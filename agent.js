import { memoryToolDefinitions } from './src/tools.js'

function parseRegexRun(rawInput) {
  const source = String(rawInput ?? '')
  const match = source.match(/^\s*name=(?:"([^"]+)"|'([^']+)'|(\S+))\s*([\s\S]*)$/i)
  if (match === null) throw new Error('用法：/regex name="脚本名称" 要处理的文本')
  return { name: match[1] ?? match[2] ?? match[3], input: match[4] ?? '' }
}

function parseRegexToggle(rawInput) {
  const source = String(rawInput ?? '').trim().replace(/^quiet=(?:true|false)\s+/i, '')
  const match = source.match(/^(?:state=(on|off|toggle)\s+)?([\s\S]+)$/i)
  if (match === null || match[2].trim() === '') throw new Error('用法：/regex-toggle [state=on|off|toggle] 脚本名称')
  const state = String(match[1] ?? 'toggle').toLowerCase()
  return { name: match[2].trim(), requested: state === 'toggle' ? undefined : state === 'on' }
}

export const name = 'dsh-sillytavern-agent'
export const inject = ['sillyTavern', 'systemPrompt', 'tools', 'commands']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'dsh-sillytavern:character',
    order: 5,
    text: '',
  })
  ctx.systemPrompt.variable('char', context => {
    if (context.agent === undefined || !ctx.sillyTavern.eligible(context.agent)) return 'Character'
    const state = ctx.sillyTavern.store.promptState(context.agent)
    return state?.record.card.data.nickname || state?.record.card.data.name || 'Character'
  })
  ctx.systemPrompt.variable('user', context => {
    if (context.agent === undefined || !ctx.sillyTavern.eligible(context.agent)) return 'User'
    return ctx.sillyTavern.store.promptState(context.agent)?.binding.userPersona.name || 'User'
  })
  ctx.systemPrompt.section({
    name: 'dsh-sillytavern:memory-guidance',
    order: 115,
    text: 'Long-term memory is recalled automatically before generation and maintained by a separate background Agent after the final reply is persisted. Your only responsibility is to continue the story. Never add, update, delete, deduplicate, or correct memory yourself. When automatically recalled facts are insufficient, use st_memory_query for matching rows or st_memory_graph_query for an event node plus its direct incoming/outgoing precedes relations. Explicit queries bypass automatic-recall and compaction gates. Use a short distinctive key, name, keyword, phrase, or eventId; structured characters/timeRange/location filters are also available, and a location path matches descendants.',
  })
  for (const definition of memoryToolDefinitions(ctx.sillyTavern)) ctx.tools.register(definition)

  ctx.commands.register({
    name: 'st-import',
    description: '导入并绑定 SillyTavern Character Card V3 到当前会话',
    handler: () => ({ kind: 'success', text: '请从左下角“+”菜单选择“导入 V3 角色卡”，并在文件对话框中选择 PNG、APNG 或 JSON。' }),
  })
  ctx.commands.register({
    name: 'st-character',
    description: '查看当前会话绑定的酒馆角色',
    async handler({ agent }) {
      await ctx.sillyTavern.ensure(agent)
      const view = ctx.sillyTavern.sessionView(agent)
      return view.card === null
        ? { kind: 'error', text: '当前会话尚未绑定角色卡。' }
        : { kind: 'success', text: `当前角色：${view.card.card.data.name}（V${view.card.card.spec_version}）` }
    },
  })
  ctx.commands.register({
    name: 'st-memory',
    description: '查看当前会话的长期记忆表格状态',
    async handler({ agent }) {
      await ctx.sillyTavern.ensure(agent)
      const view = ctx.sillyTavern.sessionView(agent)
      return { kind: 'success', text: `长期记忆：${view.memory.rows.length} 行、${view.memory.eventEdges.length} 条事件关系，修订 ${view.memory.revision}` }
    },
  })
  ctx.commands.register({
    name: 'narrator',
    description: '发送经过 Slash/Narrator Regex 原始阶段处理的旁白文本',
    input: { hint: '旁白文本' },
    async handler({ agent, rawInput, signal }) {
      await ctx.sillyTavern.ensure(agent, signal)
      return { kind: 'success', text: ctx.sillyTavern.runNarratorRegex(agent, String(rawInput).trim()) }
    },
  })
  ctx.commands.register({
    name: 'regex',
    description: '按名称运行一条已启用的 SillyTavern Regex 规则',
    input: { hint: 'name="脚本名称" 要处理的文本' },
    async handler({ agent, rawInput, signal }) {
      await ctx.sillyTavern.ensure(agent, signal)
      const parsed = parseRegexRun(rawInput)
      return { kind: 'success', text: ctx.sillyTavern.runRegex(agent, parsed.name, parsed.input) }
    },
  })
  ctx.commands.register({
    name: 'regex-state',
    description: '查询一条 SillyTavern Regex 规则是否启用',
    input: { hint: '脚本名称' },
    async handler({ agent, rawInput, signal }) {
      await ctx.sillyTavern.ensure(agent, signal)
      return { kind: 'success', text: ctx.sillyTavern.regexState(agent, String(rawInput).trim()) ? 'true' : 'false' }
    },
  })
  ctx.commands.register({
    name: 'regex-toggle',
    description: '切换一条 SillyTavern Regex 规则的启用状态',
    input: { hint: '[state=on|off|toggle] 脚本名称' },
    async handler({ agent, rawInput, signal }) {
      await ctx.sillyTavern.ensure(agent, signal)
      const parsed = parseRegexToggle(rawInput)
      const result = await ctx.sillyTavern.toggleRegex(agent, parsed.name, parsed.requested, signal)
      return { kind: 'success', text: result.name }
    },
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    if (!ctx.sillyTavern.eligible(payload.agent)) return next()
    await ctx.sillyTavern.ensure(payload.agent, payload.signal)
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const messages = ctx.sillyTavern.transformUserMessages(payload.agent, decision.messages)
    return messages === decision.messages ? decision : { ...decision, messages }
  })

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    if (context.agent === undefined) return next()
    if (!ctx.sillyTavern.eligible(context.agent)) {
      const transformed = await next()
      return { ...transformed, sections: transformed.sections.filter(section => !section.name.startsWith('dsh-sillytavern:')) }
    }
    await ctx.sillyTavern.ensure(context.agent, context.signal)
    ctx.sillyTavern.flushOpening(context.agent)
    const transformed = await next()
    const state = ctx.sillyTavern.store.promptState(context.agent)
    const route = {
      provider: transformed.variables.provider,
      model: transformed.variables.model,
    }
    const preparedPrompt = await ctx.sillyTavern.promptFor(context.agent, context.signal, route)
    const prompt = ctx.sillyTavern.bindPromptToRequest(context.agent, preparedPrompt, route)
    return {
      ...transformed,
      sections: transformed.sections.map(section => section.name === 'dsh-sillytavern:character' ? { ...section, text: prompt } : section),
      variables: {
        ...transformed.variables,
        char: state?.record.card.data.nickname || state?.record.card.data.name || 'Character',
        user: state?.binding.userPersona.name || 'User',
      },
    }
  }, { prepend: true })
}
