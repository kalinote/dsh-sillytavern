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
