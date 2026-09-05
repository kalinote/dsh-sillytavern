import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const bundle = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
const helpers = bundle.slice(bundle.indexOf('function memoryCharacters('), bundle.indexOf('function memoryStoryTimeText('))
const component = bundle.slice(bundle.indexOf('function EventTab('), bundle.indexOf('function executableScript('))

function form(rows = []) {
  const cells = []
  const requests = []
  let hook = 0
  const React = {
    useState(initial) {
      const index = hook++
      if (!(index in cells)) cells[index] = initial
      return [cells[index], value => { cells[index] = value }]
    },
    useMemo: compute => compute(),
  }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null) })
  const EventTab = vm.runInNewContext(`(() => { ${helpers}; ${component}; return EventTab })()`, {
    React, h, Field: 'field', Button: 'button', EventGraph: 'graph', MemoryRow: 'row',
    eventGraph: () => ({ nodes: [], ungroupedRows: [] }),
    overlay: { changed() {} },
    api: async (path, options) => { requests.push({ path, ...JSON.parse(options.body) }) },
  })
  function render() {
    hook = 0
    const tree = EventTab({ session: { sessionId: 'form-test', event: { revision: 3, rows } }, reload() {} })
    const elements = []
    function visit(node) {
      if (typeof node !== 'object' || node === null) return
      elements.push(node)
      node.children.forEach(visit)
    }
    visit(tree)
    return elements
  }
  const field = label => render().find(element => element.type === 'field' && element.props.label.startsWith(label)).children[0]
  const button = () => render().find(element => element.type === 'button' && element.children.includes('添加/覆盖记忆'))
  return {
    requests, field, button,
    fill(label, value) { field(label).props.onChange({ target: { value } }) },
    async submit() { button().props.onClick(); await new Promise(resolve => setImmediate(resolve)) },
    text: () => render().flatMap(element => element.children.filter(child => typeof child === 'string')).join(' '),
  }
}

test('event editor requires a start for new rows and submits a blank end as null, not zero', async () => {
  const f = form()
  f.fill('键', 'arrival')
  f.fill('时间线', 'story')
  assert.equal(f.field('开始').props.required, true)
  assert.equal(f.button().props.disabled, true)
  f.fill('开始', '0')
  assert.equal(f.button().props.disabled, false)
  await f.submit()
  assert.deepEqual(f.requests[0].operation.storyTime, { state: 'normalized', label: null, timeline: 'story', start: 0, end: null })
})

test('event editor rejects reversed or invalid ends before sending a request', async () => {
  const f = form()
  f.fill('键', 'arrival')
  f.fill('时间线', 'story')
  f.fill('开始', '5')
  f.fill('结束', '4')
  await f.submit()
  assert.equal(f.requests.length, 0)
  assert.match(f.text(), /结束时间不能早于开始/)
  f.fill('结束', 'not-a-number')
  await f.submit()
  assert.equal(f.requests.length, 0)
  assert.match(f.text(), /结束时间必须是有限数字/)
  f.fill('结束', '5')
  await f.submit()
  assert.equal(f.requests[0].operation.storyTime.end, 5)
})

test('event editor reuses a start only on the same timeline and never reuses a legacy unknown start', async () => {
  const row = { table: 'events', key: 'arrival', storyTime: { state: 'normalized', timeline: 'story', start: 8, end: 10 } }
  const f = form([row])
  f.fill('键', 'arrival')
  f.fill('时间线', 'story')
  assert.equal(f.field('开始').props.required, false)
  assert.equal(f.button().props.disabled, false)
  f.fill('时间线', 'another-calendar')
  assert.equal(f.field('开始').props.required, true)
  assert.equal(f.button().props.disabled, true)
  f.fill('时间线', 'story')
  await f.submit()
  assert.equal(f.requests[0].operation.storyTime.start, 8)
  assert.equal(f.requests[0].operation.storyTime.end, null)

  const legacy = form([{ ...row, storyTime: { state: 'unknown', start: null, end: null } }])
  legacy.fill('键', 'arrival')
  legacy.fill('时间线', 'story')
  assert.equal(legacy.button().props.disabled, true)
  await legacy.submit()
  assert.equal(legacy.requests.length, 0)
  assert.match(legacy.text(), /开始时间必填/)
})
