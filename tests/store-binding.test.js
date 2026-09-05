import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

function pauseBeforeBindingLock(store, t) {
  // refreshCard runs after the session load and before the binding lock.
  const loaded = Promise.withResolvers()
  const proceed = Promise.withResolvers()
  t.after(() => proceed.resolve())
  const refreshCard = store.refreshCard.bind(store)
  store.refreshCard = async (...args) => {
    const card = await refreshCard(...args)
    loaded.resolve()
    await proceed.promise
    return card
  }
  return { loaded: loaded.promise, resume: () => proceed.resolve() }
}

for (const conflict of ['replace-confirmation-required', 'binding-changed', 'session-started']) {
  test(`refreshes binding caches before rejecting ${conflict}`, { timeout: 10_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-st-binding-conflict-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    const winner = new SillyTavernStore({ fallbackWorkspace: workspace })
    await winner.ready
    const alice = await winner.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Alice' }))), { fileName: 'alice.json' })
    const bob = await winner.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Bob' }))), { fileName: 'bob.json' })
    const live = { id: 'shared-session', session: { header: { cwd: workspace }, events: [] } }
    if (conflict === 'binding-changed') await winner.bind(live, bob.id)
    if (conflict === 'session-started') await winner.bind(live, alice.id)
    const contender = new SillyTavernStore({ fallbackWorkspace: workspace })
    await contender.ready

    // Pause after the contender has loaded its session, before it locks bindings.
    // The winner then commits, so the stale-cache interleaving is deterministic.
    const paused = pauseBeforeBindingLock(contender, t)
    const options = conflict === 'replace-confirmation-required' ? {}
      : { replace: true, expectedCardId: conflict === 'binding-changed' ? bob.id : alice.id }
    const rejected = assert.rejects(contender.bind(live, bob.id, options), error => error.code === conflict)
    await paused.loaded
    const stale = contender.sessionView(live).binding
    if (conflict === 'replace-confirmation-required') assert.equal(stale, null)
    if (conflict === 'binding-changed') assert.equal(stale.cardId, bob.id)
    if (conflict === 'session-started') assert.equal(stale.startedAt, null)

    if (conflict === 'session-started') await winner.startSession(live)
    else await winner.bind(live, alice.id, conflict === 'binding-changed' ? { replace: true, expectedCardId: bob.id } : {})
    const path = join(workspace, '.dsh', 'sillytavern', 'bindings.json')
    const committed = await readFile(path, 'utf8')
    const expected = JSON.parse(committed).sessions[live.id]
    paused.resume()
    await rejected

    const view = contender.sessionView(live)
    assert.deepEqual(view.binding, expected, 'a rejected bind must expose the binding that already won')
    assert.equal(view.card.id, alice.id)
    assert.equal(contender.promptState(live).record.id, alice.id)
    const cached = contender.sessionSync(live)
    assert.deepEqual(cached.state.bindings.sessions[live.id], expected)
    assert.notEqual(cached.binding, cached.state.bindings.sessions[live.id], 'session and workspace caches keep separate binding objects')
    assert.equal(await readFile(path, 'utf8'), committed, 'the rejected operation must not write over the winning binding')
  })
}

test('keeps only committed bindings in the workspace cache when a bind is disposed', { timeout: 10_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-binding-disposed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const alice = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Alice' }))), { fileName: 'alice.json' })
  const bob = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Bob' }))), { fileName: 'bob.json' })
  const live = { id: 'disposed-session', session: { header: { cwd: workspace }, events: [] } }
  await store.bind(live, alice.id)
  const path = join(workspace, '.dsh', 'sillytavern', 'bindings.json')
  const committed = await readFile(path, 'utf8')
  const paused = pauseBeforeBindingLock(store, t)
  const rejected = assert.rejects(store.bind(live, bob.id, { replace: true, expectedCardId: alice.id }), /was disposed/)
  await paused.loaded
  const { state } = store.sessionSync(live)
  store.disposeSession(live)
  paused.resume()
  await rejected

  assert.deepEqual(state.bindings, JSON.parse(committed), 'a failed commit must not publish the attempted replacement to other sessions')
  assert.equal(await readFile(path, 'utf8'), committed)
  assert.equal(store.sessionSync(live), undefined)
})
