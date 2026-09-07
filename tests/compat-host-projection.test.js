import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function fakeAgent(workspace, id = 'compat-host-projection') {
  const events = []
  return {
    id,
    ctx: {},
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

test('Host llm hook applies real ledger delete/rotate without mutating multimodal protocol input or source events', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-compat-host-projection-'))
  const workspace = join(root, 'workspace')
  const live = fakeAgent(workspace)
  const agents = new Map([[live.id, live]])
  const listeners = new Map()
  const effects = []
  const adapterRequests = []
  let route
  let initiator

  const adapter = options => (async function* () {
    adapterRequests.push(options)
    yield { type: 'text-delta', index: 0, text: 'adapter reply' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
  const llm = {
    async resolveModelInfo(provider, model) { return { provider, id: model, context: { contextWindow: 4096 } } },
    stream(options) {
      const hooks = listeners.get('llm/stream') ?? []
      const dispatch = index => index >= hooks.length ? adapter(options) : hooks[index](options, () => dispatch(index + 1))
      return dispatch(0)
    },
  }
  const ctx = {
    webServer: { register(value) { route = value; return () => { route = undefined } } },
    agents: { list: () => [...agents.values()], get: id => agents.get(String(id)), currentInitiator: () => initiator },
    subagents: { async start() { throw new Error('host projection test must not start maintenance') } },
    sessions: { async flush() { return true } },
    llm,
    agentPresets: { composedPreset: () => 'sillytavern' },
    provide(name, value) { this[name] = value; return () => { delete this[name] } },
    get(name) { return this[name] },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose },
    on(name, listener, options = {}) {
      const entries = listeners.get(name) ?? []
      if (options.prepend) entries.unshift(listener)
      else entries.push(listener)
      listeners.set(name, entries)
      return () => {
        const index = entries.indexOf(listener)
        if (index >= 0) entries.splice(index, 1)
      }
    },
  }
  await apply(ctx, { fallbackWorkspace: workspace, autoInstallPreset: false })
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.()
    await rm(root, { recursive: true, force: true })
  })

  const imported = await invoke(route, 'POST', '/api/dsh-sillytavern/import', {
    sessionId: live.id,
    fileName: 'alice.json',
    mediaType: 'application/json',
    data: Buffer.from(JSON.stringify(minimalCard())).toString('base64'),
  })
  assert.equal(imported.status, 200)
  const openingState = await invoke(route, 'GET', `/api/dsh-sillytavern/compat/chat?sessionId=${live.id}`)
  assert.equal(openingState.status, 200)
  assert.equal(openingState.body.value.messages.some(message => message.extra?.dsh_opening === true), true)

  const image = { type: 'image', url: 'data:image/png;base64,eA==' }
  const reasoning = { type: 'reasoning', text: 'private thought', signature: 'signed' }
  const toolCall = { type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{"id":1}' }
  const a = { id: 'A', role: 'user', content: [image, { type: 'text', text: 'A' }], source: { kind: 'user' } }
  const b = { id: 'B', role: 'assistant', content: [reasoning, { type: 'text', text: 'B' }, toolCall], source: { kind: 'assistant' } }
  const toolResult = { id: 'tool-result', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', content: { found: true } }] }
  const c = { id: 'C', role: 'user', content: [{ type: 'text', text: 'C' }], source: { kind: 'user' } }
  live.session.append('user/message', a, { surfaceOp: 'append' })
  live.session.append('assistant/message', { message: b }, { surfaceOp: 'append' })
  live.session.append('user/message', c, { surfaceOp: 'append' })

  const refreshed = await invoke(route, 'GET', `/api/dsh-sillytavern/compat/chat?sessionId=${live.id}`)
  assert.equal(refreshed.status, 200)
  const opening = refreshed.body.value.messages.find(message => message.extra?.dsh_opening === true)
  assert.notEqual(opening, undefined)
  const deleted = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/chat/mutate', {
    sessionId: live.id,
    mutation: { action: 'delete', expectedRevision: refreshed.body.value.revision, messageIds: [opening.message_id] },
  })
  assert.equal(deleted.status, 200)
  const rotated = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/chat/mutate', {
    sessionId: live.id,
    mutation: { action: 'rotate', expectedRevision: deleted.body.value.revision, begin: 0, middle: 2, end: 3 },
  })
  assert.equal(rotated.status, 200)
  assert.deepEqual(rotated.body.value.messages.map(message => message.message), ['C', 'A', 'B'])

  const sourceEvents = structuredClone(live.session.events)
  const input = { provider: 'mock', model: 'model', system: 'system', messages: [a, b, toolResult, c] }
  const originalInput = structuredClone(input)
  initiator = live
  try {
    for await (const _chunk of ctx.llm.stream(input)) {}
  } finally {
    initiator = undefined
  }

  assert.equal(adapterRequests.length, 1)
  const final = adapterRequests[0]
  assert.deepEqual(final.messages.map(message => message.id), ['C', 'A', 'B', 'tool-result'])
  assert.deepEqual(final.messages[1].content, [image, { type: 'text', text: 'A' }])
  assert.deepEqual(final.messages[2].content, [reasoning, { type: 'text', text: 'B' }, toolCall])
  assert.deepEqual(final.messages[3], toolResult)
  assert.deepEqual(input, originalInput)
  assert.deepEqual(live.session.events, sourceEvents)
})
