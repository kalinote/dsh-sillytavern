import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function sizingScript() {
  const source = await readFile(process.env.DSH_FRAME_SIZING_CLIENT || new URL('../client.cjs', import.meta.url), 'utf8')
  const start = source.indexOf('    function executableScript')
  const end = source.indexOf('    function mergeSessionEventState', start)
  assert.ok(start >= 0 && end > start, 'trustedDocument helpers must remain discoverable')
  const { trustedDocument } = vm.runInNewContext(
    `(() => { ${source.slice(start, end)}; return { trustedDocument } })()`,
    { JSON, String, btoa },
  )
  const document = trustedDocument(
    { id: 'frame-sizing', name: 'Frame sizing', kind: 'html', source: '<!doctype html><html><head></head><body><div>content</div></body></html>' },
    'frame-sizing-channel',
    { messages: [] },
    { surface: 'message', currentMessageId: 1 },
  )
  const scripts = [...document.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1])
  const sizing = scripts.find(source => source.includes("event:'frame-resize'"))
  assert.notEqual(sizing, undefined, 'trustedDocument must inject its executable sizing script')
  return sizing
}

class FrameSizingHarness {
  constructor(source, values = {}) {
    this.source = source
    this.viewport = values.viewport ?? 600
    this.bodyHeight = values.bodyHeight ?? 89
    this.marginTop = values.marginTop ?? 8
    this.marginBottom = values.marginBottom ?? 8
    this.scrollY = values.scrollY ?? 0
    this.hasChild = values.hasChild ?? true
    this.explicitChildBottom = values.childBottom
    this.reports = []
    this.frames = []
    this.listeners = new Map()
    this.observer = null
    this.nextFrame = 0
  }

  get contentExtent() {
    const bodyExtent = this.bodyHeight > 0
      ? this.marginTop + this.bodyHeight + this.marginBottom
      : Math.max(this.marginTop, this.marginBottom)
    return Math.max(bodyExtent, this.hasChild ? this.childBottom : 0)
  }

  get childBottom() {
    return this.explicitChildBottom ?? this.marginTop + this.bodyHeight
  }

  start() {
    const harness = this
    const root = {
      get clientHeight() { return harness.viewport },
      get scrollHeight() { return Math.max(harness.viewport, harness.contentExtent) },
    }
    const child = {
      getBoundingClientRect() {
        return { bottom: harness.childBottom - harness.scrollY, width: 100, height: harness.bodyHeight }
      },
    }
    const body = {
      get scrollHeight() { return harness.bodyHeight },
      get offsetHeight() { return harness.bodyHeight },
      get children() { return harness.hasChild ? [child] : [] },
      getBoundingClientRect() {
        return { top: harness.marginTop - harness.scrollY, bottom: harness.marginTop + harness.bodyHeight - harness.scrollY, height: harness.bodyHeight }
      },
    }
    const document = { documentElement: root, body, readyState: 'loading' }
    const context = {
      document,
      parent: {
        postMessage(message) {
          if (message?.event !== 'frame-resize') return
          harness.reports.push(message.payload.height)
          if (harness.viewport === message.payload.height) return
          harness.viewport = message.payload.height
          harness.resize()
        },
      },
      addEventListener(name, listener) {
        const listeners = harness.listeners.get(name) ?? []
        listeners.push(listener)
        harness.listeners.set(name, listeners)
      },
      requestAnimationFrame(callback) {
        const id = ++harness.nextFrame
        harness.frames.push({ id, callback })
        return id
      },
      getComputedStyle(node) {
        return node === body
          ? { marginTop: `${harness.marginTop}px`, marginBottom: `${harness.marginBottom}px` }
          : { marginTop: '0px', marginBottom: '0px' }
      },
      ResizeObserver: class {
        constructor(callback) { harness.observer = callback }
        observe() {}
      },
    }
    Object.defineProperty(context, 'scrollY', { get: () => harness.scrollY })
    context.window = context
    new vm.Script(this.source).runInNewContext(context)
    for (const listener of this.listeners.get('DOMContentLoaded') ?? []) listener()
    return this.settle()
  }

  resize() {
    this.observer?.([])
  }

  settle(limit = 32) {
    let iterations = 0
    while (this.frames.length > 0 && iterations < limit) {
      const { callback } = this.frames.shift()
      callback()
      iterations += 1
    }
    return { settled: this.frames.length === 0, iterations }
  }
}

test('trusted frame sizing converges with body margins and still shrinks after expanded content collapses', async () => {
  const harness = new FrameSizingHarness(await sizingScript(), { viewport: 97, bodyHeight: 89 })
  assert.equal(harness.start().settled, true, 'the parent-height feedback loop must converge')
  assert.deepEqual(harness.reports, [105], 'default 8px body margins are part of the intrinsic document extent')
  assert.equal(harness.viewport, 105)

  harness.bodyHeight = 365
  harness.resize()
  assert.equal(harness.settle().settled, true)
  assert.equal(harness.viewport, 381)
  assert.deepEqual(harness.reports, [105, 381])

  harness.bodyHeight = 89
  harness.resize()
  assert.equal(harness.settle().settled, true)
  assert.equal(harness.viewport, 105, 'the viewport-sized root scroll extent must not prevent a later shrink')
  assert.deepEqual(harness.reports, [105, 381, 105])
})

test('trusted frame sizing preserves zero margins, empty documents, and asynchronous growth', async () => {
  const source = await sizingScript()
  const zeroMargin = new FrameSizingHarness(source, { viewport: 600, bodyHeight: 89, marginTop: 0, marginBottom: 0 })
  assert.equal(zeroMargin.start().settled, true)
  assert.deepEqual(zeroMargin.reports, [89])

  const empty = new FrameSizingHarness(source, { viewport: 0, bodyHeight: 0, hasChild: false })
  assert.equal(empty.start().settled, true)
  assert.deepEqual(empty.reports, [0], 'an empty body must not acquire height from its default margins')

  const asynchronous = new FrameSizingHarness(source, { viewport: 600, bodyHeight: 89 })
  assert.equal(asynchronous.start().settled, true)
  asynchronous.bodyHeight = 200
  asynchronous.resize()
  assert.equal(asynchronous.settle().settled, true)
  assert.deepEqual(asynchronous.reports, [105, 216], 'ResizeObserver growth includes both body margins')
})

test('trusted frame sizing is stable while the child viewport is scrolled or only its height changes', async () => {
  const source = await sizingScript()
  const harness = new FrameSizingHarness(source, { viewport: 97, bodyHeight: 89 })
  assert.equal(harness.start().settled, true)
  const reportCount = harness.reports.length

  harness.viewport = 180
  harness.resize()
  assert.equal(harness.settle().settled, true)
  assert.equal(harness.reports.length, reportCount, 'a viewport-only resize must not repeat an unchanged intrinsic height')

  const scrolled = new FrameSizingHarness(source, { viewport: 120, bodyHeight: 20, marginTop: 0, marginBottom: 0, childBottom: 120 })
  assert.equal(scrolled.start().settled, true)
  assert.deepEqual(scrolled.reports, [120])
  scrolled.scrollY = 40
  scrolled.resize()
  assert.equal(scrolled.settle().settled, true)
  assert.equal(scrolled.viewport, 120, 'viewport-relative child rectangles must be restored to document coordinates')
  assert.deepEqual(scrolled.reports, [120], 'scrolling the child window alone must not report a smaller document')
})
