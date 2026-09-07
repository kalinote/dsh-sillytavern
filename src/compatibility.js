const TAVERN_HELPER_REVISION = '8c1f159388e216b52bff0e0995f371a8c9861bca'
const SILLY_TAVERN_REVISION = '8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8'

export const TAVERN_EVENTS = Object.freeze({
  APP_READY: 'app_ready',
  EXTRAS_CONNECTED: 'extras_connected',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
  MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
  MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
  MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
  MORE_MESSAGES_LOADED: 'more_messages_loaded',
  IMPERSONATE_READY: 'impersonate_ready',
  CHAT_CHANGED: 'chat_id_changed',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATION_STARTED: 'generation_started',
  GENERATION_STOPPED: 'generation_stopped',
  GENERATION_ENDED: 'generation_ended',
  EXTENSIONS_FIRST_LOAD: 'extensions_first_load',
  EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
  SETTINGS_LOADED: 'settings_loaded',
  SETTINGS_UPDATED: 'settings_updated',
  MOVABLE_PANELS_RESET: 'movable_panels_reset',
  SETTINGS_LOADED_BEFORE: 'settings_loaded_before',
  SETTINGS_LOADED_AFTER: 'settings_loaded_after',
  CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
  CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
  OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before',
  OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
  OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready',
  OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready',
  WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
  WORLDINFO_UPDATED: 'worldinfo_updated',
  CHARACTER_EDITOR_OPENED: 'character_editor_opened',
  CHARACTER_EDITED: 'character_edited',
  CHARACTER_PAGE_LOADED: 'character_page_loaded',
  USER_MESSAGE_RENDERED: 'user_message_rendered',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  FORCE_SET_BACKGROUND: 'force_set_background',
  CHAT_DELETED: 'chat_deleted',
  CHAT_CREATED: 'chat_created',
  GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
  GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  GENERATE_AFTER_DATA: 'generate_after_data',
  WORLD_INFO_ACTIVATED: 'world_info_activated',
  TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
  CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
  CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected',
  CHARACTER_DELETED: 'characterDeleted',
  CHARACTER_DUPLICATED: 'character_duplicated',
  CHARACTER_RENAMED: 'character_renamed',
  CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat',
  SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received',
  STREAM_TOKEN_RECEIVED: 'stream_token_received',
  STREAM_REASONING_DONE: 'stream_reasoning_done',
  FILE_ATTACHMENT_DELETED: 'file_attachment_deleted',
  WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
  OPEN_CHARACTER_LIBRARY: 'open_character_library',
  ONLINE_STATUS_CHANGED: 'online_status_changed',
  IMAGE_SWIPED: 'image_swiped',
  CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
  CONNECTION_PROFILE_CREATED: 'connection_profile_created',
  CONNECTION_PROFILE_DELETED: 'connection_profile_deleted',
  CONNECTION_PROFILE_UPDATED: 'connection_profile_updated',
  TOOL_CALLS_PERFORMED: 'tool_calls_performed',
  TOOL_CALLS_RENDERED: 'tool_calls_rendered',
  CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown',
  SECRET_WRITTEN: 'secret_written',
  SECRET_DELETED: 'secret_deleted',
  SECRET_ROTATED: 'secret_rotated',
  SECRET_EDITED: 'secret_edited',
  PRESET_CHANGED: 'preset_changed',
  PRESET_DELETED: 'preset_deleted',
  PRESET_RENAMED: 'preset_renamed',
  PRESET_RENAMED_BEFORE: 'preset_renamed_before',
  MAIN_API_CHANGED: 'main_api_changed',
  WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
  WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
  MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
})

export const IFRAME_EVENTS = Object.freeze({
  MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
  MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
  GENERATION_STARTED: 'js_generation_started',
  STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
  STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
  GENERATION_ENDED: 'js_generation_ended',
})

const SURFACES = Object.freeze(['background', 'message', 'opening', 'preview'])
const capability = (id, kind, level, timing, signature, extra = {}) => Object.freeze({
  id,
  kind,
  level,
  surfaces: SURFACES,
  timing,
  signature,
  authority: 'upstream-source',
  ...(level === 'exact' ? {} : { reason: extra.reason || 'DSH emulates this API within the documented host boundary.' }),
  ...extra,
})

const unavailable = (id, kind, signature, reason) => capability(id, kind, 'unavailable', 'async', signature, { reason })

const CAPABILITIES = {
  'resource.scriptImport': capability('resource.scriptImport', 'resource', 'emulated', 'async', 'importCard(bytes): CardRecord', { reason: 'Standard content scripts and legacy exports retain IDs, enablement, data, buttons and folder metadata; tree editing and button execution remain unavailable.', parameters: ['content', 'id', 'enabled', 'data', 'button', 'export_with', 'folder'], tests: ['tests/script-importer.test.js'] }),
  'runtime.preparation': capability('runtime.preparation', 'runtime', 'degraded', 'async', 'prepare(session): Snapshot', { reason: 'Native prompt preparation and script generation drain accepted writes and call live filter owners; browser owners must be connected. Notification events do not reproduce mutable SillyTavern transform-event objects.', tests: ['tests/compat-lifecycle.test.js', 'tests/compat-client-lifecycle.test.js'] }),
  'template.ejs': capability('template.ejs', 'template', 'degraded', 'async', 'evaluatePromptTemplate(source, scope, options): Result', { reason: 'EJS 3.1.10 supplies async execution, print/include/define and structured variable changes in a prompt-build lifecycle. Full upstream GENERATE/RENDER hooks, initial-worldbook loading, preset resources and display projections are not implemented.', contexts: ['standalone-template', 'character-prompt', 'active-worldbook-prompt'], tests: ['tests/template-runtime.test.js', 'tests/template-state-commit.test.js'] }),
  'global.TavernHelper': capability('global.TavernHelper', 'global', 'emulated', 'sync', 'TavernHelper', { reason: 'Implemented by a session-scoped DSH compatibility runtime rather than the native extension.' }),
  'global.SillyTavern': capability('global.SillyTavern', 'global', 'degraded', 'sync', 'SillyTavern & { getContext(): Context }', { reason: 'Chat, character, metadata, settings, events, macros and common helpers are projected; private SillyTavern UI and backend services are unavailable.' }),
  'global.eventSource': capability('global.eventSource', 'global', 'emulated', 'event', 'EventSource', { reason: 'Delivery covers compatible frames in one DSH Session, not arbitrary native extensions.' }),
  'global.lodash': capability('global.lodash', 'global', 'degraded', 'sync', 'typeof _', { reason: 'A common lodash-compatible subset is provided; chain operators and edge cases outside that subset are unavailable.' }),
  'global.jQuery': capability('global.jQuery', 'global', 'degraded', 'sync', 'typeof $', { reason: 'The facade targets each iframe document and the DSH composer bridge; native SillyTavern DOM topology and the full jQuery plug-in ecosystem are unavailable.' }),
  'global.toastr': capability('global.toastr', 'global', 'degraded', 'sync', 'Toastr', { reason: 'Toast calls are accepted and logged inside the frame, without native SillyTavern toast UI.' }),
  'constant.tavern_events': capability('constant.tavern_events', 'constant', 'exact', 'sync', 'Record<string, string>'),
  'constant.iframe_events': capability('constant.iframe_events', 'constant', 'exact', 'sync', 'Record<string, string>'),
  'function.getVariables': capability('function.getVariables', 'function', 'emulated', 'sync', 'getVariables(option?): object', { scopes: ['chat', 'global', 'preset', 'character', 'message', 'script', 'extension'], reason: 'All official scopes are projected and persisted in DSH-owned compatibility state.' }),
  'function.replaceVariables': capability('function.replaceVariables', 'function', 'emulated', 'sync', 'replaceVariables(variables, option?): void', { scopes: ['chat', 'global', 'preset', 'character', 'message', 'script', 'extension'], reason: 'Writes are optimistic and cross the asynchronous DSH persistence boundary after the synchronous return.' }),
  'function.updateVariablesWith': capability('function.updateVariablesWith', 'function', 'emulated', 'hybrid', 'updateVariablesWith(updater, option?): object|Promise<object>', { reason: 'Updater timing and merge semantics match the public API; storage is DSH-owned.' }),
  'function.insertOrAssignVariables': capability('function.insertOrAssignVariables', 'function', 'emulated', 'sync', 'insertOrAssignVariables(variables, option?): object', { reason: 'Deep merge with array replacement is implemented over DSH-owned scope storage.' }),
  'function.insertVariables': capability('function.insertVariables', 'function', 'emulated', 'sync', 'insertVariables(variables, option?): object', { reason: 'Deep default merge with array replacement is implemented over DSH-owned scope storage.' }),
  'function.deleteVariable': capability('function.deleteVariable', 'function', 'emulated', 'sync', 'deleteVariable(path, option?): {variables,delete_occurred}', { reason: 'Lodash-style dotted and bracket paths are supported over DSH-owned scope storage.' }),
  'function.getAllVariables': capability('function.getAllVariables', 'function', 'emulated', 'sync', 'getAllVariables(): object', { reason: 'Background and message iframe merge floors follow TavernHelper ordering over projected DSH state.' }),
  'function.getChatMessages': capability('function.getChatMessages', 'function', 'emulated', 'sync', 'getChatMessages(range?, options?): ChatMessage[]', { reason: 'A durable compatibility ledger projects native DSH messages plus script-created floors; it does not rewrite the append-only DSH event log.' }),
  'function.setChatMessages': capability('function.setChatMessages', 'function', 'emulated', 'async', 'setChatMessages(messages, options?): Promise<void>', { reason: 'Edits, roles, visibility, variables and swipes update the compatibility ledger and future prompts, while the original DSH transcript remains append-only.' }),
  'function.createChatMessages': capability('function.createChatMessages', 'function', 'emulated', 'async', 'createChatMessages(messages, options?): Promise<void>', { reason: 'Synthetic floors are durable compatibility records and are projected into rendering and generation.' }),
  'function.deleteChatMessages': capability('function.deleteChatMessages', 'function', 'emulated', 'async', 'deleteChatMessages(messageIds, options?): Promise<void>', { reason: 'Deletes are tombstones/projection changes and do not destructively remove DSH events.' }),
  'function.rotateChatMessages': capability('function.rotateChatMessages', 'function', 'emulated', 'async', 'rotateChatMessages(begin, middle, end, options?): Promise<void>', { reason: 'Rotation affects the compatibility view and prompt projection, not append-only event order.' }),
  'function.injectPrompts': capability('function.injectPrompts', 'function', 'degraded', 'sync', 'injectPrompts(prompts, options?): {uninject(): void}', { reason: 'Positions, depth, roles, scan material, local filter callbacks and once cleanup are supported; filters can only execute while their owner iframe is alive.' }),
  'function.uninjectPrompts': capability('function.uninjectPrompts', 'function', 'degraded', 'sync', 'uninjectPrompts(ids): void', { reason: 'Removal is asynchronous at the persistence boundary.' }),
  'function.eventOn': capability('function.eventOn', 'function', 'emulated', 'event', 'eventOn(type, listener): {stop(): void}', { reason: 'The event bus is scoped to compatible frames in one DSH Session.' }),
  'function.eventOnce': capability('function.eventOnce', 'function', 'emulated', 'event', 'eventOnce(type, listener): {stop(): void}', { reason: 'The event bus is scoped to compatible frames in one DSH Session.' }),
  'function.eventMakeFirst': capability('function.eventMakeFirst', 'function', 'emulated', 'event', 'eventMakeFirst(type, listener): {stop(): void}', { reason: 'The event bus is scoped to compatible frames in one DSH Session.' }),
  'function.eventMakeLast': capability('function.eventMakeLast', 'function', 'emulated', 'event', 'eventMakeLast(type, listener): {stop(): void}', { reason: 'The event bus is scoped to compatible frames in one DSH Session.' }),
  'function.eventEmit': capability('function.eventEmit', 'function', 'emulated', 'async', 'eventEmit(type, ...args): Promise<void>', { reason: 'Delivery covers compatible frames in one DSH Session, not arbitrary SillyTavern extensions.' }),
  'function.eventEmitAndWait': capability('function.eventEmitAndWait', 'function', 'emulated', 'sync', 'eventEmitAndWait(type, ...args): void', { reason: 'Local listeners complete before the event is forwarded to sibling frames.' }),
  'function.eventRemoveListener': capability('function.eventRemoveListener', 'function', 'emulated', 'event', 'eventRemoveListener(type, listener): void', { reason: 'Listener lifetime is the iframe lifetime.' }),
  'function.eventClearEvent': capability('function.eventClearEvent', 'function', 'emulated', 'event', 'eventClearEvent(type): void', { reason: 'Listener lifetime is the iframe lifetime.' }),
  'function.eventClearListener': capability('function.eventClearListener', 'function', 'emulated', 'event', 'eventClearListener(listener): void', { reason: 'Listener lifetime is the iframe lifetime.' }),
  'function.eventClearAll': capability('function.eventClearAll', 'function', 'emulated', 'event', 'eventClearAll(): void', { reason: 'Listener lifetime is the iframe lifetime.' }),
  'function.triggerSlash': capability('function.triggerSlash', 'function', 'degraded', 'async', 'triggerSlash(command): Promise<unknown>', { reason: 'A table-driven common STScript subset and optional DSH command bridge are implemented; the complete native slash-command registry is unavailable.' }),
  'function.generate': capability('function.generate', 'function', 'degraded', 'async', 'generate(config?): Promise<string|ToolResult>', { reason: 'Uses the configured DSH provider with independent streaming/cancellation; native connection profiles, custom API URLs and every SillyTavern prompt-manager option are not available.' }),
  'function.generateRaw': capability('function.generateRaw', 'function', 'degraded', 'async', 'generateRaw(config?): Promise<string|ToolResult>', { reason: 'Ordered prompts, overrides, images, tools and common sampling parameters are translated to DSH, with explicit errors for unsupported custom endpoints.' }),
  'function.stopGenerationById': capability('function.stopGenerationById', 'function', 'emulated', 'sync', 'stopGenerationById(id): boolean', { reason: 'Cancellation targets DSH compatibility generation jobs rather than the native SillyTavern generation singleton.' }),
  'function.getModelList': capability('function.getModelList', 'function', 'degraded', 'async', 'getModelList(customApi?): Promise<string[]>', { reason: 'Returns models exposed by the selected DSH provider, not arbitrary custom SillyTavern endpoints.' }),
  'function.getTavernHelperVersion': capability('function.getTavernHelperVersion', 'function', 'emulated', 'sync', 'getTavernHelperVersion(): string', { reason: 'Returns the pinned TavernHelper compatibility target.' }),
  'function.getScriptId': capability('function.getScriptId', 'function', 'emulated', 'sync', 'getScriptId(): string', { reason: 'Uses the DSH frame script identity.' }),
  'function.getWorldbook': capability('function.getWorldbook', 'function', 'emulated', 'async', 'getWorldbook(name): Promise<WorldbookEntry[]>', { reason: 'Named CRUD uses lossless conversion to DSH workspace worldbooks with revision CAS.' }),
  'function.replaceWorldbook': capability('function.replaceWorldbook', 'function', 'emulated', 'async', 'replaceWorldbook(name, entries, options?): Promise<void>', { reason: 'Named CRUD is exact at the public data contract but stored by DSH.' }),
  'function.createWorldbookEntries': capability('function.createWorldbookEntries', 'function', 'emulated', 'async', 'createWorldbookEntries(name, entries, options?): Promise<object>', { reason: 'UID collision handling and returned entry slices follow the pinned API over DSH storage.' }),
  'function.deleteWorldbookEntries': capability('function.deleteWorldbookEntries', 'function', 'emulated', 'async', 'deleteWorldbookEntries(name, predicate, options?): Promise<object>', { reason: 'The predicate executes in its iframe and selected UIDs are deleted atomically with revision CAS.' }),
  'function.worldbookBindings': capability('function.worldbookBindings', 'function', 'degraded', 'hybrid', 'global/character/chat worldbook binding APIs', { reason: 'Global, current-character and current-chat bindings are persisted and all bound books feed prompting; non-current character mutation and native UI selection are unavailable.' }),
  'function.getLorebook': capability('function.getLorebook', 'function', 'emulated', 'async', 'getLorebook(name): Promise<WorldbookEntry[]>', { reason: 'Legacy lorebook names alias the named DSH worldbook implementation.' }),
  'function.getLorebookSettings': capability('function.getLorebookSettings', 'function', 'degraded', 'sync', 'getLorebookSettings(): LorebookSettings', { reason: 'Settings are persistent and affect scan depth and budget; native group-scoring UI and all recursion policies are not fully represented.' }),
  'function.registerMacroLike': capability('function.registerMacroLike', 'function', 'degraded', 'sync', 'registerMacroLike(regex, replace): {unregister(): void}', { reason: 'Live owner callbacks participate in iframe substitution, prepared system/depth prompts and raw named prompts. Native history, rendered messages and third-party pipelines do not share this macro registry.' }),
  'function.getProxyPresetNames': unavailable('function.getProxyPresetNames', 'function', 'getProxyPresetNames(): string[]', 'DSH does not provide SillyTavern proxy preset resources.'),
  'function.audio': capability('function.audio', 'function', 'degraded', 'sync', 'playAudio/pauseAudio/list/settings APIs', { reason: 'Per-frame BGM and ambient playlists use browser Audio; native shared SillyTavern playback state and autoplay guarantees are unavailable.' }),
  'function.copyText': capability('function.copyText', 'function', 'degraded', 'hybrid', 'copyText(text): void|Promise<void>', { reason: 'Uses the iframe Clipboard API or document fallback and remains subject to browser gesture permissions.' }),
  'function.callGenericPopup': capability('function.callGenericPopup', 'function', 'degraded', 'async', 'callGenericPopup(content, type, inputValue?, options?): Promise<unknown>', { reason: 'Text, confirm, input and display map to browser dialogs; native custom buttons, hooks and crop UI are unavailable.' }),
  'function.characterCrud': unavailable('function.characterCrud', 'function', 'character CRUD APIs', 'DSH cannot reproduce SillyTavern character avatar/backend/UI semantics from a script iframe.'),
  'function.presetCrud': unavailable('function.presetCrud', 'function', 'preset CRUD APIs', 'DSH prompt templates are not equivalent to SillyTavern generation presets.'),
  'function.personaCrud': unavailable('function.personaCrud', 'function', 'persona CRUD APIs', 'DSH exposes the current session persona but not SillyTavern persona storage and avatar management.'),
  'function.scriptTrees': unavailable('function.scriptTrees', 'function', 'script tree/button APIs', 'DSH card scripts are projected for execution but native TavernHelper script-tree storage and buttons are unavailable.'),
  'function.executeSlashCommands': unavailable('function.executeSlashCommands', 'function', 'executeSlashCommands(command): Promise<object>', 'General SillyTavern slash execution is not exposed by DSH.'),
  'function.importRawCharacter': unavailable('function.importRawCharacter', 'function', 'importRawCharacter(...): Promise<unknown>', 'Imports remain a host-owned management operation.'),
  'function.registerGlobalMacro': unavailable('function.registerGlobalMacro', 'function', 'registerGlobalMacro(...): void', 'DSH cannot install a macro into unrelated native extensions; iframe-local macro-like registration is available.'),
  'function.tavernRegex': capability('function.tavernRegex', 'function', 'degraded', 'hybrid', 'Tavern regex query/replace/format APIs', { reason: 'DSH global, preset and card Regex resources are similar but not identical to native Tavern Regex storage and reload behavior.' }),
  'dsh.getState': capability('dsh.getState', 'function', 'exact', 'sync', 'TavernHelper.dsh.getState(): DshSessionView', { origin: 'dsh' }),
  'dsh.getCharacterCard': capability('dsh.getCharacterCard', 'function', 'exact', 'sync', 'TavernHelper.dsh.getCharacterCard(): CharacterCard|null', { origin: 'dsh' }),
  'dsh.getCurrentWorldbook': capability('dsh.getCurrentWorldbook', 'function', 'exact', 'sync', 'TavernHelper.dsh.getCurrentWorldbook(): object|null', { origin: 'dsh' }),
  'dsh.event': capability('dsh.event', 'function', 'exact', 'async', 'TavernHelper.dsh.event(operation): Promise<object>', { origin: 'dsh' }),
  'dsh.flushWrites': capability('dsh.flushWrites', 'function', 'exact', 'async', 'TavernHelper.dsh.flushWrites(): Promise<void>', { origin: 'dsh' }),
  'dsh.setVariables': capability('dsh.setVariables', 'function', 'degraded', 'async', 'TavernHelper.setVariables(variables): Promise<void>', { origin: 'dsh', reason: 'Deprecated DSH alias retained for scripts written against pre-phase-1 builds.' }),
}

for (const [name, value] of Object.entries(TAVERN_EVENTS)) {
  CAPABILITIES[`constant.tavern_events.${name}`] = capability(`constant.tavern_events.${name}`, 'constant', 'exact', 'sync', JSON.stringify(value))
}

for (const [name, value] of Object.entries(IFRAME_EVENTS)) {
  CAPABILITIES[`constant.iframe_events.${name}`] = capability(`constant.iframe_events.${name}`, 'constant', 'exact', 'sync', JSON.stringify(value))
}

for (const [name, level, reason] of [
  ['APP_READY', 'exact', undefined],
  ['CHAT_CHANGED', 'emulated', 'DSH Session identity is projected as the SillyTavern chat id.'],
  ['MESSAGE_SENT', 'degraded', 'The current message projection omits some native SillyTavern fields.'],
  ['MESSAGE_RECEIVED', 'degraded', 'The current message projection omits some native SillyTavern fields.'],
  ['USER_MESSAGE_RENDERED', 'degraded', 'Mapped from completed DSH user message events.'],
  ['CHARACTER_MESSAGE_RENDERED', 'degraded', 'Mapped from completed DSH assistant message events.'],
]) {
  CAPABILITIES[`event.${name}`] = capability(`event.${name}`, 'event', level, 'event', `${TAVERN_EVENTS[name]}(...)`, reason ? { reason } : {})
}

const MANIFEST = Object.freeze({
  schemaVersion: 1,
  implementation: Object.freeze({ name: 'dsh-sillytavern', version: '0.10.0', phase: 5 }),
  upstream: Object.freeze({
    tavernHelper: Object.freeze({ repository: 'https://github.com/N0VI028/JS-Slash-Runner', version: '4.9.4', revision: TAVERN_HELPER_REVISION }),
    sillyTavern: Object.freeze({ repository: 'https://github.com/SillyTavern/SillyTavern', version: '1.18.0', revision: SILLY_TAVERN_REVISION }),
    promptTemplate: Object.freeze({ repository: 'https://github.com/zonde306/ST-Prompt-Template', version: '1.17.9', revision: 'd6f520d149aba146305b0b781ddd691d449c28d2', runtime: 'ejs@3.1.10' }),
  }),
  capabilities: Object.freeze(CAPABILITIES),
})

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function compatibilityManifest() {
  return clone(MANIFEST)
}

function projectedMessage(message, index) {
  const isUser = message?.role === 'user'
  const role = ['system', 'assistant', 'user'].includes(message?.role) ? message.role : isUser ? 'user' : 'assistant'
  const messageId = Number.isSafeInteger(message?.message_id) ? message.message_id : index
  const text = String(message?.message ?? message?.mes ?? message?.text ?? '')
  const swipes = Array.isArray(message?.swipes) && message.swipes.length > 0 ? message.swipes.map(String) : [text]
  const swipeId = Number.isSafeInteger(message?.swipe_id) && message.swipe_id >= 0 && message.swipe_id < swipes.length ? message.swipe_id : 0
  return {
    message_id: messageId,
    uid: typeof message?.uid === 'string' ? message.uid : undefined,
    event_seq: Number.isSafeInteger(message?.sourceSeq) ? message.sourceSeq : Number.isSafeInteger(message?.seq) ? message.seq : null,
    sourceSeq: Number.isSafeInteger(message?.sourceSeq) ? message.sourceSeq : Number.isSafeInteger(message?.seq) ? message.seq : null,
    name: String(message?.name ?? (role === 'user' ? 'User' : role === 'system' ? 'System' : 'Character')),
    is_user: isUser,
    is_system: role === 'system',
    is_hidden: message?.is_hidden === true,
    mes: text,
    message: text,
    role,
    text,
    data: clone(message?.data ?? message?.swipes_data?.[swipeId] ?? {}),
    extra: clone(message?.extra ?? message?.swipes_info?.[swipeId] ?? {}),
    swipe_id: swipeId,
    swipes,
    swipes_data: clone(message?.swipes_data ?? swipes.map(() => ({}))),
    swipes_info: clone(message?.swipes_info ?? swipes.map(() => ({}))),
  }
}

export function buildCompatibilitySnapshot({ sessionId, view, fallback, messages = [] }) {
  const fallbackView = fallback === undefined || fallback === null ? null : {
    binding: fallback.binding,
    card: fallback.record,
    worldbook: fallback.worldbook,
    event: fallback.event,
    templates: fallback.templates,
    globalRegexScripts: fallback.globalRegexScripts,
    presetRegexScripts: fallback.presetRegexScripts,
    globalVariables: fallback.globalVariables,
  }
  const selected = view?.card === null && fallbackView !== null ? { ...view, ...fallbackView } : view
  const binding = selected?.binding ?? null
  const cardRecord = selected?.card ?? null
  const card = cardRecord?.card ?? null
  const character = card?.data ?? {}
  const sourceMessages = Array.isArray(selected?.compatChat?.messages) ? selected.compatChat.messages : messages
  const projected = sourceMessages.map(projectedMessage)
  const persona = binding?.userPersona ?? { name: 'User', description: '' }
  const state = {
    ...(selected ?? {}),
    sessionId: String(sessionId ?? selected?.sessionId ?? ''),
    binding,
    card: cardRecord,
    worldbook: selected?.worldbook ?? null,
    history: sourceMessages.map(message => ({ role: message.role, text: String(message.message ?? message.text ?? ''), seq: message.sourceSeq ?? message.seq ?? message.message_id })),
  }
  return {
    schemaVersion: 1,
    runtimeRevision: 0,
    sessionId: state.sessionId,
    bindingRevision: Number(binding?.revision ?? 0),
    state,
    cardRecord,
    characterCard: card,
    character,
    worldbook: selected?.worldbook?.book ?? selected?.worldbook ?? null,
    persona,
    variables: clone(binding?.variables ?? {}),
    globalVariables: clone(selected?.globalVariables ?? {}),
    regexRevision: Number(selected?.regexRevision ?? 0),
    variableScopes: clone(selected?.compatibilityVariables?.scopes ?? { chat: binding?.variables ?? {}, global: selected?.globalVariables ?? {}, preset: {}, character: {}, message: {}, script: {}, extension: {} }),
    variableRevisions: clone(selected?.compatibilityVariables?.revisions ?? { chat: Number(binding?.revision ?? 0), global: 0, workspace: 0 }),
    variableMaps: clone(selected?.compatibilityVariableMaps ?? { global: selected?.globalVariables ?? {}, presets: {}, characters: {}, scripts: {}, extensions: {} }),
    extensionSettings: clone(selected?.extensionSettings ?? {}),
    worldbookNames: clone(selected?.worldbookNames ?? []),
    globalWorldbooks: clone(selected?.globalWorldbooks ?? []),
    characterWorldbooks: clone(selected?.characterWorldbooks ?? {}),
    lorebookSettings: clone(selected?.lorebookSettings ?? {}),
    chatWorldbookName: selected?.worldbook?.name ?? null,
    scriptInjections: clone(binding?.scriptInjections ?? []),
    currentSwipeId: Number(binding?.openingSwipeId ?? 0),
    chatRevision: Number(selected?.compatChat?.revision ?? 0),
    messages: projected,
    context: {
      chatId: state.sessionId,
      characterId: cardRecord?.id ?? null,
      groupId: null,
      name1: String(persona.name ?? 'User'),
      name2: String(character.nickname ?? character.name ?? 'Character'),
      chatMetadata: clone(binding?.chatMetadata ?? {}),
    },
    compatibility: compatibilityManifest(),
  }
}
