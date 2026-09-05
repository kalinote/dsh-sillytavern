import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEventOperation,
  assertMemoryKeywordsInSource,
  emptyEventDocument,
  isMemoryAutoRecallEligible,
  eventLimits,
  normalizeEventDocument,
  queryMemory,
  queryEventGraph,
} from '../src/event.js'
import { renderPromptTemplate } from '../src/template.js'
import { activateWorldbook } from '../src/worldbook.js'
import { injectWorldbookDepthMessages, sessionEventDelta } from '../src/prompt.js'
import { tokenizerKindForModel } from '../src/tokenizer.js'

test('renders EJS control flow and SillyTavern macros in a bounded VM', async () => {
  const result = await renderPromptTemplate('<% if (mood === "happy") { %><%= char %>: {{getvar::secret}}<% } %>', {
    mood: 'happy', char: 'Alice', variables: { secret: '<key>' },
  })
  assert.equal(result, 'Alice: <key>')
  const unknown = await renderPromptTemplate('keep {{vendor::macro}} literal', {})
  assert.equal(unknown.includes('{{'), false, 'unknown macros must not reach the DSH prompt interpolator')
  await assert.rejects(renderPromptTemplate('<%= Function("return process")() %>', {}), /Code generation from strings disallowed/)
  await assert.rejects(renderPromptTemplate('<%= character.constructor.constructor("return process")() %>', { character: { name: 'Alice' } }), /Code generation from strings disallowed/)
  await assert.rejects(renderPromptTemplate('<% while (true) {} %>', {}), /timed out/)
  await assert.rejects(renderPromptTemplate('<% Promise.resolve().then(function loop(){ Promise.resolve().then(loop) }) %>', {}), /timed out/)
  await assert.rejects(renderPromptTemplate('{{getvar::huge}}'.repeat(100), { variables: { huge: 'x'.repeat(10_000) } }), /macro output exceeds/)
  const controller = new AbortController()
  const started = Date.now()
  const aborted = renderPromptTemplate('<% while (true) {} %>', {}, controller.signal)
  setTimeout(() => controller.abort(new Error('template cancelled')), 10)
  await assert.rejects(aborted, /template cancelled/)
  assert.ok(Date.now() - started < 400, 'abort must terminate the template Worker before its deadline')
})

test('activates constant, keyword and selective worldbook entries in prompt order', async () => {
  const book = {
    token_budget: 1000,
    entries: [
      { id: 3, keys: [], content: 'constant', enabled: true, constant: true, insertion_order: 3, extensions: {} },
      { id: 2, keys: ['archive'], secondary_keys: ['key'], selective: true, content: 'selective', enabled: true, insertion_order: 2, extensions: {} },
      { id: 1, keys: ['library'], content: 'primary', enabled: true, insertion_order: 1, extensions: {} },
    ],
  }
  const active = await activateWorldbook(book, ['The library archive contains a key.'])
  assert.deepEqual(active.entries.map(entry => entry.id), [1, 2, 3])
})

test('uses native JavaScript regex syntax and preserves delimited flags', async () => {
  const longSource = `a{${600}}`
  const active = await activateWorldbook({ entries: [
    { id: 'groups', keys: ['(cat|dog)+'], use_regex: true, content: 'groups', enabled: true, insertion_order: 5, extensions: {} },
    { id: 'lookbehind', keys: ['/(?<=red )DRAGON/'], content: 'lookbehind', enabled: true, insertion_order: 4, extensions: {} },
    { id: 'long', keys: [longSource], use_regex: true, content: 'long', enabled: true, insertion_order: 3, extensions: {} },
    { id: 'explicit-i', keys: ['/dragon/i'], content: 'insensitive', enabled: true, insertion_order: 2, extensions: {} },
    { id: 'no-added-i', keys: ['/dragon/'], content: 'must not match', enabled: true, insertion_order: 1, extensions: {} },
    { id: 'sticky-flag', keys: ['/DRAGON/y'], content: 'must not match away from index zero', enabled: true, insertion_order: 0, extensions: {} },
  ] }, [`${'a'.repeat(600)} catdog red DRAGON`], { tokenBudget: 100, countTokens: async text => text.length })
  assert.deepEqual(active.entries.map(entry => entry.id), ['explicit-i', 'long', 'lookbehind', 'groups'])
})

test('supports all ST selective logic modes and V3 field aliases', async () => {
  const base = { keys: ['gate'], secondary_keys: ['red', 'missing'], selective: true, content: 'match', enabled: true, insertion_order: 1, extensions: {} }
  const active = await activateWorldbook({ entries: [
    { ...base, id: 'and-any', extensions: { selectiveLogic: 0 } },
    { ...base, id: 'not-all', extensions: { selective_logic: 'NOT_ALL' } },
    { ...base, id: 'not-any-pass', secondary_keys: ['missing', 'absent'], selectiveLogic: 2 },
    { ...base, id: 'not-any-fail', selectiveLogic: 'NOT_ANY' },
    { ...base, id: 'and-all-fail', extensions: { selectiveLogic: 3 } },
    { ...base, id: 'and-all-pass', secondary_keys: ['red', 'blue'], extensions: { selectiveLogic: 'AND_ALL' } },
    { ...base, id: 'empty-secondary', secondary_keys: [], extensions: { selectiveLogic: 2 } },
  ] }, ['gate red blue'], { tokenBudget: 1000, countTokens: async text => text.length })
  assert.deepEqual(active.entries.map(entry => entry.id), ['and-any', 'not-all', 'not-any-pass', 'and-all-pass', 'empty-secondary'])
})

test('matches macro-expanded keys, delimited regex keys, and whole words', async () => {
  const entries = [
    { id: 'macro', keys: ['{{char}}'], content: 'macro', enabled: true, insertion_order: 3, extensions: {} },
    { id: 'regex', keys: ['/dragon/i'], content: 'regex', enabled: true, insertion_order: 2, extensions: {} },
    { id: 'whole-miss', keys: ['art'], content: 'miss', enabled: true, insertion_order: 1, extensions: { match_whole_words: true } },
  ]
  const active = await activateWorldbook({ entries }, ['Alice meets a DRAGON in an archive.'], {
    tokenBudget: 100,
    countTokens: async text => text.length,
    renderKey: key => key.replace('{{char}}', 'Alice'),
  })
  assert.deepEqual(active.entries.map(entry => entry.id), ['regex', 'macro'])
})

test('recursively scans prepared entry content and honors recursion gates', async () => {
  const entries = [
    { id: 'seed', keys: ['start'], content: '{{macro}}', enabled: true, insertion_order: 50, extensions: {} },
    { id: 'first-link', keys: ['alpha'], content: 'beta', enabled: true, insertion_order: 40, extensions: {} },
    { id: 'second-link', keys: ['beta'], content: 'done', enabled: true, insertion_order: 30, extensions: {} },
    { id: 'excluded', keys: ['alpha'], content: 'excluded', enabled: true, insertion_order: 20, extensions: { exclude_recursion: true } },
    { id: 'stopper', keys: ['alpha'], content: 'gamma', enabled: true, insertion_order: 10, extensions: { prevent_recursion: true } },
    { id: 'blocked-by-stopper', keys: ['gamma'], content: 'blocked', enabled: true, insertion_order: 0, extensions: {} },
  ]
  const preparedCalls = []
  const renderCalls = []
  const active = await activateWorldbook({ recursive_scanning: true, entries }, ['start'], {
    tokenBudget: 1000,
    countTokens: async text => text.length,
    prepareEntry: async (entry, context) => {
      preparedCalls.push([entry.id, context.activation, context.recursionDepth])
      return entry.id === 'seed' ? { entry, content: 'alpha' } : entry
    },
    render: async (content, entry, context) => {
      renderCalls.push([entry.id, context.activation])
      return content
    },
  })
  assert.deepEqual(active.entries.map(entry => entry.id), ['stopper', 'second-link', 'first-link', 'seed'])
  assert.deepEqual(preparedCalls, [
    ['seed', 'keyword', 0],
    ['first-link', 'recursion', 1],
    ['stopper', 'recursion', 1],
    ['second-link', 'recursion', 2],
  ])
  assert.deepEqual(renderCalls.map(call => call[0]), preparedCalls.map(call => call[0]))
  assert.equal(active.after.at(-1), 'alpha', 'prepared content, not raw macro text, is returned to the prompt')

  const nonRecursive = await activateWorldbook({ recursive_scanning: false, entries }, ['start'], { tokenBudget: 1000, countTokens: async text => text.length, prepareEntry: entry => entry.id === 'seed' ? 'alpha' : entry })
  assert.deepEqual(nonRecursive.entries.map(entry => entry.id), ['seed'])
})

test('uses rendered content for token budget and supports deterministic probability RNG', async () => {
  const expanded = await activateWorldbook({ entries: [
    { id: 'expanded', keys: [], content: 'x', enabled: true, constant: true, insertion_order: 1, extensions: {} },
  ] }, [], {
    tokenBudget: 8,
    render: content => content.repeat(8),
    countTokens: async text => text.length,
  })
  assert.deepEqual(expanded.entries, [])
  assert.equal(expanded.overflowed, true, 'post-render content controls the budget decision')

  const rolls = [0.49, 0.5]
  const probability = await activateWorldbook({ entries: [
    { id: 'pass', keys: [], content: 'pass', enabled: true, constant: true, insertion_order: 4, extensions: { probability: 50, useProbability: true } },
    { id: 'fail-boundary', keys: [], content: 'fail', enabled: true, constant: true, insertion_order: 3, extensions: { probability: 50, use_probability: true } },
    { id: 'zero', keys: [], content: 'zero', enabled: true, constant: true, insertion_order: 2, extensions: { probability: 0, useProbability: true } },
    { id: 'probability-disabled', keys: [], content: 'always', enabled: true, constant: true, insertion_order: 1, extensions: { probability: 0, useProbability: false } },
  ] }, [], {
    tokenBudget: 100,
    countTokens: async text => text.length,
    rng: () => rolls.shift(),
  })
  assert.deepEqual(probability.entries.map(entry => entry.id), ['probability-disabled', 'pass'])
  assert.deepEqual(rolls, [])
})

test('prioritizes constants, supports keyed vectorized entries, and warns on unsupported entries', async () => {
  const warned = []
  const entries = [
    { id: 'keyword', keys: ['gate'], content: '12', enabled: true, insertion_order: 999, extensions: {} },
    { id: 'constant', keys: [], content: '1234', enabled: true, constant: true, insertion_order: 1, extensions: {} },
  ]
  const prioritized = await activateWorldbook({ entries }, ['gate'], { tokenBudget: 8, countTokens: async text => text.length })
  assert.deepEqual(prioritized.entries.map(entry => entry.id), ['constant'], 'blue-circle constants consume budget before higher-Order keyword entries')

  const warnings = await activateWorldbook({ entries: [
    { id: 'unknown-position', keys: [], content: 'bad', enabled: true, constant: true, insertion_order: 3, extensions: { position: 999 } },
    { id: 'pure-vector', keys: [], content: 'vector', enabled: true, insertion_order: 2, extensions: { vectorized: true } },
    { id: 'keyed-vector', keys: ['gate'], content: 'keyed', enabled: true, insertion_order: 1, extensions: { vectorized: true } },
  ] }, ['gate'], { tokenBudget: 100, countTokens: async text => text.length, onWarning: warning => warned.push(warning) })
  assert.deepEqual(warnings.entries.map(entry => entry.id), ['keyed-vector'], 'vectorized entries retain normal keyword activation')
  assert.equal(warnings.middle.includes('bad'), false, 'unknown positions are not silently mapped to middle')
  assert.equal(warnings.warnings.some(warning => warning.startsWith('unknown-worldbook-position:')), true)
  assert.equal(warnings.warnings.some(warning => warning.startsWith('vectorized-entry-unavailable:')), true)
  assert.deepEqual(warned, warnings.warnings)
})

test('scan depth zero disables direct keyword scans but still allows recursive activation', async () => {
  const active = await activateWorldbook({ scan_depth: 0, recursive_scanning: true, entries: [
    { id: 'constant', keys: [], content: 'link', enabled: true, constant: true, insertion_order: 2, extensions: {} },
    { id: 'recursive', keys: ['link'], content: 'recursed', enabled: true, insertion_order: 1, extensions: {} },
    { id: 'history-only', keys: ['history'], content: 'history match', enabled: true, insertion_order: 0, extensions: {} },
  ] }, ['history'], { tokenBudget: 100, countTokens: async text => text.length })
  assert.deepEqual(active.entries.map(entry => entry.id), ['recursive', 'constant'])
})

test('caps the model-relative budget by character-book and host limits', async () => {
  const entry = { id: 'ratio', keys: [], content: 'abc', enabled: true, constant: true, insertion_order: 1, extensions: {} }
  const ratio = await activateWorldbook({ token_budget: 300, entries: [entry] }, [], {
    contextWindow: 1000,
    budgetPercent: 25,
    countTokens: async text => text.length,
  })
  assert.equal(ratio.budget, 250)
  assert.deepEqual(ratio.entries.map(value => value.id), ['ratio'], 'a larger book budget cannot raise the model-relative limit')

  const bookLimited = await activateWorldbook({ token_budget: 100, entries: [entry] }, [], {
    contextWindow: 1000,
    budgetPercent: 25,
    budgetCap: 80,
    countTokens: async text => text.length,
  })
  assert.equal(bookLimited.budget, 80, 'the final budget is the minimum of model, book, and host caps')

  const rejected = await activateWorldbook({ token_budget: 1, entries: [entry] }, [], {
    contextWindow: 1000,
    budgetPercent: 25,
    countTokens: async text => text.length,
  })
  assert.equal(rejected.budget, 1)
  assert.deepEqual(rejected.entries, [], 'the character-book token budget is enforced')

  const zeroBudget = await activateWorldbook({ token_budget: 0, entries: [entry] }, [], {
    tokenBudget: 100,
    countTokens: async text => text.length,
  })
  assert.equal(zeroBudget.budget, 0)
  assert.deepEqual(zeroBudget.entries, [], 'an explicit zero book budget disables budgeted entries')

  const calls = []
  const chinese = await activateWorldbook({ entries: [{ ...entry, id: '中文', content: '天地玄黄' }] }, [], {
    contextWindow: 32,
    budgetPercent: 25,
    countTokens: async text => { calls.push(text); return 8 },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(chinese.entries, [], 'the supplied tokenizer result controls the decision; content.length / 4 is not consulted')
})

test('evaluates high Order first and does not backfill normal entries after overflow', async () => {
  const entries = [
    { id: 'small-backfill', keys: [], content: 'x', enabled: true, constant: true, insertion_order: 20, extensions: {} },
    { id: 'overflow', keys: [], content: 'abcd', enabled: true, constant: true, insertion_order: 30, extensions: {} },
    { id: 'high', keys: [], content: '12345', enabled: true, constant: true, insertion_order: 40, extensions: {} },
    { id: 'ignore', keys: [], content: 'unbounded', enabled: true, constant: true, insertion_order: 10, extensions: { ignore_budget: true } },
    { id: 'after-ignore', keys: [], content: 'z', enabled: true, constant: true, insertion_order: 0, extensions: {} },
  ]
  const active = await activateWorldbook({ entries }, [], { tokenBudget: 10, countTokens: async text => text.length })
  assert.equal(active.overflowed, true)
  assert.deepEqual(active.entries.map(entry => entry.id), ['ignore', 'high'])

  const priority = await activateWorldbook({ entries: [
    { ...entries[0], id: 'low', content: 'x', insertion_order: 1 },
    { ...entries[2], id: 'highest', content: '1234567', insertion_order: 999 },
  ] }, [], { tokenBudget: 10, countTokens: async text => text.length })
  assert.deepEqual(priority.entries.map(entry => entry.id), ['highest'], 'lower Order cannot consume the budget before the highest Order entry')
})

test('prioritizes V3 extension position/depth/role and injects depth messages request-only', async () => {
  const atDepth = { id: 'v3', keys: [], content: 'depth lore', enabled: true, constant: true, insertion_order: 10, position: 'after_char', depth: 9, role: 2, extensions: { position: 4, depth: 0, role: 0 } }
  const fallback = { id: 'legacy', keys: [], content: 'before lore', enabled: true, constant: true, insertion_order: 1, position: 'before_char', extensions: {} }
  const active = await activateWorldbook({ entries: [atDepth, fallback] }, [], { tokenBudget: 100, countTokens: async text => text.length })
  assert.deepEqual(active.before, ['before lore'])
  assert.deepEqual(active.after, [])
  assert.deepEqual(active.depthEntries.map(entry => ({ content: entry.content, depth: entry.depth, role: entry.role })), [{ content: 'depth lore', depth: 0, role: 0 }])

  const original = { provider: 'test', model: 'model', messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }] }
  const projected = injectWorldbookDepthMessages(original, active.depthEntries, () => 'fixed')
  assert.notEqual(projected, original)
  assert.equal(original.messages.length, 1, 'durable/request source array is not mutated')
  assert.deepEqual(projected.messages.map(message => [message.role, message.content[0].text]), [['user', 'hello'], ['system', 'depth lore']])
  assert.equal(projected.messages[1].id, 'dsh-sillytavern-worldbook-fixed')
})

test('keeps ST insertion anchors distinct and delays entries until the requested recursion level', async () => {
  const entries = [
    ...[0, 1, 2, 3, 5, 6].map(position => ({ id: `position-${position}`, keys: [], content: `p${position}`, enabled: true, constant: true, insertion_order: position, extensions: { position } })),
    { id: 'outlet', keys: [], content: 'outlet text', enabled: true, constant: true, insertion_order: 7, extensions: { position: 7, outlet_name: 'Lore' } },
    { id: 'outlet-alias', keys: [], content: 'alias text', enabled: true, constant: true, insertion_order: 7.5, extensions: { position: 7, outlet: 'Alias' } },
    { id: 'missing-outlet', keys: [], content: 'never', enabled: true, constant: true, insertion_order: 8, extensions: { position: 7 } },
    { id: 'seed', keys: [], content: 'first link', enabled: true, constant: true, insertion_order: 20, extensions: {} },
    { id: 'delayed', keys: ['first link'], content: 'second link', enabled: true, insertion_order: 19, extensions: { delay_until_recursion: 1 } },
  ]
  const active = await activateWorldbook({ recursive_scanning: true, entries }, [], { tokenBudget: 1000, countTokens: async text => text.length })
  assert.deepEqual(active.before, ['p0'])
  assert.deepEqual(active.after, ['p1', 'second link', 'first link'])
  assert.deepEqual(active.authorNoteTop, ['p2'])
  assert.deepEqual(active.authorNoteBottom, ['p3'])
  assert.deepEqual(active.exampleTop, ['p5'])
  assert.deepEqual(active.exampleBottom, ['p6'])
  assert.deepEqual(active.outletEntries.map(item => [item.name, item.content]), [['Lore', 'outlet text'], ['Alias', 'alias text']])
  assert.equal(active.entries.some(entry => entry.id === 'delayed'), true)
  assert.equal(active.warnings.some(warning => warning.startsWith('worldbook-outlet-name-missing:')), true)
})

test('advances independent delay-until-recursion levels even without an active frontier', async () => {
  const calls = []
  const active = await activateWorldbook({ recursive_scanning: true, entries: [
    { id: 'level-two', keys: [], content: 'bridge', enabled: true, constant: true, insertion_order: 2, extensions: { delay_until_recursion: 2 } },
    { id: 'level-four', keys: ['bridge'], content: 'reached', enabled: true, insertion_order: 1, extensions: { delay_until_recursion: 4 } },
  ] }, [], {
    tokenBudget: 100,
    countTokens: async text => text.length,
    prepareEntry: (entry, context) => { calls.push([entry.id, context.recursionDepth]); return entry },
  })
  assert.deepEqual(calls, [['level-two', 2], ['level-four', 4]])
  assert.deepEqual(active.entries.map(entry => entry.id), ['level-four', 'level-two'])
  assert.deepEqual(active.after, ['reached', 'bridge'], 'missing positions default to After Char')
})

test('maps common model routes to SillyTavern-compatible tokenizer families', () => {
  assert.equal(tokenizerKindForModel('deepseek', 'deepseek-chat'), 'web:deepseek')
  assert.equal(tokenizerKindForModel('openai', 'gpt-5'), 'tiktoken:gpt-5')
  assert.equal(tokenizerKindForModel('anthropic', 'claude-sonnet-4'), 'web:claude')
  assert.equal(tokenizerKindForModel('local', 'Qwen2.5-72B'), 'web:qwen2')
})

test('event deltas advance by event cursor without dropping bursts', () => {
  const events = Array.from({ length: 2500 }, (_value, seq) => ({ type: 'tool/result', seq, data: {} }))
  for (let index = 0; index < 250; index += 1) events.push({ type: 'user/message', seq: events.length, data: { content: [{ type: 'text', text: `message-${index}` }] } })
  const agent = { session: { events } }
  let cursor = 0
  const received = []
  let delta
  do {
    delta = sessionEventDelta(agent, cursor)
    received.push(...delta.history)
    assert.ok(delta.cursor > cursor)
    cursor = delta.cursor
  } while (delta.hasMore)
  assert.equal(received.length, 250)
  assert.equal(received[0].text, 'message-0')
  assert.equal(received.at(-1).text, 'message-249')
  const initial = sessionEventDelta(agent, -1)
  assert.equal(initial.history.length, 100)
  assert.equal(initial.history[0].text, 'message-150')
  assert.equal(initial.cursor, events.at(-1).seq)
})

const unknownStoryTime = () => ({ state: 'unknown', label: null, timeline: null, start: null, end: null })
const eventMemory = (eventId, key, overrides = {}) => ({
  action: 'upsert',
  table: 'events',
  key,
  value: { note: key },
  storyTime: unknownStoryTime(),
  location: null,
  characters: [],
  keywords: [String(key).trim(), `${String(eventId).trim()} source`],
  eventId,
  ...overrides,
})

test('requires narrative dimensions on new memory rows and inherits them on update', () => {
  let document = emptyEventDocument('session-1')
  assert.deepEqual(document, { schemaVersion: 5, sessionId: 'session-1', revision: 0, rows: [], eventEdges: [], appliedMaintenanceJobs: [] })
  assert.throws(
    () => normalizeEventDocument({ schemaVersion: 4, revision: 4, rows: [{ id: 'legacy' }] }, 'session-1'),
    /schema version 4 is unsupported; expected 5.*Delete.*manually/,
  )
  assert.deepEqual(
    normalizeEventDocument({ ...document, rows: [{ id: 'invalid-schema-5-row' }] }, 'session-1'),
    emptyEventDocument('session-1'),
    'an invalid schema 5 document is replaced rather than partially migrated',
  )
  assert.equal(eventLimits.MAX_ROWS, 10_000)
  assert.ok(eventLimits.MAX_EVENT_EDGES >= eventLimits.MAX_ROWS)
  assert.equal(eventLimits.MIN_KEYWORDS, 2)
  assert.equal(eventLimits.MAX_KEYWORDS, 10)
  const base = { action: 'upsert', table: 'relationships', key: 'Alice/User', value: { trust: 2 }, keywords: ['Alice', 'User'] }
  assert.throws(() => applyEventOperation(document, base), /storyTime/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: unknownStoryTime() }), /location/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: unknownStoryTime(), location: null }), /characters/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: { state: 'normalized', label: null, timeline: '', start: 2, end: 1 }, location: null, characters: [] }), /finite ordered/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: { state: 'label-only', label: '', timeline: null, start: null, end: null }, location: null, characters: [] }), /non-empty label/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: unknownStoryTime(), location: [], characters: [] }), /non-empty array/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: unknownStoryTime(), location: ['Tokyo Outskirts', ' '], characters: [] }), /location segments/)
  assert.throws(() => applyEventOperation(document, { ...base, storyTime: unknownStoryTime(), location: 'Archive', characters: [] }), /location segments/)

  document = applyEventOperation(document, {
    ...base,
    storyTime: { state: 'unknown', label: 'discarded', timeline: 'discarded', start: 1, end: 2 },
    location: null,
    characters: [' Alice ', '', 'Bob', 'Alice'],
    eventId: ' relationship-1 ',
    importance: 0.8,
  }).document
  assert.deepEqual(document.rows[0].storyTime, unknownStoryTime())
  assert.deepEqual(document.rows[0].characters, ['Alice', 'Bob'])
  assert.deepEqual(document.rows[0].keywords, ['Alice', 'User'])
  assert.equal(Object.hasOwn(document.rows[0], 'tags'), false)
  assert.equal(document.rows[0].eventId, 'relationship-1')
  assert.deepEqual(document.rows[0].sourceRefs, [])
  assert.equal(document.rows[0].recallPolicy, 'always')

  document = applyEventOperation(document, {
    action: 'update',
    id: document.rows[0].id,
    sourceRefs: [{ eventSeq: 12, turn: 3, role: 'assistant' }],
    recallPolicy: 'query_only',
  }).document
  const inherited = applyEventOperation(document, { action: 'update', id: document.rows[0].id, value: { trust: 3 }, importance: 1 }).document.rows[0]
  assert.equal(inherited.value.trust, 3)
  assert.deepEqual(inherited.storyTime, unknownStoryTime())
  assert.equal(inherited.location, null)
  assert.deepEqual(inherited.characters, ['Alice', 'Bob'])
  assert.equal(inherited.eventId, 'relationship-1')
  assert.deepEqual(inherited.sourceRefs, [{ eventSeq: 12, turn: 3, role: 'assistant' }])
  assert.equal(inherited.recallPolicy, 'query_only', 'updates preserve an explicit policy even when importance changes')
  assert.throws(() => applyEventOperation(document, { action: 'update', id: document.rows[0].id, eventId: ' ' }), /eventId/)
  assert.throws(() => applyEventOperation(document, { action: 'update', id: document.rows[0].id, sourceRefs: [{ eventSeq: -1, turn: 1, role: 'user' }] }), /sourceRefs/)
  assert.throws(() => applyEventOperation(document, { action: 'update', id: document.rows[0].id, sourceRefs: [{ eventSeq: 1, turn: 0, role: 'user' }] }), /sourceRefs/)
  assert.throws(() => applyEventOperation(document, { action: 'update', id: document.rows[0].id, sourceRefs: [{ eventSeq: 1, turn: 1, role: 'system' }] }), /sourceRefs/)
  assert.throws(() => applyEventOperation(document, { action: 'update', id: document.rows[0].id, recallPolicy: 'sometimes' }), /recallPolicy/)
  assert.throws(() => applyEventOperation(document, { action: 'update', id: document.rows[0].id, tags: ['legacy'] }), /no longer supported/)
})

test('validates keyword count, specificity, and verbatim assistant story sources', () => {
  const base = {
    action: 'upsert', table: 'events', key: 'silver bell', value: { owner: 'Alice' },
    storyTime: unknownStoryTime(), location: null, characters: ['Alice'],
  }
  const empty = emptyEventDocument('session-keywords')
  assert.throws(() => applyEventOperation(empty, { ...base, keywords: ['Alice'] }), /2 to 10/)
  assert.throws(() => applyEventOperation(empty, { ...base, keywords: Array.from({ length: 11 }, (_value, index) => `keyword-${index}`) }), /split memories/)
  assert.throws(() => applyEventOperation(empty, { ...base, keywords: ['Alice', 'Alice'] }), /2 to 10/)
  assert.throws(() => applyEventOperation(empty, { ...base, keywords: null }), /2 to 10/)
  assert.throws(() => applyEventOperation(empty, { ...base, keywords: ['Alice', '物品'] }), /generic classifications/)

  const document = applyEventOperation(empty, {
    ...base,
    keywords: ['Alice', 'silver bell'],
    sourceRefs: [{ eventSeq: 7, turn: 1, role: 'assistant' }],
  }).document
  const matchingEvents = [{ type: 'assistant/message', seq: 7, data: { message: { content: [{ type: 'text', text: 'Alice locks the silver bell in the archive.' }] } } }]
  assert.doesNotThrow(() => assertMemoryKeywordsInSource(document, matchingEvents))
  assert.throws(
    () => assertMemoryKeywordsInSource(document, [{ type: 'assistant/message', seq: 7, data: { message: { content: 'Alice enters the archive.' } } }]),
    /missing: "silver bell"/,
  )
  assert.throws(() => assertMemoryKeywordsInSource(document, []), /no assistant story source/)
  const userOnlySource = applyEventOperation(empty, {
    ...base,
    keywords: ['Alice', 'silver bell'],
    sourceRefs: [{ eventSeq: 7, turn: 1, role: 'user' }],
  }).document
  assert.throws(() => assertMemoryKeywordsInSource(userOnlySource, matchingEvents), /no assistant story source/)
})

test('gates automatic recall by policy, compaction, and importance while retaining relevance priority', () => {
  let document = emptyEventDocument('session-recall')
  const operations = [
    eventMemory('always-event', 'always-low', { importance: 0.2, recallPolicy: 'always', sourceRefs: [{ eventSeq: 1, turn: 1, role: 'user' }] }),
    eventMemory('query-event', 'query-high', { importance: 0.99, recallPolicy: 'query_only', sourceRefs: [] }),
    eventMemory('waiting-event', 'waiting', { importance: 0.4, sourceRefs: [{ eventSeq: 2, turn: 1, role: 'user' }, { eventSeq: 3, turn: 1, role: 'assistant' }] }),
    eventMemory('manual-event', 'manual', { importance: 0.3 }),
    eventMemory('promoted-event', 'promoted', { importance: 0.85, recallPolicy: 'after_compaction', sourceRefs: [{ eventSeq: 4, turn: 2, role: 'assistant' }] }),
  ]
  for (const operation of operations) document = applyEventOperation(document, operation).document
  const rows = Object.fromEntries(document.rows.map(row => [row.key, row]))

  assert.equal(rows.waiting.recallPolicy, 'after_compaction')
  assert.equal(rows.manual.recallPolicy, 'after_compaction')
  assert.equal(isMemoryAutoRecallEligible(rows['query-high'], new Set([1, 2, 3, 4])), false)
  assert.equal(isMemoryAutoRecallEligible(rows['always-low'], new Set()), true)
  assert.equal(isMemoryAutoRecallEligible(rows.waiting, new Set([2])), false)
  assert.equal(isMemoryAutoRecallEligible(rows.waiting, new Set([2, 3])), true)
  assert.equal(isMemoryAutoRecallEligible(rows.manual, new Set()), true, 'empty sourceRefs need no compaction evidence')
  assert.equal(isMemoryAutoRecallEligible(rows.promoted, new Set()), true, 'importance can promote an explicit after_compaction row')
  assert.equal(isMemoryAutoRecallEligible(rows.promoted, new Set(), 0.9), false)
  assert.deepEqual(queryMemory(document, {}).slice(0, 2).map(row => row.key), ['query-high', 'promoted'])
})

test('uses normalized table/key identity for upsert and rejects persisted duplicates', () => {
  let document = emptyEventDocument('session-row-identity')
  document = applyEventOperation(document, {
    ...eventMemory('event-identity', ' durable fact '),
    table: ' events ',
    sourceRefs: [{ eventSeq: 1, turn: 1, role: 'assistant' }],
  }).document
  const originalId = document.rows[0].id
  document = applyEventOperation(document, {
    ...eventMemory('event-identity', 'durable fact'),
    table: 'events',
    value: { note: 'corrected' },
  }).document
  assert.equal(document.rows.length, 1)
  assert.equal(document.rows[0].id, originalId)
  assert.equal(document.rows[0].value.note, 'corrected')

  const duplicate = structuredClone(document.rows[0])
  duplicate.id = 'second-id'
  duplicate.table = ' events '
  duplicate.key = ' durable fact '
  assert.deepEqual(
    normalizeEventDocument({ ...document, rows: [...document.rows, duplicate] }, document.sessionId),
    emptyEventDocument(document.sessionId),
  )
})

test('queries memory by people, intersecting story time, location, event, and text', () => {
  let document = emptyEventDocument('session-filters')
  const rows = [
    { key: 'arrival-hall', value: { note: 'first' }, keywords: ['Alice', 'terminal'], storyTime: { state: 'normalized', label: 'Dawn arrival', timeline: 'main', start: 1, end: 2 }, location: ['Tokyo Outskirts', 'Narita Airport', 'International Arrivals Hall'], characters: ['Alice', 'Bob'], eventId: 'shared-scene-42' },
    { key: 'arrival-garden', value: { note: 'second' }, keywords: ['Alice', 'Moon Garden'], storyTime: { state: 'normalized', label: 'Dusk departure', timeline: 'main', start: 5, end: 7 }, location: ['Tokyo Outskirts', 'Moon Garden'], characters: ['Alice', 'Cara'], eventId: 'shared-scene-42' },
    { key: 'festival-rumor', value: { note: 'vague' }, keywords: ['festival', 'rumor'], storyTime: { state: 'label-only', label: 'After the festival', timeline: 'main', start: null, end: null }, location: ['Central District', 'Archive'], characters: ['Bob'] },
    { key: 'unplaced', value: { note: 'unknown' }, keywords: ['unknown', 'unplaced'], storyTime: unknownStoryTime(), location: null, characters: [] },
  ]
  for (const row of rows) document = applyEventOperation(document, { action: 'upsert', table: 'events', ...row }).document

  assert.deepEqual(queryMemory(document, { eventId: 'shared-scene-42', order: 'time_asc' }).map(row => row.key), ['arrival-hall', 'arrival-garden'])
  assert.deepEqual(queryMemory(document, { filters: { eventId: 'shared-scene-42', order: 'time_desc' } }).map(row => row.key), ['arrival-garden', 'arrival-hall'])
  assert.deepEqual(queryMemory(document, { location: ['tokyo outskirts'] }).map(row => row.key).sort(), ['arrival-garden', 'arrival-hall'])
  assert.deepEqual(queryMemory(document, { location: ['TOKYO OUTSKIRTS', 'NARITA AIRPORT'] }).map(row => row.key), ['arrival-hall'])
  assert.deepEqual(queryMemory(document, { location: ['Narita Airport'] }), [], 'a location filter is a root-based path prefix')
  assert.deepEqual(queryMemory(document, { location: ['Tokyo Outskirts', 'Narita Airport', 'International Arrivals Hall', 'Gate'] }), [])
  assert.deepEqual(queryMemory(document, { location: null }).map(row => row.key), ['unplaced'])
  assert.deepEqual(queryMemory(document, { characters: ['Bob', 'Cara'], characterMatch: 'any' }).map(row => row.key).sort(), ['arrival-garden', 'arrival-hall', 'festival-rumor'])
  assert.deepEqual(queryMemory(document, { characters: ['Alice', 'Cara'], characterMatch: 'all' }).map(row => row.key), ['arrival-garden'])
  assert.deepEqual(queryMemory(document, { characters: ['alice', 'CARA'], characterMatch: 'all' }).map(row => row.key), ['arrival-garden'])
  assert.deepEqual(queryMemory(document, { timeRange: { timeline: 'main', start: 2, end: 5 }, order: 'time_asc' }).map(row => row.key), ['arrival-hall', 'arrival-garden'])
  assert.deepEqual(queryMemory(document, { timeRange: { timeline: 'main', start: 2.1, end: 4.9 } }), [])
  assert.equal(queryMemory(document, { query: 'after the festival' })[0].key, 'festival-rumor')
  assert.equal(queryMemory(document, { query: 'narita airport' })[0].key, 'arrival-hall')
  assert.equal(queryMemory(document, { query: 'terminal' })[0].key, 'arrival-hall', 'keywords participate in full-text search')
  assert.equal(queryMemory(document, { query: 'cara' })[0].key, 'arrival-garden')
  assert.equal(queryMemory(document, { query: 'shared-scene-42' }).length, 2, 'eventId participates in full-text search')
})

test('keeps event batches atomic and enforces row budgets', () => {
  let document = emptyEventDocument('session-batch')
  document = applyEventOperation(document, {
    action: 'upsert', table: 'items', key: 'brass key', value: { owner: 'User' },
    keywords: ['brass key', 'User'], storyTime: unknownStoryTime(), location: ['Central District', 'Archive'], characters: ['User'],
  }).document
  const before = structuredClone(document)
  assert.throws(() => applyEventOperation(document, { action: 'batch', operations: [
    { action: 'upsert', table: 'items', key: 'silver key', value: {}, keywords: ['silver key', 'Vault'], storyTime: unknownStoryTime(), location: ['Castle', 'Vault'], characters: [] },
    { action: 'update', id: 'missing', value: { owner: 'Nobody' } },
  ] }), /was not found/)
  assert.deepEqual(document, before, 'a failed later operation cannot expose earlier batch mutations')

  const id = document.rows[0].id
  document = applyEventOperation(document, { action: 'batch', operations: [
    { action: 'upsert', table: 'items', key: 'silver key', value: {}, keywords: ['silver key', 'Vault'], storyTime: unknownStoryTime(), location: ['Castle', 'Vault'], characters: [] },
    { action: 'delete', id },
  ] }).document
  assert.deepEqual(document.rows.map(row => row.key), ['silver key'])
  assert.throws(() => applyEventOperation(document, {
    action: 'upsert', table: 'oversize', key: 'blob', value: { text: 'x'.repeat(300 * 1024) },
    keywords: ['oversize', 'blob'], storyTime: unknownStoryTime(), location: null, characters: [],
  }), /exceeds/)
})

test('records maintenance job application atomically and makes replay a no-op', () => {
  const operation = {
    action: 'batch',
    maintenanceJobId: 'turn-1-assistant-7',
    operations: [eventMemory('event-idempotent', 'durable fact')],
  }
  const first = applyEventOperation(emptyEventDocument('session-idempotent'), operation)
  assert.equal(first.changed, true)
  assert.equal(first.document.revision, 1)
  assert.deepEqual(first.document.appliedMaintenanceJobs, ['turn-1-assistant-7'])

  const replay = applyEventOperation(first.document, operation)
  assert.equal(replay.changed, false)
  assert.equal(replay.duplicate, true)
  assert.equal(replay.document.revision, 1)
  assert.equal(replay.document.rows.length, 1)
})

test('upserts event edges idempotently and deletes them by id', () => {
  let document = emptyEventDocument('session-edge-upsert')
  document = applyEventOperation(document, eventMemory('event-1', 'first')).document
  document = applyEventOperation(document, eventMemory('event-2', 'second')).document

  const created = applyEventOperation(document, {
    action: 'event_edge_upsert',
    kind: 'precedes',
    predecessorEventId: ' event-1 ',
    successorEventId: 'event-2',
    reason: 'The first event causes the second.',
    sourceRefs: [{ eventSeq: 20, turn: 4, role: 'assistant' }],
  })
  document = created.document
  assert.equal(document.eventEdges.length, 1)
  assert.equal(created.result.predecessorEventId, 'event-1')
  assert.equal(created.result.kind, 'precedes')

  const originalId = created.result.id
  const originalCreatedAt = created.result.createdAt
  const updated = applyEventOperation(document, {
    action: 'event_edge_upsert',
    predecessorEventId: 'event-1',
    successorEventId: 'event-2',
    reason: 'Updated reason',
  })
  document = updated.document
  assert.equal(document.eventEdges.length, 1)
  assert.equal(updated.result.id, originalId)
  assert.equal(updated.result.createdAt, originalCreatedAt)
  assert.equal(updated.result.reason, 'Updated reason')
  assert.deepEqual(updated.result.sourceRefs, [{ eventSeq: 20, turn: 4, role: 'assistant' }])

  const removed = applyEventOperation(document, { action: 'event_edge_delete', id: originalId })
  assert.equal(removed.result.id, originalId)
  assert.deepEqual(removed.document.eventEdges, [])
})

test('enforces event graph endpoints, self-edge, duplicate, and cycle invariants', () => {
  let document = emptyEventDocument('session-graph-invariants')
  for (const eventId of ['event-1', 'event-2', 'event-3']) {
    document = applyEventOperation(document, eventMemory(eventId, eventId)).document
  }
  const pristine = structuredClone(document)
  assert.throws(() => applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-1', successorEventId: 'missing',
  }), /endpoints/)
  assert.throws(() => applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-1', successorEventId: 'event-1',
  }), /self-edge/)
  assert.deepEqual(document, pristine)

  document = applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-1', successorEventId: 'event-2',
  }).document
  document = applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-2', successorEventId: 'event-3',
  }).document
  const acyclic = structuredClone(document)
  assert.throws(() => applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-3', successorEventId: 'event-1',
  }), /cycle/)
  assert.deepEqual(document, acyclic)

  const firstRowId = document.rows.find(row => row.eventId === 'event-1').id
  assert.throws(() => applyEventOperation(document, { action: 'delete', id: firstRowId }), /endpoints/)
  assert.deepEqual(document, acyclic, 'a row deletion cannot leave a dangling event edge')

  const duplicate = structuredClone(document)
  duplicate.eventEdges.push({ ...duplicate.eventEdges[0], id: 'duplicate-id' })
  assert.deepEqual(
    normalizeEventDocument(duplicate, document.sessionId),
    emptyEventDocument(document.sessionId),
    'an invalid persisted graph normalizes to a fresh schema 5 document',
  )
})

test('validates mixed row and edge batches only after the final atomic document exists', () => {
  let document = emptyEventDocument('session-mixed-batch')
  const applied = applyEventOperation(document, {
    action: 'batch',
    operations: [
      { action: 'event_edge_upsert', predecessorEventId: 'event-1', successorEventId: 'event-2' },
      eventMemory('event-1', 'first'),
      eventMemory('event-2', 'second'),
    ],
  })
  document = applied.document
  assert.equal(document.revision, 1)
  assert.equal(document.rows.length, 2)
  assert.equal(document.eventEdges.length, 1)

  const beforeFailure = structuredClone(document)
  assert.throws(() => applyEventOperation(document, {
    action: 'batch',
    operations: [
      eventMemory('event-3', 'third'),
      { action: 'event_edge_upsert', predecessorEventId: 'event-3', successorEventId: 'missing' },
    ],
  }), /endpoints/)
  assert.deepEqual(document, beforeFailure)

  const firstRowId = document.rows.find(row => row.eventId === 'event-1').id
  const edgeId = document.eventEdges[0].id
  document = applyEventOperation(document, {
    action: 'batch',
    operations: [
      { action: 'delete', id: firstRowId },
      { action: 'event_edge_delete', id: edgeId },
    ],
  }).document
  assert.deepEqual(document.rows.map(row => row.eventId), ['event-2'])
  assert.deepEqual(document.eventEdges, [])
})

test('queries grouped event nodes with direct incoming and outgoing relationships', () => {
  let document = emptyEventDocument('session-graph-query')
  const rows = [
    eventMemory('event-before', 'before'),
    eventMemory('event-seed', 'seed-a', { value: { note: 'unique silver clue' }, importance: 0.9 }),
    eventMemory('event-seed', 'seed-b', { value: { note: 'same scene detail' } }),
    eventMemory('event-after', 'after'),
    eventMemory('event-unrelated', 'unrelated'),
  ]
  for (const row of rows) document = applyEventOperation(document, row).document
  document = applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-before', successorEventId: 'event-seed', reason: 'setup',
  }).document
  document = applyEventOperation(document, {
    action: 'event_edge_upsert', predecessorEventId: 'event-seed', successorEventId: 'event-after', reason: 'consequence',
  }).document

  const direct = queryEventGraph(document, { eventId: 'event-seed' })
  assert.deepEqual(direct.seedEventIds, ['event-seed'])
  assert.deepEqual(direct.events.map(event => event.eventId), ['event-seed', 'event-before', 'event-after'])
  assert.equal(direct.events[0].rows.length, 2, 'all rows sharing the seed eventId are grouped into one event node')
  assert.deepEqual(direct.incomingEdges.map(edge => edge.predecessorEventId), ['event-before'])
  assert.deepEqual(direct.outgoingEdges.map(edge => edge.successorEventId), ['event-after'])

  const derived = queryEventGraph(document, { query: 'unique silver clue', limit: 1 })
  assert.deepEqual(derived.seedEventIds, ['event-seed'])
  assert.deepEqual(derived.events.map(event => event.eventId), ['event-seed', 'event-before', 'event-after'])
  assert.equal(derived.events.some(event => event.eventId === 'event-unrelated'), false)
  assert.deepEqual(queryEventGraph(document, { eventId: 'missing' }), {
    seedEventIds: [], events: [], incomingEdges: [], outgoingEdges: [],
  })
})
