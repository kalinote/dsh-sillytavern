export const REGEX_PLACEMENT = Object.freeze({
  MD_DISPLAY: 0,
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
})

export const SUBSTITUTE_FIND_REGEX = Object.freeze({ NONE: 0, RAW: 1, ESCAPED: 2 })

function macroValue(token, scope) {
  const name = String(token).trim()
  const character = scope?.character ?? scope?.card?.data ?? {}
  const variables = scope?.variables ?? {}
  const globalVariables = scope?.globalVariables ?? {}
  if (name === 'char' || name === 'charIfNotGroup') return scope?.char ?? character.nickname ?? character.name ?? ''
  if (name === 'user') return scope?.user ?? scope?.persona?.name ?? scope?.userPersona?.name ?? ''
  if (name === 'notChar') return scope?.user ?? scope?.persona?.name ?? scope?.userPersona?.name ?? ''
  if (name === 'group' || name === 'groupNotMuted') return scope?.group ?? ''
  if (name === 'description') return character.description ?? ''
  if (name === 'personality') return character.personality ?? ''
  if (name === 'scenario') return character.scenario ?? ''
  if (name === 'firstMessage' || name === 'first_mes' || name === 'charFirstMessage') return character.first_mes ?? character.firstMessage ?? ''
  if (name.startsWith('charFirstMessage::')) {
    const index = Number(name.slice(18))
    const greetings = [character.first_mes ?? character.firstMessage ?? '', ...(Array.isArray(character.alternate_greetings) ? character.alternate_greetings : [])]
    return Number.isSafeInteger(index) && index >= 0 ? greetings[index] ?? '' : ''
  }
  if (name === 'persona') return scope?.persona?.description ?? scope?.userPersona?.description ?? ''
  if (name === 'mesExamples' || name === 'mesExamplesRaw') return character.mes_example ?? ''
  if (name === 'systemPrompt' || name === 'charPrompt') return character.system_prompt ?? ''
  if (name === 'charInstruction') return character.post_history_instructions ?? ''
  if (name === 'charCreatorNotes') return character.creator_notes ?? ''
  if (name === 'charVersion') return character.character_version ?? ''
  if (name === 'input') return scope?.input ?? ''
  if (name === 'original') return scope?.original ?? ''
  if (name === 'newline') return '\n'
  if (name.startsWith('newline::')) return '\n'.repeat(Math.max(0, Math.min(10_000, Number(name.slice(9)) || 0)))
  if (name === 'space') return ' '
  if (name.startsWith('space::')) return ' '.repeat(Math.max(0, Math.min(10_000, Number(name.slice(7)) || 0)))
  if (name === 'noop') return ''
  if (name === 'date') return new Date(scope?.now ?? Date.now()).toLocaleDateString()
  if (name === 'time') return new Date(scope?.now ?? Date.now()).toLocaleTimeString()
  if (name === 'weekday') return new Date(scope?.now ?? Date.now()).toLocaleDateString(undefined, { weekday: 'long' })
  if (name === 'isodate') return new Date(scope?.now ?? Date.now()).toISOString().slice(0, 10)
  if (name === 'isotime') return new Date(scope?.now ?? Date.now()).toISOString().slice(11, 19)
  if (name === 'lastMessage') return scope?.messages?.at?.(-1)?.text ?? ''
  if (name === 'lastUserMessage') return [...(scope?.messages ?? [])].reverse().find(message => message?.role === 'user')?.text ?? ''
  if (name === 'lastCharMessage') return [...(scope?.messages ?? [])].reverse().find(message => message?.role === 'assistant')?.text ?? ''
  if (name === 'lastMessageId') return String(scope?.messages?.at?.(-1)?.seq ?? '')
  if (name === 'firstIncludedMessageId' || name === 'firstDisplayedMessageId') return String(scope?.messages?.[0]?.seq ?? '')
  if (name === 'allChatRange') return (scope?.messages ?? []).map(message => message?.text ?? '').join('\n')
  if (name === 'currentSwipeId' || name === 'lastSwipeId') return String(scope?.currentSwipeId ?? 0)
  if (name.startsWith('reverse::')) return [...name.slice(9)].reverse().join('')
  if (name.startsWith('random::') || name.startsWith('pick::')) {
    const values = name.slice(name.indexOf('::') + 2).split('::')
    return values.length === 0 ? '' : values[Math.floor(Math.random() * values.length)] ?? ''
  }
  if (/^roll(?:::|\s)/i.test(name)) {
    const expression = name.replace(/^roll(?:::|\s)+/i, '').trim()
    const match = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(expression)
    if (match === null) return ''
    const count = Math.max(1, Math.min(1000, Number(match[1] || 1)))
    const sides = Math.max(1, Math.min(1_000_000, Number(match[2])))
    let total = Number(match[3] || 0)
    for (let index = 0; index < count; index += 1) total += 1 + Math.floor(Math.random() * sides)
    return String(total)
  }
  if (name.startsWith('getvar::')) return variables[name.slice(8)] ?? ''
  if (name.startsWith('globalvar::')) return globalVariables[name.slice(11)] ?? ''
  if (name.startsWith('getglobalvar::')) return globalVariables[name.slice(14)] ?? ''
  if (name.startsWith('hasvar::')) return Object.hasOwn(variables, name.slice(8)) ? 'true' : 'false'
  if (name.startsWith('hasglobalvar::')) return Object.hasOwn(globalVariables, name.slice(14)) ? 'true' : 'false'
  return undefined
}

/** Expand the SillyTavern macros this Bundle can resolve and preserve unknown macros verbatim. */
export function substituteRegexParams(input, scope = {}, transform = value => value) {
  return String(input ?? '').replace(/{{([\s\S]*?)}}/g, (whole, token) => {
    const value = macroValue(token, scope)
    return value === undefined ? whole : String(transform(String(value)))
  })
}

/** Official ESCAPED findRegex macro escaping. This applies only to expanded macro values. */
export function escapeRegexMacro(value) {
  return String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, character => {
    if (character === '\n') return '\\n'
    if (character === '\r') return '\\r'
    if (character === '\t') return '\\t'
    if (character === '\v') return '\\v'
    if (character === '\f') return '\\f'
    if (character === '\0') return '\\0'
    return `\\${character}`
  })
}

/** Match SillyTavern's regexFromString parser, including plain unwrapped patterns. */
export function regexFromString(input) {
  try {
    const text = String(input ?? '')
    const match = text.match(/(\/?)(.+)\1([a-z]*)/i)
    if (match === null) return undefined
    if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) return new RegExp(text)
    return new RegExp(match[2], match[3])
  } catch {
    return undefined
  }
}

function filterString(rawString, trimStrings, scope) {
  let output = String(rawString)
  for (const rawTrim of Array.isArray(trimStrings) ? trimStrings : []) {
    const trim = substituteRegexParams(rawTrim, scope)
    output = output.replaceAll(trim, '')
  }
  return output
}

function findRegexString(script, scope) {
  switch (Number(script?.substituteRegex)) {
    case SUBSTITUTE_FIND_REGEX.NONE:
      return String(script?.findRegex ?? '')
    case SUBSTITUTE_FIND_REGEX.RAW:
      return substituteRegexParams(script?.findRegex, scope)
    case SUBSTITUTE_FIND_REGEX.ESCAPED:
      return substituteRegexParams(script?.findRegex, scope, escapeRegexMacro)
    default:
      return String(script?.findRegex ?? '')
  }
}

/** Run one official-compatible SillyTavern Regex rule. No replacement code is filtered or sanitized. */
export function runRegexScript(script, rawString, { scope = {}, characterOverride } = {}) {
  let output = rawString
  if (!script || script.disabled === true || script.enabled === false || !script.findRegex || !rawString) return output
  const originalScope = { ...scope, original: scope?.original ?? rawString }
  const characterScope = characterOverride === undefined ? originalScope : { ...originalScope, char: characterOverride }
  const findRegex = regexFromString(findRegexString(script, characterScope))
  if (!findRegex) return output
  if (findRegex.global || findRegex.sticky) findRegex.lastIndex = 0
  const replacement = String(script.replaceString ?? script.source ?? '').replace(/{{match}}/gi, '$0')
  output = String(rawString).replace(findRegex, function (match) {
    const args = [...arguments]
    const expanded = replacement.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_token, number, groupName) => {
      let value
      if (number) value = args[Number(number)]
      else if (groupName) {
        const groups = args[args.length - 1]
        value = groups && typeof groups === 'object' ? groups[groupName] : undefined
      }
      if (!value) return ''
      return filterString(value, script.trimStrings, characterScope)
    })
    return substituteRegexParams(expanded, originalScope)
  })
  return output
}

function stageMatches(script, options) {
  return script.markdownOnly === true && options.isMarkdown === true
    || script.promptOnly === true && options.isPrompt === true
    || script.markdownOnly !== true && script.promptOnly !== true && options.isMarkdown !== true && options.isPrompt !== true
}

/** Apply ordered Global → Preset → Scoped rule arrays using SillyTavern's stage/depth/placement gates. */
export function getRegexedString(rawString, placement, sources, options = {}) {
  if (typeof rawString !== 'string') return { text: '', applied: [], errors: [] }
  if (rawString === '' || placement === undefined || options.extensionDisabled === true) return { text: rawString, applied: [], errors: [] }
  const rules = Array.isArray(sources)
    ? sources
    : [...(sources?.global ?? []), ...(sources?.preset ?? []), ...(sources?.scoped ?? [])]
  let text = rawString
  const passOptions = { ...options, scope: { ...(options.scope ?? {}), original: options.scope?.original ?? rawString } }
  const applied = []
  const errors = []
  for (const script of rules) {
    if (script?.kind !== undefined && script.kind !== 'regex') continue
    if (script?.enabled !== true || script?.disabled === true || !stageMatches(script, options)) continue
    if (options.isEdit === true && script.runOnEdit !== true) continue
    if (typeof options.depth === 'number') {
      if (!Number.isNaN(script.minDepth) && script.minDepth !== null && script.minDepth !== undefined && script.minDepth >= -1 && options.depth < script.minDepth) continue
      if (!Number.isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth !== undefined && script.maxDepth >= 0 && options.depth > script.maxDepth) continue
    }
    if (!Array.isArray(script.placement) || !script.placement.includes(placement)) continue
    try {
      const next = runRegexScript(script, text, passOptions)
      if (next !== text) applied.push(String(script.id ?? script.scriptName ?? script.name ?? ''))
      text = next
    } catch (error) {
      errors.push({ id: String(script.id ?? ''), message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { text, applied, errors }
}

export function regexRulesForState(state) {
  return {
    global: Array.isArray(state?.globalRegexScripts) ? state.globalRegexScripts : [],
    preset: Array.isArray(state?.presetRegexScripts) ? state.presetRegexScripts : [],
    scoped: Array.isArray(state?.record?.scripts) ? state.record.scripts : [],
  }
}

export function regexScopeForState(state, messages = []) {
  const data = state?.record?.card?.data ?? {}
  const character = {
    ...data,
    name: data.nickname || data.name || 'Character',
    firstMessage: data.first_mes ?? '',
  }
  return {
    card: state?.record?.card,
    character,
    char: character.name,
    user: state?.binding?.userPersona?.name || 'User',
    persona: state?.binding?.userPersona,
    userPersona: state?.binding?.userPersona,
    variables: state?.binding?.variables ?? {},
    globalVariables: state?.globalVariables ?? {},
    currentSwipeId: Number(state?.binding?.openingSwipeId ?? 0),
    messages,
  }
}
