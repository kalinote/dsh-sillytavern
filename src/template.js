import { Worker } from 'node:worker_threads'

const MAX_TEMPLATE_CHARS = 256 * 1024
const MAX_OUTPUT_CHARS = 256 * 1024
const WORKER_DEADLINE_MS = 500
const MAX_SCOPE_CHARS = 2 * 1024 * 1024
const WORKER_URL = new URL('./template-worker.cjs', import.meta.url)

function safeClone(value, depth = 0) {
  if (depth > 20) throw new Error('template scope nesting exceeds 20 levels')
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 10_000).map(item => safeClone(item, depth + 1))
  if (typeof value !== 'object') return String(value)
  const copy = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue
    copy[key] = safeClone(child, depth + 1)
  }
  return copy
}

function macroValue(token, scope) {
  const trimmed = token.trim()
  if (trimmed === 'char') return scope.char ?? scope.character?.name ?? ''
  if (trimmed === 'user') return scope.user ?? scope.userPersona?.name ?? ''
  if (trimmed === 'description') return scope.character?.description ?? ''
  if (trimmed === 'personality') return scope.character?.personality ?? ''
  if (trimmed === 'scenario') return scope.character?.scenario ?? ''
  if (trimmed === 'firstMessage' || trimmed === 'first_mes') return scope.character?.first_mes ?? ''
  if (trimmed.startsWith('outlet::')) return scope.outlets?.[trimmed.slice(8).trim()] ?? ''
  if (trimmed.startsWith('getvar::')) return scope.variables?.[trimmed.slice(8)] ?? ''
  if (trimmed.startsWith('globalvar::')) return scope.globalVariables?.[trimmed.slice(11)] ?? ''
  return `⦃⦃${trimmed.replaceAll('⦃', '').replaceAll('⦄', '')}⦄⦄`
}

export function renderMacros(input, scope, maxChars = MAX_OUTPUT_CHARS) {
  const source = String(input)
  if (source.length > MAX_TEMPLATE_CHARS) throw new Error(`template exceeds ${MAX_TEMPLATE_CHARS} characters`)
  const pattern = /{{([\s\S]*?)}}/g
  let output = ''
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    output += source.slice(cursor, match.index)
    output += String(macroValue(match[1], scope))
    if (output.length > maxChars) throw new Error(`template macro output exceeds ${maxChars} characters`)
    cursor = match.index + match[0].length
  }
  output += source.slice(cursor)
  if (output.length > maxChars) throw new Error(`template macro output exceeds ${maxChars} characters`)
  return output
}

export async function renderPromptTemplate(input, scope, signal) {
  signal?.throwIfAborted()
  const renderedMacros = renderMacros(input, scope)
  const scopeJson = JSON.stringify(safeClone(scope))
  if (scopeJson.length > MAX_SCOPE_CHARS) throw new Error(`template scope exceeds ${MAX_SCOPE_CHARS} characters`)
  signal?.throwIfAborted()
  const worker = new Worker(WORKER_URL, {
    workerData: { template: renderedMacros, scopeJson, maxOutputChars: MAX_OUTPUT_CHARS },
    resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, codeRangeSizeMb: 16, stackSizeMb: 2 },
  })
  return new Promise((resolveValue, reject) => {
    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal?.removeEventListener('abort', aborted)
      void worker.terminate()
      callback()
    }
    const aborted = () => finish(() => reject(signal.reason ?? new Error('template rendering aborted')))
    const deadline = setTimeout(() => finish(() => reject(new Error(`template worker timed out after ${WORKER_DEADLINE_MS}ms`))), WORKER_DEADLINE_MS)
    signal?.addEventListener('abort', aborted, { once: true })
    worker.once('message', message => finish(() => {
      if (message?.status === 1) resolveValue(String(message.value))
      else reject(new Error(String(message?.value ?? 'template worker failed')))
    }))
    worker.once('error', error => finish(() => reject(error)))
    worker.once('exit', code => {
      if (!settled && code !== 0) finish(() => reject(new Error(`template worker exited with code ${code}`)))
    })
    if (signal?.aborted) aborted()
  })
}

export function neutralizeDshTemplates(value) {
  return String(value).replaceAll('{{', '⦃⦃').replaceAll('}}', '⦄⦄')
}
