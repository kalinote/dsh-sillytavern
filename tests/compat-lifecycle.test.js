import assert from 'node:assert/strict'
import test from 'node:test'
import { CompatibilityLifecycle } from '../src/compat-lifecycle.js'

test('preparation waits for every live owner, and ignores foreign and duplicate acknowledgements', async () => {
  const lifecycle = new CompatibilityLifecycle()
  lifecycle.poll('s', 'a'); lifecycle.poll('s', 'b')
  let done = false
  const pending = lifecycle.request('s', 'prepare', { revision: 2 }).then(result => { done = true; return result })
  const [a] = lifecycle.poll('s', 'a')
  const [b] = lifecycle.poll('s', 'b')
  assert.equal(lifecycle.complete('s', 'b', a.id, {}, null), false)
  lifecycle.complete('s', 'a', a.id, { eligibleInjectionIds: ['one'] })
  await Promise.resolve()
  assert.equal(done, false)
  lifecycle.complete('s', 'b', b.id, { eligibleInjectionIds: ['two'] })
  assert.deepEqual(await pending, [{ eligibleInjectionIds: ['one'] }, { eligibleInjectionIds: ['two'] }])
  assert.equal(lifecycle.complete('s', 'a', a.id, {}), false)
  lifecycle.dispose()
})

test('callback errors, owner disposal, cancellation and stale leases have explicit outcomes', async () => {
  let now = 0
  const lifecycle = new CompatibilityLifecycle({ now: () => now, leaseMs: 10 })
  lifecycle.poll('s', 'a')
  const failed = lifecycle.request('s', 'prepare', {})
  lifecycle.complete('s', 'a', lifecycle.poll('s', 'a')[0].id, null, 'filter failed')
  await assert.rejects(failed, /filter failed/)
  const disconnected = lifecycle.request('s', 'prepare', {})
  lifecycle.disconnect('s', 'a')
  await assert.rejects(disconnected, /disconnected/)
  lifecycle.poll('s', 'a')
  const controller = new AbortController()
  const cancelled = lifecycle.request('s', 'prepare', {}, controller.signal)
  controller.abort(new Error('cancelled'))
  await assert.rejects(cancelled, /cancelled/)
  now = 11
  assert.deepEqual(await lifecycle.request('s', 'prepare', {}), [])
  lifecycle.dispose()
})
