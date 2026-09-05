const REGEXP_TAG = '__dsh_sillytavern_regexp__'
const V3_BRIDGE_KEY = '__dsh_sillytavern_v3__'
const TH_UNKNOWN_KEY = '__dsh_sillytavern_worldbook__'
const MAX_UID = 1_000_000

const POSITION_TO_TAVERN = Object.freeze({
  0: 'before_character_definition',
  1: 'after_character_definition',
  2: 'before_author_note',
  3: 'after_author_note',
  4: 'at_depth',
  5: 'before_example_messages',
  6: 'after_example_messages',
  7: 'outlet',
})
const POSITION_FROM_TAVERN = Object.freeze(Object.fromEntries(Object.entries(POSITION_TO_TAVERN).map(([key, value]) => [value, Number(key)])))
const LOGIC_TO_TAVERN = Object.freeze({ 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' })
const LOGIC_FROM_TAVERN = Object.freeze(Object.fromEntries(Object.entries(LOGIC_TO_TAVERN).map(([key, value]) => [value, Number(key)])))
const ROLE_TO_TAVERN = Object.freeze({ 0: 'system', 1: 'user', 2: 'assistant' })
const ROLE_FROM_TAVERN = Object.freeze(Object.fromEntries(Object.entries(ROLE_TO_TAVERN).map(([key, value]) => [value, Number(key)])))

const IMPLICIT_DEFAULTS = Object.freeze({
  addMemo: true,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  group: '',
  groupOverride: false,
  groupWeight: 100,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  ignoreBudget: false,
  outletName: '',
  triggers: Object.freeze([]),
  characterFilter: Object.freeze({ isExclude: false, names: Object.freeze([]), tags: Object.freeze([]) }),
})

const IMPLICIT_EXTENSION_KEYS = Object.freeze({
  addMemo: ['addMemo', 'add_memo'],
  matchPersonaDescription: ['matchPersonaDescription', 'match_persona_description'],
  matchCharacterDescription: ['matchCharacterDescription', 'match_character_description'],
  matchCharacterPersonality: ['matchCharacterPersonality', 'match_character_personality'],
  matchCharacterDepthPrompt: ['matchCharacterDepthPrompt', 'match_character_depth_prompt'],
  matchScenario: ['matchScenario', 'match_scenario'],
  matchCreatorNotes: ['matchCreatorNotes', 'match_creator_notes'],
  group: ['group'],
  groupOverride: ['groupOverride', 'group_override'],
  groupWeight: ['groupWeight', 'group_weight'],
  caseSensitive: ['caseSensitive', 'case_sensitive'],
  matchWholeWords: ['matchWholeWords', 'match_whole_words'],
  useGroupScoring: ['useGroupScoring', 'use_group_scoring'],
  automationId: ['automationId', 'automation_id'],
  ignoreBudget: ['ignoreBudget', 'ignore_budget'],
  outletName: ['outletName', 'outlet_name', 'outlet'],
  triggers: ['triggers'],
  characterFilter: ['characterFilter', 'character_filter'],
})

const IMPLICIT_CANONICAL_KEYS = Object.freeze({
  addMemo: 'addMemo',
  matchPersonaDescription: 'match_persona_description',
  matchCharacterDescription: 'match_character_description',
  matchCharacterPersonality: 'match_character_personality',
  matchCharacterDepthPrompt: 'match_character_depth_prompt',
  matchScenario: 'match_scenario',
  matchCreatorNotes: 'match_creator_notes',
  group: 'group',
  groupOverride: 'group_override',
  groupWeight: 'group_weight',
  caseSensitive: 'case_sensitive',
  matchWholeWords: 'match_whole_words',
  useGroupScoring: 'use_group_scoring',
  automationId: 'automation_id',
  ignoreBudget: 'ignore_budget',
  outletName: 'outlet_name',
  triggers: 'triggers',
  characterFilter: 'character_filter',
})

const TAVERN_KEYS = new Set([
  'uid', 'name', 'enabled', 'strategy', 'position', 'content', 'probability', 'recursion', 'effect', 'extra',
  ...Object.keys(IMPLICIT_DEFAULTS),
])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function merge(base, patch) {
  if (!object(base) || !object(patch) || patch instanceof RegExp) return clone(patch)
  const result = clone(base)
  for (const [key, value] of Object.entries(patch)) {
    result[key] = object(value) && !(value instanceof RegExp) && object(result[key])
      ? merge(result[key], value)
      : clone(value)
  }
  return result
}

function same(left, right) {
  if (left === right) return true
  if (left instanceof RegExp || right instanceof RegExp) {
    return left instanceof RegExp && right instanceof RegExp && left.source === right.source && left.flags === right.flags
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]))
  }
  if (!object(left) || !object(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return same(leftKeys, rightKeys) && leftKeys.every(key => same(left[key], right[key]))
}

function extensionValue(entry, ...keys) {
  const extensions = object(entry?.extensions) ? entry.extensions : {}
  for (const key of keys) if (extensions[key] !== undefined) return extensions[key]
  for (const key of keys) if (entry?.[key] !== undefined) return entry[key]
  return undefined
}

function validUid(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < MAX_UID
}

function nextUid(used, preferred) {
  const start = validUid(preferred) ? preferred : 0
  for (let offset = 0; offset < MAX_UID; offset += 1) {
    const candidate = (start + offset) % MAX_UID
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new RangeError(`worldbook has no free uid below ${MAX_UID}`)
}

function parseRegex(value, forceRegex = false, caseSensitive = false) {
  if (value instanceof RegExp) return clone(value)
  const text = String(value ?? '')
  const match = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(text)
  if (match === null && !forceRegex) return text
  try {
    return new RegExp(match?.[1] ?? text, match?.[2] ?? (caseSensitive ? '' : 'i'))
  } catch {
    return text
  }
}

function regexString(value) {
  return value instanceof RegExp ? value.toString() : String(value ?? '')
}

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function nonNegativeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function positionToTavern(value) {
  if (POSITION_TO_TAVERN[value] !== undefined) return POSITION_TO_TAVERN[value]
  if (typeof value === 'string') {
    if (POSITION_FROM_TAVERN[value] !== undefined) return value
    const normalized = value.toLocaleLowerCase().replace(/[\s_-]/g, '')
    const aliases = {
      before: 'before_character_definition', beforechar: 'before_character_definition', beforecharacter: 'before_character_definition',
      after: 'after_character_definition', afterchar: 'after_character_definition', aftercharacter: 'after_character_definition',
      antop: 'before_author_note', authornotetop: 'before_author_note',
      anbottom: 'after_author_note', authornotebottom: 'after_author_note',
      atdepth: 'at_depth', depth: 'at_depth',
      beforeexamples: 'before_example_messages', examplemessagestop: 'before_example_messages',
      afterexamples: 'after_example_messages', examplemessagesbottom: 'after_example_messages',
      outlet: 'outlet',
    }
    if (aliases[normalized] !== undefined) return aliases[normalized]
  }
  return 'at_depth'
}

function roleToTavern(value) {
  if (ROLE_TO_TAVERN[value] !== undefined) return ROLE_TO_TAVERN[value]
  return ROLE_FROM_TAVERN[value] !== undefined ? value : 'system'
}

function logicToTavern(value) {
  if (LOGIC_TO_TAVERN[value] !== undefined) return LOGIC_TO_TAVERN[value]
  return LOGIC_FROM_TAVERN[value] !== undefined ? value : 'and_any'
}

export function encodeTavernWorldbookProtocol(value) {
  if (value instanceof RegExp) return { [REGEXP_TAG]: { source: value.source, flags: value.flags } }
  if (Array.isArray(value)) return value.map(encodeTavernWorldbookProtocol)
  if (!object(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeTavernWorldbookProtocol(item)]))
}

export function decodeTavernWorldbookProtocol(value) {
  if (Array.isArray(value)) return value.map(decodeTavernWorldbookProtocol)
  if (!object(value)) return value
  const keys = Object.keys(value)
  const encoded = value[REGEXP_TAG]
  if (keys.length === 1 && object(encoded) && typeof encoded.source === 'string' && typeof encoded.flags === 'string') {
    return new RegExp(encoded.source, encoded.flags)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeTavernWorldbookProtocol(item)]))
}

export function createDefaultWorldbookEntry(partial = {}, uid = 0) {
  if (!object(partial)) throw new TypeError('worldbook entry must be an object')
  const defaults = {
    uid: validUid(uid) ? uid : 0,
    name: '',
    enabled: true,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 100 },
    content: '',
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    ...clone(IMPLICIT_DEFAULTS),
  }
  return merge(defaults, partial)
}

function projectEntry(entry, uid, includeBridge) {
  if (!object(entry)) throw new TypeError('V3 worldbook entry must be an object')
  const extensions = object(entry.extensions) ? clone(entry.extensions) : {}
  const useRegex = extensionValue(entry, 'use_regex', 'useRegex') === true
  const caseSensitive = extensionValue(entry, 'case_sensitive', 'caseSensitive') === true
  const keys = Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : []
  const secondaryKeys = Array.isArray(entry.secondary_keys) ? entry.secondary_keys : Array.isArray(entry.keysecondary) ? entry.keysecondary : []
  const vectorized = extensionValue(entry, 'vectorized') === true
  const rawPosition = extensionValue(entry, 'position')
  const rawRole = extensionValue(entry, 'role')
  const rawScanDepth = extensionValue(entry, 'scan_depth', 'scanDepth')
  const rawProbability = extensionValue(entry, 'probability')
  const useProbability = extensionValue(entry, 'useProbability', 'use_probability') !== false
  const rawDelayUntil = extensionValue(entry, 'delay_until_recursion', 'delayUntilRecursion')
  const unknown = object(extensions[TH_UNKNOWN_KEY]?.fields) ? clone(extensions[TH_UNKNOWN_KEY].fields) : {}
  delete extensions[TH_UNKNOWN_KEY]
  const extra = {
    ...extensions,
    ...(object(entry.extra) ? clone(entry.extra) : {}),
  }
  if (includeBridge) extra[V3_BRIDGE_KEY] = { version: 1, uid, entry: clone(entry) }

  const result = {
    uid,
    name: String(entry.comment ?? entry.name ?? ''),
    enabled: entry.enabled !== undefined ? entry.enabled === true : entry.disable !== true,
    strategy: {
      type: entry.constant === true ? 'constant' : vectorized ? 'vectorized' : 'selective',
      keys: keys.map(value => parseRegex(value, useRegex, caseSensitive)),
      keys_secondary: {
        logic: logicToTavern(extensionValue(entry, 'selectiveLogic', 'selective_logic')),
        keys: secondaryKeys.map(value => parseRegex(value, useRegex, caseSensitive)),
      },
      scan_depth: Number.isSafeInteger(rawScanDepth) && rawScanDepth >= 0 ? rawScanDepth : 'same_as_global',
    },
    position: {
      type: positionToTavern(rawPosition),
      role: roleToTavern(rawRole),
      depth: numeric(extensionValue(entry, 'depth'), 4),
      order: numeric(entry.insertion_order ?? entry.order, 100),
    },
    content: String(entry.content ?? ''),
    probability: useProbability ? numeric(rawProbability, 100) : 100,
    recursion: {
      prevent_incoming: extensionValue(entry, 'exclude_recursion', 'excludeRecursion') === true,
      prevent_outgoing: extensionValue(entry, 'prevent_recursion', 'preventRecursion') === true,
      delay_until: nonNegativeIntegerOrNull(rawDelayUntil),
    },
    effect: {
      sticky: nonNegativeIntegerOrNull(extensionValue(entry, 'sticky')),
      cooldown: nonNegativeIntegerOrNull(extensionValue(entry, 'cooldown')),
      delay: nonNegativeIntegerOrNull(extensionValue(entry, 'delay')),
    },
    ...unknown,
  }
  for (const [key, aliases] of Object.entries(IMPLICIT_EXTENSION_KEYS)) {
    const value = extensionValue(entry, ...aliases)
    result[key] = value === undefined ? clone(IMPLICIT_DEFAULTS[key]) : clone(value)
  }
  if (Object.keys(extra).length > 0) result.extra = extra
  return result
}

export function toTavernWorldbookEntry(entry, uid = undefined) {
  const preferred = validUid(entry?.id) ? entry.id : validUid(entry?.uid) ? entry.uid : uid
  return projectEntry(entry, validUid(preferred) ? preferred : 0, true)
}

export function toTavernWorldbookEntries(book) {
  const entries = Array.isArray(book?.entries) ? book.entries : []
  const used = new Set()
  return entries.map(entry => {
    const preferred = validUid(entry?.id) ? entry.id : validUid(entry?.uid) ? entry.uid : undefined
    return projectEntry(entry, nextUid(used, preferred), true)
  })
}

function normalizedTavernEntries(entries, reserved = []) {
  if (!Array.isArray(entries)) throw new TypeError('worldbook entries must be an array')
  const used = new Set(reserved.filter(validUid))
  return entries.map(entry => {
    if (!object(entry)) throw new TypeError('worldbook entry must be an object')
    const uid = nextUid(used, entry.uid)
    return createDefaultWorldbookEntry({ ...clone(entry), uid }, uid)
  })
}

export function toV3WorldbookEntry(entry, displayIndex = 0) {
  if (!object(entry)) throw new TypeError('TavernHelper worldbook entry must be an object')
  const bridge = object(entry.extra?.[V3_BRIDGE_KEY]) && object(entry.extra[V3_BRIDGE_KEY].entry)
    ? entry.extra[V3_BRIDGE_KEY]
    : null
  if (bridge !== null) {
    const comparable = clone(entry)
    delete comparable.extra[V3_BRIDGE_KEY]
    if (Object.keys(comparable.extra).length === 0) delete comparable.extra
    const projection = projectEntry(bridge.entry, bridge.uid, false)
    if (same(comparable, projection)) return clone(bridge.entry)
  }

  const base = bridge === null ? {} : clone(bridge.entry)
  const cleanExtra = object(entry.extra) ? clone(entry.extra) : {}
  delete cleanExtra[V3_BRIDGE_KEY]
  const extensions = { ...(object(base.extensions) ? clone(base.extensions) : {}), ...cleanExtra }
  const unknownFields = Object.fromEntries(Object.entries(entry).filter(([key]) => !TAVERN_KEYS.has(key)).map(([key, value]) => [key, clone(value)]))
  if (Object.keys(unknownFields).length > 0) extensions[TH_UNKNOWN_KEY] = { version: 1, fields: unknownFields }

  extensions.display_index = Number.isSafeInteger(displayIndex) && displayIndex >= 0 ? displayIndex : 0
  extensions.position = POSITION_FROM_TAVERN[entry.position?.type] ?? 4
  extensions.role = ROLE_FROM_TAVERN[entry.position?.role] ?? 0
  extensions.depth = numeric(entry.position?.depth, 4)
  extensions.selectiveLogic = LOGIC_FROM_TAVERN[entry.strategy?.keys_secondary?.logic] ?? 0
  extensions.scan_depth = entry.strategy?.scan_depth === 'same_as_global' ? null : (Number.isSafeInteger(entry.strategy?.scan_depth) && entry.strategy.scan_depth >= 0 ? entry.strategy.scan_depth : null)
  extensions.vectorized = entry.strategy?.type === 'vectorized'
  extensions.useProbability = true
  extensions.probability = numeric(entry.probability, 100)
  extensions.exclude_recursion = entry.recursion?.prevent_incoming === true
  extensions.prevent_recursion = entry.recursion?.prevent_outgoing === true
  extensions.delay_until_recursion = nonNegativeIntegerOrNull(entry.recursion?.delay_until) ?? false
  extensions.sticky = nonNegativeIntegerOrNull(entry.effect?.sticky)
  extensions.cooldown = nonNegativeIntegerOrNull(entry.effect?.cooldown)
  extensions.delay = nonNegativeIntegerOrNull(entry.effect?.delay)
  for (const [key, extensionKey] of Object.entries(IMPLICIT_CANONICAL_KEYS)) {
    extensions[extensionKey] = clone(entry[key] === undefined ? IMPLICIT_DEFAULTS[key] : entry[key])
  }

  return {
    ...base,
    id: validUid(entry.uid) ? entry.uid : 0,
    comment: String(entry.name ?? ''),
    enabled: entry.enabled !== false,
    keys: Array.isArray(entry.strategy?.keys) ? entry.strategy.keys.map(regexString) : [],
    secondary_keys: Array.isArray(entry.strategy?.keys_secondary?.keys) ? entry.strategy.keys_secondary.keys.map(regexString) : [],
    constant: entry.strategy?.type === undefined || entry.strategy.type === 'constant',
    selective: entry.strategy?.type === 'selective',
    insertion_order: numeric(entry.position?.order, 100),
    content: String(entry.content ?? ''),
    extensions,
  }
}

export function toV3Worldbook(entries, template = {}) {
  const worldbook = normalizedTavernEntries(entries)
  return {
    ...(object(template) ? clone(template) : {}),
    entries: worldbook.map((entry, index) => toV3WorldbookEntry(entry, index)),
    extensions: object(template?.extensions) ? clone(template.extensions) : {},
  }
}

export function replaceWorldbookEntries(book, entries) {
  const worldbook = normalizedTavernEntries(entries)
  const nextBook = toV3Worldbook(worldbook, book)
  return { book: nextBook, worldbook: clone(worldbook) }
}

export function createWorldbookEntries(book, entries) {
  const current = toTavernWorldbookEntries(book)
  const created = normalizedTavernEntries(entries, current.map(entry => entry.uid))
  const worldbook = [...current, ...created]
  const nextBook = toV3Worldbook(worldbook, book)
  return { book: nextBook, worldbook: clone(worldbook), new_entries: clone(created) }
}

export function deleteWorldbookEntries(book, predicate) {
  if (typeof predicate !== 'function') throw new TypeError('worldbook predicate must be a function')
  const current = toTavernWorldbookEntries(book)
  const worldbook = []
  const deletedEntries = []
  current.forEach((entry, index) => {
    if (predicate(clone(entry), index)) deletedEntries.push(entry)
    else worldbook.push(entry)
  })
  const nextBook = toV3Worldbook(worldbook, book)
  return { book: nextBook, worldbook: clone(worldbook), deleted_entries: clone(deletedEntries) }
}

export const fromTavernWorldbookEntry = toV3WorldbookEntry
export const fromTavernWorldbookEntries = toV3Worldbook
export const encodeWorldbookProtocol = encodeTavernWorldbookProtocol
export const decodeWorldbookProtocol = decodeTavernWorldbookProtocol
export const tavernWorldbookProtocolTag = REGEXP_TAG
