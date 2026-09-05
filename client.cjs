window.__ModuleLoader__.load({
  id: 'dsh-sillytavern',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const {
      Menu, MarkdownText, JsonBlock,
      IconChevronDownOutline14, IconSettingsOutline14,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const API = '/api/dsh-sillytavern'

    const overlay = (() => {
      let state = { open: false, mode: 'manager', sessionId: null, version: 0 }
      const listeners = new Set()
      const publish = next => {
        state = { ...state, ...next, version: state.version + 1 }
        for (const listener of listeners) listener()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        open(mode, sessionId = null) { publish({ open: true, mode, sessionId }) },
        close() { publish({ open: false }) },
        changed() { publish({}) },
        reset() { publish({ open: false, mode: 'manager', sessionId: null }) },
      }
    })()

    function createSessionStore(emptyValue) {
      const values = new Map()
      const listeners = new Set()
      return {
        get: id => values.get(id)?.value ?? emptyValue,
        set(id, value, token) {
          const previous = values.get(id)
          if (previous?.token === token) return
          values.set(id, { value, token })
          for (const listener of listeners) listener()
        },
        clear(id) {
          if (!values.delete(id)) return
          for (const listener of listeners) listener()
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        reset() { values.clear(); for (const listener of listeners) listener() },
      }
    }

    const scriptPolicies = createSessionStore(Object.freeze([]))
    const scriptScopes = createSessionStore(Object.freeze({}))
    const scriptEvents = createSessionStore(null)
    const useSessionStore = (store, sessionId) => React.useSyncExternalStore(store.subscribe, () => store.get(sessionId), () => store.get(sessionId))

    const regexWorkerSource = String.raw`
const macroValue = (token, scope) => {
  const name = String(token).trim();
  const character = scope && (scope.character || (scope.card && scope.card.data)) || {};
  const variables = scope && scope.variables || {};
  const globalVariables = scope && scope.globalVariables || {};
  if (name === 'char' || name === 'charIfNotGroup') return scope && scope.char != null ? scope.char : character.nickname || character.name || '';
  if (name === 'user') return scope && scope.user != null ? scope.user : scope && scope.persona && scope.persona.name || scope && scope.userPersona && scope.userPersona.name || '';
  if (name === 'notChar') return scope && scope.user != null ? scope.user : scope && scope.persona && scope.persona.name || scope && scope.userPersona && scope.userPersona.name || '';
  if (name === 'group' || name === 'groupNotMuted') return scope && scope.group || '';
  if (name === 'description') return character.description || '';
  if (name === 'personality') return character.personality || '';
  if (name === 'scenario') return character.scenario || '';
  if (name === 'firstMessage' || name === 'first_mes' || name === 'charFirstMessage') return character.first_mes || character.firstMessage || '';
  if (name.startsWith('charFirstMessage::')) { const index = Number(name.slice(18)); const greetings = [character.first_mes || character.firstMessage || '', ...(Array.isArray(character.alternate_greetings) ? character.alternate_greetings : [])]; return Number.isSafeInteger(index) && index >= 0 ? greetings[index] || '' : ''; }
  if (name === 'persona') return scope && scope.persona && scope.persona.description || scope && scope.userPersona && scope.userPersona.description || '';
  if (name === 'mesExamples' || name === 'mesExamplesRaw') return character.mes_example || '';
  if (name === 'systemPrompt' || name === 'charPrompt') return character.system_prompt || '';
  if (name === 'charInstruction') return character.post_history_instructions || '';
  if (name === 'charCreatorNotes') return character.creator_notes || '';
  if (name === 'charVersion') return character.character_version || '';
  if (name === 'input') return scope && scope.input || '';
  if (name === 'original') return scope && scope.original || '';
  if (name === 'newline') return '\n'; if (name.startsWith('newline::')) return '\n'.repeat(Math.max(0, Math.min(10000, Number(name.slice(9)) || 0)));
  if (name === 'space') return ' '; if (name.startsWith('space::')) return ' '.repeat(Math.max(0, Math.min(10000, Number(name.slice(7)) || 0)));
  if (name === 'noop') return '';
  if (name === 'date') return new Date(scope && scope.now || Date.now()).toLocaleDateString();
  if (name === 'time') return new Date(scope && scope.now || Date.now()).toLocaleTimeString();
  if (name === 'weekday') return new Date(scope && scope.now || Date.now()).toLocaleDateString(undefined, { weekday: 'long' });
  if (name === 'isodate') return new Date(scope && scope.now || Date.now()).toISOString().slice(0, 10);
  if (name === 'isotime') return new Date(scope && scope.now || Date.now()).toISOString().slice(11, 19);
  if (name === 'lastMessage') return scope && Array.isArray(scope.messages) && scope.messages.length ? scope.messages[scope.messages.length - 1].text || '' : '';
  if (name === 'lastUserMessage') { const messages = scope && Array.isArray(scope.messages) ? [...scope.messages].reverse() : []; return messages.find(message => message && message.role === 'user')?.text || ''; }
  if (name === 'lastCharMessage') { const messages = scope && Array.isArray(scope.messages) ? [...scope.messages].reverse() : []; return messages.find(message => message && message.role === 'assistant')?.text || ''; }
  if (name === 'lastMessageId') return String(scope && Array.isArray(scope.messages) && scope.messages.length ? scope.messages[scope.messages.length - 1].seq ?? '' : '');
  if (name === 'firstIncludedMessageId' || name === 'firstDisplayedMessageId') return String(scope && Array.isArray(scope.messages) && scope.messages.length ? scope.messages[0].seq ?? '' : '');
  if (name === 'allChatRange') return scope && Array.isArray(scope.messages) ? scope.messages.map(message => message && message.text || '').join('\n') : '';
  if (name === 'currentSwipeId' || name === 'lastSwipeId') return String(scope && scope.currentSwipeId != null ? scope.currentSwipeId : 0);
  if (name.startsWith('reverse::')) return [...name.slice(9)].reverse().join('');
  if (name.startsWith('random::') || name.startsWith('pick::')) { const values = name.slice(name.indexOf('::') + 2).split('::'); return values.length ? values[Math.floor(Math.random() * values.length)] || '' : ''; }
  if (/^roll(?:::|\s)/i.test(name)) { const expression = name.replace(/^roll(?:::|\s)+/i, '').trim(); const match = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(expression); if (!match) return ''; const count = Math.max(1, Math.min(1000, Number(match[1] || 1))); const sides = Math.max(1, Math.min(1000000, Number(match[2]))); let total = Number(match[3] || 0); for (let index = 0; index < count; index += 1) total += 1 + Math.floor(Math.random() * sides); return String(total); }
  if (name.startsWith('getvar::')) return variables[name.slice(8)] == null ? '' : variables[name.slice(8)];
  if (name.startsWith('globalvar::')) return globalVariables[name.slice(11)] == null ? '' : globalVariables[name.slice(11)];
  if (name.startsWith('getglobalvar::')) return globalVariables[name.slice(14)] == null ? '' : globalVariables[name.slice(14)];
  if (name.startsWith('hasvar::')) return Object.hasOwn(variables, name.slice(8)) ? 'true' : 'false';
  if (name.startsWith('hasglobalvar::')) return Object.hasOwn(globalVariables, name.slice(14)) ? 'true' : 'false';
  return undefined;
};
const substitute = (input, scope, transform = value => value) => String(input == null ? '' : input).replace(/{{([\s\S]*?)}}/g, (whole, token) => {
  const value = macroValue(token, scope || {});
  return value === undefined ? whole : String(transform(String(value)));
});
const escapeMacro = value => String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, character => {
  if (character === '\n') return '\\n'; if (character === '\r') return '\\r'; if (character === '\t') return '\\t';
  if (character === '\v') return '\\v'; if (character === '\f') return '\\f'; if (character === '\0') return '\\0';
  return '\\' + character;
});
const parseRegex = input => {
  try {
    const text = String(input == null ? '' : input);
    const match = text.match(/(\/?)(.+)\1([a-z]*)/i);
    if (!match) return null;
    if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) return new RegExp(text);
    return new RegExp(match[2], match[3]);
  } catch { return null; }
};
const filterString = (value, trims, scope) => {
  let output = String(value);
  for (const rawTrim of Array.isArray(trims) ? trims : []) output = output.replaceAll(substitute(rawTrim, scope), '');
  return output;
};
const runRule = (rule, input, scope) => {
  if (!rule || rule.disabled === true || !rule.findRegex || !input) return input;
  scope = { ...(scope || {}), original: scope && scope.original != null ? scope.original : input };
  let regexText = String(rule.findRegex);
  if (Number(rule.substituteRegex) === 1) regexText = substitute(regexText, scope);
  else if (Number(rule.substituteRegex) === 2) regexText = substitute(regexText, scope, escapeMacro);
  const regex = parseRegex(regexText);
  if (!regex) return input;
  if (regex.global || regex.sticky) regex.lastIndex = 0;
  const replacement = String(rule.replaceString == null ? rule.source || '' : rule.replaceString).replace(/{{match}}/gi, '$0');
  return String(input).replace(regex, function (match) {
    const args = [...arguments];
    const expanded = replacement.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_token, number, groupName) => {
      let value;
      if (number) value = args[Number(number)];
      else { const groups = args[args.length - 1]; value = groups && typeof groups === 'object' ? groups[groupName] : undefined; }
      return value ? filterString(value, rule.trimStrings, scope) : '';
    });
    return substitute(expanded, scope);
  });
};
const stageMatches = (rule, options) => rule.markdownOnly === true && options.isMarkdown === true
  || rule.promptOnly === true && options.isPrompt === true
  || rule.markdownOnly !== true && rule.promptOnly !== true && options.isMarkdown !== true && options.isPrompt !== true;
self.onmessage = event => {
  const { id, text, rules, options = {}, scope = {} } = event.data || {};
  try {
    let output = String(text == null ? '' : text);
    const passScope = { ...scope, original: scope.original != null ? scope.original : output };
    const applied = [];
    const errors = [];
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!options.force) {
        if (rule.enabled !== true || rule.disabled === true || !stageMatches(rule, options)) continue;
        if (options.isEdit === true && rule.runOnEdit !== true) continue;
        if (typeof options.depth === 'number') {
          if (!Number.isNaN(rule.minDepth) && rule.minDepth != null && rule.minDepth >= -1 && options.depth < rule.minDepth) continue;
          if (!Number.isNaN(rule.maxDepth) && rule.maxDepth != null && rule.maxDepth >= 0 && options.depth > rule.maxDepth) continue;
        }
        if (!Array.isArray(rule.placement) || !rule.placement.includes(options.placement)) continue;
      }
      try {
        const next = runRule(rule, output, passScope);
        if (next !== output) applied.push(String(rule.id || rule.name || ''));
        output = next;
      } catch (error) { errors.push({ id: String(rule.id || ''), message: error && error.message ? error.message : String(error) }); }
    }
    self.postMessage({ id, ok: true, value: { text: output, applied, errors } });
  } catch (error) { self.postMessage({ id, ok: false, error: error && error.message ? error.message : String(error) }); }
};`

    const regexEngine = (() => {
      let workerUrl = null
      let nextId = 0
      const workers = new Set()
      const url = () => {
        if (workerUrl === null) workerUrl = URL.createObjectURL(new Blob([regexWorkerSource], { type: 'text/javascript' }))
        return workerUrl
      }
      return {
        run(text, rules, signal, options = {}, scope = {}) {
          if (signal?.aborted) return Promise.reject(signal.reason || new Error('regex rendering aborted'))
          const id = ++nextId
          const worker = new Worker(url())
          workers.add(worker)
          return new Promise((resolve, reject) => {
            let settled = false
            const finish = callback => {
              if (settled) return
              settled = true
              signal?.removeEventListener('abort', aborted)
              workers.delete(worker)
              worker.terminate()
              callback()
            }
            const aborted = () => finish(() => reject(signal.reason || new Error('regex rendering aborted')))
            signal?.addEventListener('abort', aborted, { once: true })
            worker.onmessage = event => finish(() => { if (event.data?.ok !== true) return reject(new Error(event.data?.error || 'regex rendering failed')); const value = event.data.value; if (Array.isArray(value?.errors) && value.errors.length > 0) console.warn('[dsh-sillytavern] Regex rule errors', value.errors); resolve(value) })
            worker.onerror = event => finish(() => reject(new Error(event?.message || 'regex rendering worker failed')))
            try { worker.postMessage({ id, text: String(text), rules: structuredClone(rules), options: structuredClone(options), scope: structuredClone(scope) }) }
            catch (error) { finish(() => reject(error)) }
          })
        },
        dispose() {
          for (const worker of workers) worker.terminate()
          workers.clear()
          if (workerUrl !== null) URL.revokeObjectURL(workerUrl)
          workerUrl = null
        },
      }
    })()

    async function api(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      })
      let body
      try { body = await response.json() } catch { throw new Error(`HTTP ${response.status}`) }
      if (!response.ok || body.ok !== true) {
        const error = new Error(body.error || `HTTP ${response.status}`)
        error.code = body.code
        error.status = response.status
        error.details = body.details
        error.body = body
        throw error
      }
      return body.value
    }

    function useOverlay() {
      return React.useSyncExternalStore(overlay.subscribe, overlay.getSnapshot, overlay.getSnapshot)
    }

    function useAsync(load, deps) {
      const [state, setState] = React.useState({ loading: true, value: null, error: null })
      React.useEffect(() => {
        const controller = new AbortController()
        setState(previous => ({ ...previous, loading: true, error: null }))
        Promise.resolve(load(controller.signal)).then(value => {
          if (!controller.signal.aborted) setState({ loading: false, value, error: null })
        }).catch(error => {
          if (!controller.signal.aborted) setState({ loading: false, value: null, error: error instanceof Error ? error.message : String(error) })
        })
        return () => controller.abort()
      }, deps)
      return state
    }

    const compatRuntime = (() => {
      const sessions = new Map()
      const frames = new Map()
      let removeWindowListener = null
      let nextRevision = 0

      const clone = value => value === undefined ? undefined : structuredClone(value)
      const sessionFor = sessionId => {
        const id = String(sessionId)
        let runtime = sessions.get(id)
        if (runtime === undefined) {
          runtime = { id, snapshot: null, token: undefined, eventToken: undefined, listeners: new Set(), frames: new Set(), composer: null, queue: Promise.resolve(), cardId: undefined, eventSeq: -1, eventsInitialized: false }
          sessions.set(id, runtime)
        }
        return runtime
      }
      const notify = runtime => { for (const listener of runtime.listeners) listener() }
      const post = (registration, message) => registration.getWindow()?.postMessage({ __dshSillyTavern: true, channel: registration.channel, ...message }, '*')
      const broadcastState = runtime => {
        if (runtime.snapshot === null) return
        for (const channel of runtime.frames) {
          const registration = frames.get(channel)
          if (registration !== undefined) post(registration, { event: 'compat-state', payload: clone(runtime.snapshot) })
        }
      }
      const set = (sessionId, snapshot, token) => {
        if (snapshot === null || snapshot === undefined) return
        const runtime = sessionFor(sessionId)
        if (token !== undefined && runtime.token === token) return
        runtime.token = token
        runtime.snapshot = { ...clone(snapshot), runtimeRevision: ++nextRevision }
        const history = runtime.snapshot.state?.history || []
        runtime.eventSeq = Math.max(runtime.eventSeq, ...history.map(message => Number(message?.seq)).filter(Number.isSafeInteger), -1)
        runtime.cardId = runtime.snapshot.cardRecord?.id ?? null
        notify(runtime)
        broadcastState(runtime)
      }
      const patchSnapshot = (runtime, patch) => {
        if (runtime.snapshot === null) return
        runtime.snapshot = { ...runtime.snapshot, ...clone(patch), runtimeRevision: ++nextRevision }
        notify(runtime)
        broadcastState(runtime)
      }
      const broadcastEvent = (runtime, name, args, exceptChannel) => {
        for (const channel of runtime.frames) {
          if (channel === exceptChannel) continue
          const registration = frames.get(channel)
          if (registration !== undefined) post(registration, { event: 'compat-event', payload: { name, args: clone(args) } })
        }
      }
      const applyEventState = (sessionId, state) => {
        if (state === null || state === undefined) return
        const runtime = sessionFor(sessionId)
        if (runtime.snapshot === null) return
        const history = Array.isArray(state.history) ? state.history : []
        const eventToken = `${state.card?.id || 'none'}:${state.cursor ?? -1}:${state.compatChatRevision ?? -1}:${history.at(-1)?.seq ?? -1}:${history.length}:${state.unavailable === true}`
        if (runtime.eventToken === eventToken) return
        runtime.eventToken = eventToken
        const stateView = { ...(runtime.snapshot.state || {}), history: clone(history) }
        const patch = { state: stateView, chatRevision: Number(state.compatChatRevision ?? runtime.snapshot.chatRevision ?? 0) }
        if (Array.isArray(state.messages)) patch.messages = clone(state.messages)
        patchSnapshot(runtime, patch)
        const cardId = state.card?.id ?? null
        if (runtime.eventsInitialized && cardId !== runtime.cardId) broadcastEvent(runtime, 'chat_id_changed', [runtime.id])
        const newer = history.filter(message => Number.isSafeInteger(message?.seq) && message.seq > runtime.eventSeq)
        if (runtime.eventsInitialized) for (const message of newer) {
          const projectedId = (runtime.snapshot.messages || []).findIndex(item => item.sourceSeq === message.seq || item.event_seq === message.seq)
          const messageId = projectedId >= 0 ? projectedId : history.indexOf(message)
          if (message.role === 'user') {
            broadcastEvent(runtime, 'message_sent', [messageId])
            broadcastEvent(runtime, 'user_message_rendered', [messageId])
          } else if (message.role === 'assistant') {
            broadcastEvent(runtime, 'message_received', [messageId, 'normal'])
            broadcastEvent(runtime, 'character_message_rendered', [messageId, 'normal'])
          }
        }
        runtime.eventsInitialized = true
        runtime.cardId = cardId
        if (history.length > 0) runtime.eventSeq = Math.max(runtime.eventSeq, ...history.map(message => Number(message?.seq)).filter(Number.isSafeInteger))
      }
      const mergeSessionView = (runtime, view) => {
        const binding = view?.binding ?? runtime.snapshot?.state?.binding ?? null
        patchSnapshot(runtime, {
          bindingRevision: Number(binding?.revision ?? runtime.snapshot?.bindingRevision ?? 0),
          variables: clone(binding?.variables ?? runtime.snapshot?.variables ?? {}),
          scriptInjections: clone(binding?.scriptInjections ?? runtime.snapshot?.scriptInjections ?? []),
          state: { ...(runtime.snapshot?.state || {}), ...(view || {}), history: runtime.snapshot?.state?.history || [] },
        })
      }
      const patchVariableScope = (runtime, option, variables, metadata = {}) => {
        if (runtime.snapshot === null) return
        const type = String(option?.type || 'chat')
        const scopes = clone(runtime.snapshot.variableScopes || {})
        scopes[type] = clone(variables || {})
        const patch = { variableScopes: scopes }
        if (type === 'chat') {
          patch.variables = clone(variables || {})
          patch.state = { ...(runtime.snapshot.state || {}), binding: { ...(runtime.snapshot.state?.binding || {}), variables: clone(variables || {}) } }
        } else if (type === 'global') patch.globalVariables = clone(variables || {})
        const maps = clone(runtime.snapshot.variableMaps || {})
        if (type === 'global') maps.global = clone(variables || {})
        else if (type === 'preset') {
          const ids = Array.isArray(runtime.snapshot.state?.binding?.templateIds) ? runtime.snapshot.state.binding.templateIds.map(String).sort() : []
          maps.presets ||= {}; maps.presets[ids.length === 0 ? 'in_use' : ids.join('\u001f')] = clone(variables || {})
        } else if (type === 'character') {
          maps.characters ||= {}; maps.characters[String(runtime.snapshot.cardRecord?.id || '')] = clone(variables || {})
        } else if (type === 'script') {
          maps.scripts ||= {}; maps.scripts[`${String(runtime.snapshot.cardRecord?.id || 'none')}\u001f${String(metadata.scriptId || option?.script_id || 'unknown')}`] = clone(variables || {})
        } else if (type === 'extension') {
          maps.extensions ||= {}; maps.extensions[String(option?.extension_id || '')] = clone(variables || {})
        } else if (type === 'message') {
          const messages = clone(runtime.snapshot.messages || [])
          const raw = option?.message_id ?? 'latest'
          let index = raw === 'latest' ? messages.length - 1 : Number(raw)
          if (index < 0) index = messages.length + index
          if (Number.isSafeInteger(index) && messages[index]) messages[index].data = clone(variables || {})
          patch.messages = messages
        }
        patch.variableMaps = maps
        patchSnapshot(runtime, patch)
      }
      const persistVariableScope = (runtime, option, variables, metadata = {}) => {
        const operation = runtime.queue.then(async () => {
          const type = String(option?.type || 'chat')
          const revisions = runtime.snapshot?.variableRevisions || {}
          const revisionKey = type === 'chat' ? 'chat' : type === 'global' ? 'global' : type === 'message' ? 'message' : 'workspace'
          try {
            const value = await api('/compat/variables/replace', {
              method: 'POST',
              body: JSON.stringify({ sessionId: runtime.id, option, variables, scriptId: metadata.scriptId, extensionId: option?.extension_id, expectedRevision: Number(revisions[revisionKey] || 0) }),
            })
            patchVariableScope(runtime, option, variables, metadata)
            patchSnapshot(runtime, { variableRevisions: clone(value?.revisions || revisions) })
            return value
          } catch (error) {
            const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
            set(runtime.id, fresh)
            throw error
          }
        })
        runtime.queue = operation.catch(() => undefined)
        return operation
      }
      const persistSessionPatch = (runtime, patch) => {
        const operation = runtime.queue.then(async () => {
          const expectedRevision = Number(runtime.snapshot?.bindingRevision ?? 0)
          try {
            const view = await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, patch: { ...patch, expectedRevision } }) })
            mergeSessionView(runtime, view)
            return view
          } catch (error) {
            const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
            set(runtime.id, fresh)
            throw error
          }
        })
        runtime.queue = operation.catch(() => undefined)
        return operation
      }
      const handleAction = async (registration, message) => {
        const runtime = sessionFor(registration.sessionId)
        const args = message.args || {}
        if (registration.actions && typeof registration.actions[message.action] === 'function') return registration.actions[message.action](args, registration.channel)
        if (message.action === 'getState') return clone(runtime.snapshot?.state ?? null)
        if (message.action === 'getWorldbook') return clone(runtime.snapshot?.worldbook ?? null)
        if (message.action === 'replaceVariables' || message.action === 'setVariables') {
          const variables = args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables) ? clone(args.variables) : {}
          const option = args.option && typeof args.option === 'object' ? clone(args.option) : { type: 'chat' }
          patchVariableScope(runtime, option, variables, { scriptId: registration.scriptId })
          return persistVariableScope(runtime, option, variables, { scriptId: registration.scriptId })
        }
        if (message.action === 'injectPrompts') {
          const incoming = Array.isArray(args.prompts) ? args.prompts : []
          const byId = new Map((runtime.snapshot?.scriptInjections || []).map(item => [String(item.id), item]))
          for (const item of incoming) byId.set(String(item.id), clone(item))
          const scriptInjections = [...byId.values()]
          patchSnapshot(runtime, { scriptInjections, state: { ...(runtime.snapshot?.state || {}), binding: { ...(runtime.snapshot?.state?.binding || {}), scriptInjections } } })
          return persistSessionPatch(runtime, { scriptInjections })
        }
        if (message.action === 'uninjectPrompts') {
          const ids = new Set((Array.isArray(args.ids) ? args.ids : []).map(String))
          const scriptInjections = (runtime.snapshot?.scriptInjections || []).filter(item => !ids.has(String(item.id)))
          patchSnapshot(runtime, { scriptInjections, state: { ...(runtime.snapshot?.state || {}), binding: { ...(runtime.snapshot?.state?.binding || {}), scriptInjections } } })
          return persistSessionPatch(runtime, { scriptInjections })
        }
        if (message.action === 'mutateChat') {
          const operation = runtime.queue.then(async () => {
          const mutation = clone(args.mutation || {})
          mutation.expectedRevision = Number(runtime.snapshot?.chatRevision || 0)
          const value = await api('/compat/chat/mutate', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, mutation }) })
          const messages = clone(value?.messages || [])
          patchSnapshot(runtime, {
            chatRevision: Number(value?.revision || 0),
            messages,
            state: { ...(runtime.snapshot?.state || {}), history: messages.map(item => ({ role: item.role, text: item.message ?? item.text ?? '', seq: item.sourceSeq ?? item.message_id })) },
          })
          const refresh = mutation.options?.refresh || 'affected'
          if (mutation.action === 'set') {
            for (const item of mutation.messages || []) broadcastEvent(runtime, 'message_updated', [item.message_id])
          } else if (mutation.action === 'create') {
            const before = mutation.options?.insert_before
            const start = Number.isSafeInteger(before) ? before : Math.max(0, messages.length - (mutation.messages || []).length)
            for (let offset = 0; offset < (mutation.messages || []).length; offset += 1) {
              const id = start + offset
              const item = mutation.messages[offset]
              if (item?.role === 'user') broadcastEvent(runtime, 'message_sent', [id])
              else if (item?.role === 'assistant') broadcastEvent(runtime, 'message_received', [id, 'normal'])
            }
          } else if (mutation.action === 'delete') {
            for (const id of mutation.messageIds || []) broadcastEvent(runtime, 'message_deleted', [id])
          } else if (mutation.action === 'switch-swipe') broadcastEvent(runtime, 'message_swiped', [mutation.messageId])
          if (refresh === 'all') broadcastEvent(runtime, 'chat_id_changed', [runtime.id])
          else if (refresh === 'affected') {
            const affected = mutation.action === 'set' ? (mutation.messages || []).map(item => item.message_id)
              : mutation.action === 'create' ? messages.slice(-(mutation.messages || []).length).map(item => item.message_id)
              : []
            for (const id of affected) {
              const item = messages[id]
              if (item?.role === 'user') broadcastEvent(runtime, 'user_message_rendered', [id])
              else if (item?.role === 'assistant') broadcastEvent(runtime, 'character_message_rendered', [id, 'normal'])
            }
          }
          return null
          })
          runtime.queue = operation.catch(() => undefined)
          return operation
        }
        if (message.action === 'worldbook') {
          const value = await api('/compat/worldbook', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, ...(args.request || {}) }) })
          const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
          set(runtime.id, fresh)
          return value
        }
        if (message.action === 'replaceRegexes') {
          const operation = runtime.queue.then(async () => {
            const changes = clone(args.changes || {})
            if (Object.hasOwn(changes, 'global') || Object.hasOwn(changes, 'preset')) changes.expectedRevision = Number(runtime.snapshot?.regexRevision || 0)
            const value = await api('/compat/regex', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, changes }) })
            const fresh = await api(`/compat/runtime?sessionId=${encodeURIComponent(runtime.id)}`)
            set(runtime.id, fresh)
            broadcastEvent(runtime, 'settings_updated', [])
            broadcastEvent(runtime, 'chat_id_changed', [runtime.id])
            return value
          })
          runtime.queue = operation.catch(() => undefined)
          return operation
        }
        if (message.action === 'flushWrites') return runtime.queue
        if (message.action === 'memory') return api('/memory', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, operation: args.operation || {} }) })
        if (message.action === 'triggerSlash') return api('/compat/slash', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, command: String(args.command || '') }) })
        if (message.action === 'generate') {
          const started = await api('/compat/generation/start', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, mode: args.mode === 'raw' ? 'raw' : 'preset', config: args.config || {} }) })
          const generationId = String(started.generationId)
          broadcastEvent(runtime, 'js_generation_started', [generationId])
          broadcastEvent(runtime, 'generation_started', ['normal', {}, false])
          let previous = ''
          for (;;) {
            await new Promise(resolve => window.setTimeout(resolve, 40))
            const state = await api(`/compat/generation?sessionId=${encodeURIComponent(runtime.id)}&generationId=${encodeURIComponent(generationId)}`)
            const full = String(state.full || '')
            if (full !== previous) {
              const incremental = full.startsWith(previous) ? full.slice(previous.length) : full
              previous = full
              broadcastEvent(runtime, 'js_stream_token_received_incrementally', [incremental, generationId])
              broadcastEvent(runtime, 'js_stream_token_received_fully', [full, generationId])
              broadcastEvent(runtime, 'stream_token_received', [full])
            }
            if (state.active) continue
            if (state.status === 'failed') throw Object.assign(new Error(state.error?.message || 'generation failed'), { code: state.error?.code })
            if (state.status === 'stopped') broadcastEvent(runtime, 'generation_stopped', [generationId])
            broadcastEvent(runtime, 'js_generation_ended', [full, generationId])
            broadcastEvent(runtime, 'generation_ended', [null])
            return Array.isArray(state.toolCalls) && state.toolCalls.length > 0 ? { content: full, tool_calls: state.toolCalls } : full
          }
        }
        if (message.action === 'stopGeneration') return api('/compat/generation/stop', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id, generationId: args.generationId }) })
        if (message.action === 'stopAllGeneration') return api('/compat/generation/stop-all', { method: 'POST', body: JSON.stringify({ sessionId: runtime.id }) })
        if (message.action === 'getModelList') return api(`/compat/models?sessionId=${encodeURIComponent(runtime.id)}&provider=${encodeURIComponent(String(args.provider || ''))}`)
        if (message.action === 'appendInput') {
          if (typeof runtime.composer !== 'function') throw new Error('conversation composer bridge is unavailable')
          return runtime.composer(args.text)
        }
        throw new Error(`unsupported script API action ${message.action}`)
      }
      const onMessage = async event => {
        const message = event.data
        if (!message || message.__dshSillyTavern !== true || typeof message.channel !== 'string') return
        const registration = frames.get(message.channel)
        if (registration === undefined || event.source !== registration.getWindow()) return
        if (message.event === 'frame-resize') {
          const height = Math.ceil(Number(message.payload?.height))
          if (Number.isFinite(height) && height > 0) registration.onResize?.(height)
          return
        }
        if (message.event === 'frame-ready') {
          registration.onReady?.()
          const runtime = sessionFor(registration.sessionId)
          if (runtime.snapshot !== null) post(registration, { event: 'compat-state', payload: clone(runtime.snapshot) })
          return
        }
        if (message.event === 'compat-event') {
          const name = String(message.payload?.name ?? '')
          const args = Array.isArray(message.payload?.args) ? message.payload.args : []
          if (name !== '') broadcastEvent(sessionFor(registration.sessionId), name, args, registration.channel)
          return
        }
        if (!message.id) return
        try {
          const value = await handleAction(registration, message)
          post(registration, { replyTo: message.id, ok: true, value: value ?? null })
        } catch (error) {
          post(registration, { replyTo: message.id, ok: false, error: error?.message || String(error), code: error?.code })
        }
      }
      return {
        start() {
          if (removeWindowListener !== null) return () => undefined
          if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') return () => undefined
          window.addEventListener('message', onMessage)
          removeWindowListener = () => { window.removeEventListener('message', onMessage); removeWindowListener = null }
          return removeWindowListener
        },
        get(sessionId) { return sessionId === undefined || sessionId === null ? null : sessionFor(sessionId).snapshot },
        subscribe(sessionId, listener) { if (sessionId === undefined || sessionId === null) return () => undefined; const runtime = sessionFor(sessionId); runtime.listeners.add(listener); return () => runtime.listeners.delete(listener) },
        set,
        applyEventState,
        setComposer(sessionId, composer) { const runtime = sessionFor(sessionId); runtime.composer = composer; return () => { if (runtime.composer === composer) runtime.composer = null } },
        register(registration) {
          frames.set(registration.channel, registration)
          sessionFor(registration.sessionId).frames.add(registration.channel)
          return () => { frames.delete(registration.channel); sessions.get(String(registration.sessionId))?.frames.delete(registration.channel) }
        },
        reset() {
          removeWindowListener?.()
          frames.clear()
          sessions.clear()
        },
      }
    })()

    function useCompatSnapshot(sessionId) {
      const subscribe = React.useCallback(listener => compatRuntime.subscribe(sessionId, listener), [sessionId])
      const getSnapshot = React.useCallback(() => compatRuntime.get(sessionId), [sessionId])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    function Button({ children, className = '', ...props }) {
      return h('button', { type: 'button', className: `dst-button ${className}`, ...props }, children)
    }

    function TavernMugIcon({ size = 16, className = '' }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        className,
        'aria-hidden': true,
        focusable: false,
      },
      h('path', {
        d: 'M3 5.25h8v6A1.75 1.75 0 0 1 9.25 13h-4.5A1.75 1.75 0 0 1 3 11.25v-6Z',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M11 6.5h1a2 2 0 0 1 0 4h-1M3.25 7h7.5',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 4.5, cy: 4, r: 1, fill: 'currentColor' }),
      h('circle', { cx: 7.25, cy: 3.25, r: 1.25, fill: 'currentColor' }),
      h('circle', { cx: 9.75, cy: 4.25, r: 1, fill: 'currentColor' }))
    }

    function Field({ label, children }) {
      return h('label', { className: 'dst-field' }, h('span', null, label), children)
    }

    function sessionHasStarted(session) {
      if (session?.conversationStarted === true || session?.hasConversationMessages === true || session?.binding?.locked === true || session?.binding?.startedAt != null) return true
      return Array.isArray(session?.history) && session.history.some(message => message?.role === 'user' || message?.type === 'user/message')
    }

    function referenceLabel(reference, fallback) {
      if (typeof reference === 'string') return reference
      return String(reference?.title || reference?.name || reference?.sessionId || reference?.id || fallback)
    }

    function ReferenceList({ title, references }) {
      if (!Array.isArray(references) || references.length === 0) return null
      return h('section', { className: 'dst-reference-list' },
        h('strong', null, `${title}（${references.length}）`),
        h('ul', null, references.map((reference, index) => h('li', { key: `${reference?.id || reference?.sessionId || index}` }, referenceLabel(reference, `#${index + 1}`)))))
    }

    function ConfirmPanel({ title, children, busy, confirmDisabled = false, confirmLabel = '确认', danger = true, onConfirm, onCancel }) {
      return h('div', { className: 'dst-confirm-layer', role: 'presentation' },
        h('section', { className: 'dst-confirm-card', role: 'dialog', 'aria-modal': true, 'aria-label': title },
          h('div', { className: 'dst-dialog-title' }, title),
          children,
          h('div', { className: 'dst-actions' },
            h(Button, { className: danger ? 'danger' : '', disabled: busy || confirmDisabled, onClick: onConfirm }, busy ? '处理中…' : confirmLabel),
            h(Button, { className: 'secondary', disabled: busy, onClick: onCancel }, '取消'))))
    }

    function scriptApprovalMaterial(script) {
      const source = String(script?.source ?? '')
      if (script?.kind !== 'regex') return `${script?.kind === 'html' ? 'html' : 'javascript'}\0${source}`
      const trimStrings = Array.isArray(script.trimStrings) ? script.trimStrings.map(value => String(value)) : []
      const placement = Array.isArray(script.placement) ? [...new Set(script.placement.map(Number).filter(Number.isSafeInteger))] : []
      return `regex\0${JSON.stringify({ findRegex: String(script.findRegex ?? ''), trimStrings, placement, markdownOnly: script.markdownOnly === true, promptOnly: script.promptOnly === true, runOnEdit: script.runOnEdit === true, substituteRegex: Number.isSafeInteger(Number(script.substituteRegex)) ? Number(script.substituteRegex) : 0, minDepth: script.minDepth === null || script.minDepth === undefined || !Number.isFinite(Number(script.minDepth)) ? null : Number(script.minDepth), maxDepth: script.maxDepth === null || script.maxDepth === undefined || !Number.isFinite(Number(script.maxDepth)) ? null : Number(script.maxDepth), source })}`
    }

    async function sourceDigest(script) {
      const bytes = new TextEncoder().encode(scriptApprovalMaterial(script))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    }

    function fileBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
        reader.readAsDataURL(file)
      })
    }

    function ImportDialog({ sessionId, close }) {
      const inputRef = React.useRef(null)
      const closeTimer = React.useRef(null)
      React.useEffect(() => () => {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      }, [])
      const [status, setStatus] = React.useState('请选择 Character Card V3 PNG、APNG 或 JSON。')
      const [busy, setBusy] = React.useState(false)
      const session = useAsync(() => api(`/session?sessionId=${encodeURIComponent(sessionId)}`), [sessionId])
      const choose = async event => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file || session.loading || session.error || !session.value) return
        if (file.size > 64 * 1024 * 1024) { setStatus('文件超过 64 MiB 限制。'); return }
        const replacing = session.value?.binding !== null && session.value?.binding !== undefined
        if (replacing && sessionHasStarted(session.value)) { setStatus('当前会话已经开始对话，不能再更换角色卡。请新建会话后导入。'); return }
        if (replacing && !window.confirm(`当前会话已绑定“${session.value.card?.card?.data?.name || '角色'}”。是否替换为 ${file.name}？`)) return
        setBusy(true)
        setStatus(`正在导入 ${file.name}…`)
        try {
          const payload = {
            sessionId,
            fileName: file.name,
            mediaType: file.type || (file.name.toLowerCase().endsWith('.json') ? 'application/json' : 'image/png'),
            data: await fileBase64(file),
            replace: replacing,
            expectedCardId: session.value?.binding?.cardId || null,
          }
          const submit = worldbookConflict => api('/import', {
            method: 'POST',
            body: JSON.stringify({ ...payload, ...(worldbookConflict === undefined ? {} : { worldbookConflict }) }),
          })
          let result
          try { result = await submit() }
          catch (error) {
            if (!['worldbook-name-conflict', 'worldbook-conflict'].includes(error?.code)) throw error
            const conflictingName = String(error.details?.worldbookName || error.details?.name || error.details?.conflict?.name || error.body?.conflict?.name || '同名世界书')
            const overwrite = window.confirm(`导入角色卡内置世界书“${conflictingName}”时发现同名世界书。\n\n选择“确定”将完整覆盖现有世界书；选择“取消”可另存为新名称。`)
            if (overwrite) result = await submit({ action: 'overwrite' })
            else {
              const saveAsName = window.prompt('请输入另存为的世界书名称：', `${conflictingName} - 副本`)
              if (saveAsName === null) { setStatus('已取消导入。'); return }
              if (saveAsName.trim() === '') throw new Error('另存为名称不能为空')
              result = await submit({ action: 'save-as', name: saveAsName.trim() })
            }
          }
          setStatus(`已绑定角色：${result.record.card.data.name}`)
          overlay.changed()
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = null
            close()
          }, 700)
        } catch (error) {
          setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`)
        } finally { setBusy(false) }
      }
      return h('div', { className: 'dst-dialog-card' },
        h('div', { className: 'dst-dialog-title' }, '导入 V3 角色卡'),
        session.loading ? h('p', null, '正在读取当前会话…') : null,
        session.error ? h('p', { className: 'dst-error' }, `无法读取当前会话：${session.error}`) : null,
        session.value?.card ? h('p', { className: 'dst-muted' }, `当前绑定：${session.value.card.card.data.name}`) : null,
        h('p', { className: 'dst-status' }, status),
        h('input', { ref: inputRef, type: 'file', hidden: true, accept: '.png,.apng,.json,image/png,application/json', onChange: choose }),
        session.value?.binding && sessionHasStarted(session.value) ? h('p', { className: 'dst-warning' }, '当前会话已经开始对话，不能导入并替换角色卡。请在新会话中导入。') : null,
        h('div', { className: 'dst-actions' },
          h(Button, { disabled: busy || session.loading || !!session.error || !session.value || (session.value?.binding && sessionHasStarted(session.value)), onClick: () => inputRef.current?.click() }, busy ? '导入中…' : '选择角色卡文件…'),
          h(Button, { className: 'secondary', onClick: close }, '关闭')))
    }

    function LibraryTab({ library, session, reload }) {
      const [status, setStatus] = React.useState('')
      const [deletingId, setDeletingId] = React.useState(null)
      const [deleteDialog, setDeleteDialog] = React.useState(null)
      const started = sessionHasStarted(session)
      const bind = async card => {
        if (!session) return
        const replacing = session.binding !== null
        if (replacing && started) { setStatus('当前会话已经开始对话，不能更换角色卡。'); return }
        if (replacing && !window.confirm(`将当前角色替换为“${card.name}”？`)) return
        try {
          await api('/bind', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, cardId: card.id, replace: replacing, expectedCardId: session.binding?.cardId || null }) })
          setStatus(''); overlay.changed(); reload()
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
      }
      const remove = async card => {
        setDeletingId(card.id)
        setStatus(`正在删除“${card.nickname || card.name}”…`)
        try {
          const result = await api('/card/delete', { method: 'POST', body: JSON.stringify({ sessionId: session?.sessionId, cardId: card.id, deleteWorldbook: deleteDialog?.deleteWorldbook === true, ...(deleteDialog?.confirmWorldbookDelete === true ? { confirmWorldbookDelete: true } : {}) }) })
          setStatus(`已删除“${card.nickname || card.name}”${result?.worldbookDeleted === true || result?.deletedWorldbook ? '，并同步删除默认世界书' : ''}。`)
          setDeleteDialog(null)
          overlay.changed(); reload()
        } catch (error) {
          const activeSessions = error?.details?.activeSessions || error?.details?.sessions || error?.details?.references?.sessions
          if (error?.code === 'worldbook-references-required') {
            const worldbookReferences = error.details?.references || {}
            setDeleteDialog(previous => ({ ...previous, worldbookReferences, confirmWorldbookDelete: true, error: '默认世界书还被其他角色卡或 Session 引用。请核对引用后再次确认；继续会删除世界书并清空全部引用。' }))
            setStatus('默认世界书仍有共享引用，角色卡尚未删除。')
          } else if (Array.isArray(activeSessions) && activeSessions.length > 0) {
            setDeleteDialog(previous => ({ ...previous, activeSessions, error: '仍有尚未删除或归档的会话正在使用该角色卡，当前禁止删除。' }))
            setStatus('角色卡仍被活跃会话引用，未删除。')
          } else setStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`)
        }
        finally { setDeletingId(null) }
      }
      return h('div', null,
        h('div', { className: 'dst-section-title' }, `全局角色库（${library.cards.length}）`),
        library.cards.length === 0 ? h('p', { className: 'dst-muted' }, '还没有角色卡。请从当前会话左下角“+”导入。') : null,
        h('div', { className: 'dst-card-grid' }, library.cards.map(card => h('article', { className: 'dst-card', key: card.id },
          h('strong', null, card.nickname || card.name),
          h('span', { className: 'dst-muted' }, `V3 · ${card.format} · ${card.creator || 'unknown'}`),
          h('div', { className: 'dst-tags' }, (card.tags || []).slice(0, 5).map(tag => h('span', { key: tag }, tag))),
          h('div', { className: 'dst-actions' },
            session ? h(Button, { className: 'small', disabled: deletingId === card.id || session.binding?.cardId === card.id || (started && session.binding !== null), title: started && session.binding?.cardId !== card.id ? '对话开始后不能更换角色卡' : undefined, onClick: () => void bind(card) }, session.binding?.cardId === card.id ? '当前角色' : '用于当前会话') : null,
            h(Button, { className: 'danger small', disabled: deletingId !== null || !session, onClick: () => setDeleteDialog({ card, deleteWorldbook: false, activeSessions: [], error: '' }) }, deletingId === card.id ? '删除中…' : '删除角色卡'))))),
        started ? h('p', { className: 'dst-muted' }, '当前会话已经开始对话，角色卡选择已锁定。') : null,
        status ? h('p', { className: 'dst-status' }, status) : null,
        deleteDialog ? h(ConfirmPanel, {
          title: `删除角色卡“${deleteDialog.card.nickname || deleteDialog.card.name}”`,
          busy: deletingId !== null,
          confirmDisabled: deleteDialog.activeSessions?.length > 0,
          confirmLabel: deleteDialog.activeSessions?.length > 0 ? '无法删除' : '永久删除',
          onConfirm: deleteDialog.activeSessions?.length > 0 ? undefined : () => void remove(deleteDialog.card),
          onCancel: () => setDeleteDialog(null),
        },
        h('p', null, '确定永久删除角色卡吗？角色卡将从当前工作区永久删除，此操作不可撤销。'),
        deleteDialog.error ? h('p', { className: 'dst-error' }, deleteDialog.error) : null,
        h(ReferenceList, { title: '阻止删除的会话', references: deleteDialog.activeSessions }),
        deleteDialog.worldbookReferences ? h(React.Fragment, null,
          h(ReferenceList, { title: '仍引用默认世界书的角色卡', references: deleteDialog.worldbookReferences.cards }),
          h(ReferenceList, { title: '仍引用默认世界书的 Session', references: deleteDialog.worldbookReferences.sessions })) : null,
        h('label', { className: 'dst-worldbook-check' },
          h('input', { type: 'checkbox', disabled: deletingId !== null || deleteDialog.activeSessions?.length > 0 || deleteDialog.confirmWorldbookDelete === true, checked: deleteDialog.deleteWorldbook === true, onChange: event => setDeleteDialog(previous => ({ ...previous, deleteWorldbook: event.target.checked, worldbookReferences: null, confirmWorldbookDelete: false, error: '' })) }),
          h('span', null, '同时删除该角色卡绑定的默认世界书（若仍有其他引用，Host 将要求再次确认或拒绝）'))) : null)
    }

    function PersonaTab({ session, reload }) {
      const [name, setName] = React.useState(session.binding?.userPersona?.name || 'User')
      const [description, setDescription] = React.useState(session.binding?.userPersona?.description || '')
      const [variables, setVariables] = React.useState(() => JSON.stringify(session.binding?.variables || {}, null, 2))
      const [globalVariables, setGlobalVariables] = React.useState(() => JSON.stringify(session.globalVariables || {}, null, 2))
      const [status, setStatus] = React.useState('')
      const save = async () => {
        try {
          const parsedVariables = JSON.parse(variables)
          if (!parsedVariables || typeof parsedVariables !== 'object' || Array.isArray(parsedVariables)) throw new Error('变量必须是 JSON 对象')
          const parsedGlobalVariables = JSON.parse(globalVariables)
          if (!parsedGlobalVariables || typeof parsedGlobalVariables !== 'object' || Array.isArray(parsedGlobalVariables)) throw new Error('全局变量必须是 JSON 对象')
          await Promise.all([
            api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, patch: { userPersona: { name, description }, variables: parsedVariables } }) }),
            api('/regex-sources', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, variables: parsedGlobalVariables }) }),
          ])
          setStatus('已保存'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message) }
      }
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '用户角色设定'),
        h(Field, { label: '称呼' }, h('input', { value: name, onChange: event => setName(event.target.value) })),
        h(Field, { label: '设定' }, h('textarea', { rows: 8, value: description, onChange: event => setDescription(event.target.value) })),
        h(Field, { label: '会话变量（JSON 对象，{{getvar::key}}）' }, h('textarea', { rows: 6, value: variables, onChange: event => setVariables(event.target.value), spellCheck: false })),
        h(Field, { label: '全局变量（JSON 对象，{{globalvar::key}}）' }, h('textarea', { rows: 6, value: globalVariables, onChange: event => setGlobalVariables(event.target.value), spellCheck: false })),
        h('div', { className: 'dst-actions' }, h(Button, { onClick: () => void save() }, '保存角色设定与变量'), h('span', { className: 'dst-muted' }, status)))
    }

    function CardEditTab({ session, library, reload }) {
      const record = session.card
      const data = record?.card?.data
      const worldbooks = Array.isArray(library?.worldbooks) ? library.worldbooks : []
      const [form, setForm] = React.useState(() => data ? ({
        name: data.name, description: data.description, personality: data.personality,
        scenario: data.scenario, first_mes: data.first_mes, mes_example: data.mes_example,
        system_prompt: data.system_prompt, post_history_instructions: data.post_history_instructions,
      }) : {})
      const [defaultWorldbookId, setDefaultWorldbookId] = React.useState(() => record?.defaultWorldbookId || '')
      const [status, setStatus] = React.useState('')
      if (!record) return h('p', { className: 'dst-muted' }, '当前会话尚未绑定角色。')
      const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }))
      const save = async () => {
        try {
          await api('/card/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, cardId: record.id, patch: { cardData: form, defaultWorldbookId: defaultWorldbookId || null } }) })
          setStatus('已保存到全局角色库'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message) }
      }
      const fields = [['name', '角色名', 1], ['description', '角色描述', 7], ['personality', '性格', 5], ['scenario', '场景', 5], ['first_mes', '首条问候', 6], ['mes_example', '示例对话', 7], ['system_prompt', '角色系统提示词', 5], ['post_history_instructions', '历史后指令', 5]]
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '角色卡与角色设定'),
        h(Field, { label: '新会话默认世界书' }, h('select', { value: defaultWorldbookId, onChange: event => setDefaultWorldbookId(event.target.value) },
          h('option', { value: '' }, '不绑定默认世界书'),
          worldbooks.map(worldbook => h('option', { key: worldbook.id, value: worldbook.id }, worldbook.name || '未命名世界书')))),
        h('p', { className: 'dst-muted' }, '只影响之后第一次开始对话的新 Session；已创建 Session 的世界书引用不会跟随修改。'),
        fields.map(([key, label, rows]) => h(Field, { label, key }, rows === 1
          ? h('input', { value: form[key] || '', onChange: event => update(key, event.target.value) })
          : h('textarea', { rows, value: form[key] || '', onChange: event => update(key, event.target.value) }))),
        h('div', { className: 'dst-actions' }, h(Button, { onClick: () => void save() }, '保存角色卡'), h('span', { className: 'dst-muted' }, status)))
    }

    const WORLDBOOK_POSITIONS = [
      [0, '0 · Before Char'], [1, '1 · After Char'], [2, '2 · AN Top'], [3, '3 · AN Bottom'],
      [4, '4 · @Depth'], [5, '5 · EM Top'], [6, '6 · EM Bottom'], [7, '7 · Outlet'],
    ]

    function worldbookExtension(entry, key, aliases = []) {
      const names = [key, ...aliases]
      const extensions = entry?.extensions
      if (extensions && typeof extensions === 'object' && !Array.isArray(extensions)) {
        for (const name of names) if (Object.hasOwn(extensions, name)) return extensions[name]
      }
      for (const name of names) if (entry && Object.hasOwn(entry, name)) return entry[name]
      return undefined
    }

    function updateWorldbookExtension(entry, key, value, aliases = []) {
      const names = [key, ...aliases]
      const next = { ...entry }
      const extensions = entry?.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions) ? { ...entry.extensions } : {}
      let found = false
      for (const name of names) {
        if (Object.hasOwn(extensions, name)) { extensions[name] = value; found = true }
        if (Object.hasOwn(next, name)) { next[name] = value; found = true }
      }
      if (!found) extensions[key] = value
      next.extensions = extensions
      return next
    }

    function worldbookPosition(entry) {
      const raw = worldbookExtension(entry, 'position')
      if (raw === undefined || raw === null || raw === '') return undefined
      const number = Number(raw)
      if (Number.isSafeInteger(number) && number >= 0 && number <= 7) return number
      const normalized = typeof raw === 'string' ? raw.toLocaleLowerCase().replace(/[\s_-]/g, '') : ''
      return ({
        beforechar: 0, beforecharacter: 0, before: 0,
        afterchar: 1, aftercharacter: 1, after: 1,
        antop: 2, authornotetop: 2, topofan: 2,
        anbottom: 3, authornotebottom: 3, bottomofan: 3,
        atdepth: 4, depth: 4,
        emtop: 5, examplemessagestop: 5, beforeexamples: 5,
        embottom: 6, examplemessagesbottom: 6, afterexamples: 6,
        outlet: 7,
      })[normalized]
    }

    function worldbookPolicy(entry) {
      if (entry.constant === true) return 'constant'
      return worldbookExtension(entry, 'vectorized') === true ? 'vectorized' : 'keyword'
    }

    function WorldbookPolicyButton({ active, className, title, children, onClick }) {
      return h('button', {
        type: 'button',
        className: `dst-worldbook-policy ${className}${active ? ' active' : ''}`,
        title,
        'aria-pressed': active,
        onClick,
      }, children)
    }

    function WorldbookEntryEditor({ rowKey, index, entry, onChange, onRemove }) {
      const [open, setOpen] = React.useState(() => entry.content === '' && (!Array.isArray(entry.keys) || entry.keys.length === 0))
      const policy = worldbookPolicy(entry)
      const rawPosition = worldbookExtension(entry, 'position')
      const position = worldbookPosition(entry)
      const positionIsMissing = rawPosition === undefined || rawPosition === null || rawPosition === ''
      const positionPlaceholder = positionIsMissing
        ? '未设置（运行时默认 1 · After Char）'
        : `不支持的原值：${typeof rawPosition === 'string' ? rawPosition : JSON.stringify(rawPosition)}`
      const rawDepth = worldbookExtension(entry, 'depth')
      const numericDepth = Number(rawDepth)
      const depthValue = rawDepth === undefined || rawDepth === null || rawDepth === '' || !Number.isSafeInteger(numericDepth) || numericDepth < 0 ? 4 : numericDepth
      const probabilityEnabled = worldbookExtension(entry, 'useProbability', ['use_probability']) !== false
      const probability = Number(worldbookExtension(entry, 'probability'))
      const selectiveLogic = Number(worldbookExtension(entry, 'selectiveLogic', ['selective_logic']))
      const label = entry.comment || entry.name || (Array.isArray(entry.keys) && entry.keys[0]) || '未命名条目'
      const patch = values => onChange(rowKey, current => ({ ...current, ...values }))
      const patchExtension = (key, value, aliases) => onChange(rowKey, current => updateWorldbookExtension(current, key, value, aliases))
      const setPolicy = value => onChange(rowKey, current => {
        let next = { ...current, constant: value === 'constant' }
        next = updateWorldbookExtension(next, 'vectorized', value === 'vectorized')
        return next
      })
      const parseKeys = value => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
      return h('article', { className: `dst-worldbook-entry${entry.enabled === false ? ' disabled' : ''}` },
        h('div', { className: 'dst-worldbook-entry-head' },
          h('label', { className: 'dst-worldbook-check' }, h('input', { type: 'checkbox', checked: entry.enabled !== false, onChange: event => patch({ enabled: event.target.checked }) }), h('span', null, '启用')),
          h('strong', { title: label }, `${index + 1}. ${label}`),
          h('div', { className: 'dst-worldbook-policies dst-worldbook-policies-head', role: 'group', 'aria-label': `${label} 的插入策略` },
            h(WorldbookPolicyButton, { active: policy === 'constant', className: 'constant', title: '蓝圈：始终插入，无需关键词', onClick: () => setPolicy('constant') }, h('span', { 'aria-hidden': true }, '●'), ' 常驻'),
            h(WorldbookPolicyButton, { active: policy === 'keyword', className: 'keyword', title: '绿圈：主关键字命中后插入', onClick: () => setPolicy('keyword') }, h('span', { 'aria-hidden': true }, '●'), ' 关键词'),
            h(WorldbookPolicyButton, { active: policy === 'vectorized', className: 'vectorized', title: '链接：由向量/嵌入相似度检索；有关键词时仍可按关键词触发', onClick: () => setPolicy('vectorized') }, h('span', { 'aria-hidden': true }, '🔗'), ' 向量')),
          h('span', { className: 'dst-muted dst-worldbook-order' }, `Order ${Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : 0}`),
          h(Button, { className: 'danger small', onClick: () => onRemove(rowKey, label) }, '删除')),
        h('details', { open, onToggle: event => setOpen(event.currentTarget.open) },
          h('summary', null, open ? '收起条目' : '展开编辑'),
          h('div', { className: 'dst-worldbook-entry-body' },
            policy === 'vectorized' ? h('p', { className: 'dst-warning dst-worldbook-vector-note' }, '向量模式需要向量检索支持；当前插件不会仅凭相似度自动触发。保留主关键字时仍可按关键词触发。') : null,
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '备注 / Comment' }, h('input', { value: entry.comment ?? '', onChange: event => patch({ comment: event.target.value }) })),
              h(Field, { label: 'Insertion Order' }, h('input', { type: 'number', step: '1', value: Number.isFinite(Number(entry.insertion_order)) ? entry.insertion_order : 0, onChange: event => patch({ insertion_order: Number(event.target.value) || 0 }) }))),
            h(Field, { label: '内容 / Content' }, h('textarea', { rows: 7, value: entry.content ?? '', onChange: event => patch({ content: event.target.value }) })),
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '主关键字（每行一个）' }, h('textarea', { rows: 4, value: Array.isArray(entry.keys) ? entry.keys.join('\n') : '', onChange: event => patch({ keys: parseKeys(event.target.value) }), placeholder: 'dragon\nancient archive' })),
              h(Field, { label: '次关键字（每行一个）' }, h('textarea', { rows: 4, value: Array.isArray(entry.secondary_keys) ? entry.secondary_keys.join('\n') : '', onChange: event => patch({ secondary_keys: parseKeys(event.target.value) }), placeholder: 'fire\nsecret' }))),
            h('details', { className: 'dst-worldbook-advanced' },
              h('summary', null, '高级匹配与插入位置'),
              h('div', { className: 'dst-worldbook-advanced-body' },
                h('div', { className: 'dst-inline-fields' },
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: entry.selective === true, onChange: event => patch({ selective: event.target.checked }) }), h('span', null, '启用次关键字选择性匹配')),
                  h(Field, { label: '次关键字逻辑' }, h('select', { disabled: entry.selective !== true, value: Number.isSafeInteger(selectiveLogic) && selectiveLogic >= 0 && selectiveLogic <= 3 ? selectiveLogic : 0, onChange: event => patchExtension('selectiveLogic', Number(event.target.value), ['selective_logic']) },
                    h('option', { value: 0 }, 'AND ANY · 任一个'), h('option', { value: 1 }, 'NOT ALL · 不全命中'), h('option', { value: 2 }, 'NOT ANY · 均不命中'), h('option', { value: 3 }, 'AND ALL · 全部')))),
                h('div', { className: 'dst-inline-fields' },
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'use_regex', ['useRegex']) === true, onChange: event => patchExtension('use_regex', event.target.checked, ['useRegex']) }), h('span', null, '正则关键字（原生 JavaScript）')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'case_sensitive', ['caseSensitive']) === true, onChange: event => patchExtension('case_sensitive', event.target.checked, ['caseSensitive']) }), h('span', null, '区分大小写')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'match_whole_words', ['matchWholeWords']) === true, onChange: event => patchExtension('match_whole_words', event.target.checked, ['matchWholeWords']) }), h('span', null, '全词匹配'))),
                h('div', { className: 'dst-inline-fields' },
                  h(Field, { label: 'Position' }, h('select', { value: position ?? '__unsupported__', onChange: event => patchExtension('position', Number(event.target.value)) },
                    position === undefined ? h('option', { value: '__unsupported__', disabled: true }, positionPlaceholder) : null,
                    WORLDBOOK_POSITIONS.map(([value, text]) => h('option', { key: value, value }, text)))),
                  h(Field, { label: '概率值（0–100）' }, h('input', { type: 'number', min: 0, max: 100, step: 1, disabled: !probabilityEnabled, value: Number.isFinite(probability) ? Math.max(0, Math.min(100, probability)) : 100, onChange: event => patchExtension('probability', Math.max(0, Math.min(100, Number(event.target.value) || 0))) })),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: probabilityEnabled, onChange: event => patchExtension('useProbability', event.target.checked, ['use_probability']) }), h('span', null, '启用概率'))),
                h('div', { className: 'dst-inline-fields' },
                  h(Field, { label: '条目扫描深度（留空继承）' }, h('input', { type: 'number', min: 0, max: 100, step: 1, value: worldbookExtension(entry, 'scan_depth', ['scanDepth']) ?? '', onChange: event => patchExtension('scan_depth', event.target.value === '' ? undefined : Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0))), ['scanDepth']) })),
                  h(Field, { label: '延迟到递归层级' }, h('input', { type: 'number', min: 0, step: 1, value: worldbookExtension(entry, 'delay_until_recursion', ['delayUntilRecursion']) ?? 0, onChange: event => patchExtension('delay_until_recursion', Math.max(0, Math.trunc(Number(event.target.value) || 0)), ['delayUntilRecursion']) }))),
                h('div', { className: 'dst-inline-fields' },
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'exclude_recursion', ['excludeRecursion']) === true, onChange: event => patchExtension('exclude_recursion', event.target.checked, ['excludeRecursion']) }), h('span', null, '递归扫描时排除此条目')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'prevent_recursion', ['preventRecursion']) === true, onChange: event => patchExtension('prevent_recursion', event.target.checked, ['preventRecursion']) }), h('span', null, '此内容不触发后续递归')),
                  h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: worldbookExtension(entry, 'ignore_budget', ['ignoreBudget']) === true, onChange: event => patchExtension('ignore_budget', event.target.checked, ['ignoreBudget']) }), h('span', null, '忽略预算'))),
                position === undefined && !positionIsMissing ? h('p', { className: 'dst-warning' }, `当前 Position ${positionPlaceholder}；保存其他设置不会改写它。请从上方列表选择支持的位置以转换。`) : null,
                position === 4 ? h('div', { className: 'dst-inline-fields' },
                  h(Field, { label: '@Depth 深度' }, h('input', { type: 'number', min: 0, step: 1, value: depthValue, onChange: event => patchExtension('depth', event.target.value === '' ? 4 : Math.max(0, Math.trunc(Number(event.target.value) || 0))) })),
                  h(Field, { label: '@Depth 角色' }, h('select', { value: Number(worldbookExtension(entry, 'role')) || 0, onChange: event => patchExtension('role', Number(event.target.value)) }, h('option', { value: 0 }, 'System'), h('option', { value: 1 }, 'User'), h('option', { value: 2 }, 'Assistant')))) : null,
                position === 7 ? h(React.Fragment, null,
                  h(Field, { label: 'Outlet 名称' }, h('input', { value: worldbookExtension(entry, 'outlet_name', ['outletName', 'outlet']) ?? '', onChange: event => patchExtension('outlet_name', event.target.value, ['outletName', 'outlet']), placeholder: '例如：Lore' })),
                  h('p', { className: 'dst-muted' }, '在提示词模板中使用 {{outlet::名称}} 插入；名称区分大小写，空名称不会生效。')) : null)))))
    }

    function normalizeWorldbookRecord(value) {
      const record = value?.worldbook || value?.record || value || {}
      const book = record.book && typeof record.book === 'object' && !Array.isArray(record.book)
        ? record.book
        : record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? record.data
          : {}
      return { ...record, id: String(record.id || ''), name: String(record.name || book.name || ''), book: { ...book, name: String(record.name || book.name || '') } }
    }

    function WorldbookEditor({ sessionId, worldbook, diagnostics, reload }) {
      const normalized = normalizeWorldbookRecord(worldbook)
      const initial = normalized.book
      const keySequence = React.useRef(0)
      const [book, setBook] = React.useState(() => ({ ...initial }))
      const [entryRows, setEntryRows] = React.useState(() => (Array.isArray(initial.entries) ? initial.entries : []).map(entry => ({ uiKey: `worldbook-entry-${++keySequence.current}`, value: entry })))
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const updateBook = React.useCallback((key, value) => setBook(previous => {
        const next = { ...previous }
        if (value === undefined) delete next[key]
        else next[key] = value
        return next
      }), [])
      const updateEntry = React.useCallback((rowKey, updater) => setEntryRows(previous => previous.map(row => row.uiKey === rowKey ? { ...row, value: updater(row.value) } : row)), [])
      const removeEntry = React.useCallback((rowKey, label) => {
        if (!window.confirm(`确定删除世界书条目“${label}”吗？`)) return
        setEntryRows(previous => previous.filter(row => row.uiKey !== rowKey))
      }, [])
      const addEntry = () => setEntryRows(previous => {
        const numericIds = previous.map(row => Number(row.value.id)).filter(Number.isFinite)
        const orders = previous.map(row => Number(row.value.insertion_order)).filter(Number.isFinite)
        const entry = {
          id: numericIds.length > 0 ? Math.max(...numericIds) + 1 : 0,
          keys: [], secondary_keys: [], comment: '', content: '', enabled: true,
          constant: false, selective: false, insertion_order: orders.length > 0 ? Math.max(...orders) + 10 : 100,
           extensions: { position: 1, vectorized: false, useProbability: false, probability: 100, depth: 4, role: 0 },
        }
        return [...previous, { uiKey: `worldbook-entry-${++keySequence.current}`, value: entry }]
      })
      const save = async () => {
        setBusy(true)
        try {
          const characterBook = {
            ...book,
            entries: entryRows.map(row => row.value),
            extensions: book.extensions && typeof book.extensions === 'object' && !Array.isArray(book.extensions) ? book.extensions : {},
          }
          await api('/worldbook/update', { method: 'POST', body: JSON.stringify({ sessionId, worldbookId: normalized.id, patch: { name: String(characterBook.name || '').trim(), book: characterBook } }) })
          setStatus('已保存世界书'); overlay.changed(); reload()
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
        finally { setBusy(false) }
      }
      const nonNegativeInteger = value => value === '' ? undefined : Math.max(0, Math.trunc(Number(value) || 0))
      const diagnosticWarnings = Array.isArray(diagnostics?.warnings) ? diagnostics.warnings : []
      const diagnosticBudget = diagnostics?.budget
      const diagnosticTime = typeof diagnostics?.generatedAt === 'string' ? new Date(diagnostics.generatedAt) : undefined
      const diagnosticTimeLabel = diagnosticTime !== undefined && Number.isFinite(diagnosticTime.getTime()) ? diagnosticTime.toLocaleString() : ''
      return h('div', { className: 'dst-worldbook' },
        h('p', { className: 'dst-muted' }, '编辑工作区内独立保存的世界书资源。修改会影响所有引用该世界书的角色卡与 Session。未显示的字段与 extensions 会原样保留。'),
        diagnostics === null || diagnostics === undefined
          ? h('p', { className: 'dst-muted' }, '尚无生成诊断；完成一次模型请求后，这里会显示实际激活条目、预算和运行时警告。')
          : h('section', { className: 'dst-worldbook-book' },
              h('strong', null, '最近一次生成诊断'),
              h('p', { className: 'dst-muted' }, `${diagnosticTimeLabel ? `${diagnosticTimeLabel} · ` : ''}激活 ${Array.isArray(diagnostics.activeEntryIds) ? diagnostics.activeEntryIds.length : 0} 个条目 · 预算 ${Number(diagnosticBudget?.usedTokens) || 0}/${Number(diagnosticBudget?.tokens) || 0}${diagnosticBudget?.overflowed === true ? ' · 已达到上限' : ''}`),
              diagnosticWarnings.length === 0
                ? h('p', { className: 'dst-muted' }, '最近一次组装未发现世界书警告。')
                : h('div', { className: 'dst-warning' }, h('strong', null, `运行时警告（${diagnosticWarnings.length}）`), h('ul', null, diagnosticWarnings.map((warning, index) => h('li', { key: `${index}:${warning}` }, warning))))),
        h('section', { className: 'dst-worldbook-book' },
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '世界书名称' }, h('input', { value: book.name ?? '', onChange: event => updateBook('name', event.target.value) })),
            h(Field, { label: '扫描深度' }, h('input', { type: 'number', min: 0, max: 100, step: 1, value: book.scan_depth ?? '', placeholder: '使用默认值', onChange: event => updateBook('scan_depth', event.target.value === '' ? undefined : Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0)))) })),
            h(Field, { label: '书内 Token 上限（留空=不额外限制，0=禁用）' }, h('input', { type: 'number', min: 0, step: 1, value: book.token_budget ?? '', placeholder: '不额外限制', onChange: event => updateBook('token_budget', nonNegativeInteger(event.target.value)) }))),
          h('p', { className: 'dst-muted' }, '该上限只会收紧按模型上下文比例计算的世界书预算，不会提高全局预算；设为 0 时仅“忽略预算”的条目仍可插入。'),
          h(Field, { label: '描述' }, h('textarea', { rows: 3, value: book.description ?? '', onChange: event => updateBook('description', event.target.value) })),
          h('label', { className: 'dst-worldbook-check dst-worldbook-setting' }, h('input', { type: 'checkbox', checked: book.recursive_scanning === true, onChange: event => updateBook('recursive_scanning', event.target.checked) }), h('span', null, '递归扫描（Recursive Scanning）'))),
        h('div', { className: 'dst-worldbook-list-head' },
          h('strong', null, `条目（${entryRows.length}）`),
          h(Button, { className: 'small', onClick: addEntry }, '新增条目')),
        entryRows.length === 0 ? h('p', { className: 'dst-muted' }, '世界书还没有条目。') : null,
        h('div', { className: 'dst-worldbook-list' }, entryRows.map((row, index) => h(WorldbookEntryEditor, { key: row.uiKey, rowKey: row.uiKey, index, entry: row.value, onChange: updateEntry, onRemove: removeEntry }))),
        h('div', { className: 'dst-actions dst-worldbook-save' }, h(Button, { disabled: busy, onClick: () => void save() }, busy ? '保存中…' : '保存世界书'), h('span', { className: 'dst-muted' }, status)))
    }

    function WorldbookTab({ session, library, editorSelection, onEditorSelection, reload }) {
      const worldbooks = Array.isArray(library?.worldbooks) ? library.worldbooks : []
      const boundWorldbookId = String(session.binding?.worldbookId || session.worldbookId || '')
      const inheritedWorldbookId = session.binding?.worldbookExplicit === true ? '' : String(session.card?.defaultWorldbookId || '')
      const currentWorldbookId = boundWorldbookId || inheritedWorldbookId
      const editorWorldbookId = editorSelection === null || editorSelection === undefined ? currentWorldbookId || String(worldbooks[0]?.id || '') : editorSelection
      const [editorRevision, setEditorRevision] = React.useState(0)
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [deleteDialog, setDeleteDialog] = React.useState(null)
      const editorState = useAsync(signal => editorWorldbookId
        ? api(`/worldbook?sessionId=${encodeURIComponent(session.sessionId)}&id=${encodeURIComponent(editorWorldbookId)}`, { signal })
        : null, [session.sessionId, editorWorldbookId, editorRevision])
      React.useEffect(() => {
        const available = editorWorldbookId !== '' && worldbooks.some(item => String(item.id) === editorWorldbookId)
        if (available) return
        const fallback = worldbooks.some(item => String(item.id) === currentWorldbookId) ? currentWorldbookId : String(worldbooks[0]?.id || '')
        if (fallback !== editorWorldbookId) onEditorSelection(fallback)
      }, [editorWorldbookId, currentWorldbookId, worldbooks.map(item => item.id).join('|')])
      const create = async () => {
        const name = window.prompt('新世界书名称：', 'New Worldbook')
        if (name === null) return
        if (name.trim() === '') { setStatus('世界书名称不能为空。'); return }
        setBusy(true)
        try {
          const result = await api('/worldbook/create', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, name: name.trim(), book: { name: name.trim(), description: '', entries: [], extensions: {} } }) })
          const created = normalizeWorldbookRecord(result)
          setStatus(`已创建“${created.name || name.trim()}”。`)
          if (created.id) onEditorSelection(created.id)
          overlay.changed(); reload()
        } catch (error) { setStatus(`创建失败：${error instanceof Error ? error.message : String(error)}`) }
        finally { setBusy(false) }
      }
      const bind = async value => {
        setBusy(true)
        try {
          await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, patch: { worldbookId: value || null } }) })
          setStatus(value ? '已更新当前 Session 的世界书引用。' : '当前 Session 已不引用世界书。')
          overlay.changed(); reload()
        } catch (error) { setStatus(`绑定失败：${error instanceof Error ? error.message : String(error)}`) }
        finally { setBusy(false) }
      }
      const remove = async confirm => {
        const target = deleteDialog?.worldbook
        if (!target) return
        setBusy(true)
        try {
          await api('/worldbook/delete', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, worldbookId: target.id, ...(confirm ? { confirm: true } : {}) }) })
          setStatus(`已删除“${target.name || '未命名世界书'}”，并移除所有角色卡和 Session 对它的引用。`)
          if (editorWorldbookId === target.id) onEditorSelection(null)
          setDeleteDialog(null)
          overlay.changed(); reload()
        } catch (error) {
          if (error?.code === 'worldbook-references-required') {
            const references = error.details?.references || {}
            setDeleteDialog(previous => ({ ...previous, references, inspected: true, error: '' }))
            setStatus('该世界书仍有引用，请核对后再次确认删除。')
          } else {
            setDeleteDialog(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }))
            setStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`)
          }
        } finally { setBusy(false) }
      }
      const selectedSummary = worldbooks.find(item => String(item.id) === editorWorldbookId)
      const diagnostics = editorWorldbookId !== '' && editorWorldbookId === currentWorldbookId ? session.worldbookDiagnostics : null
      return h('div', { className: 'dst-worldbook-manager' },
        h('div', { className: 'dst-section-title' }, '工作区全局世界书'),
        h('section', { className: 'dst-worldbook-controls' },
          h(Field, { label: '正在编辑的世界书（只切换编辑器，不改变 Session）' }, h('select', { value: editorWorldbookId, disabled: busy, onChange: event => onEditorSelection(event.target.value) },
            worldbooks.length === 0 ? h('option', { value: '' }, '暂无世界书') : null,
            worldbooks.map(worldbook => h('option', { key: worldbook.id, value: worldbook.id }, worldbook.name || '未命名世界书')))),
          h('div', { className: 'dst-actions dst-worldbook-resource-actions' },
            h(Button, { className: 'secondary', disabled: busy, onClick: () => void create() }, '新建世界书'),
            h(Button, { className: 'danger', disabled: busy || !selectedSummary, onClick: () => setDeleteDialog({ worldbook: selectedSummary, references: null, inspected: false, error: '' }) }, '删除正在编辑的世界书')),
          h(Field, { label: '当前 Session 引用的世界书（与上方编辑选择相互独立）' }, h('select', { value: currentWorldbookId, disabled: busy || !session.card, onChange: event => void bind(event.target.value) },
            h('option', { value: '' }, '不使用世界书'),
            worldbooks.map(worldbook => h('option', { key: worldbook.id, value: worldbook.id }, `${worldbook.name || '未命名世界书'}${boundWorldbookId === '' && inheritedWorldbookId === String(worldbook.id) ? '（角色默认，首次消息时继承）' : ''}`)))),
          h('p', { className: 'dst-muted' }, session.card ? 'Session 保存的是世界书 ID 引用；两个 Session 引用同一本世界书时，编辑该资源会同时影响它们。' : '当前 Session 尚未选择角色卡；仍可管理全局世界书，但暂时不能建立 Session 引用。')),
        status ? h('p', { className: 'dst-status' }, status) : null,
        editorWorldbookId === '' ? h('p', { className: 'dst-muted' }, '请新建或选择一个世界书。') : null,
        editorState.loading ? h('p', { className: 'dst-loading' }, '正在读取世界书…') : null,
        editorState.error ? h('p', { className: 'dst-error' }, editorState.error) : null,
        editorState.value ? h(WorldbookEditor, { key: `${editorWorldbookId}:${editorRevision}`, sessionId: session.sessionId, worldbook: editorState.value, diagnostics, reload: () => { setEditorRevision(value => value + 1); reload() } }) : null,
        deleteDialog ? h(ConfirmPanel, {
          title: `删除世界书“${deleteDialog.worldbook.name || '未命名世界书'}”`,
          busy,
          confirmLabel: deleteDialog.inspected ? '确认删除并移除引用' : '检查引用并删除',
          onConfirm: () => void remove(deleteDialog.inspected === true),
          onCancel: () => setDeleteDialog(null),
        },
        h('p', null, '删除后，所有角色卡的默认世界书和所有 Session 的世界书引用都会自动清空。此操作不可撤销。'),
        deleteDialog.error ? h('p', { className: 'dst-error' }, deleteDialog.error) : null,
        deleteDialog.inspected ? h(React.Fragment, null,
          h('p', { className: 'dst-warning' }, '以下对象正在引用该世界书。继续删除会移除它们的引用：'),
          h(ReferenceList, { title: '角色卡', references: deleteDialog.references?.cards }),
          h(ReferenceList, { title: 'Session', references: deleteDialog.references?.sessions })) : null) : null)
    }

    function MemoryScalar({ value }) {
      if (value === null) return h('span', { className: 'dst-memory-scalar null' }, '空值')
      if (typeof value === 'boolean') return h('span', { className: `dst-memory-scalar boolean ${value ? 'true' : 'false'}` }, value ? '是' : '否')
      if (typeof value === 'number') return h('span', { className: 'dst-memory-scalar number' }, String(value))
      if (typeof value === 'string') return h('span', { className: `dst-memory-scalar string${value === '' ? ' empty' : ''}` }, value === '' ? '空字符串' : value)
      return h('span', { className: 'dst-memory-scalar' }, String(value))
    }

    function MemoryValue({ value, depth = 0 }) {
      if (value === null || typeof value !== 'object') return h(MemoryScalar, { value })
      const array = Array.isArray(value)
      const entries = array ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value)
      if (entries.length === 0) return h('span', { className: 'dst-memory-empty' }, array ? '空列表' : '空对象')
      const content = h(array ? 'ol' : 'dl', { className: array ? 'dst-memory-array' : 'dst-memory-fields' }, entries.map(([name, item]) => array
        ? h('li', { key: name }, h(MemoryValue, { value: item, depth: depth + 1 }))
        : h('div', { className: 'dst-memory-field', key: name }, h('dt', null, name), h('dd', null, h(MemoryValue, { value: item, depth: depth + 1 })))))
      if (depth === 0) return content
      return h('details', { className: 'dst-memory-nested', open: depth === 1 },
        h('summary', null, array ? `${entries.length} 项` : `${entries.length} 个字段`), content)
    }

    const MEMORY_STORY_TIME_STATUS_LABELS = Object.freeze({ unknown: '未知', 'label-only': '仅标签', normalized: '已标准化' })
    const MEMORY_RECALL_POLICY_LABELS = Object.freeze({ always: '始终自动召回', after_compaction: '剧情折叠后自动召回', query_only: '仅显式查询' })
    const MEMORY_SOURCE_ROLE_LABELS = Object.freeze({ user: '用户', assistant: '助手', system: '系统' })

    function memoryCharacters(input) {
      return [...new Set(String(input ?? '').split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
    }

    function memoryKeywords(input) {
      return [...new Set(String(input ?? '').split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
    }

    function memoryLocation(input) {
      const text = String(input ?? '').trim()
      if (text === '') return null
      const path = text.split('/').map(segment => segment.trim())
      if (path.some(segment => segment === '')) throw new Error('地点路径不能包含空层级')
      return path
    }

    function memoryLocationText(location) {
      return Array.isArray(location) && location.length > 0 ? location.join(' / ') : '未记录'
    }

    function memoryTimeNumber(input) {
      return String(input).trim() === '' ? NaN : Number(input)
    }

    function memoryStoryTimeText(storyTime) {
      const time = storyTime && typeof storyTime === 'object' ? storyTime : {}
      const status = ['unknown', 'label-only', 'normalized'].includes(time.state) ? time.state : 'unknown'
      const parts = [MEMORY_STORY_TIME_STATUS_LABELS[status], time.label, time.timeline]
      const range = [time.start, time.end].filter(item => item != null && String(item).trim() !== '').map(item => String(item).trim()).join(' – ')
      if (range !== '') parts.push(range)
      return parts.filter(item => item != null && String(item).trim() !== '').join(' · ')
    }

    function memoryRecallPolicyText(recallPolicy) {
      return MEMORY_RECALL_POLICY_LABELS[recallPolicy] || MEMORY_RECALL_POLICY_LABELS.after_compaction
    }

    function memorySourceRefsText(sourceRefs) {
      const refs = Array.isArray(sourceRefs) ? sourceRefs : []
      if (refs.length === 0) return '无来源记录'
      const shown = refs.slice(0, 3).map(ref => {
        const parts = []
        if (Number.isSafeInteger(ref?.eventSeq)) parts.push(`#${ref.eventSeq}`)
        if (Number.isSafeInteger(ref?.turn)) parts.push(`第 ${ref.turn} 回合`)
        if (typeof ref?.role === 'string' && ref.role !== '') parts.push(MEMORY_SOURCE_ROLE_LABELS[ref.role] || ref.role)
        return parts.length > 0 ? parts.join(' · ') : '未知来源'
      })
      if (refs.length > shown.length) shown.push(`另 ${refs.length - shown.length} 条`)
      return shown.join('；')
    }

    function memoryEventGraph(rows, eventEdges) {
      const nodesById = new Map()
      const ungroupedRows = []
      for (const row of rows) {
        const eventId = typeof row?.eventId === 'string' ? row.eventId.trim() : ''
        if (eventId === '') {
          ungroupedRows.push(row)
          continue
        }
        let node = nodesById.get(eventId)
        if (node === undefined) {
          node = { eventId, rows: [], predecessors: [], successors: [] }
          nodesById.set(eventId, node)
        }
        node.rows.push(row)
      }
      for (const edge of eventEdges) {
        if (edge?.kind !== 'precedes') continue
        const predecessorEventId = String(edge.predecessorEventId ?? '').trim()
        const successorEventId = String(edge.successorEventId ?? '').trim()
        const predecessor = nodesById.get(predecessorEventId)
        const successor = nodesById.get(successorEventId)
        if (predecessor !== undefined) predecessor.successors.push({ eventId: successorEventId, edge })
        if (successor !== undefined) successor.predecessors.push({ eventId: predecessorEventId, edge })
      }
      return { nodes: [...nodesById.values()], ungroupedRows }
    }

    function MemoryRow({ row, remove }) {
      return h('article', { className: 'dst-memory-row' },
        h('header', { className: 'dst-memory-row-head' },
          h('div', { className: 'dst-memory-identity' }, h('span', { className: 'dst-memory-table-name' }, row.table), h('strong', null, row.key)),
          h('div', { className: 'dst-memory-meta' },
            h('span', null, `重要度 ${Math.round(Number(row.importance ?? 0.5) * 100)}%`),
            Array.isArray(row.keywords) && row.keywords.length > 0 ? h('div', { className: 'dst-memory-keywords' }, row.keywords.map(keyword => h('span', { key: keyword }, keyword))) : null)),
        h('div', { className: 'dst-memory-context' },
          h('span', null, `召回：${memoryRecallPolicyText(row.recallPolicy)}`),
          h('span', { className: 'dst-memory-provenance' }, `来源：${memorySourceRefsText(row.sourceRefs)}`),
          h('span', null, `剧情时间：${memoryStoryTimeText(row.storyTime)}`),
          h('span', null, `地点：${memoryLocationText(row.location)}`),
          h('span', null, `人物：${Array.isArray(row.characters) && row.characters.length > 0 ? row.characters.join('、') : '未记录'}`),
          row.eventId ? h('span', null, `事件组：${row.eventId}`) : null),
        h('div', { className: 'dst-memory-value' }, h(MemoryValue, { value: row.value })),
        h('footer', { className: 'dst-memory-row-actions' },
          h('details', { className: 'dst-memory-raw' }, h('summary', null, '查看原始 JSON'), h('pre', null, JSON.stringify(row.value, null, 2))),
          h(Button, { className: 'danger small', onClick: () => void remove(row.id) }, '删除')))
    }

    function MemoryEventRelationList({ title, relations }) {
      return h('div', { className: 'dst-memory-event-relations' },
        h('strong', null, title),
        relations.length === 0 ? h('span', { className: 'dst-muted' }, '无') : h('ul', null, relations.map((relation, index) => h('li', { key: relation.edge?.id || `${relation.eventId}:${index}` },
          h('code', null, relation.eventId),
          relation.edge?.reason ? h('span', null, ` · ${relation.edge.reason}`) : null,
          Array.isArray(relation.edge?.sourceRefs) && relation.edge.sourceRefs.length > 0
            ? h('small', null, `来源：${memorySourceRefsText(relation.edge.sourceRefs)}`)
            : null))))
    }

    function MemoryEventGraph({ graph, remove }) {
      return h('section', { className: 'dst-memory-event-section' },
        h('div', { className: 'dst-memory-section-head' },
          h('div', { className: 'dst-section-title' }, '事件关系'),
          h('span', { className: 'dst-muted' }, '按事件组聚合记忆，并展示直接先后关系')),
        graph.nodes.length === 0 ? h('div', { className: 'dst-memory-event-empty dst-muted' }, '尚无已分组的记忆事件。') : null,
        h('div', { className: 'dst-memory-event-graph' }, graph.nodes.map(node => h('article', { className: 'dst-memory-event-node', key: node.eventId },
          h('header', { className: 'dst-memory-event-head' }, h('strong', null, `事件 ${node.eventId}`), h('span', { className: 'dst-muted' }, `${node.rows.length} 条记忆`)),
          h('div', { className: 'dst-memory-event-links' },
            h(MemoryEventRelationList, { title: '直接前置事件', relations: node.predecessors }),
            h(MemoryEventRelationList, { title: '直接后续事件', relations: node.successors })),
          h('div', { className: 'dst-memory-table dst-memory-event-rows' }, node.rows.map(row => h(MemoryRow, { key: row.id, row, remove })))))))
    }

    function MemoryTab({ session, reload }) {
      const [table, setTable] = React.useState('events')
      const [key, setKey] = React.useState('')
      const [value, setValue] = React.useState('{}')
      const [keywords, setKeywords] = React.useState('')
      const [storyTimeStatus, setStoryTimeStatus] = React.useState('unknown')
      const [storyTimeLabel, setStoryTimeLabel] = React.useState('')
      const [storyTimeTimeline, setStoryTimeTimeline] = React.useState('')
      const [storyTimeStart, setStoryTimeStart] = React.useState('')
      const [storyTimeEnd, setStoryTimeEnd] = React.useState('')
      const [location, setLocation] = React.useState('')
      const [characters, setCharacters] = React.useState('')
      const [eventId, setEventId] = React.useState('')
      const [recallPolicy, setRecallPolicy] = React.useState('after_compaction')
      const [status, setStatus] = React.useState('')
      const rows = session.memory?.rows || []
      const eventEdges = session.memory?.eventEdges || []
      const graph = React.useMemo(() => memoryEventGraph(rows, eventEdges), [rows, eventEdges])
      const add = async () => {
        try {
          const parsed = JSON.parse(value)
          const storyTime = storyTimeStatus === 'unknown'
            ? { state: 'unknown', label: null, timeline: null, start: null, end: null }
            : storyTimeStatus === 'label-only'
              ? { state: 'label-only', label: storyTimeLabel.trim(), timeline: null, start: null, end: null }
              : { state: 'normalized', label: storyTimeLabel.trim() || null, timeline: storyTimeTimeline.trim(), start: memoryTimeNumber(storyTimeStart), end: memoryTimeNumber(storyTimeEnd) }
          await api('/memory', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, operation: { action: 'upsert', expectedRevision: session.memory?.revision ?? 0, table, key, value: parsed, keywords: memoryKeywords(keywords), importance: 0.6, recallPolicy, sourceRefs: [], storyTime: storyTime, location: memoryLocation(location), characters: memoryCharacters(characters), eventId: eventId.trim() || undefined } }) })
          setKey(''); setValue('{}'); setKeywords(''); setStoryTimeStatus('unknown'); setStoryTimeLabel(''); setStoryTimeTimeline(''); setStoryTimeStart(''); setStoryTimeEnd(''); setLocation(''); setCharacters(''); setEventId(''); setRecallPolicy('after_compaction'); setStatus('已写入'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message); reload() }
      }
      const remove = async id => {
        const row = rows.find(item => item.id === id)
        const eventId = typeof row?.eventId === 'string' ? row.eventId : ''
        const removesEventNode = eventId !== '' && rows.filter(item => item.eventId === eventId).length === 1
        const edgeDeletes = removesEventNode
          ? eventEdges.filter(edge => edge.predecessorEventId === eventId || edge.successorEventId === eventId).map(edge => ({ action: 'event_edge_delete', id: edge.id }))
          : []
        const change = edgeDeletes.length === 0
          ? { action: 'delete', id }
          : { action: 'batch', operations: [...edgeDeletes, { action: 'delete', id }] }
        const operation = { ...change, expectedRevision: session.memory?.revision ?? 0 }
        try {
          await api('/memory', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, operation }) })
          setStatus('已删除'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message); reload() }
      }
      return h('div', null,
        h('div', { className: 'dst-section-title' }, `长期记忆表格（修订 ${session.memory?.revision || 0}）`),
        h('div', { className: 'dst-inline-fields' },
          h(Field, { label: '表名' }, h('input', { value: table, onChange: event => setTable(event.target.value) })),
          h(Field, { label: '键' }, h('input', { value: key, onChange: event => setKey(event.target.value) }))),
        h(Field, { label: '关键词（2–10 个，逗号或换行分隔，必须逐字来自助手正文）' }, h('textarea', { rows: 2, value: keywords, onChange: event => setKeywords(event.target.value) })),
        h(Field, { label: '结构化值（JSON 对象）' }, h('textarea', { rows: 4, value, onChange: event => setValue(event.target.value) })),
        h('div', { className: 'dst-memory-context-form' },
          h('div', { className: 'dst-section-title' }, '剧情上下文'),
          h(Field, { label: '剧情时间状态' }, h('select', { value: storyTimeStatus, onChange: event => setStoryTimeStatus(event.target.value) },
            h('option', { value: 'unknown' }, '未知'),
            h('option', { value: 'label-only' }, '仅标签'),
            h('option', { value: 'normalized' }, '已标准化'))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '时间标签（label）' }, h('input', { value: storyTimeLabel, onChange: event => setStoryTimeLabel(event.target.value) })),
            h(Field, { label: '时间线（timeline）' }, h('input', { value: storyTimeTimeline, onChange: event => setStoryTimeTimeline(event.target.value) }))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '开始（start）' }, h('input', { type: 'number', step: 'any', value: storyTimeStart, onChange: event => setStoryTimeStart(event.target.value) })),
            h(Field, { label: '结束（end）' }, h('input', { type: 'number', step: 'any', value: storyTimeEnd, onChange: event => setStoryTimeEnd(event.target.value) }))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '地点路径（从大到小，以 / 分隔，可留空）' }, h('input', { value: location, placeholder: '东京都外 / 成田机场 / 国际到达大厅', onChange: event => setLocation(event.target.value) })),
            h(Field, { label: '人物（逗号或换行分隔）' }, h('textarea', { rows: 2, value: characters, onChange: event => setCharacters(event.target.value) }))),
          h('div', { className: 'dst-inline-fields' },
            h(Field, { label: '事件组 ID（可选）' }, h('input', { value: eventId, onChange: event => setEventId(event.target.value) })),
            h(Field, { label: '召回策略' }, h('select', { value: recallPolicy, onChange: event => setRecallPolicy(event.target.value) },
              h('option', { value: 'after_compaction' }, '剧情折叠后自动召回'),
              h('option', { value: 'always' }, '始终自动召回'),
              h('option', { value: 'query_only' }, '仅显式查询'))))),
        h('div', { className: 'dst-actions' }, h(Button, { disabled: key.trim() === '', onClick: () => void add() }, '新增/覆盖'), h('span', { className: 'dst-muted' }, status)),
        rows.length === 0 ? h('div', { className: 'dst-memory-empty-state' }, '还没有长期记忆。对话中形成的持久事实会显示在这里。') : null,
        h(MemoryEventGraph, { graph, remove }),
        graph.ungroupedRows.length > 0 ? h('section', { className: 'dst-memory-ungrouped' },
          h('div', { className: 'dst-section-title' }, '未关联事件的记忆'),
          h('div', { className: 'dst-memory-table' }, graph.ungroupedRows.map(row => h(MemoryRow, { key: row.id, row, remove })))) : null)
    }

    function executableScript(script) {
      if (script?.kind !== 'regex') return script
      const source = String(script.source ?? '')
      const fenced = /^\s*```html?\s*([\s\S]*?)```\s*$/i.exec(source)
      return { ...script, kind: 'html', source: fenced === null ? source : fenced[1] }
    }

    function compatibleHtmlSource(source) {
      return String(source)
        .replace(/\b(?:window\.)?parent\.document\.querySelector\(\s*(['"])#send_textarea\1\s*\)/g, 'window.__dshComposerInput')
        .replace(/\b(?:window\.)?parent\.document\.getElementById\(\s*(['"])send_textarea\1\s*\)/g, 'window.__dshComposerInput')
        .replace(/\b(?:window\.)?parent\.document\.querySelector\(\s*(['"])#send_but\1\s*\)/g, 'window.__dshComposerSend')
        .replace(/\b(?:window\.)?parent\.document\.getElementById\(\s*(['"])send_but\1\s*\)/g, 'window.__dshComposerSend')
        .replace(/\b(?:window\.)?parent\.(?:\$|jQuery)\(\s*(['"])#send_textarea\1\s*\)/g, 'window.__dshComposerJquery("#send_textarea")')
        .replace(/\b(?:window\.)?parent\.(?:\$|jQuery)\(\s*(['"])#send_but\1\s*\)/g, 'window.__dshComposerJquery("#send_but")')
    }

    function installCompatibilityRuntime(root, initialSnapshot, channel, metadata) {
      const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
      const deepFreeze = value => {
        if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
        for (const child of Object.values(value)) deepFreeze(child)
        return Object.freeze(value)
      }
      const assignArray = (target, values) => { target.splice(0, target.length, ...clone(values || [])) }
      const assignObject = (target, value) => {
        for (const key of Object.keys(target)) delete target[key]
        Object.assign(target, clone(value || {}))
      }
      class CompatibilityUnavailableError extends Error {
        constructor(capability, reason) { super(`${capability} is unavailable: ${reason}`); this.name = 'CompatibilityUnavailableError'; this.code = 'dsh-compat-unavailable'; this.capability = capability }
      }
      let snapshot = clone(initialSnapshot || {})
      let seq = 0
      let listenerSeq = 0
      let disposed = false
      const pending = new Map()
      const listeners = new Map()
      const chat = []
      const characters = []
      const chatMetadata = {}
      if (metadata?.surface === 'message') root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'compat-event', payload: { name: 'message_iframe_render_started', args: [String(metadata.scriptId || channel)] } }, '*')
      const getBucket = name => {
        const key = String(name)
        if (!listeners.has(key)) listeners.set(key, [])
        return listeners.get(key)
      }
      const removeRecord = record => {
        const bucket = listeners.get(record.name)
        if (!bucket) return
        const index = bucket.indexOf(record)
        if (index >= 0) bucket.splice(index, 1)
        if (bucket.length === 0) listeners.delete(record.name)
      }
      const addListener = (name, fn, priority, once) => {
        if (typeof fn !== 'function') throw new TypeError('event listener must be a function')
        const bucket = getBucket(name)
        const existing = bucket.find(record => record.fn === fn)
        if (existing) return Object.freeze({ stop: () => removeRecord(existing) })
        const record = { name: String(name), fn, priority, once, order: ++listenerSeq }
        bucket.push(record)
        bucket.sort((left, right) => left.priority - right.priority || left.order - right.order)
        return Object.freeze({ stop: () => removeRecord(record) })
      }
      const dispatch = async (name, args) => {
        const bucket = [...(listeners.get(String(name)) || [])]
        for (const record of bucket) {
          if (record.once) removeRecord(record)
          await record.fn(...args)
        }
      }
      const eventOn = (name, fn) => addListener(name, fn, 0, false)
      const eventMakeFirst = (name, fn) => addListener(name, fn, -1, false)
      const eventMakeLast = (name, fn) => addListener(name, fn, 1, false)
      const eventOnce = (name, fn) => addListener(name, fn, 0, true)
      const eventRemoveListener = (name, fn) => {
        for (const record of [...(listeners.get(String(name)) || [])]) if (record.fn === fn) removeRecord(record)
      }
      const eventClearEvent = name => listeners.delete(String(name))
      const eventClearListener = fn => { for (const bucket of [...listeners.values()]) for (const record of [...bucket]) if (record.fn === fn) removeRecord(record) }
      const eventClearAll = () => listeners.clear()
      const eventEmit = async (name, ...args) => {
        await dispatch(name, args)
        root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'compat-event', payload: { name: String(name), args: clone(args) } }, '*')
      }
      const eventEmitAndWait = (name, ...args) => { void eventEmit(name, ...args) }
      const eventSource = Object.freeze({ on: eventOn, makeFirst: eventMakeFirst, makeLast: eventMakeLast, once: eventOnce, removeListener: eventRemoveListener, emit: eventEmit, emitAndWait: eventEmitAndWait })
      const rpc = (action, args = {}, timeout = 5000) => new Promise((resolve, reject) => {
        const id = ++seq
        const timer = root.setTimeout(() => { pending.delete(id); reject(new Error('SillyTavern script RPC timed out')) }, timeout)
        pending.set(id, { resolve, reject, timer })
        try { root.parent.postMessage({ __dshSillyTavern: true, channel, id, action, args }, '*') }
        catch (error) { root.clearTimeout(timer); pending.delete(id); reject(error) }
      })
      const reportWriteError = error => { console.error('[dsh-sillytavern] compatibility write failed', error); void dispatch('dsh_compatibility_error', [error]).catch(next => console.error(next)) }
      const variableType = option => String(option?.type || 'chat')
      const presetKey = () => {
        const ids = Array.isArray(snapshot.state?.binding?.templateIds) ? snapshot.state.binding.templateIds.map(String).sort() : []
        return ids.length === 0 ? 'in_use' : ids.join('\u001f')
      }
      const scriptKey = () => `${String(snapshot.cardRecord?.id || 'none')}\u001f${String(metadata?.scriptId || 'unknown')}`
      const messageIndex = option => {
        const raw = option?.message_id ?? 'latest'
        if (raw === 'latest') {
          for (let index = (snapshot.messages || []).length - 1; index >= 0; index -= 1) if (snapshot.messages[index]?.role !== 'system') return index
          return -1
        }
        const number = Number(raw)
        if (!Number.isSafeInteger(number)) throw new TypeError('message_id must be a safe integer or latest')
        return number < 0 ? (snapshot.messages || []).length + number : number
      }
      const currentMessageIndex = () => {
        if (metadata?.surface !== 'message') return -1
        if (Number.isSafeInteger(metadata.currentSourceSeq)) {
          const index = (snapshot.messages || []).findIndex(message => message.sourceSeq === metadata.currentSourceSeq || message.event_seq === metadata.currentSourceSeq)
          if (index >= 0) return index
        }
        return Number.isSafeInteger(metadata.currentMessageId) ? metadata.currentMessageId : -1
      }
      const readVariableScope = option => {
        const type = variableType(option)
        const maps = snapshot.variableMaps || {}
        if (type === 'chat') return snapshot.variableScopes?.chat ?? snapshot.variables ?? {}
        if (type === 'global') return snapshot.variableScopes?.global ?? snapshot.globalVariables ?? {}
        if (type === 'preset') return maps.presets?.[presetKey()] ?? snapshot.variableScopes?.preset ?? {}
        if (type === 'character') return maps.characters?.[String(snapshot.cardRecord?.id || '')] ?? snapshot.variableScopes?.character ?? {}
        if (type === 'script') return maps.scripts?.[scriptKey()] ?? snapshot.variableScopes?.script ?? {}
        if (type === 'extension') {
          const extensionId = String(option?.extension_id || '')
          if (extensionId === '') throw new TypeError('extension_id is required for extension variables')
          return maps.extensions?.[extensionId] ?? {}
        }
        if (type === 'message') {
          const message = (snapshot.messages || [])[messageIndex(option)]
          if (!message) throw new RangeError('message_id is outside the current chat')
          return message.data && typeof message.data === 'object' && !Array.isArray(message.data) ? message.data : {}
        }
        throw new TypeError(`unknown variable scope ${type}`)
      }
      const writeVariableScope = (option, variables) => {
        const type = variableType(option)
        const value = clone(variables)
        snapshot.variableScopes ||= {}
        snapshot.variableMaps ||= {}
        snapshot.variableScopes[type] = value
        if (type === 'chat') {
          snapshot.variables = value
          if (snapshot.state?.binding) snapshot.state.binding.variables = value
        } else if (type === 'global') {
          snapshot.globalVariables = value
          snapshot.variableMaps.global = value
        } else if (type === 'preset') {
          snapshot.variableMaps.presets ||= {}; snapshot.variableMaps.presets[presetKey()] = value
        } else if (type === 'character') {
          snapshot.variableMaps.characters ||= {}; snapshot.variableMaps.characters[String(snapshot.cardRecord?.id || '')] = value
        } else if (type === 'script') {
          snapshot.variableMaps.scripts ||= {}; snapshot.variableMaps.scripts[scriptKey()] = value
        } else if (type === 'extension') {
          const extensionId = String(option?.extension_id || '')
          if (extensionId === '') throw new TypeError('extension_id is required for extension variables')
          snapshot.variableMaps.extensions ||= {}; snapshot.variableMaps.extensions[extensionId] = value
        } else if (type === 'message') {
          const index = messageIndex(option)
          if (!(snapshot.messages || [])[index]) throw new RangeError('message_id is outside the current chat')
          snapshot.messages[index].data = value
        } else throw new TypeError(`unknown variable scope ${type}`)
      }
      const getVariables = option => clone(readVariableScope(option))
      const replaceVariables = (variables, option) => {
        if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) throw new TypeError('replaceVariables expects an object')
        writeVariableScope(option, variables)
        syncContext()
        void rpc('replaceVariables', { variables: clone(variables), option: clone(option || { type: 'chat' }), scriptId: metadata?.scriptId }).catch(reportWriteError)
      }
      const updateVariablesWith = (updater, option) => {
        if (typeof updater !== 'function') throw new TypeError('updateVariablesWith expects a function')
        const value = updater(getVariables(option))
        if (value && typeof value.then === 'function') return value.then(next => { replaceVariables(next, option); return next })
        replaceVariables(value, option)
        return value
      }
      const mergeVariables = (target, source) => {
        if (Array.isArray(source)) return clone(source)
        if (source === null || typeof source !== 'object') return clone(source)
        const result = target !== null && typeof target === 'object' && !Array.isArray(target) ? clone(target) : {}
        for (const [key, value] of Object.entries(source)) result[key] = Array.isArray(value) ? clone(value) : value !== null && typeof value === 'object' ? mergeVariables(result[key], value) : clone(value)
        return result
      }
      const insertOrAssignVariables = (variables, option) => { const next = mergeVariables(getVariables(option), variables || {}); replaceVariables(next, option); return next }
      const insertVariables = (variables, option) => {
        const next = mergeVariables(variables || {}, getVariables(option))
        replaceVariables(next, option)
        return next
      }
      const deleteVariable = (path, option) => {
        const next = getVariables(option)
        const parts = []
        String(path ?? '').replace(/[^.[\]]+|\[(?:(['"])((?:(?!\1)[^\\]|\\.)*?)\1|([^\]]*))\]/g, (match, quote, quoted, bare) => {
          parts.push(String(quote ? quoted.replace(/\\(['"\\])/g, '$1') : bare === undefined ? match : bare.trim()))
          return match
        })
        let parent = next
        let delete_occurred = false
        for (const key of parts.slice(0, -1)) {
          if (parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, key)) { parent = null; break }
          parent = parent[key]
        }
        const key = parts.at(-1)
        if (parent !== null && parent !== undefined && typeof parent === 'object' && key !== undefined && Object.hasOwn(parent, key)) {
          delete_occurred = true
          delete parent[key]
        }
        replaceVariables(next, option)
        return { variables: getVariables(option), delete_occurred }
      }
      const getAllVariables = () => {
        const result = {
          ...getVariables({ type: 'global' }),
          ...getVariables({ type: 'character' }),
        }
        if (metadata?.surface !== 'message') Object.assign(result, getVariables({ type: 'script' }))
        Object.assign(result, getVariables())
        if (metadata?.surface === 'message') {
          const end = currentMessageIndex()
          for (const message of (snapshot.messages || []).slice(0, end + 1)) {
            const variables = message?.data
            if (variables && typeof variables === 'object' && !Array.isArray(variables)) Object.assign(result, variables)
          }
        }
        return clone(result)
      }
      const injectionFilters = new Map()
      const ownedInjectionIds = new Set()
      const normalizedInjection = prompt => ({
        id: String(prompt?.id || `dsh-injection-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        position: prompt?.position === 'none' ? 'none' : 'in_chat',
        depth: Number.isFinite(Number(prompt?.depth)) ? Number(prompt.depth) : 0,
        role: ['system', 'assistant', 'user'].includes(prompt?.role) ? prompt.role : 'system',
        content: String(prompt?.content ?? prompt?.text ?? ''),
        text: String(prompt?.content ?? prompt?.text ?? ''),
        order: Number.isFinite(Number(prompt?.order)) ? Number(prompt.order) : 0,
        should_scan: prompt?.should_scan === true,
        once: false,
        ownerFrameId: channel,
        hasFilter: typeof prompt?.filter === 'function',
      })
      const uninjectPrompts = ids => {
        const values = [...new Set((Array.isArray(ids) ? ids : [ids]).map(String))]
        snapshot.scriptInjections = (snapshot.scriptInjections || []).filter(item => !values.includes(String(item.id)))
        for (const id of values) { injectionFilters.delete(id); ownedInjectionIds.delete(id) }
        void rpc('uninjectPrompts', { ids: values }).catch(reportWriteError)
      }
      const injectPrompts = (prompts, options = {}) => {
        if (!Array.isArray(prompts)) throw new TypeError('injectPrompts expects an array')
        const normalized = prompts.map(normalizedInjection)
        for (let index = 0; index < normalized.length; index += 1) {
          normalized[index].once = options?.once === true
          ownedInjectionIds.add(normalized[index].id)
          if (typeof prompts[index]?.filter === 'function') injectionFilters.set(normalized[index].id, prompts[index].filter)
        }
        const ids = normalized.map(item => item.id)
        const byId = new Map((snapshot.scriptInjections || []).map(item => [String(item.id), item]))
        for (const item of normalized) byId.set(item.id, item)
        snapshot.scriptInjections = [...byId.values()]
        void rpc('injectPrompts', { prompts: normalized, options: clone(options) }).catch(reportWriteError)
        let active = true
        return Object.freeze({ uninject() { if (!active) return; active = false; uninjectPrompts(ids) } })
      }
      const activeGenerations = new Set()
      const prepareGenerationConfig = async config => {
        const eligibleInjectionIds = []
        for (const item of snapshot.scriptInjections || []) {
          const filter = injectionFilters.get(String(item.id))
          if (typeof filter !== 'function') {
            if (item.hasFilter !== true) eligibleInjectionIds.push(String(item.id))
            continue
          }
          if (await filter()) eligibleInjectionIds.push(String(item.id))
        }
        return { ...clone(config || {}), __dshEligibleInjectionIds: eligibleInjectionIds }
      }
      const runGeneration = async (mode, config = {}) => {
        const prepared = await prepareGenerationConfig(config)
        const generationId = String(prepared.generation_id || `dsh-generation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        prepared.generation_id = generationId
        if (activeGenerations.has(generationId)) throw new Error(`generation ${generationId} is already active`)
        activeGenerations.add(generationId)
        try {
          const result = await rpc('generate', { mode, config: prepared }, 5 * 60 * 1000)
          const onceIds = (snapshot.scriptInjections || []).filter(item => item.once === true && prepared.__dshEligibleInjectionIds.includes(String(item.id))).map(item => String(item.id))
          if (onceIds.length > 0) uninjectPrompts(onceIds)
          return result
        } finally { activeGenerations.delete(generationId) }
      }
      const generate = config => runGeneration('preset', config)
      const generateRaw = config => runGeneration('raw', config)
      const stopGenerationById = generationId => {
        const id = String(generationId ?? '')
        if (!activeGenerations.has(id)) return false
        void rpc('stopGeneration', { generationId: id }).catch(reportWriteError)
        return true
      }
      const stopAllGeneration = () => {
        if (activeGenerations.size === 0) return false
        void rpc('stopAllGeneration').catch(reportWriteError)
        return true
      }
      const getModelList = customApi => rpc('getModelList', { provider: String(customApi?.source || '') })
      const macroLikes = []
      const namedMacros = new Map()
      const registerMacroLike = (regex, replace) => {
        if (!(regex instanceof RegExp) && Object.prototype.toString.call(regex) !== '[object RegExp]') throw new TypeError('macro regex must be a RegExp')
        if (typeof replace !== 'function') throw new TypeError('macro replacement must be a function')
        if (!macroLikes.some(item => item.regex.source === regex.source)) macroLikes.push({ regex: new RegExp(regex.source, regex.flags), replace })
        let active = true
        return Object.freeze({ unregister() { if (!active) return; active = false; unregisterMacroLike(regex) } })
      }
      const unregisterMacroLike = regex => {
        if (!(regex instanceof RegExp) && Object.prototype.toString.call(regex) !== '[object RegExp]') throw new TypeError('macro regex must be a RegExp')
        const index = macroLikes.findIndex(item => item.regex.source === regex.source)
        if (index >= 0) macroLikes.splice(index, 1)
      }
      const macroContext = extra => {
        const messageId = currentMessageIndex()
        return { ...(messageId >= 0 ? { message_id: messageId } : {}), ...extra }
      }
      const substituteParams = (input, userName, characterName) => {
        let text = String(input ?? '')
        const builtin = {
          user: String(userName ?? snapshot.context?.name1 ?? snapshot.persona?.name ?? 'User'),
          char: String(characterName ?? snapshot.context?.name2 ?? snapshot.character?.nickname ?? snapshot.character?.name ?? 'Character'),
          lastMessageId: String(Math.max(-1, (snapshot.messages || []).length - 1)),
          lastMessage: String((snapshot.messages || []).at(-1)?.message ?? ''),
        }
        text = text.replace(/{{\s*([^{}]+?)\s*}}/g, (substring, key) => {
          const name = String(key).trim()
          if (Object.hasOwn(builtin, name)) return builtin[name]
          const registered = namedMacros.get(name)
          if (registered === undefined) return substring
          return typeof registered === 'function' ? String(registered('')) : String(registered)
        })
        const contextValue = macroContext({})
        for (const item of macroLikes) {
          const regex = new RegExp(item.regex.source, item.regex.flags)
          text = text.replace(regex, (substring, ...args) => String(item.replace(contextValue, substring, ...args)))
        }
        return text
      }
      const registerMacro = (key, value) => { namedMacros.set(String(key), value) }
      const unregisterMacro = key => { namedMacros.delete(String(key)) }
      const pathParts = path => {
        if (Array.isArray(path)) return path.map(String)
        const parts = []
        String(path ?? '').replace(/[^.[\]]+|\[(?:(['"])((?:(?!\1)[^\\]|\\.)*?)\1|([^\]]*))\]/g, (match, quote, quoted, bare) => {
          parts.push(String(quote ? quoted.replace(/\\(['"\\])/g, '$1') : bare === undefined ? match : bare.trim()))
          return match
        })
        return parts
      }
      const lodashGet = (object, path, fallback) => {
        let value = object
        for (const key of pathParts(path)) {
          if (value === null || value === undefined || !Object.hasOwn(Object(value), key)) return fallback
          value = value[key]
        }
        return value
      }
      const lodashSet = (object, path, value) => {
        const parts = pathParts(path)
        let target = object
        for (let index = 0; index < parts.length; index += 1) {
          const key = parts[index]
          if (index === parts.length - 1) target[key] = value
          else {
            const nextArray = /^\d+$/.test(parts[index + 1])
            if (target[key] === null || typeof target[key] !== 'object') target[key] = nextArray ? [] : {}
            target = target[key]
          }
        }
        return object
      }
      const lodashUnset = (object, path) => {
        const parts = pathParts(path)
        let target = object
        for (const key of parts.slice(0, -1)) {
          if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) return true
          target = target[key]
        }
        return parts.length === 0 || target === null || typeof target !== 'object' ? true : delete target[parts.at(-1)]
      }
      const lodashMerge = (target, ...sources) => {
        for (const source of sources) {
          if (source === null || typeof source !== 'object') continue
          for (const [key, value] of Object.entries(source)) {
            if (Array.isArray(value)) target[key] = clone(value)
            else if (value !== null && typeof value === 'object') target[key] = lodashMerge(target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {}, value)
            else target[key] = value
          }
        }
        return target
      }
      const lodash = value => {
        let current = value
        const chain = {
          assign(...values) { current = Object.assign(current, ...values); return chain },
          map(fn) { current = Array.from(current || []).map(fn); return chain },
          sortBy(key) { current = Array.from(current || []).sort((left, right) => String(lodashGet(left, key, '')).localeCompare(String(lodashGet(right, key, '')))); return chain },
          values() { current = Object.values(current || {}); return chain },
          reject(fn) { current = Array.from(current || []).filter((item, index) => !fn(item, index)); return chain },
          value() { return current },
        }
        return chain
      }
      Object.assign(lodash, {
        get: lodashGet, set: lodashSet, unset: lodashUnset, has: (object, path) => lodashGet(object, path, Symbol.for('missing')) !== Symbol.for('missing'),
        cloneDeep: clone, merge: lodashMerge, assign: Object.assign, isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
        inRange: (value, start, end) => value >= Math.min(start, end === undefined ? 0 : start) && value < Math.max(start, end === undefined ? start : end),
        times: (count, fn) => Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => fn(index)), constant: value => () => value,
        range: (start, end) => { if (end === undefined) { end = start; start = 0 } return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index) },
        toString: value => value == null ? '' : String(value), random: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
        concat: (...values) => values.flat(), isNull: value => value === null, pick: (object, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object || {}, key)).map(key => [key, object[key]])),
        omitBy: (object, fn) => Object.fromEntries(Object.entries(object || {}).filter(([key, value]) => !fn(value, key))), clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      })
      const jquery = selector => {
        const nodes = selector === undefined || selector === null ? [] : selector === root || selector?.nodeType ? [selector] : Array.isArray(selector) ? selector.filter(Boolean) : Array.from(root.document.querySelectorAll(String(selector)))
        const wrapper = {
          length: nodes.length,
          get: index => nodes[index],
          each(fn) { nodes.forEach((node, index) => fn.call(node, index, node)); return wrapper },
          find(query) { return jquery(nodes.flatMap(node => Array.from(node.querySelectorAll(query)))) },
          val(value) { if (arguments.length === 0) return nodes[0]?.value; nodes.forEach(node => { node.value = value }); return wrapper },
          prop(name, value) { if (arguments.length === 1) return nodes[0]?.[name]; nodes.forEach(node => { node[name] = value }); return wrapper },
          attr(name, value) { if (arguments.length === 1) return nodes[0]?.getAttribute?.(name); nodes.forEach(node => node.setAttribute?.(name, value)); return wrapper },
          text(value) { if (arguments.length === 0) return nodes[0]?.textContent; nodes.forEach(node => { node.textContent = value }); return wrapper },
          html(value) { if (arguments.length === 0) return nodes[0]?.innerHTML; nodes.forEach(node => { node.innerHTML = value }); return wrapper },
          append(value) { nodes.forEach(node => node.insertAdjacentHTML?.('beforeend', String(value))); return wrapper },
          on(name, handler) { nodes.forEach(node => node.addEventListener?.(name, handler)); return wrapper },
          off(name, handler) { nodes.forEach(node => node.removeEventListener?.(name, handler)); return wrapper },
          trigger(name) { nodes.forEach(node => node.dispatchEvent?.(new Event(name, { bubbles: true }))); return wrapper },
          click(handler) { if (handler) return wrapper.on('click', handler); nodes.forEach(node => node.click?.()); return wrapper },
          focus() { nodes[0]?.focus?.(); return wrapper },
          add(other) { return jquery([...nodes, ...(other?.get ? Array.from({ length: other.length }, (_, index) => other.get(index)) : [])]) },
          addClass(name) { nodes.forEach(node => node.classList?.add(...String(name).split(/\s+/))); return wrapper },
          removeClass(name) { nodes.forEach(node => node.classList?.remove(...String(name).split(/\s+/))); return wrapper },
          data(name, value) { if (arguments.length === 1) return nodes[0]?.dataset?.[name]; nodes.forEach(node => { if (node.dataset) node.dataset[name] = value }); return wrapper },
        }
        nodes.forEach((node, index) => { wrapper[index] = node })
        return wrapper
      }
      const toast = level => (message, title) => { console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log'](`[${title || level}] ${String(message ?? '')}`); return null }
      const toastr = Object.freeze({ success: toast('success'), info: toast('info'), warning: toast('warning'), error: toast('error'), clear() {} })
      const POPUP_TYPE = Object.freeze({ TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4, CROP: 5 })
      const POPUP_RESULT = Object.freeze({ AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: -1, CUSTOM1: 2, CUSTOM2: 3, CUSTOM3: 4, CUSTOM4: 5, CUSTOM5: 6, CUSTOM6: 7, CUSTOM7: 8, CUSTOM8: 9, CUSTOM9: 10 })
      const popupText = content => typeof content === 'string' ? content : content?.textContent ?? String(content ?? '')
      const callGenericPopup = async (content, type, inputValue) => type === POPUP_TYPE.CONFIRM ? root.confirm(popupText(content)) : type === POPUP_TYPE.INPUT ? root.prompt(popupText(content), inputValue ?? '') ?? undefined : (root.alert(popupText(content)), POPUP_RESULT.AFFIRMATIVE)
      class Popup {
        constructor(content, type = POPUP_TYPE.TEXT, inputValue = '', options = {}) {
          this.content = content
          this.type = type
          this.inputValue = inputValue
          this.options = options
          this.result = POPUP_RESULT.CANCELLED
          this.value = inputValue
          this.dlg = null
        }
        async show() {
          const value = await callGenericPopup(this.content, this.type, this.inputValue, this.options)
          this.value = value
          this.result = value === false || value === undefined ? POPUP_RESULT.NEGATIVE : value === true ? POPUP_RESULT.AFFIRMATIVE : value
          return value
        }
        complete(result = POPUP_RESULT.AFFIRMATIVE) { this.result = result; return result }
        static showConfirm(header, text) { return callGenericPopup([header, text].filter(Boolean).join('\n'), POPUP_TYPE.CONFIRM) }
        static showInput(header, text, inputValue = '') { return callGenericPopup([header, text].filter(Boolean).join('\n'), POPUP_TYPE.INPUT, inputValue) }
        static showText(header, text) { return callGenericPopup([header, text].filter(Boolean).join('\n'), POPUP_TYPE.TEXT) }
      }
      const copyText = text => {
        if (root.navigator.clipboard?.writeText) return root.navigator.clipboard.writeText(String(text))
        const area = root.document.createElement('textarea'); area.value = String(text); root.document.body.append(area); area.select(); root.document.execCommand('copy'); area.remove()
      }
      const audioState = Object.fromEntries(['bgm', 'ambient'].map(type => [type, { playlist: [], src: '', playing: false, progress: 0, settings: { enabled: true, mode: 'repeat', muted: false, volume: 100 }, element: null }]))
      const audioStore = type => { if (!audioState[type]) throw new TypeError('audio type must be bgm or ambient'); return audioState[type] }
      const audioTitle = url => String(url).split('/').at(-1)?.split('.').at(0) || String(url)
      const playAudio = (type, audio) => {
        const store = audioStore(type); const item = { title: audio?.title || audioTitle(audio?.url), url: String(audio?.url || '') }; const existing = store.playlist.find(entry => entry.title === item.title || entry.url === item.url)
        if (existing) Object.assign(existing, item); else store.playlist.push(item); store.src = item.url; store.progress = 0; store.playing = true
        store.element?.pause?.(); store.element = new root.Audio(item.url); store.element.loop = store.settings.mode === 'repeat'; store.element.muted = store.settings.muted; store.element.volume = store.settings.volume / 100; void store.element.play().catch(() => { store.playing = false })
      }
      const pauseAudio = type => { const store = audioStore(type); store.playing = false; store.element?.pause?.() }
      const getAudioList = type => clone(audioStore(type).playlist)
      const replaceAudioList = (type, list) => { audioStore(type).playlist = (list || []).map(item => ({ title: item.title || audioTitle(item.url), url: String(item.url || '') })) }
      const appendAudioList = (type, list) => { audioStore(type).playlist.push(...(list || []).map(item => ({ title: item.title || audioTitle(item.url), url: String(item.url || '') }))) }
      const getAudioSettings = type => clone(audioStore(type).settings)
      const setAudioSettings = (type, settings) => { const store = audioStore(type); Object.assign(store.settings, clone(settings || {})); store.settings.volume = lodash.clamp(Number(store.settings.volume), 0, 100); if (store.element) { store.element.muted = store.settings.muted; store.element.volume = store.settings.volume / 100 } }
      const getCurrentAudio = type => { const store = audioStore(type); return { src: store.src, title: store.playlist.find(item => item.url === store.src)?.title ?? '', playing: store.playing, progress: store.element?.currentTime ?? store.progress } }
      const extensionSettings = {}
      const context = {
        chat,
        characters,
        groups: [],
        name1: 'User',
        name2: 'Character',
        characterId: null,
        groupId: null,
        chatId: String(snapshot.sessionId || ''),
        chatMetadata,
        extensionSettings,
        eventSource,
        eventTypes: null,
        getCurrentChatId: () => context.chatId,
        substituteParams,
        substituteParamsExtended: substituteParams,
        registerMacro,
        unregisterMacro,
        saveSettingsDebounced: () => worldbookRpc({ action: 'save-extension-settings', settings: clone(extensionSettings), expectedRevision: snapshot.variableRevisions?.workspace }),
        callGenericPopup,
        Popup,
        POPUP_TYPE,
        POPUP_RESULT,
        t: (strings, ...values) => Array.isArray(strings?.raw) ? strings.reduce((text, item, index) => text + item + (values[index] ?? ''), '') : String(strings ?? ''),
        translate: text => String(text ?? ''),
        getCurrentLocale: () => root.navigator.language || 'en',
        isMobile: () => /Android|iPhone|iPad|Mobile/i.test(root.navigator.userAgent),
        uuidv4: () => root.crypto?.randomUUID?.() || `dsh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }
      const syncContext = () => {
        assignArray(chat, snapshot.messages)
        assignArray(characters, snapshot.characterCard ? [snapshot.characterCard] : [])
        assignObject(chatMetadata, snapshot.context?.chatMetadata)
        assignObject(extensionSettings, snapshot.extensionSettings)
        context.name1 = String(snapshot.context?.name1 || snapshot.persona?.name || 'User')
        context.name2 = String(snapshot.context?.name2 || snapshot.character?.nickname || snapshot.character?.name || 'Character')
        context.characterId = snapshot.context?.characterId ?? snapshot.cardRecord?.id ?? null
        context.chatId = String(snapshot.context?.chatId || snapshot.sessionId || '')
      }
      const getState = () => clone(snapshot.state || null)
      const getCharacterCard = () => clone(snapshot.characterCard || null)
      const getCurrentWorldbook = () => clone(snapshot.worldbook || null)
      const unavailable = (name, reason) => () => { throw new CompatibilityUnavailableError(name, reason) }
      const getLastMessageId = () => (snapshot.messages || []).length - 1
      const chatRangeIds = range => {
        const length = (snapshot.messages || []).length
        if (range === undefined) range = '0-{{lastMessageId}}'
        if (typeof range === 'number') {
          if (!Number.isSafeInteger(range)) throw new TypeError('message range must be a safe integer')
          const id = range < 0 ? length + range : range
          return id >= 0 && id < length ? [id] : []
        }
        const expanded = String(range).trim().replaceAll('{{lastMessageId}}', String(length - 1))
        if (/^-?\d+$/.test(expanded)) return chatRangeIds(Number(expanded))
        const match = expanded.match(/^(-?\d+)\s*-\s*(-?\d+)$/)
        if (!match) throw new TypeError(`invalid message range ${range}`)
        const begin = Number(match[1]) < 0 ? length + Number(match[1]) : Number(match[1])
        const end = Number(match[2]) < 0 ? length + Number(match[2]) : Number(match[2])
        if (begin > end) throw new RangeError('message range start must not exceed its end')
        const ids = []
        for (let id = Math.max(0, begin); id <= Math.min(length - 1, end); id += 1) ids.push(id)
        return ids
      }
      const getChatMessages = (range, options = {}) => {
        const role = options.role || 'all'
        const hideState = options.hide_state || 'all'
        if (!['all', 'system', 'assistant', 'user'].includes(role)) throw new TypeError('invalid role filter')
        if (!['all', 'hidden', 'unhidden'].includes(hideState)) throw new TypeError('invalid hide_state filter')
        return chatRangeIds(range).map(id => snapshot.messages[id]).filter(Boolean)
          .filter(item => role === 'all' || item.role === role)
          .filter(item => hideState === 'all' || (hideState === 'hidden') === (item.is_hidden === true))
          .map(item => options.include_swipes === true ? {
            message_id: item.message_id,
            name: String(item.name || (item.role === 'user' ? 'User' : item.role === 'system' ? 'System' : 'Character')),
            role: item.role,
            is_hidden: item.is_hidden === true,
            swipe_id: Number(item.swipe_id || 0),
            swipes: clone(item.swipes || [item.message ?? item.mes ?? item.text ?? '']),
            swipes_data: clone(item.swipes_data || [item.data || {}]),
            swipes_info: clone(item.swipes_info || [item.extra || {}]),
          } : {
            message_id: item.message_id,
            name: String(item.name || (item.role === 'user' ? 'User' : item.role === 'system' ? 'System' : 'Character')),
            role: item.role,
            is_hidden: item.is_hidden === true,
            message: String(item.message ?? item.mes ?? item.text ?? ''),
            data: clone(item.data || {}),
            extra: clone(item.extra || {}),
          })
      }
      const mutateChat = mutation => rpc('mutateChat', { mutation }).then(() => undefined)
      const setChatMessages = async (messages, options = {}) => {
        if (metadata?.scriptId === 'opening-html' && (messages || []).some(item => Number(item?.message_id) === 0 && Number.isSafeInteger(Number(item?.swipe_id)))) {
          const selection = await rpc('setChatMessages', { messages: clone(messages || []) })
          await rpc('commitSwipe', { swipe_id: selection?.swipe_id })
          return
        }
        await mutateChat({ action: 'set', messages: clone(messages || []), options: clone(options) })
      }
      const createChatMessages = (messages, options = {}) => mutateChat({ action: 'create', messages: clone(messages || []), options: clone(options) })
      const deleteChatMessages = (messageIds, options = {}) => mutateChat({ action: 'delete', messageIds: clone(messageIds || []), options: clone(options) })
      const rotateChatMessages = (begin, middle, end, options = {}) => mutateChat({ action: 'rotate', begin, middle, end, options: clone(options) })
      const refreshOneMessage = async messageId => { await dispatch((snapshot.messages || [])[messageId]?.role === 'user' ? 'user_message_rendered' : 'character_message_rendered', [messageId, 'normal']) }
      const triggerSlash = command => rpc('triggerSlash', { command: String(command ?? '') })
      const worldbookRevisions = new Map()
      const worldbookRpc = request => rpc('worldbook', { request })
      const getWorldbookNames = () => clone(snapshot.worldbookNames || [])
      const getWorldbookSnapshot = async name => {
        const value = await worldbookRpc({ action: 'get', name: String(name) })
        worldbookRevisions.set(String(name), Number(value.revision || 0))
        return value
      }
      const getWorldbook = async name => clone((await getWorldbookSnapshot(name)).worldbook || [])
      const createWorldbook = (name, entries = []) => worldbookRpc({ action: 'create', name: String(name), entries: clone(entries) })
      const createOrReplaceWorldbook = async (name, entries = [], options = {}) => {
        const key = String(name)
        const value = await worldbookRpc({ action: 'create-or-replace', name: key, entries: clone(entries), expectedRevision: worldbookRevisions.get(key), options: clone(options) })
        worldbookRevisions.delete(key)
        return value
      }
      const replaceWorldbook = async (name, entries, options = {}) => {
        const key = String(name)
        const value = await worldbookRpc({ action: 'replace', name: key, entries: clone(entries), expectedRevision: worldbookRevisions.get(key), options: clone(options) })
        worldbookRevisions.set(key, Number(value.revision || 0))
      }
      const updateWorldbookWith = async (name, updater, options = {}) => {
        if (typeof updater !== 'function') throw new TypeError('updateWorldbookWith expects an updater function')
        const current = await getWorldbook(name)
        const next = await updater(clone(current))
        await replaceWorldbook(name, next, options)
        return getWorldbook(name)
      }
      const createWorldbookEntries = async (name, entries, options = {}) => {
        const key = String(name)
        if (!worldbookRevisions.has(key)) await getWorldbookSnapshot(key)
        const value = await worldbookRpc({ action: 'create-entries', name: key, entries: clone(entries), expectedRevision: worldbookRevisions.get(key), options: clone(options) })
        worldbookRevisions.set(key, Number(value.revision || 0))
        return clone({ worldbook: value.worldbook, new_entries: value.new_entries })
      }
      const deleteWorldbookEntries = async (name, predicate, options = {}) => {
        if (typeof predicate !== 'function') throw new TypeError('deleteWorldbookEntries expects a predicate function')
        const key = String(name)
        const current = await getWorldbookSnapshot(key)
        const deleted = current.worldbook.filter(predicate)
        const value = await worldbookRpc({ action: 'delete-entries', name: key, uids: deleted.map(item => item.uid), expectedRevision: current.revision, options: clone(options) })
        worldbookRevisions.set(key, Number(value.revision || 0))
        return clone({ worldbook: value.worldbook, deleted_entries: value.deleted_entries })
      }
      const deleteWorldbook = async name => {
        const key = String(name)
        const value = await worldbookRpc({ action: 'delete', name: key, expectedRevision: worldbookRevisions.get(key) })
        worldbookRevisions.delete(key)
        return value
      }
      const getGlobalWorldbookNames = () => clone(snapshot.globalWorldbooks || snapshot.lorebookSettings?.selected_global_lorebooks || [])
      const rebindGlobalWorldbooks = names => worldbookRpc({ action: 'rebind-global', names: clone(names || []), expectedRevision: snapshot.variableRevisions?.workspace })
      const getCharWorldbookNames = name => {
        if (name !== undefined && name !== 'current' && name !== snapshot.character?.name && name !== snapshot.character?.nickname) throw new Error(`character '${String(name)}' is unavailable in the current DSH session`)
        return clone(snapshot.characterWorldbooks?.[String(snapshot.cardRecord?.id || '')] || { primary: null, additional: [] })
      }
      const rebindCharWorldbooks = (name, worldbooks) => {
        if (name !== 'current') throw new Error('only the current character can be rebound')
        return worldbookRpc({ action: 'rebind-character', worldbooks: clone(worldbooks || {}), expectedRevision: snapshot.variableRevisions?.workspace })
      }
      const getChatWorldbookName = name => {
        if (name !== 'current') throw new Error('only the current chat is available')
        return snapshot.state?.binding?.worldbookExplicit === true ? snapshot.chatWorldbookName : null
      }
      const rebindChatWorldbook = (name, worldbookName) => {
        if (name !== 'current') throw new Error('only the current chat is available')
        return worldbookRpc({ action: 'rebind-chat', name: worldbookName, bindingRevision: snapshot.bindingRevision })
      }
      const getOrCreateChatWorldbook = (name, worldbookName) => {
        if (name !== 'current') throw new Error('only the current chat is available')
        return worldbookRpc({ action: 'get-or-create-chat', name: worldbookName })
      }
      const getLorebookSettings = () => clone(snapshot.lorebookSettings || {})
      const setLorebookSettings = settings => {
        snapshot.lorebookSettings = { ...(snapshot.lorebookSettings || {}), ...clone(settings || {}) }
        syncContext()
        void worldbookRpc({ action: 'set-lorebook-settings', settings: clone(settings || {}), expectedRevision: snapshot.variableRevisions?.workspace }).catch(reportWriteError)
      }
      const regexSources = () => ({
        global: clone(snapshot.state?.globalRegexScripts || []),
        preset: clone(snapshot.state?.presetRegexScripts || []),
        character: clone((snapshot.cardRecord?.scripts || []).filter(script => script?.kind === 'regex')),
      })
      const toTavernRegex = (script, scope) => ({
        id: String(script?.id || ''),
        script_name: String(script?.name ?? script?.scriptName ?? ''),
        enabled: script?.enabled === true && script?.disabled !== true,
        find_regex: String(script?.findRegex ?? ''),
        trim_strings: clone(Array.isArray(script?.trimStrings) ? script.trimStrings : []),
        replace_string: String(script?.source ?? script?.replaceString ?? ''),
        source: {
          user_input: script?.placement?.includes(1) === true,
          ai_output: script?.placement?.includes(2) === true,
          slash_command: script?.placement?.includes(3) === true,
          world_info: script?.placement?.includes(5) === true,
          reasoning: script?.placement?.includes(6) === true,
        },
        destination: { display: script?.markdownOnly === true, prompt: script?.promptOnly === true },
        run_on_edit: script?.runOnEdit === true,
        min_depth: Number.isFinite(script?.minDepth) ? Number(script.minDepth) : null,
        max_depth: Number.isFinite(script?.maxDepth) ? Number(script.maxDepth) : null,
        ...(scope === undefined ? {} : { scope }),
      })
      const fromTavernRegex = (regex, index) => {
        if (regex === null || typeof regex !== 'object' || Array.isArray(regex)) throw new TypeError(`regexes[${index}] must be an object`)
        const source = regex.source || {}
        const destination = regex.destination || {}
        return {
          id: String(regex.id || `regex-${Date.now()}-${index}`),
          name: String(regex.script_name || `未命名-${regex.id || index}`),
          kind: 'regex',
          enabled: regex.enabled !== false,
          source: String(regex.replace_string ?? ''),
          findRegex: String(regex.find_regex ?? ''),
          trimStrings: clone(Array.isArray(regex.trim_strings) ? regex.trim_strings : []),
          placement: [source.user_input ? 1 : null, source.ai_output ? 2 : null, source.slash_command ? 3 : null, source.world_info ? 5 : null, source.reasoning ? 6 : null].filter(Number.isSafeInteger),
          markdownOnly: destination.display === true,
          promptOnly: destination.prompt === true,
          runOnEdit: regex.run_on_edit === true,
          substituteRegex: 0,
          minDepth: Number.isFinite(regex.min_depth) ? Number(regex.min_depth) : null,
          maxDepth: Number.isFinite(regex.max_depth) ? Number(regex.max_depth) : null,
        }
      }
      const assertCurrentCharacter = name => {
        if (name === undefined || name === 'current' || name === snapshot.character?.name || name === snapshot.character?.nickname) return
        throw new Error(`character '${String(name)}' is unavailable in the current DSH session`)
      }
      const assertCurrentPreset = name => {
        if (name === undefined || name === 'in_use') return
        throw new Error(`preset '${String(name)}' is unavailable in the current DSH session`)
      }
      const getTavernRegexes = option => {
        const sources = regexSources()
        if (option?.type === undefined) {
          const scope = option?.scope || 'all'
          const enableState = option?.enable_state || 'all'
          if (!['all', 'global', 'character'].includes(scope)) throw new Error(`invalid regex scope '${scope}'`)
          if (!['all', 'enabled', 'disabled'].includes(enableState)) throw new Error(`invalid regex enable_state '${enableState}'`)
          let values = [
            ...(scope === 'all' || scope === 'global' ? sources.global.map(script => toTavernRegex(script, 'global')) : []),
            ...(scope === 'all' || scope === 'character' ? sources.character.map(script => toTavernRegex(script, 'character')) : []),
          ]
          if (enableState !== 'all') values = values.filter(regex => regex.enabled === (enableState === 'enabled'))
          return values
        }
        if (option.type === 'global') return sources.global.map(script => toTavernRegex(script))
        if (option.type === 'preset') { assertCurrentPreset(option.name); return sources.preset.map(script => toTavernRegex(script)) }
        if (option.type === 'character') { assertCurrentCharacter(option.name); return sources.character.map(script => toTavernRegex(script)) }
        throw new TypeError(`unknown regex source '${String(option.type)}'`)
      }
      const replaceTavernRegexes = async (regexes, option) => {
        if (!Array.isArray(regexes)) throw new TypeError('replaceTavernRegexes expects an array')
        for (const regex of regexes) if (regex && regex.script_name === '') regex.script_name = `未命名-${regex.id}`
        const changes = {}
        if (option?.type === undefined) {
          const scope = option?.scope || 'all'
          if (!['all', 'global', 'character'].includes(scope)) throw new Error(`invalid regex scope '${scope}'`)
          if (scope === 'all' || scope === 'global') changes.global = regexes.filter(regex => regex?.scope === 'global').map(fromTavernRegex)
          if (scope === 'all' || scope === 'character') changes.character = regexes.filter(regex => regex?.scope !== 'global').map(fromTavernRegex)
        } else if (option.type === 'global') changes.global = regexes.map(fromTavernRegex)
        else if (option.type === 'preset') { assertCurrentPreset(option.name); changes.preset = regexes.map(fromTavernRegex) }
        else if (option.type === 'character') { assertCurrentCharacter(option.name); changes.character = regexes.map(fromTavernRegex) }
        else throw new TypeError(`unknown regex source '${String(option.type)}'`)
        if (Object.hasOwn(changes, 'global')) { snapshot.state ||= {}; snapshot.state.globalRegexScripts = clone(changes.global) }
        if (Object.hasOwn(changes, 'preset')) { snapshot.state ||= {}; snapshot.state.presetRegexScripts = clone(changes.preset) }
        if (Object.hasOwn(changes, 'character') && snapshot.cardRecord) {
          let index = 0
          snapshot.cardRecord.scripts = (snapshot.cardRecord.scripts || []).flatMap(script => script?.kind === 'regex' ? index < changes.character.length ? [changes.character[index++]] : [] : [script])
          snapshot.cardRecord.scripts.push(...changes.character.slice(index))
        }
        await rpc('replaceRegexes', { changes })
      }
      const updateTavernRegexesWith = async (updater, option) => {
        if (typeof updater !== 'function') throw new TypeError('updateTavernRegexesWith expects an updater function')
        const regexes = await updater(getTavernRegexes(option))
        await replaceTavernRegexes(regexes, option)
        return regexes
      }
      const regexFromString = value => {
        const text = String(value ?? '')
        if (!text.startsWith('/')) return null
        let end = text.length - 1
        while (end > 0 && /[dgimsuvy]/.test(text[end])) end -= 1
        if (text[end] !== '/') return null
        return new RegExp(text.slice(1, end), text.slice(end + 1))
      }
      const escapeRegexMacro = value => String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, character => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\f': '\\f', '\0': '\\0' })[character] || `\\${character}`)
      const formatAsTavernRegexedString = (input, source, destination, options = {}) => {
        const placement = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }[source]
        if (placement === undefined) throw new TypeError(`unknown regex source '${String(source)}'`)
        if (!['display', 'prompt'].includes(destination)) throw new TypeError(`unknown regex destination '${String(destination)}'`)
        const original = String(input ?? '')
        let text = original
        for (const script of [...regexSources().global, ...regexSources().preset, ...regexSources().character]) {
          if (script?.enabled !== true || script?.disabled === true || !script?.placement?.includes(placement)) continue
          if (destination === 'display' ? script.markdownOnly !== true : script.promptOnly !== true) continue
          const depth = options.depth
          if (Number.isFinite(depth) && Number.isFinite(script.minDepth) && script.minDepth >= -1 && depth < script.minDepth) continue
          if (Number.isFinite(depth) && Number.isFinite(script.maxDepth) && script.maxDepth >= 0 && depth > script.maxDepth) continue
          let pattern = String(script.findRegex ?? '')
          if (Number(script.substituteRegex) === 1) pattern = substituteParams(pattern, undefined, options.character_name)
          else if (Number(script.substituteRegex) === 2) pattern = pattern.replace(/{{\s*([^{}]+?)\s*}}/g, token => escapeRegexMacro(substituteParams(token, undefined, options.character_name)))
          const matcher = regexFromString(pattern)
          if (!matcher || text === '') continue
          const replacement = String(script.source ?? script.replaceString ?? '').replace(/{{match}}/gi, '$0')
          text = text.replace(matcher, function () {
            const args = [...arguments]
            return substituteParams(replacement.replace(/\$(\d+)|\$<([^>]+)>/g, (_token, number, groupName) => {
              const groups = args.at(-1)
              const value = number ? args[Number(number)] : groups && typeof groups === 'object' ? groups[groupName] : undefined
              if (!value) return ''
              let trimmed = String(value)
              for (const rawTrim of script.trimStrings || []) trimmed = trimmed.replaceAll(substituteParams(rawTrim, undefined, options.character_name), '')
              return trimmed
            }), undefined, options.character_name)
          })
        }
        return substituteParams(text, undefined, options.character_name)
      }
      const isCharacterTavernRegexesEnabled = () => snapshot.cardRecord !== null && snapshot.cardRecord !== undefined
      const getCompatibility = () => clone(snapshot.compatibility || {})
      const dsh = Object.freeze({ getState, getCharacterCard, getCurrentWorldbook, memory: operation => rpc('memory', { operation }), flushWrites: () => rpc('flushWrites') })
      const helper = {
        compatibility: deepFreeze(clone(snapshot.compatibility || {})),
        getCompatibility,
        getTavernHelperVersion: () => '4.9.3',
        getScriptId: () => metadata?.scriptId || channel,
        getVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables, insertVariables, deleteVariable, getAllVariables,
        injectPrompts, uninjectPrompts,
        eventOn, eventMakeFirst, eventMakeLast, eventOnce, eventEmit, eventEmitAndWait, eventRemoveListener, eventClearEvent, eventClearListener, eventClearAll,
        getChatMessages, getLastMessageId, setChatMessages, createChatMessages, deleteChatMessages, rotateChatMessages, refreshOneMessage, triggerSlash, triggerSlashWithResult: triggerSlash,
        getWorldbookNames, getGlobalWorldbookNames, rebindGlobalWorldbooks, getCharWorldbookNames, rebindCharWorldbooks, getChatWorldbookName, rebindChatWorldbook, getOrCreateChatWorldbook,
        getWorldbook, createWorldbook, createOrReplaceWorldbook, deleteWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries,
        getLorebookSettings, setLorebookSettings, getLorebooks: getWorldbookNames, getLorebook: getWorldbook, createLorebook: name => createWorldbook(name), deleteLorebook: deleteWorldbook,
        registerMacroLike, unregisterMacroLike, formatAsTavernRegexedString, getTavernRegexes, replaceTavernRegexes, updateTavernRegexesWith, isCharacterTavernRegexesEnabled,
        playAudio, pauseAudio, getAudioList, replaceAudioList, appendAudioList, getAudioSettings, setAudioSettings, getCurrentAudio,
        copyText, callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT,
        generate, generateRaw, stopGenerationById, stopAllGeneration, getModelList, getProxyPresetNames: () => (snapshot.state?.templates || []).map(item => String(item.name || item.id)),
        getState, getCharacterCard,
        setVariables: variables => { replaceVariables(variables); return dsh.flushWrites() },
        memory: dsh.memory,
        dsh,
      }
      for (const name of ['executeSlashCommands', 'importRawCharacter', 'registerGlobalMacro']) helper[name] = unavailable(name, 'not implemented by the compatibility runtime')
      const tavernEvents = Object.freeze({
        APP_READY: 'app_ready', EXTRAS_CONNECTED: 'extras_connected', MESSAGE_SWIPED: 'message_swiped', MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_DELETED: 'message_deleted', MESSAGE_UPDATED: 'message_updated', MESSAGE_FILE_EMBEDDED: 'message_file_embedded', MESSAGE_REASONING_EDITED: 'message_reasoning_edited', MESSAGE_REASONING_DELETED: 'message_reasoning_deleted', MESSAGE_SWIPE_DELETED: 'message_swipe_deleted', MORE_MESSAGES_LOADED: 'more_messages_loaded', IMPERSONATE_READY: 'impersonate_ready', CHAT_CHANGED: 'chat_id_changed', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS', GENERATION_STARTED: 'generation_started', GENERATION_STOPPED: 'generation_stopped', GENERATION_ENDED: 'generation_ended', SD_PROMPT_PROCESSING: 'sd_prompt_processing', EXTENSIONS_FIRST_LOAD: 'extensions_first_load', EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded', SETTINGS_LOADED: 'settings_loaded', SETTINGS_UPDATED: 'settings_updated', MOVABLE_PANELS_RESET: 'movable_panels_reset', SETTINGS_LOADED_BEFORE: 'settings_loaded_before', SETTINGS_LOADED_AFTER: 'settings_loaded_after', CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed', CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed', OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before', OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after', OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready', OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready', WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated', WORLDINFO_UPDATED: 'worldinfo_updated', CHARACTER_EDITOR_OPENED: 'character_editor_opened', CHARACTER_EDITED: 'character_edited', CHARACTER_PAGE_LOADED: 'character_page_loaded', USER_MESSAGE_RENDERED: 'user_message_rendered', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', FORCE_SET_BACKGROUND: 'force_set_background', CHAT_DELETED: 'chat_deleted', CHAT_CREATED: 'chat_created', GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts', GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts', GENERATE_AFTER_DATA: 'generate_after_data', WORLD_INFO_ACTIVATED: 'world_info_activated', TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready', CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected', CHARACTER_DELETED: 'characterDeleted', CHARACTER_DUPLICATED: 'character_duplicated', CHARACTER_RENAMED: 'character_renamed', CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat', SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received', STREAM_TOKEN_RECEIVED: 'stream_token_received', STREAM_REASONING_DONE: 'stream_reasoning_done', FILE_ATTACHMENT_DELETED: 'file_attachment_deleted', WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate', OPEN_CHARACTER_LIBRARY: 'open_character_library', ONLINE_STATUS_CHANGED: 'online_status_changed', IMAGE_SWIPED: 'image_swiped', CONNECTION_PROFILE_LOADED: 'connection_profile_loaded', CONNECTION_PROFILE_CREATED: 'connection_profile_created', CONNECTION_PROFILE_DELETED: 'connection_profile_deleted', CONNECTION_PROFILE_UPDATED: 'connection_profile_updated', TOOL_CALLS_PERFORMED: 'tool_calls_performed', TOOL_CALLS_RENDERED: 'tool_calls_rendered', CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown', SECRET_WRITTEN: 'secret_written', SECRET_DELETED: 'secret_deleted', SECRET_ROTATED: 'secret_rotated', SECRET_EDITED: 'secret_edited', PRESET_CHANGED: 'preset_changed', PRESET_DELETED: 'preset_deleted', PRESET_RENAMED: 'preset_renamed', PRESET_RENAMED_BEFORE: 'preset_renamed_before', MAIN_API_CHANGED: 'main_api_changed', WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', WORLDINFO_SCAN_DONE: 'worldinfo_scan_done', MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
      })
      const iframeEvents = Object.freeze({
        MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started', MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended', GENERATION_STARTED: 'js_generation_started', STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully', STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally', GENERATION_ENDED: 'js_generation_ended',
      })
      context.eventTypes = tavernEvents
      const sillyTavern = context
      sillyTavern.getContext = () => sillyTavern
      syncContext()
      root.TavernHelper = helper
      root.SillyTavern = sillyTavern
      root.tavern_events = tavernEvents
      root.event_types = tavernEvents
      root.iframe_events = iframeEvents
      root.eventSource = eventSource
      root._ = lodash
      root.$ = root.jQuery = jquery
      root.toastr = toastr
      root.copyText = copyText
      root.substituteParams = root.substituteParamsExtended = substituteParams
      root.extension_settings = extensionSettings
      for (const name of ['getVariables', 'replaceVariables', 'updateVariablesWith', 'insertOrAssignVariables', 'insertVariables', 'deleteVariable', 'getAllVariables', 'setVariables', 'injectPrompts', 'uninjectPrompts', 'eventOn', 'eventMakeFirst', 'eventMakeLast', 'eventOnce', 'eventEmit', 'eventEmitAndWait', 'eventRemoveListener', 'eventClearEvent', 'eventClearListener', 'eventClearAll', 'getChatMessages', 'getLastMessageId', 'setChatMessages', 'createChatMessages', 'deleteChatMessages', 'rotateChatMessages', 'refreshOneMessage', 'triggerSlash', 'triggerSlashWithResult', 'generate', 'generateRaw', 'stopGenerationById', 'stopAllGeneration', 'getModelList', 'getProxyPresetNames', 'getWorldbookNames', 'getGlobalWorldbookNames', 'rebindGlobalWorldbooks', 'getCharWorldbookNames', 'rebindCharWorldbooks', 'getChatWorldbookName', 'rebindChatWorldbook', 'getOrCreateChatWorldbook', 'getWorldbook', 'createWorldbook', 'createOrReplaceWorldbook', 'deleteWorldbook', 'replaceWorldbook', 'updateWorldbookWith', 'createWorldbookEntries', 'deleteWorldbookEntries', 'getLorebookSettings', 'setLorebookSettings', 'getLorebooks', 'getLorebook', 'createLorebook', 'deleteLorebook', 'registerMacroLike', 'unregisterMacroLike', 'formatAsTavernRegexedString', 'getTavernRegexes', 'replaceTavernRegexes', 'updateTavernRegexesWith', 'isCharacterTavernRegexesEnabled', 'playAudio', 'pauseAudio', 'getAudioList', 'replaceAudioList', 'appendAudioList', 'getAudioSettings', 'setAudioSettings', 'getCurrentAudio', 'copyText', 'callGenericPopup']) root[name] = helper[name]
      root.Popup = Popup
      root.POPUP_TYPE = POPUP_TYPE
      root.POPUP_RESULT = POPUP_RESULT
      let composerDraft = ''
      let composerRestore = []
      let composerQueue = Promise.resolve()
      const readComposerDraft = () => [...composerRestore, composerDraft].filter(value => value.trim() !== '').join('\n')
      Object.defineProperty(root, '__dshComposerInput', { configurable: true, value: Object.freeze({
        get value() { return readComposerDraft() },
        set value(value) { composerRestore = []; composerDraft = String(value ?? '') },
        dispatchEvent() {
          const text = readComposerDraft().trim()
          if (text === '') return true
          composerDraft = ''; composerRestore = []
          composerQueue = composerQueue.then(() => rpc('appendInput', { text })).catch(error => { composerRestore.push(text); console.error('SillyTavern composer bridge failed:', error) })
          return true
        },
        focus() { return true },
        click() { return this.dispatchEvent() },
      }) })
      Object.defineProperty(root, '__dshComposerSend', { configurable: true, value: Object.freeze({ click: () => root.__dshComposerInput.dispatchEvent(), dispatchEvent: () => root.__dshComposerInput.dispatchEvent(), focus: () => true }) })
      Object.defineProperty(root, '__dshComposerJquery', { configurable: true, value: selector => {
        const target = selector === '#send_but' ? root.__dshComposerSend : root.__dshComposerInput
        const wrapper = {
          0: target,
          length: 1,
          val(value) { if (arguments.length === 0) return root.__dshComposerInput.value; root.__dshComposerInput.value = value; return wrapper },
          trigger() { target.dispatchEvent(); return wrapper },
          click() { target.click(); return wrapper },
          focus() { target.focus(); return wrapper },
        }
        return wrapper
      } })
      root.addEventListener('message', event => {
        const message = event.data
        if (event.source !== root.parent || !message || message.__dshSillyTavern !== true || message.channel !== channel) return
        if (message.replyTo) {
          const item = pending.get(message.replyTo)
          if (!item) return
          pending.delete(message.replyTo)
          root.clearTimeout(item.timer)
          message.ok ? item.resolve(message.value) : item.reject(Object.assign(new Error(message.error || 'RPC failed'), { code: message.code }))
          return
        }
        if (message.event === 'compat-state') {
          const next = message.payload
          if (!next || Number(next.runtimeRevision) <= Number(snapshot.runtimeRevision || 0)) return
          snapshot = clone(next)
          syncContext()
          return
        }
        if (message.event === 'compat-event') {
          const name = String(message.payload?.name ?? '')
          const args = Array.isArray(message.payload?.args) ? message.payload.args : []
          if (name !== '') void dispatch(name, args).catch(error => console.error('[dsh-sillytavern] event listener failed', error))
        }
      })
      root.addEventListener('pagehide', () => {
        if (ownedInjectionIds.size > 0) {
          try { root.parent.postMessage({ __dshSillyTavern: true, channel, id: ++seq, action: 'uninjectPrompts', args: { ids: [...ownedInjectionIds] } }, '*') } catch {}
        }
        if (activeGenerations.size > 0) {
          try { root.parent.postMessage({ __dshSillyTavern: true, channel, id: ++seq, action: 'stopAllGeneration', args: {} }, '*') } catch {}
        }
        injectionFilters.clear(); ownedInjectionIds.clear(); activeGenerations.clear()
        disposed = true
        listeners.clear()
        for (const item of pending.values()) { root.clearTimeout(item.timer); item.reject(new Error('SillyTavern frame was disposed')) }
        pending.clear()
      }, { once: true })
      root.__dshTavernReady = () => {
        if (disposed || root.__dshTavernDidReady) return
        root.__dshTavernDidReady = true
        if (metadata?.surface === 'message') void dispatch('message_iframe_render_ended', [String(metadata.scriptId || channel)]).catch(error => console.error(error))
        void dispatch(tavernEvents.APP_READY, []).catch(error => console.error('[dsh-sillytavern] APP_READY listener failed', error))
        root.parent.postMessage({ __dshSillyTavern: true, channel, event: 'frame-ready' }, '*')
      }
      return { dispatch, getSnapshot: () => clone(snapshot) }
    }

    function inlineJson(value) {
      return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    }

    function compatibilityBootstrap(channel, initialSnapshot, metadata) {
      return `<script>(${installCompatibilityRuntime.toString()})(window,${inlineJson(initialSnapshot)},${JSON.stringify(channel)},${inlineJson(metadata)})<\/script>`
    }

    function trustedDocument(script, channel, initialSnapshot, metadata) {
      script = executableScript(script)
      const bootstrap = compatibilityBootstrap(channel, initialSnapshot, { ...metadata, scriptId: script.id })
      const sizing = `<script>(()=>{const bridgeChannel=${JSON.stringify(channel)};let frame=0,last=-1,observer;const measure=()=>{frame=0;const root=document.documentElement,body=document.body;const height=Math.ceil(Math.max(root?.offsetHeight||0,body?.scrollHeight||0,body?.offsetHeight||0));if(Number.isFinite(height)&&height>0&&height!==last){last=height;parent.postMessage({__dshSillyTavern:true,channel:bridgeChannel,event:'frame-resize',payload:{height}},'*')}};const schedule=()=>{if(frame===0)frame=requestAnimationFrame(measure)};addEventListener('load',schedule,{once:true});document.fonts?.ready?.then(schedule,()=>{});if(typeof ResizeObserver==='function'){observer=new ResizeObserver(schedule);observer.observe(document.documentElement);if(document.body)observer.observe(document.body)}schedule()})()<\/script>`
      const ready = `<script>window.__dshTavernReady?.()<\/script>`
      if (script.kind === 'html') {
        const source = compatibleHtmlSource(script.source)
        if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(source)) {
          const withBootstrap = /<head[\s>]/i.test(source)
            ? source.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}${sizing}`)
            : source.replace(/<html([^>]*)>/i, `<html$1><head>${bootstrap}${sizing}</head>`)
          if (/<\/body>/i.test(withBootstrap)) return withBootstrap.replace(/<\/body>/i, `${ready}</body>`)
          if (/<\/html>/i.test(withBootstrap)) return withBootstrap.replace(/<\/html>/i, `${ready}</html>`)
          return `${withBootstrap}${ready}`
        }
        return `<!doctype html><html><head>${bootstrap}${sizing}</head><body>${source}${ready}</body></html>`
      }
      const encoded = btoa(unescape(encodeURIComponent(String(script.source))))
      const runner = `<script>(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const source=new TextDecoder().decode(bytes);const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));try{await import(url);window.__dshTavernReady?.()}finally{URL.revokeObjectURL(url)}})().catch(error=>{document.body.innerHTML='<pre style="color:#b91c1c;white-space:pre-wrap"></pre>';document.querySelector('pre').textContent=error.stack||String(error)})<\/script>`
      return `<!doctype html><html><head><meta charset="utf-8">${bootstrap}${sizing}<style>body{font:14px/1.5 system-ui;margin:12px;color:#172033}pre{white-space:pre-wrap}</style></head><body><div id="app"></div>${runner}</body></html>`
    }

    function mergeSessionEventState(previous, value) {
      const bySeq = new Map([...(previous?.history || []), ...(value.history || [])].map(message => [message.seq, message]))
      const history = [...bySeq.values()].sort((left, right) => left.seq - right.seq).slice(-100)
      return {
        card: value.card,
        history,
        messages: Array.isArray(value.messages) ? value.messages : previous?.messages,
        cursor: Number.isSafeInteger(value.cursor) ? value.cursor : previous?.cursor,
        compatChatRevision: Number.isSafeInteger(value.compatChatRevision) ? value.compatChatRevision : previous?.compatChatRevision,
        unavailable: false,
      }
    }

    function useSessionEventState(sessionId) {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        const controller = new AbortController()
        let running = false
        let after = -1
        const poll = async () => {
          if (running || controller.signal.aborted) return
          running = true
          let catchUp = false
          try {
            const previousCursor = after
            const value = await api(`/event-state?sessionId=${encodeURIComponent(sessionId)}&after=${after}`, { signal: controller.signal })
            if (Number.isSafeInteger(value.cursor) && value.cursor > after) after = value.cursor
            catchUp = value.hasMore === true && after > previousCursor
            if (!controller.signal.aborted) setState(previous => mergeSessionEventState(previous, value))
          } catch {
            if (!controller.signal.aborted) setState(previous => ({ ...(previous || { card: null, history: [] }), unavailable: true }))
          } finally {
            running = false
            if (catchUp && !controller.signal.aborted) void poll()
          }
        }
        void poll()
        const interval = window.setInterval(() => { void poll() }, 1500)
        return () => { controller.abort(); window.clearInterval(interval) }
      }, [sessionId])
      return state
    }

    function TrustedFrame({ sessionId, script, eventState, className = 'dst-trusted-frame', title, actions, hidden = false, initialSnapshotOverride = null }) {
      const channel = React.useMemo(() => `dst-${sessionId}-${script.id}-${Math.random().toString(36).slice(2)}`, [sessionId, script.id])
      const frame = React.useRef(null)
      const snapshot = useCompatSnapshot(sessionId)
      const surface = script.id === 'opening-html' ? 'opening' : script.id.startsWith('conversation-') ? 'message' : hidden ? 'background' : 'preview'
      const parsedSourceSeq = surface === 'message' ? Number(script.id.match(/^conversation-(\d+)-/)?.[1]) : null
      const sourceSeq = Number.isSafeInteger(script.sourceSeq) ? script.sourceSeq : parsedSourceSeq
      const currentMessageId = Number.isSafeInteger(sourceSeq) ? (snapshot?.messages || []).findIndex(message => message.sourceSeq === sourceSeq || message.event_seq === sourceSeq) : null
      const messageReady = surface !== 'message' || !Number.isSafeInteger(sourceSeq) || currentMessageId >= 0
      const boot = React.useRef({ channel: null, source: null, snapshot: null, currentMessageId: null })
      if (boot.current.channel !== channel || boot.current.source !== script.source) boot.current = { channel, source: script.source, snapshot: null, currentMessageId: null }
      if (boot.current.snapshot === null && messageReady && (snapshot !== null || initialSnapshotOverride !== null)) {
        boot.current = { channel, source: script.source, snapshot: structuredClone(snapshot ?? initialSnapshotOverride), currentMessageId }
      }
      const [height, setHeight] = React.useState(null)
      const [armedChannel, setArmedChannel] = React.useState(null)
      const actionsRef = React.useRef(actions)
      actionsRef.current = actions
      React.useLayoutEffect(() => {
        setHeight(null)
        const unregister = compatRuntime.register({
          channel,
          sessionId: sessionId ?? '__standalone__',
          scriptId: script.id,
          getWindow: () => frame.current?.contentWindow,
          get actions() { return actionsRef.current },
          onResize: next => setHeight(previous => previous === next ? previous : next),
        })
        setArmedChannel(channel)
        return unregister
      }, [channel, sessionId])
      const runtimeReady = boot.current.snapshot !== null
      const transportReady = typeof window.addEventListener !== 'function' || armedChannel === channel
      const bootMessageId = boot.current.currentMessageId
      const srcDoc = React.useMemo(() => runtimeReady && transportReady ? trustedDocument(script, channel, boot.current.snapshot, { surface, currentMessageId: bootMessageId, currentSourceSeq: sourceSeq }) : '', [channel, script.kind, script.source, runtimeReady, transportReady, surface, bootMessageId, sourceSeq])
      if (!runtimeReady) return null
      return h('iframe', {
        ref: frame,
        className,
        title: title || script.name,
        'aria-label': title || script.name,
        sandbox: 'allow-scripts allow-forms allow-popups allow-downloads allow-modals',
        srcDoc,
        style: hidden ? { display: 'none' } : height === null ? undefined : { height, minHeight: 0 },
      })
    }

    function ScriptPreview({ sessionId, script, sample }) {
      const eventState = useSessionStore(scriptEvents, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const [rendered, setRendered] = React.useState({ status: 'loading', text: '' })
      React.useEffect(() => {
        if (script.kind !== 'regex') { setRendered({ status: 'direct', text: '' }); return undefined }
        if (sample.trim() === '') { setRendered({ status: 'empty', text: '' }); return undefined }
        const controller = new AbortController()
        setRendered({ status: 'loading', text: '' })
        regexEngine.run(sample, [script], controller.signal, { force: true }, scope).then(value => {
          if (!controller.signal.aborted) setRendered(value.applied.length === 0 ? { status: 'unmatched', text: '' } : { status: 'rendered', text: value.text })
        }).catch(error => {
          if (!controller.signal.aborted) setRendered({ status: 'error', text: error instanceof Error ? error.message : String(error) })
        })
        return () => controller.abort()
      }, [sample, script, scope])
      const warning = eventState?.unavailable === true ? h('p', { className: 'dst-error' }, '预览暂时无法读取会话事件。') : null
      if (script.kind !== 'regex') return h(React.Fragment, null, warning, h(TrustedFrame, { sessionId, script, eventState }))
      if (rendered.status === 'empty') return h('p', { className: 'dst-muted' }, '请输入一段用于匹配的预览文本。')
      if (rendered.status === 'loading') return h('p', { className: 'dst-muted' }, '正在运行 Regex 预览…')
      if (rendered.status === 'unmatched') return h('p', { className: 'dst-muted' }, '预览文本未匹配此规则。')
      if (rendered.status === 'error') return h('p', { className: 'dst-error' }, `Regex 预览失败：${rendered.text}`)
      return h(React.Fragment, null, warning, h(RenderedScriptSegments, { sessionId, seq: `preview-${script.id}`, text: rendered.text, eventState, label: `${script.name} 预览` }))
    }

    function ScriptsTab({ session, reload }) {
      const record = session.card
      const [scopeKind, setScopeKind] = React.useState('scoped')
      const [sources, setSources] = React.useState(() => ({ scoped: structuredClone(record?.scripts || []), global: structuredClone(session.globalRegexScripts || []), preset: structuredClone(session.presetRegexScripts || []) }))
      const scripts = sources[scopeKind]
      const setScripts = update => setSources(previous => ({ ...previous, [scopeKind]: typeof update === 'function' ? update(previous[scopeKind]) : update }))
      const [status, setStatus] = React.useState('')
      const [pendingApprovals, setPendingApprovals] = React.useState(() => new Set())
      const [runningIds, setRunningIds] = React.useState(() => new Set())
      const [previewInputs, setPreviewInputs] = React.useState(() => new Map())
      const approvalAttempts = React.useRef(new Map())
      if (!record) return h('p', { className: 'dst-muted' }, '当前会话尚未绑定角色。')
      const save = async () => {
        try {
          await api('/card/update', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, cardId: record.id, patch: { scripts: sources.scoped } }) })
          await api('/regex-sources', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, global: sources.global, preset: sources.preset }) })
          setStatus('已保存'); overlay.changed(); reload()
        } catch (error) { setStatus(error.message) }
      }
      const clearPendingApproval = id => setPendingApprovals(previous => { const next = new Set(previous); next.delete(id); return next })
      const stopPreview = id => setRunningIds(previous => { if (!previous.has(id)) return previous; const next = new Set(previous); next.delete(id); return next })
      const invalidateApproval = id => { approvalAttempts.current.set(id, (approvalAttempts.current.get(id) || 0) + 1); clearPendingApproval(id); stopPreview(id) }
      const patch = (index, next) => setScripts(previous => previous.map((item, i) => i === index ? { ...item, ...next } : item))
      const patchTrusted = (index, id, next) => { invalidateApproval(id); patch(index, { ...next, enabled: false, approvedHash: null }) }
      const remove = (index, id) => { invalidateApproval(id); setScripts(previous => previous.filter((_item, i) => i !== index)) }
      const add = () => setScripts(previous => previous.concat(scopeKind === 'scoped'
        ? { id: crypto.randomUUID(), name: 'New script', kind: 'javascript', enabled: false, approvedHash: null, source: '' }
        : { id: crypto.randomUUID(), name: 'New Regex', kind: 'regex', enabled: false, approvedHash: null, source: '', findRegex: '', trimStrings: [], placement: [1, 2], markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }))
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '执行脚本'),
        h('p', { className: 'dst-warning' }, '导入脚本默认启用；已确认的 JavaScript 会作为当前会话的后台脚本自动运行，Regex 在对应文本阶段运行，HTML 可在管理页预览。系统不审查或过滤替换内容与脚本源码，启用前请自行验证。编辑规则、源码或类型后会自动停用。'),
        h('div', { className: 'dst-actions' }, ...[['global', 'Global'], ['preset', 'Preset'], ['scoped', 'Scoped（角色卡）']].map(([id, label]) => h(Button, { key: id, className: `${scopeKind === id ? 'active' : 'secondary'} small`, onClick: () => { setRunningIds(new Set()); setScopeKind(id) } }, label))),
        scripts.map((script, index) => {
          const running = runningIds.has(script.id)
          return h('section', { className: 'dst-script', key: script.id },
            h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '名称' }, h('input', { value: script.name, onChange: event => patch(index, { name: event.target.value }) })),
              h(Field, { label: '类型' }, h('select', { value: script.kind, disabled: scopeKind !== 'scoped', onChange: event => { const kind = event.target.value; patchTrusted(index, script.id, kind === 'regex' ? { kind, placement: [1, 2], findRegex: script.findRegex || '' } : { kind }) } }, h('option', { value: 'regex' }, 'Regex 替换'), ...(scopeKind === 'scoped' ? [h('option', { key: 'javascript', value: 'javascript' }, 'JavaScript'), h('option', { key: 'html', value: 'html' }, 'HTML')] : [])))),
            script.kind === 'regex' ? h(Field, { label: '匹配规则（findRegex）' }, h('textarea', { rows: 3, value: script.findRegex || '', onChange: event => patchTrusted(index, script.id, { findRegex: event.target.value }), spellCheck: false })) : null,
            script.kind === 'regex' ? h(Field, { label: 'Find Regex 宏替换' }, h('select', { value: Number(script.substituteRegex || 0), onChange: event => patchTrusted(index, script.id, { substituteRegex: Number(event.target.value) }) }, h('option', { value: 0 }, '不替换'), h('option', { value: 1 }, 'Raw'), h('option', { value: 2 }, 'Escaped'))) : null,
            h(Field, { label: script.kind === 'regex' ? '替换内容（replaceString）' : '源码' }, h('textarea', { rows: 10, value: script.source, onChange: event => patchTrusted(index, script.id, { source: event.target.value }), spellCheck: false })),
            script.kind === 'regex' ? h(Field, { label: 'Trim Out（每行一项）' }, h('textarea', { rows: 3, value: (script.trimStrings || []).join('\n'), onChange: event => patchTrusted(index, script.id, { trimStrings: event.target.value.split(/\r?\n/) }), spellCheck: false })) : null,
            script.kind === 'regex' ? h('div', { className: 'dst-inline-fields' },
              h(Field, { label: '最小消息深度' }, h('input', { type: 'number', value: script.minDepth ?? '', onChange: event => patchTrusted(index, script.id, { minDepth: event.target.value === '' ? null : Number(event.target.value) }) })),
              h(Field, { label: '最大消息深度' }, h('input', { type: 'number', value: script.maxDepth ?? '', onChange: event => patchTrusted(index, script.id, { maxDepth: event.target.value === '' ? null : Number(event.target.value) }) }))) : null,
            script.kind === 'regex' ? h('div', { className: 'dst-actions' },
              ...[[1, '用户消息'], [2, '助手消息'], [3, 'Slash/Narrator'], [5, '世界书'], [6, 'Reasoning']].map(([value, label]) => h('label', { key: value }, h('input', { type: 'checkbox', checked: script.placement?.includes(value) === true, onChange: event => { const placement = new Set(script.placement || []); if (event.target.checked) placement.add(value); else placement.delete(value); patchTrusted(index, script.id, { placement: [...placement] }) } }), ` ${label}`)),
              h('label', null, h('input', { type: 'checkbox', checked: script.markdownOnly === true, onChange: event => patchTrusted(index, script.id, { markdownOnly: event.target.checked }) }), ' 仅显示阶段'),
              h('label', null, h('input', { type: 'checkbox', checked: script.promptOnly === true, onChange: event => patchTrusted(index, script.id, { promptOnly: event.target.checked }) }), ' 仅提示词阶段'),
              h('label', null, h('input', { type: 'checkbox', checked: script.runOnEdit === true, onChange: event => patchTrusted(index, script.id, { runOnEdit: event.target.checked }) }), ' 编辑消息时运行')) : null,
            script.kind === 'regex' ? h(Field, { label: '预览输入（只用于运行预览，不会保存）' }, h('textarea', { rows: 3, value: previewInputs.get(script.id) || '', onChange: event => setPreviewInputs(previous => { const next = new Map(previous); next.set(script.id, event.target.value); return next }), spellCheck: false })) : null,
            h('div', { className: 'dst-actions' },
              h('label', null, h('input', { type: 'checkbox', checked: script.enabled || pendingApprovals.has(script.id), onChange: async event => {
                const attempt = (approvalAttempts.current.get(script.id) || 0) + 1
                approvalAttempts.current.set(script.id, attempt)
                const enabled = event.target.checked
                if (!enabled) { clearPendingApproval(script.id); stopPreview(script.id); patch(index, { enabled: false, approvedHash: null }); return }
                if (!window.confirm(script.kind === 'javascript' ? `确认启用脚本“${script.name}”？启用后会在当前会话中作为后台脚本运行；修改内容后必须重新确认。` : `确认启用脚本“${script.name}”？启用后会在对应文本阶段运行；修改内容后必须重新确认。`)) return
                setPendingApprovals(previous => new Set(previous).add(script.id))
                const material = scriptApprovalMaterial(script)
                try {
                  const approvedHash = await sourceDigest(script)
                  if (approvalAttempts.current.get(script.id) !== attempt) return
                  setScripts(previous => previous.map(item => item.id === script.id && scriptApprovalMaterial(item) === material ? { ...item, enabled: true, approvedHash } : item))
                } catch (error) { setStatus(error.message || String(error)) }
                finally { if (approvalAttempts.current.get(script.id) === attempt) clearPendingApproval(script.id) }
              } }), ' 启用'),
              h(Button, { className: 'secondary small', disabled: script.source.trim() === '', onClick: () => { if (!running && !script.enabled && !window.confirm(`仅在管理页运行一次“${script.name}”预览？这不会启用对话执行。`)) return; setRunningIds(previous => { const next = new Set(previous); if (next.has(script.id)) next.delete(script.id); else next.add(script.id); return next }) } }, running ? '停止预览' : '运行预览'),
              h(Button, { className: 'danger small', onClick: () => remove(index, script.id) }, '删除')),
            running ? h(ScriptPreview, { sessionId: session.sessionId, script, sample: previewInputs.get(script.id) || '' }) : null)
        }),
        h('div', { className: 'dst-actions' }, h(Button, { className: 'secondary', onClick: add }, '添加脚本'), h(Button, { onClick: () => void save() }, '保存脚本'), h('span', { className: 'dst-muted' }, status)))
    }

    function TemplatesTab({ library, sessionId, reload }) {
      const [selected, setSelected] = React.useState(() => library.templates[0] || { id: crypto.randomUUID(), name: 'New template', content: '', position: 'after', order: 0, enabled: true })
      const [status, setStatus] = React.useState('')
      const save = async () => {
        try { await api('/template/save', { method: 'POST', body: JSON.stringify({ sessionId, template: selected }) }); setStatus('已保存'); overlay.changed(); reload() } catch (error) { setStatus(error.message) }
      }
      const create = () => setSelected({ id: crypto.randomUUID(), name: 'New template', content: '', position: 'after', order: 0, enabled: true })
      return h('div', null,
        h('div', { className: 'dst-section-title' }, '提示词模板'),
        h('div', { className: 'dst-template-list' }, library.templates.map(template => h(Button, { key: template.id, className: template.id === selected.id ? 'small active' : 'secondary small', onClick: () => setSelected(structuredClone(template)) }, template.name)), h(Button, { className: 'secondary small', onClick: create }, '+ 新建')),
        h(Field, { label: '模板名称' }, h('input', { value: selected.name, onChange: event => setSelected(previous => ({ ...previous, name: event.target.value })) })),
        h('div', { className: 'dst-inline-fields' },
          h(Field, { label: '注入位置' }, h('select', { value: selected.position, onChange: event => setSelected(previous => ({ ...previous, position: event.target.value })) }, h('option', { value: 'before' }, '角色卡之前'), h('option', { value: 'after' }, '角色卡之后'), h('option', { value: 'post-history' }, '历史之后'))),
          h(Field, { label: '顺序' }, h('input', { type: 'number', value: selected.order, onChange: event => setSelected(previous => ({ ...previous, order: Number(event.target.value) })) }))),
        h(Field, { label: 'EJS 模板内容' }, h('textarea', { rows: 16, value: selected.content, onChange: event => setSelected(previous => ({ ...previous, content: event.target.value })), spellCheck: false })),
        h('div', { className: 'dst-actions' }, h(Button, { onClick: () => void save() }, '保存模板'), h('label', null, h('input', { type: 'checkbox', checked: selected.enabled, onChange: event => setSelected(previous => ({ ...previous, enabled: event.target.checked })) }), ' 启用'), h('span', { className: 'dst-muted' }, status)))
    }

    function ManagerContent({ sessionId }) {
      const [revision, setRevision] = React.useState(0)
      const reload = () => setRevision(value => value + 1)
      const libraryState = useAsync(() => sessionId ? api(`/library?sessionId=${encodeURIComponent(sessionId)}`) : null, [sessionId, revision])
      const sessionState = useAsync(() => sessionId ? api(`/session?sessionId=${encodeURIComponent(sessionId)}`) : null, [sessionId, revision, useOverlay().version])
      const [tab, setTab] = React.useState('library')
      const [worldbookEditorId, setWorldbookEditorId] = React.useState(null)
      if (!sessionId) return h('div', { className: 'dst-warning' }, '酒馆数据按工作区隔离。请从一个具体 Session 的角色菜单打开管理页。')
      if (libraryState.loading || sessionState.loading) return h('div', { className: 'dst-loading' }, '正在读取酒馆数据…')
      if (libraryState.error) return h('div', { className: 'dst-error' }, libraryState.error)
      if (sessionId && sessionState.error) return h('div', { className: 'dst-error' }, sessionState.error)
      const library = libraryState.value
      const session = sessionState.value
      const tabs = [['library', '角色库'], ['card', '角色卡'], ['worldbook', '世界书'], ['persona', '用户设定/变量'], ['memory', '记忆表格'], ['scripts', '脚本'], ['templates', '提示词模板']]
      return h('div', { className: 'dst-manager-content' },
        session?.card ? h('div', { className: 'dst-current' }, `当前角色：${session.card.card.data.nickname || session.card.card.data.name}`) : sessionId ? h('div', { className: 'dst-current empty' }, '当前会话尚未绑定角色') : null,
        h('nav', { className: 'dst-tabs' }, tabs.map(([id, label]) => h(Button, { key: id, className: tab === id ? 'tab active' : 'tab', onClick: () => { if (id === tab) return; setTab(id); if (tab === 'scripts') reload() } }, label))),
        h('div', { className: 'dst-tab-body' },
          tab === 'library' ? h(LibraryTab, { library, session, reload }) : null,
          tab === 'card' && session ? h(CardEditTab, { key: `${session.card?.id}:${session.card?.updatedAt}`, session, library, reload }) : null,
          tab === 'worldbook' && session ? h(WorldbookTab, { key: session.sessionId, session, library, editorSelection: worldbookEditorId, onEditorSelection: setWorldbookEditorId, reload }) : null,
          tab === 'persona' && session ? h(PersonaTab, { key: `${session.sessionId}:${session.binding?.revision ?? session.binding?.boundAt}`, session, reload }) : null,
          tab === 'memory' && session ? h(MemoryTab, { key: `${session.sessionId}:${session.memory?.revision}`, session, reload }) : null,
          tab === 'scripts' && session ? h(ScriptsTab, { key: `${session.card?.id}:${session.card?.updatedAt}`, session, reload }) : null,
          tab === 'templates' ? h(TemplatesTab, { key: library.templates.map(item => `${item.id}:${item.order}:${item.enabled}`).join('|'), library, sessionId, reload }) : null))
    }

    function OverlaySurface() {
      const state = useOverlay()
      if (!state.open) return null
      return h('div', { className: 'dst-overlay' },
        h('div', { className: 'dst-backdrop', onClick: overlay.close }),
        state.mode === 'import'
          ? h('div', { className: 'dst-dialog-wrap' }, h(ImportDialog, { sessionId: state.sessionId, close: overlay.close }))
          : h('aside', { className: 'dst-manager', role: 'dialog', 'aria-modal': true, 'aria-label': '酒馆模式管理' },
              h('header', null, h('div', null, h('strong', null, '酒馆模式'), h('span', null, 'dsh-sillytavern')), h(Button, { className: 'secondary small', onClick: overlay.close }, '关闭')),
              h(ManagerContent, { sessionId: state.sessionId })))
    }

    function SettingsSection() {
      return h('section', { className: 'dst-settings' }, h('h2', null, '酒馆模式'), h('p', { className: 'dst-muted' }, '角色库、世界书、脚本和提示词模板均按工作区隔离。请从目标 Session 的角色菜单打开全屏管理页。'))
    }

    function cardLabel(card) {
      return String(card?.nickname || card?.name || '未命名角色')
    }

    function useCharacterSelectLayout(compact, label) {
      const buttonRef = React.useRef(null)
      const labelRef = React.useRef(null)
      const [iconOnly, setIconOnly] = React.useState(true)
      React.useLayoutEffect(() => {
        const button = buttonRef.current
        const text = labelRef.current
        if (!compact || !button || !text) return undefined
        // Find the wrapping toolbar without depending on the host's CSS module names.
        let row = button.parentElement
        while (row) {
          const style = getComputedStyle(row)
          if (style.display === 'flex' && style.flexWrap === 'wrap') break
          row = row.parentElement
        }
        const measure = () => {
          // Expanded chrome: 16px mug + 14px chevron + 16px padding + two 4px gaps.
          // The hidden label keeps its natural width, so collapsing cannot cause a toggle loop.
          const expandedWidth = text.getBoundingClientRect().width + 54
          let fits = expandedWidth <= 180
          if (fits && row) {
            const style = getComputedStyle(row)
            const number = value => parseFloat(value) || 0
            const children = [...row.children].filter(child => getComputedStyle(child).display !== 'none')
            // The host's trailing group uses margin-left:auto; its resolved margin is spare space.
            const occupied = children.reduce((width, child) => width + child.getBoundingClientRect().width, 0)
              + Math.max(0, children.length - 1) * number(style.columnGap)
            const available = row.clientWidth - number(style.paddingLeft) - number(style.paddingRight)
            const expandedRowWidth = occupied - button.getBoundingClientRect().width + expandedWidth
            fits = expandedRowWidth <= available - 1
          }
          setIconOnly(!fits)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(text)
        if (row) {
          observer.observe(row)
          for (const child of row.children) observer.observe(child)
        }
        return () => observer.disconnect()
      }, [compact, label])
      return { buttonRef, labelRef, iconOnly: compact && iconOnly }
    }

    function CharacterSelect({ cards, value, busy, locked = false, onChange, onManage, compact = false }) {
      const [open, setOpen] = React.useState(false)
      const available = Array.isArray(cards) && cards.length > 0
      const selected = available ? cards.find(card => card.id === value) : undefined
      const label = selected === undefined ? '选择角色卡' : cardLabel(selected)
      const { buttonRef, labelRef, iconOnly } = useCharacterSelectLayout(compact, label)
      const items = available
        ? [
          ...cards.map(card => ({ id: card.id, label: cardLabel(card), disabled: locked && card.id !== value })),
          { type: 'separator', id: 'character-separator' },
          { id: 'manage', label: '管理酒馆模式', icon: h(IconSettingsOutline14) },
        ]
        : [{ id: 'manage', label: '导入或管理角色卡', icon: h(IconSettingsOutline14) }]
      return h(Menu, {
        open,
        onClose: () => setOpen(false),
        items,
        selectedId: value || undefined,
        onSelect: id => {
          setOpen(false)
          if (id === 'manage') onManage?.()
          else onChange(id)
        },
        align: 'start',
        side: 'top',
        portal: true,
        dense: true,
        compact: true,
        className: 'dst-character-menu',
        anchor: h('button', {
          ref: buttonRef,
          type: 'button',
          className: `dst-character-seat${compact ? ' compact' : ''}${iconOnly ? ' icon-only' : ''}`,
          'aria-label': '当前角色卡',
          'aria-description': label,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          title: available ? `当前角色卡：${label}${locked ? '（对话已开始，不能更换）' : ''}` : '请先导入角色卡',
          disabled: busy,
          onClick: () => setOpen(previous => !previous),
        },
        h(TavernMugIcon, { className: 'dst-character-icon' }),
        h('span', { ref: labelRef, className: 'dst-character-label' }, label),
        h(IconChevronDownOutline14, { className: 'dst-character-chevron' }))
      })
    }

    function displayRegexRules(scripts) {
      return (Array.isArray(scripts) ? scripts : []).filter(script => script?.kind === 'regex'
        && script.enabled === true
        && script.disabled !== true
        && String(script.findRegex || '').trim() !== '')
    }

    function regexMessageDepth(scope, seq) {
      const messages = Array.isArray(scope?.messages) ? scope.messages.filter(message => message?.role === 'user' || message?.role === 'assistant') : []
      const index = messages.findIndex(message => Number(message?.seq) === Number(seq))
      return index < 0 ? undefined : messages.length - index - 1
    }

    const SCRIPT_MARKDOWN_LABELS = Object.freeze({
      code: Object.freeze({ copyLabel: '复制', copiedLabel: '已复制' }),
      footnotes: '脚注',
    })

    function splitMarkdownFenceRegions(input) {
      const source = String(input ?? '')
      const lines = source.match(/[^\n]*(?:\n|$)/g) || []
      const regions = []
      const push = (kind, text) => {
        if (text === '') return
        const previous = regions.at(-1)
        if (previous?.kind === kind) previous.text += text
        else regions.push({ kind, text })
      }
      let fence = null
      let regionStart = 0
      let offset = 0
      for (const line of lines) {
        if (line === '') continue
        const end = offset + line.length
        if (fence === null) {
          const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/)
          const validOpening = opening !== null && !(opening[1][0] === '`' && opening[2].includes('`'))
          if (validOpening) {
            if (offset > regionStart) push('markup', source.slice(regionStart, offset))
            fence = { char: opening[1][0], length: opening[1].length, start: offset }
          } else if (/^(?: {4}|\t)/.test(line)) {
            if (offset > regionStart) push('markup', source.slice(regionStart, offset))
            push('markdown', line)
            regionStart = end
          }
        } else {
          const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/)
          if (closing !== null && closing[1][0] === fence.char && closing[1].length >= fence.length) {
            push('markdown', source.slice(fence.start, end))
            fence = null
            regionStart = end
          }
        }
        offset = end
      }
      if (fence !== null) push('markdown', source.slice(fence.start))
      else if (regionStart < source.length) push('markup', source.slice(regionStart))
      return regions
    }

    function legacyFontColor(attributes) {
      const match = String(attributes ?? '').match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined
    }

    function tavernMarkdownSegments(input) {
      const segments = []
      for (const region of splitMarkdownFenceRegions(input)) {
        if (region.kind === 'markdown') {
          segments.push(region)
          continue
        }
        const source = region.text
        const pattern = /^[ \t]*<font\b([^>\r\n]*)>([\s\S]*?)<\/font\s*>[ \t]*$/gim
        let cursor = 0
        let match
        while ((match = pattern.exec(source)) !== null) {
          if (match.index > cursor) segments.push({ kind: 'markdown', text: source.slice(cursor, match.index) })
          const body = String(match[2] ?? '')
          if (/<font\b/i.test(body)) segments.push({ kind: 'markdown', text: match[0] })
          else segments.push({ kind: 'font', text: body.trim(), color: legacyFontColor(match[1]) })
          cursor = match.index + match[0].length
        }
        if (cursor < source.length) segments.push({ kind: 'markdown', text: source.slice(cursor) })
      }
      return segments.filter(segment => segment.kind !== 'markdown' || segment.text !== '')
    }

    function TavernMarkdownContent({ text, streaming = false, fileMentions }) {
      const segments = React.useMemo(() => streaming
        ? [{ kind: 'markdown', text: String(text ?? '') }]
        : tavernMarkdownSegments(text), [text, streaming])
      return h('div', { className: 'dst-markdown-content' }, segments.map((segment, index) => {
        if (segment.kind === 'font') return h('div', { key: `font-${index}`, className: 'dst-legacy-font', style: segment.color === undefined ? undefined : { color: segment.color } },
          h(MarkdownText, { text: segment.text, streaming, labels: SCRIPT_MARKDOWN_LABELS, fileMentions }))
        return h(MarkdownText, { key: `markdown-${index}`, text: segment.text, streaming, labels: SCRIPT_MARKDOWN_LABELS, fileMentions })
      }))
    }

    const TavernTurnProcessNode = React.memo(function TavernTurnProcessNode({ node, turnProcess }) {
      if (turnProcess === undefined || !turnProcess.foldable) return null
      const open = turnProcess.open
      return h('button', {
        type: 'button',
        className: 'dst-story-progress-toggle',
        'data-open': open || undefined,
        'data-turn-process': node.data.turn,
        'data-turn-process-messages': node.data.messageCount,
        'data-turn-process-tool-calls': node.data.toolCallCount,
        'data-turn-process-subagents': node.data.subagentCount,
        'aria-expanded': open,
        onClick: event => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        },
      },
      h('span', { className: 'dst-story-progress-label' }, '剧情推进'),
      h(IconChevronDownOutline14, { className: 'dst-story-progress-chevron' }))
    })

    const TavernSystemPromptNode = React.memo(function TavernSystemPromptNode() {
      return h('span', { hidden: true, 'data-dst-system-prompt-hidden': true })
    })

    function StoryProcessReasoning({ hidden, reveal, children }) {
      const ref = React.useRef(null)
      React.useLayoutEffect(() => {
        const element = ref.current
        if (element === null) return
        if (hidden && element.contains(element.ownerDocument.activeElement)) {
          reveal()
          return
        }
        if (hidden) element.setAttribute('hidden', 'until-found')
        else element.removeAttribute('hidden')
      }, [hidden, reveal])
      React.useEffect(() => {
        const element = ref.current
        if (element === null) return
        element.addEventListener('beforematch', reveal)
        return () => element.removeEventListener('beforematch', reveal)
      }, [reveal])
      return h('div', { ref, 'data-turn-process-inline': hidden || undefined }, children)
    }

    function AssistantFallback({ node, renderMessageImages, mentions, replacementBase, replacements, reasoningHidden = false, revealProcess }) {
      const data = node.data
      const streaming = data.status === 'running'
      const rendered = []
      for (let index = 0; index < data.blocks.length; index += 1) {
        const block = data.blocks[index]
        if (block?.kind === 'text') {
          const replacement = replacements?.[index]
          if (replacement !== undefined) rendered.push(h(ScriptConversationContent, { key: index, ...replacementBase, messageSeq: replacementBase.messageSeq ?? replacementBase.seq, seq: `${replacementBase.seq}-${index}`, text: replacement, mentions }))
          else rendered.push(h(TavernMarkdownContent, { key: index, text: block.text, streaming, fileMentions: mentions }))
        }
        else if (block?.kind === 'reasoning') rendered.push(h(StoryProcessReasoning, { key: index, hidden: reasoningHidden, reveal: revealProcess },
          h('details', { className: 'dst-assistant-reasoning', open: streaming || undefined }, h('summary', null, streaming ? '思考中…' : '思考过程'), replacements?.[index] !== undefined ? h(ScriptConversationContent, { ...replacementBase, messageSeq: replacementBase.messageSeq ?? replacementBase.seq, seq: `${replacementBase.seq}-reasoning-${index}`, text: replacements[index] }) : h('pre', null, block.text))))
        else if (block?.kind === 'image') {
          const start = index
          const images = [block]
          while (data.blocks[index + 1]?.kind === 'image') { images.push(data.blocks[index + 1]); index += 1 }
          rendered.push(h(React.Fragment, { key: start }, renderMessageImages({ images: images.map(item => ({ attachment: item.attachment })), align: 'start' })))
        } else if (block?.kind !== 'tool-call' && block !== undefined) rendered.push(h(JsonBlock, { key: index, label: '未知消息块', payload: block.block, truncatedLabel: total => `JSON 已截断（${total}）` }))
      }
      if (data.status === 'interrupted') rendered.push(h('span', { className: 'dst-assistant-stopped', key: 'stopped' }, '已停止'))
      return rendered.length === 0 ? null : h('div', { className: 'dst-assistant-message', 'data-streaming': streaming || undefined }, rendered)
    }

    function RenderedScriptSegments({ sessionId, seq, messageSeq = null, text, mentions, eventState, label = '脚本渲染内容' }) {
      const segments = greetingSegments(text, true, false)
      if (segments.length === 0) return null
      return h('article', { className: 'dst-script-conversation', 'aria-label': label }, segments.map((segment, index) => segment.type === 'html'
        ? h(TrustedFrame, { key: `html-${seq}-${index}`, sessionId, script: { id: `conversation-${seq}-${index}`, name: label, kind: 'html', source: segment.value, sourceSeq: messageSeq }, eventState })
        : h(TavernMarkdownContent, { key: `markdown-${index}`, text: segment.value, fileMentions: mentions })))
    }

    function ScriptConversationContent({ sessionId, seq, messageSeq = null, text, mentions }) {
      const eventState = useSessionStore(scriptEvents, sessionId)
      return h(RenderedScriptSegments, { sessionId, seq, messageSeq, text, mentions, eventState })
    }

    function TavernAssistantNode(props) {
      const { node, renderMessageImages, sessionId, useTurnData, openFile, fileMentions, turnProcess } = props
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const compat = useCompatSnapshot(sessionId)
      const messageSeq = node.data.finalNode?.seq ?? node.seq ?? node.data.seq
      const projected = React.useMemo(() => (compat?.messages || []).find(message => message.event_seq === messageSeq || message.sourceSeq === messageSeq), [compat, messageSeq])
      const depth = regexMessageDepth(scope, messageSeq)
      const turn = node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn : undefined
      const tail = useTurnData('turn-tail')
      const mentionOwner = React.useMemo(() => turn?.status === 'closed' && node.data.finalNode !== undefined && tail?.closing?.finalNode.seq === node.data.finalNode.seq ? { turn, seq: node.data.finalNode.seq, openFile } : undefined, [node.data.finalNode, openFile, tail, turn])
      const mentions = React.useMemo(() => mentionOwner === undefined || typeof fileMentions !== 'function' ? undefined : fileMentions(mentionOwner), [fileMentions, mentionOwner])
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const regexBlocks = React.useMemo(() => node.data.blocks.flatMap((block, index) => block?.kind === 'text' ? [{ index, text: block.text, placement: 2 }] : block?.kind === 'reasoning' ? [{ index, text: block.text, placement: 6 }] : []), [node.data.blocks])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [rendered, setRendered] = React.useState({ status: 'native', message: '', replacements: {} })
      const reasoningHidden = turnProcess !== undefined
        && turnProcess.foldable
        && turnProcess.spec.answerStep === node.data.step
        && turnProcess.spec.inlineReasoning
        && !turnProcess.open
      const revealProcess = React.useCallback(() => {
        turnProcess?.setOpen(true)
      }, [turnProcess])
      React.useEffect(() => {
        const controller = new AbortController()
        if (node.data.status !== 'settled' || rules.length === 0 || regexBlocks.length === 0) {
          setRendered({ status: 'native', message: '', replacements: {} })
          return () => controller.abort()
        }
        setRendered(previous => previous.status === 'rendered' ? previous : { status: 'loading', message: '', replacements: {} })
        Promise.all(regexBlocks.map(block => regexEngine.run(block.text, rules, controller.signal, { placement: block.placement, isMarkdown: true, depth }, scope))).then(values => {
          if (controller.signal.aborted) return
          const replacements = {}
          values.forEach((value, index) => { if (value.applied.length > 0) replacements[regexBlocks[index].index] = value.text })
          setRendered(Object.keys(replacements).length === 0 ? { status: 'native', message: '', replacements: {} } : { status: 'rendered', message: '', replacements })
        }).catch(error => {
          if (!controller.signal.aborted) setRendered({ status: 'error', message: error instanceof Error ? error.message : String(error), replacements: {} })
        })
        return () => controller.abort()
      }, [fingerprint, node.data.status, regexBlocks, depth, scope])
      if (projected?.is_hidden === true) return null
      const nativeText = regexBlocks.filter(block => block.placement === 2).map(block => block.text).join('\n')
      if (projected && String(projected.message ?? projected.mes ?? projected.text ?? '') !== nativeText) return h(RenderedScriptSegments, { sessionId, seq: `compat-assistant-${messageSeq}`, messageSeq, text: String(projected.message ?? projected.mes ?? projected.text ?? ''), mentions, eventState: null, label: '兼容消息投影' })
      if (rendered.status === 'loading') return h('div', { className: 'dst-script-rendering', role: 'status' }, '正在渲染脚本…')
      if (rendered.status === 'rendered') return h(AssistantFallback, { node, renderMessageImages, mentions, replacementBase: { sessionId, seq: messageSeq, messageSeq }, replacements: rendered.replacements, reasoningHidden, revealProcess })
      return h(React.Fragment, null,
        h(AssistantFallback, { node, renderMessageImages, mentions, reasoningHidden, revealProcess }),
        rendered.status === 'error' ? h('p', { className: 'dst-script-render-error' }, `脚本渲染失败：${rendered.message}`) : null)
    }

    function TavernUserNode({ node, renderMessageImages, sessionId }) {
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const eventState = useSessionStore(scriptEvents, sessionId)
      const compat = useCompatSnapshot(sessionId)
      const depth = regexMessageDepth(scope, node.data.seq)
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const textBlocks = React.useMemo(() => (node.data.content || []).flatMap((block, index) => block?.type === 'text' ? [{ index, text: block.text }] : []), [node.data.content])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [replacements, setReplacements] = React.useState({})
      React.useEffect(() => {
        const controller = new AbortController()
        if (rules.length === 0 || textBlocks.length === 0) { setReplacements({}); return () => controller.abort() }
        Promise.all(textBlocks.map(block => regexEngine.run(block.text, rules, controller.signal, { placement: 1, isMarkdown: true, depth }, scope))).then(values => {
          if (controller.signal.aborted) return
          const next = {}
          values.forEach((value, index) => { if (value.applied.length > 0) next[textBlocks[index].index] = value.text })
          setReplacements(next)
        }).catch(() => { if (!controller.signal.aborted) setReplacements({}) })
        return () => controller.abort()
      }, [fingerprint, textBlocks, depth, scope])
      const projected = (compat?.messages || []).find(message => message.event_seq === node.data.seq || message.sourceSeq === node.data.seq)
      if (projected?.is_hidden === true) return null
      const nativeText = textBlocks.map(block => block.text).join('\n')
      if (projected && String(projected.message ?? projected.mes ?? projected.text ?? '') !== nativeText) return h('div', { className: 'dst-user-row' }, h('div', { className: 'dst-user-stack' }, h('div', { className: 'dst-user-message' }, h(RenderedScriptSegments, { sessionId, seq: `compat-user-${node.data.seq}`, messageSeq: node.data.seq, text: String(projected.message ?? projected.mes ?? projected.text ?? ''), eventState, label: '兼容用户消息投影' }))))
      const rendered = []
      const images = []
      const content = node.data.content || []
      for (let index = 0; index < content.length; index += 1) {
        const block = content[index]
        if (block?.type === 'text') rendered.push(replacements[index] !== undefined
          ? h(ScriptConversationContent, { key: index, sessionId, seq: `user-${node.data.seq}-${index}`, messageSeq: node.data.seq, text: replacements[index], eventState, label: '用户 Regex 替换' })
          : h(MarkdownText, { key: index, text: block.text, labels: SCRIPT_MARKDOWN_LABELS }))
        else if (block?.type === 'image') images.push({ attachment: block.attachment })
      }
      if (rendered.length === 0 && images.length === 0) return null
      const stack = []
      if (images.length > 0) stack.push(h(React.Fragment, { key: 'images' }, renderMessageImages({ images, align: 'end' })))
      if (rendered.length > 0) stack.push(h('div', { className: 'dst-user-message', key: 'message' }, rendered))
      return h('div', { className: 'dst-user-row' }, h('div', { className: 'dst-user-stack' }, ...stack))
    }

    function TavernCharacterSelect({ sessionId, blocks, registerMessageRenderers, appendInput }) {
      const version = useOverlay().version
      const eventState = useSessionEventState(sessionId)
      const eventCardId = eventState?.card?.id || null
      const session = useAsync(signal => api(`/session?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version, eventCardId])
      const compatibility = useAsync(signal => api(`/compat/runtime?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version, eventCardId])
      const library = useAsync(signal => api(`/library?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version])
      const verifiedScripts = useSessionStore(scriptPolicies, sessionId)
      const [busy, setBusy] = React.useState(false)
      const ownedBlock = React.useRef(Object.freeze({ reason: '正在切换角色卡…' }))
      const previousBlock = React.useRef(undefined)
      const appendInputRef = React.useRef(appendInput)
      appendInputRef.current = appendInput
      const cardRecord = session.value?.card
      const eventTail = eventState?.history?.at(-1)?.seq ?? -1
      const eventCursor = eventState?.cursor ?? -1
      const compatChatRevision = eventState?.compatChatRevision ?? -1
      const globalVariablesToken = JSON.stringify(session.value?.globalVariables || {})
      const regexSourcesToken = [
        ...(session.value?.globalRegexScripts || []),
        ...(session.value?.presetRegexScripts || []),
        ...(cardRecord?.scripts || []),
      ].map(script => `${script.id}:${script.enabled}:${script.approvedHash || ''}`).join('|')
      React.useEffect(() => typeof registerMessageRenderers === 'function' ? registerMessageRenderers() : undefined, [registerMessageRenderers])
      React.useEffect(() => {
        const bridge = value => appendInputRef.current(value)
        return compatRuntime.setComposer(sessionId, bridge)
      }, [sessionId])
      React.useEffect(() => {
        if (compatibility.value === null) return
        compatRuntime.set(sessionId, compatibility.value, `${compatibility.value.bindingRevision}:${compatibility.value.cardRecord?.id || 'none'}:${compatibility.value.chatRevision ?? -1}`)
      }, [sessionId, compatibility.value])
      React.useEffect(() => { compatRuntime.applyEventState(sessionId, eventState) }, [sessionId, eventState, eventTail, compatibility.value])
      React.useEffect(() => {
        if (session.loading) return undefined
        let active = true
        const token = `${cardRecord?.id || 'none'}:${cardRecord?.updatedAt || 'none'}:${regexSourcesToken}`
        const scripts = [
          ...(Array.isArray(session.value?.globalRegexScripts) ? session.value.globalRegexScripts : []),
          ...(Array.isArray(session.value?.presetRegexScripts) ? session.value.presetRegexScripts : []),
          ...(Array.isArray(cardRecord?.scripts) ? cardRecord.scripts : []),
        ]
        scriptPolicies.set(sessionId, [], `verifying:${token}`)
        Promise.all(scripts.map(async script => {
          if (script?.enabled !== true) return script
          try {
            const approvedHash = await sourceDigest(script)
            return approvedHash === script.approvedHash ? script : { ...script, enabled: false, approvedHash: null }
          } catch { return { ...script, enabled: false, approvedHash: null } }
        })).then(verified => { if (active) scriptPolicies.set(sessionId, verified, `verified:${token}`) })
        return () => { active = false }
      }, [sessionId, session.loading, cardRecord?.id, cardRecord?.updatedAt, regexSourcesToken])
      React.useEffect(() => {
        const data = cardRecord?.card?.data || {}
        const messages = (eventState?.messages || eventState?.history || []).map(message => ({
          role: message.role,
          text: message.message ?? message.mes ?? message.text ?? '',
          seq: message.sourceSeq ?? message.event_seq ?? message.seq ?? message.message_id,
        }))
        const scope = {
          card: cardRecord?.card || null,
          character: data,
          char: data.nickname || data.name || 'Character',
          user: session.value?.binding?.userPersona?.name || 'User',
          persona: session.value?.binding?.userPersona || { name: 'User', description: '' },
          variables: session.value?.binding?.variables || {},
          globalVariables: session.value?.globalVariables || {},
          currentSwipeId: Number(session.value?.binding?.openingSwipeId || 0),
          messages,
        }
        scriptScopes.set(sessionId, scope, `${cardRecord?.id || 'none'}:${session.value?.binding?.revision || 0}:${eventCursor}:${compatChatRevision}:${globalVariablesToken}`)
      }, [sessionId, cardRecord?.id, cardRecord?.updatedAt, session.value?.binding?.revision, eventCursor, compatChatRevision, globalVariablesToken])
      React.useEffect(() => {
        scriptEvents.set(sessionId, eventState, `${eventCursor}:${compatChatRevision}:${eventTail}:${eventState?.history?.length || 0}:${eventState?.unavailable === true}:${eventState?.card?.id || 'none'}`)
      }, [sessionId, eventState, eventCursor, compatChatRevision, eventTail])
      const releaseBlock = () => {
        if (blocks.storeFor(sessionId).getSnapshot() === ownedBlock.current) blocks.set(sessionId, previousBlock.current)
        previousBlock.current = undefined
      }
      React.useEffect(() => releaseBlock, [sessionId, blocks])
      if (session.error || session.loading || compatibility.error || compatibility.loading || library.error || library.loading) return null
      const currentId = session.value?.binding?.cardId || ''
      const locked = currentId !== '' && sessionHasStarted(session.value)
      const selectCard = async id => {
        if (!id || id === currentId || busy) return
        if (locked) { window.alert('当前会话已经开始对话，不能更换角色卡。'); return }
        const currentName = cardLabel(session.value?.card?.card?.data)
        const next = library.value.cards.find(card => card.id === id)
        if (currentId && !window.confirm(`将当前角色“${currentName}”替换为“${cardLabel(next)}”？`)) return
        previousBlock.current = blocks.storeFor(sessionId).getSnapshot()
        blocks.set(sessionId, ownedBlock.current)
        setBusy(true)
        try {
          await api('/bind', { method: 'POST', body: JSON.stringify({ sessionId, cardId: id, replace: currentId !== '', expectedCardId: currentId || null }) })
          overlay.changed()
        } catch (error) {
          window.alert(`切换角色失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          releaseBlock()
          setBusy(false)
        }
      }
      const currentScriptApprovals = new Set((cardRecord?.scripts || []).map(script => `${script.id}:${script.approvedHash || ''}`))
      const backgroundScripts = verifiedScripts.filter(script => script?.kind === 'javascript' && script.enabled === true && typeof script.approvedHash === 'string' && currentScriptApprovals.has(`${script.id}:${script.approvedHash}`))
      return h('span', { className: 'dst-composer-character' },
        h(CharacterSelect, {
          cards: library.value.cards,
          value: currentId,
          busy,
          locked,
          compact: true,
          onChange: id => { void selectCard(id) },
          onManage: () => overlay.open('manager', sessionId),
        }),
        ...backgroundScripts.map(script => h(TrustedFrame, { key: `background:${cardRecord?.id || 'none'}:${script.id}:${script.approvedHash}`, sessionId, script, eventState, hidden: true, title: `${script.name} 后台脚本` })))
    }

    function sessionAgentPreset(summary) {
      return summary?.projectionValues?.agentPreset ?? summary?.agentPreset
    }

    function ComposerCharacterSelect(props) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      const draft = String(props.useInput(state => state.draft) ?? '')
      const phase = props.useInput(state => state.phase)
      const draftRef = React.useRef(draft)
      const phaseRef = React.useRef(phase)
      const inputActionsRef = React.useRef(props.inputActions)
      draftRef.current = draft
      phaseRef.current = phase
      inputActionsRef.current = props.inputActions
      const appendInput = React.useCallback(value => {
        const text = String(value ?? '').trim()
        if (text === '' || text.length > 32768) throw new RangeError('script composer text is empty or too large')
        const inputActions = inputActionsRef.current
        if (phaseRef.current !== 'plain' || typeof inputActions?.setDraft !== 'function') throw new Error('conversation composer is unavailable')
        const current = draftRef.current.trim()
        const next = current === '' ? text : `${current}\n${text}`
        draftRef.current = next
        inputActions.setDraft(next)
        return { draft: next }
      }, [])
      return agentPreset === 'sillytavern' ? h(TavernCharacterSelect, { ...props, appendInput }) : null
    }

    function greetingSegments(input, allowHtmlFragments = false, stripOpeningMarkers = true) {
      let source = String(input ?? '')
      if (stripOpeningMarkers) source = source
        .replace(/^\s*<start>\s*(?:\r?\n|$)/i, '')
        .replace(/(?:(?:\r?\n)?\s*(?:<\/start>|<end>)\s*)+$/i, '')
        .trim()
      if (source.trim() === '') return []
      if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(source)) return [{ type: 'html', value: source }]
      const lines = source.match(/[^\n]*(?:\n|$)/g) || []
      const segments = []
      const push = (type, value) => {
        if (value === '') return
        const previous = segments.at(-1)
        if (type === 'markdown' && previous?.type === type) previous.value += value
        else segments.push({ type, value })
      }
      let fence = null
      let markdownStart = 0
      let offset = 0
      let hasFence = false
      for (const line of lines) {
        if (line === '') continue
        const end = offset + line.length
        if (fence === null) {
          const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/)
          const validOpening = opening !== null && !(opening[1][0] === '`' && opening[2].includes('`'))
          if (validOpening) {
            const info = opening[2].trim()
            fence = { char: opening[1][0], length: opening[1].length, html: /^html?$/i.test(info), bodyStart: end }
            hasFence = true
            if (fence.html && offset > markdownStart) push('markdown', source.slice(markdownStart, offset))
          }
        } else {
          const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/)
          if (closing !== null && closing[1][0] === fence.char && closing[1].length >= fence.length) {
            if (fence.html) {
              push('html', source.slice(fence.bodyStart, offset))
              markdownStart = end
            }
            fence = null
          }
        }
        offset = end
      }
      if (fence?.html) {
        push('html', source.slice(fence.bodyStart))
        markdownStart = source.length
      }
      if (markdownStart < source.length) push('markdown', source.slice(markdownStart))
      if (allowHtmlFragments && !hasFence && /<(?:style|script|div|section|article|main|aside|form|button|input|select|textarea|canvas|svg)(?:\s|>)/i.test(source)) return [{ type: 'html', value: source }]
      return segments
        .map(segment => ({ ...segment, value: stripOpeningMarkers ? segment.value.trim() : segment.value }))
        .filter(segment => segment.type === 'html' || segment.value.trim() !== '')
    }

    const standaloneCompatibilitySnapshot = Object.freeze({ schemaVersion: 1, runtimeRevision: 0, sessionId: '__standalone__', state: { sessionId: '__standalone__', binding: null, card: null, history: [] }, bindingRevision: 0, cardRecord: null, characterCard: null, character: {}, worldbook: null, persona: { name: 'User', description: '' }, variables: {}, globalVariables: {}, scriptInjections: [], currentSwipeId: 0, messages: [], context: { chatId: '__standalone__', characterId: null, groupId: null, name1: 'User', name2: 'Character', chatMetadata: {} }, compatibility: {} })

    function GreetingHtmlFrame({ sessionId, source, onSetChatMessages, onCommitSwipe, onTriggerSlash }) {
      const script = React.useMemo(() => ({ id: 'opening-html', name: '角色开场 HTML', kind: 'html', source }), [source])
      const actions = React.useMemo(() => ({
        setChatMessages: (args, channel) => {
          if (typeof onSetChatMessages !== 'function') throw new Error('opening swipe selection is unavailable after the conversation starts')
          return onSetChatMessages(args?.messages, channel)
        },
        commitSwipe: (args, channel) => {
          if (typeof onCommitSwipe !== 'function') throw new Error('opening swipe commit is unavailable after the conversation starts')
          return onCommitSwipe(args?.swipe_id, channel)
        },
        triggerSlash: args => {
          if (typeof onTriggerSlash !== 'function') throw new Error('opening slash bridge is unavailable in conversation history')
          return onTriggerSlash(args?.command)
        },
      }), [onSetChatMessages, onCommitSwipe, onTriggerSlash])
      return h(TrustedFrame, { sessionId, script, className: 'dst-opening-html', title: '角色开场 HTML', actions, initialSnapshotOverride: sessionId ? null : standaloneCompatibilitySnapshot })
    }

    function GreetingContent({ sessionId, text, onSetChatMessages, onCommitSwipe, onTriggerSlash }) {
      const segments = greetingSegments(text, true)
      return h('div', { className: 'dst-opening-text' }, ...segments.map((segment, index) => segment.type === 'html'
        ? h(GreetingHtmlFrame, { key: `html:${index}`, sessionId, source: segment.value, onSetChatMessages, onCommitSwipe, onTriggerSlash })
        : h(TavernMarkdownContent, { key: `markdown:${index}`, text: segment.value })))
    }

    function openingEchoNotice(command) {
      const match = String(command ?? '').trim().match(/^\/echo(?:\s+severity=([^\s]+))?(?:\s+([\s\S]*))?$/i)
      if (!match) throw new Error(`unsupported SillyTavern slash command: ${String(command ?? '')}`)
      const severity = ['success', 'warning', 'error', 'info'].includes(String(match[1] || '').toLowerCase()) ? String(match[1]).toLowerCase() : 'info'
      return { severity, text: String(match[2] || '').trim() || '完成' }
    }

    function RegexGreetingContent({ sessionId, text, depth = 0, ...props }) {
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [rendered, setRendered] = React.useState(text)
      React.useEffect(() => {
        const controller = new AbortController()
        setRendered(text)
        if (rules.length > 0 && String(text || '') !== '') regexEngine.run(text, rules, controller.signal, { placement: 2, isMarkdown: true, depth }, scope).then(value => { if (!controller.signal.aborted) setRendered(value.text) }).catch(() => undefined)
        return () => controller.abort()
      }, [text, fingerprint, scope, depth])
      return h(GreetingContent, { ...props, sessionId, text: rendered })
    }

    function TavernOpeningGreetingContent({ sessionId, version }) {
      const [swipeId, setSwipeId] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const preparedSwipes = React.useRef(new Map())
      const greeting = useAsync(signal => api(`/greeting?sessionId=${encodeURIComponent(sessionId)}${swipeId === null ? '' : `&swipeId=${swipeId}`}`, { signal }), [sessionId, version, swipeId])
      const openingRuntime = useAsync(signal => api(`/compat/runtime?sessionId=${encodeURIComponent(sessionId)}`, { signal }), [sessionId, version, swipeId])
      React.useEffect(() => {
        if (openingRuntime.value) compatRuntime.set(sessionId, openingRuntime.value, `opening:${openingRuntime.value.bindingRevision}:${openingRuntime.value.cardRecord?.id || 'none'}:${openingRuntime.value.chatRevision ?? -1}`)
      }, [sessionId, openingRuntime.value])
      React.useEffect(() => {
        preparedSwipes.current.clear()
        setSwipeId(null)
        setNotice(null)
        return () => { preparedSwipes.current.clear() }
      }, [sessionId, version])
      const setChatMessages = React.useCallback(async (messages, channel) => {
        if (!Array.isArray(messages)) throw new TypeError('setChatMessages expects an array')
        const update = messages.find(message => Number(message?.message_id) === 0 && Number.isSafeInteger(Number(message?.swipe_id)))
        if (update === undefined) throw new TypeError('opening setChatMessages requires message_id 0 and a safe integer swipe_id')
        const nextSwipe = Number(update.swipe_id)
        const swipeCount = Number(greeting.value?.swipeCount)
        if (nextSwipe < 0 || !Number.isSafeInteger(swipeCount) || nextSwipe >= swipeCount) throw new RangeError(`opening swipe_id ${nextSwipe} is unavailable`)
        const selected = await api('/opening/select', { method: 'POST', body: JSON.stringify({ sessionId, swipeId: nextSwipe }) })
        if (Number(selected?.swipeId) !== nextSwipe) throw new Error('opening swipe selection was not committed')
        preparedSwipes.current.set(channel, nextSwipe)
        return { message_id: 0, swipe_id: nextSwipe }
      }, [sessionId, greeting.value?.swipeCount])
      const commitSwipe = React.useCallback((value, channel) => {
        const nextSwipe = Number(value)
        if (!Number.isSafeInteger(nextSwipe) || preparedSwipes.current.get(channel) !== nextSwipe) throw new Error('opening swipe commit does not match the prepared frame selection')
        preparedSwipes.current.delete(channel)
        setSwipeId(nextSwipe)
        return { message_id: 0, swipe_id: nextSwipe }
      }, [])
      const triggerSlash = React.useCallback(command => {
        const next = openingEchoNotice(command)
        setNotice(next)
        return next.text
      }, [])
      if (greeting.error || !greeting.value?.text) return null
      return h('section', {
        className: 'dst-opening-greeting',
        'aria-label': '角色开场预览',
        'aria-live': 'polite',
        'aria-busy': greeting.loading || undefined,
      },
      h('header', { className: 'dst-opening-header' },
        h(TavernMugIcon, { className: 'dst-opening-icon' }),
        h('strong', { className: 'dst-opening-name' }, greeting.value.characterName)),
      h(RegexGreetingContent, { sessionId, text: greeting.value.text, onSetChatMessages: setChatMessages, onCommitSwipe: commitSwipe, onTriggerSlash: triggerSlash }),
      h('footer', { className: `dst-opening-hint${notice ? ` ${notice.severity}` : ''}`, role: notice ? 'status' : undefined }, notice?.text || '发送第一条消息后开始对话'))
    }

    function TavernOpeningGreeting({ sessionId }) {
      const version = useOverlay().version
      return h(TavernOpeningGreetingContent, { key: sessionId, sessionId, version })
    }

    function ComposerOpeningGreeting(props) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      if (agentPreset !== 'sillytavern' || props.session?.blank !== true) return null
      return h(TavernOpeningGreeting, { key: props.sessionId, sessionId: props.sessionId })
    }

    function TavernNarratorMessage({ node, sessionId }) {
      const text = node?.outcome?.kind === 'success' ? String(node.outcome.text ?? '') : ''
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const eventState = useSessionStore(scriptEvents, sessionId)
      const commandSeq = node?.run?.seq ?? node?.seq
      const depth = (eventState?.history || []).filter(message => Number(message?.seq) > Number(commandSeq) && (message?.role === 'user' || message?.role === 'assistant')).length
      const rules = React.useMemo(() => displayRegexRules(scripts), [scripts])
      const fingerprint = rules.map(rule => rule.approvedHash || scriptApprovalMaterial(rule)).join('|')
      const [rendered, setRendered] = React.useState(text)
      React.useEffect(() => {
        const controller = new AbortController()
        setRendered(text)
        if (text !== '' && rules.length > 0) regexEngine.run(text, rules, controller.signal, { placement: 3, isMarkdown: true, depth }, scope).then(value => { if (!controller.signal.aborted) setRendered(value.text) }).catch(() => undefined)
        return () => controller.abort()
      }, [text, fingerprint, scope, depth])
      return rendered === '' ? null : h('article', { className: 'dst-opening-message', 'aria-label': '旁白' }, h(ScriptConversationContent, { sessionId, seq: `narrator-${node?.run?.seq || 'message'}`, text: rendered, eventState, label: '旁白' }))
    }

    function TavernOpeningMessage({ node, sessionId }) {
      const text = node?.outcome?.kind === 'success' ? node.outcome.text : ''
      const eventState = useSessionStore(scriptEvents, sessionId)
      const depth = (eventState?.history || []).filter(message => message?.role === 'user' || message?.role === 'assistant').length
      if (typeof text !== 'string' || text.trim() === '') return null
      return h('article', { className: 'dst-opening-message', 'aria-label': '角色开场' }, h(RegexGreetingContent, { sessionId, text, depth }))
    }

    const CSS = `
.dst-memory-context-form{margin-top:14px;padding:12px;border:1px solid #dce3ed;border-radius:10px}.dst-memory-context-form>.dst-section-title{font-size:14px;margin-bottom:4px}.dst-memory-context{display:flex;flex-wrap:wrap;gap:6px 14px;color:#475569;font-size:12px}.dst-memory-context>span{overflow-wrap:anywhere}
.dst-overlay{position:fixed;inset:0;z-index:90;pointer-events:none;font:14px/1.45 system-ui,sans-serif;color:#182033}.dst-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.42);pointer-events:auto}.dst-dialog-wrap{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}.dst-dialog-card{width:min(520px,calc(100vw - 32px));background:var(--dsh-surface,#fff);border:1px solid #ccd5e3;border-radius:16px;padding:20px;box-shadow:0 24px 70px #0f172a55;pointer-events:auto}.dst-dialog-title{font-size:18px;font-weight:750;margin-bottom:8px}.dst-manager{position:absolute;inset:0;width:100vw;height:100dvh;box-sizing:border-box;background:var(--dsh-surface,#fff);border:0;border-radius:0;box-shadow:none;overflow:hidden;pointer-events:auto;display:flex;flex-direction:column}.dst-manager>header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e2e8f0}.dst-manager>header strong{display:block;font-size:17px}.dst-manager>header span{display:block;color:#64748b;font-size:12px}.dst-manager-content{min-height:0;display:flex;flex-direction:column;flex:1}.dst-manager .dst-manager-content{overflow:hidden}.dst-settings .dst-manager-content{min-height:520px}.dst-current{padding:9px 16px;background:#eef6ff;color:#24548a}.dst-current.empty{background:#fff7db;color:#76520b}.dst-tabs{display:flex;gap:5px;padding:10px 12px;border-bottom:1px solid #e2e8f0;overflow-x:auto}.dst-tab-body{padding:16px;overflow:auto;flex:1}.dst-button{border:0;border-radius:9px;padding:8px 12px;background:#326fd1;color:white;cursor:pointer;font:inherit}.dst-button:disabled{opacity:.5;cursor:not-allowed}.dst-button.secondary,.dst-button.tab{background:#eef2f7;color:#334155}.dst-button.active,.dst-button.tab.active{background:#dcecff;color:#174c8d}.dst-button.small{padding:5px 9px;font-size:12px}.dst-button.danger{background:#fee2e2;color:#a51f2a}.dst-header-button{padding:5px 9px;background:#f3e8ff;color:#6b21a8;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-actions{display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap}.dst-field{display:flex;flex-direction:column;gap:5px;margin:9px 0;min-width:0;flex:1}.dst-field>span{font-size:12px;font-weight:650;color:#475569}.dst-field input,.dst-field textarea,.dst-field select{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:var(--dsh-surface,#fff);color:inherit;font:inherit}.dst-field textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.dst-inline-fields{display:flex;gap:10px}.dst-section-title{font-size:16px;font-weight:750;margin-bottom:10px}.dst-muted{color:#64748b;font-size:12px}.dst-warning{background:#fff4d6;border:1px solid #f0cb69;color:#744d00;padding:9px;border-radius:8px}.dst-status{min-height:20px}.dst-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.dst-card{border:1px solid #dce3ed;border-radius:11px;padding:12px;display:flex;flex-direction:column;gap:6px}.dst-tags,.dst-memory-keywords{display:flex;gap:4px;flex-wrap:wrap}.dst-tags span,.dst-memory-keywords span{font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:999px}.dst-memory-table{display:flex;flex-direction:column;gap:7px;margin-top:12px}.dst-memory-row{display:flex;justify-content:space-between;gap:12px;border:1px solid #dce3ed;border-radius:9px;padding:9px}.dst-memory-row pre{margin:5px 0 0;white-space:pre-wrap;font-size:11px}.dst-script{border:1px solid #dce3ed;border-radius:10px;padding:12px;margin:12px 0}.dst-trusted-frame,.dst-turn-render iframe{width:100%;min-height:260px;border:1px solid #cbd5e1;border-radius:8px;background:white}.dst-template-list{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}.dst-turn-render{margin:8px 0;padding:8px;border:1px solid #e2e8f0;border-radius:9px}.dst-turn-render summary{cursor:pointer;color:#6b21a8}.dst-settings{padding:8px 4px}.dst-settings h2{margin-top:0}.dst-loading,.dst-error{padding:20px}.dst-error{color:#b91c1c}.dst-confirm-layer{position:fixed;inset:0;z-index:8;display:grid;place-items:center;padding:16px;background:#0f172a66;pointer-events:auto}.dst-confirm-card{box-sizing:border-box;width:min(600px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border:1px solid #ccd5e3;border-radius:14px;background:var(--dsh-surface,#fff);box-shadow:0 24px 70px #0f172a66}.dst-reference-list{margin:10px 0;padding:10px 12px;border:1px solid #dce3ed;border-radius:9px}.dst-reference-list ul{margin:6px 0 0;padding-left:20px}.dst-worldbook-controls{display:grid;grid-template-columns:minmax(260px,1fr) auto minmax(260px,1fr);align-items:end;gap:12px;margin-bottom:14px;padding:12px;border:1px solid #dce3ed;border-radius:11px}.dst-worldbook-controls>.dst-muted{grid-column:1/-1;margin:0}.dst-worldbook-resource-actions{align-self:end;margin:9px 0}.dst-worldbook-resource-actions .dst-button{white-space:nowrap}@media(max-width:900px){.dst-worldbook-controls{grid-template-columns:1fr}.dst-worldbook-controls>.dst-muted{grid-column:auto}}@media(max-width:640px){.dst-inline-fields{display:block}.dst-manager{inset:0;width:100vw;height:100dvh}.dst-card-grid{grid-template-columns:1fr}}
.dst-worldbook-book{padding:10px 12px;border:1px solid #dce3ed;border-radius:11px;background:color-mix(in srgb,var(--dsh-surface,#fff) 96%,#326fd1 4%)}.dst-worldbook-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#475569;cursor:pointer}.dst-worldbook-check input{margin:0}.dst-worldbook-setting{align-self:center;min-height:36px;padding-top:16px;box-sizing:border-box}.dst-worldbook-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 8px}.dst-worldbook-list{display:flex;flex-direction:column;gap:10px}.dst-worldbook-entry{content-visibility:auto;contain-intrinsic-size:92px 620px;border:1px solid #dce3ed;border-radius:11px;background:var(--dsh-surface,#fff);overflow:hidden}.dst-worldbook-entry.disabled{opacity:.72}.dst-worldbook-entry-head{display:flex;align-items:center;gap:9px;padding:10px 12px}.dst-worldbook-entry-head strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-worldbook-order{white-space:nowrap}.dst-worldbook-entry>details{border-top:1px solid #e2e8f0}.dst-worldbook-entry summary,.dst-worldbook-advanced summary{padding:8px 12px;color:#326fd1;cursor:pointer;user-select:none}.dst-worldbook-entry-body{padding:4px 12px 12px}.dst-worldbook-policies{display:inline-flex;flex:0 0 auto;gap:4px;padding:3px;border:1px solid #d7deea;border-radius:10px;background:#f4f7fb}.dst-worldbook-policy{border:0;border-radius:7px;padding:5px 8px;background:transparent;color:#475569;font:inherit;font-size:12px;cursor:pointer}.dst-worldbook-policy.active{background:var(--dsh-surface,#fff);box-shadow:0 1px 4px #0f172a22;color:#172033}.dst-worldbook-policy.constant>span{color:#3478dc}.dst-worldbook-policy.keyword>span{color:#28a35a}.dst-worldbook-policy.vectorized>span{filter:saturate(.7)}.dst-worldbook-vector-note{margin:6px 0;font-size:12px}.dst-worldbook-advanced{margin-top:10px;border:1px solid #e2e8f0;border-radius:9px}.dst-worldbook-advanced-body{padding:0 10px 10px}.dst-worldbook-save{position:sticky;bottom:-16px;z-index:2;margin:16px -16px -16px;padding:10px 16px;border-top:1px solid #dce3ed;background:color-mix(in srgb,var(--dsh-surface,#fff) 94%,transparent)}@media(max-width:640px){.dst-worldbook-entry-head{flex-wrap:wrap}.dst-worldbook-entry-head strong{flex-basis:45%}.dst-worldbook-policies-head{width:100%;box-sizing:border-box}.dst-worldbook-policy{flex:1}.dst-worldbook-setting{padding-top:4px}}
.dst-opening-greeting{box-sizing:border-box;width:100%;height:max(320px,calc(100dvh - 260px));min-height:0;margin:0 0 8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,#dfe3ea);border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#182033);box-shadow:0 4px 18px rgba(15,23,42,.06);font:14px/1.55 system-ui,sans-serif;display:flex;flex:0 0 auto;flex-direction:column;overflow:hidden}.dst-opening-header{display:flex;flex:0 0 auto;align-items:center;gap:7px;margin-bottom:8px}.dst-opening-icon{flex:0 0 auto;color:var(--dsw-alias-brand-primary,#326fd1)}.dst-opening-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.dst-opening-text{display:flex;flex:1 1 auto;flex-direction:column;gap:10px;min-height:0;max-height:none;overflow:auto;white-space:normal;overflow-wrap:anywhere}.dst-opening-html{display:block;box-sizing:border-box;width:100%;height:auto;min-height:0;flex:0 0 auto;border:0;border-radius:10px;background:var(--dsw-alias-bg-base,#fff)}.dst-opening-hint{flex:0 0 auto;margin-top:9px;color:var(--dsw-alias-label-secondary,#64748b);font-size:12px}.dst-opening-message{box-sizing:border-box;width:100%;padding:4px 16px 12px;color:var(--dsw-alias-label-primary,#182033);font:15px/1.65 system-ui,sans-serif}.dst-opening-message .dst-opening-text{display:flex;flex-direction:column;gap:10px;max-height:none;overflow:visible}.dst-opening-message .dst-opening-html{min-height:0;flex:0 0 auto}@media(max-width:560px){.dst-opening-greeting{height:max(320px,calc(100dvh - 300px))}}.dst-composer-character{display:inline-flex;align-items:center;min-width:0;max-width:min(100%,220px);flex:0 1 auto}.dst-character-menu{min-width:0;max-width:100%;flex:0 1 auto}.dst-character-seat{position:relative;display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;max-width:min(100%,220px);min-width:0;min-height:28px;padding:0 8px;border:0;border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary,var(--dsh-text,#182033));font:500 13px/20px system-ui,sans-serif;white-space:nowrap;overflow:hidden;cursor:pointer}.dst-character-seat:not(:disabled):hover,.dst-character-seat[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,#eef2f7)}.dst-character-seat:disabled{cursor:default;color:var(--dsw-alias-label-quaternary,#9aa1ad)}.dst-character-seat.compact{max-width:180px}.dst-character-icon,.dst-character-chevron{flex:0 0 auto;color:var(--dsw-alias-label-primary,#182033)}.dst-character-chevron{color:var(--dsw-alias-label-caption,#81858c)}.dst-character-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-character-seat.compact .dst-character-label{flex:0 0 auto;width:max-content}.dst-character-seat.compact.icon-only{width:28px;max-width:28px;flex:0 0 28px;justify-content:center;padding:0 6px}.dst-character-seat.compact.icon-only .dst-character-label{position:absolute;visibility:hidden;pointer-events:none}.dst-character-seat.compact.icon-only .dst-character-chevron{display:none}.dst-character-seat:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#8fb5f5);outline-offset:2px}
`
    const RUNTIME_CSS = `
.dst-memory-empty-state{margin:12px 0;padding:28px 16px;border:1px dashed #cbd5e1;border-radius:11px;color:#64748b;text-align:center}.dst-memory-table{gap:12px}.dst-memory-row{content-visibility:auto;contain-intrinsic-size:180px;display:flex;flex-direction:column;gap:12px;border-radius:12px;padding:14px;background:var(--dsh-surface,#fff)}.dst-memory-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dst-memory-identity{display:flex;min-width:0;align-items:center;gap:8px}.dst-memory-identity strong{overflow-wrap:anywhere}.dst-memory-table-name{flex:none;padding:2px 8px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:11px;font-weight:700}.dst-memory-meta{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:8px;color:#64748b;font-size:11px}.dst-memory-value{min-width:0;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--dsh-surface,#fff) 94%,#326fd1 6%)}.dst-memory-fields{display:flex;flex-direction:column;margin:0}.dst-memory-field{display:grid;grid-template-columns:minmax(90px,25%) minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid #dce3ed}.dst-memory-field:first-child{padding-top:0}.dst-memory-field:last-child{padding-bottom:0;border-bottom:0}.dst-memory-field dt{color:#64748b;font-size:12px;font-weight:650;overflow-wrap:anywhere}.dst-memory-field dd{min-width:0;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.dst-memory-array{display:flex;flex-direction:column;gap:5px;margin:0;padding-left:24px}.dst-memory-array>li{padding-left:3px}.dst-memory-scalar.number{color:#6b21a8;font-variant-numeric:tabular-nums}.dst-memory-scalar.boolean{display:inline-block;padding:1px 7px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:12px}.dst-memory-scalar.boolean.false{background:#f1f5f9;color:#64748b}.dst-memory-scalar.null,.dst-memory-scalar.empty,.dst-memory-empty{color:#94a3b8;font-style:italic}.dst-memory-nested{min-width:0;border:1px solid #dce3ed;border-radius:8px;background:var(--dsh-surface,#fff)}.dst-memory-nested>summary{padding:5px 8px;color:#326fd1;cursor:pointer;font-size:12px;user-select:none}.dst-memory-nested>.dst-memory-fields,.dst-memory-nested>.dst-memory-array{margin:0 8px 8px}.dst-memory-row-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dst-memory-raw{min-width:0;color:#64748b;font-size:12px}.dst-memory-raw>summary{cursor:pointer;user-select:none}.dst-memory-raw pre{box-sizing:border-box;max-width:min(720px,calc(100vw - 96px));max-height:300px;margin:8px 0 0;padding:10px;overflow:auto;border-radius:8px;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:640px){.dst-memory-row-head{flex-direction:column}.dst-memory-meta{flex-wrap:wrap;justify-content:flex-start}.dst-memory-field{grid-template-columns:1fr;gap:3px}.dst-memory-row-actions{align-items:flex-end}}
.dst-memory-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:22px 0 10px}.dst-memory-section-head>.dst-section-title{margin:0}.dst-memory-event-empty{padding:14px;border:1px dashed #cbd5e1;border-radius:10px}.dst-memory-event-graph{display:flex;flex-direction:column;gap:14px}.dst-memory-event-node{content-visibility:auto;contain-intrinsic-size:260px;border:1px solid #cbd5e1;border-radius:12px;padding:14px;background:color-mix(in srgb,var(--dsh-surface,#fff) 97%,#326fd1 3%)}.dst-memory-event-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.dst-memory-event-head strong{overflow-wrap:anywhere}.dst-memory-event-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.dst-memory-event-relations{min-width:0;padding:9px 10px;border:1px solid #dce3ed;border-radius:9px;background:var(--dsh-surface,#fff);font-size:12px}.dst-memory-event-relations>strong{display:block;margin-bottom:4px;color:#475569}.dst-memory-event-relations ul{display:flex;flex-direction:column;gap:4px;margin:0;padding-left:18px}.dst-memory-event-relations li{overflow-wrap:anywhere}.dst-memory-event-relations code{color:#24548a}.dst-memory-event-relations small{display:block;color:#64748b}.dst-memory-event-rows{margin-top:12px}.dst-memory-ungrouped{margin-top:22px}.dst-memory-provenance{flex-basis:100%}@media(max-width:640px){.dst-memory-section-head{display:block}.dst-memory-event-links{grid-template-columns:1fr}}
.dst-markdown-content{display:flow-root;min-width:0;overflow-wrap:anywhere}.dst-markdown-content>*>:first-child,.dst-legacy-font>*>:first-child{margin-top:0}.dst-markdown-content>*>:last-child,.dst-legacy-font>*>:last-child{margin-bottom:0}.dst-legacy-font{margin:0 0 1em;color:inherit}.dst-assistant-message{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary,#182033);font:15px/1.65 system-ui,sans-serif}.dst-assistant-message>*>:first-child{margin-top:0}.dst-assistant-message>[data-turn-process-inline][hidden]{margin-bottom:0}.dst-user-row{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.dst-user-stack{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px)*.702),82%)}.dst-user-message{box-sizing:border-box;max-width:100%;padding:10px 16px;border-radius:22px;background:var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-2,#eef2f7));color:var(--dsw-alias-label-primary,#182033);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}.dst-user-message>*>:first-child{margin-top:0}.dst-user-message>*>:last-child{margin-bottom:0}.dst-assistant-reasoning{margin:8px 0;color:var(--dsw-alias-label-secondary,#64748b)}.dst-assistant-reasoning>summary{cursor:pointer}.dst-assistant-reasoning>pre,.dst-assistant-unknown{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 ui-monospace,monospace}.dst-assistant-stopped,.dst-script-render-error{display:block;margin-top:6px;color:#b45309;font-size:12px}.dst-script-rendering{padding:8px 0;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px}.dst-script-conversation{display:flex;width:100%;min-width:0;flex-direction:column;gap:10px}.dst-script-conversation .dst-trusted-frame{display:block;width:100%;height:280px;min-height:0;border:0;border-radius:12px;background:var(--dsw-alias-bg-base,#fff)}
.dst-story-progress-toggle{box-sizing:border-box;display:flex;align-items:center;width:100%;min-width:0;height:33px;margin-bottom:8px;padding:0 0 8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:none;color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer;text-align:left;font:inherit}.dst-story-progress-label{min-width:0;overflow:hidden;font-size:14px;line-height:24px;text-overflow:ellipsis;white-space:nowrap}.dst-story-progress-chevron{flex:none;width:16px;height:16px;margin-left:6px;color:var(--dsw-alias-label-tertiary,#81858c);transform:rotate(-90deg);transition:transform 100ms ease}.dst-story-progress-toggle[data-open] .dst-story-progress-chevron{transform:rotate(0deg)}.dst-story-progress-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#8fb5f5);outline-offset:2px}[data-chat-flow-kind='system-prompt']:has([data-dst-system-prompt-hidden]){display:none}@media(prefers-reduced-motion:reduce){.dst-story-progress-chevron{transition:none}}
`

    const inject = ['slots', 'commandUi', 'conversation']
    function apply(ctx) {
      const conversation = ctx.get('conversation')
      if (conversation === undefined) return
      const style = document.createElement('style')
      style.dataset.dshSillyTavern = 'true'
      style.textContent = `${CSS}${RUNTIME_CSS}`
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove())
      ctx.effect(() => () => overlay.reset())
      ctx.effect(() => compatRuntime.start())
      ctx.effect(() => () => { scriptPolicies.reset(); scriptScopes.reset(); scriptEvents.reset(); compatRuntime.reset(); regexEngine.dispose() })
      const registerMessageRenderers = () => {
        const disposeAssistant = ctx.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', priority: -20 }, TavernAssistantNode)
        const disposeUser = ctx.slots.register({ name: 'conversation.chat.node', key: 'user', priority: -20 }, TavernUserNode)
        const disposeSteering = ctx.slots.register({ name: 'conversation.chat.node', key: 'steering', priority: -20 }, TavernUserNode)
        const disposeTurnProcess = ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-process', locale: 'chat', priority: -20 }, TavernTurnProcessNode)
        const disposeSystemPrompt = ctx.slots.register({ name: 'conversation.chat.node', key: 'system-prompt', locale: 'chat', priority: -20 }, TavernSystemPromptNode)
        return () => { disposeSystemPrompt(); disposeTurnProcess(); disposeSteering(); disposeUser(); disposeAssistant() }
      }

      ctx.effect(() => ctx.commandUi.decorate({
        name: 'st-import',
        available: () => true,
        ui: {
          kind: 'popupSelect',
          async options() {
            return [
              { id: 'file', label: '导入 V3 角色卡', detail: 'PNG、APNG 或 JSON；绑定到当前会话' },
              { id: 'manager', label: '打开酒馆管理', detail: '角色库、角色设定、记忆、脚本与提示词模板' },
            ]
          },
          onSelect(option, session) {
            overlay.open(option.id === 'file' ? 'import' : 'manager', session.sessionId)
          },
        },
      }))

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'sillytavern-character', order: 25, label: '角色卡', inject: () => ({ blocks: conversation.blocks, registerMessageRenderers }) }, ComposerCharacterSelect))
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'sillytavern-opening-greeting', order: -10, label: '角色开场预览' }, ComposerOpeningGreeting))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sillytavern-overlay', order: 60, label: '酒馆模式' }, OverlaySurface))
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'sillytavern', order: 18, label: '酒馆模式' }, SettingsSection))
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'st-opening' }, TavernOpeningMessage))
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'narrator' }, TavernNarratorMessage))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
