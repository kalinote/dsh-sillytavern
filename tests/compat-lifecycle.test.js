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

test('disconnect keeps assigned callbacks available for the same browser to resume', async () => {
  const lifecycle = new CompatibilityLifecycle({ timeoutMs: 100 })
  lifecycle.poll('s', 'a')
  let settled = false
  const pending = lifecycle.request('s', 'prepare', {}).then(value => { settled = true; return value })
  const [assigned] = lifecycle.poll('s', 'a')
  lifecycle.disconnect('s', 'a')
  await Promise.resolve()
  assert.equal(settled, false, 'route changes must not reject a callback while its iframe remounts')
  const [resumed] = lifecycle.poll('s', 'a')
  assert.equal(resumed.id, assigned.id, 'the original request is re-delivered after reconnect')
  lifecycle.complete('s', 'a', resumed.id, { ownerFrameIds: ['fresh-frame'] })
  assert.deepEqual(await pending, [{ ownerFrameIds: ['fresh-frame'] }])
  lifecycle.dispose()
})

test('callback errors, cancellation, timeout and stale leases have explicit outcomes', async () => {
  let now = 0
  const lifecycle = new CompatibilityLifecycle({ now: () => now, leaseMs: 10, timeoutMs: 20 })
  lifecycle.poll('s', 'a')
  const failed = lifecycle.request('s', 'prepare', {})
  lifecycle.complete('s', 'a', lifecycle.poll('s', 'a')[0].id, null, 'filter failed')
  await assert.rejects(failed, /filter failed/)
  const controller = new AbortController()
  const cancelled = lifecycle.request('s', 'prepare', {}, controller.signal)
  controller.abort(new Error('cancelled'))
  await assert.rejects(cancelled, /cancelled/)
  const timedOut = lifecycle.request('s', 'prepare', {})
  lifecycle.disconnect('s', 'a')
  await assert.rejects(timedOut, /timed out/)
  lifecycle.poll('s', 'a')
  now = 11
  assert.deepEqual(await lifecycle.request('s', 'prepare', {}), [])
  lifecycle.dispose()
})
