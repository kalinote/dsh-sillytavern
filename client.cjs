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
    const composerBridges = new Map()
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
      return String(source).replace(/\bwindow\.parent\.document\.querySelector\(\s*(['"])#send_textarea\1\s*\)/g, 'window.__dshComposerInput')
    }

    function trustedDocument(script, channel) {
      script = executableScript(script)
      const bootstrap = `
<script>
(() => {
  const channel = ${JSON.stringify(channel)};
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  const rpc = (action, args = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('SillyTavern script RPC timed out')); }, 5000);
    pending.set(id, { resolve, reject, timer });
    try { parent.postMessage({ __dshSillyTavern: true, channel, id, action, args }, '*'); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  let composerDraft = '';
  let composerRestore = [];
  let composerQueue = Promise.resolve();
  const readComposerDraft = () => [...composerRestore, composerDraft].filter(value => value.trim() !== '').join('\\n');
  Object.defineProperty(window, '__dshComposerInput', { value: Object.freeze({
    get value() { return readComposerDraft(); },
    set value(value) { composerRestore = []; composerDraft = String(value ?? ''); },
    dispatchEvent() {
      const text = readComposerDraft().trim();
      if (text === '') return true;
      composerDraft = ''; composerRestore = [];
      composerQueue = composerQueue.then(() => rpc('appendInput', { text })).catch(error => {
        composerRestore.push(text);
        console.error('SillyTavern composer bridge failed:', error);
      });
      return true;
    },
    focus() { return true; },
  }) });
  addEventListener('message', event => {
    const msg = event.data;
    if (event.source !== parent || !msg || msg.__dshSillyTavern !== true || msg.channel !== channel) return;
    if (msg.replyTo) { const item = pending.get(msg.replyTo); if (!item) return; pending.delete(msg.replyTo); clearTimeout(item.timer); msg.ok ? item.resolve(msg.value) : item.reject(new Error(msg.error || 'RPC failed')); return; }
    const set = listeners.get(msg.event); if (set) for (const fn of [...set]) fn(msg.payload);
  });
  const eventOn = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name)?.delete(fn); };
  const eventEmit = (name, payload) => { const set = listeners.get(name); if (set) for (const fn of [...set]) fn(payload); parent.postMessage({ __dshSillyTavern: true, channel, event: name, payload }, '*'); };
  const getState = () => rpc('getState');
  window.TavernHelper = {
    getState,
    getCharacterCard: async () => (await getState()).card?.card,
    getWorldbook: () => rpc('getWorldbook'),
    getVariables: async () => (await getState()).binding?.variables || {},
    setVariables: variables => rpc('setVariables', { variables }),
    injectPrompts: injections => rpc('injectPrompts', { injections }),
    memory: operation => rpc('memory', { operation }),
    eventOn, eventEmit,
  };
  window.getVariables = window.TavernHelper.getVariables;
  window.setVariables = window.TavernHelper.setVariables;
  window.injectPrompts = window.TavernHelper.injectPrompts;
  window.eventOn = eventOn;
  window.eventEmit = eventEmit;
  window.tavern_events = { APP_READY: 'app_ready', MESSAGE_RECEIVED: 'message_received', CHARACTER_CHANGED: 'character_changed' };
  window.__dshTavernReady = () => { eventEmit('app_ready', { source: 'dsh-sillytavern' }); parent.postMessage({ __dshSillyTavern: true, channel, event: 'frame-ready' }, '*'); };
})();
<\/script>`
      const ready = `<script>window.__dshTavernReady?.()<\/script>`
      if (script.kind === 'html') {
        const source = compatibleHtmlSource(script.source)
        if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(source)) {
          const withBootstrap = /<head[\s>]/i.test(source)
            ? source.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`)
            : source.replace(/<html([^>]*)>/i, `<html$1><head>${bootstrap}</head>`)
          if (/<\/body>/i.test(withBootstrap)) return withBootstrap.replace(/<\/body>/i, `${ready}</body>`)
          if (/<\/html>/i.test(withBootstrap)) return withBootstrap.replace(/<\/html>/i, `${ready}</html>`)
          return `${withBootstrap}${ready}`
        }
        return `<!doctype html><html><head>${bootstrap}</head><body>${source}${ready}</body></html>`
      }
      const encoded = btoa(unescape(encodeURIComponent(String(script.source))))
      const runner = `<script>(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const source=new TextDecoder().decode(bytes);const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));try{await import(url);window.__dshTavernReady?.()}finally{URL.revokeObjectURL(url)}})().catch(error=>{document.body.innerHTML='<pre style="color:#b91c1c;white-space:pre-wrap"></pre>';document.querySelector('pre').textContent=error.stack||String(error)})<\/script>`
      return `<!doctype html><html><head><meta charset="utf-8">${bootstrap}<style>body{font:14px/1.5 system-ui;margin:12px;color:#172033}pre{white-space:pre-wrap}</style></head><body><div id="app"></div>${runner}</body></html>`
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
            if (!controller.signal.aborted) setState(previous => {
              const bySeq = new Map([...(previous?.history || []), ...(value.history || [])].map(message => [message.seq, message]))
              const history = [...bySeq.values()].sort((left, right) => left.seq - right.seq).slice(-100)
              return { card: value.card, history, unavailable: false }
            })
          } catch {
            if (!controller.signal.aborted) setState(previous => ({ card: previous?.card ?? null, history: previous?.history || [], unavailable: true }))
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

    function TrustedFrame({ sessionId, script, eventState }) {
      const channel = React.useMemo(() => `dst-${sessionId}-${script.id}-${Math.random().toString(36).slice(2)}`, [sessionId, script.id])
      const frame = React.useRef(null)
      const cursor = React.useRef({ cardId: undefined, seq: -1, initialized: false })
      const [ready, setReady] = React.useState(false)
      React.useEffect(() => {
        cursor.current = { cardId: undefined, seq: -1, initialized: false }
        setReady(false)
        const listener = async event => {
          const message = event.data
          if (!message || message.__dshSillyTavern !== true || message.channel !== channel || event.source !== frame.current?.contentWindow) return
          if (message.event === 'frame-ready') { setReady(true); return }
          if (!message.id) return
          try {
            let value
            if (message.action === 'getState') value = await api(`/session?sessionId=${encodeURIComponent(sessionId)}`)
            else if (message.action === 'getWorldbook') {
              const state = await api(`/session?sessionId=${encodeURIComponent(sessionId)}`)
              const worldbookId = state.binding?.worldbookId || (state.binding?.worldbookExplicit === true ? null : state.card?.defaultWorldbookId)
              value = worldbookId ? normalizeWorldbookRecord(await api(`/worldbook?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(worldbookId)}`)).book : null
            }
            else if (message.action === 'setVariables') value = await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId, patch: { variables: message.args.variables || {} } }) })
            else if (message.action === 'injectPrompts') value = await api('/session/update', { method: 'POST', body: JSON.stringify({ sessionId, patch: { scriptInjections: message.args.injections || [] } }) })
            else if (message.action === 'memory') value = await api('/memory', { method: 'POST', body: JSON.stringify({ sessionId, operation: message.args.operation || {} }) })
            else if (message.action === 'appendInput') {
              const appendInput = composerBridges.get(sessionId)
              if (appendInput === undefined) throw new Error('conversation composer bridge is unavailable')
              value = appendInput(message.args.text)
            }
            else throw new Error(`unsupported script API action ${message.action}`)
            event.source.postMessage({ __dshSillyTavern: true, channel, replyTo: message.id, ok: true, value }, '*')
          } catch (error) {
            event.source.postMessage({ __dshSillyTavern: true, channel, replyTo: message.id, ok: false, error: error.message || String(error) }, '*')
          }
        }
        window.addEventListener('message', listener)
        return () => window.removeEventListener('message', listener)
      }, [channel, sessionId])
      React.useEffect(() => {
        if (!ready || eventState === null) return
        const current = cursor.current
        const post = (event, payload) => frame.current?.contentWindow?.postMessage({ __dshSillyTavern: true, channel, event, payload }, '*')
        const cardId = eventState.card?.id || null
        if (!current.initialized || cardId !== current.cardId) post('character_changed', { cardId, name: eventState.card?.name || null })
        const newer = (eventState.history || []).filter(message => message.seq > current.seq)
        if (!current.initialized && newer.length > 0) post('message_received', { ...newer.at(-1), replay: true })
        else for (const message of newer) post('message_received', { ...message, replay: false })
        current.cardId = cardId
        current.initialized = true
        if (eventState.history?.length) current.seq = Math.max(current.seq, ...eventState.history.map(message => message.seq))
      }, [channel, eventState, ready])
      const srcDoc = React.useMemo(() => trustedDocument(script, channel), [channel, script.kind, script.source])
      return h('iframe', {
        ref: frame,
        className: 'dst-trusted-frame',
        title: script.name,
        sandbox: 'allow-scripts allow-forms allow-popups allow-downloads allow-modals',
        srcDoc,
        onLoad: () => setReady(true),
      })
    }

    function ScriptPreview({ sessionId, script, sample }) {
      const eventState = useSessionEventState(sessionId)
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
        h('p', { className: 'dst-warning' }, '导入脚本默认启用；“启用”只控制脚本是否在对应文本阶段运行，管理页不会自动执行。系统不审查或过滤替换内容，启用前请自行验证。编辑规则、源码或类型后会自动停用。'),
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
                if (!window.confirm(`确认启用脚本“${script.name}”？启用后只会在对话内容匹配时运行，管理页不会自动执行；修改内容后必须重新确认。`)) return
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

    function CharacterSelect({ cards, value, busy, locked = false, onChange, onManage, compact = false }) {
      const [open, setOpen] = React.useState(false)
      const available = Array.isArray(cards) && cards.length > 0
      const selected = available ? cards.find(card => card.id === value) : undefined
      const label = selected === undefined ? '选择角色卡' : cardLabel(selected)
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
          type: 'button',
          className: `dst-character-seat${compact ? ' compact' : ''}`,
          'aria-label': '当前角色卡',
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          title: available ? `当前角色卡：${label}${locked ? '（对话已开始，不能更换）' : ''}` : '请先导入角色卡',
          disabled: busy,
          onClick: () => setOpen(previous => !previous),
        },
        h(TavernMugIcon, { className: 'dst-character-icon' }),
        h('span', { className: 'dst-character-label' }, label),
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
          if (replacement !== undefined) rendered.push(h(ScriptConversationContent, { key: index, ...replacementBase, seq: `${replacementBase.seq}-${index}`, text: replacement, mentions }))
          else rendered.push(h(TavernMarkdownContent, { key: index, text: block.text, streaming, fileMentions: mentions }))
        }
        else if (block?.kind === 'reasoning') rendered.push(h(StoryProcessReasoning, { key: index, hidden: reasoningHidden, reveal: revealProcess },
          h('details', { className: 'dst-assistant-reasoning', open: streaming || undefined }, h('summary', null, streaming ? '思考中…' : '思考过程'), replacements?.[index] !== undefined ? h(ScriptConversationContent, { ...replacementBase, seq: `${replacementBase.seq}-reasoning-${index}`, text: replacements[index] }) : h('pre', null, block.text))))
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

    function RenderedScriptSegments({ sessionId, seq, text, mentions, eventState, label = '脚本渲染内容' }) {
      const segments = greetingSegments(text, true, false)
      if (segments.length === 0) return null
      return h('article', { className: 'dst-script-conversation', 'aria-label': label }, segments.map((segment, index) => segment.type === 'html'
        ? h(TrustedFrame, { key: `html-${index}`, sessionId, script: { id: `conversation-${seq}-${index}`, name: label, kind: 'html', source: segment.value }, eventState })
        : h(TavernMarkdownContent, { key: `markdown-${index}`, text: segment.value, fileMentions: mentions })))
    }

    function ScriptConversationContent({ sessionId, seq, text, mentions }) {
      const eventState = useSessionStore(scriptEvents, sessionId)
      return h(RenderedScriptSegments, { sessionId, seq, text, mentions, eventState })
    }

    function TavernAssistantNode(props) {
      const { node, renderMessageImages, sessionId, useTurnData, openFile, fileMentions, turnProcess } = props
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const messageSeq = node.data.finalNode?.seq ?? node.seq ?? node.data.seq
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
        setRendered({ status: 'loading', message: '', replacements: {} })
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
      if (rendered.status === 'loading') return h('div', { className: 'dst-script-rendering', role: 'status' }, '正在渲染脚本…')
      if (rendered.status === 'rendered') return h(AssistantFallback, { node, renderMessageImages, mentions, replacementBase: { sessionId, seq: node.data.finalNode?.seq ?? node.seq ?? 0 }, replacements: rendered.replacements, reasoningHidden, revealProcess })
      return h(React.Fragment, null,
        h(AssistantFallback, { node, renderMessageImages, mentions, reasoningHidden, revealProcess }),
        rendered.status === 'error' ? h('p', { className: 'dst-script-render-error' }, `脚本渲染失败：${rendered.message}`) : null)
    }

    function TavernUserNode({ node, renderMessageImages, sessionId }) {
      const scripts = useSessionStore(scriptPolicies, sessionId)
      const scope = useSessionStore(scriptScopes, sessionId)
      const eventState = useSessionStore(scriptEvents, sessionId)
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
      const rendered = []
      const images = []
      const content = node.data.content || []
      for (let index = 0; index < content.length; index += 1) {
        const block = content[index]
        if (block?.type === 'text') rendered.push(replacements[index] !== undefined
          ? h(ScriptConversationContent, { key: index, sessionId, seq: `user-${node.data.seq}-${index}`, text: replacements[index], eventState, label: '用户 Regex 替换' })
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
      const session = useAsync(() => api(`/session?sessionId=${encodeURIComponent(sessionId)}`), [sessionId, version])
      const library = useAsync(() => api(`/library?sessionId=${encodeURIComponent(sessionId)}`), [sessionId, version])
      const eventState = useSessionEventState(sessionId)
      const [busy, setBusy] = React.useState(false)
      const ownedBlock = React.useRef(Object.freeze({ reason: '正在切换角色卡…' }))
      const previousBlock = React.useRef(undefined)
      const appendInputRef = React.useRef(appendInput)
      appendInputRef.current = appendInput
      const cardRecord = session.value?.card
      const eventTail = eventState?.history?.at(-1)?.seq ?? -1
      const globalVariablesToken = JSON.stringify(session.value?.globalVariables || {})
      const regexSourcesToken = [
        ...(session.value?.globalRegexScripts || []),
        ...(session.value?.presetRegexScripts || []),
        ...(cardRecord?.scripts || []),
      ].map(script => `${script.id}:${script.enabled}:${script.approvedHash || ''}`).join('|')
      React.useEffect(() => typeof registerMessageRenderers === 'function' ? registerMessageRenderers() : undefined, [registerMessageRenderers])
      React.useEffect(() => {
        const bridge = value => appendInputRef.current(value)
        composerBridges.set(sessionId, bridge)
        return () => { if (composerBridges.get(sessionId) === bridge) composerBridges.delete(sessionId) }
      }, [sessionId])
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
        const messages = (eventState?.history || []).map(message => ({ role: message.role, text: message.text, seq: message.seq }))
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
        scriptScopes.set(sessionId, scope, `${cardRecord?.id || 'none'}:${session.value?.binding?.revision || 0}:${eventTail}:${globalVariablesToken}`)
      }, [sessionId, cardRecord?.id, cardRecord?.updatedAt, session.value?.binding?.revision, eventTail, globalVariablesToken])
      React.useEffect(() => {
        scriptEvents.set(sessionId, eventState, `${eventTail}:${eventState?.history?.length || 0}:${eventState?.unavailable === true}:${eventState?.card?.id || 'none'}`)
      }, [sessionId, eventState, eventTail])
      React.useEffect(() => () => { scriptPolicies.clear(sessionId); scriptScopes.clear(sessionId); scriptEvents.clear(sessionId) }, [sessionId])
      const releaseBlock = () => {
        if (blocks.storeFor(sessionId).getSnapshot() === ownedBlock.current) blocks.set(sessionId, previousBlock.current)
        previousBlock.current = undefined
      }
      React.useEffect(() => releaseBlock, [sessionId, blocks])
      if (session.error || session.loading || library.error || library.loading) return null
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
      return h('span', { className: 'dst-composer-character' },
        h(CharacterSelect, {
          cards: library.value.cards,
          value: currentId,
          busy,
          locked,
          compact: true,
          onChange: id => { void selectCard(id) },
          onManage: () => overlay.open('manager', sessionId),
        }))
    }

    function sessionAgentPreset(summary) {
      return summary?.projectionValues?.agentPreset ?? summary?.agentPreset
    }

    function ComposerCharacterSelect(props) {
      const agentPreset = props.useSessions(state => sessionAgentPreset(state.byId[props.sessionId]))
      const draft = String(props.input?.draft ?? '')
      const phase = props.input?.phase
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

    function greetingBridgeScript(channel) {
      return `<script>(()=>{const channel=${JSON.stringify(channel)};let seq=0;const pending=new Map();const rpc=(action,args={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});parent.postMessage({__dshSillyTavernGreeting:true,channel,id,action,args},'*')});addEventListener('message',event=>{const message=event.data;if(event.source!==parent||!message||message.__dshSillyTavernGreeting!==true||message.channel!==channel||!message.replyTo)return;const item=pending.get(message.replyTo);if(!item)return;pending.delete(message.replyTo);message.ok?item.resolve(message.value):item.reject(new Error(message.error||'SillyTavern opening API failed'))});const setChatMessages=async messages=>{const selection=await rpc('setChatMessages',{messages});window.setTimeout(()=>{rpc('commitSwipe',{swipe_id:selection?.swipe_id}).catch(()=>{})},50);return selection};const triggerSlash=command=>rpc('triggerSlash',{command:String(command??'')});window.setChatMessages=setChatMessages;window.triggerSlash=triggerSlash;window.TavernHelper=Object.assign({},window.TavernHelper,{setChatMessages,triggerSlash})})()<\/script>`
    }

    function greetingDocument(input, channel) {
      const source = String(input ?? '')
      const bootstrap = greetingBridgeScript(channel)
      if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(source)) {
        if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`)
        if (/<html[\s>]/i.test(source)) return source.replace(/<html([^>]*)>/i, `<html$1><head>${bootstrap}</head>`)
        return `${source}${bootstrap}`
      }
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${bootstrap}<style>html{color-scheme:light dark}body{box-sizing:border-box;margin:0;padding:12px;font:14px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}</style></head><body>${source}</body></html>`
    }

    function GreetingHtmlFrame({ source, onSetChatMessages, onCommitSwipe, onTriggerSlash }) {
      const frame = React.useRef(null)
      const channel = React.useMemo(() => `dst-opening-${Math.random().toString(36).slice(2)}`, [source])
      React.useEffect(() => {
        const listener = async event => {
          const message = event.data
          if (!message || message.__dshSillyTavernGreeting !== true || message.channel !== channel || event.source !== frame.current?.contentWindow || !message.id) return
          try {
            let value
            if (message.action === 'setChatMessages') { if (typeof onSetChatMessages !== 'function') throw new Error('opening swipe selection is unavailable after the conversation starts'); value = await onSetChatMessages(message.args?.messages, channel) }
            else if (message.action === 'commitSwipe') { if (typeof onCommitSwipe !== 'function') throw new Error('opening swipe commit is unavailable after the conversation starts'); value = await onCommitSwipe(message.args?.swipe_id, channel) }
            else if (message.action === 'triggerSlash') { if (typeof onTriggerSlash !== 'function') throw new Error('opening slash bridge is unavailable in conversation history'); value = await onTriggerSlash(message.args?.command) }
            else throw new Error(`unsupported SillyTavern opening action ${message.action}`)
            event.source.postMessage({ __dshSillyTavernGreeting: true, channel, replyTo: message.id, ok: true, value: value ?? null }, '*')
          } catch (error) {
            event.source.postMessage({ __dshSillyTavernGreeting: true, channel, replyTo: message.id, ok: false, error: error.message || String(error) }, '*')
          }
        }
        window.addEventListener('message', listener)
        return () => window.removeEventListener('message', listener)
      }, [channel, onSetChatMessages, onCommitSwipe, onTriggerSlash])
      return h('iframe', {
        ref: frame,
        className: 'dst-opening-html',
        title: '角色开场 HTML',
        'aria-label': '角色开场 HTML',
        sandbox: 'allow-scripts allow-forms allow-popups allow-downloads allow-modals',
        srcDoc: greetingDocument(source, channel),
      })
    }

    function GreetingContent({ text, onSetChatMessages, onCommitSwipe, onTriggerSlash }) {
      const segments = greetingSegments(text, true)
      return h('div', { className: 'dst-opening-text' }, ...segments.map((segment, index) => segment.type === 'html'
        ? h(GreetingHtmlFrame, { key: `html:${index}`, source: segment.value, onSetChatMessages, onCommitSwipe, onTriggerSlash })
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
      return h(GreetingContent, { ...props, text: rendered })
    }

    function TavernOpeningGreetingContent({ sessionId, version }) {
      const [swipeId, setSwipeId] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const preparedSwipes = React.useRef(new Map())
      const greeting = useAsync(signal => api(`/greeting?sessionId=${encodeURIComponent(sessionId)}${swipeId === null ? '' : `&swipeId=${swipeId}`}`, { signal }), [sessionId, version, swipeId])
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
.dst-opening-greeting{box-sizing:border-box;width:100%;height:max(320px,calc(100dvh - 260px));min-height:0;margin:0 0 8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,#dfe3ea);border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#182033);box-shadow:0 4px 18px rgba(15,23,42,.06);font:14px/1.55 system-ui,sans-serif;display:flex;flex:0 0 auto;flex-direction:column;overflow:hidden}.dst-opening-header{display:flex;flex:0 0 auto;align-items:center;gap:7px;margin-bottom:8px}.dst-opening-icon{flex:0 0 auto;color:var(--dsw-alias-brand-primary,#326fd1)}.dst-opening-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.dst-opening-text{display:flex;flex:1 1 auto;flex-direction:column;gap:10px;min-height:0;max-height:none;overflow:auto;white-space:normal;overflow-wrap:anywhere}.dst-opening-html{display:block;box-sizing:border-box;width:100%;height:auto;min-height:240px;flex:1 1 360px;border:0;border-radius:10px;background:var(--dsw-alias-bg-base,#fff)}.dst-opening-hint{flex:0 0 auto;margin-top:9px;color:var(--dsw-alias-label-secondary,#64748b);font-size:12px}.dst-opening-message{box-sizing:border-box;width:100%;padding:4px 16px 12px;color:var(--dsw-alias-label-primary,#182033);font:15px/1.65 system-ui,sans-serif}.dst-opening-message .dst-opening-text{display:flex;flex-direction:column;gap:10px;max-height:none;overflow:visible}.dst-opening-message .dst-opening-html{min-height:360px;flex:0 0 520px}@media(max-width:560px){.dst-opening-greeting{height:max(320px,calc(100dvh - 300px))}}.dst-composer-character{display:inline-flex;align-items:center;min-width:0;max-width:min(100%,220px);flex:0 1 auto}.dst-character-menu{min-width:0;max-width:100%;flex:0 1 auto}.dst-character-seat{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;max-width:min(100%,220px);min-width:0;min-height:28px;padding:0 8px;border:0;border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary,var(--dsh-text,#182033));font:500 13px/20px system-ui,sans-serif;white-space:nowrap;overflow:hidden;cursor:pointer}.dst-character-seat:not(:disabled):hover,.dst-character-seat[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,#eef2f7)}.dst-character-seat:disabled{cursor:default;color:var(--dsw-alias-label-quaternary,#9aa1ad)}.dst-character-seat.compact{max-width:180px}.dst-character-icon,.dst-character-chevron{flex:0 0 auto;color:var(--dsw-alias-label-primary,#182033)}.dst-character-chevron{color:var(--dsw-alias-label-caption,#81858c)}.dst-character-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-character-seat:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#8fb5f5);outline-offset:2px}@container (max-width:780px){.dst-character-seat.compact{max-width:52px;padding:0 6px}.dst-character-label{display:none}}@container (max-width:560px){.dst-character-seat.compact{max-width:28px}.dst-character-chevron{display:none}}@media (max-width:900px){.dst-character-seat.compact{max-width:52px;padding:0 6px}.dst-character-label{display:none}}@media (max-width:520px){.dst-character-seat.compact{max-width:28px}.dst-character-chevron{display:none}}
`
    const RUNTIME_CSS = `
.dst-memory-empty-state{margin:12px 0;padding:28px 16px;border:1px dashed #cbd5e1;border-radius:11px;color:#64748b;text-align:center}.dst-memory-table{gap:12px}.dst-memory-row{content-visibility:auto;contain-intrinsic-size:180px;display:flex;flex-direction:column;gap:12px;border-radius:12px;padding:14px;background:var(--dsh-surface,#fff)}.dst-memory-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dst-memory-identity{display:flex;min-width:0;align-items:center;gap:8px}.dst-memory-identity strong{overflow-wrap:anywhere}.dst-memory-table-name{flex:none;padding:2px 8px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:11px;font-weight:700}.dst-memory-meta{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:8px;color:#64748b;font-size:11px}.dst-memory-value{min-width:0;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--dsh-surface,#fff) 94%,#326fd1 6%)}.dst-memory-fields{display:flex;flex-direction:column;margin:0}.dst-memory-field{display:grid;grid-template-columns:minmax(90px,25%) minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid #dce3ed}.dst-memory-field:first-child{padding-top:0}.dst-memory-field:last-child{padding-bottom:0;border-bottom:0}.dst-memory-field dt{color:#64748b;font-size:12px;font-weight:650;overflow-wrap:anywhere}.dst-memory-field dd{min-width:0;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.dst-memory-array{display:flex;flex-direction:column;gap:5px;margin:0;padding-left:24px}.dst-memory-array>li{padding-left:3px}.dst-memory-scalar.number{color:#6b21a8;font-variant-numeric:tabular-nums}.dst-memory-scalar.boolean{display:inline-block;padding:1px 7px;border-radius:999px;background:#e8f1ff;color:#24548a;font-size:12px}.dst-memory-scalar.boolean.false{background:#f1f5f9;color:#64748b}.dst-memory-scalar.null,.dst-memory-scalar.empty,.dst-memory-empty{color:#94a3b8;font-style:italic}.dst-memory-nested{min-width:0;border:1px solid #dce3ed;border-radius:8px;background:var(--dsh-surface,#fff)}.dst-memory-nested>summary{padding:5px 8px;color:#326fd1;cursor:pointer;font-size:12px;user-select:none}.dst-memory-nested>.dst-memory-fields,.dst-memory-nested>.dst-memory-array{margin:0 8px 8px}.dst-memory-row-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dst-memory-raw{min-width:0;color:#64748b;font-size:12px}.dst-memory-raw>summary{cursor:pointer;user-select:none}.dst-memory-raw pre{box-sizing:border-box;max-width:min(720px,calc(100vw - 96px));max-height:300px;margin:8px 0 0;padding:10px;overflow:auto;border-radius:8px;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:640px){.dst-memory-row-head{flex-direction:column}.dst-memory-meta{flex-wrap:wrap;justify-content:flex-start}.dst-memory-field{grid-template-columns:1fr;gap:3px}.dst-memory-row-actions{align-items:flex-end}}
.dst-memory-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:22px 0 10px}.dst-memory-section-head>.dst-section-title{margin:0}.dst-memory-event-empty{padding:14px;border:1px dashed #cbd5e1;border-radius:10px}.dst-memory-event-graph{display:flex;flex-direction:column;gap:14px}.dst-memory-event-node{content-visibility:auto;contain-intrinsic-size:260px;border:1px solid #cbd5e1;border-radius:12px;padding:14px;background:color-mix(in srgb,var(--dsh-surface,#fff) 97%,#326fd1 3%)}.dst-memory-event-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.dst-memory-event-head strong{overflow-wrap:anywhere}.dst-memory-event-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.dst-memory-event-relations{min-width:0;padding:9px 10px;border:1px solid #dce3ed;border-radius:9px;background:var(--dsh-surface,#fff);font-size:12px}.dst-memory-event-relations>strong{display:block;margin-bottom:4px;color:#475569}.dst-memory-event-relations ul{display:flex;flex-direction:column;gap:4px;margin:0;padding-left:18px}.dst-memory-event-relations li{overflow-wrap:anywhere}.dst-memory-event-relations code{color:#24548a}.dst-memory-event-relations small{display:block;color:#64748b}.dst-memory-event-rows{margin-top:12px}.dst-memory-ungrouped{margin-top:22px}.dst-memory-provenance{flex-basis:100%}@media(max-width:640px){.dst-memory-section-head{display:block}.dst-memory-event-links{grid-template-columns:1fr}}
.dst-markdown-content{display:flow-root;min-width:0;overflow-wrap:anywhere}.dst-markdown-content>*>:first-child,.dst-legacy-font>*>:first-child{margin-top:0}.dst-markdown-content>*>:last-child,.dst-legacy-font>*>:last-child{margin-bottom:0}.dst-legacy-font{margin:0 0 1em;color:inherit}.dst-assistant-message{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary,#182033);font:15px/1.65 system-ui,sans-serif}.dst-assistant-message>*>:first-child{margin-top:0}.dst-assistant-message>[data-turn-process-inline][hidden]{margin-bottom:0}.dst-user-row{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.dst-user-stack{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px)*.702),82%)}.dst-user-message{box-sizing:border-box;max-width:100%;padding:10px 16px;border-radius:22px;background:var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-2,#eef2f7));color:var(--dsw-alias-label-primary,#182033);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}.dst-user-message>*>:first-child{margin-top:0}.dst-user-message>*>:last-child{margin-bottom:0}.dst-assistant-reasoning{margin:8px 0;color:var(--dsw-alias-label-secondary,#64748b)}.dst-assistant-reasoning>summary{cursor:pointer}.dst-assistant-reasoning>pre,.dst-assistant-unknown{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 ui-monospace,monospace}.dst-assistant-stopped,.dst-script-render-error{display:block;margin-top:6px;color:#b45309;font-size:12px}.dst-script-rendering{padding:8px 0;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px}.dst-script-conversation{display:flex;width:100%;min-width:0;flex-direction:column;gap:10px}.dst-script-conversation .dst-trusted-frame{display:block;width:100%;height:520px;min-height:280px;border:0;border-radius:12px;background:var(--dsw-alias-bg-base,#fff)}
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
      ctx.effect(() => () => { scriptPolicies.reset(); scriptScopes.reset(); scriptEvents.reset(); composerBridges.clear(); regexEngine.dispose() })
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
