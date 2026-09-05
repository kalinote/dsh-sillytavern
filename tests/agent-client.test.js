import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { apply as applyAgent } from '../agent.js'

test('agent face registers validated tools and loads session state inside prompt assembly', async () => {
  const sections = []
  const contexts = []
  const variables = []
  const tools = []
  const commands = []
  const events = new Map()
  const eventOptions = new Map()
  const calls = []
  let promptSignal
  let promptRoute
  const service = {
    eligible: agent => agent?.child !== true,
    promptFor: async (_agent, signal, route) => { promptSignal = signal; promptRoute = route; return { system: 'role', postHistory: '' } },
    bindPromptToRequest: (_agent, prompt) => `${prompt.system}\n\n<!-- request-bound -->`,
    store: { promptState: () => undefined },
    sessionView: agent => ({ card: null, memory: { rows: [], eventEdges: [], revision: 0 }, sessionId: agent.id }),
    memory: async (_agent, operation, signal) => { calls.push(operation); assert.equal(signal.aborted, false); return { revision: 1, result: [] } },
    memoryGraph: async (_agent, request, signal) => { calls.push(['graph', request]); assert.equal(signal.aborted, false); return { revision: 1, result: { events: [] } } },
    consolidateMemory: async (agent, signal) => {
      calls.push(['consolidateMemory', agent.id])
      assert.equal(signal.aborted, false)
      return { queued: true, startTurn: 1, endTurn: 2, chunks: 1 }
    },
    ensure: async () => { calls.push('ensure') },
    flushOpening: agent => { calls.push(['flushOpening', agent.id]); return true },
    transformUserMessages: (_agent, messages) => messages.map(message => ({ ...message, transformed: true })),
    runNarratorRegex: (_agent, input) => `narrator:${input}`,
    runRegex: (_agent, name, input) => `${name}:${input}`,
    regexState: () => true,
    toggleRegex: async (_agent, name, requested) => ({ name, enabled: requested ?? false }),
  }
  applyAgent({
    sillyTavern: service,
    systemPrompt: { section: value => sections.push(value), context: value => contexts.push(value), variable: (...value) => variables.push(value) },
    tools: { register: value => tools.push(value) },
    commands: { register: value => commands.push(value) },
    on(name, listener, options) { events.set(name, listener); eventOptions.set(name, options) },
  })
  assert.equal(sections.length, 2)
  assert.equal(contexts.length, 0)
  assert.equal(variables.length, 2)
  assert.deepEqual(tools.map(tool => tool.name), ['st_memory_query', 'st_memory_graph_query'])
  assert.deepEqual(commands.map(command => command.name), ['st-import', 'st-character', 'st-memory', 'st-memory-consolidate', 'narrator', 'regex', 'regex-state', 'regex-toggle'])
  const querySchema = tools[0].parameters
  assert.deepEqual(querySchema.properties.characterMatch.enum, ['any', 'all'])
  assert.deepEqual(querySchema.properties.order.enum, ['time_asc', 'time_desc', 'relevance'])
  assert.deepEqual(Object.keys(querySchema.properties.timeRange.properties), ['timeline', 'start', 'end'])
  assert.equal(querySchema.properties.eventId.type, 'string')
  assert.equal(querySchema.properties.location.oneOf[0].type, 'array')
  assert.equal(querySchema.properties.location.oneOf[0].items.type, 'string')
  assert.equal(querySchema.properties.location.oneOf[1].type, 'null')
  assert.equal(tools[1].parameters.properties.eventId.type, 'string')
  assert.match(tools[0].description, /bypass/)
  assert.match(tools[1].description, /incoming\/outgoing/)
  assert.match(sections[1].text, /maintained by separate background Agents/)
  assert.match(sections[1].text, /periodic consolidation/)
  assert.match(sections[1].text, /Never add, update, delete, deduplicate, or correct memory/)
  assert.match(sections[1].text, /st_memory_graph_query/)

  const preStepAgent = { id: 's1' }
  const preStep = await events.get('agent/pre-step')({ agent: preStepAgent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [] }] }))
  assert.equal(preStep.messages[0].transformed, true)
  const commandSignal = new AbortController().signal
  assert.deepEqual(await commands[3].handler({ agent: preStepAgent, signal: commandSignal }), { kind: 'success', text: '已排队定期记忆整理：第 1–2 轮，共 1 个连续任务。' })
  assert.deepEqual(await commands[4].handler({ agent: preStepAgent, rawInput: ' scene ', signal: commandSignal }), { kind: 'success', text: 'narrator:scene' })
  assert.deepEqual(await commands[5].handler({ agent: preStepAgent, rawInput: ' name="选项" <opinion>x</opinion>', signal: commandSignal }), { kind: 'success', text: '选项:<opinion>x</opinion>' })
  assert.deepEqual(await commands[6].handler({ agent: preStepAgent, rawInput: '选项', signal: commandSignal }), { kind: 'success', text: 'true' })
  assert.deepEqual(await commands[7].handler({ agent: preStepAgent, rawInput: 'state=off 选项', signal: commandSignal }), { kind: 'success', text: '选项' })
  calls.length = 0

  const controller = new AbortController()
  const assembly = { sections: [{ name: 'dsh-sillytavern:character', text: '' }], contexts: [], tools: [], variables: { provider: 'deepseek', model: 'deepseek-chat' } }
  const next = async () => { calls.push('next'); return assembly }
  const assembled = await events.get('system-prompt/assemble')(assembly, { agent: { id: 's1' }, signal: controller.signal }, next)
  assert.deepEqual(calls, ['ensure', ['flushOpening', 's1'], 'next'])
  assert.equal(promptSignal, controller.signal)
  assert.deepEqual(promptRoute, { provider: 'deepseek', model: 'deepseek-chat' })
  assert.deepEqual(eventOptions.get('system-prompt/assemble'), { prepend: true })
  assert.equal(assembled.sections[0].text, 'role\n\n<!-- request-bound -->')
  assert.deepEqual(assembled.variables, { provider: 'deepseek', model: 'deepseek-chat', char: 'Character', user: 'User' })

  await tools[0].execute({ action: 'delete' }, { agent: { id: 's1' }, signal: controller.signal })
  assert.equal(calls.at(-1).action, 'query', 'an extra action argument cannot override the fixed tool operation')
  const result = await tools[0].execute({ query: 'alice' }, { agent: { id: 's1' }, signal: controller.signal })
  assert.equal(result.ok, true)
  assert.deepEqual(calls.at(-1), { query: 'alice', action: 'query' })
  const graphResult = await tools[1].execute({ eventId: 'arrival' }, { agent: { id: 's1' }, signal: controller.signal })
  assert.equal(graphResult.ok, true)
  assert.deepEqual(calls.at(-1), ['graph', { eventId: 'arrival' }])

  calls.length = 0
  const child = { id: 'child', child: true }
  const untouched = await events.get('agent/pre-step')({ agent: child, messages: [], signal: controller.signal }, async () => ({ kind: 'enter', messages: [{ content: [] }] }))
  assert.equal(untouched.messages[0].transformed, undefined)
  const childAssembly = await events.get('system-prompt/assemble')(
    assembly,
    { agent: child, signal: controller.signal },
    async () => ({ ...assembly, sections: [...assembly.sections, { name: 'dsh-sillytavern:memory-guidance', text: 'hidden' }, { name: 'other', text: 'kept' }] }),
  )
  assert.deepEqual(childAssembly.sections.map(section => section.name), ['other'])
  await assert.rejects(tools[0].execute({}, { agent: child, signal: controller.signal }), /unavailable outside/)
})

test('0.9.0 manifest targets the DSH 0.1.2 Client dependency graph', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.version, '0.9.0')
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-chat'), true)
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), false)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-chat'], '^0.1.2-alpha.1')
})

test('memory management UI supports schema 5 keywords, recall provenance, and event relationships', async () => {
  const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
  const memoryTabSource = source.slice(source.indexOf('function MemoryScalar'), source.indexOf('function executableScript'))
  assert.match(memoryTabSource, /MEMORY_RECALL_POLICY_LABELS/)
  assert.match(memoryTabSource, /React\.useState\('after_compaction'\)/)
  assert.match(memoryTabSource, /value: 'always'/)
  assert.match(memoryTabSource, /value: 'after_compaction'/)
  assert.match(memoryTabSource, /value: 'query_only'/)
  assert.match(memoryTabSource, /keywords: memoryKeywords\(keywords\)/)
  assert.match(memoryTabSource, /2–10 个/)
  assert.match(memoryTabSource, /importance: 0\.6, recallPolicy, sourceRefs: \[\]/)
  assert.match(memoryTabSource, /session\.memory\?\.eventEdges \|\| \[\]/)
  assert.match(memoryTabSource, /function MemoryEventGraph/)
  assert.match(memoryTabSource, /直接前置事件/)
  assert.match(memoryTabSource, /直接后续事件/)
  assert.match(memoryTabSource, /relation\.edge\?\.reason/)
  assert.match(memoryTabSource, /relation\.edge\?\.sourceRefs/)
  assert.match(memoryTabSource, /未关联事件的记忆/)
  assert.match(memoryTabSource, /action: 'event_edge_delete'/)
  assert.match(memoryTabSource, /removesEventNode/)
  assert.match(memoryTabSource, /expectedRevision: session\.memory\?\.revision \?\? 0/)
  assert.match(source, /\.dst-memory-event-node\{content-visibility:auto/)
  assert.match(source, /\.dst-memory-row\{content-visibility:auto/)

  const helperSource = source.slice(source.indexOf('const MEMORY_STORY_TIME_STATUS_LABELS'), source.indexOf('function MemoryRow'))
  const helpers = vm.runInNewContext(`(() => { ${helperSource}; return { memoryEventGraph, memoryRecallPolicyText, memorySourceRefsText } })()`, { Object, Array, Number, String, Set, Map })
  assert.equal(helpers.memoryRecallPolicyText('always'), '始终自动召回')
  assert.equal(helpers.memoryRecallPolicyText('after_compaction'), '剧情折叠后自动召回')
  assert.equal(helpers.memoryRecallPolicyText('query_only'), '仅显式查询')
  const provenance = helpers.memorySourceRefsText([
    { eventSeq: 11, turn: 2, role: 'user' },
    { eventSeq: 12, turn: 2, role: 'assistant' },
    { eventSeq: 13, turn: 3, role: 'system' },
    { eventSeq: 14, turn: 4, role: 'user' },
  ])
  assert.equal(provenance, '#11 · 第 2 回合 · 用户；#12 · 第 2 回合 · 助手；#13 · 第 3 回合 · 系统；另 1 条')

  const edgeBefore = { id: 'edge-before', kind: 'precedes', predecessorEventId: 'event-before', successorEventId: 'event-a', reason: '铺垫', sourceRefs: [{ eventSeq: 10, turn: 1, role: 'assistant' }] }
  const edgeAfter = { id: 'edge-after', kind: 'precedes', predecessorEventId: 'event-a', successorEventId: 'event-after', reason: null, sourceRefs: [] }
  const graph = helpers.memoryEventGraph([
    { id: 'memory-a1', eventId: 'event-a' },
    { id: 'memory-a2', eventId: 'event-a' },
    { id: 'memory-free', eventId: null },
  ], [edgeBefore, edgeAfter])
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].eventId, 'event-a')
  assert.deepEqual(Array.from(graph.nodes[0].rows, row => row.id), ['memory-a1', 'memory-a2'])
  assert.deepEqual(Array.from(graph.nodes[0].predecessors, relation => relation.eventId), ['event-before'])
  assert.deepEqual(Array.from(graph.nodes[0].successors, relation => relation.eventId), ['event-after'])
  assert.equal(graph.nodes[0].predecessors[0].edge.reason, '铺垫')
  assert.deepEqual(Array.from(graph.ungroupedRows, row => row.id), ['memory-free'])
})

test('client bundle keeps additive controls and scopes exact assistant replacement to Tavern sessions', async () => {
  let definition
  const previous = globalThis.window
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options })
    const swipeId = JSON.parse(options.body).swipeId
    return { ok: true, status: 200, async json() { return { ok: true, value: { swipeId } } } }
  }
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  try {
    await import(new URL(`../client.cjs?test=${Date.now()}`, import.meta.url).href)
    assert.equal(definition.id, 'dsh-sillytavern')
    let hookStates = []
    const reactEffects = []
    const reactLayoutEffects = []
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
        useState(initial) { return [hookStates.length > 0 ? hookStates.shift() : typeof initial === 'function' ? initial() : initial, () => undefined] },
        useRef(value) { return { current: value } },
        useMemo(factory) { return factory() },
        useCallback(callback) { return callback },
        useEffect(effect) { reactEffects.push(effect) },
        useLayoutEffect(effect) { reactLayoutEffects.push(effect) },
        useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
      }
    })
    assert.equal(typeof plugin.apply, 'function')
    assert.deepEqual(plugin.inject, ['slots', 'commandUi', 'conversation'])

    let removed = false
    const style = { dataset: {}, textContent: '', remove() { removed = true } }
    globalThis.document = { createElement: () => style, head: { appendChild() {} } }
    const disposers = []
    const slots = []
    const slotOptions = []
    const slotComponents = []
    let commandDisposed = 0
    let slotsDisposed = 0
    let decoration
    const conversation = { blocks: { set() {}, storeFor: () => ({ getSnapshot: () => undefined }) } }
    plugin.apply({
      get(name) { return name === 'conversation' ? conversation : undefined },
      effect(callback) { const dispose = callback(); disposers.push(dispose); return dispose },
      commandUi: { decorate(value) { decoration = value; return () => { commandDisposed += 1 } } },
      slots: {
        inject(name, callback) { slots.push(name); const dispose = callback(); disposers.push(dispose); return dispose },
        register(options, component) { slotOptions.push(options); slotComponents.push(component); return () => { slotsDisposed += 1 } },
      },
    })
    assert.equal(decoration.name, 'st-import')
    assert.deepEqual(slots, ['conversation.input.left', 'conversation.input.dock', 'shell.overlay', 'settings.section', 'conversation.chat.commandview', 'conversation.chat.commandview'])
    assert.deepEqual(slotOptions.map(option => [option.name, option.id, option.order, option.priority]), [
      ['conversation.input.left', 'sillytavern-character', 25, undefined],
      ['conversation.input.dock', 'sillytavern-opening-greeting', -10, undefined],
      ['shell.overlay', 'dsh-sillytavern-overlay', 60, undefined],
      ['settings.section', 'sillytavern', 18, undefined],
      ['conversation.chat.commandview', undefined, undefined, undefined],
      ['conversation.chat.commandview', undefined, undefined, undefined],
    ])
    assert.equal(slotOptions[4].key, 'st-opening')
    assert.equal(slotOptions[5].key, 'narrator')
    assert.equal(slotOptions[1].inject, undefined)
    hookStates = [
      null,
      { loading: false, error: null, value: { binding: { cardId: 'card-a' }, card: { card: { data: { name: 'Alice' } } } } },
      { loading: false, error: null, value: { schemaVersion: 1, runtimeRevision: 0, sessionId: 'session-a', bindingRevision: 0, state: { sessionId: 'session-a', binding: { variables: {} }, history: [] }, cardRecord: { id: 'card-a' }, characterCard: { data: { name: 'Alice' } }, character: { name: 'Alice' }, persona: { name: 'User' }, variables: {}, globalVariables: {}, scriptInjections: [], messages: [], context: { chatId: 'session-a', characterId: 'card-a', name1: 'User', name2: 'Alice', chatMetadata: {} }, compatibility: {} } },
      { loading: false, error: null, value: { cards: [{ id: 'card-a', name: 'Alice' }] } },
      false,
    ]
    const sessionState = { byId: { 'session-a': { projectionValues: { agentPreset: 'sillytavern' } } } }
    const inputState = { draft: '已有草稿', phase: 'plain' }
    const useInput = selector => selector(inputState)
    let nextDraft
    const composerElement = slotComponents[0]({ sessionId: 'session-a', ...slotOptions[0].inject(), useInput, inputActions: { setDraft(value) { nextDraft = value } }, useSessions: selector => selector(sessionState) })
    assert.equal(composerElement.type.name, 'TavernCharacterSelect')
    assert.equal(composerElement.props.input, undefined, 'the fixture must use the public DSH input hook, not the removed props.input field')
    const legacyComposerElement = slotComponents[0]({ sessionId: 'legacy-session', useInput: selector => selector({ draft: '', phase: 'plain' }), inputActions: { setDraft() {} }, useSessions: selector => selector({ byId: { 'legacy-session': { agentPreset: 'sillytavern' } } }) })
    assert.equal(legacyComposerElement.type.name, 'TavernCharacterSelect', 'pre-0.1.2 Session summaries remain compatible')
    assert.deepEqual(composerElement.props.appendInput('1. 前往练习室'), { draft: '已有草稿\n1. 前往练习室' })
    assert.equal(nextDraft, '已有草稿\n1. 前往练习室')
    assert.deepEqual(composerElement.props.appendInput('2. 留在原地'), { draft: '已有草稿\n1. 前往练习室\n2. 留在原地' }, 'rapid bridge calls serialize against the synchronous draft ref')
    assert.equal(nextDraft, '已有草稿\n1. 前往练习室\n2. 留在原地')
    assert.throws(() => composerElement.props.appendInput('   '), /empty or too large/)
    const composerView = composerElement.type(composerElement.props)
    assert.equal(composerView.props.className, 'dst-composer-character')
    const rendererEffect = reactEffects.find(effect => String(effect).includes('registerMessageRenderers'))
    assert.equal(typeof rendererEffect, 'function')
    const disposeRenderers = rendererEffect()
    assert.deepEqual(slotOptions.slice(-5).map(option => [option.name, option.key, option.priority, option.locale]), [
      ['conversation.chat.node', 'assistant-step', -20, undefined],
      ['conversation.chat.node', 'user', -20, undefined],
      ['conversation.chat.node', 'steering', -20, undefined],
      ['conversation.chat.node', 'turn-process', -20, 'chat'],
      ['conversation.chat.node', 'system-prompt', -20, 'chat'],
    ])
    assert.deepEqual(slotComponents.slice(-5).map(component => component.name), ['TavernAssistantNode', 'TavernUserNode', 'TavernUserNode', 'TavernTurnProcessNode', 'TavernSystemPromptNode'])
    const messageRenderers = Object.fromEntries(slotOptions.map((option, index) => [option.key, slotComponents[index]]).filter(([key]) => key !== undefined))
    const assistantRenderer = messageRenderers['assistant-step']
    const turnProcessRenderer = messageRenderers['turn-process']
    const systemPromptRenderer = messageRenderers['system-prompt']
    const storySpec = {
      turn: 7,
      controlAnchorSeq: 8,
      processStartSeq: 10,
      answerAnchorSeq: 20,
      answerStep: 2,
      inlineReasoning: true,
      messageCount: 0,
      toolCallCount: 2,
      subagentCount: 0,
    }
    const storyNode = {
      anchorSeq: 10,
      location: { kind: 'turn', turn: { turn: 7, status: 'closed' } },
      data: { ...storySpec },
    }
    const processOpenWrites = []
    const storyTurnProcess = { spec: storySpec, foldable: true, open: false, setOpen(value) { processOpenWrites.push(value) } }
    const closedStory = turnProcessRenderer({ sessionId: 'session-a', node: storyNode, turnProcess: storyTurnProcess })
    assert.equal(closedStory.type, 'button')
    assert.equal(closedStory.props.className, 'dst-story-progress-toggle')
    assert.equal(closedStory.props['aria-expanded'], false)
    assert.equal(closedStory.props['data-turn-process-tool-calls'], 2)
    assert.equal(closedStory.children[0].children[0], '剧情推进', 'the native process disclosure is relabeled without a second outer store')
    closedStory.props.onClick({ currentTarget: { focus() {} } })
    assert.deepEqual(processOpenWrites, [true], 'story progress directly controls the native process state')
    const openedStory = turnProcessRenderer({ sessionId: 'session-a', node: storyNode, turnProcess: { ...storyTurnProcess, open: true } })
    assert.equal(openedStory.props['aria-expanded'], true)
    openedStory.props.onClick({ currentTarget: { focus() {} } })
    assert.deepEqual(processOpenWrites, [true, false])

    const systemNode = (anchorSeq, text) => ({
      anchorSeq,
      location: { kind: 'turn', turn: { turn: 7, status: 'closed' } },
      data: { text },
    })
    for (const [anchorSeq, text] of [[7, '前置系统提示词'], [12, '流程中的系统提示词'], [20, '正文后的系统提示词']]) {
      const hiddenSystemPrompt = systemPromptRenderer({ sessionId: 'session-a', node: systemNode(anchorSeq, text) })
      assert.equal(hiddenSystemPrompt.type, 'span')
      assert.equal(hiddenSystemPrompt.props.hidden, true)
      assert.equal(hiddenSystemPrompt.props['data-dst-system-prompt-hidden'], true, 'all Tavern system-prompt rows use the no-gap hidden marker')
    }

    const finalAssistantNode = {
      seq: 20,
      anchorSeq: 20,
      location: { kind: 'turn', turn: { turn: 7, status: 'closed' } },
      data: {
        turn: 7,
        step: 2,
        status: 'settled',
        finalNode: { seq: 20 },
        blocks: [{ kind: 'reasoning', text: '隐藏推理' }, { kind: 'text', text: '剧情正文' }],
      },
    }
    const finalTurnProcess = { spec: storySpec, foldable: true, open: false, setOpen() {} }
    hookStates = []
    const hiddenReasoningAssistant = assistantRenderer({ sessionId: 'session-a', node: finalAssistantNode, turnProcess: finalTurnProcess, renderMessageImages() { return null }, useTurnData() { return undefined } })
    const hiddenReasoningFallback = hiddenReasoningAssistant.children[0]
    const hiddenReasoningView = hiddenReasoningFallback.type(hiddenReasoningFallback.props)
    const hiddenReasoningParts = hiddenReasoningView.children.flat()
    const reasoningWrapper = hiddenReasoningParts.find(part => part.type.name === 'StoryProcessReasoning')
    assert.equal(reasoningWrapper.props.hidden, true, 'collapsed native process hides final inline reasoning')
    assert.equal(hiddenReasoningParts.find(part => part.type.name === 'TavernMarkdownContent').props.text, '剧情正文', 'collapsing reasoning never hides the story body')
    hookStates = []
    const visibleReasoningAssistant = assistantRenderer({ sessionId: 'session-a', node: finalAssistantNode, turnProcess: { ...finalTurnProcess, open: true }, renderMessageImages() { return null }, useTurnData() { return undefined } })
    const visibleReasoningFallback = visibleReasoningAssistant.children[0]
    const visibleReasoningView = visibleReasoningFallback.type(visibleReasoningFallback.props)
    assert.equal(visibleReasoningView.children.flat().find(part => part.type.name === 'StoryProcessReasoning').props.hidden, false)
    hookStates = []
    const independentReasoningAssistant = assistantRenderer({ sessionId: 'session-a', node: finalAssistantNode, turnProcess: { ...finalTurnProcess, spec: { ...storySpec, inlineReasoning: false } }, renderMessageImages() { return null }, useTurnData() { return undefined } })
    const independentReasoningFallback = independentReasoningAssistant.children[0]
    const independentReasoningView = independentReasoningFallback.type(independentReasoningFallback.props)
    assert.equal(independentReasoningView.children.flat().find(part => part.type.name === 'StoryProcessReasoning').props.hidden, false, 'non-inline reasoning keeps the host visibility rule')
    const assistantElement = assistantRenderer({
      sessionId: 'session-a',
      node: { seq: 9, location: { kind: 'session' }, data: { status: 'settled', blocks: [{ kind: 'text', text: '**正文**\n\n<status>时间：下午 · 地点：机场</status>' }] } },
      renderMessageImages() { return null },
      useTurnData() { return undefined },
    })
    const assistantFallback = assistantElement.children[0]
    assert.equal(assistantFallback.type.name, 'AssistantFallback')
    const assistantView = assistantFallback.type(assistantFallback.props)
    assert.equal(assistantView.props.className, 'dst-assistant-message')
    const assistantContent = assistantView.children.flat()[0]
    assert.equal(assistantContent.type.name, 'TavernMarkdownContent')
    const assistantMarkdown = assistantContent.type(assistantContent.props)
    const assistantParts = assistantMarkdown.children.flat()
    assert.equal(assistantParts.some(child => child.type === MarkdownText && child.props.text.includes('**正文**')), true)
    assert.equal(assistantParts.some(child => child.type === MarkdownText && child.props.text.includes('<status>时间：下午 · 地点：机场</status>')), true)
    assert.equal(assistantParts.some(child => child.props.className === 'dst-generated-status'), false, 'undefined status tags remain ordinary Markdown source')
    const embeddedFenceReplacement = [
      'Before',
      '```html',
      '<!doctype html><html><body><script>',
      '// 容错：提取可能被```json等包裹的数据',
      'const parsed = true;',
      '</script><div>Rendered status</div></body></html>',
      '```',
      'After',
    ].join('\n')
    const replacedAssistant = assistantFallback.type({
      ...assistantFallback.props,
      replacementBase: { sessionId: 'session-a', seq: 9 },
      replacements: { 0: embeddedFenceReplacement },
    })
    const scriptConversation = replacedAssistant.children.flat()[0]
    assert.equal(scriptConversation.type.name, 'ScriptConversationContent')
    const renderedScript = scriptConversation.type(scriptConversation.props)
    assert.equal(renderedScript.type.name, 'RenderedScriptSegments')
    const renderedSegments = renderedScript.type(renderedScript.props)
    assert.equal(renderedSegments.children.length, 1)
    const conversationSegments = renderedSegments.children[0]
    assert.equal(conversationSegments.length, 3)
    assert.equal(conversationSegments[0].type.name, 'TavernMarkdownContent')
    assert.equal(conversationSegments[0].props.text, 'Before\n')
    assert.equal(conversationSegments[1].type.name, 'TrustedFrame')
    assert.match(conversationSegments[1].props.script.source, /提取可能被```json等包裹的数据/)
    assert.match(conversationSegments[1].props.script.source, /const parsed = true;/)
    assert.match(conversationSegments[1].props.script.source, /<div>Rendered status<\/div>/)
    assert.doesNotMatch(conversationSegments[0].props.text, /const parsed/)
    assert.equal(conversationSegments[2].type.name, 'TavernMarkdownContent')
    assert.equal(conversationSegments[2].props.text, 'After')
    const userRenderer = messageRenderers.user
    const shortUser = userRenderer({
      sessionId: 'session-a',
      node: { data: { seq: 10, content: [{ type: 'text', text: '继续' }] } },
      renderMessageImages() { throw new Error('text-only user message must not render images') },
    })
    assert.equal(shortUser.props.className, 'dst-user-row')
    const shortUserStack = shortUser.children[0]
    assert.equal(shortUserStack.props.className, 'dst-user-stack')
    assert.equal(shortUserStack.children.length, 1)
    assert.equal(shortUserStack.children[0].props.className, 'dst-user-message')
    assert.equal(shortUserStack.children[0].children[0][0].type, MarkdownText)
    assert.equal(shortUserStack.children[0].children[0][0].props.text, '继续')
    let userImageRender
    const imageUser = userRenderer({
      sessionId: 'session-a',
      node: { data: { seq: 11, content: [{ type: 'image', attachment: 'image-a' }, { type: 'text', text: '图片说明' }] } },
      renderMessageImages(value) { userImageRender = value; return { type: 'figure', props: { 'data-images': true }, children: [] } },
    })
    assert.deepEqual(userImageRender, { images: [{ attachment: 'image-a' }], align: 'end' })
    assert.equal(imageUser.children[0].children[0].type, Fragment)
    assert.equal(imageUser.children[0].children[1].props.className, 'dst-user-message')
    hookStates = [{ 0: '```html\n<div>User Regex</div>\n```' }]
    const regexUser = userRenderer({
      sessionId: 'session-a',
      node: { data: { seq: 12, content: [{ type: 'text', text: 'raw user' }] } },
      renderMessageImages() { return null },
    })
    const regexBubble = regexUser.children[0].children[0]
    assert.equal(regexBubble.props.className, 'dst-user-message')
    assert.equal(regexBubble.children[0][0].type.name, 'ScriptConversationContent')
    disposeRenderers()
    const characterElement = composerView.children[0]
    assert.equal(characterElement.props.value, 'card-a')
    const characterView = characterElement.type(characterElement.props)
    assert.equal(characterView.type, Menu)
    assert.equal(characterView.props.className, 'dst-character-menu')
    assert.equal(characterView.props.selectedId, 'card-a')
    assert.deepEqual(characterView.props.items.filter(item => typeof item.label === 'string').map(item => item.label), ['Alice', '管理酒馆模式'])
    assert.equal(characterView.props.anchor.type, 'button')
    assert.equal(characterView.props.anchor.props['aria-label'], '当前角色卡')
    assert.equal(characterView.props.anchor.props['aria-haspopup'], 'menu')
    const tavernIcon = characterView.props.anchor.children[0]
    assert.equal(tavernIcon.type.name, 'TavernMugIcon')
    const tavernSvg = tavernIcon.type(tavernIcon.props)
    assert.equal(tavernSvg.type, 'svg')
    assert.equal(tavernSvg.props['aria-hidden'], true)
    assert.equal(tavernSvg.props.viewBox, '0 0 16 16')
    assert.equal(characterView.props.anchor.children[1].children[0], 'Alice')
    assert.equal(slotComponents[0]({ sessionId: 'session-b', blocks: conversation.blocks, useInput: selector => selector({ draft: '', phase: 'plain' }), inputActions: { setDraft() {} }, useSessions: selector => selector({ byId: { 'session-b': { projectionValues: { agentPreset: 'cat' } } } }) }), null)
    hookStates = [null, null, { loading: true, error: null, value: { characterName: 'Alice', text: 'Welcome, User.', swipeId: 0, swipeCount: 2 } }]
    const openingElement = slotComponents[1]({ sessionId: 'session-a', session: { blank: true }, useSessions: selector => selector(sessionState) })
    assert.equal(openingElement.type.name, 'TavernOpeningGreeting')
    const openingContent = openingElement.type(openingElement.props)
    assert.equal(openingContent.type.name, 'TavernOpeningGreetingContent')
    const openingView = openingContent.type(openingContent.props)
    assert.equal(openingView.type, 'section')
    assert.equal(openingView.props.className, 'dst-opening-greeting')
    assert.equal(openingView.props['aria-label'], '角色开场预览')
    assert.equal(openingView.props['aria-busy'], true, 'refresh keeps the previous preview mounted instead of flashing')
    assert.equal(openingView.children[0].children[1].children[0], 'Alice')
    assert.equal(openingView.children[0].children.length, 2, 'the visible opening-preview badge is removed')
    const renderedGreeting = openingView.children[1]
    assert.equal(renderedGreeting.type.name, 'RegexGreetingContent')
    const resolvedGreeting = renderedGreeting.type(renderedGreeting.props)
    assert.equal(resolvedGreeting.type.name, 'GreetingContent')
    const prepared = await renderedGreeting.props.onSetChatMessages([{ message_id: 0, swipe_id: 1 }], 'frame-a')
    assert.deepEqual(prepared, { message_id: 0, swipe_id: 1 })
    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0].url, '/api/dsh-sillytavern/opening/select')
    assert.equal(fetchCalls[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { sessionId: 'session-a', swipeId: 1 })
    assert.deepEqual(renderedGreeting.props.onCommitSwipe(1, 'frame-a'), { message_id: 0, swipe_id: 1 })
    assert.throws(() => renderedGreeting.props.onCommitSwipe(1, 'frame-a'), /does not match the prepared frame selection/)
    const markdownGreeting = resolvedGreeting.type(resolvedGreeting.props)
    assert.equal(markdownGreeting.children[0].type.name, 'TavernMarkdownContent')
    const markdownGreetingContent = markdownGreeting.children[0].type(markdownGreeting.children[0].props)
    const markdownGreetingPart = markdownGreetingContent.children.flat()[0]
    assert.equal(markdownGreetingPart.type, MarkdownText)
    assert.equal(markdownGreetingPart.props.text, 'Welcome, User.')
    assert.deepEqual(markdownGreetingPart.props.labels, { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' })
    const networkImageGreeting = resolvedGreeting.type({ text: '![track](http://127.0.0.1/state-changing-get)' })
    const networkImageContent = networkImageGreeting.children[0].type(networkImageGreeting.children[0].props)
    assert.equal(networkImageContent.children.flat()[0].props.text, '![track](http://127.0.0.1/state-changing-get)')
    const renderTavernParts = text => {
      const greeting = resolvedGreeting.type({ text })
      const content = greeting.children[0].type(greeting.children[0].props)
      assert.equal(content.props.className, 'dst-markdown-content')
      return content.children.flat()
    }
    const compatibleParts = renderTavernParts('**正文**\n\n<font color="#e58aaa">*爱音台词*</font>\n\n<status>**时间**：2020年4月12日  ·  **地点**：机场</status>\n\n```text\n<status>代码示例保持原样</status>\n```')
    const markdownParts = compatibleParts.filter(child => child.type === MarkdownText)
    assert.equal(markdownParts.some(child => child.props.text.includes('**正文**')), true)
    assert.equal(markdownParts.some(child => child.props.text.includes('```text\n<status>代码示例保持原样</status>')), true, 'fenced tag examples remain Markdown code instead of becoming UI')
    const coloredPart = compatibleParts.find(child => child.props.className === 'dst-legacy-font')
    assert.deepEqual(coloredPart.props.style, { color: '#e58aaa' })
    assert.equal(coloredPart.children[0].type, MarkdownText)
    assert.equal(coloredPart.children[0].props.text, '*爱音台词*')
    assert.equal(compatibleParts.some(child => child.props.className === 'dst-generated-status'), false)
    assert.equal(markdownParts.some(child => child.props.text.includes('<status>**时间**：2020年4月12日  ·  **地点**：机场</status>')), true, 'status is rendered only when a card Regex actually replaces it')
    const partialParts = renderTavernParts('<status>尚未闭合')
    assert.equal(partialParts.some(child => child.props.className === 'dst-generated-status'), false)
    assert.equal(partialParts.some(child => child.type === MarkdownText && child.props.text === '<status>尚未闭合'), true)
    const nestedParts = renderTavernParts('<status>外层 <font color="red">内层</font></status>')
    assert.equal(nestedParts.some(child => child.props.className === 'dst-generated-status' || child.props.className === 'dst-legacy-font'), false, 'nested compatibility tags remain literal Markdown')
    const inlineCodeParts = renderTavernParts('`<status>行内代码</status>`\n\n`<font color="red">颜色代码</font>`\n\n[<status>链接标签</status>](https://example.com)\n\n正文中的 <status>内联标签</status>')
    assert.equal(inlineCodeParts.some(child => child.props.className === 'dst-generated-status' || child.props.className === 'dst-legacy-font'), false, 'inline Markdown constructs never become compatibility UI')
    assert.equal(inlineCodeParts.some(child => child.type === MarkdownText && child.props.text.includes('`<status>行内代码</status>`')), true)
    const singleQuotedFont = renderTavernParts("<font color='#78a6d8'>单引号颜色</font>")
    assert.deepEqual(singleQuotedFont.find(child => child.props.className === 'dst-legacy-font').props.style, { color: '#78a6d8' })
    const trailingFenceParts = renderTavernParts('```text\n<font color="red">围栏内</font>\n```not-a-close\n<font color="red">仍在围栏内</font>\n```\n<font color="blue">围栏外</font>')
    assert.equal(trailingFenceParts.filter(child => child.props.className === 'dst-legacy-font').length, 1, 'fence markers with trailing text do not close the fence')
    assert.equal(trailingFenceParts.some(child => child.type === MarkdownText && child.props.text.includes('```not-a-close\n<font color="red">仍在围栏内</font>')), true)
    const mismatchedFenceParts = renderTavernParts('````text\r\n<font color="red">围栏内</font>\r\n~~~\r\n```\r\n````\r\n<font color="blue">围栏外</font>')
    assert.equal(mismatchedFenceParts.filter(child => child.props.className === 'dst-legacy-font').length, 1, 'mismatched fence chars and shorter markers stay inside the fence')
    const indentedFenceParts = renderTavernParts('   ~~~text\n<font color="red">围栏内</font>\n   ~~~\n<font color="blue">围栏外</font>')
    assert.equal(indentedFenceParts.filter(child => child.props.className === 'dst-legacy-font').length, 1, 'three-space-indented CommonMark fences are protected')
    const indentedCodeParts = renderTavernParts('正文\n\n    <font color="red">缩进代码</font>\n<font color="blue">普通颜色</font>')
    assert.equal(indentedCodeParts.filter(child => child.props.className === 'dst-legacy-font').length, 1, 'four-space Markdown code stays literal')
    const unclosedFenceParts = renderTavernParts('```text\n<font color="red">未闭合围栏</font>')
    assert.equal(unclosedFenceParts.some(child => child.props.className === 'dst-legacy-font'), false)
    const mixedGreeting = resolvedGreeting.type({ text: '<start>\n**Before**\n```html\n<!doctype html><html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1/state-changing-get"><style>.cover{background:url(https://tracker.invalid/cover.png)}</style></head><body onload="window.onloadEvil=true"><script>window.evil=true</script><img src="https://gitgud.io/AncientCY/repo/-/raw/master/background/BanG_Dream!_Our_Notes_CN_Logo.png" alt="Cover" onerror="this.style.display=\'none\'"><button onclick="window.clickEvil=true"><strong>Rendered</strong></button><a href="javascript:window.linkEvil=true">Link</a></body></html>\n```\nAfter\n</start>' })
    assert.equal(mixedGreeting.children[0].type.name, 'TavernMarkdownContent')
    const mixedBefore = mixedGreeting.children[0].type(mixedGreeting.children[0].props)
    assert.equal(mixedBefore.children.flat()[0].type, MarkdownText)
    assert.equal(mixedBefore.children.flat()[0].props.text, '**Before**')
    assert.equal(mixedGreeting.children[1].type.name, 'GreetingHtmlFrame')
    const htmlFrameWrapper = mixedGreeting.children[1].type(mixedGreeting.children[1].props)
    assert.equal(htmlFrameWrapper.type.name, 'TrustedFrame')
    const htmlFrame = htmlFrameWrapper.type(htmlFrameWrapper.props)
    assert.equal(htmlFrame.type, 'iframe')
    assert.equal(htmlFrame.props.sandbox, 'allow-scripts allow-forms allow-popups allow-downloads allow-modals')
    assert.equal(htmlFrame.props.referrerPolicy, undefined)
    assert.match(htmlFrame.props.srcDoc, /installCompatibilityRuntime/)
    assert.match(htmlFrame.props.srcDoc, /const setChatMessages = async \(messages, options = \{\}\)/)
    assert.match(htmlFrame.props.srcDoc, /__dshSillyTavern: true/)
    assert.doesNotMatch(htmlFrame.props.srcDoc, /__dshSillyTavernGreeting/)
    assert.doesNotMatch(htmlFrame.props.srcDoc, /Content-Security-Policy/)
    assert.match(htmlFrame.props.srcDoc, /http-equiv="refresh"/i)
    assert.match(htmlFrame.props.srcDoc, /window\.(?:evil|onloadEvil|clickEvil|linkEvil)/)
    assert.match(htmlFrame.props.srcDoc, /https:\/\/gitgud\.io\/AncientCY\/repo\/-\/raw\/master\/background\/BanG_Dream!_Our_Notes_CN_Logo\.png/)
    assert.match(htmlFrame.props.srcDoc, /onerror="this\.style\.display='none'"/)
    assert.match(htmlFrame.props.srcDoc, /javascript:window\.linkEvil=true/)
    assert.match(htmlFrame.props.srcDoc, /<strong>Rendered<\/strong>/)
    assert.equal(mixedGreeting.children[2].type.name, 'TavernMarkdownContent')
    const mixedAfter = mixedGreeting.children[2].type(mixedGreeting.children[2].props)
    assert.equal(mixedAfter.children.flat()[0].type, MarkdownText)
    assert.equal(mixedAfter.children.flat()[0].props.text, 'After')
    const embeddedFenceGreeting = resolvedGreeting.type({ text: '<start>\nBefore\n```html\n<!doctype html><html><body><script>\n// 容错：提取可能被```json等包裹的数据\nconst parsed = true;\n</script><div>Rendered status</div></body></html>\n```\nAfter\n</start>' })
    assert.equal(embeddedFenceGreeting.children.length, 3)
    assert.equal(embeddedFenceGreeting.children[1].type.name, 'GreetingHtmlFrame')
    const embeddedGreetingWrapper = embeddedFenceGreeting.children[1].type(embeddedFenceGreeting.children[1].props)
    const embeddedGreetingFrame = embeddedGreetingWrapper.type(embeddedGreetingWrapper.props)
    assert.match(embeddedGreetingFrame.props.srcDoc, /提取可能被```json等包裹的数据/)
    assert.match(embeddedGreetingFrame.props.srcDoc, /const parsed = true;/)
    assert.match(embeddedGreetingFrame.props.srcDoc, /<div>Rendered status<\/div>/)
    const embeddedGreetingAfter = embeddedFenceGreeting.children[2].type(embeddedFenceGreeting.children[2].props)
    assert.equal(embeddedGreetingAfter.children.flat()[0].props.text, 'After')
    const consecutiveHtmlGreeting = resolvedGreeting.type({ text: '```html\n<!doctype html><html><body><div>Status</div></body></html>\n```\n```html\n<!doctype html><html><body><div>Options</div></body></html>\n```' })
    assert.equal(consecutiveHtmlGreeting.children.length, 2, 'adjacent HTML fences remain separate iframe documents')
    assert.equal(consecutiveHtmlGreeting.children.every(child => child.type.name === 'GreetingHtmlFrame'), true)
    assert.match(consecutiveHtmlGreeting.children[0].props.source, /<div>Status<\/div>/)
    assert.doesNotMatch(consecutiveHtmlGreeting.children[0].props.source, /<div>Options<\/div>/)
    assert.match(consecutiveHtmlGreeting.children[1].props.source, /<div>Options<\/div>/)
    assert.equal(openingView.children[2].children[0], '发送第一条消息后开始对话')
    assert.equal(slotComponents[1]({ sessionId: 'session-a', session: { blank: false }, useSessions: selector => selector(sessionState) }), null)
    assert.equal(slotComponents[1]({ sessionId: 'session-b', session: { blank: true }, useSessions: selector => selector({ byId: { 'session-b': { projectionValues: { agentPreset: 'cat' } } } }) }), null)
    assert.equal(slotComponents[4]({ node: { outcome: null } }), null)
    assert.equal(slotComponents[4]({ node: { outcome: { kind: 'error', text: 'superseded duplicate opening' } } }), null)
    const openingMessage = slotComponents[4]({ node: { outcome: { kind: 'success', text: 'Selected opening' } } })
    assert.equal(openingMessage.type, 'article')
    assert.equal(openingMessage.props.className, 'dst-opening-message')
    assert.equal(openingMessage.props['aria-label'], '角色开场')
    const openingMessageRegex = openingMessage.children[0].type(openingMessage.children[0].props)
    const openingMessageContent = openingMessageRegex.type(openingMessageRegex.props)
    assert.equal(openingMessageContent.children[0].type.name, 'TavernMarkdownContent')
    const openingMessageMarkdown = openingMessageContent.children[0].type(openingMessageContent.children[0].props)
    assert.equal(openingMessageMarkdown.children.flat()[0].type, MarkdownText)
    assert.equal(openingMessageMarkdown.children.flat()[0].props.text, 'Selected opening')
    const source = await readFile(new URL('../client.cjs', import.meta.url), 'utf8')
    const workerMarker = 'const regexWorkerSource = String.raw`'
    const workerStart = source.indexOf(workerMarker) + workerMarker.length
    const workerEnd = source.indexOf('`\n\n    const regexEngine', workerStart)
    let workerReply
    const workerSelf = { postMessage(value) { workerReply = value } }
    vm.runInNewContext(source.slice(workerStart, workerEnd), { self: workerSelf, RegExp, Set, String, Array, Error })
    const runRegex = (text, rules, scope = {}) => { workerReply = undefined; workerSelf.onmessage({ data: { id: 7, text, rules, options: { force: true }, scope } }); return workerReply }
    const renderedRegex = runRegex('<opinion>A<trim>B</opinion>', [{ id: 'rule', findRegex: '/<opinion>([\\s\\S]*?)<\\/opinion>/', source: '<button>$1</button>', trimStrings: ['<trim>'] }])
    assert.equal(renderedRegex.ok, true)
    assert.equal(renderedRegex.value.text, '<button>AB</button>')
    assert.equal(renderedRegex.value.applied[0], 'rule')
    const matchTokens = runRegex('<x>value</x>', [{ id: 'tokens', findRegex: '/<x>(?<body>[\\s\\S]*?)<\\/x>/', source: '{{match}}|$1|$<body>|$$|$&|$10', trimStrings: [] }])
    assert.equal(matchTokens.value.text, '<x>value</x>|value|value|$$|$&|')
    assert.equal(runRegex('aaa', [{ id: 'user-owned', findRegex: '/(a+)+$/', source: '<script>run()</script>', trimStrings: [] }]).value.text, '<script>run()</script>')
    const macroRegex = runRegex('A+B', [{ id: 'macro', findRegex: '/{{user}}/', source: '{{char}}', trimStrings: [], substituteRegex: 2 }], { user: 'A+B', char: 'Alice' })
    assert.equal(macroRegex.value.text, 'Alice')
    const historyMacro = runRegex('x', [{ id: 'history-macro', findRegex: '/x/', source: '{{lastUserMessage}}|{{lastCharMessage}}|{{globalvar::shared}}', trimStrings: [] }], { messages: [{ role: 'user', text: 'U' }, { role: 'assistant', text: 'A' }], globalVariables: { shared: 'G' } })
    assert.equal(historyMacro.value.text, 'U|A|G')
    const originalMacro = runRegex('x', [{ id: 'first', findRegex: '/x/', source: 'changed', trimStrings: [] }, { id: 'second', findRegex: '/changed/', source: '{{original}}', trimStrings: [] }])
    assert.equal(originalMacro.value.text, 'x')
    const dynamicMacros = runRegex('x', [{ id: 'dynamic', findRegex: '/x/', source: '{{lastMessageId}}|{{currentSwipeId}}|{{reverse::abc}}|{{roll::1d1}}', trimStrings: [] }], { messages: [{ role: 'assistant', text: 'A', seq: 7 }], currentSwipeId: 3 })
    assert.equal(dynamicMacros.value.text, '7|3|cba|1')
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const scriptsTabSource = source.slice(source.indexOf('function ScriptsTab'), source.indexOf('function TemplatesTab'))
    const switchScopeBody = scriptsTabSource.match(/onClick: \(\) => \{ (setRunningIds\(new Set\(\)\); setScopeKind\(id\)) \}/)?.[1]
    assert.equal(typeof switchScopeBody, 'string')
    const switchScriptScope = vm.runInNewContext(`(id, setRunningIds, setScopeKind) => { ${switchScopeBody} }`)
    let nextRunningIds
    let nextScopeKind
    switchScriptScope('global', value => { nextRunningIds = value }, value => { nextScopeKind = value })
    assert.equal(nextRunningIds.size, 0)
    assert.equal(nextScopeKind, 'global')
    assert.match(scriptsTabSource, /'执行脚本'/)
    assert.match(scriptsTabSource, /导入脚本默认启用/)
    assert.equal(scriptsTabSource.includes('酒馆助手'), false)
    assert.equal(scriptsTabSource.includes('TavernHelper'), false)
    assert.equal(scriptsTabSource.includes('导入脚本默认禁用'), false)
    assert.equal(source.includes('unsupported TavernHelper action'), false)
    assert.match(source, /unsupported script API action/)
    assert.match(source, /api\('\/card\/delete'/)
    assert.match(source, /确定永久删除角色卡/)
    assert.match(source, /删除角色卡/)
    assert.match(source, /disabled: deletingId !== null/)
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
    assert.equal(source.includes('allow-same-origin'), false)
    assert.equal(source.includes("conversation.chat.turnTail"), false)
    assert.match(source, /name: 'conversation\.chat\.commandview', key: 'st-opening'/)
    assert.match(source, /function TavernOpeningMessage/)
    assert.match(source, /\.dst-opening-message\{/)
    assert.match(source, /确认启用脚本/)
    assert.match(scriptsTabSource, /JavaScript 会作为当前会话的后台脚本自动运行/)
    assert.match(scriptsTabSource, /运行预览/)
    assert.match(scriptsTabSource, /停止预览/)
    assert.match(scriptsTabSource, /预览输入（只用于运行预览，不会保存）/)
    assert.match(scriptsTabSource, /setRunningIds\(new Set\(\)\); setScopeKind\(id\)/)
    assert.match(source, /regexEngine\.run\(sample, \[script\]/)
    assert.match(source, /compatibleHtmlSource/)
    assert.match(source, /window\.__dshComposerInput/)
    assert.match(source, /composerQueue = composerQueue\.then/)
    assert.match(source, /SillyTavern script RPC timed out/)
    assert.match(source, /clearTimeout\(item\.timer\)/)
    assert.match(source, /composerRestore\.push\(text\)/)
    assert.match(source, /message\.action === 'appendInput'/)
    assert.match(source, /compatRuntime\.setComposer\(sessionId, bridge\)/)
    assert.match(source, /inputActions\.setDraft\(next\)/)
    assert.doesNotMatch(source, /document\.querySelector\('\[data-input-scroll\]/)
    assert.match(scriptsTabSource, /这不会启用对话执行/)
    assert.match(source, /backgroundScripts\.map\(script => h\(TrustedFrame/)
    assert.match(source, /patchTrusted\(index, script\.id, \{ source: event\.target\.value \}\)/)
    assert.match(source, /const srcDoc = React\.useMemo\(\(\) => runtimeReady && transportReady \? trustedDocument/)
    assert.match(source, /\/event-state\?sessionId=/)
    assert.match(source, /approvalAttempts\.current\.get\(script\.id\) !== attempt/)
    assert.match(source, /eventState\?\.unavailable === true/)
    assert.match(source, /name: 'conversation\.chat\.node', key: 'assistant-step', priority: -20/)
    assert.match(source, /function displayRegexRules/)
    assert.doesNotMatch(source, /regex rendering timed out/)
    assert.doesNotMatch(source, /rejected nested repetition/)
    assert.match(source, /function TavernUserNode/)
    assert.match(source, /\.dst-user-row\{display:flex;flex-direction:column;align-items:flex-end/)
    assert.match(source, /\.dst-user-stack\{[^}]*max-width:min\(calc\(var\(--dsh-chat-content-width,748px\)\*\.702\),82%\)/)
    assert.match(source, /background:var\(--dsw-specific-bubble/)
    assert.doesNotMatch(source, /\.dst-user-message\{[^}]*margin-left:auto/)
    assert.match(source, /key: 'user', priority: -20/)
    assert.match(source, /key: 'steering', priority: -20/)
    assert.match(source, /scriptScopes/)
    assert.match(scriptsTabSource, /Find Regex 宏替换/)
    assert.match(scriptsTabSource, /Slash\/Narrator/)
    assert.match(scriptsTabSource, /系统不审查或过滤替换内容/)
    assert.doesNotMatch(source.slice(source.indexOf('function scriptApprovalMaterial'), source.indexOf('async function sourceDigest')), /slice\(0, (?:16|32)\)/)
    assert.match(source, /compatRuntime\.register\(/)
    assert.match(source, /greetingSegments\(text, true, false\)/)
    assert.match(source, /closing\[1\]\[0\] === fence\.char && closing\[1\]\.length >= fence\.length/)
    assert.doesNotMatch(source, /const fence = \/```html\?\\s\*\(\[\\s\\S\]\*\?\)```\/gi/)
    assert.match(source, /function TavernNarratorMessage/)
    assert.match(source, /用户 Regex 替换/)
    assert.match(source, /reasoning-\$\{index\}/)
    const worldbookTabSource = source.slice(source.indexOf('const WORLDBOOK_POSITIONS'), source.indexOf('function MemoryTab'))
    assert.match(worldbookTabSource, /label: '扫描深度'.*max: 100/)
    assert.match(worldbookTabSource, /label: '条目扫描深度（留空继承）'.*max: 100/)
    assert.match(worldbookTabSource, /const depthValue = .*\? 4 : numericDepth/)
    assert.match(worldbookTabSource, /label: '@Depth 深度'.*value: depthValue/)
    assert.match(worldbookTabSource, /patchExtension\('depth', event\.target\.value === '' \? 4/)
    assert.match(worldbookTabSource, /position \?\? '__unsupported__'/)
    assert.match(worldbookTabSource, /不支持的原值/)
    assert.match(worldbookTabSource, /保存其他设置不会改写它/)
    assert.match(worldbookTabSource, /正则关键字（原生 JavaScript）/)
    assert.doesNotMatch(worldbookTabSource, /受限子集|安全子集|不支持量词/)
    assert.match(worldbookTabSource, /书内 Token 上限（留空=不额外限制，0=禁用）/)
    assert.match(worldbookTabSource, /不会提高全局预算/)
    assert.match(worldbookTabSource, /设为 0 时仅“忽略预算”的条目仍可插入/)
    assert.match(worldbookTabSource, /worldbookExtension\(entry, 'outlet_name', \['outletName', 'outlet'\]\)/)
    assert.match(worldbookTabSource, /\{\{outlet::名称\}\}/)
    assert.match(worldbookTabSource, /session\.worldbookDiagnostics/)
    assert.match(worldbookTabSource, /最近一次生成诊断/)
    assert.match(worldbookTabSource, /运行时警告/)
    assert.match(worldbookTabSource, /尚无生成诊断/)
    const memoryTabSource = source.slice(source.indexOf('function MemoryScalar'), source.indexOf('function executableScript'))
    assert.match(memoryTabSource, /function MemoryValue/)
    assert.match(memoryTabSource, /h\(MemoryValue, \{ value: row\.value \}\)/)
    assert.match(memoryTabSource, /查看原始 JSON/)
    assert.match(memoryTabSource, /重要度/)
    assert.match(memoryTabSource, /row\.keywords\.map/)
    assert.doesNotMatch(memoryTabSource, /row\.tags/)
    assert.match(memoryTabSource, /storyTimeStatus/)
    assert.match(memoryTabSource, /value: 'label-only'/)
    assert.match(memoryTabSource, /value: 'normalized'/)
    assert.match(memoryTabSource, /state: 'unknown'/)
    assert.match(memoryTabSource, /state: 'label-only'/)
    assert.match(memoryTabSource, /state: 'normalized'/)
    assert.match(memoryTabSource, /storyTime: storyTime/)
    assert.match(memoryTabSource, /function memoryLocation/)
    assert.match(memoryTabSource, /text\.split\('\/'\)/)
    assert.match(memoryTabSource, /location: memoryLocation\(location\)/)
    assert.match(memoryTabSource, /地点路径（从大到小，以 \/ 分隔，可留空）/)
    assert.match(memoryTabSource, /location\.join\(' \/ '\)/)
    assert.match(memoryTabSource, /characters: memoryCharacters\(characters\)/)
    assert.match(memoryTabSource, /row\.storyTime/)
    assert.match(memoryTabSource, /row\.location/)
    assert.match(memoryTabSource, /row\.characters/)
    assert.match(memoryTabSource, /eventId: eventId\.trim\(\) \|\| undefined/)
    assert.match(source, /\.dst-memory-field\{display:grid/)
    assert.match(source, /\.dst-memory-row\{content-visibility:auto/)
    const worldbookHelperSource = source.slice(source.indexOf('function worldbookExtension'), source.indexOf('function worldbookPolicy'))
    const worldbookHelpers = vm.runInNewContext(`(() => { ${worldbookHelperSource}; return { worldbookPosition } })()`, { Object, Array, Number })
    assert.equal(worldbookHelpers.worldbookPosition({ extensions: { position: 99 } }), undefined, 'unknown positions stay unknown instead of becoming Before Char')
    assert.equal(worldbookHelpers.worldbookPosition({ extensions: { position: null } }), undefined)
    assert.equal(worldbookHelpers.worldbookPosition({ extensions: { position: '' } }), undefined)
    assert.equal(worldbookHelpers.worldbookPosition({ extensions: { position: 4 } }), 4)
    assert.equal(worldbookHelpers.worldbookPosition({ position: 'before_char', extensions: {} }), 0)
    assert.equal(source.includes('conversation.hero.agentPreset'), false, 'the plugin must not replace the native Agent preset seat')
    assert.match(source, /conversation\.input\.left/)
    assert.match(source, /conversation\.input\.dock/)
    assert.match(source, /props\.session\?\.blank !== true/)
    assert.equal(source.includes('ctx.interval('), false)
    assert.equal(source.includes('pollRevision'), false)
    assert.equal(source.includes("addEventListener('focus'"), false)
    assert.match(source, /api\(`\/greeting\?sessionId=.*swipeId === null \? '' : `&swipeId=\$\{swipeId\}`.*\{ signal \}\)/)
    assert.match(source, /api\('\/opening\/select', \{ method: 'POST', body: JSON\.stringify\(\{ sessionId, swipeId: nextSwipe \}\) \}\)/)
    assert.match(source, /opening setChatMessages requires message_id 0 and a safe integer swipe_id/)
    assert.match(source, /unsupported SillyTavern slash command/)
    assert.match(source, /rpc\('commitSwipe', \{ swipe_id: selection\?\.swipe_id \}\)/)
    assert.match(source, /preparedSwipes\.current\.set\(channel, nextSwipe\)/)
    assert.match(source, /preparedSwipes\.current\.get\(channel\) !== nextSwipe/)
    assert.match(source, /event\.source !== root\.parent/)
    assert.match(source, /window\.clearTimeout\(closeTimer\.current\)/)
    assert.match(source, /overlay\.reset\(\)/)
    assert.match(source, /h\(MarkdownText/)
    assert.equal(source.includes('dst-opening-badge'), false)
    assert.equal(source.includes('dst-generated-status'), false, 'undefined status tags must not gain plugin-owned UI')
    assert.match(source, /height:max\(320px,calc\(100dvh - 260px\)\)/)
    assert.match(source, /font:14px\/1\.55 system-ui,sans-serif;display:flex;flex:0 0 auto;flex-direction:column/)
    assert.match(source, /@media\(max-width:560px\)\{\.dst-opening-greeting\{height:max\(320px,calc\(100dvh - 300px\)\)\}\}/)
    assert.match(source, /\.dst-opening-text\{display:flex;flex:1 1 auto;flex-direction:column/)
    assert.match(source, /\.dst-opening-html\{[^}]*min-height:0;flex:0 0 auto/)
    assert.match(source, /sandbox: 'allow-scripts allow-forms allow-popups allow-downloads allow-modals'/)
    assert.equal(source.includes('function staticGreetingHtml'), false)
    assert.equal(source.includes('function safeGreetingMarkdown'), false)
    assert.equal(source.includes('Content-Security-Policy'), false)
    assert.equal(source.includes('dangerouslySetInnerHTML'), false)
    assert.match(source, /agentPreset === 'sillytavern'/)
    assert.match(source, /'aria-label': '当前角色卡'/)
    assert.match(source, /function TavernMugIcon/)
    assert.equal(source.includes('IconPersonalizationOutline16'), false)
    assert.match(source, /\.dst-character-seat\.compact\.icon-only\{width:28px;max-width:28px/)
    assert.match(source, /\.dst-character-seat\.compact\.icon-only \.dst-character-chevron\{display:none\}/)
    assert.match(source, /blocks\.storeFor\(sessionId\)\.getSnapshot\(\) === ownedBlock\.current/)
    assert.match(source, /blocks\.set\(sessionId, previousBlock\.current\)/)
    assert.equal(source.includes("querySelector('[data-slot"), false, 'the additive control must not query product DOM')
    const trustedFrameSource = source.slice(source.indexOf('function TrustedFrame'), source.indexOf('function ScriptsTab'))
    assert.equal(trustedFrameSource.includes('overlay.changed()'), false)
    decoration.ui.onSelect({ id: 'manager' }, { sessionId: 'session-a' })
    assert.equal(slotComponents[2]().type, 'div')
    for (const dispose of disposers.reverse()) dispose?.()
    assert.equal(slotComponents[2](), null, 'plugin disposal must reset module-scoped overlay state')
    assert.equal(removed, true)
    assert.equal(commandDisposed, 1)
    assert.equal(slotsDisposed, 11)
  } finally { globalThis.window = previous; globalThis.document = previousDocument; globalThis.fetch = previousFetch }
})
