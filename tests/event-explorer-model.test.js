import assert from 'node:assert/strict'
import test from 'node:test'
import eventExplorer from '../src/client/event-explorer-model.cjs'

const { buildEventExplorerModel, describeMemory, groupTimelineIntervals, layoutEventGraph } = eventExplorer

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

test('timeline tracks group by event identity and combine only identical coordinates without changing memories', () => {
  const time = { state: 'normalized', label: '深夜', timeline: '主线', start: 10, end: null }
  const rows = [
    row('a1', 'a', time),
    row('a2', 'a', { ...time, label: '后半夜' }),
    row('b1', 'b', time),
    row('a3', 'a', { ...time, start: 20, end: 25 }),
    row('a4', 'a', { ...time, end: 10 }),
    row('a5', 'a', { ...time, timeline: '回忆线' }),
  ]
  const before = structuredClone(rows)
  const model = buildEventExplorerModel({ revision: 1, rows, eventEdges: [] })
  const groups = groupTimelineIntervals(model.timelines[0].intervals)

  assert.deepEqual(groups.map(group => [group.eventId, group.rowCount]), [['a', 4], ['b', 1]])
  assert.deepEqual(groups[0].intervals.map(interval => [interval.start, interval.end]), [[10, null], [10, 10], [20, 25]])
  assert.deepEqual(groups[0].intervals[0].storyTimes.map(value => value.label), ['深夜', '后半夜'])
  assert.equal(groups[1].intervals.length, 1, 'a distinct event at the same time remains separate')
  assert.equal(groupTimelineIntervals(model.timelines[1].intervals)[0].rowCount, 1, 'another timeline retains its own track')
  assert.equal(model.byId.get('a').rows.length, 5)
  assert.equal(model.byId.get('a').normalizedIntervals.length, 5)
  assert.deepEqual(rows, before)
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

test('timelines preserve a missing end while all rows establish the latest known boundary', () => {
  const laterOpen = row('open-later', 'event-open-later', {
    state: 'normalized', label: 'later', timeline: 'story', start: 30, end: null,
  })
  const ranged = row('ranged', 'event-ranged', {
    state: 'normalized', label: 'range', timeline: 'story', start: 20, end: 40,
  })
  const earlierOpen = row('open-earlier', 'event-open-earlier', {
    state: 'normalized', label: 'earlier', timeline: 'story', start: 10, end: null,
  })
  const ungroupedBoundary = row('ungrouped-current', undefined, {
    state: 'normalized', label: 'current', timeline: 'story', start: 50, end: 60,
  })
  delete ungroupedBoundary.eventId

  const model = buildEventExplorerModel({ revision: 3, rows: [laterOpen, ranged, earlierOpen, ungroupedBoundary], eventEdges: [] })
  const timeline = model.timelines[0]

  assert.equal(timeline.min, 10)
  assert.equal(timeline.max, 60)
  assert.equal(timeline.span, 50)
  assert.deepEqual(timeline.intervals.map(interval => interval.rowId), ['open-earlier', 'ranged', 'open-later'])
  assert.equal(timeline.intervals[0].end, null)
  assert.equal(timeline.intervals[0].storyTime, earlierOpen.storyTime)
  assert.equal(model.ungrouped[0], ungroupedBoundary)
  assert.equal(timeline.intervals.some(interval => interval.rowId === 'ungrouped-current'), false)
})

test('an ungrouped-only normalized timeline has a domain without inventing an event interval', () => {
  const loose = row('loose-time', undefined, {
    state: 'normalized', label: null, timeline: 'background-clock', start: -2, end: 3,
  })
  delete loose.eventId

  const model = buildEventExplorerModel({ revision: 1, rows: [loose], eventEdges: [] })

  assert.deepEqual(model.timelines, [{ timeline: 'background-clock', min: -2, max: 3, span: 5, intervals: [] }])
  assert.equal(model.nodes.length, 0)
  assert.equal(model.ungrouped[0], loose)
})

test('readable event descriptions take priority over storage identifiers', () => {
  const memory = row('readable', 'event-turn1-ring-onboarding-ice-maker', {
    state: 'normalized', label: '2020年05月11日 星期一 15:40', timeline: 'RiNG咖啡厅工作时间线', start: 202005111540, end: null,
  }, {
    table: 'narrative_events',
    key: 'lin-che-begins-ring-work-and-ice-maker-check',
    value: {
      event: '林澈第一天在RiNG兼职，向立希了解咖啡厅工作，并被请去检查发出异常声音的制冰机。',
      durableFacts: ['立希将整理餐具作为林澈的第一项工作。', '乐奈注意到制冰机声音不对。'],
    },
  })

  const description = describeMemory(memory)
  const model = buildEventExplorerModel({ revision: 1, rows: [memory], eventEdges: [], appliedMaintenanceJobs: ['job-1'] })

  assert.equal(description.title, '林澈第一天在RiNG兼职')
  assert.match(description.summary, /检查发出异常声音的制冰机/)
  assert.deepEqual(description.facts, ['立希将整理餐具作为林澈的第一项工作。', '乐奈注意到制冰机声音不对。'])
  assert.equal(model.nodes[0].title, description.title)
  assert.equal(model.nodes[0].summary, description.summary)
  assert.deepEqual(model.nodes[0].facts, description.facts)
  assert.deepEqual(model.appliedMaintenanceJobs, ['job-1'])
})

test('date-shaped coordinates retain their numeric distances regardless of timeline names or labels', () => {
  const evening = row('calendar-evening', 'calendar-evening', {
    state: 'normalized', label: '2020年05月11日 23:30', timeline: 'RiNG工作时间线', start: 202005112330, end: null,
  })
  const morning = row('calendar-morning', 'calendar-morning', {
    state: 'normalized', label: '2020年05月12日 00:30', timeline: 'RiNG工作时间线', start: 202005120030, end: null,
  })
  const dynasty = row('dynasty', 'dynasty', {
    state: 'normalized', label: '星历第七纪元 15:40', timeline: '王朝纪年轴', start: 202005111540, end: null,
  })
  const document = { revision: 1, rows: [morning, evening, dynasty], eventEdges: [] }
  const before = structuredClone(document)
  const model = buildEventExplorerModel(document)
  const calendar = model.timelines.find(timeline => timeline.timeline === 'RiNG工作时间线')
  const nonCalendar = model.timelines.find(timeline => timeline.timeline === '王朝纪年轴')

  assert.equal(calendar.min, 202005112330)
  assert.equal(calendar.max, 202005120030)
  assert.equal(calendar.span, 7700, 'the raw difference defines distance even when the label resembles a Gregorian date')
  assert.deepEqual(calendar.intervals.map(interval => interval.rowId), ['calendar-evening', 'calendar-morning'])
  assert.equal(nonCalendar.min, 202005111540)
  assert.equal(nonCalendar.span, 0)
  for (const timeline of ['calendar', 'gregorian', 'date', '公历', '日历', '王朝纪年轴']) {
    const renamed = buildEventExplorerModel({ ...document, rows: [evening, morning].map(value => ({
      ...value, storyTime: { ...value.storyTime, timeline, label: '第七纪元·第二轮红月' },
    })) })
    assert.equal(renamed.timelines[0].span, 7700)
    assert.deepEqual(renamed.timelines[0].intervals.map(interval => interval.start), [202005112330, 202005120030])
  }
  assert.deepEqual(document, before)
})
