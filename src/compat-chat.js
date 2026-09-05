const CHAT_SCHEMA_VERSION = 1
const ALL_ROLES = new Set(['system', 'assistant', 'user'])
const ALL_ROLE_FILTERS = new Set(['all', ...ALL_ROLES])
const ALL_HIDE_FILTERS = new Set(['all', 'hidden', 'unhidden'])

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function freeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freeze(child, seen)
  return Object.freeze(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`)
}

function assertRole(value, label = 'role') {
  if (!ALL_ROLES.has(value)) throw new TypeError(`${label} must be system, assistant, or user`)
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`)
}

function defaultName(role) {
  if (role === 'user') return 'User'
  if (role === 'system') return 'System'
  return 'Character'
}

function textFromNative(message) {
  for (const value of [message.message, message.mes, message.text]) if (typeof value === 'string') return value
  const content = message.data?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('')
  throw new TypeError('native message text must be a string')
}

function normalizeRecordArray(value, length, label, fallback) {
  if (value === undefined) return Array.from({ length }, (_, index) => clone(fallback?.[index] ?? {}))
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${label} must contain exactly one object for each swipe`)
  return value.map((item, index) => {
    assertRecord(item, `${label}[${index}]`)
    return clone(item)
  })
}

function normalizeSwipes(value, fallbackText, label = 'swipes') {
  if (value === undefined) return [String(fallbackText)]
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty string array`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new TypeError(`${label}[${index}] must be a string`)
    return item
  })
}

function normalizeNativeMessage(message) {
  assertRecord(message, 'native message')
  const sourceSeq = message.sourceSeq ?? message.seq
  assertSafeInteger(sourceSeq, 'native message sourceSeq')
  if (sourceSeq < 0) throw new RangeError('native message sourceSeq must be non-negative')
  const role = message.role
  assertRole(role, 'native message role')
  const text = textFromNative(message)
  const swipes = normalizeSwipes(message.swipes, text, 'native message swipes')
  const swipeId = message.swipe_id ?? 0
  assertSafeInteger(swipeId, 'native message swipe_id')
  if (swipeId < 0 || swipeId >= swipes.length) throw new RangeError('native message swipe_id is outside the available swipes')
  const fallbackData = swipes.map(() => ({}))
  fallbackData[swipeId] = clone(message.data ?? {})
  const fallbackInfo = swipes.map(() => ({}))
  fallbackInfo[swipeId] = clone(message.extra ?? {})
  if (message.data !== undefined) assertRecord(message.data, 'native message data')
  if (message.extra !== undefined) assertRecord(message.extra, 'native message extra')
  if (message.is_hidden !== undefined) assertBoolean(message.is_hidden, 'native message is_hidden')
  return {
    message_id: -1,
    uid: `native:${sourceSeq}`,
    sourceSeq,
    origin: 'native',
    name: String(message.name ?? defaultName(role)),
    role,
    is_hidden: message.is_hidden ?? false,
    swipe_id: swipeId,
    swipes,
    swipes_data: normalizeRecordArray(message.swipes_data, swipes.length, 'native message swipes_data', fallbackData),
    swipes_info: normalizeRecordArray(message.swipes_info, swipes.length, 'native message swipes_info', fallbackInfo),
  }
}

function normalizeCreatedMessage(message, uid) {
  assertRecord(message, 'chat message')
  assertRole(message.role, 'chat message role')
  if (typeof message.message !== 'string') throw new TypeError('chat message message must be a string')
  if (message.is_hidden !== undefined) assertBoolean(message.is_hidden, 'chat message is_hidden')
  if (message.data !== undefined) assertRecord(message.data, 'chat message data')
  if (message.extra !== undefined) assertRecord(message.extra, 'chat message extra')
  return {
    message_id: -1,
    uid,
    sourceSeq: null,
    origin: 'compat',
    name: String(message.name ?? defaultName(message.role)),
    role: message.role,
    is_hidden: message.is_hidden ?? false,
    swipe_id: 0,
    swipes: [message.message],
    swipes_data: [clone(message.data ?? {})],
    swipes_info: [clone(message.extra ?? {})],
  }
}

function reindex(entries) {
  for (let index = 0; index < entries.length; index += 1) entries[index].message_id = index
  return entries
}

function assertEntry(entry, index) {
  assertRecord(entry, `state.entries[${index}]`)
  if (entry.message_id !== index) throw new TypeError('compat chat message_id values must match array order')
  if (typeof entry.uid !== 'string' || entry.uid === '') throw new TypeError('compat chat uid must be a non-empty string')
  if (entry.sourceSeq !== null && (!Number.isSafeInteger(entry.sourceSeq) || entry.sourceSeq < 0)) throw new TypeError('compat chat sourceSeq must be null or a non-negative safe integer')
  if (entry.origin !== 'native' && entry.origin !== 'compat') throw new TypeError('compat chat origin must be native or compat')
  assertRole(entry.role)
  assertBoolean(entry.is_hidden, 'is_hidden')
  if (typeof entry.name !== 'string') throw new TypeError('name must be a string')
  const swipes = normalizeSwipes(entry.swipes, '', 'swipes')
  normalizeRecordArray(entry.swipes_data, swipes.length, 'swipes_data')
  normalizeRecordArray(entry.swipes_info, swipes.length, 'swipes_info')
  assertSafeInteger(entry.swipe_id, 'swipe_id')
  if (entry.swipe_id < 0 || entry.swipe_id >= swipes.length) throw new RangeError('swipe_id is outside the available swipes')
}

function assertState(state) {
  assertRecord(state, 'compat chat state')
  if (state.schemaVersion !== CHAT_SCHEMA_VERSION) throw new TypeError(`unsupported compat chat schema ${state.schemaVersion}`)
  if (!Array.isArray(state.entries)) throw new TypeError('compat chat entries must be an array')
  if (!Array.isArray(state.seenSourceSeqs)) throw new TypeError('compat chat seenSourceSeqs must be an array')
  if (!Number.isSafeInteger(state.nativeCursor) || state.nativeCursor < -1) throw new TypeError('compat chat nativeCursor must be a safe integer >= -1')
  if (!Number.isSafeInteger(state.nextSyntheticUid) || state.nextSyntheticUid < 1) throw new TypeError('compat chat nextSyntheticUid must be a positive safe integer')
  const uids = new Set()
  for (let index = 0; index < state.entries.length; index += 1) {
    assertEntry(state.entries[index], index)
    if (uids.has(state.entries[index].uid)) throw new TypeError(`duplicate compat chat uid ${state.entries[index].uid}`)
    uids.add(state.entries[index].uid)
  }
  const seen = new Set()
  for (const seq of state.seenSourceSeqs) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seen.has(seq)) throw new TypeError('seenSourceSeqs must contain unique non-negative safe integers')
    seen.add(seq)
  }
  if (state.seenSourceSeqs.some(seq => seq > state.nativeCursor)) throw new TypeError('seenSourceSeqs cannot exceed nativeCursor')
  for (const entry of state.entries) {
    if (entry.origin === 'native' && (!seen.has(entry.sourceSeq) || entry.uid !== `native:${entry.sourceSeq}`)) throw new TypeError('native entries must retain their source identity')
    if (entry.origin === 'compat' && (entry.sourceSeq !== null || !/^compat:\d+$/.test(entry.uid))) throw new TypeError('compat entries must retain their synthetic identity')
  }
  const greatestSyntheticUid = state.entries.reduce((greatest, entry) => entry.origin === 'compat' ? Math.max(greatest, Number(entry.uid.slice(7))) : greatest, 0)
  if (state.nextSyntheticUid <= greatestSyntheticUid) throw new TypeError('nextSyntheticUid must exceed every allocated synthetic uid')
  return state
}

function mutableState(state) {
  assertState(state)
  return clone(state)
}

function finish(state) {
  reindex(state.entries)
  assertState(state)
  return freeze(state)
}

export function createCompatChat(nativeMessages = []) {
  if (!Array.isArray(nativeMessages)) throw new TypeError('nativeMessages must be an array')
  const empty = freeze({ schemaVersion: CHAT_SCHEMA_VERSION, nativeCursor: -1, nextSyntheticUid: 1, seenSourceSeqs: [], entries: [] })
  return mergeNativeMessages(empty, nativeMessages)
}

export function mergeNativeMessages(state, nativeMessages) {
  if (!Array.isArray(nativeMessages)) throw new TypeError('nativeMessages must be an array')
  const next = mutableState(state)
  const batch = nativeMessages.map(normalizeNativeMessage).sort((left, right) => left.sourceSeq - right.sourceSeq)
  const batchSeqs = new Set()
  for (const message of batch) {
    if (batchSeqs.has(message.sourceSeq)) throw new TypeError(`duplicate native sourceSeq ${message.sourceSeq}`)
    batchSeqs.add(message.sourceSeq)
  }
  const seen = new Set(next.seenSourceSeqs)
  for (const message of batch) {
    if (seen.has(message.sourceSeq)) continue
    if (message.sourceSeq <= next.nativeCursor) throw new RangeError(`native sourceSeq ${message.sourceSeq} arrived behind cursor ${next.nativeCursor}`)
    next.entries.push(message)
    next.seenSourceSeqs.push(message.sourceSeq)
    seen.add(message.sourceSeq)
    next.nativeCursor = message.sourceSeq
  }
  next.seenSourceSeqs.sort((left, right) => left - right)
  return finish(next)
}

function resolveQueryIndex(value, length) {
  return value < 0 ? length + value : value
}

function queryIds(range, length) {
  if (range === undefined) range = '0-{{lastMessageId}}'
  if (typeof range === 'number') {
    assertSafeInteger(range, 'message range')
    if (length === 0) return []
    const id = resolveQueryIndex(range, length)
    return id >= 0 && id < length ? [id] : []
  }
  if (typeof range !== 'string') throw new TypeError('message range must be a number or string')
  const expanded = range.trim().replaceAll('{{lastMessageId}}', String(length - 1))
  if (/^-?\d+$/.test(expanded)) return length === 0 ? [] : queryIds(Number(expanded), length)
  const match = expanded.match(/^(-?\d+)\s*-\s*(-?\d+)$/)
  if (!match) throw new TypeError(`invalid message range ${range}`)
  if (length === 0 && range.includes('{{lastMessageId}}')) return []
  const begin = resolveQueryIndex(Number(match[1]), length)
  const end = resolveQueryIndex(Number(match[2]), length)
  if (begin > end) throw new RangeError('message range start must not exceed its end')
  const ids = []
  for (let id = Math.max(0, begin); id <= Math.min(length - 1, end); id += 1) ids.push(id)
  return ids
}

function projectMessage(entry, includeSwipes) {
  const common = {
    message_id: entry.message_id,
    name: entry.name,
    role: entry.role,
    is_hidden: entry.is_hidden,
  }
  if (includeSwipes) return {
    ...common,
    swipe_id: entry.swipe_id,
    swipes: clone(entry.swipes),
    swipes_data: clone(entry.swipes_data),
    swipes_info: clone(entry.swipes_info),
  }
  return {
    ...common,
    message: entry.swipes[entry.swipe_id],
    data: clone(entry.swipes_data[entry.swipe_id]),
    extra: clone(entry.swipes_info[entry.swipe_id]),
  }
}

export function getChatMessages(state, range = '0-{{lastMessageId}}', options = {}) {
  assertState(state)
  assertRecord(options, 'getChatMessages options')
  const role = options.role ?? 'all'
  const hideState = options.hide_state ?? 'all'
  if (!ALL_ROLE_FILTERS.has(role)) throw new TypeError('role filter must be all, system, assistant, or user')
  if (!ALL_HIDE_FILTERS.has(hideState)) throw new TypeError('hide_state filter must be all, hidden, or unhidden')
  if (options.include_swipes !== undefined) assertBoolean(options.include_swipes, 'include_swipes')
  return queryIds(range, state.entries.length)
    .map(id => state.entries[id])
    .filter(entry => role === 'all' || entry.role === role)
    .filter(entry => hideState === 'all' || (hideState === 'hidden') === entry.is_hidden)
    .map(entry => projectMessage(entry, options.include_swipes === true))
}

function resizeRecords(records, length) {
  return Array.from({ length }, (_, index) => clone(records[index] ?? {}))
}

function applySet(entry, update, updateIndex) {
  assertRecord(update, `chat message update[${updateIndex}]`)
  if (update.name !== undefined) entry.name = String(update.name)
  if (update.role !== undefined) { assertRole(update.role, 'chat message role'); entry.role = update.role }
  if (update.is_hidden !== undefined) { assertBoolean(update.is_hidden, 'chat message is_hidden'); entry.is_hidden = update.is_hidden }
  const hasSwipeUpdate = ['swipe_id', 'swipes', 'swipes_data', 'swipes_info'].some(key => Object.hasOwn(update, key))
  if (hasSwipeUpdate) {
    if (update.swipes !== undefined && !Array.isArray(update.swipes)) throw new TypeError('chat message swipes must be an array')
    if (update.swipes_data !== undefined && !Array.isArray(update.swipes_data)) throw new TypeError('chat message swipes_data must be an array')
    if (update.swipes_info !== undefined && !Array.isArray(update.swipes_info)) throw new TypeError('chat message swipes_info must be an array')
    const length = Math.max(1, update.swipes?.length ?? 0, update.swipes_data?.length ?? 0, update.swipes_info?.length ?? 0, entry.swipes.length)
    entry.swipes = Array.from({ length }, (_, index) => {
      const value = update.swipes?.[index] ?? entry.swipes[index] ?? ''
      if (typeof value !== 'string') throw new TypeError(`chat message swipes[${index}] must be a string`)
      return value
    })
    entry.swipes_data = Array.from({ length }, (_, index) => {
      const value = update.swipes_data?.[index] ?? entry.swipes_data[index] ?? {}
      assertRecord(value, `chat message swipes_data[${index}]`)
      return clone(value)
    })
    entry.swipes_info = Array.from({ length }, (_, index) => {
      const value = update.swipes_info?.[index] ?? entry.swipes_info[index] ?? {}
      assertRecord(value, `chat message swipes_info[${index}]`)
      return clone(value)
    })
    if (update.swipe_id !== undefined) assertSafeInteger(update.swipe_id, 'chat message swipe_id')
    entry.swipe_id = Math.max(0, Math.min(length - 1, update.swipe_id ?? entry.swipe_id))
  }
  if (update.message !== undefined) {
    if (typeof update.message !== 'string') throw new TypeError('chat message message must be a string')
    entry.swipes[entry.swipe_id] = update.message
  }
  if (update.data !== undefined) {
    assertRecord(update.data, 'chat message data')
    entry.swipes_data[entry.swipe_id] = clone(update.data)
  }
  if (update.extra !== undefined) {
    assertRecord(update.extra, 'chat message extra')
    entry.swipes_info[entry.swipe_id] = clone(update.extra)
  }
}

export function setChatMessages(state, updates) {
  if (!Array.isArray(updates)) throw new TypeError('chat message updates must be an array')
  const next = mutableState(state)
  const merged = new Map()
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index]
    assertRecord(update, `chat message update[${index}]`)
    assertSafeInteger(update.message_id, `chat message update[${index}].message_id`)
    const messageId = update.message_id < 0 ? next.entries.length + update.message_id : update.message_id
    if (messageId < 0 || messageId >= next.entries.length) continue
    merged.set(messageId, { ...(merged.get(messageId) ?? {}), ...clone(update), message_id: messageId })
  }
  for (const [messageId, update] of [...merged].sort(([left], [right]) => left - right)) applySet(next.entries[messageId], update, messageId)
  return finish(next)
}

function insertIndex(value, length) {
  if (value === undefined || value === 'end') return length
  assertSafeInteger(value, 'insert_before')
  const clamped = Math.max(-length, Math.min(length, value))
  return clamped < 0 ? length + clamped : clamped
}

export function createChatMessages(state, messages, options = {}) {
  if (!Array.isArray(messages)) throw new TypeError('chat messages must be an array')
  assertRecord(options, 'createChatMessages options')
  const next = mutableState(state)
  const at = insertIndex(options.insert_before ?? options.insert_at, next.entries.length)
  const created = messages.map(message => {
    const uid = `compat:${next.nextSyntheticUid++}`
    return normalizeCreatedMessage(message, uid)
  })
  next.entries.splice(at, 0, ...created)
  return finish(next)
}

function resolveMutationIndex(value, length, label) {
  assertSafeInteger(value, label)
  const id = value < 0 ? length + value : value
  if (id < 0 || id >= length) throw new RangeError(`${label} ${value} is outside the chat`)
  return id
}

export function deleteChatMessages(state, messageIds) {
  if (!Array.isArray(messageIds)) throw new TypeError('messageIds must be an array')
  const next = mutableState(state)
  const ids = new Set(messageIds.flatMap((value, index) => {
    assertSafeInteger(value, `messageIds[${index}]`)
    const id = value < 0 ? next.entries.length + value : value
    return id >= 0 && id < next.entries.length ? [id] : []
  }))
  next.entries = next.entries.filter((_, index) => !ids.has(index))
  return finish(next)
}

export function rotateChatMessages(state, begin, middle, end) {
  const next = mutableState(state)
  for (const [value, label] of [[begin, 'begin'], [middle, 'middle'], [end, 'end']]) assertSafeInteger(value, label)
  const normalize = value => Math.max(0, Math.min(next.entries.length, value < 0 ? next.entries.length + value : value))
  begin = normalize(begin)
  end = normalize(end)
  middle = Math.max(begin, Math.min(end, normalize(middle)))
  const rotated = [...next.entries.slice(middle, end), ...next.entries.slice(begin, middle)]
  next.entries.splice(begin, end - begin, ...rotated)
  return finish(next)
}

export function switchSwipe(state, messageId, swipeId) {
  const next = mutableState(state)
  const id = resolveMutationIndex(messageId, next.entries.length, 'messageId')
  assertSafeInteger(swipeId, 'swipeId')
  if (swipeId < 0 || swipeId >= next.entries[id].swipes.length) throw new RangeError(`swipeId ${swipeId} is outside the available swipes`)
  next.entries[id].swipe_id = swipeId
  return finish(next)
}

export function inspectCompatChat(state) {
  assertState(state)
  return clone(state)
}

export { CHAT_SCHEMA_VERSION }
