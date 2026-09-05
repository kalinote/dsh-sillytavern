import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { assembleSillyTavernPrompt } from '../src/prompt.js'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

const unknownMemoryContext = {
  storyTime: { state: 'normalized', label: null, timeline: 'story', start: 1, end: null },
  location: null,
  characters: [],
  keywords: ['Alice', 'smiles'],
}

function agent(workspace, id = 'session-test') {
  return {
    id,
    session: {
      header: { cwd: workspace },
      events: [
        {
          type: 'user/message',
          seq: 0,
          data: { content: [{ type: 'text', text: 'I found the archive key.' }] },
        },
        {
          type: 'assistant/message',
          seq: 1,
          data: { message: { content: [{ type: 'text', text: 'Alice smiles.' }] } },
        },
      ],
    },
  }
}

test('persists workspace-scoped cards, worldbooks, bindings, and events', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  const first = new SillyTavernStore({ fallbackWorkspace: workspace })
  const observer = new SillyTavernStore({ fallbackWorkspace: workspace })
  await Promise.all([first.ready, observer.ready])
  const record = await first.importCard(Buffer.from(JSON.stringify(minimalCard({
    description: 'A curious archivist with {{vendor::unknown}}.',
    character_book: { entries: [{ keys: ['archive'], content: 'Archive lore.', enabled: true, insertion_order: 1, extensions: {} }], extensions: {} },
    extensions: { scripts: [{ name: 'untrusted', code: 'globalThis.__executed = true' }] },
  }))), { fileName: 'alice.json' })
  assert.equal(record.scripts[0].enabled, true, 'imported scripts are enabled by default')
  const source = record.scripts[0].source
  const approvedHash = createHash('sha256').update(`javascript\0${source}`).digest('hex')
  assert.equal(record.scripts[0].approvedHash, approvedHash, 'import records the exact source approval hash')
  const trusted = record
  const typeChanged = await first.updateCard(record.id, { scripts: [{ ...trusted.scripts[0], kind: 'html' }] })
  assert.equal(typeChanged.scripts[0].enabled, false, 'changing script type revokes approval')
  assert.equal(typeChanged.scripts[0].approvedHash, null)
  const changed = await first.updateCard(record.id, { scripts: [{ ...trusted.scripts[0], source: `${source}\n// changed` }] })
  assert.equal(changed.scripts[0].enabled, false, 'editing trusted source revokes approval')
  await assert.rejects(first.updateCard('../escape', { cardData: { name: 'x' } }), /SHA-256/)
  const largeField = 'x'.repeat(1536 * 1024)
  const largeScript = 'y'.repeat(6500 * 1024)
  await assert.rejects(first.updateCard(record.id, {
    cardData: { description: largeField, personality: largeField, scenario: largeField, mes_example: largeField },
    scripts: [{ id: 'large', name: 'large', kind: 'javascript', source: largeScript, enabled: false, approvedHash: null }],
  }), /card record exceeds/)
  const live = agent(workspace)
  await first.bind(live, record.id)
  await first.updateCard(record.id, { characterBook: {
    entries: [{ keys: ['archive'], content: 'Archive lore updated: {{char}} guards {{getvar::secret}}. Description: {{description}}', enabled: true, insertion_order: 1, extensions: {} }],
    extensions: {},
  } })
  await first.updateSession(live, { userPersona: { name: 'Morgan', description: 'A visitor.' }, variables: { secret: 'the amber seal' } })
  await first.event(live, { action: 'upsert', table: 'items', key: 'archive key', value: { owner: 'Morgan' }, importance: 0.9, ...unknownMemoryContext })
  await first.saveTemplate({ name: 'Style', content: '<% if (char) { %>Use close third person for <%= char %>.<% } %> Recalled event memories: <%= event.length %>.', position: 'after' })
  await first.selectCard(record.id)
  const autoBound = agent(workspace, 'session-auto-selected')
  await observer.ensureSelectedSession(autoBound)
  assert.equal(observer.sessionView(autoBound).binding.cardId, record.id, 'another live Store sees the workspace selection when explicitly asked to prepare a draft binding')
  await observer.refreshLibrary()
  assert.equal(observer.getCard(record.id).card.data.name, 'Alice', 'a Store started earlier refreshes newly imported workspace cards')
  assert.equal(observer.templates.length, 1, 'a Store started earlier refreshes global templates')
  await observer.ensureSession(live)
  const observedPrompt = await assembleSillyTavernPrompt(live, observer.promptState(live))
  assert.match(observedPrompt.system, /close third person/, 'refreshed templates participate in another Store prompt')

  const prompt = await assembleSillyTavernPrompt(live, first.promptState(live))
  assert.match(prompt.system, /Alice/)
  assert.match(prompt.system, /Archive lore updated: Alice guards the amber seal/)
  assert.match(prompt.system, /Description: A curious archivist/)
  assert.match(prompt.system, /archive key/)
  assert.match(prompt.system, /Morgan/)
  assert.match(prompt.system, /close third person/)
  assert.match(prompt.system, /Recalled event memories: 1/)
  assert.equal(prompt.system.includes('{{'), false)

  await Promise.all(Array.from({ length: 12 }, (_value, index) => first.event(live, {
    action: 'upsert', table: 'events', key: `event-${index}`, value: { index }, importance: 0.5, ...unknownMemoryContext,
  })))
  assert.equal(first.sessionView(live).event.revision, 13)
  assert.equal(first.sessionView(live).event.rows.length, 13)
  assert.equal(Object.hasOwn(first.sessionView(live), 'memory'), false)
  const eventPath = join(stateRoot, 'event', `${createHash('sha256').update(live.id).digest('hex')}.json`)
  const persistedEvent = JSON.parse(await readFile(eventPath, 'utf8'))
  assert.deepEqual(persistedEvent, first.sessionView(live).event)
  assert.equal(persistedEvent.schemaVersion, 5)
  assert.equal((await readdir(stateRoot)).includes('memory'), false)

  const bob = await first.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Bob' }))), { fileName: 'bob.json' })
  const observedBob = agent(workspace, 'session-observer-bob')
  await observer.bind(observedBob, bob.id)
  assert.equal(observer.sessionView(observedBob).card.card.data.name, 'Bob', 'bind refreshes a card imported by another live Store')
  const cardPath = join(stateRoot, 'cards', `${record.id}.json`)
  const legacy = JSON.parse(await readFile(cardPath, 'utf8'))
  legacy.schemaVersion = 1
  legacy.scripts = legacy.scripts.map(script => { const copy = { ...script, enabled: true }; delete copy.approvedHash; return copy })
  await writeFile(cardPath, `${JSON.stringify(legacy)}\n`, 'utf8')

  const second = new SillyTavernStore({ fallbackWorkspace: workspace })
  await second.ready
  assert.equal(second.getCard(record.id).scripts[0].enabled, false, 'legacy enabled scripts are migrated to disabled')
  const migrated = JSON.parse(await readFile(cardPath, 'utf8'))
  assert.equal(migrated.schemaVersion, 4)
  assert.equal(migrated.scripts[0].enabled, false)
  assert.equal(migrated.scripts[0].approvedHash, null)
  await second.ensureSession(live)
  const concurrent = agent(workspace, 'session-concurrent')
  await Promise.all([first.ensureSession(concurrent), second.ensureSession(concurrent)])
  const bindingsRace = await Promise.allSettled([first.bind(concurrent, record.id), second.bind(concurrent, bob.id)])
  assert.equal(bindingsRace.filter(result => result.status === 'fulfilled').length, 1)
  const rejectedBinding = bindingsRace.find(result => result.status === 'rejected')
  assert.equal(rejectedBinding.reason.code, 'replace-confirmation-required', rejectedBinding.reason?.stack)
  assert.equal(first.sessionView(concurrent).binding.cardId, second.sessionView(concurrent).binding.cardId)
  const concurrentCardId = first.sessionView(concurrent).binding.cardId
  const replacementId = concurrentCardId === record.id ? bob.id : record.id
  await assert.rejects(first.bind(concurrent, replacementId, { replace: true, expectedCardId: replacementId }), error => error.code === 'binding-changed')
  await first.bind(concurrent, replacementId, { replace: true, expectedCardId: concurrentCardId })
  assert.equal(first.sessionView(concurrent).binding.cardId, replacementId)
  const restored = second.sessionView(live)
  assert.equal(restored.card.card.data.name, 'Alice')
  assert.equal(restored.binding.userPersona.name, 'Morgan')
  assert.equal(restored.event.rows.length, 13)
  assert.equal(restored.event.revision, 13)
  await Promise.all(Array.from({ length: 10 }, (_value, index) => (index % 2 === 0 ? first : second).event(live, {
    action: 'upsert', table: 'multi-process', key: `key-${index}`, value: { index }, importance: 0.4, ...unknownMemoryContext,
  })))
  const synchronized = await second.event(live, { action: 'query', table: 'multi-process', limit: 20 })
  assert.equal(synchronized.revision, 23)
  assert.equal(synchronized.result.length, 10)
  const bindings = JSON.parse(await readFile(join(workspace, '.dsh', 'sillytavern', 'bindings.json'), 'utf8'))
  assert.equal(bindings.sessions['session-test'].cardId, record.id)
})

test('imports and migrates SillyTavern regex scripts as whole trusted rules', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-regex-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const rule = {
    id: 'regex-options',
    scriptName: '选项',
    findRegex: '/<opinion>([\\s\\S]*?)<\\/opinion>/',
    replaceString: '```html\n<!doctype html><html><body><button>$1</button></body></html>\n```',
    trimStrings: ['<trim>'],
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: 1,
  }
  const record = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ extensions: { regex_scripts: [rule] } }))), { fileName: 'regex.json' })
  assert.equal(record.schemaVersion, 4)
  assert.equal(record.scripts.length, 1, 'one regex object must not be fragmented into field scripts')
  assert.deepEqual(record.scripts[0], {
    id: 'regex-options',
    name: '选项',
    kind: 'regex',
    enabled: true,
    approvedHash: record.scripts[0].approvedHash,
    source: rule.replaceString,
    findRegex: rule.findRegex,
    trimStrings: ['<trim>'],
    placement: [1, 2],
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: 1,
  })
  const material = { findRegex: rule.findRegex, trimStrings: ['<trim>'], placement: [1, 2], markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: 1, source: rule.replaceString }
  assert.equal(record.scripts[0].approvedHash, createHash('sha256').update(`regex\0${JSON.stringify(material)}`).digest('hex'))

  const cardPath = join(stateRoot, 'cards', `${record.id}.json`)
  const fragmented = JSON.parse(await readFile(cardPath, 'utf8'))
  fragmented.schemaVersion = 2
  fragmented.scripts = Object.entries(rule)
    .filter(([_key, value]) => typeof value === 'string')
    .map(([name, source]) => ({ id: createHash('sha256').update(source).digest('hex').slice(0, 16), name, kind: /html/i.test(source) ? 'html' : 'javascript', enabled: true, approvedHash: createHash('sha256').update(`${/html/i.test(source) ? 'html' : 'javascript'}\0${source}`).digest('hex'), source }))
  fragmented.scripts.push({ id: 'genuine-id-script', name: 'id', kind: 'javascript', enabled: false, approvedHash: null, source: 'console.log("genuine")' })
  await writeFile(cardPath, `${JSON.stringify(fragmented)}\n`, 'utf8')
  const migratedStore = new SillyTavernStore({ fallbackWorkspace: workspace })
  await migratedStore.ready
  const migrated = migratedStore.getCard(record.id)
  assert.equal(migrated.schemaVersion, 4)
  assert.equal(migrated.scripts.length, 2)
  assert.equal(migrated.scripts[0].name, '选项')
  assert.equal(migrated.scripts[0].kind, 'regex')
  assert.equal(migrated.scripts[0].enabled, true)
  assert.equal(migrated.scripts[1].name, 'id', 'a genuine script with a fragment-like display name is preserved')

  const trustedWholeLegacy = { ...migrated, schemaVersion: 2, scripts: [{ ...record.scripts[0] }] }
  await writeFile(cardPath, `${JSON.stringify(trustedWholeLegacy)}\n`, 'utf8')
  assert.equal((await migratedStore.refreshCard(record.id)).scripts[0].enabled, true, 'whole-rule approval survives only when the full material hash still matches')
  const wholeLegacy = { ...migrated, schemaVersion: 2, scripts: [{ ...migrated.scripts[0], enabled: false, approvedHash: null }] }
  await writeFile(cardPath, `${JSON.stringify(wholeLegacy)}\n`, 'utf8')
  const refreshed = await migratedStore.refreshCard(record.id)
  assert.equal(refreshed.scripts[0].enabled, false, 'whole-rule disabled state survives schema-2 refresh migration')
  assert.equal(JSON.parse(await readFile(cardPath, 'utf8')).schemaVersion, 4, 'refresh persists migration while holding the card lock')

  const schemaOne = { ...refreshed, schemaVersion: 1, scripts: [{ ...record.scripts[0], enabled: true }] }
  await writeFile(cardPath, `${JSON.stringify(schemaOne)}\n`, 'utf8')
  const disabledLegacy = await migratedStore.refreshCard(record.id)
  assert.equal(disabledLegacy.scripts[0].enabled, false, 'schema-1 regex approvals remain disabled after migration')
  const changed = await migratedStore.updateCard(record.id, { scripts: [{ ...record.scripts[0], findRegex: '/changed/' }] })
  assert.equal(changed.scripts[0].enabled, false, 'editing the matcher revokes the whole-rule approval')
  assert.equal(changed.scripts[0].approvedHash, null)

  const duplicateIds = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Duplicate IDs', extensions: { regex_scripts: [rule, { ...rule, findRegex: '/<status>([\\s\\S]*?)<\\/status>/', scriptName: '状态栏' }] } }))), { fileName: 'duplicate-ids.json' })
  assert.equal(duplicateIds.scripts.length, 2)
  assert.equal(new Set(duplicateIds.scripts.map(script => script.id)).size, 2, 'duplicate imported IDs are deterministically uniquified')
})

test('permanently deletes a card, clears selection, and unbinds loaded workspaces', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-delete-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  const first = new SillyTavernStore({ fallbackWorkspace: workspace })
  const observer = new SillyTavernStore({ fallbackWorkspace: workspace })
  await Promise.all([first.ready, observer.ready])
  const bytes = Buffer.from(JSON.stringify(minimalCard({ extensions: { scripts: [{ name: 'imported', code: 'globalThis.ready = true' }] } })))
  const record = await first.importCard(bytes, { fileName: 'delete-me.json' })
  const firstAgent = agent(workspace, 'session-delete-first')
  const observerAgent = agent(workspace, 'session-delete-observer')
  await first.bind(firstAgent, record.id)
  await observer.bind(observerAgent, record.id)
  await first.selectCard(record.id)

  const deleted = await first.deleteCard(record.id)
  assert.deepEqual({ deleted: deleted.deleted, cardId: deleted.cardId, name: deleted.name, unboundSessions: deleted.unboundSessions, selectedCardId: deleted.selectedCardId }, { deleted: true, cardId: record.id, name: 'Alice', unboundSessions: 2, selectedCardId: null })
  assert.equal(first.getCard(record.id), undefined)
  assert.equal(first.listCards().length, 0)
  assert.equal(first.selectionView().selectedCardId, null)
  assert.equal(first.sessionView(firstAgent).binding, null)
  await assert.rejects(readFile(join(stateRoot, 'cards', `${record.id}.json`)), error => error.code === 'ENOENT')
  await assert.rejects(readFile(join(stateRoot, 'originals', `${record.id}.json`)), error => error.code === 'ENOENT')

  await observer.refreshLibrary()
  assert.equal(observer.getCard(record.id), undefined, 'other Stores evict records whose files were deleted')
  await observer.ensureSession(observerAgent)
  assert.equal(observer.sessionView(observerAgent).binding, null, 'persisted bindings are removed for other Stores too')
  await assert.rejects(first.selectCard(record.id), /not found/)
  await assert.rejects(first.deleteCard(record.id), /not found/)

  const restored = await first.importCard(bytes, { fileName: 'delete-me.json' })
  assert.equal(restored.id, record.id)
  assert.equal(restored.scripts[0].enabled, true, 'reimport after deletion creates a fresh default-enabled script record')
})

test('serializes deletion against selection, refresh, and in-flight session loads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sillytavern-delete-races-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  const observer = new SillyTavernStore({ fallbackWorkspace: workspace })
  await Promise.all([store.ready, observer.ready])

  const selectionCard = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Selection Race' }))), { fileName: 'selection.json' })
  const originalLoad = store.loadCardRecord.bind(store)
  let enterSelection
  let releaseSelection
  const selectionEntered = new Promise(resolve => { enterSelection = resolve })
  const selectionGate = new Promise(resolve => { releaseSelection = resolve })
  let blockSelection = true
  store.loadCardRecord = async (...args) => {
    const result = await originalLoad(...args)
    if (blockSelection && args[1] === selectionCard.id) {
      blockSelection = false
      enterSelection()
      await selectionGate
    }
    return result
  }
  const selecting = store.selectCard(selectionCard.id)
  await selectionEntered
  const deletingSelection = store.deleteCard(selectionCard.id)
  releaseSelection()
  await Promise.all([selecting, deletingSelection])
  store.loadCardRecord = originalLoad
  assert.equal(store.selectionView().selectedCardId, null)
  assert.equal(store.getCard(selectionCard.id), undefined)
  const persistedSelection = JSON.parse(await readFile(join(stateRoot, 'selection.json'), 'utf8'))
  assert.equal(persistedSelection.selectedCardId, null)

  const refreshCard = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Refresh Race' }))), { fileName: 'refresh.json' })
  const originalObserverLoad = observer.loadCardRecord.bind(observer)
  let enterRefresh
  let releaseRefresh
  const refreshEntered = new Promise(resolve => { enterRefresh = resolve })
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve })
  let blockRefresh = true
  observer.loadCardRecord = async (...args) => {
    const result = await originalObserverLoad(...args)
    if (blockRefresh && args[1] === refreshCard.id) {
      blockRefresh = false
      enterRefresh()
      await refreshGate
    }
    return result
  }
  const refreshing = observer.refreshLibrary()
  await refreshEntered
  const deletingRefresh = store.deleteCard(refreshCard.id)
  releaseRefresh()
  await Promise.all([refreshing, deletingRefresh])
  observer.loadCardRecord = originalObserverLoad
  await observer.refreshLibrary()
  assert.equal(observer.getCard(refreshCard.id), undefined, 'a refresh snapshot cannot repopulate a card deleted while refresh was in flight')

  const loadCard = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Load Race' }))), { fileName: 'load.json' })
  const loadingAgent = agent(workspace, 'session-delete-load-race')
  await store.bind(loadingAgent, loadCard.id)
  store.sessions.delete(store.sessionKey(loadingAgent))
  store.cards.delete(loadCard.id)
  const loadBeforeSession = store.loadCardRecord.bind(store)
  let enterLoad
  let releaseLoad
  const loadEntered = new Promise(resolve => { enterLoad = resolve })
  const loadGate = new Promise(resolve => { releaseLoad = resolve })
  let blockLoad = true
  store.loadCardRecord = async (...args) => {
    const result = await loadBeforeSession(...args)
    if (blockLoad && args[1] === loadCard.id) {
      blockLoad = false
      enterLoad()
      await loadGate
    }
    return result
  }
  const loading = store.ensureSession(loadingAgent)
  await loadEntered
  const deletingLoad = store.deleteCard(loadCard.id)
  releaseLoad()
  await Promise.all([loading, deletingLoad])
  store.loadCardRecord = loadBeforeSession
  assert.equal(store.sessionView(loadingAgent).binding, null, 'delete clears a session load that started before physical removal')
})
