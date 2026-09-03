import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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
  assert.match(characterSelect, /const cardRecord = session\.value\?\.card/)
  assert.match(characterSelect, /scriptPolicies\.set\(sessionId, \[\], `verifying:/)
  assert.match(characterSelect, /scriptScopes\.set\(sessionId, scope,/)
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
  assert.ok(
    frameSource.includes("message.event === 'frame-resize'") || frameSource.includes("message.event === 'resize'"),
    'TrustedFrame must handle the scoped resize event',
  )
  assert.match(frameSource, /event\.source !== frame\.current\?\.contentWindow/)
  assert.match(frameSource, /style: height === null \? undefined : \{ height, minHeight: 0 \}/)

  const conversationCss = source.match(/\.dst-script-conversation \.dst-trusted-frame\{([^}]*)\}/)?.[1] || ''
  assert.doesNotMatch(conversationCss, /height\s*:\s*520px/)
})
