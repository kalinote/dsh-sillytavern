import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { hostname } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { parseCardBytes, validateCardV3 } from './card-v3.js'
import { createChatMessages, createCompatChat, deleteChatMessages, getChatMessages, inspectCompatChat, mergeNativeMessages, rotateChatMessages, setChatMessages, switchSwipe } from './compat-chat.js'
import { compatibilityScriptKey, emptyCompatibilityWorkspace, normalizeCompatibilityWorkspace, readWorkspaceVariableScope, replaceWorkspaceVariableScope } from './compatibility-state.js'
import { applyEventOperation, assertMemoryKeywordsInSource, emptyEventDocument, normalizeEventDocument, queryEventGraph } from './event.js'
import { initialGreetingView, sessionEvents, sessionTranscriptMessages } from './prompt.js'
import { extractCardScriptImports, preserveImportedScriptMetadata } from './script-importer.js'
import {
  createWorldbookEntries as appendTavernWorldbookEntries,
  deleteWorldbookEntries as removeTavernWorldbookEntries,
  replaceWorldbookEntries as replaceTavernWorldbookEntries,
  toTavernWorldbookEntries,
} from './tavern-worldbook.js'

const MAX_CARD_RECORD_BYTES = 12 * 1024 * 1024
const MAX_CARD_READ_BYTES = 13 * 1024 * 1024
const MAX_WORLDBOOK_RECORD_BYTES = 16 * 1024 * 1024
const LOCK_OWNER = Object.freeze({ pid: process.pid, host: hostname() })

function snapshot(value) { return structuredClone(value) }
function safeSessionId(value) {
  const id = String(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new Error('session id has an unsafe shape')
  return id
}
function safeCardId(value) {
  const id = String(value)
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('card id must be a SHA-256 hex digest')
  return id
}
function safeWorldbookId(value) {
  const id = String(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new Error('worldbook id has an unsafe shape')
  return id
}
function extensionFor(format) { return format === 'json-v3' ? '.json' : format === 'apng-v3' ? '.apng' : '.png' }
function normalizeRegexMetadata(script) {
  return {
    findRegex: String(script?.findRegex ?? ''),
    trimStrings: Array.isArray(script?.trimStrings) ? script.trimStrings.map(value => String(value)) : [],
    placement: Array.isArray(script?.placement) ? [...new Set(script.placement.map(Number).filter(Number.isSafeInteger))] : [],
    markdownOnly: script?.markdownOnly === true,
    promptOnly: script?.promptOnly === true,
    runOnEdit: script?.runOnEdit === true,
    substituteRegex: Number.isSafeInteger(Number(script?.substituteRegex)) ? Number(script.substituteRegex) : 0,
    minDepth: script?.minDepth === null || script?.minDepth === undefined || !Number.isFinite(Number(script.minDepth)) ? null : Number(script.minDepth),
    maxDepth: script?.maxDepth === null || script?.maxDepth === undefined || !Number.isFinite(Number(script.maxDepth)) ? null : Number(script.maxDepth),
  }
}
function scriptApprovalMaterial(kind, source, script) {
  if (kind !== 'regex') return `${kind === 'html' ? 'html' : 'javascript'}\0${String(source)}`
  return `regex\0${JSON.stringify({ ...normalizeRegexMetadata(script), source: String(source) })}`
}
function scriptHash(kind, source, script) { return createHash('sha256').update(scriptApprovalMaterial(kind, source, script)).digest('hex') }
function assertJsonBytes(value, maxBytes, label) {
  const text = JSON.stringify(value)
  if (text === undefined || Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes or is not JSON`)
}
function assertSafeOwnedJson(value, maxBytes, label) {
  assertJsonBytes(value, maxBytes, label)
  const pending = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === null || typeof current !== 'object') continue
    for (const [key, child] of Object.entries(current)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${label} contains unsafe key ${key}`)
      pending.push(child)
    }
  }
}
function normalizeStoredScript(script, index, forceDisable = false) {
  const source = String(script?.source ?? '')
  const kind = script?.kind === 'html' ? 'html' : script?.kind === 'regex' ? 'regex' : 'javascript'
  const regex = kind === 'regex' ? normalizeRegexMetadata(script) : undefined
  const approvedHash = String(script?.approvedHash ?? '')
  const trusted = !forceDisable && script?.enabled === true && approvedHash === scriptHash(kind, source, regex)
  return {
    id: String(script?.id ?? ''),
    name: String(script?.name ?? `Script ${index + 1}`),
    kind,
    enabled: trusted,
    approvedHash: trusted ? approvedHash : null,
    source,
    ...(regex ?? {}),
    ...(kind === 'regex' ? {} : preserveImportedScriptMetadata(script, source)),
  }
}
function normalizeScriptList(scripts, forceDisable = false) {
  const used = new Set()
  return (Array.isArray(scripts) ? scripts : []).map((script, index) => {
    const normalized = normalizeStoredScript(script, index, forceDisable)
    const raw = normalized.id.trim()
    const seed = `${normalized.kind}\0${normalized.name}\0${scriptApprovalMaterial(normalized.kind, normalized.source, normalized)}\0${index}`
    let id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw) ? raw : `script-${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`
    if (used.has(id)) id = `${id.slice(0, 112)}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`
    let suffix = 2
    while (used.has(id)) { id = `${id.slice(0, 120)}-${suffix}`; suffix += 1 }
    used.add(id)
    return { ...normalized, id }
  })
}

function normalizeCompatibilityRegexList(scripts) {
  if (!Array.isArray(scripts) || scripts.length > 32) throw new TypeError('regexes must be an array with at most 32 entries')
  return normalizeScriptList(scripts.map((script, index) => {
    if (script === null || typeof script !== 'object' || Array.isArray(script)) throw new TypeError(`regexes[${index}] must be an object`)
    const regex = normalizeRegexMetadata(script)
    const source = String(script.source ?? script.replaceString ?? '')
    const enabled = script.enabled !== false && script.disabled !== true
    return {
      id: String(script.id ?? ''),
      name: String(script.name ?? script.scriptName ?? `Regex ${index + 1}`),
      kind: 'regex',
      enabled,
      approvedHash: enabled ? scriptHash('regex', source, regex) : null,
      source,
      ...regex,
    }
  }))
}

async function awaitWithSignal(promise, signal) {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise((resolveValue, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('operation aborted'))
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolveValue, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

async function readJson(path, fallback, maxBytes = 32 * 1024 * 1024) {
  try {
    const content = await readFile(path)
    if (content.length > maxBytes) throw new Error(`JSON file exceeds ${maxBytes} bytes`)
    return JSON.parse(content.toString('utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return snapshot(fallback)
    throw error
  }
}

async function atomicJson(path, value, beforeCommit) {
  await mkdir(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    beforeCommit?.()
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

async function recoverDeadOwnerLock(lockPath) {
  let owner
  try { owner = JSON.parse((await readFile(lockPath, 'utf8')).slice(0, 4096)) } catch { return false }
  if (owner?.host !== LOCK_OWNER.host || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') return false
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    if (error?.code !== 'ESRCH') return false
  }
  const stale = `${lockPath}.dead-${owner.token}-${randomUUID()}`
  try { await rename(lockPath, stale) } catch (error) {
    if (error?.code === 'ENOENT') return true
    return false
  }
  await rm(stale, { force: true })
  return true
}

async function withFileLock(target, operation, signal) {
  const lockPath = `${target}.lock`
  await mkdir(resolve(lockPath, '..'), { recursive: true })
  for (let attempt = 0; attempt < 400; attempt += 1) {
    signal?.throwIfAborted()
    const token = randomUUID()
    let handle
    try {
      handle = await open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ ...LOCK_OWNER, token, createdAt: Date.now() }), 'utf8')
      await handle.sync()
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined)
        await rm(lockPath, { force: true }).catch(() => undefined)
      }
      if (error?.code !== 'EEXIST') throw error
      if (await recoverDeadOwnerLock(lockPath)) continue
      await delay(25, undefined, signal ? { signal } : undefined)
      continue
    }
    try {
      signal?.throwIfAborted()
      return await operation()
    } finally {
      await handle.close()
      let owner
      try { owner = JSON.parse((await readFile(lockPath, 'utf8')).slice(0, 4096)) } catch { owner = undefined }
      if (owner?.token === token) await rm(lockPath, { force: true })
    }
  }
  throw new Error(`timed out acquiring file lock for ${target}`)
}

async function withFileLocks(targets, operation, signal, index = 0) {
  if (index >= targets.length) return operation()
  return withFileLock(targets[index], () => withFileLocks(targets, operation, signal, index + 1), signal)
}

function extractScripts(card) {
  const scripts = []
  const regexScripts = Array.isArray(card?.data?.extensions?.regex_scripts) ? card.data.extensions.regex_scripts : []
  for (let index = 0; index < regexScripts.length; index += 1) {
    const rule = regexScripts[index]
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) continue
    const source = String(rule.replaceString ?? '')
    const regex = normalizeRegexMetadata(rule)
    if (regex.findRegex.trim() === '') continue
    const id = String(rule.id ?? createHash('sha256').update(`${regex.findRegex}\0${source}`).digest('hex').slice(0, 16))
    const enabled = rule.disabled !== true
    scripts.push({
      id,
      name: String(rule.scriptName ?? rule.name ?? `Regex ${index + 1}`),
      kind: 'regex',
      enabled,
      approvedHash: enabled ? scriptHash('regex', source, regex) : null,
      source,
      ...regex,
    })
  }
  const imported = extractCardScriptImports(card).scripts
  for (const script of imported) {
    const approvedHash = script.enabled === true ? scriptHash(script.kind, script.source, script) : null
    scripts.push({ ...script, approvedHash })
  }
  return scripts
}

function reconcileDiscoveredScripts(stored, discovered) {
  const output = [...stored]
  const consumed = new Set()
  for (const imported of discovered) {
    let index = output.findIndex((script, candidateIndex) => !consumed.has(candidateIndex)
      && script.kind === imported.kind
      && (script.id === imported.id || (script.name === imported.name && script.source === imported.source)))
    if (index < 0) {
      output.push(imported)
      consumed.add(output.length - 1)
      continue
    }
    const existing = output[index]
    consumed.add(index)
    output[index] = {
      ...imported,
      ...existing,
      ...preserveImportedScriptMetadata(imported, existing.source),
    }
  }
  return normalizeScriptList(output)
}

function scriptsForRecord(record) {
  const stored = Array.isArray(record?.scripts) ? record.scripts : []
  const forceDisable = Number(record?.schemaVersion) < 2
  const rawRegex = Array.isArray(record?.card?.data?.extensions?.regex_scripts) ? record.card.data.extensions.regex_scripts : []
  const needsRegexMigration = Number(record?.schemaVersion) < 3 && rawRegex.length > 0
  if (!needsRegexMigration) return normalizeScriptList(stored, forceDisable)
  const extracted = extractScripts(record.card)
  const consumed = new Set()
  const structuralFragments = rawRegex.map(rule => {
    const matches = []
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return matches
    for (const field of ['id', 'scriptName', 'findRegex', 'replaceString']) {
      const source = rule[field]
      if (typeof source !== 'string' || source.trim() === '') continue
      const oldId = createHash('sha256').update(source).digest('hex').slice(0, 16)
      const kind = /<html|<body|<!doctype/i.test(source) ? 'html' : 'javascript'
      const newerId = createHash('sha256').update(`${kind}\0${source}`).digest('hex').slice(0, 16)
      const candidate = stored.find(item => !consumed.has(item)
        && item?.name === field
        && String(item?.source ?? '') === source
        && (String(item?.id ?? '') === oldId || String(item?.id ?? '') === newerId))
      if (candidate !== undefined) { consumed.add(candidate); matches.push(candidate) }
    }
    return matches
  })
  for (const script of extracted) {
    if (script.kind !== 'regex') continue
    const rawIndex = rawRegex.findIndex(rule => rule && typeof rule === 'object'
      && String(rule.id ?? '') === script.id
      && String(rule.findRegex ?? '') === script.findRegex
      && String(rule.replaceString ?? '') === script.source)
    const whole = stored.find(candidate => !consumed.has(candidate)
      && (candidate?.kind === 'regex' || typeof candidate?.findRegex === 'string')
      && (String(candidate?.id ?? '') === script.id
        || (String(candidate?.findRegex ?? '') === script.findRegex && String(candidate?.source ?? candidate?.replaceString ?? '') === script.source)))
    if (whole !== undefined) {
      consumed.add(whole)
      const approvedHash = scriptHash('regex', script.source, script)
      script.enabled = !forceDisable && whole.enabled === true && whole.approvedHash === approvedHash
      script.approvedHash = script.enabled ? approvedHash : null
      continue
    }
    const fragments = rawIndex < 0 ? [] : structuralFragments[rawIndex]
    if (forceDisable || fragments.some(fragment => fragment.enabled === false)) {
      script.enabled = false
      script.approvedHash = null
    }
  }
  const keyOf = script => script.kind === 'regex'
    ? scriptApprovalMaterial('regex', script.source, script)
    : `${script.kind}\0${script.source}`
  const keys = new Set(extracted.map(keyOf))
  for (const script of stored) {
    if (consumed.has(script)) continue
    const normalized = normalizeStoredScript(script, extracted.length, forceDisable)
    const key = keyOf(normalized)
    if (keys.has(key)) continue
    keys.add(key)
    extracted.push(normalized)
  }
  return normalizeScriptList(extracted, forceDisable)
}

function normalizeBinding(binding) {
  if (binding === null || typeof binding !== 'object' || Array.isArray(binding) || !/^[a-f0-9]{64}$/.test(String(binding.cardId ?? ''))) return null
  const persona = binding.userPersona !== null && typeof binding.userPersona === 'object' && !Array.isArray(binding.userPersona) ? binding.userPersona : {}
  const variables = binding.variables !== null && typeof binding.variables === 'object' && !Array.isArray(binding.variables) ? snapshot(binding.variables) : {}
  const chatMetadata = binding.chatMetadata !== null && typeof binding.chatMetadata === 'object' && !Array.isArray(binding.chatMetadata) ? snapshot(binding.chatMetadata) : {}
  const scriptInjections = Array.isArray(binding.scriptInjections) ? binding.scriptInjections.flatMap((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
    const normalized = {
      id: String(item.id ?? `injection-${index}`),
      text: String(item.content ?? item.text ?? ''),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    }
    if (['content', 'position', 'depth', 'role', 'should_scan'].some(key => Object.hasOwn(item, key))) Object.assign(normalized, {
      content: String(item.content ?? item.text ?? ''),
      position: item.position === 'none' ? 'none' : 'in_chat',
      depth: Number.isFinite(Number(item.depth)) ? Number(item.depth) : 0,
      role: ['system', 'assistant', 'user'].includes(item.role) ? item.role : 'system',
      should_scan: item.should_scan === true,
      once: item.once === true,
      ownerFrameId: typeof item.ownerFrameId === 'string' ? item.ownerFrameId : null,
      hasFilter: item.hasFilter === true,
    })
    return [normalized]
  }) : []
  const inherited = binding.inheritedFrom !== null && typeof binding.inheritedFrom === 'object' && !Array.isArray(binding.inheritedFrom)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(String(binding.inheritedFrom.parentSessionId ?? ''))
    && Number.isSafeInteger(Number(binding.inheritedFrom.inheritedEventCount)) && Number(binding.inheritedFrom.inheritedEventCount) >= 0
    ? {
        parentSessionId: String(binding.inheritedFrom.parentSessionId),
        inheritedEventCount: Number(binding.inheritedFrom.inheritedEventCount),
        exact: binding.inheritedFrom.exact === true,
        bindingExact: binding.inheritedFrom.bindingExact === true,
        source: ['fork-point', 'history', 'parent-current'].includes(binding.inheritedFrom.source) ? binding.inheritedFrom.source : 'parent-current',
        event: ['exact', 'source-bounded', 'missing'].includes(binding.inheritedFrom.event) ? binding.inheritedFrom.event : 'missing',
        compatChat: ['exact', 'native-only', 'missing'].includes(binding.inheritedFrom.compatChat) ? binding.inheritedFrom.compatChat : 'missing',
        inheritedAt: typeof binding.inheritedFrom.inheritedAt === 'string' ? binding.inheritedFrom.inheritedAt : new Date(0).toISOString(),
      }
    : null
  return {
    revision: Number.isSafeInteger(Number(binding.revision)) && Number(binding.revision) >= 0 ? Number(binding.revision) : 0,
    cardId: String(binding.cardId),
    boundAt: typeof binding.boundAt === 'string' ? binding.boundAt : new Date(0).toISOString(),
    startedAt: typeof binding.startedAt === 'string' ? binding.startedAt : null,
    worldbookId: typeof binding.worldbookId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(binding.worldbookId) ? binding.worldbookId : null,
    worldbookExplicit: binding.worldbookExplicit === true,
    userPersona: { name: String(persona.name ?? 'User'), description: String(persona.description ?? '') },
    templateIds: Array.isArray(binding.templateIds) ? binding.templateIds.map(value => String(value)) : [],
    variables,
    chatMetadata,
    scriptInjections,
    openingSwipeId: Number.isSafeInteger(Number(binding.openingSwipeId)) && Number(binding.openingSwipeId) >= 0 ? Number(binding.openingSwipeId) : 0,
    ...(inherited === null ? {} : { inheritedFrom: inherited }),
  }
}

function normalizeBindingsDocument(document) {
  const sessions = Object.create(null)
  if (document?.schemaVersion === 1 && document.sessions && typeof document.sessions === 'object' && !Array.isArray(document.sessions)) {
    for (const [id, raw] of Object.entries(document.sessions)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) continue
      const binding = normalizeBinding(raw)
      if (binding !== null) sessions[id] = binding
    }
  }
  return { schemaVersion: 1, sessions }
}

function normalizeRegexSourcesDocument(document) {
  const normalize = scripts => normalizeScriptList(scripts).filter(script => script.kind === 'regex')
  const variables = document?.schemaVersion === 1 && document.variables !== null && typeof document.variables === 'object' && !Array.isArray(document.variables) ? snapshot(document.variables) : {}
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(Number(document?.revision)) && Number(document.revision) >= 0 ? Number(document.revision) : 0,
    global: normalize(document?.schemaVersion === 1 ? document.global : []),
    preset: normalize(document?.schemaVersion === 1 ? document.preset : []),
    variables,
    updatedAt: typeof document?.updatedAt === 'string' ? document.updatedAt : new Date(0).toISOString(),
  }
}

function defaultBinding(cardId) {
  return {
    revision: 0,
    cardId,
    boundAt: new Date().toISOString(),
    startedAt: null,
    worldbookId: null,
    worldbookExplicit: false,
    userPersona: { name: 'User', description: '' },
    templateIds: [],
    variables: {},
    chatMetadata: {},
    scriptInjections: [],
    openingSwipeId: 0,
  }
}

function ordinaryFork(session) {
  const parentSessionId = session?.header?.parentSession
  const inheritedEventCount = Number(session?.inheritedEventCount)
  if (session?.header?.origin === 'subagent' || session?.header?.isSeeded !== true
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(String(parentSessionId ?? ''))
    || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) return null
  return { parentSessionId: String(parentSessionId), inheritedEventCount }
}

function sessionBoundary(session) {
  if (Number.isSafeInteger(Number(session?.seq)) && Number(session.seq) >= 0) return Number(session.seq)
  return sessionEvents(session).length
}

function normalizeBranchBindingHistory(value, sessionId) {
  const snapshots = []
  if (value?.schemaVersion === 1 && value.sessionId === sessionId && Array.isArray(value.snapshots)) {
    for (const item of value.snapshots) {
      const boundary = Number(item?.boundary)
      const binding = normalizeBinding(item?.binding)
      if (!Number.isSafeInteger(boundary) || boundary < 0 || binding === null) continue
      snapshots.push({ boundary, exact: item.exact !== false, binding })
    }
  }
  snapshots.sort((left, right) => left.boundary - right.boundary)
  return { schemaVersion: 1, sessionId, snapshots }
}

function sourceBoundedEventDocument(document, sessionId, inheritedEventCount) {
  const beforeBoundary = item => Array.isArray(item?.sourceRefs) && item.sourceRefs.length > 0
    && item.sourceRefs.every(ref => Number.isSafeInteger(ref?.eventSeq) && ref.eventSeq < inheritedEventCount)
  const rows = document.rows.filter(beforeBoundary).map(snapshot)
  const eventIds = new Set(rows.flatMap(row => typeof row.eventId === 'string' ? [row.eventId] : []))
  const eventEdges = document.eventEdges.filter(edge => beforeBoundary(edge)
    && eventIds.has(edge.predecessorEventId) && eventIds.has(edge.successorEventId)).map(snapshot)
  return normalizeEventDocument({
    ...document,
    sessionId,
    revision: 0,
    rows,
    eventEdges,
    appliedMaintenanceJobs: [],
  }, sessionId)
}

function normalizeWorldbookBook(value, forcedName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('worldbook must be an object')
  const book = snapshot(value)
  const name = String(forcedName ?? book.name ?? '').trim()
  if (name === '') throw new Error('worldbook name is required')
  if (Buffer.byteLength(name, 'utf8') > 1024) throw new Error('worldbook name exceeds 1024 bytes')
  book.name = name
  if (!Array.isArray(book.entries)) book.entries = []
  assertSafeOwnedJson(book, MAX_WORLDBOOK_RECORD_BYTES - 4096, 'worldbook')
  return book
}

function worldbookNameKey(value) { return String(value).trim().toLocaleLowerCase() }

function worldbookLibraryLockTarget(state) { return join(state.root, 'worldbooks', '.library') }

function isAbortSignal(value) {
  return value !== null && typeof value === 'object' && typeof value.throwIfAborted === 'function' && typeof value.addEventListener === 'function'
}

function emptyCompatChatDocument(sessionId, nativeMessages = []) {
  return { schemaVersion: 1, sessionId: String(sessionId), revision: 0, chat: inspectCompatChat(createCompatChat(nativeMessages)), updatedAt: new Date(0).toISOString() }
}

function normalizeCompatChatDocument(value, sessionId, nativeMessages = []) {
  if (value?.schemaVersion !== 1 || value.sessionId !== String(sessionId) || value.chat === null || typeof value.chat !== 'object') return emptyCompatChatDocument(sessionId, nativeMessages)
  const merged = mergeNativeMessages(value.chat, nativeMessages)
  return {
    schemaVersion: 1,
    sessionId: String(sessionId),
    revision: Number.isSafeInteger(Number(value.revision)) && Number(value.revision) >= 0 ? Number(value.revision) : 0,
    chat: inspectCompatChat(merged),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  }
}

// Every durable plugin resource is rooted below the workspace that owns it.
export class SillyTavernStore {
  constructor(options = {}) {
    this.fallbackWorkspace = resolve(options.fallbackWorkspace ?? process.cwd())
    this.workspaces = new Map()
    this.workspaceLoads = new Map()
    this.sessions = new Map()
    this.disposedAgents = new WeakSet()
    this.sessionLoads = new Map()
    this.sessionEpoch = new Map()
    this.forkCaptures = new WeakMap()
    this.preparedForkCaptures = new Map()
    this.tails = new Map()
    this.ready = this.workspaceState(this.fallbackWorkspace)
  }

  get cards() { return this.workspaces.get(this.fallbackWorkspace)?.cards ?? new Map() }
  get worldbooks() { return this.workspaces.get(this.fallbackWorkspace)?.worldbooks ?? new Map() }
  get templates() { return this.workspaces.get(this.fallbackWorkspace)?.templates ?? [] }
  get globalRegexScripts() { return this.workspaces.get(this.fallbackWorkspace)?.globalRegexScripts ?? [] }
  get presetRegexScripts() { return this.workspaces.get(this.fallbackWorkspace)?.presetRegexScripts ?? [] }
  get globalVariables() { return this.workspaces.get(this.fallbackWorkspace)?.globalVariables ?? {} }
  get selectedCardId() { return this.workspaces.get(this.fallbackWorkspace)?.selectedCardId ?? null }

  rootForWorkspace(workspace) {
    return join(resolve(workspace), '.dsh', 'sillytavern')
  }

  workspaceOf(agent) { return resolve(agent?.session?.header?.cwd ?? this.fallbackWorkspace) }

  workspaceFor(context) {
    if (typeof context === 'string' && context !== '') return resolve(context)
    if (context?.session?.header?.cwd) return this.workspaceOf(context)
    if (typeof context?.workspace === 'string' && context.workspace !== '') return resolve(context.workspace)
    return this.fallbackWorkspace
  }

  sessionKey(agent) { return `${this.workspaceOf(agent)}\0${safeSessionId(agent.id)}` }

  async serial(key, operation, signal) {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => {
      signal?.throwIfAborted()
      return operation()
    })
    this.tails.set(key, current)
    const cleanup = () => { if (this.tails.get(key) === current) this.tails.delete(key) }
    void current.then(cleanup, cleanup)
    return awaitWithSignal(current, signal)
  }

  async waitCompatibilityWrites(agent, signal) {
    const workspace = this.workspaceOf(agent)
    const root = this.rootForWorkspace(workspace)
    const keys = [`compat-chat:${workspace}:${agent.id}`, ...['regex', 'compatibility', 'resources', 'selection', 'bindings', 'templates'].map(type => `${type}:${root}`)]
    // Snapshot the accepted writes; later writes belong to the next snapshot.
    const pending = keys.map(key => this.tails.get(key)).filter(Boolean)
    await awaitWithSignal(Promise.all(pending), signal)
  }

  async loadCardRecord(path, expectedId, persist = false, signal) {
    const raw = await readJson(path, null, MAX_CARD_READ_BYTES)
    signal?.throwIfAborted()
    if (raw === null || raw.id !== expectedId || ![1, 2, 3, 4].includes(Number(raw.schemaVersion))) return undefined
    const card = snapshot(raw.card)
    if (card?.data && Object.hasOwn(card.data, 'character_book')) delete card.data.character_book
    const scriptImport = extractCardScriptImports(card)
    const storedScripts = scriptsForRecord(raw)
    const record = {
      ...raw,
      schemaVersion: 4,
      card,
      defaultWorldbookId: typeof raw.defaultWorldbookId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(raw.defaultWorldbookId) ? raw.defaultWorldbookId : null,
      scripts: raw.scriptImportReport === undefined ? reconcileDiscoveredScripts(storedScripts, extractScripts(card)) : storedScripts,
      scriptImportReport: raw.scriptImportReport ?? scriptImport.report,
    }
    assertJsonBytes(record, MAX_CARD_RECORD_BYTES, 'card record')
    if (persist && JSON.stringify(record) !== JSON.stringify(raw)) await atomicJson(path, record, () => signal?.throwIfAborted())
    return record
  }

  async loadWorldbookRecord(path, expectedId) {
    const raw = await readJson(path, null, MAX_WORLDBOOK_RECORD_BYTES)
    if (![1, 2].includes(Number(raw?.schemaVersion)) || raw.id !== expectedId || typeof raw.name !== 'string' || raw.book === null || typeof raw.book !== 'object' || Array.isArray(raw.book)) return undefined
    const book = normalizeWorldbookBook(raw.book, raw.name)
    return {
      schemaVersion: 2,
      id: expectedId,
      revision: Number.isSafeInteger(Number(raw.revision)) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
      name: book.name,
      book,
      createdAt: String(raw.createdAt ?? new Date(0).toISOString()),
      updatedAt: String(raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString()),
    }
  }

  async refreshWorldbookLibrary(state) {
    const files = await readdir(join(state.root, 'worldbooks'), { withFileTypes: true })
    const records = new Map()
    for (const file of files) {
      if (!file.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/.test(file.name)) continue
      const id = file.name.slice(0, -5)
      try {
        const record = await this.loadWorldbookRecord(join(state.root, 'worldbooks', file.name), id)
        if (record !== undefined) records.set(id, record)
      } catch { /* one malformed resource must not hide the rest of the library */ }
    }
    state.worldbooks = records
    return records
  }

  async workspaceState(context) {
    const workspace = this.workspaceFor(context)
    const current = this.workspaces.get(workspace)
    if (current !== undefined) return current
    const pending = this.workspaceLoads.get(workspace)
    if (pending !== undefined) return pending
    const load = (async () => {
      const root = this.rootForWorkspace(workspace)
      await Promise.all([
        mkdir(join(root, 'cards'), { recursive: true }),
        mkdir(join(root, 'originals'), { recursive: true }),
        mkdir(join(root, 'worldbooks'), { recursive: true }),
        mkdir(join(root, 'event'), { recursive: true }),
        mkdir(join(root, 'compat-chats'), { recursive: true }),
        mkdir(join(root, 'branch-bindings'), { recursive: true }),
      ])
      const state = {
        workspace,
        root,
        cards: new Map(),
        worldbooks: new Map(),
        bindings: normalizeBindingsDocument(await readJson(join(root, 'bindings.json'), { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024)),
        templates: [],
        globalRegexScripts: [],
        presetRegexScripts: [],
        globalVariables: {},
        regexRevision: 0,
        compatibility: emptyCompatibilityWorkspace(),
        selectedCardId: null,
      }
      const [cardFiles, worldbookFiles] = await Promise.all([
        readdir(join(root, 'cards'), { withFileTypes: true }),
        readdir(join(root, 'worldbooks'), { withFileTypes: true }),
      ])
      for (const file of cardFiles) {
        if (!file.isFile() || !/^[a-f0-9]{64}\.json$/.test(file.name)) continue
        const id = file.name.slice(0, -5)
        try {
          const record = await this.loadCardRecord(join(root, 'cards', file.name), id, true)
          if (record !== undefined) state.cards.set(id, record)
        } catch { /* malformed workspace records are isolated */ }
      }
      for (const file of worldbookFiles) {
        if (!file.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/.test(file.name)) continue
        const id = file.name.slice(0, -5)
        try {
          const record = await this.loadWorldbookRecord(join(root, 'worldbooks', file.name), id)
          if (record !== undefined) state.worldbooks.set(id, record)
        } catch { /* malformed workspace records are isolated */ }
      }
      for (const card of state.cards.values()) if (card.defaultWorldbookId !== null && !state.worldbooks.has(card.defaultWorldbookId)) card.defaultWorldbookId = null
      const templates = await readJson(join(root, 'templates.json'), { schemaVersion: 1, templates: [] }, 4 * 1024 * 1024)
      state.templates = templates?.schemaVersion === 1 && Array.isArray(templates.templates) ? templates.templates.slice(0, 32) : []
      const regex = normalizeRegexSourcesDocument(await readJson(join(root, 'regex-scripts.json'), { schemaVersion: 1, revision: 0, global: [], preset: [] }, 16 * 1024 * 1024))
      state.globalRegexScripts = regex.global
      state.presetRegexScripts = regex.preset
      state.globalVariables = regex.variables
      state.regexRevision = regex.revision
      state.compatibility = normalizeCompatibilityWorkspace(await readJson(join(root, 'compatibility.json'), emptyCompatibilityWorkspace(), 16 * 1024 * 1024))
      if (Object.keys(state.compatibility.variables.global).length === 0 && Object.keys(state.globalVariables).length > 0) state.compatibility.variables.global = snapshot(state.globalVariables)
      const selection = await readJson(join(root, 'selection.json'), { schemaVersion: 1, selectedCardId: null }, 64 * 1024)
      state.selectedCardId = typeof selection?.selectedCardId === 'string' && state.cards.has(selection.selectedCardId) ? selection.selectedCardId : null
      this.workspaces.set(workspace, state)
      return state
    })()
    this.workspaceLoads.set(workspace, load)
    try { return await load } finally { this.workspaceLoads.delete(workspace) }
  }

  async stateFor(context) {
    await this.ready
    return this.workspaceState(context)
  }

  async refreshTemplates(context, signal) {
    if (isAbortSignal(context)) { signal = context; context = undefined }
    const state = await this.stateFor(context)
    signal?.throwIfAborted()
    const document = await readJson(join(state.root, 'templates.json'), { schemaVersion: 1, templates: [] }, 4 * 1024 * 1024)
    state.templates = document?.schemaVersion === 1 && Array.isArray(document.templates) ? document.templates.slice(0, 32) : []
    return snapshot(state.templates)
  }

  async refreshRegexSources(context, signal) {
    if (isAbortSignal(context)) { signal = context; context = undefined }
    const state = await this.stateFor(context)
    signal?.throwIfAborted()
    const document = normalizeRegexSourcesDocument(await readJson(join(state.root, 'regex-scripts.json'), { schemaVersion: 1, revision: 0, global: [], preset: [] }, 16 * 1024 * 1024))
    state.globalRegexScripts = document.global
    state.presetRegexScripts = document.preset
    state.globalVariables = document.variables
    state.regexRevision = document.revision
    return snapshot(document)
  }

  async saveRegexSources(patch, signal, context) {
    if (signal !== undefined && !isAbortSignal(signal)) { context = signal; signal = undefined }
    context ??= patch?.context
    const state = await this.stateFor(context)
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('regex source patch must be an object')
    if (Object.hasOwn(patch, 'global') && !Array.isArray(patch.global)) throw new TypeError('global Regex source must be an array')
    if (Object.hasOwn(patch, 'preset') && !Array.isArray(patch.preset)) throw new TypeError('preset Regex source must be an array')
    if (Object.hasOwn(patch, 'variables') && (patch.variables === null || typeof patch.variables !== 'object' || Array.isArray(patch.variables))) throw new TypeError('global variables must be an object')
    const path = join(state.root, 'regex-scripts.json')
    return this.serial(`regex:${state.root}`, () => withFileLock(path, async () => {
      const current = normalizeRegexSourcesDocument(await readJson(path, { schemaVersion: 1, revision: 0, global: [], preset: [] }, 16 * 1024 * 1024))
      if (Object.hasOwn(patch, 'expectedRevision')) {
        const expectedRevision = Number(patch.expectedRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('regex expectedRevision must be a non-negative safe integer')
        if (expectedRevision !== current.revision) {
          const error = new Error(`regex revision changed from ${expectedRevision} to ${current.revision}`)
          error.code = 'regex-revision-conflict'
          error.details = { currentRevision: current.revision }
          throw error
        }
      }
      const next = {
        schemaVersion: 1,
        revision: current.revision + 1,
        global: Object.hasOwn(patch, 'global') ? normalizeScriptList(patch.global).filter(script => script.kind === 'regex') : current.global,
        preset: Object.hasOwn(patch, 'preset') ? normalizeScriptList(patch.preset).filter(script => script.kind === 'regex') : current.preset,
        variables: Object.hasOwn(patch, 'variables') ? snapshot(patch.variables) : current.variables,
        updatedAt: new Date().toISOString(),
      }
      assertSafeOwnedJson(next, 16 * 1024 * 1024, 'regex sources')
      await atomicJson(path, next, () => signal?.throwIfAborted())
      state.globalRegexScripts = next.global
      state.presetRegexScripts = next.preset
      state.globalVariables = next.variables
      state.regexRevision = next.revision
      state.compatibility.variables.global = snapshot(next.variables)
      return snapshot(next)
    }, signal), signal)
  }

  async replaceCompatibilityRegexes(agent, changes, signal) {
    if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('regex changes must be an object')
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    const sourcePatch = {}
    if (Object.hasOwn(changes, 'global')) sourcePatch.global = normalizeCompatibilityRegexList(changes.global)
    if (Object.hasOwn(changes, 'preset')) sourcePatch.preset = normalizeCompatibilityRegexList(changes.preset)
    if (Object.keys(sourcePatch).length > 0) {
      await this.saveRegexSources({
        ...sourcePatch,
        ...(changes.expectedRevision === undefined ? {} : { expectedRevision: changes.expectedRevision }),
      }, signal, agent)
    }
    if (Object.hasOwn(changes, 'character')) {
      if (session.binding === null) throw new Error('current session has no selected character')
      const record = session.state.cards.get(session.binding.cardId)
      if (record === undefined) throw new Error(`card ${session.binding.cardId} was not found`)
      const replacements = normalizeCompatibilityRegexList(changes.character)
      let replacementIndex = 0
      const scripts = record.scripts.flatMap(script => {
        if (script.kind !== 'regex') return [script]
        if (replacementIndex >= replacements.length) return []
        const replacement = replacements[replacementIndex]
        replacementIndex += 1
        return [replacement]
      })
      scripts.push(...replacements.slice(replacementIndex))
      await this.updateCard(record.id, { scripts }, signal, agent)
    }
    return this.sessionView(agent)
  }

  compatChatProjection(agent) {
    const session = this.sessionSync(agent)
    if (session === undefined) return { revision: 0, messages: [] }
    const state = session.compatChat.chat
    const messages = getChatMessages(state, '0-{{lastMessageId}}').map((message, index) => {
      const internal = state.entries[index]
      const isUser = message.role === 'user'
      return {
        ...message,
        uid: internal.uid,
        origin: internal.origin,
        sourceSeq: internal.sourceSeq,
        event_seq: internal.sourceSeq,
        is_user: isUser,
        is_system: message.role === 'system',
        mes: message.message,
        text: message.message,
        swipe_id: internal.swipe_id,
        swipes: snapshot(internal.swipes),
        swipes_data: snapshot(internal.swipes_data),
        swipes_info: snapshot(internal.swipes_info),
      }
    })
    return { revision: session.compatChat.revision, seenSourceSeqs: snapshot(state.seenSourceSeqs), messages }
  }

  async refreshCompatChat(agent, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    const path = session.compatChatPath
    return this.serial(`compat-chat:${session.workspace}:${session.agentId}`, () => withFileLock(path, async () => {
      let current
      try {
        current = normalizeCompatChatDocument(await readJson(path, emptyCompatChatDocument(session.agentId), 20 * 1024 * 1024), session.agentId, sessionTranscriptMessages(agent))
      } catch {
        current = emptyCompatChatDocument(session.agentId, sessionTranscriptMessages(agent))
      }
      if (current.chat.entries.length === 0 && current.chat.nextSyntheticUid === 1 && current.chat.seenSourceSeqs.length === 0 && session.binding !== null) {
        const promptState = this.promptState(agent)
        const greeting = promptState === undefined ? null : initialGreetingView(promptState, Number(session.binding.openingSwipeId ?? 0))
        if (greeting !== null) {
          const swipes = []
          for (let swipeId = 0; swipeId < greeting.swipeCount; swipeId += 1) {
            const item = initialGreetingView(promptState, swipeId)
            swipes.push(item?.text ?? '')
          }
          let chat = createChatMessages(current.chat, [{ role: 'assistant', name: greeting.characterName, message: swipes[greeting.swipeId], data: {}, extra: { dsh_opening: true } }])
          chat = setChatMessages(chat, [{ message_id: 0, swipes, swipe_id: greeting.swipeId, swipes_data: swipes.map(() => ({})), swipes_info: swipes.map(() => ({ dsh_opening: true })) }])
          current.chat = inspectCompatChat(chat)
        }
      }
      const previous = JSON.stringify(session.compatChat.chat)
      if (JSON.stringify(current.chat) !== previous) {
        current.revision = Math.max(current.revision, session.compatChat.revision) + 1
        current.updatedAt = new Date().toISOString()
        assertSafeOwnedJson(current, 20 * 1024 * 1024, 'compat chat')
        await atomicJson(path, current, () => this.assertAgentActive(agent, session))
      }
      session.compatChat = current
      return this.compatChatProjection(agent)
    }, signal), signal)
  }

  async mutateCompatChat(agent, request, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    if (request === null || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('compat chat mutation must be an object')
    const path = session.compatChatPath
    return this.serial(`compat-chat:${session.workspace}:${session.agentId}`, () => withFileLock(path, async () => {
      let current = normalizeCompatChatDocument(await readJson(path, emptyCompatChatDocument(session.agentId), 20 * 1024 * 1024), session.agentId, sessionTranscriptMessages(agent))
      if (Object.hasOwn(request, 'expectedRevision')) {
        const expectedRevision = Number(request.expectedRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('chat expectedRevision must be a non-negative safe integer')
        if (expectedRevision !== current.revision) {
          const error = new Error(`chat revision changed from ${expectedRevision} to ${current.revision}`)
          error.code = 'chat-revision-conflict'
          error.details = { currentRevision: current.revision }
          throw error
        }
      }
      const action = String(request.action ?? '')
      let next
      if (action === 'set') next = setChatMessages(current.chat, request.messages ?? [])
      else if (action === 'create') next = createChatMessages(current.chat, request.messages ?? [], request.options ?? {})
      else if (action === 'delete') next = deleteChatMessages(current.chat, request.messageIds ?? [])
      else if (action === 'rotate') next = rotateChatMessages(current.chat, request.begin, request.middle, request.end)
      else if (action === 'switch-swipe') next = switchSwipe(current.chat, request.messageId, request.swipeId)
      else throw new TypeError(`unknown compat chat mutation ${action}`)
      current = { ...current, revision: current.revision + 1, chat: inspectCompatChat(next), updatedAt: new Date().toISOString() }
      assertSafeOwnedJson(current, 20 * 1024 * 1024, 'compat chat')
      await atomicJson(path, current, () => this.assertAgentActive(agent, session))
      session.compatChat = current
      return this.compatChatProjection(agent)
    }, signal), signal)
  }

  compatibilityVariableSnapshot(agent, metadata = {}) {
    const session = this.sessionSync(agent)
    if (session === undefined || session.binding === null) return {
      revisions: { chat: 0, global: 0, workspace: 0, message: 0 },
      scopes: { chat: {}, global: {}, preset: {}, character: {}, message: {}, script: {}, extension: {} },
    }
    const context = { binding: session.binding, cardId: session.binding.cardId, scriptId: metadata.scriptId }
    const read = option => readWorkspaceVariableScope(session.state.compatibility, option, context)
    return {
      revisions: {
        chat: Number(session.binding.revision ?? 0),
        global: Number(session.state.regexRevision ?? 0),
        workspace: Number(session.state.compatibility.revision ?? 0),
        message: Number(session.compatChat?.revision ?? 0),
      },
      scopes: {
        chat: snapshot(session.binding.variables),
        global: snapshot(session.state.globalVariables),
        preset: read({ type: 'preset' }),
        character: read({ type: 'character' }),
        message: {},
        script: read({ type: 'script', script_id: metadata.scriptId }),
        extension: metadata.extensionId ? read({ type: 'extension', extension_id: metadata.extensionId }) : {},
      },
    }
  }

  async replaceCompatibilityVariables(agent, option, variables, metadata = {}, signal) {
    if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) throw new TypeError('variables must be an object')
    assertSafeOwnedJson(variables, 1024 * 1024, 'variables')
    const type = String(option?.type || 'chat')
    if (type === 'chat') {
      const patch = { variables }
      if (metadata.expectedRevision !== undefined) patch.expectedRevision = metadata.expectedRevision
      await this.updateSession(agent, patch, signal)
      return this.compatibilityVariableSnapshot(agent, metadata)
    }
    if (type === 'global') {
      await this.saveRegexSources({ variables, ...(metadata.expectedRevision === undefined ? {} : { expectedRevision: metadata.expectedRevision }) }, signal, agent)
      return this.compatibilityVariableSnapshot(agent, metadata)
    }
    if (type === 'message') {
      await this.refreshCompatChat(agent, signal)
      const projection = this.compatChatProjection(agent)
      const rawId = option?.message_id ?? 'latest'
      const number = rawId === 'latest' ? projection.messages.length - 1 : Number(rawId)
      if (!Number.isSafeInteger(number)) throw new TypeError('message_id must be a safe integer or latest')
      const messageId = number < 0 ? projection.messages.length + number : number
      if (messageId < 0 || messageId >= projection.messages.length) throw new RangeError('message_id is outside the current chat')
      await this.mutateCompatChat(agent, {
        action: 'set',
        expectedRevision: metadata.expectedRevision,
        messages: [{ message_id: messageId, data: variables }],
      }, signal)
      const result = this.compatibilityVariableSnapshot(agent, metadata)
      result.revisions.message = this.compatChatProjection(agent).revision
      result.scopes.message = snapshot(variables)
      return result
    }
    if (!['preset', 'character', 'script', 'extension'].includes(type)) throw new TypeError(`unsupported variable scope ${type}`)
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    if (session.binding === null) throw new Error('current session has no selected character')
    const state = session.state
    const path = join(state.root, 'compatibility.json')
    return this.serial(`compatibility:${state.root}`, () => withFileLock(path, async () => {
      const current = normalizeCompatibilityWorkspace(await readJson(path, emptyCompatibilityWorkspace(), 16 * 1024 * 1024))
      if (metadata.expectedRevision !== undefined) {
        const expectedRevision = Number(metadata.expectedRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('compatibility expectedRevision must be a non-negative safe integer')
        if (current.revision !== expectedRevision) {
          const error = new Error(`compatibility revision changed from ${expectedRevision} to ${current.revision}`)
          error.code = 'compatibility-revision-conflict'
          error.details = { currentRevision: current.revision }
          throw error
        }
      }
      const next = replaceWorkspaceVariableScope(current, option, variables, {
        binding: session.binding,
        cardId: session.binding.cardId,
        scriptId: metadata.scriptId,
      })
      assertSafeOwnedJson(next, 16 * 1024 * 1024, 'compatibility workspace state')
      await atomicJson(path, next, () => this.assertAgentActive(agent, session))
      state.compatibility = next
      return this.compatibilityVariableSnapshot(agent, metadata)
    }, signal), signal)
  }

  async updateCompatibilityState(agent, patch, metadata = {}, signal) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('compatibility state patch must be an object')
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    if (session.binding === null) throw new Error('current session has no selected character')
    const state = session.state
    const path = join(state.root, 'compatibility.json')
    return this.serial(`compatibility:${state.root}`, () => withFileLock(path, async () => {
      const current = normalizeCompatibilityWorkspace(await readJson(path, emptyCompatibilityWorkspace(), 16 * 1024 * 1024))
      if (metadata.expectedRevision !== undefined) {
        const expectedRevision = Number(metadata.expectedRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('compatibility expectedRevision must be a non-negative safe integer')
        if (current.revision !== expectedRevision) {
          const error = new Error(`compatibility revision changed from ${expectedRevision} to ${current.revision}`)
          error.code = 'compatibility-revision-conflict'
          error.details = { currentRevision: current.revision }
          throw error
        }
      }
      const available = new Set(this.getWorldbookNames(state.workspace))
      const names = (value, label) => {
        if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
        const result = [...new Set(value.map(String))]
        const missing = result.filter(name => !available.has(name))
        if (missing.length > 0) throw new Error(`${label} contains unknown worldbooks: ${missing.join(', ')}`)
        return result
      }
      const next = normalizeCompatibilityWorkspace(current)
      if (patch.extensionSettings !== undefined) {
        if (patch.extensionSettings === null || typeof patch.extensionSettings !== 'object' || Array.isArray(patch.extensionSettings)) throw new TypeError('extensionSettings must be an object')
        next.extensionSettings = snapshot(patch.extensionSettings)
      }
      if (patch.globalWorldbooks !== undefined) next.globalWorldbooks = names(patch.globalWorldbooks, 'globalWorldbooks')
      if (patch.characterWorldbooks !== undefined) {
        const value = patch.characterWorldbooks
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('characterWorldbooks must be an object')
        const primary = value.primary === null || value.primary === undefined || value.primary === '' ? null : String(value.primary)
        if (primary !== null && !available.has(primary)) throw new Error(`character primary worldbook "${primary}" was not found`)
        next.characterWorldbooks[session.binding.cardId] = { primary, additional: names(value.additional ?? [], 'character additional worldbooks') }
      }
      if (patch.lorebookSettings !== undefined) {
        if (patch.lorebookSettings === null || typeof patch.lorebookSettings !== 'object' || Array.isArray(patch.lorebookSettings)) throw new TypeError('lorebookSettings must be an object')
        next.lorebookSettings = { ...next.lorebookSettings, ...snapshot(patch.lorebookSettings) }
        if (Object.hasOwn(patch.lorebookSettings, 'selected_global_lorebooks')) {
          next.lorebookSettings.selected_global_lorebooks = names(patch.lorebookSettings.selected_global_lorebooks, 'selected_global_lorebooks')
          next.globalWorldbooks = snapshot(next.lorebookSettings.selected_global_lorebooks)
        }
      }
      next.revision = current.revision + 1
      next.updatedAt = new Date().toISOString()
      assertSafeOwnedJson(next, 16 * 1024 * 1024, 'compatibility workspace state')
      await atomicJson(path, next, () => this.assertAgentActive(agent, session))
      state.compatibility = next
      return this.sessionView(agent)
    }, signal), signal)
  }

  async readCardRecord(cardId, signal, persist = false, context) {
    const state = await this.stateFor(context)
    const record = await this.loadCardRecord(join(state.root, 'cards', `${cardId}.json`), cardId, persist, signal)
    if (record === undefined) state.cards.delete(cardId)
    else state.cards.set(cardId, record)
    return record === undefined ? undefined : snapshot(record)
  }

  async refreshCard(id, signal, context) {
    const cardId = safeCardId(id)
    const state = await this.stateFor(context)
    const path = join(state.root, 'cards', `${cardId}.json`)
    return this.serial(`resources:${state.root}`, () => withFileLock(path, async () => {
      const record = await this.loadCardRecord(path, cardId, true, signal)
      if (record === undefined) state.cards.delete(cardId)
      else state.cards.set(cardId, record)
      return record === undefined ? undefined : snapshot(record)
    }, signal), signal)
  }

  async refreshLibrary(context, signal) {
    if (isAbortSignal(context)) { signal = context; context = undefined }
    const state = await this.stateFor(context)
    const [cardFiles, worldbookFiles] = await Promise.all([
      readdir(join(state.root, 'cards'), { withFileTypes: true }),
      readdir(join(state.root, 'worldbooks'), { withFileTypes: true }),
    ])
    const cardIds = new Set(cardFiles.filter(file => file.isFile() && /^[a-f0-9]{64}\.json$/.test(file.name)).map(file => file.name.slice(0, -5)))
    const worldbookIds = new Set(worldbookFiles.filter(file => file.isFile() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/.test(file.name)).map(file => file.name.slice(0, -5)))
    for (const id of cardIds) {
      try { await this.refreshCard(id, signal, state.workspace) } catch (error) { if (signal?.aborted) throw error }
    }
    for (const id of worldbookIds) {
      try {
        const record = await this.loadWorldbookRecord(join(state.root, 'worldbooks', `${id}.json`), id)
        if (record !== undefined) state.worldbooks.set(id, record)
      } catch (error) { if (signal?.aborted) throw error }
    }
    for (const id of state.cards.keys()) if (!cardIds.has(id)) state.cards.delete(id)
    for (const id of state.worldbooks.keys()) if (!worldbookIds.has(id)) state.worldbooks.delete(id)
    await Promise.all([this.refreshTemplates(state.workspace, signal), this.refreshRegexSources(state.workspace, signal), this.refreshSelection(state.workspace, signal)])
    for (const session of this.sessions.values()) {
      if (session.workspace !== state.workspace || session.binding === null) continue
      if (!state.cards.has(session.binding.cardId)) session.binding = null
      else if (session.binding.worldbookId !== null && !state.worldbooks.has(session.binding.worldbookId)) session.binding.worldbookId = null
    }
  }

  async refreshSelection(context, signal) {
    if (isAbortSignal(context)) { signal = context; context = undefined }
    const state = await this.stateFor(context)
    const selection = await readJson(join(state.root, 'selection.json'), { schemaVersion: 1, selectedCardId: null }, 64 * 1024)
    signal?.throwIfAborted()
    const rawCandidate = typeof selection?.selectedCardId === 'string' && /^[a-f0-9]{64}$/.test(selection.selectedCardId) ? selection.selectedCardId : null
    if (rawCandidate !== null && !state.cards.has(rawCandidate)) {
      const record = await this.loadCardRecord(join(state.root, 'cards', `${rawCandidate}.json`), rawCandidate, false, signal)
      if (record !== undefined) state.cards.set(rawCandidate, record)
    }
    const candidate = rawCandidate !== null && state.cards.has(rawCandidate) ? rawCandidate : null
    state.selectedCardId = candidate
    return candidate
  }

  selectionView(context) {
    const state = this.workspaces.get(this.workspaceFor(context))
    const selected = state?.selectedCardId === null || state === undefined ? undefined : state.cards.get(state.selectedCardId)
    return {
      selectedCardId: selected?.id ?? null,
      selectedCard: selected === undefined ? null : { id: selected.id, name: selected.card.data.name, nickname: selected.card.data.nickname },
    }
  }

  async selectCard(cardId, context, signal) {
    if (isAbortSignal(context)) { signal = context; context = undefined }
    const state = await this.stateFor(context)
    const id = cardId === null || cardId === undefined || cardId === '' ? null : safeCardId(cardId)
    const path = join(state.root, 'selection.json')
    return this.serial(`resources:${state.root}`, async () => {
      if (id !== null) {
        const cardPath = join(state.root, 'cards', `${id}.json`)
        const record = await withFileLock(cardPath, () => this.loadCardRecord(cardPath, id, true, signal), signal)
        if (record === undefined) {
          state.cards.delete(id)
          throw new Error(`card ${id} was not found`)
        }
        state.cards.set(id, record)
      }
      return this.serial(`selection:${state.root}`, () => withFileLock(path, async () => {
        await atomicJson(path, { schemaVersion: 1, selectedCardId: id }, () => signal?.throwIfAborted())
        state.selectedCardId = id
        return this.selectionView(state.workspace)
      }, signal), signal)
    }, signal)
  }

  listCards(context) {
    const state = this.workspaces.get(this.workspaceFor(context))
    return [...(state?.cards.values() ?? [])].map(record => ({
      id: record.id,
      name: record.card.data.name,
      nickname: record.card.data.nickname,
      tags: record.card.data.tags,
      creator: record.card.data.creator,
      characterVersion: record.card.data.character_version,
      format: record.format,
      warnings: record.warnings,
      importedAt: record.importedAt,
      updatedAt: record.updatedAt,
      scriptCount: record.scripts.length,
      scriptImportSummary: record.scriptImportReport?.summary ?? null,
      defaultWorldbookId: record.defaultWorldbookId,
    })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  getCard(id, context) {
    if (!/^[a-f0-9]{64}$/.test(String(id))) return undefined
    const record = this.workspaces.get(this.workspaceFor(context))?.cards.get(String(id))
    return record === undefined ? undefined : snapshot(record)
  }

  listWorldbooks(context) {
    const state = this.workspaces.get(this.workspaceFor(context))
    return [...(state?.worldbooks.values() ?? [])].map(record => ({
      id: record.id,
      name: record.name,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      entryCount: Array.isArray(record.book.entries) ? record.book.entries.length : 0,
    })).sort((left, right) => left.name.localeCompare(right.name))
  }

  getWorldbook(id, context) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(String(id))) return undefined
    const record = this.workspaces.get(this.workspaceFor(context))?.worldbooks.get(String(id))
    return record === undefined ? undefined : snapshot(record)
  }

  worldbookByName(state, name) {
    const key = worldbookNameKey(name)
    return [...state.worldbooks.values()].find(record => worldbookNameKey(record.name) === key)
  }

  exactWorldbookByName(state, name) {
    return [...state.worldbooks.values()].find(record => record.name === String(name))
  }

  getWorldbookNames(context) {
    const state = this.workspaces.get(this.workspaceFor(context))
    return [...(state?.worldbooks.values() ?? [])].map(record => record.name).sort((left, right) => left.localeCompare(right))
  }

  getTavernWorldbookSnapshot(name, context) {
    const state = this.workspaces.get(this.workspaceFor(context))
    const record = state === undefined ? undefined : this.exactWorldbookByName(state, name)
    if (record === undefined) throw new Error(`worldbook "${String(name)}" was not found`)
    return {
      id: record.id,
      name: record.name,
      revision: record.revision,
      worldbook: toTavernWorldbookEntries(record.book),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  getTavernWorldbook(name, context) {
    return this.getTavernWorldbookSnapshot(name, context).worldbook
  }

  worldbookNameConflict(name, existing) {
    const error = new Error(`worldbook "${name}" already exists`)
    error.code = 'worldbook-name-conflict'
    error.details = { worldbookName: name, existingWorldbookId: existing.id }
    return error
  }

  worldbookRevisionConflict(existing, expectedRevision) {
    const error = new Error(`worldbook "${existing.name}" revision changed`)
    error.code = 'worldbook-revision-conflict'
    error.details = {
      worldbookId: existing.id,
      worldbookName: existing.name,
      expectedRevision,
      actualRevision: existing.revision,
    }
    return error
  }

  assertWorldbookRevision(existing, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return
    const expected = Number(expectedRevision)
    if (!Number.isSafeInteger(expected) || expected < 0) throw new TypeError('expected worldbook revision must be a non-negative integer')
    if (existing.revision !== expected) throw this.worldbookRevisionConflict(existing, expected)
  }

  async writeWorldbook(state, record, signal) {
    const id = safeWorldbookId(record.id)
    const path = join(state.root, 'worldbooks', `${id}.json`)
    assertSafeOwnedJson(record, MAX_WORLDBOOK_RECORD_BYTES, 'worldbook record')
    await withFileLock(path, () => atomicJson(path, record, () => signal?.throwIfAborted()), signal)
    state.worldbooks.set(id, record)
    return snapshot(record)
  }

  async importWorldbook(bookValue, options = {}) {
    const context = options.context ?? options.workspace
    const signal = options.signal
    const state = await this.stateFor(context)
    const strategy = options.conflict ?? 'error'
    if (!['error', 'overwrite', 'save-as'].includes(strategy)) throw new Error('worldbook conflict strategy must be error, overwrite, or save-as')
    const requestedName = strategy === 'save-as' ? options.saveAsName : options.name
    const book = normalizeWorldbookBook(bookValue, requestedName)
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      const sameName = this.worldbookByName(state, book.name)
      if (sameName !== undefined && strategy === 'error') throw this.worldbookNameConflict(book.name, sameName)
      if (strategy === 'save-as' && sameName !== undefined) throw this.worldbookNameConflict(book.name, sameName)
      let target
      if (strategy === 'overwrite') {
        const overwriteId = options.overwriteId === undefined ? sameName?.id : safeWorldbookId(options.overwriteId)
        target = overwriteId === undefined ? undefined : state.worldbooks.get(overwriteId)
        if (target === undefined) throw new Error('overwrite target worldbook was not found')
        this.assertWorldbookRevision(target, options.expectedRevision)
      }
      const timestamp = new Date().toISOString()
      const id = target?.id ?? randomUUID()
      const record = {
        schemaVersion: 2,
        id,
        revision: target === undefined ? 0 : target.revision + 1,
        name: book.name,
        book,
        createdAt: target?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      return this.writeWorldbook(state, record, signal)
    }, signal), signal)
  }

  async createWorldbook(book, options = {}) {
    return this.importWorldbook(book, { ...options, conflict: options.conflict ?? 'error' })
  }

  async updateWorldbook(id, patch, options = {}) {
    const worldbookId = safeWorldbookId(id)
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('worldbook patch must be an object')
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      const path = join(state.root, 'worldbooks', `${worldbookId}.json`)
      return withFileLock(path, async () => {
        const existing = await this.loadWorldbookRecord(path, worldbookId)
        if (existing === undefined) throw new Error(`worldbook ${worldbookId} was not found`)
        this.assertWorldbookRevision(existing, options.expectedRevision)
        const input = snapshot(Object.hasOwn(patch, 'book') ? patch.book : { ...existing.book, ...patch })
        if (input !== null && typeof input === 'object' && !Array.isArray(input)) delete input.id
        const book = normalizeWorldbookBook(input, patch.name ?? input.name ?? existing.name)
        const collision = this.worldbookByName(state, book.name)
        if (collision !== undefined && collision.id !== worldbookId) {
          throw this.worldbookNameConflict(book.name, collision)
        }
        const record = { ...existing, schemaVersion: 2, revision: existing.revision + 1, name: book.name, book, updatedAt: new Date().toISOString() }
        assertSafeOwnedJson(record, MAX_WORLDBOOK_RECORD_BYTES, 'worldbook record')
        await atomicJson(path, record, () => signal?.throwIfAborted())
        state.worldbooks.set(worldbookId, record)
        return snapshot(record)
      }, signal)
    }, signal), signal)
  }

  async createTavernWorldbook(name, entries = [], options = {}) {
    if (!Array.isArray(entries)) throw new TypeError('worldbook entries must be an array')
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    const worldbookName = normalizeWorldbookBook({ name, entries: [] }).name
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      if (this.worldbookByName(state, worldbookName) !== undefined) return false
      const timestamp = new Date().toISOString()
      const converted = replaceTavernWorldbookEntries({ name: worldbookName, entries: [], extensions: {} }, entries)
      const record = {
        schemaVersion: 2,
        id: randomUUID(),
        revision: 0,
        name: worldbookName,
        book: normalizeWorldbookBook(converted.book, worldbookName),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await this.writeWorldbook(state, record, signal)
      return true
    }, signal), signal)
  }

  async createOrReplaceTavernWorldbook(name, entries = [], options = {}) {
    if (!Array.isArray(entries)) throw new TypeError('worldbook entries must be an array')
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    const worldbookName = normalizeWorldbookBook({ name, entries: [] }).name
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      const existing = this.worldbookByName(state, worldbookName)
      if (existing !== undefined) this.assertWorldbookRevision(existing, options.expectedRevision)
      else if (options.expectedRevision !== undefined && options.expectedRevision !== null) {
        throw new Error(`worldbook "${worldbookName}" was not found`)
      }
      const converted = replaceTavernWorldbookEntries(existing?.book ?? { name: worldbookName, entries: [], extensions: {} }, entries)
      const timestamp = new Date().toISOString()
      const record = {
        schemaVersion: 2,
        id: existing?.id ?? randomUUID(),
        revision: existing === undefined ? 0 : existing.revision + 1,
        name: existing?.name ?? worldbookName,
        book: normalizeWorldbookBook(converted.book, existing?.name ?? worldbookName),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      await this.writeWorldbook(state, record, signal)
      return existing === undefined
    }, signal), signal)
  }

  async replaceTavernWorldbook(name, entries, options = {}) {
    if (!Array.isArray(entries)) throw new TypeError('worldbook entries must be an array')
    await this.mutateTavernWorldbook(name, options, existing => replaceTavernWorldbookEntries(existing.book, entries))
  }

  async createTavernWorldbookEntries(name, entries, options = {}) {
    if (!Array.isArray(entries)) throw new TypeError('new worldbook entries must be an array')
    const result = await this.mutateTavernWorldbook(name, options, existing => appendTavernWorldbookEntries(existing.book, entries))
    return { worldbook: result.worldbook, new_entries: result.new_entries }
  }

  async deleteTavernWorldbookEntries(name, predicateOrUids, options = {}) {
    const predicate = typeof predicateOrUids === 'function'
      ? predicateOrUids
      : (() => {
          if (!Array.isArray(predicateOrUids)) throw new TypeError('worldbook entry deletion requires a predicate or uid array')
          const uids = new Set(predicateOrUids.map(Number).filter(Number.isSafeInteger))
          return entry => uids.has(entry.uid)
        })()
    const result = await this.mutateTavernWorldbook(name, options, existing => removeTavernWorldbookEntries(existing.book, predicate))
    return { worldbook: result.worldbook, deleted_entries: result.deleted_entries }
  }

  async mutateTavernWorldbook(name, options, operation) {
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    const worldbookName = String(name)
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      const existing = this.exactWorldbookByName(state, worldbookName)
      if (existing === undefined) throw new Error(`worldbook "${worldbookName}" was not found`)
      this.assertWorldbookRevision(existing, options.expectedRevision)
      const result = operation(snapshot(existing))
      if (result === null || typeof result !== 'object' || result.book === null || typeof result.book !== 'object') throw new TypeError('worldbook mutation must return a book')
      const record = {
        ...existing,
        schemaVersion: 2,
        revision: existing.revision + 1,
        book: normalizeWorldbookBook(result.book, existing.name),
        updatedAt: new Date().toISOString(),
      }
      const path = join(state.root, 'worldbooks', `${existing.id}.json`)
      assertSafeOwnedJson(record, MAX_WORLDBOOK_RECORD_BYTES, 'worldbook record')
      await withFileLock(path, () => atomicJson(path, record, () => signal?.throwIfAborted()), signal)
      state.worldbooks.set(existing.id, record)
      return { ...snapshot(result), revision: record.revision }
    }, signal), signal)
  }

  async deleteTavernWorldbook(name, options = {}) {
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    const worldbookName = String(name)
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      const existing = this.exactWorldbookByName(state, worldbookName)
      if (existing === undefined) return false
      this.assertWorldbookRevision(existing, options.expectedRevision)
      const bindings = await this.currentBindings(state)
      const references = this.worldbookReferencesFrom(state, bindings, existing.id)
      if (options.rejectIfReferenced === true && (references.cards.length > 0 || references.sessions.length > 0)) throw this.referenceError('worldbook', existing.id, references)
      await this.deleteWorldbookLocked(state, existing, bindings, signal)
      return true
    }, signal), signal)
  }

  async initializeImportedScriptData(state, cardId, scripts, signal) {
    const initializers = scripts.filter(script => script?.tavernHelper && script.data !== null && typeof script.data === 'object' && !Array.isArray(script.data))
    if (initializers.length === 0) return
    const path = join(state.root, 'compatibility.json')
    await this.serial(`compatibility:${state.root}`, () => withFileLock(path, async () => {
      const current = normalizeCompatibilityWorkspace(await readJson(path, emptyCompatibilityWorkspace(), 16 * 1024 * 1024))
      const next = snapshot(current)
      let changed = false
      for (const script of initializers) {
        const key = compatibilityScriptKey(cardId, script.id)
        if (Object.hasOwn(next.variables.scripts, key)) continue
        next.variables.scripts[key] = snapshot(script.data)
        changed = true
      }
      if (!changed) {
        state.compatibility = current
        return
      }
      next.revision = current.revision + 1
      next.updatedAt = new Date().toISOString()
      assertSafeOwnedJson(next, 16 * 1024 * 1024, 'compatibility workspace state')
      await atomicJson(path, next, () => signal?.throwIfAborted())
      state.compatibility = next
    }, signal), signal)
  }

  async importCard(bytes, metadata = {}, signal, context) {
    if (signal !== undefined && !isAbortSignal(signal)) { context = signal; signal = undefined }
    context ??= metadata.context ?? metadata.workspace
    const state = await this.stateFor(context)
    signal?.throwIfAborted()
    const parsed = parseCardBytes(bytes, { strict: true })
    const id = createHash('sha256').update(bytes).digest('hex')
    const card = snapshot(parsed.card)
    const scriptImport = extractCardScriptImports(parsed.card)
    const embeddedWorldbook = card.data.character_book === null || typeof card.data.character_book !== 'object' || Array.isArray(card.data.character_book)
      ? null
      : snapshot(card.data.character_book)
    delete card.data.character_book
    let importedWorldbook
    if (embeddedWorldbook !== null) {
      const requestedConflict = metadata.worldbookConflict ?? metadata.conflict ?? 'error'
      const conflict = requestedConflict !== null && typeof requestedConflict === 'object' ? requestedConflict.action : requestedConflict
      importedWorldbook = await this.importWorldbook(embeddedWorldbook, {
        context: state.workspace,
        signal,
        conflict,
        overwriteId: metadata.overwriteWorldbookId,
        saveAsName: requestedConflict !== null && typeof requestedConflict === 'object' ? requestedConflict.name : metadata.saveAsName,
        name: metadata.worldbookName ?? embeddedWorldbook.name ?? `${card.data.name} Worldbook`,
      })
    }
    const record = await this.serial(`resources:${state.root}`, async () => {
      const path = join(state.root, 'cards', `${id}.json`)
      return withFileLock(path, async () => {
        const timestamp = new Date().toISOString()
        const existing = await this.loadCardRecord(path, id, false, signal)
        const record = {
          schemaVersion: 4,
          id,
          importedAt: existing?.importedAt ?? timestamp,
          updatedAt: timestamp,
          fileName: basename(String(metadata.fileName ?? `${card.data.name}${extensionFor(parsed.format)}`)),
          mediaType: String(metadata.mediaType ?? (parsed.format === 'json-v3' ? 'application/json' : 'image/png')),
          format: parsed.format,
          warnings: parsed.warnings,
          card,
          defaultWorldbookId: importedWorldbook?.id ?? existing?.defaultWorldbookId ?? null,
          scripts: existing?.scripts ?? normalizeScriptList(extractScripts(parsed.card)),
          scriptImportReport: existing?.scriptImportReport ?? scriptImport.report,
        }
        assertJsonBytes(record, MAX_CARD_RECORD_BYTES, 'card record')
        await atomicJson(path, record, () => signal?.throwIfAborted())
        await writeFile(join(state.root, 'originals', `${id}${extensionFor(parsed.format)}`), bytes)
        state.cards.set(id, record)
        return snapshot(record)
      }, signal)
    }, signal)
    await this.initializeImportedScriptData(state, id, record.scripts, signal)
    return record
  }

  async updateCard(id, patch, signal, context) {
    if (signal !== undefined && !isAbortSignal(signal)) { context = signal; signal = undefined }
    context ??= patch?.context ?? patch?.workspace
    const state = await this.stateFor(context)
    const cardId = safeCardId(id)
    let characterBookId
    if (patch.characterBook !== undefined && patch.characterBook !== null) {
      const existingCard = state.cards.get(cardId)
      if (existingCard?.defaultWorldbookId && state.worldbooks.has(existingCard.defaultWorldbookId)) {
        characterBookId = (await this.updateWorldbook(existingCard.defaultWorldbookId, { book: patch.characterBook }, { context: state.workspace, signal })).id
      } else {
        characterBookId = (await this.createWorldbook(patch.characterBook, { context: state.workspace, signal, name: `${existingCard?.card?.data?.name ?? 'Character'} Worldbook` })).id
      }
    }
    return this.serial(`resources:${state.root}`, async () => {
      const path = join(state.root, 'cards', `${cardId}.json`)
      return withFileLock(path, async () => {
        const existing = await this.loadCardRecord(path, cardId, false, signal)
        if (existing === undefined) throw new Error(`card ${cardId} was not found`)
        const record = snapshot(existing)
        if (patch.cardData !== undefined) {
          if (patch.cardData === null || typeof patch.cardData !== 'object' || Array.isArray(patch.cardData)) throw new Error('cardData must be an object')
          for (const [key, field] of Object.entries(patch.cardData)) {
            if (['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'nickname'].includes(key) && typeof field === 'string') record.card.data[key] = field
          }
        }
        if (Object.hasOwn(patch, 'defaultWorldbookId')) {
          const worldbookId = patch.defaultWorldbookId === null || patch.defaultWorldbookId === '' ? null : safeWorldbookId(patch.defaultWorldbookId)
          if (worldbookId !== null && !state.worldbooks.has(worldbookId)) throw new Error(`worldbook ${worldbookId} was not found`)
          record.defaultWorldbookId = worldbookId
        }
        if (patch.characterBook !== undefined) record.defaultWorldbookId = patch.characterBook === null ? null : characterBookId
        validateCardV3(record.card)
        if (patch.scripts !== undefined) {
          if (!Array.isArray(patch.scripts)) throw new Error('scripts must be an array')
          assertSafeOwnedJson(patch.scripts, 8 * 1024 * 1024, 'scripts')
          record.scripts = normalizeScriptList(patch.scripts)
        }
        record.schemaVersion = 4
        record.updatedAt = new Date().toISOString()
        assertJsonBytes(record, MAX_CARD_RECORD_BYTES, 'card record')
        await atomicJson(path, record, () => signal?.throwIfAborted())
        state.cards.set(cardId, record)
        return snapshot(record)
      }, signal)
    }, signal)
  }

  async currentBindings(state) {
    const path = join(state.root, 'bindings.json')
    const bindings = normalizeBindingsDocument(await readJson(path, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
    state.bindings = bindings
    return bindings
  }

  async inspectWorldbookReferences(id, context) {
    const worldbookId = safeWorldbookId(id)
    const state = await this.stateFor(context)
    const bindings = await this.currentBindings(state)
    return {
      worldbookId,
      cards: [...state.cards.values()].filter(card => card.defaultWorldbookId === worldbookId).map(card => ({ id: card.id, name: String(card.card.data.name ?? '') })),
      sessions: Object.entries(bindings.sessions).flatMap(([sessionId, binding]) => binding.worldbookId === worldbookId ? [{ sessionId, cardId: binding.cardId, startedAt: binding.startedAt }] : []),
    }
  }

  async inspectCardReferences(id, context) {
    const cardId = safeCardId(id)
    const state = await this.stateFor(context)
    const bindings = await this.currentBindings(state)
    return {
      cardId,
      sessions: Object.entries(bindings.sessions).flatMap(([sessionId, binding]) => binding.cardId === cardId ? [{ sessionId, startedAt: binding.startedAt, worldbookId: binding.worldbookId }] : []),
    }
  }

  referenceError(kind, id, references) {
    const error = new Error(`${kind} ${id} is still referenced`)
    error.code = kind === 'worldbook' ? 'worldbook-references-required' : 'card-references-required'
    error.details = { references }
    return error
  }

  worldbookReferencesFrom(state, bindings, worldbookId) {
    return {
      worldbookId,
      cards: [...state.cards.values()].filter(card => card.defaultWorldbookId === worldbookId).map(card => ({ id: card.id, name: String(card.card.data.name ?? '') })),
      sessions: Object.entries(bindings.sessions).flatMap(([sessionId, binding]) => binding.worldbookId === worldbookId ? [{ sessionId, cardId: binding.cardId, startedAt: binding.startedAt }] : []),
    }
  }

  async deleteWorldbookLocked(state, existing, bindings, signal) {
    const worldbookId = existing.id
    const references = this.worldbookReferencesFrom(state, bindings, worldbookId)
    for (const reference of references.cards) {
      const card = state.cards.get(reference.id)
      if (card === undefined) continue
      const next = { ...card, defaultWorldbookId: null, updatedAt: new Date().toISOString() }
      const path = join(state.root, 'cards', `${card.id}.json`)
      await withFileLock(path, () => atomicJson(path, next, () => signal?.throwIfAborted()), signal)
      state.cards.set(card.id, next)
    }
    if (references.sessions.length > 0) {
      for (const reference of references.sessions) {
        const binding = bindings.sessions[reference.sessionId]
        binding.worldbookId = null
        binding.worldbookExplicit = true
        binding.revision += 1
      }
      const bindingsPath = join(state.root, 'bindings.json')
      await withFileLock(bindingsPath, () => atomicJson(bindingsPath, bindings, () => signal?.throwIfAborted()), signal)
      state.bindings = bindings
      for (const session of this.sessions.values()) {
        if (session.workspace !== state.workspace || session.binding === null) continue
        const persisted = bindings.sessions[session.agentId]
        if (persisted !== undefined) session.binding = snapshot(persisted)
      }
    }
    await rm(join(state.root, 'worldbooks', `${worldbookId}.json`), { force: true })
    state.worldbooks.delete(worldbookId)
    return { deleted: true, worldbookId, name: existing.name, clearedCards: references.cards.length, clearedSessions: references.sessions.length, references }
  }

  async deleteWorldbook(id, options = {}) {
    if (isAbortSignal(options)) options = { signal: options }
    const worldbookId = safeWorldbookId(id)
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    return this.serial(`resources:${state.root}`, () => withFileLock(worldbookLibraryLockTarget(state), async () => {
      await this.refreshWorldbookLibrary(state)
      const existing = state.worldbooks.get(worldbookId) ?? await this.loadWorldbookRecord(join(state.root, 'worldbooks', `${worldbookId}.json`), worldbookId)
      if (existing === undefined) throw new Error(`worldbook ${worldbookId} was not found`)
      this.assertWorldbookRevision(existing, options.expectedRevision)
      const bindings = await this.currentBindings(state)
      const references = this.worldbookReferencesFrom(state, bindings, worldbookId)
      if (options.rejectIfReferenced === true && (references.cards.length > 0 || references.sessions.length > 0)) throw this.referenceError('worldbook', worldbookId, references)
      return this.deleteWorldbookLocked(state, existing, bindings, signal)
    }, signal), signal)
  }

  async deleteCard(id, options = {}) {
    if (isAbortSignal(options)) options = { signal: options }
    const cardId = safeCardId(id)
    const state = await this.stateFor(options.context ?? options.workspace)
    const signal = options.signal
    return this.serial(`resources:${state.root}`, async () => {
      const path = join(state.root, 'cards', `${cardId}.json`)
      const existing = await this.loadCardRecord(path, cardId, false, signal)
      if (existing === undefined) throw new Error(`card ${cardId} was not found`)
      const bindings = await this.currentBindings(state)
      const references = {
        cardId,
        sessions: Object.entries(bindings.sessions).flatMap(([sessionId, binding]) => binding.cardId === cardId ? [{ sessionId, startedAt: binding.startedAt, worldbookId: binding.worldbookId }] : []),
      }
      const rejectedIds = new Set(Array.isArray(options.rejectSessionIds) ? options.rejectSessionIds.map(String) : [])
      const blocked = options.rejectIfReferenced === true ? references.sessions : references.sessions.filter(item => rejectedIds.has(item.sessionId))
      if (blocked.length > 0) throw this.referenceError('card', cardId, { ...references, sessions: blocked })
      const deleteBoundWorldbook = (options.deleteWorldbook === true || options.deleteDefaultWorldbook === true) && existing.defaultWorldbookId !== null && state.worldbooks.has(existing.defaultWorldbookId)
      let worldbookToDelete = null
      if (deleteBoundWorldbook) {
        worldbookToDelete = state.worldbooks.get(existing.defaultWorldbookId)
        const allWorldbookReferences = this.worldbookReferencesFrom(state, bindings, existing.defaultWorldbookId)
        const remainingReferences = {
          ...allWorldbookReferences,
          cards: allWorldbookReferences.cards.filter(card => card.id !== cardId),
          sessions: allWorldbookReferences.sessions.filter(session => session.cardId !== cardId),
        }
        if ((remainingReferences.cards.length > 0 || remainingReferences.sessions.length > 0) && options.confirmWorldbookDelete !== true) {
          throw this.referenceError('worldbook', existing.defaultWorldbookId, remainingReferences)
        }
      }
      let unboundSessions = 0
      for (const [sessionId, binding] of Object.entries(bindings.sessions)) {
        if (binding.cardId !== cardId) continue
        delete bindings.sessions[sessionId]
        unboundSessions += 1
      }
      if (unboundSessions > 0) {
        const bindingsPath = join(state.root, 'bindings.json')
        await withFileLock(bindingsPath, () => atomicJson(bindingsPath, bindings, () => signal?.throwIfAborted()), signal)
        state.bindings = bindings
      }
      const selectionPath = join(state.root, 'selection.json')
      if (state.selectedCardId === cardId) {
        await withFileLock(selectionPath, () => atomicJson(selectionPath, { schemaVersion: 1, selectedCardId: null }, () => signal?.throwIfAborted()), signal)
        state.selectedCardId = null
      }
      await rm(join(state.root, 'originals', `${cardId}${extensionFor(existing.format)}`), { force: true })
      await rm(path, { force: true })
      state.cards.delete(cardId)
      for (const session of this.sessions.values()) if (session.workspace === state.workspace && session.binding?.cardId === cardId) session.binding = null
      let deletedWorldbook = null
      if (worldbookToDelete !== null) deletedWorldbook = await this.deleteWorldbookLocked(state, worldbookToDelete, bindings, signal)
      return { deleted: true, cardId, name: String(existing.card.data.name ?? ''), unboundSessions, selectedCardId: state.selectedCardId, references, deletedWorldbook }
    }, signal)
  }

  branchBindingPath(state, sessionId) {
    const name = createHash('sha256').update(String(sessionId)).digest('hex')
    return join(state.root, 'branch-bindings', `${name}.json`)
  }

  captureForkPoint(session, parentAgent) {
    const fork = ordinaryFork(session)
    if (fork === null || parentAgent?.session === undefined || String(parentAgent.id) !== fork.parentSessionId) return false
    const prepared = this.preparedForkCaptures.get(String(session.id))
    if (prepared?.parentSessionId === fork.parentSessionId && prepared.inheritedEventCount === fork.inheritedEventCount) {
      this.preparedForkCaptures.delete(String(session.id))
      this.forkCaptures.set(session, prepared)
      return true
    }
    const parent = this.sessionSync(parentAgent)
    if (parent === undefined || parent.binding === null || parent.workspace !== this.workspaceFor(session?.header?.cwd)) return false
    if (sessionBoundary(parentAgent.session) !== fork.inheritedEventCount) return false
    this.forkCaptures.set(session, {
      ...fork,
      binding: snapshot(parent.binding),
      event: snapshot(parent.event),
      compatChat: snapshot(parent.compatChat),
    })
    return true
  }

  prepareFreshFork(childSessionId, parentAgent) {
    const parent = this.sessionSync(parentAgent)
    if (parent === undefined || parent.binding === null) throw new Error('source session has no selected character')
    const id = safeSessionId(childSessionId)
    const binding = snapshot(parent.binding)
    binding.revision = 0
    binding.boundAt = new Date().toISOString()
    binding.startedAt = null
    const card = parent.state.cards.get(binding.cardId)
    binding.worldbookId = card === undefined ? binding.worldbookId : this.effectiveWorldbook(parent.state, parent.binding, card)?.id ?? null
    binding.worldbookExplicit = true
    binding.variables = {}
    binding.chatMetadata = {}
    binding.scriptInjections = []
    binding.openingSwipeId = 0
    delete binding.inheritedFrom
    this.preparedForkCaptures.set(id, {
      parentSessionId: String(parentAgent.id),
      inheritedEventCount: 0,
      binding,
      event: emptyEventDocument(id),
      compatChat: emptyCompatChatDocument(id),
    })
  }

  cancelPreparedFork(childSessionId) {
    this.preparedForkCaptures.delete(String(childSessionId))
  }

  async recordBindingSnapshot(agent, binding, signal) {
    if (binding === null || binding === undefined) return
    const state = await this.stateFor(agent)
    const path = this.branchBindingPath(state, agent.id)
    const boundary = sessionBoundary(agent.session)
    await this.serial(`branch-binding:${state.root}:${String(agent.id)}`, () => withFileLock(path, async () => {
      const history = normalizeBranchBindingHistory(await readJson(path, { schemaVersion: 1, sessionId: String(agent.id), snapshots: [] }, 16 * 1024 * 1024), String(agent.id))
      const item = { boundary, exact: true, binding: snapshot(binding) }
      const index = history.snapshots.findIndex(entry => entry.boundary === boundary)
      if (index === -1) history.snapshots.push(item)
      else history.snapshots[index] = item
      history.snapshots.sort((left, right) => left.boundary - right.boundary)
      history.snapshots = history.snapshots.slice(-512)
      assertJsonBytes(history, 16 * 1024 * 1024, 'branch binding history')
      await atomicJson(path, history, () => signal?.throwIfAborted())
    }, signal), signal)
  }

  async checkpointBranchState(agent, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    if (session.binding !== null) await this.recordBindingSnapshot(agent, session.binding, signal)
    return this.sessionView(agent)
  }

  async branchAvailability(parentAgent, inheritedEventCount, signal) {
    const cut = Number(inheritedEventCount)
    if (!Number.isSafeInteger(cut) || cut < 0) throw new TypeError('fork boundary must be a non-negative safe integer')
    const session = this.sessionSync(parentAgent) ?? await this.ensureSession(parentAgent, signal)
    if (session.binding === null) return { available: false, exact: false, source: null }
    if (sessionBoundary(parentAgent.session) === cut) return { available: true, exact: true, source: 'fork-point' }
    const bindingsPath = join(session.state.root, 'bindings.json')
    const bindings = normalizeBindingsDocument(await readJson(bindingsPath, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
    const historical = (await this.collectBranchHistory(session.state, bindings, String(parentAgent.id), cut)).at(-1)
    return historical === undefined
      ? { available: false, exact: false, source: null }
      : { available: true, exact: historical.exact === true && historical.boundary === cut, source: 'history' }
  }

  async collectBranchHistory(state, bindings, sessionId, cut, seen = new Set()) {
    if (seen.has(sessionId) || seen.size >= 64) return []
    seen.add(sessionId)
    const path = this.branchBindingPath(state, sessionId)
    const local = normalizeBranchBindingHistory(await readJson(path, { schemaVersion: 1, sessionId, snapshots: [] }, 16 * 1024 * 1024), sessionId)
      .snapshots.filter(item => item.boundary <= cut)
    const lineage = bindings.sessions[sessionId]?.inheritedFrom
    const inherited = lineage !== undefined && cut <= lineage.inheritedEventCount
      ? await this.collectBranchHistory(state, bindings, lineage.parentSessionId, cut, seen)
      : []
    const merged = new Map(inherited.map(item => [item.boundary, item]))
    for (const item of local) merged.set(item.boundary, item)
    return [...merged.values()].sort((left, right) => left.boundary - right.boundary)
  }

  async forkSource(agent, state, bindings, allowCurrentFallback = false) {
    const fork = ordinaryFork(agent.session)
    if (fork === null) return null
    const captured = this.forkCaptures.get(agent.session)
    if (captured?.parentSessionId === fork.parentSessionId && captured.inheritedEventCount === fork.inheritedEventCount) {
      return { source: 'fork-point', exact: true, binding: snapshot(captured.binding), event: snapshot(captured.event), compatChat: snapshot(captured.compatChat) }
    }
    const history = await this.collectBranchHistory(state, bindings, fork.parentSessionId, fork.inheritedEventCount)
    const historical = history.at(-1)
    if (historical !== undefined) return { source: 'history', exact: historical.exact === true && historical.boundary === fork.inheritedEventCount, binding: snapshot(historical.binding) }
    const current = bindings.sessions[fork.parentSessionId]
    if (allowCurrentFallback && current !== undefined) return { source: 'parent-current', exact: false, binding: snapshot(current) }
    return null
  }

  forkView(agent, session) {
    const fork = ordinaryFork(agent.session)
    if (fork === null) return null
    const inherited = session.binding?.inheritedFrom
    if (inherited?.parentSessionId === fork.parentSessionId && inherited.inheritedEventCount === fork.inheritedEventCount) {
      return {
        ...fork,
        inheritance: {
          status: 'inherited', exact: inherited.exact === true, source: inherited.source,
          repairable: true, binding: inherited.bindingExact === true ? 'exact' : 'fallback',
          event: inherited.event, compatChat: inherited.compatChat,
          ...(inherited.exact === true ? {} : { reason: inherited.source === 'parent-current'
            ? 'the fork-point binding was unavailable, so repair used the parent session current configuration'
            : 'the binding was recovered at the fork boundary, while event memory and compatibility state were conservatively reconstructed from persisted sources' }),
        },
      }
    }
    return {
      ...fork,
      inheritance: {
        status: session.forkRepairable ? 'repairable' : 'unavailable', exact: false, source: null,
        repairable: session.forkRepairable === true, binding: session.binding === null ? 'missing' : 'fallback',
        event: 'missing', compatChat: 'missing',
        reason: session.forkRepairable ? 'legacy fork binding can be restored from its parent' : 'no parent binding snapshot exists at or before the fork boundary',
      },
    }
  }

  async inheritedDocuments(agent, session, source, fork) {
    if (source.source === 'fork-point') {
      return {
        event: normalizeEventDocument({ ...source.event, sessionId: session.agentId }, session.agentId),
        compatChat: normalizeCompatChatDocument({ ...source.compatChat, sessionId: session.agentId }, session.agentId, sessionTranscriptMessages(agent)),
        eventKind: 'exact', compatChatKind: 'exact',
      }
    }
    const parentName = createHash('sha256').update(fork.parentSessionId).digest('hex')
    const parentEvent = normalizeEventDocument(await readJson(join(session.state.root, 'event', `${parentName}.json`), emptyEventDocument(fork.parentSessionId), 20 * 1024 * 1024), fork.parentSessionId)
    return {
      event: sourceBoundedEventDocument(parentEvent, session.agentId, fork.inheritedEventCount),
      compatChat: emptyCompatChatDocument(session.agentId, sessionTranscriptMessages(agent)),
      eventKind: 'source-bounded', compatChatKind: 'native-only',
    }
  }

  async inheritFork(agent, session, bindings, source, signal) {
    const fork = ordinaryFork(agent.session)
    const documents = await this.inheritedDocuments(agent, session, source, fork)
    const binding = {
      ...snapshot(source.binding),
      inheritedFrom: {
        ...fork,
        exact: source.exact === true && documents.eventKind === 'exact' && documents.compatChatKind === 'exact',
        bindingExact: source.exact === true,
        source: source.source,
        event: documents.eventKind,
        compatChat: documents.compatChatKind,
        inheritedAt: new Date().toISOString(),
      },
    }
    await Promise.all([
      atomicJson(session.eventPath, documents.event, () => this.assertAgentActive(agent, session)),
      atomicJson(session.compatChatPath, documents.compatChat, () => this.assertAgentActive(agent, session)),
    ])
    session.event = documents.event
    session.compatChat = documents.compatChat
    session.binding = binding
    bindings.sessions[session.agentId] = snapshot(binding)
    const inheritedHistory = await this.collectBranchHistory(session.state, bindings, fork.parentSessionId, fork.inheritedEventCount)
    const historyPath = this.branchBindingPath(session.state, session.agentId)
    await this.serial(`branch-binding:${session.state.root}:${session.agentId}`, () => withFileLock(historyPath, async () => {
      const existing = normalizeBranchBindingHistory(await readJson(historyPath, { schemaVersion: 1, sessionId: session.agentId, snapshots: [] }, 16 * 1024 * 1024), session.agentId)
      const merged = new Map(inheritedHistory.map(item => [item.boundary, snapshot(item)]))
      for (const item of existing.snapshots) merged.set(item.boundary, item)
      merged.set(fork.inheritedEventCount, { boundary: fork.inheritedEventCount, exact: source.exact === true, binding: snapshot(binding) })
      existing.snapshots = [...merged.values()].sort((left, right) => left.boundary - right.boundary).slice(-512)
      assertJsonBytes(existing, 16 * 1024 * 1024, 'branch binding history')
      await atomicJson(historyPath, existing, () => signal?.throwIfAborted())
    }, signal), signal)
    return binding
  }

  async ensureSession(agent, signal) {
    if (this.disposedAgents.has(agent)) throw new Error(`agent ${String(agent.id)} was disposed`)
    const id = safeSessionId(agent.id)
    const workspace = this.workspaceOf(agent)
    const key = `${workspace}\0${id}`
    const pending = this.sessionLoads.get(key)
    if (pending !== undefined) return awaitWithSignal(pending, signal)
    const epoch = this.sessionEpoch.get(key) ?? 0
    const load = (async () => {
      const state = await this.stateFor(workspace)
      const sessionFileName = createHash('sha256').update(id).digest('hex')
      const eventPath = join(state.root, 'event', `${sessionFileName}.json`)
      const compatChatPath = join(state.root, 'compat-chats', `${sessionFileName}.json`)
      let event = normalizeEventDocument(await readJson(eventPath, emptyEventDocument(id), 20 * 1024 * 1024), id)
      let compatChat
      try {
        compatChat = normalizeCompatChatDocument(await readJson(compatChatPath, emptyCompatChatDocument(id), 20 * 1024 * 1024), id, sessionTranscriptMessages(agent))
      } catch {
        compatChat = emptyCompatChatDocument(id, sessionTranscriptMessages(agent))
      }
      await Promise.all([this.refreshTemplates(workspace), this.refreshRegexSources(workspace)])
      return this.serial(`bindings:${state.root}`, async () => {
        const bindingsPath = join(state.root, 'bindings.json')
        return withFileLock(bindingsPath, async () => {
          const bindings = normalizeBindingsDocument(await readJson(bindingsPath, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
          let binding = bindings.sessions[id] ?? null
          const session = { key, agentId: id, epoch, workspace, state, binding: binding === null ? null : snapshot(binding), event, eventPath, compatChat, compatChatPath, forkRepairable: false }
          const fork = ordinaryFork(agent.session)
          if (fork !== null) {
            const source = await this.forkSource(agent, state, bindings)
            if (binding === null && source !== null) {
              binding = await this.inheritFork(agent, session, bindings, source, signal)
              event = session.event
              compatChat = session.compatChat
              await atomicJson(bindingsPath, bindings, () => this.assertAgentActive(agent, session))
            } else if (binding?.inheritedFrom?.parentSessionId !== fork.parentSessionId || binding?.inheritedFrom?.inheritedEventCount !== fork.inheritedEventCount) {
              session.forkRepairable = source !== null || bindings.sessions[fork.parentSessionId] !== undefined
            }
          }
          if (binding !== null && !state.cards.has(binding.cardId)) {
            const record = await this.loadCardRecord(join(state.root, 'cards', `${binding.cardId}.json`), binding.cardId, false)
            if (record !== undefined) state.cards.set(binding.cardId, record)
          }
          if (binding !== null && !state.cards.has(binding.cardId)) {
            delete bindings.sessions[id]
            await atomicJson(bindingsPath, bindings)
            binding = null
          }
          if (binding !== null && binding.worldbookId !== null && !state.worldbooks.has(binding.worldbookId)) {
            const worldbook = await this.loadWorldbookRecord(join(state.root, 'worldbooks', `${binding.worldbookId}.json`), binding.worldbookId)
            if (worldbook !== undefined) state.worldbooks.set(binding.worldbookId, worldbook)
          }
          if (binding !== null && binding.startedAt === null && binding.worldbookExplicit !== true) {
            const defaultWorldbookId = state.cards.get(binding.cardId)?.defaultWorldbookId
            if (defaultWorldbookId && !state.worldbooks.has(defaultWorldbookId)) {
              const worldbook = await this.loadWorldbookRecord(join(state.root, 'worldbooks', `${defaultWorldbookId}.json`), defaultWorldbookId)
              if (worldbook !== undefined) state.worldbooks.set(defaultWorldbookId, worldbook)
            }
          }
          if (binding !== null && binding.worldbookId !== null && !state.worldbooks.has(binding.worldbookId)) binding.worldbookId = null
          state.bindings = bindings
          const cached = this.sessions.get(key)
          if (cached?.event.revision > event.revision) event = cached.event
          if (this.disposedAgents.has(agent)) throw new Error(`agent ${id} was disposed`)
          session.binding = binding === null ? null : snapshot(binding)
          session.event = event
          session.compatChat = compatChat
          if ((this.sessionEpoch.get(key) ?? 0) === epoch) this.sessions.set(key, session)
          return session
        })
      })
    })()
    this.sessionLoads.set(key, load)
    const cleanup = () => { if (this.sessionLoads.get(key) === load) this.sessionLoads.delete(key) }
    void load.then(cleanup, cleanup)
    return awaitWithSignal(load, signal)
  }

  sessionSync(agent) { return this.sessions.get(this.sessionKey(agent)) }

  assertAgentActive(agent, session) {
    if (this.disposedAgents.has(agent) || (this.sessionEpoch.get(session.key) ?? 0) !== session.epoch) throw new Error(`agent ${session.agentId} was disposed`)
  }

  async repairForkInheritance(agent, options = {}, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    const fork = ordinaryFork(agent.session)
    if (fork === null) {
      const error = new Error('session is not an ordinary seeded fork')
      error.code = 'not-repairable-fork'
      throw error
    }
    if (options.parentAgent !== undefined) this.captureForkPoint(agent.session, options.parentAgent)
    const state = session.state
    const path = join(state.root, 'bindings.json')
    const view = await this.serial(`bindings:${state.root}`, () => withFileLock(path, async () => {
      const bindings = normalizeBindingsDocument(await readJson(path, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
      const source = await this.forkSource(agent, state, bindings, true)
      if (source === null) {
        const error = new Error('parent binding is unavailable for this fork')
        error.code = 'fork-inheritance-unavailable'
        throw error
      }
      const binding = await this.inheritFork(agent, session, bindings, source, signal)
      assertJsonBytes(bindings, 16 * 1024 * 1024, 'workspace bindings')
      await atomicJson(path, bindings, () => this.assertAgentActive(agent, session))
      session.binding = binding
      session.forkRepairable = false
      state.bindings = bindings
      return this.sessionView(agent)
    }, signal), signal)
    await this.recordBindingSnapshot(agent, session.binding, signal)
    return view
  }

  async ensureSelectedSession(agent, signal) {
    const session = await this.ensureSession(agent, signal)
    if (session.binding !== null) return session
    if (ordinaryFork(agent.session) !== null) {
      const error = new Error('fork inheritance is unavailable; repair the fork before continuing')
      error.code = 'fork-inheritance-unavailable'
      throw error
    }
    const selectedCardId = await this.refreshSelection(session.workspace, signal)
    if (selectedCardId === null) return session
    await this.bind(agent, selectedCardId, { signal })
    return this.sessionSync(agent) ?? session
  }

  async bind(agent, cardId, options = {}) {
    const id = safeCardId(cardId)
    const signal = options.signal
    const session = await this.ensureSession(agent, signal)
    const state = session.state
    if (await this.refreshCard(id, signal, state.workspace) === undefined) throw new Error(`card ${id} was not found`)
    const defaultWorldbookId = state.cards.get(id)?.defaultWorldbookId
    if (defaultWorldbookId && !state.worldbooks.has(defaultWorldbookId)) {
      const worldbook = await this.loadWorldbookRecord(join(state.root, 'worldbooks', `${defaultWorldbookId}.json`), defaultWorldbookId)
      if (worldbook !== undefined) state.worldbooks.set(defaultWorldbookId, worldbook)
    }
    const expectedCardId = Object.hasOwn(options, 'expectedCardId')
      ? options.expectedCardId === null || options.expectedCardId === '' ? null : safeCardId(options.expectedCardId)
      : undefined
    if (options.replace === true && expectedCardId === undefined) throw new Error('expectedCardId is required when replacing a bound character')
    const path = join(state.root, 'bindings.json')
    return this.serial(`bindings:${state.root}`, () => withFileLock(path, async () => {
      const bindings = normalizeBindingsDocument(await readJson(path, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
      const previous = bindings.sessions[session.agentId] ?? null
      // Another Store may have committed after ensureSession loaded our cache.
      // Keep that committed state visible even when this bind is rejected.
      session.binding = previous === null ? null : snapshot(previous)
      state.bindings = snapshot(bindings)
      if (expectedCardId !== undefined && (previous?.cardId ?? null) !== expectedCardId) {
        const error = new Error('current session binding changed before replacement')
        error.code = 'binding-changed'
        throw error
      }
      if (previous !== null && previous.startedAt !== null && previous.cardId !== id) {
        const error = new Error('a started session cannot change character')
        error.code = 'session-started'
        throw error
      }
      if (previous !== null && previous.cardId !== id && options.replace !== true) {
        const error = new Error('current session already has a selected character')
        error.code = 'replace-confirmation-required'
        throw error
      }
      if (previous?.cardId === id) {
        await this.recordBindingSnapshot(agent, previous, signal)
        return this.sessionView(agent)
      }
      const next = previous === null
        ? defaultBinding(id)
        : { ...previous, revision: previous.revision + 1, cardId: id, boundAt: new Date().toISOString(), startedAt: null, worldbookId: null, worldbookExplicit: false, openingSwipeId: 0 }
      if (previous?.cardId !== id) delete next.inheritedFrom
      bindings.sessions[session.agentId] = snapshot(next)
      if (Object.keys(bindings.sessions).length > 4096) throw new Error('workspace bindings exceed 4096 sessions')
      assertJsonBytes(bindings, 16 * 1024 * 1024, 'workspace bindings')
      await atomicJson(path, bindings, () => this.assertAgentActive(agent, session))
      session.binding = next
      state.bindings = bindings
      if (previous?.cardId !== id) {
        session.compatChat = emptyCompatChatDocument(session.agentId, sessionTranscriptMessages(agent))
        await atomicJson(session.compatChatPath, session.compatChat, () => this.assertAgentActive(agent, session))
      }
      await this.recordBindingSnapshot(agent, next, signal)
      return this.sessionView(agent)
    }, signal), signal)
  }

  async startSession(agent, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    const state = session.state
    const path = join(state.root, 'bindings.json')
    return this.serial(`bindings:${state.root}`, () => withFileLock(path, async () => {
      const bindings = normalizeBindingsDocument(await readJson(path, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
      const current = bindings.sessions[session.agentId] ?? null
      if (current === null) throw new Error('current session has no selected character')
      if (current.startedAt !== null) {
        session.binding = snapshot(current)
        state.bindings = bindings
        await this.recordBindingSnapshot(agent, current, signal)
        return this.sessionView(agent)
      }
      const cardPath = join(state.root, 'cards', `${current.cardId}.json`)
      const diskCard = await this.loadCardRecord(cardPath, current.cardId, false, signal)
      if (diskCard !== undefined) state.cards.set(current.cardId, diskCard)
      const card = diskCard ?? state.cards.get(current.cardId)
      if (card === undefined) throw new Error(`card ${current.cardId} was not found`)
      if (card.defaultWorldbookId && !state.worldbooks.has(card.defaultWorldbookId)) {
        const worldbook = await this.loadWorldbookRecord(join(state.root, 'worldbooks', `${card.defaultWorldbookId}.json`), card.defaultWorldbookId)
        if (worldbook !== undefined) state.worldbooks.set(card.defaultWorldbookId, worldbook)
      }
      const inheritedId = card.defaultWorldbookId !== null && state.worldbooks.has(card.defaultWorldbookId) ? card.defaultWorldbookId : null
      const next = {
        ...current,
        revision: current.revision + 1,
        startedAt: new Date().toISOString(),
        worldbookId: current.worldbookExplicit ? current.worldbookId : inheritedId,
      }
      bindings.sessions[session.agentId] = snapshot(next)
      await atomicJson(path, bindings, () => this.assertAgentActive(agent, session))
      session.binding = next
      state.bindings = bindings
      await this.recordBindingSnapshot(agent, next, signal)
      return this.sessionView(agent)
    }, signal), signal)
  }

  async updateSession(agent, patch, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    const state = session.state
    const path = join(state.root, 'bindings.json')
    return this.serial(`bindings:${state.root}`, () => withFileLock(path, async () => {
      const bindings = normalizeBindingsDocument(await readJson(path, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
      const current = bindings.sessions[session.agentId] ?? null
      if (current === null) throw new Error('current session has no selected character')
      if (Object.hasOwn(patch, 'expectedRevision')) {
        const expectedRevision = Number(patch.expectedRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('session expectedRevision must be a non-negative safe integer')
        if (current.revision !== expectedRevision) {
          const error = new Error(`session revision changed from ${expectedRevision} to ${current.revision}`)
          error.code = 'session-revision-conflict'
          throw error
        }
      }
      const next = snapshot(current)
      if (patch.userPersona !== undefined) {
        const name = String(patch.userPersona.name ?? 'User')
        const description = String(patch.userPersona.description ?? '')
        if (Buffer.byteLength(name, 'utf8') > 1024 || Buffer.byteLength(description, 'utf8') > 64 * 1024) throw new Error('user persona exceeds the size limit')
        next.userPersona = { name, description }
      }
      if (patch.templateIds !== undefined) {
        if (!Array.isArray(patch.templateIds) || patch.templateIds.length > 32) throw new Error('templateIds must contain at most 32 entries')
        next.templateIds = patch.templateIds.map(String)
      }
      if (patch.variables !== undefined) {
        if (patch.variables === null || typeof patch.variables !== 'object' || Array.isArray(patch.variables)) throw new Error('variables must be an object')
        assertSafeOwnedJson(patch.variables, 1024 * 1024, 'variables')
        next.variables = snapshot(patch.variables)
      }
      if (patch.chatMetadata !== undefined) {
        if (patch.chatMetadata === null || typeof patch.chatMetadata !== 'object' || Array.isArray(patch.chatMetadata)) throw new Error('chatMetadata must be an object')
        assertSafeOwnedJson(patch.chatMetadata, 1024 * 1024, 'chatMetadata')
        next.chatMetadata = snapshot(patch.chatMetadata)
      }
      if (patch.scriptInjections !== undefined) {
        if (!Array.isArray(patch.scriptInjections) || patch.scriptInjections.length > 64) throw new Error('scriptInjections must contain at most 64 entries')
        const injections = patch.scriptInjections.map(item => ({
          id: String(item.id ?? randomUUID()),
          text: String(item.content ?? item.text ?? ''),
          content: String(item.content ?? item.text ?? ''),
          order: Number(item.order ?? 0),
          position: item.position === 'none' ? 'none' : 'in_chat',
          depth: Number.isFinite(Number(item.depth)) ? Number(item.depth) : 0,
          role: ['system', 'assistant', 'user'].includes(item.role) ? item.role : 'system',
          should_scan: item.should_scan === true,
          once: item.once === true,
          ownerFrameId: typeof item.ownerFrameId === 'string' ? item.ownerFrameId : null,
          hasFilter: item.hasFilter === true,
        }))
        if (injections.some(item => Buffer.byteLength(item.text, 'utf8') > 16 * 1024) || Buffer.byteLength(JSON.stringify(injections), 'utf8') > 64 * 1024) throw new Error('scriptInjections exceed the size limit')
        next.scriptInjections = injections
      }
      if (Object.hasOwn(patch, 'worldbookId')) {
        const worldbookId = patch.worldbookId === null || patch.worldbookId === '' ? null : safeWorldbookId(patch.worldbookId)
        if (worldbookId !== null && !state.worldbooks.has(worldbookId)) throw new Error(`worldbook ${worldbookId} was not found`)
        next.worldbookId = worldbookId
        next.worldbookExplicit = true
      }
      if (patch.openingSwipeId !== undefined) {
        const openingSwipeId = Number(patch.openingSwipeId)
        const record = state.cards.get(current.cardId)
        const count = (Array.isArray(record?.card?.data?.alternate_greetings) ? record.card.data.alternate_greetings.length : 0) + 1
        if (!Number.isSafeInteger(openingSwipeId) || openingSwipeId < 0 || openingSwipeId >= count) throw new RangeError(`opening swipeId ${openingSwipeId} is outside 0..${count - 1}`)
        next.openingSwipeId = openingSwipeId
      }
      next.revision = current.revision + 1
      bindings.sessions[session.agentId] = snapshot(next)
      assertJsonBytes(bindings, 16 * 1024 * 1024, 'workspace bindings')
      await atomicJson(path, bindings, () => this.assertAgentActive(agent, session))
      session.binding = next
      state.bindings = bindings
      await this.recordBindingSnapshot(agent, next, signal)
      return this.sessionView(agent)
    }, signal), signal)
  }

  async commitTemplateResult(agent, result, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    if (session.binding === null) throw new Error('current session has no selected character')
    if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('template result must be an object')
    if (!Array.isArray(result.mutations)) throw new TypeError('template result mutations must be an array')
    if (result.scopes === null || typeof result.scopes !== 'object' || Array.isArray(result.scopes)) throw new TypeError('template result scopes must be an object')
    const durableScopes = new Set()
    for (const [index, mutation] of result.mutations.entries()) {
      if (mutation === null || typeof mutation !== 'object' || Array.isArray(mutation)) throw new TypeError(`template mutation ${index} must be an object`)
      const scope = String(mutation.scope ?? '')
      if (scope === 'initial') continue
      if (!['local', 'global', 'message'].includes(scope)) throw new TypeError(`template mutation ${index} has unsupported durable scope ${scope}`)
      durableScopes.add(scope)
    }
    const orderedScopes = ['local', 'global', 'message'].filter(scope => durableScopes.has(scope))
    if (orderedScopes.length === 0) {
      return {
        committed: false,
        scopes: [],
        revisions: {
          chat: Number(session.binding.revision ?? 0),
          global: Number(session.state.regexRevision ?? 0),
          workspace: Number(session.state.compatibility.revision ?? 0),
          message: Number(session.compatChat.revision ?? 0),
        },
      }
    }
    for (const scope of orderedScopes) {
      const value = result.scopes[scope]
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`template ${scope} scope must be an object`)
      assertSafeOwnedJson(value, scope === 'message' || scope === 'local' ? 1024 * 1024 : 16 * 1024 * 1024, `template ${scope} scope`)
    }
    const revisionField = { local: 'chat', global: 'global', message: 'message' }
    const expected = {}
    for (const scope of orderedScopes) {
      const field = revisionField[scope]
      const value = Number(result.baseRevisions?.[field])
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`template base revision ${field} must be a non-negative safe integer`)
      expected[field] = value
    }

    const state = session.state
    const paths = {
      local: join(state.root, 'bindings.json'),
      global: join(state.root, 'regex-scripts.json'),
      message: session.compatChatPath,
    }
    const serialKeys = {
      local: `bindings:${state.root}`,
      global: `regex:${state.root}`,
      message: `compat-chat:${session.workspace}:${session.agentId}`,
    }
    const keys = orderedScopes.map(scope => serialKeys[scope]).sort()
    const lockPaths = orderedScopes.map(scope => paths[scope]).sort()
    const runSerial = (index, operation) => index >= keys.length
      ? operation()
      : this.serial(keys[index], () => runSerial(index + 1, operation), signal)

    return runSerial(0, () => withFileLocks(lockPaths, async () => {
      this.assertAgentActive(agent, session)
      const current = {}
      const existed = {}
      const exists = async path => {
        try { await readFile(path); return true } catch (error) {
          if (error?.code === 'ENOENT') return false
          throw error
        }
      }
      if (durableScopes.has('local')) {
        existed.local = await exists(paths.local)
        current.local = normalizeBindingsDocument(await readJson(paths.local, { schemaVersion: 1, sessions: {} }, 16 * 1024 * 1024))
      }
      if (durableScopes.has('global')) {
        existed.global = await exists(paths.global)
        current.global = normalizeRegexSourcesDocument(await readJson(paths.global, { schemaVersion: 1, revision: 0, global: [], preset: [], variables: {} }, 16 * 1024 * 1024))
      }
      if (durableScopes.has('message')) {
        existed.message = await exists(paths.message)
        current.message = normalizeCompatChatDocument(
          await readJson(paths.message, emptyCompatChatDocument(session.agentId), 20 * 1024 * 1024),
          session.agentId,
          sessionTranscriptMessages(agent),
        )
      }

      const conflicts = []
      if (current.local !== undefined) {
        const binding = current.local.sessions[session.agentId]
        if (binding === undefined) throw new Error('current session has no selected character')
        if (binding.revision !== expected.chat) conflicts.push({ scope: 'local', revision: 'chat', expected: expected.chat, current: binding.revision })
      }
      if (current.global !== undefined && current.global.revision !== expected.global) conflicts.push({ scope: 'global', revision: 'global', expected: expected.global, current: current.global.revision })
      if (current.message !== undefined && current.message.revision !== expected.message) conflicts.push({ scope: 'message', revision: 'message', expected: expected.message, current: current.message.revision })
      if (conflicts.length > 0) {
        const error = new Error(`template state changed before commit: ${conflicts.map(item => `${item.scope} ${item.expected} -> ${item.current}`).join(', ')}`)
        error.code = 'template-state-conflict'
        error.details = { conflicts }
        throw error
      }

      const next = {}
      if (current.local !== undefined) {
        next.local = snapshot(current.local)
        const binding = snapshot(next.local.sessions[session.agentId])
        binding.variables = snapshot(result.scopes.local)
        binding.revision += 1
        next.local.sessions[session.agentId] = binding
        assertJsonBytes(next.local, 16 * 1024 * 1024, 'template bindings commit')
      }
      if (current.global !== undefined) {
        next.global = {
          ...snapshot(current.global),
          revision: current.global.revision + 1,
          variables: snapshot(result.scopes.global),
          updatedAt: new Date().toISOString(),
        }
        assertSafeOwnedJson(next.global, 16 * 1024 * 1024, 'template global commit')
      }
      let messageTarget = null
      if (current.message !== undefined) {
        const entries = current.message.chat.entries
        if (entries.length === 0) throw new RangeError('template message scope has no target message')
        const messageMutations = result.mutations.filter(mutation => mutation.scope === 'message')
        const resolveMessageId = value => {
          if (value === undefined) return entries.length - 1
          if (!Number.isSafeInteger(value)) throw new TypeError('template messageId must be a safe integer')
          const id = value < 0 ? entries.length + value : value
          if (id < 0 || id >= entries.length) throw new RangeError(`template messageId ${value} is outside the chat`)
          return id
        }
        const messageIds = [...new Set(messageMutations.map(mutation => resolveMessageId(mutation.messageId)))]
        if (messageIds.length !== 1) throw new Error('one template result cannot replace more than one message scope')
        const messageId = messageIds[0]
        const entry = entries[messageId]
        const resolveSwipeId = value => {
          if (value === undefined) return entry.swipe_id
          if (!Number.isSafeInteger(value)) throw new TypeError('template swipeId must be a safe integer')
          if (value < 0 || value >= entry.swipes.length) throw new RangeError(`template swipeId ${value} is outside message ${messageId}`)
          return value
        }
        const swipeIds = [...new Set(messageMutations.map(mutation => resolveSwipeId(mutation.swipeId)))]
        if (swipeIds.length !== 1) throw new Error('one template result cannot replace more than one message swipe scope')
        const swipeId = swipeIds[0]
        const swipesData = snapshot(entry.swipes_data)
        swipesData[swipeId] = snapshot(result.scopes.message)
        const chat = setChatMessages(current.message.chat, [{ message_id: messageId, swipes_data: swipesData }])
        next.message = {
          ...snapshot(current.message),
          revision: current.message.revision + 1,
          chat: inspectCompatChat(chat),
          updatedAt: new Date().toISOString(),
        }
        assertSafeOwnedJson(next.message, 20 * 1024 * 1024, 'template message commit')
        messageTarget = { messageId, swipeId }
      }

      const documents = orderedScopes.map(scope => ({ scope, path: paths[scope], before: current[scope], after: next[scope], existed: existed[scope] }))
        .sort((left, right) => left.path.localeCompare(right.path))
      const written = []
      try {
        for (const document of documents) {
          await atomicJson(document.path, document.after, () => {
            signal?.throwIfAborted()
            this.assertAgentActive(agent, session)
          })
          written.push(document)
        }
      } catch (error) {
        const rollbackFailures = []
        for (const document of written.reverse()) {
          try {
            if (document.existed) await atomicJson(document.path, document.before)
            else await rm(document.path, { force: true })
          } catch (rollbackError) {
            rollbackFailures.push({ scope: document.scope, message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) })
          }
        }
        if (rollbackFailures.length > 0) {
          const wrapped = new Error(`template state commit failed and rollback was incomplete: ${error instanceof Error ? error.message : String(error)}`)
          wrapped.code = 'template-state-rollback-failed'
          wrapped.cause = error
          wrapped.details = { rollbackFailures }
          throw wrapped
        }
        if (error && typeof error === 'object') error.templateCommit = { rolledBack: true }
        throw error
      }

      if (next.local !== undefined) {
        state.bindings = next.local
        session.binding = snapshot(next.local.sessions[session.agentId])
        await this.recordBindingSnapshot(agent, session.binding, signal)
      }
      if (next.global !== undefined) {
        state.globalRegexScripts = next.global.global
        state.presetRegexScripts = next.global.preset
        state.globalVariables = next.global.variables
        state.regexRevision = next.global.revision
        state.compatibility.variables.global = snapshot(next.global.variables)
      }
      if (next.message !== undefined) session.compatChat = next.message
      return {
        committed: true,
        scopes: orderedScopes,
        revisions: {
          chat: Number(session.binding.revision ?? 0),
          global: Number(state.regexRevision ?? 0),
          workspace: Number(state.compatibility.revision ?? 0),
          message: Number(session.compatChat.revision ?? 0),
        },
        message: messageTarget,
      }
    }, signal))
  }

  async consumeOnceInjections(agent, ids, expectedRevision, signal) {
    if (!Array.isArray(ids)) throw new TypeError('once injection ids must be an array')
    const requested = new Set(ids.map(String))
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    if (session.binding === null) throw new Error('current session has no selected character')
    const removedIds = session.binding.scriptInjections
      .filter(item => item.once === true && requested.has(item.id))
      .map(item => item.id)
    const view = await this.updateSession(agent, {
      expectedRevision,
      scriptInjections: session.binding.scriptInjections.filter(item => !removedIds.includes(item.id)),
    }, signal)
    return { removedIds, session: view }
  }

  effectiveWorldbook(state, binding, card) {
    if (binding === null || card === undefined) return null
    const id = binding.startedAt === null && binding.worldbookExplicit !== true ? card.defaultWorldbookId : binding.worldbookId
    return id === null ? null : state.worldbooks.get(id) ?? null
  }

  compatibilityPromptWorldbook(state, binding, card) {
    const selected = this.effectiveWorldbook(state, binding, card)
    const character = state.compatibility.characterWorldbooks[String(binding?.cardId ?? '')] ?? { primary: null, additional: [] }
    const names = [
      ...state.compatibility.globalWorldbooks,
      character.primary,
      ...character.additional,
    ].filter(value => typeof value === 'string' && value !== '')
    const records = []
    const seen = new Set()
    for (const name of names) {
      const record = this.exactWorldbookByName(state, name)
      if (record !== undefined && !seen.has(record.id)) { seen.add(record.id); records.push(record) }
    }
    if (selected !== null && !seen.has(selected.id)) records.push(selected)
    if (records.length === 0) return null
    if (records.length === 1) return records[0]
    return {
      schemaVersion: 2,
      id: 'dsh-sillytavern-combined-worldbooks',
      revision: Math.max(...records.map(record => Number(record.revision ?? 0))),
      name: records.map(record => record.name).join(' + '),
      book: {
        name: records.map(record => record.name).join(' + '),
        entries: records.flatMap(record => (record.book.entries ?? []).map((entry, index) => ({
          ...snapshot(entry),
          id: `${record.id}:${String(entry.id ?? entry.uid ?? index)}`,
        }))),
        extensions: { dsh_sillytavern_sources: records.map(record => ({ id: record.id, name: record.name, revision: record.revision })) },
      },
      createdAt: records[0].createdAt,
      updatedAt: records.map(record => record.updatedAt).sort().at(-1),
    }
  }

  async event(agent, operation, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    return this.serial(`event:${session.workspace}:${session.agentId}`, () => withFileLock(session.eventPath, async () => {
      const current = normalizeEventDocument(await readJson(session.eventPath, emptyEventDocument(session.agentId), 20 * 1024 * 1024), session.agentId)
      if (Object.hasOwn(operation, 'expectedRevision')) {
        if (!Number.isSafeInteger(operation.expectedRevision) || operation.expectedRevision < 0) throw new Error('event expectedRevision must be a non-negative safe integer')
        if (current.revision !== operation.expectedRevision) {
          const error = new Error(`event revision changed from ${operation.expectedRevision} to ${current.revision}`)
          error.code = 'event-revision-conflict'
          throw error
        }
      }
      const applied = applyEventOperation(current, operation)
      if (applied.changed) {
        assertMemoryKeywordsInSource(applied.document, sessionEvents(agent.session))
        await atomicJson(session.eventPath, applied.document, () => this.assertAgentActive(agent, session))
      }
      session.event = applied.document
      return { result: applied.result, revision: session.event.revision, rows: operation.action === 'query' ? applied.result : undefined }
    }, signal), signal)
  }

  async eventSnapshot(agent, signal) {
    const session = this.sessionSync(agent) ?? await this.ensureSession(agent, signal)
    return this.serial(`event:${session.workspace}:${session.agentId}`, () => withFileLock(session.eventPath, async () => {
      const current = normalizeEventDocument(await readJson(session.eventPath, emptyEventDocument(session.agentId), 20 * 1024 * 1024), session.agentId)
      this.assertAgentActive(agent, session)
      session.event = current
      return snapshot(current)
    }, signal), signal)
  }

  async eventGraph(agent, request, signal) {
    const document = await this.eventSnapshot(agent, signal)
    return { result: queryEventGraph(document, request), revision: document.revision }
  }

  disposeSession(agent) {
    this.disposedAgents.add(agent)
    const key = this.sessionKey(agent)
    this.sessionEpoch.set(key, (this.sessionEpoch.get(key) ?? 0) + 1)
    this.sessions.delete(key)
    this.sessionLoads.delete(key)
  }

  sessionView(agent) {
    const session = this.sessionSync(agent)
    if (session === undefined) return { sessionId: agent.id, ready: false, binding: null, card: null, worldbook: null, worldbookId: null, fork: null, event: emptyEventDocument(agent.id), templates: [], globalRegexScripts: [], presetRegexScripts: [], globalVariables: {}, compatibilityVariables: { revisions: { chat: 0, global: 0, workspace: 0 }, scopes: { chat: {}, global: {}, preset: {}, character: {}, message: {}, script: {}, extension: {} } } }
    const card = session.binding === null ? null : session.state.cards.get(session.binding.cardId) ?? null
    const worldbook = card === null ? null : this.effectiveWorldbook(session.state, session.binding, card)
    return {
      sessionId: agent.id,
      ready: true,
      workspace: session.workspace,
      binding: session.binding === null ? null : snapshot(session.binding),
      card: card === null ? null : snapshot(card),
      worldbook: worldbook === null ? null : snapshot(worldbook),
      worldbookId: worldbook?.id ?? null,
      fork: this.forkView(agent, session),
      event: snapshot(session.event),
      templates: snapshot(session.state.templates),
      globalRegexScripts: snapshot(session.state.globalRegexScripts),
      presetRegexScripts: snapshot(session.state.presetRegexScripts),
      regexRevision: Number(session.state.regexRevision ?? 0),
      globalVariables: snapshot(session.state.globalVariables),
      compatibilityVariables: this.compatibilityVariableSnapshot(agent),
      compatibilityVariableMaps: snapshot(session.state.compatibility.variables),
      extensionSettings: snapshot(session.state.compatibility.extensionSettings),
      globalWorldbooks: snapshot(session.state.compatibility.globalWorldbooks),
      characterWorldbooks: snapshot(session.state.compatibility.characterWorldbooks),
      lorebookSettings: snapshot(session.state.compatibility.lorebookSettings),
      worldbookNames: this.getWorldbookNames(session.workspace),
      compatChat: this.compatChatProjection(agent),
    }
  }

  promptState(agent) {
    const session = this.sessionSync(agent)
    if (session === undefined || session.binding === null) return undefined
    const record = session.state.cards.get(session.binding.cardId)
    if (record === undefined) return undefined
    const selected = session.binding.templateIds.length === 0
      ? session.state.templates.filter(template => template.enabled !== false)
      : session.state.templates.filter(template => session.binding.templateIds.includes(template.id) && template.enabled !== false)
    return { record, binding: session.binding, worldbook: this.compatibilityPromptWorldbook(session.state, session.binding, record), event: session.event, templates: selected, globalRegexScripts: session.state.globalRegexScripts, presetRegexScripts: session.state.presetRegexScripts, globalVariables: session.state.globalVariables, compatMessages: this.compatChatProjection(agent).messages, compatibilityVariables: this.compatibilityVariableSnapshot(agent), lorebookSettings: session.state.compatibility.lorebookSettings }
  }

  regexEntries(agent) {
    const state = this.promptState(agent)
    if (state === undefined) return []
    return [
      ...state.globalRegexScripts.map((script, index) => ({ scope: 'global', index, script })),
      ...state.presetRegexScripts.map((script, index) => ({ scope: 'preset', index, script })),
      ...state.record.scripts.flatMap((script, index) => script.kind === 'regex' ? [{ scope: 'scoped', index, script }] : []),
    ]
  }

  findRegex(agent, name) {
    const target = String(name).trim()
    return this.regexEntries(agent).find(entry => String(entry.script.name).localeCompare(target, undefined, { sensitivity: 'base' }) === 0)
  }

  async toggleRegex(agent, name, requested, signal) {
    const entry = this.findRegex(agent, name)
    if (entry === undefined) throw new Error(`Regex script "${String(name)}" was not found`)
    const enabled = requested === undefined ? entry.script.enabled !== true : requested === true
    const script = { ...entry.script, enabled, approvedHash: enabled ? scriptHash('regex', entry.script.source, entry.script) : null }
    if (entry.scope === 'scoped') {
      const state = this.promptState(agent)
      await this.updateCard(state.record.id, { scripts: state.record.scripts.map((item, index) => index === entry.index ? script : item) }, signal, agent)
    } else {
      const state = this.promptState(agent)
      const scripts = (entry.scope === 'global' ? state.globalRegexScripts : state.presetRegexScripts).map((item, index) => index === entry.index ? script : item)
      await this.saveRegexSources({ [entry.scope]: scripts }, signal, agent)
    }
    return { name: entry.script.name, enabled, scope: entry.scope }
  }

  async greetingState(agent, signal) {
    const session = await this.ensureSession(agent, signal)
    const binding = session.binding ?? (session.state.selectedCardId === null ? null : defaultBinding(session.state.selectedCardId))
    if (binding === null) return undefined
    const record = session.state.cards.get(binding.cardId)
    if (record === undefined) return undefined
    return { record, binding, worldbook: this.effectiveWorldbook(session.state, binding, record), event: session.event, templates: [], globalRegexScripts: session.state.globalRegexScripts, presetRegexScripts: session.state.presetRegexScripts, globalVariables: session.state.globalVariables }
  }

  async saveTemplate(template, signal, context) {
    if (signal !== undefined && !isAbortSignal(signal)) { context = signal; signal = undefined }
    context ??= template?.context ?? template?.workspace
    const state = await this.stateFor(context)
    const id = String(template.id ?? randomUUID())
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new Error('template id has an unsafe shape')
    const content = String(template.content ?? '')
    const name = String(template.name ?? 'Prompt Template')
    if (Buffer.byteLength(content, 'utf8') > 256 * 1024) throw new Error('template content exceeds 262144 bytes')
    if (Buffer.byteLength(name, 'utf8') > 1024) throw new Error('template name exceeds 1024 bytes')
    const normalized = { id, name, content, position: ['before', 'after', 'post-history'].includes(template.position) ? template.position : 'after', order: Number.isFinite(Number(template.order)) ? Number(template.order) : 0, enabled: template.enabled !== false }
    const path = join(state.root, 'templates.json')
    return this.serial(`templates:${state.root}`, () => withFileLock(path, async () => {
      const document = await readJson(path, { schemaVersion: 1, templates: [] }, 4 * 1024 * 1024)
      const next = document?.schemaVersion === 1 && Array.isArray(document.templates) ? snapshot(document.templates) : []
      const index = next.findIndex(item => item.id === id)
      if (index === -1 && next.length >= 32) throw new Error('template library exceeds 32 templates')
      if (index === -1) next.push(normalized)
      else next[index] = normalized
      next.sort((left, right) => left.order - right.order)
      const nextDocument = { schemaVersion: 1, templates: next }
      assertJsonBytes(nextDocument, 4 * 1024 * 1024, 'template library')
      await atomicJson(path, nextDocument, () => signal?.throwIfAborted())
      state.templates = next
      return snapshot(normalized)
    }, signal), signal)
  }

  async deleteTemplate(id, signal, context) {
    if (signal !== undefined && !isAbortSignal(signal)) { context = signal; signal = undefined }
    const state = await this.stateFor(context)
    const path = join(state.root, 'templates.json')
    return this.serial(`templates:${state.root}`, () => withFileLock(path, async () => {
      const document = await readJson(path, { schemaVersion: 1, templates: [] }, 4 * 1024 * 1024)
      const next = document?.schemaVersion === 1 && Array.isArray(document.templates) ? snapshot(document.templates) : []
      const index = next.findIndex(item => item.id === String(id))
      if (index !== -1) next.splice(index, 1)
      await atomicJson(path, { schemaVersion: 1, templates: next }, () => signal?.throwIfAborted())
      state.templates = next
      return index !== -1
    }, signal), signal)
  }
}
