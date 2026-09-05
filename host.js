import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { assertTrustedLoopbackRequest, decodeBase64, readJsonBody, sendJson } from './src/http.js'
import { assembleSillyTavernPrompt, compactedEventSeqs, initialGreetingView, injectWorldbookDepthMessages, sessionEventDelta, sessionEvents, sessionMessages } from './src/prompt.js'
import { createEventMaintenanceJob, EventMaintenanceManager } from './src/event-maintenance.js'
import { SillyTavernStore } from './src/store.js'
import { installBundledPreset } from './src/preset-installer.js'
import { promptRegexRequest, transformRawAssistantStream, transformRawUserMessages } from './src/regex-pipeline.js'
import { getRegexedString, REGEX_PLACEMENT, regexRulesForState, runRegexScript, regexScopeForState } from './src/regex.js'
import { countModelTokens } from './src/tokenizer.js'
import { buildCompatibilitySnapshot, compatibilityManifest } from './src/compatibility.js'
import { execute as executeCompatSlash, registry as compatSlashRegistry } from './src/compat-slash.js'
import { CompatibilityGenerationBroker } from './src/compat-generation.js'

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

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}

function projectCompatibilityChat(options, agent, projection) {
  if (!Array.isArray(options?.messages) || !Array.isArray(projection?.messages)) return options
  const idBySeq = new Map()
  for (const event of sessionEvents(agent.session)) {
    const message = event?.type === 'user/message' ? event.data : event?.type === 'assistant/message' ? event.data?.message : null
    if (message && typeof message.id === 'string') idBySeq.set(event.seq, message.id)
  }
  const overlayById = new Map()
  const syntheticBefore = new Map()
  const syntheticAfter = []
  let pendingSynthetic = []
  for (const item of projection.messages) {
    const id = idBySeq.get(item.sourceSeq)
    if (id === undefined) pendingSynthetic.push(item)
    else {
      overlayById.set(id, item)
      if (pendingSynthetic.length > 0) syntheticBefore.set(id, pendingSynthetic.splice(0))
    }
  }
  syntheticAfter.push(...pendingSynthetic)
  const asMessage = item => ({
    id: `dsh-sillytavern-compat-${item.uid ?? randomUUID()}`,
    role: item.role,
    content: [{ type: 'text', text: String(item.message ?? '') }],
    source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'compatibility-message' },
  })
  const messages = options.messages.flatMap(message => {
    const overlay = overlayById.get(message?.id)
    if (overlay === undefined) return [message]
    const before = (syntheticBefore.get(message.id) ?? []).filter(item => item.is_hidden !== true).map(asMessage)
    if (overlay.is_hidden === true) return before
    return [...before, { ...message, role: overlay.role, content: [{ type: 'text', text: String(overlay.message ?? '') }] }]
  })
  const existingText = new Set(messages.map(message => `${message.role}\u0000${contentText(message.content)}`))
  for (const item of syntheticAfter) {
    if (item.is_hidden === true) continue
    const key = `${item.role}\u0000${String(item.message ?? '')}`
    if (existingText.has(key)) continue
    messages.push(asMessage(item))
  }
  return { ...options, messages }
}

export async function apply(ctx, config = {}) {
  const presetInstall = config.autoInstallPreset === false
    ? { status: 'disabled', presetId: 'sillytavern', version: VERSION }
    : await installBundledPreset(ctx.agentPresets, { version: VERSION })
  const store = new SillyTavernStore(config)
  await store.ready
  const generationBroker = new CompatibilityGenerationBroker(options => ctx.llm.stream(options), {
    maxResults: config.compatibilityGenerationResults ?? 100,
    ttlMs: config.compatibilityGenerationTtlMs ?? 5 * 60 * 1000,
  })
  let active = true

  const eligible = agent => agent?.session?.header?.origin !== 'subagent'
    && ctx.agentPresets.composedPreset(agent.ctx) === 'sillytavern'
  const maintenanceAgentOptions = {}
  if (typeof config.eventMaintenanceProvider === 'string' && config.eventMaintenanceProvider !== '') maintenanceAgentOptions.provider = config.eventMaintenanceProvider
  if (typeof config.eventMaintenanceModel === 'string' && config.eventMaintenanceModel !== '') maintenanceAgentOptions.model = config.eventMaintenanceModel
  if (typeof config.eventMaintenanceReasoningEffort === 'string' && config.eventMaintenanceReasoningEffort !== '') maintenanceAgentOptions.reasoningEffort = config.eventMaintenanceReasoningEffort
  const eventMaintenance = new EventMaintenanceManager({
    store,
    subagents: ctx.subagents,
    provider: typeof config.eventMaintenanceSubagentProvider === 'string' && config.eventMaintenanceSubagentProvider !== '' ? config.eventMaintenanceSubagentProvider : 'spawn',
    maxAttempts: config.eventMaintenanceMaxAttempts,
    maxConcurrency: config.eventMaintenanceMaxConcurrency,
    maxTokens: config.eventMaintenanceMaxTokens,
    agentOptions: maintenanceAgentOptions,
    isEligible: eligible,
    isCurrent: agent => active && ctx.agents.get(String(agent.id)) === agent,
  })
  const maintenanceRecoveryWarnings = new WeakSet()
  const resumeEventMaintenance = async (agent, reason) => {
    if (!active || !eligible(agent) || ctx.agents.get(String(agent.id)) !== agent) return false
    try {
      await eventMaintenance.resume(agent)
      maintenanceRecoveryWarnings.delete(agent)
      return true
    } catch (error) {
      if (!maintenanceRecoveryWarnings.has(agent)) {
        maintenanceRecoveryWarnings.add(agent)
        console.error(`[dsh-sillytavern] failed to resume background event maintenance during ${reason}; it will retry later`, error)
      }
      return false
    }
  }
  ctx.effect(() => async () => {
    active = false
    generationBroker.stopAll()
    await eventMaintenance.dispose()
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
      await resumeEventMaintenance(agent, 'prompt assembly')
      const hasPersistedUserMessage = sessionEvents(agent.session).some(event => event.type === 'user/message')
      const pending = pendingOpenings.get(String(agent.session.id))
      const hasPendingFirstUser = pending !== undefined && pending.agent === agent && pending.session === agent.session
      if (hasPersistedUserMessage || hasPendingFirstUser) {
        await store.ensureSelectedSession(agent, signal)
        await store.startSession(agent, signal)
        if (hasPendingFirstUser) flushPendingOpening(agent)
      }
      await store.refreshCompatChat(agent, signal)
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
      let pendingEventFallback = []
      try {
        pendingEventFallback = await eventMaintenance.pendingFallback(agent, compactedSeqs)
      } catch (error) {
        if (!maintenanceFallbackWarnings.has(agent)) {
          maintenanceFallbackWarnings.add(agent)
          console.warn(`[dsh-sillytavern] could not read event maintenance fallback; story generation will continue: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const promptState = store.promptState(agent)
      const lorebookSettings = promptState?.lorebookSettings ?? {}
      const eligibleInjectionIds = new Set(Array.isArray(route.eligibleInjectionIds) ? route.eligibleInjectionIds.map(String) : [])
      const injections = (promptState?.binding?.scriptInjections ?? []).filter(item => item.hasFilter !== true || eligibleInjectionIds.has(String(item.id)))
      const prompt = await assembleSillyTavernPrompt(agent, promptState, signal, {
        compactedSeqs,
        pendingEventFallback,
        contextWindow,
        budgetPercent: lorebookSettings.context_percentage ?? config.worldInfoBudgetPercent ?? 25,
        budgetCap: lorebookSettings.budget_cap ?? config.worldInfoBudgetCap ?? 0,
        scanDepth: lorebookSettings.scan_depth,
        fallbackTokenBudget: config.worldInfoFallbackTokenBudget ?? 2048,
        injections,
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
    event(agent, operation, signal) {
      if (!eligible(agent)) throw new Error('event queries are unavailable outside a SillyTavern parent Agent')
      return store.event(agent, operation, signal)
    },
    eventGraph(agent, request, signal) {
      if (!eligible(agent)) throw new Error('event graph queries are unavailable outside a SillyTavern parent Agent')
      return store.eventGraph(agent, request, signal)
    },
    async consolidateEvent(agent, signal) {
      if (!eligible(agent)) throw new Error('event consolidation is unavailable outside a SillyTavern parent Agent')
      signal?.throwIfAborted()
      await ensure(agent, signal)
      return eventMaintenance.enqueuePeriodic(agent, { signal })
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
    depthProjected = projectCompatibilityChat(depthProjected, agent, store.compatChatProjection(agent))
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
    void resumeEventMaintenance(agent, 'Agent idle transition')
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

  const slashText = invocation => invocation.args.length > 0 ? invocation.args.join(' ') : String(invocation.pipe ?? '')
  const triggerSlash = async (agent, source, signal) => {
    const addMessage = async (role, invocation, isHidden = false) => {
      const current = await store.refreshCompatChat(agent, signal)
      await store.mutateCompatChat(agent, {
        action: 'create',
        expectedRevision: current.revision,
        messages: [{ role, message: slashText(invocation), is_hidden: isHidden }],
      }, signal)
      return slashText(invocation)
    }
    const handlers = {
      send: invocation => addMessage('user', invocation),
      sendas: invocation => addMessage('assistant', invocation),
      sys: invocation => addMessage('system', invocation),
      comment: invocation => addMessage('system', invocation, true),
      trigger: async invocation => { await agent.followup?.(slashText(invocation) || 'Continue'); return '' },
      continue: async invocation => { await agent.followup?.(slashText(invocation) || 'Continue'); return '' },
      regenerate: async invocation => { await agent.followup?.(slashText(invocation) || 'Regenerate the last response.'); return '' },
      setvar: async invocation => {
        const key = String(invocation.named.key ?? invocation.args[0] ?? '')
        if (key === '') throw new TypeError('/setvar requires key=<name> or a first argument')
        const value = invocation.named.value ?? invocation.args.slice(1).join(' ') ?? invocation.pipe
        const current = store.compatibilityVariableSnapshot(agent)
        await store.replaceCompatibilityVariables(agent, { type: 'chat' }, { ...current.scopes.chat, [key]: value }, { expectedRevision: current.revisions.chat }, signal)
        return String(value ?? '')
      },
      getvar: invocation => {
        const key = String(invocation.named.key ?? invocation.args[0] ?? '')
        return String(store.compatibilityVariableSnapshot(agent).scopes.chat[key] ?? '')
      },
      inject: async invocation => {
        const view = store.sessionView(agent)
        const id = String(invocation.named.id ?? `slash-${randomUUID()}`)
        const injections = [...(view.binding?.scriptInjections ?? []).filter(item => item.id !== id), { id, content: slashText(invocation), text: slashText(invocation), position: 'in_chat', depth: Number(invocation.named.depth ?? 0), role: invocation.named.role ?? 'system', should_scan: invocation.named.scan === 'true' }]
        await store.updateSession(agent, { scriptInjections: injections, expectedRevision: view.binding.revision }, signal)
        return id
      },
      flushinject: async () => {
        const view = store.sessionView(agent)
        await store.updateSession(agent, { scriptInjections: [], expectedRevision: view.binding.revision }, signal)
        return ''
      },
      messages: () => JSON.stringify(store.compatChatProjection(agent).messages),
      run: async invocation => {
        const commands = ctx.get('commands')
        if (typeof commands?.execute !== 'function') throw new Error('DSH command service is unavailable')
        const result = await commands.execute(agent, slashText(invocation), [], signal)
        return typeof result === 'string' ? result : JSON.stringify(result ?? '')
      },
    }
    return executeCompatSlash(String(source ?? ''), { registry: compatSlashRegistry(handlers), context: { agent, store }, signal })
  }

  const compatibilityGenerationOptions = async (agent, mode, generationConfig, signal) => {
    const request = generationConfig && typeof generationConfig === 'object' && !Array.isArray(generationConfig) ? generationConfig : {}
    const custom = request.custom_api && typeof request.custom_api === 'object' ? request.custom_api : {}
    if (typeof custom.apiurl === 'string' && custom.apiurl.trim() !== '') {
      const error = new Error('custom_api.apiurl is unavailable in DSH compatibility mode; configure a DSH provider and select it by source/model')
      error.code = 'generation-custom-api-unavailable'
      throw error
    }
    await store.refreshCompatChat(agent, signal)
    const state = store.promptState(agent)
    if (state === undefined) throw new Error('current session has no selected character')
    const provider = String(custom.source ?? agent.options?.provider ?? '').trim()
    const model = String(custom.model ?? agent.options?.model ?? '').trim()
    if (provider === '' || model === '') throw new Error('generation requires a configured provider and model')
    const prepared = await service.promptFor(agent, signal, { provider, model, eligibleInjectionIds: request.__dshEligibleInjectionIds })
    const historyLimit = request.max_chat_history === 'all' || request.max_chat_history === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Math.trunc(Number(request.max_chat_history) || 0))
    const history = store.compatChatProjection(agent).messages.filter(item => item.is_hidden !== true).slice(-historyLimit).map(item => ({
      id: `dsh-sillytavern-generate-${item.uid ?? item.message_id}`,
      role: item.role,
      content: [{ type: 'text', text: String(item.message ?? '') }],
      source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'compatibility-generation-history' },
    }))
    const userInput = String(request.user_input ?? '')
    const imageValues = Array.isArray(request.image) ? request.image : request.image === undefined ? [] : [request.image]
    const userBlocks = [...(userInput === '' ? [] : [{ type: 'text', text: userInput }]), ...imageValues.filter(value => typeof value === 'string').map(value => ({ type: 'image', url: value }))]
    const card = state.record.card.data
    const persona = state.binding.userPersona
    const named = {
      world_info_before: request.overrides?.world_info_before,
      persona_description: request.overrides?.persona_description ?? persona.description,
      char_description: request.overrides?.char_description ?? card.description,
      char_personality: request.overrides?.char_personality ?? card.personality,
      scenario: request.overrides?.scenario ?? card.scenario,
      world_info_after: request.overrides?.world_info_after,
      dialogue_examples: request.overrides?.dialogue_examples ?? card.mes_example,
    }
    let messages = history
    let system = prepared.system
    if (mode === 'raw' && Array.isArray(request.ordered_prompts)) {
      messages = []
      const systemParts = []
      for (const item of request.ordered_prompts) {
        if (typeof item === 'string') {
          if (item === 'chat_history') messages.push(...(request.overrides?.chat_history?.prompts ?? history).map((entry, index) => entry?.content ? { id: `raw-history-${index}`, role: entry.role, content: [{ type: 'text', text: String(entry.content) }], source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'raw-history' } } : entry))
          else if (item === 'user_input' && userBlocks.length > 0) messages.push({ id: `raw-user-${randomUUID()}`, role: 'user', content: userBlocks, source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'raw-user-input' } })
          else if (named[item] !== undefined && String(named[item]).trim() !== '') systemParts.push(String(named[item]))
        } else if (item && typeof item === 'object' && ['system', 'assistant', 'user'].includes(item.role)) messages.push({ id: `raw-role-${randomUUID()}`, role: item.role, content: [{ type: 'text', text: String(item.content ?? '') }], source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'raw-role-prompt' } })
      }
      system = systemParts.join('\n\n')
    } else if (userBlocks.length > 0) messages.push({ id: `generate-user-${randomUUID()}`, role: 'user', content: userBlocks, source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'generation-user-input' } })
    messages = injectWorldbookDepthMessages({ messages }, prepared.worldbookDepthEntries, randomUUID).messages
    const result = { provider, model, system, messages }
    if (request.tools !== undefined) result.tools = request.tools
    if (request.tool_choice !== undefined) result.toolChoice = request.tool_choice
    if (request.json_schema !== undefined) result.jsonSchema = request.json_schema
    for (const [from, to] of [['temperature', 'temperature'], ['top_p', 'topP'], ['top_k', 'topK'], ['frequency_penalty', 'frequencyPenalty'], ['presence_penalty', 'presencePenalty']]) {
      const value = custom[from]
      if (typeof value === 'number' && Number.isFinite(value)) result[to] = value
    }
    if (typeof custom.max_tokens === 'number' && Number.isFinite(custom.max_tokens)) result.maxTokens = Math.max(1, Math.trunc(custom.max_tokens))
    return result
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
      if (req.method === 'GET' && route === '/compatibility') {
        sendJson(res, 200, { ok: true, value: compatibilityManifest() })
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
        await store.refreshCompatChat(agent)
        const afterValue = Number(url.searchParams.get('after') ?? -1)
        const after = Number.isSafeInteger(afterValue) ? afterValue : -1
        const view = store.sessionView(agent)
        const delta = sessionEventDelta(agent, after)
        const projected = store.compatChatProjection(agent).messages
        const history = after < 0
          ? projected.map(message => ({ role: message.role, text: message.message.slice(-8192), seq: message.sourceSeq ?? message.message_id, message_id: message.message_id }))
          : delta.history.map(message => ({ ...message, text: message.text.slice(-8192) }))
        sendJson(res, 200, { ok: true, value: { card: view.card === null ? null : { id: view.card.id, name: view.card.card.data.nickname || view.card.card.data.name }, history, messages: projected, cursor: delta.cursor, hasMore: delta.hasMore, compatChatRevision: store.compatChatProjection(agent).revision } })
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
        await store.refreshCompatChat(agent)
        sendJson(res, 200, { ok: true, value: { ...sessionView(agent), history: sessionMessages(agent, 100) } })
        return
      }
      if (req.method === 'GET' && route === '/events') {
        const agent = await agentFor(url.searchParams.get('sessionId'), false)
        const document = await store.eventSnapshot(agent)
        const unchanged = url.searchParams.get('revision') === String(document.revision)
        sendJson(res, 200, { ok: true, value: {
          sessionId: String(agent.id),
          revision: document.revision,
          unchanged,
          ...(unchanged ? {} : { document }),
        } })
        return
      }
      if (req.method === 'GET' && route === '/compat/runtime') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        await store.refreshCompatChat(agent)
        const fallback = await store.greetingState(agent)
        sendJson(res, 200, { ok: true, value: buildCompatibilitySnapshot({ sessionId: agent.id, view: sessionView(agent), fallback, messages: sessionMessages(agent, 100) }) })
        return
      }
      if (req.method === 'GET' && route === '/compat/variables') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        sendJson(res, 200, { ok: true, value: store.compatibilityVariableSnapshot(agent, {
          scriptId: url.searchParams.get('scriptId') ?? undefined,
          extensionId: url.searchParams.get('extensionId') ?? undefined,
        }) })
        return
      }
      if (req.method === 'GET' && route === '/compat/chat') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        sendJson(res, 200, { ok: true, value: await store.refreshCompatChat(agent) })
        return
      }
      if (req.method === 'GET' && route === '/compat/generation') {
        const agent = await agentFor(url.searchParams.get('sessionId'), false)
        const generation = generationBroker.get(url.searchParams.get('generationId'))
        if (generation !== null && generation.sessionId !== String(agent.id)) throw new Error('generation belongs to another session')
        sendJson(res, generation === null ? 404 : 200, generation === null ? { ok: false, error: 'generation not found' } : { ok: true, value: generation })
        return
      }
      if (req.method === 'GET' && route === '/compat/models') {
        const agent = await agentFor(url.searchParams.get('sessionId'), false)
        const provider = String(url.searchParams.get('provider') ?? agent.options?.provider ?? '')
        const models = typeof ctx.llm.listModels === 'function' ? await ctx.llm.listModels(provider) : []
        sendJson(res, 200, { ok: true, value: Array.isArray(models) ? models.map(item => String(item?.id ?? item?.name ?? item)) : [] })
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
              const nextView = await store.updateSession(agent, { openingSwipeId: body.swipeId }, signal)
              await store.refreshCompatChat(agent, signal)
              const compatChat = store.compatChatProjection(agent)
              if (compatChat.messages[0]?.extra?.dsh_opening === true) await store.mutateCompatChat(agent, { action: 'switch-swipe', expectedRevision: compatChat.revision, messageId: 0, swipeId: body.swipeId }, signal)
              return nextView
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
      if (route === '/compat/variables/replace') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.replaceCompatibilityVariables(agent, body.option ?? { type: 'chat' }, body.variables ?? {}, {
          scriptId: body.scriptId,
          extensionId: body.extensionId,
          expectedRevision: body.expectedRevision,
        }) })
        return
      }
      if (route === '/compat/chat/mutate') {
        const agent = await agentFor(body.sessionId)
        const result = await store.mutateCompatChat(agent, body.mutation ?? body)
        sendJson(res, 200, { ok: true, value: result })
        return
      }
      if (route === '/compat/worldbook') {
        const agent = await agentFor(body.sessionId)
        await store.refreshLibrary(agent)
        const action = String(body.action ?? '')
        const name = String(body.name ?? '')
        const options = { context: agent, expectedRevision: body.expectedRevision }
        let value
        if (action === 'get') value = store.getTavernWorldbookSnapshot(name, agent)
        else if (action === 'create') value = await store.createTavernWorldbook(name, body.entries ?? [], options)
        else if (action === 'create-or-replace') value = await store.createOrReplaceTavernWorldbook(name, body.entries ?? [], options)
        else if (action === 'replace') {
          await store.replaceTavernWorldbook(name, body.entries ?? [], options)
          value = store.getTavernWorldbookSnapshot(name, agent)
        } else if (action === 'create-entries') {
          value = await store.createTavernWorldbookEntries(name, body.entries ?? [], options)
          value = { ...value, revision: store.getTavernWorldbookSnapshot(name, agent).revision }
        } else if (action === 'delete-entries') {
          value = await store.deleteTavernWorldbookEntries(name, body.uids ?? [], options)
          value = { ...value, revision: store.getTavernWorldbookSnapshot(name, agent).revision }
        } else if (action === 'delete') value = await store.deleteTavernWorldbook(name, { ...options, rejectIfReferenced: false })
        else if (action === 'rebind-global') value = await store.updateCompatibilityState(agent, { globalWorldbooks: body.names ?? [], lorebookSettings: { selected_global_lorebooks: body.names ?? [] } }, { expectedRevision: body.expectedRevision })
        else if (action === 'rebind-character') value = await store.updateCompatibilityState(agent, { characterWorldbooks: body.worldbooks ?? {} }, { expectedRevision: body.expectedRevision })
        else if (action === 'rebind-chat') {
          const targetName = body.name === null || body.name === '' ? null : String(body.name)
          const target = targetName === null ? null : store.getTavernWorldbookSnapshot(targetName, agent)
          value = await store.updateSession(agent, { worldbookId: target?.id ?? null, expectedRevision: body.bindingRevision })
        } else if (action === 'get-or-create-chat') {
          const currentView = store.sessionView(agent)
          if (currentView.binding?.worldbookExplicit === true && currentView.worldbook !== null) value = currentView.worldbook.name
          else {
            const requested = typeof body.name === 'string' && body.name.trim() !== ''
              ? body.name.trim()
              : `Chat Book ${String(agent.session.id)}`.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').slice(0, 64)
            const created = await store.createTavernWorldbook(requested, [], { context: agent })
            if (!created && typeof body.name === 'string' && body.name.trim() !== '') throw new Error(`worldbook "${requested}" already exists`)
            const target = store.getTavernWorldbookSnapshot(requested, agent)
            await store.updateSession(agent, { worldbookId: target.id, expectedRevision: currentView.binding?.revision })
            value = requested
          }
        } else if (action === 'set-lorebook-settings') value = await store.updateCompatibilityState(agent, { lorebookSettings: body.settings ?? {} }, { expectedRevision: body.expectedRevision })
        else if (action === 'save-extension-settings') value = await store.updateCompatibilityState(agent, { extensionSettings: body.settings ?? {} }, { expectedRevision: body.expectedRevision })
        else throw new TypeError(`unknown compatibility worldbook action ${action}`)
        sendJson(res, 200, { ok: true, value })
        return
      }
      if (route === '/compat/regex') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.replaceCompatibilityRegexes(agent, body.changes ?? {}) })
        return
      }
      if (route === '/compat/slash') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await triggerSlash(agent, body.command) })
        return
      }
      if (route === '/compat/generation/start') {
        const agent = await agentFor(body.sessionId)
        const options = await compatibilityGenerationOptions(agent, body.mode === 'raw' ? 'raw' : 'preset', body.config ?? {})
        const started = generationBroker.start({ sessionId: agent.id, generationId: body.config?.generation_id, options })
        void started.done.catch(() => undefined)
        sendJson(res, 202, { ok: true, value: { generationId: started.generationId } })
        return
      }
      if (route === '/compat/generation/stop') {
        const agent = await agentFor(body.sessionId, false)
        const current = generationBroker.get(body.generationId)
        const stopped = current?.sessionId === String(agent.id) && generationBroker.stopById(body.generationId)
        sendJson(res, 200, { ok: true, value: stopped === true })
        return
      }
      if (route === '/compat/generation/stop-all') {
        const agent = await agentFor(body.sessionId, false)
        let stopped = false
        for (const item of generationBroker.list({ sessionId: agent.id, activeOnly: true })) stopped = generationBroker.stopById(item.generationId) || stopped
        sendJson(res, 200, { ok: true, value: stopped })
        return
      }
      if (route === '/event') {
        const agent = await agentFor(body.sessionId)
        sendJson(res, 200, { ok: true, value: await store.event(agent, body.operation ?? {}) })
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
      const status = ['replace-confirmation-required', 'binding-changed', 'session-started', 'session-revision-conflict', 'regex-revision-conflict', 'compatibility-revision-conflict', 'chat-revision-conflict', 'worldbook-revision-conflict', 'worldbook-name-conflict', 'worldbook-references-required', 'card-active-sessions', 'card-references-required'].includes(code) ? 409
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
    await resumeEventMaintenance(agent, 'Agent recovery')
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
        const job = createEventMaintenanceJob(agent, event)
        if (job !== null) await eventMaintenance.enqueueCompletedTurn(agent, job)
      } catch (error) {
        console.error('[dsh-sillytavern] failed to durably enqueue background event maintenance job', error)
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
    eventMaintenance.stopAgent(agent)
    store.disposeSession(agent)
  })
}
