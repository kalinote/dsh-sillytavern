import { estimateTokens } from './tokenizer.js'

const MAX_SCAN_CHARS = 16 * 1024
const MAX_SCAN_DEPTH = 100
const DEFAULT_SCAN_DEPTH = 8
export const DEFAULT_FALLBACK_TOKEN_BUDGET = 250_000
const DEFAULT_BUDGET_PERCENT = 25
const DEFAULT_DEPTH = 4

const SELECTIVE_LOGIC = Object.freeze({ AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 })

function normalizeText(value, caseSensitive) {
  const text = String(value)
  return caseSensitive ? text : text.toLocaleLowerCase()
}

function regexFromKey(key, caseSensitive) {
  const match = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(key)
  const source = match === null ? key : match[1]
  // Delimited expressions own their flags. Bare patterns from use_regex keep
  // the legacy entry-level case-sensitivity fallback without otherwise
  // rewriting the user's native JavaScript regular expression.
  const flags = match === null ? (caseSensitive ? '' : 'i') : match[2]
  return new RegExp(source, flags)
}

function entryValue(entry, ...names) {
  if (entry?.extensions !== null && typeof entry?.extensions === 'object') {
    for (const name of names) if (entry.extensions[name] !== undefined) return entry.extensions[name]
  }
  for (const name of names) if (entry?.[name] !== undefined) return entry[name]
  return undefined
}

function entryEnabled(entry) {
  if (entry?.enabled !== undefined) return entry.enabled === true
  if (entry?.disable !== undefined) return entry.disable !== true
  return false
}

function primaryKeysOf(entry) {
  const value = Array.isArray(entry?.keys) ? entry.keys : entry?.key
  return Array.isArray(value) ? value : []
}

function secondaryKeysOf(entry) {
  const value = Array.isArray(entry?.secondary_keys) ? entry.secondary_keys : entry?.keysecondary
  return Array.isArray(value) ? value : []
}

function plainKeyMatches(key, haystack, caseSensitive, wholeWords) {
  if (!wholeWords) return normalizeText(haystack, caseSensitive).includes(normalizeText(key, caseSensitive))
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const flags = caseSensitive ? 'u' : 'iu'
  try { return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, flags).test(haystack) } catch { return false }
}

function keyMatches(key, haystack, entry, options = {}) {
  if (typeof key !== 'string' || key === '') return false
  try { key = typeof options.renderKey === 'function' ? String(options.renderKey(key, entry) ?? '') : key } catch { return false }
  if (key === '') return false
  const caseSensitive = entryValue(entry, 'case_sensitive', 'caseSensitive') === true
  const delimitedRegex = /^\/[\s\S]*\/[dgimsuvy]*$/.test(key)
  if (entryValue(entry, 'use_regex', 'useRegex') === true || delimitedRegex) {
    try { return regexFromKey(key, caseSensitive).test(haystack) } catch { return false }
  }
  return plainKeyMatches(key, haystack, caseSensitive, entryValue(entry, 'match_whole_words', 'matchWholeWords') === true)
}

function selectiveLogicOf(entry) {
  const raw = entryValue(entry, 'selective_logic', 'selectiveLogic')
  if (Number.isSafeInteger(raw) && raw >= SELECTIVE_LOGIC.AND_ANY && raw <= SELECTIVE_LOGIC.AND_ALL) return raw
  if (typeof raw === 'string') {
    const value = raw.toLocaleUpperCase().replace(/[\s-]/g, '_')
    if (SELECTIVE_LOGIC[value] !== undefined) return SELECTIVE_LOGIC[value]
  }
  return SELECTIVE_LOGIC.AND_ANY
}

export function entryMatches(entry, haystack, options = {}) {
  if (!entryEnabled(entry)) return false
  if (entry.constant === true) return true
  const primary = primaryKeysOf(entry).some(key => keyMatches(key, haystack, entry, options))
  if (!primary) return false
  const secondaryKeys = secondaryKeysOf(entry)
  if (entry.selective !== true || secondaryKeys.length === 0) return true
  const matches = secondaryKeys.map(key => keyMatches(key, haystack, entry, options))
  switch (selectiveLogicOf(entry)) {
    case SELECTIVE_LOGIC.NOT_ALL: return matches.some(match => !match)
    case SELECTIVE_LOGIC.NOT_ANY: return matches.every(match => !match)
    case SELECTIVE_LOGIC.AND_ALL: return matches.every(Boolean)
    default: return matches.some(Boolean)
  }
}

function positionOf(entry) {
  const raw = entryValue(entry, 'position')
  if (raw === undefined || raw === null || raw === '') return 'after'
  const value = typeof raw === 'string' ? raw.toLocaleLowerCase().replace(/[\s_-]/g, '') : raw
  if (value === 0 || ['beforechar', 'beforecharacter', 'before'].includes(value)) return 'before'
  if (value === 1 || ['afterchar', 'aftercharacter', 'after'].includes(value)) return 'after'
  if (value === 2 || ['antop', 'authornotetop', 'topofan'].includes(value)) return 'authorNoteTop'
  if (value === 3 || ['anbottom', 'authornotebottom', 'bottomofan'].includes(value)) return 'authorNoteBottom'
  if (value === 4 || value === 'atdepth' || value === 'depth') return 'atDepth'
  if (value === 5 || ['emtop', 'examplemessagestop', 'beforeexamples'].includes(value)) return 'exampleTop'
  if (value === 6 || ['embottom', 'examplemessagesbottom', 'afterexamples'].includes(value)) return 'exampleBottom'
  if (value === 7 || value === 'outlet') return 'outlet'
  if (value === 'middle') return 'middle'
  return undefined
}

function outletNameOf(entry) {
  const value = entryValue(entry, 'outlet_name', 'outletName', 'outlet')
  return typeof value === 'string' ? value.trim() : ''
}

function depthOf(entry) {
  const value = Number(entryValue(entry, 'depth'))
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_DEPTH
}

function roleOf(entry) {
  const raw = entryValue(entry, 'role')
  if (typeof raw === 'string') {
    const value = raw.toLocaleLowerCase()
    if (value === 'user') return 1
    if (value === 'assistant') return 2
    if (value === 'system') return 0
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 && value <= 2 ? value : 0
}

function ignoresBudget(entry) {
  return entryValue(entry, 'ignore_budget', 'ignoreBudget') === true
}

function preventsRecursion(entry) {
  return entryValue(entry, 'prevent_recursion', 'preventRecursion') === true
}

function excludesRecursion(entry) {
  return entryValue(entry, 'exclude_recursion', 'excludeRecursion') === true
}

function delayedUntilRecursion(entry) {
  const raw = entryValue(entry, 'delay_until_recursion', 'delayUntilRecursion')
  if (raw === true) return 1
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 0
}

function vectorized(entry) {
  return entryValue(entry, 'vectorized') === true
}

function orderOf(entry) {
  const value = entry?.insertion_order ?? entry?.order
  return Number.isFinite(value) ? Number(value) : 0
}

function priorityOf(entry) {
  const value = entryValue(entry, 'priority')
  return Number.isFinite(value) ? Number(value) : 0
}

function scanDepthOf(entry, fallback) {
  const raw = entryValue(entry, 'scan_depth', 'scanDepth')
  if (Number.isSafeInteger(raw) && raw >= 0) return Math.min(MAX_SCAN_DEPTH, raw)
  return fallback
}

function probabilityOf(entry) {
  const raw = Number(entryValue(entry, 'probability') ?? 100)
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 100
}

function usesProbability(entry) {
  return entryValue(entry, 'use_probability', 'useProbability') !== false
}

function entryLabel(entry, index) {
  return String(entry?.id ?? entry?.uid ?? entry?.name ?? entry?.comment ?? index)
}

export function worldbookTokenBudget(options = {}, book = undefined) {
  const contextWindow = Number(options.contextWindow)
  const percentValue = Number(options.budgetPercent ?? DEFAULT_BUDGET_PERCENT)
  const percent = Number.isFinite(percentValue) && percentValue > 0 ? Math.min(percentValue, 100) : DEFAULT_BUDGET_PERCENT
  let budget = Number.isSafeInteger(contextWindow) && contextWindow > 0
    ? Math.max(1, Math.round(contextWindow * percent / 100))
    : Number(options.fallbackTokenBudget ?? options.tokenBudget ?? DEFAULT_FALLBACK_TOKEN_BUDGET)
  if (!Number.isSafeInteger(budget) || budget <= 0) budget = DEFAULT_FALLBACK_TOKEN_BUDGET
  const bookBudget = Number(book?.token_budget ?? options.bookTokenBudget)
  if (Number.isSafeInteger(bookBudget) && bookBudget >= 0) budget = Math.min(budget, bookBudget)
  const cap = Number(options.budgetCap)
  if (Number.isSafeInteger(cap) && cap > 0) budget = Math.min(budget, cap)
  return budget
}

function emptyActivation(options, book) {
  return {
    before: [], middle: [], after: [], authorNoteTop: [], authorNoteBottom: [],
    exampleTop: [], exampleBottom: [], depthEntries: [], outletEntries: [], entries: [],
    budget: worldbookTokenBudget(options, book), usedTokens: 0, overflowed: false,
    warnings: [],
  }
}

function requestedScanDepth(book, options) {
  const raw = book.scan_depth ?? options.scanDepth
  if (Number.isSafeInteger(raw) && raw >= 0) return Math.min(MAX_SCAN_DEPTH, raw)
  return DEFAULT_SCAN_DEPTH
}

function scanText(messages, depth, recurseText = '') {
  const history = depth === 0 ? '' : messages.slice(-depth).join('\n')
  return `${history}${history && recurseText ? '\n' : ''}${recurseText}`.slice(-MAX_SCAN_CHARS)
}

function compareEvaluation(left, right) {
  // ST gives blue-circle constants budget priority over green-circle keyword
  // activations. Vectorized entries with keys remain regular keyword entries.
  const leftKind = left.activation === 'constant' ? 0 : 1
  const rightKind = right.activation === 'constant' ? 0 : 1
  return leftKind - rightKind
    || orderOf(right.entry) - orderOf(left.entry)
    || priorityOf(right.entry) - priorityOf(left.entry)
    || left.index - right.index
}

function comparePromptOrder(left, right) {
  return orderOf(left.entry) - orderOf(right.entry)
    || priorityOf(left.entry) - priorityOf(right.entry)
    || left.index - right.index
}

/**
 * Prepare an activated entry before recursion and token accounting.
 *
 * `prepareEntry(entry, context)` may return a string, an entry-like object, or
 * `{ entry, content }`. `render(content, preparedEntry, context)` can then
 * apply a final macro/Regex pass. Returning null/false from prepareEntry skips
 * the entry. Neither callback is allowed to mutate the source entry here.
 */
async function prepareCandidate(candidate, options) {
  const context = {
    activation: candidate.activation,
    recursionDepth: candidate.recursionDepth,
    signal: options.signal,
    content: String(candidate.entry?.content ?? ''),
  }
  let preparedEntry = candidate.entry
  let content = context.content
  if (typeof options.prepareEntry === 'function') {
    const prepared = await options.prepareEntry(candidate.entry, context)
    options.signal?.throwIfAborted()
    if (prepared === null || prepared === false) return undefined
    if (typeof prepared === 'string') content = prepared
    else if (prepared !== undefined && typeof prepared === 'object') {
      if (prepared.entry !== null && typeof prepared.entry === 'object') preparedEntry = prepared.entry
      else preparedEntry = prepared
      if (prepared.content !== undefined) content = String(prepared.content)
      else if (preparedEntry?.content !== undefined) content = String(preparedEntry.content)
    }
  }
  if (typeof options.render === 'function') {
    content = String(await options.render(content, preparedEntry, context) ?? '')
    options.signal?.throwIfAborted()
  }
  return { ...candidate, preparedEntry, content }
}

export async function activateWorldbook(book, rawMessages, options = {}) {
  if (book === undefined || book === null || !Array.isArray(book.entries)) return emptyActivation(options, book)
  options.signal?.throwIfAborted()
  const messages = Array.isArray(rawMessages) ? rawMessages.map(value => String(value ?? '')) : []
  const defaultScanDepth = requestedScanDepth(book, options)
  const budget = worldbookTokenBudget(options, book)
  const countTokens = typeof options.countTokens === 'function' ? options.countTokens : async text => estimateTokens(text)
  const random = typeof options.rng === 'function' ? options.rng : (typeof options.random === 'function' ? options.random : Math.random)
  const warnings = []
  const warned = new Set()
  const warn = (code, message, candidate) => {
    const key = `${code}:${candidate?.index ?? ''}`
    if (warned.has(key)) return
    warned.add(key)
    const warning = `${code}: ${message}`
    warnings.push(warning)
    try { options.onWarning?.(warning, candidate === undefined ? undefined : { entry: candidate.entry, index: candidate.index }) } catch { /* warning sinks must not stop activation */ }
  }

  const indexed = book.entries.map((entry, index) => ({ entry, index }))
  for (const candidate of indexed) {
    if (!entryEnabled(candidate.entry)) continue
    if (vectorized(candidate.entry) && candidate.entry.constant !== true && primaryKeysOf(candidate.entry).length === 0) {
      warn('vectorized-entry-unavailable', `entry ${entryLabel(candidate.entry, candidate.index)} has no keys and cannot be activated without an embedding retriever`, candidate)
    }
  }

  const settled = new Set()
  const accepted = []
  let acceptedText = ''
  let usedTokens = 0
  let overflowed = false

  const evaluate = async candidates => {
    const frontier = []
    candidates.sort(compareEvaluation)
    for (const candidate of candidates) {
      options.signal?.throwIfAborted()
      settled.add(candidate.index)
      const position = positionOf(candidate.entry)
      if (position === undefined) {
        warn('unknown-worldbook-position', `entry ${entryLabel(candidate.entry, candidate.index)} was skipped because position ${JSON.stringify(entryValue(candidate.entry, 'position'))} is unsupported`, candidate)
        continue
      }
      if (position === 'outlet' && outletNameOf(candidate.entry) === '') {
        warn('worldbook-outlet-name-missing', `entry ${entryLabel(candidate.entry, candidate.index)} was skipped because its Outlet name is empty`, candidate)
        continue
      }
      const ignoreBudget = ignoresBudget(candidate.entry)
      if (overflowed && !ignoreBudget) continue
      if (usesProbability(candidate.entry)) {
        const probability = probabilityOf(candidate.entry)
        if (probability <= 0) continue
        if (probability < 100) {
          const roll = Number(await random(candidate.entry, { activation: candidate.activation, recursionDepth: candidate.recursionDepth }))
          options.signal?.throwIfAborted()
          if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('worldbook RNG must return a finite number in [0, 1)')
          if (roll >= probability / 100) continue
        }
      }
      let prepared
      try { prepared = await prepareCandidate(candidate, options) } catch (error) {
        if (options.signal?.aborted) throw (options.signal.reason ?? error)
        warn('worldbook-entry-prepare-failed', `entry ${entryLabel(candidate.entry, candidate.index)} was skipped: ${error instanceof Error ? error.message : String(error)}`, candidate)
        continue
      }
      if (prepared === undefined) continue
      const nextText = `${acceptedText}${prepared.content}\n`
      const nextTokens = await countTokens(nextText, options.signal)
      options.signal?.throwIfAborted()
      if (!ignoreBudget && nextTokens >= budget) {
        overflowed = true
        continue
      }
      acceptedText = nextText
      usedTokens = nextTokens
      accepted.push({ ...prepared, position })
      if (!preventsRecursion(candidate.entry) && prepared.content !== '') frontier.push(prepared.content)
    }
    return frontier
  }

  const initialCandidates = []
  for (const candidate of indexed) {
    if (!entryEnabled(candidate.entry)) continue
    if (delayedUntilRecursion(candidate.entry) > 0) continue
    if (candidate.entry.constant === true) {
      initialCandidates.push({ ...candidate, activation: 'constant', recursionDepth: 0 })
      continue
    }
    const haystack = scanText(messages, scanDepthOf(candidate.entry, defaultScanDepth))
    if (entryMatches(candidate.entry, haystack, options)) initialCandidates.push({ ...candidate, activation: 'keyword', recursionDepth: 0 })
  }

  let frontier = await evaluate(initialCandidates)
  const recursiveScanning = options.recursiveScanning ?? book.recursive_scanning ?? false
  const requestedRecursions = Number(options.maxRecursionSteps)
  const maxRecursionSteps = Number.isSafeInteger(requestedRecursions) && requestedRecursions > 0
    ? Math.min(MAX_SCAN_DEPTH, requestedRecursions)
    : MAX_SCAN_DEPTH
  let recurseText = ''
  let recursionDepth = 0
  const hasPendingDelayedLevel = () => indexed.some(candidate => {
    if (settled.has(candidate.index) || !entryEnabled(candidate.entry) || excludesRecursion(candidate.entry)) return false
    return delayedUntilRecursion(candidate.entry) > recursionDepth
  })
  while (recursiveScanning === true && recursionDepth < maxRecursionSteps && (frontier.length > 0 || hasPendingDelayedLevel())) {
    options.signal?.throwIfAborted()
    recursionDepth += 1
    recurseText = `${recurseText}${recurseText ? '\n' : ''}${frontier.join('\n')}`.slice(-MAX_SCAN_CHARS)
    const recursiveCandidates = []
    for (const candidate of indexed) {
      if (settled.has(candidate.index) || !entryEnabled(candidate.entry) || excludesRecursion(candidate.entry)) continue
      if (delayedUntilRecursion(candidate.entry) > recursionDepth) continue
      const haystack = scanText(messages, scanDepthOf(candidate.entry, defaultScanDepth), recurseText)
      if (entryMatches(candidate.entry, haystack, options)) recursiveCandidates.push({ ...candidate, activation: 'recursion', recursionDepth })
    }
    frontier = recursiveCandidates.length === 0 ? [] : await evaluate(recursiveCandidates)
  }

  // ST evaluates high Order first, then builds each prompt section low-to-high
  // so the highest Order content sits closest to the end of that section.
  accepted.sort(comparePromptOrder)
  const entries = accepted.map(({ entry }) => entry)
  const grouped = {
    before: [], middle: [], after: [], authorNoteTop: [], authorNoteBottom: [],
    exampleTop: [], exampleBottom: [], depthEntries: [], outletEntries: [],
    entries, budget, usedTokens, overflowed, warnings,
  }
  for (const acceptedEntry of accepted) {
    const { entry, content, position } = acceptedEntry
    if (position === 'atDepth') grouped.depthEntries.push({ content, depth: depthOf(entry), role: roleOf(entry), entry })
    else if (position === 'outlet') grouped.outletEntries.push({ content, name: outletNameOf(entry), entry })
    else grouped[position].push(content)
  }
  return grouped
}
