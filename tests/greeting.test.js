import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyEventDocument } from '../src/event.js'
import { assembleSillyTavernPrompt, initialGreetingView, sessionMessages } from '../src/prompt.js'
import { minimalCard } from './helpers.js'

function greetingState(firstMes, variables = {}, alternateGreetings = []) {
  return {
    record: { card: minimalCard({ first_mes: firstMes, alternate_greetings: alternateGreetings }) },
    binding: {
      userPersona: { name: 'Bob', description: '' },
      variables,
      templateIds: [],
      scriptInjections: [],
      openingSwipeId: 0,
    },
    event: emptyEventDocument('greeting-test'),
    templates: [],
  }
}

test('initial greeting expands bounded macros without treating markup as HTML', () => {
  assert.deepEqual(initialGreetingView(greetingState('Hello {{user}}, I am {{char}}. {{getvar::mood}}', { mood: '<script>alert(1)</script>' })), {
    characterName: 'Alice',
    text: 'Hello Bob, I am Alice. <script>alert(1)</script>',
    swipeId: 0,
    swipeCount: 1,
  })
})

test('initial greeting applies raw AI Regex before Markdown display and prompt projection', () => {
  const state = greetingState('Original opening')
  state.record.scripts = [{ id: 'opening-raw', kind: 'regex', enabled: true, findRegex: '/Original/', source: '<script>raw()</script>', trimStrings: [], placement: [2], markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }]
  assert.equal(initialGreetingView(state).text, '<script>raw()</script> opening')
})

test('initial greeting selects alternate swipes without mutating state', () => {
  const state = greetingState('First {{user}}', {}, ['Second {{char}}', 'Third'])
  assert.deepEqual(initialGreetingView(state, 1), { characterName: 'Alice', text: 'Second Alice', swipeId: 1, swipeCount: 3 })
  assert.equal(state.record.card.data.alternate_greetings[0], 'Second {{char}}')
  assert.throws(() => initialGreetingView(state, 3), /outside 0\.\.2/)
  assert.throws(() => initialGreetingView(state, -1), /non-negative safe integer/)
})

test('card angle aliases use the same persona as template macros in opening context', () => {
  const state = greetingState('<user> meets <char>. {{user}} greets {{char}}. <USER>!', {}, ['Welcome <user>'])
  assert.equal(initialGreetingView(state).text, 'Bob meets Alice. Bob greets Alice. Bob!')
  assert.equal(initialGreetingView(state, 1).text, 'Welcome Bob')
  assert.equal(state.record.card.data.first_mes, '<user> meets <char>. {{user}} greets {{char}}. <USER>!')
})

test('selected opening remains model context without duplicating the native user history', async () => {
  const state = greetingState('Original menu {{user}}', {}, ['Selected route for {{char}}'])
  state.binding.openingSwipeId = 1
  const emptyPrompt = await assembleSillyTavernPrompt({ session: { events: [], surface: { nodes: [] } } }, state)
  assert.match(emptyPrompt.system, /# Conversation-opening assistant message\nSelected route for Alice/)
  assert.doesNotMatch(emptyPrompt.system, /Original menu Bob/)
  assert.doesNotMatch(emptyPrompt.system, /# Initial greeting/)
  const user = { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: 'Hello' }] } }
  const continuedPrompt = await assembleSillyTavernPrompt({ session: { events: [user], surface: { nodes: [0] } } }, state)
  assert.match(continuedPrompt.system, /# Conversation-opening assistant message\nSelected route for Alice/)
})

test('session messages follow native Surface replacement semantics', () => {
  const original = { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: 'Hello' }] } }
  const opening = { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'Selected route' }] } }, surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] }
  const visibleUser = { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: 'Hello' }] }, surfaceOp: 'append' }
  const agent = { session: { events: [original, opening, visibleUser], surface: { nodes: [1, 2] } } }
  assert.deepEqual(sessionMessages(agent), [
    { role: 'assistant', text: 'Selected route', seq: 1 },
    { role: 'user', text: 'Hello', seq: 2 },
  ])
})

test('initial greeting omits empty content and preserves macro expansion beyond 32 KiB', () => {
  assert.equal(initialGreetingView(greetingState('   ')), null)
  const huge = `${'x'.repeat(33 * 1024)}<GREETING-MACRO-END>`
  assert.equal(initialGreetingView(greetingState('{{getvar::huge}}', { huge }))?.text, huge)
})

test('assembles ST world-info anchors separately and resolves named outlets only in macro-aware templates', async () => {
  const state = greetingState('Opening')
  state.record.card.data.character_book = {
    recursive_scanning: true,
    entries: [
      ...[0, 1, 2, 3, 5, 6].map(position => ({ id: position, keys: [], content: `anchor-${position}`, enabled: true, constant: true, insertion_order: position, extensions: { position } })),
      { id: 7, keys: [], content: 'outlet-content', enabled: true, constant: true, insertion_order: 7, extensions: { position: 7, outlet_name: 'Lore' } },
    ],
    extensions: {},
  }
  state.worldbook = { id: 'anchors', name: 'Anchors', book: state.record.card.data.character_book }
  delete state.record.card.data.character_book
  state.record.card.data.description = 'Description must not consume {{outlet::Lore}}.'
  state.templates = [{ id: 'outlet-template', name: 'Outlet template', content: 'Template consumes {{outlet::Lore}}.', position: 'after' }]
  const prompt = await assembleSillyTavernPrompt({ session: { events: [], surface: { nodes: [] } } }, state)
  const system = prompt.system
  assert.ok(system.indexOf('anchor-0') < system.indexOf('## Character name'))
  assert.ok(system.indexOf('anchor-1') > system.indexOf('## Conversation-opening assistant message'))
  assert.ok(system.indexOf('anchor-5') < system.indexOf('## Example dialogue'))
  assert.ok(system.indexOf('anchor-6') > system.indexOf('## Example dialogue'))
  assert.ok(system.indexOf('anchor-2') < system.indexOf('## Post-history instructions'))
  assert.ok(system.indexOf('anchor-3') > system.indexOf('## Post-history instructions'))
  assert.match(system, /Template consumes outlet-content\./)
  assert.doesNotMatch(system, /Description must not consume outlet-content/)
})

test('world-info assembly can scan one hundred visible chat messages', async () => {
  const state = greetingState('')
  state.record.card.data.character_book = {
    scan_depth: 100,
    entries: [{ id: 'oldest', keys: ['oldest-marker'], content: 'found-one-hundred-deep', enabled: true, insertion_order: 1, extensions: {} }],
    extensions: {},
  }
  state.worldbook = { id: 'deep-scan', name: 'Deep scan', book: state.record.card.data.character_book }
  delete state.record.card.data.character_book
  const events = Array.from({ length: 100 }, (_value, seq) => ({
    type: 'user/message',
    seq,
    data: { content: [{ type: 'text', text: seq === 0 ? 'oldest-marker' : `filler-${seq}` }] },
  }))
  const agent = { session: { events, surface: { nodes: events.map((_event, index) => index) } } }
  const prompt = await assembleSillyTavernPrompt(agent, state, undefined, { countTokens: async text => text.length })
  assert.match(prompt.system, /found-one-hundred-deep/)
})
