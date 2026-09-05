import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createChatMessages,
  createCompatChat,
  deleteChatMessages,
  getChatMessages,
  inspectCompatChat,
  mergeNativeMessages,
  rotateChatMessages,
  setChatMessages,
  switchSwipe,
} from '../src/compat-chat.js'

const native = (seq, role, text, extra = {}) => ({ seq, role, text, ...extra })

test('native initialization and overlap-safe increments retain stable source identities and local overlays', () => {
  const input = [native(9, 'assistant', 'Welcome'), native(7, 'user', 'Hello')]
  const initial = createCompatChat(input)
  input[0].text = 'mutated outside'
  assert.deepEqual(inspectCompatChat(initial).entries.map(message => [message.message_id, message.uid, message.sourceSeq, message.origin]), [
    [0, 'native:7', 7, 'native'],
    [1, 'native:9', 9, 'native'],
  ])
  assert.deepEqual(getChatMessages(initial).map(message => message.message), ['Hello', 'Welcome'])

  const edited = setChatMessages(initial, [{ message_id: 0, message: 'Edited locally', is_hidden: true }])
  const merged = mergeNativeMessages(edited, [native(7, 'user', 'Hello'), native(9, 'assistant', 'Welcome'), native(12, 'assistant', 'Next')])
  assert.deepEqual(getChatMessages(merged).map(message => [message.message_id, message.message, message.is_hidden]), [
    [0, 'Edited locally', true],
    [1, 'Welcome', false],
    [2, 'Next', false],
  ])
  assert.deepEqual(inspectCompatChat(merged).entries.map(message => message.uid), ['native:7', 'native:9', 'native:12'])

  const deleted = deleteChatMessages(merged, [1])
  const afterPoll = mergeNativeMessages(deleted, [native(9, 'assistant', 'Welcome'), native(13, 'user', 'Continue')])
  assert.deepEqual(inspectCompatChat(afterPoll).entries.map(message => message.uid), ['native:7', 'native:12', 'native:13'], 'deleted native rows do not resurrect on overlapping polls')
  assert.throws(() => mergeNativeMessages(afterPoll, [native(11, 'assistant', 'late')]), /arrived behind cursor/)
})

test('synchronous range queries implement ids, closed ranges, negative depth, filters, and exact official shapes', () => {
  let state = createCompatChat([
    native(1, 'system', 'System', { is_hidden: true, data: { source: 'system' }, extra: { token: 1 } }),
    native(2, 'user', 'User'),
    native(3, 'assistant', 'First', {
      swipe_id: 1,
      swipes: ['First', 'Second'],
      swipes_data: [{ page: 0 }, { page: 1 }],
      swipes_info: [{ reason: 'first' }, { reason: 'second' }],
    }),
    native(4, 'user', 'Last', { is_hidden: true }),
  ])
  const result = getChatMessages(state, -2)
  assert.equal(result instanceof Promise, false)
  assert.deepEqual(result, [{ message_id: 2, name: 'Character', role: 'assistant', is_hidden: false, message: 'Second', data: { page: 1 }, extra: { reason: 'second' } }])
  assert.deepEqual(Object.keys(result[0]), ['message_id', 'name', 'role', 'is_hidden', 'message', 'data', 'extra'])
  assert.deepEqual(getChatMessages(state, '1-3', { role: 'user' }).map(message => message.message_id), [1, 3])
  assert.deepEqual(getChatMessages(state, '0-{{lastMessageId}}', { hide_state: 'hidden' }).map(message => message.message_id), [0, 3])
  assert.deepEqual(getChatMessages(state, '3-20').map(message => message.message_id), [3])
  assert.deepEqual(getChatMessages(state, 20), [])
  const swiped = getChatMessages(state, 2, { include_swipes: true })[0]
  assert.deepEqual(swiped, {
    message_id: 2,
    name: 'Character',
    role: 'assistant',
    is_hidden: false,
    swipe_id: 1,
    swipes: ['First', 'Second'],
    swipes_data: [{ page: 0 }, { page: 1 }],
    swipes_info: [{ reason: 'first' }, { reason: 'second' }],
  })
  assert.deepEqual(Object.keys(swiped), ['message_id', 'name', 'role', 'is_hidden', 'swipe_id', 'swipes', 'swipes_data', 'swipes_info'])
  swiped.swipes_data[1].page = 99
  assert.equal(getChatMessages(state, 2, { include_swipes: true })[0].swipes_data[1].page, 1, 'query results are deep clones')
  assert.deepEqual(getChatMessages(createCompatChat()), [])
  assert.throws(() => getChatMessages(createCompatChat(), 'bad'), /invalid message range/)
  assert.throws(() => getChatMessages(state, '3-1'), /start must not exceed/)
  assert.throws(() => getChatMessages(state, 'bad'), /invalid message range/)
  assert.throws(() => getChatMessages(state, 0, { role: 'tool' }), /role filter/)
})

test('setChatMessages updates selected pages, ignores out-of-range floors, and merges duplicate patches', () => {
  const state = createCompatChat([
    native(1, 'assistant', 'A', {
      swipe_id: 0,
      swipes: ['A', 'B'],
      swipes_data: [{ value: 'a' }, { value: 'b' }],
      swipes_info: [{ model: 'a' }, { model: 'b' }],
    }),
    native(2, 'user', 'Reply'),
  ])
  const updated = setChatMessages(state, [{
    message_id: 0,
    name: 'Alice',
    role: 'system',
    is_hidden: true,
    swipe_id: 1,
    message: 'B edited',
    data: { value: 'edited' },
    extra: { model: 'edited' },
  }])
  assert.deepEqual(getChatMessages(updated, 0)[0], {
    message_id: 0,
    name: 'Alice',
    role: 'system',
    is_hidden: true,
    message: 'B edited',
    data: { value: 'edited' },
    extra: { model: 'edited' },
  })
  assert.deepEqual(getChatMessages(updated, 0, { include_swipes: true })[0].swipes, ['A', 'B edited'])
  assert.deepEqual(inspectCompatChat(updated).entries[0], { ...inspectCompatChat(updated).entries[0], uid: 'native:1', sourceSeq: 1 })
  assert.deepEqual(getChatMessages(state, 0)[0].message, 'A', 'input state remains unchanged')

  const forgiving = setChatMessages(updated, [
    { message_id: 99, message: 'ignored' },
    { message_id: 0, message: 'would apply' },
    { message_id: 1, swipe_id: 8 },
  ])
  assert.equal(getChatMessages(forgiving, 0)[0].message, 'would apply')
  assert.equal(getChatMessages(forgiving, 1, { include_swipes: true })[0].swipe_id, 0)
  const merged = setChatMessages(updated, [{ message_id: 0, name: 'Merged' }, { message_id: 0, message: 'merged text' }])
  assert.deepEqual([getChatMessages(merged, 0)[0].name, getChatMessages(merged, 0)[0].message], ['Merged', 'merged text'])
})

test('setChatMessages preserves and consistently resizes swipe metadata', () => {
  const state = createCompatChat([native(1, 'assistant', 'A', {
    swipes: ['A', 'B'],
    swipes_data: [{ n: 1 }, { n: 2 }],
    swipes_info: [{ i: 1 }, { i: 2 }],
  })])
  const grown = setChatMessages(state, [{ message_id: 0, swipes: ['A2', 'B2', 'C'], swipe_id: 2, data: { n: 3 }, extra: { i: 3 } }])
  assert.deepEqual(getChatMessages(grown, 0, { include_swipes: true })[0], {
    message_id: 0,
    name: 'Character',
    role: 'assistant',
    is_hidden: false,
    swipe_id: 2,
    swipes: ['A2', 'B2', 'C'],
    swipes_data: [{ n: 1 }, { n: 2 }, { n: 3 }],
    swipes_info: [{ i: 1 }, { i: 2 }, { i: 3 }],
  })
  const partial = setChatMessages(grown, [{ message_id: 0, swipes_data: [{ replaced: true }] }])
  assert.deepEqual(getChatMessages(partial, 0, { include_swipes: true })[0].swipes_data, [{ replaced: true }, { n: 2 }, { n: 3 }])
})

test('createChatMessages inserts atomically with stable synthetic uids and reindexes every row', () => {
  const state = createCompatChat([native(1, 'user', 'before'), native(2, 'assistant', 'after')])
  const input = [
    { role: 'system', message: 'one', data: { nested: { value: 1 } } },
    { role: 'assistant', name: 'Bob', message: 'two', is_hidden: true, extra: { source: 'compat' } },
  ]
  const created = createChatMessages(state, input, { insert_before: 1 })
  input[0].data.nested.value = 99
  assert.deepEqual(inspectCompatChat(created).entries.map(message => [message.message_id, message.uid, message.sourceSeq]), [
    [0, 'native:1', 1],
    [1, 'compat:1', null],
    [2, 'compat:2', null],
    [3, 'native:2', 2],
  ])
  assert.deepEqual(getChatMessages(created, '1-2').map(message => [message.name, message.role, message.message, message.is_hidden]), [
    ['System', 'system', 'one', false],
    ['Bob', 'assistant', 'two', true],
  ])
  assert.equal(getChatMessages(created, 1)[0].data.nested.value, 1)
  const appended = createChatMessages(created, [{ role: 'user', message: 'end' }])
  assert.equal(inspectCompatChat(appended).entries.at(-1).uid, 'compat:3')
  assert.throws(() => createChatMessages(created, [{ role: 'user', message: 'valid' }, { role: 'tool', message: 'invalid' }]), /role/)
  assert.equal(created.entries.length, 4)
})

test('deleteChatMessages resolves negative ids once, preserves tombstones, and reindexes', () => {
  let state = createCompatChat([native(1, 'user', '0'), native(2, 'assistant', '1'), native(3, 'user', '2'), native(4, 'assistant', '3')])
  state = deleteChatMessages(state, [1, -1, 1])
  assert.deepEqual(getChatMessages(state).map(message => [message.message_id, message.message]), [[0, '0'], [1, '2']])
  assert.deepEqual(inspectCompatChat(state).entries.map(message => message.uid), ['native:1', 'native:3'])
  assert.deepEqual(inspectCompatChat(state).seenSourceSeqs, [1, 2, 3, 4])
  const ignored = deleteChatMessages(state, [-3, 99])
  assert.deepEqual(getChatMessages(ignored).map(message => message.message), ['0', '2'])
})

test('rotateChatMessages and switchSwipe preserve logical identities and validate without mutation', () => {
  const state = createCompatChat([
    native(1, 'user', '0'),
    native(2, 'assistant', '1'),
    native(3, 'user', '2'),
    native(4, 'assistant', '3', { swipes: ['3a', '3b'], swipes_data: [{}, { selected: true }], swipes_info: [{}, { model: 'b' }] }),
  ])
  const rotated = rotateChatMessages(state, 0, 2, 4)
  assert.deepEqual(inspectCompatChat(rotated).entries.map(message => [message.message_id, message.uid]), [
    [0, 'native:3'], [1, 'native:4'], [2, 'native:1'], [3, 'native:2'],
  ])
  const switched = switchSwipe(rotated, 1, 1)
  assert.deepEqual(getChatMessages(switched, 1)[0], {
    message_id: 1,
    name: 'Character',
    role: 'assistant',
    is_hidden: false,
    message: '3b',
    data: { selected: true },
    extra: { model: 'b' },
  })
  const clamped = rotateChatMessages(switched, 0, 4, 3)
  assert.deepEqual(inspectCompatChat(clamped).entries.map(message => message.uid), inspectCompatChat(switched).entries.map(message => message.uid))
  assert.throws(() => switchSwipe(switched, 1, 2), /outside the available swipes/)
  assert.equal(getChatMessages(switched, 1)[0].message, '3b')
})

test('invalid native batches and externally forged state cannot partially alter prior state', () => {
  const state = createCompatChat([native(1, 'user', 'safe')])
  assert.throws(() => mergeNativeMessages(state, [native(2, 'assistant', 'valid'), native(2, 'assistant', 'duplicate')]), /duplicate native sourceSeq/)
  assert.deepEqual(getChatMessages(state).map(message => message.message), ['safe'])
  const inspected = inspectCompatChat(state)
  inspected.entries[0].swipes[0] = 'forged'
  assert.equal(getChatMessages(state, 0)[0].message, 'safe')
})
