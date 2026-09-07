'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { createContext, Script } = require('node:vm')
const ejs = require('ejs')

const limits = workerData.limits ?? {
  maxOutputChars: workerData.maxOutputChars ?? 256 * 1024,
  deadlineMs: 500,
}

const context = createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
})

new Script(`for (const name of ${JSON.stringify([
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array', 'Atomics', 'WebAssembly',
])}) Object.defineProperty(globalThis, name, { value: undefined })`, {
  filename: 'dsh-sillytavern-template-scope.js',
}).runInContext(context, { timeout: 50, breakOnSigint: false })

const parseJson = new Script('(json) => JSON.parse(json)', { filename: 'dsh-sillytavern-template-json.js' })
  .runInContext(context, { timeout: 50, breakOnSigint: false })
const makeApi = new Script(`(bridge) => Object.freeze({
  getvar(...args) { return bridge('getvar', args) },
  setvar(...args) { return bridge('setvar', args) },
  incvar(...args) { return bridge('incvar', args) },
  decvar(...args) { return bridge('decvar', args) },
  getLocalVar(...args) { return bridge('getLocalVar', args) },
  setLocalVar(...args) { return bridge('setLocalVar', args) },
  incLocalVar(...args) { return bridge('incLocalVar', args) },
  decLocalVar(...args) { return bridge('decLocalVar', args) },
  getGlobalVar(...args) { return bridge('getGlobalVar', args) },
  setGlobalVar(...args) { return bridge('setGlobalVar', args) },
  incGlobalVar(...args) { return bridge('incGlobalVar', args) },
  decGlobalVar(...args) { return bridge('decGlobalVar', args) },
  getMessageVar(...args) { return bridge('getMessageVar', args) },
  setMessageVar(...args) { return bridge('setMessageVar', args) },
  incMessageVar(...args) { return bridge('incMessageVar', args) },
  decMessageVar(...args) { return bridge('decMessageVar', args) },
  execute(...args) { return bridge('execute', args) },
  include(...args) { return bridge('include', args) },
  getwi(...args) { return bridge('getwi', args) },
  getWorldInfo(...args) { return bridge('getwi', args) },
  getchar(...args) { return bridge('getchar', args) },
  getchr(...args) { return bridge('getchar', args) },
  getChara(...args) { return bridge('getchar', args) },
  getpreset(...args) { return bridge('getpreset', args) },
  getprp(...args) { return bridge('getpreset', args) },
  getPresetPrompt(...args) { return bridge('getpreset', args) },
  define(...args) { return bridge('define', args) },
  inject(...args) { return bridge('inject', args) },
  injectPrompt(...args) { return bridge('inject', args) },
})`, { filename: 'dsh-sillytavern-template-api.js' })
  .runInContext(context, { timeout: 50, breakOnSigint: false })

const toRealm = value => value === undefined ? undefined : parseJson(JSON.stringify(value))
const snapshot = (value, label = 'template value') => {
  if (value === undefined) return undefined
  try { return JSON.parse(JSON.stringify(value)) } catch (error) {
    const wrapped = new TypeError(`${label} must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`)
    wrapped.code = 'TEMPLATE_STATE_NOT_SERIALIZABLE'
    throw wrapped
  }
}

const initialState = workerData.state ?? {}
const scopes = toRealm({
  global: initialState.global ?? initialState.globalVariables ?? {},
  initial: initialState.initial ?? initialState.initialVariables ?? {},
  local: initialState.local ?? initialState.chat ?? initialState.variables ?? {},
  message: initialState.message ?? initialState.messageVariables ?? {},
})
const resources = toRealm(workerData.resources ?? {})
const baseRevisions = toRealm(workerData.baseRevisions ?? {})
const definitions = toRealm({})
const compileCache = new Map()
const mutations = []
const injections = []
const diagnostics = []
let sequence = 0
let activeFrame
let nextRpcId = 1
let nextCallId = 1
const rpcPending = new Map()
const vmPending = new Map()
context.__templateCalls = Object.create(null)
const drainMicrotasks = new Script('void 0', { filename: 'dsh-sillytavern-template-drain.cjs' })
let pumpScheduled = false

function settleVmCalls() {
  for (const [callId, pending] of vmPending) {
    const call = context.__templateCalls[callId]
    if (!call?.settled) continue
    vmPending.delete(callId)
    if (call.error !== undefined) pending.reject(call.error)
    else pending.resolve(call.value)
  }
}

function pumpVm() {
  pumpScheduled = false
  if (vmPending.size === 0) return
  try {
    drainMicrotasks.runInContext(context, { timeout: 50, breakOnSigint: false })
    settleVmCalls()
  } catch (error) {
    for (const pending of vmPending.values()) pending.reject(error)
    vmPending.clear()
  }
}

function schedulePump() {
  if (pumpScheduled || vmPending.size === 0) return
  pumpScheduled = true
  setImmediate(pumpVm)
}

function mergeTree(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) return target.concat(source)
  if (target !== null && source !== null && typeof target === 'object' && typeof source === 'object' && !Array.isArray(target) && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source)) target[key] = key in target ? mergeTree(target[key], value) : value
    return target
  }
  return source
}

function rebuildCache() {
  scopes.cache = Object.assign({}, scopes.global, scopes.initial, scopes.local, scopes.message)
  return scopes.cache
}
rebuildCache()

function stringToPath(value) {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'number') return [String(value)]
  const source = String(value)
  const result = []
  if (source[0] === '.') result.push('')
  source.replace(/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g, (match, number, quote, quoted) => {
    result.push(quote ? quoted.replace(/\\(\\)?/g, '$1') : (number ?? match))
    return match
  })
  return result
}

function pathFor(root, key) {
  if (key === null) return null
  if (typeof key === 'string' && root !== null && typeof root === 'object' && Object.prototype.hasOwnProperty.call(root, key)) return [key]
  return stringToPath(key)
}

function hasPath(root, key) {
  const path = pathFor(root, key)
  if (path === null) return true
  let current = root
  for (const part of path) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return false
    current = current[part]
  }
  return true
}

function getPath(root, key, fallback) {
  const path = pathFor(root, key)
  if (path === null) return root
  let current = root
  for (const part of path) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return fallback
    current = current[part]
  }
  return current
}

function setPath(root, key, value) {
  const path = pathFor(root, key)
  if (path === null) {
    for (const name of Object.keys(root)) delete root[name]
    if (value !== null && typeof value === 'object') Object.assign(root, value)
    return null
  }
  if (path.length === 0) return path
  let current = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index]
    if (current[part] === null || typeof current[part] !== 'object') current[part] = /^\d+$/.test(path[index + 1]) ? [] : {}
    current = current[part]
  }
  if (value === undefined) {
    if (Array.isArray(current) && /^\d+$/.test(path.at(-1))) delete current[Number(path.at(-1))]
    else delete current[path.at(-1)]
  } else current[path.at(-1)] = value
  return path
}

function optionObject(options, kind) {
  if (options === null || options === undefined) return {}
  if (typeof options === 'boolean') return { dryRun: options }
  if (typeof options === 'string') {
    if (['global', 'local', 'message', 'cache', 'initial'].includes(options)) return kind === 'update' ? { outscope: options } : { scope: options }
    if (['old', 'new', 'fullcache'].includes(options)) return { results: options }
    return { flags: options }
  }
  return options
}

function messageIdFor(options) {
  const raw = options?.withMsg?.id
  return raw === undefined ? resources.currentMessageId : raw
}

function stateScope(name, options = {}) {
  if (name === 'message' && options.withMsg && options.withMsg.id !== undefined && options.withMsg.id !== resources.currentMessageId) {
    const error = new Error(`message variable scope ${options.withMsg.id} is unavailable; only the current message scope is loaded`)
    error.code = 'TEMPLATE_MESSAGE_SCOPE_UNAVAILABLE'
    throw error
  }
  if (name === 'message' && options.withMsg?.swipe_id !== undefined && options.withMsg.swipe_id !== (resources.currentSwipeId ?? 0)) {
    const error = new Error(`message swipe ${options.withMsg.swipe_id} is unavailable; only the current swipe scope is loaded`)
    error.code = 'TEMPLATE_MESSAGE_SCOPE_UNAVAILABLE'
    throw error
  }
  return scopes[name]
}

function getVariable(key, options = {}) {
  options = optionObject(options, 'get')
  const target = stateScope(options.scope ?? 'cache', options)
  let value = getPath(target, key, options.defaults)
  if (options.index !== null && options.index !== undefined) {
    let indexed = value
    if (typeof indexed === 'string') {
      try { indexed = JSON.parse(indexed) } catch { indexed = {} }
    }
    value = getPath(indexed, options.index, options.defaults)
  }
  return options.clone ? toRealm(snapshot(value)) : value
}

function mutationRecord(scope, key, path, value, deleted, options) {
  if (scope === 'cache') return
  const record = {
    scope,
    key,
    path,
    value: snapshot(value, 'template mutation value'),
    delete: deleted,
    sequence: ++sequence,
    source: activeFrame?.source ?? 'template.ejs',
  }
  if (scope === 'message') {
    record.messageId = messageIdFor(options)
    record.swipeId = options?.withMsg?.swipe_id ?? resources.currentSwipeId
  }
  mutations.push(record)
}

function setVariable(key, value, options = {}) {
  options = optionObject(options, 'set')
  if (activeFrame?.stage === 'prepare' && options.dryRun !== true) return undefined
  const scopeName = options.scope ?? 'message'
  const target = stateScope(scopeName, options)
  const cachePath = pathFor(scopes.cache, key)
  let oldValue
  let newValue = value
  let path
  if (options.index !== null && options.index !== undefined) {
    let container = getPath(scopes.cache, key, {})
    if (typeof container === 'string') {
      try { container = JSON.parse(container) } catch { container = {} }
    }
    container = toRealm(snapshot(container))
    const exists = hasPath(container, options.index)
    if ((options.flags === 'nx' && exists) || (options.flags === 'xx' && !exists)) return undefined
    oldValue = getPath(container, options.index)
    if (options.merge) newValue = mergeTree(toRealm(snapshot(oldValue ?? (Array.isArray(value) ? [] : {}))), value)
    setPath(container, options.index, newValue)
    newValue = JSON.stringify(container)
    path = setPath(target, key, newValue)
    setPath(scopes.cache, cachePath, newValue)
  } else {
    const cacheHas = hasPath(scopes.cache, key)
    const scopedHas = hasPath(target, key)
    if ((options.flags === 'nx' && cacheHas) || (options.flags === 'xx' && !cacheHas) || (options.flags === 'nxs' && scopedHas) || (options.flags === 'xxs' && !scopedHas)) return undefined
    oldValue = getPath(scopes.cache, key)
    if (options.merge) newValue = mergeTree(toRealm(snapshot(oldValue ?? (Array.isArray(value) ? [] : {}))), value)
    path = setPath(target, key, newValue)
    setPath(scopes.cache, cachePath, newValue)
  }
  mutationRecord(scopeName, key, path, newValue, newValue === undefined, options)
  if (options.results === 'old') return oldValue
  if (options.results === 'fullcache') return scopes.cache
  return newValue
}

function updateVariable(key, amount = 1, options = {}) {
  options = optionObject(options, 'update')
  const current = getVariable(key, {
    index: options.index,
    scope: options.inscope ?? 'cache',
    defaults: options.defaults ?? 0,
    withMsg: options.withMsg,
  })
  let value = current + amount
  if (options.min !== null && options.min !== undefined) value = Math.max(value, options.min)
  if (options.max !== null && options.max !== undefined) value = Math.min(value, options.max)
  return setVariable(key, value, {
    index: options.index,
    scope: options.outscope ?? 'message',
    flags: options.flags,
    results: options.results,
    withMsg: options.withMsg,
    dryRun: options.dryRun,
  })
}

function diagnostic(severity, code, message, source = activeFrame?.source ?? 'template.ejs') {
  diagnostics.push({ severity, code, message, source })
}

function matchValue(value, pattern) {
  if (pattern !== null && typeof pattern === 'object' && typeof pattern.test === 'function') return pattern.test(String(value ?? ''))
  return String(value ?? '') === String(pattern ?? '')
}

function worldbookNamed(name) {
  const books = Array.isArray(resources.worldbooks) ? resources.worldbooks : []
  const wanted = name ?? resources.currentWorldbook
  return books.find(book => matchValue(book.name ?? book.id, wanted))
}

function worldEntry(book, title) {
  return (Array.isArray(book?.entries) ? book.entries : []).find(entry => {
    if (typeof title === 'number') return Number(entry.uid ?? entry.id) === title
    return [entry.comment, entry.title, entry.name, entry.uid, entry.id].some(value => matchValue(value, title))
  })
}

async function getWorldInfo(...args) {
  if (!Array.isArray(resources.worldbooks)) {
    const error = new Error('world-book resources are unavailable in this template runtime')
    error.code = 'TEMPLATE_WORLDINFO_UNAVAILABLE'
    throw error
  }
  let bookName
  let title
  let data = {}
  if (args.length > 1 && (typeof args[1] !== 'object' || args[1] === null || typeof args[1]?.test === 'function')) {
    ;[bookName, title, data = {}] = args
  } else {
    ;[title, data = {}] = args
    bookName = resources.currentWorldbook
  }
  const book = worldbookNamed(bookName)
  const entry = worldEntry(book, title)
  if (!entry) {
    diagnostic('warning', 'TEMPLATE_WORLDINFO_NOT_FOUND', `world-book entry ${String(title)} was not found in ${String(bookName ?? 'the current world book')}`)
    return ''
  }
  return evaluateTemplate(String(entry.content ?? ''), Object.assign({}, activeFrame.scope, data, { world_info: entry }), {
    source: `worldbook:${book?.name ?? book?.id ?? 'current'}/${entry.comment ?? entry.title ?? entry.uid ?? entry.id ?? 'entry'}`,
    stage: activeFrame.stage,
    output: 'emit',
  })
}

const DEFAULT_CHARACTER_TEMPLATE = `<% if (name) { %><<%- name %>>\n<% if (system_prompt) { %>System: <%- system_prompt %>\n<% } %>name: <%- name %>\n<% if (personality) { %>personality: <%- personality %>\n<% } %><% if (description) { %>description: <%- description %>\n<% } %><% if (message_example) { %>example:\n<%- message_example %>\n<% } %><% if (depth_prompt) { %>System: <%- depth_prompt %>\n<% } %></<%- name %>><% } %>`

function characterNamed(name) {
  const characters = Array.isArray(resources.characters) ? resources.characters : []
  const wanted = name ?? resources.currentCharacter
  return characters.find(character => [character.id, character.name, character.data?.name, character.card?.data?.name]
    .some(value => value !== undefined && matchValue(value, wanted)))
}

async function getCharacter(name = resources.currentCharacter, template = DEFAULT_CHARACTER_TEMPLATE, data = {}) {
  if (!Array.isArray(resources.characters)) {
    const error = new Error('character resources are unavailable in this template runtime')
    error.code = 'TEMPLATE_CHARACTER_UNAVAILABLE'
    throw error
  }
  if (template !== null && typeof template === 'object') {
    data = template
    template = DEFAULT_CHARACTER_TEMPLATE
  }
  const item = characterNamed(name)
  if (!item) {
    diagnostic('warning', 'TEMPLATE_CHARACTER_NOT_FOUND', `character ${String(name)} was not found`)
    return ''
  }
  const card = item.card?.data ?? item.data ?? item
  const definition = {
    name: card.name ?? item.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_message: card.first_mes ?? card.first_message,
    message_example: card.mes_example ?? card.message_example,
    creator_notes: card.creator_notes,
    system_prompt: card.system_prompt,
    post_history_instructions: card.post_history_instructions,
    alternate_greetings: card.alternate_greetings,
    depth_prompt: card.depth_prompt,
    creator: card.creator,
  }
  return evaluateTemplate(String(template ?? DEFAULT_CHARACTER_TEMPLATE), Object.assign({}, activeFrame.scope, definition, data, { chara_name: definition.name }), {
    source: `character:${definition.name ?? item.id ?? 'current'}`,
    stage: activeFrame.stage,
    output: 'emit',
  })
}

async function getPreset(name, data = {}) {
  if (!Array.isArray(resources.presets)) {
    const error = new Error('preset resources are unavailable in this template runtime')
    error.code = 'TEMPLATE_PRESET_UNAVAILABLE'
    throw error
  }
  const preset = resources.presets.find(item => matchValue(item.name ?? item.id, name))
  if (!preset) {
    diagnostic('warning', 'TEMPLATE_PRESET_NOT_FOUND', `preset prompt ${String(name)} was not found`)
    return ''
  }
  return evaluateTemplate(String(preset.content ?? preset.prompt ?? ''), Object.assign({}, activeFrame.scope, data, { prompt_name: preset.name ?? name }), {
    source: `preset:${preset.name ?? preset.id ?? name}`,
    stage: activeFrame.stage,
    output: 'emit',
  })
}

function defineValue(name, value, merge = false) {
  const previous = getPath(definitions, name)
  const next = merge ? mergeTree(previous ?? (Array.isArray(value) ? [] : {}), value) : value
  setPath(definitions, name, next)
  if (activeFrame?.locals) setPath(activeFrame.locals, name, next)
  return previous
}

function injectValue(text, options = {}) {
  const record = {
    text: String(text ?? ''),
    position: String(options.position ?? 'after'),
    role: options.role === undefined ? 'system' : String(options.role),
    depth: options.depth === undefined ? 0 : Number(options.depth),
    once: options.once === undefined ? true : Boolean(options.once),
    source: activeFrame?.source ?? 'template.ejs',
    sequence: ++sequence,
  }
  injections.push(record)
  return record
}

function rpc(method, args) {
  return new Promise((resolve, reject) => {
    const rpcId = nextRpcId++
    rpcPending.set(rpcId, { resolve, reject })
    parentPort.postMessage({ type: 'rpc', rpcId, method, args: snapshot(args, `${method} arguments`) })
  })
}

async function includeTemplate(path, data = {}) {
  const includes = resources.includes ?? {}
  let item = includes[path]
  if (item === undefined) item = await rpc('resolveInclude', [path, activeFrame?.source])
  if (item === undefined || item === null) {
    const error = new Error(`template include ${String(path)} was not found`)
    error.code = 'TEMPLATE_INCLUDE_NOT_FOUND'
    throw error
  }
  const source = typeof item === 'string' ? item : item.content
  const sourceName = typeof item === 'string' ? `include:${path}` : (item.source ?? `include:${path}`)
  return evaluateTemplate(String(source ?? ''), Object.assign({}, activeFrame.scope, data), {
    source: sourceName,
    stage: activeFrame.stage,
    output: 'emit',
  })
}

const api = makeApi((method, args) => {
  switch (method) {
    case 'getvar': return getVariable(...args)
    case 'setvar': return setVariable(...args)
    case 'incvar': return updateVariable(args[0], args[1] ?? 1, args[2])
    case 'decvar': return updateVariable(args[0], -(args[1] ?? 1), args[2])
    case 'getLocalVar': return getVariable(args[0], { ...optionObject(args[1], 'get'), scope: 'local' })
    case 'setLocalVar': return setVariable(args[0], args[1], { ...optionObject(args[2], 'set'), scope: 'local' })
    case 'incLocalVar': return updateVariable(args[0], args[1] ?? 1, { ...optionObject(args[2], 'update'), outscope: 'local' })
    case 'decLocalVar': return updateVariable(args[0], -(args[1] ?? 1), { ...optionObject(args[2], 'update'), outscope: 'local' })
    case 'getGlobalVar': return getVariable(args[0], { ...optionObject(args[1], 'get'), scope: 'global' })
    case 'setGlobalVar': return setVariable(args[0], args[1], { ...optionObject(args[2], 'set'), scope: 'global' })
    case 'incGlobalVar': return updateVariable(args[0], args[1] ?? 1, { ...optionObject(args[2], 'update'), outscope: 'global' })
    case 'decGlobalVar': return updateVariable(args[0], -(args[1] ?? 1), { ...optionObject(args[2], 'update'), outscope: 'global' })
    case 'getMessageVar': return getVariable(args[0], { ...optionObject(args[1], 'get'), scope: 'message' })
    case 'setMessageVar': return setVariable(args[0], args[1], { ...optionObject(args[2], 'set'), scope: 'message' })
    case 'incMessageVar': return updateVariable(args[0], args[1] ?? 1, { ...optionObject(args[2], 'update'), outscope: 'message' })
    case 'decMessageVar': return updateVariable(args[0], -(args[1] ?? 1), { ...optionObject(args[2], 'update'), outscope: 'message' })
    case 'execute': return rpc('execute', args)
    case 'include': return includeTemplate(...args)
    case 'getwi': return getWorldInfo(...args)
    case 'getchar': return getCharacter(...args)
    case 'getpreset': return getPreset(...args)
    case 'define': return defineValue(...args)
    case 'inject': return injectValue(...args)
    default: throw new Error(`unknown template API ${method}`)
  }
})

function compile(source, sourceName) {
  const key = `${sourceName}\0${source}`
  if (compileCache.has(key)) return compileCache.get(key)
  const generated = ejs.compile(source, {
    async: true,
    client: true,
    compileDebug: true,
    filename: sourceName,
    outputFunctionName: 'print',
    _with: true,
  }).toString()
  const compiled = new Script(`(${generated})`, { filename: `${sourceName}.compiled.cjs` })
    .runInContext(context, { timeout: 50, breakOnSigint: false })
  compileCache.set(key, compiled)
  return compiled
}

function identity(value) {
  return value === undefined || value === null ? '' : String(value)
}

function rethrow(error, source, filename, line) {
  const lines = String(source).split('\n')
  const start = Math.max(line - 3, 0)
  const end = Math.min(lines.length, line + 3)
  const excerpt = lines.slice(start, end).map((text, index) => `${index + start + 1 === line ? ' >> ' : '    '}${index + start + 1}| ${text}`).join('\n')
  error.path = filename
  error.message = `${filename || 'template.ejs'}:${line}\n${excerpt}\n\n${error.message}`
  throw error
}

function macroValue(token, scope) {
  const trimmed = token.trim()
  if (trimmed === 'char') return scope.char ?? scope.character?.name ?? ''
  if (trimmed === 'user') return scope.user ?? scope.userPersona?.name ?? scope.persona?.name ?? ''
  if (trimmed === 'description') return scope.character?.description ?? ''
  if (trimmed === 'personality') return scope.character?.personality ?? ''
  if (trimmed === 'scenario') return scope.character?.scenario ?? ''
  if (trimmed === 'firstMessage' || trimmed === 'first_mes') return scope.character?.first_mes ?? scope.character?.firstMessage ?? ''
  if (trimmed.startsWith('outlet::')) return scope.outlets?.[trimmed.slice(8).trim()] ?? ''
  if (trimmed.startsWith('getvar::')) return getPath(scopes.cache, trimmed.slice(8), '')
  if (trimmed.startsWith('globalvar::') || trimmed.startsWith('getglobalvar::')) {
    const offset = trimmed.startsWith('globalvar::') ? 11 : 14
    return getPath(scopes.global, trimmed.slice(offset), '')
  }
  return `⦃⦃${trimmed.replaceAll('⦃', '').replaceAll('⦄', '')}⦄⦄`
}

function expandMacros(source, scope) {
  let output = ''
  let cursor = 0
  for (const match of source.matchAll(/{{([\s\S]*?)}}/g)) {
    output += source.slice(cursor, match.index)
    output += String(macroValue(match[1], scope))
    if (output.length > limits.maxOutputChars) {
      const error = new Error(`template macro output exceeds ${limits.maxOutputChars} characters`)
      error.code = 'TEMPLATE_MACRO_OUTPUT_LIMIT'
      throw error
    }
    cursor = match.index + match[0].length
  }
  output += source.slice(cursor)
  if (output.length > limits.maxOutputChars) {
    const error = new Error(`template macro output exceeds ${limits.maxOutputChars} characters`)
    error.code = 'TEMPLATE_MACRO_OUTPUT_LIMIT'
    throw error
  }
  return output
}

async function evaluateTemplate(source, scope, options = {}) {
  source = expandMacros(source, scope)
  if (!source.includes('<%')) return source
  const sourceName = String(options.source ?? options.filename ?? 'template.ejs')
  const stage = ['prepare', 'generate', 'render'].includes(options.stage) ? options.stage : 'generate'
  const previousFrame = activeFrame
  const locals = Object.assign({}, scope, definitions, api, {
    stage,
    phase: stage,
    runID: workerData.baseRevisions?.runID,
  })
  Object.defineProperty(locals, 'variables', { enumerable: true, configurable: true, get: () => scopes.cache })
  activeFrame = { source: sourceName, stage, scope, locals }
  const callId = nextCallId++
  try {
    const compiled = compile(source, sourceName)
    const call = context.__templateCalls[callId] = { compiled, locals, identity, include: api.include, rethrow, settled: false }
    new Script(`Promise.resolve(__templateCalls[${callId}].compiled.call(__templateCalls[${callId}].locals, __templateCalls[${callId}].locals, __templateCalls[${callId}].identity, __templateCalls[${callId}].include, __templateCalls[${callId}].rethrow)).then(value => { __templateCalls[${callId}].value = value; __templateCalls[${callId}].settled = true }, error => { __templateCalls[${callId}].error = error; __templateCalls[${callId}].settled = true })`, {
      filename: `${sourceName}.invoke.cjs`,
    }).runInContext(context, { timeout: 50, breakOnSigint: false })
    if (call.settled && call.error !== undefined) throw call.error
    const output = call.settled ? call.value : await new Promise((resolve, reject) => {
      vmPending.set(callId, { resolve, reject })
      schedulePump()
    })
    const text = String(output ?? '')
    if (text.length > limits.maxOutputChars) {
      const error = new Error(`template output exceeds ${limits.maxOutputChars} characters`)
      error.code = 'TEMPLATE_OUTPUT_LIMIT'
      throw error
    }
    return text
  } finally {
    vmPending.delete(callId)
    delete context.__templateCalls[callId]
    activeFrame = previousFrame
    schedulePump()
  }
}

function errorPayload(error, source) {
  const message = error instanceof Error ? error.message : String(error)
  const lineMatch = message.match(/(?:\.ejs|worldbook:|character:|preset:|include:)[^:\n]*:(\d+)/)
  const diagnostic = {
    severity: 'error',
    code: error?.code ?? (error instanceof SyntaxError ? 'TEMPLATE_SYNTAX_ERROR' : 'TEMPLATE_RUNTIME_ERROR'),
    message,
    source,
  }
  if (lineMatch) diagnostic.line = Number(lineMatch[1])
  return { name: error?.name ?? 'Error', code: diagnostic.code, message, stack: error?.stack, source, diagnostic }
}

function structuredSnapshot(fromMutation, fromInjection, fromDiagnostic) {
  return snapshot({
    baseRevisions,
    mutations: mutations.slice(fromMutation),
    injections: injections.slice(fromInjection),
    diagnostics: diagnostics.slice(fromDiagnostic),
    scopes: {
      global: scopes.global,
      initial: scopes.initial,
      local: scopes.local,
      message: scopes.message,
      cache: scopes.cache,
    },
    compileCacheSize: compileCache.size,
  })
}

async function handleRender(message) {
  const sourceName = String(message.options?.source ?? message.options?.filename ?? 'template.ejs')
  const stage = ['prepare', 'generate', 'render'].includes(message.options?.stage) ? message.options.stage : 'generate'
  const outputMode = message.options?.output ?? (stage === 'prepare' ? 'discard' : 'emit')
  const fromMutation = mutations.length
  const fromInjection = injections.length
  const fromDiagnostic = diagnostics.length
  try {
    const rawText = await evaluateTemplate(message.source, parseJson(message.scopeJson), { ...message.options, source: sourceName, stage })
    const state = structuredSnapshot(fromMutation, fromInjection, fromDiagnostic)
    parentPort.postMessage({
      type: 'result',
      id: message.id,
      ok: true,
      value: { text: outputMode === 'discard' ? '' : rawText, stage, output: outputMode, ...state },
    })
  } catch (error) {
    parentPort.postMessage({ type: 'result', id: message.id, ok: false, error: errorPayload(error, sourceName) })
  }
}

parentPort.on('message', message => {
  if (message?.type === 'rpc-result') {
    const pending = rpcPending.get(message.rpcId)
    if (!pending) return
    rpcPending.delete(message.rpcId)
    if (message.ok) pending.resolve(toRealm(message.value))
    else {
      const error = new Error(String(message.error?.message ?? 'template adapter failed'))
      error.code = message.error?.code ?? 'TEMPLATE_ADAPTER_ERROR'
      pending.reject(error)
    }
    schedulePump()
    return
  }
  if (message?.type === 'snapshot') {
    try { parentPort.postMessage({ type: 'result', id: message.id, ok: true, value: structuredSnapshot(0, 0, 0) }) } catch (error) {
      parentPort.postMessage({ type: 'result', id: message.id, ok: false, error: errorPayload(error, 'template-runtime') })
    }
    return
  }
  if (message?.type === 'render') void handleRender(message)
})

parentPort.postMessage({ type: 'ready' })

if (!workerData.runtime && typeof workerData.template === 'string') {
  void handleRender({ id: 0, source: workerData.template, scopeJson: workerData.scopeJson ?? '{}', options: {} })
}
