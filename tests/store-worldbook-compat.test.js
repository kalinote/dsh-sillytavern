import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SillyTavernStore } from '../src/store.js'

function partialEntry(name, extra = {}) {
  return { name, strategy: { type: 'selective', keys: [/lore/giu] }, content: `${name} content`, ...extra }
}

test('implements TavernHelper 4.9.3 named worldbook create/read/replace contracts without duplicating the native resource', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-worldbook-compat-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready

  assert.equal(await store.createTavernWorldbook('Lore', [partialEntry('first')]), true)
  assert.equal(await store.createTavernWorldbook('Lore', [partialEntry('ignored')]), false)
  assert.deepEqual(store.getWorldbookNames(), ['Lore'])
  const initial = store.getTavernWorldbookSnapshot('Lore')
  assert.equal(initial.revision, 0)
  assert.equal(initial.worldbook[0].uid, 0)
  assert.equal(initial.worldbook[0].position.depth, 4)
  assert.ok(initial.worldbook[0].strategy.keys[0] instanceof RegExp)
  assert.equal(initial.worldbook[0].strategy.keys[0].flags, 'giu')
  assert.equal(store.getWorldbook(initial.id).book.entries[0].comment, 'first')

  await store.replaceTavernWorldbook('Lore', [{ uid: 7, name: 'replacement', content: 'new' }], { expectedRevision: 0 })
  const replaced = store.getTavernWorldbookSnapshot('Lore')
  assert.equal(replaced.id, initial.id, 'named replacement updates the existing DSH resource')
  assert.equal(replaced.revision, 1)
  assert.deepEqual(replaced.worldbook.map(entry => [entry.uid, entry.name, entry.content]), [[7, 'replacement', 'new']])

  assert.equal(await store.createOrReplaceTavernWorldbook('Lore', [{ name: 'again' }], { expectedRevision: 1 }), false)
  assert.equal(await store.createOrReplaceTavernWorldbook('Second', [{ name: 'created' }]), true)
  assert.deepEqual(store.getWorldbookNames(), ['Lore', 'Second'])
})

test('creates and deletes entries atomically with stable UIDs and revision CAS', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-worldbook-entries-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  await store.createTavernWorldbook('Entries', [{ uid: 4, name: 'keep' }, { uid: 4, name: 'drop' }])

  const created = await store.createTavernWorldbookEntries('Entries', [{ name: 'new' }, { uid: 4, name: 'collision' }], { expectedRevision: 0 })
  assert.deepEqual(created.worldbook.map(entry => entry.uid), [4, 5, 0, 6])
  assert.deepEqual(created.new_entries.map(entry => entry.uid), [0, 6])
  assert.equal(store.getTavernWorldbookSnapshot('Entries').revision, 1)

  await assert.rejects(
    store.createTavernWorldbookEntries('Entries', [{}], { expectedRevision: 0 }),
    error => error.code === 'worldbook-revision-conflict'
      && error.details.worldbookName === 'Entries'
      && error.details.expectedRevision === 0
      && error.details.actualRevision === 1,
  )
  const deleted = await store.deleteTavernWorldbookEntries('Entries', entry => entry.name === 'drop' || entry.name === 'collision', { expectedRevision: 1 })
  assert.deepEqual(deleted.deleted_entries.map(entry => entry.name), ['drop', 'collision'])
  assert.deepEqual(deleted.worldbook.map(entry => entry.name), ['keep', 'new'])

  const restored = new SillyTavernStore({ fallbackWorkspace: workspace })
  await restored.ready
  assert.equal(restored.getTavernWorldbookSnapshot('Entries').revision, 2)
  assert.deepEqual(restored.getTavernWorldbook('Entries').map(entry => entry.name), ['keep', 'new'])
})

test('serializes same-name creation and CAS updates across independent store instances', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-worldbook-race-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const first = new SillyTavernStore({ fallbackWorkspace: workspace })
  const second = new SillyTavernStore({ fallbackWorkspace: workspace })
  await Promise.all([first.ready, second.ready])

  const created = await Promise.all([
    first.createTavernWorldbook('Shared', [{ name: 'first' }]),
    second.createTavernWorldbook('Shared', [{ name: 'second' }]),
  ])
  assert.deepEqual(created.slice().sort(), [false, true])
  assert.deepEqual(first.getWorldbookNames(), ['Shared'])
  assert.deepEqual(second.getWorldbookNames(), ['Shared'])
  const files = await readdir(join(workspace, '.dsh', 'sillytavern', 'worldbooks'))
  assert.equal(files.filter(name => name.endsWith('.json')).length, 1)

  const writes = await Promise.allSettled([
    first.replaceTavernWorldbook('Shared', [{ name: 'A' }], { expectedRevision: 0 }),
    second.replaceTavernWorldbook('Shared', [{ name: 'B' }], { expectedRevision: 0 }),
  ])
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = writes.find(result => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'worldbook-revision-conflict')
  assert.equal(rejected.reason.details.actualRevision, 1)
})

test('loads legacy schema-1 worldbooks at revision zero and upgrades them on mutation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-worldbook-legacy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const directory = join(workspace, '.dsh', 'sillytavern', 'worldbooks')
  const id = 'legacy-book'
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${id}.json`), JSON.stringify({
    schemaVersion: 1,
    id,
    name: 'Legacy',
    book: { name: 'Legacy', entries: [{ id: 3, comment: 'old', content: 'kept', constant: true, extensions: {} }], extensions: {} },
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }))

  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  assert.equal(store.getTavernWorldbookSnapshot('Legacy').revision, 0)
  await store.createTavernWorldbookEntries('Legacy', [{ name: 'new' }], { expectedRevision: 0 })
  const saved = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'))
  assert.equal(saved.schemaVersion, 2)
  assert.equal(saved.revision, 1)
  assert.deepEqual(store.getTavernWorldbook('Legacy').map(entry => entry.name), ['old', 'new'])

  assert.equal(await store.deleteTavernWorldbook('missing'), false)
  assert.equal(await store.deleteTavernWorldbook('Legacy', { expectedRevision: 1 }), true)
  assert.deepEqual(store.getWorldbookNames(), [])
})
