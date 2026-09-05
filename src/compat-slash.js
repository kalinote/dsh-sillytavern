const HOST_COMMAND_NAMES = Object.freeze([
  'send',
  'sendas',
  'sys',
  'comment',
  'trigger',
  'continue',
  'regenerate',
  'setvar',
  'getvar',
  'inject',
  'flushinject',
  'messages',
  'run',
])

export const SLASH_ERROR_CODES = Object.freeze({
  PARSE: 'slash-parse-error',
  UNKNOWN_COMMAND: 'slash-unknown-command',
  HANDLER: 'slash-handler-error',
})

export class SlashCommandError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SlashCommandError'
    this.code = code
    this.details = details
  }
}

function parseError(message, offset, source) {
  return new SlashCommandError(SLASH_ERROR_CODES.PARSE, message, { offset, source })
}

function finishToken(tokens, token) {
  if (token === null) return null
  tokens.push(token)
  return null
}

function tokenize(source) {
  const pipeline = []
  let tokens = []
  let token = null
  let quote = null
  let escaped = false

  const append = (character, marksNamedSeparator = false) => {
    token ??= { value: '', namedSeparator: -1 }
    if (marksNamedSeparator && token.namedSeparator === -1) token.namedSeparator = token.value.length
    token.value += character
  }
  const finishStage = offset => {
    token = finishToken(tokens, token)
    if (tokens.length === 0) throw parseError('slash pipeline contains an empty command', offset, source)
    pipeline.push(tokens)
    tokens = []
  }

  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source[offset]
    if (escaped) {
      append(character)
      escaped = false
      continue
    }
    if (character === '\\') {
      token ??= { value: '', namedSeparator: -1 }
      escaped = true
      continue
    }
    if (quote !== null) {
      if (character === quote) quote = null
      else append(character, character === '=')
      continue
    }
    if (character === '"' || character === "'") {
      token ??= { value: '', namedSeparator: -1 }
      quote = character
      continue
    }
    if (character === '|') {
      finishStage(offset)
      continue
    }
    if (/\s/u.test(character)) {
      token = finishToken(tokens, token)
      continue
    }
    append(character, character === '=')
  }

  if (escaped) throw parseError('slash command ends with an incomplete escape', source.length - 1, source)
  if (quote !== null) throw parseError(`slash command has an unterminated ${quote} quote`, source.length, source)
  token = finishToken(tokens, token)
  if (tokens.length === 0) {
    if (pipeline.length === 0) throw parseError('slash command is empty', 0, source)
    throw parseError('slash pipeline contains an empty command', source.length, source)
  }
  pipeline.push(tokens)
  return pipeline
}

function commandFromTokens(tokens, index, source) {
  const commandToken = tokens[0].value
  if (!commandToken.startsWith('/') || commandToken.length === 1) {
    throw parseError(`pipeline command ${index + 1} must start with '/'`, 0, source)
  }
  const command = commandToken.slice(1).toLocaleLowerCase()
  const args = []
  const namedEntries = []
  for (const token of tokens.slice(1)) {
    if (token.namedSeparator > 0) {
      namedEntries.push([
        token.value.slice(0, token.namedSeparator),
        token.value.slice(token.namedSeparator + 1),
      ])
    } else {
      args.push(token.value)
    }
  }
  return Object.freeze({
    command,
    args: Object.freeze(args),
    named: Object.freeze(Object.fromEntries(namedEntries)),
  })
}

/** Parse a Slash command pipeline without executing it. */
export function parse(source) {
  if (typeof source !== 'string') throw parseError('slash command must be a string', 0, source)
  return Object.freeze(tokenize(source).map((tokens, index) => commandFromTokens(tokens, index, source)))
}

function normalizeCommandName(name) {
  if (typeof name !== 'string') throw new TypeError('slash command name must be a string')
  const normalized = name.trim().replace(/^\//u, '').toLocaleLowerCase()
  if (normalized === '') throw new TypeError('slash command name must not be empty')
  return normalized
}

function argumentText(invocation) {
  return invocation.args.length === 0 ? invocation.pipe : invocation.args.join(' ')
}

const COMMAND_DEFINITIONS = Object.freeze([
  Object.freeze({ name: 'pass', builtin: invocation => argumentText(invocation) }),
  Object.freeze({ name: 'echo', builtin: invocation => argumentText(invocation) }),
  ...HOST_COMMAND_NAMES.map(name => Object.freeze({ name, injected: true })),
])

export class SlashCommandRegistry {
  #handlers = new Map()

  register(name, handler) {
    const command = normalizeCommandName(name)
    if (typeof handler !== 'function') throw new TypeError(`slash handler for /${command} must be a function`)
    this.#handlers.set(command, handler)
    let active = true
    return Object.freeze({
      unregister: () => {
        if (!active) return false
        active = false
        if (this.#handlers.get(command) !== handler) return false
        return this.#handlers.delete(command)
      },
    })
  }

  unregister(name) {
    return this.#handlers.delete(normalizeCommandName(name))
  }

  has(name) {
    return this.#handlers.has(normalizeCommandName(name))
  }

  get(name) {
    return this.#handlers.get(normalizeCommandName(name))
  }

  list() {
    return [...this.#handlers.keys()].sort()
  }
}

/** Build the standard table-driven registry, optionally supplying host handlers. */
export function registry(handlers = {}) {
  if (handlers === null || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new TypeError('slash handlers must be an object')
  }
  const result = new SlashCommandRegistry()
  const registered = new Set()
  for (const definition of COMMAND_DEFINITIONS) {
    const handler = definition.builtin ?? handlers[definition.name]
    if (handler !== undefined) {
      result.register(definition.name, handler)
      registered.add(definition.name)
    }
  }
  for (const [name, handler] of Object.entries(handlers)) {
    const normalized = normalizeCommandName(name)
    if (!registered.has(normalized)) result.register(normalized, handler)
  }
  return result
}

/** Execute each parsed command sequentially, passing the prior result as `pipe`. */
export async function execute(source, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('slash execution options must be an object')
  }
  const commandRegistry = options.registry ?? registry()
  if (commandRegistry === null || typeof commandRegistry.get !== 'function') {
    throw new TypeError('slash execution registry must provide get(name)')
  }
  const pipeline = parse(source)
  let pipe = options.pipe ?? ''
  for (let index = 0; index < pipeline.length; index += 1) {
    options.signal?.throwIfAborted()
    const parsed = pipeline[index]
    const handler = commandRegistry.get(parsed.command)
    if (typeof handler !== 'function') {
      throw new SlashCommandError(
        SLASH_ERROR_CODES.UNKNOWN_COMMAND,
        `unknown slash command /${parsed.command}`,
        { command: parsed.command, index },
      )
    }
    const invocation = Object.freeze({
      ...parsed,
      index,
      pipe,
      context: options.context,
      signal: options.signal,
    })
    try {
      const result = await handler(invocation)
      if (result !== undefined) pipe = result
    } catch (cause) {
      if (cause?.name === 'AbortError') throw cause
      throw new SlashCommandError(
        SLASH_ERROR_CODES.HANDLER,
        `slash handler /${parsed.command} failed`,
        { command: parsed.command, index },
        cause,
      )
    }
  }
  return pipe
}

export { COMMAND_DEFINITIONS, HOST_COMMAND_NAMES }
