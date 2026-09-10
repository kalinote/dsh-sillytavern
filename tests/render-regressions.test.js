import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = () => readFile(new URL('../client.cjs', import.meta.url), 'utf8')

test('full HTML documents receive syntactically executable bootstrap, sizing, and ready scripts', async () => {
  const source = await clientSource()
  const start = source.indexOf('    function executableScript')
  const end = source.indexOf('    function mergeSessionEventState', start)
  assert.ok(start >= 0 && end > start)
  const helpers = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return { trustedDocument } })()`, { JSON, String, btoa })
  const cardHtml = `<!DOCTYPE html><html lang="zh-CN"><head><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans');body{display:flex}</style></head><body><div id="raw-data" style="display:none">{"scene":"RiNG"}</div><div class="panel">可见内容</div><script>(function(){const init=()=>document.querySelector('.panel');if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init()})()<\/script></body></html>`
  const document = helpers.trustedDocument({ id: 'ournotes', name: 'OurNotes', kind: 'html', source: cardHtml }, 'test-channel', { messages: [] }, { surface: 'message', currentMessageId: 2 })
  const scripts = [...document.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1])
  assert.equal(scripts.length, 4)
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script))
  assert.ok(document.indexOf('installCompatibilityRuntime') < document.indexOf('@import url'), 'the compatibility bootstrap runs before a remote stylesheet can block later document work')
})

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
  assert.match(runtimeSource, /message\.event === 'frame-ready'[\s\S]*registration\.ready = true[\s\S]*event: 'compat-state', payload: clone\(runtime\.snapshot\)/)
  assert.match(runtimeSource, /const readyFrames = runtime =>[\s\S]*filter\(registration => registration\?\.ready === true\)/)
  assert.match(runtimeSource, /if \(Number\.isFinite\(height\) && height >= 0\) registration\.onResize/)
  assert.match(frameSource, /\[sessionId, script\.id, script\.source, attempt\]/, 'a changed script source or explicit retry must get a fresh iframe channel')
  assert.match(frameSource, /if \(!runtimeReady\) \{ setArmedChannel\(null\); return undefined \}/)
  assert.match(frameSource, /height === null \? \{ position: 'absolute',[^}]*visibility: 'hidden'/)
  assert.match(frameSource, /key: transportReady \? channel : `\$\{channel\}:arming`/, 'arming completion must replace the empty about:srcdoc iframe with a document-bearing node')
  assert.match(frameSource, /const messageReady = surface !== 'message' \|\| !Number\.isSafeInteger\(sourceSeq\) \|\| currentMessageId >= 0/)
  assert.match(frameSource, /boot\.current\.snapshot === null && messageReady/)
  assert.match(frameSource, /currentSourceSeq: sourceSeq/)
  assert.doesNotMatch(frameSource, /\[channel, script\.kind, script\.source, runtimeReady, transportReady, surface, currentMessageId\]/)

  const conversationCss = source.match(/\.dst-script-conversation \.dst-trusted-frame\{([^}]*)\}/)?.[1] || ''
  assert.doesNotMatch(conversationCss, /height\s*:\s*520px/)
  assert.doesNotMatch(conversationCss, /height\s*:\s*280px/)
  assert.doesNotMatch(trustedSource, /root\?\.offsetHeight/, 'the measuring viewport must not become an empty document height')
  assert.match(trustedSource, /body\?\.scrollHeight/)
  assert.match(trustedSource, /rootScroll>viewport\?rootScroll:0/, 'overflowing documents must retain content outside the measuring viewport')
  assert.match(trustedSource, /DOMContentLoaded',observeDocument/, 'zero height must not be published before the source document is parsed')
  assert.match(trustedSource, /observeDocument=\(\)=>\{[^}]*observer\.observe\(document\.documentElement\)[\s\S]*?measure\(\)\}/, 'the first parsed-document measurement must not depend on a hidden iframe requestAnimationFrame')
  assert.match(runtimeSource, /message\.event === 'frame-error'[\s\S]*registration\.onError/)
  assert.match(frameSource, /脚本渲染失败/)
  assert.match(frameSource, /重新加载/)
  assert.match(frameSource, /查看脚本原文/)
  assert.match(frameSource, /if \(hidden\) return iframe/, 'background scripts do not render diagnostic chrome')
  assert.doesNotMatch(frameSource, /if \(!runtimeReady\) return null/, 'a stalled runtime must remain diagnosable')
  assert.match(trustedSource, /finally\{URL\.revokeObjectURL\(url\);window\.__dshTavernReady\?\.\(\)\}/, 'a failed background module must still leave the callback barrier')
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
