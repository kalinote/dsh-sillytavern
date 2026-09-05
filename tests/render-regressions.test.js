import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = () => readFile(new URL('../client.cjs', import.meta.url), 'utf8')

test('new-session auto binding reloads the session snapshot before script rendering', async () => {
  const source = await clientSource()
  const start = source.indexOf('    function TavernCharacterSelect')
  const end = source.indexOf('    function ComposerCharacterSelect', start)
  assert.ok(start >= 0 && end > start, 'TavernCharacterSelect must remain discoverable')
  const characterSelect = source.slice(start, end)

  // A new session starts with /session.card === null. The first real message
  // causes Host to bind a card and /event-state then exposes its id. That id
  // must be part of the session loader identity so card Regex scripts and the
  // derived script scope are loaded without a browser refresh.
  assert.match(
    characterSelect,
    /const eventState = useSessionEventState\(sessionId\)[\s\S]*const eventCardId = eventState\?\.card\?\.id \|\| null[\s\S]*const session = useAsync\(signal => api\(`\/session\?sessionId=\$\{encodeURIComponent\(sessionId\)\}`,[\s\S]*\[sessionId, version, eventCardId\]\)/,
    'event-state card transitions must invalidate the stale /session snapshot',
  )
  assert.match(
    characterSelect,
    /const compatibility = useAsync\(signal => api\(`\/compat\/runtime\?sessionId=\$\{encodeURIComponent\(sessionId\)\}`,[\s\S]*\[sessionId, version, eventCardId\]\)/,
    'event-state card transitions must also invalidate the stale compatibility snapshot',
  )
  assert.match(characterSelect, /const cardRecord = session\.value\?\.card/)
  assert.match(characterSelect, /scriptPolicies\.set\(sessionId, \[\], `verifying:/)
  assert.match(characterSelect, /scriptScopes\.set\(sessionId, scope,/)
})

test('second-turn polling preserves the full compatibility projection and its revision', async () => {
  const source = await clientSource()
  const mergeStart = source.indexOf('    function mergeSessionEventState')
  const hookStart = source.indexOf('    function useSessionEventState', mergeStart)
  assert.ok(mergeStart >= 0 && hookStart > mergeStart, 'event-state merge helper must remain discoverable')
  const mergeSessionEventState = vm.runInNewContext(`(() => { ${source.slice(mergeStart, hookStart)}; return mergeSessionEventState })()`, { Map, Number })
  const opening = { message_id: 0, role: 'assistant', message: 'opening', sourceSeq: null }
  const firstUser = { message_id: 1, role: 'user', message: 'first user', sourceSeq: 11 }
  const firstAssistant = { message_id: 2, role: 'assistant', message: 'first assistant', sourceSeq: 12 }
  const secondUser = { message_id: 3, role: 'user', message: 'second user', sourceSeq: 13 }
  const secondAssistant = { message_id: 4, role: 'assistant', message: 'second assistant', sourceSeq: 14 }
  const previous = {
    card: { id: 'card' },
    history: [
      { role: 'assistant', text: 'opening', seq: 0 },
      { role: 'user', text: 'first user', seq: 11 },
      { role: 'assistant', text: 'first assistant', seq: 12 },
    ],
    messages: [opening, firstUser, firstAssistant],
    cursor: 12,
    compatChatRevision: 3,
    unavailable: false,
  }
  const messages = [opening, firstUser, firstAssistant, secondUser, secondAssistant]
  const merged = mergeSessionEventState(previous, {
    card: { id: 'card' },
    history: [
      { role: 'user', text: 'second user', seq: 13 },
      { role: 'assistant', text: 'second assistant', seq: 14 },
    ],
    messages,
    cursor: 14,
    compatChatRevision: 7,
  })
  assert.deepEqual(Array.from(merged.history, item => item.seq), [0, 11, 12, 13, 14])
  assert.deepEqual(Array.from(merged.messages, item => item.message_id), [0, 1, 2, 3, 4])
  assert.equal(merged.messages[2].sourceSeq, 12, 'the first assistant keeps its compatibility message id')
  assert.equal(merged.messages[4].sourceSeq, 14, 'the second assistant is available before its iframe boots')
  assert.equal(merged.cursor, 14)
  assert.equal(merged.compatChatRevision, 7)

  const withoutProjection = mergeSessionEventState(merged, { card: { id: 'card' }, history: [], cursor: 14, compatChatRevision: 7 })
  assert.deepEqual(Array.from(withoutProjection.messages, item => item.message_id), [0, 1, 2, 3, 4], 'a partial event response must not degrade the compatibility projection')

  const runtimeSource = source.slice(source.indexOf('    const compatRuntime'), source.indexOf('    function useCompatSnapshot'))
  assert.doesNotMatch(runtimeSource, /projectMessages/)
  assert.match(runtimeSource, /if \(Array\.isArray\(state\.messages\)\) patch\.messages = clone\(state\.messages\)/)
  assert.match(runtimeSource, /state\.cursor \?\? -1.*state\.compatChatRevision \?\? -1/)
})

test('TrustedFrame resizes from authenticated child messages and does not reserve 520px', async () => {
  const source = await clientSource()
  const trustedStart = source.indexOf('    function trustedDocument')
  const previewStart = source.indexOf('    function ScriptPreview', trustedStart)
  assert.ok(trustedStart >= 0 && previewStart > trustedStart, 'trusted document and frame code must remain discoverable')
  const trustedSource = source.slice(trustedStart, previewStart)
  const frameStart = trustedSource.indexOf('    function TrustedFrame')
  assert.ok(frameStart >= 0, 'TrustedFrame must remain in the trusted rendering section')
  const frameSource = trustedSource.slice(frameStart)

  // The child is opaque-origin, so the parent cannot inspect its DOM. Height
  // is therefore reported over the already-authenticated channel. Keep the
  // event name deliberately scoped to this bridge to avoid accepting random
  // window messages.
  assert.match(trustedSource, /new ResizeObserver/)
  assert.match(trustedSource, /parent\.postMessage\(\{[^}]*channel[^}]*event:\s*['"](?:frame-)?resize['"][^}]*height/)
  const runtimeSource = source.slice(source.indexOf('    const compatRuntime'), source.indexOf('    function useCompatSnapshot'))
  assert.match(runtimeSource, /message\.event === 'frame-resize'/)
  assert.match(runtimeSource, /event\.source !== registration\.getWindow\(\)/)
  assert.match(runtimeSource, /message\.event === 'frame-ready'[\s\S]*event: 'compat-state', payload: clone\(runtime\.snapshot\)/)
  assert.match(frameSource, /style: hidden \? \{ display: 'none' \} : height === null \? undefined : \{ height, minHeight: 0 \}/)
  assert.match(frameSource, /const messageReady = surface !== 'message' \|\| !Number\.isSafeInteger\(sourceSeq\) \|\| currentMessageId >= 0/)
  assert.match(frameSource, /boot\.current\.snapshot === null && messageReady/)
  assert.match(frameSource, /currentSourceSeq: sourceSeq/)
  assert.doesNotMatch(frameSource, /\[channel, script\.kind, script\.source, runtimeReady, transportReady, surface, currentMessageId\]/)

  const conversationCss = source.match(/\.dst-script-conversation \.dst-trusted-frame\{([^}]*)\}/)?.[1] || ''
  assert.doesNotMatch(conversationCss, /height\s*:\s*520px/)
})

test('second-turn Regex refresh keeps the last rendered iframe mounted', async () => {
  const source = await clientSource()
  const assistantStart = source.indexOf('    function TavernAssistantNode')
  const userStart = source.indexOf('    function TavernUserNode', assistantStart)
  const assistantSource = source.slice(assistantStart, userStart)
  const segmentsStart = source.indexOf('    function RenderedScriptSegments')
  const assistantNodeStart = source.indexOf('    function TavernAssistantNode', segmentsStart)
  const segmentSource = source.slice(segmentsStart, assistantNodeStart)
  assert.match(assistantSource, /setRendered\(previous => previous\.status === 'rendered' \? previous : \{ status: 'loading'/)
  assert.match(segmentSource, /key: `html-\$\{seq\}-\$\{index\}`/)
  assert.match(segmentSource, /sourceSeq: messageSeq/)
})
