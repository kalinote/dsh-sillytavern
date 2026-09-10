import assert from 'node:assert/strict'
import test from 'node:test'
import { playerRecovery } from '../src/player-recovery.js'

const message = (id, text) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const event = (seq, type, data) => ({ seq, type, data })

test('failed pre-prompt claims retain exact player input across reconstruction', () => {
  const input = message('m1', '我去看看制冰机。\n然后请立希说明流程。')
  const events = [event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [input] }),
    event(1, 'turn/start', { turn: 1 }), event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    event(3, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'script callback barrier timed out' } } })]
  const value = playerRecovery(JSON.parse(JSON.stringify(events)))
  assert.equal(value.failedTurns[0].text, input.content[0].text)
  assert.equal(value.failedTurns[0].inputs[0].persisted, false)
  assert.equal(value.failedTurns[0].endSeq, 3)
})

test('canceled and replaced queued actions are not confused with claimed actions', () => {
  const events = [event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message('old', '旧行动')] }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, outcome: 'canceled', inserted: [message('new', '新行动')] }),
    event(2, 'turn/start', { turn: 1 }), event(3, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    event(4, 'user/message', message('new', '新行动')), event(5, 'assistant/message', { message: { id: 'answer' } }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } })]
  const value = playerRecovery(events)
  assert.equal(value.failedTurns.length, 0)
  assert.equal(value.turns[0].text, '新行动')
  assert.equal(value.turns[0].inputs.length, 1)
  assert.equal(value.turns[0].inputs[0].persisted, true)
  assert.deepEqual(value.turns[0].assistantIds, ['answer'])
})

test('mid-turn steering stays visible but is excluded from the automatic retry action', () => {
  const opening = message('opening', '我先检查制冰机。')
  const steering = message('steering', '再问立希刚才听到了什么。')
  const events = [event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [opening] }),
    event(1, 'turn/start', { turn: 1 }), event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    event(3, 'user/message', opening), event(4, 'agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [steering] }),
    event(5, 'agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] }), event(6, 'user/message', steering),
    event(7, 'assistant/message', { message: { id: 'answer' } }), event(8, 'turn/end', { turn: 1, reason: { kind: 'error' } })]
  const recovered = playerRecovery(events).failedTurns[0]
  assert.equal(recovered.text, `${opening.content[0].text}\n${steering.content[0].text}`)
  assert.equal(recovered.retryText, opening.content[0].text)
  assert.equal(recovered.steeringText, steering.content[0].text)
  assert.deepEqual(recovered.inputs.map(input => input.target), ['next-turn', 'next-step'])
  assert.ok(recovered.inputs.every(input => input.persisted))
})
