import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { sessionEvents, sessionMessages } from './prompt.js'

const MAX_JOB_TEXT = 64 * 1024
const MAX_CONTEXT_MESSAGES = 20
const MAX_PROMPT_MEMORY_CHARS = 180 * 1024
const MAX_STATE_BYTES = 4 * 1024 * 1024
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

export const MEMORY_PATCH_SCHEMA = Object.freeze({
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
    const text = contentText(event.data?.content).slice(-MAX_JOB_TEXT)
    return text === '' ? undefined : { role: 'user', text, seq: event.seq, sourceKind: event.data?.source?.kind ?? null }
  }
  if (event?.type === 'assistant/message') {
    const text = contentText(event.data?.message?.content).slice(-MAX_JOB_TEXT)
    return text === '' ? undefined : { role: 'assistant', text, seq: event.seq, sourceKind: event.data?.message?.source?.kind ?? null }
  }
  return undefined
}

export function createMemoryMaintenanceJob(agent, turnEndEvent) {
  const turn = turnEndEvent?.data?.turn
  if (!Number.isSafeInteger(turn) || turn <= 0 || turnEndEvent?.data?.reason?.kind !== 'completed') return null
  const events = sessionEvents(agent?.session)
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
  const sourceMessages = [...users, finalAssistant]
  const sourceRefs = sourceMessages.map(message => ({ eventSeq: message.seq, turn, role: message.role }))
  const turnStartSeq = events[startIndex].seq
  const recentContext = sessionMessages(agent, MAX_CONTEXT_MESSAGES)
    .filter(message => message.seq < turnStartSeq)
    .map(message => ({ role: message.role, text: message.text.slice(-8192), seq: message.seq }))
  return {
    id: `turn-${turn}-assistant-${finalAssistant.seq}`,
    turn,
    sourceRefs,
    turnMessages: messages.map(({ role, text, seq }) => ({ role, text, seq })),
    recentContext,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function searchableRow(row) {
  return `${row.table}\n${row.key}\n${row.eventId ?? ''}\n${row.keywords?.join(' ') ?? ''}\n${row.characters?.join(' ') ?? ''}\n${row.location?.join(' ') ?? ''}\n${JSON.stringify(row.value)}`.toLocaleLowerCase()
}

function searchTerms(text) {
  const normalized = String(text).toLocaleLowerCase()
  const terms = new Set(normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
  for (const run of normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/gu) ?? []) {
    const points = [...run]
    for (let index = 0; index < points.length - 1; index += 1) terms.add(points.slice(index, index + 2).join(''))
  }
  return [...terms].slice(-128)
}

function boundedPush(list, value, budget) {
  const size = JSON.stringify(value).length
  if (budget.used + size > budget.limit) return false
  budget.used += size
  list.push(value)
  return true
}

function memoryContext(document, contextText) {
  const raw = JSON.stringify({ rows: document.rows, eventEdges: document.eventEdges })
  if (raw.length <= MAX_PROMPT_MEMORY_CHARS) return { complete: true, rows: document.rows, eventEdges: document.eventEdges }
  const terms = searchTerms(contextText)
  const scored = document.rows.map(row => {
    const text = searchableRow(row)
    let matches = 0
    for (const term of terms) if (text.includes(term)) matches += 1
    return { row, matches }
  }).sort((left, right) => right.matches - left.matches || right.row.importance - left.row.importance || right.row.updatedAt - left.row.updatedAt)
  const selected = scored.slice(0, 120).map(item => item.row)
  const selectedIds = new Set(selected.map(row => row.id))
  const selectedEvents = new Set(selected.map(row => row.eventId).filter(Boolean))
  for (const row of document.rows) {
    if (selected.length >= 180) break
    if (row.eventId && selectedEvents.has(row.eventId) && !selectedIds.has(row.id)) {
      selected.push(row)
      selectedIds.add(row.id)
    }
  }
  const eventEdges = document.eventEdges.filter(edge => selectedEvents.has(edge.predecessorEventId) || selectedEvents.has(edge.successorEventId)).slice(0, 240)
  const index = []
  const budget = { used: 0, limit: 72 * 1024 }
  for (const row of document.rows) {
    if (!boundedPush(index, {
      id: row.id,
      table: row.table,
      key: row.key,
      eventId: row.eventId ?? null,
      importance: row.importance,
      recallPolicy: row.recallPolicy,
      keywords: row.keywords,
    }, budget)) break
  }
  return { complete: false, rows: selected, eventEdges, rowIndex: index }
}

export function buildMemoryMaintenancePrompt(job, document) {
  const contextText = [...job.recentContext, ...job.turnMessages].map(message => message.text).join('\n').slice(-160 * 1024)
  const memory = memoryContext(document, contextText)
  const instructions = [
    'Maintain the long-term memory for a roleplay conversation after its final text has been persisted.',
    'Produce only the structured patch requested by the output tool. An empty operations array is valid.',
    '',
    'Responsibilities:',
    '- Add durable facts established by the latest completed turn.',
    '- Correct or delete contradicted facts, merge duplicates, and update an existing row instead of creating a near-duplicate.',
    '- Group multiple memories from the same logical event with one stable eventId.',
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
    `Latest completed turn: ${job.turn}`,
  ].join('\n')
  const narrative = JSON.stringify({ recentContext: job.recentContext, latestTurn: job.turnMessages }).slice(-160 * 1024)
  const snapshotText = JSON.stringify(memory).slice(0, 300 * 1024)
  return `${instructions}\n${narrative}\n\nCurrent memory snapshot (complete=${memory.complete}):\n${snapshotText}`.slice(0, 512 * 1024)
}

function emptyState(sessionId) {
  return { schemaVersion: 1, sessionId, pending: [], failed: [], completed: [] }
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !Number.isSafeInteger(job.turn) || job.turn <= 0) return undefined
  if (!Array.isArray(job.sourceRefs) || !Array.isArray(job.turnMessages) || !Array.isArray(job.recentContext)) return undefined
  return {
    ...clone(job),
    status: job.status === 'running' ? 'pending' : job.status === 'failed' ? 'failed' : 'pending',
    attempts: Number.isSafeInteger(job.attempts) && job.attempts >= 0 ? job.attempts : 0,
  }
}

function normalizeState(raw, sessionId) {
  if (!raw || raw.schemaVersion !== 1 || raw.sessionId !== sessionId) return emptyState(sessionId)
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).map(normalizeJob).filter(Boolean)
  const failed = (Array.isArray(raw.failed) ? raw.failed : []).map(normalizeJob).filter(Boolean).slice(-MAX_FAILED_JOBS)
  const completed = [...new Set((Array.isArray(raw.completed) ? raw.completed : []).filter(value => typeof value === 'string'))].slice(-MAX_COMPLETED_IDS)
  return { schemaVersion: 1, sessionId, pending, failed, completed }
}

async function readState(path, sessionId) {
  try {
    const content = await readFile(path)
    if (content.length > MAX_STATE_BYTES) throw new Error('memory maintenance state exceeds its size limit')
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
  if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) throw new Error('memory maintenance state exceeds its size limit')
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

function operationsForCommit(rawOperations, document, sourceRefs) {
  if (!Array.isArray(rawOperations)) throw new Error('memory maintenance result has no operations array')
  if (rawOperations.length > MAX_PATCH_OPERATIONS) throw new Error(`memory maintenance result exceeds ${MAX_PATCH_OPERATIONS} operations`)
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

export class MemoryMaintenanceManager {
  constructor(options) {
    this.store = options.store
    this.subagents = options.subagents
    this.provider = options.provider ?? 'spawn'
    this.maxAttempts = Math.max(1, Number.isSafeInteger(options.maxAttempts) ? options.maxAttempts : 3)
    this.maxConcurrency = Math.max(1, Number.isSafeInteger(options.maxConcurrency) ? options.maxConcurrency : 2)
    this.maxTokens = Math.max(512, Number.isSafeInteger(options.maxTokens) ? options.maxTokens : 4096)
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
    return join(this.store.rootForWorkspace(this.store.workspaceOf(agent)), 'memory-maintenance', `${name}.json`)
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
      console.error('[dsh-sillytavern] memory maintenance queue failed', error)
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
        reject(signal.reason ?? new Error('memory maintenance aborted'))
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
      const document = await this.store.memorySnapshot(agent, controller.signal)
      if (document.appliedMaintenanceJobs.includes(job.id)) return
      const prompt = buildMemoryMaintenancePrompt(job, document)
      run = await this.subagents.start(this.provider, {
        label: `Memory maintenance turn ${job.turn}`,
        prompt: [{ type: 'text', text: prompt }],
        parent: agent,
        signal: controller.signal,
        agentOptions: { ...this.agentOptions, maxTokens: this.maxTokens },
        outputSchema: MEMORY_PATCH_SCHEMA,
        maxDepth: 1,
        toolFilter: { allow: [] },
        persona: 'You are a dedicated narrative-memory curator. Do not roleplay or continue the story. Reconcile durable facts and event relationships, then submit exactly one structured memory patch.',
      })
      const result = await run.result
      if (result.stopReason !== 'completed' || result.structured === undefined) {
        throw new Error(`memory maintenance subagent stopped with ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}`)
      }
      const latest = await this.store.memorySnapshot(agent, controller.signal)
      if (latest.revision !== document.revision) {
        const error = new Error(`memory revision changed from ${document.revision} to ${latest.revision} while maintenance was running`)
        error.code = 'memory-revision-conflict'
        throw error
      }
      const operations = operationsForCommit(result.structured.operations, latest, job.sourceRefs)
      await this.store.memory(agent, {
        action: 'batch',
        operations,
        expectedRevision: latest.revision,
        maintenanceJobId: job.id,
      }, controller.signal)
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
        await this.execute(agent, job)
        await this.serialState(agent, async () => {
          const state = await this.stateFor(agent)
          state.pending = state.pending.filter(item => item.id !== job.id)
          state.completed.push(job.id)
          state.completed = [...new Set(state.completed)].slice(-MAX_COMPLETED_IDS)
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
        .filter(job => job.sourceRefs.length > 0 && job.sourceRefs.every(ref => compactedSeqs.has(ref.eventSeq)))
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
    for (const controller of this.controllers.values()) controller.abort(new Error('memory maintenance manager disposed'))
    for (const waiter of this.capacityWaiters.splice(0)) {
      waiter.signal.removeEventListener('abort', waiter.aborted)
      waiter.reject(new Error('memory maintenance manager disposed'))
    }
    await Promise.allSettled([...this.workers.values()])
  }
}
