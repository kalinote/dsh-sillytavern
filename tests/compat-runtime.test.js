import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

async function runtimeInstaller() {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const start = source.indexOf('    function installCompatibilityRuntime')
  const end = source.indexOf('\n    function inlineJson', start)
  assert.ok(start >= 0 && end > start)
  const functionSource = source.slice(start, end).trim()
  return vm.runInNewContext(`(${functionSource})`, { JSON, Object, Array, Map, Set, Error, TypeError, String, Number, Date, Math, Promise, console })
}

function frameRoot() {
  const handlers = new Map()
  const messages = []
  const parent = { postMessage(message) { messages.push(message) } }
  const root = {
    parent,
    setTimeout,
    clearTimeout,
    addEventListener(name, listener) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(listener) },
    emit(name, data) { for (const listener of handlers.get(name) || []) listener({ source: parent, data }) },
  }
  return { root, parent, messages }
}

const snapshot = () => ({
  schemaVersion: 1,
  runtimeRevision: 1,
  sessionId: 'session-a',
  state: { sessionId: 'session-a', binding: { variables: { count: 1 } }, history: [] },
  bindingRevision: 0,
  cardRecord: { id: 'card-a' },
  characterCard: { spec: 'chara_card_v3', data: { name: 'Alice' } },
  character: { name: 'Alice' },
  worldbook: null,
  persona: { name: 'User', description: '' },
  variables: { count: 1, nested: { value: true } },
  globalVariables: { shared: 'yes' },
  variableScopes: { chat: { count: 1, nested: { value: true } }, global: { shared: 'yes' }, preset: { preset: 1 }, character: { character: 2 }, script: { script: 3 }, extension: {}, message: {} },
  variableMaps: { global: { shared: 'yes' }, presets: { in_use: { preset: 1 } }, characters: { 'card-a': { character: 2 } }, scripts: { 'card-a\u001fbackground-a': { script: 3 } }, extensions: { sample: { extension: 4 } } },
  variableRevisions: { chat: 0, global: 0, workspace: 0, message: 0 },
  extensionSettings: { sample: { enabled: true } },
  worldbookNames: ['Lore'],
  globalWorldbooks: ['Lore'],
  characterWorldbooks: { 'card-a': { primary: 'Lore', additional: [] } },
  lorebookSettings: { selected_global_lorebooks: ['Lore'], scan_depth: 2 },
  chatWorldbookName: null,
  scriptInjections: [],
  messages: [{ message_id: 0, is_user: false, is_system: false, role: 'assistant', mes: 'Welcome', message: 'Welcome', text: 'Welcome', data: { floor: 5 } }],
  context: { chatId: 'session-a', characterId: 'card-a', name1: 'User', name2: 'Alice', chatMetadata: {} },
  compatibility: { schemaVersion: 1, capabilities: {} },
})

test('bootstrap installs synchronous variables and stable SillyTavern context before user code', async () => {
  const install = await runtimeInstaller()
  const { root } = frameRoot()
  install(root, snapshot(), 'frame-a', { scriptId: 'background-a' })
  assert.equal(typeof root.TavernHelper, 'object')
  assert.equal(typeof root.SillyTavern.getContext, 'function')
  assert.equal(root.getVariables() instanceof Promise, false)
  const variables = root.getVariables()
  variables.nested.value = false
  assert.equal(root.getVariables().nested.value, true, 'variable reads are deep clones')
  assert.deepEqual(root.getVariables({ type: 'global' }), { shared: 'yes' })
  assert.deepEqual(root.getVariables({ type: 'preset' }), { preset: 1 })
  assert.deepEqual(root.getVariables({ type: 'character' }), { character: 2 })
  assert.deepEqual(root.getVariables({ type: 'script', script_id: 'forged' }), { script: 3 }, 'iframe script identity overrides caller supplied ids')
  assert.deepEqual(root.getVariables({ type: 'extension', extension_id: 'sample' }), { extension: 4 })
  assert.deepEqual(root.getVariables({ type: 'message' }), { floor: 5 })
  assert.deepEqual(root.getAllVariables(), { shared: 'yes', character: 2, script: 3, count: 1, nested: { value: true } })
  assert.equal(root.SillyTavern.chat, root.SillyTavern.getContext().chat)
  assert.equal(root.SillyTavern.eventSource, root.eventSource)
  assert.equal(root.SillyTavern.getCurrentChatId(), 'session-a')
  assert.equal(root.tavern_events.CHAT_CHANGED, 'chat_id_changed')
  assert.equal(root.iframe_events.GENERATION_STARTED, 'js_generation_started')
  assert.equal(root.iframe_events.CHAT_CHANGED, undefined)
  assert.deepEqual(root.getWorldbookNames(), ['Lore'])
  assert.deepEqual(root.getLorebookSettings(), { selected_global_lorebooks: ['Lore'], scan_depth: 2 })
  assert.equal(root.SillyTavern.extensionSettings.sample.enabled, true)
  root.registerMacroLike(/\[name\]/g, () => 'Alice')
  assert.equal(root.SillyTavern.substituteParams('{{user}} + [name]'), 'User + Alice')
  assert.equal(root.TavernHelper.getScriptId(), 'background-a')
  assert.equal(typeof root.Popup, 'function')
  assert.equal(root.POPUP_TYPE.CONFIRM, 2)
})

test('Tavern Regex facade projects sources, formats display text, and persists replacements', async () => {
  const install = await runtimeInstaller()
  const { root, messages } = frameRoot()
  const state = snapshot()
  const rule = { id: 'global-display', name: 'Global display', kind: 'regex', enabled: true, findRegex: '/<choice>([\\s\\S]*?)<\\/choice>/', source: '<button>$1</button>', trimStrings: [], placement: [2], markdownOnly: true, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }
  state.state.globalRegexScripts = [rule]
  state.state.presetRegexScripts = []
  state.cardRecord.scripts = [{ ...rule, id: 'character-display', name: 'Character display', findRegex: '/button/g', source: 'strong' }]
  install(root, state, 'frame-regex', { scriptId: 'regex-script' })

  assert.deepEqual(JSON.parse(JSON.stringify(root.getTavernRegexes().map(regex => [regex.scope, regex.script_name]))), [['global', 'Global display'], ['character', 'Character display']])
  assert.equal(root.formatAsTavernRegexedString('<choice>Continue</choice>', 'ai_output', 'display'), '<strong>Continue</strong>')
  assert.equal(root.formatAsTavernRegexedString('<choice>Continue</choice>', 'ai_output', 'prompt'), '<choice>Continue</choice>')

  const replacement = [{ ...root.getTavernRegexes({ type: 'global' })[0], replace_string: '<a>$1</a>' }]
  const pending = root.replaceTavernRegexes(replacement, { type: 'global' })
  const request = messages.at(-1)
  assert.equal(request.action, 'replaceRegexes')
  assert.equal(request.args.changes.global[0].source, '<a>$1</a>')
  root.emit('message', { __dshSillyTavern: true, channel: 'frame-regex', replyTo: request.id, ok: true, value: null })
  await pending
})

test('variable writes are optimistic and prompt injection has a synchronous disposer', async () => {
  const install = await runtimeInstaller()
  const { root, messages } = frameRoot()
  install(root, snapshot(), 'frame-a', { scriptId: 'script-a' })
  const returned = root.replaceVariables({ count: 2 })
  assert.equal(returned, undefined)
  assert.deepEqual(root.getVariables(), { count: 2 })
  assert.equal(messages.at(-1).action, 'replaceVariables')
  const injection = root.injectPrompts([{ id: 'route', content: 'Airport', position: 'in_chat', depth: 2, role: 'system' }])
  assert.equal(typeof injection.uninject, 'function')
  assert.equal(messages.at(-1).action, 'injectPrompts')
  assert.equal(messages.at(-1).args.prompts[0].content, 'Airport')
  injection.uninject()
  assert.equal(messages.at(-1).action, 'uninjectPrompts')
  injection.uninject()
  assert.equal(messages.filter(message => message.action === 'uninjectPrompts').length, 1)
  for (const message of messages.filter(message => message.id)) root.emit('message', { __dshSillyTavern: true, channel: 'frame-a', replyTo: message.id, ok: true, value: null })
})

test('event facade preserves first/normal/last order, once, stop, and variadic payloads', async () => {
  const install = await runtimeInstaller()
  const { root, messages } = frameRoot()
  install(root, snapshot(), 'frame-a', {})
  const calls = []
  const stopped = root.eventOn('custom', (...args) => calls.push(['stopped', ...args]))
  stopped.stop()
  root.eventMakeLast('custom', (...args) => calls.push(['last', ...args]))
  root.eventOn('custom', (...args) => calls.push(['normal', ...args]))
  root.eventMakeFirst('custom', (...args) => calls.push(['first', ...args]))
  root.eventOnce('custom', (...args) => calls.push(['once', ...args]))
  await root.eventEmit('custom', 7, 'value')
  await root.eventEmit('custom', 8, 'again')
  assert.deepEqual(calls.map(call => call[0]), ['first', 'normal', 'once', 'last', 'first', 'normal', 'last'])
  assert.deepEqual(calls[0].slice(1), [7, 'value'])
  assert.equal(messages.filter(message => message.event === 'compat-event').length, 2)
})

test('newer state updates mutate stable context collections and stale updates are ignored', async () => {
  const install = await runtimeInstaller()
  const { root } = frameRoot()
  install(root, snapshot(), 'frame-a', {})
  const chat = root.SillyTavern.chat
  root.emit('message', { __dshSillyTavern: true, channel: 'frame-a', event: 'compat-state', payload: { ...snapshot(), runtimeRevision: 2, messages: [{ message_id: 1, is_user: true, mes: 'Next', text: 'Next' }] } })
  assert.equal(root.SillyTavern.chat, chat)
  assert.equal(chat[0].mes, 'Next')
  root.emit('message', { __dshSillyTavern: true, channel: 'frame-a', event: 'compat-state', payload: { ...snapshot(), runtimeRevision: 1, messages: [{ message_id: 2, mes: 'stale' }] } })
  assert.equal(chat[0].mes, 'Next')
})

test('opening and conversation documents share the same compatibility bootstrap and composer facade', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  assert.equal(source.includes('__dshSillyTavernGreeting'), false)
  assert.match(source, /function GreetingHtmlFrame[\s\S]*h\(TrustedFrame/)
  assert.match(source, /getElementById\\\(\\s\*\(\['"\]\)send_textarea/)
  assert.match(source, /__dshComposerSend/)
  assert.match(source, /backgroundScripts\.map\(script => h\(TrustedFrame/)
})
