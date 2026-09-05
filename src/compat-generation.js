const TERMINAL_STATUSES = new Set(['completed', 'stopped', 'failed'])
const ALL_STATUSES = new Set(['pending', 'running', ...TERMINAL_STATUSES])

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function freeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freeze(child, seen)
  return Object.freeze(value)
}

function errorView(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  }
}

function abortError(generationId) {
  const error = new Error(`generation ${generationId} was stopped`)
  error.name = 'AbortError'
  error.code = 'generation-stopped'
  return error
}

function isAsyncIterable(value) {
  return value !== null && value !== undefined && typeof value[Symbol.asyncIterator] === 'function'
}

function streamAdapterFrom(value) {
  if (typeof value === 'function') return value
  if (value !== null && typeof value === 'object' && typeof value.stream === 'function') return value.stream.bind(value)
  throw new TypeError('CompatibilityGenerationBroker requires a stream adapter function or object with stream()')
}

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) throw new TypeError(`${label} must be a non-negative safe integer`)
  return resolved
}

function blockIndex(chunk) {
  return Number.isSafeInteger(chunk?.index) && chunk.index >= 0 ? chunk.index : 0
}

function toolCallFrom(chunk) {
  if (chunk?.type === 'tool-call') return chunk.toolCall ?? chunk.tool_call ?? chunk.call ?? chunk.block ?? chunk
  if (chunk?.type === 'block-end' && (chunk.block?.type === 'tool-call' || chunk.block?.kind === 'tool-call')) return chunk.block
  return undefined
}

function stableToolKey(toolCall) {
  const id = toolCall?.id ?? toolCall?.tool_call_id
  if (id !== undefined) return `id:${String(id)}`
  try { return `json:${JSON.stringify(toolCall)}` } catch { return toolCall }
}

function textFromBlocks(blocks) {
  return [...blocks.entries()]
    .sort(([left], [right]) => left - right)
    .filter(([, block]) => block.type === 'text')
    .map(([, block]) => block.text)
    .join('')
}

export class CompatibilityGenerationBroker {
  #stream
  #active = new Map()
  #records = new Map()
  #maxResults
  #ttlMs
  #now
  #idFactory
  #sequence = 0
  #ordinal = 0

  constructor(streamAdapter, options = {}) {
    const sourceOptions = streamAdapter !== null && typeof streamAdapter === 'object' && typeof streamAdapter.stream === 'function'
      ? { ...streamAdapter, ...options }
      : options
    this.#stream = streamAdapterFrom(streamAdapter)
    this.#maxResults = positiveInteger(sourceOptions.maxResults, 100, 'maxResults')
    this.#ttlMs = positiveInteger(sourceOptions.ttlMs, 5 * 60 * 1000, 'ttlMs')
    this.#now = sourceOptions.now ?? Date.now
    this.#idFactory = sourceOptions.idFactory ?? (() => `dsh-generation-${this.#now()}-${++this.#sequence}`)
    if (typeof this.#now !== 'function') throw new TypeError('now must be a function')
    if (typeof this.#idFactory !== 'function') throw new TypeError('idFactory must be a function')
  }

  #prune() {
    const now = this.#now()
    const terminal = [...this.#records.values()]
      .filter(record => TERMINAL_STATUSES.has(record.status))
      .sort((left, right) => left.ordinal - right.ordinal)
    for (const record of terminal) {
      if (now - record.completedAt >= this.#ttlMs) this.#records.delete(record.generationId)
    }
    const retained = [...this.#records.values()]
      .filter(record => TERMINAL_STATUSES.has(record.status))
      .sort((left, right) => left.ordinal - right.ordinal)
    while (retained.length > this.#maxResults) {
      const record = retained.shift()
      if (this.#records.get(record.generationId) === record) this.#records.delete(record.generationId)
    }
  }

  #snapshot(record) {
    if (record === undefined) return null
    return freeze({
      generationId: record.generationId,
      sessionId: record.sessionId,
      status: record.status,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      full: record.full,
      toolCalls: clone(record.toolCalls),
      finish: clone(record.finish),
      result: clone(record.result),
      error: clone(record.error),
      active: this.#active.get(record.generationId) === record,
      abortable: record.controller !== null,
      eventErrorCount: record.eventErrorCount,
    })
  }

  #emit(record, type, fields = {}) {
    if (typeof record.onEvent !== 'function') return
    const event = freeze({
      type,
      generationId: record.generationId,
      sessionId: record.sessionId,
      ...clone(fields),
    })
    try {
      const result = record.onEvent(event)
      if (result && typeof result.then === 'function') void result.catch(() => { record.eventErrorCount += 1 })
    } catch {
      record.eventErrorCount += 1
    }
  }

  #outcome(record, status) {
    return freeze({
      generationId: record.generationId,
      sessionId: record.sessionId,
      status,
      text: record.full,
      toolCalls: clone(record.toolCalls),
      finish: clone(record.finish),
    })
  }

  #terminal(record, status, error) {
    if (record.settled) return record.result
    record.settled = true
    record.status = status
    record.completedAt = this.#now()
    if (error !== undefined) record.error = errorView(error)
    record.result = this.#outcome(record, status)
    this.#active.delete(record.generationId)
    record.controller = null
    record.iterator = null
    if (status === 'stopped') this.#emit(record, 'stopped', { incremental: '', full: record.full, final: record.full })
    if (status === 'failed') this.#emit(record, 'failed', { incremental: '', full: record.full, final: record.full, error: record.error })
    this.#emit(record, 'final', { incremental: '', full: record.full, final: record.full, status, result: record.result })
    if (status === 'failed') record.reject(error)
    else record.resolve(record.result)
    record.resolve = null
    record.reject = null
    this.#prune()
    return record.result
  }

  #setBlockText(record, index, type, text, incremental) {
    const previousFull = record.full
    record.blocks.set(index, { type, text })
    record.full = textFromBlocks(record.blocks)
    if (record.full !== previousFull || incremental !== '') this.#emit(record, 'stream', { incremental, full: record.full, final: null })
  }

  #consume(record, chunk) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      const index = blockIndex(chunk)
      const previous = record.blocks.get(index)
      const text = `${previous?.type === 'text' ? previous.text : ''}${chunk.text}`
      this.#setBlockText(record, index, 'text', text, chunk.text)
    } else if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      const index = blockIndex(chunk)
      const previous = record.blocks.get(index)
      const priorText = previous?.type === 'text' ? previous.text : ''
      const incremental = chunk.block.text.startsWith(priorText) ? chunk.block.text.slice(priorText.length) : ''
      this.#setBlockText(record, index, 'text', chunk.block.text, incremental)
    }
    const toolCall = toolCallFrom(chunk)
    if (toolCall !== undefined) {
      const key = stableToolKey(toolCall)
      if (!record.toolKeys.has(key)) {
        record.toolKeys.add(key)
        record.toolCalls.push(clone(toolCall))
      }
    }
    if (chunk?.type === 'finish') record.finish = clone(chunk.reason ?? chunk.finishReason ?? chunk)
  }

  async #run(record) {
    try {
      if (record.settled) return
      record.status = 'running'
      record.startedAt = this.#now()
      this.#emit(record, 'started', { incremental: '', full: '', final: null })
      if (record.settled) return
      const signal = record.controller.signal
      const iterable = await this.#stream({ ...record.options, signal }, {
        sessionId: record.sessionId,
        generationId: record.generationId,
        signal,
      })
      if (record.settled) return
      if (!isAsyncIterable(iterable)) throw new TypeError('stream adapter must return an AsyncIterable')
      const iterator = iterable[Symbol.asyncIterator]()
      record.iterator = iterator
      while (!record.settled) {
        const step = await iterator.next()
        if (record.settled) return
        if (step.done) break
        this.#consume(record, step.value)
      }
      if (!record.settled) this.#terminal(record, 'completed')
    } catch (error) {
      if (!record.settled) {
        if (record.controller?.signal.aborted || error?.name === 'AbortError') this.#terminal(record, 'stopped', error)
        else this.#terminal(record, 'failed', error)
      }
    }
  }

  start({ sessionId, generationId, options = {}, onEvent } = {}) {
    this.#prune()
    const normalizedSessionId = String(sessionId ?? '').trim()
    if (normalizedSessionId === '') throw new TypeError('sessionId is required')
    if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('generation options must be an object')
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function')
    const id = generationId === undefined ? String(this.#idFactory()) : String(generationId)
    if (id.trim() === '') throw new TypeError('generationId must be a non-empty string')
    if (this.#active.has(id)) {
      const error = new Error(`generation ${id} is already active`)
      error.code = 'generation-id-active'
      throw error
    }
    const controller = new AbortController()
    let resolve
    let reject
    const done = new Promise((yes, no) => { resolve = yes; reject = no })
    const record = {
      generationId: id,
      sessionId: normalizedSessionId,
      status: 'pending',
      createdAt: this.#now(),
      startedAt: null,
      completedAt: null,
      ordinal: ++this.#ordinal,
      options: { ...options },
      onEvent,
      eventErrorCount: 0,
      controller,
      iterator: null,
      blocks: new Map(),
      full: '',
      toolCalls: [],
      toolKeys: new Set(),
      finish: null,
      result: null,
      error: null,
      settled: false,
      resolve,
      reject,
    }
    this.#records.set(id, record)
    this.#active.set(id, record)
    void Promise.resolve().then(() => this.#run(record))
    return freeze({ generationId: id, done })
  }

  stopById(generationId) {
    const id = String(generationId ?? '')
    const record = this.#active.get(id)
    if (record === undefined || record.settled) return false
    const error = abortError(id)
    const iterator = record.iterator
    record.controller.abort(error)
    this.#terminal(record, 'stopped', error)
    if (iterator && typeof iterator.return === 'function') {
      try {
        const returned = iterator.return()
        if (returned && typeof returned.catch === 'function') void returned.catch(() => undefined)
      } catch {}
    }
    return true
  }

  stopAll() {
    const ids = [...this.#active.keys()]
    for (const id of ids) this.stopById(id)
    return ids.length > 0
  }

  get(generationId) {
    this.#prune()
    return this.#snapshot(this.#records.get(String(generationId ?? '')))
  }

  list({ sessionId, status, activeOnly = false } = {}) {
    this.#prune()
    if (status !== undefined && !ALL_STATUSES.has(status)) throw new TypeError(`unknown generation status ${status}`)
    const normalizedSessionId = sessionId === undefined ? undefined : String(sessionId)
    return [...this.#records.values()]
      .filter(record => normalizedSessionId === undefined || record.sessionId === normalizedSessionId)
      .filter(record => status === undefined || record.status === status)
      .filter(record => !activeOnly || this.#active.get(record.generationId) === record)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(record => this.#snapshot(record))
  }
}
