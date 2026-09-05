import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { apply, inject } from '../host.js'
import { sessionMessages } from '../src/prompt.js'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

const unknownMemoryContext = {
  storyTime: { state: 'normalized', label: null, timeline: 'story', start: 1, end: null },
  location: null,
  characters: [],
}

function request(method, url, body, headers = {}) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', ...headers },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
}

async function invoke(route, method, url, body, requestHeaders) {
  let status
  let responseHeaders
  let bytes
  const res = {
    writeHead(nextStatus, nextHeaders) { status = nextStatus; responseHeaders = nextHeaders },
    end(nextBytes) { bytes = Buffer.from(nextBytes ?? '') },
  }
  await route.handler(request(method, url, body, requestHeaders), res)
  return { status, headers: responseHeaders, body: JSON.parse(bytes.toString('utf8')) }
}

async function waitFor(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail(message)
}

function fakeAgent(workspace, id = 'session-http') {
  const events = []
  const surface = { nodes: [] }
  return {
    id,
    ctx: {},
    runMaintenance(job) {
      const task = Promise.resolve(job(new AbortController().signal))
      this.lastMaintenance = task
      return task
    },
    session: {
      id,
      header: { cwd: workspace },
      events,
      surface,
      snapshotEvents() { return events.slice() },
      append(type, data, options = {}) {
        const event = { type, seq: events.length, time: Date.now(), data: structuredClone(data), ...options }
        events.push(event)
        if (options.surfaceOp === 'append') surface.nodes.push({ eventSeq: event.seq })
        else if (options.surfaceOp?.op === 'replace') {
          const start = surface.nodes.findIndex(node => node.eventSeq === options.surfaceOp.start)
          const end = surface.nodes.findIndex(node => node.eventSeq === options.surfaceOp.end)
          surface.nodes.splice(start, end - start + 1, { eventSeq: event.seq })
        }
        return event
      },
    },
  }
}

test('Host API imports into the existing session and exposes memory CRUD', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dst-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const live = fakeAgent(join(root, 'workspace'))
  const agents = new Map([[live.id, live]])
  const effects = []
  const listeners = new Map()
  let route
  let initiator
  let adapterOptions
  let flushSession = async () => true
  const sessionFlushes = []
  const subagentRuns = []
  const llm = {
    async resolveModelInfo(provider, model) {
      return { provider, id: model, name: model, context: { contextWindow: 1000 } }
    },
    stream(options) {
      const base = async function* () {
        adapterOptions = options
        yield { type: 'text-delta', index: 0, text: 'model raw' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'model raw' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      return listeners.get('llm/stream')(options, base)
    },
  }
  const ctx = {
    webServer: { register(value) { route = value; return () => { route = undefined } } },
    agents: { list: () => [...agents.values()], get: id => agents.get(id), currentInitiator: () => initiator },
    subagents: {
      async start(provider, options) {
        subagentRuns.push({ provider, options })
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: { operations: [{
              action: 'upsert',
              eventId: 'background-event',
              table: 'events',
              key: 'background maintained fact',
              value: { persisted: true },
              keywords: ['Alice', 'silver bell', 'archive'],
              ...unknownMemoryContext,
              importance: 0.5,
              recallPolicy: 'after_compaction',
            }] },
          }),
          async dispose() {},
        }
      },
    },
    sessions: {
      flush(session) {
        sessionFlushes.push(session)
        return flushSession(session)
      },
    },
    llm,
    agentPresets: { composedPreset: agentContext => agentContext?.preset === 'standard' ? 'standard' : 'sillytavern' },
    provide(name, value) { this[name] = value; return () => { delete this[name] } },
    get(name) { return this[name] },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
  }
  assert.deepEqual(inject, ['agents', 'agentPresets', 'llm', 'sessions', 'subagents'])
  await apply(ctx, { fallbackWorkspace: join(root, 'workspace'), autoInstallPreset: false })
  assert.equal(route.path, '/api/dsh-sillytavern')
  const crossSite = await invoke(route, 'GET', '/api/dsh-sillytavern/library', undefined, { host: 'evil.example', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' })
  assert.equal(crossSite.status, 403)
  assert.match(crossSite.body.error, /untrusted API request/)

  const card = minimalCard({ first_mes: 'Welcome {{user}} — {{char}} keeps {{getvar::secret}}.', alternate_greetings: ['Alternate {{user}} with {{char}}.'] })
  const imported = await invoke(route, 'POST', '/api/dsh-sillytavern/import', {
    sessionId: live.id,
    fileName: 'alice.json',
    mediaType: 'application/json',
    data: Buffer.from(JSON.stringify(card)).toString('base64'),
    replace: false,
  })
  assert.equal(imported.status, 200)
  assert.equal(imported.body.value.record.card.data.name, 'Alice')
  assert.equal(imported.body.value.session.sessionId, live.id)
  assert.equal(live.session.events.length, 0, 'import must not append an out-of-turn assistant event')

  const trustedRegex = values => {
    const script = { id: values.id, name: values.id, kind: 'regex', enabled: true, approvedHash: null, source: values.source, findRegex: values.findRegex, trimStrings: [], placement: values.placement, markdownOnly: values.markdownOnly === true, promptOnly: values.promptOnly === true, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }
    const material = { findRegex: script.findRegex, trimStrings: script.trimStrings, placement: script.placement, markdownOnly: script.markdownOnly, promptOnly: script.promptOnly, runOnEdit: script.runOnEdit, substituteRegex: script.substituteRegex, minDepth: script.minDepth, maxDepth: script.maxDepth, source: script.source }
    script.approvedHash = createHash('sha256').update(`regex\0${JSON.stringify(material)}`).digest('hex')
    return script
  }
  const regexUpdate = await invoke(route, 'POST', '/api/dsh-sillytavern/card/update', {
    sessionId: live.id,
    cardId: imported.body.value.record.id,
    patch: {
      scripts: [
        trustedRegex({ id: 'prompt', findRegex: '/secret/g', source: 'filtered', placement: [2], promptOnly: true }),
        trustedRegex({ id: 'raw-output', findRegex: '/model raw/g', source: 'character reply', placement: [2] }),
      ],
      characterBook: { entries: [
        { id: 7, keys: [], content: 'request-only lore', enabled: true, constant: true, insertion_order: 99, extensions: { position: 4, depth: 0, role: 0 } },
        { id: 8, keys: [], content: 'not retrieved yet', enabled: true, insertion_order: 1, extensions: { vectorized: true, position: 1 } },
      ], extensions: {} },
    },
  })
  assert.equal(regexUpdate.status, 200)
  initiator = live
  const llmChunks = []
  for await (const chunk of ctx.llm.stream({ provider: 'test', model: 'model', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'secret history' }] }] })) llmChunks.push(chunk)
  initiator = undefined
  assert.equal(adapterOptions.messages[0].content[0].text, 'filtered history', 'promptOnly is projected into the adapter request without mutating durable history')
  assert.equal(llmChunks[0].text, 'character reply', 'raw assistant Regex rewrites the stream before agent-loop persistence')
  assert.equal(llmChunks[1].block.text, 'character reply')

  const prepared = await ctx.sillyTavern.promptFor(live, undefined, { provider: 'openai', model: 'gpt-5' })
  assert.equal(prepared.worldbookBudget.tokens, 250)
  assert.deepEqual(prepared.activeWorldbookEntries, [7])
  const diagnostics = ctx.sillyTavern.sessionView(live).worldbookDiagnostics
  assert.deepEqual(diagnostics.activeEntryIds, ['7'])
  assert.deepEqual(diagnostics.budget, prepared.worldbookBudget)
  assert.equal(diagnostics.warnings.some(warning => warning.startsWith('vectorized-entry-unavailable:')), true)
  assert.equal(Object.hasOwn(diagnostics, 'system'), false, 'diagnostics never expose the generated prompt')
  const diagnosedSession = await invoke(route, 'GET', `/api/dsh-sillytavern/session?sessionId=${live.id}`)
  assert.deepEqual(diagnosedSession.body.value.worldbookDiagnostics, diagnostics)
  const requestSystem = ctx.sillyTavern.bindPromptToRequest(live, prepared, { provider: 'openai', model: 'gpt-5' })
  assert.match(requestSystem, /dsh-sillytavern-request:/, 'an @depth projection receives a request binding marker')
  assert.equal(
    ctx.sillyTavern.bindPromptToRequest(live, { ...prepared, worldbookDepthEntries: [] }, { provider: 'openai', model: 'gpt-5' }),
    prepared.system,
    'a prompt without @depth entries remains stable and receives no request binding marker',
  )
  initiator = live
  for await (const _chunk of ctx.llm.stream({ provider: 'openai', model: 'gpt-5', system: requestSystem, messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }] })) {}
  initiator = undefined
  assert.equal(adapterOptions.system.includes('dsh-sillytavern-request:'), false, 'the private request binding marker never reaches the adapter')
  const injected = adapterOptions.messages.at(-1)
  assert.equal(injected.role, 'system')
  assert.equal(injected.content[0].text, 'request-only lore')
  assert.equal(live.session.events.some(event => JSON.stringify(event).includes('request-only lore')), false, 'depth lore is injected only into the adapter request')

  initiator = live
  for await (const _chunk of ctx.llm.stream({ provider: 'openai', model: 'gpt-5', system: prepared.system, messages: [{ id: 'u2', role: 'user', content: [{ type: 'text', text: 'unbound' }], source: { kind: 'user' } }] })) {}
  initiator = undefined
  assert.equal(adapterOptions.messages.some(message => message.content?.[0]?.text === 'request-only lore'), false, 'an unbound request cannot reuse another generation\'s @depth projection')

  const libraryAfterImport = await invoke(route, 'GET', `/api/dsh-sillytavern/library?sessionId=${live.id}`)
  assert.equal(libraryAfterImport.body.value.selectedCardId, imported.body.value.record.id)
  assert.equal(libraryAfterImport.body.value.selectedCard.name, 'Alice')
  const previewOnly = fakeAgent(join(root, 'workspace'), 'session-http-preview-only')
  agents.set(previewOnly.id, previewOnly)
  const compatibility = await invoke(route, 'GET', '/api/dsh-sillytavern/compatibility')
  assert.equal(compatibility.status, 200)
  assert.equal(compatibility.body.value.schemaVersion, 1)
  assert.match(compatibility.body.value.upstream.tavernHelper.revision, /^[a-f0-9]{40}$/)
  const compatWorldbookCreate = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/worldbook', {
    sessionId: live.id,
    action: 'create',
    name: 'Compatibility Route Lore',
    entries: [{ name: 'route', content: 'route-compatible lore', strategy: { type: 'constant' } }],
  })
  assert.equal(compatWorldbookCreate.status, 200)
  const compatWorldbookRead = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/worldbook', { sessionId: live.id, action: 'get', name: 'Compatibility Route Lore' })
  assert.equal(compatWorldbookRead.body.value.worldbook[0].content, 'route-compatible lore')
  const compatRegexWrite = await invoke(route, 'POST', '/api/dsh-sillytavern/compat/regex', {
    sessionId: live.id,
    changes: { global: [{ id: 'compat-route', name: 'Compatibility Route', enabled: true, findRegex: '/never-match-this/', source: 'unchanged', placement: [2], markdownOnly: true }] },
  })
  assert.equal(compatRegexWrite.status, 200)
  const compatRuntime = await invoke(route, 'GET', `/api/dsh-sillytavern/compat/runtime?sessionId=${live.id}`)
  assert.equal(compatRuntime.body.value.state.globalRegexScripts[0].id, 'compat-route')
  assert.equal(compatRuntime.body.value.regexRevision > 0, true)
  const openingRuntime = await invoke(route, 'GET', `/api/dsh-sillytavern/compat/runtime?sessionId=${previewOnly.id}`)
  assert.equal(openingRuntime.status, 200)
  assert.equal(openingRuntime.body.value.sessionId, previewOnly.id)
  assert.equal(openingRuntime.body.value.cardRecord.id, imported.body.value.record.id, 'blank sessions receive the same selected greeting candidate in their bootstrap snapshot')
  assert.equal(openingRuntime.body.value.state.binding.cardId, imported.body.value.record.id)
  const preview = await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${previewOnly.id}`)
  assert.equal(preview.status, 200)
  assert.deepEqual(preview.body.value, { characterName: 'Alice', text: 'Welcome User — Alice keeps .', swipeId: 0, swipeCount: 2 })
  const alternatePreview = await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${previewOnly.id}&swipeId=1`)
  assert.equal(alternatePreview.status, 200)
  assert.deepEqual(alternatePreview.body.value, { characterName: 'Alice', text: 'Alternate User with Alice.', swipeId: 1, swipeCount: 2 })
  const invalidSwipe = await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${previewOnly.id}&swipeId=2`)
  assert.equal(invalidSwipe.status, 400)
  assert.match(invalidSwipe.body.error, /outside 0\.\.1/)
  assert.equal(ctx.sillyTavern.sessionView(previewOnly).binding, null, 'greeting GET previews the workspace selection without creating a draft binding')
  assert.equal(previewOnly.session.events.length, 0)

  for (const invalid of [null, '1', 1.5, -1]) {
    const malformedSelection = await invoke(route, 'POST', '/api/dsh-sillytavern/opening/select', { sessionId: previewOnly.id, swipeId: invalid })
    assert.equal(malformedSelection.status, 400)
    assert.match(malformedSelection.body.error, /non-negative safe integer/)
  }
  const selectedOpening = await invoke(route, 'POST', '/api/dsh-sillytavern/opening/select', { sessionId: previewOnly.id, swipeId: 1 })
  assert.equal(selectedOpening.status, 200)
  assert.deepEqual(selectedOpening.body.value, { swipeId: 1 })
  assert.equal(ctx.sillyTavern.sessionView(previewOnly).binding.openingSwipeId, 1)
  const staleSessionWrite = await invoke(route, 'POST', '/api/dsh-sillytavern/session/update', { sessionId: previewOnly.id, patch: { expectedRevision: 0, variables: { stale: true } } })
  assert.equal(staleSessionWrite.status, 409)
  assert.equal(staleSessionWrite.body.code, 'session-revision-conflict')
  const reopenedStore = new SillyTavernStore({ fallbackWorkspace: join(root, 'workspace') })
  await reopenedStore.ready
  const reopenedAgent = fakeAgent(join(root, 'workspace'), previewOnly.id)
  await reopenedStore.ensureSession(reopenedAgent)
  assert.equal(reopenedStore.sessionView(reopenedAgent).binding.openingSwipeId, 1, 'opening swipe survives a fresh Store instance')
  reopenedStore.disposeSession(reopenedAgent)
  const persistedPreview = await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${previewOnly.id}`)
  assert.equal(persistedPreview.body.value.text, 'Alternate User with Alice.')

  const firstUserMessage = { id: 'user-1', role: 'user', content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }
  listeners.get('agent/inbox/inserted')({ agent: previewOnly, message: firstUserMessage })
  listeners.get('agent/inbox/inserted')({ agent: previewOnly, message: firstUserMessage })
  await previewOnly.lastMaintenance
  assert.deepEqual(previewOnly.session.events.map(event => event.type), ['command/run', 'command/done'], 'opening is recorded once before the first user turn')
  assert.equal(previewOnly.session.events[0].data.name, 'st-opening')
  assert.equal(previewOnly.session.events[1].data.text, 'Alternate User with Alice.')
  assert.equal(previewOnly.session.surface.nodes.length, 0, 'the opening command row is log-only and never rewrites the native message Surface')
  previewOnly.session.append('turn/start', { turn: 1 })
  previewOnly.session.append('step/start', { turn: 1, step: 1 })
  const firstUser = previewOnly.session.append('user/message', firstUserMessage, { surfaceOp: 'append' })
  const runtimeContext = previewOnly.session.append('user/message', { id: 'context-1', role: 'user', content: [{ type: 'text', text: 'Runtime context' }], source: { kind: 'context', name: 'runtime' } }, { surfaceOp: 'append' })
  assert.equal(previewOnly.session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1, 'the plugin must not insert a duplicate user message')
  assert.deepEqual(previewOnly.session.surface.nodes, [{ eventSeq: firstUser.seq }, { eventSeq: runtimeContext.seq }])
  assert.equal(previewOnly.session.events.some(event => event.type === 'assistant/message' && event.data.message?.source?.provider === 'dsh-sillytavern'), false, 'the plugin must not append an out-of-order assistant surface event')
  const rejectedReselection = await invoke(route, 'POST', '/api/dsh-sillytavern/opening/select', { sessionId: previewOnly.id, swipeId: 0 })
  assert.equal(rejectedReselection.status, 400)
  assert.match(rejectedReselection.body.error, /before conversation messages exist/)
  const bypassedReselection = await invoke(route, 'POST', '/api/dsh-sillytavern/session/update', { sessionId: previewOnly.id, patch: { openingSwipeId: 0 } })
  assert.equal(bypassedReselection.status, 400)
  assert.match(bypassedReselection.body.error, /through \/opening\/select/)

  const fastAgent = fakeAgent(join(root, 'workspace'), 'session-http-fast-first-user')
  agents.set(fastAgent.id, fastAgent)
  listeners.get('agent/inbox/inserted')({ agent: fastAgent, message: firstUserMessage })
  await fastAgent.lastMaintenance
  assert.deepEqual(fastAgent.session.events.map(event => event.type), ['command/run', 'command/done'], 'a fast first inbox waits in Agent maintenance until the selected card is initialized')
  assert.equal(fastAgent.session.events[1].data.text, 'Welcome User — Alice keeps .')

  const maintenanceRaceAgent = fakeAgent(join(root, 'workspace'), 'session-http-maintenance-admission')
  agents.set(maintenanceRaceAgent.id, maintenanceRaceAgent)
  const admittedMaintenance = maintenanceRaceAgent.runMaintenance
  let maintenanceAdmissions = 0
  maintenanceRaceAgent.runMaintenance = function (job) {
    maintenanceAdmissions += 1
    if (maintenanceAdmissions === 1) throw new Error('agent already has active work')
    return admittedMaintenance.call(this, job)
  }
  const previousConsoleError = console.error
  console.error = () => undefined
  try {
    listeners.get('agent/inbox/inserted')({ agent: maintenanceRaceAgent, message: firstUserMessage })
    assert.equal(maintenanceRaceAgent.session.events.length, 0)
    listeners.get('agent/status')({ agent: maintenanceRaceAgent, status: 'idle' })
    await maintenanceRaceAgent.lastMaintenance
  } finally {
    console.error = previousConsoleError
  }
  assert.equal(maintenanceAdmissions, 2, 'a retained first-inbox marker retries when Agent maintenance converges to idle')
  assert.deepEqual(maintenanceRaceAgent.session.events.map(event => event.type), ['command/run', 'command/done'])
  const assemblyFallbackAgent = fakeAgent(join(root, 'workspace'), 'session-http-assembly-fallback')
  agents.set(assemblyFallbackAgent.id, assemblyFallbackAgent)
  assemblyFallbackAgent.runMaintenance = () => { throw new Error('agent already has active maintenance') }
  console.error = () => undefined
  try { listeners.get('agent/inbox/inserted')({ agent: assemblyFallbackAgent, message: firstUserMessage }) } finally { console.error = previousConsoleError }
  assert.equal(assemblyFallbackAgent.session.events.length, 0)
  await ctx.sillyTavern.promptFor(assemblyFallbackAgent)
  assert.equal(ctx.sillyTavern.flushOpening(assemblyFallbackAgent), false, 'system-prompt assembly flushes the retained opening before step/user publication')
  assert.deepEqual(assemblyFallbackAgent.session.events.map(event => event.type), ['command/run', 'command/done'])

  const orphanAgent = fakeAgent(join(root, 'workspace'), 'session-http-orphan-opening')
  agents.set(orphanAgent.id, orphanAgent)
  await ctx.sillyTavern.ensure(orphanAgent)
  orphanAgent.session.append('command/run', { commandId: 'st-opening-orphan', name: 'st-opening', source: { kind: 'user' } })
  listeners.get('agent/inbox/inserted')({ agent: orphanAgent, message: firstUserMessage })
  await orphanAgent.lastMaintenance
  assert.equal(orphanAgent.session.events.filter(event => event.type === 'command/run').length, 1, 'an orphan is repaired rather than duplicated')
  assert.deepEqual(orphanAgent.session.events.map(event => event.type), ['command/run', 'command/done'])
  assert.equal(orphanAgent.session.events[1].data.commandId, 'st-opening-orphan')
  orphanAgent.session.append('command/run', { commandId: 'st-opening-extra-orphan', name: 'st-opening', source: { kind: 'user' } })
  await listeners.get('agent/created')({ agent: orphanAgent })
  assert.equal(orphanAgent.session.events.at(-1).type, 'command/done')
  assert.equal(orphanAgent.session.events.at(-1).data.commandId, 'st-opening-extra-orphan')
  assert.equal(orphanAgent.session.events.at(-1).data.kind, 'error', 'an unmatched duplicate is settled even when a completed opening exists')
  const restartOrphan = fakeAgent(join(root, 'workspace'), 'session-http-restart-orphan')
  agents.set(restartOrphan.id, restartOrphan)
  await ctx.sillyTavern.ensure(restartOrphan)
  restartOrphan.session.append('command/run', { commandId: 'st-opening-restart-orphan', name: 'st-opening', source: { kind: 'user' } })
  restartOrphan.session.append('user/message', firstUserMessage, { surfaceOp: 'append' })
  await listeners.get('agent/created')({ agent: restartOrphan })
  assert.deepEqual(restartOrphan.session.events.map(event => event.type), ['command/run', 'user/message', 'command/done'], 'startup repair settles an orphan even after the native user event persisted')
  assert.equal(restartOrphan.session.events[2].data.commandId, 'st-opening-restart-orphan')

  const snapshotOnlyAgent = fakeAgent(join(root, 'workspace'), 'session-http-snapshot-only')
  agents.set(snapshotOnlyAgent.id, snapshotOnlyAgent)
  await ctx.sillyTavern.ensure(snapshotOnlyAgent)
  snapshotOnlyAgent.session.append('command/run', { commandId: 'st-opening-snapshot-only', name: 'st-opening', source: { kind: 'user' } })
  snapshotOnlyAgent.session.append('user/message', firstUserMessage, { surfaceOp: 'append' })
  delete snapshotOnlyAgent.session.events
  await listeners.get('agent/created')({ agent: snapshotOnlyAgent })
  assert.deepEqual(snapshotOnlyAgent.session.snapshotEvents().map(event => event.type), ['command/run', 'user/message', 'command/done'], 'Agent recovery reads the public snapshotEvents API when no legacy events property exists')
  assert.equal(sessionMessages(snapshotOnlyAgent).at(-1).text, 'Hello', 'conversation history also reads snapshotEvents')

  const selectionRaceAgent = fakeAgent(join(root, 'workspace'), 'session-http-selection-race')
  agents.set(selectionRaceAgent.id, selectionRaceAgent)
  await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${selectionRaceAgent.id}`)
  const originalUpdateSession = ctx.sillyTavern.store.updateSession.bind(ctx.sillyTavern.store)
  let announceUpdate
  let releaseUpdate
  const updateStarted = new Promise(resolve => { announceUpdate = resolve })
  const updateGate = new Promise(resolve => { releaseUpdate = resolve })
  ctx.sillyTavern.store.updateSession = async (...args) => {
    announceUpdate()
    await updateGate
    return originalUpdateSession(...args)
  }
  let racedSelection
  try {
    const request = invoke(route, 'POST', '/api/dsh-sillytavern/opening/select', { sessionId: selectionRaceAgent.id, swipeId: 1 })
    await updateStarted
    listeners.get('agent/inbox/inserted')({ agent: selectionRaceAgent, message: firstUserMessage })
    assert.equal(selectionRaceAgent.session.events.length, 0, 'first inbox is held while opening selection maintenance is pending')
    releaseUpdate()
    racedSelection = await request
  } finally {
    ctx.sillyTavern.store.updateSession = originalUpdateSession
    releaseUpdate?.()
  }
  assert.equal(racedSelection.status, 200)
  assert.deepEqual(racedSelection.body.value, { swipeId: 1 })
  assert.deepEqual(selectionRaceAgent.session.events.map(event => event.type), ['command/run', 'command/done'])
  assert.equal(selectionRaceAgent.session.events[1].data.text, 'Alternate User with Alice.', 'displayed opening uses the selection committed before the held first turn')

  const ineligible = fakeAgent(join(root, 'workspace'), 'session-http-ineligible')
  ineligible.ctx.preset = 'standard'
  agents.set(ineligible.id, ineligible)
  const forbiddenGreeting = await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${ineligible.id}`)
  assert.equal(forbiddenGreeting.status, 403)
  assert.match(forbiddenGreeting.body.error, /not using/)
  const fresh = fakeAgent(join(root, 'workspace'), 'session-http-fresh')
  agents.set(fresh.id, fresh)
  await ctx.sillyTavern.ensure(fresh)
  assert.equal(ctx.sillyTavern.sessionView(fresh).binding, null, 'loading a session does not bind the workspace selection before the first real user message')
  live.session.append('user/message', { content: [{ type: 'text', text: 'archive' }] }, { surfaceOp: 'append' })
  const eventState = await invoke(route, 'GET', `/api/dsh-sillytavern/event-state?sessionId=${live.id}&after=-1`)
  assert.equal(eventState.status, 200)
  assert.deepEqual(eventState.body.value.card, { id: imported.body.value.record.id, name: 'Alice' })
  assert.equal(eventState.body.value.history.find(message => message.role === 'user')?.text, 'archive')
  assert.equal(eventState.body.value.history[0].role, 'assistant', 'the selected opening is a durable projected floor before the first user message')
  assert.equal('event' in eventState.body.value, false)
  assert.ok(JSON.stringify(eventState.body).length < 2048, 'event polling response stays lightweight')
  const traversal = await invoke(route, 'POST', '/api/dsh-sillytavern/card/update', { sessionId: live.id, cardId: '../escape', patch: { cardData: { name: 'x' } } })
  assert.equal(traversal.status, 400)
  assert.match(traversal.body.error, /SHA-256/)

  const duplicate = await invoke(route, 'POST', '/api/dsh-sillytavern/import', {
    sessionId: live.id,
    fileName: 'alice.json',
    data: Buffer.from(JSON.stringify(card)).toString('base64'),
  })
  assert.equal(duplicate.status, 200, 're-importing the currently selected card is idempotent for the draft binding')

  const variables = await invoke(route, 'POST', '/api/dsh-sillytavern/session/update', { sessionId: live.id, patch: { variables: { secret: 'amber' } } })
  assert.equal(variables.status, 200)
  const eventCountBeforeGreeting = live.session.events.length
  const greeting = await invoke(route, 'GET', `/api/dsh-sillytavern/greeting?sessionId=${live.id}`)
  assert.equal(greeting.status, 200)
  assert.deepEqual(greeting.body.value, { characterName: 'Alice', text: 'Welcome User — Alice keeps amber.', swipeId: 0, swipeCount: 2 })
  assert.equal(live.session.events.length, eventCountBeforeGreeting, 'greeting preview must not append a conversation event')
  const worldbookId = regexUpdate.body.value.defaultWorldbookId
  const worldbook = await invoke(route, 'POST', '/api/dsh-sillytavern/worldbook/update', { sessionId: live.id, worldbookId, patch: { book: { name: 'Alice Worldbook', entries: [{ keys: ['archive'], content: '{{getvar::secret}}', enabled: true, insertion_order: 0, extensions: {} }], extensions: {} } } })
  assert.equal(worldbook.status, 200, worldbook.body.error)
  const invalidBook = await invoke(route, 'POST', '/api/dsh-sillytavern/worldbook/update', { sessionId: live.id, worldbookId, patch: { book: 'invalid' } })
  assert.equal(invalidBook.status, 400)
  const scriptSource = 'window.test = true'
  const approvedHash = createHash('sha256').update(`javascript\0${scriptSource}`).digest('hex')
  const trustedScript = await invoke(route, 'POST', '/api/dsh-sillytavern/card/update', { sessionId: live.id, cardId: imported.body.value.record.id, patch: { scripts: [{ id: 's', name: 's', kind: 'javascript', source: scriptSource, enabled: true, approvedHash }] } })
  assert.equal(trustedScript.body.value.scripts[0].enabled, true)
  const changedKind = await invoke(route, 'POST', '/api/dsh-sillytavern/card/update', { sessionId: live.id, cardId: imported.body.value.record.id, patch: { scripts: [{ ...trustedScript.body.value.scripts[0], kind: 'html' }] } })
  assert.equal(changedKind.body.value.scripts[0].enabled, false)

  live.session.append('assistant/message', { message: { content: 'Alice arrives at Narita Airport in the International Arrivals Hall.' } })
  const oneKeyword = await invoke(route, 'POST', '/api/dsh-sillytavern/event', {
    sessionId: live.id,
    operation: { action: 'upsert', table: 'events', key: 'invalid-count', value: {}, keywords: ['Alice'], ...unknownMemoryContext },
  })
  assert.equal(oneKeyword.status, 400)
  assert.match(oneKeyword.body.error, /2 to 10/)
  const genericKeyword = await invoke(route, 'POST', '/api/dsh-sillytavern/event', {
    sessionId: live.id,
    operation: { action: 'upsert', table: 'events', key: 'invalid-generic', value: {}, keywords: ['Alice', '事件'], ...unknownMemoryContext },
  })
  assert.equal(genericKeyword.status, 400)
  assert.match(genericKeyword.body.error, /generic classifications/)
  const missingKeyword = await invoke(route, 'POST', '/api/dsh-sillytavern/event', {
    sessionId: live.id,
    operation: { action: 'upsert', table: 'events', key: 'invalid-source', value: {}, keywords: ['Alice', 'Osaka'], ...unknownMemoryContext },
  })
  assert.equal(missingKeyword.status, 400)
  assert.match(missingKeyword.body.error, /missing: "Osaka"/)
  for (const storyTime of [
    { state: 'unknown', start: null, end: null },
    { state: 'normalized', timeline: 'story', end: 2 },
    { state: 'normalized', timeline: 'story', start: 2, end: 1 },
  ]) {
    const invalidTime = await invoke(route, 'POST', '/api/dsh-sillytavern/event', {
      sessionId: live.id,
      operation: { action: 'upsert', table: 'events', key: 'invalid-time', value: {}, keywords: ['Alice', 'Narita Airport'], ...unknownMemoryContext, storyTime },
    })
    assert.equal(invalidTime.status, 400)
    assert.match(invalidTime.body.error, /storyTime/)
  }
  const memory = await invoke(route, 'POST', '/api/dsh-sillytavern/event', {
    sessionId: live.id,
    operation: { action: 'upsert', table: 'events', key: 'arrival', value: { place: 'archive' }, keywords: ['Alice', 'Narita Airport'], ...unknownMemoryContext, location: ['Tokyo Outskirts', 'Narita Airport', 'International Arrivals Hall'] },
  })
  assert.equal(memory.status, 200)
  assert.equal(memory.body.value.revision, 1)

  const session = await invoke(route, 'GET', `/api/dsh-sillytavern/session?sessionId=${live.id}`)
  assert.equal(session.status, 200)
  assert.equal(session.body.value.event.rows[0].key, 'arrival')
  assert.deepEqual(session.body.value.event.rows[0].location, ['Tokyo Outskirts', 'Narita Airport', 'International Arrivals Hall'])
  assert.equal(session.body.value.binding.cardId, imported.body.value.record.id)
  assert.equal(session.body.value.binding.variables.secret, 'amber')
  assert.equal(session.body.value.card.card.data.character_book, undefined)
  assert.equal(session.body.value.worldbook.book.entries[0].content, '{{getvar::secret}}')
  assert.deepEqual(session.body.value.event.rows[0].storyTime, unknownMemoryContext.storyTime, 'required start and nullable end survive API persistence')

  const eventView = await invoke(route, 'GET', `/api/dsh-sillytavern/events?sessionId=${live.id}`)
  assert.equal(eventView.status, 200)
  assert.deepEqual(eventView.body.value.document, session.body.value.event, 'the explorer receives all stored rows and edges without query/recall limits')
  assert.equal(eventView.body.value.sessionId, live.id)
  const unchangedEvents = await invoke(route, 'GET', `/api/dsh-sillytavern/events?sessionId=${live.id}&revision=1`)
  assert.deepEqual(unchangedEvents.body.value, { sessionId: live.id, revision: 1, unchanged: true })
  const otherEvents = await invoke(route, 'GET', `/api/dsh-sillytavern/events?sessionId=${fresh.id}`)
  assert.equal(otherEvents.body.value.document.rows.length, 0, 'events remain scoped to the requested session')

  const backgroundTurn = 9
  live.session.append('turn/start', { turn: backgroundTurn })
  const backgroundUser = live.session.append('user/message', { content: [{ type: 'text', text: 'Remember the silver bell.' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const backgroundAssistant = live.session.append('assistant/message', { message: { content: [{ type: 'text', text: 'Alice locks the silver bell in the archive.' }], source: { kind: 'model' } } }, { surfaceOp: 'append' })
  const backgroundEnd = live.session.append('turn/end', { turn: backgroundTurn, reason: { kind: 'completed' } })
  let releaseFinalBodyFlush
  flushSession = () => new Promise(resolve => { releaseFinalBodyFlush = resolve })
  listeners.get('session/event')(live.session, backgroundEnd)
  await waitFor(() => releaseFinalBodyFlush !== undefined, 'turn/end did not request a durable final-body flush')
  await delay(20)
  assert.equal(subagentRuns.length, 0, 'background maintenance must wait until final-body persistence succeeds')
  releaseFinalBodyFlush(true)
  flushSession = async () => true
  await waitFor(() => ctx.sillyTavern.sessionView(live).event.rows.some(row => row.key === 'background maintained fact'), 'turn/end did not launch background event maintenance')
  const updatedEvents = await invoke(route, 'GET', `/api/dsh-sillytavern/events?sessionId=${live.id}&revision=1`)
  assert.equal(updatedEvents.body.value.unchanged, false)
  assert.equal(updatedEvents.body.value.document.rows.some(row => row.key === 'background maintained fact'), true)
  assert.equal(sessionFlushes.at(-1), live.session)
  assert.equal(subagentRuns.length, 1)
  assert.equal(subagentRuns[0].provider, 'spawn')
  assert.equal(subagentRuns[0].options.parent, live)
  assert.match(subagentRuns[0].options.prompt[0].text, /Alice locks the silver bell/)
  const maintained = ctx.sillyTavern.sessionView(live).event.rows.find(row => row.key === 'background maintained fact')
  assert.deepEqual(maintained.sourceRefs, [
    { eventSeq: backgroundUser.seq, turn: backgroundTurn, role: 'user' },
    { eventSeq: backgroundAssistant.seq, turn: backgroundTurn, role: 'assistant' },
  ])

  const maintenanceChild = fakeAgent(join(root, 'workspace'), 'session-http-maintenance-child')
  maintenanceChild.session.header.origin = 'subagent'
  maintenanceChild.session.header.parentSession = live.id
  agents.set(maintenanceChild.id, maintenanceChild)
  assert.equal(ctx.sillyTavern.eligible(maintenanceChild), false)
  maintenanceChild.session.append('turn/start', { turn: 1 })
  maintenanceChild.session.append('assistant/message', { message: { content: [{ type: 'text', text: 'patch output' }], source: { kind: 'model' } } })
  const childEnd = maintenanceChild.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  listeners.get('session/event')(maintenanceChild.session, childEnd)
  await delay(30)
  assert.equal(subagentRuns.length, 1, 'a maintenance child must never recursively schedule event maintenance')

  const blockedDelete = await invoke(route, 'POST', '/api/dsh-sillytavern/card/delete', { sessionId: live.id, cardId: imported.body.value.record.id })
  assert.equal(blockedDelete.status, 409)
  assert.equal(blockedDelete.body.code, 'card-active-sessions')
  for (const id of [...agents.keys()]) if (id !== fresh.id) agents.delete(id)
  const deleted = await invoke(route, 'POST', '/api/dsh-sillytavern/card/delete', { sessionId: fresh.id, cardId: imported.body.value.record.id })
  assert.equal(deleted.status, 200, deleted.body.error)
  assert.equal(deleted.body.value.deleted, true)
  assert.equal(deleted.body.value.cardId, imported.body.value.record.id)
  assert.ok(deleted.body.value.unboundSessions >= 3)
  assert.equal(deleted.body.value.selectedCardId, null)
  const libraryAfterDelete = await invoke(route, 'GET', `/api/dsh-sillytavern/library?sessionId=${fresh.id}`)
  assert.equal(libraryAfterDelete.body.value.cards.length, 0)
  assert.equal(libraryAfterDelete.body.value.selectedCardId, null)
  const cardAfterDelete = await invoke(route, 'GET', `/api/dsh-sillytavern/card?sessionId=${fresh.id}&id=${imported.body.value.record.id}`)
  assert.equal(cardAfterDelete.status, 404)
  const sessionAfterDelete = ctx.sillyTavern.sessionView(live)
  assert.equal(sessionAfterDelete.binding, null)
  assert.equal(sessionAfterDelete.card, null)
  assert.equal(sessionAfterDelete.event.rows[0].key, 'arrival', 'deleting a card does not erase session memory')
  const duplicateDelete = await invoke(route, 'POST', '/api/dsh-sillytavern/card/delete', { sessionId: fresh.id, cardId: imported.body.value.record.id })
  assert.equal(duplicateDelete.status, 404)

  const hostSource = await readFile(new URL('../host.js', import.meta.url), 'utf8')
  assert.match(hostSource, /ctx\.on\('agent\/inbox\/inserted', recordOpeningBeforeFirstUser\)/)
  assert.match(hostSource, /ctx\.on\('session\/event'/)
  assert.match(hostSource, /session\.append\('command\/run'/)
  assert.equal(hostSource.includes("session.append('assistant/message'"), false)
  assert.equal(hostSource.includes("session.append('user/message'"), false)

  for (const dispose of effects.reverse()) await dispose?.()
  assert.equal(route, undefined)
})

test('Host startup installs the bundled preset without mounting it before Service activation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dst-host-preset-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const systemRoot = join(root, 'system')
  const userRoot = join(root, 'user')
  await mkdir(join(systemRoot, 'minimal'), { recursive: true })
  await mkdir(userRoot, { recursive: true })
  await writeFile(join(systemRoot, 'minimal', 'agent.cordis.yml'), '- id: minimal\n  name: minimal\n', 'utf8')
  await writeFile(join(systemRoot, 'minimal', 'preset.yml'), 'name: Minimal\n', 'utf8')
  let eagerMountCalls = 0
  const roster = {
    composedPreset: () => undefined,
    async list() {
      const presets = [{ id: 'minimal', trust: 'system', path: join(systemRoot, 'minimal', 'agent.cordis.yml') }]
      for (const entry of await readdir(userRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name)) presets.push({ id: entry.name, trust: 'user', path: join(userRoot, entry.name, 'agent.cordis.yml') })
      }
      return presets
    },
    async resolve(id) {
      const preset = (await this.list()).find(item => item.id === id)
      if (preset === undefined) throw new Error(`preset ${id} not found`)
      return preset
    },
    async copy(from, id) {
      const source = await this.resolve(from)
      await cp(dirname(source.path), join(userRoot, id), { recursive: true, force: false, errorOnExist: true })
    },
    async remove(id) { await rm(join(userRoot, id), { recursive: true, force: true }) },
    async standingKeyFor() {
      eagerMountCalls += 1
      throw new Error('standing mount is intentionally unavailable until Host apply completes')
    },
  }
  const ctx = {
    agents: { list: () => [], get: () => undefined },
    agentPresets: roster,
    provide(name, value) { this[name] = value; return () => { delete this[name] } },
    get() { return undefined },
    effect(callback) { return callback() },
    on() { return () => undefined },
  }
  await apply(ctx, { fallbackWorkspace: join(root, 'workspace') })
  assert.equal(eagerMountCalls, 0)
  assert.ok(ctx.sillyTavern, 'Host Service is available after apply completes')
  assert.match(await readFile(join(userRoot, 'sillytavern', 'agent.cordis.yml'), 'utf8'), /dsh-sillytavern\/agent/)
})
