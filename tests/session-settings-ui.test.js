import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist in the client bundle`)
  const signatureEnd = source.indexOf(') {', start)
  assert.notEqual(signatureEnd, -1, `${name} must use a function declaration`)
  const bodyStart = signatureEnd + 2
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  assert.fail(`${name} has no closing brace`)
}

function createReactHarness() {
  const states = []
  let cursor = 0
  const React = {
    Fragment: function Fragment() {},
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      const setState = update => { states[index] = typeof update === 'function' ? update(states[index]) : update }
      return [states[index], setState]
    },
    useRef(initial) { return { current: initial } },
    useCallback(callback) { return callback },
  }
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  return {
    React,
    h,
    render(component, props) { cursor = 0; return component(props) },
  }
}

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node || typeof node !== 'object') return []
  return [node, ...descendants(node.children)]
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  return textContent(node.children)
}

function findButton(tree, Button, label) {
  const button = descendants(tree).find(node => node.type === Button && textContent(node) === label)
  assert.ok(button, `button ${label} must be rendered`)
  return button
}

function compile(source, names, context) {
  const declarations = names.map(name => functionSource(source, name)).join('\n')
  return vm.runInNewContext(`(() => { ${declarations}; return { ${names.join(', ')} } })()`, context)
}

function createEffectHarness() {
  const states = []
  const effects = []
  let stateCursor = 0
  let effectCursor = 0
  const React = {
    useState(initial) {
      const index = stateCursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update }]
    },
    useCallback(callback) { return callback },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useEffect(effect, dependencies) {
      const index = effectCursor++
      const previous = effects[index]
      const changed = previous === undefined || dependencies.length !== previous.dependencies.length || dependencies.some((value, dependencyIndex) => !Object.is(value, previous.dependencies[dependencyIndex]))
      if (!changed) return
      previous?.cleanup?.()
      effects[index] = { dependencies: [...dependencies], cleanup: effect() }
    },
  }
  return {
    React,
    render(component, value) {
      stateCursor = 0
      effectCursor = 0
      return component(value)
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.()
      effects.length = 0
    },
  }
}

test('settings loads survive overlay visibility changes and cancel stale sessions', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const overlayStart = source.indexOf('const overlay = (() => {')
  const overlayEnd = source.indexOf('\n\n    function createSessionStore', overlayStart)
  assert.notEqual(overlayStart, -1)
  assert.notEqual(overlayEnd, -1)
  const overlayDeclaration = source.slice(overlayStart, overlayEnd)
  const declarations = ['useOverlay', 'useAsync', 'useTavernSettings'].map(name => functionSource(source, name)).join('\n')
  const harness = createEffectHarness()
  const calls = []
  const api = (path, { signal }) => {
    calls.push({ path, signal })
    return new Promise(() => {})
  }
  const { overlay, useTavernSettings } = vm.runInNewContext(`(() => { ${overlayDeclaration}; ${declarations}; return { overlay, useTavernSettings } })()`, {
    React: harness.React,
    api,
    AbortController,
    Promise,
    Set,
    encodeURIComponent,
  })

  let state = harness.render(useTavernSettings, 'session-a')
  assert.deepEqual(calls.map(call => call.path), ['/library?sessionId=session-a', '/session?sessionId=session-a'])
  const initialSignals = calls.map(call => call.signal)
  assert.ok(initialSignals.every(signal => !signal.aborted))

  overlay.open('manager', 'session-a')
  state = harness.render(useTavernSettings, 'session-a')
  overlay.close()
  state = harness.render(useTavernSettings, 'session-a')
  assert.equal(calls.length, 2, 'opening or closing the manager must not replace loaded settings or discard drafts')
  assert.ok(initialSignals.every(signal => !signal.aborted))

  overlay.changed()
  state = harness.render(useTavernSettings, 'session-a')
  assert.equal(calls.length, 4, 'a saved data change reloads both shared settings resources')
  assert.ok(initialSignals.every(signal => signal.aborted))
  const changedSignals = calls.slice(2).map(call => call.signal)
  assert.ok(changedSignals.every(signal => !signal.aborted))

  state.reload()
  state = harness.render(useTavernSettings, 'session-a')
  assert.equal(calls.length, 6, 'the page reload callback also refreshes both resources')
  assert.ok(changedSignals.every(signal => signal.aborted))
  const reloadedSignals = calls.slice(4).map(call => call.signal)

  state = harness.render(useTavernSettings, 'session-b')
  assert.ok(reloadedSignals.every(signal => signal.aborted), 'switching sessions aborts the previous request')
  assert.deepEqual(calls.slice(6).map(call => call.path), ['/library?sessionId=session-b', '/session?sessionId=session-b'])
  const currentSignals = calls.slice(6).map(call => call.signal)
  harness.unmount()
  assert.ok(currentSignals.every(signal => signal.aborted), 'unmounting aborts the active request')
})

test('script editor keeps card and workspace saves isolated', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const session = {
    sessionId: 'session-a',
    card: {
      id: 'card-a',
      scripts: [{ id: 'card-rule', name: 'Card rule', kind: 'regex', source: 'card', findRegex: 'card', placement: [2] }],
    },
    globalRegexScripts: [{ id: 'global-rule', name: 'Global rule', kind: 'regex', source: 'global', findRegex: 'global', placement: [2] }],
    presetRegexScripts: [{ id: 'preset-rule', name: 'Preset rule', kind: 'regex', source: 'preset', findRegex: 'preset', placement: [2] }],
  }

  const renderEditor = scope => {
    const harness = createReactHarness()
    const calls = []
    let reloads = 0
    const Button = function Button() {}
    const context = {
      React: harness.React,
      h: harness.h,
      Button,
      Field: function Field() {},
      ScriptPreview: function ScriptPreview() {},
      api: async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return {} },
      overlay: { changed() {} },
      scriptApprovalMaterial: () => '',
      sourceDigest: async () => 'digest',
      structuredClone,
      crypto: { randomUUID: () => 'new-script' },
      window: { confirm: () => true },
    }
    const { ScriptsTab } = compile(source, ['ScriptsTab'], context)
    return {
      Button,
      calls,
      harness,
      ScriptsTab,
      props: { session: scope === 'card' ? session : { ...session, card: null }, reload: () => { reloads += 1 }, scope },
      reloads: () => reloads,
    }
  }

  const card = renderEditor('card')
  const cardTree = card.harness.render(card.ScriptsTab, card.props)
  assert.deepEqual(descendants(cardTree).filter(node => node.type === card.Button && ['Global', 'Preset', 'Scoped（角色卡）'].includes(textContent(node))).map(textContent), ['Scoped（角色卡）'])
  findButton(cardTree, card.Button, '保存脚本').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(card.calls, [{
    path: '/card/update',
    body: { sessionId: 'session-a', cardId: 'card-a', patch: { scripts: session.card.scripts } },
  }])
  assert.equal(card.reloads(), 1)

  const workspace = renderEditor('workspace')
  const workspaceTree = workspace.harness.render(workspace.ScriptsTab, workspace.props)
  assert.deepEqual(descendants(workspaceTree).filter(node => node.type === workspace.Button && ['Global', 'Preset', 'Scoped（角色卡）'].includes(textContent(node))).map(textContent), ['Global', 'Preset'])
  findButton(workspaceTree, workspace.Button, '保存脚本').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(workspace.calls, [{
    path: '/regex-sources',
    body: { sessionId: 'session-a', global: session.globalRegexScripts, preset: session.presetRegexScripts },
  }])
  assert.equal(workspace.reloads(), 1)
})

test('manager and conversation settings route each page to the intended editor', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const LibraryTab = function LibraryTab() {}
  const CardEditTab = function CardEditTab() {}
  const ScriptsTab = function ScriptsTab() {}
  const WorldbookTab = function WorldbookTab() {}
  const PersonaTab = function PersonaTab() {}
  const EventTab = function EventTab() {}
  const TemplatesTab = function TemplatesTab() {}
  const session = { sessionId: 'session-a', binding: {}, event: {}, card: { id: 'card-a', card: { data: { name: 'Alice' } } } }
  const library = { templates: [] }
  const context = {
    React: harness.React,
    h: harness.h,
    Button,
    LibraryTab,
    CardEditTab,
    ScriptsTab,
    WorldbookTab,
    PersonaTab,
    EventTab,
    TemplatesTab,
    useTavernSettings: () => ({ loading: false, error: null, value: { library, session }, reload() {} }),
  }
  const { ManagerContent, SessionSettingsContent } = compile(source, ['ManagerContent', 'SessionSettingsContent'], context)

  let tree = harness.render(ManagerContent, { sessionId: 'session-a' })
  assert.deepEqual(descendants(tree).filter(node => node.type === Button).map(textContent), ['角色库', '角色卡', '角色脚本'])
  findButton(tree, Button, '角色脚本').props.onClick()
  tree = harness.render(ManagerContent, { sessionId: 'session-a' })
  const cardScripts = descendants(tree).find(node => node.type === ScriptsTab)
  assert.equal(cardScripts.props.scope, 'card')

  const pages = [
    ['worldbook', WorldbookTab],
    ['persona', PersonaTab],
    ['event', EventTab],
    ['scripts', ScriptsTab],
    ['templates', TemplatesTab],
  ]
  for (const [page, expected] of pages) {
    const pageHarness = createReactHarness()
    context.React = pageHarness.React
    context.h = pageHarness.h
    const compiled = compile(source, ['SessionSettingsContent'], context).SessionSettingsContent
    const pageTree = pageHarness.render(compiled, { sessionId: 'session-a', page })
    const editor = descendants(pageTree).find(node => node.type === expected)
    assert.ok(editor, `${page} must render its existing editor`)
    if (page === 'scripts') assert.equal(editor.props.scope, 'workspace')
  }

  const TavernSettingsView = function TavernSettingsView() {}
  const wrapperNames = ['TavernWorldbookView', 'TavernPersonaView', 'TavernScriptsView', 'TavernTemplatesView']
  const wrappers = compile(source, wrapperNames, { h: harness.h, TavernSettingsView })
  const wrapperPages = [
    ['TavernWorldbookView', 'worldbook', '世界书'],
    ['TavernPersonaView', 'persona', '用户设定/变量'],
    ['TavernScriptsView', 'scripts', '脚本'],
    ['TavernTemplatesView', 'templates', '提示词模板'],
  ]
  for (const [name, page, title] of wrapperPages) {
    const view = wrappers[name]({ sessionId: 'session-a', useSessions() {} })
    assert.equal(view.type, TavernSettingsView)
    assert.equal(view.props.sessionId, 'session-a')
    assert.equal(view.props.page, page)
    assert.equal(view.props.title, title)
  }
})

test('blank Tavern sessions keep every pre-message page keyed to the active session', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const TavernOpeningGreeting = function TavernOpeningGreeting() {}
  const SessionSettingsContent = function SessionSettingsContent() {}
  const BlankSessionSettings = compile(source, ['BlankSessionSettings'], {
    React: harness.React,
    h: harness.h,
    Button,
    TavernOpeningGreeting,
    SessionSettingsContent,
  }).BlankSessionSettings

  let tree = harness.render(BlankSessionSettings, { sessionId: 'blank-a' })
  let content = descendants(tree).find(node => node.type === TavernOpeningGreeting)
  assert.equal(content.props.sessionId, 'blank-a')
  for (const [label, page] of [['世界书', 'worldbook'], ['用户设定/变量', 'persona'], ['脚本', 'scripts'], ['提示词模板', 'templates']]) {
    findButton(tree, Button, label).props.onClick()
    tree = harness.render(BlankSessionSettings, { sessionId: 'blank-a' })
    content = descendants(tree).find(node => node.type === SessionSettingsContent)
    assert.equal(content.props.sessionId, 'blank-a')
    assert.equal(content.props.page, page)
    assert.equal(content.props.key, `blank-a:${page}`)
  }
})

test('timeline switches to the existing event editor within the same view', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const SessionSettingsContent = function SessionSettingsContent() {}
  const EventExplorer = function EventExplorer() {}
  const context = { React: harness.React, h: harness.h, Button, SessionSettingsContent, eventExplorerUI: { EventExplorer } }
  const { TavernEventsSession } = compile(source, ['TavernEventsSession'], context)
  let refreshes = 0
  const props = {
    sessionId: 'session-a',
    useEventExplorer: selector => selector({ document: { revision: 3 }, loading: false }),
    refreshEvents: () => { refreshes += 1 },
  }

  let tree = harness.render(TavernEventsSession, props)
  assert.equal(tree.type, EventExplorer)
  tree.props.onEdit()
  tree = harness.render(TavernEventsSession, props)
  const editor = descendants(tree).find(node => node.type === SessionSettingsContent)
  assert.equal(editor.props.page, 'event')
  findButton(tree, Button, '返回时间线').props.onClick()
  assert.equal(refreshes, 1)
  tree = harness.render(TavernEventsSession, props)
  assert.equal(tree.type, EventExplorer)
})
