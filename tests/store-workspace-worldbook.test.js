import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

const unknownMemoryContext = {
  storyTime: { state: 'unknown', label: null, timeline: null, start: null, end: null },
  location: null,
  characters: [],
  keywords: ['Alice', 'shared-key'],
}

function agent(workspace, id) {
  return { id, session: { header: { cwd: workspace }, events: [] } }
}

function cardBytes(name, worldbook) {
  return Buffer.from(JSON.stringify(minimalCard({ name, ...(worldbook === undefined ? {} : { character_book: worldbook }) })))
}

function book(name, content, extra = {}) {
  return { name, entries: [{ keys: ['lore'], content, enabled: true, insertion_order: 1, extensions: {} }], extensions: {}, ...extra }
}

test('stores every resource below its workspace and isolates worldbook libraries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-workspaces-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const firstWorkspace = join(root, 'first')
  const secondWorkspace = join(root, 'second')
  const store = new SillyTavernStore({ fallbackWorkspace: firstWorkspace, globalRoot: join(root, 'must-not-be-used') })
  await store.ready

  const first = await store.importCard(cardBytes('Alice', book('Shared name', 'first')), { context: firstWorkspace, fileName: 'alice.json' })
  const second = await store.importCard(cardBytes('Bob', book('Shared name', 'second')), { context: secondWorkspace, fileName: 'bob.json' })
  assert.equal(store.listCards(firstWorkspace).length, 1)
  assert.equal(store.listCards(secondWorkspace).length, 1)
  assert.equal(store.listWorldbooks(firstWorkspace)[0].name, 'Shared name')
  assert.equal(store.listWorldbooks(secondWorkspace)[0].name, 'Shared name')
  assert.equal(store.getCard(first.id, secondWorkspace), undefined)
  assert.equal(store.getCard(second.id, firstWorkspace), undefined)
  await readFile(join(firstWorkspace, '.dsh', 'sillytavern', 'cards', `${first.id}.json`))
  await readFile(join(secondWorkspace, '.dsh', 'sillytavern', 'worldbooks', `${second.defaultWorldbookId}.json`))
  await assert.rejects(readFile(join(root, 'must-not-be-used', 'cards', `${first.id}.json`)), error => error.code === 'ENOENT')
  assert.equal(Object.hasOwn(first.card.data, 'character_book'), false, 'embedded lore is import input, not stored card runtime data')
})

test('imports named worldbooks with explicit error, overwrite, and save-as contracts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-worldbook-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready

  const first = await store.importCard(cardBytes('Alice', book('Lore', 'old', { recursive_scanning: true })), { fileName: 'alice.json' })
  await assert.rejects(
    store.importCard(cardBytes('Bob', book('Lore', 'new')), { fileName: 'bob.json' }),
    error => error.code === 'worldbook-name-conflict' && error.details.worldbookName === 'Lore' && error.details.existingWorldbookId === first.defaultWorldbookId,
  )
  const saved = await store.importCard(cardBytes('Bob', book('Lore', 'saved')), { fileName: 'bob.json', worldbookConflict: { action: 'save-as', name: 'Lore copy' } })
  assert.equal(store.getWorldbook(saved.defaultWorldbookId).name, 'Lore copy')

  const overwritten = await store.importCard(cardBytes('Carol', book('Lore', 'replacement')), { fileName: 'carol.json', worldbookConflict: { action: 'overwrite' } })
  assert.equal(overwritten.defaultWorldbookId, first.defaultWorldbookId, 'overwrite preserves the target resource id')
  const lore = store.getWorldbook(first.defaultWorldbookId)
  assert.equal(lore.book.entries[0].content, 'replacement')
  assert.equal(Object.hasOwn(lore.book, 'recursive_scanning'), false, 'overwrite replaces the whole book instead of merging')
})

test('freezes inherited worldbook only on first real session start', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-session-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const card = await store.importCard(cardBytes('Alice', book('First', 'one')), { fileName: 'alice.json' })
  const secondBook = await store.createWorldbook(book('Second', 'two'))
  const other = await store.importCard(cardBytes('Bob'), { fileName: 'bob.json' })

  const explicit = agent(workspace, 'explicit-session')
  await store.bind(explicit, card.id)
  assert.equal(store.sessionView(explicit).binding.startedAt, null)
  assert.equal(store.sessionView(explicit).binding.worldbookId, null)
  assert.equal(store.sessionView(explicit).worldbookId, card.defaultWorldbookId)
  await store.updateCard(card.id, { defaultWorldbookId: secondBook.id })
  assert.equal(store.sessionView(explicit).worldbookId, secondBook.id, 'draft inheritance follows the current card default')
  await store.updateSession(explicit, { worldbookId: card.defaultWorldbookId })
  await store.startSession(explicit)
  assert.equal(store.sessionView(explicit).binding.worldbookId, card.defaultWorldbookId)
  await assert.rejects(store.bind(explicit, other.id, { replace: true, expectedCardId: card.id }), error => error.code === 'session-started')

  const inherited = agent(workspace, 'inherited-session')
  await store.bind(inherited, card.id)
  await store.startSession(inherited)
  assert.equal(store.sessionView(inherited).binding.worldbookId, secondBook.id)
  await store.updateCard(card.id, { defaultWorldbookId: card.defaultWorldbookId })
  assert.equal(store.sessionView(inherited).worldbookId, secondBook.id, 'started session keeps the frozen reference')
})

test('isolates same-card session persona, worldbook, memory, templates, variables, and prompt injections', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-session-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const card = await store.importCard(cardBytes('Alice'), { fileName: 'alice.json' })
  const firstBook = await store.createWorldbook(book('First session lore', 'first-only'))
  const secondBook = await store.createWorldbook(book('Second session lore', 'second-only'))
  const firstTemplate = await store.saveTemplate({ name: 'First style', content: 'first-template', position: 'after', order: 1, enabled: true })
  const secondTemplate = await store.saveTemplate({ name: 'Second style', content: 'second-template', position: 'after', order: 1, enabled: true })
  const first = agent(workspace, 'same-card-first')
  const second = agent(workspace, 'same-card-second')
  await store.bind(first, card.id)
  await store.bind(second, card.id)
  await store.updateSession(first, {
    userPersona: { name: 'Morgan', description: 'First persona' },
    variables: { route: 'first' },
    worldbookId: firstBook.id,
    templateIds: [firstTemplate.id],
    scriptInjections: [{ id: 'first-injection', text: 'first prompt injection', order: 1 }],
  })
  await store.updateSession(second, {
    userPersona: { name: 'Riley', description: 'Second persona' },
    variables: { route: 'second' },
    worldbookId: secondBook.id,
    templateIds: [secondTemplate.id],
    scriptInjections: [{ id: 'second-injection', text: 'second prompt injection', order: 1 }],
  })
  first.session.events.push({ type: 'assistant/message', seq: 0, data: { message: { content: 'Alice remembers shared-key for the first session.' } } })
  second.session.events.push({ type: 'assistant/message', seq: 0, data: { message: { content: 'Alice remembers shared-key for the second session.' } } })
  await store.memory(first, { action: 'upsert', table: 'facts', key: 'shared-key', value: { owner: 'first' }, ...unknownMemoryContext })
  await store.memory(second, { action: 'upsert', table: 'facts', key: 'shared-key', value: { owner: 'second' }, ...unknownMemoryContext })
  await Promise.all([store.startSession(first), store.startSession(second)])

  const firstView = store.sessionView(first)
  const secondView = store.sessionView(second)
  assert.equal(firstView.card.id, secondView.card.id, 'both sessions use the same immutable card resource')
  assert.equal(firstView.binding.userPersona.name, 'Morgan')
  assert.equal(secondView.binding.userPersona.name, 'Riley')
  assert.equal(firstView.binding.variables.route, 'first')
  assert.equal(secondView.binding.variables.route, 'second')
  assert.equal(firstView.worldbookId, firstBook.id)
  assert.equal(secondView.worldbookId, secondBook.id)
  assert.equal(firstView.memory.rows[0].value.owner, 'first')
  assert.equal(secondView.memory.rows[0].value.owner, 'second')
  assert.deepEqual(store.promptState(first).templates.map(item => item.id), [firstTemplate.id])
  assert.deepEqual(store.promptState(second).templates.map(item => item.id), [secondTemplate.id])
  assert.equal(store.promptState(first).binding.scriptInjections[0].text, 'first prompt injection')
  assert.equal(store.promptState(second).binding.scriptInjections[0].text, 'second prompt injection')

  const restored = new SillyTavernStore({ fallbackWorkspace: workspace })
  await restored.ready
  await Promise.all([restored.ensureSession(first), restored.ensureSession(second)])
  assert.equal(restored.sessionView(first).binding.userPersona.name, 'Morgan')
  assert.equal(restored.sessionView(second).worldbookId, secondBook.id)
  assert.equal(restored.sessionView(first).memory.rows[0].value.owner, 'first')
  assert.equal(restored.sessionView(second).memory.rows[0].value.owner, 'second')
})

test('reports references, clears them on worldbook deletion, and confirms coupled card deletion before mutation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-worldbook-delete-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const first = await store.importCard(cardBytes('Alice', book('Lore', 'one')), { fileName: 'alice.json' })
  const second = await store.importCard(cardBytes('Bob'), { fileName: 'bob.json' })
  await store.updateCard(second.id, { defaultWorldbookId: first.defaultWorldbookId })
  const live = agent(workspace, 'live-session')
  await store.bind(live, second.id)
  await store.startSession(live)

  const references = await store.inspectWorldbookReferences(first.defaultWorldbookId)
  assert.deepEqual(new Set(references.cards.map(item => item.id)), new Set([first.id, second.id]))
  assert.equal(references.sessions[0].sessionId, live.id)
  await assert.rejects(store.deleteWorldbook(first.defaultWorldbookId, { rejectIfReferenced: true }), error => error.code === 'worldbook-references-required' && error.details.references.sessions.length === 1)
  assert.notEqual(store.getWorldbook(first.defaultWorldbookId), undefined)

  await assert.rejects(store.deleteCard(first.id, { deleteWorldbook: true }), error => error.code === 'worldbook-references-required')
  assert.notEqual(store.getCard(first.id), undefined, 'reference confirmation happens before deleting the card')
  await assert.rejects(store.deleteCard(second.id, { rejectSessionIds: [live.id] }), error => error.code === 'card-references-required')

  await store.deleteWorldbook(first.defaultWorldbookId)
  assert.equal(store.getCard(first.id).defaultWorldbookId, null)
  assert.equal(store.getCard(second.id).defaultWorldbookId, null)
  assert.equal(store.sessionView(live).binding.worldbookId, null)
})
