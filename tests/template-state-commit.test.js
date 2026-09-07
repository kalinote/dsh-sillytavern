import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

async function setup(t, suffix) {
  const root = await mkdtemp(join(tmpdir(), `dsh-st-template-${suffix}-`))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const card = await store.importCard(Buffer.from(JSON.stringify(minimalCard({ name: 'Template Character' }))), { fileName: 'template.json' })
  const agent = { id: `template-${suffix}`, session: { header: { cwd: workspace }, events: [] } }
  await store.bind(agent, card.id)
  await store.mutateCompatChat(agent, {
    action: 'create',
    messages: [{ role: 'assistant', message: 'First swipe' }],
  })
  const created = store.compatChatProjection(agent)
  await store.mutateCompatChat(agent, {
    action: 'set',
    expectedRevision: created.revision,
    messages: [{
      message_id: 0,
      swipe_id: 1,
      swipes: ['First swipe', 'Current swipe'],
      swipes_data: [{ page: 0, retained: true }, { page: 1, retained: true }],
      swipes_info: [{ source: 'first' }, { source: 'current' }],
    }],
  })
  return { store, agent, workspace }
}

function templateResult(revisions, overrides = {}) {
  return {
    baseRevisions: revisions,
    mutations: [
      { scope: 'local', key: 'localValue', path: ['localValue'], value: 'committed', delete: false, sequence: 1, source: 'test' },
      { scope: 'global', key: 'globalValue', path: ['globalValue'], value: 2, delete: false, sequence: 2, source: 'test' },
      { scope: 'message', key: 'messageValue', path: ['messageValue'], value: 3, delete: false, sequence: 3, source: 'test' },
      { scope: 'initial', key: 'ephemeral', path: ['ephemeral'], value: 4, delete: false, sequence: 4, source: 'test' },
    ],
    scopes: {
      local: { localValue: 'committed', nested: { local: true } },
      global: { globalValue: 2, nested: { global: true } },
      message: { messageValue: 3, nested: { message: true } },
      initial: { ephemeral: 4 },
      cache: { compiled: true },
    },
    ...overrides,
  }
}

test('commits local, global, and current message swipe scopes together and exposes them to the next prompt', async t => {
  const { store, agent } = await setup(t, 'multi')
  const before = store.compatibilityVariableSnapshot(agent)
  const result = await store.commitTemplateResult(agent, templateResult(before.revisions))

  assert.equal(result.committed, true)
  assert.deepEqual(result.scopes, ['local', 'global', 'message'])
  assert.deepEqual(result.message, { messageId: 0, swipeId: 1 })
  assert.equal(result.revisions.chat, before.revisions.chat + 1)
  assert.equal(result.revisions.global, before.revisions.global + 1)
  assert.equal(result.revisions.message, before.revisions.message + 1)
  assert.equal(result.revisions.workspace, before.revisions.workspace, 'initial and cache scopes do not persist')

  const prompt = store.promptState(agent)
  assert.deepEqual(prompt.binding.variables, { localValue: 'committed', nested: { local: true } })
  assert.deepEqual(prompt.globalVariables, { globalValue: 2, nested: { global: true } })
  assert.deepEqual(prompt.compatMessages[0].swipes_data, [
    { page: 0, retained: true },
    { messageValue: 3, nested: { message: true } },
  ])
  assert.deepEqual(prompt.compatMessages[0].data, { messageValue: 3, nested: { message: true } }, 'the current swipe is visible on the next prompt build')
  assert.equal(Object.hasOwn(prompt.binding.variables, 'ephemeral'), false)

  const current = store.compatibilityVariableSnapshot(agent).revisions
  const explicitSwipe = await store.commitTemplateResult(agent, {
    baseRevisions: current,
    mutations: [{ scope: 'message', key: 'page', path: ['page'], value: 'first-updated', delete: false, sequence: 1, source: 'test', messageId: 0, swipeId: 0 }],
    scopes: { message: { page: 'first-updated' } },
  })
  assert.deepEqual(explicitSwipe.message, { messageId: 0, swipeId: 0 })
  const swipes = store.promptState(agent).compatMessages[0].swipes_data
  assert.deepEqual(swipes[0], { page: 'first-updated' })
  assert.deepEqual(swipes[1], { messageValue: 3, nested: { message: true } }, 'writing another swipe does not replace the current swipe data')
})

test('rejects any stale touched scope before writing another scope', async t => {
  const { store, agent, workspace } = await setup(t, 'conflict')
  const initial = store.compatibilityVariableSnapshot(agent).revisions
  await store.commitTemplateResult(agent, templateResult(initial))

  const paths = [
    join(workspace, '.dsh', 'sillytavern', 'bindings.json'),
    join(workspace, '.dsh', 'sillytavern', 'regex-scripts.json'),
    store.sessionSync(agent).compatChatPath,
  ]
  const diskBefore = await Promise.all(paths.map(path => readFile(path, 'utf8')))
  const promptBefore = store.promptState(agent)
  const current = store.compatibilityVariableSnapshot(agent).revisions
  const stale = templateResult({ ...current, chat: current.chat - 1 }, {
    scopes: {
      local: { shouldNotCommit: 'local' },
      global: { shouldNotCommit: 'global' },
      message: { shouldNotCommit: 'message' },
      initial: {},
      cache: {},
    },
  })

  await assert.rejects(store.commitTemplateResult(agent, stale), error => {
    assert.equal(error.code, 'template-state-conflict')
    assert.deepEqual(error.details.conflicts, [{ scope: 'local', revision: 'chat', expected: current.chat - 1, current: current.chat }])
    return true
  })

  assert.deepEqual(await Promise.all(paths.map(path => readFile(path, 'utf8'))), diskBefore, 'conflict detection happens before the first file write')
  assert.deepEqual(store.promptState(agent), promptBefore, 'a rejected transaction does not publish tentative state to memory')
})

test('consumes only requested once injections with session CAS', async t => {
  const { store, agent } = await setup(t, 'once')
  const revision = store.sessionView(agent).binding.revision
  const seeded = await store.updateSession(agent, {
    expectedRevision: revision,
    scriptInjections: [
      { id: 'once-a', text: 'once a', once: true },
      { id: 'once-b', text: 'once b', once: true },
      { id: 'persistent', text: 'persistent', once: false },
    ],
  })
  const consumed = await store.consumeOnceInjections(agent, ['once-b', 'persistent', 'missing'], seeded.binding.revision)

  assert.deepEqual(consumed.removedIds, ['once-b'])
  assert.deepEqual(consumed.session.binding.scriptInjections.map(item => item.id), ['once-a', 'persistent'])
  await assert.rejects(store.consumeOnceInjections(agent, ['once-a'], seeded.binding.revision), error => error.code === 'session-revision-conflict')
  assert.deepEqual(store.sessionView(agent).binding.scriptInjections.map(item => item.id), ['once-a', 'persistent'])
})
