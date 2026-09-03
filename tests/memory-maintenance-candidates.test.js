import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeMaintenanceMatchText,
  selectMaintenanceMemory,
  splitPeriodicConversationRounds,
} from '../src/memory-maintenance.js'

const PERIODIC_CONTEXT_BYTES = 160 * 1024

function row(id, eventId, keywords, importance = 0.5) {
  return {
    id,
    eventId,
    table: 'events',
    key: id,
    value: {},
    keywords,
    importance,
    updatedAt: 1,
  }
}

function document(rows, eventEdges = []) {
  return { rows, eventEdges }
}

function contextBytes(rounds) {
  return Buffer.byteLength(JSON.stringify({
    conversationRounds: rounds.map(round => ({ turn: round.turn, messages: round.messages })),
  }), 'utf8')
}

function round(turn, text) {
  return {
    turn,
    startSeq: turn * 10,
    endSeq: turn * 10 + 2,
    sourceRefs: [{ eventSeq: turn * 10 + 1, turn, role: 'assistant' }],
    messages: [
      { role: 'user', text: `user ${turn}`, seq: turn * 10 + 1 },
      { role: 'assistant', text, seq: turn * 10 + 2 },
    ],
  }
}

test('normalizes maintenance match text with NFKC, lowercase, and unified whitespace', () => {
  assert.equal(
    normalizeMaintenanceMatchText('  Ｈｅｌｌｏ\u00a0\nWORLD\t世界  '),
    'hello world 世界',
  )
})

test('selects only strict keyword substring hits and ranks hit count, keyword length, then importance', () => {
  const rows = [
    row('count-two', 'event-count', ['alpha', 'beta'], 0.1),
    row('long-keyword', 'event-long', ['very-long-token'], 0.1),
    row('short-keyword', 'event-short', ['short'], 0.1),
    row('tie-high', 'event-tie-high', ['tie'], 0.8),
    row('tie-low', 'event-tie-low', ['tie'], 0.2),
    row('irrelevant-important', 'event-unrelated', ['never-seen'], 1),
  ]
  const selected = selectMaintenanceMemory(
    document(rows),
    'alpha beta very-long-token short tie',
  )

  assert.deepEqual(selected.rows.map(item => item.id), [
    'count-two',
    'long-keyword',
    'short-keyword',
    'tie-high',
    'tie-low',
  ])
  assert.deepEqual(selected.rows[0].matchedKeywords, ['alpha', 'beta'])
  assert.deepEqual(selected.rows[1].matchedKeywords, ['very-long-token'])
  assert.equal(selected.rows.some(item => item.id === 'irrelevant-important'), false)
})

test('completes selected event rows, keeps only direct edges, and summarizes adjacent events', () => {
  const rows = [
    row('selected-hit', 'event-selected', ['archive']),
    row('selected-sibling', 'event-selected', ['not-in-latest-text']),
    row('adjacent-row', 'event-adjacent', ['adjacent-memory']),
    row('remote-row', 'event-remote', ['remote-memory']),
  ]
  const eventEdges = [
    {
      id: 'direct-edge',
      kind: 'precedes',
      predecessorEventId: 'event-selected',
      successorEventId: 'event-adjacent',
      reason: 'direct narrative relation',
    },
    {
      id: 'neighbor-edge',
      kind: 'precedes',
      predecessorEventId: 'event-adjacent',
      successorEventId: 'event-remote',
      reason: 'not direct to selected event',
    },
  ]
  const selected = selectMaintenanceMemory(document(rows, eventEdges), 'archive')

  assert.deepEqual(selected.rows.map(item => item.id), ['selected-hit', 'selected-sibling'])
  assert.deepEqual(selected.rows[1].matchedKeywords, [])
  assert.deepEqual(selected.eventEdges.map(edge => edge.id), ['direct-edge'])
  assert.deepEqual(selected.neighborEventSummaries, [{
    eventId: 'event-adjacent',
    memoryCount: 1,
    memories: [{ table: 'events', key: 'adjacent-row' }],
  }])
  assert.equal(selected.neighborEventSummaries[0].rows, undefined)
})

test('splits periodic context by UTF-8 byte limit at complete contiguous rounds without loss', () => {
  const rounds = [1, 2, 3, 4].map(turn => round(turn, '界'.repeat(20_000)))
  const chunks = splitPeriodicConversationRounds(rounds)

  assert.deepEqual(chunks.map(chunk => chunk.map(item => item.turn)), [[1, 2], [3, 4]])
  assert.deepEqual(chunks.flat(), rounds)
  assert.deepEqual(chunks.flat().map(item => item.messages.at(-1).text), rounds.map(item => item.messages.at(-1).text))
  for (const chunk of chunks) assert.ok(contextBytes(chunk) <= PERIODIC_CONTEXT_BYTES)
})

test('throws explicitly when one complete periodic round exceeds the context limit', () => {
  const oversized = [round(99, '界'.repeat(60_000))]

  assert.throws(
    () => splitPeriodicConversationRounds(oversized),
    /complete conversation turn 99 exceeds the 163840-byte periodic memory context limit and cannot be split without truncation/,
  )
})
