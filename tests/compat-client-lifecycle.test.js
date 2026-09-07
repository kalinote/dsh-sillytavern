import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const waitFor = async (predicate, message, timeoutMs = 3000) => {
  const expires = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= expires) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const deferred = () => {
  let resolve, reject
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

const baseSnapshot = () => ({
  schemaVersion: 1,
  runtimeRevision: 1,
  sessionId: 'session-a',
  state: { sessionId: 'session-a', binding: { revision: 0, variables: { count: 1 }, scriptInjections: [] }, history: [] },
  bindingRevision: 0,
  cardRecord: { id: 'card-a' },
  characterCard: { spec: 'chara_card_v3', data: { name: 'Alice' } },
  character: { name: 'Alice' },
  worldbook: null,
  persona: { name: 'User', description: '' },
  variables: { count: 1 },
  globalVariables: {},
  variableScopes: { chat: { count: 1 }, global: {}, preset: {}, character: {}, script: {}, extension: {}, message: {} },
  variableMaps: { global: {}, presets: {}, characters: {}, scripts: {}, extensions: {} },
  variableRevisions: { chat: 0, global: 0, workspace: 0, message: 0 },
  extensionSettings: {},
  worldbookNames: [],
  globalWorldbooks: [],
  characterWorldbooks: {},
  lorebookSettings: {},
  chatWorldbookName: null,
  scriptInjections: [],
  messages: [],
  context: { chatId: 'session-a', characterId: 'card-a', name1: 'User', name2: 'Alice', chatMetadata: {} },
  compatibility: { schemaVersion: 1, capabilities: {} },
})

async function loadRuntimes(api, parentWindow) {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const parentStart = source.indexOf('    const compatRuntime = (() => {')
  const parentEnd = source.indexOf('\n    function useCompatSnapshot', parentStart)
  const frameStart = source.indexOf('    function installCompatibilityRuntime')
  const frameEnd = source.indexOf('\n    function inlineJson', frameStart)
  assert.ok(parentStart >= 0 && parentEnd > parentStart)
  assert.ok(frameStart >= 0 && frameEnd > frameStart)
  const globals = { JSON, Object, Array, Map, Set, Error, TypeError, String, Number, Date, Math, Promise, console, structuredClone }
  const parent = vm.runInNewContext(`(() => { ${source.slice(parentStart, parentEnd).trim()}; return compatRuntime })()`, { ...globals, api, window: parentWindow })
  const installFrame = vm.runInNewContext(`(${source.slice(frameStart, frameEnd).trim()})`, globals)
  return { parent, installFrame }
}

function parentSurface() {
  const handlers = new Map()
  return {
    setTimeout,
    clearTimeout,
    addEventListener(name, listener) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(listener) },
    removeEventListener(name, listener) { handlers.get(name)?.delete(listener) },
    dispatch(source, data) { for (const listener of handlers.get('message') || []) void listener({ source, data }) },
  }
}

function attachFrame(parentWindow, installFrame, channel, metadata = {}) {
  const handlers = new Map()
  let frameWindow
  const parent = { postMessage(message) { parentWindow.dispatch(frameWindow, message) } }
  const root = {
    parent,
    setTimeout,
    clearTimeout,
    addEventListener(name, listener) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(listener) },
    emit(name, data) { for (const listener of handlers.get(name) || []) listener(name === 'message' ? { source: parent, data } : {}) },
  }
  frameWindow = { postMessage(message) { root.emit('message', message) } }
  installFrame(root, baseSnapshot(), channel, { scriptId: `script-${channel}`, ...metadata })
  return { channel, root, frameWindow }
}

class FakeHost {
  constructor({ blockFirstWrite = false, completeImmediately = true } = {}) {
    this.calls = []
    this.lifecycle = []
    this.generations = new Map()
    this.nextLifecycleId = 0
    this.bindingRevision = 0
    this.firstWrite = blockFirstWrite ? deferred() : null
    this.firstWriteClaimed = false
    this.completeImmediately = completeImmediately
  }

  releaseFirstWrite() { this.firstWrite?.resolve() }

  async api(url, options = {}) {
    const [path] = url.split('?')
    const body = options.body ? JSON.parse(options.body) : null
    this.calls.push({ path, method: options.method || 'GET', body, url })
    if (path === '/compat/variables/replace') {
      if (this.firstWrite && !this.firstWriteClaimed) { this.firstWriteClaimed = true; await this.firstWrite.promise }
      assert.equal(body.expectedRevision, this.bindingRevision, 'chat variable writes use the current binding revision')
      this.bindingRevision += 1
      return { revisions: { chat: this.bindingRevision, global: 0, workspace: 0, message: 0 } }
    }
    if (path === '/session/update') {
      assert.equal(body.patch.expectedRevision, this.bindingRevision, 'injection writes use the revision advanced by chat variables')
      this.bindingRevision += 1
      return { binding: { revision: this.bindingRevision, variables: { count: 2 }, scriptInjections: body.patch.scriptInjections || [] } }
    }
    if (path === '/compat/lifecycle') {
      const available = this.lifecycle.filter(item => !item.delivered)
      for (const item of available) item.delivered = true
      return available.map(({ id, kind, payload }) => ({ id, kind, payload }))
    }
    if (path === '/compat/lifecycle/result') {
      const request = this.lifecycle.find(item => item.id === body.id)
      if (!request) throw new Error(`unknown lifecycle result ${body.id}`)
      request.result = body.result
      request.error = body.error
      if (body.error) request.start.reject(Object.assign(new Error(body.error), { code: 'generation-prepare-failed' }))
      else {
        const state = this.generations.get(request.generationId)
        if (this.completeImmediately) Object.assign(state, { active: false, status: 'completed', full: 'done' })
        request.start.resolve({ generationId: request.generationId })
      }
      return true
    }
    if (path === '/compat/lifecycle/disconnect') return true
    if (path === '/compat/generation/start') {
      const generationId = String(body.config.generation_id)
      this.generations.set(generationId, { active: true, status: 'active', full: '', toolCalls: [] })
      const start = deferred()
      this.lifecycle.push({ id: `prepare-${++this.nextLifecycleId}`, kind: 'prepare', payload: {}, generationId, start, delivered: false })
      return start.promise
    }
    if (path === '/compat/generation') return structuredClone(this.generations.get(new URL(url, 'http://local').searchParams.get('generationId')))
    if (path === '/compat/generation/stop') {
      const state = this.generations.get(String(body.generationId))
      if (state) Object.assign(state, { active: false, status: 'stopped' })
      return true
    }
    if (path === '/compat/generation/stop-all') {
      for (const state of this.generations.values()) Object.assign(state, { active: false, status: 'stopped' })
      return true
    }
    if (path === '/compat/runtime') return baseSnapshot()
    throw new Error(`unhandled fake API ${options.method || 'GET'} ${url}`)
  }
}

async function harness(options) {
  const surface = parentSurface()
  const host = new FakeHost(options)
  const { parent, installFrame } = await loadRuntimes(host.api.bind(host), surface)
  parent.start()
  const a = attachFrame(surface, installFrame, 'frame-a')
  const b = attachFrame(surface, installFrame, 'frame-b')
  const unregisterA = parent.register({ channel: a.channel, sessionId: 'session-a', scriptId: 'script-a', getWindow: () => a.frameWindow })
  const unregisterB = parent.register({ channel: b.channel, sessionId: 'session-a', scriptId: 'script-b', getWindow: () => b.frameWindow })
  parent.set('session-a', baseSnapshot(), 'initial')
  return { host, parent, a, b, cleanup() { unregisterA(); unregisterB(); parent.reset() } }
}

test('two frames drain accepted writes before generation and run owner filters through the lifecycle barrier', async t => {
  const runtime = await harness({ blockFirstWrite: true })
  t.after(runtime.cleanup)
  let filterRuns = 0
  runtime.a.root.replaceVariables({ count: 2 })
  runtime.a.root.injectPrompts([{ id: 'owned-filter', content: 'filtered', filter: () => { filterRuns += 1; return true } }])
  const generated = runtime.b.root.generate({ generation_id: 'barrier-generation', user_input: 'hello' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(runtime.host.calls.some(call => call.path === '/compat/generation/start'), false, 'generation waits for the shared parent write queue')
  // The first queued write is deliberately unresolved; releasing it lets the
  // injection write complete before the generation request reaches the Host.
  assert.equal(runtime.host.firstWriteClaimed, true, 'the parent accepted the blocked write synchronously')
  runtime.host.releaseFirstWrite()
  assert.equal(await generated, 'done')
  assert.equal(filterRuns, 1)
  const lifecycle = runtime.host.lifecycle[0]
  assert.deepEqual(JSON.parse(JSON.stringify(lifecycle.result)), {
    eligibleInjectionIds: ['owned-filter'],
    ownerFrameIds: ['frame-a', 'frame-b'],
  })
  const callOrder = runtime.host.calls.map(call => call.path)
  assert.ok(callOrder.indexOf('/session/update') < callOrder.indexOf('/compat/generation/start'))
})

test('an injection write advances the CAS revision used by the following variable write', async t => {
  const runtime = await harness()
  t.after(runtime.cleanup)
  runtime.a.root.injectPrompts([{ id: 'first', content: 'first' }])
  runtime.a.root.replaceVariables({ count: 3 })
  assert.equal(await runtime.b.root.generate({ generation_id: 'reverse-cas' }), 'done')
  assert.equal(runtime.host.bindingRevision, 2)
})

test('an owner filter failure rejects another frame generation instead of reporting success', async t => {
  const runtime = await harness()
  t.after(runtime.cleanup)
  runtime.a.root.injectPrompts([{ id: 'broken-filter', content: 'never eligible', filter: () => { throw new Error('owner filter failed') } }])
  await assert.rejects(runtime.b.root.generate({ generation_id: 'failed-generation' }), /owner filter failed/)
  assert.match(runtime.host.lifecycle[0].error, /owner filter failed/)
  assert.equal(runtime.host.generations.get('failed-generation').status, 'active')
})

test('a sibling frame can stop a shared generation and frame disposal never sends stop-all', async t => {
  const runtime = await harness({ completeImmediately: false })
  t.after(runtime.cleanup)
  const generated = runtime.a.root.generate({ generation_id: 'cross-frame' })
  await waitFor(() => runtime.host.generations.has('cross-frame'), 'generation did not reach fake host')
  assert.equal(runtime.b.root.stopGenerationById('cross-frame'), true)
  assert.equal(await generated, '')
  assert.equal(runtime.host.generations.get('cross-frame').status, 'stopped')

  const disposedGeneration = runtime.a.root.generate({ generation_id: 'disposed-owner' })
  disposedGeneration.catch(() => undefined)
  await waitFor(() => runtime.host.generations.has('disposed-owner'), 'owned generation did not start')
  runtime.a.root.emit('pagehide')
  await waitFor(() => runtime.host.calls.some(call => call.path === '/compat/generation/stop' && call.body?.generationId === 'disposed-owner'), 'frame disposal did not send a targeted stop')
  assert.equal(runtime.host.calls.some(call => call.path === '/compat/generation/stop-all'), false)
  await assert.rejects(disposedGeneration, /disposed/)
})
