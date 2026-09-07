import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyEventDocument } from '../src/event.js'
import { assembleSillyTavernPrompt } from '../src/prompt.js'
import { createTemplateRuntime, evaluatePromptTemplate } from '../src/template.js'
import { minimalCard } from './helpers.js'

test('runs real asynchronous EJS with await, print, and ST-compatible unescaped expressions', async t => {
  const runtime = createTemplateRuntime()
  t.after(() => runtime.close())
  const result = await runtime.render('<% const value = await Promise.resolve("ready"); print(value) %>|<%= "<tag>" %>', {}, { source: 'async.ejs' })
  assert.equal(result.text, 'ready|<tag>')
  assert.deepEqual(result.mutations, [])
  assert.deepEqual(result.diagnostics, [])
})

test('shares define values and compiled templates for one execution lifecycle', async t => {
  const runtime = createTemplateRuntime()
  t.after(() => runtime.close())
  const prepared = await runtime.render('<% define("decorate", function(value) { return this.char + ":" + value }) %>not emitted', { char: 'Alice' }, {
    source: 'definitions.ejs',
    stage: 'prepare',
  })
  assert.equal(prepared.text, '')
  assert.equal(prepared.output, 'discard')

  const first = await runtime.render('<%= decorate("hello") %>', { char: 'Alice' }, { source: 'use-definition.ejs' })
  const second = await runtime.render('<%= decorate("hello") %>', { char: 'Alice' }, { source: 'use-definition.ejs' })
  assert.equal(first.text, 'Alice:hello')
  assert.equal(second.text, 'Alice:hello')
  assert.equal(first.compileCacheSize, 2)
  assert.equal(second.compileCacheSize, 2)
})

test('models STPT cache precedence while keeping getvar and setvar default scopes distinct', async t => {
  const runtime = createTemplateRuntime({
    state: {
      global: { shared: 'global', count: 2 },
      initial: { shared: 'initial' },
      local: { shared: 'local', localOnly: true },
      message: { shared: 'message' },
    },
    baseRevisions: { chat: 3, global: 4, message: 5, workspace: 6 },
    resources: { currentMessageId: 9, currentSwipeId: 1 },
  })
  t.after(() => runtime.close())
  const result = await runtime.render([
    '<%= getvar("shared") %>',
    '<% setvar("fresh", 7) %>',
    '<% setLocalVar("profile.level", 4) %>',
    '<%= incvar("count", 3) %>',
    '<%= variables.count %>',
  ].join('|'), {}, { source: 'variables.ejs' })

  assert.equal(result.text, 'message|||5|5')
  assert.deepEqual(result.baseRevisions, { chat: 3, global: 4, message: 5, workspace: 6 })
  assert.deepEqual(result.mutations.map(item => [item.scope, item.path, item.messageId]), [
    ['message', ['fresh'], 9],
    ['local', ['profile', 'level'], undefined],
    ['message', ['count'], 9],
  ])
  assert.equal(result.scopes.local.profile.level, 4)
  assert.equal(result.scopes.message.fresh, 7)
  assert.equal(result.scopes.message.count, 5)
  assert.equal(result.scopes.cache.shared, 'message')
  await assert.rejects(runtime.render('<%= getvar("count", { scope: "message", withMsg: { id: 9, swipe_id: 0 } }) %>'),
    error => error.code === 'TEMPLATE_MESSAGE_SCOPE_UNAVAILABLE')
})

test('preparation discards output and only applies explicitly dry-run-enabled writes', async t => {
  const runtime = createTemplateRuntime()
  t.after(() => runtime.close())
  const result = await runtime.render('<% setvar("ignored", 1); setvar("kept", 2, { dryRun: true }); print("hidden") %>', {}, {
    source: 'prepare.ejs',
    stage: 'prepare',
  })
  assert.equal(result.text, '')
  assert.deepEqual(result.mutations.map(item => item.key), ['kept'])
  assert.deepEqual(result.scopes.message, { kept: 2 })
})

test('supports asynchronous include, getwi, getchar, getpreset, and execute adapters', async t => {
  const runtime = createTemplateRuntime({
    state: { local: { seed: 'S' } },
    resources: {
      includes: { card: { content: '<%= label %>:<%= getvar("seed") %>', source: 'partials/card.ejs' } },
      currentWorldbook: 'Book',
      worldbooks: [{ name: 'Book', entries: [{ uid: 1, comment: 'Lore', content: '<%= world_info.comment %>:<%= suffix %>' }] }],
      currentCharacter: 'Alice',
      characters: [{ id: 'alice', name: 'Alice', card: { data: { name: 'Alice', description: 'Kind' } } }],
      presets: [{ name: 'Style', content: 'preset:<%= tone %>' }],
    },
    execute: async command => `ran:${command}`,
    limits: { deadlineMs: 10_000 },
  })
  t.after(() => runtime.close())
  const result = await runtime.render([
    '<%- await include("card", { label: "include" }) %>',
    '<%- await getwi("Lore", { suffix: "ok" }) %>',
    '<%- await getchar("Alice", characterTemplate) %>',
    '<%- await getpreset("Style", { tone: "quiet" }) %>',
    '<%- await execute("/echo hello") %>',
  ].join('|'), { characterTemplate: '<%= name %>:<%= description %>' }, { source: 'resources.ejs' })
  assert.equal(result.text, 'include:S|Lore:ok|Alice:Kind|preset:quiet|ran:/echo hello')
})

test('returns structured injections and source-located diagnostics', async t => {
  const runtime = createTemplateRuntime()
  t.after(() => runtime.close())
  const result = await runtime.render('<% injectPrompt("remember", { position: "depth", role: "assistant", depth: 2 }) %>', {}, { source: 'inject.ejs' })
  assert.deepEqual(result.injections, [{
    text: 'remember',
    position: 'depth',
    role: 'assistant',
    depth: 2,
    once: true,
    source: 'inject.ejs',
    sequence: 1,
  }])

  await assert.rejects(
    runtime.render('line one\n<%= missing.value %>', {}, { source: 'broken.ejs' }),
    error => error.code === 'TEMPLATE_RUNTIME_ERROR'
      && error.diagnostic.source === 'broken.ejs'
      && error.diagnostic.message.includes('broken.ejs:2'),
  )
  await assert.rejects(
    runtime.render('<%- await execute("/echo unavailable") %>', {}, { source: 'execute.ejs' }),
    error => error.code === 'TEMPLATE_EXECUTE_UNAVAILABLE',
  )
})

test('one-shot structured evaluation exposes final scope snapshots', async () => {
  const result = await evaluatePromptTemplate('<% setGlobalVar("flag", true) %><%= getvar("flag") %>', {}, {
    state: { global: {} },
    baseRevisions: { global: 2 },
    source: 'one-shot.ejs',
  })
  assert.equal(result.text, 'true')
  assert.equal(result.scopes.global.flag, true)
  assert.equal(result.mutations[0].scope, 'global')
})

test('prompt assembly evaluates world-book, template, and character EJS once and returns commit state', async () => {
  const card = minimalCard({
    description: '<%= describe(char) %><% setLocalVar("character.seen", true) %>',
    character_book: undefined,
  })
  const book = {
    name: 'Runtime book',
    entries: [{ id: 1, comment: 'Runtime lore', keys: [], constant: true, enabled: true, insertion_order: 1, content: '<% setGlobalVar("loreRuns", 1) %>Lore:<%= await Promise.resolve(char) %>', extensions: {} }],
    extensions: {},
  }
  const state = {
    record: { id: 'alice', card },
    binding: {
      userPersona: { name: 'Bob', description: '' },
      variables: {},
      scriptInjections: [],
      openingSwipeId: 0,
    },
    compatibilityVariables: {
      revisions: { chat: 1, global: 2, message: 3, workspace: 4 },
      scopes: { chat: {}, global: {}, message: {} },
    },
    event: emptyEventDocument('template-runtime-prompt'),
    worldbook: { id: 'runtime-book', name: 'Runtime book', book },
    templates: [{
      id: 'definitions',
      name: 'Definitions',
      position: 'before',
      content: '<% define("describe", value => "Defined:" + value); inject("depth note", { position: "depth", role: "assistant", depth: 2 }) %>',
    }],
    globalVariables: {},
  }
  const prompt = await assembleSillyTavernPrompt({ session: { events: [], surface: { nodes: [] } } }, state)
  assert.match(prompt.system, /Lore:Alice/)
  assert.match(prompt.system, /Defined:Alice/)
  assert.equal(prompt.renderedNamedPrompts.char_description, 'Defined:Alice')
  assert.deepEqual(prompt.template.baseRevisions, { chat: 1, global: 2, message: 3, workspace: 4 })
  assert.deepEqual(prompt.template.mutations.map(item => item.scope), ['global', 'local'])
  assert.equal(prompt.template.scopes.global.loreRuns, 1)
  assert.equal(prompt.template.scopes.local.character.seen, true)
  assert.ok(prompt.worldbookDepthEntries.some(item => item.content === 'depth note' && item.depth === 2 && item.role === 2))
})
