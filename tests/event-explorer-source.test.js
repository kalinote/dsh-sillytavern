import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const { createEventExplorerSource } = createRequire(import.meta.url)('../src/client/event-explorer-source.cjs')

function harness(load) {
  const timers = new Map()
  let next = 0
  let visible = true
  let visibilityListener
  const source = createEventExplorerSource({
    load,
    schedule(callback) { const id = ++next; timers.set(id, callback); return id },
    cancel(id) { timers.delete(id) },
    isVisible: () => visible,
    subscribeVisibility(listener) { visibilityListener = listener; return () => { visibilityListener = undefined } },
  })
  return {
    source, timers,
    visibility(value) { visible = value; visibilityListener?.() },
    tick() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback() },
    watched: () => visibilityListener !== undefined,
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('event source shares one load, preserves unchanged snapshots, and publishes a full replacement', async () => {
  const revisions = []
  const documents = [{ revision: 1, rows: [{ id: 'a' }] }, { revision: 2, rows: [{ id: 'b' }] }]
  let response = { document: documents[0], unchanged: false }
  const h = harness(async revision => { revisions.push(revision); return response })
  assert.equal(revisions.length, 0, 'unselected views do not fetch')
  let changes = 0
  const stop = h.source.subscribe(() => changes++)
  const stop2 = h.source.subscribe(() => {})
  await settle()
  assert.deepEqual(revisions, [undefined])
  assert.equal(h.source.getSnapshot().document, documents[0])
  assert.equal(h.timers.size, 1)
  const before = h.source.getSnapshot()
  response = { unchanged: true, revision: 1 }
  h.tick()
  await settle()
  assert.equal(h.source.getSnapshot(), before)
  assert.equal(changes, 1)
  response = { document: documents[1], unchanged: false }
  h.tick()
  await settle()
  assert.equal(h.source.getSnapshot().document, documents[1])
  assert.deepEqual(revisions, [undefined, 1, 1])
  stop()
  assert.equal(h.timers.size, 1)
  stop2()
  assert.equal(h.timers.size, 0)
  assert.equal(h.watched(), false)
  assert.equal(h.source.getSnapshot().document, null, 'inactive sessions release their event payload')
})

test('event source ignores late responses after unmount, retries errors, and resumes on visibility', async () => {
  let resolveLoad
  let signal
  let attempts = 0
  const h = harness(async (_revision, nextSignal) => {
    signal = nextSignal
    attempts++
    if (attempts === 1) return new Promise(resolve => { resolveLoad = resolve })
    if (attempts === 2) throw new Error('offline')
    return { document: { revision: 3, rows: [] }, unchanged: false }
  })
  const stop = h.source.subscribe(() => {})
  await settle()
  const pending = h.source.refresh()
  assert.equal(attempts, 1)
  stop()
  assert.equal(signal.aborted, true)
  resolveLoad({ document: { revision: 99 }, unchanged: false })
  await pending
  assert.equal(h.source.getSnapshot().document, null)
  const stop2 = h.source.subscribe(() => {})
  await settle()
  assert.equal(h.source.getSnapshot().error, 'offline')
  h.visibility(false)
  assert.equal(h.timers.size, 0)
  h.visibility(true)
  await settle()
  assert.equal(h.source.getSnapshot().document.revision, 3)
  assert.equal(h.source.getSnapshot().error, null)
  h.source.dispose()
  assert.equal(h.timers.size, 0)
  assert.equal(h.watched(), false)
  await h.source.refresh()
  stop2()
  assert.equal(attempts, 3)
})

test('a failed refresh retains the last full document for inspection', async () => {
  let fail = false
  const document = { revision: 8, rows: [{ id: 'kept' }] }
  const h = harness(async () => { if (fail) throw new Error('connection lost'); return { document } })
  const stop = h.source.subscribe(() => {})
  await settle()
  fail = true
  await h.source.refresh()
  assert.equal(h.source.getSnapshot().document, document)
  assert.equal(h.source.getSnapshot().error, 'connection lost')
  assert.equal(h.source.getSnapshot().refreshing, false)
  stop()
})
