import { Buffer } from 'node:buffer'
import { extractCcv3Json } from './png.js'

const REQUIRED_STRINGS = [
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version',
]
const REQUIRED_ARRAYS = ['alternate_greetings', 'tags']
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const DEFAULT_LIMITS = Object.freeze({
  maxJsonBytes: 8 * 1024 * 1024,
  maxDepth: 64,
  maxMembers: 100_000,
  maxArrayItems: 100_000,
  maxStringBytes: 2 * 1024 * 1024,
  maxAssets: 1_024,
  maxAssetUriBytes: 8 * 1024,
  maxLorebookEntries: 10_000,
  maxKeysPerEntry: 256,
  maxKeyBytes: 1_024,
  maxEntryBytes: 1024 * 1024,
  maxLorebookBytes: 16 * 1024 * 1024,
})

function plain(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function assertString(value, label, max = DEFAULT_LIMITS.maxStringBytes) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (byteLength(value) > max) throw new Error(`${label} exceeds ${max} UTF-8 bytes`)
}

function assertStringArray(value, label, maxItems = DEFAULT_LIMITS.maxArrayItems, maxString = DEFAULT_LIMITS.maxStringBytes) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be an array with at most ${maxItems} items`)
  value.forEach((item, index) => assertString(item, `${label}[${index}]`, maxString))
}

function assertJsonBudget(root, limits) {
  const pending = [{ value: root, depth: 0, label: 'card' }]
  let members = 0
  let arrayItems = 0
  while (pending.length > 0) {
    const current = pending.pop()
    const { value, depth, label } = current
    if (depth > limits.maxDepth) throw new Error(`JSON depth exceeds ${limits.maxDepth}`)
    if (typeof value === 'string') {
      assertString(value, label, limits.maxStringBytes)
      continue
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`)
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      arrayItems += value.length
      if (arrayItems > limits.maxArrayItems) throw new Error(`JSON array items exceed ${limits.maxArrayItems}`)
      value.forEach((child, index) => pending.push({ value: child, depth: depth + 1, label: `${label}[${index}]` }))
      continue
    }
    const keys = Object.keys(value)
    members += keys.length
    if (members > limits.maxMembers) throw new Error(`JSON object members exceed ${limits.maxMembers}`)
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) throw new Error(`${label} contains unsafe key ${JSON.stringify(key)}`)
      pending.push({ value: value[key], depth: depth + 1, label: `${label}.${key}` })
    }
  }
}

function safeEmbeddedPath(uri, prefix) {
  const path = uri.slice(prefix.length)
  if (path.length === 0 || path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  const parts = path.split('/')
  return !parts.some(part => part === '' || part === '.' || part === '..')
}

function validateAsset(asset, index, limits) {
  const value = plain(asset, `data.assets[${index}]`)
  for (const key of ['type', 'uri', 'name', 'ext']) assertString(value[key], `data.assets[${index}].${key}`, limits.maxAssetUriBytes)
  const uri = value.uri
  if (/^https?:\/\//i.test(uri) || /^data:[^,]*;base64,/i.test(uri) || /^ccdefault:/i.test(uri)) return
  if (uri.startsWith('embeded://') && safeEmbeddedPath(uri, 'embeded://')) return
  if (uri.startsWith('__asset:') && safeEmbeddedPath(uri, '__asset:')) return
  throw new Error(`data.assets[${index}].uri uses an unsupported or unsafe URI`)
}

function validateBook(book, limits, warnings) {
  const value = plain(book, 'data.character_book')
  if (!Array.isArray(value.entries) || value.entries.length > limits.maxLorebookEntries) {
    throw new Error(`data.character_book.entries must contain at most ${limits.maxLorebookEntries} entries`)
  }
  if (value.extensions === undefined) {
    value.extensions = {}
    warnings.push('data.character_book.extensions was missing and was normalized to an empty object')
  } else plain(value.extensions, 'data.character_book.extensions')
  for (const field of ['name', 'description']) if (value[field] !== undefined) assertString(value[field], `data.character_book.${field}`)
  for (const field of ['scan_depth', 'token_budget']) {
    if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) || value[field] < 0)) throw new Error(`data.character_book.${field} must be a non-negative integer`)
  }
  if (value.recursive_scanning !== undefined && typeof value.recursive_scanning !== 'boolean') throw new Error('data.character_book.recursive_scanning must be boolean')
  let textBytes = 0
  value.entries.forEach((entry, index) => {
    const label = `data.character_book.entries[${index}]`
    const item = plain(entry, label)
    assertStringArray(item.keys, `${label}.keys`, limits.maxKeysPerEntry, limits.maxKeyBytes)
    assertString(item.content, `${label}.content`, limits.maxEntryBytes)
    textBytes += byteLength(item.content)
    if (textBytes > limits.maxLorebookBytes) throw new Error(`lorebook text exceeds ${limits.maxLorebookBytes} bytes`)
    if (typeof item.enabled !== 'boolean') throw new Error(`${label}.enabled must be boolean`)
    if (!Number.isFinite(item.insertion_order)) throw new Error(`${label}.insertion_order must be finite`)
    plain(item.extensions, `${label}.extensions`)
    if (item.secondary_keys !== undefined) assertStringArray(item.secondary_keys, `${label}.secondary_keys`, limits.maxKeysPerEntry, limits.maxKeyBytes)
    for (const field of ['name', 'comment']) if (item[field] !== undefined) assertString(item[field], `${label}.${field}`)
    for (const field of ['enabled', 'selective', 'constant', 'case_sensitive', 'use_regex']) {
      if (item[field] !== undefined && typeof item[field] !== 'boolean') throw new Error(`${label}.${field} must be boolean`)
    }
    for (const field of ['id', 'priority']) if (item[field] !== undefined && !Number.isFinite(item[field])) throw new Error(`${label}.${field} must be finite`)
    if (item.position !== undefined && typeof item.position !== 'string' && !Number.isFinite(item.position)) throw new Error(`${label}.position must be a string or finite number`)
  })
}

export function validateCardV3(input, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  assertJsonBudget(input, limits)
  const card = structuredClone(plain(input, 'card'))
  if (card.spec !== 'chara_card_v3') throw new Error('card.spec must be "chara_card_v3"')
  if (card.spec_version !== '3.0') throw new Error('card.spec_version must be exactly "3.0" in V1')
  const warnings = []
  const data = plain(card.data, 'card.data')
  for (const field of REQUIRED_STRINGS) assertString(data[field], `data.${field}`)
  for (const field of REQUIRED_ARRAYS) assertStringArray(data[field], `data.${field}`)
  if (data.group_only_greetings === undefined) {
    data.group_only_greetings = []
    warnings.push('data.group_only_greetings was missing and was normalized to an empty array')
  } else assertStringArray(data.group_only_greetings, 'data.group_only_greetings')
  plain(data.extensions, 'data.extensions')
  if (data.assets !== undefined) {
    if (!Array.isArray(data.assets) || data.assets.length > limits.maxAssets) throw new Error(`data.assets must contain at most ${limits.maxAssets} assets`)
    data.assets.forEach((asset, index) => validateAsset(asset, index, limits))
  }
  if (data.character_book !== undefined) validateBook(data.character_book, limits, warnings)
  if (data.nickname !== undefined) assertString(data.nickname, 'data.nickname')
  if (data.creator_notes_multilingual !== undefined) {
    const notes = plain(data.creator_notes_multilingual, 'data.creator_notes_multilingual')
    for (const [locale, text] of Object.entries(notes)) {
      assertString(locale, 'creator notes locale', 128)
      assertString(text, `creator_notes_multilingual.${locale}`)
    }
  }
  if (data.source !== undefined) assertStringArray(data.source, 'data.source', 1024, 8192)
  for (const field of ['creation_date', 'modification_date']) {
    if (data[field] !== undefined && (!Number.isSafeInteger(data[field]) || data[field] < 0)) throw new Error(`data.${field} must be a non-negative Unix timestamp`)
  }
  return { card, warnings }
}

export function parseCardJson(text, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  if (byteLength(text) > limits.maxJsonBytes) throw new Error(`Character Card JSON exceeds ${limits.maxJsonBytes} bytes`)
  let value
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`invalid Character Card JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateCardV3(value, { ...options, limits })
}

export function parseCardBytes(input, options = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const png = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
  if (png) {
    const extracted = extractCcv3Json(bytes, options)
    const parsed = parseCardJson(extracted.json, options)
    return { ...parsed, warnings: [...extracted.warnings, ...parsed.warnings], format: extracted.apng ? 'apng-v3' : 'png-v3' }
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Character Card JSON is not valid UTF-8')
  }
  return { ...parseCardJson(text, options), format: 'json-v3' }
}

export const cardV3Limits = DEFAULT_LIMITS
