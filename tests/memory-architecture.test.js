import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { createMemoryMaintenanceJob, MEMORY_PATCH_SCHEMA, MemoryMaintenanceManager } from '../src/memory-maintenance.js'
import { assembleSillyTavernPrompt, compactedEventSeqs, selectAutoRecallRows } from '../src/prompt.js'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

const unknownContext = {
  storyTime: { state: 'unknown', label: null, timeline: null, start: null, end: null },
  location: null,
  characters: [],
}

function event(type, seq, data) {
  return { type, seq, time: seq + 1, data }
}

function agent(workspace, id, events = []) {
  return {
    id,
    ctx: {},
    session: {
      id,
      header: { cwd: workspace },
      events,
      snapshotEvents() { return this.events.slice() },
    },
  }
}

function maintenanceJob(id, turn, eventSeq = turn * 10) {
  return {
    id,
    turn,
    sourceRefs: [{ eventSeq, turn, role: 'assistant' }],
    turnMessages: [{ role: 'assistant', text: `final body ${turn}`, seq: eventSeq }],
    recentContext: [],
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function addJobSource(live, job) {
  const source = job.turnMessages.find(message => message.role === 'assistant' && message.seq === job.sourceRefs.find(ref => ref.role === 'assistant')?.eventSeq)
  if (source !== undefined) live.session.events.push(event('assistant/message', source.seq, { message: { content: [{ type: 'text', text: source.text }] } }))
}

test('maintenance structured output schema is accepted by the DSH runtime subset', () => {
  assert.doesNotThrow(() => assertObjectJsonSchema(MEMORY_PATCH_SCHEMA))
  const schemaText = JSON.stringify(MEMORY_PATCH_SCHEMA)
  assert.match(schemaText, /keywords/)
  assert.doesNotMatch(schemaText, /"tags"/)
})

async function waitFor(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail(message)
}

test('automatic recall promotes important rows, gates ordinary rows on source compaction, and injects direct event relations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-recall-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const events = [
    event('user/message', 0, { content: [{ type: 'text', text: 'Alice returns to the archive.' }], source: { kind: 'user' } }),
    event('compaction/summary', 1, { shadowedSeqs: [10, 11] }),
    event('user/message', 10, { content: [{ type: 'text', text: 'Remember the archived scene.' }], source: { kind: 'user' } }),
    event('assistant/message', 11, { message: { content: [{ type: 'text', text: 'The record contains compacted ordinary marker, sealed consequence marker, moon wedding marker, and query only secret marker.' }] } }),
    event('assistant/message', 12, { message: { content: [{ type: 'text', text: 'The record contains uncompacted ordinary marker.' }] } }),
    event('assistant/message', 20, { message: { content: [{ type: 'text', text: 'The record contains high canon marker and future high canon marker.' }] } }),
  ]
  const live = agent(workspace, 'session-recall-prompt', events)
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const card = await store.importCard(Buffer.from(JSON.stringify(minimalCard())), { fileName: 'alice.json' })
  await store.bind(live, card.id)
  const rows = [
    { eventId: 'event-high', key: 'high canon', importance: 0.9, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 20, turn: 3, role: 'assistant' }] },
    { eventId: 'event-old', key: 'compacted ordinary', importance: 0.4, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 10, turn: 1, role: 'user' }, { eventSeq: 11, turn: 1, role: 'assistant' }] },
    { eventId: 'event-related', key: 'sealed consequence', importance: 0.4, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 10, turn: 1, role: 'user' }, { eventSeq: 11, turn: 1, role: 'assistant' }] },
    { eventId: 'event-unrelated', key: 'moon wedding', importance: 0.4, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 10, turn: 1, role: 'user' }, { eventSeq: 11, turn: 1, role: 'assistant' }] },
    { eventId: 'event-next', key: 'future high canon', importance: 0.85, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 20, turn: 3, role: 'assistant' }] },
    { eventId: 'event-waiting', key: 'uncompacted ordinary', importance: 0.7, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 12, turn: 2, role: 'assistant' }] },
    { eventId: 'event-private', key: 'query only secret', importance: 1, recallPolicy: 'query_only', sourceRefs: [] },
  ]
  for (const row of rows) {
    await store.memory(live, {
      action: 'upsert',
      table: 'events',
      value: { note: row.key },
      keywords: [row.key, `${row.key} marker`],
      ...unknownContext,
      ...row,
    })
  }
  await store.memory(live, {
    action: 'event_edge_upsert',
    predecessorEventId: 'event-old',
    successorEventId: 'event-high',
    reason: 'The archived clue enabled the return.',
    sourceRefs: [{ eventSeq: 11, turn: 1, role: 'assistant' }],
  })
  await store.memory(live, {
    action: 'event_edge_upsert',
    predecessorEventId: 'event-old',
    successorEventId: 'event-related',
    reason: 'The archive mechanism reveals this otherwise unrelated consequence.',
    sourceRefs: [{ eventSeq: 11, turn: 1, role: 'assistant' }],
  })
  await store.memory(live, {
    action: 'event_edge_upsert',
    predecessorEventId: 'event-high',
    successorEventId: 'event-next',
    reason: 'Uncompacted relation secret.',
    sourceRefs: [{ eventSeq: 20, turn: 3, role: 'assistant' }],
  })
  live.session.events.splice(2, 4)

  const compacted = compactedEventSeqs(live)
  assert.deepEqual([...compacted], [10, 11])
  const selected = selectAutoRecallRows(store.sessionView(live).memory, [{ role: 'user', text: 'archive', seq: 0 }], compacted)
  assert.deepEqual(selected.map(row => row.key), ['high canon', 'future high canon', 'sealed consequence', 'compacted ordinary'])

  const prompt = await assembleSillyTavernPrompt(live, store.promptState(live), undefined, {
    compactedSeqs: compacted,
    pendingMemoryFallback: [{
      id: 'pending-turn',
      turn: 1,
      turnMessages: [{ role: 'assistant', text: 'Raw compacted scene fallback.', seq: 11 }],
    }],
  })
  assert.match(prompt.system, /Automatically recalled long-term memory/)
  assert.match(prompt.system, /high canon/)
  assert.match(prompt.system, /compacted ordinary/)
  assert.match(prompt.system, /sealed consequence/)
  assert.doesNotMatch(prompt.system, /moon wedding/)
  assert.doesNotMatch(prompt.system, /uncompacted ordinary/)
  assert.doesNotMatch(prompt.system, /query only secret/)
  assert.ok(prompt.system.indexOf('high canon') < prompt.system.indexOf('compacted ordinary'), 'high-importance memory is injected first')
  assert.match(prompt.system, /event-old precedes event-high/)
  assert.match(prompt.system, /event-old precedes event-related/)
  assert.doesNotMatch(prompt.system, /Uncompacted relation secret/)
  assert.match(prompt.system, /Raw compacted scene fallback/)
})

test('maintenance job captures the completed final body, user provenance, and prior conversation context', () => {
  const events = [
    event('user/message', 0, { content: [{ type: 'text', text: 'Earlier question' }], source: { kind: 'user' } }),
    event('assistant/message', 1, { message: { content: [{ type: 'text', text: 'Earlier answer' }], source: { kind: 'model' } } }),
    event('turn/start', 2, { turn: 2 }),
    event('user/message', 3, { content: [{ type: 'text', text: 'Latest user text' }], source: { kind: 'user' } }),
    event('user/message', 4, { content: [{ type: 'text', text: 'Injected runtime context' }], source: { kind: 'context' } }),
    event('assistant/message', 5, { message: { content: [{ type: 'text', text: 'Intermediate assistant text' }], source: { kind: 'model' } } }),
    event('assistant/message', 6, { message: { content: [{ type: 'text', text: 'Persisted final body' }], source: { kind: 'model' } } }),
    event('turn/end', 7, { turn: 2, reason: { kind: 'completed' } }),
  ]
  const live = agent('G:\\fiction', 'session-job-capture', events)
  const job = createMemoryMaintenanceJob(live, events.at(-1))
  assert.equal(job.id, 'turn-2-assistant-6')
  assert.deepEqual(job.sourceRefs, [
    { eventSeq: 3, turn: 2, role: 'user' },
    { eventSeq: 6, turn: 2, role: 'assistant' },
  ])
  assert.deepEqual(job.recentContext.map(message => message.text), ['Earlier question', 'Earlier answer'])
  assert.equal(job.turnMessages.at(-1).text, 'Persisted final body')
  assert.equal(createMemoryMaintenanceJob(live, { ...events.at(-1), data: { turn: 2, reason: { kind: 'aborted' } } }), null)
})

test('background manager is non-blocking, processes each session FIFO, and commits host-owned provenance at the latest revision', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-maintenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const live = agent(workspace, 'session-maintenance')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  await store.ensureSession(live)
  const starts = []
  const releases = []
  const commits = []
  const originalMemory = store.memory.bind(store)
  store.memory = async (...args) => {
    commits.push(structuredClone(args[1]))
    return originalMemory(...args)
  }
  const subagents = {
    async start(provider, options) {
      starts.push({ provider, options })
      let release
      const result = new Promise(resolve => { release = resolve })
      releases.push(release)
      return { result, async dispose() {} }
    },
  }
  const manager = new MemoryMaintenanceManager({ store, subagents, maxConcurrency: 2 })
  t.after(() => manager.dispose())
  const first = maintenanceJob('job-1', 1, 10)
  const second = maintenanceJob('job-2', 2, 20)
  addJobSource(live, first)
  addJobSource(live, second)
  assert.equal(await manager.enqueue(live, first), true)
  assert.equal(await manager.enqueue(live, second), true)
  await waitFor(() => starts.length === 1, 'first FIFO job did not start')
  assert.equal(starts.length, 1, 'enqueue returns without awaiting background generation')
  assert.equal(starts[0].provider, 'spawn')
  assert.equal(starts[0].options.parent, live)
  assert.equal(starts[0].options.outputSchema, MEMORY_PATCH_SCHEMA)
  assert.deepEqual(starts[0].options.toolFilter, { allow: [] })
  assert.equal(starts[0].options.maxDepth, 1)
  await manager.resume(live)
  assert.equal(JSON.parse(await readFile(manager.statePath(live), 'utf8')).pending[0].status, 'running', 'routine recovery must not reset a live worker')
  releases[0]({
    stopReason: 'completed',
    structured: { operations: [{
      action: 'upsert',
      eventId: 'event-one',
      table: 'events',
      key: 'first fact',
      value: { durable: true },
      keywords: ['final body 1', 'body 1'],
      ...unknownContext,
      importance: 0.5,
      recallPolicy: 'after_compaction',
    }] },
  })
  await waitFor(() => starts.length === 2, 'second FIFO job started before or did not follow the first')
  releases[1]({ stopReason: 'completed', structured: { operations: [] } })
  await waitFor(() => manager.workers.size === 0, 'FIFO worker did not settle')

  const memory = await store.memorySnapshot(live)
  assert.equal(memory.rows.length, 1)
  assert.deepEqual(memory.rows[0].sourceRefs, first.sourceRefs)
  assert.equal(commits[0].expectedRevision, 0)
  assert.deepEqual(commits[0].operations[0].sourceRefs, first.sourceRefs)
  const state = JSON.parse(await readFile(manager.statePath(live), 'utf8'))
  assert.deepEqual(state.completed, ['job-1', 'job-2'])
  assert.deepEqual(state.pending, [])
  assert.deepEqual(memory.appliedMaintenanceJobs, ['job-1', 'job-2'])

  await manager.execute(live, first)
  assert.equal(starts.length, 2, 'an applied job marker skips duplicate subagent execution after a crash-window replay')
  assert.equal((await store.memorySnapshot(live)).revision, memory.revision)
})

test('background manager rejects oversized structured patches before committing them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-patch-limit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const live = agent(workspace, 'session-patch-limit')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  await store.ensureSession(live)
  const manager = new MemoryMaintenanceManager({
    store,
    maxAttempts: 1,
    subagents: {
      async start() {
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: { operations: Array.from({ length: 101 }, () => ({ action: 'delete', id: 'missing' })) },
          }),
          async dispose() {},
        }
      },
    },
  })
  t.after(() => manager.dispose())

  await manager.enqueue(live, maintenanceJob('oversized-patch', 1, 10))
  await waitFor(() => manager.workers.size === 0, 'oversized patch worker did not settle')

  const state = JSON.parse(await readFile(manager.statePath(live), 'utf8'))
  assert.equal(state.completed.length, 0)
  assert.equal(state.failed.length, 1)
  assert.match(state.failed[0].lastError, /exceeds 100 operations/)
  assert.equal((await store.memorySnapshot(live)).revision, 0)
})

test('background manager retries transient failures and restores an interrupted persisted job after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-restart-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const live = agent(workspace, 'session-restart')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  await store.ensureSession(live)

  let retryStarts = 0
  const retryManager = new MemoryMaintenanceManager({
    store,
    maxAttempts: 3,
    subagents: {
      async start() {
        retryStarts += 1
        if (retryStarts === 1) throw new Error('temporary model failure')
        if (retryStarts === 2) {
          await store.memory(live, {
            action: 'upsert',
            table: 'manual',
            key: 'concurrent edit',
            value: { changed: true },
            keywords: ['final body 1', 'body 1'],
            ...unknownContext,
            recallPolicy: 'always',
            sourceRefs: [],
          })
        }
        return { result: Promise.resolve({ stopReason: 'completed', structured: { operations: [] } }), async dispose() {} }
      },
    },
  })
  const retryJob = maintenanceJob('retry-job', 1, 10)
  addJobSource(live, retryJob)
  await retryManager.enqueue(live, retryJob)
  await waitFor(() => retryManager.workers.size === 0 && retryStarts === 3, 'transient failure and current-revision conflict were not retried')
  await retryManager.dispose()

  let interruptedStarts = 0
  const interruptedManager = new MemoryMaintenanceManager({
    store,
    subagents: {
      async start(_provider, options) {
        interruptedStarts += 1
        return {
          result: new Promise((_resolve, reject) => {
            const abort = () => reject(options.signal.reason ?? new Error('aborted'))
            if (options.signal.aborted) abort()
            else options.signal.addEventListener('abort', abort, { once: true })
          }),
          async dispose() {},
        }
      },
    },
  })
  const pending = maintenanceJob('restart-job', 2, 20)
  await interruptedManager.enqueue(live, pending)
  await waitFor(() => interruptedStarts === 1, 'interruptible maintenance job did not start')
  assert.deepEqual(await interruptedManager.pendingFallback(live, new Set([20])), [{
    id: 'restart-job',
    turn: 2,
    turnMessages: pending.turnMessages,
  }])
  await interruptedManager.dispose()
  const interruptedState = JSON.parse(await readFile(interruptedManager.statePath(live), 'utf8'))
  assert.equal(interruptedState.pending[0].status, 'pending')
  assert.equal(interruptedState.failed.length, 0)

  let resumedStarts = 0
  const resumedManager = new MemoryMaintenanceManager({
    store,
    subagents: {
      async start() {
        resumedStarts += 1
        return { result: Promise.resolve({ stopReason: 'completed', structured: { operations: [] } }), async dispose() {} }
      },
    },
  })
  t.after(() => resumedManager.dispose())
  await resumedManager.resume(live)
  await waitFor(() => resumedManager.workers.size === 0 && resumedStarts === 1, 'persisted maintenance job was not resumed')
  const resumedState = JSON.parse(await readFile(resumedManager.statePath(live), 'utf8'))
  assert.equal(resumedState.pending.length, 0)
  assert.deepEqual(resumedState.completed, ['retry-job', 'restart-job'])
})

test('background maintenance enforces one global concurrency budget across sessions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-concurrency-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const firstAgent = agent(workspace, 'session-concurrency-a')
  const secondAgent = agent(workspace, 'session-concurrency-b')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  await Promise.all([store.ensureSession(firstAgent), store.ensureSession(secondAgent)])
  let active = 0
  let maximum = 0
  const releases = []
  const subagents = {
    async start() {
      active += 1
      maximum = Math.max(maximum, active)
      let release
      const result = new Promise(resolve => {
        release = value => {
          active -= 1
          resolve(value)
        }
      })
      releases.push(release)
      return { result, async dispose() {} }
    },
  }
  const manager = new MemoryMaintenanceManager({ store, subagents, maxConcurrency: 1 })
  t.after(() => manager.dispose())
  await Promise.all([
    manager.enqueue(firstAgent, maintenanceJob('concurrency-a', 1, 10)),
    manager.enqueue(secondAgent, maintenanceJob('concurrency-b', 1, 11)),
  ])
  await waitFor(() => releases.length === 1, 'first globally limited job did not start')
  await delay(30)
  assert.equal(releases.length, 1)
  releases[0]({ stopReason: 'completed', structured: { operations: [] } })
  await waitFor(() => releases.length === 2, 'second globally limited job did not start')
  releases[1]({ stopReason: 'completed', structured: { operations: [] } })
  await waitFor(() => manager.workers.size === 0, 'globally limited workers did not settle')
  assert.equal(maximum, 1)
})

test('global capacity hands released slots directly to queued workers', async t => {
  const manager = new MemoryMaintenanceManager({ store: {}, subagents: {}, maxConcurrency: 2 })
  t.after(() => manager.dispose())
  const signal = new AbortController().signal
  await manager.acquireCapacity(signal)
  await manager.acquireCapacity(signal)

  const firstQueued = manager.acquireCapacity(signal)
  const secondQueued = manager.acquireCapacity(signal)
  assert.equal(manager.capacityWaiters.length, 2)
  manager.releaseCapacity()
  manager.releaseCapacity()

  let thirdAcquired = false
  const thirdQueued = manager.acquireCapacity(signal).then(() => { thirdAcquired = true })
  await Promise.all([firstQueued, secondQueued])
  await Promise.resolve()
  assert.equal(manager.activeCount, 2)
  assert.equal(thirdAcquired, false, 'a newcomer must not steal a slot already handed to a queued worker')

  manager.releaseCapacity()
  await thirdQueued
  assert.equal(manager.activeCount, 2)
  manager.releaseCapacity()
  manager.releaseCapacity()
  assert.equal(manager.activeCount, 0)
})
