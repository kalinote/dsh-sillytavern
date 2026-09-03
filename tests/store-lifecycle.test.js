import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname, tmpdir } from 'node:os'
import test from 'node:test'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

function live(workspace, id) {
  return { id, session: { header: { cwd: workspace }, events: [] } }
}

test('session loads isolate caller cancellation and cannot resurrect disposed sessions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new SillyTavernStore({ fallbackWorkspace: join(root, 'workspace') })
  await store.ready

  const firstAgent = live(join(root, 'workspace'), 'session-cancel')
  const controller = new AbortController()
  const first = store.ensureSession(firstAgent, controller.signal)
  const second = store.ensureSession(firstAgent)
  queueMicrotask(() => controller.abort())
  await assert.rejects(first, error => error?.name === 'AbortError')
  const loaded = await second
  assert.equal(loaded.agentId, firstAgent.id)
  assert.equal(store.sessionSync(firstAgent)?.agentId, firstAgent.id)

  const disposedAgent = live(join(root, 'workspace'), 'session-disposed')
  const pending = store.ensureSession(disposedAgent)
  queueMicrotask(() => store.disposeSession(disposedAgent))
  await assert.rejects(pending, /was disposed/)
  assert.equal(store.sessionSync(disposedAgent), undefined)
})

test('recovers a dead lock owner and rejects commit after Agent disposal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const record = await store.importCard(Buffer.from(JSON.stringify(minimalCard())), { fileName: 'alice.json' })

  let deadPid = 999_999
  while (true) {
    try { process.kill(deadPid, 0); deadPid += 1 }
    catch (error) { if (error?.code === 'ESRCH') break; throw error }
  }
  const cardLock = join(stateRoot, 'cards', `${record.id}.json.lock`)
  await writeFile(cardLock, JSON.stringify({ pid: deadPid, host: hostname(), token: 'dead-owner' }), 'utf8')
  const recovered = await store.updateCard(record.id, { cardData: { description: 'Recovered.' } })
  assert.equal(recovered.card.data.description, 'Recovered.')

  const agent = live(workspace, 'session-commit-race')
  await store.bind(agent, record.id)
  const bindingsPath = join(workspace, '.dsh', 'sillytavern', 'bindings.json')
  await mkdir(join(workspace, '.dsh', 'sillytavern'), { recursive: true })
  const bindingLock = `${bindingsPath}.lock`
  await writeFile(bindingLock, JSON.stringify({ pid: process.pid, host: hostname(), token: 'live-test-owner' }), 'utf8')
  const update = store.updateSession(agent, { userPersona: { name: 'Should not commit', description: '' } })
  const controller = new AbortController()
  const waiting = store.updateSession(agent, { userPersona: { name: 'Cancelled waiter', description: '' } }, controller.signal)
  const started = Date.now()
  setTimeout(() => controller.abort(new Error('cancelled serial waiter')), 20)
  await assert.rejects(waiting, /cancelled serial waiter/)
  assert.ok(Date.now() - started < 250, 'a cancelled serial waiter must not wait for the lock timeout')
  await new Promise(resolve => setTimeout(resolve, 60))
  store.disposeSession(agent)
  await rm(bindingLock, { force: true })
  await assert.rejects(update, /was disposed/)
  const bindings = JSON.parse(await readFile(bindingsPath, 'utf8'))
  assert.equal(bindings.sessions[agent.id].userPersona.name, 'User')
})
