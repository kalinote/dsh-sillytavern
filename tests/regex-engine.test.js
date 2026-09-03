import assert from 'node:assert/strict'
import test from 'node:test'
import {
  escapeRegexMacro,
  getRegexedString,
  regexFromString,
  REGEX_PLACEMENT,
  runRegexScript,
  SUBSTITUTE_FIND_REGEX,
} from '../src/regex.js'
import { transformPromptMessages, transformRawAssistantStream, transformRawUserMessages } from '../src/regex-pipeline.js'

function rule(overrides = {}) {
  return {
    id: 'rule',
    name: 'Rule',
    kind: 'regex',
    enabled: true,
    findRegex: '/x/g',
    source: 'y',
    trimStrings: [],
    placement: [REGEX_PLACEMENT.USER_INPUT, REGEX_PLACEMENT.AI_OUTPUT],
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: SUBSTITUTE_FIND_REGEX.NONE,
    minDepth: null,
    maxDepth: null,
    ...overrides,
  }
}

function state(scoped, extras = {}) {
  return {
    record: { card: { data: { name: 'Alice', description: 'Archivist' } }, scripts: scoped },
    binding: { userPersona: { name: 'A+B', description: '' }, variables: { trim: '<cut>' } },
    memory: { rows: [] },
    templates: [],
    globalRegexScripts: extras.global ?? [],
    presetRegexScripts: extras.preset ?? [],
  }
}

test('matches official parser, captures, trim, macros and literal replacement tokens', () => {
  assert.equal(regexFromString('x').global, false, 'plain patterns do not gain an implicit global flag')
  assert.equal('xxx'.replace(regexFromString('x'), 'y'), 'yxx')
  const source = rule({
    findRegex: '/<x>(?<body>[\\s\\S]*?)<\\/x>/',
    source: '{{match}}|$1|$<body>|$$|$&|$10|{{char}}',
    trimStrings: ['{{getvar::trim}}'],
  })
  const output = runRegexScript(source, '<x>A<cut>B</x>', {
    scope: { char: 'Alice', user: 'A+B', variables: { trim: '<cut>' } },
  })
  assert.equal(output, '<x>AB</x>|AB|AB|$$|$&||Alice')
  assert.equal(escapeRegexMacro('A+B\n'), 'A\\+B\\n')
  assert.equal(runRegexScript(rule({ source: '{{lastMessageId}}|{{currentSwipeId}}|{{reverse::abc}}|{{roll::1d1}}' }), 'x', { scope: { messages: [{ seq: 7, text: 'last' }], currentSwipeId: 3 } }), '7|3|cba|1')
})

test('implements NONE, RAW and ESCAPED findRegex macro modes', () => {
  const scope = { user: 'A+B' }
  const raw = rule({ findRegex: '/{{user}}/g', source: 'raw', substituteRegex: 1 })
  const escaped = rule({ findRegex: '/{{user}}/g', source: 'escaped', substituteRegex: 2 })
  const none = rule({ findRegex: '/{{user}}/g', source: 'none', substituteRegex: 0 })
  assert.equal(runRegexScript(raw, 'AAAB A+B', { scope }), 'raw A+B')
  assert.equal(runRegexScript(escaped, 'AAAB A+B', { scope }), 'AAAB escaped')
  assert.equal(runRegexScript(none, '{{user}} A+B', { scope }), 'none A+B')
})

test('applies Global then Preset then Scoped with official phase, edit, depth and placement gates', () => {
  const global = rule({ id: 'g', findRegex: '/x/g', source: 'G', markdownOnly: true })
  const preset = rule({ id: 'p', findRegex: '/G/g', source: 'P', markdownOnly: true })
  const scoped = rule({ id: 's', findRegex: '/P/g', source: 'S', markdownOnly: true, minDepth: 1, maxDepth: 2 })
  const sources = { global: [global], preset: [preset], scoped: [scoped] }
  assert.equal(getRegexedString('x', 2, sources, { isMarkdown: true, depth: 1 }).text, 'S')
  assert.equal(getRegexedString('x', 2, sources, { isMarkdown: true, depth: 0 }).text, 'P')
  assert.equal(getRegexedString('x', 2, sources, { isPrompt: true, depth: 1 }).text, 'x')
  assert.equal(getRegexedString('x', 1, sources, { isMarkdown: true, depth: 1 }).text, 'S')

  const both = rule({ markdownOnly: true, promptOnly: true, source: 'both' })
  assert.equal(getRegexedString('x', 2, [both], {}).text, 'x')
  assert.equal(getRegexedString('x', 2, [both], { isMarkdown: true }).text, 'both')
  assert.equal(getRegexedString('x', 2, [both], { isPrompt: true }).text, 'both')
  assert.equal(getRegexedString('x', 2, [rule({ source: 'edit' })], { isEdit: true }).text, 'x')
  assert.equal(getRegexedString('x', 2, [rule({ source: 'edit', runOnEdit: true })], { isEdit: true }).text, 'edit')
  const originalPass = [rule({ id: 'first', findRegex: '/x/', source: 'changed' }), rule({ id: 'second', findRegex: '/changed/', source: '{{original}}' })]
  assert.equal(getRegexedString('x', 2, originalPass).text, 'x', '{{original}} stays bound to the full pass input across sequential rules')
})

test('does not filter replacement HTML/JavaScript or reject user-owned Regex patterns', () => {
  const replacement = '<script>window.userOwned=true</script><button onclick="run()">$1</button>'
  const html = runRegexScript(rule({ findRegex: '/(aaa)/', source: replacement }), 'aaa')
  assert.equal(html, '<script>window.userOwned=true</script><button onclick="run()">aaa</button>')
  assert.equal(runRegexScript(rule({ findRegex: '/(a+)+$/', source: 'accepted' }), 'aaa'), 'accepted')
})

test('transforms raw user input, prompt-only history and raw assistant/reasoning stream blocks independently', async () => {
  const rules = [
    rule({ id: 'user-raw', findRegex: '/raw/g', source: 'stored', placement: [1] }),
    rule({ id: 'assistant-prompt', findRegex: '/secret/g', source: '', placement: [2], promptOnly: true }),
    rule({ id: 'reasoning-prompt', findRegex: '/hidden/g', source: '', placement: [6], promptOnly: true }),
    rule({ id: 'assistant-raw', findRegex: '/model/g', source: 'character', placement: [2] }),
    rule({ id: 'reasoning-raw', findRegex: '/think/g', source: 'reason', placement: [6] }),
  ]
  const current = state(rules)
  const user = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'raw input' }] }
  assert.equal(transformRawUserMessages([user], current)[0].content[0].text, 'stored input')
  const historyRule = state([rule({ id: 'user-history', findRegex: '/raw input/', source: '{{lastCharMessage}}', placement: [1] })])
  assert.equal(transformRawUserMessages([user], historyRule, [{ role: 'assistant', text: 'prior reply' }])[0].content[0].text, 'prior reply')

  const messages = [
    { role: 'assistant', content: [{ type: 'reasoning', text: 'hidden thought' }, { type: 'text', text: 'secret text' }] },
    { role: 'user', content: [{ type: 'text', text: 'next' }] },
  ]
  const projected = transformPromptMessages(messages, current)
  assert.equal(projected[0].content[0].text, ' thought')
  assert.equal(projected[0].content[1].text, ' text')
  assert.equal(messages[0].content[1].text, 'secret text', 'prompt projection does not mutate durable messages')

  async function* stream() {
    yield { type: 'reasoning-delta', index: 0, text: 'think' }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } }
    yield { type: 'text-delta', index: 1, text: 'model' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: 'model' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const chunks = []
  for await (const chunk of transformRawAssistantStream(stream(), current)) chunks.push(chunk)
  assert.equal(chunks[0].text, 'reason')
  assert.equal(chunks[1].block.text, 'reason')
  assert.equal(chunks[2].text, 'character')
  assert.equal(chunks[3].block.text, 'character')
})
