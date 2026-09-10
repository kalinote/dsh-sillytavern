window.__ModuleLoader__.load({
  id: 'dsh-sillytavern',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    // BEGIN GENERATED EVENT EXPLORER
    const eventExplorerModel = (() => {
      const module = { exports: {} }
      'use strict'

      const DEFAULT_LAYOUT = Object.freeze({
        nodeWidth: 240,
        nodeHeight: 100,
        gapX: 88,
        gapY: 36,
        padding: 28,
      })

      const TITLE_FIELDS = new Set(['title', 'name', 'headline', 'displayName', 'display_name', 'eventTitle', 'event_title', 'subject'])
      const SUMMARY_FIELDS = new Set(['summary', 'event', 'description', 'narrative', 'content', 'text', 'detail', 'details'])
      const FACT_FIELDS = new Set(['durableFacts', 'durable_facts', 'facts', 'keyFacts', 'key_facts', 'highlights', 'outcomes', 'consequences'])

      function readableStrings(value) {
        if (typeof value === 'string') {
          const normalized = value.replace(/\s+/gu, ' ').trim()
          return normalized === '' ? [] : [normalized]
        }
        if (Array.isArray(value)) return value.flatMap(readableStrings)
        return []
      }

      function valuesForFields(value, fields, seen = new Set()) {
        if (value === null || typeof value !== 'object' || seen.has(value)) return []
        seen.add(value)
        const found = []
        for (const [key, child] of Object.entries(value)) {
          if (fields.has(key)) found.push(...readableStrings(child))
          if (child !== null && typeof child === 'object') found.push(...valuesForFields(child, fields, seen))
        }
        return found
      }

      function identifierLike(value) {
        return /^[\p{L}\p{N}]+(?:[-_.:/][\p{L}\p{N}]+)+$/u.test(value) && !/[\u3400-\u9fff]/u.test(value)
      }

      function readableIdentifier(value) {
        return String(value ?? '').replace(/[-_.:/]+/gu, ' ').replace(/\s+/gu, ' ').trim()
      }

      function clippedTitle(value, maximum = 42) {
        const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim()
        if (normalized === '') return ''
        const clause = normalized.split(/[，,；;。！？!?]/u)[0].trim()
        const preferred = [...clause].length >= 4 ? clause : normalized
        const characters = [...preferred]
        return characters.length <= maximum ? preferred : `${characters.slice(0, maximum - 1).join('')}…`
      }

      function describeMemory(row) {
        const value = row?.value && typeof row.value === 'object' ? row.value : {}
        const titles = valuesForFields(value, TITLE_FIELDS)
        const summaries = valuesForFields(value, SUMMARY_FIELDS)
        const facts = [...new Set(valuesForFields(value, FACT_FIELDS))]
        const naturalTitle = titles.find(candidate => !identifierLike(candidate))
        const summary = summaries.find(candidate => !identifierLike(candidate)) || summaries[0] || titles[0] || ''
        const fallback = readableIdentifier(row?.key) || readableIdentifier(row?.eventId) || '未命名事件'
        const title = clippedTitle(naturalTitle || summary || titles[0] || fallback)
        return { title, summary, facts, natural: Boolean(naturalTitle || summary) }
      }

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
        const descriptions = rows.map(describeMemory)
        const importanceValues = rows.map(row => row.importance).filter(Number.isFinite)
        const importanceTotal = importanceValues.reduce((sum, value) => sum + value, 0)
        return {
          eventId,
          title: descriptions.find(description => description.natural)?.title || descriptions[0]?.title || readableIdentifier(eventId),
          summary: descriptions.find(description => description.summary)?.summary || '',
          facts: [...new Set(descriptions.flatMap(description => description.facts))],
          descriptions,
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

      function extendTimelineBoundary(timeline, value) {
        if (!Number.isFinite(value)) return
        timeline.min = Math.min(timeline.min, value)
        timeline.max = Math.max(timeline.max, value)
      }

      function buildTimelines(nodes, rows = []) {
        const byTimeline = new Map()

        // Every normalized memory contributes to its timeline's known domain. Rows
        // without an event id affect the clock, but never create an event track.
        for (const row of rows) {
          const storyTime = row?.storyTime
          if (storyTime?.state !== 'normalized' || !Number.isFinite(storyTime.start)) continue
          let timeline = byTimeline.get(storyTime.timeline)
          if (timeline === undefined) {
            timeline = { timeline: storyTime.timeline, min: storyTime.start, max: storyTime.start, span: 0, intervals: [] }
            byTimeline.set(storyTime.timeline, timeline)
          }
          extendTimelineBoundary(timeline, storyTime.start)
          extendTimelineBoundary(timeline, storyTime.end)
        }

        for (const node of nodes) {
          for (const interval of node.normalizedIntervals) {
            if (!Number.isFinite(interval.start)) continue
            let timeline = byTimeline.get(interval.timeline)
            if (timeline === undefined) {
              timeline = { timeline: interval.timeline, min: interval.start, max: interval.start, span: 0, intervals: [] }
              byTimeline.set(interval.timeline, timeline)
            }
            extendTimelineBoundary(timeline, interval.start)
            extendTimelineBoundary(timeline, interval.end)
            timeline.intervals.push(interval)
          }
        }
        // Coordinates carry the world's own numeric measure. Labels and timeline
        // names never select a calendar or change the unit used for distances.
        return [...byTimeline.values()].map(timeline => ({
          ...timeline,
          span: timeline.max - timeline.min,
          intervals: timeline.intervals.slice().sort((left, right) => (
            left.start - right.start
            || (left.end ?? left.start) - (right.end ?? right.start)
          )),
        }))
      }

      // Timeline rows represent events. Keep distinct ranges on that event's track,
      // while memories with the same coordinates share one marker. Raw rows and all
      // of their story times remain available on the event node for its details.
      function groupTimelineIntervals(intervals) {
        const byEvent = new Map()
        for (const interval of intervals) {
          let event = byEvent.get(interval.eventId)
          if (event === undefined) {
            event = { eventId: interval.eventId, rowCount: 0, byRange: new Map() }
            byEvent.set(interval.eventId, event)
          }
          event.rowCount += 1
          const key = JSON.stringify([interval.timeline, interval.start, interval.end ?? null])
          let range = event.byRange.get(key)
          if (range === undefined) {
            range = { ...interval, storyTimes: [] }
            event.byRange.set(key, range)
          }
          range.storyTimes.push(interval.storyTime)
        }
        return [...byEvent.values()].map(({ eventId, rowCount, byRange }) => ({
          eventId, rowCount, intervals: [...byRange.values()],
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
          appliedMaintenanceJobs: Array.isArray(document.appliedMaintenanceJobs) ? document.appliedMaintenanceJobs.slice() : [],
          nodes,
          edges,
          byId,
          timelines: buildTimelines(nodes, document.rows),
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

      module.exports = {
        DEFAULT_LAYOUT,
        buildEventExplorerModel,
        describeMemory,
        groupTimelineIntervals,
        layoutEventGraph,
      }
      return module.exports
    })()
    const eventExplorerSource = (() => {
      const module = { exports: {} }
      /** A mounted event view owns one sequential, revision-aware polling source. */
      function createEventExplorerSource({ load, interval = 2000, schedule = setTimeout, cancel = clearTimeout,
        isVisible = () => true, subscribeVisibility = () => () => {} }) {
        const initial = () => ({ document: null, maintenance: null, loading: true, refreshing: false, error: null })
        let state = initial()
        const listeners = new Set()
        let timer
        let current
        let disposed = false
        let unwatch

        function publish(next) {
          state = next
          for (const listener of listeners) listener()
        }

        function clearTimer() {
          if (timer !== undefined) cancel(timer)
          timer = undefined
        }

        function queue() {
          clearTimer()
          if (!disposed && listeners.size > 0 && isVisible()) {
            timer = schedule(() => { timer = undefined; void refresh(false) }, interval)
          }
        }

        function refresh(manual = true) {
          if (disposed || listeners.size === 0) return Promise.resolve()
          if (current !== undefined) return current.promise
          clearTimer()
          const run = { controller: new AbortController(), promise: undefined }
          current = run
          if (manual && state.document !== null) publish({ ...state, refreshing: true })
          run.promise = Promise.resolve().then(() => load(state.document?.revision, run.controller.signal)).then(value => {
            if (current !== run || run.controller.signal.aborted) return
            const document = value.unchanged ? state.document : value.document
            const nextMaintenance = Object.hasOwn(value, 'maintenance') ? value.maintenance : state.maintenance
            const maintenance = JSON.stringify(nextMaintenance) === JSON.stringify(state.maintenance) ? state.maintenance : nextMaintenance
            if (document !== state.document || maintenance !== state.maintenance || state.loading || state.refreshing || state.error !== null) {
              publish({ document, maintenance, loading: false, refreshing: false, error: null })
            }
          }).catch(error => {
            if (current !== run || run.controller.signal.aborted) return
            publish({ ...state, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) })
          }).finally(() => {
            if (current !== run) return
            current = undefined
            queue()
          })
          return run.promise
        }

        function stop() {
          clearTimer()
          const run = current
          current = undefined
          run?.controller.abort()
          unwatch?.()
          unwatch = undefined
          state = initial()
        }

        return {
          getSnapshot: () => state,
          refresh: () => refresh(true),
          subscribe(listener) {
            if (disposed) return () => {}
            listeners.add(listener)
            if (listeners.size === 1) {
              unwatch = subscribeVisibility(() => {
                if (isVisible()) void refresh(false)
                else clearTimer()
              })
              void refresh(false)
            }
            return () => { listeners.delete(listener); if (listeners.size === 0) stop() }
          },
          dispose() { disposed = true; stop(); listeners.clear() },
        }
      }

      module.exports = { createEventExplorerSource }
      return module.exports
    })()
    const createEventExplorerUI = (() => {
      const module = { exports: {} }
      'use strict'

      module.exports = function createEventExplorerUI(React, modelHelpers) {
        const h = React.createElement
        const { buildEventExplorerModel, describeMemory, groupTimelineIntervals, layoutEventGraph } = modelHelpers
        const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
        const list = value => Array.isArray(value) ? value : []
        const text = value => value == null ? '' : String(value)
        const classes = (...values) => values.filter(Boolean).join(' ')
        const finite = value => typeof value === 'number' && Number.isFinite(value)

        function eventTitle(node) {
          return text(node?.title).trim() || '未命名事件'
        }

        function timeOf(value) {
          const storyTime = value?.storyTime && typeof value.storyTime === 'object' ? value.storyTime : value || {}
          return {
            state: text(storyTime.state || value?.state || 'unknown'),
            label: storyTime.label ?? value?.label ?? null,
            timeline: storyTime.timeline ?? value?.timeline ?? null,
            start: storyTime.start ?? value?.start ?? null,
            end: storyTime.end ?? value?.end ?? null,
          }
        }

        function formatNumber(value) {
          if (value == null || text(value).trim() === '') return '—'
          if (!finite(Number(value))) return '—'
          return String(Number(value))
        }

        function formatStoryTime(value) {
          const storyTime = timeOf(value)
          if (storyTime.state === 'normalized') {
            const start = finite(storyTime.start) ? formatNumber(storyTime.start) : '开始时间未记录'
            const range = storyTime.end == null || text(storyTime.end).trim() === ''
              ? `${start} – 结束时间未记录`
              : `${start} – ${formatNumber(storyTime.end)}`
            return [storyTime.label, storyTime.timeline, `坐标 ${range}`].filter(item => text(item).trim()).join(' · ')
          }
          if (storyTime.state === 'label-only') return `仅标签 · ${text(storyTime.label) || '未命名'}`
          return '时间未知'
        }

        function formatDate(value) {
          if (!finite(Number(value))) return '—'
          const date = new Date(Number(value))
          return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString()
        }

        function formatLocation(value) {
          return list(value).length ? value.map(text).join(' / ') : '未记录'
        }

        function formatJson(value) {
          try { return JSON.stringify(value, null, 2) }
          catch { return text(value) }
        }

        function sourceRefLabel(ref) {
          const fields = []
          if (Number.isSafeInteger(ref?.turn)) fields.push(`第 ${ref.turn} 回合`)
          if (text(ref?.role)) fields.push(ref.role === 'user' ? '用户原文' : ref.role === 'assistant' ? '剧情原文' : text(ref.role))
          if (!fields.length && Number.isSafeInteger(ref?.eventSeq)) fields.push(`会话事件 ${ref.eventSeq}`)
          return fields.join(' · ') || '未知来源'
        }

        function edgeOf(relation) {
          return relation?.edge && typeof relation.edge === 'object' ? relation.edge : relation || {}
        }

        function relatedEventId(relation, direction) {
          const edge = edgeOf(relation)
          if (text(relation?.eventId)) return text(relation.eventId)
          return direction === 'predecessor' ? text(edge.predecessorEventId) : text(edge.successorEventId)
        }

        function nodeById(model, eventId) {
          if (model?.byId && typeof model.byId.get === 'function') return model.byId.get(eventId)
          if (model?.byId && typeof model.byId === 'object') return model.byId[eventId]
          return list(model?.nodes).find(node => node.eventId === eventId)
        }

        function searchableNode(node) {
          return [
            node?.eventId,
            ...list(node?.rows).flatMap(row => [
              row?.table,
              row?.key,
              formatJson(row?.value),
              ...list(row?.keywords),
              ...list(row?.characters),
              ...list(row?.location),
              formatStoryTime(row?.storyTime),
            ]),
          ].map(text).join('\n').toLocaleLowerCase()
        }

        function graphPath(edge) {
          if (typeof edge?.path === 'string' && edge.path.trim()) return edge.path
          const points = list(edge?.points).filter(point => finite(Number(point?.x)) && finite(Number(point?.y)))
          return points.length ? points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') : ''
        }

        function endpoint(edge, side) {
          return text(edgeOf(edge)?.[side === 'from' ? 'predecessorEventId' : 'successorEventId'] || edge?.[side === 'from' ? 'source' : 'target'])
        }

        function StoryTimePill({ value }) {
          const storyTime = timeOf(value)
          return h('span', { className: `dst-explorer-time-pill ${storyTime.state}` }, formatStoryTime(storyTime))
        }

        function SourceRefs({ refs, onOpenSource }) {
          const values = list(refs)
          if (!values.length) return h('span', { className: 'dst-explorer-muted' }, '无来源记录')
          return h('ol', { className: 'dst-explorer-source-list' }, values.map((ref, index) =>
            h('li', { key: `${ref?.eventSeq ?? 'unknown'}:${ref?.turn ?? 'unknown'}:${ref?.role ?? 'unknown'}:${index}` },
              typeof onOpenSource === 'function'
                ? h('button', { type: 'button', onClick: () => onOpenSource(ref), title: '返回对话并查看这段原文' }, sourceRefLabel(ref))
                : sourceRefLabel(ref))))
        }

        function maintenanceFeedback(maintenance, model) {
          const status = text(maintenance?.status).toLocaleLowerCase()
          const pending = Number(maintenance?.pending ?? maintenance?.pendingCount ?? 0)
          const running = Number(maintenance?.running ?? maintenance?.runningCount ?? 0)
          const failed = Number(maintenance?.failed ?? maintenance?.failedCount ?? 0)
          if (status === 'running' || status === 'processing' || running > 0) {
            return { tone: 'busy', message: '正在整理这轮剧情，新的事件记忆会在完成后自动出现。' }
          }
          if (status === 'pending' || status === 'queued' || pending > 0) {
            return { tone: 'busy', message: '剧情已进入记忆整理队列，完成后会自动更新。' }
          }
          if (status === 'failed' || status === 'error' || failed > 0) {
            const reason = text(maintenance?.lastError || maintenance?.error).trim()
            return { tone: 'error', message: reason ? `剧情记忆整理失败：${reason}` : '剧情记忆整理失败，稍后会自动重试。' }
          }
          const events = list(model?.nodes).length
          const completed = Number(maintenance?.completed ?? maintenance?.completedCount ?? list(model?.appliedMaintenanceJobs).length)
          if (events > 0) return { tone: 'ready', message: `已整理 ${events} 个剧情事件${completed > 0 ? ` · 完成 ${completed} 次记忆整理` : ''}` }
          return { tone: 'waiting', message: '尚无剧情记忆。完成一个剧情回合后，系统会自动开始整理。' }
        }

        function EventButton({ eventId, children, className, selected, dimmed, matched, onChoose, register, style }) {
          return h('button', {
            type: 'button',
            ref: register,
            className: classes('dst-explorer-event-button', className, selected && 'selected', dimmed && 'search-dim', matched && 'search-match'),
            'data-event-id': eventId,
            'aria-pressed': selected === true,
            style,
            onClick: event => onChoose(eventId, event.currentTarget),
          }, children)
        }

        const MIN_CLICKABLE_PERCENT = 8 / 450 * 100

        function boundedTimelineViewport(minimum, maximum, timeline) {
          const domainMinimum = timeline.min
          const domainMaximum = timeline.max
          const domainSpan = domainMaximum - domainMinimum
          if (!(domainSpan > 0)) return { minimum: domainMaximum, maximum: domainMaximum }
          let width = maximum - minimum
          if (!finite(width) || !(width > 0) || width >= domainSpan) return { minimum: domainMinimum, maximum: domainMaximum }
          let nextMinimum = minimum
          let nextMaximum = maximum
          if (nextMinimum < domainMinimum) {
            nextMaximum += domainMinimum - nextMinimum
            nextMinimum = domainMinimum
          }
          if (nextMaximum > domainMaximum) {
            nextMinimum -= nextMaximum - domainMaximum
            nextMaximum = domainMaximum
          }
          nextMinimum = Math.max(domainMinimum, nextMinimum)
          nextMaximum = Math.min(domainMaximum, nextMaximum)
          width = nextMaximum - nextMinimum
          return width > 0 ? { minimum: nextMinimum, maximum: nextMaximum } : { minimum: domainMinimum, maximum: domainMaximum }
        }

        function zoomTimelineViewport(viewport, timeline, factor) {
          const width = viewport.maximum - viewport.minimum
          if (!(width > 0)) return viewport
          const nextWidth = width * factor
          const middle = viewport.minimum + width / 2
          const candidateMinimum = middle - nextWidth / 2
          const candidateMaximum = middle + nextWidth / 2
          if (!(candidateMaximum > candidateMinimum)) return viewport
          const next = boundedTimelineViewport(candidateMinimum, candidateMaximum, timeline)
          if (factor < 1 && !(next.maximum - next.minimum < width)) return viewport
          return next
        }

        function moveTimelineViewport(viewport, timeline, direction) {
          const width = viewport.maximum - viewport.minimum
          if (!(width > 0)) return viewport
          const distance = width * 0.4 * direction
          return boundedTimelineViewport(viewport.minimum + distance, viewport.maximum + distance, timeline)
        }

        function coordinateDisplayStep(value) {
          const source = String(value).toLocaleLowerCase()
          const [coefficient, exponentText] = source.split('e')
          const fractionDigits = coefficient.includes('.') ? coefficient.length - coefficient.indexOf('.') - 1 : 0
          const exponent = exponentText === undefined ? 0 : Number(exponentText)
          const writtenStep = 10 ** Math.min(0, exponent - fractionDigits)
          const floatingStep = Math.abs(value) * Number.EPSILON * 16
          return Math.max(Number.MIN_VALUE, writtenStep, floatingStep)
        }

        function focusTimelineViewport(timeline, intervals) {
          let eventMinimum = Infinity
          let eventMaximum = -Infinity
          for (const interval of intervals) {
            if (!finite(interval.start)) continue
            const end = finite(interval.end) ? interval.end : timeline.max
            eventMinimum = Math.min(eventMinimum, interval.start, end)
            eventMaximum = Math.max(eventMaximum, interval.start, end)
          }
          if (!finite(eventMinimum) || !finite(eventMaximum)) return { minimum: timeline.min, maximum: timeline.max }
          const eventSpan = eventMaximum - eventMinimum
          const domainSpan = timeline.max - timeline.min
          if (!(domainSpan > 0)) return { minimum: timeline.max, maximum: timeline.max }
          if (!(eventSpan > 0)) {
            const localStep = coordinateDisplayStep(eventMinimum)
            return boundedTimelineViewport(eventMinimum - localStep * 20, eventMaximum + localStep * 20, timeline)
          }
          const padding = eventSpan * 2
          // Anchor this viewport to the event's source coordinates. Deriving it from
          // a percentage of a huge global minimum can erase very short intervals.
          return boundedTimelineViewport(eventMinimum - padding, eventMaximum + padding, timeline)
        }

        function TimelineView({ timeline, model, selectedId, query, matchedIds, onChoose, registerEvent }) {
          const overview = { minimum: timeline.min, maximum: timeline.max }
          const [viewport, setViewport] = React.useState(overview)
          const minimum = viewport.minimum
          const maximum = viewport.maximum
          const viewportSpan = maximum - minimum
          const zeroSpan = !(timeline.span > 0)
          const atOverview = minimum === timeline.min && maximum === timeline.max
          const zoomedIn = zoomTimelineViewport(viewport, timeline, 0.5)
          const canZoomIn = zoomedIn.minimum !== minimum || zoomedIn.maximum !== maximum
          const hasQuery = query.trim() !== ''
          const tickPortions = viewportSpan > 0 ? [0, 0.25, 0.5, 0.75, 1] : [1]
          const ticks = tickPortions.map(portion => {
            const coordinate = viewportSpan > 0
              ? portion === 0 ? minimum : portion === 1 ? maximum : minimum + viewportSpan * portion
              : timeline.max
            const current = portion === 1 && maximum === timeline.max
            return h('span', {
              key: portion,
              className: classes(portion === 0 && 'first', current && 'current'),
              style: { left: `${portion * 100}%` },
            }, current ? `最新 ${formatNumber(timeline.max)}` : formatNumber(coordinate))
          })
          const groups = groupTimelineIntervals(list(timeline.intervals))
          const bars = groups.map(group => {
            const eventId = text(group.eventId)
            const matched = hasQuery && matchedIds.has(eventId)
            const barTitle = eventTitle(nodeById(model, eventId))
            const markers = group.intervals.flatMap(interval => {
              const storyTime = timeOf(interval)
              const start = storyTime.start
              const endUnrecorded = !finite(storyTime.end)
              const actualEnd = endUnrecorded ? timeline.max : storyTime.end
              if (!finite(start) || actualEnd < minimum || start > maximum) return []
              const point = !endUnrecorded && start === actualEnd
              const visibleStart = Math.max(start, minimum)
              const visibleEnd = Math.min(actualEnd, maximum)
              const left = viewportSpan > 0 ? clamp((visibleStart - minimum) / viewportSpan * 100, 0, 100) : 100
              const right = viewportSpan > 0 ? clamp((visibleEnd - minimum) / viewportSpan * 100, 0, 100) : 100
              const width = viewportSpan > 0 ? clamp((visibleEnd - visibleStart) / viewportSpan * 100, 0, 100) : 0
              const minimumMarker = !point && !zeroSpan && (
                (width > 0 && width < MIN_CLICKABLE_PERCENT)
                || (endUnrecorded && width === 0)
              )
              const pointTransform = left <= 0 ? 'none' : left >= 100 ? 'translateX(-100%)' : 'translateX(-50%)'
              let style
              if (zeroSpan) style = { left: '100%', width: '8px', transform: 'translateX(-100%)' }
              else if (point) style = { left: `${left}%`, transform: pointTransform }
              else if (endUnrecorded && minimumMarker) style = { right: '0', width: `${width}%`, minWidth: '8px' }
              else if (endUnrecorded) style = { left: `${left}%`, right: '0' }
              else if (minimumMarker && right >= 100) style = { right: '0', width: `${width}%`, minWidth: '8px' }
              else style = { left: `${left}%`, width: `${width}%`, ...(minimumMarker ? { minWidth: '8px' } : {}) }
              const timeDescription = [...new Set(interval.storyTimes.map(formatStoryTime))].join('\n')
              const durationDescription = endUnrecorded
                ? `真实起点 ${formatNumber(start)}\n真实终点 未记录\n真实时长 未知\n图示延伸至最新已知剧情时间 ${formatNumber(timeline.max)}`
                : `真实起点 ${formatNumber(start)}\n真实终点 ${formatNumber(storyTime.end)}\n真实时长 ${formatNumber(storyTime.end - start)}`
              const markerDescription = zeroSpan && endUnrecorded
                ? '\n时间线上只有一个已知坐标；显示为标记，未推断事件时长。'
                : endUnrecorded && width === 0 && start === timeline.max
                  ? '\n开放事件的起点就是最新已知坐标；显示为右端标记，未推断事件时长。'
                  : minimumMarker ? '\n此标记为便于点击而加宽，宽度不代表实际时长；放大后会按线性比例显示。' : ''
              const title = `${barTitle}\n${timeDescription}\n${durationDescription}${markerDescription}`
              return h('button', {
                key: JSON.stringify([interval.start, interval.end ?? null]),
                type: 'button',
                className: classes('dst-explorer-bar', point && 'point', minimumMarker && 'minimum-marker', endUnrecorded && 'end-unrecorded', selectedId === eventId && 'selected', hasQuery && !matched && 'search-dim', matched && 'search-match'),
                style,
                title,
                'aria-label': `打开事件 ${barTitle}：${title}`,
                onClick: event => onChoose(eventId, event.currentTarget),
              }, point || zeroSpan || width === 0 ? null : h('span', null, text(storyTime.label) || (endUnrecorded ? `${formatNumber(start)}–最新` : `${formatNumber(start)}–${formatNumber(storyTime.end)}`)))
            })
            return h('div', { className: 'dst-explorer-bar-row', key: eventId },
              h('div', { className: 'dst-explorer-bar-label' },
                h(EventButton, {
                  eventId,
                  selected: selectedId === eventId,
                  dimmed: hasQuery && !matched,
                  matched,
                  onChoose,
                  register: element => registerEvent(eventId, element, 'gantt'),
                }, h('span', { className: 'dst-explorer-bar-name', title: barTitle }, barTitle),
                h('span', { className: 'dst-explorer-muted' }, `${group.rowCount} 条记忆`)),
                h('button', {
                  type: 'button',
                  className: 'dst-explorer-focus-time',
                  title: `聚焦 ${barTitle} 的剧情时间`,
                  'aria-label': `聚焦事件时间：${barTitle}`,
                  onClick: () => setViewport(focusTimelineViewport(timeline, group.intervals)),
                }, '聚焦事件时间')),
              h('div', { className: 'dst-explorer-bar-track' }, markers))
          })
          return h('article', { className: 'dst-explorer-timeline' },
            h('div', { className: 'dst-explorer-timeline-head' },
              h('div', null,
                h('strong', null, text(timeline.timeline) || '未命名时间线'),
                h('span', { className: 'dst-explorer-viewport-range' }, `视窗 ${formatNumber(minimum)} – ${formatNumber(maximum)}`)),
              h('div', { className: 'dst-explorer-timeline-controls', 'aria-label': `${text(timeline.timeline) || '未命名时间线'}视窗控制` },
                h('button', { type: 'button', disabled: zeroSpan || !canZoomIn, onClick: () => setViewport(zoomedIn), 'aria-label': '放大时间线' }, '放大'),
                h('button', { type: 'button', disabled: atOverview || zeroSpan, onClick: () => setViewport(zoomTimelineViewport(viewport, timeline, 2)), 'aria-label': '缩小时间线' }, '缩小'),
                h('button', { type: 'button', disabled: minimum <= timeline.min || zeroSpan, onClick: () => setViewport(moveTimelineViewport(viewport, timeline, -1)), 'aria-label': '向前移动时间线' }, '向前'),
                h('button', { type: 'button', disabled: maximum >= timeline.max || zeroSpan, onClick: () => setViewport(moveTimelineViewport(viewport, timeline, 1)), 'aria-label': '向后移动时间线' }, '向后'),
                h('button', { type: 'button', disabled: atOverview, onClick: () => setViewport(overview), 'aria-label': '总览时间线' }, '总览'))),
            h('div', { className: 'dst-explorer-timeline-domain' }, `全域 ${formatNumber(timeline.min)} – ${formatNumber(timeline.max)}`),
            h('div', { className: 'dst-explorer-axis', 'aria-hidden': true }, ticks),
            h('div', { className: 'dst-explorer-bars' }, bars))
        }

        function GanttChart({ model, selectedId, query, matchedIds, onChoose, registerEvent }) {
          const timelines = list(model?.timelines)
          const untimed = []
          for (const node of list(model?.nodes)) {
            const times = new Map()
            let rowCount = 0
            for (const row of list(node.rows)) {
              const storyTime = timeOf(row?.storyTime)
              if (storyTime.state !== 'normalized' || !finite(storyTime.start)) {
                rowCount += 1
                times.set(formatStoryTime(storyTime), storyTime)
              }
            }
            if (rowCount) untimed.push({ eventId: node.eventId, rowCount, times: [...times.values()] })
          }
          const hasQuery = query.trim() !== ''
          const timelineViews = timelines.map(timeline => h(TimelineView, {
            key: `${text(timeline.timeline)}:${timeline.min}:${timeline.max}`,
            timeline,
            model,
            selectedId,
            query,
            matchedIds,
            onChoose,
            registerEvent,
          }))
          const untimedItems = untimed.map(({ eventId, rowCount, times }) => {
            const matched = hasQuery && matchedIds.has(eventId)
            return h(EventButton, {
              key: eventId,
              eventId,
              className: 'dst-explorer-untimed-item',
              selected: selectedId === eventId,
              dimmed: hasQuery && !matched,
              matched,
              onChoose,
              register: element => registerEvent(eventId, element, 'gantt'),
            },
            h('strong', null, eventTitle(nodeById(model, eventId))),
            times.map(storyTime => h(StoryTimePill, { key: formatStoryTime(storyTime), value: storyTime })),
            h('span', { className: 'dst-explorer-muted' }, `${rowCount} 条记忆`))
          })
          const untimedView = untimedItems.length ? h('article', { className: 'dst-explorer-timeline dst-explorer-untimed' },
            h('div', { className: 'dst-explorer-timeline-head' },
              h('strong', null, '无数值剧情时间'),
              h('span', null, `${untimed.length} 个事件`)),
            h('div', { className: 'dst-explorer-untimed-list' }, untimedItems)) : null
          return h('section', { className: 'dst-explorer-panel dst-explorer-gantt', 'aria-labelledby': 'dst-explorer-gantt-title' },
            h('header', { className: 'dst-explorer-panel-head' },
              h('div', null,
                h('h2', { id: 'dst-explorer-gantt-title' }, '剧情时间'),
                h('p', null, '按原始数值计算间隔，每条时间线独立缩放；结束时间未记录的事件延伸至该轴最新已知位置。')),
              h('span', { className: 'dst-explorer-count' }, `${timelines.length} 条时间线`)),
            timelines.length === 0 && untimed.length === 0
              ? h('div', { className: 'dst-explorer-empty' }, '尚无可显示的剧情时间。')
              : h('div', { className: 'dst-explorer-gantt-scroll' }, timelineViews, untimedView))
        }

        function GraphView({ layout, selectedId, query, matchedIds, onChoose, registerEvent, viewportRef, pan, scale, onPanStart, onPanMove, onPanEnd }) {
          const hasQuery = query.trim() !== ''
          const arrowId = `dst-explorer-arrow-${text(layout?.revision).replace(/[^a-zA-Z0-9_-]/g, '-')}`
          const width = Math.max(1, Number(layout?.width) || 1)
          const height = Math.max(1, Number(layout?.height) || 1)
          return h('div', {
            ref: viewportRef,
            className: 'dst-explorer-graph-viewport',
            tabIndex: 0,
            'aria-label': '事件先后关系图；拖动可平移，滚轮可缩放',
            onPointerDown: onPanStart,
            onPointerMove: onPanMove,
            onPointerUp: onPanEnd,
            onPointerCancel: onPanEnd,
          },
          h('div', {
            className: 'dst-explorer-graph-canvas',
            style: { width: `${width}px`, height: `${height}px`, transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})` },
          },
          h('svg', { className: 'dst-explorer-edges', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': true },
            h('defs', null, h('marker', { id: arrowId, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' },
              h('path', { d: 'M0,0 L8,4 L0,8 z', className: 'dst-explorer-arrow' }))),
            list(layout?.edges).map((edge, index) => {
              const from = endpoint(edge, 'from')
              const to = endpoint(edge, 'to')
              const active = selectedId && (from === selectedId || to === selectedId)
              return h('path', {
                key: text(edge?.id || `${from}:${to}:${index}`),
                d: graphPath(edge),
                className: classes('dst-explorer-edge', active && 'active'),
                markerEnd: `url(#${arrowId})`,
              })
            })),
          list(layout?.nodes).map(node => {
            const eventId = text(node.eventId)
            const matched = hasQuery && matchedIds.has(eventId)
            const normalizedTimes = list(node.rows).map(row => timeOf(row?.storyTime)).filter(storyTime => storyTime.state === 'normalized')
            return h(EventButton, {
              key: eventId,
              eventId,
              className: 'dst-explorer-graph-node',
              selected: selectedId === eventId,
              dimmed: hasQuery && !matched,
              matched,
              onChoose,
              register: element => registerEvent(eventId, element, 'graph'),
              style: { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` },
            },
            h('span', { className: 'dst-explorer-graph-node-position' },
            h('strong', { title: eventTitle(node) }, eventTitle(node)),
            node.summary ? h('span', { className: 'dst-explorer-node-summary', title: text(node.summary) }, text(node.summary)) : null,
            h('span', { className: 'dst-explorer-node-meta' }, `${list(node.rows).length} 条记忆 · 层级 ${Number(node.rank) + 1}`),
            h('span', { className: 'dst-explorer-node-time' }, normalizedTimes.length ? formatStoryTime(normalizedTimes[0]) : '无标准化时间'),
            ))
          })))
        }

        function GraphPanel(props) {
          return h('section', { className: 'dst-explorer-panel dst-explorer-graph', 'aria-labelledby': 'dst-explorer-graph-title' },
            h('header', { className: 'dst-explorer-panel-head dst-explorer-graph-head' },
              h('div', null,
                h('h2', { id: 'dst-explorer-graph-title' }, '事件流程'),
                h('p', null, '仅显示已记录的直接先后关系。')),
              h('div', { className: 'dst-explorer-zoom', 'aria-label': '流程图缩放工具' },
                h('button', { type: 'button', onClick: () => props.onZoom(0.8), 'aria-label': '缩小流程图' }, '−'),
                h('output', null, `${Math.round(props.scale * 100)}%`),
                h('button', { type: 'button', onClick: () => props.onZoom(1.25), 'aria-label': '放大流程图' }, '+'),
                h('button', { type: 'button', onClick: props.onFit }, '适配'))),
            list(props.layout?.nodes).length
              ? h(GraphView, props)
              : h('div', { className: 'dst-explorer-empty' }, '尚无由记忆组成的事件。'))
        }

        function RelationList({ title, relations, direction, model, onNavigate, onOpenSource }) {
          const values = list(relations)
          return h('section', { className: 'dst-explorer-detail-section' },
            h('h3', null, title),
            values.length
              ? h('ul', { className: 'dst-explorer-relations' }, values.map((relation, index) => {
                  const edge = edgeOf(relation)
                  const target = relatedEventId(relation, direction)
                  return h('li', { key: text(edge.id || `${target}:${index}`) },
                    h('button', { type: 'button', onClick: () => onNavigate(target) }, eventTitle(nodeById(model, target))),
                    edge.reason ? h('p', null, text(edge.reason)) : null,
                    list(edge.sourceRefs).length ? h(SourceRefs, { refs: edge.sourceRefs, onOpenSource }) : null,
                    h('details', { className: 'dst-explorer-technical' },
                      h('summary', null, '技术信息'),
                      h('dl', { className: 'dst-explorer-edge-meta' },
                        detailPair('关系 ID', text(edge.id) || '未记录'),
                        detailPair('类型', text(edge.kind) || '未记录'),
                        detailPair('创建时间', formatDate(edge.createdAt)),
                        detailPair('更新时间', formatDate(edge.updatedAt))),
                      h('pre', { className: 'dst-explorer-json' }, formatJson(edge))))
                }))
              : h('p', { className: 'dst-explorer-muted' }, '无'))
        }

        function MemoryDetail({ row, index, onOpenSource }) {
          const storyTime = timeOf(row?.storyTime)
          const description = describeMemory(row)
          return h('article', { className: 'dst-explorer-memory-detail' },
            h('header', null,
              h('h3', null, description.title || `剧情记忆 ${index + 1}`)),
            description.summary ? h('p', { className: 'dst-explorer-memory-summary' }, description.summary) : null,
            description.facts.length ? h('section', { className: 'dst-explorer-facts' },
              h('h4', null, '已确认的剧情事实'),
              h('ul', null, description.facts.map((fact, factIndex) => h('li', { key: `${factIndex}:${fact}` }, fact)))) : null,
            h('dl', { className: 'dst-explorer-detail-grid' },
              detailPair('剧情时间', h(StoryTimePill, { value: storyTime })),
              detailPair('地点', formatLocation(row?.location)),
              detailPair('人物', list(row?.characters).length ? list(row.characters).join('、') : '未记录')),
            h('section', { className: 'dst-explorer-detail-section' },
              h('h4', null, `来源（${list(row?.sourceRefs).length}）`),
              h(SourceRefs, { refs: row?.sourceRefs, onOpenSource })),
            h('details', { className: 'dst-explorer-technical' },
              h('summary', null, '技术信息'),
              h('dl', { className: 'dst-explorer-detail-grid' },
                detailPair('数据表', text(row?.table) || '未记录'),
                detailPair('记录键', text(row?.key) || '未记录'),
                detailPair('记忆 ID', text(row?.id) || '未记录'),
                storyTime.state === 'normalized' ? detailPair('排序坐标（开始）', finite(storyTime.start) ? formatNumber(storyTime.start) : '未记录') : null,
                storyTime.state === 'normalized' ? detailPair('排序坐标（结束）', storyTime.end == null || text(storyTime.end).trim() === '' ? '未记录' : formatNumber(storyTime.end)) : null,
                detailPair('关键词', list(row?.keywords).length ? list(row.keywords).join('、') : '未记录'),
                detailPair('召回策略', text(row?.recallPolicy) || '未记录'),
                detailPair('重要度', `${Math.round(Number(row?.importance ?? 0) * 100)}%`),
                detailPair('创建时间', formatDate(row?.createdAt)),
                detailPair('更新时间', formatDate(row?.updatedAt))),
              h('h4', null, '完整结构化数据'),
              h('pre', { className: 'dst-explorer-json' }, formatJson(row))))
        }

        function detailPair(label, value) {
          return h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value))
        }

        function DetailDialog({ dialogRef, node, model, onDismiss, onClosed, onNavigate, onOpenSource }) {
          return h('dialog', {
            ref: dialogRef,
            className: 'dst-explorer-detail-dialog',
            'aria-label': node ? `事件 ${node.eventId} 详情` : '事件详情',
            onClose: onClosed,
            onCancel: event => { event.preventDefault(); onDismiss() },
            onClick: event => { if (event.target === event.currentTarget) onDismiss() },
            onKeyDown: event => { if (event.key === 'Escape') onDismiss() },
          }, node ? h('div', { className: 'dst-explorer-detail-card' },
            h('header', { className: 'dst-explorer-detail-head' },
              h('div', null,
                h('span', { className: 'dst-explorer-kicker' }, '事件详情'),
                h('h2', null, eventTitle(node)),
                node.summary ? h('p', { className: 'dst-explorer-event-summary' }, text(node.summary)) : null),
              h('button', { type: 'button', className: 'dst-explorer-close', onClick: onDismiss, autoFocus: true, 'aria-label': '关闭事件详情' }, '×')),
            h('div', { className: 'dst-explorer-detail-body' },
              h(RelationList, { title: '直接前置事件', relations: node.predecessors, direction: 'predecessor', model, onNavigate, onOpenSource }),
              h(RelationList, { title: '直接后续事件', relations: node.successors, direction: 'successor', model, onNavigate, onOpenSource }),
              h('section', { className: 'dst-explorer-detail-section' },
                h('h3', null, '剧情信息'),
                h('dl', { className: 'dst-explorer-detail-grid' },
                  detailPair('人物', list(node.characters).length ? list(node.characters).join('、') : '未记录'),
                  detailPair('地点', list(node.locations).length ? list(node.locations).map(formatLocation).join('；') : '未记录'),
                  detailPair('记忆数量', `${list(node.rows).length} 条`))),
              h('section', { className: 'dst-explorer-detail-section' },
                h('h3', null, `记忆（${list(node.rows).length}）`),
                h('div', { className: 'dst-explorer-memory-list' }, list(node.rows).map((row, index) =>
                  h(MemoryDetail, { key: text(row?.id || index), row, index, onOpenSource })))),
              h('details', { className: 'dst-explorer-technical dst-explorer-event-technical' },
                h('summary', null, '事件技术信息'),
                h('dl', { className: 'dst-explorer-detail-grid' },
                  detailPair('事件 ID', text(node.eventId) || '未记录'),
                  detailPair('关键词', list(node.keywords).length ? list(node.keywords).join('、') : '未记录'),
                  detailPair('平均重要度', finite(Number(node.importance?.average)) ? `${Math.round(Number(node.importance.average) * 100)}%` : '未记录'),
                  detailPair('最高重要度', finite(Number(node.importance?.max)) ? `${Math.round(Number(node.importance.max) * 100)}%` : '未记录'))))) : null)
        }

        function UngroupedRows({ rows, onOpenSource }) {
          const values = list(rows)
          if (!values.length) return null
          return h('details', { className: 'dst-explorer-ungrouped' },
            h('summary', null, `未关联事件的记忆（${values.length}）`),
            h('div', { className: 'dst-explorer-memory-list' }, values.map((row, index) =>
              h(MemoryDetail, { key: text(row?.id || index), row, index, onOpenSource }))))
        }

        function EventExplorerView({ document: eventDocument, maintenance = null, loading = false, refreshing = false, error = null, onRefresh, onEdit, onOpenSource, sessionId }) {
          const [selectedId, setSelectedId] = React.useState(null)
          const [query, setQuery] = React.useState('')
          const [searchCursor, setSearchCursor] = React.useState(-1)
          const [scale, setScale] = React.useState(1)
          const [pan, setPan] = React.useState({ x: 0, y: 0 })
          const [sourceNotice, setSourceNotice] = React.useState('')
          const graphViewport = React.useRef(null)
          const dialogRef = React.useRef(null)
          const restoreFocus = React.useRef(null)
          const drag = React.useRef(null)
          const eventElements = React.useRef(new Map())
          const fittedSession = React.useRef(null)

          const computed = React.useMemo(() => {
            try {
              const source = eventDocument || { schemaVersion: 5, sessionId: text(sessionId), revision: 0, rows: [], eventEdges: [] }
              const model = buildEventExplorerModel(source)
              return { model, layout: layoutEventGraph(model), error: null }
            } catch (caught) {
              return { model: null, layout: null, error: caught instanceof Error ? caught.message : text(caught) }
            }
          }, [eventDocument, sessionId])

          const searchEntries = React.useMemo(() => list(computed.model?.nodes).map(node => ({ id: text(node.eventId), haystack: searchableNode(node) })), [computed.model])
          const normalizedQuery = query.trim().toLocaleLowerCase()
          const matches = React.useMemo(() => normalizedQuery ? searchEntries.filter(entry => entry.haystack.includes(normalizedQuery)).map(entry => entry.id) : searchEntries.map(entry => entry.id), [searchEntries, normalizedQuery])
          const matchedIds = React.useMemo(() => new Set(matches), [matches])
          const selectedNode = selectedId ? nodeById(computed.model, selectedId) : null
          const maintenanceState = maintenanceFeedback(maintenance, computed.model)

          const openSource = React.useCallback(ref => {
            if (typeof onOpenSource !== 'function') return
            setSourceNotice('正在返回来源回合…')
            try {
              Promise.resolve(onOpenSource(ref)).then(
                () => setSourceNotice(''),
                caught => setSourceNotice(`无法打开来源回合：${caught instanceof Error ? caught.message : text(caught)}`),
              )
            } catch (caught) {
              setSourceNotice(`无法打开来源回合：${caught instanceof Error ? caught.message : text(caught)}`)
            }
          }, [onOpenSource])

          const registerEvent = React.useCallback((eventId, element, surface) => {
            const id = text(eventId)
            let record = eventElements.current.get(id)
            if (!record) { record = {}; eventElements.current.set(id, record) }
            if (element) record[surface] = element
            else delete record[surface]
          }, [])

          const fitGraph = React.useCallback(() => {
            const viewport = graphViewport.current
            const layout = computed.layout
            if (!viewport || !layout || !Number(layout.width) || !Number(layout.height)) return
            const inset = 36
            const availableWidth = Math.max(1, viewport.clientWidth - inset * 2)
            const availableHeight = Math.max(1, viewport.clientHeight - inset * 2)
            const nextScale = clamp(Math.min(availableWidth / layout.width, availableHeight / layout.height), 0.35, 1.6)
            setScale(nextScale)
            setPan({ x: (viewport.clientWidth - layout.width * nextScale) / 2, y: (viewport.clientHeight - layout.height * nextScale) / 2 })
          }, [computed.layout])

          const centerGraphEvent = React.useCallback((eventId, nextScale = scale) => {
            const viewport = graphViewport.current
            const node = list(computed.layout?.nodes).find(item => text(item.eventId) === text(eventId))
            if (!viewport || !node) return
            setPan({
              x: viewport.clientWidth / 2 - (Number(node.x) + Number(node.width) / 2) * nextScale,
              y: viewport.clientHeight / 2 - (Number(node.y) + Number(node.height) / 2) * nextScale,
            })
          }, [computed.layout, scale])

          const chooseEvent = React.useCallback((eventId, activator, locate = false) => {
            if (!eventId || !nodeById(computed.model, eventId)) return
            if (!selectedId && activator) restoreFocus.current = activator
            const matchIndex = matches.indexOf(eventId)
            if (normalizedQuery && matchIndex >= 0) setSearchCursor(matchIndex)
            setSelectedId(eventId)
            if (locate) {
              const element = eventElements.current.get(eventId)?.gantt
              element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
              centerGraphEvent(eventId)
            }
          }, [computed.model, selectedId, centerGraphEvent, matches, normalizedQuery])

          const restorePreviousFocus = React.useCallback(() => {
            const target = restoreFocus.current
            restoreFocus.current = null
            if (target?.focus) queueMicrotask(() => target.focus())
          }, [])

          const dismissDetails = React.useCallback(() => {
            const dialog = dialogRef.current
            if (dialog?.open && typeof dialog.close === 'function') dialog.close()
            else {
              dialog?.removeAttribute?.('open')
              setSelectedId(null)
              restorePreviousFocus()
            }
          }, [restorePreviousFocus])

          const handleDialogClosed = React.useCallback(() => {
            setSelectedId(null)
            restorePreviousFocus()
          }, [restorePreviousFocus])

          React.useEffect(() => {
            const dialog = dialogRef.current
            if (!dialog || !selectedNode) return
            if (!dialog.open) {
              if (typeof dialog.showModal === 'function') dialog.showModal()
              else dialog.setAttribute?.('open', '')
            }
          }, [selectedNode])

          React.useEffect(() => {
            if (selectedId && !selectedNode) dismissDetails()
          }, [selectedId, selectedNode, dismissDetails])

          React.useEffect(() => {
            setSelectedId(null)
            setQuery('')
            setSearchCursor(-1)
            setScale(1)
            setPan({ x: 0, y: 0 })
            setSourceNotice('')
            fittedSession.current = null
            eventElements.current.clear()
          }, [sessionId])

          React.useEffect(() => {
            if (!computed.layout || !list(computed.layout.nodes).length || fittedSession.current === sessionId) return
            fittedSession.current = sessionId
            const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fitGraph) : setTimeout(fitGraph, 0)
            return () => {
              if (typeof cancelAnimationFrame === 'function' && typeof frame === 'number') cancelAnimationFrame(frame)
              else clearTimeout(frame)
            }
          }, [computed.layout, fitGraph, sessionId])

          React.useEffect(() => () => {
            const dialog = dialogRef.current
            if (dialog?.open && typeof dialog.close === 'function') dialog.close()
          }, [])

          const zoomBy = React.useCallback(factor => {
            const viewport = graphViewport.current
            const nextScale = clamp(scale * factor, 0.35, 2.5)
            if (!viewport) return setScale(nextScale)
            const centerX = viewport.clientWidth / 2
            const centerY = viewport.clientHeight / 2
            setPan(previous => ({
              x: centerX - (centerX - previous.x) / scale * nextScale,
              y: centerY - (centerY - previous.y) / scale * nextScale,
            }))
            setScale(nextScale)
          }, [scale])

          const onWheel = React.useCallback(event => {
            event.preventDefault()
            const viewport = event.currentTarget
            const rect = viewport.getBoundingClientRect()
            const cursorX = event.clientX - rect.left
            const cursorY = event.clientY - rect.top
            const nextScale = clamp(scale * (event.deltaY > 0 ? 0.88 : 1.14), 0.35, 2.5)
            setPan(previous => ({
              x: cursorX - (cursorX - previous.x) / scale * nextScale,
              y: cursorY - (cursorY - previous.y) / scale * nextScale,
            }))
            setScale(nextScale)
          }, [scale])

          React.useEffect(() => {
            const viewport = graphViewport.current
            if (!viewport) return
            viewport.addEventListener('wheel', onWheel, { passive: false })
            return () => viewport.removeEventListener('wheel', onWheel)
          }, [onWheel, computed.layout])

          React.useEffect(() => { setSearchCursor(-1) }, [normalizedQuery])

          const onPanStart = React.useCallback(event => {
            if (event.button !== 0 || event.target?.closest?.('button')) return
            drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pan }
            event.currentTarget.setPointerCapture?.(event.pointerId)
            event.currentTarget.classList?.add('dragging')
          }, [pan])

          const onPanMove = React.useCallback(event => {
            const current = drag.current
            if (!current || current.pointerId !== event.pointerId) return
            setPan({ x: current.pan.x + event.clientX - current.clientX, y: current.pan.y + event.clientY - current.clientY })
          }, [])

          const onPanEnd = React.useCallback(event => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return
            drag.current = null
            event.currentTarget.releasePointerCapture?.(event.pointerId)
            event.currentTarget.classList?.remove('dragging')
          }, [])

          const locateMatch = React.useCallback(direction => {
            if (!matches.length) return
            const nextIndex = direction < 0
              ? (searchCursor <= 0 ? matches.length - 1 : searchCursor - 1)
              : (searchCursor + 1) % matches.length
            const next = matches[nextIndex]
            setSearchCursor(nextIndex)
            chooseEvent(next, globalThis.document?.activeElement, true)
          }, [matches, searchCursor, chooseEvent])

          const shownError = error || computed.error
          const matchPosition = searchCursor >= 0 && searchCursor < matches.length ? searchCursor + 1 : 0
          return h('div', { className: 'dst-explorer-root', 'data-session-id': text(sessionId), 'data-conversation-composer-overlay': '' },
            h('header', { className: 'dst-explorer-toolbar' },
              h('div', { className: 'dst-explorer-heading' },
                h('span', { className: 'dst-explorer-kicker' }, 'SillyTavern'),
                h('h1', null, '剧情时间线'),
                h('span', { className: 'dst-explorer-revision' }, `修订 ${computed.model?.revision ?? eventDocument?.revision ?? 0}`)),
              h('div', { className: 'dst-explorer-search' },
                h('label', null,
                  h('span', { className: 'dst-explorer-sr-only' }, '搜索事件'),
                  h('input', {
                    type: 'search',
                    value: query,
                    placeholder: '搜索事件、人物、地点或记忆…',
                    onChange: event => setQuery(event.target.value),
                    onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); locateMatch(event.shiftKey ? -1 : 1) } },
                  })),
                h('output', { 'aria-live': 'polite' }, normalizedQuery ? `${matchPosition}/${matches.length}` : `${searchEntries.length} 个事件`),
                h('button', { type: 'button', disabled: !normalizedQuery || !matches.length, onClick: () => locateMatch(-1), 'aria-label': '上一个搜索结果' }, '↑'),
                h('button', { type: 'button', disabled: !normalizedQuery || !matches.length, onClick: () => locateMatch(1), 'aria-label': '下一个搜索结果' }, '↓')),
              typeof onEdit === 'function' ? h('button', { type: 'button', onClick: onEdit }, '编辑事件') : null,
              h('button', { type: 'button', className: 'dst-explorer-refresh', disabled: refreshing || typeof onRefresh !== 'function', onClick: () => onRefresh?.() }, refreshing ? '刷新中…' : '刷新')),
            shownError ? h('div', { className: 'dst-explorer-error', role: 'alert' },
              h('span', null, text(shownError)),
              typeof onRefresh === 'function' ? h('button', { type: 'button', onClick: () => onRefresh() }, '重试') : null) : null,
            sourceNotice ? h('div', {
              className: classes('dst-explorer-maintenance', sourceNotice.startsWith('无法') ? 'error' : 'busy'),
              role: sourceNotice.startsWith('无法') ? 'alert' : 'status',
            }, sourceNotice) : null,
            !loading || eventDocument ? h('div', {
              className: classes('dst-explorer-maintenance', maintenanceState.tone),
              role: maintenanceState.tone === 'error' ? 'alert' : 'status',
              'aria-live': 'polite',
            }, maintenanceState.message) : null,
            loading && !eventDocument ? h('div', { className: 'dst-explorer-loading', role: 'status' }, '正在读取事件…') : null,
            computed.model && (!loading || eventDocument) ? h('main', { className: 'dst-explorer-content', 'aria-busy': refreshing === true },
              h(GanttChart, { model: computed.model, selectedId, query: normalizedQuery, matchedIds, onChoose: chooseEvent, registerEvent }),
              h(GraphPanel, {
                layout: computed.layout,
                selectedId,
                query: normalizedQuery,
                matchedIds,
                onChoose: chooseEvent,
                registerEvent,
                viewportRef: graphViewport,
                pan,
                scale,
                onPanStart,
                onPanMove,
                onPanEnd,
                onZoom: zoomBy,
                onFit: fitGraph,
              }),
              h(UngroupedRows, { rows: computed.model.ungrouped, onOpenSource: openSource })) : null,
            h(DetailDialog, {
              dialogRef,
              node: selectedNode,
              model: computed.model,
              onDismiss: dismissDetails,
              onClosed: handleDialogClosed,
              onNavigate: eventId => { setSelectedId(eventId); centerGraphEvent(eventId) },
              onOpenSource: openSource,
            }))
        }

        const EventExplorer = typeof React.memo === 'function' ? React.memo(EventExplorerView) : EventExplorerView

        const css = `
      .dst-explorer-root{box-sizing:border-box;display:flex;min-width:0;height:100%;min-height:0;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#f7f8fa);color:var(--dsw-alias-label-primary,#172033);font:14px/1.5 system-ui,sans-serif}.dst-explorer-root *{box-sizing:border-box}.dst-explorer-toolbar{display:flex;flex:0 0 auto;align-items:center;gap:18px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,#dfe3ea);background:var(--dsw-alias-bg-layer-1,#fff)}.dst-explorer-heading{display:flex;min-width:max-content;align-items:baseline;gap:9px}.dst-explorer-heading h1{margin:0;font-size:18px;line-height:1.25}.dst-explorer-kicker{color:var(--dsw-alias-brand-primary,#326fd1);font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.dst-explorer-revision,.dst-explorer-muted{color:var(--dsw-alias-label-secondary,#667085);font-size:12px}.dst-explorer-search{display:flex;min-width:240px;max-width:720px;flex:1;align-items:center;gap:6px}.dst-explorer-search label{min-width:0;flex:1}.dst-explorer-search input{width:100%;height:34px;padding:0 11px;border:1px solid var(--dsw-alias-border-l1,#cbd3df);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}.dst-explorer-search output{min-width:70px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;text-align:center}.dst-explorer-toolbar button,.dst-explorer-zoom button,.dst-explorer-relations button{min-height:32px;border:1px solid var(--dsw-alias-border-l1,#ccd5e3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;cursor:pointer;font:inherit}.dst-explorer-toolbar button{padding:0 10px}.dst-explorer-toolbar button:disabled,.dst-explorer-zoom button:disabled{opacity:.45;cursor:not-allowed}.dst-explorer-refresh{color:var(--dsw-alias-brand-primary,#326fd1)!important}.dst-explorer-content{display:grid;min-height:0;flex:1;grid-template-rows:minmax(250px,42%) minmax(320px,1fr) auto;gap:12px;padding:12px;overflow:auto}.dst-explorer-panel{min-width:0;min-height:0;border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:13px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 3px 14px rgba(15,23,42,.04);overflow:hidden}.dst-explorer-panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e4e7ec)}.dst-explorer-panel-head h2{margin:0;font-size:15px}.dst-explorer-panel-head p{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#667085);font-size:12px}.dst-explorer-count{padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#eef2f7);color:var(--dsw-alias-label-secondary,#667085);font-size:11px}.dst-explorer-gantt{display:flex;flex-direction:column}.dst-explorer-gantt-scroll{min-height:0;flex:1;padding:4px 14px 14px;overflow:auto}.dst-explorer-timeline{min-width:660px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#edf0f4)}.dst-explorer-timeline:last-child{border-bottom:0}.dst-explorer-timeline-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:5px}.dst-explorer-timeline-head>span{color:var(--dsw-alias-label-secondary,#667085);font-size:11px;font-variant-numeric:tabular-nums}.dst-explorer-axis{position:relative;height:24px;margin-left:190px;border-bottom:1px solid var(--dsw-alias-border-l1,#ccd5e3)}.dst-explorer-axis>span{position:absolute;bottom:2px;color:var(--dsw-alias-label-tertiary,#87909f);font-size:10px;transform:translateX(-50%)}.dst-explorer-axis>span::after{position:absolute;top:20px;bottom:-10000px;left:50%;width:1px;background:var(--dsw-alias-border-l3,#edf0f4);content:''}.dst-explorer-bars{position:relative;isolation:isolate}.dst-explorer-bar-row{content-visibility:auto;contain-intrinsic-size:32px;display:grid;grid-template-columns:180px minmax(450px,1fr);align-items:center;gap:10px;min-height:32px}.dst-explorer-event-button{border:0;background:none;color:inherit;cursor:pointer;font:inherit;text-align:left}.dst-explorer-bar-row>.dst-explorer-event-button{min-width:0;padding:3px 6px;border-radius:6px}.dst-explorer-bar-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-explorer-bar-track{position:relative;height:18px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#eef2f7) 80%,transparent)}.dst-explorer-bar{position:absolute;top:2px;height:14px;min-width:4px;border-radius:5px;background:var(--dsw-alias-brand-primary,#326fd1);box-shadow:0 1px 3px rgba(36,84,138,.2);overflow:hidden}.dst-explorer-bar>span{display:block;padding:0 5px;overflow:hidden;color:#fff;font-size:10px;line-height:14px;text-overflow:ellipsis;white-space:nowrap}.dst-explorer-bar.selected{outline:3px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#326fd1) 28%,transparent);outline-offset:2px}.dst-explorer-event-button.selected{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#326fd1) 12%,transparent);color:var(--dsw-alias-brand-primary,#24548a)}.dst-explorer-event-button.search-match{box-shadow:inset 0 0 0 2px #f2b84b}.dst-explorer-event-button.search-dim{opacity:.3}.dst-explorer-untimed-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:7px}.dst-explorer-untimed-item{display:flex;min-width:0;align-items:center;gap:8px;padding:7px 9px!important;border:1px solid var(--dsw-alias-border-l2,#dfe3ea)!important;border-radius:8px;background:var(--dsw-alias-bg-base,#fff)!important}.dst-explorer-untimed-item strong{max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-explorer-time-pill{display:inline-flex;width:max-content;max-width:100%;padding:1px 7px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:11px;overflow-wrap:anywhere}.dst-explorer-time-pill.label-only{background:#fff4d6;color:#744d00}.dst-explorer-time-pill.unknown{background:#f1f3f6;color:#667085}.dst-explorer-graph{display:flex;flex-direction:column}.dst-explorer-graph-head{flex:0 0 auto}.dst-explorer-zoom{display:flex;align-items:center;gap:5px}.dst-explorer-zoom button{min-width:32px;padding:0 8px}.dst-explorer-zoom output{min-width:48px;color:var(--dsw-alias-label-secondary,#667085);font-size:11px;text-align:center}.dst-explorer-graph-viewport{position:relative;min-height:280px;flex:1;overflow:hidden;background-color:var(--dsw-alias-bg-base,#f8fafc);background-image:radial-gradient(circle,var(--dsw-alias-border-l1,#d5dbe5) 1px,transparent 1px);background-size:18px 18px;cursor:grab;touch-action:none}.dst-explorer-graph-viewport.dragging{cursor:grabbing}.dst-explorer-graph-viewport:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#326fd1);outline-offset:-2px}.dst-explorer-graph-canvas{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}.dst-explorer-edges{position:absolute;inset:0;overflow:visible}.dst-explorer-edge{fill:none;stroke:#9aa8ba;stroke-width:2}.dst-explorer-edge.active{stroke:var(--dsw-alias-brand-primary,#326fd1);stroke-width:3}.dst-explorer-arrow{fill:#9aa8ba}.dst-explorer-graph-node{position:absolute!important;padding:0!important;overflow:visible}.dst-explorer-graph-node-position{display:flex;width:100%;height:100%;flex-direction:column;justify-content:center;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#cbd3df);border-radius:11px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 4px 12px rgba(15,23,42,.09);overflow:hidden}.dst-explorer-graph-node:hover .dst-explorer-graph-node-position,.dst-explorer-graph-node:focus-visible .dst-explorer-graph-node-position{border-color:var(--dsw-alias-brand-primary,#326fd1);box-shadow:0 7px 20px rgba(50,111,209,.18)}.dst-explorer-graph-node.selected .dst-explorer-graph-node-position{border:2px solid var(--dsw-alias-brand-primary,#326fd1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,var(--dsw-alias-brand-primary,#326fd1) 8%)}.dst-explorer-graph-node.search-match .dst-explorer-graph-node-position{box-shadow:0 0 0 3px #f2b84b}.dst-explorer-graph-node.search-dim .dst-explorer-graph-node-position{opacity:.3}.dst-explorer-graph-node-position strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.dst-explorer-node-summary,.dst-explorer-node-time,.dst-explorer-node-characters{overflow:hidden;color:var(--dsw-alias-label-secondary,#667085);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.dst-explorer-empty,.dst-explorer-loading{display:grid;min-height:160px;place-items:center;padding:24px;color:var(--dsw-alias-label-secondary,#667085);text-align:center}.dst-explorer-error{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 18px;border-bottom:1px solid #f1b8b8;background:#fff0f0;color:#9b1c1c}.dst-explorer-error button{border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer}.dst-explorer-ungrouped{padding:11px 14px;border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff)}.dst-explorer-ungrouped>summary{cursor:pointer;font-weight:700}.dst-explorer-detail-dialog{position:fixed;inset:0 0 0 auto;width:min(520px,calc(100vw - 32px));height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;border-left:1px solid var(--dsw-alias-border-l1,#cbd3df);background:transparent;color:inherit;box-shadow:-18px 0 50px rgba(15,23,42,.18)}.dst-explorer-detail-dialog::backdrop{background:rgba(15,23,42,.36)}.dst-explorer-detail-card{display:flex;width:100%;height:100%;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff)}.dst-explorer-detail-head{display:flex;flex:0 0 auto;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px;border-bottom:1px solid var(--dsw-alias-border-l2,#e4e7ec)}.dst-explorer-detail-head h2{margin:2px 0 0;font-size:20px;overflow-wrap:anywhere}.dst-explorer-detail-head p{margin:4px 0 0;color:var(--dsw-alias-label-secondary,#667085)}.dst-explorer-close{width:36px;height:36px;border:0;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#eef2f7);color:inherit;cursor:pointer;font:24px/1 system-ui}.dst-explorer-detail-body{min-height:0;flex:1;padding:0 18px 28px;overflow:auto}.dst-explorer-detail-section{padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#edf0f4)}.dst-explorer-detail-section:last-child{border-bottom:0}.dst-explorer-detail-section h3,.dst-explorer-detail-section h4{margin:0 0 9px}.dst-explorer-detail-grid{display:grid;grid-template-columns:110px minmax(0,1fr);gap:7px 12px;margin:0}.dst-explorer-detail-grid dt{color:var(--dsw-alias-label-secondary,#667085);font-size:12px;font-weight:650}.dst-explorer-detail-grid dd{min-width:0;margin:0;overflow-wrap:anywhere}.dst-explorer-relations{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}.dst-explorer-relations li{padding:9px;border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:9px}.dst-explorer-relations button{height:auto;min-height:0;padding:0;border:0;color:var(--dsw-alias-brand-primary,#326fd1);font-weight:700;text-align:left;overflow-wrap:anywhere}.dst-explorer-relations p{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.dst-explorer-source-list{margin:6px 0 0;padding-left:22px}.dst-explorer-source-list li{padding:2px 0;overflow-wrap:anywhere}.dst-explorer-memory-list{display:flex;flex-direction:column;gap:12px}.dst-explorer-memory-detail{padding:13px;border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:11px;background:var(--dsw-alias-bg-base,#fafbfc)}.dst-explorer-memory-detail>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dst-explorer-memory-detail h3{margin:5px 0 10px;font-size:14px;overflow-wrap:anywhere}.dst-explorer-table-pill{display:inline-block;padding:1px 7px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:10px;font-weight:700}.dst-explorer-importance{flex:none;color:var(--dsw-alias-label-secondary,#667085);font-size:11px}.dst-explorer-json{max-width:100%;max-height:none;margin:0;padding:11px;border-radius:8px;background:#111827;color:#e5e7eb;white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.dst-explorer-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:760px){.dst-explorer-toolbar{flex-wrap:wrap;gap:10px}.dst-explorer-heading{width:100%}.dst-explorer-search{min-width:0;order:3;width:100%}.dst-explorer-content{grid-template-rows:minmax(250px,42%) minmax(300px,1fr) auto}.dst-explorer-detail-dialog{width:100vw}.dst-explorer-detail-grid{grid-template-columns:90px minmax(0,1fr)}}@media(prefers-reduced-motion:reduce){.dst-explorer-root *{scroll-behavior:auto!important}}
      .dst-explorer-panel-head{border-bottom:1px solid var(--dsw-alias-border-l2,#e4e7ec)}.dst-explorer-timeline{--dst-gantt-label-width:clamp(220px,22vw,340px);min-width:760px}.dst-explorer-axis{margin-left:calc(var(--dst-gantt-label-width) + 10px)}.dst-explorer-axis>span::after{content:none}.dst-explorer-axis>span.first{transform:none}.dst-explorer-axis>span.current{color:#9a5b12;font-weight:700;transform:translateX(-100%)}.dst-explorer-axis>span.current::before{display:inline-block;width:6px;height:6px;margin-right:4px;border-radius:50%;background:#c7771d;content:'';vertical-align:1px}.dst-explorer-bar-row{grid-template-columns:var(--dst-gantt-label-width) minmax(450px,1fr)}.dst-explorer-bar-track{overflow:visible;background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-bg-layer-2,#eef2f7) 82%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-2,#eef2f7) 55%,transparent))}.dst-explorer-bar{min-width:0;padding:0;border:0;color:#fff;cursor:pointer;font:inherit}.dst-explorer-bar.point{top:5px;width:8px;height:8px;border-radius:50%}.dst-explorer-bar.end-unrecorded{min-width:5px;border-radius:5px 2px 2px 5px;background:repeating-linear-gradient(135deg,#b66916 0,#b66916 6px,#d9913c 6px,#d9913c 11px)}.dst-explorer-bar.end-unrecorded::after{position:absolute;top:0;right:0;width:3px;height:100%;background:#92500e;content:''}.dst-explorer-bar.search-match{box-shadow:0 0 0 3px #f2b84b}.dst-explorer-bar.search-dim{opacity:.3}.dst-explorer-node-id{overflow:hidden;color:var(--dsw-alias-label-tertiary,#87909f);font:10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.dst-explorer-edge-meta{display:grid;grid-template-columns:82px minmax(0,1fr);gap:3px 8px;margin:8px 0 0;font-size:11px}.dst-explorer-edge-meta dt{color:var(--dsw-alias-label-secondary,#667085);font-weight:650}.dst-explorer-edge-meta dd{min-width:0;margin:0;overflow-wrap:anywhere}.dst-explorer-raw{margin-top:10px}.dst-explorer-raw>summary{color:var(--dsw-alias-brand-primary,#326fd1);cursor:pointer;font-size:12px}.dst-explorer-raw>.dst-explorer-json{margin-top:8px}
      `

        // The public View marker opts into the host's fixed-height layout. Reserve its
        // measured composer seat so the graph remains usable above the native input.
        const viewportCss = `
      .dst-explorer-axis>span{white-space:nowrap}
      .dst-explorer-root{width:100%;padding-bottom:calc(var(--dsh-composer-height,152px) + 8px);container-type:inline-size;container-name:dst-events}
      .dst-explorer-maintenance{flex:0 0 auto;padding:7px 18px;border-bottom:1px solid var(--dsw-alias-border-l3,#edf0f4);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#667085);font-size:12px}.dst-explorer-maintenance.busy{background:#fff8e8;color:#80550a}.dst-explorer-maintenance.ready{background:#eef8f1;color:#28613a}.dst-explorer-maintenance.error{background:#fff0f0;color:#9b1c1c}.dst-explorer-memory-summary,.dst-explorer-event-summary{white-space:pre-wrap;overflow-wrap:anywhere}.dst-explorer-memory-summary{margin:0 0 12px;font-size:14px;line-height:1.7}.dst-explorer-facts{margin:0 0 13px}.dst-explorer-facts h4{margin:0 0 6px}.dst-explorer-facts ul{margin:0;padding-left:21px}.dst-explorer-facts li{padding:2px 0}.dst-explorer-source-list button{height:auto;padding:1px 0;border:0;background:none;color:var(--dsw-alias-brand-primary,#24548a);cursor:pointer;font:inherit;text-align:left;text-decoration:underline;text-underline-offset:2px}.dst-explorer-technical{margin-top:12px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l2,#dfe3ea)}.dst-explorer-technical>summary{color:var(--dsw-alias-label-secondary,#667085);cursor:pointer;font-size:12px}.dst-explorer-technical[open]>summary{margin-bottom:8px}.dst-explorer-technical>.dst-explorer-json{margin-top:10px}.dst-explorer-event-technical{margin-bottom:20px}.dst-explorer-node-meta{overflow:hidden;color:var(--dsw-alias-label-tertiary,#87909f);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
      .dst-explorer-content{grid-template-rows:minmax(156px,34%) minmax(220px,1fr) auto;gap:10px;padding:10px}
      .dst-explorer-graph-viewport{min-height:0}
      .dst-explorer-timeline-head>div:first-child{display:flex;min-width:0;flex-direction:column;gap:1px}.dst-explorer-viewport-range,.dst-explorer-timeline-domain{color:var(--dsw-alias-label-secondary,#667085);font-size:10px;font-variant-numeric:tabular-nums}.dst-explorer-timeline-domain{margin:0 0 2px var(--dst-gantt-label-width);padding-left:10px}.dst-explorer-timeline-controls{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}.dst-explorer-timeline-controls button,.dst-explorer-focus-time{min-height:24px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l1,#ccd5e3);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#667085);cursor:pointer;font:10px/1.2 system-ui,sans-serif}.dst-explorer-timeline-controls button:disabled{opacity:.42;cursor:not-allowed}.dst-explorer-bar-label{display:grid;min-width:0;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px}.dst-explorer-bar-label>.dst-explorer-event-button{min-width:0;padding:3px 6px;border-radius:6px}.dst-explorer-focus-time{white-space:nowrap}.dst-explorer-bar.minimum-marker{z-index:1}
      @container dst-events (max-width:850px){.dst-explorer-toolbar{flex-wrap:wrap;gap:8px;padding:10px}.dst-explorer-heading{width:100%;min-width:0}.dst-explorer-search{min-width:0;max-width:none;order:3;width:100%}.dst-explorer-refresh{margin-left:auto}.dst-explorer-heading h1{font-size:16px}.dst-explorer-kicker{letter-spacing:0}}
      `
        return { EventExplorer, css: css + viewportCss }
      }
      return module.exports
    })()
    const eventExplorerUI = createEventExplorerUI(React, eventExplorerModel)
    // END GENERATED EVENT EXPLORER
    const {
      Menu, MarkdownText, JsonBlock, Tooltip,
      IconChevronDownOutline14, IconSettingsOutline14,
      IconRefreshOutline16, IconEditOutline16, IconRightUpOutline16,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const API = '/api/dsh-sillytavern'

    const overlay = (() => {
      let state = { open: false, mode: 'manager', sessionId: null, version: 0, dataVersion: 0 }
      const listeners = new Set()
      const publish = next => {
        state = { ...state, ...next, version: state.version + 1 }
        for (const listener of listeners) listener()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        open(mode, sessionId = null) { publish({ open: true, mode, sessionId }) },
        close() { publish({ open: false }) },
        changed() { publish({ dataVersion: state.dataVersion + 1 }) },
        reset() { publish({ open: false, mode: 'manager', sessionId: null }) },
      }
    })()

    function createSessionStore(emptyValue) {
      const values = new Map()
      const listeners = new Set()
      return {
        get: id => values.get(id)?.value ?? emptyValue,
        set(id, value, token) {
          const previous = values.get(id)
          if (previous?.token === token) return
          values.set(id, { value, token })
          for (const listener of listeners) listener()
        },
        clear(id) {
          if (!values.delete(id)) return
          for (const listener of listeners) listener()
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        reset() { values.clear(); for (const listener of listeners) listener() },
      }
    }

    const scriptPolicies = createSessionStore(Object.freeze([]))
    const scriptScopes = createSessionStore(Object.freeze({}))
    const scriptEvents = createSessionStore(null)
    const useSessionStore = (store, sessionId) => React.useSyncExternalStore(store.subscribe, () => store.get(sessionId), () => store.get(sessionId))

    const regexWorkerSource = String.raw`
const macroValue = (token, scope) => {
  const name = String(token).trim();
  const character = scope && (scope.character || (scope.card && scope.card.data)) || {};
  const variables = scope && scope.variables || {};
  const globalVariables = scope && scope.globalVariables || {};
  if (name === 'char' || name === 'charIfNotGroup') return scope && scope.char != null ? scope.char : character.nickname || character.name || '';
  if (name === 'user') return scope && scope.user != null ? scope.user : scope && scope.persona && scope.persona.name || scope && scope.userPersona && scope.userPersona.name || '';
  if (name === 'notChar') return scope && scope.user != null ? scope.user : scope && scope.persona && scope.persona.name || scope && scope.userPersona && scope.userPersona.name || '';
  if (name === 'group' || name === 'groupNotMuted') return scope && scope.group || '';
  if (name === 'description') return character.description || '';
  if (name === 'personality') return character.personality || '';
  if (name === 'scenario') return character.scenario || '';
  if (name === 'firstMessage' || name === 'first_mes' || name === 'charFirstMessage') return character.first_mes || character.firstMessage || '';
  if (name.startsWith('charFirstMessage::')) { const index = Number(name.slice(18)); const greetings = [character.first_mes || character.firstMessage || '', ...(Array.isArray(character.alternate_greetings) ? character.alternate_greetings : [])]; return Number.isSafeInteger(index) && index >= 0 ? greetings[index] || '' : ''; }
  if (name === 'persona') return scope && scope.persona && scope.persona.description || scope && scope.userPersona && scope.userPersona.description || '';
  if (name === 'mesExamples' || name === 'mesExamplesRaw') return character.mes_example || '';
  if (name === 'systemPrompt' || name === 'charPrompt') return character.system_prompt || '';
  if (name === 'charInstruction') return character.post_history_instructions || '';
  if (name === 'charCreatorNotes') return character.creator_notes || '';
  if (name === 'charVersion') return character.character_version || '';
  if (name === 'input') return scope && scope.input || '';
  if (name === 'original') return scope && scope.original || '';
  if (name === 'newline') return '\n'; if (name.startsWith('newline::')) return '\n'.repeat(Math.max(0, Math.min(10000, Number(name.slice(9)) || 0)));
  if (name === 'space') return ' '; if (name.startsWith('space::')) return ' '.repeat(Math.max(0, Math.min(10000, Number(name.slice(7)) || 0)));
  if (name === 'noop') return '';
  if (name === 'date') return new Date(scope && scope.now || Date.now()).toLocaleDateString();
  if (name === 'time') return new Date(scope && scope.now || Date.now()).toLocaleTimeString();
  if (name === 'weekday') return new Date(scope && scope.now || Date.now()).toLocaleDateString(undefined, { weekday: 'long' });
  if (name === 'isodate') return new Date(scope && scope.now || Date.now()).toISOString().slice(0, 10);
  if (name === 'isotime') return new Date(scope && scope.now || Date.now()).toISOString().slice(11, 19);
  if (name === 'lastMessage') return scope && Array.isArray(scope.messages) && scope.messages.length ? scope.messages[scope.messages.length - 1].text || '' : '';
  if (name === 'lastUserMessage') { const messages = scope && Array.isArray(scope.messages) ? [...scope.messages].reverse() : []; return messages.find(message => message && message.role === 'user')?.text || ''; }
  if (name === 'lastCharMessage') { const messages = scope && Array.isArray(scope.messages) ? [...scope.messages].reverse() : []; return messages.find(message => message && message.role === 'assistant')?.text || ''; }
  if (name === 'lastMessageId') return String(scope && Array.isArray(scope.messages) && scope.messages.length ? scope.messages[scope.messages.length - 1].seq ?? '' : '');
  if (name === 'firstIncludedMessageId' || name === 'firstDisplayedMessageId') return String(scope && Array.isArray(scope.messages) && scope.messages.length ? scope.messages[0].seq ?? '' : '');
  if (name === 'allChatRange') return scope && Array.isArray(scope.messages) ? scope.messages.map(message => message && message.text || '').join('\n') : '';
  if (name === 'currentSwipeId' || name === 'lastSwipeId') return String(scope && scope.currentSwipeId != null ? scope.currentSwipeId : 0);
  if (name.startsWith('reverse::')) return [...name.slice(9)].reverse().join('');
  if (name.startsWith('random::') || name.startsWith('pick::')) { const values = name.slice(name.indexOf('::') + 2).split('::'); return values.length ? values[Math.floor(Math.random() * values.length)] || '' : ''; }
  if (/^roll(?:::|\s)/i.test(name)) { const expression = name.replace(/^roll(?:::|\s)+/i, '').trim(); const match = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(expression); if (!match) return ''; const count = Math.max(1, Math.min(1000, Number(match[1] || 1))); const sides = Math.max(1, Math.min(1000000, Number(match[2]))); let total = Number(match[3] || 0); for (let index = 0; index < count; index += 1) total += 1 + Math.floor(Math.random() * sides); return String(total); }
  if (name.startsWith('getvar::')) return variables[name.slice(8)] == null ? '' : variables[name.slice(8)];
  if (name.startsWith('globalvar::')) return globalVariables[name.slice(11)] == null ? '' : globalVariables[name.slice(11)];
  if (name.startsWith('getglobalvar::')) return globalVariables[name.slice(14)] == null ? '' : globalVariables[name.slice(14)];
  if (name.startsWith('hasvar::')) return Object.hasOwn(variables, name.slice(8)) ? 'true' : 'false';
  if (name.startsWith('hasglobalvar::')) return Object.hasOwn(globalVariables, name.slice(14)) ? 'true' : 'false';
  return undefined;
};
const substitute = (input, scope, transform = value => value) => String(input == null ? '' : input).replace(/{{([\s\S]*?)}}/g, (whole, token) => {
  const value = macroValue(token, scope || {});
  return value === undefined ? whole : String(transform(String(value)));
});
const escapeMacro = value => String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, character => {
  if (character === '\n') return '\\n'; if (character === '\r') return '\\r'; if (character === '\t') return '\\t';
  if (character === '\v') return '\\v'; if (character === '\f') return '\\f'; if (character === '\0') return '\\0';
  return '\\' + character;
});
const parseRegex = input => {
  try {
    const text = String(input == null ? '' : input);
    const match = text.match(/(\/?)(.+)\1([a-z]*)/i);
    if (!match) return null;
    if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) return new RegExp(text);
    return new RegExp(match[2], match[3]);
  } catch { return null; }
};
const filterString = (value, trims, scope) => {
  let output = String(value);
  for (const rawTrim of Array.isArray(trims) ? trims : []) output = output.replaceAll(substitute(rawTrim, scope), '');
  return output;
};
const runRule = (rule, input, scope) => {
  if (!rule || rule.disabled === true || !rule.findRegex || !input) return input;
  scope = { ...(scope || {}), original: scope && scope.original != null ? scope.original : input };
  let regexText = String(rule.findRegex);
  if (Number(rule.substituteRegex) === 1) regexText = substitute(regexText, scope);
  else if (Number(rule.substituteRegex) === 2) regexText = substitute(regexText, scope, escapeMacro);
  const regex = parseRegex(regexText);
  if (!regex) return input;
  if (regex.global || regex.sticky) regex.lastIndex = 0;
  const replacement = String(rule.replaceString == null ? rule.source || '' : rule.replaceString).replace(/{{match}}/gi, '$0');
  return String(input).replace(regex, function (match) {
    const args = [...arguments];
    const expanded = replacement.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_token, number, groupName) => {
      let value;
      if (number) value = args[Number(number)];
      else { const groups = args[args.length - 1]; value = groups && typeof groups === 'object' ? groups[groupName] : undefined; }
      return value ? filterString(value, rule.trimStrings, scope) : '';
    });
    return substitute(expanded, scope);
  });
};
const stageMatches = (rule, options) => rule.markdownOnly === true && options.isMarkdown === true
  || rule.promptOnly === true && options.isPrompt === true
  || rule.markdownOnly !== true && rule.promptOnly !== true && options.isMarkdown !== true && options.isPrompt !== true;
self.onmessage = event => {
  const { id, text, rules, options = {}, scope = {} } = event.data || {};
  try {
    let output = String(text == null ? '' : text);
    const passScope = { ...scope, original: scope.original != null ? scope.original : output };
    const applied = [];
    const errors = [];
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!options.force) {
        if (rule.enabled !== true || rule.disabled === true || !stageMatches(rule, options)) continue;
        if (options.isEdit === true && rule.runOnEdit !== true) continue;
        if (typeof options.depth === 'number') {
          if (!Number.isNaN(rule.minDepth) && rule.minDepth != null && rule.minDepth >= -1 && options.depth < rule.minDepth) continue;
          if (!Number.isNaN(rule.maxDepth) && rule.maxDepth != null && rule.maxDepth >= 0 && options.depth > rule.maxDepth) continue;
        }
        if (!Array.isArray(rule.placement) || !rule.placement.includes(options.placement)) continue;
      }
      try {
        const next = runRule(rule, output, passScope);
        if (next !== output) applied.push(String(rule.id || rule.name || ''));
        output = next;
      } catch (error) { errors.push({ id: String(rule.id || ''), message: error && error.message ? error.message : String(error) }); }
    }
    self.postMessage({ id, ok: true, value: { text: output, applied, errors } });
  } catch (error) { self.postMessage({ id, ok: false, error: error && error.message ? error.message : String(error) }); }
};`

    const regexEngine = (() => {
      let workerUrl = null
      let nextId = 0
      const workers = new Set()
      const url = () => {
        if (workerUrl === null) workerUrl = URL.createObjectURL(new Blob([regexWorkerSource], { type: 'text/javascript' }))
        return workerUrl
      }
      return {
        run(text, rules, signal, options = {}, scope = {}) {
          if (signal?.aborted) return Promise.reject(signal.reason || new Error('regex rendering aborted'))
          const id = ++nextId
          const worker = new Worker(url())
          workers.add(worker)
          return new Promise((resolve, reject) => {
            let settled = false
            const finish = callback => {
              if (settled) return
              settled = true
              signal?.removeEventListener('abort', aborted)
              workers.delete(worker)
              worker.terminate()
              callback()
            }
            const aborted = () => finish(() => reject(signal.reason || new Error('regex rendering aborted')))
            signal?.addEventListener('abort', aborted, { once: true })
            worker.onmessage = event => finish(() => { if (event.data?.ok !== true) return reject(new Error(event.data?.error || 'regex rendering failed')); const value = event.data.value; if (Array.isArray(value?.errors) && value.errors.length > 0) console.warn('[dsh-sillytavern] Regex rule errors', value.errors); resolve(value) })
            worker.onerror = event => finish(() => reject(new Error(event?.message || 'regex rendering worker failed')))
            try { worker.postMessage({ id, text: String(text), rules: structuredClone(rules), options: structuredClone(options), scope: structuredClone(scope) }) }
            catch (error) { finish(() => reject(error)) }
          })
        },
        dispose() {
          for (const worker of workers) worker.terminate()
          workers.clear()
          if (workerUrl !== null) URL.revokeObjectURL(workerUrl)
          workerUrl = null
        },
      }
    })()

    async function api(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      })
      let body
      try { body = await response.json() } catch { throw new Error(`HTTP ${response.status}`) }
      if (!response.ok || body.ok !== true) {
        const error = new Error(body.error || `HTTP ${response.status}`)
        error.code = body.code
        error.status = response.status
        error.details = body.details
        error.body = body
        throw error
      }
      return body.value
    }

    function useOverlay() {
      return React.useSyncExternalStore(overlay.subscribe, overlay.getSnapshot, overlay.getSnapshot)
    }

    function useAsync(load, deps) {
      const [state, setState] = React.useState({ loading: true, value: null, error: null })
      React.useEffect(() => {
        const controller = new AbortController()
        setState(previous => ({ ...previous, loading: true, error: null }))
        Promise.resolve(load(controller.signal)).then(value => {
          if (!controller.signal.aborted) setState({ loading: false, value, error: null })
        }).catch(error => {
          if (!controller.signal.aborted) setState({ loading: false, value: null, error: error instanceof Error ? error.message : String(error) })
        })
        return () => controller.abort()
      }, deps)
      return state
    }

    const compatRuntime = (() => {
      const sessions = new Map()
      const frames = new Map()
      const frameCalls = new Map()
      const lifecycleClientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`
      let frameCallSeq = 0
      let removeWindowListener = null
      let nextRevision = 0

      const clone = value => value === undefined ? undefined : structuredClone(value)
      const sessionFor = sessionId => {
        const id = String(sessionId)
        let runtime = sessions.get(id)
        if (runtime === undefined) {
          runtime = { id, snapshot: null, token: undefined, eventToken: undefined, listeners: new Set(), frames: new Set(), composer: null, queue: Promise.resolve(), cardId: undefined, eventSeq: -1, eventsInitialized: false }
          sessions.set(id, runtime)
        }
        return runtime
      }
      const notify = runtime => { for (const listener of runtime.listeners) listener() }
      const post = (registration, message) => registration.getWindow()?.postMessage({ __dshSillyTavern: true, channel: registration.channel, ...message }, '*')
      const frameError = (message, code) => Object.assign(new Error(message), { code })
      const readyFrames = runtime => [...runtime.frames].map(channel => frames.get(channel)).filter(registration => registration?.ready === true)
      const callFrame = (registration, kind, payload = {}) => new Promise((resolve, reject) => {
        const target = registration.ready === true ? registration.getWindow() : null
        if (target === null || target === undefined) {
          registration.ready = false
          reject(frameError('script callback owner was detached', 'dsh-frame-detached'))
          return
        }
        const id = `host-${++frameCallSeq}`
        const timer = window.setTimeout(() => {
          frameCalls.delete(id)
          registration.ready = false
          reject(frameError(`script callback ${kind} timed out`, 'dsh-frame-timeout'))
        }, 10000)
        frameCalls.set(id, { channel: registration.channel, resolve, reject, timer })
        target.postMessage({ __dshSillyTavern: true, channel: registration.channel, event: 'compat-call', payload: { id, kind, ...payload } }, '*')
      })
      const callFrames = async (owners, kind, payload) => {
        const settled = await Promise.allSettled(owners.map(owner => callFrame(owner, kind, payload)))
        const detached = settled.find(item => item.status === 'rejected' && item.reason?.code === 'dsh-frame-detached')
        if (detached) throw detached.reason
        const failed = settled.find(item => item.status === 'rejected' && item.reason?.code !== 'dsh-frame-timeout')
        if (failed) throw failed.reason
        return settled.flatMap((item, index) => item.status === 'fulfilled' ? [{ owner: owners[index], value: item.value }] : [])
      }
      const drainWrites = async runtime => {
        await runtime.queue
        if (runtime.writeError) { const error = runtime.writeError; runtime.writeError = null; throw error }
      }
      const prepareRuntime = async runtime => {
        const barriers = await callFrames(readyFrames(runtime), 'barrier')
        await drainWrites(runtime)
        const results = await callFrames(barriers.map(item => item.owner), 'filters')
        await drainWrites(runtime)
        return { eligibleInjectionIds: results.flatMap(item => item.value?.eligibleInjectionIds || []), ownerFrameIds: results.map(item => item.owner.channel) }
      }
      const pollLifecycle = async runtime => {
        if (readyFrames(runtime).length === 0 || runtime.polling) return
        runtime.polling = true
        try {
          const requests = await api(`/compat/lifecycle?sessionId=${encodeURIComponent(runtime.id)}&clientId=${encodeURIComponent(lifecycleClientId)}`)
          for (const request of requests || []) {
            let result, error
            try {
              if (request.kind === 'prepare') result = await prepareRuntime(runtime)
              else if (request.kind === 'macros') {
                let texts = request.payload.texts
                for (const owner of readyFrames(runtime)) {
                  try { texts = (await callFrame(owner, 'macros', { texts })).texts }
                  catch (failure) {
                    if (failure?.code === 'dsh-frame-timeout') continue
                    throw failure
                  }
                }
                await drainWrites(runtime)
                result = { texts }
              }
              else throw new Error(`unknown lifecycle request ${request.kind}`)
            } catch (failure) {
              if (failure?.code === 'dsh-frame-detached') continue
              error = failure?.message || String(failure)
            }
            await api('/compat/lifecycle/result', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, clientId: lifecycleClientId, id: request.id, result, error }) })
          }
        } catch (error) { console.error('[dsh-sillytavern] lifecycle coordination failed', error) }
        finally {
          runtime.polling = false
          if (readyFrames(runtime).length > 0 && sessions.get(runtime.id) === runtime) runtime.pollTimer = window.setTimeout(() => void pollLifecycle(runtime), 250)
        }
      }
      const broadcastState = runtime => {
        if (runtime.snapshot === null) return
        for (const channel of runtime.frames) {
          const registration = frames.get(channel)
          if (registration !== undefined) post(registration, { event: 'compat-state', payload: clone(runtime.snapshot) })
        }
      }
      const set = (sessionId, snapshot, token) => {
        if (snapshot === null || snapshot === undefined) return
        const runtime = sessionFor(sessionId)
        if (token !== undefined && runtime.token === token) return
        runtime.token = token
        runtime.snapshot = { ...clone(snapshot), activeGenerationIds: [...(runtime.generations || [])], runtimeRevision: ++nextRevision }
        const history = runtime.snapshot.state?.history || []
        runtime.eventSeq = Math.max(runtime.eventSeq, ...history.map(message => Number(message?.seq)).filter(Number.isSafeInteger), -1)
        runtime.cardId = runtime.snapshot.cardRecord?.id ?? null
        notify(runtime)
        broadcastState(runtime)
      }
      const patchSnapshot = (runtime, patch) => {
        if (runtime.snapshot === null) return
        // Variable scopes and their backing resources share the same CAS counter.
        const revisions = { ...(runtime.snapshot.variableRevisions || {}), ...(patch.variableRevisions || {}) }
        for (const [field, scope] of [['bindingRevision', 'chat'], ['regexRevision', 'global'], ['chatRevision', 'message']]) {
          if (Object.hasOwn(patch, field)) revisions[scope] = patch[field]
          else if (Object.hasOwn(patch.variableRevisions || {}, scope)) patch[field] = revisions[scope]
        }
        patch = { ...patch, variableRevisions: revisions }
        runtime.snapshot = { ...runtime.snapshot, ...clone(patch), runtimeRevision: ++nextRevision }
        notify(runtime)
        broadcastState(runtime)
      }
      const broadcastEvent = (runtime, name, args, exceptChannel) => {
        for (const channel of runtime.frames) {
          if (channel === exceptChannel) continue
          const registration = frames.get(channel)
          if (registration !== undefined) post(registration, { event: 'compat-event', payload: { name, args: clone(args) } })
        }
      }
      const applyEventState = (sessionId, state) => {
        if (state === null || state === undefined) return
        const runtime = sessionFor(sessionId)
        if (runtime.snapshot === null) return
        const history = Array.isArray(state.history) ? state.history : []
        const eventToken = `${state.card?.id || 'none'}:${state.cursor ?? -1}:${state.compatChatRevision ?? -1}:${history.at(-1)?.seq ?? -1}:${history.length}:${state.unavailable === true}`
        if (runtime.eventToken === eventToken) return
        runtime.eventToken = eventToken
        const stateView = { ...(runtime.snapshot.state || {}), history: clone(history) }
        const patch = { state: stateView, chatRevision: Number(state.compatChatRevision ?? runtime.snapshot.chatRevision ?? 0) }
        if (Array.isArray(state.messages)) patch.messages = clone(state.messages)
        patchSnapshot(runtime, patch)
        const cardId = state.card?.id ?? null
        if (runtime.eventsInitialized && cardId !== runtime.cardId) broadcastEvent(runtime, 'chat_id_changed', [runtime.id])
        const newer = history.filter(message => Number.isSafeInteger(message?.seq) && message.seq > runtime.eventSeq)
        if (runtime.eventsInitialized) for (const message of newer) {
          const projectedId = (runtime.snapshot.messages || []).findIndex(item => item.sourceSeq === message.seq || item.event_seq === message.seq)
          const messageId = projectedId >= 0 ? projectedId : history.indexOf(message)
          if (message.role === 'user') {
            broadcastEvent(runtime, 'message_sent', [messageId])
            broadcastEvent(runtime, 'user_message_rendered', [messageId])
          } else if (message.role === 'assistant') {
            broadcastEvent(runtime, 'message_received', [messageId, 'normal'])
            broadcastEvent(runtime, 'character_message_rendered', [messageId, 'normal'])
          }
        }
        runtime.eventsInitialized = true
        runtime.cardId = cardId
        if (history.length > 0) runtime.eventSeq = Math.max(runtime.eventSeq, ...history.map(message => Number(message?.seq)).filter(Number.isSafeInteger))
      }
      const mergeSessionView = (runtime, view) => {
        const binding = view?.binding ?? runtime.snapshot?.state?.binding ?? null
        patchSnapshot(runtime, {
          bindingRevision: Number(binding?.revision ?? runtime.snapshot?.bindingRevision ?? 0),
          variables: clone(binding?.variables ?? runtime.snapshot?.variables ?? {}),
          scriptInjections: clone(binding?.scriptInjections ?? runtime.snapshot?.scriptInjections ?? []),
          state: { ...(runtime.snapshot?.state || {}), ...(view || {}), history: runtime.snapshot?.state?.history || [] },
        })
      }
      const patchVariableScope = (runtime, option, variables, metadata = {}) => {
        if (runtime.snapshot === null) return
        const type = String(option?.type || 'chat')
        const scopes = clone(runtime.snapshot.variableScopes || {})
        scopes[type] = clone(variables || {})
        const patch = { variableScopes: scopes }
        if (type === 'chat') {
          patch.variables = clone(variables || {})
          patch.state = { ...(runtime.snapshot.state || {}), binding: { ...(runtime.snapshot.state?.binding || {}), variables: clone(variables || {}) } }
        } else if (type === 'global') patch.globalVariables = clone(variables || {})
        const maps = clone(runtime.snapshot.variableMaps || {})
        if (type === 'global') maps.global = clone(variables || {})
        else if (type === 'preset') {
          const ids = Array.isArray(runtime.snapshot.state?.binding?.templateIds) ? runtime.snapshot.state.binding.templateIds.map(String).sort() : []
          maps.presets ||= {}; maps.presets[ids.length === 0 ? 'in_use' : ids.join('\u001f')] = clone(variables || {})
        } else if (type === 'character') {
          maps.characters ||= {}; maps.characters[String(runtime.snapshot.cardRecord?.id || '')] = clone(variables || {})
        } else if (type === 'script') {
          maps.scripts ||= {}; maps.scripts[`${String(runtime.snapshot.cardRecord?.id || 'none')}\u001f${String(metadata.scriptId || option?.script_id || 'unknown')}`] = clone(variables || {})
        } else if (type === 'extension') {
          maps.extensions ||= {}; maps.extensions[String(option?.extension_id || '')] = clone(variables || {})
        } else if (type === 'message') {
          const messages = clone(runtime.snapshot.messages || [])
          const raw = option?.message_id ?? 'latest'
          let index = raw === 'latest' ? messages.length - 1 : Number(raw)
          if (index < 0) index = messages.length + index
          if (Number.isSafeInteger(index) && messages[index]) messages[index].data = clone(variables || {})
          patch.messages = messages
        }
        patch.variableMaps = maps
        patchSnapshot(runtime, patch)
      }
      const persistVariableScope = (runtime, option, variables, metadata = {}) => {
        const operation = runtime.queue.then(async () => {
          const type = String(option?.type || 'chat')
          const revisions = runtime.snapshot?.variableRevisions || {}
          const revisionKey = type === 'chat' ? 'chat' : type === 'global' ? 'global' : type === 'message' ? 'message' : 'workspace'
          try {
            const value = await api('/compat/variables/replace', {
              method: 'POST',
              body: JSON.stringify({ sessionId: runtime.id, option, variables, scriptId: metadata.scriptId, extensionId: option?.extension_id, expectedRevision: Number(revisions[revisionKey] || 0) }),
            })
            patchVariableScope(runtime, option, variables, metadata)
            patchSnapshot(runtime, { variableRevisions: clone(value?.revisions || revisions) })
            return value
          } catch (error) {
            const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
            set(runtime.id, fresh)
            throw error
          }
        })
        runtime.queue = operation.catch(error => { runtime.writeError = error })
        return operation
      }
      const persistSessionPatch = (runtime, patch) => {
        const operation = runtime.queue.then(async () => {
          const expectedRevision = Number(runtime.snapshot?.bindingRevision ?? 0)
          try {
            const view = await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, patch: { ...patch, expectedRevision } }) })
            mergeSessionView(runtime, view)
            return view
          } catch (error) {
            const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
            set(runtime.id, fresh)
            throw error
          }
        })
        runtime.queue = operation.catch(error => { runtime.writeError = error })
        return operation
      }
      const handleAction = async (registration, message) => {
        const runtime = sessionFor(registration.sessionId)
        const args = message.args || {}
        if (registration.actions && typeof registration.actions[message.action] === 'function') return registration.actions[message.action](args, registration.channel)
        if (message.action === 'getState') return clone(runtime.snapshot?.state ?? null)
        if (message.action === 'getWorldbook') return clone(runtime.snapshot?.worldbook ?? null)
        if (message.action === 'replaceVariables' || message.action === 'setVariables') {
          const variables = args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables) ? clone(args.variables) : {}
          const option = args.option && typeof args.option === 'object' ? clone(args.option) : { type: 'chat' }
          patchVariableScope(runtime, option, variables, { scriptId: registration.scriptId })
          return persistVariableScope(runtime, option, variables, { scriptId: registration.scriptId })
        }
        if (message.action === 'injectPrompts') {
          const incoming = Array.isArray(args.prompts) ? args.prompts : []
          const byId = new Map((runtime.snapshot?.scriptInjections || []).map(item => [String(item.id), item]))
          for (const item of incoming) byId.set(String(item.id), clone(item))
          const scriptInjections = [...byId.values()]
          patchSnapshot(runtime, { scriptInjections, state: { ...(runtime.snapshot?.state || {}), binding: { ...(runtime.snapshot?.state?.binding || {}), scriptInjections } } })
          return persistSessionPatch(runtime, { scriptInjections })
        }
        if (message.action === 'uninjectPrompts') {
          const ids = new Set((Array.isArray(args.ids) ? args.ids : []).map(String))
          const scriptInjections = (runtime.snapshot?.scriptInjections || []).filter(item => !ids.has(String(item.id)))
          patchSnapshot(runtime, { scriptInjections, state: { ...(runtime.snapshot?.state || {}), binding: { ...(runtime.snapshot?.state?.binding || {}), scriptInjections } } })
          return persistSessionPatch(runtime, { scriptInjections })
        }
        if (message.action === 'mutateChat') {
          const operation = runtime.queue.then(async () => {
          const mutation = clone(args.mutation || {})
          mutation.expectedRevision = Number(runtime.snapshot?.chatRevision || 0)
          const value = await api('/compat/chat/mutate', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, mutation }) })
          const messages = clone(value?.messages || [])
          patchSnapshot(runtime, {
            chatRevision: Number(value?.revision || 0),
            messages,
            state: { ...(runtime.snapshot?.state || {}), history: messages.map(item => ({ role: item.role, text: item.message ?? item.text ?? '', seq: item.sourceSeq ?? item.message_id })) },
          })
          const refresh = mutation.options?.refresh || 'affected'
          if (mutation.action === 'set') {
            for (const item of mutation.messages || []) broadcastEvent(runtime, 'message_updated', [item.message_id])
          } else if (mutation.action === 'create') {
            const before = mutation.options?.insert_before
            const start = Number.isSafeInteger(before) ? before : Math.max(0, messages.length - (mutation.messages || []).length)
            for (let offset = 0; offset < (mutation.messages || []).length; offset += 1) {
              const id = start + offset
              const item = mutation.messages[offset]
              if (item?.role === 'user') broadcastEvent(runtime, 'message_sent', [id])
              else if (item?.role === 'assistant') broadcastEvent(runtime, 'message_received', [id, 'normal'])
            }
          } else if (mutation.action === 'delete') {
            for (const id of mutation.messageIds || []) broadcastEvent(runtime, 'message_deleted', [id])
          } else if (mutation.action === 'switch-swipe') broadcastEvent(runtime, 'message_swiped', [mutation.messageId])
          if (refresh === 'all') broadcastEvent(runtime, 'chat_id_changed', [runtime.id])
          else if (refresh === 'affected') {
            const affected = mutation.action === 'set' ? (mutation.messages || []).map(item => item.message_id)
              : mutation.action === 'create' ? messages.slice(-(mutation.messages || []).length).map(item => item.message_id)
              : []
            for (const id of affected) {
              const item = messages[id]
              if (item?.role === 'user') broadcastEvent(runtime, 'user_message_rendered', [id])
              else if (item?.role === 'assistant') broadcastEvent(runtime, 'character_message_rendered', [id, 'normal'])
            }
          }
          return null
          })
          runtime.queue = operation.catch(error => { runtime.writeError = error })
          return operation
        }
        if (message.action === 'worldbook') {
          const operation = runtime.queue.then(async () => {
          const value = await api('/compat/worldbook', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, ...(args.request || {}) }) })
          const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
          set(runtime.id, fresh)
          return value
          })
          runtime.queue = operation.catch(error => { runtime.writeError = error })
          return operation
        }
        if (message.action === 'replaceRegexes') {
          const operation = runtime.queue.then(async () => {
            const changes = clone(args.changes || {})
            if (Object.hasOwn(changes, 'global') || Object.hasOwn(changes, 'preset')) changes.expectedRevision = Number(runtime.snapshot?.regexRevision || 0)
            const value = await api('/compat/regex', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, changes }) })
            const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
            set(runtime.id, fresh)
            broadcastEvent(runtime, 'settings_updated', [])
            broadcastEvent(runtime, 'chat_id_changed', [runtime.id])
            return value
          })
          runtime.queue = operation.catch(error => { runtime.writeError = error })
          return operation
        }
        if (message.action === 'flushWrites') return drainWrites(runtime)
        if (message.action === 'event') return api('/event', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, operation: args.operation || {} }) })
        if (message.action === 'triggerSlash') {
          const operation = runtime.queue.then(() => api('/compat/slash', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, command: String(args.command || '') }) }))
          runtime.queue = operation.catch(error => { runtime.writeError = error })
          return operation
        }
        if (message.action === 'generate') {
          await drainWrites(runtime)
          const generationId = String(args.config?.generation_id || `generation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
          runtime.generations ||= new Set()
          runtime.generations.add(generationId)
          patchSnapshot(runtime, { activeGenerationIds: [...runtime.generations] })
          try {
          await api('/compat/generation/start', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, mode: args.mode === 'raw' ? 'raw' : 'preset', config: { ...(args.config || {}), generation_id: generationId } }) })
          set(runtime.id, await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`))
          broadcastEvent(runtime, 'js_generation_started', [generationId])
          broadcastEvent(runtime, 'generation_started', ['normal', {}, false])
          let previous = ''
          for (;;) {
            await new Promise(resolve => window.setTimeout(resolve, 40))
            const state = await api(`/compat/generation?sessionId=${encodeURIComponent(runtime.id)}&generationId=${encodeURIComponent(generationId)}`)
            const full = String(state.full || '')
            if (full !== previous) {
              const incremental = full.startsWith(previous) ? full.slice(previous.length) : full
              previous = full
              broadcastEvent(runtime, 'js_stream_token_received_incrementally', [incremental, generationId])
              broadcastEvent(runtime, 'js_stream_token_received_fully', [full, generationId])
              broadcastEvent(runtime, 'stream_token_received', [full])
            }
            if (state.active) continue
            if (state.status === 'failed') throw Object.assign(new Error(state.error?.message || 'generation failed'), { code: state.error?.code })
            if (state.status === 'stopped') broadcastEvent(runtime, 'generation_stopped', [generationId])
            broadcastEvent(runtime, 'js_generation_ended', [full, generationId])
            broadcastEvent(runtime, 'generation_ended', [null])
            return Array.isArray(state.toolCalls) && state.toolCalls.length > 0 ? { content: full, tool_calls: state.toolCalls } : full
          }
          } finally {
            runtime.generations.delete(generationId)
            patchSnapshot(runtime, { activeGenerationIds: [...runtime.generations] })
          }
        }
        if (message.action === 'stopGeneration') return api('/compat/generation/stop', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, generationId: args.generationId }) })
        if (message.action === 'stopAllGeneration') return api('/compat/generation/stop-all', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id }) })
        if (message.action === 'getModelList') return api(`/compat/models?sessionId=${encodeURIComponent(runtime.id)}&provider=${encodeURIComponent(String(args.provider || ''))}`)
        if (message.action === 'appendInput') {
          if (typeof runtime.composer !== 'function') throw new Error('conversation composer bridge is unavailable')
          return runtime.composer(args.text)
        }
        throw new Error(`unsupported script API action ${message.action}`)
      }
      const onMessage = async event => {
        const message = event.data
        if (!message || message.__dshSillyTavern !== true || typeof message.channel !== 'string') return
        const registration = frames.get(message.channel)
        if (registration === undefined || event.source !== registration.getWindow()) return
        if (message.event === 'compat-call-result') {
          const call = frameCalls.get(message.payload?.id)
          if (!call || call.channel !== registration.channel) return
          frameCalls.delete(message.payload.id)
          window.clearTimeout(call.timer)
          if (message.payload.error) call.reject(new Error(message.payload.error))
          else call.resolve(message.payload.result)
          return
        }
        if (message.event === 'frame-resize') {
          const height = Math.ceil(Number(message.payload?.height))
          if (Number.isFinite(height) && height >= 0) registration.onResize?.(height)
          return
        }
        if (message.event === 'frame-error') {
          registration.onError?.(String(message.payload?.message || '脚本运行失败'))
          return
        }
        if (message.event === 'frame-ready') {
          registration.ready = true
          registration.onReady?.()
          const runtime = sessionFor(registration.sessionId)
          if (runtime.snapshot !== null) post(registration, { event: 'compat-state', payload: clone(runtime.snapshot) })
          window.clearTimeout(runtime.pollTimer)
          void pollLifecycle(runtime)
          return
        }
        if (message.event === 'compat-event') {
          const name = String(message.payload?.name ?? '')
          const args = Array.isArray(message.payload?.args) ? message.payload.args : []
          if (name !== '') broadcastEvent(sessionFor(registration.sessionId), name, args, registration.channel)
          return
        }
        if (!message.id) return
        try {
          const value = await handleAction(registration, message)
          post(registration, { replyTo: message.id, ok: true, value: value ?? null })
        } catch (error) {
          post(registration, { replyTo: message.id, ok: false, error: error?.message || String(error), code: error?.code })
        }
      }
      return {
        start() {
          if (removeWindowListener !== null) return () => undefined
          if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') return () => undefined
          window.addEventListener('message', onMessage)
          removeWindowListener = () => { window.removeEventListener('message', onMessage); removeWindowListener = null }
          return removeWindowListener
        },
        get(sessionId) { return sessionId === undefined || sessionId === null ? null : sessionFor(sessionId).snapshot },
        subscribe(sessionId, listener) { if (sessionId === undefined || sessionId === null) return () => undefined; const runtime = sessionFor(sessionId); runtime.listeners.add(listener); return () => runtime.listeners.delete(listener) },
        set,
        applyEventState,
        setComposer(sessionId, composer) { const runtime = sessionFor(sessionId); runtime.composer = composer; return () => { if (runtime.composer === composer) runtime.composer = null } },
        register(registration) {
          registration.ready = false
          frames.set(registration.channel, registration)
          const runtime = sessionFor(registration.sessionId)
          runtime.frames.add(registration.channel)
          return () => {
            registration.ready = false
            frames.delete(registration.channel)
            runtime.frames.delete(registration.channel)
            for (const [id, call] of frameCalls) if (call.channel === registration.channel) { window.clearTimeout(call.timer); frameCalls.delete(id); call.reject(frameError('script callback owner was detached', 'dsh-frame-detached')) }
            if (readyFrames(runtime).length === 0) {
              window.clearTimeout(runtime.pollTimer)
              void api('/compat/lifecycle/disconnect', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, clientId: lifecycleClientId }) }).catch(error => console.error(error))
            }
          }
        },
        reset() {
          removeWindowListener?.()
          for (const runtime of sessions.values()) {
            window.clearTimeout(runtime.pollTimer)
            if (runtime.frames.size) void api('/compat/lifecycle/disconnect', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, clientId: lifecycleClientId }) }).catch(error => console.error(error))
          }
          for (const call of frameCalls.values()) { window.clearTimeout(call.timer); call.reject(new Error('compatibility runtime disposed')) }
          frameCalls.clear()
          frames.clear()
          sessions.clear()
        },
      }
    })()

    function useCompatSnapshot(sessionId) {
      const subscribe = React.useCallback(listener => compatRuntime.subscribe(sessionId, listener), [sessionId])
      const getSnapshot = React.useCallback(() => compatRuntime.get(sessionId), [sessionId])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    function Button({ children, className = '', ...props }) {
      return h('button', { type: 'button', className: `dst-button ${className}`, ...props }, children)
    }

    function TavernMugIcon({ size = 16, className = '' }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        className,
        'aria-hidden': true,
        focusable: false,
      },
      h('path', {
        d: 'M3 5.25h8v6A1.75 1.75 0 0 1 9.25 13h-4.5A1.75 1.75 0 0 1 3 11.25v-6Z',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M11 6.5h1a2 2 0 0 1 0 4h-1M3.25 7h7.5',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 4.5, cy: 4, r: 1, fill: 'currentColor' }),
      h('circle', { cx: 7.25, cy: 3.25, r: 1.25, fill: 'currentColor' }),
      h('circle', { cx: 9.75, cy: 4.25, r: 1, fill: 'currentColor' }))
    }

    function Field({ label, children }) {
      return h('label', { className: 'dst-field' }, h('span', null, label), children)
    }

    function sessionHasStarted(session) {
      if (session?.conversationStarted === true || session?.hasConversationMessages === true || session?.binding?.locked === true || session?.binding?.startedAt != null) return true
      return Array.isArray(session?.history) && session.history.some(message => message?.role === 'user' || message?.type === 'user/message')
    }

    function referenceLabel(reference, fallback) {
      if (typeof reference === 'string') return reference
      return String(reference?.title || reference?.name || reference?.sessionId || reference?.id || fallback)
    }

    function ReferenceList({ title, references }) {
      if (!Array.isArray(references) || references.length === 0) return null
      return h('section', { className: 'dst-reference-list' },
        h('strong', null, `${title}（${references.length}）`),
        h('ul', null, references.map((reference, index) => h('li', { key: `${reference?.id || reference?.sessionId || index}` }, referenceLabel(reference, `#${index + 1}`)))))
    }

    function ConfirmPanel({ title, children, busy, confirmDisabled = false, confirmLabel = '确认', danger = true, onConfirm, onCancel }) {
      return h('div', { className: 'dst-confirm-layer', role: 'presentation' },
        h('section', { className: 'dst-confirm-card', role: 'dialog', 'aria-modal': true, 'aria-label': title },
          h('div', { className: 'dst-dialog-title' }, title),
          children,
          h('div', { className: 'dst-actions' },
            h(Button, { className: danger ? 'danger' : '', disabled: busy || confirmDisabled, onClick: onConfirm }, busy ? '处理中…' : confirmLabel),
            h(Button, { className: 'secondary', disabled: busy, onClick: onCancel }, '取消'))))
    }

    function scriptApprovalMaterial(script) {
      const source = String(script?.source ?? '')
      if (script?.kind !== 'regex') return `${script?.kind === 'html' ? 'html' : 'javascript'}\0${source}`
      const trimStrings = Array.isArray(script.trimStrings) ? script.trimStrings.map(value => String(value)) : []
      const placement = Array.isArray(script.placement) ? [...new Set(script.placement.map(Number).filter(Number.isSafeInteger))] : []
      return `regex\0${JSON.stringify({ findRegex: String(script.findRegex ?? ''), trimStrings, placement, markdownOnly: script.markdownOnly === true, promptOnly: script.promptOnly === true, runOnEdit: script.runOnEdit === true, substituteRegex: Number.isSafeInteger(Number(script.substituteRegex)) ? Number(script.substituteRegex) : 0, minDepth: script.minDepth === null || script.minDepth === undefined || !Number.isFinite(Number(script.minDepth)) ? null : Number(script.minDepth), maxDepth: script.maxDepth === null || script.maxDepth === undefined || !Number.isFinite(Number(script.maxDepth)) ? null : Number(script.maxDepth), source })}`
    }

    async function sourceDigest(script) {
      const bytes = new TextEncoder().encode(scriptApprovalMaterial(script))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    }

    function fileBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
        reader.readAsDataURL(file)
      })
    }

    function ImportDialog({ sessionId, close }) {
      const inputRef = React.useRef(null)
      const closeTimer = React.useRef(null)
      React.useEffect(() => () => {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      }, [])
      const [status, setStatus] = React.useState('请选择 Character Card V3 PNG、APNG 或 JSON。')
      const [busy, setBusy] = React.useState(false)
      const session = useAsync(() => api(`/session?sessionId=${encodeURIComponent(sessionId)}`), [sessionId])
      const choose = async event => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file || session.loading || session.error || !session.value) return
        if (file.size > 64 * 1024 * 1024) { setStatus('文件超过 64 MiB 限制。'); return }
        const replacing = session.value?.binding !== null && session.value?.binding !== undefined
        if (replacing && sessionHasStarted(session.value)) { setStatus('当前会话已经开始对话，不能再更换角色卡。请新建会话后导入。'); return }
        if (replacing && !window.confirm(`当前会话已绑定“${session.value.card?.card?.data?.name || '角色'}”。是否替换为 ${file.name}？`)) return
        setBusy(true)
        setStatus(`正在导入 ${file.name}…`)
        try {
          const payload = {
            sessionId,
            fileName: file.name,
            mediaType: file.type || (file.name.toLowerCase().endsWith('.json') ? 'application/json' : 'image/png'),
            data: await fileBase64(file),
            replace: replacing,
            expectedCardId: session.value?.binding?.cardId || null,
          }
          const submit = worldbookConflict => api('/import', {
            method: 'POST',
            body: JSON.stringify({ ...payload, ...(worldbookConflict === undefined ? {} : { worldbookConflict }) }),
          })
          let result
          try { result = await submit() }
          catch (error) {
            if (!['worldbook-name-conflict', 'worldbook-conflict'].includes(error?.code)) throw error
            const conflictingName = String(error.details?.worldbookName || error.details?.name || error.details?.conflict?.name || error.body?.conflict?.name || '同名世界书')
            const overwrite = window.confirm(`导入角色卡内置世界书“${conflictingName}”时发现同名世界书。\n\n选择“确定”将完整覆盖现有世界书；选择“取消”可另存为新名称。`)
            if (overwrite) result = await submit({ action: 'overwrite' })
            else {
              const saveAsName = window.prompt('请输入另存为的世界书名称：', `${conflictingName} - 副本`)
              if (saveAsName === null) { setStatus('已取消导入。'); return }
              if (saveAsName.trim() === '') throw new Error('另存为名称不能为空')
              result = await submit({ action: 'save-as', name: saveAsName.trim() })
            }
          }
          setStatus(`已绑定角色：${result.record.card.data.name}`)
          overlay.changed()
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = null
            close()
          }, 700)
        } catch (error) {
          setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`)
        } finally { setBusy(false) }
      }
      return h('div', { className: 'dst-dialog-card' },
        h('div', { className: 'dst-dialog-title' }, '导入 V3 角色卡'),
        session.loading ? h('p', null, '正在读取当前会话…') : null,
        session.error ? h('p', { className: 'dst-error' }, `无法读取当前会话：${session.error}`) : null,
        session.value?.card ? h('p', { className: 'dst-muted' }, `当前绑定：${session.value.card.card.data.name}`) : null,
        h('p', { className: 'dst-status' }, status),
        h('input', { ref: inputRef, type: 'file', hidden: true, accept: '.png,.apng,.json,image/png,application/json', onChange: choose }),
        session.value?.binding && sessionHasStarted(session.value) ? h('p', { className: 'dst-warning' }, '当前会话已经开始对话，不能导入并替换角色卡。请在新会话中导入。') : null,
        h('div', { className: 'dst-actions' },
          h(Button, { disabled: busy || session.loading || !!session.error || !session.value || (session.value?.binding && sessionHasStarted(session.value)), onClick: () => inputRef.current?.click() }, busy ? '导入中…' : '选择角色卡文件…'),
          h(Button, { className: 'secondary', onClick: close }, '关闭')))
    }

    function LibraryTab({ library, session, reload }) {
      const [status, setStatus] = React.useState('')
      const [replacement, setReplacement] = React.useState(null)
      const [bindingBusy, setBindingBusy] = React.useState(false)
      const [deletingId, setDeletingId] = React.useState(null)
      const [deleteDialog, setDeleteDialog] = React.useState(null)
      const started = sessionHasStarted(session)
      const bind = async (card, confirmed = false) => {
        if (!session || bindingBusy) return
        const replacing = session.binding !== null
        if (replacing && started) { setStatus('当前会话已经开始对话，不能更换角色卡。'); return }
        if (replacing && !confirmed) { setReplacement({ card, sessionId: session.sessionId, cardId: session.binding?.cardId }); return }
        setBindingBusy(true)
        try {
          await api('/bind', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, cardId: card.id, replace: replacing, expectedCardId: session.binding?.cardId || null }) })
          setReplacement(null); setStatus(''); overlay.changed(); reload()
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
        finally { setBindingBusy(false) }
      }
      const remove = async card => {
        setDeletingId(card.id)
        setStatus(`正在删除“${card.nickname || card.name}”…`)
        try {
          const result = await api('/card/delete', { method: 'POST', body: JSON.stringify({ sessionId: session?.sessionId, cardId: card.id, deleteWorldbook: deleteDialog?.deleteWorldbook === true, ...(deleteDialog?.confirmWorldbookDelete === true ? { confirmWorldbookDelete: true } : {}) }) })
          setStatus(`已删除“${card.nickname || card.name}”${result?.worldbookDeleted === true || result?.deletedWorldbook ? '，并同步删除默认世界书' : ''}。`)
          setDeleteDialog(null)
          overlay.changed(); reload()
        } catch (error) {
          const activeSessions = error?.details?.activeSessions || error?.details?.sessions || error?.details?.references?.sessions
          if (error?.code === 'worldbook-references-required') {
            const worldbookReferences = error.details?.references || {}
            setDeleteDialog(previous => ({ ...previous, worldbookReferences, confirmWorldbookDelete: true, error: '默认世界书还被其他角色卡或 Session 引用。请核对引用后再次确认；继续会删除世界书并清空全部引用。' }))
            setStatus('默认世界书仍有共享引用，角色卡尚未删除。')
          } else if (Array.isArray(activeSessions) && activeSessions.length > 0) {
            setDeleteDialog(previous => ({ ...previous, activeSessions, error: '仍有尚未删除或归档的会话正在使用该角色卡，当前禁止删除。' }))
            setStatus('角色卡仍被活跃会话引用，未删除。')
          } else setStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`)
        }
        finally { setDeletingId(null) }
      }
      return h('div', null,
        replacement && replacement.sessionId === session?.sessionId && replacement.cardId === session?.binding?.cardId ? h(ConfirmPanel, { title: '更换当前角色', busy: bindingBusy, danger: false, confirmLabel: '确认更换', onCancel: () => setReplacement(null), onConfirm: () => { void bind(replacement.card, true) } }, h('p', null, `将当前角色替换为“${replacement.card.nickname || replacement.card.name}”？`), status ? h('p', { role: 'status', className: 'dst-error' }, status) : null) : null,
        h('div', { className: 'dst-section-title' }, `全局角色库（${library.cards.length}）`),
        h('div', { className: 'dst-actions' }, h(Button, { disabled: !session || started, onClick: () => overlay.open('import', session.sessionId) }, '导入角色卡…')),
        h('p', { className: 'dst-muted' }, started ? '在新剧情中可以导入其他角色卡；当前剧情的角色已固定。' : '选择一张角色卡，然后关闭管理页，选择开场并填写玩家身份。也可以导入 PNG、APNG 或 JSON 角色卡。'),
        library.cards.length === 0 ? h('p', { className: 'dst-muted' }, '还没有角色卡。点击“导入角色卡”开始。') : null,
        h('div', { className: 'dst-card-grid' }, library.cards.map(card => h('article', { className: 'dst-card', key: card.id },
          session && card.format !== 'json-v3' ? h('img', { className: 'dst-card-cover', src: `${API}/card/cover?sessionId=${encodeURIComponent(session.sessionId)}&id=${encodeURIComponent(card.id)}`, alt: `${card.nickname || card.name} 封面`, loading: 'lazy', onError: event => { event.currentTarget.hidden = true } }) : null,
          h('strong', null, card.nickname || card.name),
          h('span', { className: 'dst-muted' }, card.creator ? `作者：${card.creator}` : '作者未填写'),
          h('div', { className: 'dst-tags' }, (card.tags || []).slice(0, 5).map(tag => h('span', { key: tag }, tag))),
          h('div', { className: 'dst-actions' },
            session ? h(Button, { className: 'small', disabled: deletingId === card.id || session.binding?.cardId === card.id || (started && session.binding !== null), title: started && session.binding?.cardId !== card.id ? '对话开始后不能更换角色卡' : undefined, onClick: () => void bind(card) }, session.binding?.cardId === card.id ? '当前角色' : '用于当前会话') : null,
            h(Button, { className: 'danger small', disabled: deletingId !== null || !session, onClick: () => setDeleteDialog({ card, deleteWorldbook: false, activeSessions: [], error: '' }) }, deletingId === card.id ? '删除中…' : '删除角色卡'))))),
        started ? h('p', { className: 'dst-muted' }, '当前会话已经开始对话，角色卡选择已锁定。') : null,
        status ? h('p', { className: 'dst-status' }, status) : null,
        deleteDialog ? h(ConfirmPanel, {
          title: `删除角色卡“${deleteDialog.card.nickname || deleteDialog.card.name}”`,
          busy: deletingId !== null,
          confirmDisabled: deleteDialog.activeSessions?.length > 0,
          confirmLabel: deleteDialog.activeSessions?.length > 0 ? '无法删除' : '永久删除',
          onConfirm: deleteDialog.activeSessions?.length > 0 ? undefined : () => void remove(deleteDialog.card),
          onCancel: () => setDeleteDialog(null),
        },
        h('p', null, '确定永久删除角色卡吗？角色卡将从当前工作区永久删除，此操作不可撤销。'),
        deleteDialog.error ? h('p', { className: 'dst-error' }, deleteDialog.error) : null,
        h(ReferenceList, { title: '阻止删除的会话', references: deleteDialog.activeSessions }),
        deleteDialog.worldbookReferences ? h(React.Fragment, null,
          h(ReferenceList, { title: '仍引用默认世界书的角色卡', references: deleteDialog.worldbookReferences.cards }),
          h(ReferenceList, { title: '仍引用默认世界书的 Session', references: deleteDialog.worldbookReferences.sessions })) : null,
        h('label', { className: 'dst-worldbook-check' },
          h('input', { type: 'checkbox', disabled: deletingId !== null || deleteDialog.activeSessions?.length > 0 || deleteDialog.confirmWorldbookDelete === true, checked: deleteDialog.deleteWorldbook === true, onChange: event => setDeleteDialog(previous => ({ ...previous, deleteWorldbook: event.target.checked, worldbookReferences: null, confirmWorldbookDelete: false, error: '' })) }),
          h('span', null, '同时删除该角色卡绑定的默认世界书（若仍有其他引用，Host 将要求再次确认或拒绝）'))) : null)
    }

    function PersonaTab({ session, reload }) {
      const [name, setName] = React.useState(session.binding?.userPersona?.name || 'User')
      const [description, setDescription] = React.useState(session.binding?.userPersona?.description || '')
      const [variables, setVariables] = React.useState(() => JSON.stringify(session.binding?.variables || {}, null, 2))
      const [globalVariables, setGlobalVariables] = React.useState(() => JSON.stringify(session.globalVariables || {}, null, 2))
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [sessionDirty, setSessionDirty] = React.useState(false)
      const [globalDirty, setGlobalDirty] = React.useState(false)
      const dirty = sessionDirty || globalDirty
      const edit = (setter, markDirty) => event => { setter(event.target.value); markDirty(true); setStatus('尚未保存') }
      const save = async () => {
        if (!dirty) return
        setBusy(true)
        setStatus('正在保存…')
        const sessionRequest = sessionDirty ? Promise.resolve().then(() => {
          const parsedVariables = JSON.parse(variables)
          if (!parsedVariables || typeof parsedVariables !== 'object' || Array.isArray(parsedVariables)) throw new Error('变量必须是 JSON 对象')
          return api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, patch: { userPersona: { name, description }, variables: parsedVariables } }) })
        }) : null
        const globalRequest = globalDirty ? Promise.resolve().then(() => {
          const parsedGlobalVariables = JSON.parse(globalVariables)
          if (!parsedGlobalVariables || typeof parsedGlobalVariables !== 'object' || Array.isArray(parsedGlobalVariables)) throw new Error('全局变量必须是 JSON 对象')
          return api('/regex-sources', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, variables: parsedGlobalVariables }) })
        }) : null
        const [sessionResult, globalResult] = await Promise.allSettled([sessionRequest, globalRequest])
        const messages = []
        const failureMessage = reason => reason && typeof reason.message === 'string' ? reason.message : String(reason)
        let saved = false
        if (sessionDirty) {
          if (sessionResult.status === 'fulfilled') { setSessionDirty(false); messages.push('角色设定与会话变量已保存'); saved = true }
          else messages.push(`角色设定与会话变量保存失败：${failureMessage(sessionResult.reason)}`)
        }
        if (globalDirty) {
          if (globalResult.status === 'fulfilled') { setGlobalDirty(false); messages.push('全局变量已保存'); saved = true }
          else messages.push(`全局变量保存失败：${failureMessage(globalResult.reason)}`)
        }
        setStatus(messages.join('；'))
        if (saved) { overlay.changed(); reload() }
        setBusy(false)
      }
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '用户角色设定'),
        h('p', { className: 'dst-muted' }, '称呼和设定仅用于当前剧情。写下你希望扮演的身份，以及希望角色如何与你互动。'),
        h(Field, { label: '称呼' }, h('input', { value: name, disabled: busy, onChange: edit(setName, setSessionDirty) })),
        h(Field, { label: '设定' }, h('textarea', { rows: 8, value: description, disabled: busy, onChange: edit(setDescription, setSessionDirty) })),
        h('details', { className: 'dst-advanced-settings' }, h('summary', null, '高级：会话变量与全局变量'),
          h(Field, { label: '会话变量（JSON 对象，{{getvar::key}}）' }, h('textarea', { rows: 6, value: variables, disabled: busy, onChange: edit(setVariables, setSessionDirty), spellCheck: false })),
          h(Field, { label: '全局变量（JSON 对象，{{globalvar::key}}）' }, h('textarea', { rows: 6, value: globalVariables, disabled: busy, onChange: edit(setGlobalVariables, setGlobalDirty), spellCheck: false }))),
        h('div', { className: 'dst-actions' }, h(Button, { disabled: busy || !dirty, onClick: () => void save() }, busy ? '保存中…' : '保存角色设定与变量'), h('span', { className: dirty ? 'dst-warning' : 'dst-status', role: 'status' }, status)))
    }

    function CardEditTab({ session, library, reload }) {
      const record = session.card
      const data = record?.card?.data
      const worldbooks = Array.isArray(library?.worldbooks) ? library.worldbooks : []
      const [form, setForm] = React.useState(() => data ? ({
        name: data.name, description: data.description, personality: data.personality,
        scenario: data.scenario, first_mes: data.first_mes, mes_example: data.mes_example,
        system_prompt: data.system_prompt, post_history_instructions: data.post_history_instructions,
      }) : {})
      const [defaultWorldbookId, setDefaultWorldbookId] = React.useState(() => record?.defaultWorldbookId || '')
      const [status, setStatus] = React.useState('')
      if (!record) return h('div', null, h('p', { className: 'dst-muted' }, '先从角色库选择角色，或导入角色卡，再查看和编辑设定。'), h(Button, { onClick: () => overlay.open('import', session.sessionId) }, '导入角色卡…'))
      const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }))
      const save = async () => {
        try {
          await api('/card/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, cardId: record.id, patch: { cardData: form, defaultWorldbookId: defaultWorldbookId || null } }) })
          setStatus('已保存到全局角色库'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message) }
      }
      const fields = [['name', '角色名', 1], ['description', '角色描述', 7], ['personality', '性格', 5], ['scenario', '场景', 5], ['first_mes', '首条问候', 6], ['mes_example', '示例对话', 7], ['system_prompt', '角色系统提示词', 5], ['post_history_instructions', '历史后指令', 5]]
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '角色卡与角色设定'),
        h(Field, { label: '新会话默认世界书' }, h('select', { value: defaultWorldbookId, onChange: event => setDefaultWorldbookId(event.target.value) },
          h('option', { value: '' }, '不绑定默认世界书'),
          worldbooks.map(worldbook => h('option', { key: worldbook.id, value: worldbook.id }, worldbook.name || '未命名世界书')))),
        h('p', { className: 'dst-muted' }, '只影响之后第一次开始对话的新 Session；已创建 Session 的世界书引用不会跟随修改。'),
        fields.map(([key, label, rows]) => h(Field, { label, key }, rows === 1
          ? h('input', { value: form[key] || '', onChange: event => update(key, event.target.value) })
          : h('textarea', { rows, value: form[key] || '', onChange: event => update(key, event.target.value) }))),
        h('div', { className: 'dst-actions' }, h(Button, { onClick: () => void save() }, '保存角色卡'), h('span', { className: 'dst-muted' }, status)))
    }

    const WORLDBOOK_POSITIONS = [
      [0, '0 · Before Char'], [1, '1 · After Char'], [2, '2 · AN Top'], [3, '3 · AN Bottom'],
      [4, '4 · @Depth'], [5, '5 · EM Top'], [6, '6 · EM Bottom'], [7, '7 · Outlet'],
    ]

    function worldbookExtension(entry, key, aliases = []) {
      const names = [key, ...aliases]
      const extensions = entry?.extensions
      if (extensions && typeof extensions === 'object' && !Array.isArray(extensions)) {
        for (const name of names) if (Object.hasOwn(extensions, name)) return extensions[name]
      }
      for (const name of names) if (entry && Object.hasOwn(entry, name)) return entry[name]
      return undefined
    }

    function updateWorldbookExtension(entry, key, value, aliases = []) {
      const names = [key, ...aliases]
      const next = { ...entry }
      const extensions = entry?.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions) ? { ...entry.extensions } : {}
      let found = false
      for (const name of names) {
        if (Object.hasOwn(extensions, name)) { extensions[name] = value; found = true }
        if (Object.hasOwn(next, name)) { next[name] = value; found = true }
      }
      if (!found) extensions[key] = value
      next.extensions = extensions
      return next
    }

    function worldbookPosition(entry) {
      const raw = worldbookExtension(entry, 'position')
      if (raw === undefined || raw === null || raw === '') return undefined
      const number = Number(raw)
      if (Number.isSafeInteger(number) && number >= 0 && number <= 7) return number
      const normalized = typeof raw === 'string' ? raw.toLocaleLowerCase().replace(/[\s_-]/g, '') : ''
      return ({
        beforechar: 0, beforecharacter: 0, before: 0,
        afterchar: 1, aftercharacter: 1, after: 1,
        antop: 2, authornotetop: 2, topofan: 2,
        anbottom: 3, authornotebottom: 3, bottomofan: 3,
        atdepth: 4, depth: 4,
        emtop: 5, examplemessagestop: 5, beforeexamples: 5,
        embottom: 6, examplemessagesbottom: 6, afterexamples: 6,
        outlet: 7,
      })[normalized]
    }

    function worldbookPolicy(entry) {
      if (entry.constant === true) return 'constant'
      return worldbookExtension(entry, 'vectorized') === true ? 'vectorized' : 'keyword'
    }

    function WorldbookPolicyButton({ active, className, title, children, onClick }) {
      return h('button', {
        type: 'button',
        className: `dst-worldbook-policy ${className}${active ? ' active' : ''}`,
        title,
        'aria-pressed': active,
        onClick,
      }, children)
    }

    function WorldbookEntryEditor({ rowKey, index, entry, onChange, onRemove }) {
      const [open, setOpen] = React.useState(() => entry.content === '' && (!Array.isArray(entry.keys) || entry.keys.length === 0))
      const policy = worldbookPolicy(entry)
      const rawPosition = worldbookExtension(entry, 'position')
      const position = worldbookPosition(entry)
      const positionIsMissing = rawPosition === undefined || rawPosition === null || rawPosition === ''
      const positionPlaceholder = positionIsMissing
        ? '未设置（运行时默认 1 · After Char）'
        : `不支持的原值：${typeof rawPosition === 'string' ? rawPosition : JSON.stringify(rawPosition)}`
      const rawDepth = worldbookExtension(entry, 'depth')
      const numericDepth = Number(rawDepth)
      const depthValue = rawDepth === undefined || rawDepth === null || rawDepth === '' || !Number.isSafeInteger(numericDepth) || numericDepth < 0 ? 4 : numericDepth
      const probabilityEnabled = worldbookExtension(entry, 'useProbability', ['use_probability']) !== false
      const probability = Number(worldbookExtension(entry, 'probability'))
      const selectiveLogic = Number(worldbookExtension(entry, 'selectiveLogic', ['selective_logic']))
      const label = entry.comment || entry.name || (Array.isArray(entry.keys) && entry.keys[0]) || '未命名条目'
      const patch = values => onChange(rowKey, current => ({ ...current, ...values }))
      const patchExtension = (key, value, aliases) => onChange(rowKey, current => updateWorldbookExtension(current, key, value, aliases))
      const setPolicy = value => onChange(rowKey, current => {
        let next = { ...current, constant: value === 'constant' }
        next = updateWorldbookExtension(next, 'vectorized', value === 'vectorized')
        return next
      })
      const parseKeys = value => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
      return h('article', { className: `dst-worldbook-entry${entry.enabled === false ? ' disabled' : ''}` },
        h('div', { className: 'dst-worldbook-entry-head' },
          h('label', { className: 'dst-worldbook-check' }, h('input', { type: 'checkbox', checked: entry.enabled !== false, onChange: event => patch({ enabled: event.target.checked }) }), h('span', null, '启用')),
          h('strong', { title: label }, `${index + 1}. ${label}`),
          h('div', { className: 'dst-worldbook-policies dst-worldbook-policies-head', role: 'group', 'aria-label': `${label} 的插入策略` },
            h(WorldbookPolicyButton, { active: policy === 'constant', className: 'constant', title: '蓝圈：始终插入，无需关键词', onClick: () => setPolicy('constant') }, h('span', { 'aria-hidden': true }, '●'), ' 常驻'),
            h(WorldbookPolicyButton, { active: policy === 'keyword', className: 'keyword', title: '绿圈：主关键字命中后插入', onClick: () => setPolicy('keyword') }, h('span', { 'aria-hidden': true }, '●'), ' 关键词'),
            h(WorldbookPolicyButton, { active: policy === 'vectorized', className: 'vectorized', title: '链接：由向量/嵌入相似度检索；有关键词时仍可按关键词触发', onClick: () => setPolicy('vectorized') }, h('span', { 'aria-hidden': true }, '🔗'), ' 向量')),
          h('span', { className: 'dst-muted dst-worldbook-order' }, `Order ${Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : 0}`),
          h(Button, { className: 'danger small', onClick: () => onRemove(rowKey, label) }, '删除')),
        h('details', { open, onToggle: event => setOpen(event.currentTarget.open) },
          h('summary', null, open ? '收起条目' : '展开编辑'),
          h('div', { className: 'dst-worldbook-entry-body' },
            policy === 'vectorized' ? h('p', { className: 'dst-warning dst-worldbook-vector-note' }, '向量模式需要向量检索支持；当前插件不会仅凭相似度自动触发。保留主关键字时仍可按关键词触发。') : null,
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '备注 / Comment' }, h('input', { value: entry.comment ?? '', onChange: event => patch({ comment: event.target.value }) })),
              h(Field, { label: 'Insertion Order' }, h('input', { type: 'number', step: '1', value: Number.isFinite(Number(entry.insertion_order)) ? entry.insertion_order : 0, onChange: event => patch({ insertion_order: Number(event.target.value) || 0 }) }))),
            h(Field, { label: '内容 / Content' }, h('textarea', { rows: 7, value: entry.content ?? '', onChange: event => patch({ content: event.target.value }) })),
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '主关键字（每行一个）' }, h('textarea', { rows: 4, value: Array.isArray(entry.keys) ? entry.keys.join('\n') : '', onChange: event => patch({ keys: parseKeys(event.target.value) }), placeholder: 'dragon\nancient archive' })),
              h(Field, { label: '次关键字（每行一个）' }, h('textarea', { rows: 4, value: Array.isArray(entry.secondary_keys) ? entry.secondary_keys.join('\n') : '', onChange: event => patch({ secondary_keys: parseKeys(event.target.value) }), placeholder: 'fire\nsecret' }))),
            h('details', { className: 'dst-worldbook-advanced' },
              h('summary', null, '高级匹配与插入位置'),
              h('div', { className: 'dst-worldbook-advanced-body' },
                h('div', { className: 'dst-inline-fields' },
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: entry.selective === true, onChange: event => patch({ selective: event.target.checked }) }), h('span', null, '启用次关键字选择性匹配')),
                  h(Field, { label: '次关键字逻辑' }, h('select', { disabled: entry.selective !== true, value: Number.isSafeInteger(selectiveLogic) && selectiveLogic >= 0 && selectiveLogic <= 3 ? selectiveLogic : 0, onChange: event => patchExtension('selectiveLogic', Number(event.target.value), ['selective_logic']) },
                    h('option', { value: 0 }, 'AND ANY · 任一个'), h('option', { value: 1 }, 'NOT ALL · 不全命中'), h('option', { value: 2 }, 'NOT ANY · 均不命中'), h('option', { value: 3 }, 'AND ALL · 全部')))),
                h('div', { className: 'dst-inline-fields' },
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'use_regex', ['useRegex']) === true, onChange: event => patchExtension('use_regex', event.target.checked, ['useRegex']) }), h('span', null, '正则关键字（原生 JavaScript）')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'case_sensitive', ['caseSensitive']) === true, onChange: event => patchExtension('case_sensitive', event.target.checked, ['caseSensitive']) }), h('span', null, '区分大小写')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'match_whole_words', ['matchWholeWords']) === true, onChange: event => patchExtension('match_whole_words', event.target.checked, ['matchWholeWords']) }), h('span', null, '全词匹配'))),
                h('div', { className: 'dst-inline-fields' },
                  h(Field, { label: 'Position' }, h('select', { value: position ?? '__unsupported__', onChange: event => patchExtension('position', Number(event.target.value)) },
                    position === undefined ? h('option', { value: '__unsupported__', disabled: true }, positionPlaceholder) : null,
                    WORLDBOOK_POSITIONS.map(([value, text]) => h('option', { key: value, value }, text)))),
                  h(Field, { label: '概率值（0–100）' }, h('input', { type: 'number', min: 0, max: 100, step: 1, disabled: !probabilityEnabled, value: Number.isFinite(probability) ? Math.max(0, Math.min(100, probability)) : 100, onChange: event => patchExtension('probability', Math.max(0, Math.min(100, Number(event.target.value) || 0))) })),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: probabilityEnabled, onChange: event => patchExtension('useProbability', event.target.checked, ['use_probability']) }), h('span', null, '启用概率'))),
                h('div', { className: 'dst-inline-fields' },
                  h(Field, { label: '条目扫描深度（留空继承）' }, h('input', { type: 'number', min: 0, max: 100, step: 1, value: worldbookExtension(entry, 'scan_depth', ['scanDepth']) ?? '', onChange: event => patchExtension('scan_depth', event.target.value === '' ? undefined : Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0))), ['scanDepth']) })),
                  h(Field, { label: '延迟到递归层级' }, h('input', { type: 'number', min: 0, step: 1, value: worldbookExtension(entry, 'delay_until_recursion', ['delayUntilRecursion']) ?? 0, onChange: event => patchExtension('delay_until_recursion', Math.max(0, Math.trunc(Number(event.target.value) || 0)), ['delayUntilRecursion']) }))),
                h('div', { className: 'dst-inline-fields' },
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'exclude_recursion', ['excludeRecursion']) === true, onChange: event => patchExtension('exclude_recursion', event.target.checked, ['excludeRecursion']) }), h('span', null, '递归扫描时排除此条目')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'prevent_recursion', ['preventRecursion']) === true, onChange: event => patchExtension('prevent_recursion', event.target.checked, ['preventRecursion']) }), h('span', null, '此内容不触发后续递归')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'ignore_budget', ['ignoreBudget']) === true, onChange: event => patchExtension('ignore_budget', event.target.checked, ['ignoreBudget']) }), h('span', null, '忽略预算'))),
                position === undefined && !positionIsMissing ? h('p', { className: 'dst-warning' }, `当前 Position ${positionPlaceholder}；保存其他设置不会改写它。请从上方列表选择支持的位置以转换。`) : null,
                position === 4 ? h('div', { className: 'dst-inline-fields' },
                  h(Field, { label: '@Depth 深度' }, h('input', { type: 'number', min: 0, step: 1, value: depthValue, onChange: event => patchExtension('depth', event.target.value === '' ? 4 : Math.max(0, Math.trunc(Number(event.target.value) || 0))) })),
                  h(Field, { label: '@Depth 角色' }, h('select', { value: Number(worldbookExtension(entry, 'role')) || 0, onChange: event => patchExtension('role', Number(event.target.value)) }, h('option', { value: 0 }, 'System'), h('option', { value: 1 }, 'User'), h('option', { value: 2 }, 'Assistant')))) : null,
                position === 7 ? h(React.Fragment, null,
                  h(Field, { label: 'Outlet 名称' }, h('input', { value: worldbookExtension(entry, 'outlet_name', ['outletName', 'outlet']) ?? '', onChange: event => patchExtension('outlet_name', event.target.value, ['outletName', 'outlet']), placeholder: '例如：Lore' })),
                  h('p', { className: 'dst-muted' }, '在提示词模板中使用 {{outlet::名称}} 插入；名称区分大小写，空名称不会生效。')) : null)))))
    }

    function normalizeWorldbookRecord(value) {
      const record = value?.worldbook || value?.record || value || {}
      const book = record.book && typeof record.book === 'object' && !Array.isArray(record.book)
        ? record.book
        : record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? record.data
          : {}
      return { ...record, id: String(record.id || ''), name: String(record.name || book.name || ''), book: { ...book, name: String(record.name || book.name || '') } }
    }

    function availableWorldbookCopyName(originalName, occupiedNames) {
      const base = `${String(originalName || '世界书').trim() || '世界书'} · 当前剧情副本`
      const occupied = occupiedNames instanceof Set ? occupiedNames : new Set(occupiedNames || [])
      if (!occupied.has(base)) return base
      let suffix = 2
      while (occupied.has(`${base} ${suffix}`)) suffix += 1
      return `${base} ${suffix}`
    }

    function WorldbookEditor({ sessionId, worldbook, diagnostics, reload }) {
      const normalized = normalizeWorldbookRecord(worldbook)
      const initial = normalized.book
      const keySequence = React.useRef(0)
      const [book, setBook] = React.useState(() => ({ ...initial }))
      const [entryRows, setEntryRows] = React.useState(() => (Array.isArray(initial.entries) ? initial.entries : []).map(entry => ({ uiKey: `worldbook-entry-${++keySequence.current}`, value: entry })))
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [enabledFilter, setEnabledFilter] = React.useState('all')
      const updateBook = React.useCallback((key, value) => setBook(previous => {
        const next = { ...previous }
        if (value === undefined) delete next[key]
        else next[key] = value
        return next
      }), [])
      const updateEntry = React.useCallback((rowKey, updater) => setEntryRows(previous => previous.map(row => row.uiKey === rowKey ? { ...row, value: updater(row.value) } : row)), [])
      const removeEntry = React.useCallback((rowKey, label) => {
        if (!window.confirm(`确定删除世界书条目“${label}”吗？`)) return
        setEntryRows(previous => previous.filter(row => row.uiKey !== rowKey))
      }, [])
      const addEntry = () => setEntryRows(previous => {
        const numericIds = previous.map(row => Number(row.value.id)).filter(Number.isFinite)
        const orders = previous.map(row => Number(row.value.insertion_order)).filter(Number.isFinite)
        const entry = {
          id: numericIds.length > 0 ? Math.max(...numericIds) + 1 : 0,
          keys: [], secondary_keys: [], comment: '', content: '', enabled: true,
          constant: false, selective: false, insertion_order: orders.length > 0 ? Math.max(...orders) + 10 : 100,
           extensions: { position: 1, vectorized: false, useProbability: false, probability: 100, depth: 4, role: 0 },
        }
        return [...previous, { uiKey: `worldbook-entry-${++keySequence.current}`, value: entry }]
      })
      const save = async () => {
        setBusy(true)
        try {
          const characterBook = {
            ...book,
            entries: entryRows.map(row => row.value),
            extensions: book.extensions && typeof book.extensions === 'object' && !Array.isArray(book.extensions) ? book.extensions : {},
          }
          await api('/worldbook/update', { method: 'POST', body: JSON.stringify({ sessionId, worldbookId: normalized.id, patch: { name: String(characterBook.name || '').trim(), book: characterBook } }) })
          setStatus('已保存世界书'); overlay.changed(); reload()
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
        finally { setBusy(false) }
      }
      const nonNegativeInteger = value => value === '' ? undefined : Math.max(0, Math.trunc(Number(value) || 0))
      const diagnosticWarnings = Array.isArray(diagnostics?.warnings) ? diagnostics.warnings : []
      const diagnosticBudget = diagnostics?.budget
      const depthProjection = diagnostics?.depthProjection
      const diagnosticTime = typeof diagnostics?.generatedAt === 'string' ? new Date(diagnostics.generatedAt) : undefined
      const diagnosticTimeLabel = diagnosticTime !== undefined && Number.isFinite(diagnosticTime.getTime()) ? diagnosticTime.toLocaleString() : ''
      const search = query.trim().toLocaleLowerCase()
      const visibleRows = entryRows.map((row, index) => ({ row, index })).filter(({ row }) => {
        const entry = row.value
        const enabled = entry.enabled !== false
        return (enabledFilter === 'all' || enabled === (enabledFilter === 'enabled'))
          && (search === '' || [entry.comment, entry.name, entry.content, ...(entry.keys || []), ...(entry.secondary_keys || [])].join('\n').toLocaleLowerCase().includes(search))
      })
      return h('div', { className: 'dst-worldbook' },
        h('div', { className: 'dst-actions dst-worldbook-save' }, h('span', { className: 'dst-muted' }, status), h(Button, { disabled: busy, onClick: () => void save() }, busy ? '保存中…' : '保存世界书')),
        h('p', { className: 'dst-muted' }, '编辑工作区内独立保存的世界书资源。修改会影响所有引用该世界书的角色卡与 Session。未显示的字段与 extensions 会原样保留。'),
        diagnostics === null || diagnostics === undefined
          ? h('p', { className: 'dst-muted' }, '尚无生成诊断；完成一次模型请求后，这里会显示实际激活条目、预算和运行时警告。')
          : h('section', { className: 'dst-worldbook-book' },
              h('strong', null, '最近一次生成诊断'),
              h('p', { className: 'dst-muted' }, `${diagnosticTimeLabel ? `${diagnosticTimeLabel} · ` : ''}激活 ${Array.isArray(diagnostics.activeEntryIds) ? diagnostics.activeEntryIds.length : 0} 个条目 · 预算 ${Number(diagnosticBudget?.usedTokens) || 0}/${Number(diagnosticBudget?.tokens) || 0}${diagnosticBudget?.overflowed === true ? ' · 已达到上限' : ''}`),
              depthProjection?.status === 'injected'
                ? h('p', { className: 'dst-muted' }, `@Depth 内容已加入模型请求：${depthProjection.injectedEntries}/${depthProjection.expectedEntries} 项。`)
                : depthProjection?.status === 'skipped'
                  ? h('p', { className: 'dst-warning' }, `@Depth 内容未加入模型请求。${depthProjection.reason || '请检查插入内容后重新生成。'}`)
                  : depthProjection?.status === 'not-needed'
                    ? h('p', { className: 'dst-muted' }, '本次没有需要单独插入的 @Depth 内容。')
                    : h('p', { className: 'dst-warning' }, '已完成世界书组装，尚未确认 @Depth 内容加入模型请求。'),
              diagnosticWarnings.length === 0
                ? h('p', { className: 'dst-muted' }, '最近一次组装未发现世界书警告。')
                : h('div', { className: 'dst-warning' }, h('strong', null, `运行时警告（${diagnosticWarnings.length}）`), h('ul', null, diagnosticWarnings.map((warning, index) => h('li', { key: `${index}:${warning}` }, warning))))),
        h('fieldset', { disabled: busy, 'aria-busy': busy, style: { border: 0, margin: 0, minWidth: 0, padding: 0 } },
          h('section', { className: 'dst-worldbook-book' },
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '世界书名称' }, h('input', { value: book.name ?? '', onChange: event => updateBook('name', event.target.value) })),
              h(Field, { label: '扫描深度' }, h('input', { type: 'number', min: 0, max: 100, step: 1, value: book.scan_depth ?? '', placeholder: '使用默认值', onChange: event => updateBook('scan_depth', event.target.value === '' ? undefined : Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0)))) })),
              h(Field, { label: '书内 Token 上限（留空=不额外限制，0=禁用）' }, h('input', { type: 'number', min: 0, step: 1, value: book.token_budget ?? '', placeholder: '不额外限制', onChange: event => updateBook('token_budget', nonNegativeInteger(event.target.value)) }))),
            h('p', { className: 'dst-muted' }, '该上限只会收紧按模型上下文比例计算的世界书预算，不会提高全局预算；设为 0 时仅“忽略预算”的条目仍可插入。'),
            h(Field, { label: '描述' }, h('textarea', { rows: 3, value: book.description ?? '', onChange: event => updateBook('description', event.target.value) })),
            h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: book.recursive_scanning === true, onChange: event => updateBook('recursive_scanning', event.target.checked) }), h('span', null, '递归扫描（Recursive Scanning）'))),
          h('div', { className: 'dst-worldbook-list-head' },
            h('strong', null, `条目（${entryRows.length}）`),
            h(Button, { className: 'small', onClick: addEntry }, '新增条目')),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '搜索世界书条目' }, h('input', { type: 'search', value: query, placeholder: '名称、关键词或正文', onChange: event => setQuery(event.target.value) })),
            h(Field, { label: '条目状态' }, h('select', { value: enabledFilter, onChange: event => setEnabledFilter(event.target.value) }, h('option', { value: 'all' }, '全部条目'), h('option', { value: 'enabled' }, '已启用'), h('option', { value: 'disabled' }, '已停用')))),
          h('p', { className: 'dst-muted', role: 'status' }, `显示 ${visibleRows.length} / ${entryRows.length} 条；搜索只影响显示，保存仍保留所有条目。`),
          entryRows.length === 0 ? h('p', { className: 'dst-muted' }, '世界书还没有条目。') : null,
          h('div', { className: 'dst-worldbook-list' }, visibleRows.map(({ row, index }) => h(WorldbookEntryEditor, { key: row.uiKey, rowKey: row.uiKey, index, entry: row.value, onChange: updateEntry, onRemove: removeEntry })))))
    }

    function WorldbookTab({ session, library, editorSelection, onEditorSelection, reload }) {
      const worldbooks = Array.isArray(library?.worldbooks) ? library.worldbooks : []
      const boundWorldbookId = String(session.binding?.worldbookId || session.worldbookId || '')
      const inheritedWorldbookId = session.binding?.worldbookExplicit === true ? '' : String(session.card?.defaultWorldbookId || '')
      const currentWorldbookId = boundWorldbookId || inheritedWorldbookId
      const editorWorldbookId = editorSelection === null || editorSelection === undefined ? currentWorldbookId || String(worldbooks[0]?.id || '') : editorSelection
      const [editorRevision, setEditorRevision] = React.useState(0)
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [deleteDialog, setDeleteDialog] = React.useState(null)
      const pendingEditorWorldbookId = React.useRef(null)
      const editorState = useAsync(signal => editorWorldbookId
        ? api(`/worldbook?sessionId=${encodeURIComponent(session.sessionId)}&id=${encodeURIComponent(editorWorldbookId)}`, { signal })
        : null, [session.sessionId, editorWorldbookId, editorRevision])
      const loadedEditorWorldbook = editorState.value ? normalizeWorldbookRecord(editorState.value) : null
      const editorRecordReady = loadedEditorWorldbook?.id === editorWorldbookId
      React.useEffect(() => {
        const available = editorWorldbookId !== '' && worldbooks.some(item => String(item.id) === editorWorldbookId)
        if (available) {
          if (pendingEditorWorldbookId.current === editorWorldbookId) pendingEditorWorldbookId.current = null
          return
        }
        if (pendingEditorWorldbookId.current === editorWorldbookId) return
        const fallback = worldbooks.some(item => String(item.id) === currentWorldbookId) ? currentWorldbookId : String(worldbooks[0]?.id || '')
        if (fallback !== editorWorldbookId) onEditorSelection(fallback)
      }, [editorWorldbookId, currentWorldbookId, worldbooks.map(item => item.id).join('|')])
      const create = async () => {
        const name = window.prompt('新世界书名称：', 'New Worldbook')
        if (name === null) return
        if (name.trim() === '') { setStatus('世界书名称不能为空。'); return }
        setBusy(true)
        try {
          const result = await api('/worldbook/create', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, name: name.trim(), book: { name: name.trim(), description: '', entries: [], extensions: {} } }) })
          const created = normalizeWorldbookRecord(result)
          setStatus(`已创建“${created.name || name.trim()}”。`)
          if (created.id) {
            pendingEditorWorldbookId.current = created.id
            onEditorSelection(created.id)
          }
          overlay.changed(); reload()
        } catch (error) { setStatus(`创建失败：${error instanceof Error ? error.message : String(error)}`) }
        finally { setBusy(false) }
      }
      const bind = async value => {
        setBusy(true)
        try {
          await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, patch: { worldbookId: value || null } }) })
          setStatus(value ? '已更新当前 Session 的世界书引用。' : '当前 Session 已不引用世界书。')
          overlay.changed(); reload()
        } catch (error) { setStatus(`绑定失败：${error instanceof Error ? error.message : String(error)}`) }
        finally { setBusy(false) }
      }
      const copyForSession = async () => {
        const original = editorRecordReady ? loadedEditorWorldbook : null
        if (!original?.book) return
        setBusy(true)
        try {
          const occupiedNames = new Set(worldbooks.map(worldbook => String(worldbook.name || '')).filter(Boolean))
          let name
          let result
          while (result === undefined) {
            name = availableWorldbookCopyName(original.name, occupiedNames)
            try {
              result = await api('/worldbook/create', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, name, book: { ...original.book, name } }) })
            } catch (error) {
              if (error?.code !== 'worldbook-name-conflict' && !/already exists/i.test(String(error?.message || error))) throw error
              occupiedNames.add(name)
            }
          }
          const created = normalizeWorldbookRecord(result)
          await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, patch: { worldbookId: created.id } }) })
          pendingEditorWorldbookId.current = created.id
          onEditorSelection(created.id)
          setStatus(`已创建“${name}”并用于当前剧情，可以在下方编辑。`)
          overlay.changed(); reload()
        } catch (error) { setStatus(`复制失败：${error instanceof Error ? error.message : String(error)}`) }
        finally { setBusy(false) }
      }
      const remove = async confirm => {
        const target = deleteDialog?.worldbook
        if (!target) return
        setBusy(true)
        try {
          await api('/worldbook/delete', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, worldbookId: target.id, ...(confirm ? { confirm: true } : {}) }) })
          setStatus(`已删除“${target.name || '未命名世界书'}”，并移除所有角色卡和 Session 对它的引用。`)
          if (editorWorldbookId === target.id) onEditorSelection(null)
          setDeleteDialog(null)
          overlay.changed(); reload()
        } catch (error) {
          if (error?.code === 'worldbook-references-required') {
            const references = error.details?.references || {}
            setDeleteDialog(previous => ({ ...previous, references, inspected: true, error: '' }))
            setStatus('该世界书仍有引用，请核对后再次确认删除。')
          } else {
            setDeleteDialog(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }))
            setStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`)
          }
        } finally { setBusy(false) }
      }
      const selectedSummary = worldbooks.find(item => String(item.id) === editorWorldbookId)
      const diagnostics = editorWorldbookId !== '' && editorWorldbookId === currentWorldbookId ? session.worldbookDiagnostics : null
      return h('div', { className: 'dst-worldbook-manager' },
        h('div', { className: 'dst-section-title' }, '工作区全局世界书'),
        h('section', { className: 'dst-worldbook-controls' },
          h(Field, { label: '正在编辑的世界书（只切换编辑器，不改变 Session）' }, h('select', { value: editorWorldbookId, disabled: busy, onChange: event => onEditorSelection(event.target.value) },
            worldbooks.length === 0 ? h('option', { value: '' }, '暂无世界书') : null,
            worldbooks.map(worldbook => h('option', { key: worldbook.id, value: worldbook.id }, worldbook.name || '未命名世界书')))),
          h('div', { className: 'dst-actions dst-worldbook-resource-actions' },
            h(Button, { className: 'secondary', disabled: busy, onClick: () => void create() }, '新建世界书'),
            h(Button, { className: 'secondary', disabled: busy || !session.card || !editorRecordReady, onClick: () => void copyForSession() }, '复制到当前剧情再编辑'),
            h(Button, { className: 'danger', disabled: busy || !selectedSummary, onClick: () => setDeleteDialog({ worldbook: selectedSummary, references: null, inspected: false, error: '' }) }, '删除正在编辑的世界书')),
          h(Field, { label: '当前 Session 引用的世界书（与上方编辑选择相互独立）' }, h('select', { value: currentWorldbookId, disabled: busy || !session.card, onChange: event => void bind(event.target.value) },
            h('option', { value: '' }, '不使用世界书'),
            worldbooks.map(worldbook => h('option', { key: worldbook.id, value: worldbook.id }, `${worldbook.name || '未命名世界书'}${boundWorldbookId === '' && inheritedWorldbookId === String(worldbook.id) ? '（角色默认，首次消息时继承）' : ''}`)))),
          h('p', { className: 'dst-muted' }, session.card ? 'Session 保存的是世界书 ID 引用；两个 Session 引用同一本世界书时，编辑该资源会同时影响它们。' : '当前 Session 尚未选择角色卡；仍可管理全局世界书，但暂时不能建立 Session 引用。')),
        status ? h('p', { className: 'dst-status' }, status) : null,
        editorWorldbookId === '' ? h('p', { className: 'dst-muted' }, '请新建或选择一个世界书。') : null,
        editorState.loading || editorWorldbookId !== '' && !editorRecordReady && !editorState.error ? h('p', { className: 'dst-loading' }, '正在读取世界书…') : null,
        editorState.error ? h('p', { className: 'dst-error' }, editorState.error) : null,
        editorRecordReady ? h(WorldbookEditor, { key: `${editorWorldbookId}:${editorRevision}`, sessionId: session.sessionId, worldbook: loadedEditorWorldbook, diagnostics, reload: () => { setEditorRevision(value => value + 1); reload() } }) : null,
        deleteDialog ? h(ConfirmPanel, {
          title: `删除世界书“${deleteDialog.worldbook.name || '未命名世界书'}”`,
          busy,
          confirmLabel: deleteDialog.inspected ? '确认删除并移除引用' : '检查引用并删除',
          onConfirm: () => void remove(deleteDialog.inspected === true),
          onCancel: () => setDeleteDialog(null),
        },
        h('p', null, '删除后，所有角色卡的默认世界书和所有 Session 的世界书引用都会自动清空。此操作不可撤销。'),
        deleteDialog.error ? h('p', { className: 'dst-error' }, deleteDialog.error) : null,
        deleteDialog.inspected ? h(React.Fragment, null,
          h('p', { className: 'dst-warning' }, '以下对象正在引用该世界书。继续删除会移除它们的引用：'),
          h(ReferenceList, { title: '角色卡', references: deleteDialog.references?.cards }),
          h(ReferenceList, { title: 'Session', references: deleteDialog.references?.sessions })) : null) : null)
    }

    function MemoryScalar({ value }) {
      if (value === null) return h('span', { className: 'dst-memory-scalar null' }, '空值')
      if (typeof value === 'boolean') return h('span', { className: `dst-memory-scalar boolean ${value ? 'true' : 'false'}` }, value ? '是' : '否')
      if (typeof value === 'number') return h('span', { className: 'dst-memory-scalar number' }, String(value))
      if (typeof value === 'string') return h('span', { className: `dst-memory-scalar string${value === '' ? ' empty' : ''}` }, value === '' ? '空字符串' : value)
      return h('span', { className: 'dst-memory-scalar' }, String(value))
    }

    function MemoryValue({ value, depth = 0 }) {
      if (value === null || typeof value !== 'object') return h(MemoryScalar, { value })
      const array = Array.isArray(value)
      const entries = array ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value)
      if (entries.length === 0) return h('span', { className: 'dst-memory-empty' }, array ? '空列表' : '空对象')
      const content = h(array ? 'ol' : 'dl', { className: array ? 'dst-memory-array' : 'dst-memory-fields' }, entries.map(([name, item]) => array
        ? h('li', { key: name }, h(MemoryValue, { value: item, depth: depth + 1 }))
        : h('div', { className: 'dst-memory-field', key: name }, h('dt', null, name), h('dd', null, h(MemoryValue, { value: item, depth: depth + 1 })))))
      if (depth === 0) return content
      return h('details', { className: 'dst-memory-nested', open: depth === 1 },
        h('summary', null, array ? `${entries.length} 项` : `${entries.length} 个字段`), content)
    }

    const MEMORY_STORY_TIME_STATUS_LABELS = Object.freeze({ unknown: '未知', 'label-only': '仅标签', normalized: '已标准化' })
    const MEMORY_RECALL_POLICY_LABELS = Object.freeze({ always: '始终自动召回', after_compaction: '剧情折叠后自动召回', query_only: '仅显式查询' })
    const MEMORY_SOURCE_ROLE_LABELS = Object.freeze({ user: '用户', assistant: '助手', system: '系统' })

    function memoryCharacters(input) {
      return [...new Set(String(input ?? '').split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
    }

    function memoryKeywords(input) {
      return [...new Set(String(input ?? '').split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
    }

    function memoryLocation(input) {
      const text = String(input ?? '').trim()
      if (text === '') return null
      const path = text.split('/').map(segment => segment.trim())
      if (path.some(segment => segment === '')) throw new Error('地点路径不能包含空层级')
      return path
    }

    function memoryLocationText(location) {
      return Array.isArray(location) && location.length > 0 ? location.join(' / ') : '未记录'
    }

    function memoryTimeNumber(input) {
      return String(input).trim() === '' ? NaN : Number(input)
    }

    function memoryStoryTimeText(storyTime) {
      const time = storyTime && typeof storyTime === 'object' ? storyTime : {}
      const status = ['unknown', 'label-only', 'normalized'].includes(time.state) ? time.state : 'unknown'
      const parts = [MEMORY_STORY_TIME_STATUS_LABELS[status], time.label, time.timeline]
      if (status === 'normalized') {
        const start = time.start == null || String(time.start).trim() === '' ? '开始时间未记录' : String(time.start).trim()
        const end = time.end == null || String(time.end).trim() === '' ? '结束时间未记录' : String(time.end).trim()
        parts.push(`${start} – ${end}`)
      }
      return parts.filter(item => item != null && String(item).trim() !== '').join(' · ')
    }

    function memoryRecallPolicyText(recallPolicy) {
      return MEMORY_RECALL_POLICY_LABELS[recallPolicy] || MEMORY_RECALL_POLICY_LABELS.after_compaction
    }

    function memorySourceRefsText(sourceRefs) {
      const refs = Array.isArray(sourceRefs) ? sourceRefs : []
      if (refs.length === 0) return '无来源记录'
      const shown = refs.slice(0, 3).map(ref => {
        const parts = []
        if (Number.isSafeInteger(ref?.eventSeq)) parts.push(`#${ref.eventSeq}`)
        if (Number.isSafeInteger(ref?.turn)) parts.push(`第 ${ref.turn} 回合`)
        if (typeof ref?.role === 'string' && ref.role !== '') parts.push(MEMORY_SOURCE_ROLE_LABELS[ref.role] || ref.role)
        return parts.length > 0 ? parts.join(' · ') : '未知来源'
      })
      if (refs.length > shown.length) shown.push(`另 ${refs.length - shown.length} 条`)
      return shown.join('；')
    }

    function eventGraph(rows, eventEdges) {
      const nodesById = new Map()
      const ungroupedRows = []
      for (const row of rows) {
        const eventId = typeof row?.eventId === 'string' ? row.eventId.trim() : ''
        if (eventId === '') {
          ungroupedRows.push(row)
          continue
        }
        let node = nodesById.get(eventId)
        if (node === undefined) {
          node = { eventId, rows: [], predecessors: [], successors: [] }
          nodesById.set(eventId, node)
        }
        node.rows.push(row)
      }
      for (const edge of eventEdges) {
        if (edge?.kind !== 'precedes') continue
        const predecessorEventId = String(edge.predecessorEventId ?? '').trim()
        const successorEventId = String(edge.successorEventId ?? '').trim()
        const predecessor = nodesById.get(predecessorEventId)
        const successor = nodesById.get(successorEventId)
        if (predecessor !== undefined) predecessor.successors.push({ eventId: successorEventId, edge })
        if (successor !== undefined) successor.predecessors.push({ eventId: predecessorEventId, edge })
      }
      return { nodes: [...nodesById.values()], ungroupedRows }
    }

    function MemoryRow({ row, remove }) {
      return h('article', { className: 'dst-memory-row' },
        h('header', { className: 'dst-memory-row-head' },
          h('div', { className: 'dst-memory-identity' }, h('span', { className: 'dst-memory-table-name' }, row.table), h('strong', null, row.key)),
          h('div', { className: 'dst-memory-meta' },
            h('span', null, `重要度 ${Math.round(Number(row.importance ?? 0.5) * 100)}%`),
            Array.isArray(row.keywords) && row.keywords.length > 0 ? h('div', { className: 'dst-memory-keywords' }, row.keywords.map(keyword => h('span', { key: keyword }, keyword))) : null)),
        h('div', { className: 'dst-memory-context' },
          h('span', null, `召回：${memoryRecallPolicyText(row.recallPolicy)}`),
          h('span', { className: 'dst-memory-provenance' }, `来源：${memorySourceRefsText(row.sourceRefs)}`),
          h('span', null, `剧情时间：${memoryStoryTimeText(row.storyTime)}`),
          h('span', null, `地点：${memoryLocationText(row.location)}`),
          h('span', null, `人物：${Array.isArray(row.characters) && row.characters.length > 0 ? row.characters.join('、') : '未记录'}`),
          row.eventId ? h('span', null, `事件组：${row.eventId}`) : null),
        h('div', { className: 'dst-memory-value' }, h(MemoryValue, { value: row.value })),
        h('footer', { className: 'dst-memory-row-actions' },
          h('details', { className: 'dst-memory-raw' }, h('summary', null, '查看原始 JSON'), h('pre', null, JSON.stringify(row.value, null, 2))),
          h(Button, { className: 'danger small', onClick: () => void remove(row.id) }, '删除')))
    }

    function EventRelationList({ title, relations }) {
      return h('div', { className: 'dst-event-relations' },
        h('strong', null, title),
        relations.length === 0 ? h('span', { className: 'dst-muted' }, '无') : h('ul', null, relations.map((relation, index) => h('li', { key: relation.edge?.id || `${relation.eventId}:${index}` },
          h('code', null, relation.eventId),
          relation.edge?.reason ? h('span', null, ` · ${relation.edge.reason}`) : null,
          Array.isArray(relation.edge?.sourceRefs) && relation.edge.sourceRefs.length > 0
            ? h('small', null, `来源：${memorySourceRefsText(relation.edge.sourceRefs)}`)
            : null))))
    }

    function EventGraph({ graph, remove }) {
      return h('section', { className: 'dst-event-section' },
        h('div', { className: 'dst-event-section-head' },
          h('div', { className: 'dst-section-title' }, '事件关系'),
          h('span', { className: 'dst-muted' }, '按事件组聚合记忆，并展示直接先后关系')),
        graph.nodes.length === 0 ? h('div', { className: 'dst-event-empty dst-muted' }, '尚无由记忆组成的事件。') : null,
        h('div', { className: 'dst-event-graph' }, graph.nodes.map(node => h('article', { className: 'dst-event-node', key: node.eventId },
          h('header', { className: 'dst-event-head' }, h('strong', null, `事件 ${node.eventId}`), h('span', { className: 'dst-muted' }, `${node.rows.length} 条记忆`)),
          h('div', { className: 'dst-event-links' },
            h(EventRelationList, { title: '直接前置事件', relations: node.predecessors }),
            h(EventRelationList, { title: '直接后续事件', relations: node.successors })),
          h('div', { className: 'dst-memory-table dst-event-memory-rows' }, node.rows.map(row => h(MemoryRow, { key: row.id, row, remove })))))))
    }

    function EventTab({ session, reload }) {
      const [table, setTable] = React.useState('events')
      const [key, setKey] = React.useState('')
      const [value, setValue] = React.useState('{}')
      const [keywords, setKeywords] = React.useState('')
      const [storyTimeLabel, setStoryTimeLabel] = React.useState('')
      const [storyTimeTimeline, setStoryTimeTimeline] = React.useState('')
      const [storyTimeStart, setStoryTimeStart] = React.useState('')
      const [storyTimeEnd, setStoryTimeEnd] = React.useState('')
      const [location, setLocation] = React.useState('')
      const [characters, setCharacters] = React.useState('')
      const [eventId, setEventId] = React.useState('')
      const [recallPolicy, setRecallPolicy] = React.useState('after_compaction')
      const [status, setStatus] = React.useState('')
      const rows = session.event?.rows || []
      const eventEdges = session.event?.eventEdges || []
      const graph = React.useMemo(() => eventGraph(rows, eventEdges), [rows, eventEdges])
      const existingDraftRow = rows.find(row => String(row?.table ?? '').trim() === table.trim() && String(row?.key ?? '').trim() === key.trim())
      const reusableStart = existingDraftRow?.storyTime?.state === 'normalized'
        && existingDraftRow.storyTime.timeline === storyTimeTimeline.trim()
        && Number.isFinite(existingDraftRow.storyTime.start)
        ? existingDraftRow.storyTime.start
        : null
      const add = async () => {
        try {
          const parsed = JSON.parse(value)
          const timeline = storyTimeTimeline.trim()
          if (timeline === '') throw new Error('剧情时间线不能为空')
          const start = storyTimeStart.trim() === '' ? reusableStart : memoryTimeNumber(storyTimeStart)
          if (!Number.isFinite(start)) throw new Error('剧情开始时间必填且必须是有限数字')
          const end = storyTimeEnd.trim() === '' ? null : memoryTimeNumber(storyTimeEnd)
          if (end !== null && !Number.isFinite(end)) throw new Error('剧情结束时间必须是有限数字或留空')
          if (end !== null && end < start) throw new Error('剧情结束时间不能早于开始时间')
          const storyTime = { state: 'normalized', label: storyTimeLabel.trim() || null, timeline, start, end }
          await api('/event', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, operation: { action: 'upsert', expectedRevision: session.event?.revision ?? 0, table, key, value: parsed, keywords: memoryKeywords(keywords), importance: 0.6, recallPolicy, sourceRefs: [], storyTime: storyTime, location: memoryLocation(location), characters: memoryCharacters(characters), eventId: eventId.trim() || undefined } }) })
          setKey(''); setValue('{}'); setKeywords(''); setStoryTimeLabel(''); setStoryTimeTimeline(''); setStoryTimeStart(''); setStoryTimeEnd(''); setLocation(''); setCharacters(''); setEventId(''); setRecallPolicy('after_compaction'); setStatus('已写入'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message); reload() }
      }
      const remove = async id => {
        const row = rows.find(item => item.id === id)
        const eventId = typeof row?.eventId === 'string' ? row.eventId : ''
        const removesEventNode = eventId !== '' && rows.filter(item => item.eventId === eventId).length === 1
        const edgeDeletes = removesEventNode
          ? eventEdges.filter(edge => edge.predecessorEventId === eventId || edge.successorEventId === eventId).map(edge => ({ action: 'event_edge_delete', id: edge.id }))
          : []
        const change = edgeDeletes.length === 0
          ? { action: 'delete', id }
          : { action: 'batch', operations: [...edgeDeletes, { action: 'delete', id }] }
        const operation = { ...change, expectedRevision: session.event?.revision ?? 0 }
        try {
          await api('/event', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, operation }) })
          setStatus('已删除'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message); reload() }
      }
      return h('div', null,
        h('div', { className: 'dst-section-title' }, `事件（修订 ${session.event?.revision || 0}）`),
        h('p', { className: 'dst-muted' }, '一个事件可聚合多条记忆，并通过直接前置与后续关系连接其他事件。'),
        h('div', { className: 'dst-inline-fields' },
          h(Field, { label: '表名' }, h('input', { value: table, onChange: event => setTable(event.target.value) })),
          h(Field, { label: '键' }, h('input', { value: key, onChange: event => setKey(event.target.value) }))),
        h(Field, { label: '关键词（2–10 个，逗号或换行分隔，必须逐字来自助手正文）' }, h('textarea', { rows: 2, value: keywords, onChange: event => setKeywords(event.target.value) })),
        h(Field, { label: '结构化值（JSON 对象）' }, h('textarea', { rows: 4, value, onChange: event => setValue(event.target.value) })),
        h('div', { className: 'dst-event-context-form' },
          h('div', { className: 'dst-section-title' }, '剧情上下文'),
          h('p', { className: 'dst-muted' }, '新写记忆使用标准化剧情时间；开始时间必填，结束时间可留空。'),
          h('p', { className: 'dst-muted' }, '时间标签可按世界观格式补零，并注明原文精度（如日、亿年）；开始和结束坐标保持该时间线原有单位，不因展示补零换算。'),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '时间标签（label）' }, h('input', { value: storyTimeLabel, onChange: event => setStoryTimeLabel(event.target.value) })),
            h(Field, { label: '时间线（timeline，必填）' }, h('input', { required: true, value: storyTimeTimeline, onChange: event => setStoryTimeTimeline(event.target.value) }))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '开始（start，新增必填）' }, h('input', { type: 'number', step: 'any', required: reusableStart === null, value: storyTimeStart, placeholder: reusableStart === null ? undefined : `留空沿用 ${reusableStart}`, onChange: event => setStoryTimeStart(event.target.value) })),
            h(Field, { label: '结束（end，可留空）' }, h('input', { type: 'number', step: 'any', value: storyTimeEnd, placeholder: '留空表示结束时间未记录', onChange: event => setStoryTimeEnd(event.target.value) }))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '地点路径（从大到小，以 / 分隔，可留空）' }, h('input', { value: location, placeholder: '东京都外 / 成田机场 / 国际到达大厅', onChange: event => setLocation(event.target.value) })),
            h(Field, { label: '人物（逗号或换行分隔）' }, h('textarea', { rows: 2, value: characters, onChange: event => setCharacters(event.target.value) }))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '事件组 ID（可选）' }, h('input', { value: eventId, onChange: event => setEventId(event.target.value) })),
            h(Field, { label: '召回策略' }, h('select', { value: recallPolicy, onChange: event => setRecallPolicy(event.target.value) },
              h('option', { value: 'after_compaction' }, '剧情折叠后自动召回'),
              h('option', { value: 'always' }, '始终自动召回'),
              h('option', { value: 'query_only' }, '仅显式查询'))))),
        h('div', { className: 'dst-actions' }, h(Button, { disabled: key.trim() === '' || storyTimeTimeline.trim() === '' || storyTimeStart.trim() === '' && reusableStart === null, onClick: () => void add() }, '添加/覆盖记忆'), h('span', { className: 'dst-muted' }, status)),
        rows.length === 0 ? h('div', { className: 'dst-event-empty-state' }, '还没有事件。对话中形成的持久事实会作为记忆聚合到事件中。') : null,
        h(EventGraph, { graph, remove }),
        graph.ungroupedRows.length > 0 ? h('section', { className: 'dst-event-ungrouped' },
          h('div', { className: 'dst-section-title' }, '未关联事件的记忆'),
          h('div', { className: 'dst-memory-table' }, graph.ungroupedRows.map(row => h(MemoryRow, { key: row.id, row, remove })))) : null)
    }

    function executableScript(script) {
      if (script?.kind !== 'regex') return script
      const source = String(script.source ?? '')
      const fenced = /^\s*```html?\s*([\s\S]*?)```\s*$/i.exec(source)
      return { ...script, kind: 'html', source: fenced === null ? source : fenced[1] }
    }

    function compatibleHtmlSource(source) {
      return String(source)
        .replace(/\b(?:window\.)?parent\.document\.querySelector\(\s*(['"])#send_textarea\1\s*\)/g, 'window.__dshComposerInput')
        .replace(/\b(?:window\.)?parent\.document\.getElementById\(\s*(['"])send_textarea\1\s*\)/g, 'window.__dshComposerInput')
        .replace(/\b(?:window\.)?parent\.document\.querySelector\(\s*(['"])#send_but\1\s*\)/g, 'window.__dshComposerSend')
        .replace(/\b(?:window\.)?parent\.document\.getElementById\(\s*(['"])send_but\1\s*\)/g, 'window.__dshComposerSend')
        .replace(/\b(?:window\.)?parent\.(?:\$|jQuery)\(\s*(['"])#send_textarea\1\s*\)/g, 'window.__dshComposerJquery("#send_textarea")')
        .replace(/\b(?:window\.)?parent\.(?:\$|jQuery)\(\s*(['"])#send_but\1\s*\)/g, 'window.__dshComposerJquery("#send_but")')
    }

    function installCompatibilityRuntime(root, initialSnapshot, channel, metadata) {
      const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
      const deepFreeze = value => {
        if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
        for (const child of Object.values(value)) deepFreeze(child)
        return Object.freeze(value)
      }
      const assignArray = (target, values) => { target.splice(0, target.length, ...clone(values || [])) }
      const assignObject = (target, value) => {
        for (const key of Object.keys(target)) delete target[key]
        Object.assign(target, clone(value || {}))
      }
      class CompatibilityUnavailableError extends Error {
        constructor(capability, reason) { super(`${capability} is unavailable: ${reason}`); this.name = 'CompatibilityUnavailableError'; this.code = 'dsh-compat-unavailable'; this.capability = capability }
      }
      let snapshot = clone(initialSnapshot || {})
      let seq = 0
      let listenerSeq = 0
      let disposed = false
      const pending = new Map()
      const listeners = new Map()
      const chat = []
      const characters = []
      const chatMetadata = {}
      if (metadata?.surface === 'message') root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'compat-event', payload: { name: 'message_iframe_render_started', args: [String(metadata.scriptId || channel)] } }, '*')
      const getBucket = name => {
        const key = String(name)
        if (!listeners.has(key)) listeners.set(key, [])
        return listeners.get(key)
      }
      const removeRecord = record => {
        const bucket = listeners.get(record.name)
        if (!bucket) return
        const index = bucket.indexOf(record)
        if (index >= 0) bucket.splice(index, 1)
        if (bucket.length === 0) listeners.delete(record.name)
      }
      const addListener = (name, fn, priority, once) => {
        if (typeof fn !== 'function') throw new TypeError('event listener must be a function')
        const bucket = getBucket(name)
        const existing = bucket.find(record => record.fn === fn)
        if (existing) return Object.freeze({ stop: () => removeRecord(existing) })
        const record = { name: String(name), fn, priority, once, order: ++listenerSeq }
        bucket.push(record)
        bucket.sort((left, right) => left.priority - right.priority || left.order - right.order)
        return Object.freeze({ stop: () => removeRecord(record) })
      }
      const dispatch = async (name, args) => {
        const bucket = [...(listeners.get(String(name)) || [])]
        for (const record of bucket) {
          if (record.once) removeRecord(record)
          await record.fn(...args)
        }
      }
      const eventOn = (name, fn) => addListener(name, fn, 0, false)
      const eventMakeFirst = (name, fn) => addListener(name, fn, -1, false)
      const eventMakeLast = (name, fn) => addListener(name, fn, 1, false)
      const eventOnce = (name, fn) => addListener(name, fn, 0, true)
      const eventRemoveListener = (name, fn) => {
        for (const record of [...(listeners.get(String(name)) || [])]) if (record.fn === fn) removeRecord(record)
      }
      const eventClearEvent = name => listeners.delete(String(name))
      const eventClearListener = fn => { for (const bucket of [...listeners.values()]) for (const record of [...bucket]) if (record.fn === fn) removeRecord(record) }
      const eventClearAll = () => listeners.clear()
      const eventEmit = async (name, ...args) => {
        await dispatch(name, args)
        root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'compat-event', payload: { name: String(name), args: clone(args) } }, '*')
      }
      const eventEmitAndWait = (name, ...args) => { void eventEmit(name, ...args) }
      const eventSource = Object.freeze({ on: eventOn, makeFirst: eventMakeFirst, makeLast: eventMakeLast, once: eventOnce, removeListener: eventRemoveListener, emit: eventEmit, emitAndWait: eventEmitAndWait })
      const rpc = (action, args = {}, timeout = 5000) => new Promise((resolve, reject) => {
        const id = ++seq
        const timer = root.setTimeout(() => { pending.delete(id); reject(new Error('SillyTavern script RPC timed out')) }, timeout)
        pending.set(id, { resolve, reject, timer })
        try { root.parent.postMessage({ __dshSillyTavern: true, channel, id, action, args }, '*') }
        catch (error) { root.clearTimeout(timer); pending.delete(id); reject(error) }
      })
      const reportWriteError = error => { console.error('[dsh-sillytavern] compatibility write failed', error); void dispatch('dsh_compatibility_error', [error]).catch(next => console.error(next)) }
      const variableType = option => String(option?.type || 'chat')
      const presetKey = () => {
        const ids = Array.isArray(snapshot.state?.binding?.templateIds) ? snapshot.state.binding.templateIds.map(String).sort() : []
        return ids.length === 0 ? 'in_use' : ids.join('\u001f')
      }
      const scriptKey = () => `${String(snapshot.cardRecord?.id || 'none')}\u001f${String(metadata?.scriptId || 'unknown')}`
      const messageIndex = option => {
        const raw = option?.message_id ?? 'latest'
        if (raw === 'latest') {
          for (let index = (snapshot.messages || []).length - 1; index >= 0; index -= 1) if (snapshot.messages[index]?.role !== 'system') return index
          return -1
        }
        const number = Number(raw)
        if (!Number.isSafeInteger(number)) throw new TypeError('message_id must be a safe integer or latest')
        return number < 0 ? (snapshot.messages || []).length + number : number
      }
      const currentMessageIndex = () => {
        if (metadata?.surface !== 'message') return -1
        if (Number.isSafeInteger(metadata.currentSourceSeq)) {
          const index = (snapshot.messages || []).findIndex(message => message.sourceSeq === metadata.currentSourceSeq || message.event_seq === metadata.currentSourceSeq)
          if (index >= 0) return index
        }
        return Number.isSafeInteger(metadata.currentMessageId) ? metadata.currentMessageId : -1
      }
      const readVariableScope = option => {
        const type = variableType(option)
        const maps = snapshot.variableMaps || {}
        if (type === 'chat') return snapshot.variableScopes?.chat ?? snapshot.variables ?? {}
        if (type === 'global') return snapshot.variableScopes?.global ?? snapshot.globalVariables ?? {}
        if (type === 'preset') return maps.presets?.[presetKey()] ?? snapshot.variableScopes?.preset ?? {}
        if (type === 'character') return maps.characters?.[String(snapshot.cardRecord?.id || '')] ?? snapshot.variableScopes?.character ?? {}
        if (type === 'script') {
          if (Object.hasOwn(maps.scripts || {}, scriptKey())) return maps.scripts[scriptKey()]
          const imported = snapshot.cardRecord?.scripts?.find(script => script.id === metadata?.scriptId)
          return imported?.data ?? snapshot.variableScopes?.script ?? {}
        }
        if (type === 'extension') {
          const extensionId = String(option?.extension_id || '')
          if (extensionId === '') throw new TypeError('extension_id is required for extension variables')
          return maps.extensions?.[extensionId] ?? {}
        }
        if (type === 'message') {
          const message = (snapshot.messages || [])[messageIndex(option)]
          if (!message) throw new RangeError('message_id is outside the current chat')
          return message.data && typeof message.data === 'object' && !Array.isArray(message.data) ? message.data : {}
        }
        throw new TypeError(`unknown variable scope ${type}`)
      }
      const writeVariableScope = (option, variables) => {
        const type = variableType(option)
        const value = clone(variables)
        snapshot.variableScopes ||= {}
        snapshot.variableMaps ||= {}
        snapshot.variableScopes[type] = value
        if (type === 'chat') {
          snapshot.variables = value
          if (snapshot.state?.binding) snapshot.state.binding.variables = value
        } else if (type === 'global') {
          snapshot.globalVariables = value
          snapshot.variableMaps.global = value
        } else if (type === 'preset') {
          snapshot.variableMaps.presets ||= {}; snapshot.variableMaps.presets[presetKey()] = value
        } else if (type === 'character') {
          snapshot.variableMaps.characters ||= {}; snapshot.variableMaps.characters[String(snapshot.cardRecord?.id || '')] = value
        } else if (type === 'script') {
          snapshot.variableMaps.scripts ||= {}; snapshot.variableMaps.scripts[scriptKey()] = value
        } else if (type === 'extension') {
          const extensionId = String(option?.extension_id || '')
          if (extensionId === '') throw new TypeError('extension_id is required for extension variables')
          snapshot.variableMaps.extensions ||= {}; snapshot.variableMaps.extensions[extensionId] = value
        } else if (type === 'message') {
          const index = messageIndex(option)
          if (!(snapshot.messages || [])[index]) throw new RangeError('message_id is outside the current chat')
          snapshot.messages[index].data = value
        } else throw new TypeError(`unknown variable scope ${type}`)
      }
      const getVariables = option => clone(readVariableScope(option))
      const replaceVariables = (variables, option) => {
        if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) throw new TypeError('replaceVariables expects an object')
        writeVariableScope(option, variables)
        syncContext()
        void rpc('replaceVariables', { variables: clone(variables), option: clone(option || { type: 'chat' }), scriptId: metadata?.scriptId }).catch(reportWriteError)
      }
      const updateVariablesWith = (updater, option) => {
        if (typeof updater !== 'function') throw new TypeError('updateVariablesWith expects a function')
        const value = updater(getVariables(option))
        if (value && typeof value.then === 'function') return value.then(next => { replaceVariables(next, option); return next })
        replaceVariables(value, option)
        return value
      }
      const mergeVariables = (target, source) => {
        if (Array.isArray(source)) return clone(source)
        if (source === null || typeof source !== 'object') return clone(source)
        const result = target !== null && typeof target === 'object' && !Array.isArray(target) ? clone(target) : {}
        for (const [key, value] of Object.entries(source)) result[key] = Array.isArray(value) ? clone(value) : value !== null && typeof value === 'object' ? mergeVariables(result[key], value) : clone(value)
        return result
      }
      const insertOrAssignVariables = (variables, option) => { const next = mergeVariables(getVariables(option), variables || {}); replaceVariables(next, option); return next }
      const insertVariables = (variables, option) => {
        const next = mergeVariables(variables || {}, getVariables(option))
        replaceVariables(next, option)
        return next
      }
      const deleteVariable = (path, option) => {
        const next = getVariables(option)
        const parts = []
        String(path ?? '').replace(/[^.[\]]+|\[(?:(['"])((?:(?!\1)[^\\]|\\.)*?)\1|([^\]]*))\]/g, (match, quote, quoted, bare) => {
          parts.push(String(quote ? quoted.replace(/\\(['"\\])/g, '$1') : bare === undefined ? match : bare.trim()))
          return match
        })
        let parent = next
        let delete_occurred = false
        for (const key of parts.slice(0, -1)) {
          if (parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, key)) { parent = null; break }
          parent = parent[key]
        }
        const key = parts.at(-1)
        if (parent !== null && parent !== undefined && typeof parent === 'object' && key !== undefined && Object.hasOwn(parent, key)) {
          delete_occurred = true
          delete parent[key]
        }
        replaceVariables(next, option)
        return { variables: getVariables(option), delete_occurred }
      }
      const getAllVariables = () => {
        const result = {
          ...getVariables({ type: 'global' }),
          ...getVariables({ type: 'character' }),
        }
        if (metadata?.surface !== 'message') Object.assign(result, getVariables({ type: 'script' }))
        Object.assign(result, getVariables())
        if (metadata?.surface === 'message') {
          const end = currentMessageIndex()
          for (const message of (snapshot.messages || []).slice(0, end + 1)) {
            const variables = message?.data
            if (variables && typeof variables === 'object' && !Array.isArray(variables)) Object.assign(result, variables)
          }
        }
        return clone(result)
      }
      const injectionFilters = new Map()
      const ownedInjectionIds = new Set()
      const normalizedInjection = prompt => ({
        id: String(prompt?.id || `dsh-injection-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        position: prompt?.position === 'none' ? 'none' : 'in_chat',
        depth: Number.isFinite(Number(prompt?.depth)) ? Number(prompt.depth) : 0,
        role: ['system', 'assistant', 'user'].includes(prompt?.role) ? prompt.role : 'system',
        content: String(prompt?.content ?? prompt?.text ?? ''),
        text: String(prompt?.content ?? prompt?.text ?? ''),
        order: Number.isFinite(Number(prompt?.order)) ? Number(prompt.order) : 0,
        should_scan: prompt?.should_scan === true,
        once: false,
        ownerFrameId: channel,
        hasFilter: typeof prompt?.filter === 'function',
      })
      const uninjectPrompts = ids => {
        const values = [...new Set((Array.isArray(ids) ? ids : [ids]).map(String))]
        snapshot.scriptInjections = (snapshot.scriptInjections || []).filter(item => !values.includes(String(item.id)))
        for (const id of values) { injectionFilters.delete(id); ownedInjectionIds.delete(id) }
        void rpc('uninjectPrompts', { ids: values }).catch(reportWriteError)
      }
      const injectPrompts = (prompts, options = {}) => {
        if (!Array.isArray(prompts)) throw new TypeError('injectPrompts expects an array')
        const normalized = prompts.map(normalizedInjection)
        for (let index = 0; index < normalized.length; index += 1) {
          normalized[index].once = options?.once === true
          ownedInjectionIds.add(normalized[index].id)
          if (typeof prompts[index]?.filter === 'function') injectionFilters.set(normalized[index].id, prompts[index].filter)
        }
        const ids = normalized.map(item => item.id)
        const byId = new Map((snapshot.scriptInjections || []).map(item => [String(item.id), item]))
        for (const item of normalized) byId.set(item.id, item)
        snapshot.scriptInjections = [...byId.values()]
        void rpc('injectPrompts', { prompts: normalized, options: clone(options) }).catch(reportWriteError)
        let active = true
        return Object.freeze({ uninject() { if (!active) return; active = false; uninjectPrompts(ids) } })
      }
      const activeGenerations = new Set()
      const prepareGenerationConfig = async config => {
        const eligibleInjectionIds = []
        for (const item of snapshot.scriptInjections || []) {
          const filter = injectionFilters.get(String(item.id))
          if (typeof filter !== 'function') {
            if (item.hasFilter !== true) eligibleInjectionIds.push(String(item.id))
            continue
          }
          if (await filter()) eligibleInjectionIds.push(String(item.id))
        }
        return { ...clone(config || {}), __dshEligibleInjectionIds: eligibleInjectionIds }
      }
      const runGeneration = async (mode, config = {}) => {
        const images = Array.isArray(config.image) ? config.image : config.image === undefined ? [] : [config.image]
        if (images.some(image => typeof image !== 'string')) throw new TypeError('File image inputs are unavailable; use an image URL or data URL string')
        const prepared = clone(config || {})
        const generationId = String(prepared.generation_id || `dsh-generation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        prepared.generation_id = generationId
        if (activeGenerations.has(generationId)) throw new Error(`generation ${generationId} is already active`)
        activeGenerations.add(generationId)
        try {
          const result = await rpc('generate', { mode, config: prepared }, 5 * 60 * 1000)
          return result
        } finally { activeGenerations.delete(generationId) }
      }
      const generate = config => runGeneration('preset', config)
      const generateRaw = config => runGeneration('raw', config)
      const stopGenerationById = generationId => {
        const id = String(generationId ?? '')
        if (!activeGenerations.has(id) && !(snapshot.activeGenerationIds || []).includes(id)) return false
        void rpc('stopGeneration', { generationId: id }).catch(reportWriteError)
        return true
      }
      const stopAllGeneration = () => {
        if (activeGenerations.size === 0 && (snapshot.activeGenerationIds || []).length === 0) return false
        void rpc('stopAllGeneration').catch(reportWriteError)
        return true
      }
      const getModelList = customApi => rpc('getModelList', { provider: String(customApi?.source || '') })
      const macroLikes = []
      const namedMacros = new Map()
      const registerMacroLike = (regex, replace) => {
        if (!(regex instanceof RegExp) && Object.prototype.toString.call(regex) !== '[object RegExp]') throw new TypeError('macro regex must be a RegExp')
        if (typeof replace !== 'function') throw new TypeError('macro replacement must be a function')
        if (!macroLikes.some(item => item.regex.source === regex.source)) macroLikes.push({ regex: new RegExp(regex.source, regex.flags), replace })
        let active = true
        return Object.freeze({ unregister() { if (!active) return; active = false; unregisterMacroLike(regex) } })
      }
      const unregisterMacroLike = regex => {
        if (!(regex instanceof RegExp) && Object.prototype.toString.call(regex) !== '[object RegExp]') throw new TypeError('macro regex must be a RegExp')
        const index = macroLikes.findIndex(item => item.regex.source === regex.source)
        if (index >= 0) macroLikes.splice(index, 1)
      }
      const macroContext = extra => {
        const messageId = currentMessageIndex()
        return { ...(messageId >= 0 ? { message_id: messageId } : {}), ...extra }
      }
      const substituteParams = (input, userName, characterName) => {
        let text = String(input ?? '')
        const builtin = {
          user: String(userName ?? snapshot.context?.name1 ?? snapshot.persona?.name ?? 'User'),
          char: String(characterName ?? snapshot.context?.name2 ?? snapshot.character?.nickname ?? snapshot.character?.name ?? 'Character'),
          lastMessageId: String(Math.max(-1, (snapshot.messages || []).length - 1)),
          lastMessage: String((snapshot.messages || []).at(-1)?.message ?? ''),
        }
        text = text.replace(/{{\s*([^{}]+?)\s*}}/g, (substring, key) => {
          const name = String(key).trim()
          if (Object.hasOwn(builtin, name)) return builtin[name]
          const registered = namedMacros.get(name)
          if (registered === undefined) return substring
          return typeof registered === 'function' ? String(registered('')) : String(registered)
        })
        const contextValue = macroContext({})
        for (const item of macroLikes) {
          const regex = new RegExp(item.regex.source, item.regex.flags)
          text = text.replace(regex, (substring, ...args) => String(item.replace(contextValue, substring, ...args)))
        }
        return text
      }
      const registerMacro = (key, value) => { namedMacros.set(String(key), value) }
      const unregisterMacro = key => { namedMacros.delete(String(key)) }
      const pathParts = path => {
        if (Array.isArray(path)) return path.map(String)
        const parts = []
        String(path ?? '').replace(/[^.[\]]+|\[(?:(['"])((?:(?!\1)[^\\]|\\.)*?)\1|([^\]]*))\]/g, (match, quote, quoted, bare) => {
          parts.push(String(quote ? quoted.replace(/\\(['"\\])/g, '$1') : bare === undefined ? match : bare.trim()))
          return match
        })
        return parts
      }
      const lodashGet = (object, path, fallback) => {
        let value = object
        for (const key of pathParts(path)) {
          if (value === null || value === undefined || !Object.hasOwn(Object(value), key)) return fallback
          value = value[key]
        }
        return value
      }
      const lodashSet = (object, path, value) => {
        const parts = pathParts(path)
        let target = object
        for (let index = 0; index < parts.length; index += 1) {
          const key = parts[index]
          if (index === parts.length - 1) target[key] = value
          else {
            const nextArray = /^\d+$/.test(parts[index + 1])
            if (target[key] === null || typeof target[key] !== 'object') target[key] = nextArray ? [] : {}
            target = target[key]
          }
        }
        return object
      }
      const lodashUnset = (object, path) => {
        const parts = pathParts(path)
        let target = object
        for (const key of parts.slice(0, -1)) {
          if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) return true
          target = target[key]
        }
        return parts.length === 0 || target === null || typeof target !== 'object' ? true : delete target[parts.at(-1)]
      }
      const lodashMerge = (target, ...sources) => {
        for (const source of sources) {
          if (source === null || typeof source !== 'object') continue
          for (const [key, value] of Object.entries(source)) {
            if (Array.isArray(value)) target[key] = clone(value)
            else if (value !== null && typeof value === 'object') target[key] = lodashMerge(target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {}, value)
            else target[key] = value
          }
        }
        return target
      }
      const lodash = value => {
        let current = value
        const chain = {
          assign(...values) { current = Object.assign(current, ...values); return chain },
          map(fn) { current = Array.from(current || []).map(fn); return chain },
          sortBy(key) { current = Array.from(current || []).sort((left, right) => String(lodashGet(left, key, '')).localeCompare(String(lodashGet(right, key, '')))); return chain },
          values() { current = Object.values(current || {}); return chain },
          reject(fn) { current = Array.from(current || []).filter((item, index) => !fn(item, index)); return chain },
          value() { return current },
        }
        return chain
      }
      Object.assign(lodash, {
        get: lodashGet, set: lodashSet, unset: lodashUnset, has: (object, path) => lodashGet(object, path, Symbol.for('missing')) !== Symbol.for('missing'),
        cloneDeep: clone, merge: lodashMerge, assign: Object.assign, isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
        inRange: (value, start, end) => value >= Math.min(start, end === undefined ? 0 : start) && value < Math.max(start, end === undefined ? start : end),
        times: (count, fn) => Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => fn(index)), constant: value => () => value,
        range: (start, end) => { if (end === undefined) { end = start; start = 0 } return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index) },
        toString: value => value == null ? '' : String(value), random: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
        concat: (...values) => values.flat(), isNull: value => value === null, pick: (object, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object || {}, key)).map(key => [key, object[key]])),
        omitBy: (object, fn) => Object.fromEntries(Object.entries(object || {}).filter(([key, value]) => !fn(value, key))), clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      })
      const jquery = selector => {
        const nodes = selector === undefined || selector === null ? [] : selector === root || selector?.nodeType ? [selector] : Array.isArray(selector) ? selector.filter(Boolean) : Array.from(root.document.querySelectorAll(String(selector)))
        const wrapper = {
          length: nodes.length,
          get: index => nodes[index],
          each(fn) { nodes.forEach((node, index) => fn.call(node, index, node)); return wrapper },
          find(query) { return jquery(nodes.flatMap(node => Array.from(node.querySelectorAll(query)))) },
          val(value) { if (arguments.length === 0) return nodes[0]?.value; nodes.forEach(node => { node.value = value }); return wrapper },
          prop(name, value) { if (arguments.length === 1) return nodes[0]?.[name]; nodes.forEach(node => { node[name] = value }); return wrapper },
          attr(name, value) { if (arguments.length === 1) return nodes[0]?.getAttribute?.(name); nodes.forEach(node => node.setAttribute?.(name, value)); return wrapper },
          text(value) { if (arguments.length === 0) return nodes[0]?.textContent; nodes.forEach(node => { node.textContent = value }); return wrapper },
          html(value) { if (arguments.length === 0) return nodes[0]?.innerHTML; nodes.forEach(node => { node.innerHTML = value }); return wrapper },
          append(value) { nodes.forEach(node => node.insertAdjacentHTML?.('beforeend', String(value))); return wrapper },
          on(name, handler) { nodes.forEach(node => node.addEventListener?.(name, handler)); return wrapper },
          off(name, handler) { nodes.forEach(node => node.removeEventListener?.(name, handler)); return wrapper },
          trigger(name) { nodes.forEach(node => node.dispatchEvent?.(new Event(name, { bubbles: true }))); return wrapper },
          click(handler) { if (handler) return wrapper.on('click', handler); nodes.forEach(node => node.click?.()); return wrapper },
          focus() { nodes[0]?.focus?.(); return wrapper },
          add(other) { return jquery([...nodes, ...(other?.get ? Array.from({ length: other.length }, (_, index) => other.get(index)) : [])]) },
          addClass(name) { nodes.forEach(node => node.classList?.add(...String(name).split(/\s+/))); return wrapper },
          removeClass(name) { nodes.forEach(node => node.classList?.remove(...String(name).split(/\s+/))); return wrapper },
          data(name, value) { if (arguments.length === 1) return nodes[0]?.dataset?.[name]; nodes.forEach(node => { if (node.dataset) node.dataset[name] = value }); return wrapper },
        }
        nodes.forEach((node, index) => { wrapper[index] = node })
        return wrapper
      }
      const toast = level => (message, title) => { console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log'](`[${title || level}] ${String(message ?? '')}`); return null }
      const toastr = Object.freeze({ success: toast('success'), info: toast('info'), warning: toast('warning'), error: toast('error'), clear() {} })
      const POPUP_TYPE = Object.freeze({ TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4, CROP: 5 })
      const POPUP_RESULT = Object.freeze({ AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: -1, CUSTOM1: 2, CUSTOM2: 3, CUSTOM3: 4, CUSTOM4: 5, CUSTOM5: 6, CUSTOM6: 7, CUSTOM7: 8, CUSTOM8: 9, CUSTOM9: 10 })
      const popupText = content => typeof content === 'string' ? content : content?.textContent ?? String(content ?? '')
      const callGenericPopup = async (content, type, inputValue) => type === POPUP_TYPE.CONFIRM ? root.confirm(popupText(content)) : type === POPUP_TYPE.INPUT ? root.prompt(popupText(content), inputValue ?? '') ?? undefined : (root.alert(popupText(content)), POPUP_RESULT.AFFIRMATIVE)
      class Popup {
        constructor(content, type = POPUP_TYPE.TEXT, inputValue = '', options = {}) {
          this.content = content
          this.type = type
          this.inputValue = inputValue
          this.options = options
          this.result = POPUP_RESULT.CANCELLED
          this.value = inputValue
          this.dlg = null
        }
        async show() {
          const value = await callGenericPopup(this.content, this.type, this.inputValue, this.options)
          this.value = value
          this.result = value === false || value === undefined ? POPUP_RESULT.NEGATIVE : value === true ? POPUP_RESULT.AFFIRMATIVE : value
          return value
        }
        complete(result = POPUP_RESULT.AFFIRMATIVE) { this.result = result; return result }
        static showConfirm(header, text) { return callGenericPopup([header, text].filter(Boolean).join('\n'), POPUP_TYPE.CONFIRM) }
        static showInput(header, text, inputValue = '') { return callGenericPopup([header, text].filter(Boolean).join('\n'), POPUP_TYPE.INPUT, inputValue) }
        static showText(header, text) { return callGenericPopup([header, text].filter(Boolean).join('\n'), POPUP_TYPE.TEXT) }
      }
      const copyText = text => {
        if (root.navigator.clipboard?.writeText) return root.navigator.clipboard.writeText(String(text))
        const area = root.document.createElement('textarea'); area.value = String(text); root.document.body.append(area); area.select(); root.document.execCommand('copy'); area.remove()
      }
      const audioState = Object.fromEntries(['bgm', 'ambient'].map(type => [type, { playlist: [], src: '', playing: false, progress: 0, settings: { enabled: true, mode: 'repeat', muted: false, volume: 100 }, element: null }]))
      const audioStore = type => { if (!audioState[type]) throw new TypeError('audio type must be bgm or ambient'); return audioState[type] }
      const audioTitle = url => String(url).split('/').at(-1)?.split('.').at(0) || String(url)
      const playAudio = (type, audio) => {
        const store = audioStore(type); const item = { title: audio?.title || audioTitle(audio?.url), url: String(audio?.url || '') }; const existing = store.playlist.find(entry => entry.title === item.title || entry.url === item.url)
        if (existing) Object.assign(existing, item); else store.playlist.push(item); store.src = item.url; store.progress = 0; store.playing = true
        store.element?.pause?.(); store.element = new root.Audio(item.url); store.element.loop = store.settings.mode === 'repeat'; store.element.muted = store.settings.muted; store.element.volume = store.settings.volume / 100; void store.element.play().catch(() => { store.playing = false })
      }
      const pauseAudio = type => { const store = audioStore(type); store.playing = false; store.element?.pause?.() }
      const getAudioList = type => clone(audioStore(type).playlist)
      const replaceAudioList = (type, list) => { audioStore(type).playlist = (list || []).map(item => ({ title: item.title || audioTitle(item.url), url: String(item.url || '') })) }
      const appendAudioList = (type, list) => { audioStore(type).playlist.push(...(list || []).map(item => ({ title: item.title || audioTitle(item.url), url: String(item.url || '') }))) }
      const getAudioSettings = type => clone(audioStore(type).settings)
      const setAudioSettings = (type, settings) => { const store = audioStore(type); Object.assign(store.settings, clone(settings || {})); store.settings.volume = lodash.clamp(Number(store.settings.volume), 0, 100); if (store.element) { store.element.muted = store.settings.muted; store.element.volume = store.settings.volume / 100 } }
      const getCurrentAudio = type => { const store = audioStore(type); return { src: store.src, title: store.playlist.find(item => item.url === store.src)?.title ?? '', playing: store.playing, progress: store.element?.currentTime ?? store.progress } }
      const extensionSettings = {}
      const context = {
        chat,
        characters,
        groups: [],
        name1: 'User',
        name2: 'Character',
        characterId: null,
        groupId: null,
        chatId: String(snapshot.sessionId || ''),
        chatMetadata,
        extensionSettings,
        eventSource,
        eventTypes: null,
        getCurrentChatId: () => context.chatId,
        substituteParams,
        substituteParamsExtended: substituteParams,
        registerMacro,
        unregisterMacro,
        saveSettingsDebounced: () => worldbookRpc({ action: 'save-extension-settings', settings: clone(extensionSettings), expectedRevision: snapshot.variableRevisions?.workspace }),
        callGenericPopup,
        Popup,
        POPUP_TYPE,
        POPUP_RESULT,
        t: (strings, ...values) => Array.isArray(strings?.raw) ? strings.reduce((text, item, index) => text + item + (values[index] ?? ''), '') : String(strings ?? ''),
        translate: text => String(text ?? ''),
        getCurrentLocale: () => root.navigator.language || 'en',
        isMobile: () => /Android|iPhone|iPad|Mobile/i.test(root.navigator.userAgent),
        uuidv4: () => root.crypto?.randomUUID?.() || `dsh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }
      const syncContext = () => {
        assignArray(chat, snapshot.messages)
        assignArray(characters, snapshot.characterCard ? [snapshot.characterCard] : [])
        assignObject(chatMetadata, snapshot.context?.chatMetadata)
        assignObject(extensionSettings, snapshot.extensionSettings)
        context.name1 = String(snapshot.context?.name1 || snapshot.persona?.name || 'User')
        context.name2 = String(snapshot.context?.name2 || snapshot.character?.nickname || snapshot.character?.name || 'Character')
        context.characterId = snapshot.context?.characterId ?? snapshot.cardRecord?.id ?? null
        context.chatId = String(snapshot.context?.chatId || snapshot.sessionId || '')
      }
      const getState = () => clone(snapshot.state || null)
      const getCharacterCard = () => clone(snapshot.characterCard || null)
      const getCurrentWorldbook = () => clone(snapshot.worldbook || null)
      const unavailable = (name, reason) => () => { throw new CompatibilityUnavailableError(name, reason) }
      const getLastMessageId = () => (snapshot.messages || []).length - 1
      const chatRangeIds = range => {
        const length = (snapshot.messages || []).length
        if (range === undefined) range = '0-{{lastMessageId}}'
        if (typeof range === 'number') {
          if (!Number.isSafeInteger(range)) throw new TypeError('message range must be a safe integer')
          const id = range < 0 ? length + range : range
          return id >= 0 && id < length ? [id] : []
        }
        const expanded = String(range).trim().replaceAll('{{lastMessageId}}', String(length - 1))
        if (/^-?\d+$/.test(expanded)) return chatRangeIds(Number(expanded))
        const match = expanded.match(/^(-?\d+)\s*-\s*(-?\d+)$/)
        if (!match) throw new TypeError(`invalid message range ${range}`)
        const begin = Number(match[1]) < 0 ? length + Number(match[1]) : Number(match[1])
        const end = Number(match[2]) < 0 ? length + Number(match[2]) : Number(match[2])
        if (begin > end) throw new RangeError('message range start must not exceed its end')
        const ids = []
        for (let id = Math.max(0, begin); id <= Math.min(length - 1, end); id += 1) ids.push(id)
        return ids
      }
      const getChatMessages = (range, options = {}) => {
        const role = options.role || 'all'
        const hideState = options.hide_state || 'all'
        if (!['all', 'system', 'assistant', 'user'].includes(role)) throw new TypeError('invalid role filter')
        if (!['all', 'hidden', 'unhidden'].includes(hideState)) throw new TypeError('invalid hide_state filter')
        return chatRangeIds(range).map(id => snapshot.messages[id]).filter(Boolean)
          .filter(item => role === 'all' || item.role === role)
          .filter(item => hideState === 'all' || (hideState === 'hidden') === (item.is_hidden === true))
          .map(item => options.include_swipes === true ? {
            message_id: item.message_id,
            name: String(item.name || (item.role === 'user' ? 'User' : item.role === 'system' ? 'System' : 'Character')),
            role: item.role,
            is_hidden: item.is_hidden === true,
            swipe_id: Number(item.swipe_id || 0),
            swipes: clone(item.swipes || [item.message ?? item.mes ?? item.text ?? '']),
            swipes_data: clone(item.swipes_data || [item.data || {}]),
            swipes_info: clone(item.swipes_info || [item.extra || {}]),
          } : {
            message_id: item.message_id,
            name: String(item.name || (item.role === 'user' ? 'User' : item.role === 'system' ? 'System' : 'Character')),
            role: item.role,
            is_hidden: item.is_hidden === true,
            message: String(item.message ?? item.mes ?? item.text ?? ''),
            data: clone(item.data || {}),
            extra: clone(item.extra || {}),
          })
      }
      const mutateChat = mutation => rpc('mutateChat', { mutation }).then(() => undefined)
      const setChatMessages = async (messages, options = {}) => {
        if (metadata?.scriptId === 'opening-html' && (messages || []).some(item => Number(item?.message_id) === 0 && Number.isSafeInteger(Number(item?.swipe_id)))) {
          const selection = await rpc('setChatMessages', { messages: clone(messages || []) })
          await rpc('commitSwipe', { swipe_id: selection?.swipe_id })
          return
        }
        await mutateChat({ action: 'set', messages: clone(messages || []), options: clone(options) })
      }
      const createChatMessages = (messages, options = {}) => mutateChat({ action: 'create', messages: clone(messages || []), options: clone(options) })
      const deleteChatMessages = (messageIds, options = {}) => mutateChat({ action: 'delete', messageIds: clone(messageIds || []), options: clone(options) })
      const rotateChatMessages = (begin, middle, end, options = {}) => mutateChat({ action: 'rotate', begin, middle, end, options: clone(options) })
      const refreshOneMessage = async messageId => { await dispatch((snapshot.messages || [])[messageId]?.role === 'user' ? 'user_message_rendered' : 'character_message_rendered', [messageId, 'normal']) }
      const triggerSlash = command => rpc('triggerSlash', { command: String(command ?? '') })
      const worldbookRevisions = new Map()
      const worldbookRpc = request => rpc('worldbook', { request })
      const getWorldbookNames = () => clone(snapshot.worldbookNames || [])
      const getWorldbookSnapshot = async name => {
        const value = await worldbookRpc({ action: 'get', name: String(name) })
        worldbookRevisions.set(String(name), Number(value.revision || 0))
        return value
      }
      const getWorldbook = async name => clone((await getWorldbookSnapshot(name)).worldbook || [])
      const createWorldbook = (name, entries = []) => worldbookRpc({ action: 'create', name: String(name), entries: clone(entries) })
      const createOrReplaceWorldbook = async (name, entries = [], options = {}) => {
        const key = String(name)
        const value = await worldbookRpc({ action: 'create-or-replace', name: key, entries: clone(entries), expectedRevision: worldbookRevisions.get(key), options: clone(options) })
        worldbookRevisions.delete(key)
        return value
      }
      const replaceWorldbook = async (name, entries, options = {}) => {
        const key = String(name)
        const value = await worldbookRpc({ action: 'replace', name: key, entries: clone(entries), expectedRevision: worldbookRevisions.get(key), options: clone(options) })
        worldbookRevisions.set(key, Number(value.revision || 0))
      }
      const updateWorldbookWith = async (name, updater, options = {}) => {
        if (typeof updater !== 'function') throw new TypeError('updateWorldbookWith expects an updater function')
        const current = await getWorldbook(name)
        const next = await updater(clone(current))
        await replaceWorldbook(name, next, options)
        return getWorldbook(name)
      }
      const createWorldbookEntries = async (name, entries, options = {}) => {
        const key = String(name)
        if (!worldbookRevisions.has(key)) await getWorldbookSnapshot(key)
        const value = await worldbookRpc({ action: 'create-entries', name: key, entries: clone(entries), expectedRevision: worldbookRevisions.get(key), options: clone(options) })
        worldbookRevisions.set(key, Number(value.revision || 0))
        return clone({ worldbook: value.worldbook, new_entries: value.new_entries })
      }
      const deleteWorldbookEntries = async (name, predicate, options = {}) => {
        if (typeof predicate !== 'function') throw new TypeError('deleteWorldbookEntries expects a predicate function')
        const key = String(name)
        const current = await getWorldbookSnapshot(key)
        const deleted = current.worldbook.filter(predicate)
        const value = await worldbookRpc({ action: 'delete-entries', name: key, uids: deleted.map(item => item.uid), expectedRevision: current.revision, options: clone(options) })
        worldbookRevisions.set(key, Number(value.revision || 0))
        return clone({ worldbook: value.worldbook, deleted_entries: value.deleted_entries })
      }
      const deleteWorldbook = async name => {
        const key = String(name)
        const value = await worldbookRpc({ action: 'delete', name: key, expectedRevision: worldbookRevisions.get(key) })
        worldbookRevisions.delete(key)
        return value
      }
      const getGlobalWorldbookNames = () => clone(snapshot.globalWorldbooks || snapshot.lorebookSettings?.selected_global_lorebooks || [])
      const rebindGlobalWorldbooks = names => worldbookRpc({ action: 'rebind-global', names: clone(names || []), expectedRevision: snapshot.variableRevisions?.workspace })
      const getCharWorldbookNames = name => {
        if (name !== undefined && name !== 'current' && name !== snapshot.character?.name && name !== snapshot.character?.nickname) throw new Error(`character '${String(name)}' is unavailable in the current DSH session`)
        return clone(snapshot.characterWorldbooks?.[String(snapshot.cardRecord?.id || '')] || { primary: null, additional: [] })
      }
      const rebindCharWorldbooks = (name, worldbooks) => {
        if (name !== 'current') throw new Error('only the current character can be rebound')
        return worldbookRpc({ action: 'rebind-character', worldbooks: clone(worldbooks || {}), expectedRevision: snapshot.variableRevisions?.workspace })
      }
      const getChatWorldbookName = name => {
        if (name !== 'current') throw new Error('only the current chat is available')
        return snapshot.state?.binding?.worldbookExplicit === true ? snapshot.chatWorldbookName : null
      }
      const rebindChatWorldbook = (name, worldbookName) => {
        if (name !== 'current') throw new Error('only the current chat is available')
        return worldbookRpc({ action: 'rebind-chat', name: worldbookName, bindingRevision: snapshot.bindingRevision })
      }
      const getOrCreateChatWorldbook = (name, worldbookName) => {
        if (name !== 'current') throw new Error('only the current chat is available')
        return worldbookRpc({ action: 'get-or-create-chat', name: worldbookName })
      }
      const getLorebookSettings = () => clone(snapshot.lorebookSettings || {})
      const setLorebookSettings = settings => {
        snapshot.lorebookSettings = { ...(snapshot.lorebookSettings || {}), ...clone(settings || {}) }
        syncContext()
        void worldbookRpc({ action: 'set-lorebook-settings', settings: clone(settings || {}), expectedRevision: snapshot.variableRevisions?.workspace }).catch(reportWriteError)
      }
      const regexSources = () => ({
        global: clone(snapshot.state?.globalRegexScripts || []),
        preset: clone(snapshot.state?.presetRegexScripts || []),
        character: clone((snapshot.cardRecord?.scripts || []).filter(script => script?.kind === 'regex')),
      })
      const toTavernRegex = (script, scope) => ({
        id: String(script?.id || ''),
        script_name: String(script?.name ?? script?.scriptName ?? ''),
        enabled: script?.enabled === true && script?.disabled !== true,
        find_regex: String(script?.findRegex ?? ''),
        trim_strings: clone(Array.isArray(script?.trimStrings) ? script.trimStrings : []),
        replace_string: String(script?.source ?? script?.replaceString ?? ''),
        source: {
          user_input: script?.placement?.includes(1) === true,
          ai_output: script?.placement?.includes(2) === true,
          slash_command: script?.placement?.includes(3) === true,
          world_info: script?.placement?.includes(5) === true,
          reasoning: script?.placement?.includes(6) === true,
        },
        destination: { display: script?.markdownOnly === true, prompt: script?.promptOnly === true },
        run_on_edit: script?.runOnEdit === true,
        min_depth: Number.isFinite(script?.minDepth) ? Number(script.minDepth) : null,
        max_depth: Number.isFinite(script?.maxDepth) ? Number(script.maxDepth) : null,
        ...(scope === undefined ? {} : { scope }),
      })
      const fromTavernRegex = (regex, index) => {
        if (regex === null || typeof regex !== 'object' || Array.isArray(regex)) throw new TypeError(`regexes[${index}] must be an object`)
        const source = regex.source || {}
        const destination = regex.destination || {}
        return {
          id: String(regex.id || `regex-${Date.now()}-${index}`),
          name: String(regex.script_name || `未命名-${regex.id || index}`),
          kind: 'regex',
          enabled: regex.enabled !== false,
          source: String(regex.replace_string ?? ''),
          findRegex: String(regex.find_regex ?? ''),
          trimStrings: clone(Array.isArray(regex.trim_strings) ? regex.trim_strings : []),
          placement: [source.user_input ? 1 : null, source.ai_output ? 2 : null, source.slash_command ? 3 : null, source.world_info ? 5 : null, source.reasoning ? 6 : null].filter(Number.isSafeInteger),
          markdownOnly: destination.display === true,
          promptOnly: destination.prompt === true,
          runOnEdit: regex.run_on_edit === true,
          substituteRegex: 0,
          minDepth: Number.isFinite(regex.min_depth) ? Number(regex.min_depth) : null,
          maxDepth: Number.isFinite(regex.max_depth) ? Number(regex.max_depth) : null,
        }
      }
      const assertCurrentCharacter = name => {
        if (name === undefined || name === 'current' || name === snapshot.character?.name || name === snapshot.character?.nickname) return
        throw new Error(`character '${String(name)}' is unavailable in the current DSH session`)
      }
      const assertCurrentPreset = name => {
        if (name === undefined || name === 'in_use') return
        throw new Error(`preset '${String(name)}' is unavailable in the current DSH session`)
      }
      const getTavernRegexes = option => {
        const sources = regexSources()
        if (option?.type === undefined) {
          const scope = option?.scope || 'all'
          const enableState = option?.enable_state || 'all'
          if (!['all', 'global', 'character'].includes(scope)) throw new Error(`invalid regex scope '${scope}'`)
          if (!['all', 'enabled', 'disabled'].includes(enableState)) throw new Error(`invalid regex enable_state '${enableState}'`)
          let values = [
            ...(scope === 'all' || scope === 'global' ? sources.global.map(script => toTavernRegex(script, 'global')) : []),
            ...(scope === 'all' || scope === 'character' ? sources.character.map(script => toTavernRegex(script, 'character')) : []),
          ]
          if (enableState !== 'all') values = values.filter(regex => regex.enabled === (enableState === 'enabled'))
          return values
        }
        if (option.type === 'global') return sources.global.map(script => toTavernRegex(script))
        if (option.type === 'preset') { assertCurrentPreset(option.name); return sources.preset.map(script => toTavernRegex(script)) }
        if (option.type === 'character') { assertCurrentCharacter(option.name); return sources.character.map(script => toTavernRegex(script)) }
        throw new TypeError(`unknown regex source '${String(option.type)}'`)
      }
      const replaceTavernRegexes = async (regexes, option) => {
        if (!Array.isArray(regexes)) throw new TypeError('replaceTavernRegexes expects an array')
        for (const regex of regexes) if (regex && regex.script_name === '') regex.script_name = `未命名-${regex.id}`
        const changes = {}
        if (option?.type === undefined) {
          const scope = option?.scope || 'all'
          if (!['all', 'global', 'character'].includes(scope)) throw new Error(`invalid regex scope '${scope}'`)
          if (scope === 'all' || scope === 'global') changes.global = regexes.filter(regex => regex?.scope === 'global').map(fromTavernRegex)
          if (scope === 'all' || scope === 'character') changes.character = regexes.filter(regex => regex?.scope !== 'global').map(fromTavernRegex)
        } else if (option.type === 'global') changes.global = regexes.map(fromTavernRegex)
        else if (option.type === 'preset') { assertCurrentPreset(option.name); changes.preset = regexes.map(fromTavernRegex) }
        else if (option.type === 'character') { assertCurrentCharacter(option.name); changes.character = regexes.map(fromTavernRegex) }
        else throw new TypeError(`unknown regex source '${String(option.type)}'`)
        if (Object.hasOwn(changes, 'global')) { snapshot.state ||= {}; snapshot.state.globalRegexScripts = clone(changes.global) }
        if (Object.hasOwn(changes, 'preset')) { snapshot.state ||= {}; snapshot.state.presetRegexScripts = clone(changes.preset) }
        if (Object.hasOwn(changes, 'character') && snapshot.cardRecord) {
          let index = 0
          snapshot.cardRecord.scripts = (snapshot.cardRecord.scripts || []).flatMap(script => script?.kind === 'regex' ? index < changes.character.length ? [changes.character[index++]] : [] : [script])
          snapshot.cardRecord.scripts.push(...changes.character.slice(index))
        }
        await rpc('replaceRegexes', { changes })
      }
      const updateTavernRegexesWith = async (updater, option) => {
        if (typeof updater !== 'function') throw new TypeError('updateTavernRegexesWith expects an updater function')
        const regexes = await updater(getTavernRegexes(option))
        await replaceTavernRegexes(regexes, option)
        return regexes
      }
      const regexFromString = value => {
        const text = String(value ?? '')
        if (!text.startsWith('/')) return null
        let end = text.length - 1
        while (end > 0 && /[dgimsuvy]/.test(text[end])) end -= 1
        if (text[end] !== '/') return null
        return new RegExp(text.slice(1, end), text.slice(end + 1))
      }
      const escapeRegexMacro = value => String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, character => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\f': '\\f', '\0': '\\0' })[character] || `\\${character}`)
      const formatAsTavernRegexedString = (input, source, destination, options = {}) => {
        const placement = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }[source]
        if (placement === undefined) throw new TypeError(`unknown regex source '${String(source)}'`)
        if (!['display', 'prompt'].includes(destination)) throw new TypeError(`unknown regex destination '${String(destination)}'`)
        const original = String(input ?? '')
        let text = original
        for (const script of [...regexSources().global, ...regexSources().preset, ...regexSources().character]) {
          if (script?.enabled !== true || script?.disabled === true || !script?.placement?.includes(placement)) continue
          if (destination === 'display' ? script.markdownOnly !== true : script.promptOnly !== true) continue
          const depth = options.depth
          if (Number.isFinite(depth) && Number.isFinite(script.minDepth) && script.minDepth >= -1 && depth < script.minDepth) continue
          if (Number.isFinite(depth) && Number.isFinite(script.maxDepth) && script.maxDepth >= 0 && depth > script.maxDepth) continue
          let pattern = String(script.findRegex ?? '')
          if (Number(script.substituteRegex) === 1) pattern = substituteParams(pattern, undefined, options.character_name)
          else if (Number(script.substituteRegex) === 2) pattern = pattern.replace(/{{\s*([^{}]+?)\s*}}/g, token => escapeRegexMacro(substituteParams(token, undefined, options.character_name)))
          const matcher = regexFromString(pattern)
          if (!matcher || text === '') continue
          const replacement = String(script.source ?? script.replaceString ?? '').replace(/{{match}}/gi, '$0')
          text = text.replace(matcher, function () {
            const args = [...arguments]
            return substituteParams(replacement.replace(/\$(\d+)|\$<([^>]+)>/g, (_token, number, groupName) => {
              const groups = args.at(-1)
              const value = number ? args[Number(number)] : groups && typeof groups === 'object' ? groups[groupName] : undefined
              if (!value) return ''
              let trimmed = String(value)
              for (const rawTrim of script.trimStrings || []) trimmed = trimmed.replaceAll(substituteParams(rawTrim, undefined, options.character_name), '')
              return trimmed
            }), undefined, options.character_name)
          })
        }
        return substituteParams(text, undefined, options.character_name)
      }
      const isCharacterTavernRegexesEnabled = () => snapshot.cardRecord !== null && snapshot.cardRecord !== undefined
      const getCompatibility = () => clone(snapshot.compatibility || {})
      const dsh = Object.freeze({ getState, getCharacterCard, getCurrentWorldbook, event: operation => rpc('event', { operation }), flushWrites: () => rpc('flushWrites') })
      const helper = {
        compatibility: deepFreeze(clone(snapshot.compatibility || {})),
        getCompatibility,
        getTavernHelperVersion: () => '4.9.4',
        getScriptId: () => metadata?.scriptId || channel,
        getVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables, insertVariables, deleteVariable, getAllVariables,
        injectPrompts, uninjectPrompts,
        eventOn, eventMakeFirst, eventMakeLast, eventOnce, eventEmit, eventEmitAndWait, eventRemoveListener, eventClearEvent, eventClearListener, eventClearAll,
        getChatMessages, getLastMessageId, setChatMessages, createChatMessages, deleteChatMessages, rotateChatMessages, refreshOneMessage, triggerSlash, triggerSlashWithResult: triggerSlash,
        getWorldbookNames, getGlobalWorldbookNames, rebindGlobalWorldbooks, getCharWorldbookNames, rebindCharWorldbooks, getChatWorldbookName, rebindChatWorldbook, getOrCreateChatWorldbook,
        getWorldbook, createWorldbook, createOrReplaceWorldbook, deleteWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries,
        getLorebookSettings, setLorebookSettings, getLorebooks: getWorldbookNames, getLorebook: getWorldbook, createLorebook: name => createWorldbook(name), deleteLorebook: deleteWorldbook,
        registerMacroLike, unregisterMacroLike, formatAsTavernRegexedString, getTavernRegexes, replaceTavernRegexes, updateTavernRegexesWith, isCharacterTavernRegexesEnabled,
        playAudio, pauseAudio, getAudioList, replaceAudioList, appendAudioList, getAudioSettings, setAudioSettings, getCurrentAudio,
        copyText, callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT,
        generate, generateRaw, stopGenerationById, stopAllGeneration, getModelList, getProxyPresetNames: unavailable('getProxyPresetNames', 'DSH proxy presets are not implemented'),
        getState, getCharacterCard,
        setVariables: variables => { replaceVariables(variables); return dsh.flushWrites() },
        event: dsh.event,
        dsh,
      }
      for (const name of ['executeSlashCommands', 'importRawCharacter', 'registerGlobalMacro']) helper[name] = unavailable(name, 'not implemented by the compatibility runtime')
      const tavernEvents = Object.freeze({
        APP_READY: 'app_ready', EXTRAS_CONNECTED: 'extras_connected', MESSAGE_SWIPED: 'message_swiped', MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_DELETED: 'message_deleted', MESSAGE_UPDATED: 'message_updated', MESSAGE_FILE_EMBEDDED: 'message_file_embedded', MESSAGE_REASONING_EDITED: 'message_reasoning_edited', MESSAGE_REASONING_DELETED: 'message_reasoning_deleted', MESSAGE_SWIPE_DELETED: 'message_swipe_deleted', MORE_MESSAGES_LOADED: 'more_messages_loaded', IMPERSONATE_READY: 'impersonate_ready', CHAT_CHANGED: 'chat_id_changed', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS', GENERATION_STARTED: 'generation_started', GENERATION_STOPPED: 'generation_stopped', GENERATION_ENDED: 'generation_ended', SD_PROMPT_PROCESSING: 'sd_prompt_processing', EXTENSIONS_FIRST_LOAD: 'extensions_first_load', EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded', SETTINGS_LOADED: 'settings_loaded', SETTINGS_UPDATED: 'settings_updated', MOVABLE_PANELS_RESET: 'movable_panels_reset', SETTINGS_LOADED_BEFORE: 'settings_loaded_before', SETTINGS_LOADED_AFTER: 'settings_loaded_after', CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed', CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed', OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before', OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after', OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready', OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready', WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated', WORLDINFO_UPDATED: 'worldinfo_updated', CHARACTER_EDITOR_OPENED: 'character_editor_opened', CHARACTER_EDITED: 'character_edited', CHARACTER_PAGE_LOADED: 'character_page_loaded', USER_MESSAGE_RENDERED: 'user_message_rendered', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', FORCE_SET_BACKGROUND: 'force_set_background', CHAT_DELETED: 'chat_deleted', CHAT_CREATED: 'chat_created', GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts', GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts', GENERATE_AFTER_DATA: 'generate_after_data', WORLD_INFO_ACTIVATED: 'world_info_activated', TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready', CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected', CHARACTER_DELETED: 'characterDeleted', CHARACTER_DUPLICATED: 'character_duplicated', CHARACTER_RENAMED: 'character_renamed', CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat', SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received', STREAM_TOKEN_RECEIVED: 'stream_token_received', STREAM_REASONING_DONE: 'stream_reasoning_done', FILE_ATTACHMENT_DELETED: 'file_attachment_deleted', WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate', OPEN_CHARACTER_LIBRARY: 'open_character_library', ONLINE_STATUS_CHANGED: 'online_status_changed', IMAGE_SWIPED: 'image_swiped', CONNECTION_PROFILE_LOADED: 'connection_profile_loaded', CONNECTION_PROFILE_CREATED: 'connection_profile_created', CONNECTION_PROFILE_DELETED: 'connection_profile_deleted', CONNECTION_PROFILE_UPDATED: 'connection_profile_updated', TOOL_CALLS_PERFORMED: 'tool_calls_performed', TOOL_CALLS_RENDERED: 'tool_calls_rendered', CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown', SECRET_WRITTEN: 'secret_written', SECRET_DELETED: 'secret_deleted', SECRET_ROTATED: 'secret_rotated', SECRET_EDITED: 'secret_edited', PRESET_CHANGED: 'preset_changed', PRESET_DELETED: 'preset_deleted', PRESET_RENAMED: 'preset_renamed', PRESET_RENAMED_BEFORE: 'preset_renamed_before', MAIN_API_CHANGED: 'main_api_changed', WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', WORLDINFO_SCAN_DONE: 'worldinfo_scan_done', MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
      })
      const iframeEvents = Object.freeze({
        MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started', MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended', GENERATION_STARTED: 'js_generation_started', STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully', STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally', GENERATION_ENDED: 'js_generation_ended',
      })
      context.eventTypes = tavernEvents
      const sillyTavern = context
      sillyTavern.getContext = () => sillyTavern
      syncContext()
      root.TavernHelper = helper
      root.SillyTavern = sillyTavern
      root.tavern_events = tavernEvents
      root.event_types = tavernEvents
      root.iframe_events = iframeEvents
      root.eventSource = eventSource
      root._ = lodash
      root.$ = root.jQuery = jquery
      root.toastr = toastr
      root.copyText = copyText
      root.substituteParams = root.substituteParamsExtended = substituteParams
      root.extension_settings = extensionSettings
      for (const name of ['getVariables', 'replaceVariables', 'updateVariablesWith', 'insertOrAssignVariables', 'insertVariables', 'deleteVariable', 'getAllVariables', 'setVariables', 'injectPrompts', 'uninjectPrompts', 'eventOn', 'eventMakeFirst', 'eventMakeLast', 'eventOnce', 'eventEmit', 'eventEmitAndWait', 'eventRemoveListener', 'eventClearEvent', 'eventClearListener', 'eventClearAll', 'getChatMessages', 'getLastMessageId', 'setChatMessages', 'createChatMessages', 'deleteChatMessages', 'rotateChatMessages', 'refreshOneMessage', 'triggerSlash', 'triggerSlashWithResult', 'generate', 'generateRaw', 'stopGenerationById', 'stopAllGeneration', 'getModelList', 'getProxyPresetNames', 'getWorldbookNames', 'getGlobalWorldbookNames', 'rebindGlobalWorldbooks', 'getCharWorldbookNames', 'rebindCharWorldbooks', 'getChatWorldbookName', 'rebindChatWorldbook', 'getOrCreateChatWorldbook', 'getWorldbook', 'createWorldbook', 'createOrReplaceWorldbook', 'deleteWorldbook', 'replaceWorldbook', 'updateWorldbookWith', 'createWorldbookEntries', 'deleteWorldbookEntries', 'getLorebookSettings', 'setLorebookSettings', 'getLorebooks', 'getLorebook', 'createLorebook', 'deleteLorebook', 'registerMacroLike', 'unregisterMacroLike', 'formatAsTavernRegexedString', 'getTavernRegexes', 'replaceTavernRegexes', 'updateTavernRegexesWith', 'isCharacterTavernRegexesEnabled', 'playAudio', 'pauseAudio', 'getAudioList', 'replaceAudioList', 'appendAudioList', 'getAudioSettings', 'setAudioSettings', 'getCurrentAudio', 'copyText', 'callGenericPopup']) root[name] = helper[name]
      root.Popup = Popup
      root.POPUP_TYPE = POPUP_TYPE
      root.POPUP_RESULT = POPUP_RESULT
      let composerDraft = ''
      let composerRestore = []
      let composerQueue = Promise.resolve()
      const readComposerDraft = () => [...composerRestore, composerDraft].filter(value => value.trim() !== '').join('\n')
      Object.defineProperty(root, '__dshComposerInput', { configurable: true, value: Object.freeze({
        get value() { return readComposerDraft() },
        set value(value) { composerRestore = []; composerDraft = String(value ?? '') },
        dispatchEvent() {
          const text = readComposerDraft().trim()
          if (text === '') return true
          composerDraft = ''; composerRestore = []
          composerQueue = composerQueue.then(() => rpc('appendInput', { text })).catch(error => { composerRestore.push(text); console.error('SillyTavern composer bridge failed:', error) })
          return true
        },
        focus() { return true },
        click() { return this.dispatchEvent() },
      }) })
      Object.defineProperty(root, '__dshComposerSend', { configurable: true, value: Object.freeze({ click: () => root.__dshComposerInput.dispatchEvent(), dispatchEvent: () => root.__dshComposerInput.dispatchEvent(), focus: () => true }) })
      Object.defineProperty(root, '__dshComposerJquery', { configurable: true, value: selector => {
        const target = selector === '#send_but' ? root.__dshComposerSend : root.__dshComposerInput
        const wrapper = {
          0: target,
          length: 1,
          val(value) { if (arguments.length === 0) return root.__dshComposerInput.value; root.__dshComposerInput.value = value; return wrapper },
          trigger() { target.dispatchEvent(); return wrapper },
          click() { target.click(); return wrapper },
          focus() { target.focus(); return wrapper },
        }
        return wrapper
      } })
      root.addEventListener('message', event => {
        const message = event.data
        if (event.source !== root.parent || !message || message.__dshSillyTavern !== true || message.channel !== channel) return
        if (message.event === 'compat-call') {
          const request = message.payload || {}
          void (async () => {
            let result, error
            try {
              if (request.kind === 'barrier') result = await rpc('flushWrites')
              else if (request.kind === 'filters') {
                const eligibleInjectionIds = []
                for (const item of snapshot.scriptInjections || []) {
                  if (item.ownerFrameId !== channel || item.hasFilter !== true) continue
                  const filter = injectionFilters.get(String(item.id))
                  if (typeof filter !== 'function') throw new Error(`injection filter ${item.id} is no longer registered`)
                  if (await filter()) eligibleInjectionIds.push(String(item.id))
                }
                result = { eligibleInjectionIds }
              } else if (request.kind === 'macros') {
                result = { texts: request.texts.map(input => {
                  let text = String(input)
                  for (const item of macroLikes) text = text.replace(new RegExp(item.regex.source, item.regex.flags), (substring, ...args) => String(item.replace(macroContext({}), substring, ...args)))
                  return text
                }) }
              } else throw new Error(`unknown script callback ${request.kind}`)
            } catch (failure) { error = failure?.message || String(failure) }
            root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'compat-call-result', payload: { id: request.id, result, error } }, '*')
          })()
          return
        }
        if (message.replyTo) {
          const item = pending.get(message.replyTo)
          if (!item) return
          pending.delete(message.replyTo)
          root.clearTimeout(item.timer)
          message.ok ? item.resolve(message.value) : item.reject(Object.assign(new Error(message.error || 'RPC failed'), { code: message.code }))
          return
        }
        if (message.event === 'compat-state') {
          const next = message.payload
          if (!next || Number(next.runtimeRevision) <= Number(snapshot.runtimeRevision || 0)) return
          snapshot = clone(next)
          syncContext()
          return
        }
        if (message.event === 'compat-event') {
          const name = String(message.payload?.name ?? '')
          const args = Array.isArray(message.payload?.args) ? message.payload.args : []
          if (name !== '') void dispatch(name, args).catch(error => console.error('[dsh-sillytavern] event listener failed', error))
        }
      })
      root.addEventListener('pagehide', () => {
        if (ownedInjectionIds.size > 0) {
          try { root.parent.postMessage({ __dshSillyTavern: true, channel, id: ++seq, action: 'uninjectPrompts', args: { ids: [...ownedInjectionIds] } }, '*') } catch {}
        }
        if (activeGenerations.size > 0) {
          for (const generationId of activeGenerations) try { root.parent.postMessage({ __dshSillyTavern: true, channel, id: ++seq, action: 'stopGeneration', args: { generationId } }, '*') } catch {}
        }
        injectionFilters.clear(); ownedInjectionIds.clear(); activeGenerations.clear()
        disposed = true
        listeners.clear()
        for (const item of pending.values()) { root.clearTimeout(item.timer); item.reject(new Error('SillyTavern frame was disposed')) }
        pending.clear()
      }, { once: true })
      root.__dshTavernReady = () => {
        if (disposed || root.__dshTavernDidReady) return
        root.__dshTavernDidReady = true
        if (metadata?.surface === 'message') void dispatch('message_iframe_render_ended', [String(metadata.scriptId || channel)]).catch(error => console.error(error))
        void dispatch(tavernEvents.APP_READY, []).catch(error => console.error('[dsh-sillytavern] APP_READY listener failed', error))
        root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'frame-ready' }, '*')
      }
      return { dispatch, getSnapshot: () => clone(snapshot) }
    }

    function inlineJson(value) {
      return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    }

    function compatibilityBootstrap(channel, initialSnapshot, metadata) {
      return `<script>(${installCompatibilityRuntime.toString()})(window,${inlineJson(initialSnapshot)},${JSON.stringify(channel)},${inlineJson(metadata)})<\/script>`
    }

    function trustedDocument(script, channel, initialSnapshot, metadata) {
      script = executableScript(script)
      const bootstrap = compatibilityBootstrap(channel, initialSnapshot, { ...metadata, scriptId: script.id })
      // Include the body's document-space bottom margin independently of the
      // current iframe viewport. Otherwise scrollbar removal drops that margin
      // from rootScroll and starts a shrink/grow loop. Keep the overflow gate
      // so a collapsed document can still shrink below its previous viewport;
      // an empty body must not grow just to accommodate its default margins.
      const sizing = `<script>(()=>{const bridgeChannel=${JSON.stringify(channel)};let frame=0,last=-1,observer;const report=message=>parent.postMessage({__dshSillyTavern:true,channel:bridgeChannel,event:'frame-error',payload:{message:String(message||'Script error')}},'*');addEventListener('error',event=>report(event.error?.stack||event.message));addEventListener('unhandledrejection',event=>report(event.reason?.stack||event.reason));const measure=()=>{frame=0;const root=document.documentElement,body=document.body;const viewport=Math.ceil(root?.clientHeight||0);const rootScroll=Math.ceil(root?.scrollHeight||0);const scrollY=window.scrollY||0;const bodyRect=body?.getBoundingClientRect();const bodyHeight=Math.max(body?.scrollHeight||0,body?.offsetHeight||0,bodyRect?.height||0);const bodyBottom=bodyHeight>0?(bodyRect?.top||0)+scrollY+bodyHeight+(parseFloat(getComputedStyle(body).marginBottom)||0):0;const childBottom=body?[...body.children].reduce((height,node)=>{const rect=node.getBoundingClientRect?.();return rect&&(rect.width>0||rect.height>0)?Math.max(height,Math.ceil(rect.bottom+scrollY)):height},0):0;const height=Math.ceil(Math.max(bodyHeight,bodyBottom,childBottom,(bodyHeight>0||childBottom>0)&&rootScroll>viewport?rootScroll:0));if(Number.isFinite(height)&&height>=0&&height!==last){last=height;parent.postMessage({__dshSillyTavern:true,channel:bridgeChannel,event:'frame-resize',payload:{height}},'*')}};const schedule=()=>{if(frame===0)frame=requestAnimationFrame(measure)};const observeDocument=()=>{if(observer){observer.observe(document.documentElement);if(document.body)observer.observe(document.body)}measure()};addEventListener('load',measure,{once:true});if(document.readyState==='loading')addEventListener('DOMContentLoaded',observeDocument,{once:true});else observeDocument();document.fonts?.ready?.then(schedule,()=>{});if(typeof ResizeObserver==='function')observer=new ResizeObserver(schedule)})()<\/script>`
      const ready = `<script>window.__dshTavernReady?.()<\/script>`
      if (script.kind === 'html') {
        const source = compatibleHtmlSource(script.source)
        if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(source)) {
          const withBootstrap = /<head[\s>]/i.test(source)
            ? source.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}${sizing}`)
            : source.replace(/<html([^>]*)>/i, `<html$1><head>${bootstrap}${sizing}</head>`)
          if (/<\/body>/i.test(withBootstrap)) return withBootstrap.replace(/<\/body>/i, `${ready}</body>`)
          if (/<\/html>/i.test(withBootstrap)) return withBootstrap.replace(/<\/html>/i, `${ready}</html>`)
          return `${withBootstrap}${ready}`
        }
        return `<!doctype html><html><head>${bootstrap}${sizing}</head><body>${source}${ready}</body></html>`
      }
      const encoded = btoa(unescape(encodeURIComponent(String(script.source))))
      const runner = `<script>(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const source=new TextDecoder().decode(bytes);const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));try{await import(url)}catch(error){document.body.innerHTML='<pre style="color:#b91c1c;white-space:pre-wrap"></pre>';document.querySelector('pre').textContent=error.stack||String(error);parent.postMessage({__dshSillyTavern:true,channel:${JSON.stringify(channel)},event:'frame-error',payload:{message:error.stack||String(error)}},'*')}finally{URL.revokeObjectURL(url);window.__dshTavernReady?.()}})()<\/script>`
      return `<!doctype html><html><head><meta charset="utf-8">${bootstrap}${sizing}<style>body{font:14px/1.5 system-ui;margin:12px;color:#172033}pre{white-space:pre-wrap}</style></head><body><div id="app"></div>${runner}</body></html>`
    }

    function mergeSessionEventState(previous, value) {
      const bySeq = new Map([...(previous?.history || []), ...(value.history || [])].map(message => [message.seq, message]))
      const history = [...bySeq.values()].sort((left, right) => left.seq - right.seq).slice(-100)
      return {
        card: value.card,
        history,
        messages: Array.isArray(value.messages) ? value.messages : previous?.messages,
        cursor: Number.isSafeInteger(value.cursor) ? value.cursor : previous?.cursor,
        compatChatRevision: Number.isSafeInteger(value.compatChatRevision) ? value.compatChatRevision : previous?.compatChatRevision,
        unavailable: false,
      }
    }

    function useSessionEventState(sessionId) {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        const controller = new AbortController()
        let running = false
        let after = -1
        const poll = async () => {
          if (running || controller.signal.aborted) return
          running = true
          let catchUp = false
          try {
            const previousCursor = after
            const value = await api(`/event-state?sessionId=${encodeURIComponent(sessionId)}&after=${after}`, { signal: controller.signal })
            if (Number.isSafeInteger(value.cursor) && value.cursor > after) after = value.cursor
            catchUp = value.hasMore === true && after > previousCursor
            if (!controller.signal.aborted) setState(previous => mergeSessionEventState(previous, value))
          } catch {
            if (!controller.signal.aborted) setState(previous => ({ ...(previous || { card: null, history: [] }), unavailable: true }))
          } finally {
            running = false
            if (catchUp && !controller.signal.aborted) void poll()
          }
        }
        void poll()
        const interval = window.setInterval(() => { void poll() }, 1500)
        return () => { controller.abort(); window.clearInterval(interval) }
      }, [sessionId])
      return state
    }

    function TrustedFrame({ sessionId, script, eventState, className = 'dst-trusted-frame', title, actions, hidden = false, initialSnapshotOverride = null }) {
      const [attempt, setAttempt] = React.useState(0)
      const channel = React.useMemo(() => `dst-${sessionId}-${script.id}-${Math.random().toString(36).slice(2)}`, [sessionId, script.id, script.source, attempt])
      const frame = React.useRef(null)
      const snapshot = useCompatSnapshot(sessionId)
      const surface = script.id === 'opening-html' ? 'opening' : script.id.startsWith('conversation-') ? 'message' : hidden ? 'background' : 'preview'
      const parsedSourceSeq = surface === 'message' ? Number(script.id.match(/^conversation-(\d+)-/)?.[1]) : null
      const sourceSeq = Number.isSafeInteger(script.sourceSeq) ? script.sourceSeq : parsedSourceSeq
      const currentMessageId = Number.isSafeInteger(sourceSeq) ? (snapshot?.messages || []).findIndex(message => message.sourceSeq === sourceSeq || message.event_seq === sourceSeq) : null
      const messageReady = surface !== 'message' || !Number.isSafeInteger(sourceSeq) || currentMessageId >= 0
      const boot = React.useRef({ channel: null, source: null, snapshot: null, currentMessageId: null })
      if (boot.current.channel !== channel || boot.current.source !== script.source) boot.current = { channel, source: script.source, snapshot: null, currentMessageId: null }
      if (boot.current.snapshot === null && messageReady && (snapshot !== null || initialSnapshotOverride !== null)) {
        boot.current = { channel, source: script.source, snapshot: structuredClone(snapshot ?? initialSnapshotOverride), currentMessageId }
      }
      const [height, setHeight] = React.useState(null)
      const [armedChannel, setArmedChannel] = React.useState(null)
      const [renderState, setRenderState] = React.useState({ status: 'loading', error: null })
      const actionsRef = React.useRef(actions)
      actionsRef.current = actions
      const runtimeReady = boot.current.snapshot !== null
      React.useLayoutEffect(() => {
        setRenderState({ status: 'loading', error: null })
        if (!runtimeReady) { setArmedChannel(null); return undefined }
        setHeight(null)
        const unregister = compatRuntime.register({
          channel,
          sessionId: sessionId ?? '__standalone__',
          scriptId: script.id,
          getWindow: () => frame.current?.contentWindow,
          get actions() { return actionsRef.current },
          onResize: next => setHeight(previous => previous === next ? previous : next),
          onReady: () => setRenderState(previous => previous.error === null ? { status: 'ready', error: null } : previous),
          onError: error => setRenderState({ status: 'error', error }),
        })
        setArmedChannel(channel)
        return unregister
      }, [channel, sessionId, runtimeReady])
      React.useEffect(() => {
        if (hidden || renderState.status === 'error' || renderState.status === 'ready' && height !== null) return undefined
        const timer = window.setTimeout(() => setRenderState({ status: 'error', error: runtimeReady ? '脚本未完成加载或尺寸测量。' : '脚本运行环境未就绪。' }), 8000)
        return () => window.clearTimeout(timer)
      }, [channel, hidden, runtimeReady, renderState.status, height])
      const transportReady = typeof window.addEventListener !== 'function' || armedChannel === channel
      const bootMessageId = boot.current.currentMessageId
      const srcDoc = React.useMemo(() => runtimeReady && transportReady ? trustedDocument(script, channel, boot.current.snapshot, { surface, currentMessageId: bootMessageId, currentSourceSeq: sourceSeq }) : '', [channel, script.kind, script.source, runtimeReady, transportReady, surface, bootMessageId, sourceSeq])
      const retry = async () => {
        setRenderState({ status: 'loading', error: null })
        setHeight(null)
        try {
          if (sessionId) compatRuntime.set(sessionId, await api(`/compat/runtime?sessionId=${encodeURIComponent(sessionId)}`), `frame-reload:${Date.now()}`)
          setAttempt(value => value + 1)
        } catch (error) {
          setRenderState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }
      const iframe = runtimeReady ? h('iframe', {
        key: transportReady ? channel : `${channel}:arming`,
        ref: frame,
        className,
        title: title || script.name,
        'aria-label': title || script.name,
        sandbox: 'allow-scripts allow-forms allow-popups allow-downloads allow-modals',
        srcDoc,
        style: hidden ? { display: 'none' } : height === null ? { position: 'absolute', width: '100%', height: 600, minHeight: 0, visibility: 'hidden', pointerEvents: 'none' } : { height, minHeight: 0 },
      }) : null
      if (hidden) return iframe
      const pending = renderState.status !== 'error' && !(renderState.status === 'ready' && height !== null)
      const empty = renderState.status === 'ready' && height === 0
      return h('div', { className: 'dst-trusted-frame-shell' },
        pending ? h('div', { className: 'dst-script-frame-status', role: 'status' }, runtimeReady ? '正在渲染脚本内容…' : '正在准备脚本运行环境…') : null,
        renderState.status === 'error' ? h('div', { className: 'dst-script-frame-error', role: 'alert' }, h('span', null, `脚本渲染失败：${renderState.error}`), h(Button, { className: 'secondary small', onClick: () => void retry() }, '重新加载')) : null,
        empty ? h('div', { className: 'dst-script-frame-status', role: 'status' }, '脚本没有输出可见内容。') : null,
        iframe,
        renderState.status === 'error' || empty ? h('details', { className: 'dst-script-frame-source' }, h('summary', null, '查看脚本原文'), h('pre', null, String(script.source || ''))) : null)
    }

    function ScriptPreview({ sessionId, script, sample }) {
      const eventState = useSessionStore(scriptEvents, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const [rendered, setRendered] = React.useState({ status: 'loading', text: '' })
      React.useEffect(() => {
        if (script.kind !== 'regex') { setRendered({ status: 'direct', text: '' }); return undefined }
        if (sample.trim() === '') { setRendered({ status: 'empty', text: '' }); return undefined }
        const controller = new AbortController()
        setRendered({ status: 'loading', text: '' })
        regexEngine.run(sample, [script], controller.signal, { force: true }, scope).then(value => {
          if (!controller.signal.aborted) setRendered(value.applied.length === 0 ? { status: 'unmatched', text: '' } : { status: 'rendered', text: value.text })
        }).catch(error => {
          if (!controller.signal.aborted) setRendered({ status: 'error', text: error instanceof Error ? error.message : String(error) })
        })
        return () => controller.abort()
      }, [sample, script, scope])
      const warning = eventState?.unavailable === true ? h('p', { className: 'dst-error' }, '预览暂时无法读取会话事件。') : null
      if (script.kind !== 'regex') return h(React.Fragment, null, warning, h(TrustedFrame, { sessionId, script, eventState }))
      if (rendered.status === 'empty') return h('p', { className: 'dst-muted' }, '请输入一段用于匹配的预览文本。')
      if (rendered.status === 'loading') return h('p', { className: 'dst-muted' }, '正在运行 Regex 预览…')
      if (rendered.status === 'unmatched') return h('p', { className: 'dst-muted' }, '预览文本未匹配此规则。')
      if (rendered.status === 'error') return h('p', { className: 'dst-error' }, `Regex 预览失败：${rendered.text}`)
      return h(React.Fragment, null, warning, h(RenderedScriptSegments, { sessionId, seq: `preview-${script.id}`, text: rendered.text, eventState, label: `${script.name} 预览` }))
    }

    function ScriptsTab({ session, reload, scope = 'card' }) {
      const record = session.card
      const cardScope = scope === 'card'
      const [scopeKind, setScopeKind] = React.useState(cardScope ? 'scoped' : 'global')
      const [sources, setSources] = React.useState(() => ({ scoped: structuredClone(record?.scripts || []), global: structuredClone(session.globalRegexScripts || []), preset: structuredClone(session.presetRegexScripts || []) }))
      const scripts = sources[scopeKind]
      const setScripts = update => setSources(previous => ({ ...previous, [scopeKind]: typeof update === 'function' ? update(previous[scopeKind]) : update }))
      const [status, setStatus] = React.useState('')
      const [pendingApprovals, setPendingApprovals] = React.useState(() => new Set())
      const [runningIds, setRunningIds] = React.useState(() => new Set())
      const [previewInputs, setPreviewInputs] = React.useState(() => new Map())
      const approvalAttempts = React.useRef(new Map())
      if (cardScope && !record) return h('p', { className: 'dst-muted' }, '当前会话尚未绑定角色。')
      const save = async () => {
        try {
          if (cardScope) {
            await api('/card/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, cardId: record.id, patch: { scripts: sources.scoped } }) })
          } else {
            await api('/regex-sources', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, global: sources.global, preset: sources.preset }) })
          }
          setStatus('已保存'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message) }
      }
      const clearPendingApproval = id => setPendingApprovals(previous => { const next = new Set(previous); next.delete(id); return next })
      const stopPreview = id => setRunningIds(previous => { if (!previous.has(id)) return previous; const next = new Set(previous); next.delete(id); return next })
      const invalidateApproval = id => { approvalAttempts.current.set(id, (approvalAttempts.current.get(id) || 0) + 1); clearPendingApproval(id); stopPreview(id) }
      const patch = (index, next) => setScripts(previous => previous.map((item, i) => i === index ? { ...item, ...next } : item))
      const patchTrusted = (index, id, next) => { invalidateApproval(id); patch(index, { ...next, enabled: false, approvedHash: null }) }
      const remove = (index, id) => { invalidateApproval(id); setScripts(previous => previous.filter((_item, i) => i !== index)) }
      const add = () => setScripts(previous => previous.concat(scopeKind === 'scoped'
        ? { id: crypto.randomUUID(), name: 'New script', kind: 'javascript', enabled: false, approvedHash: null, source: '' }
        : { id: crypto.randomUUID(), name: 'New Regex', kind: 'regex', enabled: false, approvedHash: null, source: '', findRegex: '', trimStrings: [], placement: [1, 2], markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }))
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '执行脚本'),
        h('p', { className: 'dst-muted' }, cardScope ? '角色卡脚本随角色卡共享。工作区的 Global / Preset 规则位于对话旁的“脚本”标签页。' : 'Global / Preset 规则在当前工作区内共享。角色卡自带的脚本仍在“管理酒馆模式”中编辑。'),
        h('p', { className: 'dst-warning' }, '标准脚本保留原始启用状态，并遵循所属文件夹的启用状态；已确认的 JavaScript 会作为当前会话的后台脚本自动运行，Regex 在对应文本阶段运行，HTML 可在管理页预览。系统不审查或过滤替换内容与脚本源码，启用前请自行验证。编辑规则、源码或类型后会自动停用。'),
        cardScope && record?.scriptImportReport ? h('details', { className: 'dst-script-import-report' },
          h('summary', null, `最近导入：发现 ${record.scriptImportReport.found.length} 项，转换 ${record.scriptImportReport.converted.length} 项，跳过 ${record.scriptImportReport.skipped.length} 项`),
          h('ul', null, [...record.scriptImportReport.skipped, ...record.scriptImportReport.losses].map((item, index) => h('li', { key: index }, `${item.path}：${item.reason}`)))) : null,
        h('div', { className: 'dst-actions' }, ...(cardScope ? [['scoped', 'Scoped（角色卡）']] : [['global', 'Global'], ['preset', 'Preset']]).map(([id, label]) => h(Button, { key: id, className: `${scopeKind === id ? 'active' : 'secondary'} small`, onClick: () => { setRunningIds(new Set()); setScopeKind(id) } }, label))),
        scripts.map((script, index) => {
          const running = runningIds.has(script.id)
          return h('section', { className: 'dst-script', key: script.id },
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '名称' }, h('input', { value: script.name, onChange: event => patch(index, { name: event.target.value }) })),
              h(Field, { label: '类型' }, h('select', { value: script.kind, disabled: scopeKind !== 'scoped', onChange: event => { const kind = event.target.value; patchTrusted(index, script.id, kind === 'regex' ? { kind, placement: [1, 2], findRegex: script.findRegex || '' } : { kind }) } }, h('option', { value: 'regex' }, 'Regex 替换'), ...(scopeKind === 'scoped' ? [h('option', { key: 'javascript', value: 'javascript' }, 'JavaScript'), h('option', { key: 'html', value: 'html' }, 'HTML')] : [])))),
            script.kind === 'regex' ? h(Field, { label: '匹配规则（findRegex）' }, h('textarea', { rows: 3, value: script.findRegex || '', onChange: event => patchTrusted(index, script.id, { findRegex: event.target.value }), spellCheck: false })) : null,
            script.kind === 'regex' ? h(Field, { label: 'Find Regex 宏替换' }, h('select', { value: Number(script.substituteRegex || 0), onChange: event => patchTrusted(index, script.id, { substituteRegex: Number(event.target.value) }) }, h('option', { value: 0 }, '不替换'), h('option', { value: 1 }, 'Raw'), h('option', { value: 2 }, 'Escaped'))) : null,
            h(Field, { label: script.kind === 'regex' ? '替换内容（replaceString）' : '源码' }, h('textarea', { rows: 10, value: script.source, onChange: event => patchTrusted(index, script.id, { source: event.target.value }), spellCheck: false })),
            script.kind === 'regex' ? h(Field, { label: 'Trim Out（每行一项）' }, h('textarea', { rows: 3, value: (script.trimStrings || []).join('\n'), onChange: event => patchTrusted(index, script.id, { trimStrings: event.target.value.split(/\r?\n/) }), spellCheck: false })) : null,
            script.kind === 'regex' ? h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '最小消息深度' }, h('input', { type: 'number', value: script.minDepth ?? '', onChange: event => patchTrusted(index, script.id, { minDepth: event.target.value === '' ? null : Number(event.target.value) }) })),
              h(Field, { label: '最大消息深度' }, h('input', { type: 'number', value: script.maxDepth ?? '', onChange: event => patchTrusted(index, script.id, { maxDepth: event.target.value === '' ? null : Number(event.target.value) }) }))) : null,
            script.kind === 'regex' ? h('div', { className: 'dst-actions' },
              ...[[1, '用户消息'], [2, '助手消息'], [3, 'Slash/Narrator'], [5, '世界书'], [6, 'Reasoning']].map(([value, label]) => h('label', { key: value }, h('input', { type: 'checkbox', checked: script.placement?.includes(value) === true, onChange: event => { const placement = new Set(script.placement || []); if (event.target.checked) placement.add(value); else placement.delete(value); patchTrusted(index, script.id, { placement: [...placement] }) } }), ` ${label}`)),
              h('label', null, h('input', { type: 'checkbox', checked: script.markdownOnly === true, onChange: event => patchTrusted(index, script.id, { markdownOnly: event.target.checked }) }), ' 仅显示阶段'),
              h('label', null, h('input', { type: 'checkbox', checked: script.promptOnly === true, onChange: event => patchTrusted(index, script.id, { promptOnly: event.target.checked }) }), ' 仅提示词阶段'),
              h('label', null, h('input', { type: 'checkbox', checked: script.runOnEdit === true, onChange: event => patchTrusted(index, script.id, { runOnEdit: event.target.checked }) }), ' 编辑消息时运行')) : null,
            script.kind === 'regex' ? h(Field, { label: '预览输入（只用于运行预览，不会保存）' }, h('textarea', { rows: 3, value: previewInputs.get(script.id) || '', onChange: event => setPreviewInputs(previous => { const next = new Map(previous); next.set(script.id, event.target.value); return next }), spellCheck: false })) : null,
            h('div', { className: 'dst-actions' },
              h('label', null, h('input', { type: 'checkbox', checked: script.enabled || pendingApprovals.has(script.id), onChange: async event => {
                const attempt = (approvalAttempts.current.get(script.id) || 0) + 1
                approvalAttempts.current.set(script.id, attempt)
                const enabled = event.target.checked
                if (!enabled) { clearPendingApproval(script.id); stopPreview(script.id); patch(index, { enabled: false, approvedHash: null }); return }
                if (!window.confirm(script.kind === 'javascript' ? `确认启用脚本“${script.name}”？启用后会在当前会话中作为后台脚本运行；修改内容后必须重新确认。` : `确认启用脚本“${script.name}”？启用后会在对应文本阶段运行；修改内容后必须重新确认。`)) return
                setPendingApprovals(previous => new Set(previous).add(script.id))
                const material = scriptApprovalMaterial(script)
                try {
                  const approvedHash = await sourceDigest(script)
                  if (approvalAttempts.current.get(script.id) !== attempt) return
                  setScripts(previous => previous.map(item => item.id === script.id && scriptApprovalMaterial(item) === material ? { ...item, enabled: true, approvedHash } : item))
                } catch (error) { setStatus(error.message || String(error)) }
                finally { if (approvalAttempts.current.get(script.id) === attempt) clearPendingApproval(script.id) }
              } }), ' 启用'),
              h(Button, { className: 'secondary small', disabled: script.source.trim() === '', onClick: () => { if (!running && !script.enabled && !window.confirm(`仅在管理页运行一次“${script.name}”预览？这不会启用对话执行。`)) return; setRunningIds(previous => { const next = new Set(previous); if (next.has(script.id)) next.delete(script.id); else next.add(script.id); return next }) } }, running ? '停止预览' : '运行预览'),
              h(Button, { className: 'danger small', onClick: () => remove(index, script.id) }, '删除')),
            running ? h(ScriptPreview, { sessionId: session.sessionId, script, sample: previewInputs.get(script.id) || '' }) : null)
        }),
        h('div', { className: 'dst-actions' }, h(Button, { className: 'secondary', onClick: add }, '添加脚本'), h(Button, { onClick: () => void save() }, '保存脚本'), h('span', { className: 'dst-muted' }, status)))
    }

    function TemplatesTab({ library, sessionId, reload }) {
      const [selected, setSelected] = React.useState(() => library.templates[0] || { id: crypto.randomUUID(), name: 'New template', content: '', position: 'after', order: 0, enabled: true })
      const [status, setStatus] = React.useState('')
      const save = async () => {
        try { await api('/template/save', { method: 'POST', body: JSON.stringify({ sessionId, template: selected }) }); setStatus('已保存'); overlay.changed(); reload() } catch (error) { setStatus(error.message) }
      }
      const create = () => setSelected({ id: crypto.randomUUID(), name: 'New template', content: '', position: 'after', order: 0, enabled: true })
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '提示词模板'),
        h('div', { className: 'dst-template-list' }, library.templates.map(template => h(Button, { key: template.id, className: template.id === selected.id ? 'small active' : 'secondary small', onClick: () => setSelected(structuredClone(template)) }, template.name)), h(Button, { className: 'secondary small', onClick: create }, '+ 新建')),
        h(Field, { label: '模板名称' }, h('input', { value: selected.name, onChange: event => setSelected(previous => ({ ...previous, name: event.target.value })) })),
        h('div', { className: 'dst-inline-fields' },
          h(Field, { label: '注入位置' }, h('select', { value: selected.position, onChange: event => setSelected(previous => ({ ...previous, position: event.target.value })) }, h('option', { value: 'before' }, '角色卡之前'), h('option', { value: 'after' }, '角色卡之后'), h('option', { value: 'post-history' }, '历史之后'))),
          h(Field, { label: '顺序' }, h('input', { type: 'number', value: selected.order, onChange: event => setSelected(previous => ({ ...previous, order: Number(event.target.value) })) }))),
        h(Field, { label: 'EJS 模板内容' }, h('textarea', { rows: 16, value: selected.content, onChange: event => setSelected(previous => ({ ...previous, content: event.target.value })), spellCheck: false })),
        h('div', { className: 'dst-actions' }, h(Button, { onClick: () => void save() }, '保存模板'), h('label', null, h('input', { type: 'checkbox', checked: selected.enabled, onChange: event => setSelected(previous => ({ ...previous, enabled: event.target.checked })) }), ' 启用'), h('span', { className: 'dst-muted' }, status)))
    }

    function useTavernSettings(sessionId) {
      const [revision, setRevision] = React.useState(0)
      const dataVersion = useOverlay().dataVersion
      const reload = React.useCallback(() => setRevision(value => value + 1), [])
      const state = useAsync(async signal => {
        if (!sessionId) return null
        const query = `sessionId=${encodeURIComponent(sessionId)}`
        const [library, session] = await Promise.all([
          api(`/library?${query}`, { signal }),
          api(`/session?${query}`, { signal }),
        ])
        return { library, session }
      }, [sessionId, revision, dataVersion])
      return { ...state, reload }
    }

    let playerSessions = null
    const pendingPlayerDrafts = new Map()
    async function openPlayerBranch(sessionId, cut, draft = '', submit = false) {
      if (!playerSessions) throw new Error('会话导航尚未就绪')
      const sessions = playerSessions
      const created = await api('/player/branch', { method: 'POST', body: JSON.stringify({ sessionId, ...cut }) })
      const nextId = created.sessionId
      try { await sessions.refresh() }
      catch (error) { throw new Error(`新分支已创建，但会话列表刷新失败；稍后刷新列表后可打开该分支。${error instanceof Error ? ` ${error.message}` : ''}`) }
      if (playerSessions !== sessions || sessions.list.getSnapshot().current !== sessionId) {
        window.alert('新分支已创建。你已切换到其他会话，可稍后从会话列表打开新分支。')
        return { sessionId: nextId, opened: false }
      }
      pendingPlayerDrafts.set(nextId, { text: draft, submit })
      try { sessions.open(nextId) }
      catch (error) { pendingPlayerDrafts.delete(nextId); throw error }
      overlay.close()
      return { sessionId: nextId, opened: true }
    }

    function PlayerNewStory({ sessionId }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const create = async () => {
        setBusy(true); setError('')
        try { await openPlayerBranch(sessionId, { fresh: true }) }
        catch (error) { setError(error.message) }
        finally { setBusy(false) }
      }
      return h('div', { className: 'dst-player-new-story' }, h(Button, { className: 'secondary small', disabled: busy, onClick: () => void create() }, busy ? '正在创建新剧情…' : '用当前角色开启新剧情'), error ? h('span', { role: 'alert' }, error) : null)
    }

    function ForkInheritanceNotice({ session, reload }) {
      const inheritance = session?.fork?.inheritance
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      if (!inheritance) return null
      const repair = async () => {
        setBusy(true)
        try {
          await api('/session/repair-fork', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId }) })
          setNotice('已从来源剧情恢复分支设定。'); overlay.changed(); reload()
        } catch (error) { setNotice(`恢复失败：${error instanceof Error ? error.message : String(error)}`) }
        finally { setBusy(false) }
      }
      return h('section', { className: inheritance.exact ? 'dst-muted' : 'dst-warning' },
        h('p', null, inheritance.exact ? '角色与剧情状态已按分支点继承。' : inheritance.status === 'repairable' ? '这个旧分支缺少角色与剧情状态记录。可以从来源剧情恢复设定；缺少历史快照的部分将采用来源剧情的当前设定，无法精确还原当时的状态。' : inheritance.status === 'unavailable' ? '这个分支缺少可恢复的来源记录，暂时无法还原剧情设定。' : '已继承来源剧情的设定。部分旧状态没有历史快照，不能保证与分支时完全一致，请核对玩家设定与剧情记忆。'),
        inheritance.status === 'repairable' && inheritance.repairable ? h(Button, { className: 'secondary small', disabled: busy, onClick: () => void repair() }, busy ? '正在恢复…' : '从来源剧情恢复分支设定') : null,
        notice ? h('p', { role: 'status' }, notice) : null)
    }

    function ManagerContent({ sessionId }) {
      const state = useTavernSettings(sessionId)
      const [tab, setTab] = React.useState('library')
      if (!sessionId) return h('div', { className: 'dst-warning' }, '酒馆数据按工作区隔离。请从一个具体 Session 的角色菜单打开管理页。')
      if (state.loading && !state.value) return h('div', { className: 'dst-loading' }, '正在读取酒馆数据…')
      if (state.error) return h('div', { className: 'dst-error' }, state.error)
      if (!state.value) return null
      const { library, session } = state.value
      const { reload } = state
      const tabs = [['library', '角色库'], ['card', '角色卡'], ['scripts', '角色脚本']]
      return h('div', { className: 'dst-manager-content' },
        session?.card ? h('div', { className: 'dst-current' }, `当前角色：${session.card.card.data.nickname || session.card.card.data.name}`) : sessionId ? h('div', { className: 'dst-current empty' }, '当前会话尚未绑定角色') : null,
        h(ForkInheritanceNotice, { session, reload }),
        session?.card ? h(PlayerNewStory, { sessionId }) : null,
        h('p', { className: 'dst-manager-hint' }, '世界书、用户设定/变量、工作区脚本和提示词模板已移到对话旁的标签页；事件在“时间线”中查看和编辑。'),
        h('nav', { className: 'dst-tabs' }, tabs.map(([id, label]) => h(Button, { key: id, className: tab === id ? 'tab active' : 'tab', onClick: () => { if (id === tab) return; setTab(id); if (tab === 'scripts') reload() } }, label))),
        h('div', { className: 'dst-tab-body' },
          tab === 'library' ? h(LibraryTab, { library, session, reload }) : null,
          tab === 'card' && session ? h(CardEditTab, { key: `${session.card?.id}:${session.card?.updatedAt}`, session, library, reload }) : null,
          tab === 'scripts' && session ? h(ScriptsTab, { key: `${session.card?.id}:${session.card?.updatedAt}`, session, scope: 'card', reload }) : null))
    }

    function SessionSettingsContent({ sessionId, page, onSaved }) {
      const state = useTavernSettings(sessionId)
      const [worldbookEditorId, setWorldbookEditorId] = React.useState(null)
      const reload = React.useCallback(() => { state.reload(); onSaved?.() }, [state.reload, onSaved])
      if (state.loading && !state.value) return h('div', { className: 'dst-loading', role: 'status' }, '正在读取酒馆数据…')
      if (state.error) return h('div', { className: 'dst-error', role: 'alert' }, state.error, h(Button, { className: 'secondary small', onClick: reload }, '重试'))
      if (!state.value) return null
      const { library, session } = state.value
      return h('div', { className: 'dst-session-content' },
        page === 'worldbook' ? h(WorldbookTab, { key: sessionId, session, library, editorSelection: worldbookEditorId, onEditorSelection: setWorldbookEditorId, reload }) : null,
        page === 'persona' ? h(PersonaTab, { key: sessionId, session, reload }) : null,
        page === 'event' ? h(EventTab, { key: `${sessionId}:${session.event?.revision ?? 0}`, session, reload }) : null,
        page === 'scripts' ? h(ScriptsTab, { key: `${sessionId}:${session.regexRevision ?? 0}`, session, scope: 'workspace', reload }) : null,
        page === 'templates' ? h(TemplatesTab, { library, sessionId, reload }) : null)
    }

    function OverlaySurface() {
      const state = useOverlay()
      if (!state.open) return null
      return h('div', { className: 'dst-overlay' },
        h('div', { className: 'dst-backdrop', onClick: overlay.close }),
        state.mode === 'import'
          ? h('div', { className: 'dst-dialog-wrap' }, h(ImportDialog, { sessionId: state.sessionId, close: overlay.close }))
          : h('aside', { className: 'dst-manager', role: 'dialog', 'aria-modal': true, 'aria-label': '酒馆模式管理' },
              h('header', null, h('div', null, h('strong', null, '酒馆模式'), h('span', null, 'dsh-sillytavern')), h(Button, { className: 'secondary small', onClick: overlay.close }, '关闭')),
              h(ManagerContent, { key: state.sessionId, sessionId: state.sessionId })))
    }

    function SettingsSection() {
      return h('section', { className: 'dst-settings' }, h('h2', null, '酒馆模式'), h('p', { className: 'dst-muted' }, '从角色菜单的“管理酒馆模式”管理角色库、角色卡和角色脚本。世界书、用户设定/变量、工作区脚本与提示词模板位于对话旁的标签页，事件在“时间线”中查看和编辑。数据仍按工作区保存。'))
    }

    function cardLabel(card) {
      return String(card?.nickname || card?.name || '未命名角色')
    }

    function useCharacterSelectLayout(compact, label) {
      const buttonRef = React.useRef(null)
      const labelRef = React.useRef(null)
      const [iconOnly, setIconOnly] = React.useState(true)
      React.useLayoutEffect(() => {
        const button = buttonRef.current
        const text = labelRef.current
        if (!compact || !button || !text) return undefined
        // Find the wrapping toolbar without depending on the host's CSS module names.
        let row = button.parentElement
        while (row) {
          const style = getComputedStyle(row)
          if (style.display === 'flex' && style.flexWrap === 'wrap') break
          row = row.parentElement
        }
        const measure = () => {
          // Expanded chrome: 16px mug + 14px chevron + 16px padding + two 4px gaps.
          // The hidden label keeps its natural width, so collapsing cannot cause a toggle loop.
          const expandedWidth = Math.min(text.getBoundingClientRect().width + 54, 180)
          let fits = expandedWidth <= 180
          if (fits && row) {
            const style = getComputedStyle(row)
            const number = value => parseFloat(value) || 0
            const children = [...row.children].filter(child => getComputedStyle(child).display !== 'none')
            // The host's trailing group uses margin-left:auto; its resolved margin is spare space.
            const occupied = children.reduce((width, child) => width + child.getBoundingClientRect().width, 0)
              + Math.max(0, children.length - 1) * number(style.columnGap)
            const available = row.clientWidth - number(style.paddingLeft) - number(style.paddingRight)
            const expandedRowWidth = occupied - button.getBoundingClientRect().width + expandedWidth
            fits = expandedRowWidth <= available - 1
          }
          setIconOnly(!fits)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(text)
        if (row) {
          observer.observe(row)
          for (const child of row.children) observer.observe(child)
        }
        return () => observer.disconnect()
      }, [compact, label])
      return { buttonRef, labelRef, iconOnly: compact && iconOnly }
    }

    function CharacterSelect({ cards, value, busy, locked = false, onChange, onManage, compact = false }) {
      const [open, setOpen] = React.useState(false)
      const available = Array.isArray(cards) && cards.length > 0
      const selected = available ? cards.find(card => card.id === value) : undefined
      const label = selected === undefined ? '选择角色卡' : cardLabel(selected)
      const { buttonRef, labelRef, iconOnly } = useCharacterSelectLayout(compact, label)
      const items = available
        ? [
          ...cards.map(card => ({ id: card.id, label: cardLabel(card), disabled: locked && card.id !== value })),
          { type: 'separator', id: 'character-separator' },
          { id: 'manage', label: '管理酒馆模式', icon: h(IconSettingsOutline14) },
        ]
        : [{ id: 'manage', label: '导入或管理角色卡', icon: h(IconSettingsOutline14) }]
      return h(Menu, {
        open,
        onClose: () => setOpen(false),
        items,
        selectedId: value || undefined,
        onSelect: id => {
          setOpen(false)
          if (id === 'manage') onManage?.()
          else onChange(id)
        },
        align: 'start',
        side: 'top',
        portal: true,
        dense: true,
        compact: true,
        className: 'dst-character-menu',
        anchor: h('button', {
          ref: buttonRef,
          type: 'button',
          className: `dst-character-seat${compact ? ' compact' : ''}${iconOnly ? ' icon-only' : ''}`,
          'aria-label': '当前角色卡',
          'aria-description': label,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          title: available ? `当前角色卡：${label}${locked ? '（对话已开始，不能更换）' : ''}` : '请先导入角色卡',
          disabled: busy,
          onClick: () => setOpen(previous => !previous),
        },
        h(TavernMugIcon, { className: 'dst-character-icon' }),
        h('span', { ref: labelRef, className: 'dst-character-label' }, label),
        h(IconChevronDownOutline14, { className: 'dst-character-chevron' }))
      })
    }

    function displayRegexRules(scripts) {
      return (Array.isArray(scripts) ? scripts : []).filter(script => script?.kind === 'regex'
        && script.enabled === true
        && script.disabled !== true
        && String(script.findRegex || '').trim() !== '')
    }

    function regexMessageDepth(scope, seq) {
      const messages = Array.isArray(scope?.messages) ? scope.messages.filter(message => message?.role === 'user' || message?.role === 'assistant') : []
      const index = messages.findIndex(message => Number(message?.seq) === Number(seq))
      return index < 0 ? undefined : messages.length - index - 1
    }

    const SCRIPT_MARKDOWN_LABELS = Object.freeze({
      code: Object.freeze({ copyLabel: '复制', copiedLabel: '已复制' }),
      footnotes: '脚注',
    })

    function splitMarkdownFenceRegions(input) {
      const source = String(input ?? '')
      const lines = source.match(/[^\n]*(?:\n|$)/g) || []
      const regions = []
      const push = (kind, text) => {
        if (text === '') return
        const previous = regions.at(-1)
        if (previous?.kind === kind) previous.text += text
        else regions.push({ kind, text })
      }
      let fence = null
      let regionStart = 0
      let offset = 0
      for (const line of lines) {
        if (line === '') continue
        const end = offset + line.length
        if (fence === null) {
          const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/)
          const validOpening = opening !== null && !(opening[1][0] === '`' && opening[2].includes('`'))
          if (validOpening) {
            if (offset > regionStart) push('markup', source.slice(regionStart, offset))
            fence = { char: opening[1][0], length: opening[1].length, start: offset }
          } else if (/^(?: {4}|\t)/.test(line)) {
            if (offset > regionStart) push('markup', source.slice(regionStart, offset))
            push('markdown', line)
            regionStart = end
          }
        } else {
          const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/)
          if (closing !== null && closing[1][0] === fence.char && closing[1].length >= fence.length) {
            push('markdown', source.slice(fence.start, end))
            fence = null
            regionStart = end
          }
        }
        offset = end
      }
      if (fence !== null) push('markdown', source.slice(fence.start))
      else if (regionStart < source.length) push('markup', source.slice(regionStart))
      return regions
    }

    function legacyFontColor(attributes) {
      const match = String(attributes ?? '').match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined
    }

    function tavernMarkdownSegments(input) {
      const segments = []
      for (const region of splitMarkdownFenceRegions(input)) {
        if (region.kind === 'markdown') {
          segments.push(region)
          continue
        }
        const source = region.text
        const pattern = /^[ \t]*<font\b([^>\r\n]*)>([\s\S]*?)<\/font\s*>[ \t]*$/gim
        let cursor = 0
        let match
        while ((match = pattern.exec(source)) !== null) {
          if (match.index > cursor) segments.push({ kind: 'markdown', text: source.slice(cursor, match.index) })
          const body = String(match[2] ?? '')
          if (/<font\b/i.test(body)) segments.push({ kind: 'markdown', text: match[0] })
          else segments.push({ kind: 'font', text: body.trim(), color: legacyFontColor(match[1]) })
          cursor = match.index + match[0].length
        }
        if (cursor < source.length) segments.push({ kind: 'markdown', text: source.slice(cursor) })
      }
      return segments.filter(segment => segment.kind !== 'markdown' || segment.text !== '')
    }

    function TavernMarkdownContent({ text, streaming = false, fileMentions }) {
      const segments = React.useMemo(() => streaming
        ? [{ kind: 'markdown', text: String(text ?? '') }]
        : tavernMarkdownSegments(text), [text, streaming])
      return h('div', { className: 'dst-markdown-content' }, segments.map((segment, index) => {
        if (segment.kind === 'font') return h('div', { key: `font-${index}`, className: 'dst-legacy-font', style: segment.color === undefined ? undefined : { color: segment.color } },
          h(MarkdownText, { text: segment.text, streaming, labels: SCRIPT_MARKDOWN_LABELS, fileMentions }))
        return h(MarkdownText, { key: `markdown-${index}`, text: segment.text, streaming, labels: SCRIPT_MARKDOWN_LABELS, fileMentions })
      }))
    }

    const TavernTurnProcessNode = React.memo(function TavernTurnProcessNode({ node, turnProcess }) {
      if (turnProcess === undefined || !turnProcess.foldable) return null
      const open = turnProcess.open
      return h('button', {
        type: 'button',
        className: 'dst-story-progress-toggle',
        'data-open': open || undefined,
        'data-turn-process': node.data.turn,
        'data-turn-process-messages': node.data.messageCount,
        'data-turn-process-tool-calls': node.data.toolCallCount,
        'data-turn-process-subagents': node.data.subagentCount,
        'aria-expanded': open,
        onClick: event => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        },
      },
      h('span', { className: 'dst-story-progress-label' }, '剧情推进'),
      h(IconChevronDownOutline14, { className: 'dst-story-progress-chevron' }))
    })

    const TavernSystemPromptNode = React.memo(function TavernSystemPromptNode() {
      return h('span', { hidden: true, 'data-dst-system-prompt-hidden': true })
    })

    function StoryProcessReasoning({ hidden, reveal, children }) {
      const ref = React.useRef(null)
      React.useLayoutEffect(() => {
        const element = ref.current
        if (element === null) return
        if (hidden && element.contains(element.ownerDocument.activeElement)) {
          reveal()
          return
        }
        if (hidden) element.setAttribute('hidden', 'until-found')
        else element.removeAttribute('hidden')
      }, [hidden, reveal])
      React.useEffect(() => {
        const element = ref.current
        if (element === null) return
        element.addEventListener('beforematch', reveal)
        return () => element.removeEventListener('beforematch', reveal)
      }, [reveal])
      return h('div', { ref, 'data-turn-process-inline': hidden || undefined }, children)
    }

    function AssistantFallback({ node, renderMessageImages, mentions, replacementBase, replacements, reasoningHidden = false, revealProcess }) {
      const data = node.data
      const streaming = data.status === 'running'
      const rendered = []
      for (let index = 0; index < data.blocks.length; index += 1) {
        const block = data.blocks[index]
        if (block?.kind === 'text') {
          const replacement = replacements?.[index]
          if (replacement !== undefined) rendered.push(h(ScriptConversationContent, { key: index, ...replacementBase, messageSeq: replacementBase.messageSeq ?? replacementBase.seq, seq: `${replacementBase.seq}-${index}`, text: replacement, mentions }))
          else rendered.push(h(TavernMarkdownContent, { key: index, text: block.text, streaming, fileMentions: mentions }))
        }
        else if (block?.kind === 'reasoning') rendered.push(h(StoryProcessReasoning, { key: index, hidden: reasoningHidden, reveal: revealProcess },
          h('details', { className: 'dst-assistant-reasoning', open: streaming || undefined }, h('summary', null, streaming ? '思考中…' : '思考过程'), replacements?.[index] !== undefined ? h(ScriptConversationContent, { ...replacementBase, messageSeq: replacementBase.messageSeq ?? replacementBase.seq, seq: `${replacementBase.seq}-reasoning-${index}`, text: replacements[index] }) : h('pre', null, block.text))))
        else if (block?.kind === 'image') {
          const start = index
          const images = [block]
          while (data.blocks[index + 1]?.kind === 'image') { images.push(data.blocks[index + 1]); index += 1 }
          rendered.push(h(React.Fragment, { key: start }, renderMessageImages({ images: images.map(item => ({ attachment: item.attachment })), align: 'start' })))
        } else if (block?.kind !== 'tool-call' && block !== undefined) rendered.push(h(JsonBlock, { key: index, label: '未知消息块', payload: block.block, truncatedLabel: total => `JSON 已截断（${total}）` }))
      }
      if (data.status === 'interrupted') rendered.push(h('span', { className: 'dst-assistant-stopped', key: 'stopped' }, '已停止'))
      return rendered.length === 0 ? null : h('div', { className: 'dst-assistant-message', 'data-streaming': streaming || undefined }, rendered)
    }

    function RenderedScriptSegments({ sessionId, seq, messageSeq = null, text, mentions, eventState, label = '脚本渲染内容' }) {
      const segments = greetingSegments(text, true, false)
      if (segments.length === 0) return null
      return h('article', { className: 'dst-script-conversation', 'aria-label': label }, segments.map((segment, index) => segment.type === 'html'
        ? h(TrustedFrame, { key: `html-${seq}-${index}`, sessionId, script: { id: `conversation-${seq}-${index}`, name: label, kind: 'html', source: segment.value, sourceSeq: messageSeq }, eventState })
        : h(TavernMarkdownContent, { key: `markdown-${index}`, text: segment.value, fileMentions: mentions })))
    }

    function ScriptConversationContent({ sessionId, seq, messageSeq = null, text, mentions }) {
      const eventState = useSessionStore(scriptEvents, sessionId)
      return h(RenderedScriptSegments, { sessionId, seq, messageSeq, text, mentions, eventState })
    }

    function TavernAssistantNode(props) {
      const { node, renderMessageImages, sessionId, useTurnData, openFile, fileMentions, turnProcess } = props
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const compat = useCompatSnapshot(sessionId)
      const messageSeq = node.data.finalNode?.seq ?? node.seq ?? node.data.seq
      const projected = React.useMemo(() => (compat?.messages || []).find(message => message.event_seq === messageSeq || message.sourceSeq === messageSeq), [compat, messageSeq])
      const depth = regexMessageDepth(scope, messageSeq)
      const turn = node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn : undefined
      const tail = useTurnData('turn-tail')
      const mentionOwner = React.useMemo(() => turn?.status === 'closed' && node.data.finalNode !== undefined && tail?.closing?.finalNode.seq === node.data.finalNode.seq ? { turn, seq: node.data.finalNode.seq, openFile } : undefined, [node.data.finalNode, openFile, tail, turn])
      const mentions = React.useMemo(() => mentionOwner === undefined || typeof fileMentions !== 'function' ? undefined : fileMentions(mentionOwner), [fileMentions, mentionOwner])
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const regexBlocks = React.useMemo(() => node.data.blocks.flatMap((block, index) => block?.kind === 'text' ? [{ index, text: block.text, placement: 2 }] : block?.kind === 'reasoning' ? [{ index, text: block.text, placement: 6 }] : []), [node.data.blocks])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [rendered, setRendered] = React.useState({ status: 'native', message: '', replacements: {} })
      const reasoningHidden = turnProcess !== undefined
        && turnProcess.foldable
        && turnProcess.spec.answerStep === node.data.step
        && turnProcess.spec.inlineReasoning
        && !turnProcess.open
      const revealProcess = React.useCallback(() => {
        turnProcess?.setOpen(true)
      }, [turnProcess])
      React.useEffect(() => {
        const controller = new AbortController()
        if (node.data.status !== 'settled' || rules.length === 0 || regexBlocks.length === 0) {
          setRendered({ status: 'native', message: '', replacements: {} })
          return () => controller.abort()
        }
        setRendered(previous => previous.status === 'rendered' ? previous : { status: 'loading', message: '', replacements: {} })
        Promise.all(regexBlocks.map(block => regexEngine.run(block.text, rules, controller.signal, { placement: block.placement, isMarkdown: true, depth }, scope))).then(values => {
          if (controller.signal.aborted) return
          const replacements = {}
          values.forEach((value, index) => { if (value.applied.length > 0) replacements[regexBlocks[index].index] = value.text })
          setRendered(Object.keys(replacements).length === 0 ? { status: 'native', message: '', replacements: {} } : { status: 'rendered', message: '', replacements })
        }).catch(error => {
          if (!controller.signal.aborted) setRendered({ status: 'error', message: error instanceof Error ? error.message : String(error), replacements: {} })
        })
        return () => controller.abort()
      }, [fingerprint, node.data.status, regexBlocks, depth, scope])
      if (projected?.is_hidden === true) return null
      const nativeText = regexBlocks.filter(block => block.placement === 2).map(block => block.text).join('\n')
      if (projected && String(projected.message ?? projected.mes ?? projected.text ?? '') !== nativeText) return h(RenderedScriptSegments, { sessionId, seq: `compat-assistant-${messageSeq}`, messageSeq, text: String(projected.message ?? projected.mes ?? projected.text ?? ''), mentions, eventState: null, label: '兼容消息投影' })
      if (rendered.status === 'loading') return h('div', { className: 'dst-script-rendering', role: 'status' }, '正在渲染脚本…')
      if (rendered.status === 'rendered') return h(AssistantFallback, { node, renderMessageImages, mentions, replacementBase: { sessionId, seq: messageSeq, messageSeq }, replacements: rendered.replacements, reasoningHidden, revealProcess })
      return h(React.Fragment, null,
        h(AssistantFallback, { node, renderMessageImages, mentions, reasoningHidden, revealProcess }),
        rendered.status === 'error' ? h('p', { className: 'dst-script-render-error' }, `脚本渲染失败：${rendered.message}`) : null)
    }

    function TavernMessageActions({ sessionId, messageId }) {
      const recovery = useAsync(signal => api(`/player/recovery?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, messageId])
      const entry = recovery.value?.turns?.find(turn => turn.assistantIds.includes(messageId))
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const branch = async (cut, text, submit) => {
        setBusy(true); setError('')
        try { await openPlayerBranch(sessionId, cut, text, submit) }
        catch (error) { setError(error.message) }
        finally { setBusy(false) }
      }
      if (!entry) return null
      const retryText = Object.hasOwn(entry, 'retryText') ? entry.retryText : entry.text
      const hasSteering = typeof entry.steeringText === 'string' && entry.steeringText.trim() !== ''
      const canContinue = entry.reason === 'completed'
      const action = (label, Icon, unavailable, description, onClick) => h(Tooltip, { label: description || label, side: 'bottom' },
        h('button', {
          type: 'button', className: 'dst-player-message-action',
          'aria-label': label, 'aria-description': description || undefined,
          'aria-disabled': unavailable || undefined,
          onClick: unavailable ? undefined : onClick,
        }, h('span', { 'aria-hidden': true }, h(Icon))))
      return h('div', { className: 'dst-player-message-actions' },
        action('重生成 · 保留原分支', IconRefreshOutline16, busy || !retryText, busy ? '正在创建分支…' : !retryText ? '本轮没有可重放的行动' : '', () => void branch({ beforeTurn: entry.turn }, retryText, true)),
        action('编辑行动后重试', IconEditOutline16, busy || !retryText, busy ? '正在创建分支…' : !retryText ? '本轮没有可编辑的行动' : '', () => { setDraft(retryText); setEditing(true) }),
        action('从这里继续', IconRightUpOutline16, busy || !canContinue, busy ? '正在创建分支…' : !canContinue ? '这轮回复未完成，不能从回复之后继续' : '从这里继续：在本轮之后创建新剧情分支', () => void branch({ afterTurn: entry.turn }, '', false)),
        hasSteering ? h('div', { className: 'dst-muted' }, h('p', null, '本轮还有中途追加的行动。重生成只会自动重放开场行动；请在新回复生成时按需要再次追加：'), h('blockquote', null, entry.steeringText)) : null,
        editing ? h('div', { className: 'dst-player-action-editor' },
          h('textarea', { 'aria-label': '修改本轮行动', value: draft, disabled: busy, onChange: event => setDraft(event.target.value), rows: 4 }),
          h('p', { className: 'dst-muted' }, '会从本轮行动之前创建新分支，保留原来的剧情候选。'),
          h(Button, { disabled: busy || !draft.trim(), onClick: () => void branch({ beforeTurn: entry.turn }, draft, true) }, busy ? '正在创建分支…' : '在新分支生成'),
          h(Button, { className: 'secondary', disabled: busy, onClick: () => setEditing(false) }, '取消')) : null,
        error ? h('p', { role: 'alert' }, error) : null)
    }

    function TavernFailureNode({ node, sessionId, useInput, inputActions }) {
      const recovery = useAsync(signal => api(`/player/recovery?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, node.data.seq])
      const draft = String(useInput(state => state.draft) ?? '')
      const phase = useInput(state => state.phase)
      const [notice, setNotice] = React.useState('')
      const failed = recovery.value?.failedTurns?.find(item => item.turn === node.data.turn)
      const hasStructuredRecovery = failed && Object.hasOwn(failed, 'retryText')
      const retryText = hasStructuredRecovery ? failed.retryText : failed?.text || ''
      const retryInputs = hasStructuredRecovery ? failed.inputs?.filter(item => item.target === 'next-turn') || [] : failed?.inputs || []
      const persisted = retryInputs.some(item => item.persisted)
      const hasSteering = typeof failed?.steeringText === 'string' && failed.steeringText.trim() !== ''
      const needsBranch = recovery.value?.turns?.some(item => item.turn > (failed?.turn ?? Infinity)) === true
      const technical = String(node.data.message || failed?.error?.message || '未知错误')
      const reason = /callback|barrier|owner disconnected/i.test(technical)
        ? '角色脚本暂时没有完成响应，这轮剧情未能继续。'
        : '这轮回复没有生成完成，可以恢复行动后继续。'
      const restore = () => {
        const original = retryText
        inputActions.setDraft(draft.trim() && draft !== original ? `${draft}\n${original}` : original)
        setNotice('行动已恢复到输入框，可以编辑后发送。')
      }
      const retry = async () => {
        if (needsBranch) {
          try { await openPlayerBranch(sessionId, { beforeTurn: failed.turn }, retryText, true) }
          catch (error) { setNotice(`创建重试分支失败：${error.message}`) }
          return
        }
        inputActions.setDraft(persisted ? '请继续完成上一条尚未完成的玩家行动，从中断处继续剧情。' : retryText)
        inputActions.submit()
        setNotice(persisted ? '已请求继续未完成的回复。' : '已重新发送这轮行动。')
      }
      return h('section', { className: 'dst-player-failure', role: 'alert' },
        h('strong', null, '本轮剧情未完成'), h('p', null, reason),
        failed?.text ? h(React.Fragment, null,
          h('div', { className: 'dst-muted' }, '你的行动'), h('blockquote', null, failed.text),
          hasSteering ? h('p', { className: 'dst-muted' }, '其中包含本轮中途追加的行动；自动重试只会重放开场行动，请在新回复生成时按需要再次追加。') : null,
          h('p', { className: 'dst-muted' }, persisted ? '开场行动已在对话中，继续时会接着已有内容生成。' : hasSteering ? '开场行动尚未写入剧情上下文，重试会重新发送开场行动。' : '行动尚未写入剧情上下文，重试会重新发送这段原文。'),
          h('div', { className: 'dst-actions' },
            h(Button, { className: 'secondary', disabled: phase !== 'plain', onClick: restore }, '恢复输入 / 编辑'),
            h(Button, { disabled: phase !== 'plain' || draft.trim() !== '', onClick: () => void retry(), title: draft.trim() ? '请先处理输入框中的草稿' : undefined }, needsBranch ? '从这轮创建重试分支' : persisted ? '继续未完成的回复' : '重试这轮')),
          draft.trim() ? h('p', { className: 'dst-muted' }, '输入框中已有草稿；处理后可直接重试，恢复输入会追加到现有草稿。') : null)
          : h('p', { className: 'dst-muted' }, recovery.loading ? '正在找回这轮行动…' : recovery.error ? `读取行动失败：${recovery.error}` : '这轮没有可恢复的玩家文字，请在输入框中继续。'),
        notice ? h('p', { className: 'dst-status', role: 'status' }, notice) : null,
        h('details', null, h('summary', null, '技术详情'), h('pre', null, technical)))
    }

    function TavernUserNode({ node, renderMessageImages, sessionId }) {
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const eventState = useSessionStore(scriptEvents, sessionId)
      const compat = useCompatSnapshot(sessionId)
      const depth = regexMessageDepth(scope, node.data.seq)
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const textBlocks = React.useMemo(() => (node.data.content || []).flatMap((block, index) => block?.type === 'text' ? [{ index, text: block.text }] : []), [node.data.content])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [replacements, setReplacements] = React.useState({})
      React.useEffect(() => {
        const controller = new AbortController()
        if (rules.length === 0 || textBlocks.length === 0) { setReplacements({}); return () => controller.abort() }
        Promise.all(textBlocks.map(block => regexEngine.run(block.text, rules, controller.signal, { placement: 1, isMarkdown: true, depth }, scope))).then(values => {
          if (controller.signal.aborted) return
          const next = {}
          values.forEach((value, index) => { if (value.applied.length > 0) next[textBlocks[index].index] = value.text })
          setReplacements(next)
        }).catch(() => { if (!controller.signal.aborted) setReplacements({}) })
        return () => controller.abort()
      }, [fingerprint, textBlocks, depth, scope])
      const projected = (compat?.messages || []).find(message => message.event_seq === node.data.seq || message.sourceSeq === node.data.seq)
      if (projected?.is_hidden === true) return null
      const nativeText = textBlocks.map(block => block.text).join('\n')
      if (projected && String(projected.message ?? projected.mes ?? projected.text ?? '') !== nativeText) return h('div', { className: 'dst-user-row' }, h('div', { className: 'dst-user-stack' }, h('div', { className: 'dst-user-message' }, h(RenderedScriptSegments, { sessionId, seq: `compat-user-${node.data.seq}`, messageSeq: node.data.seq, text: String(projected.message ?? projected.mes ?? projected.text ?? ''), eventState, label: '兼容用户消息投影' }))))
      const rendered = []
      const images = []
      const content = node.data.content || []
      for (let index = 0; index < content.length; index += 1) {
        const block = content[index]
        if (block?.type === 'text') rendered.push(replacements[index] !== undefined
          ? h(ScriptConversationContent, { key: index, sessionId, seq: `user-${node.data.seq}-${index}`, messageSeq: node.data.seq, text: replacements[index], eventState, label: '用户 Regex 替换' })
          : h(MarkdownText, { key: index, text: block.text, labels: SCRIPT_MARKDOWN_LABELS }))
        else if (block?.type === 'image') images.push({ attachment: block.attachment })
      }
      if (rendered.length === 0 && images.length === 0) return null
      const stack = []
      if (images.length > 0) stack.push(h(React.Fragment, { key: 'images' }, renderMessageImages({ images, align: 'end' })))
      if (rendered.length > 0) stack.push(h('div', { className: 'dst-user-message', key: 'message' }, rendered))
      return h('div', { className: 'dst-user-row' }, h('div', { className: 'dst-user-stack' }, ...stack))
    }

    function TavernCharacterSelect({ sessionId, blocks, registerMessageRenderers, appendInput }) {
      const version = useOverlay().dataVersion
      const eventState = useSessionEventState(sessionId)
      const eventCardId = eventState?.card?.id || null
      const session = useAsync(signal => api(`/session?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version, eventCardId])
      const compatibility = useAsync(signal => api(`/compat/runtime?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version, eventCardId])
      const library = useAsync(signal => api(`/library?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version])
      const verifiedScripts = useSessionStore(scriptPolicies, sessionId)
      const [busy, setBusy] = React.useState(false)
      const [replacement, setReplacement] = React.useState(null)
      const [selectionError, setSelectionError] = React.useState('')
      const ownedBlock = React.useRef(Object.freeze({ reason: '正在切换角色卡…' }))
      const previousBlock = React.useRef(undefined)
      const appendInputRef = React.useRef(appendInput)
      appendInputRef.current = appendInput
      const cardRecord = session.value?.card || compatibility.value?.cardRecord
      const previewBinding = session.value?.binding || compatibility.value?.state?.binding
      const eventTail = eventState?.history?.at(-1)?.seq ?? -1
      const eventCursor = eventState?.cursor ?? -1
      const compatChatRevision = eventState?.compatChatRevision ?? -1
      const globalVariablesToken = JSON.stringify(session.value?.globalVariables || {})
      const regexSourcesToken = [
        ...(session.value?.globalRegexScripts || []),
        ...(session.value?.presetRegexScripts || []),
        ...(cardRecord?.scripts || []),
      ].map(script => `${script.id}:${script.enabled}:${script.approvedHash || ''}`).join('|')
      React.useEffect(() => typeof registerMessageRenderers === 'function' ? registerMessageRenderers() : undefined, [registerMessageRenderers])
      React.useEffect(() => {
        const bridge = value => appendInputRef.current(value)
        return compatRuntime.setComposer(sessionId, bridge)
      }, [sessionId])
      React.useEffect(() => {
        if (compatibility.value === null) return
        compatRuntime.set(sessionId, compatibility.value, `${compatibility.value.bindingRevision}:${compatibility.value.cardRecord?.id || 'none'}:${compatibility.value.chatRevision ?? -1}`)
      }, [sessionId, compatibility.value])
      React.useEffect(() => { compatRuntime.applyEventState(sessionId, eventState) }, [sessionId, eventState, eventTail, compatibility.value])
      React.useEffect(() => {
        if (session.loading) return undefined
        let active = true
        const token = `${cardRecord?.id || 'none'}:${cardRecord?.updatedAt || 'none'}:${regexSourcesToken}`
        const scripts = [
          ...(Array.isArray(session.value?.globalRegexScripts) ? session.value.globalRegexScripts : []),
          ...(Array.isArray(session.value?.presetRegexScripts) ? session.value.presetRegexScripts : []),
          ...(Array.isArray(cardRecord?.scripts) ? cardRecord.scripts : []),
        ]
        scriptPolicies.set(sessionId, [], `verifying:${token}`)
        Promise.all(scripts.map(async script => {
          if (script?.enabled !== true) return script
          try {
            const approvedHash = await sourceDigest(script)
            return approvedHash === script.approvedHash ? script : { ...script, enabled: false, approvedHash: null }
          } catch { return { ...script, enabled: false, approvedHash: null } }
        })).then(verified => { if (active) scriptPolicies.set(sessionId, verified, `verified:${token}`) })
        return () => { active = false }
      }, [sessionId, session.loading, cardRecord?.id, cardRecord?.updatedAt, regexSourcesToken])
      React.useEffect(() => {
        const data = cardRecord?.card?.data || {}
        const messages = (eventState?.messages || eventState?.history || []).map(message => ({
          role: message.role,
          text: message.message ?? message.mes ?? message.text ?? '',
          seq: message.sourceSeq ?? message.event_seq ?? message.seq ?? message.message_id,
        }))
        const scope = {
          card: cardRecord?.card || null,
          character: data,
          char: data.nickname || data.name || 'Character',
          user: previewBinding?.userPersona?.name || compatibility.value?.persona?.name || 'User',
          persona: previewBinding?.userPersona || compatibility.value?.persona || { name: 'User', description: '' },
          variables: previewBinding?.variables || {},
          globalVariables: session.value?.globalVariables || {},
          currentSwipeId: Number(previewBinding?.openingSwipeId || 0),
          messages,
        }
        scriptScopes.set(sessionId, scope, `${cardRecord?.id || 'none'}:${previewBinding?.revision || 0}:${eventCursor}:${compatChatRevision}:${globalVariablesToken}`)
      }, [sessionId, cardRecord?.id, cardRecord?.updatedAt, previewBinding?.revision, eventCursor, compatChatRevision, globalVariablesToken])
      React.useEffect(() => {
        scriptEvents.set(sessionId, eventState, `${eventCursor}:${compatChatRevision}:${eventTail}:${eventState?.history?.length || 0}:${eventState?.unavailable === true}:${eventState?.card?.id || 'none'}`)
      }, [sessionId, eventState, eventCursor, compatChatRevision, eventTail])
      const releaseBlock = () => {
        if (blocks.storeFor(sessionId).getSnapshot() === ownedBlock.current) blocks.set(sessionId, previousBlock.current)
        previousBlock.current = undefined
      }
      React.useEffect(() => releaseBlock, [sessionId, blocks])
      if (session.error || compatibility.error || library.error) return h('span', { className: 'dst-character-load-error', role: 'status' }, '角色设置加载失败 ', h(Button, { className: 'secondary small', onClick: () => overlay.changed() }, '重试'), h(Button, { className: 'secondary small', onClick: () => overlay.open('manager', sessionId) }, '管理酒馆模式'))
      if (!session.value || !compatibility.value || !library.value) return h('span', { className: 'dst-muted' }, '正在加载角色…')
      const currentId = session.value?.binding?.cardId || cardRecord?.id || ''
      const locked = Boolean(session.value?.binding?.cardId) && sessionHasStarted(session.value)
      const selectCard = async (id, confirmed = false) => {
        if (!id || id === session.value?.binding?.cardId || busy) return
        if (locked) { setSelectionError('当前会话已经开始对话，不能更换角色卡。'); return }
        const currentName = cardLabel(session.value?.card?.card?.data)
        const next = library.value.cards.find(card => card.id === id)
        const boundCardId = session.value?.binding?.cardId || null
        setSelectionError('')
        if (boundCardId && !confirmed) { setReplacement({ id, sessionId, boundCardId, currentName, nextName: cardLabel(next) }); return }
        previousBlock.current = blocks.storeFor(sessionId).getSnapshot()
        blocks.set(sessionId, ownedBlock.current)
        setBusy(true)
        try {
          await api('/bind', { method: 'POST', body: JSON.stringify({ sessionId, cardId: id, replace: boundCardId !== null, expectedCardId: boundCardId }) })
          setReplacement(null)
          overlay.changed()
        } catch (error) {
          setSelectionError(`切换角色失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          releaseBlock()
          setBusy(false)
        }
      }
      const currentScriptApprovals = new Set((cardRecord?.scripts || []).map(script => `${script.id}:${script.approvedHash || ''}`))
      const backgroundScripts = verifiedScripts.filter(script => script?.kind === 'javascript' && script.enabled === true && typeof script.approvedHash === 'string' && currentScriptApprovals.has(`${script.id}:${script.approvedHash}`))
      return h('span', { className: 'dst-composer-character' },
        h(CharacterSelect, {
          cards: library.value.cards,
          value: currentId,
          busy,
          locked,
          compact: true,
          onChange: id => { void selectCard(id) },
          onManage: () => overlay.open('manager', sessionId),
        }),
        replacement && replacement.sessionId === sessionId && replacement.boundCardId === session.value?.binding?.cardId ? h(ConfirmPanel, { title: '更换当前角色', busy, danger: false, confirmLabel: '确认更换', onCancel: () => { setReplacement(null); setSelectionError('') }, onConfirm: () => { void selectCard(replacement.id, true) } }, h('p', null, `将当前角色“${replacement.currentName}”替换为“${replacement.nextName}”？`), selectionError ? h('p', { role: 'status', className: 'dst-error' }, selectionError) : null) : null,
        selectionError && !replacement ? h('span', { role: 'status', className: 'dst-error' }, selectionError) : null,
        ...backgroundScripts.map(script => h(TrustedFrame, { key: `background:${cardRecord?.id || 'none'}:${script.id}:${script.approvedHash}`, sessionId, script, eventState, hidden: true, title: `${script.name} 后台脚本` })))
    }

    function sessionAgentPreset(summary) {
      return summary?.projectionValues?.agentPreset ?? summary?.agentPreset
    }

    let pendingSourceJump = null
    function TavernEventsSession(props) {
      const state = props.useEventExplorer(value => value)
      const [editing, setEditing] = React.useState(false)
      if (editing) return h('section', { className: 'dst-session-page', 'data-session-id': props.sessionId, 'data-conversation-composer-overlay': '' },
        h('header', { className: 'dst-session-header' }, h('h1', null, '编辑事件'), h(Button, { className: 'secondary small', onClick: () => { props.refreshEvents(); setEditing(false) } }, '返回时间线')),
        h(SessionSettingsContent, { key: props.sessionId, sessionId: props.sessionId, page: 'event', onSaved: props.refreshEvents }))
      const openSource = ref => {
        const turn = Number(ref.turn)
        pendingSourceJump?.()
        const scope = [...document.querySelectorAll('.dst-explorer-root[data-session-id]')].find(element => element.dataset.sessionId === props.sessionId)?.closest('[data-phase]')
        props.openView('chat', `turn:${turn}`)
        return new Promise((resolve, reject) => {
          let timer
          const cleanup = () => { observer.disconnect(); clearTimeout(timer); if (pendingSourceJump === cancel) pendingSourceJump = null }
          const cancel = () => { cleanup(); resolve() }
          const observer = new MutationObserver(locate)
          pendingSourceJump = cancel
          function locate() {
            if (props.isCurrentSession?.() === false) { cancel(); return true }
            const labels = [`跳转到第 ${turn} 轮`, `加载并跳转到第 ${turn} 轮`, `Jump to turn ${turn}`, `Load and jump to turn ${turn}`]
            const button = [...(scope?.querySelectorAll('nav button[aria-label], [aria-label="轮次导航"] button, [aria-label="Turn navigation"] button') || [])].find(item => labels.includes(item.getAttribute('aria-label')))
            if (!button) return false
            cleanup()
            button.click(); resolve(); return true
          }
          if (locate()) return
          observer.observe(document.body, { childList: true, subtree: true })
          timer = setTimeout(() => {
            cleanup()
            if (props.isCurrentSession?.() === false) { resolve(); return }
            const message = `已打开对话，请在轮次导航中选择第 ${turn} 轮。`
            window.alert(message); reject(new Error(message))
          }, 5000)
        })
      }
      return h(eventExplorerUI.EventExplorer, { ...state, sessionId: props.sessionId, onRefresh: props.refreshEvents, onEdit: () => setEditing(true), onOpenSource: openSource })
    }

    function TavernEventsView(props) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      if (agentPreset !== 'sillytavern') return h('div', { className: 'dst-explorer-unavailable' }, '时间线用于酒馆模式会话。请选择一个酒馆会话查看剧情事件。')
      return h(TavernEventsSession, { ...props, key: props.sessionId })
    }

    function TavernSettingsView({ page, title, ...props }) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      if (agentPreset !== 'sillytavern') return h('div', { className: 'dst-explorer-unavailable' }, `${title}用于酒馆模式会话。请选择一个酒馆会话。`)
      return h('section', { className: `dst-session-page${page === 'worldbook' ? ' dst-worldbook-page' : ''}`, 'data-session-id': props.sessionId, 'data-conversation-composer-overlay': '' },
        h('header', { className: 'dst-session-header' }, h('h1', null, title)),
        h(SessionSettingsContent, { key: `${props.sessionId}:${page}`, sessionId: props.sessionId, page }))
    }

    function TavernWorldbookView(props) { return h(TavernSettingsView, { ...props, page: 'worldbook', title: '世界书' }) }
    function TavernPersonaView(props) { return h(TavernSettingsView, { ...props, page: 'persona', title: '用户设定/变量' }) }
    function TavernScriptsView(props) { return h(TavernSettingsView, { ...props, page: 'scripts', title: '脚本' }) }
    function TavernTemplatesView(props) { return h(TavernSettingsView, { ...props, page: 'templates', title: '提示词模板' }) }

    function TavernPlayerChrome({ children, sessionId, inputActions, phase }) {
      const [advanced, setAdvanced] = React.useState(false)
      const marker = React.useRef(null)
      React.useEffect(() => {
        const pending = pendingPlayerDrafts.get(sessionId)
        if (!pending || phase !== 'plain') return
        pendingPlayerDrafts.delete(sessionId)
        inputActions.setDraft(pending.text)
        if (pending.submit) inputActions.submit()
      }, [sessionId, inputActions, phase])
      React.useLayoutEffect(() => {
        const root = marker.current?.closest('[data-phase]')
        if (!root) return
        root.dataset.dstPlayerTools = advanced ? 'expanded' : 'collapsed'
        const original = new Map()
        const placeholder = '输入你的行动或台词…'
        const update = () => {
          for (const input of root.querySelectorAll('[data-composer-input]')) {
            if (!original.has(input)) original.set(input, { label: input.getAttribute('aria-label'), placeholder: input.getAttribute('data-placeholder') })
            if (input.getAttribute('aria-label') !== placeholder) input.setAttribute('aria-label', placeholder)
            if (input.getAttribute('data-placeholder') !== placeholder) input.setAttribute('data-placeholder', placeholder)
          }
          for (const hint of root.querySelectorAll('[data-composer-placeholder]')) {
            if (!original.has(hint)) original.set(hint, { text: hint.textContent })
            if (hint.textContent !== placeholder) hint.textContent = placeholder
          }
        }
        update()
        const observer = new MutationObserver(update)
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'data-placeholder'] })
        return () => {
          observer.disconnect()
          delete root.dataset.dstPlayerTools
          for (const [element, value] of original) {
            if (value.text !== undefined) { if (element.textContent === placeholder) element.textContent = value.text; continue }
            for (const [name, text] of [['aria-label', value.label], ['data-placeholder', value.placeholder]]) if (element.getAttribute(name) === placeholder) {
              if (text === null) element.removeAttribute(name); else element.setAttribute(name, text)
            }
          }
        }
      }, [sessionId, advanced])
      const toolsLabel = advanced ? '收起高级工具' : '高级工具'
      return h('div', { ref: marker, style: { display: 'contents' } }, children,
        h(Button, { className: 'dst-player-advanced', title: toolsLabel, 'aria-label': toolsLabel, 'aria-expanded': advanced, onClick: () => setAdvanced(value => !value) },
          h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
            h('path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77Z' }))))
    }

    function ComposerCharacterSelect(props) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      const draft = String(props.useInput(state => state.draft) ?? '')
      const phase = props.useInput(state => state.phase)
      const draftRef = React.useRef(draft)
      const phaseRef = React.useRef(phase)
      const inputActionsRef = React.useRef(props.inputActions)
      draftRef.current = draft
      phaseRef.current = phase
      inputActionsRef.current = props.inputActions
      const appendInput = React.useCallback(value => {
        const text = String(value ?? '').trim()
        if (text === '' || text.length > 32768) throw new RangeError('script composer text is empty or too large')
        const inputActions = inputActionsRef.current
        if (phaseRef.current !== 'plain' || typeof inputActions?.setDraft !== 'function') throw new Error('conversation composer is unavailable')
        const current = draftRef.current.trim()
        const next = current === '' ? text : `${current}\n${text}`
        draftRef.current = next
        inputActions.setDraft(next)
        return { draft: next }
      }, [])
      return agentPreset === 'sillytavern' ? h(TavernPlayerChrome, { sessionId: props.sessionId, inputActions: props.inputActions, phase }, h(TavernCharacterSelect, { ...props, appendInput })) : null
    }

    function greetingSegments(input, allowHtmlFragments = false, stripOpeningMarkers = true) {
      let source = String(input ?? '')
      if (stripOpeningMarkers) source = source
        .replace(/^\s*<start>\s*(?:\r?\n|$)/i, '')
        .replace(/(?:(?:\r?\n)?\s*(?:<\/start>|<end>)\s*)+$/i, '')
        .trim()
      if (source.trim() === '') return []
      if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(source)) return [{ type: 'html', value: source }]
      const lines = source.match(/[^\n]*(?:\n|$)/g) || []
      const segments = []
      const push = (type, value) => {
        if (value === '') return
        const previous = segments.at(-1)
        if (type === 'markdown' && previous?.type === type) previous.value += value
        else segments.push({ type, value })
      }
      let fence = null
      let markdownStart = 0
      let offset = 0
      let hasFence = false
      for (const line of lines) {
        if (line === '') continue
        const end = offset + line.length
        if (fence === null) {
          const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/)
          const validOpening = opening !== null && !(opening[1][0] === '`' && opening[2].includes('`'))
          if (validOpening) {
            const info = opening[2].trim()
            fence = { char: opening[1][0], length: opening[1].length, html: /^html?$/i.test(info), bodyStart: end }
            hasFence = true
            if (fence.html && offset > markdownStart) push('markdown', source.slice(markdownStart, offset))
          }
        } else {
          const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/)
          if (closing !== null && closing[1][0] === fence.char && closing[1].length >= fence.length) {
            if (fence.html) {
              push('html', source.slice(fence.bodyStart, offset))
              markdownStart = end
            }
            fence = null
          }
        }
        offset = end
      }
      if (fence?.html) {
        push('html', source.slice(fence.bodyStart))
        markdownStart = source.length
      }
      if (markdownStart < source.length) push('markdown', source.slice(markdownStart))
      if (allowHtmlFragments && !hasFence && /<(?:style|script|div|section|article|main|aside|form|button|input|select|textarea|canvas|svg)(?:\s|>)/i.test(source)) return [{ type: 'html', value: source }]
      return segments
        .map(segment => ({ ...segment, value: stripOpeningMarkers ? segment.value.trim() : segment.value }))
        .filter(segment => segment.type === 'html' || segment.value.trim() !== '')
    }

    const standaloneCompatibilitySnapshot = Object.freeze({ schemaVersion: 1, runtimeRevision: 0, sessionId: '__standalone__', state: { sessionId: '__standalone__', binding: null, card: null, history: [] }, bindingRevision: 0, cardRecord: null, characterCard: null, character: {}, worldbook: null, persona: { name: 'User', description: '' }, variables: {}, globalVariables: {}, scriptInjections: [], currentSwipeId: 0, messages: [], context: { chatId: '__standalone__', characterId: null, groupId: null, name1: 'User', name2: 'Character', chatMetadata: {} }, compatibility: {} })

    function GreetingHtmlFrame({ sessionId, source, onSetChatMessages, onCommitSwipe, onTriggerSlash }) {
      const script = React.useMemo(() => ({ id: 'opening-html', name: '角色开场 HTML', kind: 'html', source }), [source])
      const actions = React.useMemo(() => ({
        setChatMessages: (args, channel) => {
          if (typeof onSetChatMessages !== 'function') throw new Error('opening swipe selection is unavailable after the conversation starts')
          return onSetChatMessages(args?.messages, channel)
        },
        commitSwipe: (args, channel) => {
          if (typeof onCommitSwipe !== 'function') throw new Error('opening swipe commit is unavailable after the conversation starts')
          return onCommitSwipe(args?.swipe_id, channel)
        },
        triggerSlash: args => {
          if (typeof onTriggerSlash !== 'function') throw new Error('opening slash bridge is unavailable in conversation history')
          return onTriggerSlash(args?.command)
        },
      }), [onSetChatMessages, onCommitSwipe, onTriggerSlash])
      return h(TrustedFrame, { sessionId, script, className: 'dst-opening-html', title: '角色开场 HTML', actions, initialSnapshotOverride: sessionId ? null : standaloneCompatibilitySnapshot })
    }

    function GreetingContent({ sessionId, text, onSetChatMessages, onCommitSwipe, onTriggerSlash }) {
      const segments = greetingSegments(text, true)
      return h('div', { className: 'dst-opening-text' }, ...segments.map((segment, index) => segment.type === 'html'
        ? h(GreetingHtmlFrame, { key: `html:${index}`, sessionId, source: segment.value, onSetChatMessages, onCommitSwipe, onTriggerSlash })
        : h(TavernMarkdownContent, { key: `markdown:${index}`, text: segment.value })))
    }

    function openingEchoNotice(command) {
      const match = String(command ?? '').trim().match(/^\/echo(?:\s+severity=([^\s]+))?(?:\s+([\s\S]*))?$/i)
      if (!match) throw new Error(`unsupported SillyTavern slash command: ${String(command ?? '')}`)
      const severity = ['success', 'warning', 'error', 'info'].includes(String(match[1] || '').toLowerCase()) ? String(match[1]).toLowerCase() : 'info'
      return { severity, text: String(match[2] || '').trim() || '完成' }
    }

    function RegexGreetingContent({ sessionId, text, depth = 0, ...props }) {
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [rendered, setRendered] = React.useState(text)
      React.useEffect(() => {
        const controller = new AbortController()
        setRendered(text)
        if (rules.length > 0 && String(text || '') !== '') regexEngine.run(text, rules, controller.signal, { placement: 2, isMarkdown: true, depth }, scope).then(value => { if (!controller.signal.aborted) setRendered(value.text) }).catch(() => undefined)
        return () => controller.abort()
      }, [text, fingerprint, scope, depth])
      const personalized = String(rendered ?? '').replace(/<(user|char)>/gi, (_match, name) => String(name.toLowerCase() === 'user' ? scope?.user || 'User' : scope?.char || 'Character'))
      return h(GreetingContent, { ...props, sessionId, text: personalized })
    }

    function TavernOpeningGreetingContent({ sessionId, version }) {
      const [swipeId, setSwipeId] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [reloadVersion, setReloadVersion] = React.useState(0)
      const [selecting, setSelecting] = React.useState(false)
      const sectionRef = React.useRef(null)
      const preparedSwipes = React.useRef(new Map())
      const greeting = useAsync(signal => api(`/greeting?sessionId=${encodeURIComponent(sessionId)}${swipeId === null ? '' : `&swipeId=${swipeId}`}`, { signal }), [sessionId, version, swipeId, reloadVersion])
      const openingRuntime = useAsync(signal => api(`/compat/runtime?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version, swipeId])
      React.useEffect(() => {
        if (openingRuntime.value) compatRuntime.set(sessionId, openingRuntime.value, `opening:${openingRuntime.value.bindingRevision}:${openingRuntime.value.cardRecord?.id || 'none'}:${openingRuntime.value.chatRevision ?? -1}`)
      }, [sessionId, openingRuntime.value])
      React.useEffect(() => {
        preparedSwipes.current.clear()
        setSwipeId(null)
        setNotice(null)
        return () => { preparedSwipes.current.clear() }
      }, [sessionId, version])
      const setChatMessages = React.useCallback(async (messages, channel) => {
        if (!Array.isArray(messages)) throw new TypeError('setChatMessages expects an array')
        const update = messages.find(message => Number(message?.message_id) === 0 && Number.isSafeInteger(Number(message?.swipe_id)))
        if (update === undefined) throw new TypeError('opening setChatMessages requires message_id 0 and a safe integer swipe_id')
        const nextSwipe = Number(update.swipe_id)
        const swipeCount = Number(greeting.value?.swipeCount)
        if (nextSwipe < 0 || !Number.isSafeInteger(swipeCount) || nextSwipe >= swipeCount) throw new RangeError(`opening swipe_id ${nextSwipe} is unavailable`)
        const selected = await api('/opening/select', { method: 'POST', body: JSON.stringify({ sessionId, swipeId: nextSwipe }) })
        if (Number(selected?.swipeId) !== nextSwipe) throw new Error('opening swipe selection was not committed')
        preparedSwipes.current.set(channel, nextSwipe)
        return { message_id: 0, swipe_id: nextSwipe }
      }, [sessionId, greeting.value?.swipeCount])
      const commitSwipe = React.useCallback((value, channel) => {
        const nextSwipe = Number(value)
        if (!Number.isSafeInteger(nextSwipe) || preparedSwipes.current.get(channel) !== nextSwipe) throw new Error('opening swipe commit does not match the prepared frame selection')
        preparedSwipes.current.delete(channel)
        setSwipeId(nextSwipe)
        return { message_id: 0, swipe_id: nextSwipe }
      }, [])
      const triggerSlash = React.useCallback(command => {
        const next = openingEchoNotice(command)
        setNotice(next)
        return next.text
      }, [])
      React.useLayoutEffect(() => {
        const content = sectionRef.current?.querySelector('.dst-opening-text')
        if (content) content.scrollTop = 0
      }, [greeting.value?.text])
      const chooseOpening = async nextSwipe => {
        setSelecting(true)
        try {
          const selected = await api('/opening/select', { method: 'POST', body: JSON.stringify({ sessionId, swipeId: nextSwipe }) })
          setSwipeId(Number(selected.swipeId))
          setNotice({ severity: 'info', text: '开场已切换。输入你的行动或台词开始剧情。' })
        } catch (error) { setNotice({ severity: 'error', text: `切换失败：${error.message}` }) }
        finally { setSelecting(false) }
      }
      if (greeting.error) return h('div', { className: 'dst-error', role: 'alert' }, `开场加载失败：${greeting.error}`, h(Button, { onClick: () => setReloadVersion(value => value + 1) }, '重新加载开场'))
      if (!greeting.value?.text) return h('div', { className: 'dst-opening-empty', role: 'status' }, greeting.loading ? '正在加载角色开场…' : '先选择角色卡，再选择开场并填写玩家身份。', h(Button, { onClick: () => overlay.open('manager', sessionId) }, '选择或导入角色卡'))
      const selectedSwipe = Number(greeting.value.swipeId || 0)
      const swipeCount = Number(greeting.value.swipeCount || 1)
      return h('section', {
        ref: sectionRef,
        className: 'dst-opening-greeting',
        'aria-label': '角色开场预览',
        'aria-live': 'polite',
        'aria-busy': greeting.loading || undefined,
      },
      h('header', { className: 'dst-opening-header' },
        h(TavernMugIcon, { className: 'dst-opening-icon' }),
        h('strong', { className: 'dst-opening-name' }, greeting.value.characterName),
        swipeCount > 1 ? h('div', { className: 'dst-actions dst-opening-controls' },
          h(Button, { className: 'secondary small', disabled: selecting || selectedSwipe === 0, onClick: () => void chooseOpening(selectedSwipe - 1) }, '上一开场'),
          h('select', { 'aria-label': '选择开场', value: selectedSwipe, disabled: selecting, onChange: event => void chooseOpening(Number(event.target.value)) }, Array.from({ length: swipeCount }, (_, index) => h('option', { key: index, value: index }, index === 0 ? '角色介绍 / 初始开场' : `开场 ${index + 1}`))),
          h(Button, { className: 'secondary small', disabled: selecting || selectedSwipe === swipeCount - 1, onClick: () => void chooseOpening(selectedSwipe + 1) }, '下一开场'),
          selectedSwipe > 0 ? h(Button, { className: 'secondary small', disabled: selecting, onClick: () => void chooseOpening(0) }, '重新选开场') : null) : null),
      h(RegexGreetingContent, { sessionId, text: greeting.value.text, onSetChatMessages: setChatMessages, onCommitSwipe: commitSwipe, onTriggerSlash: triggerSlash }),
      h('footer', { className: `dst-opening-hint${notice ? ` ${notice.severity}` : ''}`, role: notice ? 'status' : undefined }, notice?.text || '发送第一条消息后开始对话'))
    }

    function TavernOpeningGreeting({ sessionId }) {
      const version = useOverlay().dataVersion
      return h(TavernOpeningGreetingContent, { key: sessionId, sessionId, version })
    }

    function BlankSessionSettings({ sessionId }) {
      const [page, setPage] = React.useState('opening')
      const pages = [['opening', '开场'], ['worldbook', '世界书'], ['persona', '用户设定/变量'], ['scripts', '脚本'], ['templates', '提示词模板']]
      return h('section', { className: 'dst-blank-settings', 'aria-label': '酒馆会话设置' },
        h('nav', { className: 'dst-tabs', 'aria-label': '酒馆会话页面' }, pages.map(([id, label]) => h(Button, {
          key: id,
          className: page === id ? 'tab active' : 'tab',
          'aria-pressed': page === id,
          onClick: () => setPage(id),
        }, label))),
        page === 'opening'
          ? h(TavernOpeningGreeting, { sessionId })
          : h(SessionSettingsContent, { key: `${sessionId}:${page}`, sessionId, page }))
    }

    function ComposerOpeningGreeting(props) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      if (agentPreset !== 'sillytavern' || props.session?.blank !== true) return null
      return h(BlankSessionSettings, { key: props.sessionId, sessionId: props.sessionId })
    }

    function TavernNarratorMessage({ node, sessionId }) {
      const text = node?.outcome?.kind === 'success' ? String(node.outcome.text ?? '') : ''
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const eventState = useSessionStore(scriptEvents, sessionId)
      const commandSeq = node?.run?.seq ?? node?.seq
      const depth = (eventState?.history || []).filter(message => Number(message?.seq) > Number(commandSeq) && (message?.role === 'user' || message?.role === 'assistant')).length
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [rendered, setRendered] = React.useState(text)
      React.useEffect(() => {
        const controller = new AbortController()
        setRendered(text)
        if (text !== '' && rules.length > 0) regexEngine.run(text, rules, controller.signal, { placement: 3, isMarkdown: true, depth }, scope).then(value => { if (!controller.signal.aborted) setRendered(value.text) }).catch(() => undefined)
        return () => controller.abort()
      }, [text, fingerprint, scope, depth])
      return rendered === '' ? null : h('article', { className: 'dst-opening-message', 'aria-label': '旁白' }, h(ScriptConversationContent, { sessionId, seq: `narrator-${node?.run?.seq || 'message'}`, text: rendered, eventState, label: '旁白' }))
    }

    function TavernOpeningMessage({ node, sessionId }) {
      const text = node?.outcome?.kind === 'success' ? node.outcome.text : ''
      const eventState = useSessionStore(scriptEvents, sessionId)
      const depth = (eventState?.history || []).filter(message => message?.role === 'user' || message?.role === 'assistant').length
      if (typeof text !== 'string' || text.trim() === '') return null
      return h('article', { className: 'dst-opening-message', 'aria-label': '角色开场' }, h(RegexGreetingContent, { sessionId, text, depth }))
    }

    const SESSION_CSS = `
.dst-manager-hint{flex:none;margin:0;padding:10px 16px;color:var(--dsw-alias-label-secondary,#64748b);font-size:12px;line-height:1.6}
.dst-session-page{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;padding-bottom:calc(var(--dsh-composer-height,152px) + 8px);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#182033);font:14px/1.5 system-ui,sans-serif}
.dst-session-header{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e8f0)}.dst-session-header h1{margin:0;font-size:18px}
.dst-session-content{box-sizing:border-box;min-width:0;min-height:0;flex:1;overflow:auto;padding:16px;scrollbar-gutter:stable}.dst-session-content .dst-worldbook-controls{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}
.dst-session-page .dst-confirm-layer,.dst-blank-settings .dst-confirm-layer{z-index:100}
.dst-blank-settings{box-sizing:border-box;display:flex;flex:0 0 auto;flex-direction:column;width:100%;min-width:0;color:var(--dsw-alias-label-primary,#182033);font:14px/1.5 system-ui,sans-serif}.dst-blank-settings>.dst-tabs{flex:none;padding:8px 0}.dst-blank-settings .dst-tabs button{white-space:nowrap}.dst-blank-settings>.dst-session-content{flex:none;height:max(280px,calc(100dvh - 310px))}.dst-blank-settings .dst-opening-greeting{height:max(280px,calc(100dvh - 310px))}
@media(max-width:900px){.dst-session-content .dst-worldbook-controls{grid-template-columns:1fr}}@media(max-width:560px){.dst-blank-settings>.dst-session-content,.dst-blank-settings .dst-opening-greeting{height:max(280px,calc(100dvh - 350px))}.dst-session-header{padding:10px 14px}.dst-session-content{padding:12px}.dst-worldbook-page .dst-worldbook-save{right:14px}}
`

    const CSS = `
.dst-event-context-form{margin-top:14px;padding:12px;border:1px solid #dce3ed;border-radius:10px}.dst-event-context-form>.dst-section-title{font-size:14px;margin-bottom:4px}.dst-memory-context{display:flex;flex-wrap:wrap;gap:6px 14px;color:#475569;font-size:12px}.dst-memory-context>span{overflow-wrap:anywhere}
.dst-overlay{position:fixed;inset:0;z-index:90;pointer-events:none;font:14px/1.45 system-ui,sans-serif;color:#182033}.dst-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.42);pointer-events:auto}.dst-dialog-wrap{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}.dst-dialog-card{width:min(520px,calc(100vw - 32px));background:var(--dsh-surface,#fff);border:1px solid #ccd5e3;border-radius:16px;padding:20px;box-shadow:0 24px 70px #0f172a55;pointer-events:auto}.dst-dialog-title{font-size:18px;font-weight:750;margin-bottom:8px}.dst-manager{position:absolute;inset:0;width:100vw;height:100dvh;box-sizing:border-box;background:var(--dsh-surface,#fff);border:0;border-radius:0;box-shadow:none;overflow:hidden;pointer-events:auto;display:flex;flex-direction:column}.dst-manager>header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e2e8f0}.dst-manager>header strong{display:block;font-size:17px}.dst-manager>header span{display:block;color:#64748b;font-size:12px}.dst-manager-content{min-height:0;display:flex;flex-direction:column;flex:1}.dst-manager .dst-manager-content{overflow:hidden}.dst-settings .dst-manager-content{min-height:520px}.dst-current{padding:9px 16px;background:#eef6ff;color:#24548a}.dst-current.empty{background:#fff7db;color:#76520b}.dst-tabs{display:flex;gap:5px;padding:10px 12px;border-bottom:1px solid #e2e8f0;overflow-x:auto}.dst-tab-body{padding:16px;overflow:auto;flex:1}.dst-button{border:0;border-radius:9px;padding:8px 12px;background:#326fd1;color:white;cursor:pointer;font:inherit}.dst-button:disabled{opacity:.5;cursor:not-allowed}.dst-button.secondary,.dst-button.tab{background:#eef2f7;color:#334155}.dst-button.active,.dst-button.tab.active{background:#dcecff;color:#174c8d}.dst-button.small{padding:5px 9px;font-size:12px}.dst-button.danger{background:#fee2e2;color:#a51f2a}.dst-header-button{padding:5px 9px;background:#f3e8ff;color:#6b21a8;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-actions{display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap}.dst-field{display:flex;flex-direction:column;gap:5px;margin:9px 0;min-width:0;flex:1}.dst-field>span{font-size:12px;font-weight:650;color:#475569}.dst-field input,.dst-field textarea,.dst-field select{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:var(--dsh-surface,#fff);color:inherit;font:inherit}.dst-field textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.dst-inline-fields{display:flex;gap:10px}.dst-section-title{font-size:16px;font-weight:750;margin-bottom:10px}.dst-muted{color:#64748b;font-size:12px}.dst-warning{background:#fff4d6;border:1px solid #f0cb69;color:#744d00;padding:9px;border-radius:8px}.dst-status{min-height:20px}.dst-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.dst-card{border:1px solid #dce3ed;border-radius:11px;padding:12px;display:flex;flex-direction:column;gap:6px}.dst-tags,.dst-memory-keywords{display:flex;gap:4px;flex-wrap:wrap}.dst-tags span,.dst-memory-keywords span{font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:999px}.dst-memory-table{display:flex;flex-direction:column;gap:7px;margin-top:12px}.dst-memory-row{display:flex;justify-content:space-between;gap:12px;border:1px solid #dce3ed;border-radius:9px;padding:9px}.dst-memory-row pre{margin:5px 0 0;white-space:pre-wrap;font-size:11px}.dst-script{border:1px solid #dce3ed;border-radius:10px;padding:12px;margin:12px 0}.dst-trusted-frame,.dst-turn-render iframe{width:100%;min-height:260px;border:1px solid #cbd5e1;border-radius:8px;background:white}.dst-template-list{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}.dst-turn-render{margin:8px 0;padding:8px;border:1px solid #e2e8f0;border-radius:9px}.dst-turn-render summary{cursor:pointer;color:#6b21a8}.dst-settings{padding:8px 4px}.dst-settings h2{margin-top:0}.dst-loading,.dst-error{padding:20px}.dst-error{color:#b91c1c}.dst-confirm-layer{position:fixed;inset:0;z-index:8;display:grid;place-items:center;padding:16px;background:#0f172a66;pointer-events:auto}.dst-confirm-card{box-sizing:border-box;width:min(600px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border:1px solid #ccd5e3;border-radius:14px;background:var(--dsh-surface,#fff);box-shadow:0 24px 70px #0f172a66}.dst-reference-list{margin:10px 0;padding:10px 12px;border:1px solid #dce3ed;border-radius:9px}.dst-reference-list ul{margin:6px 0 0;padding-left:20px}.dst-worldbook-controls{display:grid;grid-template-columns:minmax(260px,1fr) auto minmax(260px,1fr);align-items:end;gap:12px;margin-bottom:14px;padding:12px;border:1px solid #dce3ed;border-radius:11px}.dst-worldbook-controls>.dst-muted{grid-column:1/-1;margin:0}.dst-worldbook-resource-actions{align-self:end;margin:9px 0}.dst-worldbook-resource-actions .dst-button{white-space:nowrap}@media(max-width:900px){.dst-worldbook-controls{grid-template-columns:1fr}.dst-worldbook-controls>.dst-muted{grid-column:auto}}@media(max-width:640px){.dst-inline-fields{display:block}.dst-manager{inset:0;width:100vw;height:100dvh}.dst-card-grid{grid-template-columns:1fr}}
.dst-worldbook-book{padding:10px 12px;border:1px solid #dce3ed;border-radius:11px;background:color-mix(in srgb,var(--dsh-surface,#fff) 96%,#326fd1 4%)}.dst-worldbook-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#475569;cursor:pointer}.dst-worldbook-check input{margin:0}.dst-worldbook-setting{align-self:center;min-height:36px;padding-top:16px;box-sizing:border-box}.dst-worldbook-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 8px}.dst-worldbook-list{display:flex;flex-direction:column;gap:10px}.dst-worldbook-entry{content-visibility:auto;contain-intrinsic-size:92px 620px;border:1px solid #dce3ed;border-radius:11px;background:var(--dsh-surface,#fff);overflow:hidden}.dst-worldbook-entry.disabled{opacity:.72}.dst-worldbook-entry-head{display:flex;align-items:center;gap:9px;padding:10px 12px}.dst-worldbook-entry-head strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-worldbook-order{white-space:nowrap}.dst-worldbook-entry>details{border-top:1px solid #e2e8f0}.dst-worldbook-entry summary,.dst-worldbook-advanced summary{padding:8px 12px;color:#326fd1;cursor:pointer;user-select:none}.dst-worldbook-entry-body{padding:4px 12px 12px}.dst-worldbook-policies{display:inline-flex;flex:0 0 auto;gap:4px;padding:3px;border:1px solid #d7deea;border-radius:10px;background:#f4f7fb}.dst-worldbook-policy{border:0;border-radius:7px;padding:5px 8px;background:transparent;color:#475569;font:inherit;font-size:12px;cursor:pointer}.dst-worldbook-policy.active{background:var(--dsh-surface,#fff);box-shadow:0 1px 4px #0f172a22;color:#172033}.dst-worldbook-policy.constant>span{color:#3478dc}.dst-worldbook-policy.keyword>span{color:#28a35a}.dst-worldbook-policy.vectorized>span{filter:saturate(.7)}.dst-worldbook-vector-note{margin:6px 0;font-size:12px}.dst-worldbook-advanced{margin-top:10px;border:1px solid #e2e8f0;border-radius:9px}.dst-worldbook-advanced-body{padding:0 10px 10px}.dst-worldbook-save{justify-content:flex-end;margin:0 0 12px}.dst-worldbook-save>button{flex:none;white-space:nowrap}.dst-worldbook-page{position:relative}.dst-worldbook-page>.dst-session-header{box-sizing:border-box;min-height:58px;padding-right:160px}.dst-worldbook-page .dst-worldbook-save{position:absolute;top:0;right:18px;z-index:3;min-height:58px;max-width:calc(100% - 150px);margin:0;flex-wrap:nowrap}.dst-worldbook-page .dst-worldbook-save>.dst-muted{max-height:48px;overflow:auto;overflow-wrap:anywhere}@media(max-width:640px){.dst-worldbook-entry-head{flex-wrap:wrap}.dst-worldbook-entry-head strong{flex-basis:45%}.dst-worldbook-policies-head{width:100%;box-sizing:border-box}.dst-worldbook-policy{flex:1}.dst-worldbook-setting{padding-top:4px}}
.dst-opening-greeting{box-sizing:border-box;width:100%;height:max(320px,calc(100dvh - 260px));min-height:0;margin:0 0 8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,#dfe3ea);border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#182033);box-shadow:0 4px 18px rgba(15,23,42,.06);font:14px/1.55 system-ui,sans-serif;display:flex;flex:0 0 auto;flex-direction:column;overflow:hidden}.dst-opening-header{display:flex;flex:0 0 auto;align-items:center;gap:7px;margin-bottom:8px}.dst-opening-icon{flex:0 0 auto;color:var(--dsw-alias-brand-primary,#326fd1)}.dst-opening-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.dst-opening-text{display:flex;flex:1 1 auto;flex-direction:column;gap:10px;min-height:0;max-height:none;overflow:auto;white-space:normal;overflow-wrap:anywhere}.dst-opening-html{display:block;box-sizing:border-box;width:100%;height:auto;min-height:0;flex:0 0 auto;border:0;border-radius:10px;background:var(--dsw-alias-bg-base,#fff)}.dst-opening-hint{flex:0 0 auto;margin-top:9px;color:var(--dsw-alias-label-secondary,#64748b);font-size:12px}.dst-opening-message{box-sizing:border-box;width:100%;padding:4px 16px 12px;color:var(--dsw-alias-label-primary,#182033);font:15px/1.65 system-ui,sans-serif}.dst-opening-message .dst-opening-text{display:flex;flex-direction:column;gap:10px;max-height:none;overflow:visible}.dst-opening-message .dst-opening-html{min-height:0;flex:0 0 auto}@media(max-width:560px){.dst-opening-greeting{height:max(320px,calc(100dvh - 300px))}}.dst-composer-character{display:inline-flex;align-items:center;min-width:0;max-width:min(100%,220px);flex:0 1 auto}.dst-character-menu{min-width:0;max-width:100%;flex:0 1 auto}.dst-character-seat{position:relative;display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;max-width:min(100%,220px);min-width:0;min-height:28px;padding:0 8px;border:0;border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary,var(--dsh-text,#182033));font:500 13px/20px system-ui,sans-serif;white-space:nowrap;overflow:hidden;cursor:pointer}.dst-character-seat:not(:disabled):hover,.dst-character-seat[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,#eef2f7)}.dst-character-seat:disabled{cursor:default;color:var(--dsw-alias-label-quaternary,#9aa1ad)}.dst-character-seat.compact{max-width:180px}.dst-character-icon,.dst-character-chevron{flex:0 0 auto;color:var(--dsw-alias-label-primary,#182033)}.dst-character-chevron{color:var(--dsw-alias-label-caption,#81858c)}.dst-character-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-character-seat.compact .dst-character-label{flex:0 0 auto;width:max-content}.dst-character-seat.compact.icon-only{width:28px;max-width:28px;flex:0 0 28px;justify-content:center;padding:0 6px}.dst-character-seat.compact.icon-only .dst-character-label{position:absolute;visibility:hidden;pointer-events:none}.dst-character-seat.compact.icon-only .dst-character-chevron{display:none}.dst-character-seat:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#8fb5f5);outline-offset:2px}
`
    const RUNTIME_CSS = `
.dst-trusted-frame-shell{position:relative;display:block;width:100%;min-width:0}.dst-opening-text>.dst-trusted-frame-shell,.dst-script-conversation>.dst-trusted-frame-shell{flex:0 0 auto}.dst-script-frame-status,.dst-script-frame-error{box-sizing:border-box;width:100%;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2,#cbd5e1);border-radius:9px;background:var(--dsw-alias-bg-layer-2,#f8fafc);color:var(--dsw-alias-label-secondary,#64748b);font-size:12px}.dst-script-frame-error{display:flex;align-items:center;justify-content:space-between;gap:10px;border-style:solid;border-color:#fecaca;background:#fff7f7;color:#b91c1c}.dst-script-frame-error>span{min-width:0;overflow-wrap:anywhere}.dst-script-frame-source{margin-top:6px;color:var(--dsw-alias-label-secondary,#64748b);font-size:12px}.dst-script-frame-source>summary{cursor:pointer}.dst-script-frame-source>pre{box-sizing:border-box;max-height:280px;margin:7px 0 0;padding:10px;overflow:auto;border-radius:8px;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.dst-event-empty-state{margin:12px 0;padding:28px 16px;border:1px dashed #cbd5e1;border-radius:11px;color:#64748b;text-align:center}.dst-memory-table{gap:12px}.dst-memory-row{content-visibility:auto;contain-intrinsic-size:180px;display:flex;flex-direction:column;gap:12px;border-radius:12px;padding:14px;background:var(--dsh-surface,#fff)}.dst-memory-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dst-memory-identity{display:flex;min-width:0;align-items:center;gap:8px}.dst-memory-identity strong{overflow-wrap:anywhere}.dst-memory-table-name{flex:none;padding:2px 8px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:11px;font-weight:700}.dst-memory-meta{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:8px;color:#64748b;font-size:11px}.dst-memory-value{min-width:0;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--dsh-surface,#fff) 94%,#326fd1 6%)}.dst-memory-fields{display:flex;flex-direction:column;margin:0}.dst-memory-field{display:grid;grid-template-columns:minmax(90px,25%) minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid #dce3ed}.dst-memory-field:first-child{padding-top:0}.dst-memory-field:last-child{padding-bottom:0;border-bottom:0}.dst-memory-field dt{color:#64748b;font-size:12px;font-weight:650;overflow-wrap:anywhere}.dst-memory-field dd{min-width:0;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.dst-memory-array{display:flex;flex-direction:column;gap:5px;margin:0;padding-left:24px}.dst-memory-array>li{padding-left:3px}.dst-memory-scalar.number{color:#6b21a8;font-variant-numeric:tabular-nums}.dst-memory-scalar.boolean{display:inline-block;padding:1px 7px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:12px}.dst-memory-scalar.boolean.false{background:#f1f5f9;color:#64748b}.dst-memory-scalar.null,.dst-memory-scalar.empty,.dst-memory-empty{color:#94a3b8;font-style:italic}.dst-memory-nested{min-width:0;border:1px solid #dce3ed;border-radius:8px;background:var(--dsh-surface,#fff)}.dst-memory-nested>summary{padding:5px 8px;color:#326fd1;cursor:pointer;font-size:12px;user-select:none}.dst-memory-nested>.dst-memory-fields,.dst-memory-nested>.dst-memory-array{margin:0 8px 8px}.dst-memory-row-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dst-memory-raw{min-width:0;color:#64748b;font-size:12px}.dst-memory-raw>summary{cursor:pointer;user-select:none}.dst-memory-raw pre{box-sizing:border-box;max-width:min(720px,calc(100vw - 96px));max-height:300px;margin:8px 0 0;padding:10px;overflow:auto;border-radius:8px;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:640px){.dst-memory-row-head{flex-direction:column}.dst-memory-meta{flex-wrap:wrap;justify-content:flex-start}.dst-memory-field{grid-template-columns:1fr;gap:3px}.dst-memory-row-actions{align-items:flex-end}}
.dst-event-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:22px 0 10px}.dst-event-section-head>.dst-section-title{margin:0}.dst-event-empty{padding:14px;border:1px dashed #cbd5e1;border-radius:10px}.dst-event-graph{display:flex;flex-direction:column;gap:14px}.dst-event-node{content-visibility:auto;contain-intrinsic-size:260px;border:1px solid #cbd5e1;border-radius:12px;padding:14px;background:color-mix(in srgb,var(--dsh-surface,#fff) 97%,#326fd1 3%)}.dst-event-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.dst-event-head strong{overflow-wrap:anywhere}.dst-event-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.dst-event-relations{min-width:0;padding:9px 10px;border:1px solid #dce3ed;border-radius:9px;background:var(--dsh-surface,#fff);font-size:12px}.dst-event-relations>strong{display:block;margin-bottom:4px;color:#475569}.dst-event-relations ul{display:flex;flex-direction:column;gap:4px;margin:0;padding-left:18px}.dst-event-relations li{overflow-wrap:anywhere}.dst-event-relations code{color:#24548a}.dst-event-relations small{display:block;color:#64748b}.dst-event-memory-rows{margin-top:12px}.dst-event-ungrouped{margin-top:22px}.dst-memory-provenance{flex-basis:100%}@media(max-width:640px){.dst-event-section-head{display:block}.dst-event-links{grid-template-columns:1fr}}
.dst-markdown-content{display:flow-root;min-width:0;overflow-wrap:anywhere}.dst-markdown-content>*>:first-child,.dst-legacy-font>*>:first-child{margin-top:0}.dst-markdown-content>*>:last-child,.dst-legacy-font>*>:last-child{margin-bottom:0}.dst-legacy-font{margin:0 0 1em;color:inherit}.dst-assistant-message{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary,#182033);font:15px/1.65 system-ui,sans-serif}.dst-assistant-message>*>:first-child{margin-top:0}.dst-assistant-message>[data-turn-process-inline][hidden]{margin-bottom:0}.dst-user-row{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.dst-user-stack{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px)*.702),82%)}.dst-user-message{box-sizing:border-box;max-width:100%;padding:10px 16px;border-radius:22px;background:var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-2,#eef2f7));color:var(--dsw-alias-label-primary,#182033);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}.dst-user-message>*>:first-child{margin-top:0}.dst-user-message>*>:last-child{margin-bottom:0}.dst-assistant-reasoning{margin:8px 0;color:var(--dsw-alias-label-secondary,#64748b)}.dst-assistant-reasoning>summary{cursor:pointer}.dst-assistant-reasoning>pre,.dst-assistant-unknown{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 ui-monospace,monospace}.dst-assistant-stopped,.dst-script-render-error{display:block;margin-top:6px;color:#b45309;font-size:12px}.dst-script-rendering{padding:8px 0;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px}.dst-script-conversation{display:flex;width:100%;min-width:0;flex-direction:column;gap:10px}.dst-script-conversation .dst-trusted-frame{display:block;width:100%;min-height:0;border:0;border-radius:12px;background:var(--dsw-alias-bg-base,#fff)}
.dst-story-progress-toggle{box-sizing:border-box;display:flex;align-items:center;width:100%;min-width:0;height:33px;margin-bottom:8px;padding:0 0 8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:none;color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer;text-align:left;font:inherit}.dst-story-progress-label{min-width:0;overflow:hidden;font-size:14px;line-height:24px;text-overflow:ellipsis;white-space:nowrap}.dst-story-progress-chevron{flex:none;width:16px;height:16px;margin-left:6px;color:var(--dsw-alias-label-tertiary,#81858c);transform:rotate(-90deg);transition:transform 100ms ease}.dst-story-progress-toggle[data-open] .dst-story-progress-chevron{transform:rotate(0deg)}.dst-story-progress-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#8fb5f5);outline-offset:2px}[data-chat-flow-kind='system-prompt']:has([data-dst-system-prompt-hidden]){display:none}@media(prefers-reduced-motion:reduce){.dst-story-progress-chevron{transition:none}}
`

    const inject = ['slots', 'commandUi', 'conversation', 'sessions']
    const PLAYER_CSS = `
.dst-player-new-story{padding:8px 16px}.dst-player-message-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dst-player-message-action{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary,#87909f);cursor:pointer}.dst-player-message-action>span{display:inline-flex}.dst-player-message-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}.dst-player-message-action:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-secondary,#667085)}.dst-player-message-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#326fd1);outline-offset:2px}.dst-player-message-action[aria-disabled="true"]{opacity:.4;cursor:default}.dst-player-message-action[aria-disabled="true"]:hover{background:transparent;color:var(--dsw-alias-label-tertiary,#87909f)}.dst-player-action-editor{width:100%;padding:10px}.dst-player-action-editor textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--dsw-alias-border-l1,#dfe3ea);border-radius:8px;resize:vertical;font:inherit}.dst-player-action-editor .dst-button{margin-right:8px}
[data-dst-player-tools="collapsed"] [aria-label^="访问模式"],[data-dst-player-tools="collapsed"] [aria-label^="上下文已用"],[data-dst-player-tools="collapsed"] div:has(>[aria-label="子代理模型"]){display:none!important}
.dst-button.dst-player-advanced{display:inline-flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:30px;padding:0;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:inherit;transition:background-color .15s,color .15s}.dst-player-advanced svg{display:block;flex:none}.dst-button.dst-player-advanced:hover{background:color-mix(in srgb,currentColor 10%,var(--dsw-alias-bg-layer-2,#f3f4f6))}.dst-button.dst-player-advanced[aria-expanded="true"]{background:color-mix(in srgb,#326fd1 14%,var(--dsw-alias-bg-layer-1,#fff));color:#326fd1}.dst-button.dst-player-advanced:focus-visible{outline:2px solid #326fd1;outline-offset:2px}
.dst-card-cover{display:block;width:100%;height:160px;object-fit:cover;object-position:center 25%;border-radius:8px}.dst-card-cover[hidden]{display:none}
.dst-character-seat.compact .dst-character-label{flex:1 1 auto;width:auto}.dst-character-seat.compact{min-width:100px}.dst-character-seat.compact.icon-only{width:100px;max-width:100px;flex:0 1 100px;padding:0 6px;justify-content:flex-start}.dst-character-seat.compact.icon-only .dst-character-label{position:static;visibility:visible;pointer-events:auto}.dst-character-seat.compact.icon-only .dst-character-chevron{display:block}
.dst-opening-header{flex-wrap:wrap}.dst-opening-controls{margin-left:auto;flex-wrap:wrap;gap:6px}.dst-opening-controls select{min-width:130px;max-width:240px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1,#dfe3ea);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}.dst-advanced-settings{margin:16px 0}.dst-advanced-settings>summary{cursor:pointer;font-weight:600;margin-bottom:12px}.dst-player-failure{margin:12px 16px;padding:16px;border:1px solid #e4b4a8;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);font:14px/1.6 system-ui,sans-serif}.dst-player-failure p{margin:6px 0}.dst-player-failure blockquote{white-space:pre-wrap;margin:8px 0;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#f5f6f8);border-radius:8px}.dst-player-failure details{margin-top:12px}.dst-player-failure pre{white-space:pre-wrap;overflow-wrap:anywhere}.dst-player-failure .dst-actions{display:flex;gap:8px;flex-wrap:wrap}
`

    function apply(ctx) {
      const conversation = ctx.get('conversation')
      const sessions = ctx.get('sessions')
      if (conversation === undefined || sessions === undefined) return
      playerSessions = sessions
      ctx.effect(() => () => { playerSessions = null; pendingPlayerDrafts.clear() })
      const style = document.createElement('style')
      style.dataset.dshSillyTavern = 'true'
      style.textContent = `${CSS}${RUNTIME_CSS}${eventExplorerUI.css}${SESSION_CSS}${PLAYER_CSS}`
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove())
      ctx.effect(() => () => overlay.reset())
      ctx.effect(() => () => { pendingSourceJump?.(); pendingSourceJump = null })
      ctx.effect(() => compatRuntime.start())
      ctx.effect(() => () => { scriptPolicies.reset(); scriptScopes.reset(); scriptEvents.reset(); compatRuntime.reset(); regexEngine.dispose() })
      const eventSources = new Map()
      ctx.effect(() => () => { for (const source of eventSources.values()) source.dispose(); eventSources.clear() })
      const registerEventView = () => ctx.slots.register({
        name: 'conversation.view', id: 'sillytavern-events', order: 20, label: '时间线',
        inject: sessionId => {
          let source = eventSources.get(sessionId)
          if (source === undefined) {
            source = eventExplorerSource.createEventExplorerSource({
              load: (revision, signal) => api(`/events?sessionId=${encodeURIComponent(sessionId)}${revision === undefined ? '' : `&revision=${revision}`}`, { signal }),
              isVisible: () => document.visibilityState !== 'hidden',
              subscribeVisibility: listener => {
                document.addEventListener('visibilitychange', listener)
                return () => document.removeEventListener('visibilitychange', listener)
              },
            })
            eventSources.set(sessionId, source)
          }
          return { hooks: { eventExplorer: source }, refreshEvents: source.refresh, isCurrentSession: () => ctx.get('sessions')?.list.getSnapshot().current === sessionId }
        },
      }, TavernEventsView)
      const registerMessageRenderers = () => {
        const disposeAssistant = ctx.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', priority: -20 }, TavernAssistantNode)
        const disposeUser = ctx.slots.register({ name: 'conversation.chat.node', key: 'user', priority: -20 }, TavernUserNode)
        const disposeSteering = ctx.slots.register({ name: 'conversation.chat.node', key: 'steering', priority: -20 }, TavernUserNode)
        const disposeTurnProcess = ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-process', locale: 'chat', priority: -20 }, TavernTurnProcessNode)
        const disposeSystemPrompt = ctx.slots.register({ name: 'conversation.chat.node', key: 'system-prompt', locale: 'chat', priority: -20 }, TavernSystemPromptNode)
        const disposeFailure = ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-error', priority: -20 }, TavernFailureNode)
        const disposeMessageActions = ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'sillytavern-player-actions', order: 15 }, TavernMessageActions)
        return () => { disposeMessageActions(); disposeFailure(); disposeSystemPrompt(); disposeTurnProcess(); disposeSteering(); disposeUser(); disposeAssistant() }
      }

      ctx.effect(() => ctx.commandUi.decorate({
        name: 'st-import',
        available: () => true,
        ui: {
          kind: 'popupSelect',
          async options() {
            return [
              { id: 'file', label: '导入 V3 角色卡', detail: 'PNG、APNG 或 JSON；绑定到当前会话' },
              { id: 'manager', label: '打开酒馆管理', detail: '角色库、角色卡与角色脚本' },
            ]
          },
          onSelect(option, session) {
            overlay.open(option.id === 'file' ? 'import' : 'manager', session.sessionId)
          },
        },
      }))

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'sillytavern-character', order: 25, label: '角色卡', inject: () => ({ blocks: conversation.blocks, registerMessageRenderers }) }, ComposerCharacterSelect))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'sillytavern-opening-greeting', order: -10, label: '角色开场预览' }, ComposerOpeningGreeting))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sillytavern-overlay', order: 60, label: '酒馆模式' }, OverlaySurface))
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'sillytavern', order: 18, label: '酒馆模式' }, SettingsSection))
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'st-opening' }, TavernOpeningMessage))
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'narrator' }, TavernNarratorMessage))
      // DSH derives the tab bar from the global slot roster, before rendering
      // any view component. Keep these entries mounted only for a Tavern seat.
      ctx.slots.inject('conversation.view', () => {
        let disposeViews = null
        const syncViews = () => {
          const state = sessions.list.getSnapshot()
          const enabled = sessionAgentPreset(state.byId[state.current]) === 'sillytavern'
          if (enabled === (disposeViews !== null)) return
          if (!enabled) {
            const dispose = disposeViews
            disposeViews = null
            dispose()
            return
          }
          const disposers = [registerEventView()]
          for (const [id, order, label, component] of [
            ['sillytavern-worldbook', 21, '世界书', TavernWorldbookView],
            ['sillytavern-persona', 22, '用户设定/变量', TavernPersonaView],
            ['sillytavern-scripts', 23, '脚本', TavernScriptsView],
            ['sillytavern-templates', 24, '提示词模板', TavernTemplatesView],
          ]) disposers.push(ctx.slots.register({ name: 'conversation.view', id, order, label }, component))
          disposeViews = () => { for (const dispose of disposers.reverse()) dispose() }
        }
        const unsubscribe = sessions.list.subscribe(syncViews)
        syncViews()
        return () => { unsubscribe(); disposeViews?.(); disposeViews = null }
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
