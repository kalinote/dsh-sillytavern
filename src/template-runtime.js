import { Worker } from 'node:worker_threads'

export const TEMPLATE_LIMITS = Object.freeze({
  maxTemplateChars: 256 * 1024,
  maxOutputChars: 256 * 1024,
  maxScopeChars: 2 * 1024 * 1024,
  deadlineMs: 500,
})

const WORKER_URL = new URL('./template-worker.cjs', import.meta.url)

function cloneForWorker(value, depth = 0) {
  if (depth > 20) throw new Error('template scope nesting exceeds 20 levels')
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 10_000).map(item => cloneForWorker(item, depth + 1))
  if (typeof value !== 'object') return String(value)
  const copy = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue
    copy[key] = cloneForWorker(child, depth + 1)
  }
  return copy
}

function workerError(value) {
  const diagnostic = value?.diagnostic ?? {
    severity: 'error',
    code: value?.code ?? 'TEMPLATE_RUNTIME_ERROR',
    message: String(value?.message ?? value ?? 'template worker failed'),
    source: value?.source ?? 'template.ejs',
  }
  const error = new Error(diagnostic.message)
  error.name = value?.name ?? 'TemplateRuntimeError'
  error.code = diagnostic.code
  error.diagnostic = diagnostic
  if (typeof value?.stack === 'string') error.stack = value.stack
  return error
}

/**
 * A single prompt-build lifecycle. Definitions, variable cache and compilation
 * cache are deliberately shared by every render performed through this object.
 */
export class TemplateRuntime {
  constructor(options = {}) {
    const limits = { ...TEMPLATE_LIMITS, ...options.limits }
    this.limits = limits
    this.adapters = {
      execute: options.execute,
      resolveInclude: options.resolveInclude,
    }
    this.pending = new Map()
    this.nextId = 1
    this.closed = false
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.worker = new Worker(WORKER_URL, {
      workerData: {
        runtime: true,
        state: cloneForWorker(options.state ?? {}),
        resources: cloneForWorker(options.resources ?? {}),
        baseRevisions: cloneForWorker(options.baseRevisions ?? {}),
        limits,
      },
      resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, codeRangeSizeMb: 16, stackSizeMb: 2 },
    })
    this.worker.on('message', message => void this.#onMessage(message))
    this.worker.on('error', error => this.#failAll(error))
    this.worker.on('exit', code => {
      if (!this.closed && code !== 0) this.#failAll(new Error(`template worker exited with code ${code}`))
    })
  }

  async #onMessage(message) {
    if (message?.type === 'ready') {
      this.resolveReady()
      return
    }
    if (message?.type === 'rpc') {
      const adapter = this.adapters[message.method]
      if (typeof adapter !== 'function') {
        this.worker.postMessage({
          type: 'rpc-result',
          rpcId: message.rpcId,
          ok: false,
          error: { code: `TEMPLATE_${String(message.method).toUpperCase()}_UNAVAILABLE`, message: `${message.method} is unavailable in this template runtime` },
        })
        return
      }
      try {
        const value = await adapter(...(Array.isArray(message.args) ? message.args : []))
        this.worker.postMessage({ type: 'rpc-result', rpcId: message.rpcId, ok: true, value: cloneForWorker(value) })
      } catch (error) {
        this.worker.postMessage({
          type: 'rpc-result',
          rpcId: message.rpcId,
          ok: false,
          error: { code: error?.code ?? 'TEMPLATE_ADAPTER_ERROR', message: error instanceof Error ? error.message : String(error) },
        })
      }
      return
    }
    if (message?.type !== 'result') return
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    clearTimeout(pending.deadline)
    pending.signal?.removeEventListener('abort', pending.aborted)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(workerError(message.error))
  }

  #failAll(error) {
    if (this.closed && this.pending.size === 0) return
    this.closed = true
    this.rejectReady(error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.deadline)
      pending.signal?.removeEventListener('abort', pending.aborted)
      pending.reject(error)
    }
    this.pending.clear()
    void this.worker.terminate()
  }

  async render(input, scope = {}, options = {}, signal) {
    if (this.closed) throw new Error('template runtime is closed')
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const source = String(input)
    if (source.length > this.limits.maxTemplateChars) throw new Error(`template exceeds ${this.limits.maxTemplateChars} characters`)
    const clonedScope = cloneForWorker(scope)
    const scopeJson = JSON.stringify(clonedScope)
    if (scopeJson.length > this.limits.maxScopeChars) throw new Error(`template scope exceeds ${this.limits.maxScopeChars} characters`)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const stop = error => {
        if (!this.pending.has(id)) return
        this.#failAll(error)
      }
      const aborted = () => stop(signal.reason ?? new Error('template rendering aborted'))
      const deadline = setTimeout(() => stop(new Error(`template worker timed out after ${this.limits.deadlineMs}ms`)), this.limits.deadlineMs)
      this.pending.set(id, { resolve, reject, signal, aborted, deadline })
      signal?.addEventListener('abort', aborted, { once: true })
      this.worker.postMessage({
        type: 'render',
        id,
        source,
        scopeJson,
        options: cloneForWorker(options),
      })
      if (signal?.aborted) aborted()
    })
  }

  async snapshot(signal) {
    if (this.closed) throw new Error('template runtime is closed')
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const stop = error => {
        if (!this.pending.has(id)) return
        this.#failAll(error)
      }
      const aborted = () => stop(signal.reason ?? new Error('template snapshot aborted'))
      const deadline = setTimeout(() => stop(new Error(`template worker timed out after ${this.limits.deadlineMs}ms`)), this.limits.deadlineMs)
      this.pending.set(id, { resolve, reject, signal, aborted, deadline })
      signal?.addEventListener('abort', aborted, { once: true })
      this.worker.postMessage({ type: 'snapshot', id })
      if (signal?.aborted) aborted()
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.deadline)
      pending.signal?.removeEventListener('abort', pending.aborted)
      pending.reject(new Error('template runtime closed before rendering completed'))
    }
    this.pending.clear()
    await this.worker.terminate()
  }
}

export function createTemplateRuntime(options) {
  return new TemplateRuntime(options)
}
