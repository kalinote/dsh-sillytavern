import assert from 'node:assert/strict'
import test from 'node:test'
import eventExplorer from '../src/client/event-explorer-model.cjs'

const { buildEventExplorerModel, layoutEventGraph } = eventExplorer

function row(id, eventId, storyTime, extra = {}) {
  return {
    id,
    eventId,
    table: 'events',
    key: `memory-${id}`,
    value: { full: id },
    keywords: [`keyword-${id}`, 'shared'],
    importance: 0.5,
    storyTime,
    location: null,
    characters: [],
    sourceRefs: [],
    recallPolicy: 'after_compaction',
    createdAt: 10,
    updatedAt: 20,
    ...extra,
  }
}

test('buildEventExplorerModel preserves complete rows and every form of story time', () => {
  const first = row('a-1', 'event-a', { state: 'normalized', label: 'first', timeline: 'calendar', start: 10, end: 20 }, {
    location: ['country', 'city'],
    characters: ['Alice'],
    sourceRefs: [{ eventSeq: 4, turn: 1, role: 'assistant' }],
    importance: 0.9,
  })
  const second = row('a-2', 'event-a', { state: 'normalized', label: null, timeline: 'mission', start: 2, end: 2 }, {
    location: ['country', 'city', 'archive'],
    characters: ['Alice', 'Bob'],
    sourceRefs: [{ eventSeq: 5, turn: 2, role: 'assistant' }],
    importance: 0.3,
    updatedAt: 30,
  })
  const labelOnly = row('b-1', 'event-b', { state: 'label-only', label: 'the next dawn', timeline: 'calendar', start: null, end: null })
  const unknown = row('b-2', 'event-b', { state: 'unknown', label: null, timeline: null, start: null, end: null })
  const ungrouped = { ...row('loose', undefined, { state: 'unknown', label: null, timeline: null, start: null, end: null }) }
  delete ungrouped.eventId
  const edge = { id: 'edge-a-b', kind: 'precedes', predecessorEventId: 'event-a', successorEventId: 'event-b', reason: 'direct', sourceRefs: [] }
  const document = { revision: 7, rows: [first, second, labelOnly, unknown, ungrouped], eventEdges: [edge] }

  const model = buildEventExplorerModel(document)

  assert.equal(model.revision, 7)
  assert.deepEqual(model.nodes.map(node => node.eventId), ['event-a', 'event-b'])
  assert.equal(model.byId.get('event-a').rows[0], first)
  assert.equal(model.byId.get('event-a').rows[1], second)
  assert.equal(model.byId.get('event-a').intervals[0].storyTime, first.storyTime)
  assert.deepEqual(model.byId.get('event-b').labelOnlyTimes.map(interval => interval.rowId), ['b-1'])
  assert.deepEqual(model.byId.get('event-b').unknownTimes.map(interval => interval.rowId), ['b-2'])
  assert.deepEqual(model.byId.get('event-a').locations, [['country', 'city'], ['country', 'city', 'archive']])
  assert.deepEqual(model.byId.get('event-a').characters, ['Alice', 'Bob'])
  assert.deepEqual(model.byId.get('event-a').importance, { max: 0.9, average: 0.6 })
  assert.equal(model.byId.get('event-a').updatedAt, 30)
  assert.equal(model.byId.get('event-a').successors[0], edge)
  assert.equal(model.byId.get('event-b').predecessors[0], edge)
  assert.equal(model.edges[0], edge)
  assert.equal(model.ungrouped[0], ungrouped)

  assert.deepEqual(model.timelines.map(timeline => timeline.timeline), ['calendar', 'mission'])
  assert.deepEqual(model.timelines[0], {
    timeline: 'calendar', min: 10, max: 20, span: 10,
    intervals: [model.byId.get('event-a').normalizedIntervals[0]],
  })
  assert.deepEqual(model.timelines[1], {
    timeline: 'mission', min: 2, max: 2, span: 0,
    intervals: [model.byId.get('event-a').normalizedIntervals[1]],
  })
})

test('layoutEventGraph gives every DAG node and edge stable hierarchical geometry', () => {
  const rows = ['a', 'b', 'c', 'd', 'isolated'].map(id => row(id, id, { state: 'unknown', label: null, timeline: null, start: null, end: null }))
  const eventEdges = [
    { id: 'a-b', kind: 'precedes', predecessorEventId: 'a', successorEventId: 'b', reason: null, sourceRefs: [] },
    { id: 'a-c', kind: 'precedes', predecessorEventId: 'a', successorEventId: 'c', reason: null, sourceRefs: [] },
    { id: 'b-d', kind: 'precedes', predecessorEventId: 'b', successorEventId: 'd', reason: null, sourceRefs: [] },
    { id: 'c-d', kind: 'precedes', predecessorEventId: 'c', successorEventId: 'd', reason: null, sourceRefs: [] },
  ]
  const model = buildEventExplorerModel({ revision: 1, rows, eventEdges })

  const layout = layoutEventGraph(model)

  assert.deepEqual(layout.nodes.map(node => node.eventId), ['a', 'b', 'c', 'd', 'isolated'])
  assert.deepEqual(layout.nodes.map(node => node.rank), [0, 1, 1, 2, 0])
  assert.deepEqual(layout.nodes.map(node => node.component), [0, 0, 0, 0, 1])
  assert.deepEqual([layout.byId.get('a').x, layout.byId.get('a').y], [28, 28])
  assert.deepEqual([layout.byId.get('b').x, layout.byId.get('b').y], [356, 28])
  assert.deepEqual([layout.byId.get('c').x, layout.byId.get('c').y], [356, 164])
  assert.deepEqual([layout.byId.get('d').x, layout.byId.get('d').y], [684, 28])
  assert.deepEqual([layout.byId.get('isolated').x, layout.byId.get('isolated').y], [28, 300])
  assert.equal(layout.width, 952)
  assert.equal(layout.height, 428)
  assert.equal(layout.edges.length, eventEdges.length)
  assert.equal(layout.edges[0].edge, eventEdges[0])
  assert.deepEqual(layout.edges[0].points, [
    { x: 268, y: 78 },
    { x: 312, y: 78 },
    { x: 312, y: 78 },
    { x: 356, y: 78 },
  ])
  assert.deepEqual(layout.ranks, [
    { rank: 0, eventIds: ['a', 'isolated'] },
    { rank: 1, eventIds: ['b', 'c'] },
    { rank: 2, eventIds: ['d'] },
  ])
})

test('layoutEventGraph handles a long chain iteratively without dropping data', () => {
  const count = 5000
  const rows = Array.from({ length: count }, (_value, index) => row(`row-${index}`, `event-${index}`, { state: 'unknown', label: null, timeline: null, start: null, end: null }))
  const eventEdges = Array.from({ length: count - 1 }, (_value, index) => ({
    id: `edge-${index}`,
    kind: 'precedes',
    predecessorEventId: `event-${index}`,
    successorEventId: `event-${index + 1}`,
    reason: null,
    sourceRefs: [],
  }))

  const layout = layoutEventGraph(buildEventExplorerModel({ revision: 2, rows, eventEdges }))

  assert.equal(layout.nodes.length, count)
  assert.equal(layout.edges.length, count - 1)
  assert.equal(layout.byId.get(`event-${count - 1}`).rank, count - 1)
  assert.equal(layout.edges.at(-1).edge, eventEdges.at(-1))
})

test('timelines preserve a missing end while using the start only for layout extent and ordering', () => {
  const laterOpen = row('open-later', 'event-open-later', {
    state: 'normalized', label: 'later', timeline: 'story', start: 30, end: null,
  })
  const ranged = row('ranged', 'event-ranged', {
    state: 'normalized', label: 'range', timeline: 'story', start: 20, end: 40,
  })
  const earlierOpen = row('open-earlier', 'event-open-earlier', {
    state: 'normalized', label: 'earlier', timeline: 'story', start: 10, end: null,
  })

  const model = buildEventExplorerModel({ revision: 3, rows: [laterOpen, ranged, earlierOpen], eventEdges: [] })
  const timeline = model.timelines[0]

  assert.equal(timeline.min, 10)
  assert.equal(timeline.max, 40)
  assert.equal(timeline.span, 30)
  assert.deepEqual(timeline.intervals.map(interval => interval.rowId), ['open-earlier', 'ranged', 'open-later'])
  assert.equal(timeline.intervals[0].end, null)
  assert.equal(timeline.intervals[0].storyTime, earlierOpen.storyTime)
})
