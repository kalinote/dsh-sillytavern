const BUILTIN_MACRO_PATTERN = /{{([\s\S]*?)}}/g

export const MACRO_ERROR_CODES = Object.freeze({
  CALLBACK: 'macro-callback-error',
  ASYNC_CALLBACK: 'macro-async-callback',
})

export class MacroRegistryError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'MacroRegistryError'
    this.code = code
    this.details = details
  }
}

function assertRegex(regex) {
  if (!(regex instanceof RegExp)) throw new TypeError('macro pattern must be a RegExp')
}

function macroKey(regex) {
  return `${regex.source}\u0000${regex.flags}`
}

function isPromiseLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function'
}

function asyncCallbackError(record) {
  return new MacroRegistryError(
    MACRO_ERROR_CODES.ASYNC_CALLBACK,
    `${record.label} returned a Promise, but macro substitution is synchronous`,
    { source: record.source, flags: record.flags, kind: record.kind },
  )
}

function callbackError(record, cause) {
  return new MacroRegistryError(
    MACRO_ERROR_CODES.CALLBACK,
    `${record.label} failed`,
    { source: record.source, flags: record.flags, kind: record.kind },
    cause,
  )
}

function callSynchronously(record, callback, match, captures, context) {
  let result
  try {
    result = callback(match, captures, context)
  } catch (cause) {
    if (cause instanceof MacroRegistryError) throw cause
    throw callbackError(record, cause)
  }
  if (isPromiseLike(result)) {
    // Observe a rejected async callback so the explicit synchronous-contract
    // error does not also become an unhandled rejection.
    void Promise.resolve(result).catch(() => undefined)
    throw asyncCallbackError(record)
  }
  return result
}

function replaceWithRecord(text, record, context) {
  // Always use a fresh RegExp. Neither a caller-owned lastIndex nor the
  // previous substitution pass is allowed to affect this pass.
  const regex = new RegExp(record.source, record.flags)
  regex.lastIndex = 0
  return text.replace(regex, (...replaceArguments) => {
    const match = replaceArguments[0]
    const hasNamedGroups = replaceArguments.at(-1) !== null && typeof replaceArguments.at(-1) === 'object'
    const groups = hasNamedGroups ? replaceArguments.at(-1) : undefined
    const inputIndex = hasNamedGroups ? replaceArguments.length - 2 : replaceArguments.length - 1
    const offsetIndex = inputIndex - 1
    const captures = replaceArguments.slice(1, offsetIndex)
    Object.defineProperties(captures, {
      groups: { value: groups === undefined ? undefined : Object.freeze({ ...groups }), enumerable: false },
      index: { value: replaceArguments[offsetIndex], enumerable: false },
      input: { value: replaceArguments[inputIndex], enumerable: false },
    })
    Object.freeze(captures)
    return callSynchronously(record, record.callback, match, captures, context)
  })
}

function normalizeConstructorOptions(options) {
  if (typeof options === 'function') return { resolver: options }
  if (options === undefined) return {}
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('MacroRegistry options must be an object or resolver function')
  }
  return options
}

export class MacroRegistry {
  #records = new Map()
  #resolver

  constructor(options) {
    const { resolver } = normalizeConstructorOptions(options)
    if (resolver !== undefined && typeof resolver !== 'function') throw new TypeError('macro resolver must be a function')
    this.#resolver = resolver
  }

  register(regex, callback) {
    assertRegex(regex)
    if (typeof callback !== 'function') throw new TypeError('macro callback must be a function')
    const key = macroKey(regex)
    const record = Object.freeze({
      key,
      source: regex.source,
      flags: regex.flags,
      kind: 'registered',
      label: `macro /${regex.source}/${regex.flags}`,
      callback,
    })
    this.#records.set(key, record)
    let active = true
    return Object.freeze({
      unregister: () => {
        if (!active) return false
        active = false
        if (this.#records.get(key) !== record) return false
        return this.#records.delete(key)
      },
    })
  }

  unregister(regex) {
    assertRegex(regex)
    return this.#records.delete(macroKey(regex))
  }

  clear() {
    const count = this.#records.size
    this.#records.clear()
    return count
  }

  get size() {
    return this.#records.size
  }

  substituteMacros(text, context) {
    let output = String(text)
    if (this.#resolver !== undefined) {
      const resolverRecord = {
        source: BUILTIN_MACRO_PATTERN.source,
        flags: BUILTIN_MACRO_PATTERN.flags,
        kind: 'resolver',
        label: 'macro resolver',
        callback: (match, captures, valueContext) => {
          const resolved = this.#resolver(captures[0].trim(), valueContext, match)
          return resolved === undefined ? match : resolved
        },
      }
      output = replaceWithRecord(output, resolverRecord, context)
    }
    for (const record of this.#records.values()) output = replaceWithRecord(output, record, context)
    return output
  }
}

