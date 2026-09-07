import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { apply } from '../host.js'
import { minimalCard } from './helpers.js'

function request(method, url, body) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
}

async function invoke(route, method, url, body) {
  let status
  let bytes
  const res = {
    writeHead(nextStatus) { status = nextStatus },
    end(nextBytes) { bytes = Buffer.from(nextBytes ?? '') },
  }
  await route.handler(request(method, url, body), res)
  return { status, body: JSON.parse(bytes.toString('utf8')) }
}

async function waitFor(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(10)
  }
  assert.fail(message)
}

function fakeAgent(workspace, id = 'compat-generation-options') {
  const events = []
  return {
    id,
    ctx: {},
    options: { provider: 'fallback-provider', model: 'fallback-model' },
    session: {
      id,
      header: { cwd: workspace },
      events,
      surface: { nodes: [] },
      snapshotEvents() { return events.slice() },
      append(type, data, options = {}) {
        const event = { type, seq: events.length, time: Date.now(), data: structuredClone(data), ...options }
        events.push(event)
        if (options.surfaceOp === 'append') this.surface.nodes.push({ eventSeq: event.seq })
        return event
      },
    },
  }
}

function textOf(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

async function fixture(t, cardOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-compat-generation-options-'))
  const workspace = join(root, 'workspace')
  const live = fakeAgent(workspace)
  const agents = new Map([[live.id, live]])
  const effects = []
  const requests = []
  let route
  const ctx = {
    webServer: { register(value) { route = value; return () => { route = undefined } } },
    agents: { list: () => [...agents.values()], get: id => agents.get(String(id)), currentInitiator: () => undefined },
    subagents: { async start() { throw new Error('generation options test must not start maintenance') } },
    sessions: { async flush() { return true } },
    llm: {
      async resolveModelInfo(provider, model) { return { provider, id: model, context: { contextWindow: 4096 } } },
      async *stream(options) {
        requests.push(options)
        yield { type: 'text-delta', index: 0, text: 'ok' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    agentPresets: { composedPreset: () => 'sillytavern' },
    provide(name, value) { this[name] = value; return () => { delete this[name] } },
    get(name) { return this[name] },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose },
    on() { return () => undefined },
  }
  await apply(ctx, { fallbackWorkspace: workspace, autoInstallPreset: false })
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.()
    await rm(root, { recursive: true, force: true })
  })
  const card = minimalCard(cardOverrides)
  const imported = await invoke(route, 'POST', '/api/dsh-sillytavern/import', {
    sessionId: live.id,
    fileName: 'alice.json',
    mediaType: 'application/json',
    data: Buffer.from(JSON.stringify(card)).toString('base64'),
  })
  assert.equal(imported.status, 200, JSON.stringify(imported.body))
  const initial = await invoke(route, 'GET', `/api/dsh-sillytavern/compat/chat?sessionId=${live.id}`)
  const created = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/chat/mutate', {
    sessionId: live.id,
    mutation: {
      action: 'create',
      expectedRevision: initial.body.value.revision,
      messages: [
        { role: 'user', message: 'old user history' },
        { role: 'assistant', message: 'old assistant history' },
      ],
    },
  })
  assert.equal(created.status, 200)
  return { route, live, requests, service: ctx.sillyTavern }
}

test('EJS mutations persist to the selected swipe and raw character fields execute once per generation', async t => {
  const { route, live, requests, service } = await fixture(t, {
    description: '<% incvar("count"); setLocalVar("seen", true) %>count:<%= getvar("count") %>',
  })
  await service.store.mutateCompatChat(live, { action: 'set', messages: [{
    message_id: 2, swipe_id: 1, swipes: ['old', 'current'],
    swipes_data: [{ count: 90 }, { count: 4, retained: true }],
  }] })
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const result = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
      sessionId: live.id, mode: 'raw', config: {
        generation_id: `ejs-${iteration}`, ordered_prompts: ['char_description'],
        custom_api: { source: 'mock-provider', model: 'mock-model' },
      },
    })
    assert.equal(result.status, 202, JSON.stringify(result.body))
    await waitFor(() => requests.length === iteration + 1, 'EJS request did not reach provider')
    assert.equal(textOf(requests[iteration].messages[0]), `count:${5 + iteration}`)
  }
  const state = service.store.promptState(live)
  assert.deepEqual(state.compatMessages[2].swipes_data, [{ count: 90 }, { count: 6, retained: true }])
  assert.equal(state.binding.variables.seen, true)
})

test('template errors stop generation before either state changes or provider calls are committed', async t => {
  const { route, live, requests, service } = await fixture(t, {
    description: '<% setLocalVar("partial", true); setGlobalVar("partial", true); throw new Error("template failure") %>',
  })
  const before = service.store.compatibilityVariableSnapshot(live)
  const result = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
    sessionId: live.id, mode: 'preset', config: { custom_api: { source: 'mock-provider', model: 'mock-model' } },
  })
  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'template-evaluation-failed')
  assert.match(result.body.error, /template failure/)
  assert.deepEqual(service.store.compatibilityVariableSnapshot(live), before)
  assert.equal(requests.length, 0)
})

test('world-info overrides replace existing anchors and render author-note EJS in the final request', async t => {
  const { route, live, requests } = await fixture(t, { character_book: {
    name: 'Override book', extensions: {}, entries: [
      { id: 1, keys: [], enabled: true, constant: true, insertion_order: 1, content: 'original before', extensions: { position: 0 } },
      { id: 2, keys: [], enabled: true, constant: true, insertion_order: 2, content: 'original after', extensions: { position: 1 } },
    ],
  } })
  const result = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
    sessionId: live.id, mode: 'preset', config: {
      overrides: { world_info_before: 'new before', world_info_after: 'new after', chat_history: { author_note: 'note:<%= char %>' } },
      custom_api: { source: 'mock-provider', model: 'mock-model' },
    },
  })
  assert.equal(result.status, 202, JSON.stringify(result.body))
  await waitFor(() => requests.length === 1, 'overridden request did not reach provider')
  assert.match(requests[0].system, /new before/)
  assert.match(requests[0].system, /new after/)
  assert.match(requests[0].system, /note:Alice/)
  assert.doesNotMatch(requests[0].system, /original before|original after/)
})

test('generate applies overrides, zero history, request injects, images, tools, schema, and sampling to the final LLM request', async t => {
  const { route, live, requests } = await fixture(t)
  const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }]
  const started = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
    sessionId: live.id,
    mode: 'preset',
    config: {
      generation_id: 'ordinary-contract',
      preset_name: 'in_use',
      user_input: 'new request',
      image: 'data:image/png;base64,AAAA',
      max_chat_history: 0,
      overrides: {
        persona_description: 'Override persona.',
        char_description: 'Override description.',
        char_personality: 'Override personality.',
        scenario: 'Override scenario.',
        dialogue_examples: 'Override dialogue.',
      },
      injects: [
        { position: 'none', depth: 0, role: 'system', content: 'scan only', should_scan: true },
        { position: 'in_chat', depth: 0, role: 'assistant', content: 'request injection' },
      ],
      custom_api: {
        source: 'mock-provider',
        model: 'mock-model',
        temperature: 0.25,
        top_p: 0.8,
        top_k: 17,
        frequency_penalty: -0.5,
        presence_penalty: 0.75,
        max_tokens: 321,
      },
      tools,
      tool_choice: { type: 'function', function: { name: 'lookup' } },
    },
  })
  assert.equal(started.status, 202)
  await waitFor(() => requests.length === 1, 'mock LLM did not receive ordinary generate request')
  const final = requests[0]
  assert.equal(final.provider, 'mock-provider')
  assert.equal(final.model, 'mock-model')
  assert.equal(final.system.includes('Override persona.'), true)
  assert.equal(final.system.includes('Override description.'), true)
  assert.equal(final.system.includes('A curious archivist.'), false)
  assert.equal(final.system.includes('Override personality.'), true)
  assert.equal(final.system.includes('Override scenario.'), true)
  assert.equal(final.system.includes('Override dialogue.'), true)
  assert.deepEqual(final.messages.map(message => [message.role, textOf(message)]), [
    ['user', 'new request'],
    ['assistant', 'request injection'],
  ])
  assert.deepEqual(final.messages[0].content.at(-1), { type: 'image', url: 'data:image/png;base64,AAAA' })
  assert.deepEqual(final.tools, tools)
  assert.deepEqual(final.toolChoice, { type: 'function', function: { name: 'lookup' } })
  assert.equal(final.temperature, 0.25)
  assert.equal(final.topP, 0.8)
  assert.equal(final.topK, 17)
  assert.equal(final.frequencyPenalty, -0.5)
  assert.equal(final.presencePenalty, 0.75)
  assert.equal(final.maxTokens, 321)
})

test('generateRaw preserves the mixed ordered_prompts sequence and RolePrompt string images in the final LLM request', async t => {
  const { route, live, requests } = await fixture(t)
  const jsonSchema = { name: 'answer', value: { type: 'object', properties: { ok: { type: 'boolean' } } } }
  const started = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
    sessionId: live.id,
    mode: 'raw',
    config: {
      generation_id: 'raw-contract',
      user_input: 'raw user input',
      image: 'https://example.test/user.png',
      ordered_prompts: [
        'world_info_before',
        'char_description',
        { role: 'user', content: 'custom user segment', image: 'https://example.test/segment.png' },
        'chat_history',
        { role: 'assistant', content: 'custom assistant segment' },
        'user_input',
        'scenario',
        'world_info_after',
      ],
      overrides: {
        world_info_before: 'Raw world before.',
        char_description: 'Raw description.',
        scenario: 'Raw scenario.',
        world_info_after: 'Raw world after.',
        chat_history: { prompts: [{ role: 'system', content: 'replacement history' }] },
      },
      custom_api: { source: 'mock-provider', model: 'mock-model' },
      json_schema: jsonSchema,
    },
  })
  assert.equal(started.status, 202)
  await waitFor(() => requests.length === 1, 'mock LLM did not receive raw generate request')
  const final = requests[0]
  assert.equal(final.system, '')
  assert.deepEqual(final.messages.map(message => [message.role, textOf(message)]), [
    ['system', 'Raw world before.'],
    ['system', 'Raw description.'],
    ['user', 'custom user segment'],
    ['system', 'replacement history'],
    ['assistant', 'custom assistant segment'],
    ['user', 'raw user input'],
    ['system', 'Raw scenario.'],
    ['system', 'Raw world after.'],
  ])
  assert.deepEqual(final.messages[2].content.at(-1), { type: 'image', url: 'https://example.test/segment.png' })
  assert.deepEqual(final.messages[5].content.at(-1), { type: 'image', url: 'https://example.test/user.png' })
  assert.deepEqual(final.jsonSchema, jsonSchema)
})

test('unsupported preset selection and non-transferable File-shaped images fail explicitly before the broker starts', async t => {
  const { route, live, requests } = await fixture(t)
  const preset = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
    sessionId: live.id,
    mode: 'preset',
    config: { preset_name: 'Named preset', custom_api: { source: 'mock-provider', model: 'mock-model' } },
  })
  assert.equal(preset.status, 400)
  assert.equal(preset.body.code, 'generation-preset-unavailable')
  assert.match(preset.body.error, /only "in_use" is supported/)

  const image = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/generation/start', {
    sessionId: live.id,
    mode: 'raw',
    config: {
      image: { name: 'photo.png', type: 'image/png' },
      user_input: 'inspect image',
      custom_api: { source: 'mock-provider', model: 'mock-model' },
    },
  })
  assert.equal(image.status, 400)
  assert.equal(image.body.code, 'generation-image-file-unavailable')
  assert.match(image.body.error, /pass a URL or base64 string/)
  assert.equal(requests.length, 0)
})
