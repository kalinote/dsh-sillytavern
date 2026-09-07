const DEFAULT_ORDERED_PROMPTS = [
  'world_info_before',
  'persona_description',
  'char_description',
  'char_personality',
  'scenario',
  'world_info_after',
  'dialogue_examples',
  'chat_history',
  'user_input',
]

const ROLE_NUMBERS = { system: 0, user: 1, assistant: 2 }
const ROLES = new Set(Object.keys(ROLE_NUMBERS))

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function imageBlocks(value, label) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return values.map((image, index) => {
    if (typeof image !== 'string') {
      throw codedError(
        'generation-image-file-unavailable',
        `${label}${values.length > 1 ? `[${index}]` : ''} cannot carry a File through the DSH compatibility API; pass a URL or base64 string`,
      )
    }
    return { type: 'image', url: image }
  })
}

function messageFromRolePrompt(prompt, id, form) {
  if (!isRecord(prompt) || !ROLES.has(prompt.role)) throw new TypeError(`${form} must have a system, assistant, or user role`)
  const text = String(prompt.content ?? '')
  return {
    id,
    role: prompt.role,
    content: [
      ...(text === '' ? [] : [{ type: 'text', text }]),
      ...imageBlocks(prompt.image, `${form}.image`),
    ],
    source: { kind: 'plugin', plugin: 'dsh-sillytavern', form },
  }
}

function historyMessages(projection, request) {
  const historyLimit = request.max_chat_history === 'all' || request.max_chat_history === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.trunc(Number(request.max_chat_history) || 0))
  const visible = projection.messages.filter(item => item.is_hidden !== true)
  const selected = historyLimit === 0 ? [] : visible.slice(-historyLimit)
  return selected.map(item => ({
    id: `dsh-sillytavern-generate-${item.uid ?? item.message_id}`,
    role: item.role,
    content: [{ type: 'text', text: String(item.message ?? '') }],
    source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'compatibility-generation-history' },
  }))
}

function overrideHistory(request, fallback, createId) {
  const prompts = request.overrides?.chat_history?.prompts
  if (!Array.isArray(prompts)) return fallback
  return prompts.map((prompt, index) => messageFromRolePrompt(prompt, `raw-history-${createId()}-${index}`, 'raw-history'))
}

function requestInjections(request, createId) {
  if (!Array.isArray(request.injects)) return []
  return request.injects.map((inject, index) => {
    if (!isRecord(inject)) throw new TypeError(`injects[${index}] must be an object`)
    const role = ROLES.has(inject.role) ? inject.role : 'system'
    const position = inject.position === 'none' ? 'none' : 'in_chat'
    const depth = Number.isSafeInteger(inject.depth) && inject.depth >= 0 ? inject.depth : 0
    return {
      id: `dsh-generation-inject-${createId()}`,
      position,
      depth,
      role,
      content: String(inject.content ?? ''),
      should_scan: inject.should_scan === true,
      once: true,
      ownerFrameId: null,
      hasFilter: false,
      order: index,
    }
  })
}

function namedPromptValues(state, request) {
  const overrides = isRecord(request.overrides) ? request.overrides : {}
  const card = state.record.card.data
  const persona = state.binding.userPersona
  return {
    world_info_before: overrides.world_info_before,
    persona_description: overrides.persona_description ?? persona.description,
    char_description: overrides.char_description ?? card.description,
    char_personality: overrides.char_personality ?? card.personality,
    scenario: overrides.scenario ?? card.scenario,
    world_info_after: overrides.world_info_after,
    dialogue_examples: overrides.dialogue_examples ?? card.mes_example,
  }
}

function rawMessages(order, named, history, user, createId) {
  const messages = []
  for (const [index, item] of order.entries()) {
    if (typeof item === 'string') {
      if (item === 'chat_history') messages.push(...history)
      else if (item === 'user_input') {
        if (user.content.length > 0) messages.push(user)
      } else if (Object.hasOwn(named, item) && named[item] !== undefined && String(named[item]).trim() !== '') {
        messages.push({
          id: `raw-named-${createId()}-${index}`,
          role: 'system',
          content: [{ type: 'text', text: String(named[item]) }],
          source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: `raw-${item}` },
        })
      }
    } else if (isRecord(item)) {
      messages.push(messageFromRolePrompt(item, `raw-role-${createId()}-${index}`, 'raw-role-prompt'))
    }
  }
  return messages
}

function depthEntries(prepared, injections, withDepthEntries) {
  const requestIds = new Set(injections.map(item => item.id))
  const preparedEntries = Array.isArray(prepared.worldbookDepthEntries) ? prepared.worldbookDepthEntries : []
  const selected = withDepthEntries === false
    ? preparedEntries.filter(entry => requestIds.has(String(entry?.id)))
    : preparedEntries
  return selected.map(entry => ({
    ...entry,
    role: typeof entry.role === 'string' ? ROLE_NUMBERS[entry.role] ?? 0 : entry.role,
  }))
}

export function compatibilityPromptState(state, overrides) {
  if (state === undefined || !isRecord(overrides)) return state
  const sourceData = state.record.card.data
  const data = { ...sourceData }
  if (Object.hasOwn(overrides, 'char_description')) data.description = overrides.char_description
  if (Object.hasOwn(overrides, 'char_personality')) data.personality = overrides.char_personality
  if (Object.hasOwn(overrides, 'scenario')) data.scenario = overrides.scenario
  if (Object.hasOwn(overrides, 'dialogue_examples')) data.mes_example = overrides.dialogue_examples
  const userPersona = Object.hasOwn(overrides, 'persona_description')
    ? { ...state.binding.userPersona, description: overrides.persona_description }
    : state.binding.userPersona
  return {
    ...state,
    record: { ...state.record, card: { ...state.record.card, data } },
    binding: { ...state.binding, userPersona },
  }
}

export async function buildCompatibilityGenerationOptions({
  agent,
  mode,
  generationConfig,
  signal,
  store,
  service,
  injectDepthMessages,
  createId,
}) {
  const request = isRecord(generationConfig) ? generationConfig : {}
  const custom = isRecord(request.custom_api) ? request.custom_api : {}
  if (typeof custom.apiurl === 'string' && custom.apiurl.trim() !== '') {
    throw codedError('generation-custom-api-unavailable', 'custom_api.apiurl is unavailable in DSH compatibility mode; configure a DSH provider and select it by source/model')
  }
  if (request.preset_name !== undefined && request.preset_name !== 'in_use') {
    throw codedError('generation-preset-unavailable', `preset_name "${String(request.preset_name)}" is unavailable in DSH compatibility mode; only "in_use" is supported`)
  }
  imageBlocks(request.image, 'image')
  for (const prompt of [...(request.ordered_prompts ?? []), ...(request.overrides?.chat_history?.prompts ?? [])]) {
    if (isRecord(prompt)) imageBlocks(prompt.image, 'RolePrompt.image')
  }
  await store.refreshCompatChat(agent, signal)
  const state = store.promptState(agent)
  if (state === undefined) throw new Error('current session has no selected character')
  const provider = String(custom.source ?? agent.options?.provider ?? '').trim()
  const model = String(custom.model ?? agent.options?.model ?? '').trim()
  if (provider === '' || model === '') throw new Error('generation requires a configured provider and model')

  const injections = requestInjections(request, createId)
  const prepared = await service.promptFor(agent, signal, {
    provider,
    model,
    eligibleInjectionIds: request.__dshEligibleInjectionIds,
    generationInjections: injections,
    promptOverrides: request.overrides,
  })
  const projectedHistory = historyMessages(prepared.compatProjection ?? store.compatChatProjection(agent), request)
  const history = overrideHistory(request, projectedHistory, createId)
  const userInput = String(request.user_input ?? '')
  const user = {
    id: `${mode === 'raw' ? 'raw' : 'generate'}-user-${createId()}`,
    role: 'user',
    content: [
      ...(userInput === '' ? [] : [{ type: 'text', text: userInput }]),
      ...imageBlocks(request.image, 'image'),
    ],
    source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: mode === 'raw' ? 'raw-user-input' : 'generation-user-input' },
  }

  let system
  let messages
  if (mode === 'raw') {
    const order = Array.isArray(request.ordered_prompts) ? request.ordered_prompts : DEFAULT_ORDERED_PROMPTS
    system = ''
    const named = { ...namedPromptValues(state, request), ...(prepared.renderedNamedPrompts ?? {}) }
    messages = rawMessages(order, named, history, user, createId)
  } else {
    system = prepared.system
    messages = [...history]
    if (user.content.length > 0) messages.push(user)
  }
  messages = injectDepthMessages(
    { messages },
    depthEntries(prepared, injections, request.overrides?.chat_history?.with_depth_entries),
    createId,
  ).messages

  const result = { provider, model, system, messages }
  if (request.tools !== undefined) result.tools = request.tools
  if (request.tool_choice !== undefined) result.toolChoice = request.tool_choice
  if (request.json_schema !== undefined) result.jsonSchema = request.json_schema
  for (const [from, to] of [['temperature', 'temperature'], ['top_p', 'topP'], ['top_k', 'topK'], ['frequency_penalty', 'frequencyPenalty'], ['presence_penalty', 'presencePenalty']]) {
    const value = custom[from]
    if (typeof value === 'number' && Number.isFinite(value)) result[to] = value
  }
  if (typeof custom.max_tokens === 'number' && Number.isFinite(custom.max_tokens)) result.maxTokens = Math.max(1, Math.trunc(custom.max_tokens))
  return result
}
