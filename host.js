import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { assertTrustedLoopbackRequest, decodeBase64, readJsonBody, sendJson } from './src/http.js'
import { assembleSillyTavernPrompt, compactedEventSeqs, initialGreetingView, injectWorldbookDepthMessages, sessionEventDelta, sessionEvents, sessionMessages } from './src/prompt.js'
import { createMemoryMaintenanceJob, MemoryMaintenanceManager } from './src/memory-maintenance.js'
import { SillyTavernStore } from './src/store.js'
import { installBundledPreset } from './src/preset-installer.js'
import { promptRegexRequest, transformRawAssistantStream, transformRawUserMessages } from './src/regex-pipeline.js'
import { getRegexedString, REGEX_PLACEMENT, regexRulesForState, runRegexScript, regexScopeForState } from './src/regex.js'
import { countModelTokens } from './src/tokenizer.js'

export const name = 'dsh-sillytavern'
export const VERSION = '0.9.0'
export const inject = ['agents', 'agentPresets', 'llm', 'sessions', 'subagents']

const REQUEST_BINDING_PATTERN = /<!-- dsh-sillytavern-request:([0-9a-f-]{36}) -->/gi
const MAX_REQUEST_BINDINGS_PER_AGENT = 16

function stripRequestBinding(system) {
  if (typeof system !== 'string') return { id: undefined, system }
  let id
  const replaced = system.replace(REQUEST_BINDING_PATTERN, (_match, value) => {
    id = String(value).toLocaleLowerCase()
    return ''
  })
  return id === undefined
    ? { id, system }
    : { id, system: replaced.replace(/\n{3,}/g, '\n\n').trimEnd() }
}

export async function apply(ctx, config = {}) {
  const presetInstall = config.autoInstallPreset === false
    ? { status: 'disabled', presetId: 'sillytavern', version: VERSION }
    : await installBundledPreset(ctx.agentPresets, { version: VERSION })
  const store = new SillyTavernStore(config)
  await store.ready
  let active = true

  const eligible = agent => agent?.session?.header?.origin !== 'subagent'
    && ctx.agentPresets.composedPreset(agent.ctx) === 'sillytavern'
  const maintenanceAgentOptions = {}
  if (typeof config.memoryMaintenanceProvider === 'string' && config.memoryMaintenanceProvider !== '') maintenanceAgentOptions.provider = config.memoryMaintenanceProvider
  if (typeof config.memoryMaintenanceModel === 'string' && config.memoryMaintenanceModel !== '') maintenanceAgentOptions.model = config.memoryMaintenanceModel
  if (typeof config.memoryMaintenanceReasoningEffort === 'string' && config.memoryMaintenanceReasoningEffort !== '') maintenanceAgentOptions.reasoningEffort = config.memoryMaintenanceReasoningEffort
  const memoryMaintenance = new MemoryMaintenanceManager({
    store,
    subagents: ctx.subagents,
    provider: typeof config.memoryMaintenanceSubagentProvider === 'string' && config.memoryMaintenanceSubagentProvider !== '' ? config.memoryMaintenanceSubagentProvider : 'spawn',
    maxAttempts: config.memoryMaintenanceMaxAttempts,
    maxConcurrency: config.memoryMaintenanceMaxConcurrency,
    maxTokens: config.memoryMaintenanceMaxTokens,
    agentOptions: maintenanceAgentOptions,
    isEligible: eligible,
    isCurrent: agent => active && ctx.agents.get(String(agent.id)) === agent,
  })
  const maintenanceRecoveryWarnings = new WeakSet()
  const resumeMemoryMaintenance = async (agent, reason) => {
    if (!active || !eligible(agent) || ctx.agents.get(String(agent.id)) !== agent) return false
    try {
      await memoryMaintenance.resume(agent)
      maintenanceRecoveryWarnings.delete(agent)
      return true
    } catch (error) {
      if (!maintenanceRecoveryWarnings.has(agent)) {
        maintenanceRecoveryWarnings.add(agent)
        console.error(`[dsh-sillytavern] failed to resume background memory maintenance during ${reason}; it will retry later`, error)
      }
      return false
    }
  }
  ctx.effect(() => async () => {
    active = false
    await memoryMaintenance.dispose()
  })

  const ensure = async (agent, signal) => {
    if (!eligible(agent)) return undefined
    return store.ensureSession(agent, signal)
  }
  const requestBindings = new WeakMap()
  const modelInfoWarnings = new Set()
  const requestBindingWarnings = new Set()
  const worldbookDiagnostics = new WeakMap()
  const worldbookDiagnosticSequences = new WeakMap()
  const worldbookDiagnosticSuccesses = new WeakMap()
  const maintenanceFallbackWarnings = new WeakSet()
  const sessionView = agent => {
    const view = store.sessionView(agent)
    const diagnostics = worldbookDiagnostics.get(agent)
    return {
      ...view,
      worldbookDiagnostics: diagnostics?.cardId === view.card?.id ? diagnostics : null,
    }
  }
  const service = {
    store,
    eligible,
    ensure,
    async promptFor(agent, signal, route = {}) {
      const diagnosticGeneration = (worldbookDiagnosticSequences.get(agent) ?? 0) + 1
      worldbookDiagnosticSequences.set(agent, diagnosticGeneration)
      await ensure(agent, signal)
      await resumeMemoryMaintenance(agent, 'prompt assembly')
      const hasPersistedUserMessage = sessionEvents(agent.session).some(event => event.type === 'user/message')
      const pending = pendingOpenings.get(String(agent.session.id))
      const hasPendingFirstUser = pending !== undefined && pending.agent === agent && pending.session === agent.session
      if (hasPersistedUserMessage || hasPendingFirstUser) {
        await store.ensureSelectedSession(agent, signal)
        await store.startSession(agent, signal)
        if (hasPendingFirstUser) flushPendingOpening(agent)
      }
      const provider = typeof route.provider === 'string' ? route.provider : ''
      const model = typeof route.model === 'string' ? route.model : ''
      let contextWindow
      if (provider !== '' && model !== '') {
        try {
          const modelInfo = await ctx.llm.resolveModelInfo(provider, model, signal)
          contextWindow = modelInfo.context?.contextWindow
        } catch (error) {
          const key = `${provider}/${model}`
          if (!modelInfoWarnings.has(key)) {
            modelInfoWarnings.add(key)
            console.warn(`[dsh-sillytavern] could not resolve context window for ${key}; using fallback world-info budget: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      const compactedSeqs = compactedEventSeqs(agent)
      let pendingMemoryFallback = []
      try {
        pendingMemoryFallback = await memoryMaintenance.pendingFallback(agent, compactedSeqs)
      } catch (error) {
        if (!maintenanceFallbackWarnings.has(agent)) {
          maintenanceFallbackWarnings.add(agent)
          console.warn(`[dsh-sillytavern] could not read memory maintenance fallback; story generation will continue: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const prompt = await assembleSillyTavernPrompt(agent, store.promptState(agent), signal, {
        compactedSeqs,
        pendingMemoryFallback,
        contextWindow,
        budgetPercent: config.worldInfoBudgetPercent ?? 25,
        budgetCap: config.worldInfoBudgetCap ?? 0,
        fallbackTokenBudget: config.worldInfoFallbackTokenBudget ?? 2048,
        countTokens: text => countModelTokens(provider, model, text, signal),
      })
      if (diagnosticGeneration > (worldbookDiagnosticSuccesses.get(agent) ?? 0)) {
        const budget = prompt.worldbookBudget ?? {}
        worldbookDiagnosticSuccesses.set(agent, diagnosticGeneration)
        worldbookDiagnostics.set(agent, {
          revision: diagnosticGeneration,
          cardId: store.sessionView(agent).card?.id ?? null,
          generatedAt: new Date().toISOString(),
          warnings: (Array.isArray(prompt.worldbookWarnings) ? prompt.worldbookWarnings : []).slice(0, 64).map(value => String(value).slice(0, 1024)),
          activeEntryIds: (Array.isArray(prompt.activeWorldbookEntries) ? prompt.activeWorldbookEntries : []).slice(0, 256).map(value => String(value).slice(0, 256)),
          budget: {
            tokens: Number.isSafeInteger(budget.tokens) ? budget.tokens : 0,
            usedTokens: Number.isSafeInteger(budget.usedTokens) ? budget.usedTokens : 0,
            overflowed: budget.overflowed === true,
          },
        })
      }
      return prompt
    },
    bindPromptToRequest(agent, prompt, route = {}) {
      if (!Array.isArray(prompt.worldbookDepthEntries) || prompt.worldbookDepthEntries.length === 0) return prompt.system
      const id = randomUUID()
      let bindings = requestBindings.get(agent)
      if (bindings === undefined) {
        bindings = new Map()
        requestBindings.set(agent, bindings)
      }
      bindings.set(id, {
        prompt,
        provider: typeof route.provider === 'string' ? route.provider : '',
        model: typeof route.model === 'string' ? route.model : '',
      })
      while (bindings.size > MAX_REQUEST_BINDINGS_PER_AGENT) bindings.delete(bindings.keys().next().value)
      return `${prompt.system}\n\n<!-- dsh-sillytavern-request:${id} -->`
    },
    sessionView,
    flushOpening(agent) { return flushPendingOpening(agent) },
    memory(agent, operation, signal) {
      if (!eligible(agent)) throw new Error('memory queries are unavailable outside a SillyTavern parent Agent')
      return store.memory(agent, operation, signal)
    },
    memoryGraph(agent, request, signal) {
      if (!eligible(agent)) throw new Error('memory graph queries are unavailable outside a SillyTavern parent Agent')
      return store.memoryGraph(agent, request, signal)
    },
    async consolidateMemory(agent, signal) {
      if (!eligible(agent)) throw new Error('memory consolidation is unavailable outside a SillyTavern parent Agent')
      signal?.throwIfAborted()
      await ensure(agent, signal)
      return memoryMaintenance.enqueuePeriodic(agent, { signal })
    },
    transformUserMessages(agent, messages) {
      return transformRawUserMessages(messages, store.promptState(agent), sessionMessages(agent))
    },
    saveRegexSources(agent, patch, signal) { return store.saveRegexSources(patch, signal, agent) },
    runRegex(agent, name, input) {
      const state = store.promptState(agent)
      const entry = store.findRegex(agent, name)
      if (state === undefined || entry === undefined || entry.script.enabled !== true) throw new Error(`enabled Regex script "${String(name)}" was not found`)
      return runRegexScript(entry.script, String(input ?? ''), { scope: regexScopeForState(state, sessionMessages(agent)) })
    },
    runNarratorRegex(agent, input) {
      const state = store.promptState(agent)
      if (state === undefined) return String(input ?? '')
      const result = getRegexedString(String(input ?? ''), REGEX_PLACEMENT.SLASH_COMMAND, regexRulesForState(state), { scope: regexScopeForState(state, sessionMessages(agent)) })
      if (result.errors.length > 0) console.warn('[dsh-sillytavern] Regex errors during narrator command', result.errors)
      return result.text
    },
    regexState(agent, name) {
      const entry = store.findRegex(agent, name)
      if (entry === undefined) throw new Error(`Regex script "${String(name)}" was not found`)
      return entry.script.enabled === true
    },
    toggleRegex(agent, name, requested, signal) { return store.toggleRegex(agent, name, requested, signal) },
  }
  ctx.provide('sillyTavern', service)

  // Agent-loop requests are immutable and reconstructable. To provide the
  // SillyTavern promptOnly view without changing the durable log, re-dispatch
  // one owned hand-built request through the public LLM service. The WeakSet
  // makes the nested dispatch single-pass; raw output rules are applied to the
  // returned stream before agent-loop persists its assistant blocks.
  const regexRequests = new WeakSet()
  ctx.on('llm/stream', (options, next) => {
    const agent = ctx.agents.currentInitiator()
    if (agent === undefined || !eligible(agent)) return next()
    const state = store.promptState(agent)
    if (state === undefined) return next()
    const history = sessionMessages(agent)
    if (regexRequests.has(options)) return transformRawAssistantStream(next(), state, history)
    const marker = stripRequestBinding(options.system)
    let depthProjected = marker.system === options.system ? options : { ...options, system: marker.system }
    if (marker.id !== undefined) {
      const prepared = requestBindings.get(agent)?.get(marker.id)
      if (prepared === undefined) {
        if (!requestBindingWarnings.has(marker.id)) {
          requestBindingWarnings.add(marker.id)
          console.warn(`[dsh-sillytavern] request-bound world-info projection ${marker.id} was not found; @depth entries were skipped`)
        }
      } else if (prepared.provider !== options.provider || prepared.model !== options.model) {
        if (!requestBindingWarnings.has(marker.id)) {
          requestBindingWarnings.add(marker.id)
          console.warn(`[dsh-sillytavern] request route changed from ${prepared.provider}/${prepared.model} to ${options.provider}/${options.model}; @depth entries were skipped`)
        }
      } else {
        depthProjected = injectWorldbookDepthMessages(depthProjected, prepared.prompt.worldbookDepthEntries, randomUUID)
      }
    }
    const projected = promptRegexRequest(depthProjected, state)
    if (projected !== options) {
      regexRequests.add(projected)
      return ctx.llm.stream(projected)
    }
    return transformRawAssistantStream(next(), state, history)
  }, { prepend: true })

  const agentFor = async (sessionId, refresh = true) => {
    const agent = ctx.agents.get(String(sessionId))
    if (agent === undefined) throw new Error('session has no live Agent')
    if (!eligible(agent)) throw new Error('session is not using the sillytavern Agent preset')
    if (refresh || store.sessionSync(agent) === undefined) await ensure(agent)
    if (ctx.agents.get(String(sessionId)) !== agent) {
      store.disposeSession(agent)
      throw new Error('session has no live Agent')
    }
    return agent
  }

  const greetingFor = async (sessionId, swipeId) => {
    const id = String(sessionId)
    const agent = ctx.agents.get(id)
    if (agent === undefined) throw new Error('session has no live Agent')
    if (!eligible(agent)) throw new Error('session is not using the sillytavern Agent preset')
    await store.ensureSession(agent)
    const state = await store.greetingState(agent)
    if (ctx.agents.get(id) !== agent) {
      store.disposeSession(agent)
      throw new Error('session has no live Agent')
    }
    const selectedSwipeId = swipeId ?? Number(state?.binding?.openingSwipeId ?? 0)
    return initialGreetingView(state, selectedSwipeId)
  }

  const openingSelections = new Map()
  const pendingOpenings = new Map()
  const selectedOpening = agent => {
    const state = store.promptState(agent)
    if (state === undefined) return null
    return initialGreetingView(state, Number(state.binding.openingSwipeId ?? 0))
  }
  const openingRuns = session => sessionEvents(session).filter(event => event.type === 'command/run' && event.data?.name === 'st-opening')
  const completedOpeningIds = session => new Set(sessionEvents(session).filter(event => event.type === 'command/done').map(event => event.data?.commandId))
  const appendOpeningLifecycle = agent => {
    const session = agent.session
    const runs = openingRuns(session)
    const completed = completedOpeningIds(session)
    const matched = runs.filter(event => completed.has(event.data.commandId))
    const orphans = runs.filter(event => !completed.has(event.data.commandId))
    if (matched.length > 0) {
      for (const orphan of orphans) {
        session.append('command/done', {
          commandId: orphan.data.commandId,
          kind: 'error',
          text: 'superseded duplicate opening',
        })
      }
      return true
    }
    const opening = selectedOpening(agent)
    if (opening === null) return false
    const primary = orphans[0]
    const commandId = primary?.data.commandId ?? `st-opening-${randomUUID()}`
    if (primary === undefined) {
      session.append('command/run', {
        commandId,
        name: 'st-opening',
        source: { kind: 'user' },
      })
    }
    session.append('command/done', {
      commandId,
      kind: 'success',
      text: opening.text,
    })
    for (const orphan of orphans.slice(1)) {
      session.append('command/done', {
        commandId: orphan.data.commandId,
        kind: 'error',
        text: 'superseded duplicate opening',
      })
    }
    return true
  }
  const repairOpeningOrphan = agent => {
    if (!active || !eligible(agent) || ctx.agents.get(String(agent.session.id)) !== agent) return
    const completed = completedOpeningIds(agent.session)
    if (!openingRuns(agent.session).some(event => !completed.has(event.data.commandId))) return
    appendOpeningLifecycle(agent)
  }
  const hasConversationMessages = session => sessionEvents(session).some(event => event.type === 'user/message' || event.type === 'assistant/message')
  const pendingOpeningIsCurrent = pending => active
    && eligible(pending.agent)
    && ctx.agents.get(String(pending.session.id)) === pending.agent
    && pending.agent.session === pending.session
  const attemptPendingOpening = pending => {
    const id = String(pending.session.id)
    if (pendingOpenings.get(id) !== pending || pending.preparing) return
    if (!pendingOpeningIsCurrent(pending) || hasConversationMessages(pending.session)) {
      pendingOpenings.delete(id)
      return
    }
    if (store.sessionView(pending.agent).binding?.startedAt) {
      appendOpeningLifecycle(pending.agent)
      pendingOpenings.delete(id)
      return
    }
    if (pending.attempts >= 2) return
    pending.attempts += 1
    pending.preparing = true
    try {
      const maintenance = pending.agent.runMaintenance(async signal => {
        try {
          await store.ensureSelectedSession(pending.agent, signal)
          await store.startSession(pending.agent, signal)
          if (!pendingOpeningIsCurrent(pending) || hasConversationMessages(pending.session)) return
          if (appendOpeningLifecycle(pending.agent)) pendingOpenings.delete(id)
        } finally {
          pending.preparing = false
        }
      })
      void maintenance.catch(error => console.error('[dsh-sillytavern] failed to prepare opening greeting', error))
    } catch (error) {
      pending.preparing = false
      console.error('[dsh-sillytavern] failed to enter opening maintenance; opening remains pending', error)
    }
  }
  function flushPendingOpening(agent) {
    const id = String(agent.session.id)
    const pending = pendingOpenings.get(id)
    if (pending === undefined || pending.agent !== agent || pending.session !== agent.session) return false
    if (!pendingOpeningIsCurrent(pending) || hasConversationMessages(pending.session)) {
      pendingOpenings.delete(id)
      return false
    }
    if (!store.sessionView(agent).binding?.startedAt || store.promptState(agent) === undefined) return false
    const appended = appendOpeningLifecycle(agent)
    if (appended) pendingOpenings.delete(id)
    return appended
  }
  const recordOpeningBeforeFirstUser = ({ agent, message }) => {
    if (!active || message?.source?.kind !== 'user' || !eligible(agent)) return
    const session = agent.session
    const id = String(session.id)
    if (ctx.agents.get(id) !== agent) return
    const selection = openingSelections.get(id)
    if (selection !== undefined && selection.agent === agent && selection.session === session) {
      selection.message ??= message
      return
    }
    if (hasConversationMessages(session)) return
    if (store.sessionView(agent).binding?.startedAt) {
      appendOpeningLifecycle(agent)
      return
    }
    let pending = pendingOpenings.get(id)
    if (pending === undefined || pending.agent !== agent || pending.session !== session) {
      pending = { agent, session, message, preparing: false, attempts: 0 }
      pendingOpenings.set(id, pending)
    }
    attemptPendingOpening(pending)
  }
  const retryOpeningWhenIdle = ({ agent, status }) => {
    if (status !== 'idle') return
    const pending = pendingOpenings.get(String(agent.session.id))
    if (pending !== undefined && pending.agent === agent && pending.session === agent.session) attemptPendingOpening(pending)
    void resumeMemoryMaintenance(agent, 'Agent idle transition')
  }
  const finishPendingOpeningOnClaim = ({ agent, message }) => {
    const id = String(agent.session.id)
    const pending = pendingOpenings.get(id)
    if (pending === undefined || pending.agent !== agent || pending.session !== agent.session || pending.message?.id !== message?.id) return
    flushPendingOpening(agent)
  }
  const discardPendingOpening = ({ agent, message }) => {
    const id = String(agent.session.id)
    const pending = pendingOpenings.get(id)
    if (pending !== undefined && pending.agent === agent && pending.session === agent.session && pending.message?.id === message?.id) pendingOpenings.delete(id)
  }

  const activeWorkspaceSessionIds = agent => {
    const workspacePath = resolve(store.workspaceOf(agent))
    const registry = ctx.get('workspaceRegistry')
    if (registry !== undefined) {
      const workspace = registry.list().find(item => resolve(item.path) === workspacePath)
      const archived = new Set(registry.archivedSessionIds.map(String))
      return new Set((workspace?.sessionIds ?? []).map(String).filter(id => !archived.has(id)))
    }
    return new Set(ctx.agents.list().filter(candidate => resolve(store.workspaceOf(candidate)) === workspacePath).map(candidate => String(candidate.id)))
  }

  const handler = async (req, res) => {
    try {
      assertTrustedLoopbackRequest(req)
      const url = new URL(req.url ?? '/', 'http://dsh.local')
      const route = url.pathname.slice('/api/dsh-sillytavern'.length) || '/'
      if (req.method === 'GET' && route === '/health') {
        sendJson(res, 200, { ok: true, value: { version: VERSION, preset: presetInstall } })
        return
      }
      if (req.method === 'GET' && route === '/library') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        await store.refreshLibrary(agent)
        const view = store.sessionView(agent)
        sendJson(res, 200, { ok: true, value: { cards: store.listCards(agent), worldbooks: store.listWorldbooks(agent), templates: view.templates, globalRegexScripts: view.globalRegexScripts, presetRegexScripts: view.presetRegexScripts, globalVariables: view.globalVariables, ...store.selectionView(agent) } })
        return
      }
      if (req.method === 'GET' && route === '/card') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        const id = url.searchParams.get('id') ?? ''
        const card = /^[a-f0-9]{64}$/.test(id) ? await store.refreshCard(id, undefined, agent) : undefined
        sendJson(res, card === undefined ? 404 : 200, card === undefined ? { ok: false, error: 'card not found' } : { ok: true, value: card })
        return
      }
      if (req.method === 'GET' && route === '/worldbook') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        await store.refreshLibrary(agent)
        const worldbook = store.getWorldbook(url.searchParams.get('id') ?? '', agent)
        sendJson(res, worldbook === undefined ? 404 : 200, worldbook === undefined ? { ok: false, error: 'worldbook not found' } : { ok: true, value: worldbook })
        return
      }
      if (req.method === 'GET' && route === '/event-state') {
        const agent = await agentFor(url.searchParams.get('sessionId'), false)
        const afterValue = Number(url.searchParams.get('after') ?? -1)
        const after = Number.isSafeInteger(afterValue) ? afterValue : -1
        const view = store.sessionView(agent)
        const delta = sessionEventDelta(agent, after)
        const history = delta.history.map(message => ({ ...message, text: message.text.slice(-8192) }))
        sendJson(res, 200, { ok: true, value: { card: view.card === null ? null : { id: view.card.id, name: view.card.card.data.nickname || view.card.card.data.name }, history, cursor: delta.cursor, hasMore: delta.hasMore } })
        return
      }
      if (req.method === 'GET' && route === '/greeting') {
        const swipeParam = url.searchParams.get('swipeId')
        const swipeValue = swipeParam === null ? undefined : Number(swipeParam)
        if (swipeValue !== undefined && (!Number.isSafeInteger(swipeValue) || swipeValue < 0)) throw new TypeError('opening swipeId must be a non-negative safe integer')
        sendJson(res, 200, { ok: true, value: await greetingFor(url.searchParams.get('sessionId'), swipeValue) })
        return
      }
      if (req.method === 'GET' && route === '/session') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        sendJson(res, 200, { ok: true, value: { ...sessionView(agent), history: sessionMessages(agent, 100) } })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 404, { ok: false, error: 'route not found' })
        return
      }
      const body = await readJsonBody(req)
      if (route === '/regex-sources') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.saveRegexSources({ ...(Object.hasOwn(body, 'global') ? { global: body.global } : {}), ...(Object.hasOwn(body, 'preset') ? { preset: body.preset } : {}), ...(Object.hasOwn(body, 'variables') ? { variables: body.variables } : {}) }, undefined, agent) })
        return
      }
      if (route === '/import') {
        const agent = await agentFor(body.sessionId)
        const record = await store.importCard(decodeBase64(body.data), { fileName: body.fileName, mediaType: body.mediaType, worldbookConflict: body.worldbookConflict }, undefined, agent)
        const view = await store.bind(agent, record.id, { replace: body.replace === true, ...(Object.hasOwn(body, 'expectedCardId') ? { expectedCardId: body.expectedCardId } : {}) })
        await store.selectCard(record.id, agent)
        sendJson(res, 200, { ok: true, value: { record, session: view } })
        return
      }
      if (route === '/bind') {
        const agent = await agentFor(body.sessionId)
        const cardId = String(body.cardId)
        const view = await store.bind(agent, cardId, { replace: body.replace === true, ...(Object.hasOwn(body, 'expectedCardId') ? { expectedCardId: body.expectedCardId } : {}) })
        await store.selectCard(cardId, agent)
        sendJson(res, 200, { ok: true, value: { session: view } })
        return
      }
      if (route === '/selection') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.selectCard(body.cardId, agent) })
        return
      }
      if (route === '/opening/select') {
        if (typeof body.swipeId !== 'number' || !Number.isSafeInteger(body.swipeId) || body.swipeId < 0) throw new TypeError('opening swipeId must be a non-negative safe integer')
        const agent = await agentFor(body.sessionId)
        const id = String(agent.session.id)
        const selectionClosed = () => sessionEvents(agent.session).some(event => event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'command/run' && event.data?.name === 'st-opening')
        if (selectionClosed()) throw new Error('opening greeting can only be selected before conversation messages exist')
        if (openingSelections.has(id)) throw new Error('opening greeting selection is already in progress')
        const session = agent.session
        const selection = { agent, session, message: undefined }
        openingSelections.set(id, selection)
        let view
        try {
          view = await agent.runMaintenance(async signal => {
            try {
              if (selectionClosed()) throw new Error('opening greeting can only be selected before conversation messages exist')
              await store.ensureSelectedSession(agent, signal)
              return await store.updateSession(agent, { openingSwipeId: body.swipeId }, signal)
            } finally {
              if (openingSelections.get(id) === selection) openingSelections.delete(id)
              if (selection.message !== undefined && active && ctx.agents.get(id) === agent && selection.agent === agent && selection.session === session && agent.session === session && sessionEvents(session).every(event => event.type !== 'user/message' && event.type !== 'assistant/message')) appendOpeningLifecycle(agent)
            }
          })
        } finally {
          if (openingSelections.get(id) === selection) openingSelections.delete(id)
        }
        sendJson(res, 200, { ok: true, value: { swipeId: view.binding.openingSwipeId } })
        return
      }
      if (route === '/session/update') {
        const patch = body.patch ?? {}
        if (Object.hasOwn(patch, 'openingSwipeId')) throw new Error('openingSwipeId must be changed through /opening/select')
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.updateSession(agent, patch) })
        return
      }
      if (route === '/memory') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.memory(agent, body.operation ?? {}) })
        return
      }
      if (route === '/worldbook/create') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.createWorldbook(body.book ?? { name: body.name, entries: [], extensions: {} }, { name: body.name, context: agent }) })
        return
      }
      if (route === '/worldbook/update') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.updateWorldbook(String(body.worldbookId), body.patch ?? {}, { context: agent }) })
        return
      }
      if (route === '/worldbook/delete') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.deleteWorldbook(String(body.worldbookId), { context: agent, rejectIfReferenced: body.confirm !== true }) })
        return
      }
      if (route === '/card/update') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.updateCard(String(body.cardId), body.patch ?? {}, undefined, agent) })
        return
      }
      if (route === '/card/delete') {
        const agent = await agentFor(body.sessionId)
        const cardId = String(body.cardId)
        const references = await store.inspectCardReferences(cardId, agent)
        const activeIds = activeWorkspaceSessionIds(agent)
        const activeSessions = references.sessions.filter(reference => {
          if (!activeIds.has(String(reference.sessionId))) return false
          if (reference.startedAt !== null) return true
          return sessionEvents(ctx.agents.get(String(reference.sessionId))?.session).some(event => event.type === 'user/message')
        })
        if (activeSessions.length > 0) {
          const error = new Error('card is referenced by active sessions')
          error.code = 'card-active-sessions'
          error.details = { activeSessions }
          throw error
        }
        const result = await store.deleteCard(cardId, { context: agent, deleteWorldbook: body.deleteWorldbook === true, confirmWorldbookDelete: body.confirmWorldbookDelete === true })
        sendJson(res, 200, { ok: true, value: { ...result, worldbookDeleted: result.deletedWorldbook?.deleted === true } })
        return
      }
      if (route === '/template/save') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.saveTemplate(body.template ?? {}, undefined, agent) })
        return
      }
      if (route === '/template/delete') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: { deleted: await store.deleteTemplate(String(body.id), undefined, agent) } })
        return
      }
      sendJson(res, 404, { ok: false, error: 'route not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = typeof error?.code === 'string' ? error.code : undefined
      const status = ['replace-confirmation-required', 'binding-changed', 'session-started', 'worldbook-name-conflict', 'worldbook-references-required', 'card-active-sessions', 'card-references-required'].includes(code) ? 409
        : /untrusted API request/.test(message) ? 403
        : /not found|no live Agent/.test(message) ? 404
        : /not using/.test(message) ? 403
        : 400
      sendJson(res, status, { ok: false, error: message, ...(code === undefined ? {} : { code }), ...(error?.details === undefined ? {} : { details: error.details }) })
    }
  }

  const webServer = ctx.get('webServer')
  if (webServer !== undefined) ctx.effect(() => webServer.register({ kind: 'prefix', path: '/api/dsh-sillytavern', handler }))
  const ensureAndRepair = async agent => {
    if (!eligible(agent)) return
    await ensure(agent)
    if (sessionEvents(agent.session).some(event => event.type === 'user/message')) {
      await store.ensureSelectedSession(agent)
      await store.startSession(agent)
    }
    repairOpeningOrphan(agent)
    await resumeMemoryMaintenance(agent, 'Agent recovery')
  }
  const recoverAgent = async (agent, reason) => {
    try {
      await ensureAndRepair(agent)
    } catch (error) {
      console.error(`[dsh-sillytavern] failed to recover SillyTavern Agent during ${reason}; it will retry later`, error)
    }
  }
  await Promise.all(ctx.agents.list().map(agent => recoverAgent(agent, 'plugin startup')))
  const maintenanceEventTails = new WeakMap()
  ctx.on('session/event', (session, event) => {
    if (!active || event.type !== 'turn/end' || event.data?.reason?.kind !== 'completed') return
    const agent = ctx.agents.get(String(session.id))
    if (agent === undefined || agent.session !== session || !eligible(agent)) return
    const previous = maintenanceEventTails.get(session) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      try {
        if (!await ctx.sessions.flush(session)) throw new Error('no session durability listener participated in the final-body flush')
        if (!active || ctx.agents.get(String(session.id)) !== agent || agent.session !== session || !eligible(agent)) return
        const job = createMemoryMaintenanceJob(agent, event)
        if (job !== null) await memoryMaintenance.enqueueCompletedTurn(agent, job)
      } catch (error) {
        console.error('[dsh-sillytavern] failed to durably enqueue background memory maintenance job', error)
      }
    }).finally(() => {
      if (maintenanceEventTails.get(session) === current) maintenanceEventTails.delete(session)
    })
    maintenanceEventTails.set(session, current)
    void current
  })
  ctx.on('agent/inbox/inserted', recordOpeningBeforeFirstUser)
  ctx.on('agent/inbox/claimed', finishPendingOpeningOnClaim)
  ctx.on('agent/inbox/discarded', discardPendingOpening)
  ctx.on('agent/status', retryOpeningWhenIdle)
  ctx.on('agent/created', ({ agent }) => recoverAgent(agent, 'Agent creation'))
  ctx.on('agent-preset/selected', sessionId => {
    const agent = ctx.agents.get(sessionId)
    if (agent !== undefined) return recoverAgent(agent, 'preset selection')
  })
  ctx.on('agent/disposed', ({ agent }) => {
    openingSelections.delete(String(agent.session.id))
    pendingOpenings.delete(String(agent.session.id))
    memoryMaintenance.stopAgent(agent)
    store.disposeSession(agent)
  })
}
