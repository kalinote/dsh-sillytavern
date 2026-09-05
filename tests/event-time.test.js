import assert from 'node:assert/strict'
import test from 'node:test'
import { applyEventOperation, emptyEventDocument, normalizeEventDocument, queryMemory } from '../src/event.js'

const time = (start, end = null) => ({ state: 'normalized', label: null, timeline: 'story', start, end })
const write = storyTime => ({
  action: 'upsert', table: 'events', key: 'arrival', eventId: 'arrival-event', value: { note: 'arrived' },
  keywords: ['Rowan', 'Harbor Gate'], location: null, characters: ['Rowan'], storyTime,
})

test('event writes require a finite narrative start and non-empty timeline without coercion', () => {
  const empty = emptyEventDocument('time-required')
  const invalidStarts = [undefined, null, '', '12', true, false, NaN, Infinity, -Infinity]
  for (const start of invalidStarts) {
    assert.throws(() => applyEventOperation(empty, write(time(start))), /finite numeric start/)
  }
  for (const timeline of [undefined, null, '', '   ', 1]) {
    assert.throws(() => applyEventOperation(empty, write({ ...time(0), timeline })), /non-empty timeline/)
  }
  for (const storyTime of [undefined, null, { state: 'unknown' }, { state: 'unknown', start: 10 }, { state: 'label-only', label: 'dawn' }]) {
    assert.throws(() => applyEventOperation(empty, write(storyTime)), /start is required/)
  }
  const missing = write(time(0))
  delete missing.storyTime
  assert.throws(() => applyEventOperation(empty, missing), /require storyTime/)
  assert.deepEqual(empty, emptyEventDocument('time-required'))
})

test('end can be omitted, null, equal to start, or later, but is never synthesized from the clock', () => {
  for (const start of [-3.5, 0, 12.25]) {
    for (const end of [undefined, null, start, start + 5]) {
      const storyTime = time(start)
      if (end === undefined) delete storyTime.end
      else storyTime.end = end
      const document = applyEventOperation(emptyEventDocument('time-optional-end'), write(storyTime)).document
      assert.deepEqual(document.rows[0].storyTime, time(start, end ?? null))
      assert.deepEqual(normalizeEventDocument(JSON.parse(JSON.stringify(document)), document.sessionId), document, 'nullable ends survive persistence reload')
    }
  }
  for (const end of [-1, '', '10', false, NaN, Infinity, -Infinity]) {
    assert.throws(() => applyEventOperation(emptyEventDocument('invalid-end'), write(time(0, end))), /end must be null or a finite number/)
  }
})

test('updates inherit valid starts, can clear ends, and reject removing a start atomically', () => {
  let document = applyEventOperation(emptyEventDocument('time-update'), write(time(5, 8))).document
  const id = document.rows[0].id
  document = applyEventOperation(document, { action: 'update', id, value: { note: 'updated' } }).document
  assert.deepEqual(document.rows[0].storyTime, time(5, 8))
  document = applyEventOperation(document, { action: 'update', id, storyTime: time(5) }).document
  assert.deepEqual(document.rows[0].storyTime, time(5, null))
  const before = structuredClone(document)
  assert.throws(() => applyEventOperation(document, { action: 'update', id, storyTime: time(null) }), /finite numeric start/)
  assert.throws(() => applyEventOperation(document, { action: 'upsert', table: 'events', key: 'arrival', storyTime: { state: 'unknown' } }), /start is required/)
  assert.throws(() => applyEventOperation(document, { action: 'batch', operations: [
    { action: 'update', id, value: { note: 'must not escape' } },
    { ...write({ state: 'unknown' }), key: 'invalid-new-event' },
  ] }), /start is required/)
  assert.deepEqual(document, before)
})

test('legacy unknown/label-only times stay readable; modifying their rows requires filling the start', () => {
  const base = applyEventOperation(emptyEventDocument('legacy-time'), write(time(5))).document
  const id = base.rows[0].id
  for (const storyTime of [
    { state: 'unknown', label: null, timeline: null, start: null, end: null },
    { state: 'label-only', label: 'dawn', timeline: 'story', start: null, end: null },
  ]) {
    const persisted = { ...base, revision: 17, rows: [{ ...base.rows[0], storyTime }] }
    const document = normalizeEventDocument(persisted, persisted.sessionId)
    assert.deepEqual(document, persisted, 'no migration, reset, or invented start')
    assert.equal(queryMemory(document, {}).length, 1)
    assert.throws(() => applyEventOperation(document, { action: 'update', id, value: { note: 'missing start' } }), /start is required/)
    const corrected = applyEventOperation(document, { action: 'update', id, storyTime: time(2) }).document
    assert.deepEqual(corrected.rows[0].storyTime, time(2))
    assert.equal(corrected.revision, 18)
    assert.equal(applyEventOperation(document, { action: 'delete', id }).document.rows.length, 0, 'legacy rows may still be removed')
    assert.deepEqual(document, persisted)
  }
})

test('time queries use an unended record only at its known start, not zero or infinity', () => {
  const operations = [
    { ...write(time(-5)), key: 'negative-start' },
    { ...write(time(4)), key: 'start-only' },
    { ...write(time(4, 9)), key: 'known-range' },
  ]
  const document = applyEventOperation(emptyEventDocument('time-query'), { action: 'batch', operations }).document
  const query = (start, end) => queryMemory(document, { timeRange: { timeline: 'story', start, end }, order: 'time_asc' }).map(row => row.key)
  assert.deepEqual(query(-5, -5), ['negative-start'])
  assert.deepEqual(query(-4, -1), [])
  assert.deepEqual(query(4, 4), ['start-only', 'known-range'])
  assert.deepEqual(query(5, 8), ['known-range'])
  assert.deepEqual(query(10, 100), [])
  assert.deepEqual(queryMemory(document, { order: 'time_desc' }).map(row => row.key), ['known-range', 'start-only', 'negative-start'])
})
