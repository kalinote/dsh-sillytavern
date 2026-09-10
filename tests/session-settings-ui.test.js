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

test('failed action recovery preserves an existing draft and retries unpersisted input exactly once', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const input = { draft: '尚未发送的补充', phase: 'plain' }
  const sent = []
  const action = '我先检查制冰机的电源。\n再请立希说明异响。'
  const failed = { turn: 2, text: action, inputs: [{ persisted: false }] }
  const { TavernFailureNode } = compile(source, ['TavernFailureNode'], {
    React: harness.React, h: harness.h, Button,
    useAsync: () => ({ loading: false, value: { failedTurns: [failed] } }),
  })
  const props = { sessionId: 'a', node: { data: { turn: 2, seq: 9, message: 'script callback barrier timed out' } },
    useInput: selector => selector(input), inputActions: { setDraft: value => { input.draft = value }, submit: () => { sent.push(input.draft); input.draft = '' } } }
  let tree = harness.render(TavernFailureNode, props)
  assert.equal(findButton(tree, Button, '重试这轮').props.disabled, true)
  findButton(tree, Button, '恢复输入 / 编辑').props.onClick()
  assert.equal(input.draft, `尚未发送的补充\n${action}`)
  input.draft = ''
  tree = harness.render(TavernFailureNode, props)
  findButton(tree, Button, '重试这轮').props.onClick()
  assert.deepEqual(sent, [action])
  failed.inputs[0].persisted = true
  tree = harness.render(TavernFailureNode, props)
  findButton(tree, Button, '继续未完成的回复').props.onClick()
  assert.equal(sent[1].includes(action), false, 'an already-persisted user action is not resubmitted into context')
})

test('message actions retry only the opening action and reject continuation after an unfinished turn', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const branches = []
  const entry = { turn: 3, reason: 'interrupted', text: '开场行动\n中途追加', retryText: '开场行动', steeringText: '中途追加', assistantIds: ['assistant-3'] }
  const { TavernMessageActions } = compile(source, ['TavernMessageActions'], {
    React: harness.React, h: harness.h, Button, Object,
    Tooltip: 'tooltip', IconRefreshOutline16: 'refresh-icon', IconEditOutline16: 'edit-icon', IconRightUpOutline16: 'continue-icon',
    useAsync: () => ({ value: { turns: [entry] } }),
    openPlayerBranch: async (...args) => { branches.push(args) },
    encodeURIComponent,
  })
  const tree = harness.render(TavernMessageActions, { sessionId: 'session-a', messageId: 'assistant-3' })
  const continueButton = descendants(tree).find(node => node.type === 'button' && node.props['aria-label'] === '从这里继续')
  assert.equal(continueButton.props['aria-disabled'], true)
  assert.equal(continueButton.props.onClick, undefined)
  assert.match(textContent(tree), /中途追加的行动/)
  descendants(tree).find(node => node.type === 'button' && node.props['aria-label'] === '重生成 · 保留原分支').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(branches)), [['session-a', { beforeTurn: 3 }, '开场行动', true]])
})

test('retrying an earlier failure branches even when every later turn also failed', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const branches = []
  const failed = { turn: 2, text: '开场行动\n中途追加', retryText: '开场行动', steeringText: '中途追加', inputs: [{ target: 'next-turn', persisted: false }, { target: 'next-step', persisted: true }] }
  const { TavernFailureNode } = compile(source, ['TavernFailureNode'], {
    React: harness.React, h: harness.h, Button, Object,
    useAsync: () => ({ loading: false, value: { turns: [failed, { turn: 3, reason: 'error' }], failedTurns: [failed] } }),
    openPlayerBranch: async (...args) => { branches.push(args) },
  })
  const input = { draft: '', phase: 'plain' }
  const tree = harness.render(TavernFailureNode, { sessionId: 'session-a', node: { data: { turn: 2, seq: 9, message: 'failed' } },
    useInput: selector => selector(input), inputActions: { setDraft() {}, submit() {} } })
  assert.match(textContent(tree), /中途追加的行动/)
  findButton(tree, Button, '从这轮创建重试分支').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(branches)), [['session-a', { beforeTurn: 2 }, '开场行动', true]])
})

test('fork inheritance repair is offered only for a broken repairable fork', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const Button = function Button() {}
  const render = inheritance => {
    const harness = createReactHarness()
    const { ForkInheritanceNotice } = compile(source, ['ForkInheritanceNotice'], {
      React: harness.React, h: harness.h, Button,
      api: async () => ({}), overlay: { changed() {} }, JSON,
    })
    return harness.render(ForkInheritanceNotice, { session: { sessionId: 'session-a', fork: { inheritance } }, reload() {} })
  }
  const inherited = render({ status: 'inherited', exact: true, repairable: true })
  assert.equal(descendants(inherited).some(node => node.type === Button), false)
  const broken = render({ status: 'repairable', exact: false, repairable: true, reason: 'missing state' })
  assert.equal(findButton(broken, Button, '从来源剧情恢复分支设定').props.disabled, false)
})

test('branch navigation waits for refresh and does not follow or queue a draft after the player switches sessions', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const declaration = functionSource(source, 'openPlayerBranch')
  let current = 'session-a'
  let resolveRefresh
  const opened = []
  const alerts = []
  const sessions = {
    list: { getSnapshot: () => ({ current }) },
    refresh: () => new Promise(resolve => { resolveRefresh = resolve }),
    open: id => opened.push(id),
  }
  let next = 0
  const compiled = vm.runInNewContext(`(() => {
    let playerSessions = sessions
    const pendingPlayerDrafts = new Map()
    async ${declaration}
    return { openPlayerBranch, pendingPlayerDrafts }
  })()`, {
    sessions,
    api: async () => ({ sessionId: `branch-${++next}` }),
    overlay: { close() {} },
    window: { alert: message => alerts.push(message) },
    JSON,
    Error,
  })

  const switched = compiled.openPlayerBranch('session-a', { beforeTurn: 2 }, '重试行动', true)
  await new Promise(resolve => setImmediate(resolve))
  current = 'session-b'
  resolveRefresh()
  assert.equal((await switched).opened, false)
  assert.deepEqual(opened, [])
  assert.equal(compiled.pendingPlayerDrafts.size, 0)
  assert.match(alerts[0], /会话列表打开新分支/)

  current = 'session-a'
  sessions.refresh = async () => {}
  const followed = await compiled.openPlayerBranch('session-a', { beforeTurn: 2 }, '重试行动', true)
  assert.equal(followed.opened, true)
  assert.deepEqual(opened, ['branch-2'])
  assert.equal(compiled.pendingPlayerDrafts.get('branch-2').text, '重试行动')

  sessions.refresh = async () => { throw new Error('offline') }
  await assert.rejects(compiled.openPlayerBranch('session-a', { beforeTurn: 2 }, '不会排队', true), /新分支已创建，但会话列表刷新失败/)
  assert.equal(compiled.pendingPlayerDrafts.has('branch-3'), false)
})

test('worldbook editor disables its mutation surface while its save snapshot is in flight', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  let resolveSave
  const { WorldbookEditor } = compile(source, ['WorldbookEditor'], {
    React: harness.React,
    h: harness.h,
    Button,
    Field: function Field() {},
    WorldbookEntryEditor: function WorldbookEntryEditor() {},
    normalizeWorldbookRecord: value => value,
    api: () => new Promise(resolve => { resolveSave = resolve }),
    overlay: { changed() {} },
    crypto: { randomUUID: () => 'entry' },
    window: { confirm: () => true },
  })
  const props = { sessionId: 'session-a', worldbook: { id: 'book-a', name: 'Book', book: { name: 'Book', entries: [] } }, reload() {} }
  let tree = harness.render(WorldbookEditor, props)
  findButton(tree, Button, '保存世界书').props.onClick()
  tree = harness.render(WorldbookEditor, props)
  const fieldset = descendants(tree).find(node => node.type === 'fieldset')
  assert.ok(fieldset)
  assert.equal(fieldset.props.disabled, true)
  assert.equal(findButton(tree, Button, '保存中…').props.disabled, true)
  resolveSave({})
  await new Promise(resolve => setImmediate(resolve))
})

test('worldbook session copy chooses a free suffix, retries a concurrent conflict, and preserves the full book', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const baseName = '【BanD Dream！】交织的乐章 0826'
  const entries = Array.from({ length: 54 }, (_, index) => ({ id: index, keys: [`key-${index}`], content: `entry-${index}`, enabled: true, extensions: { depth: index } }))
  const original = { id: 'original', name: baseName, book: { name: baseName, entries, extensions: { custom: { retained: true } }, scan_depth: 7, unknown_field: { nested: ['kept'] } } }
  const worldbooks = [original, { id: 'copy-1', name: `${baseName} · 当前剧情副本` }]
  const createBodies = []
  const updates = []
  const selections = []
  let createdCopy
  let loadedWorldbook = original
  const api = async (path, options) => {
    const body = JSON.parse(options.body)
    if (path === '/worldbook/create') {
      createBodies.push(body)
      if (createBodies.length === 1) throw Object.assign(new Error('already exists'), { code: 'worldbook-name-conflict' })
      createdCopy = { id: 'copy-3', name: body.name, book: body.book }
      return createdCopy
    }
    if (path === '/session/update') { updates.push(body); return {} }
    throw new Error(`unexpected request ${path}`)
  }
  let persistentRef
  const { WorldbookTab } = compile(source, ['availableWorldbookCopyName', 'WorldbookTab'], {
    React: { ...harness.React, useEffect: effect => effect(), useRef: initial => (persistentRef ||= { current: initial }) },
    h: harness.h,
    Button,
    Field: function Field() {},
    ConfirmPanel: function ConfirmPanel() {},
    ReferenceList: function ReferenceList() {},
    WorldbookEditor: function WorldbookEditor() {},
    normalizeWorldbookRecord: value => value,
    useAsync: () => ({ loading: false, error: null, value: loadedWorldbook }),
    api,
    overlay: { changed() {} },
    crypto: { randomUUID: () => 'new-book' },
    window: { confirm: () => true },
    Set,
  })
  let editorSelection = original.id
  let libraryWorldbooks = worldbooks
  let session = { sessionId: 'session-a', card: { id: 'card-a' }, binding: { worldbookId: original.id, worldbookExplicit: true } }
  const render = () => harness.render(WorldbookTab, {
    session,
    library: { worldbooks: libraryWorldbooks },
    editorSelection,
    onEditorSelection: id => { editorSelection = id; selections.push(id) },
    reload() {},
  })
  let tree = render()
  findButton(tree, Button, '复制到当前剧情再编辑').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(createBodies.map(body => body.name), [`${baseName} · 当前剧情副本 2`, `${baseName} · 当前剧情副本 3`])
  assert.equal(createBodies[1].book.entries.length, 54)
  assert.deepEqual(createBodies[1].book.unknown_field, { nested: ['kept'] })
  assert.deepEqual(createBodies[1].book.extensions, { custom: { retained: true } })
  assert.deepEqual(updates, [{ sessionId: 'session-a', patch: { worldbookId: 'copy-3' } }])
  assert.deepEqual(selections, ['copy-3'])
  tree = render()
  assert.equal(editorSelection, 'copy-3', 'the old library snapshot must not roll the editor back to the original')
  assert.equal(descendants(tree).find(node => node.type === 'select').props.value, 'copy-3')
  assert.equal(descendants(tree).some(node => node.type.name === 'WorldbookEditor'), false, 'the previous worldbook value must not mount under the new selection key')
  assert.match(textContent(tree), /正在读取世界书/)
  loadedWorldbook = createdCopy
  tree = render()
  const editorNode = descendants(tree).find(node => node.type.name === 'WorldbookEditor')
  assert.equal(editorNode.props.worldbook.id, 'copy-3')
  const editorHarness = createReactHarness()
  const { WorldbookEditor } = compile(source, ['WorldbookEditor'], {
    React: editorHarness.React,
    h: editorHarness.h,
    Button,
    Field: function Field() {},
    WorldbookEntryEditor: function WorldbookEntryEditor() {},
    normalizeWorldbookRecord: value => value,
    api,
    overlay: { changed() {} },
    crypto: { randomUUID: () => 'new-entry' },
    window: { confirm: () => true },
  })
  const editorTree = editorHarness.render(WorldbookEditor, editorNode.props)
  assert.ok(descendants(editorTree).some(node => node.type === 'input' && node.props.value === `${baseName} · 当前剧情副本 3`), 'the mounted editor draft must initialize with the copy name')
  libraryWorldbooks = [...worldbooks, createdCopy]
  session = { ...session, binding: { worldbookId: 'copy-3', worldbookExplicit: true } }
  tree = render()
  assert.equal(editorSelection, 'copy-3', 'the refreshed library keeps the created copy selected')
  assert.deepEqual(selections, ['copy-3'])
  assert.match(textContent(tree), /当前剧情副本 3/)
})

test('persona save keeps only the failed resource dirty and retries only that resource', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const harness = createReactHarness()
  const Button = function Button() {}
  const calls = []
  let reloads = 0
  const { PersonaTab } = compile(source, ['PersonaTab'], {
    React: harness.React,
    h: harness.h,
    Button,
    Field: function Field() {},
    api: async path => {
      calls.push(path)
      if (path === '/regex-sources') throw new Error('global unavailable')
      return {}
    },
    overlay: { changed() {} },
  })
  const props = { session: { sessionId: 'session-a', binding: { userPersona: { name: 'User' }, variables: {} }, globalVariables: {} }, reload: () => { reloads += 1 } }
  let tree = harness.render(PersonaTab, props)
  assert.equal(findButton(tree, Button, '保存角色设定与变量').props.disabled, true)
  descendants(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'Player' } })
  descendants(tree).filter(node => node.type === 'textarea').at(-1).props.onChange({ target: { value: '{"mood":"tense"}' } })
  tree = harness.render(PersonaTab, props)
  findButton(tree, Button, '保存角色设定与变量').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  tree = harness.render(PersonaTab, props)
  assert.match(textContent(tree), /角色设定与会话变量已保存/)
  assert.match(textContent(tree), /全局变量保存失败：global unavailable/)
  assert.equal(findButton(tree, Button, '保存角色设定与变量').props.disabled, false)
  assert.deepEqual(calls, ['/session/update', '/regex-sources'])
  assert.equal(reloads, 1)

  findButton(tree, Button, '保存角色设定与变量').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['/session/update', '/regex-sources', '/regex-sources'])
  assert.equal(reloads, 1)
})

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
    ForkInheritanceNotice: function ForkInheritanceNotice() {},
    PlayerNewStory: function PlayerNewStory() {},
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
