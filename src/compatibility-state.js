const clone = value => value === undefined ? undefined : structuredClone(value)

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}

function recordOfRecords(value) {
  const result = Object.create(null)
  for (const [key, entry] of Object.entries(record(value))) result[String(key)] = clone(record(entry))
  return result
}

export function emptyCompatibilityWorkspace() {
  return {
    schemaVersion: 1,
    revision: 0,
    variables: {
      global: {},
      presets: Object.create(null),
      characters: Object.create(null),
      scripts: Object.create(null),
      extensions: Object.create(null),
    },
    extensionSettings: Object.create(null),
    globalWorldbooks: [],
    characterWorldbooks: Object.create(null),
    lorebookSettings: {
      selected_global_lorebooks: [],
      scan_depth: 2,
      context_percentage: 25,
      budget_cap: 0,
      min_activations: 0,
      max_depth: 0,
      max_recursion_steps: 0,
      insertion_strategy: 'character_first',
      include_names: false,
      recursive: true,
      case_sensitive: false,
      match_whole_words: false,
      use_group_scoring: false,
      overflow_alert: false,
    },
    updatedAt: new Date(0).toISOString(),
  }
}

export function normalizeCompatibilityWorkspace(value) {
  const source = record(value)
  const variables = record(source.variables)
  const defaults = emptyCompatibilityWorkspace()
  const lorebook = { ...defaults.lorebookSettings, ...clone(record(source.lorebookSettings)) }
  lorebook.selected_global_lorebooks = Array.isArray(lorebook.selected_global_lorebooks)
    ? [...new Set(lorebook.selected_global_lorebooks.map(String))]
    : []
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(Number(source.revision)) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
    variables: {
      global: clone(record(variables.global)),
      presets: recordOfRecords(variables.presets),
      characters: recordOfRecords(variables.characters),
      scripts: recordOfRecords(variables.scripts),
      extensions: recordOfRecords(variables.extensions),
    },
    extensionSettings: recordOfRecords(source.extensionSettings),
    globalWorldbooks: Array.isArray(source.globalWorldbooks) ? [...new Set(source.globalWorldbooks.map(String))] : [],
    characterWorldbooks: Object.fromEntries(Object.entries(record(source.characterWorldbooks)).map(([key, item]) => [String(key), {
      primary: typeof item?.primary === 'string' && item.primary !== '' ? item.primary : null,
      additional: Array.isArray(item?.additional) ? [...new Set(item.additional.map(String))] : [],
    }])),
    lorebookSettings: lorebook,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : defaults.updatedAt,
  }
}

export function compatibilityPresetKey(binding) {
  const ids = Array.isArray(binding?.templateIds) ? binding.templateIds.map(String).sort() : []
  return ids.length === 0 ? 'in_use' : ids.join('\u001f')
}

export function compatibilityScriptKey(cardId, scriptId) {
  return `${String(cardId ?? 'none')}\u001f${String(scriptId ?? 'unknown')}`
}

export function readWorkspaceVariableScope(document, option, context = {}) {
  const source = normalizeCompatibilityWorkspace(document)
  const type = String(option?.type || 'chat')
  if (type === 'global') return clone(source.variables.global)
  if (type === 'preset') return clone(source.variables.presets[compatibilityPresetKey(context.binding)] ?? {})
  if (type === 'character') return clone(source.variables.characters[String(context.cardId ?? '')] ?? {})
  if (type === 'script') {
    const scriptId = context.scriptId ?? option?.script_id
    return clone(source.variables.scripts[compatibilityScriptKey(context.cardId, scriptId)] ?? {})
  }
  if (type === 'extension') return clone(source.variables.extensions[String(option?.extension_id ?? '')] ?? {})
  throw new TypeError(`variable scope ${type} is not workspace-scoped`)
}

export function replaceWorkspaceVariableScope(document, option, variables, context = {}) {
  const next = normalizeCompatibilityWorkspace(document)
  const value = clone(record(variables))
  const type = String(option?.type || '')
  if (type === 'global') next.variables.global = value
  else if (type === 'preset') next.variables.presets[compatibilityPresetKey(context.binding)] = value
  else if (type === 'character') next.variables.characters[String(context.cardId ?? '')] = value
  else if (type === 'script') {
    const scriptId = context.scriptId ?? option?.script_id
    next.variables.scripts[compatibilityScriptKey(context.cardId, scriptId)] = value
  } else if (type === 'extension') {
    const extensionId = String(option?.extension_id ?? '')
    if (extensionId === '') throw new TypeError('extension_id is required for extension variables')
    next.variables.extensions[extensionId] = value
  } else throw new TypeError(`variable scope ${type} is not workspace-scoped`)
  next.revision += 1
  next.updatedAt = new Date().toISOString()
  return next
}

// Lodash-compatible enough for TavernHelper variable paths: dotted names,
// bracketed numeric indexes and quoted bracket keys.
export function toVariablePath(path) {
  if (Array.isArray(path)) return path.map(value => String(value))
  const source = String(path ?? '')
  const parts = []
  source.replace(/[^.[\]]+|\[(?:(['"])((?:(?!\1)[^\\]|\\.)*?)\1|([^\]]*))\]/g, (_match, quote, quoted, bare) => {
    const value = quote ? quoted.replace(/\\(['"\\])/g, '$1') : bare === undefined ? _match : bare.trim()
    parts.push(String(value))
    return _match
  })
  return parts
}

export function getVariableAtPath(object, path, fallback) {
  let value = object
  for (const key of toVariablePath(path)) {
    if (value === null || value === undefined || !Object.hasOwn(Object(value), key)) return fallback
    value = value[key]
  }
  return value
}

export function deleteVariableAtPath(object, path) {
  const next = clone(record(object))
  const parts = toVariablePath(path)
  if (parts.length === 0) return { variables: next, delete_occurred: false }
  let parent = next
  for (const key of parts.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, key)) return { variables: next, delete_occurred: false }
    parent = parent[key]
  }
  const key = parts.at(-1)
  const delete_occurred = parent !== null && typeof parent === 'object' && Object.hasOwn(parent, key)
  if (delete_occurred) delete parent[key]
  return { variables: next, delete_occurred }
}
