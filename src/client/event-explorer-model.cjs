'use strict'

const DEFAULT_LAYOUT = Object.freeze({
  nodeWidth: 240,
  nodeHeight: 100,
  gapX: 88,
  gapY: 36,
  padding: 28,
})

function uniqueValues(rows, field) {
  const result = []
  const seen = new Set()
  for (const row of rows) {
    for (const value of Array.isArray(row?.[field]) ? row[field] : []) {
      if (seen.has(value)) continue
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

function uniqueLocations(rows) {
  const result = []
  const seen = new Set()
  for (const row of rows) {
    if (!Array.isArray(row?.location)) continue
    const identity = JSON.stringify(row.location)
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(row.location)
  }
  return result
}

function uniqueSourceRefs(rows) {
  const result = []
  const seen = new Set()
  for (const row of rows) {
    for (const ref of Array.isArray(row?.sourceRefs) ? row.sourceRefs : []) {
      const identity = `${ref.eventSeq}\0${ref.turn}\0${ref.role}`
      if (seen.has(identity)) continue
      seen.add(identity)
      result.push(ref)
    }
  }
  return result
}

function finiteBoundary(rows, field, select) {
  const values = rows.map(row => row?.[field]).filter(Number.isFinite)
  return values.length === 0 ? null : select(...values)
}

function intervalForRow(eventId, row) {
  const storyTime = row.storyTime
  return {
    eventId,
    rowId: row.id,
    row,
    storyTime,
    state: storyTime.state,
    label: storyTime.label,
    timeline: storyTime.timeline,
    start: storyTime.start,
    end: storyTime.end,
  }
}

function aggregateNode(eventId, rows) {
  const intervals = rows.map(row => intervalForRow(eventId, row))
  const importanceValues = rows.map(row => row.importance).filter(Number.isFinite)
  const importanceTotal = importanceValues.reduce((sum, value) => sum + value, 0)
  return {
    eventId,
    title: rows[0]?.key || eventId,
    rows,
    rowIds: rows.map(row => row.id),
    intervals,
    normalizedIntervals: intervals.filter(interval => interval.state === 'normalized'),
    labelOnlyTimes: intervals.filter(interval => interval.state === 'label-only'),
    unknownTimes: intervals.filter(interval => interval.state === 'unknown'),
    locations: uniqueLocations(rows),
    characters: uniqueValues(rows, 'characters'),
    keywords: uniqueValues(rows, 'keywords'),
    sourceRefs: uniqueSourceRefs(rows),
    importance: {
      max: importanceValues.length === 0 ? null : Math.max(...importanceValues),
      average: importanceValues.length === 0 ? null : importanceTotal / importanceValues.length,
    },
    createdAt: finiteBoundary(rows, 'createdAt', Math.min),
    updatedAt: finiteBoundary(rows, 'updatedAt', Math.max),
    predecessors: [],
    successors: [],
  }
}

function buildTimelines(nodes) {
  const byTimeline = new Map()
  for (const node of nodes) {
    for (const interval of node.normalizedIntervals) {
      if (!Number.isFinite(interval.start)) continue
      const layoutEnd = interval.end ?? interval.start
      let timeline = byTimeline.get(interval.timeline)
      if (timeline === undefined) {
        timeline = { timeline: interval.timeline, min: interval.start, max: layoutEnd, span: 0, intervals: [] }
        byTimeline.set(interval.timeline, timeline)
      }
      timeline.min = Math.min(timeline.min, interval.start)
      timeline.max = Math.max(timeline.max, layoutEnd)
      timeline.intervals.push(interval)
    }
  }
  return [...byTimeline.values()].map(timeline => ({
    ...timeline,
    span: timeline.max - timeline.min,
    intervals: timeline.intervals.slice().sort((left, right) => (
      left.start - right.start
      || (left.end ?? left.start) - (right.end ?? right.start)
    )),
  }))
}

function buildEventExplorerModel(document) {
  const rowsByEventId = new Map()
  const ungrouped = []
  for (const row of document.rows) {
    if (row.eventId === undefined) {
      ungrouped.push(row)
      continue
    }
    let rows = rowsByEventId.get(row.eventId)
    if (rows === undefined) {
      rows = []
      rowsByEventId.set(row.eventId, rows)
    }
    rows.push(row)
  }

  const nodes = [...rowsByEventId].map(([eventId, rows]) => aggregateNode(eventId, rows))
  const byId = new Map(nodes.map(node => [node.eventId, node]))
  const edges = document.eventEdges.slice()
  for (const edge of edges) {
    byId.get(edge.predecessorEventId)?.successors.push(edge)
    byId.get(edge.successorEventId)?.predecessors.push(edge)
  }

  return {
    revision: document.revision,
    nodes,
    edges,
    byId,
    timelines: buildTimelines(nodes),
    ungrouped,
  }
}

function graphRanks(model) {
  const ids = model.nodes.map(node => node.eventId)
  const known = new Set(ids)
  const indegree = new Map(ids.map(id => [id, 0]))
  const outgoing = new Map(ids.map(id => [id, []]))
  for (const edge of model.edges) {
    if (!known.has(edge.predecessorEventId) || !known.has(edge.successorEventId)) continue
    outgoing.get(edge.predecessorEventId).push(edge.successorEventId)
    indegree.set(edge.successorEventId, indegree.get(edge.successorEventId) + 1)
  }

  const rankById = new Map(ids.map(id => [id, 0]))
  const queue = ids.filter(id => indegree.get(id) === 0)
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    for (const successor of outgoing.get(id)) {
      rankById.set(successor, Math.max(rankById.get(successor), rankById.get(id) + 1))
      const remaining = indegree.get(successor) - 1
      indegree.set(successor, remaining)
      if (remaining === 0) queue.push(successor)
    }
  }
  return rankById
}

function graphComponents(model) {
  const ids = model.nodes.map(node => node.eventId)
  const known = new Set(ids)
  const adjacent = new Map(ids.map(id => [id, []]))
  for (const edge of model.edges) {
    if (!known.has(edge.predecessorEventId) || !known.has(edge.successorEventId)) continue
    adjacent.get(edge.predecessorEventId).push(edge.successorEventId)
    adjacent.get(edge.successorEventId).push(edge.predecessorEventId)
  }

  const componentById = new Map()
  let component = 0
  for (const id of ids) {
    if (componentById.has(id)) continue
    const queue = [id]
    componentById.set(id, component)
    for (let index = 0; index < queue.length; index += 1) {
      for (const neighbor of adjacent.get(queue[index])) {
        if (componentById.has(neighbor)) continue
        componentById.set(neighbor, component)
        queue.push(neighbor)
      }
    }
    component += 1
  }
  return componentById
}

function layoutEventGraph(model, options = {}) {
  const nodeWidth = options.nodeWidth ?? DEFAULT_LAYOUT.nodeWidth
  const nodeHeight = options.nodeHeight ?? DEFAULT_LAYOUT.nodeHeight
  const gapX = options.gapX ?? DEFAULT_LAYOUT.gapX
  const gapY = options.gapY ?? DEFAULT_LAYOUT.gapY
  const padding = options.padding ?? DEFAULT_LAYOUT.padding
  const rankById = graphRanks(model)
  const componentById = graphComponents(model)
  const originalIndex = new Map(model.nodes.map((node, index) => [node.eventId, index]))
  const componentRanks = new Map()

  for (const node of model.nodes) {
    const component = componentById.get(node.eventId)
    let ranks = componentRanks.get(component)
    if (ranks === undefined) {
      ranks = new Map()
      componentRanks.set(component, ranks)
    }
    const rank = rankById.get(node.eventId)
    let rankedNodes = ranks.get(rank)
    if (rankedNodes === undefined) {
      rankedNodes = []
      ranks.set(rank, rankedNodes)
    }
    rankedNodes.push(node)
  }

  const positionedById = new Map()
  let componentTop = padding
  for (const [component, ranks] of componentRanks) {
    let rowsInComponent = 1
    for (const rankedNodes of ranks.values()) rowsInComponent = Math.max(rowsInComponent, rankedNodes.length)
    for (const [rank, rankedNodes] of ranks) {
      rankedNodes.sort((left, right) => originalIndex.get(left.eventId) - originalIndex.get(right.eventId))
      rankedNodes.forEach((node, row) => {
        positionedById.set(node.eventId, {
          ...node,
          node,
          x: padding + rank * (nodeWidth + gapX),
          y: componentTop + row * (nodeHeight + gapY),
          width: nodeWidth,
          height: nodeHeight,
          rank,
          component,
        })
      })
    }
    componentTop += rowsInComponent * nodeHeight + (rowsInComponent - 1) * gapY + gapY
  }

  const nodes = model.nodes.map(node => positionedById.get(node.eventId))
  const edges = model.edges.map(edge => {
    const source = positionedById.get(edge.predecessorEventId)
    const target = positionedById.get(edge.successorEventId)
    if (source === undefined || target === undefined) return { ...edge, edge, points: [], path: '' }
    const start = { x: source.x + source.width, y: source.y + source.height / 2 }
    const end = { x: target.x, y: target.y + target.height / 2 }
    const middleX = (start.x + end.x) / 2
    const points = [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end]
    return {
      ...edge,
      edge,
      points,
      path: `M ${start.x} ${start.y} L ${middleX} ${start.y} L ${middleX} ${end.y} L ${end.x} ${end.y}`,
    }
  })

  const maxRank = nodes.reduce((maximum, node) => Math.max(maximum, node.rank), 0)
  const height = model.nodes.length === 0 ? padding * 2 : componentTop - gapY + padding
  const width = model.nodes.length === 0 ? padding * 2 : padding * 2 + nodeWidth + maxRank * (nodeWidth + gapX)
  const ranks = []
  for (const node of nodes) {
    if (ranks[node.rank] === undefined) ranks[node.rank] = { rank: node.rank, eventIds: [] }
    ranks[node.rank].eventIds.push(node.eventId)
  }

  return { ...model, nodes, edges, byId: new Map(nodes.map(node => [node.eventId, node])), width, height, ranks }
}

module.exports = { DEFAULT_LAYOUT, buildEventExplorerModel, layoutEventGraph }
