import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyEventDocument } from '../src/event.js'
import { assembleSillyTavernPrompt, initialGreetingView, injectWorldbookDepthMessages, sessionMessages, sessionTranscriptMessages } from '../src/prompt.js'
import { minimalCard } from './helpers.js'

function promptState(cardOverrides = {}) {
  return {
    record: { id: 'length-card', card: minimalCard(cardOverrides), scripts: [] },
    binding: {
      userPersona: { name: 'Bob', description: '' },
      variables: {},
      templateIds: [],
      scriptInjections: [],
      openingSwipeId: 0,
    },
    event: emptyEventDocument('prompt-length-test'),
    templates: [],
  }
}

function worldbookEntry(id, content, position, role = 0) {
  return {
    id,
    keys: [],
    content,
    enabled: true,
    constant: true,
    insertion_order: 1,
    extensions: { position, depth: 0, role },
  }
}

const emptyAgent = { session: { events: [], surface: { nodes: [] } } }

test('two large character fields remain complete when the final system prompt exceeds 200 KiB', async () => {
  const description = `DESCRIPTION-HEAD\n${'D'.repeat(112 * 1024)}\nDESCRIPTION-MIDDLE\n${'d'.repeat(1024)}\nDESCRIPTION-TAIL`
  const personality = `PERSONALITY-HEAD\n${'P'.repeat(112 * 1024)}\nPERSONALITY-MIDDLE\n${'p'.repeat(1024)}\nPERSONALITY-TAIL`
  const state = promptState({ first_mes: '', description, personality })

  const prompt = await assembleSillyTavernPrompt(emptyAgent, state)

  assert.ok(prompt.system.length > 200 * 1024)
  assert.doesNotMatch(prompt.system, /\[prompt middle truncated\]/)
  assert.equal(prompt.renderedNamedPrompts.char_description, description)
  assert.equal(prompt.renderedNamedPrompts.char_personality, personality)
  assert.ok(prompt.system.includes(description))
  assert.ok(prompt.system.includes(personality))
})

test('a long user message stays complete in session history and template scope', async () => {
  const userMessage = `USER-HEAD\n${'U'.repeat(36 * 1024)}\nUSER-MIDDLE\n${'u'.repeat(1024)}\nUSER-TAIL`
  const event = { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: userMessage }] } }
  const agent = { session: { events: [event], surface: { nodes: [0] } } }
  const state = promptState({ first_mes: '' })
  state.templates = [{
    id: 'long-history-scope',
    name: 'Long history scope',
    position: 'after',
    content: `messages=${'<%= messages[0].text %>'}\nhistory=${'<%= history %>'}`,
  }]

  assert.equal(sessionMessages(agent)[0].text, userMessage)
  assert.equal(sessionTranscriptMessages(agent)[0].text, userMessage)
  const prompt = await assembleSillyTavernPrompt(agent, state)

  assert.match(prompt.system, new RegExp(`messages=${userMessage}\\nhistory=user: ${userMessage}`))
})

test('character fields and their EJS scope preserve content beyond 32 KiB', async () => {
  const description = `${'D'.repeat(34 * 1024)}<CHARACTER-END>`
  const state = promptState({
    first_mes: '',
    description,
    personality: '<%= character.description %>',
  })

  const prompt = await assembleSillyTavernPrompt(emptyAgent, state)

  assert.equal(prompt.renderedNamedPrompts.char_description, description)
  assert.equal(prompt.renderedNamedPrompts.char_personality, description)
  assert.equal(prompt.system.match(/<CHARACTER-END>/g)?.length, 2)
})

test('opening source text beyond 32 KiB reaches both greeting view and assembled prompt', async () => {
  const opening = `${'G'.repeat(33 * 1024)}<OPENING-END>`
  const state = promptState({ first_mes: opening })

  assert.equal(initialGreetingView(state)?.text, opening)
  const prompt = await assembleSillyTavernPrompt(emptyAgent, state)
  assert.match(prompt.system, /<OPENING-END>/)
})

test('worldbook anchors over 32 KiB do not discard depth-zero status, choices, or format injections', async () => {
  const before = `${'B'.repeat(17 * 1024)}<BEFORE-END>`
  const after = `${'A'.repeat(17 * 1024)}<AFTER-END>`
  const state = promptState({ first_mes: '' })
  state.worldbook = {
    id: 'long-worldbook',
    name: 'Long worldbook',
    book: {
      entries: [
        worldbookEntry('before', before, 0),
        worldbookEntry('after', after, 1),
        worldbookEntry('status', '<STATUS-BAR>', 4, 0),
        worldbookEntry('choices', '<CHOICES>', 4, 2),
        worldbookEntry('format', '<GENERAL-FORMAT>', 4, 0),
      ],
      extensions: {},
    },
  }

  const prompt = await assembleSillyTavernPrompt(
    emptyAgent,
    state,
    undefined,
    { countTokens: async text => text.length },
  )

  assert.match(prompt.system, /<BEFORE-END>/)
  assert.match(prompt.system, /<AFTER-END>/)
  assert.deepEqual(prompt.worldbookDepthEntries.map(({ content, depth, role }) => ({ content, depth, role })), [
    { content: '<STATUS-BAR>', depth: 0, role: 0 },
    { content: '<CHOICES>', depth: 0, role: 2 },
    { content: '<GENERAL-FORMAT>', depth: 0, role: 0 },
  ])

  const projected = injectWorldbookDepthMessages({ messages: [
    { id: 'user', role: 'user', content: [{ type: 'text', text: 'continue' }] },
  ] }, prompt.worldbookDepthEntries, () => 'length')
  assert.deepEqual(projected.messages.map(message => [message.role, message.content[0].text]), [
    ['user', 'continue'],
    ['system', '<STATUS-BAR>\n<GENERAL-FORMAT>'],
    ['assistant', '<CHOICES>'],
  ])
})

test('a long worldbook EJS source keeps its closing tag and rendered tail', async () => {
  const source = `${'W'.repeat(32 * 1024 - 2)}<%= "WORLD-EJS-END" %>`
  const state = promptState({ first_mes: '' })
  state.worldbook = {
    id: 'long-ejs-worldbook',
    name: 'Long EJS worldbook',
    book: { entries: [worldbookEntry('long-ejs', source, 1)], extensions: {} },
  }

  const prompt = await assembleSillyTavernPrompt(emptyAgent, state, undefined, {
    countTokens: async text => text.length,
  })

  assert.match(prompt.system, /WORLD-EJS-END/)
  assert.equal(prompt.renderedNamedPrompts.world_info_after.endsWith('WORLD-EJS-END'), true)
  assert.equal(prompt.template.diagnostics.length, 0)
})

test('long templates and injectPrompt payloads preserve content beyond 32 KiB', async () => {
  const templateSource = `${'T'.repeat(32 * 1024 - 2)}<%= "TEMPLATE-EJS-END" %>`
  const injected = `${'I'.repeat(33 * 1024)}<INJECT-END>`
  const state = promptState({ first_mes: '' })
  state.templates = [
    { id: 'long-template', name: 'Long template', position: 'after', content: templateSource },
    {
      id: 'long-injection',
      name: 'Long injection',
      position: 'after',
      content: `<% injectPrompt(${JSON.stringify(injected)}, { position: "depth", role: "system", depth: 0 }) %>`,
    },
  ]

  const prompt = await assembleSillyTavernPrompt(emptyAgent, state)

  assert.match(prompt.system, /TEMPLATE-EJS-END/)
  const depthInjection = prompt.worldbookDepthEntries.find(item => item.source === 'template:long-injection')
  assert.equal(depthInjection?.content, injected)
  const projected = injectWorldbookDepthMessages({ messages: [] }, prompt.worldbookDepthEntries, () => 'template')
  assert.equal(projected.messages[0].content[0].text, injected)
})

test('worldbook token budgets count the complete rendered entry', async () => {
  const description = `${'L'.repeat(36 * 1024)}<BUDGET-END>`
  const budget = 34 * 1024
  const countedLengths = []
  const state = promptState({ first_mes: '', description })
  state.worldbook = {
    id: 'budget-worldbook',
    name: 'Budget worldbook',
    book: {
      entries: [worldbookEntry('expanded-entry', '<%= character.description %>', 1)],
      extensions: {},
    },
  }

  const prompt = await assembleSillyTavernPrompt(emptyAgent, state, undefined, {
    fallbackTokenBudget: budget,
    countTokens: async text => {
      countedLengths.push(text.length)
      return text.length
    },
  })

  assert.equal(Math.max(...countedLengths), description.length + 1)
  assert.deepEqual(prompt.activeWorldbookEntries, [])
  assert.deepEqual(prompt.worldbookBudget, { tokens: budget, usedTokens: 0, overflowed: true })
  assert.doesNotMatch(prompt.system, /<BUDGET-END>.*<BUDGET-END>/s)
})
