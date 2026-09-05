import assert from 'node:assert/strict'
import test from 'node:test'
import { CompatibilityGenerationBroker } from '../src/compat-generation.js'

class ControlledStream {
  #values = []
  #waiters = []
  #ended = false
  #error = null

  constructor(signal) {
    signal.addEventListener('abort', () => this.fail(signal.reason), { once: true })
  }

  push(value) {
    if (this.#ended) throw new Error('stream already ended')
    const waiter = this.#waiters.shift()
    if (waiter) waiter.resolve({ value, done: false })
    else this.#values.push(value)
  }

  end() {
    if (this.#ended) return
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
  }

  fail(error) {
    if (this.#ended) return
    this.#ended = true
    this.#error = error
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error)
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.#values.length > 0) return Promise.resolve({ value: this.#values.shift(), done: false })
        if (this.#error !== null) return Promise.reject(this.#error)
        if (this.#ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }))
      },
      return: () => { this.end(); return Promise.resolve({ value: undefined, done: true }) },
    }
  }
}

function controlledAdapter() {
  const streams = new Map()
  const requests = new Map()
  return {
    streams,
    requests,
    adapter(options, context) {
      requests.set(context.generationId, { options, context })
      const stream = new ControlledStream(context.signal)
      streams.set(context.generationId, stream)
      return stream
    },
  }
}

async function eventually(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('condition was not reached')
}

test('independent generations consume interleaved DSH text events without cross-talk', async () => {
  const controlled = controlledAdapter()
  const events = []
  const broker = new CompatibilityGenerationBroker(controlled.adapter)
  const a = broker.start({ sessionId: 'session-a', generationId: 'A', options: { model: 'one' }, onEvent: event => events.push(event) })
  const b = broker.start({ sessionId: 'session-a', generationId: 'B', options: { model: 'two' }, onEvent: event => events.push(event) })
  assert.equal(broker.get('A').status, 'pending')
  await eventually(() => controlled.streams.size === 2)
  assert.equal(broker.get('A').status, 'running')
  assert.notEqual(controlled.requests.get('A').context.signal, controlled.requests.get('B').context.signal)
  assert.equal(controlled.requests.get('A').options.model, 'one')
  assert.equal(controlled.requests.get('A').options.signal, controlled.requests.get('A').context.signal)

  controlled.streams.get('A').push({ type: 'text-delta', index: 0, text: 'A1' })
  controlled.streams.get('B').push({ type: 'text-delta', index: 0, text: 'B1' })
  controlled.streams.get('A').push({ type: 'text-delta', index: 0, text: 'A2' })
  controlled.streams.get('A').push({ type: 'block-end', index: 0, block: { type: 'text', text: 'A1A2' } })
  controlled.streams.get('A').push({ type: 'finish', reason: { kind: 'stop' } })
  controlled.streams.get('A').end()
  controlled.streams.get('B').push({ type: 'text-delta', index: 0, text: 'B2' })
  controlled.streams.get('B').end()

  const [aResult, bResult] = await Promise.all([a.done, b.done])
  assert.deepEqual([aResult.status, aResult.text, bResult.status, bResult.text], ['completed', 'A1A2', 'completed', 'B1B2'])
  assert.deepEqual(aResult.finish, { kind: 'stop' })
  assert.deepEqual(events.filter(event => event.generationId === 'A').map(event => event.type), ['started', 'stream', 'stream', 'final'])
  assert.deepEqual(events.filter(event => event.generationId === 'A' && event.type === 'stream').map(event => [event.incremental, event.full]), [['A1', 'A1'], ['A2', 'A1A2']])
  assert.equal(events.filter(event => event.type === 'final').every(event => event.final === event.full), true)
  assert.deepEqual([broker.get('A').active, broker.get('A').abortable, broker.get('B').active, broker.get('B').abortable], [false, false, false, false])
})

test('stopById synchronously stops only its target and settles with retained partial text', async () => {
  const controlled = controlledAdapter()
  const events = []
  const broker = new CompatibilityGenerationBroker(controlled.adapter)
  const a = broker.start({ sessionId: 's', generationId: 'A', onEvent: event => events.push(event) })
  const b = broker.start({ sessionId: 's', generationId: 'B', onEvent: event => events.push(event) })
  await eventually(() => controlled.streams.size === 2)
  controlled.streams.get('A').push({ type: 'text-delta', text: 'partial' })
  controlled.streams.get('B').push({ type: 'text-delta', text: 'complete' })
  await eventually(() => broker.get('A').full === 'partial' && broker.get('B').full === 'complete')

  assert.equal(broker.stopById('A'), true)
  assert.equal(broker.get('A').status, 'stopped')
  assert.equal(broker.stopById('A'), false)
  assert.equal(broker.stopById('unknown'), false)
  controlled.streams.get('B').end()
  const [aResult, bResult] = await Promise.all([a.done, b.done])
  assert.deepEqual([aResult.status, aResult.text], ['stopped', 'partial'])
  assert.deepEqual([bResult.status, bResult.text], ['completed', 'complete'])
  assert.deepEqual(events.filter(event => event.generationId === 'A').map(event => event.type), ['started', 'stream', 'stopped', 'final'])
  assert.equal(broker.stopById('B'), false, 'completed ids are not stoppable')
})

test('adapter failure rejects only the failed task and records failed then final events', async () => {
  const controlled = controlledAdapter()
  const events = []
  const broker = new CompatibilityGenerationBroker(controlled.adapter)
  const failed = broker.start({ sessionId: 's', generationId: 'failed', onEvent: event => events.push(event) })
  const healthy = broker.start({ sessionId: 's', generationId: 'healthy', onEvent: event => events.push(event) })
  await eventually(() => controlled.streams.size === 2)
  controlled.streams.get('failed').push({ type: 'text-delta', text: 'partial' })
  controlled.streams.get('failed').fail(Object.assign(new Error('provider failed'), { code: 'provider-error' }))
  controlled.streams.get('healthy').push({ type: 'text-delta', text: 'ok' })
  controlled.streams.get('healthy').end()

  await assert.rejects(failed.done, error => error.message === 'provider failed' && error.code === 'provider-error')
  assert.equal((await healthy.done).text, 'ok')
  assert.deepEqual(events.filter(event => event.generationId === 'failed').map(event => event.type), ['started', 'stream', 'failed', 'final'])
  assert.deepEqual(broker.get('failed').error, { name: 'Error', message: 'provider failed', code: 'provider-error' })
  assert.deepEqual([broker.get('failed').active, broker.get('failed').abortable], [false, false])
})

test('duplicate active ids are rejected while a completed id may be reused', async () => {
  const controlled = controlledAdapter()
  const broker = new CompatibilityGenerationBroker(controlled.adapter)
  const first = broker.start({ sessionId: 's', generationId: 'same' })
  assert.throws(() => broker.start({ sessionId: 'other', generationId: 'same' }), error => error.code === 'generation-id-active')
  await eventually(() => controlled.streams.has('same'))
  controlled.streams.get('same').end()
  await first.done
  const second = broker.start({ sessionId: 'other', generationId: 'same' })
  await eventually(() => controlled.requests.get('same').context.sessionId === 'other')
  controlled.streams.get('same').push({ type: 'text-delta', text: 'reused' })
  controlled.streams.get('same').end()
  assert.equal((await second.done).text, 'reused')
  assert.equal(broker.get('same').sessionId, 'other')
})

test('block-end text and both DSH tool-call shapes produce one normalized result', async () => {
  const controlled = controlledAdapter()
  const events = []
  const broker = new CompatibilityGenerationBroker(controlled.adapter)
  const task = broker.start({ sessionId: 's', generationId: 'tools', onEvent: event => events.push(event) })
  await eventually(() => controlled.streams.has('tools'))
  const direct = { id: 'call-1', name: 'search', arguments: { q: 'one' } }
  controlled.streams.get('tools').push({ type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } })
  controlled.streams.get('tools').push({ type: 'tool-call', toolCall: direct })
  controlled.streams.get('tools').push({ type: 'block-end', index: 1, block: { type: 'tool-call', ...direct } })
  controlled.streams.get('tools').push({ type: 'finish', reason: { kind: 'tool-calls' } })
  controlled.streams.get('tools').end()
  const result = await task.done
  assert.equal(result.text, 'answer')
  assert.deepEqual(result.toolCalls, [direct])
  assert.deepEqual(result.finish, { kind: 'tool-calls' })
  assert.deepEqual(events.map(event => event.type), ['started', 'stream', 'final'])
  assert.deepEqual(events[1], { type: 'stream', generationId: 'tools', sessionId: 's', incremental: 'answer', full: 'answer', final: null })
})

test('stopAll is synchronous, covers pending tasks, and reports whether work existed', async () => {
  const controlled = controlledAdapter()
  const events = []
  const broker = new CompatibilityGenerationBroker(controlled.adapter)
  const a = broker.start({ sessionId: 's', generationId: 'A', onEvent: event => events.push(event) })
  const b = broker.start({ sessionId: 's', generationId: 'B', onEvent: event => events.push(event) })
  assert.equal(broker.stopAll(), true)
  assert.equal(broker.stopAll(), false)
  assert.deepEqual([(await a.done).status, (await b.done).status], ['stopped', 'stopped'])
  assert.deepEqual(events.map(event => [event.generationId, event.type]), [
    ['A', 'stopped'], ['A', 'final'], ['B', 'stopped'], ['B', 'final'],
  ])
  assert.equal(controlled.streams.size, 0, 'pending stopped tasks never call the adapter')
})

test('get/list snapshots are isolated and terminal retention honors count and lazy TTL', async () => {
  let now = 10
  const controlled = controlledAdapter()
  const broker = new CompatibilityGenerationBroker(controlled.adapter, { maxResults: 2, ttlMs: 50, now: () => now })
  for (const id of ['one', 'two', 'three']) {
    const task = broker.start({ sessionId: id === 'two' ? 'other' : 's', generationId: id })
    await eventually(() => controlled.streams.has(id))
    controlled.streams.get(id).push({ type: 'text-delta', text: id })
    controlled.streams.get(id).end()
    await task.done
    now += 1
  }
  assert.equal(broker.get('one'), null, 'oldest completed result is evicted by count')
  assert.deepEqual(broker.list().map(item => item.generationId), ['two', 'three'])
  assert.deepEqual(broker.list({ sessionId: 's', status: 'completed' }).map(item => item.generationId), ['three'])
  const snapshot = broker.get('three')
  assert.equal(Object.isFrozen(snapshot), true)
  assert.throws(() => { snapshot.toolCalls.push({}) }, TypeError)
  now = 100
  assert.deepEqual(broker.list(), [], 'expired results are pruned lazily')
})
