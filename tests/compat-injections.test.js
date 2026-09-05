import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CompatibilityInjectionManager,
  normalizeInjectionDescriptor,
  projectInjectionDescriptors,
} from '../src/compat-injections.js'

const descriptor = (id, extra = {}) => ({ id, content: id, ownerFrameId: 'frame-a', ...extra })

test('normalization emits the complete serializable descriptor without retaining filter callbacks', () => {
  const filter = () => true
  const normalized = normalizeInjectionDescriptor({ id: 'route', text: 'Airport', filter, ownerFrameId: 'frame-a' }, { once: true })
  assert.deepEqual(normalized, {
    id: 'route',
    position: 'in_chat',
    depth: 0,
    role: 'system',
    content: 'Airport',
    should_scan: false,
    once: true,
    ownerFrameId: 'frame-a',
    hasFilter: true,
    order: 0,
  })
  assert.equal(Object.hasOwn(normalized, 'filter'), false)
  assert.doesNotThrow(() => structuredClone(normalized))
  assert.throws(() => normalizeInjectionDescriptor({ id: 'bad', content: '', filter: 'yes', ownerFrameId: 'frame-a' }), /filter must be a function/)
  assert.throws(() => normalizeInjectionDescriptor({ id: 'bad', content: '', hasFilter: true }), /ownerFrameId/)
})

test('upsert is atomic and uninject results support an idempotent disposer contract', () => {
  const manager = new CompatibilityInjectionManager()
  const first = manager.upsert([descriptor('a'), descriptor('b', { order: 2 })])
  assert.deepEqual(first.insertedIds, ['a', 'b'])
  assert.deepEqual(first.updatedIds, [])
  const replacement = manager.upsert(descriptor('a', { content: 'updated', depth: 3 }))
  assert.deepEqual(replacement.updatedIds, ['a'])
  assert.equal(manager.get('a').content, 'updated')
  assert.equal(manager.get('a').depth, 3)
  assert.throws(() => manager.upsert([descriptor('valid'), descriptor('valid')]), /duplicate injection id/)
  assert.equal(manager.get('valid'), null, 'a rejected upsert batch has no partial effect')

  const disposed = manager.uninject(first.ids)
  assert.deepEqual(disposed, { ids: ['a', 'b'], removedIds: ['a', 'b'], missingIds: [], changed: true })
  const disposedAgain = manager.uninject(first.ids)
  assert.deepEqual(disposedAgain, { ids: ['a', 'b'], removedIds: [], missingIds: ['a', 'b'], changed: false })
})

test('concurrent leases allocate a once descriptor to at most one generation and honor false filters', () => {
  const manager = new CompatibilityInjectionManager()
  manager.upsert([
    descriptor('persistent'),
    descriptor('once', { once: true }),
    descriptor('filtered-once', { once: true, hasFilter: true }),
    descriptor('filtered-persistent', { hasFilter: true }),
  ])
  const first = manager.lease('generation-a', ['filtered-once'])
  const second = manager.lease('generation-b', ['filtered-once', 'filtered-persistent'])
  assert.deepEqual(first.ids, ['persistent', 'once', 'filtered-once'])
  assert.deepEqual(second.ids, ['persistent', 'filtered-persistent'], 'claimed once descriptors are unavailable to concurrent generations')
  assert.deepEqual(manager.lease('generation-a', []), first, 'repeating a generation lease is idempotent')
  const falseEligible = manager.lease('generation-c', [])
  assert.deepEqual(falseEligible.ids, ['persistent'], 'filtered descriptors are omitted unless their id is eligible')
})

test('release restores unadmitted once claims while admit consumes them exactly once', () => {
  const manager = new CompatibilityInjectionManager()
  manager.upsert([descriptor('once', { once: true }), descriptor('persistent')])
  assert.deepEqual(manager.lease('failed').ids, ['once', 'persistent'])
  assert.deepEqual(manager.release('failed'), { generationId: 'failed', released: true, releasedIds: ['once'] })
  assert.deepEqual(manager.release('failed'), { generationId: 'failed', released: false, releasedIds: [] })

  assert.deepEqual(manager.lease('admitted').ids, ['once', 'persistent'])
  const admission = manager.admit('admitted')
  assert.equal(admission.admitted, true)
  assert.deepEqual(admission.consumedIds, ['once'])
  assert.equal(manager.get('once'), null)
  assert.equal(manager.get('persistent').content, 'persistent')
  assert.deepEqual(manager.lease('later').ids, ['persistent'])
  assert.equal(manager.admit('missing').admitted, false)
  assert.equal(manager.release('admitted').released, false)
})

test('replacement during a lease does not consume the new once version on old admission', () => {
  const manager = new CompatibilityInjectionManager()
  manager.upsert(descriptor('once', { once: true, content: 'old' }))
  assert.equal(manager.lease('old-generation').descriptors[0].content, 'old')
  manager.upsert(descriptor('once', { once: true, content: 'new' }))
  const admission = manager.admit('old-generation')
  assert.deepEqual(admission.consumedIds, [])
  assert.equal(manager.get('once').content, 'new')
  assert.equal(manager.lease('new-generation').descriptors[0].content, 'new')
})

test('uninject removes descriptors from outstanding leases before admission', () => {
  const manager = new CompatibilityInjectionManager()
  manager.upsert([descriptor('once', { once: true }), descriptor('keep')])
  manager.lease('generation')
  assert.equal(manager.uninject('once').changed, true)
  const admission = manager.admit('generation')
  assert.deepEqual(admission.descriptors.map(item => item.id), ['keep'])
  assert.deepEqual(admission.consumedIds, [])
})

test('projection orders injections and separates scan material from in-chat depth/role messages', () => {
  const projection = projectInjectionDescriptors([
    descriptor('late-none', { position: 'none', should_scan: true, order: 30, content: 'scan late' }),
    descriptor('assistant', { position: 'in_chat', depth: 2, role: 'assistant', order: 20, content: 'assistant prompt' }),
    descriptor('early-none', { position: 'none', should_scan: false, order: 5, content: 'not scanned' }),
    descriptor('system', { position: 'in_chat', depth: 4, role: 'system', should_scan: true, order: 10, content: 'system prompt' }),
    descriptor('same-order', { position: 'in_chat', depth: 1, role: 'user', order: 10, content: 'user prompt' }),
  ])
  assert.deepEqual(projection.messages, [
    { id: 'system', content: 'system prompt', order: 10, depth: 4, role: 'system' },
    { id: 'same-order', content: 'user prompt', order: 10, depth: 1, role: 'user' },
    { id: 'assistant', content: 'assistant prompt', order: 20, depth: 2, role: 'assistant' },
  ])
  assert.deepEqual(projection.scan, [
    { id: 'system', content: 'system prompt', order: 10, position: 'in_chat' },
    { id: 'late-none', content: 'scan late', order: 30, position: 'none' },
  ])
  assert.equal(projection.messages.some(item => item.id === 'late-none'), false, 'position none never becomes an in-chat message')
  assert.equal(projection.scan.some(item => item.id === 'early-none'), false, 'should_scan false contributes no scan material')
})
