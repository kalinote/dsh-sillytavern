import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

test('conversation tabs follow only the current Tavern session and clean up across mounts', async () => {
  let definition
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options })
    return { ok: true, status: 200, async json() { return { ok: true, value: {} } } }
  }
  globalThis.window = { setTimeout, clearTimeout, __ModuleLoader__: { load(value) { definition = value } } }
  globalThis.document = {
    visibilityState: 'visible',
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  }

  try {
    const clientPath = require.resolve('../client.cjs')
    delete require.cache[clientPath]
    require(clientPath)
    assert.equal(definition.id, 'dsh-sillytavern')

    function Menu() {}
    function MarkdownText() {}
    function IconChevronDownOutline14() {}
    function IconSettingsOutline14() {}
    function JsonBlock() {}
    function Fragment() {}
    const plugin = definition.factory(name => {
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Menu, MarkdownText, IconChevronDownOutline14, IconSettingsOutline14, JsonBlock }
      assert.equal(name, 'react')
      return {
        Fragment,
        createElement(type, props, ...children) { return { type, props: props || {}, children } },
        memo(component) { return component },
        useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
        useRef(value) { return { current: value } },
        useMemo(factory) { return factory() },
        useCallback(callback) { return callback },
        useEffect() {},
        useLayoutEffect() {},
        useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
      }
    })
    assert.deepEqual(plugin.inject, ['slots', 'commandUi', 'conversation', 'sessions'])

    let state = {
      current: 'plain',
      byId: {
        plain: { projectionValues: { agentPreset: 'standard' } },
        'tavern-a': { projectionValues: { agentPreset: 'sillytavern' } },
        'tavern-b': { agentPreset: 'sillytavern' },
      },
    }
    const listeners = new Set()
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      },
    }
    const emit = next => {
      state = next
      for (const listener of [...listeners]) listener()
    }

    const registrations = []
    const injectedSlots = []
    const mount = () => {
      const cleanups = []
      const conversation = { blocks: { set() {}, storeFor: () => ({ getSnapshot: () => undefined }) } }
      plugin.apply({
        get(name) { return name === 'conversation' ? conversation : name === 'sessions' ? sessions : undefined },
        effect(callback) {
          const cleanup = callback()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
          return cleanup
        },
        commandUi: { decorate() { return () => {} } },
        slots: {
          inject(name, callback) {
            injectedSlots.push(name)
            const cleanup = callback()
            if (typeof cleanup === 'function') cleanups.push(cleanup)
            return cleanup
          },
          register(options, component) {
            const record = { options, component, active: true, disposeCalls: 0 }
            registrations.push(record)
            return () => {
              record.disposeCalls += 1
              record.active = false
            }
          },
        },
      })
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        for (const cleanup of cleanups.reverse()) cleanup()
      }
    }
    const activeViews = () => registrations.filter(record => record.active && record.options.name === 'conversation.view')
    const viewRegisterCount = () => registrations.filter(record => record.options.name === 'conversation.view').length

    const disposeFirstMount = mount()
    assert.equal(listeners.size, 1)
    assert.equal(injectedSlots.filter(name => name === 'conversation.view').length, 1)
    assert.equal(activeViews().length, 0, 'a normal current session must not expose tabs even when another Tavern session exists')
    assert.equal(fetchCalls.length, 0, 'a normal current session must not initialize the timeline source')

    emit({ ...state, current: 'tavern-a' })
    const firstViews = activeViews()
    assert.deepEqual(firstViews.map(record => [record.options.id, record.options.order, record.options.label, record.component.name]), [
      ['sillytavern-events', 20, '时间线', 'TavernEventsView'],
      ['sillytavern-worldbook', 21, '世界书', 'TavernWorldbookView'],
      ['sillytavern-persona', 22, '用户设定/变量', 'TavernPersonaView'],
      ['sillytavern-scripts', 23, '脚本', 'TavernScriptsView'],
      ['sillytavern-templates', 24, '提示词模板', 'TavernTemplatesView'],
    ])
    assert.equal(typeof firstViews[0].options.inject, 'function')
    assert.equal(firstViews.slice(1).every(record => record.options.inject === undefined), true)
    const eventInjection = firstViews[0].options.inject('tavern-a')
    assert.equal(typeof eventInjection.hooks.eventExplorer.subscribe, 'function')
    assert.equal(eventInjection.isCurrentSession(), true)
    assert.equal(fetchCalls.length, 0, 'registering the Tavern views alone must not request timeline data')

    const firstViewRecords = [...firstViews]
    emit({ ...state, current: 'tavern-b' })
    emit({ ...state, unrelatedRevision: 1 })
    assert.equal(viewRegisterCount(), 5, 'switching between Tavern sessions or publishing unrelated state must not register duplicates')
    assert.deepEqual(activeViews(), firstViewRecords)
    assert.equal(eventInjection.isCurrentSession(), false)

    emit({ ...state, current: 'plain' })
    assert.equal(activeViews().length, 0)
    assert.equal(firstViewRecords.every(record => record.disposeCalls === 1), true)

    emit({ ...state, current: undefined })
    emit({ ...state, current: 'missing' })
    assert.equal(activeViews().length, 0, 'an absent current id or missing summary must keep the views unmounted')

    emit({ current: 'flex', byId: { flex: { agentPreset: 'standard' } } })
    assert.equal(activeViews().length, 0)
    emit({ current: 'flex', byId: { flex: { agentPreset: 'sillytavern' } } })
    assert.equal(activeViews().length, 5, 'changing the preset on the same session id must mount the views')
    emit({ current: 'flex', byId: { flex: { agentPreset: 'sillytavern', projectionValues: { agentPreset: 'standard' } } } })
    assert.equal(activeViews().length, 0, 'the projected preset must take priority over the legacy field')
    emit({ current: 'flex', byId: { flex: { agentPreset: 'standard', projectionValues: { agentPreset: 'sillytavern' } } } })
    assert.equal(activeViews().length, 5)

    const registrationsBeforeDispose = registrations.length
    disposeFirstMount()
    assert.equal(listeners.size, 0, 'disposing the injection must unsubscribe from session state')
    assert.equal(activeViews().length, 0, 'disposing the injection must unregister all Tavern views')
    emit({ current: 'flex', byId: { flex: { projectionValues: { agentPreset: 'standard' } } } })
    assert.equal(registrations.length, registrationsBeforeDispose, 'disposed subscriptions must ignore later session updates')

    emit({ current: 'tavern-a', byId: { 'tavern-a': { projectionValues: { agentPreset: 'sillytavern' } } } })
    const disposeSecondMount = mount()
    assert.equal(listeners.size, 1)
    assert.equal(activeViews().length, 5, 'remounting must leave exactly one active set of Tavern views')
    assert.equal(injectedSlots.filter(name => name === 'conversation.view').length, 2)
    disposeSecondMount()
    assert.equal(listeners.size, 0)
    assert.equal(activeViews().length, 0)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})
