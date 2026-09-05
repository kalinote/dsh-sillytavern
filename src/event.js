import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

const SCHEMA_VERSION = 5
const MAX_ROWS = 10_000
const MAX_EVENT_EDGES = 20_000
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
const MAX_VALUE_BYTES = 256 * 1024
const MAX_NAME_BYTES = 1024
const MIN_KEYWORDS = 2
const MAX_KEYWORDS = 10
const GENERIC_KEYWORDS = new Set(['物品', '事件', '关系', '状态变化'])
const MAX_APPLIED_MAINTENANCE_JOBS = 512
const DEFAULT_IMPORTANCE_THRESHOLD = 0.8
const RECALL_POLICIES = new Set(['always', 'after_compaction', 'query_only'])

function now() { return Date.now() }
function snapshot(value) { return structuredClone(value) }
function bytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8') }

export function emptyEventDocument(sessionId) {
  return { schemaVersion: SCHEMA_VERSION, sessionId, revision: 0, rows: [], eventEdges: [], appliedMaintenanceJobs: [] }
}

function normalizedMaintenanceJobId(value) {
  if (typeof value !== 'string' || value.trim() === '' || Buffer.byteLength(value, 'utf8') > MAX_NAME_BYTES) {
    throw new Error('event maintenanceJobId must be a non-empty bounded string')
  }
  return value.trim()
}

function normalizedAppliedMaintenanceJobs(value) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_APPLIED_MAINTENANCE_JOBS) throw new Error('event appliedMaintenanceJobs is invalid')
  return [...new Set(value.map(normalizedMaintenanceJobId))].slice(-MAX_APPLIED_MAINTENANCE_JOBS)
}

function normalizedStoryTime(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('memory storyTime must be an object')
  if (value.state === 'unknown') return { state: 'unknown', label: null, timeline: null, start: null, end: null }
  if (value.state === 'label-only') {
    if (typeof value.label !== 'string' || value.label.trim() === '') throw new Error('label-only memory storyTime requires a non-empty label')
    if (value.start !== undefined && value.start !== null || value.end !== undefined && value.end !== null) throw new Error('label-only memory storyTime requires null start/end')
    if (value.timeline !== undefined && value.timeline !== null && typeof value.timeline !== 'string') throw new Error('memory storyTime timeline must be a string or null')
    return { state: 'label-only', label: value.label.trim(), timeline: typeof value.timeline === 'string' ? value.timeline.trim() : null, start: null, end: null }
  }
  if (value.state === 'normalized') {
    const timeline = typeof value.timeline === 'string' ? value.timeline.trim() : ''
    if (timeline === '' || !Number.isFinite(value.start)) {
      throw new Error('memory storyTime requires a non-empty timeline and finite numeric start (story time, not wall-clock time)')
    }
    const end = value.end ?? null
    if (end !== null && (!Number.isFinite(end) || end < value.start)) {
      throw new Error('memory storyTime end must be null or a finite number greater than or equal to start')
    }
    if (value.label !== undefined && value.label !== null && typeof value.label !== 'string') throw new Error('memory storyTime label must be a string or null')
    const label = typeof value.label === 'string' && value.label.trim() !== '' ? value.label.trim() : null
    return { state: 'normalized', label, timeline, start: value.start, end }
  }
  throw new Error('memory storyTime state must be normalized, label-only, or unknown')
}

// Read historical label-only/unknown rows without changing them, but require a
// known narrative start whenever a row is created or updated.
function writableStoryTime(value) {
  if (value?.state !== 'normalized') {
    throw new Error('memory storyTime.start is required for writes; provide normalized story time with a timeline and finite numeric start')
  }
  return normalizedStoryTime(value)
}

function normalizedLocation(value) {
  if (value === null) return null
  if (!Array.isArray(value) || value.length === 0 || value.some(segment => typeof segment !== 'string' || segment.trim() === '')) {
    throw new Error('memory location must be a non-empty array of location segments or null')
  }
  return value.map(segment => segment.trim())
}

function normalizedCharacters(value) {
  if (!Array.isArray(value) || value.some(character => typeof character !== 'string')) throw new Error('memory characters must be an array of strings')
  return [...new Set(value.map(character => character.trim()).filter(Boolean))]
}

function normalizedKeywords(value) {
  if (!Array.isArray(value) || value.some(keyword => typeof keyword !== 'string')) {
    throw new Error(`memory keywords must contain ${MIN_KEYWORDS} to ${MAX_KEYWORDS} strings`)
  }
  const keywords = [...new Set(value.map(keyword => keyword.trim()).filter(Boolean))]
  if (keywords.length < MIN_KEYWORDS || keywords.length > MAX_KEYWORDS) {
    throw new Error(`memory keywords must contain ${MIN_KEYWORDS} to ${MAX_KEYWORDS} unique non-empty strings; split memories with too many keywords into finer rows`)
  }
  if (keywords.some(keyword => Buffer.byteLength(keyword, 'utf8') > MAX_NAME_BYTES)) throw new Error('memory keyword exceeds the size limit')
  const generic = keywords.filter(keyword => GENERIC_KEYWORDS.has(keyword))
  if (generic.length > 0) {
    throw new Error(`memory keywords must be concrete source terms, not generic classifications: ${generic.map(keyword => JSON.stringify(keyword)).join(', ')}`)
  }
  return keywords
}

function normalizedEventId(value, label = 'memory eventId') {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function normalizedSourceRefs(value) {
  if (!Array.isArray(value)) throw new Error('memory sourceRefs must be an array')
  return value.map(ref => {
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref)
      || !Number.isSafeInteger(ref.eventSeq) || ref.eventSeq < 0
      || !Number.isSafeInteger(ref.turn) || ref.turn <= 0
      || ref.role !== 'user' && ref.role !== 'assistant') {
      throw new Error('memory sourceRefs entries require a non-negative eventSeq, positive turn, and user/assistant role')
    }
    return { eventSeq: ref.eventSeq, turn: ref.turn, role: ref.role }
  })
}

function normalizedRecallPolicy(value) {
  if (!RECALL_POLICIES.has(value)) throw new Error('memory recallPolicy must be always, after_compaction, or query_only')
  return value
}

function normalizedStoredRow(row) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.id.trim() === '' || typeof row.table !== 'string' || typeof row.key !== 'string') return false
  const table = row.table.trim()
  const key = row.key.trim()
  if (table === '' || key === '') return false
  if (row.value === null || typeof row.value !== 'object' || Array.isArray(row.value) || bytes(row.value) > MAX_VALUE_BYTES) return false
  if (Object.hasOwn(row, 'tags')) return false
  if (Buffer.byteLength(table, 'utf8') > MAX_NAME_BYTES || Buffer.byteLength(key, 'utf8') > MAX_NAME_BYTES) return false
  if (!Number.isFinite(row.importance) || row.importance < 0 || row.importance > 1) return false
  try {
    const normalized = {
      ...snapshot(row),
      table,
      key,
      keywords: normalizedKeywords(row.keywords),
      storyTime: normalizedStoryTime(row.storyTime),
      location: normalizedLocation(row.location),
      characters: normalizedCharacters(row.characters),
      sourceRefs: normalizedSourceRefs(row.sourceRefs),
      recallPolicy: normalizedRecallPolicy(row.recallPolicy),
    }
    if (Object.hasOwn(row, 'eventId')) normalized.eventId = normalizedEventId(row.eventId)
    return normalized
  } catch {
    return false
  }
}

function normalizedStoredEventEdge(edge) {
  if (!edge || typeof edge !== 'object' || typeof edge.id !== 'string' || edge.id.trim() === '' || edge.kind !== 'precedes') return false
  if (!Number.isSafeInteger(edge.createdAt) || edge.createdAt < 0 || !Number.isSafeInteger(edge.updatedAt) || edge.updatedAt < 0) return false
  if (edge.reason !== null && typeof edge.reason !== 'string') return false
  try {
    return {
      id: edge.id,
      kind: 'precedes',
      predecessorEventId: normalizedEventId(edge.predecessorEventId, 'event edge predecessorEventId'),
      successorEventId: normalizedEventId(edge.successorEventId, 'event edge successorEventId'),
      reason: edge.reason,
      sourceRefs: normalizedSourceRefs(edge.sourceRefs),
      createdAt: edge.createdAt,
      updatedAt: edge.updatedAt,
    }
  } catch {
    return false
  }
}

function assertEventGraph(document) {
  const eventIds = new Set(document.rows.flatMap(row => row.eventId === undefined ? [] : [row.eventId]))
  const triples = new Set()
  const outgoing = new Map([...eventIds].map(eventId => [eventId, []]))
  const indegree = new Map([...eventIds].map(eventId => [eventId, 0]))
  for (const edge of document.eventEdges) {
    if (edge.predecessorEventId === edge.successorEventId) throw new Error('event graph may not contain a self-edge')
    if (!eventIds.has(edge.predecessorEventId) || !eventIds.has(edge.successorEventId)) {
      throw new Error('event edge endpoints must exist in at least one memory row')
    }
    const triple = JSON.stringify([edge.kind, edge.predecessorEventId, edge.successorEventId])
    if (triples.has(triple)) throw new Error('event graph may not contain duplicate edge triples')
    triples.add(triple)
    outgoing.get(edge.predecessorEventId).push(edge.successorEventId)
    indegree.set(edge.successorEventId, indegree.get(edge.successorEventId) + 1)
  }
  const ready = [...eventIds].filter(eventId => indegree.get(eventId) === 0)
  let visited = 0
  for (let index = 0; index < ready.length; index += 1) {
    const eventId = ready[index]
    visited += 1
    for (const successor of outgoing.get(eventId)) {
      const remaining = indegree.get(successor) - 1
      indegree.set(successor, remaining)
      if (remaining === 0) ready.push(successor)
    }
  }
  if (visited !== eventIds.size) throw new Error('event precedes edges may not form a directed cycle')
}

function assertDocumentConstraints(document) {
  if (document.rows.length > MAX_ROWS) throw new Error(`memory rows exceed ${MAX_ROWS}`)
  if (document.eventEdges.length > MAX_EVENT_EDGES) throw new Error(`event edges exceed ${MAX_EVENT_EDGES}`)
  const rowIds = new Set()
  const rowKeys = new Set()
  for (const row of document.rows) {
    if (rowIds.has(row.id)) throw new Error('memory rows may not contain duplicate ids')
    rowIds.add(row.id)
    const identity = `${row.table}\0${row.key}`
    if (rowKeys.has(identity)) throw new Error('memory rows may not contain duplicate table/key pairs')
    rowKeys.add(identity)
  }
  assertEventGraph(document)
  if (bytes(document) > MAX_DOCUMENT_BYTES) throw new Error(`event document exceeds ${MAX_DOCUMENT_BYTES} bytes`)
}

export function normalizeEventDocument(input, sessionId) {
  if (input === null || typeof input !== 'object') return emptyEventDocument(sessionId)
  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`event schema version ${String(input.schemaVersion)} is unsupported; expected ${SCHEMA_VERSION}. Delete the existing event file manually`)
  }
  if (!Array.isArray(input.rows) || !Array.isArray(input.eventEdges)) return emptyEventDocument(sessionId)
  try {
    if (input.rows.length > MAX_ROWS || input.eventEdges.length > MAX_EVENT_EDGES) return emptyEventDocument(sessionId)
    const rows = input.rows.map(normalizedStoredRow)
    const eventEdges = input.eventEdges.map(normalizedStoredEventEdge)
    if (rows.some(row => row === false) || eventEdges.some(edge => edge === false)) return emptyEventDocument(sessionId)
    const document = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
      rows,
      eventEdges,
      appliedMaintenanceJobs: normalizedAppliedMaintenanceJobs(input.appliedMaintenanceJobs),
    }
    assertDocumentConstraints(document)
    return document
  } catch {
    return emptyEventDocument(sessionId)
  }
}

function normalizedRowIdentity(input, existing) {
  const table = String(input.table ?? existing?.table ?? 'default').trim()
  const key = String(input.key ?? existing?.key ?? '').trim()
  if (table === '' || key === '') throw new Error('memory table and key must be non-empty')
  if (Buffer.byteLength(table, 'utf8') > MAX_NAME_BYTES || Buffer.byteLength(key, 'utf8') > MAX_NAME_BYTES) throw new Error('memory table/key exceeds the size limit')
  return { table, key }
}

function normalizedRow(input, existing) {
  if (Object.hasOwn(input, 'tags')) throw new Error('memory tags is no longer supported; use keywords')
  const timestamp = now()
  const { table, key } = normalizedRowIdentity(input, existing)
  const value = input.value ?? existing?.value ?? {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('memory value must be an object')
  if (bytes(value) > MAX_VALUE_BYTES) throw new Error(`memory value exceeds ${MAX_VALUE_BYTES} bytes`)
  const importance = Number(input.importance ?? existing?.importance ?? 0.5)
  if (!Number.isFinite(importance) || importance < 0 || importance > 1) throw new Error('memory importance must be between 0 and 1')
  const keywords = Object.hasOwn(input, 'keywords')
    ? normalizedKeywords(input.keywords)
    : existing === undefined ? normalizedKeywords(undefined) : snapshot(existing.keywords)
  const readRequired = (name, normalize) => {
    if (Object.hasOwn(input, name)) return normalize(input[name])
    if (existing !== undefined) return snapshot(existing[name])
    throw new Error(`new memory rows require ${name}`)
  }
  const eventId = Object.hasOwn(input, 'eventId') ? normalizedEventId(input.eventId) : existing?.eventId
  const sourceRefs = Object.hasOwn(input, 'sourceRefs')
    ? normalizedSourceRefs(input.sourceRefs)
    : existing === undefined ? [] : snapshot(existing.sourceRefs)
  const recallPolicy = Object.hasOwn(input, 'recallPolicy')
    ? normalizedRecallPolicy(input.recallPolicy)
    : existing === undefined ? importance >= DEFAULT_IMPORTANCE_THRESHOLD ? 'always' : 'after_compaction' : existing.recallPolicy
  return {
    id: existing?.id ?? randomUUID(),
    table,
    key,
    value: snapshot(value),
    keywords,
    importance,
    storyTime: writableStoryTime(readRequired('storyTime', value => value)),
    location: readRequired('location', normalizedLocation),
    characters: readRequired('characters', normalizedCharacters),
    ...(eventId === undefined ? {} : { eventId }),
    sourceRefs,
    recallPolicy,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

function normalizedEventEdge(input, existing) {
  const timestamp = now()
  const kind = input.kind ?? existing?.kind ?? 'precedes'
  if (kind !== 'precedes') throw new Error('event edge kind must be precedes')
  const predecessorEventId = normalizedEventId(input.predecessorEventId ?? existing?.predecessorEventId, 'event edge predecessorEventId')
  const successorEventId = normalizedEventId(input.successorEventId ?? existing?.successorEventId, 'event edge successorEventId')
  const reason = Object.hasOwn(input, 'reason') ? input.reason : existing?.reason ?? null
  if (reason !== null && typeof reason !== 'string') throw new Error('event edge reason must be a string or null')
  const sourceRefs = Object.hasOwn(input, 'sourceRefs')
    ? normalizedSourceRefs(input.sourceRefs)
    : existing === undefined ? [] : snapshot(existing.sourceRefs)
  return {
    id: existing?.id ?? randomUUID(),
    kind,
    predecessorEventId,
    successorEventId,
    reason,
    sourceRefs,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

export function isMemoryAutoRecallEligible(row, compactedSeqs = new Set(), importanceThreshold = DEFAULT_IMPORTANCE_THRESHOLD) {
  if (row.recallPolicy === 'query_only') return false
  if (row.importance >= importanceThreshold || row.recallPolicy === 'always') return true
  if (row.recallPolicy !== 'after_compaction') return false
  if (!(compactedSeqs instanceof Set)) throw new Error('compacted memory event seqs must be supplied as a Set')
  return row.sourceRefs.length === 0 || row.sourceRefs.every(ref => compactedSeqs.has(ref.eventSeq))
}

export function queryMemory(document, request = {}) {
  const query = String(request.query ?? '').trim().toLocaleLowerCase().slice(0, 4096)
  const table = request.table === undefined ? undefined : String(request.table)
  const limit = Math.max(1, Math.min(200, Number.isSafeInteger(request.limit) ? request.limit : 40))
  if (request.filters !== undefined && (request.filters === null || typeof request.filters !== 'object' || Array.isArray(request.filters))) throw new Error('memory filters must be an object')
  const filters = request.filters === undefined ? request : { ...request, ...request.filters }
  let characters
  if (Object.hasOwn(filters, 'characters')) characters = normalizedCharacters(filters.characters)
  const characterMatch = filters.characterMatch ?? 'any'
  if (characterMatch !== 'any' && characterMatch !== 'all') throw new Error('memory characterMatch must be any or all')
  let timeRange
  if (Object.hasOwn(filters, 'timeRange')) {
    const value = filters.timeRange
    const timeline = value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.timeline === 'string' ? value.timeline.trim() : ''
    if (timeline === '' || !Number.isFinite(value?.start) || !Number.isFinite(value?.end) || value.end < value.start) throw new Error('memory timeRange requires a timeline and finite ordered start/end')
    timeRange = { timeline, start: value.start, end: value.end }
  }
  const hasLocation = Object.hasOwn(filters, 'location')
  const location = hasLocation ? normalizedLocation(filters.location) : undefined
  const hasEventId = Object.hasOwn(filters, 'eventId')
  const eventId = hasEventId ? normalizedEventId(filters.eventId) : undefined
  const order = filters.order ?? 'relevance'
  if (!['relevance', 'time_asc', 'time_desc'].includes(order)) throw new Error('memory order must be relevance, time_asc, or time_desc')
  const relevance = (left, right) => right.importance - left.importance || right.updatedAt - left.updatedAt
  const chronological = (left, right) => {
    const leftNormalized = left.storyTime.state === 'normalized'
    const rightNormalized = right.storyTime.state === 'normalized'
    if (leftNormalized !== rightNormalized) return leftNormalized ? -1 : 1
    if (!leftNormalized) return relevance(left, right)
    const direction = order === 'time_asc' ? 1 : -1
    return direction * (left.storyTime.start - right.storyTime.start
      || (left.storyTime.end ?? left.storyTime.start) - (right.storyTime.end ?? right.storyTime.start)) || relevance(left, right)
  }
  const matchesCharacters = row => {
    if (characters === undefined || characters.length === 0) return true
    const present = new Set(row.characters.map(character => character.toLocaleLowerCase()))
    if (characterMatch === 'all') return characters.every(character => present.has(character.toLocaleLowerCase()))
    return characters.some(character => present.has(character.toLocaleLowerCase()))
  }
  return document.rows
    .filter(row => table === undefined || row.table === table)
    .filter(row => query === '' || `${row.key}\n${JSON.stringify(row.value)}\n${row.keywords.join(' ')}\n${row.storyTime.label ?? ''}\n${row.location?.join(' ') ?? ''}\n${row.characters.join(' ')}\n${row.eventId ?? ''}`.toLocaleLowerCase().includes(query))
    .filter(matchesCharacters)
    .filter(row => timeRange === undefined || row.storyTime.state === 'normalized'
      && row.storyTime.timeline === timeRange.timeline
      // A missing end records only the known start; it does not imply that the
      // event continues indefinitely or ends at a real-world timestamp.
      && (row.storyTime.end ?? row.storyTime.start) >= timeRange.start
      && row.storyTime.start <= timeRange.end)
    .filter(row => {
      if (!hasLocation) return true
      if (row.location === null || location === null) return row.location === location
      if (location.length > row.location.length) return false
      return location.every((segment, index) => row.location[index].toLocaleLowerCase() === segment.toLocaleLowerCase())
    })
    .filter(row => !hasEventId || row.eventId === eventId)
    .sort(order === 'relevance' ? relevance : chronological)
    .slice(0, limit)
    .map(snapshot)
}

export function queryEventGraph(document, request = {}) {
  const limit = Math.max(1, Math.min(200, Number.isSafeInteger(request.limit) ? request.limit : 40))
  let seedEventIds
  if (Object.hasOwn(request, 'eventId')) {
    const eventId = normalizedEventId(request.eventId)
    seedEventIds = document.rows.some(row => row.eventId === eventId) ? [eventId] : []
  } else {
    const seen = new Set()
    seedEventIds = []
    for (const row of queryMemory(document, { ...request, limit })) {
      if (row.eventId === undefined || seen.has(row.eventId)) continue
      seen.add(row.eventId)
      seedEventIds.push(row.eventId)
    }
  }
  const seeds = new Set(seedEventIds)
  const incomingEdges = document.eventEdges.filter(edge => seeds.has(edge.successorEventId)).map(snapshot)
  const outgoingEdges = document.eventEdges.filter(edge => seeds.has(edge.predecessorEventId)).map(snapshot)
  const groupedEventIds = [...seedEventIds]
  const grouped = new Set(groupedEventIds)
  for (const edge of [...incomingEdges, ...outgoingEdges]) {
    for (const eventId of [edge.predecessorEventId, edge.successorEventId]) {
      if (grouped.has(eventId)) continue
      grouped.add(eventId)
      groupedEventIds.push(eventId)
    }
  }
  const events = groupedEventIds.map(eventId => ({
    eventId,
    rows: document.rows.filter(row => row.eventId === eventId).map(snapshot),
  }))
  return { seedEventIds: snapshot(seedEventIds), events, incomingEdges, outgoingEdges }
}

function mutateEventDocument(document, operation) {
  const action = operation.action
  if (action === 'upsert') {
    const identity = normalizedRowIdentity(operation)
    const index = document.rows.findIndex(row => row.table === identity.table && row.key === identity.key)
    if (index === -1 && document.rows.length >= MAX_ROWS) throw new Error(`memory rows exceed ${MAX_ROWS}`)
    const row = normalizedRow({ ...operation, ...identity }, index === -1 ? undefined : document.rows[index])
    if (index === -1) document.rows.push(row)
    else document.rows[index] = row
    return row
  }
  if (action === 'update') {
    const index = document.rows.findIndex(row => row.id === operation.id)
    if (index === -1) throw new Error(`memory row ${operation.id} was not found`)
    const row = normalizedRow(operation, document.rows[index])
    document.rows[index] = row
    return row
  }
  if (action === 'delete') {
    const index = document.rows.findIndex(row => row.id === operation.id)
    if (index === -1) throw new Error(`memory row ${operation.id} was not found`)
    return document.rows.splice(index, 1)[0]
  }
  if (action === 'event_edge_upsert') {
    const kind = operation.kind ?? 'precedes'
    if (kind !== 'precedes') throw new Error('event edge kind must be precedes')
    const predecessorEventId = normalizedEventId(operation.predecessorEventId, 'event edge predecessorEventId')
    const successorEventId = normalizedEventId(operation.successorEventId, 'event edge successorEventId')
    const index = document.eventEdges.findIndex(edge => edge.kind === kind
      && edge.predecessorEventId === predecessorEventId
      && edge.successorEventId === successorEventId)
    if (index === -1 && document.eventEdges.length >= MAX_EVENT_EDGES) throw new Error(`event edges exceed ${MAX_EVENT_EDGES}`)
    const edge = normalizedEventEdge({ ...operation, kind, predecessorEventId, successorEventId }, index === -1 ? undefined : document.eventEdges[index])
    if (index === -1) document.eventEdges.push(edge)
    else document.eventEdges[index] = edge
    return edge
  }
  if (action === 'event_edge_delete') {
    const index = document.eventEdges.findIndex(edge => edge.id === operation.id)
    if (index === -1) throw new Error(`event edge ${operation.id} was not found`)
    return document.eventEdges.splice(index, 1)[0]
  }
  throw new Error(`unknown event action ${String(action)}`)
}

export function applyEventOperation(document, operation) {
  const next = normalizeEventDocument(document, document.sessionId)
  const maintenanceJobId = Object.hasOwn(operation, 'maintenanceJobId')
    ? normalizedMaintenanceJobId(operation.maintenanceJobId)
    : undefined
  if (maintenanceJobId !== undefined && operation.action !== 'batch') throw new Error('event maintenanceJobId is only valid for batch operations')
  if (maintenanceJobId !== undefined && next.appliedMaintenanceJobs.includes(maintenanceJobId)) {
    return { document: next, result: [], changed: false, duplicate: true }
  }
  if (operation.action === 'query') return { document: next, result: queryMemory(next, operation), changed: false }
  let result
  if (operation.action === 'batch') {
    if (!Array.isArray(operation.operations) || operation.operations.length > 100) throw new Error('event batch must contain at most 100 operations')
    result = operation.operations.map(item => {
      if (item.action === 'batch' || item.action === 'query') throw new Error('nested batch/query operations are not allowed')
      return mutateEventDocument(next, item)
    })
  } else result = mutateEventDocument(next, operation)
  if (maintenanceJobId !== undefined) {
    next.appliedMaintenanceJobs.push(maintenanceJobId)
    next.appliedMaintenanceJobs = next.appliedMaintenanceJobs.slice(-MAX_APPLIED_MAINTENANCE_JOBS)
  }
  next.revision += 1
  assertDocumentConstraints(next)
  return { document: next, result: snapshot(result), changed: true }
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

export function assertMemoryKeywordsInSource(document, events) {
  const assistantBySeq = new Map()
  const allAssistantTexts = []
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant/message' || !Number.isSafeInteger(event.seq)) continue
    const text = messageText(event.data?.message?.content)
    if (text === '') continue
    assistantBySeq.set(event.seq, text)
    allAssistantTexts.push(text)
  }
  for (const row of document.rows) {
    const assistantRefs = row.sourceRefs.filter(ref => ref.role === 'assistant')
    const sourceTexts = row.sourceRefs.length === 0
      ? allAssistantTexts
      : assistantRefs.map(ref => assistantBySeq.get(ref.eventSeq)).filter(Boolean)
    if (sourceTexts.length === 0) {
      throw new Error(`memory keywords for ${row.table}/${row.key} cannot be validated because no assistant story source is available`)
    }
    const missing = row.keywords.filter(keyword => !sourceTexts.some(text => text.includes(keyword)))
    if (missing.length > 0) {
      throw new Error(`memory keywords for ${row.table}/${row.key} must appear verbatim in the source assistant story; missing: ${missing.map(keyword => JSON.stringify(keyword)).join(', ')}`)
    }
  }
}

export const eventLimits = Object.freeze({
  MAX_ROWS,
  MAX_EVENT_EDGES,
  MAX_DOCUMENT_BYTES,
  MAX_VALUE_BYTES,
  MAX_NAME_BYTES,
  MIN_KEYWORDS,
  MAX_KEYWORDS,
  MAX_APPLIED_MAINTENANCE_JOBS,
  DEFAULT_IMPORTANCE_THRESHOLD,
})
