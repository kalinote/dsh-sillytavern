import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

const memoryContext = {
  storyTime: { state: 'normalized', label: null, timeline: 'turns', start: 1, end: null },
  location: null,
  characters: [],
  importance: 0.5,
  recallPolicy: 'after_compaction',
}

function event(type, seq, data) {
  return { type, seq, time: seq + 1, data }
}

function agent(workspace, id, events = [], header = {}) {
  return {
    id,
    ctx: {},
    session: {
      id,
      header: { cwd: workspace, ...header },
      events,
      snapshotEvents() { return this.events.slice() },
    },
  }
}

function forkAgent(workspace, id, parent, cut) {
  const child = agent(workspace, id, parent.session.events.slice(0, cut), {
    parentSession: parent.id,
    isSeeded: true,
  })
  child.session.inheritedEventCount = cut
  return child
}

test('a synchronous fork snapshot inherits the source role and complete runtime state despite another selected draft', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-fork-live-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const alice = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Alice' }))), { fileName: 'alice.json' })
  const bob = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Bob' }))), { fileName: 'bob.json' })
  const lore = await store.createWorldbook({ name: 'Alice lore', entries: [{ keys: ['archive'], content: 'Alice only', enabled: true, insertion_order: 1, extensions: {} }], extensions: {} })
  const template = await store.saveTemplate({ name: 'Alice format', content: 'Keep the archive format.', enabled: true })
  const inheritedEvents = [
    event('turn/start', 0, { turn: 1 }),
    event('user/message', 1, { content: [{ type: 'text', text: 'Enter the archive.' }], source: { kind: 'user' } }),
    event('assistant/message', 2, { message: { content: [{ type: 'text', text: 'Alice opens the archive door.' }] } }),
    event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }),
  ]
  const parent = agent(workspace, 'parent-alice', inheritedEvents)
  await store.bind(parent, alice.id)
  await store.updateSession(parent, {
    userPersona: { name: 'Morgan', description: 'Archive visitor' },
    worldbookId: lore.id,
    variables: { route: 'alice', counter: 4 },
    templateIds: [template.id],
    scriptInjections: [{ id: 'alice-script', text: 'Preserve Alice formatting.', order: 1 }],
    chatMetadata: { scenario: 'archive' },
  })
  await store.startSession(parent)
  await store.event(parent, {
    action: 'upsert', eventId: 'alice-arrival', table: 'events', key: 'arrival', value: { actor: 'Alice' },
    keywords: ['Alice', 'archive'], sourceRefs: [{ eventSeq: 2, turn: 1, role: 'assistant' }], ...memoryContext,
  })

  const draft = agent(workspace, 'draft-bob')
  await store.bind(draft, bob.id)
  await store.selectCard(bob.id, draft)

  const child = forkAgent(workspace, 'child-alice', parent, inheritedEvents.length)
  assert.equal(store.captureForkPoint(child.session, parent), true)
  await store.ensureSession(child)
  const view = store.sessionView(child)

  assert.equal(view.card.card.data.name, 'Alice')
  assert.equal(view.worldbookId, lore.id)
  assert.deepEqual(view.binding.userPersona, { name: 'Morgan', description: 'Archive visitor' })
  assert.deepEqual(view.binding.variables, { route: 'alice', counter: 4 })
  assert.deepEqual(view.binding.templateIds, [template.id])
  assert.deepEqual(view.binding.scriptInjections.map(item => item.id), ['alice-script'])
  assert.deepEqual(view.binding.chatMetadata, { scenario: 'archive' })
  assert.equal(view.event.rows[0].key, 'arrival')
  assert.deepEqual(view.fork.inheritance, {
    status: 'inherited', exact: true, source: 'fork-point', repairable: true,
    binding: 'exact', event: 'exact', compatChat: 'exact',
  })
  await store.ensureSelectedSession(child)
  assert.equal(store.sessionView(child).card.card.data.name, 'Alice', 'workspace selection cannot overwrite a seeded fork')
})

test('historical inheritance excludes event rows with any source beyond the fork boundary and repairs legacy bindings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-fork-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const alice = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Alice' }))), { fileName: 'alice.json' })
  const bob = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Bob' }))), { fileName: 'bob.json' })
  const parent = agent(workspace, 'history-parent', [
    event('turn/start', 0, { turn: 1 }), event('user/message', 1, { content: 'before' }),
    event('assistant/message', 2, { message: { content: 'before answer' } }), event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }),
  ])
  await store.bind(parent, alice.id)
  await store.updateSession(parent, { variables: { phase: 'at-cut' } })
  await store.event(parent, { action: 'upsert', eventId: 'before', table: 'events', key: 'before', value: { kept: true }, keywords: ['before', 'answer'], sourceRefs: [{ eventSeq: 2, turn: 1, role: 'assistant' }], ...memoryContext })
  parent.session.events.push(
    event('turn/start', 4, { turn: 2 }), event('user/message', 5, { content: 'future' }),
    event('assistant/message', 6, { message: { content: 'future answer' } }), event('turn/end', 7, { turn: 2, reason: { kind: 'completed' } }),
  )
  await store.updateSession(parent, { variables: { phase: 'future' } })
  await store.event(parent, { action: 'upsert', eventId: 'future', table: 'events', key: 'future', value: { leaked: true }, keywords: ['future', 'answer'], sourceRefs: [{ eventSeq: 6, turn: 2, role: 'assistant' }], ...memoryContext })
  await store.event(parent, { action: 'upsert', eventId: 'mixed', table: 'events', key: 'mixed', value: { leaked: true }, keywords: ['before', 'future'], sourceRefs: [{ eventSeq: 2, turn: 1, role: 'assistant' }, { eventSeq: 6, turn: 2, role: 'assistant' }], ...memoryContext })

  const restored = new SillyTavernStore({ fallbackWorkspace: workspace })
  await restored.ready
  const child = forkAgent(workspace, 'historical-child', parent, 4)
  await restored.ensureSession(child)
  const view = restored.sessionView(child)
  assert.equal(view.card.card.data.name, 'Alice')
  assert.deepEqual(view.binding.variables, { phase: 'at-cut' })
  assert.deepEqual(view.event.rows.map(row => row.key), ['before'])
  assert.equal(view.fork.inheritance.source, 'history')
  assert.equal(view.fork.inheritance.event, 'source-bounded')
  assert.equal(view.fork.inheritance.compatChat, 'native-only')
  assert.equal(view.fork.inheritance.exact, false)

  const legacy = agent(workspace, 'legacy-child', parent.session.events.slice(0, 4))
  await restored.bind(legacy, bob.id)
  legacy.session.header.parentSession = parent.id
  legacy.session.header.isSeeded = true
  legacy.session.inheritedEventCount = 4
  const repaired = await restored.repairForkInheritance(legacy)
  assert.equal(repaired.card.card.data.name, 'Alice')
  assert.deepEqual(repaired.binding.variables, { phase: 'at-cut' })
  assert.deepEqual(repaired.event.rows.map(row => row.key), ['before'])
  assert.equal(repaired.fork.inheritance.status, 'inherited')
})

test('a fork with no source snapshot never auto-binds the workspace selection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-fork-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const bob = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Bob' }))), { fileName: 'bob.json' })
  await store.selectCard(bob.id, workspace)
  const missingParent = agent(workspace, 'missing-parent', [])
  const child = forkAgent(workspace, 'missing-child', missingParent, 0)
  await store.ensureSession(child)
  await assert.rejects(store.ensureSelectedSession(child), error => error.code === 'fork-inheritance-unavailable')
  assert.equal(store.sessionView(child).binding, null)
  assert.equal(store.sessionView(child).fork.inheritance.status, 'unavailable')
})

test('a fresh story keeps identity settings but resets conversation runtime state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-fork-fresh-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const alice = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Alice', alternate_greetings: ['Second opening'] }))), { fileName: 'alice.json' })
  const lore = await store.createWorldbook({ name: 'Selected lore', entries: [], extensions: {} })
  const template = await store.saveTemplate({ name: 'Selected format', content: 'format', enabled: true })
  const parent = agent(workspace, 'fresh-parent')
  await store.bind(parent, alice.id)
  await store.updateSession(parent, {
    userPersona: { name: 'Morgan', description: 'Visitor' }, worldbookId: lore.id, templateIds: [template.id],
    variables: { location: 'future city', affection: 99 }, chatMetadata: { chapter: 12 },
    scriptInjections: [{ id: 'temporary', text: 'one turn only' }], openingSwipeId: 1,
  })
  await store.startSession(parent)
  const child = forkAgent(workspace, 'fresh-child', parent, 0)
  store.prepareFreshFork(child.id, parent)
  assert.equal(store.captureForkPoint(child.session, parent), true)
  await store.ensureSession(child)
  const view = store.sessionView(child)
  assert.equal(view.card.card.data.name, 'Alice')
  assert.deepEqual(view.binding.userPersona, { name: 'Morgan', description: 'Visitor' })
  assert.equal(view.binding.worldbookId, lore.id)
  assert.deepEqual(view.binding.templateIds, [template.id])
  assert.deepEqual(view.binding.variables, {})
  assert.deepEqual(view.binding.chatMetadata, {})
  assert.deepEqual(view.binding.scriptInjections, [])
  assert.equal(view.binding.openingSwipeId, 0)
  assert.equal(view.binding.startedAt, null)
  assert.equal(view.event.rows.length, 0)
  assert.equal(view.compatChat.messages.length, 0)
})
