import assert from 'node:assert/strict'
import test from 'node:test'
import createUI from '../src/client/event-explorer-ui.cjs'
import model from '../src/client/event-explorer-model.cjs'

// Expand the presentation tree without a browser; browser smoke covers actual hooks/dialogs.
function render(document, initialStates = [], extra = {}) {
  let hookIndex = 0
  const changes = []
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = hookIndex++
      const supplied = index < initialStates.length && initialStates[index] !== undefined
      return [supplied ? initialStates[index] : initial, value => changes.push({ index, value })]
    },
    useRef: current => ({ current }),
    useMemo: compute => compute(),
    useCallback: callback => callback,
    useEffect() {},
    memo: component => component,
  }
  const { EventExplorer } = createUI(React, model)
  function expand(value) {
    if (Array.isArray(value)) return value.flatMap(expand)
    if (value == null || value === false) return []
    if (typeof value !== 'object') return [String(value)]
    if (typeof value.type === 'function') return expand(value.type(value.props))
    return [{ ...value, children: expand(value.props.children) }]
  }
  const tree = expand(React.createElement(EventExplorer, { document, sessionId: 'ui-fixture', ...extra }))
  const elements = []
  function visit(nodes) {
    for (const node of nodes) if (typeof node === 'object') { elements.push(node); visit(node.children) }
  }
  visit(tree)
  const content = nodes => nodes.map(node => typeof node === 'string' ? node : content(node.children)).join(' ')
  return { elements, changes, text: content(tree), content,
    byClass: name => elements.filter(element => element.props.className?.split(' ').includes(name)) }
}

function fixture() {
  const normalized = (timeline, start, end = start) => ({ state: 'normalized', timeline, start, end, label: null })
  const row = (id, eventId, storyTime) => ({
    id, eventId, table: 'events', key: `标题-${id}`, value: { description: `完整值-${id}` },
    keywords: ['港口', '灯塔'], characters: ['旅人'], location: ['城市', '港口'], importance: 0.7,
    storyTime, sourceRefs: [{ eventSeq: 12, turn: 3, role: 'assistant' }], recallPolicy: 'query_only', createdAt: 1, updatedAt: 2,
  })
  return { schemaVersion: 5, sessionId: 'ui-fixture', revision: 2, rows: [
    row('a1', 'a', normalized('主线', 10, 20)),
    row('a2', 'a', normalized('主线', 20)),
    row('b', 'b', normalized('独立时间线', 500, null)),
    row('b-current', 'b', normalized('独立时间线', 600)),
    row('c', 'c', { state: 'label-only', label: '翌日', timeline: null, start: null, end: null }),
    row('d', 'd', { state: 'unknown', label: null, timeline: null, start: null, end: null }),
    row('loose', undefined, { state: 'unknown', label: null, timeline: null, start: null, end: null }),
  ], eventEdges: [{ id: 'a-b', kind: 'precedes', predecessorEventId: 'a', successorEventId: 'b', reason: '收到线索后出发', sourceRefs: [], createdAt: 1, updatedAt: 2 }] }
}

test('event view renders every grouped node and independent timeline, with clickable endpoint/instant bars', () => {
  const document = fixture()
  const result = render(document)
  assert.equal(result.byClass('dst-explorer-root')[0].props['data-conversation-composer-overlay'], '', 'uses the public fixed-height View contract')
  assert.equal(result.byClass('dst-explorer-graph-node').length, 4)
  assert.equal(result.byClass('dst-explorer-edge').length, 1)
  assert.equal(result.byClass('dst-explorer-bar').length, 4)
  assert.equal(result.byClass('dst-explorer-bar-row').length, 2, 'each event has one track containing its distinct time markers')
  assert.equal(result.byClass('dst-explorer-untimed-item').length, 2)
  assert.equal(result.byClass('search-match').length, 0, 'empty searches do not highlight every event')
  assert.match(result.text, /完整值-a1/)
  assert.match(result.text, /翌日/)
  assert.match(result.text, /时间未知/)
  assert.match(result.text, /完整值-loose/)
  const bars = result.byClass('dst-explorer-bar')
  assert.ok(bars.every(bar => bar.type === 'button' && typeof bar.props.onClick === 'function'))
  assert.equal(bars[1].props.style.left, '100%')
  assert.equal(bars[1].props.style.transform, 'translateX(-100%)')
  assert.equal(bars[2].props.style.left, '0%')
  assert.equal(bars[2].props.style.right, '0', 'a missing end reaches the latest known point on its timeline')
  assert.equal(bars[3].props.style.left, '100%')
  assert.equal(result.byClass('point').length, 2, 'known zero-duration events keep their circular point markers')
  assert.equal(result.byClass('end-unrecorded').length, 1, 'a missing end uses a distinct ongoing interval style')
  assert.equal(result.byClass('current').length, 2, 'every independent timeline labels its latest known point as current')
  assert.ok(bars[2].props.className.includes('end-unrecorded'))
  assert.ok(!bars[2].props.className.includes('point'))
  assert.equal(document.rows[2].storyTime.end, null, 'display extension does not synthesize a persisted end')
  assert.match(bars[2].props.title, /结束时间未记录/)
  assert.match(bars[2].props.title, /图示延伸至最新已知剧情时间 600/)
  assert.match(result.text, /结束时间未记录/)
  bars[0].props.onClick({ currentTarget: {} })
  assert.deepEqual(result.changes.find(change => change.index === 0), { index: 0, value: 'a' })
  assert.ok(result.byClass('dst-explorer-graph-node').every(node => Number.parseFloat(node.props.style.width) > 0))
})

test('five plus three memories render as two event tracks and retain searchable details', () => {
  const document = fixture()
  const memory = document.rows[0]
  document.rows = ['a', 'b'].flatMap((eventId, eventIndex) => Array.from({ length: eventIndex ? 3 : 5 }, (_, index) => ({
    ...memory, id: `${eventId}-${index}`, eventId, key: `mem_${eventId}_${index}`,
    value: { title: eventIndex ? '四月十三日清晨' : '后半夜醒来', description: `记忆细节-${eventId}-${index}` },
    storyTime: { ...memory.storyTime, start: eventIndex ? 20 : 10, end: null },
  })))
  const before = structuredClone(document)
  const result = render(document)
  assert.equal(result.byClass('dst-explorer-bar-row').length, 2)
  assert.equal(result.byClass('dst-explorer-bar').length, 2)
  assert.deepEqual(result.byClass('dst-explorer-bar-name').map(element => result.content(element.children)), ['后半夜醒来', '四月十三日清晨'])
  assert.match(result.content(result.byClass('dst-explorer-bar-row')), /5 条记忆/)
  assert.match(result.content(result.byClass('dst-explorer-bar-row')), /3 条记忆/)
  assert.doesNotMatch(result.content(result.byClass('dst-explorer-bar-row')), /mem_/)

  const searched = render(document, ['a', '记忆细节-a-4'])
  const labels = searched.byClass('dst-explorer-event-button').filter(element => !element.props.className.includes('dst-explorer-graph-node'))
  assert.equal(labels.find(element => element.props['data-event-id'] === 'a').props.className.includes('search-match'), true)
  assert.equal(labels.find(element => element.props['data-event-id'] === 'b').props.className.includes('search-dim'), true)
  const dialog = searched.elements.find(element => element.type === 'dialog')
  const details = searched.content(dialog.children)
  for (let index = 0; index < 5; index += 1) assert.match(details, new RegExp(`记忆细节-a-${index}`))
  assert.equal(searched.byClass('dst-explorer-memory-detail').length, 5)
  assert.deepEqual(document, before)
})

test('untimed memories share one event item while keeping all distinct time labels', () => {
  const document = fixture()
  const memory = document.rows[4]
  document.rows = [
    memory,
    { ...memory, id: 'c2', key: 'c2' },
    { ...memory, id: 'c3', key: 'c3', storyTime: { ...memory.storyTime, label: '翌日清晨' } },
    { ...document.rows[5], eventId: 'c' },
  ]
  document.eventEdges = []
  const result = render(document)
  assert.equal(result.byClass('dst-explorer-untimed-item').length, 1)
  const item = result.content(result.byClass('dst-explorer-untimed-item'))
  assert.match(item, /4 条记忆/)
  assert.match(item, /仅标签 · 翌日/)
  assert.match(item, /仅标签 · 翌日清晨/)
  assert.match(item, /时间未知/)
})

test('search highlights instead of removing graph nodes and details retain full row/edge data', () => {
  const result = render(fixture(), ['a', 'not-a-match'])
  assert.equal(result.byClass('dst-explorer-graph-node').length, 4)
  assert.ok(result.byClass('dst-explorer-graph-node').every(node => node.props.className.includes('search-dim')))
  const dialog = result.elements.find(element => element.type === 'dialog')
  const detail = result.content(dialog.children)
  assert.match(detail, /完整值-a1/)
  assert.match(detail, /完整值-a2/)
  assert.match(detail, /query_only/)
  assert.match(detail, /第 3 回合 · 剧情原文/)
  assert.match(detail, /收到线索后出发/)
  assert.match(detail, /"id": "a-b"/)
  assert.match(detail, /"id": "a1"/)

  const missingEnd = render(fixture(), ['b'])
  const missingEndDialog = missingEnd.elements.find(element => element.type === 'dialog')
  assert.match(missingEnd.content(missingEndDialog.children), /剧情时间[^]*结束时间未记录/)
})

test('open intervals use later starts as current without inventing time beyond the only known point', () => {
  const multipleOpen = fixture()
  multipleOpen.rows[3].storyTime.end = null
  const multipleResult = render({ ...multipleOpen, rows: multipleOpen.rows.slice(2, 4), eventEdges: [] })
  const multipleBars = multipleResult.byClass('dst-explorer-bar')
  assert.equal(multipleBars[0].props.style.left, '0%')
  assert.equal(multipleBars[0].props.style.right, '0')
  assert.equal(multipleBars[1].props.style.right, '0')
  assert.equal(multipleBars[1].props.style.minWidth, '8px')
  assert.match(multipleBars[1].props.title, /右端标记，未推断事件时长/)

  const singleOpen = fixture()
  const singleResult = render({ ...singleOpen, rows: [singleOpen.rows[2]], eventEdges: [] })
  const onlyBar = singleResult.byClass('dst-explorer-bar')[0]
  assert.equal(onlyBar.props.style.left, '100%')
  assert.equal(onlyBar.props.style.width, '8px')
  assert.equal(onlyBar.props.style.transform, 'translateX(-100%)')
  assert.ok(onlyBar.props.className.includes('end-unrecorded'))
  assert.match(onlyBar.props.title, /只有一个已知坐标/)
  assert.match(onlyBar.props.title, /未推断事件时长/)
  assert.match(singleResult.text, /最新 500/)
})

test('empty, loading, and recoverable-error states are explicit', () => {
  assert.match(render(null, [], { loading: true }).text, /正在读取事件/)
  const empty = render({ revision: 0, rows: [], eventEdges: [] })
  assert.equal(empty.byClass('dst-explorer-graph-node').length, 0)
  assert.match(empty.text, /尚无剧情记忆/)
  const failed = render(fixture(), [], { error: '读取失败', onRefresh() {} })
  assert.equal(failed.byClass('dst-explorer-graph-node').length, 4)
  assert.match(failed.text, /读取失败/)
  assert.match(failed.text, /重试/)
})

test('timeline exposes its existing event editor through one edit action', () => {
  let edits = 0
  const result = render(fixture(), [], { onEdit: () => { edits += 1 } })
  const edit = result.elements.find(element => element.type === 'button' && result.content(element.children) === '编辑事件')
  assert.ok(edit)
  edit.props.onClick()
  assert.equal(edits, 1)
})

test('player-facing narrative, supplied time labels, and source navigation precede folded technical data', () => {
  const document = fixture()
  document.appliedMaintenanceJobs = ['incremental-turn-1-assistant-25']
  document.rows[0] = {
    ...document.rows[0],
    table: 'narrative_events',
    key: 'lin-che-begins-ring-work-and-ice-maker-check',
    eventId: 'event-turn1-ring-onboarding-ice-maker',
    value: {
      event: '林澈第一天在RiNG兼职，向立希了解咖啡厅工作，并被请去检查发出异常声音的制冰机。',
      durableFacts: ['立希安排林澈整理餐具。', '乐奈注意到制冰机声音不对。'],
    },
    storyTime: {
      state: 'normalized', label: '2020年05月11日 星期一 15:40', timeline: 'RiNG咖啡厅工作时间线', start: 202005111540, end: null,
    },
  }
  document.rows = [document.rows[0]]
  document.eventEdges = []
  let opened
  const result = render(document, ['event-turn1-ring-onboarding-ice-maker'], {
    maintenance: { status: 'idle', completed: 1 },
    onOpenSource: ref => { opened = ref },
  })

  assert.match(result.text, /林澈第一天在RiNG兼职/)
  assert.match(result.text, /检查发出异常声音的制冰机/)
  assert.match(result.text, /立希安排林澈整理餐具/)
  assert.match(result.text, /2020年05月11日 星期一 15:40/)
  assert.doesNotMatch(result.text, /202,005,111,540/)
  assert.match(result.text, /已整理 1 个剧情事件 · 完成 1 次记忆整理/)
  const technical = result.byClass('dst-explorer-technical')
  assert.ok(technical.length >= 2)
  assert.ok(technical.every(element => element.type === 'details'))
  const sourceButton = result.elements.find(element => element.type === 'button' && /第 3 回合 · 剧情原文/.test(result.content(element.children)))
  assert.ok(sourceButton)
  sourceButton.props.onClick()
  assert.deepEqual(opened, { eventSeq: 12, turn: 3, role: 'assistant' })
})

test('date-shaped coordinates control bar geometry and numeric ticks while labels remain verbatim', () => {
  const document = fixture()
  const base = document.rows[0]
  const coordinates = [[202005112330, 202005112345], [202005120000, 202005120000], [202005120030, null]]
  document.rows = coordinates.map(([start, end], index) => ({
    ...base, id: `time-${index}`, eventId: `time-${index}`,
    storyTime: { state: 'normalized', timeline: '公历 calendar', label: `2020年5月·第${index}轮红月`, start, end },
  }))
  document.eventEdges = []
  const before = structuredClone(document)
  const result = render(document, ['time-0'])
  const bars = result.byClass('dst-explorer-bar')
  assert.equal(Number.parseFloat(bars[0].props.style.width), 15 / 7700 * 100)
  assert.equal(Number.parseFloat(bars[1].props.style.left), 7670 / 7700 * 100)
  assert.equal(bars[2].props.style.right, '0')
  assert.equal(bars[2].props.style.minWidth, '8px')
  const axis = result.content(result.byClass('dst-explorer-axis'))
  for (const tick of [202005112330, 202005114255, 202005116180, 202005118105, 202005120030]) assert.ok(axis.includes(String(tick)))
  assert.doesNotMatch(axis, /2020-05/)
  assert.match(bars[0].props.title, /2020年5月·第0轮红月/)
  assert.match(bars[0].props.title, /202005112330 – 202005112345/)
  const dialog = result.elements.find(element => element.type === 'dialog')
  assert.match(result.content(dialog.children), /202005112345/)

  const renamed = render({ ...document, rows: document.rows.map(row => ({
    ...row, storyTime: { ...row.storyTime, timeline: '星历', label: '不存在于公历的自定义时刻' },
  })) })
  assert.deepEqual(renamed.byClass('dst-explorer-bar').map(bar => bar.props.style), bars.map(bar => bar.props.style))
  assert.deepEqual(document, before)
})

test('a tiny interval on a billion-year axis stays clickable and focuses directly on its source coordinates', () => {
  const document = fixture()
  const base = document.rows[0]
  const timedRow = (id, eventId, timeline, start, end, description) => ({
    ...base,
    id,
    eventId,
    key: id,
    value: { description },
    storyTime: { state: 'normalized', timeline, label: null, start, end },
  })
  const boundary = timedRow('latest-boundary', undefined, '极长主线', 0.006, null, '未归组当前边界')
  delete boundary.eventId
  document.rows = [
    timedRow('ancient', 'ancient', '极长主线', -145000000000000000, -144000000000000000, '远古事件'),
    timedRow('signal', 'signal', '极长主线', 0.001, 0.002, '毫秒信号'),
    timedRow('ongoing', 'ongoing', '极长主线', 0.003, null, '开放事件'),
    timedRow('instant', 'instant', '极长主线', 0.004, 0.004, '瞬时事件'),
    boundary,
    timedRow('single', 'single', '单点轴', 42, null, '单点开放事件'),
  ]
  document.eventEdges = []
  const before = structuredClone(document)

  const overview = render(document)
  assert.equal(overview.byClass('dst-explorer-bar-row').length, 5, 'the ungrouped boundary does not invent an event track')
  assert.equal(overview.byClass('dst-explorer-graph-node').length, 5)
  const signal = overview.byClass('dst-explorer-bar').find(bar => /毫秒信号/.test(bar.props.title))
  assert.ok(signal.props.className.includes('minimum-marker'))
  assert.equal(signal.props.style.right, '0')
  assert.equal(signal.props.style.minWidth, '8px')
  assert.match(signal.props.title, /真实起点 0\.001/)
  assert.match(signal.props.title, /真实终点 0\.002/)
  assert.match(signal.props.title, /真实时长 0\.001/)
  assert.match(signal.props.title, /宽度不代表实际时长/)
  const ongoing = overview.byClass('dst-explorer-bar').find(bar => /开放事件/.test(bar.props.title))
  assert.match(ongoing.props.title, /图示延伸至最新已知剧情时间 0\.006/)
  const axes = overview.byClass('dst-explorer-axis')
  assert.match(overview.content(axes[0].children), /最新 0\.006/)
  assert.match(overview.content(axes[1].children), /最新 42/)
  const single = overview.byClass('dst-explorer-bar').find(bar => /单点开放事件/.test(bar.props.title))
  assert.deepEqual(single.props.style, { left: '100%', width: '8px', transform: 'translateX(-100%)' })

  const focus = overview.byClass('dst-explorer-focus-time').find(button => /毫秒信号/.test(button.props['aria-label']))
  focus.props.onClick()
  const focusedViewport = overview.changes.find(change => change.index >= 6)?.value
  assert.ok(Math.abs(focusedViewport.minimum - (-0.001)) < 1e-12)
  assert.ok(Math.abs(focusedViewport.maximum - 0.004) < 1e-12)
  const pointFocus = overview.byClass('dst-explorer-focus-time').find(button => /瞬时事件/.test(button.props['aria-label']))
  pointFocus.props.onClick()
  const pointViewport = overview.changes.filter(change => change.index === 6).at(-1)?.value
  assert.ok(pointViewport.maximum - pointViewport.minimum < 1, 'point focus uses a local numeric step instead of a fraction of the global span')

  const focusedStates = []
  focusedStates[6] = focusedViewport
  const focused = render(document, focusedStates)
  const focusedSignal = focused.byClass('dst-explorer-bar').find(bar => /毫秒信号/.test(bar.props.title))
  assert.equal(focusedSignal.props.className.includes('minimum-marker'), false)
  assert.ok(Math.abs(Number.parseFloat(focusedSignal.props.style.width) - 20) < 1e-9)
  assert.doesNotMatch(focused.content(focused.byClass('dst-explorer-axis')[0].children), /最新 0\.006/)
  const overviewButton = focused.elements.find(element => element.type === 'button' && element.props['aria-label'] === '总览时间线' && !element.props.disabled)
  overviewButton.props.onClick()
  assert.deepEqual(focused.changes.find(change => change.index === 6)?.value, {
    minimum: -145000000000000000,
    maximum: 0.006,
  })
  assert.deepEqual(document, before)
})

test('timeline zoom, movement, and overview controls update only their own viewport', () => {
  const document = fixture()
  const overview = render(document)
  const zoomButtons = overview.elements.filter(element => element.type === 'button' && element.props['aria-label'] === '放大时间线')
  zoomButtons[0].props.onClick()
  assert.deepEqual(overview.changes.find(change => change.index === 6)?.value, { minimum: 12.5, maximum: 17.5 })

  const zoomedStates = []
  zoomedStates[6] = { minimum: 12.5, maximum: 17.5 }
  const zoomed = render(document, zoomedStates)
  assert.match(zoomed.content(zoomed.byClass('dst-explorer-axis')[1].children), /最新 600/)
  assert.doesNotMatch(zoomed.content(zoomed.byClass('dst-explorer-axis')[0].children), /最新 20/)
  const forward = zoomed.elements.find(element => element.type === 'button' && element.props['aria-label'] === '向后移动时间线' && !element.props.disabled)
  forward.props.onClick()
  assert.deepEqual(zoomed.changes.find(change => change.index === 6)?.value, { minimum: 14.5, maximum: 19.5 })
  const overviewButton = zoomed.elements.find(element => element.type === 'button' && element.props['aria-label'] === '总览时间线' && !element.props.disabled)
  overviewButton.props.onClick()
  assert.deepEqual(zoomed.changes.filter(change => change.index === 6).at(-1)?.value, { minimum: 10, maximum: 20 })
})

test('zoom stops at floating-point resolution instead of jumping back to overview', () => {
  const document = fixture()
  document.rows = [{
    ...document.rows[0],
    storyTime: { state: 'normalized', timeline: '精度边界', label: null, start: 1e20, end: 1e20 + 16384 },
  }]
  document.eventEdges = []

  const result = render(document)
  const zoomIn = result.elements.find(element => element.type === 'button' && element.props['aria-label'] === '放大时间线')
  assert.equal(zoomIn.props.disabled, true)
  assert.equal(result.changes.length, 0)
})

test('small fractional and negative story coordinates are displayed without rounding them away', () => {
  const document = fixture()
  document.rows = [{ ...document.rows[0], storyTime: { state: 'normalized', timeline: '相对纪元', label: null, start: -0.000012345, end: 0.000012345 } }]
  document.eventEdges = []
  const result = render(document, ['a'])
  const bar = result.byClass('dst-explorer-bar')[0]
  assert.match(bar.props.title, /-0\.000012345 – 0\.000012345/)
  assert.equal(bar.props.style.width, '100%')
})

test('maintenance feedback distinguishes waiting, queued, running, and failure states', () => {
  const empty = { revision: 0, rows: [], eventEdges: [] }
  assert.match(render(empty).text, /完成一个剧情回合后/)
  assert.match(render(empty, [], { maintenance: { status: 'pending', pending: 1 } }).text, /进入记忆整理队列/)
  assert.match(render(empty, [], { maintenance: { status: 'running', running: 1 } }).text, /正在整理这轮剧情/)
  assert.match(render(empty, [], { maintenance: { status: 'failed', failed: 1, lastError: '模型暂时不可用' } }).text, /剧情记忆整理失败：模型暂时不可用/)
})
