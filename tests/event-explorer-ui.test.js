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
      return [index < initialStates.length ? initialStates[index] : initial, value => changes.push({ index, value })]
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
  assert.equal(result.byClass('dst-explorer-untimed-item').length, 2)
  assert.equal(result.byClass('search-match').length, 0, 'empty searches do not highlight every event')
  assert.match(result.text, /标题-a1/)
  assert.match(result.text, /翌日/)
  assert.match(result.text, /时间未知/)
  assert.match(result.text, /完整值-loose/)
  const bars = result.byClass('dst-explorer-bar')
  assert.ok(bars.every(bar => bar.type === 'button' && typeof bar.props.onClick === 'function'))
  assert.equal(bars[1].props.style.left, '100%')
  assert.equal(bars[1].props.style.transform, 'translateX(-100%)')
  assert.equal(bars[2].props.style.left, '0%')
  assert.equal(bars[2].props.style.width, '100%', 'a missing end reaches the latest known point on its timeline')
  assert.equal(bars[3].props.style.left, '100%')
  assert.equal(result.byClass('point').length, 2, 'known zero-duration events keep their circular point markers')
  assert.equal(result.byClass('end-unrecorded').length, 1, 'a missing end uses a distinct ongoing interval style')
  assert.equal(result.byClass('current').length, 2, 'every independent timeline labels its latest known point as current')
  assert.ok(bars[2].props.className.includes('end-unrecorded'))
  assert.ok(!bars[2].props.className.includes('point'))
  assert.equal(document.rows[2].storyTime.end, null, 'display extension does not synthesize a persisted end')
  assert.match(bars[2].props.title, /结束时间未记录/)
  assert.match(bars[2].props.title, /图示延伸至当前剧情时间 600/)
  assert.match(result.text, /结束时间未记录/)
  bars[0].props.onClick({ currentTarget: {} })
  assert.deepEqual(result.changes.find(change => change.index === 0), { index: 0, value: 'a' })
  assert.ok(result.byClass('dst-explorer-graph-node').every(node => Number.parseFloat(node.props.style.width) > 0))
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
  assert.match(detail, /#12/)
  assert.match(detail, /收到线索后出发/)
  assert.match(detail, /"id": "a-b"/)
  assert.match(detail, /"id": "a1"/)

  const missingEnd = render(fixture(), ['b'])
  const missingEndDialog = missingEnd.elements.find(element => element.type === 'dialog')
  assert.match(missingEnd.content(missingEndDialog.children), /结束时间[^]*结束时间未记录/)
})

test('open intervals use later starts as current without inventing time beyond the only known point', () => {
  const multipleOpen = fixture()
  multipleOpen.rows[3].storyTime.end = null
  const multipleResult = render({ ...multipleOpen, rows: multipleOpen.rows.slice(2, 4), eventEdges: [] })
  const multipleBars = multipleResult.byClass('dst-explorer-bar')
  assert.equal(multipleBars[0].props.style.width, '100%')
  assert.equal(multipleBars[1].props.style.left, '100%')
  assert.equal(multipleBars[1].props.style.width, undefined)

  const singleOpen = fixture()
  const singleResult = render({ ...singleOpen, rows: [singleOpen.rows[2]], eventEdges: [] })
  const onlyBar = singleResult.byClass('dst-explorer-bar')[0]
  assert.equal(onlyBar.props.style.left, '50%')
  assert.equal(onlyBar.props.style.width, undefined)
  assert.ok(onlyBar.props.className.includes('end-unrecorded'))
  assert.match(singleResult.text, /当前 500/)
})

test('empty, loading, and recoverable-error states are explicit', () => {
  assert.match(render(null, [], { loading: true }).text, /正在读取事件/)
  const empty = render({ revision: 0, rows: [], eventEdges: [] })
  assert.equal(empty.byClass('dst-explorer-graph-node').length, 0)
  assert.match(empty.text, /尚无/)
  const failed = render(fixture(), [], { error: '读取失败', onRefresh() {} })
  assert.equal(failed.byClass('dst-explorer-graph-node').length, 4)
  assert.match(failed.text, /读取失败/)
  assert.match(failed.text, /重试/)
})
