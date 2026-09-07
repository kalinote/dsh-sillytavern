import assert from 'node:assert/strict'
import test from 'node:test'
import { projectCompatibilityChat } from '../src/compat-chat-projection.js'

const text = (id, role, value) => ({ id, role, content: [{ type: 'text', text: value }] })
const native = [text('A', 'user', 'A'), text('B', 'assistant', 'B'), text('C', 'user', 'C')]
const events = native.map((message, seq) => ({ seq, type: message.role === 'user' ? 'user/message' : 'assistant/message', data: message.role === 'user' ? message : { message } }))
const floor = (seq, extra = {}) => ({ sourceSeq: seq, uid: `native:${seq}`, origin: 'native', role: native[seq].role, message: native[seq].content[0].text, ...extra })

test('ledger tombstones and order control the outgoing request without mutating the log', () => {
  const original = structuredClone(native)
  const options = Object.freeze({ system: 'keep', messages: Object.freeze(native) })
  const result = projectCompatibilityChat(options, events, { seenSourceSeqs: [0, 1, 2], messages: [floor(2), floor(1, { message: 'edited' })] })
  assert.deepEqual(result.messages.map(message => message.id), ['C', 'B'])
  assert.equal(result.messages[1].content[0].text, 'edited')
  assert.deepEqual(native, original)
  assert.equal(result.system, 'keep')
})

test('duplicate synthetic text stays distinct and compacted floors never reappear', () => {
  const result = projectCompatibilityChat({ messages: [native[2]] }, events, { seenSourceSeqs: [0, 1, 2], messages: [floor(0), floor(2), { uid: 'compat:1', role: 'user', message: 'C' }, { uid: 'compat:2', role: 'user', message: 'C' }] })
  assert.deepEqual(result.messages.map(item => item.id), ['C', 'dsh-sillytavern-compat-compat:1', 'dsh-sillytavern-compat-compat:2'])
})

test('text edits preserve images, reasoning, tool calls and their result block', () => {
  const call = { type: 'tool-call', id: 'call-1', name: 'test', arguments: '{}' }
  const image = { type: 'image', url: 'data:image/png;base64,eA==' }
  const reason = { type: 'reasoning', text: 'thought', signature: 'signed' }
  const a = { ...native[0], content: [image, ...native[0].content] }
  const b = { ...native[1], content: [reason, ...native[1].content, call] }
  const tool = { id: 'result', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', content: 'ok' }] }
  const result = projectCompatibilityChat({ messages: [a, b, tool, native[2]] }, events, { seenSourceSeqs: [0, 1, 2], messages: [floor(2), floor(1, { message: 'changed' }), floor(0)] })
  assert.deepEqual(result.messages.map(item => item.id), ['C', 'B', 'result', 'A'])
  assert.deepEqual(result.messages[1].content, [reason, { type: 'text', text: 'changed' }, call])
  assert.deepEqual(result.messages[2], tool)
  assert.deepEqual(result.messages[3].content[0], image)
  const deleted = projectCompatibilityChat({ messages: [a, b, tool] }, events, { seenSourceSeqs: [0, 1], messages: [] })
  assert.deepEqual(deleted.messages, [{ ...b, content: [reason, call] }, tool])
})
