import { getRegexedString, REGEX_PLACEMENT, regexRulesForState, regexScopeForState } from './regex.js'
import { sessionMessages } from './prompt.js'

function blockText(block) {
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : undefined
}

function executeRegex(text, placement, sources, options, phase) {
  const result = getRegexedString(text, placement, sources, options)
  if (result.errors.length > 0) console.warn(`[dsh-sillytavern] Regex errors during ${phase}`, result.errors)
  return result.text
}

function mapMessageContent(message, transformText, transformReasoning) {
  if (!Array.isArray(message?.content)) return message
  let changed = false
  const content = message.content.map(block => {
    if (block?.type === 'text' && typeof block.text === 'string') {
      const text = transformText(block.text)
      if (text !== block.text) changed = true
      return text === block.text ? block : { ...block, text }
    }
    if (block?.type === 'reasoning' && typeof block.text === 'string') {
      const text = transformReasoning(block.text)
      if (text !== block.text) changed = true
      return text === block.text ? block : { ...block, text }
    }
    return block
  })
  return changed ? { ...message, content } : message
}

export function transformPromptMessages(messages, state) {
  if (!Array.isArray(messages) || state === undefined) return messages
  const sources = regexRulesForState(state)
  const history = messages.flatMap((message, index) => {
    const text = Array.isArray(message?.content) ? message.content.map(blockText).filter(value => value !== undefined).join('\n') : ''
    return message?.role === 'user' || message?.role === 'assistant' ? [{ role: message.role, text, seq: index }] : []
  })
  const scope = regexScopeForState(state, history)
  const usable = messages.flatMap((message, index) => message?.role === 'user' || message?.role === 'assistant' ? [index] : [])
  const depths = new Map(usable.map((index, position) => [index, usable.length - position - 1]))
  let changed = false
  const transformed = messages.map((message, index) => {
    const depth = depths.get(index)
    if (depth === undefined) return message
    const textPlacement = message.role === 'user' ? REGEX_PLACEMENT.USER_INPUT : REGEX_PLACEMENT.AI_OUTPUT
    const next = mapMessageContent(
      message,
      text => executeRegex(text, textPlacement, sources, { isPrompt: true, depth, scope }, 'prompt projection'),
      text => executeRegex(text, REGEX_PLACEMENT.REASONING, sources, { isPrompt: true, depth, scope }, 'reasoning prompt projection'),
    )
    if (next !== message) changed = true
    return next
  })
  return changed ? transformed : messages
}

export function transformRawUserMessages(messages, state, history = []) {
  if (!Array.isArray(messages) || state === undefined) return messages
  const sources = regexRulesForState(state)
  const scope = regexScopeForState(state, history)
  const direct = messages.flatMap((message, index) => message?.role === 'user' && (message.source === undefined || message.source?.kind === 'user') ? [index] : [])
  const depths = new Map(direct.map((index, position) => [index, direct.length - position - 1]))
  let changed = false
  const transformed = messages.map((message, index) => {
    const depth = depths.get(index)
    if (depth === undefined) return message
    const next = mapMessageContent(
      message,
      text => executeRegex(text, REGEX_PLACEMENT.USER_INPUT, sources, { depth, scope }, 'raw user input'),
      text => text,
    )
    if (next !== message) changed = true
    return next
  })
  return changed ? transformed : messages
}

function hasRawRule(sources, placement) {
  return [...sources.global, ...sources.preset, ...sources.scoped].some(script => script?.kind === 'regex'
    && script.enabled === true
    && script.disabled !== true
    && script.markdownOnly !== true
    && script.promptOnly !== true
    && Array.isArray(script.placement)
    && script.placement.includes(placement))
}

/** Buffer only when raw assistant/reasoning rules exist, then rewrite matching stream blocks before persistence. */
export function transformRawAssistantStream(stream, state, history = []) {
  const sources = regexRulesForState(state)
  const transformText = hasRawRule(sources, REGEX_PLACEMENT.AI_OUTPUT)
  const transformReasoning = hasRawRule(sources, REGEX_PLACEMENT.REASONING)
  if (!transformText && !transformReasoning) return stream
  const scope = regexScopeForState(state, history)
  return (async function* () {
    const chunks = []
    try {
      for await (const chunk of stream) chunks.push(chunk)
    } catch (error) {
      // Preserve interrupted provider output exactly when there is no complete
      // block on which whole-message Regex can run; agent-loop can then commit
      // the partial transcript before it handles the thrown failure.
      for (const chunk of chunks) yield chunk
      throw error
    }
    const replacements = new Map()
    for (const chunk of chunks) {
      if (chunk?.type !== 'block-end' || typeof chunk.block?.text !== 'string') continue
      const placement = chunk.block.type === 'text' && transformText
        ? REGEX_PLACEMENT.AI_OUTPUT
        : chunk.block.type === 'reasoning' && transformReasoning ? REGEX_PLACEMENT.REASONING : undefined
      if (placement === undefined) continue
      const blockScope = { ...scope, messages: [...history, { role: 'assistant', text: chunk.block.text }] }
      replacements.set(chunk.index, executeRegex(chunk.block.text, placement, sources, { depth: 0, scope: blockScope }, placement === REGEX_PLACEMENT.REASONING ? 'raw reasoning output' : 'raw assistant output'))
    }
    const emitted = new Set()
    for (const chunk of chunks) {
      const replacement = replacements.get(chunk?.index)
      if (replacement === undefined) { yield chunk; continue }
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        if (emitted.has(chunk.index)) continue
        emitted.add(chunk.index)
        yield { ...chunk, text: replacement }
        continue
      }
      if (chunk.type === 'block-end' && (chunk.block?.type === 'text' || chunk.block?.type === 'reasoning')) {
        yield { ...chunk, block: { ...chunk.block, text: replacement } }
        continue
      }
      yield chunk
    }
  })()
}

export function promptRegexRequest(options, state) {
  const messages = transformPromptMessages(options.messages, state)
  return messages === options.messages ? options : { ...options, messages }
}

export function stateRegexContext(agent, store) {
  const state = store.promptState(agent)
  if (state === undefined) return undefined
  return { state, history: sessionMessages(agent) }
}
