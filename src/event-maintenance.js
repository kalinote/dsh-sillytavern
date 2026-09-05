import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { sessionEvents } from './prompt.js'

export const PERIODIC_MAINTENANCE_INTERVAL = 10
export const PERIODIC_MAINTENANCE_OVERLAP = 1
export const MAX_PERIODIC_CONTEXT_BYTES = 160 * 1024
const MAX_MAINTENANCE_CANDIDATE_GROUPS = 120
const MAX_STATE_BYTES = 16 * 1024 * 1024
const MAX_COMPLETED_IDS = 512
const MAX_FAILED_JOBS = 64
const MAX_PATCH_OPERATIONS = 100

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const storyTimeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: { type: 'string', enum: ['normalized', 'label-only', 'unknown'] },
    label: nullableString,
    timeline: nullableString,
    start: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    end: { oneOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['state', 'label', 'timeline', 'start', 'end'],
}
const locationSchema = { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] }
const rowBaseProperties = {
  eventId: { type: 'string' },
  table: { type: 'string' },
  key: { type: 'string' },
  value: { type: 'object', additionalProperties: true, properties: {} },
  keywords: { type: 'array', items: { type: 'string' } },
  importance: { type: 'number' },
  storyTime: storyTimeSchema,
  location: locationSchema,
  characters: { type: 'array', items: { type: 'string' } },
  recallPolicy: { type: 'string', enum: ['always', 'after_compaction', 'query_only'] },
}
const upsertOperation = {
  type: 'object',
  additionalProperties: false,
  properties: { action: { type: 'string', const: 'upsert' }, ...rowBaseProperties },
  required: ['action', 'table', 'key', 'value', 'keywords', 'storyTime', 'location', 'characters'],
}
const updateOperation = {
  type: 'object',
  additionalProperties: false,
  properties: { action: { type: 'string', const: 'update' }, id: { type: 'string' }, ...rowBaseProperties },
  required: ['action', 'id'],
}
const deleteOperation = {
  type: 'object',
  additionalProperties: false,
  properties: { action: { type: 'string', const: 'delete' }, id: { type: 'string' } },
  required: ['action', 'id'],
}
const edgeUpsertOperation = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', const: 'event_edge_upsert' },
    kind: { type: 'string', const: 'precedes' },
    predecessorEventId: { type: 'string' },
    successorEventId: { type: 'string' },
    reason: nullableString,
  },
  required: ['action', 'kind', 'predecessorEventId', 'successorEventId'],
}
const edgeDeleteOperation = {
  type: 'object',
  additionalProperties: false,
  properties: { action: { type: 'string', const: 'event_edge_delete' }, id: { type: 'string' } },
  required: ['action', 'id'],
}

export const EVENT_PATCH_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    operations: {
      type: 'array',
      items: { oneOf: [upsertOperation, updateOperation, deleteOperation, edgeUpsertOperation, edgeDeleteOperation] },
    },
  },
  required: ['operations'],
})

function clone(value) { return structuredClone(value) }

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function eventMessage(event) {
  if (event?.type === 'user/message') {
    const text = contentText(event.data?.content)
    return text === '' ? undefined : { role: 'user', text, seq: event.seq, sourceKind: event.data?.source?.kind ?? null }
  }
  if (event?.type === 'assistant/message') {
    const text = contentText(event.data?.message?.content)
    return text === '' ? undefined : { role: 'assistant', text, seq: event.seq, sourceKind: event.data?.message?.source?.kind ?? null }
  }
  return undefined
}

function conversationRoundFromEndEvent(events, turnEndEvent) {
  const turn = turnEndEvent?.data?.turn
  if (!Number.isSafeInteger(turn) || turn <= 0 || turnEndEvent?.data?.reason?.kind !== 'completed') return null
  const endIndex = events.findIndex(event => event.seq === turnEndEvent.seq)
  if (endIndex === -1) return null
  let startIndex = -1
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'turn/start' && event.data?.turn === turn) {
      startIndex = index
      break
    }
  }
  if (startIndex === -1) return null
  const messages = events.slice(startIndex + 1, endIndex).map(eventMessage).filter(Boolean)
  const finalAssistant = messages.findLast(message => message.role === 'assistant')
  if (finalAssistant === undefined) return null
  const users = messages.filter(message => message.role === 'user' && message.sourceKind === 'user')
  if (users.length === 0) return null
  const sourceMessages = [...users, finalAssistant]
  const sourceRefs = sourceMessages.map(message => ({ eventSeq: message.seq, turn, role: message.role }))
  return {
    turn,
    startSeq: events[startIndex].seq,
    endSeq: turnEndEvent.seq,
    sourceRefs,
    messages: sourceMessages.map(({ role, text, seq }) => ({ role, text, seq })),
  }
}

export function completedConversationRounds(agent) {
  const events = sessionEvents(agent?.session)
  return events
    .filter(event => event?.type === 'turn/end' && event.data?.reason?.kind === 'completed')
    .map(event => conversationRoundFromEndEvent(events, event))
    .filter(Boolean)
    .sort((left, right) => left.endSeq - right.endSeq)
}

function createIncrementalJob(round) {
  const latestUser = round.messages.findLast(message => message.role === 'user')
  const finalAssistant = round.messages.findLast(message => message.role === 'assistant')
  const messages = [latestUser, finalAssistant]
  const sourceRefs = messages.map(message => ({ eventSeq: message.seq, turn: round.turn, role: message.role }))
  const incrementalRound = { ...clone(round), messages: clone(messages), sourceRefs: clone(sourceRefs) }
  return {
    id: `incremental-turn-${round.turn}-assistant-${finalAssistant.seq}`,
    kind: 'incremental',
    trigger: 'automatic',
    turn: round.turn,
    startTurn: round.turn,
    endTurn: round.turn,
    sourceRefs,
    rounds: [incrementalRound],
    turnMessages: clone(messages),
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function createEventMaintenanceJob(agent, turnEndEvent) {
  const round = conversationRoundFromEndEvent(sessionEvents(agent?.session), turnEndEvent)
  return round === null ? null : createIncrementalJob(round)
}

export function normalizeMaintenanceMatchText(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

function keywordScore(row, normalizedText) {
  const matches = []
  const seen = new Set()
  for (const keyword of Array.isArray(row.keywords) ? row.keywords : []) {
    const normalized = normalizeMaintenanceMatchText(keyword)
    if (normalized === '' || seen.has(normalized) || !normalizedText.includes(normalized)) continue
    seen.add(normalized)
    matches.push({ keyword, length: [...normalized].length })
  }
  return {
    count: matches.length,
    longest: matches.reduce((value, match) => Math.max(value, match.length), 0),
    totalLength: matches.reduce((value, match) => value + match.length, 0),
    keywords: matches.map(match => match.keyword),
  }
}

function eventSummary(document, eventId) {
  const rows = document.rows.filter(row => row.eventId === eventId)
  return {
    eventId,
    memoryCount: rows.length,
    memories: rows.slice(0, 4).map(row => ({ table: row.table, key: row.key })),
  }
}

export function selectMaintenanceEvents(document, text, options = {}) {
  const normalizedText = normalizeMaintenanceMatchText(text)
  const touchedRowIds = new Set(Array.isArray(options.touchedRowIds) ? options.touchedRowIds : [])
  const touchedEventIds = new Set(Array.isArray(options.touchedEventIds) ? options.touchedEventIds : [])
  const scored = document.rows.map(row => ({ row, score: keywordScore(row, normalizedText) }))
    .filter(item => item.score.count > 0)
    .sort((left, right) => right.score.count - left.score.count
      || right.score.longest - left.score.longest
      || right.score.totalLength - left.score.totalLength
      || right.row.importance - left.row.importance
      || right.row.updatedAt - left.row.updatedAt)
  const seeds = scored.map(item => item.row)
  for (const row of document.rows) {
    if (touchedRowIds.has(row.id) || row.eventId && touchedEventIds.has(row.eventId)) seeds.push(row)
  }
  const selectedGroupKeys = []
  const selectedGroupSet = new Set()
  for (const row of seeds) {
    const groupKey = row.eventId ? `event:${row.eventId}` : `row:${row.id}`
    if (selectedGroupSet.has(groupKey)) continue
    selectedGroupSet.add(groupKey)
    selectedGroupKeys.push(groupKey)
  }
  const keptGroupKeys = selectedGroupKeys.slice(0, MAX_MAINTENANCE_CANDIDATE_GROUPS)
  const scoredRank = new Map(scored.map((item, index) => [item.row.id, index]))
  const rows = keptGroupKeys.flatMap(groupKey => document.rows
    .filter(row => (row.eventId ? `event:${row.eventId}` : `row:${row.id}`) === groupKey)
    .sort((left, right) => (scoredRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (scoredRank.get(right.id) ?? Number.MAX_SAFE_INTEGER)))
  const eventIds = new Set(rows.map(row => row.eventId).filter(Boolean))
  const eventEdges = document.eventEdges.filter(edge => eventIds.has(edge.predecessorEventId) || eventIds.has(edge.successorEventId))
  const neighborIds = new Set()
  for (const edge of eventEdges) {
    if (!eventIds.has(edge.predecessorEventId)) neighborIds.add(edge.predecessorEventId)
    if (!eventIds.has(edge.successorEventId)) neighborIds.add(edge.successorEventId)
  }
  const hitByRowId = new Map(scored.map(item => [item.row.id, item.score.keywords]))
  return {
    complete: selectedGroupKeys.length <= MAX_MAINTENANCE_CANDIDATE_GROUPS,
    omittedCandidateGroups: Math.max(0, selectedGroupKeys.length - MAX_MAINTENANCE_CANDIDATE_GROUPS),
    rows: rows.map(row => ({ ...row, matchedKeywords: hitByRowId.get(row.id) ?? [] })),
    eventEdges,
    neighborEventSummaries: [...neighborIds].map(eventId => eventSummary(document, eventId)),
  }
}

function contextText(job) {
  return job.rounds.flatMap(round => round.messages).map(message => message.text).join('\n')
}

function promptForJob(job, document, touches = {}) {
  const event = selectMaintenanceEvents(document, contextText(job), job.kind === 'periodic' ? touches : {})
  const periodic = job.kind === 'periodic'
  const instructions = [
    periodic
      ? 'Periodically consolidate narrative events for the supplied contiguous roleplay conversation rounds.'
      : 'Incrementally maintain narrative events after the latest completed roleplay round.',
    'Produce only the structured event patch requested by the output tool. An empty operations array is valid.',
    '',
    'Responsibilities:',
    ...(periodic ? [
      '- Merge near-duplicate memories produced round by round.',
      '- Correct missed contradictions.',
      '- Complete direct event relationships.',
      '- Recalibrate importance and recallPolicy.',
      '- Delete state that is no longer valid.',
      '- Merge events that were incorrectly split, including moving their rows to one stable eventId and repairing edges.',
    ] : [
      '- Add durable facts established by the latest completed round.',
      '- Correct or delete contradicted candidate facts, and update a candidate row instead of creating a near-duplicate.',
    ]),
    '- Group multiple memories from the same logical event with one stable eventId.',
    '- Treat each event as one logical unit that aggregates one or more memory rows.',
    '- Link events, never individual memory rows. Use a precedes edge only for a direct narrative prerequisite or progression, not mere temporal adjacency.',
    '- If an existing event is continued, reuse its exact eventId. Do not invent a second id for the same event.',
    '- Do not create an edge to an event that is not represented by at least one row in the resulting patch/document.',
    '- Do not infer unknown story time. Use the explicit unknown structure.',
    '- Keep one broad-to-specific location path per row. Use separate rows sharing eventId when one event has multiple locations.',
    '- Give every memory 2 to 10 unique keywords copied verbatim, with exact spelling and case, from the assistant story text represented by its source references.',
    '- Keywords must be concrete searchable text such as names, aliases, proper nouns, identifiers, or distinctive phrases. Never use generic classifications such as 物品, 事件, 关系, or 状态变化.',
    '- More than 10 useful keywords means the memory is too broad: split it into finer rows, reusing the same eventId when they belong to one logical event.',
    '- The host rejects the whole patch when a keyword is absent from its source assistant story or the keyword count is invalid.',
    '- importance is 0..1. Use recallPolicy always for core/high-value facts, after_compaction for ordinary scene facts, and query_only for low-value trace-only facts.',
    '- Source references are added by the host; do not include them in operations.',
    `- Return at most ${MAX_PATCH_OPERATIONS} operations.`,
    '',
    `Maintenance mode: ${job.kind}.`,
    `Conversation range: turn ${job.startTurn} through turn ${job.endTurn}.`,
    ...(periodic ? [
      `Periodic trigger: ${job.trigger}.`,
      `Continuous context task: ${job.chunkIndex + 1} of ${job.chunkCount}.`,
      'Candidate rows were selected only by normalized keyword substring hits across this task context plus rows/events touched during the current maintenance period.',
    ] : [
      'Candidate rows were selected only by normalized keyword substring hits in the latest real user message(s) plus final assistant body.',
    ]),
    'Rows sharing a selected eventId are supplied together. Only direct edges are supplied; adjacent events appear only as brief summaries.',
    event.complete ? 'The candidate-group selection is complete.' : `The ranked candidate-group limit omitted ${event.omittedCandidateGroups} lower-ranked groups.`,
  ].join('\n')
  const narrative = JSON.stringify({ conversationRounds: job.rounds.map(round => ({ turn: round.turn, messages: round.messages })) })
  const snapshotText = JSON.stringify(event)
  return { text: `${instructions}\n\nComplete conversation rounds for this task:\n${narrative}\n\nRelevant event candidates:\n${snapshotText}`, event }
}

export function buildEventMaintenancePrompt(job, document) {
  return promptForJob(job, document).text
}

function emptyState(sessionId) {
  return {
    schemaVersion: 2,
    sessionId,
    lastPeriodicBoundary: null,
    touchedRowIds: [],
    touchedEventIds: [],
    pending: [],
    failed: [],
    completed: [],
  }
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !['incremental', 'periodic'].includes(job.kind)) return undefined
  if (!Number.isSafeInteger(job.turn) || job.turn <= 0 || !Array.isArray(job.sourceRefs) || !Array.isArray(job.turnMessages) || !Array.isArray(job.rounds)) return undefined
  if (job.kind === 'periodic' && (typeof job.groupId !== 'string' || !Number.isSafeInteger(job.chunkIndex) || !Number.isSafeInteger(job.chunkCount))) return undefined
  return {
    ...clone(job),
    status: job.status === 'running' ? 'pending' : job.status === 'failed' ? 'failed' : 'pending',
    attempts: Number.isSafeInteger(job.attempts) && job.attempts >= 0 ? job.attempts : 0,
  }
}

function normalizeState(raw, sessionId) {
  if (!raw || raw.schemaVersion !== 2 || raw.sessionId !== sessionId) return emptyState(sessionId)
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).map(normalizeJob).filter(Boolean)
  const failed = (Array.isArray(raw.failed) ? raw.failed : []).map(normalizeJob).filter(Boolean).slice(-MAX_FAILED_JOBS)
  const completed = [...new Set((Array.isArray(raw.completed) ? raw.completed : []).filter(value => typeof value === 'string'))].slice(-MAX_COMPLETED_IDS)
  const boundary = raw.lastPeriodicBoundary
  const lastPeriodicBoundary = boundary && Number.isSafeInteger(boundary.endSeq) && boundary.endSeq >= 0 && Number.isSafeInteger(boundary.turn) && boundary.turn > 0
    ? { endSeq: boundary.endSeq, turn: boundary.turn }
    : null
  const touchedRowIds = [...new Set((Array.isArray(raw.touchedRowIds) ? raw.touchedRowIds : []).filter(value => typeof value === 'string'))]
  const touchedEventIds = [...new Set((Array.isArray(raw.touchedEventIds) ? raw.touchedEventIds : []).filter(value => typeof value === 'string'))]
  return { schemaVersion: 2, sessionId, lastPeriodicBoundary, touchedRowIds, touchedEventIds, pending, failed, completed }
}

async function readState(path, sessionId) {
  try {
    const content = await readFile(path)
    if (content.length > MAX_STATE_BYTES) throw new Error('event maintenance state exceeds its size limit')
    return normalizeState(JSON.parse(content.toString('utf8')), sessionId)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState(sessionId)
    throw error
  }
}

async function writeState(path, state) {
  await mkdir(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const text = `${JSON.stringify(state, null, 2)}\n`
  if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) throw new Error('event maintenance state exceeds its size limit')
  await writeFile(temporary, text, 'utf8')
  try { await rename(temporary, path) } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function mergeSourceRefs(...lists) {
  const refs = []
  const seen = new Set()
  for (const ref of lists.flat()) {
    const key = `${ref.eventSeq}:${ref.turn}:${ref.role}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(clone(ref))
  }
  return refs
}

function conversationContextBytes(rounds) {
  return Buffer.byteLength(JSON.stringify({
    conversationRounds: rounds.map(round => ({ turn: round.turn, messages: round.messages })),
  }), 'utf8')
}

export function splitPeriodicConversationRounds(rounds, limit = MAX_PERIODIC_CONTEXT_BYTES) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('periodic event context byte limit must be a positive integer')
  const chunks = []
  let current = []
  for (const round of rounds) {
    if (conversationContextBytes([round]) > limit) {
      throw new Error(`complete conversation turn ${round.turn} exceeds the ${limit}-byte periodic event context limit and cannot be split without truncation`)
    }
    if (current.length > 0 && conversationContextBytes([...current, round]) > limit) {
      chunks.push(current)
      current = []
    }
    current.push(round)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function periodicContextRounds(rounds, boundary, targetEndSeq, overlap) {
  const targetIndex = rounds.findLastIndex(round => round.endSeq <= targetEndSeq)
  if (targetIndex === -1) return []
  const boundaryIndex = boundary === null ? -1 : rounds.findLastIndex(round => round.endSeq <= boundary.endSeq)
  const startIndex = boundaryIndex === -1 ? 0 : Math.max(0, boundaryIndex - overlap + 1)
  return rounds.slice(startIndex, targetIndex + 1)
}

function createPeriodicJobs(rounds, boundary, target, trigger, overlap, contextLimit) {
  const contextRounds = periodicContextRounds(rounds, boundary, target.endSeq, overlap)
  if (contextRounds.length === 0) return []
  const chunks = splitPeriodicConversationRounds(contextRounds, contextLimit)
  const groupId = trigger === 'automatic'
    ? `periodic-auto-after-${boundary?.endSeq ?? 'start'}-through-${target.endSeq}`
    : `periodic-manual-through-${target.endSeq}-${randomUUID()}`
  const timestamp = Date.now()
  return chunks.map((chunk, chunkIndex) => {
    const sourceRefs = mergeSourceRefs(...chunk.map(round => round.sourceRefs))
    return {
      id: `${groupId}-chunk-${chunkIndex + 1}-of-${chunks.length}`,
      groupId,
      kind: 'periodic',
      trigger,
      turn: chunk.at(-1).turn,
      startTurn: chunk[0].turn,
      endTurn: chunk.at(-1).turn,
      periodStartTurn: contextRounds[0].turn,
      periodEndTurn: target.turn,
      boundary: { turn: target.turn, endSeq: target.endSeq },
      chunkIndex,
      chunkCount: chunks.length,
      sourceRefs,
      rounds: clone(chunk),
      turnMessages: chunk.flatMap(round => clone(round.messages)),
      status: 'pending',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })
}

function operationsForCommit(rawOperations, document, sourceRefs) {
  if (!Array.isArray(rawOperations)) throw new Error('event maintenance result has no operations array')
  if (rawOperations.length > MAX_PATCH_OPERATIONS) throw new Error(`event maintenance result exceeds ${MAX_PATCH_OPERATIONS} operations`)
  const rowIds = new Set(document.rows.map(row => row.id))
  const edgeIds = new Set(document.eventEdges.map(edge => edge.id))
  const rowsById = new Map(document.rows.map(row => [row.id, row]))
  const rowsByKey = new Map(document.rows.map(row => [`${row.table}\0${row.key}`, row]))
  const edgesByTriple = new Map(document.eventEdges.map(edge => [`${edge.kind}\0${edge.predecessorEventId}\0${edge.successorEventId}`, edge]))
  const buckets = { edgeDeletes: [], rowWrites: [], edgeWrites: [], rowDeletes: [] }
  for (const raw of rawOperations) {
    const operation = clone(raw)
    if (operation.action === 'delete' && !rowIds.has(operation.id)) continue
    if (operation.action === 'update' && !rowIds.has(operation.id)) continue
    if (operation.action === 'event_edge_delete' && !edgeIds.has(operation.id)) continue
    if (operation.action === 'upsert') {
      operation.table = String(operation.table ?? 'default').trim()
      operation.key = String(operation.key ?? '').trim()
      const existing = rowsByKey.get(`${operation.table}\0${operation.key}`)
      operation.sourceRefs = mergeSourceRefs(existing?.sourceRefs ?? [], sourceRefs)
      buckets.rowWrites.push(operation)
    } else if (operation.action === 'update') {
      operation.sourceRefs = mergeSourceRefs(rowsById.get(operation.id)?.sourceRefs ?? [], sourceRefs)
      buckets.rowWrites.push(operation)
    } else if (operation.action === 'event_edge_upsert') {
      const kind = operation.kind ?? 'precedes'
      const existing = edgesByTriple.get(`${kind}\0${operation.predecessorEventId}\0${operation.successorEventId}`)
      operation.sourceRefs = mergeSourceRefs(existing?.sourceRefs ?? [], sourceRefs)
      buckets.edgeWrites.push(operation)
    } else if (operation.action === 'event_edge_delete') buckets.edgeDeletes.push(operation)
    else buckets.rowDeletes.push(operation)
  }
  return [...buckets.edgeDeletes, ...buckets.rowWrites, ...buckets.edgeWrites, ...buckets.rowDeletes]
}

function touchesFromCommit(selection, results) {
  const rowIds = new Set(selection.rows.map(row => row.id))
  const eventIds = new Set(selection.rows.map(row => row.eventId).filter(Boolean))
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || typeof result !== 'object') continue
    if (typeof result.table === 'string' && typeof result.id === 'string') rowIds.add(result.id)
    if (typeof result.eventId === 'string') eventIds.add(result.eventId)
    if (typeof result.predecessorEventId === 'string') eventIds.add(result.predecessorEventId)
    if (typeof result.successorEventId === 'string') eventIds.add(result.successorEventId)
  }
  return { rowIds: [...rowIds], eventIds: [...eventIds] }
}

function touchesFromAppliedJob(document, job) {
  const sourceKeys = new Set(job.sourceRefs.map(ref => `${ref.eventSeq}:${ref.turn}:${ref.role}`))
  const hasJobSource = value => Array.isArray(value?.sourceRefs)
    && value.sourceRefs.some(ref => sourceKeys.has(`${ref.eventSeq}:${ref.turn}:${ref.role}`))
  const rows = document.rows.filter(hasJobSource)
  const edges = document.eventEdges.filter(hasJobSource)
  return {
    rowIds: rows.map(row => row.id),
    eventIds: [...new Set([
      ...rows.map(row => row.eventId).filter(Boolean),
      ...edges.flatMap(edge => [edge.predecessorEventId, edge.successorEventId]),
    ])],
  }
}

export class EventMaintenanceManager {
  constructor(options) {
    this.store = options.store
    this.subagents = options.subagents
    this.provider = options.provider ?? 'spawn'
    this.maxAttempts = Math.max(1, Number.isSafeInteger(options.maxAttempts) ? options.maxAttempts : 3)
    this.maxConcurrency = Math.max(1, Number.isSafeInteger(options.maxConcurrency) ? options.maxConcurrency : 2)
    this.maxTokens = Math.max(512, Number.isSafeInteger(options.maxTokens) ? options.maxTokens : 4096)
    this.periodicInterval = Math.max(1, Number.isSafeInteger(options.periodicInterval) ? options.periodicInterval : PERIODIC_MAINTENANCE_INTERVAL)
    this.periodicOverlap = Math.max(0, Number.isSafeInteger(options.periodicOverlap) ? options.periodicOverlap : PERIODIC_MAINTENANCE_OVERLAP)
    this.periodicContextBytes = Math.max(1024, Number.isSafeInteger(options.periodicContextBytes) ? options.periodicContextBytes : MAX_PERIODIC_CONTEXT_BYTES)
    this.agentOptions = options.agentOptions ?? {}
    this.isEligible = options.isEligible ?? (() => true)
    this.isCurrent = options.isCurrent ?? (() => true)
    this.active = true
    this.states = new Map()
    this.stateTails = new Map()
    this.workers = new Map()
    this.controllers = new Map()
    this.stoppedAgents = new WeakSet()
    this.activeCount = 0
    this.capacityWaiters = []
  }

  sessionKey(agent) { return this.store.sessionKey(agent) }

  statePath(agent) {
    const id = String(agent.id)
    const name = createHash('sha256').update(id).digest('hex')
    return join(this.store.rootForWorkspace(this.store.workspaceOf(agent)), 'event-maintenance', `${name}.json`)
  }

  async serialState(agent, operation) {
    const key = this.sessionKey(agent)
    const previous = this.stateTails.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.stateTails.set(key, current)
    try { return await current } finally {
      if (this.stateTails.get(key) === current) this.stateTails.delete(key)
    }
  }

  async stateFor(agent) {
    const key = this.sessionKey(agent)
    let state = this.states.get(key)
    if (state === undefined) {
      state = await readState(this.statePath(agent), String(agent.id))
      this.states.set(key, state)
    }
    return state
  }

  async save(agent, state) {
    await writeState(this.statePath(agent), state)
    this.states.set(this.sessionKey(agent), state)
  }

  async enqueue(agent, job) {
    if (job === null || !this.active || this.stoppedAgents.has(agent) || !this.isEligible(agent)) return false
    const inserted = await this.serialState(agent, async () => {
      const state = await this.stateFor(agent)
      if (state.completed.includes(job.id) || state.pending.some(item => item.id === job.id) || state.failed.some(item => item.id === job.id)) return false
      state.pending.push(clone(job))
      await this.save(agent, state)
      return true
    })
    this.kick(agent)
    return inserted
  }

  async enqueueCompletedTurn(agent, job) {
    if (job === null || !this.active || this.stoppedAgents.has(agent) || !this.isEligible(agent)) return { queued: false, kind: null }
    const decision = await this.serialState(agent, async () => {
      const state = await this.stateFor(agent)
      const rounds = completedConversationRounds(agent)
      const target = rounds.find(round => round.endSeq === job.rounds[0]?.endSeq)
      if (target === undefined) return { queued: false, kind: null }
      const alreadyCovered = state.lastPeriodicBoundary?.endSeq >= target.endSeq
        || state.completed.includes(job.id)
        || [...state.pending, ...state.failed].some(item => item.id === job.id || item.rounds.some(round => round.endSeq === target.endSeq))
      if (alreadyCovered) return { queued: false, kind: job.kind }
      const boundarySeq = state.lastPeriodicBoundary?.endSeq ?? -1
      const completedSinceBoundary = rounds.filter(round => round.endSeq > boundarySeq && round.endSeq <= target.endSeq)
      const periodicPending = state.pending.some(item => item.kind === 'periodic')
      if (!periodicPending && completedSinceBoundary.length >= this.periodicInterval) {
        const jobs = createPeriodicJobs(rounds, state.lastPeriodicBoundary, target, 'automatic', this.periodicOverlap, this.periodicContextBytes)
        state.pending.push(...jobs)
        await this.save(agent, state)
        return {
          queued: true,
          kind: 'periodic',
          startTurn: jobs[0].periodStartTurn,
          endTurn: target.turn,
          chunks: jobs.length,
        }
      }
      if (conversationContextBytes(job.rounds) > this.periodicContextBytes) {
        throw new Error(`complete conversation turn ${job.turn} exceeds the ${this.periodicContextBytes}-byte event context limit and cannot be maintained without truncation`)
      }
      state.pending.push(clone(job))
      await this.save(agent, state)
      return { queued: true, kind: 'incremental', startTurn: job.turn, endTurn: job.turn, chunks: 1 }
    })
    this.kick(agent)
    return decision
  }

  async enqueuePeriodic(agent, options = {}) {
    if (!this.active || this.stoppedAgents.has(agent) || !this.isEligible(agent)) return { queued: false, reason: 'unavailable' }
    options.signal?.throwIfAborted()
    const result = await this.serialState(agent, async () => {
      const state = await this.stateFor(agent)
      const existing = state.pending.find(job => job.kind === 'periodic')
      if (existing !== undefined) {
        return {
          queued: false,
          reason: 'already-pending',
          startTurn: existing.periodStartTurn,
          endTurn: existing.periodEndTurn,
          chunks: existing.chunkCount,
        }
      }
      const rounds = completedConversationRounds(agent)
      const target = rounds.at(-1)
      if (target === undefined) return { queued: false, reason: 'no-completed-rounds' }
      const jobs = createPeriodicJobs(rounds, state.lastPeriodicBoundary, target, 'manual', this.periodicOverlap, this.periodicContextBytes)
      state.pending.push(...jobs)
      await this.save(agent, state)
      return {
        queued: true,
        kind: 'periodic',
        startTurn: jobs[0].periodStartTurn,
        endTurn: target.turn,
        chunks: jobs.length,
      }
    })
    this.kick(agent)
    return result
  }

  async resume(agent) {
    if (!this.active || !this.isEligible(agent)) return
    this.stoppedAgents.delete(agent)
    const hasLiveWorker = this.workers.has(this.sessionKey(agent))
    await this.serialState(agent, async () => {
      const state = await this.stateFor(agent)
      let changed = false
      if (!hasLiveWorker) {
        for (const job of state.pending) {
          if (job.status === 'running') { job.status = 'pending'; changed = true }
        }
      }
      if (changed) await this.save(agent, state)
    })
    this.kick(agent)
  }

  kick(agent) {
    const key = this.sessionKey(agent)
    if (!this.active || this.stoppedAgents.has(agent)) return
    const existing = this.workers.get(key)
    if (existing !== undefined) {
      void existing.finally(() => this.kick(agent))
      return
    }
    const worker = this.process(agent).catch(error => {
      console.error('[dsh-sillytavern] event maintenance queue failed', error)
    }).finally(() => {
      if (this.workers.get(key) === worker) this.workers.delete(key)
    })
    this.workers.set(key, worker)
  }

  async acquireCapacity(signal) {
    signal.throwIfAborted()
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1
      return
    }
    await new Promise((resolveWait, reject) => {
      const waiter = { resolve: resolveWait, reject, signal, aborted: undefined }
      waiter.aborted = () => {
        const index = this.capacityWaiters.indexOf(waiter)
        if (index !== -1) this.capacityWaiters.splice(index, 1)
        reject(signal.reason ?? new Error('event maintenance aborted'))
      }
      signal.addEventListener('abort', waiter.aborted, { once: true })
      this.capacityWaiters.push(waiter)
      if (signal.aborted) waiter.aborted()
    })
  }

  releaseCapacity() {
    const waiter = this.capacityWaiters.shift()
    if (waiter !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.aborted)
      waiter.resolve()
      return
    }
    this.activeCount = Math.max(0, this.activeCount - 1)
  }

  async execute(agent, job) {
    const controller = new AbortController()
    const key = this.sessionKey(agent)
    this.controllers.set(key, controller)
    let run
    let acquired = false
    try {
      await this.acquireCapacity(controller.signal)
      acquired = true
      const document = await this.store.eventSnapshot(agent, controller.signal)
      if (document.appliedMaintenanceJobs.includes(job.id)) return touchesFromAppliedJob(document, job)
      const touches = job.kind === 'periodic'
        ? await this.serialState(agent, async () => {
          const state = await this.stateFor(agent)
          return { touchedRowIds: clone(state.touchedRowIds), touchedEventIds: clone(state.touchedEventIds) }
        })
        : {}
      const built = promptForJob(job, document, touches)
      run = await this.subagents.start(this.provider, {
        label: job.kind === 'periodic'
          ? `Periodic event consolidation ${job.chunkIndex + 1}/${job.chunkCount}, through turn ${job.periodEndTurn}`
          : `Incremental event maintenance turn ${job.turn}`,
        prompt: [{ type: 'text', text: built.text }],
        parent: agent,
        signal: controller.signal,
        agentOptions: { ...this.agentOptions, maxTokens: this.maxTokens },
        outputSchema: EVENT_PATCH_SCHEMA,
        maxDepth: 1,
        toolFilter: { allow: [] },
        persona: 'You are a dedicated narrative-event curator. Do not roleplay or continue the story. Treat each event as one logical unit that aggregates one or more memory rows. Reconcile durable facts and event relationships, then submit exactly one structured event patch.',
      })
      const result = await run.result
      if (result.stopReason !== 'completed' || result.structured === undefined) {
        throw new Error(`event maintenance subagent stopped with ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}`)
      }
      const latest = await this.store.eventSnapshot(agent, controller.signal)
      if (latest.revision !== document.revision) {
        const error = new Error(`event revision changed from ${document.revision} to ${latest.revision} while maintenance was running`)
        error.code = 'event-revision-conflict'
        throw error
      }
      const operations = operationsForCommit(result.structured.operations, latest, job.sourceRefs)
      const committed = await this.store.event(agent, {
        action: 'batch',
        operations,
        expectedRevision: latest.revision,
        maintenanceJobId: job.id,
      }, controller.signal)
      return touchesFromCommit(built.event, committed.result)
    } finally {
      try { if (run !== undefined) await run.dispose() } finally {
        this.controllers.delete(key)
        if (acquired) this.releaseCapacity()
      }
    }
  }

  async process(agent) {
    while (this.active && !this.stoppedAgents.has(agent) && this.isEligible(agent) && this.isCurrent(agent)) {
      const job = await this.serialState(agent, async () => {
        const state = await this.stateFor(agent)
        const current = state.pending[0]
        if (current === undefined) return undefined
        current.status = 'running'
        current.attempts += 1
        current.updatedAt = Date.now()
        await this.save(agent, state)
        return clone(current)
      })
      if (job === undefined) return
      try {
        const touched = await this.execute(agent, job)
        await this.serialState(agent, async () => {
          const state = await this.stateFor(agent)
          state.pending = state.pending.filter(item => item.id !== job.id)
          state.completed.push(job.id)
          state.completed = [...new Set(state.completed)].slice(-MAX_COMPLETED_IDS)
          state.touchedRowIds = [...new Set([...state.touchedRowIds, ...touched.rowIds])]
          state.touchedEventIds = [...new Set([...state.touchedEventIds, ...touched.eventIds])]
          if (job.kind === 'periodic' && job.chunkIndex === job.chunkCount - 1) {
            if (state.lastPeriodicBoundary === null || job.boundary.endSeq > state.lastPeriodicBoundary.endSeq) {
              state.lastPeriodicBoundary = clone(job.boundary)
            }
            state.touchedRowIds = []
            state.touchedEventIds = []
          }
          await this.save(agent, state)
        })
      } catch (error) {
        const retry = await this.serialState(agent, async () => {
          const state = await this.stateFor(agent)
          const index = state.pending.findIndex(item => item.id === job.id)
          if (index === -1) return false
          const current = state.pending[index]
          current.updatedAt = Date.now()
          current.lastError = error instanceof Error ? error.message.slice(0, 2048) : String(error).slice(0, 2048)
          if (!this.active || this.stoppedAgents.has(agent) || !this.isCurrent(agent)) {
            current.status = 'pending'
            await this.save(agent, state)
            return false
          }
          if (current.attempts >= this.maxAttempts) {
            current.status = 'failed'
            state.pending.splice(index, 1)
            state.failed.push(current)
            if (current.kind === 'periodic') {
              const canceled = state.pending.filter(item => item.kind === 'periodic' && item.groupId === current.groupId)
              state.pending = state.pending.filter(item => item.kind !== 'periodic' || item.groupId !== current.groupId)
              state.failed.push(...canceled.map(item => ({
                ...item,
                status: 'failed',
                updatedAt: Date.now(),
                lastError: `periodic group canceled after chunk ${current.chunkIndex + 1} failed`,
              })))
            }
            state.failed = state.failed.slice(-MAX_FAILED_JOBS)
            await this.save(agent, state)
            return false
          }
          current.status = 'pending'
          await this.save(agent, state)
          return true
        })
        if (retry) await delay(Math.min(3000, job.attempts * 500))
      }
    }
  }

  async pendingFallback(agent, compactedSeqs) {
    return this.serialState(agent, async () => {
      const state = await this.stateFor(agent)
      const candidates = [...state.pending, ...state.failed]
      return candidates
        .filter(job => job.kind === 'incremental' && job.sourceRefs.length > 0 && job.sourceRefs.every(ref => compactedSeqs.has(ref.eventSeq)))
        .slice(0, 4)
        .map(job => ({ id: job.id, turn: job.turn, turnMessages: clone(job.turnMessages) }))
    })
  }

  stopAgent(agent) {
    this.stoppedAgents.add(agent)
    this.controllers.get(this.sessionKey(agent))?.abort(new Error('parent Agent was disposed'))
  }

  async dispose() {
    this.active = false
    for (const controller of this.controllers.values()) controller.abort(new Error('event maintenance manager disposed'))
    for (const waiter of this.capacityWaiters.splice(0)) {
      waiter.signal.removeEventListener('abort', waiter.aborted)
      waiter.reject(new Error('event maintenance manager disposed'))
    }
    await Promise.allSettled([...this.workers.values()])
  }
}
