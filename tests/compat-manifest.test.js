import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCompatibilitySnapshot, compatibilityManifest, IFRAME_EVENTS, TAVERN_EVENTS } from '../src/compatibility.js'

test('phase-5 compatibility manifest pins upstream revisions and reports honest capability levels', () => {
  const manifest = compatibilityManifest()
  assert.equal(manifest.schemaVersion, 1)
  assert.match(manifest.upstream.tavernHelper.revision, /^[a-f0-9]{40}$/)
  assert.match(manifest.upstream.sillyTavern.revision, /^[a-f0-9]{40}$/)
  assert.equal(manifest.upstream.tavernHelper.version, '4.9.4')
  assert.equal(manifest.upstream.promptTemplate.version, '1.17.9')
  assert.match(manifest.upstream.promptTemplate.revision, /^[a-f0-9]{40}$/)
  assert.equal(manifest.upstream.sillyTavern.version, '1.18.0')
  const levels = new Set(['exact', 'emulated', 'degraded', 'unavailable'])
  for (const [id, capability] of Object.entries(manifest.capabilities)) {
    assert.equal(capability.id, id)
    assert.equal(levels.has(capability.level), true, `${id} has an invalid level`)
    assert.equal(Array.isArray(capability.surfaces), true)
    assert.equal(typeof capability.signature, 'string')
    assert.equal(typeof capability.authority, 'string')
    if (capability.level !== 'exact') assert.equal(typeof capability.reason, 'string', `${id} must explain its limitation`)
  }
  assert.equal(manifest.capabilities['function.getVariables'].timing, 'sync')
  assert.deepEqual(manifest.capabilities['function.getVariables'].scopes, ['chat', 'global', 'preset', 'character', 'message', 'script', 'extension'])
  assert.equal(manifest.capabilities['function.getChatMessages'].level, 'emulated')
  assert.equal(manifest.capabilities['function.getWorldbook'].level, 'emulated')
  assert.equal(manifest.capabilities['function.generate'].level, 'degraded')
  assert.equal(manifest.capabilities['function.characterCrud'].level, 'unavailable')
  assert.equal(manifest.capabilities['event.MESSAGE_RECEIVED'].level, 'degraded')
  assert.equal(TAVERN_EVENTS.CHAT_CHANGED, 'chat_id_changed')
  assert.equal(IFRAME_EVENTS.GENERATION_STARTED, 'js_generation_started')
  assert.equal(TAVERN_EVENTS.GENERATION_STARTED, 'generation_started')
  manifest.implementation.phase = 99
  assert.equal(compatibilityManifest().implementation.phase, 5, 'callers receive a clone, not the manifest singleton')
})

test('compatibility snapshot uses the greeting candidate before a blank session is bound', () => {
  const fallback = {
    binding: { revision: 0, variables: { route: 'airport' }, userPersona: { name: 'Anon', description: '' }, openingSwipeId: 2, scriptInjections: [] },
    record: { id: 'card-a', card: { spec: 'chara_card_v3', data: { name: 'Alice' } } },
    worldbook: { id: 'book-a', book: { name: 'Alice Book', entries: [] } },
    globalVariables: { shared: true },
  }
  const snapshot = buildCompatibilitySnapshot({
    sessionId: 'session-a',
    view: { sessionId: 'session-a', ready: true, binding: null, card: null, worldbook: null, globalVariables: {} },
    fallback,
    messages: [{ role: 'user', text: 'Hello', seq: 7 }, { role: 'assistant', text: 'Welcome', seq: 9 }],
  })
  assert.equal(snapshot.cardRecord.id, 'card-a')
  assert.equal(snapshot.characterCard.data.name, 'Alice')
  assert.deepEqual(snapshot.variables, { route: 'airport' })
  assert.deepEqual(snapshot.globalVariables, { shared: true })
  assert.equal(snapshot.currentSwipeId, 2)
  assert.deepEqual(snapshot.messages.map(message => [message.message_id, message.is_user, message.mes, message.event_seq]), [
    [0, true, 'Hello', 7],
    [1, false, 'Welcome', 9],
  ])
  assert.equal(snapshot.context.chatId, 'session-a')
  assert.equal(snapshot.context.characterId, 'card-a')
})
