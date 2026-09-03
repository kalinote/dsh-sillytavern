import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { assembleSillyTavernPrompt } from '../src/prompt.js'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

function regex(overrides = {}) {
  return {
    id: overrides.id ?? 'regex',
    name: overrides.name ?? 'Regex',
    kind: 'regex',
    enabled: true,
    approvedHash: null,
    source: overrides.source ?? 'replaced',
    findRegex: overrides.findRegex ?? '/source/g',
    trimStrings: [],
    placement: overrides.placement ?? [1, 2],
    markdownOnly: overrides.markdownOnly ?? false,
    promptOnly: overrides.promptOnly ?? true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  }
}

function approve(script) {
  const material = {
    findRegex: script.findRegex,
    trimStrings: script.trimStrings,
    placement: script.placement,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
    source: script.source,
  }
  return { ...script, approvedHash: createHash('sha256').update(`regex\0${JSON.stringify(material)}`).digest('hex') }
}

function agent(workspace, id = 'session-regex-sources') {
  return { id, session: { header: { cwd: workspace }, events: [] } }
}

test('persists Global and Preset Regex sources and exposes official source order to sessions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-regex-sources-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  const first = new SillyTavernStore({ fallbackWorkspace: workspace })
  await first.ready
  const global = approve(regex({ id: 'global', name: 'Global', source: 'G' }))
  const preset = approve(regex({ id: 'preset', name: 'Preset', findRegex: '/G/g', source: 'P' }))
  await first.saveRegexSources({ global: [global], preset: [preset], variables: { shared: 'global-value' } })

  const cardRule = { ...regex({ id: 'scoped', name: 'Scoped', findRegex: '/P/g', source: 'S' }), scriptName: 'Scoped', replaceString: 'S', disabled: false }
  delete cardRule.kind
  delete cardRule.enabled
  delete cardRule.approvedHash
  delete cardRule.name
  delete cardRule.source
  const record = await first.importCard(Buffer.from(JSON.stringify(minimalCard({ extensions: { regex_scripts: [cardRule] } }))), { fileName: 'regex-sources.json' })
  const live = agent(workspace)
  await first.bind(live, record.id)
  const view = first.sessionView(live)
  assert.deepEqual(view.globalRegexScripts.map(script => script.name), ['Global'])
  assert.deepEqual(view.presetRegexScripts.map(script => script.name), ['Preset'])
  assert.deepEqual(first.regexEntries(live).map(entry => entry.scope), ['global', 'preset', 'scoped'])

  const restored = new SillyTavernStore({ fallbackWorkspace: workspace })
  await restored.ready
  await restored.ensureSession(live)
  assert.deepEqual(restored.promptState(live).globalRegexScripts.map(script => script.name), ['Global'])
  assert.deepEqual(restored.promptState(live).presetRegexScripts.map(script => script.name), ['Preset'])
  assert.deepEqual(restored.promptState(live).globalVariables, { shared: 'global-value' })
  const persistedRegex = JSON.parse(await readFile(join(stateRoot, 'regex-scripts.json'), 'utf8'))
  assert.equal(persistedRegex.schemaVersion, 1)
  assert.deepEqual(persistedRegex.variables, { shared: 'global-value' })
  await assert.rejects(restored.saveRegexSources({ global: null }), /must be an array/)
  assert.deepEqual(restored.globalRegexScripts.map(script => script.name), ['Global'], 'malformed updates cannot wipe persisted sources')

  assert.equal(restored.findRegex(live, 'global').script.enabled, true)
  await restored.toggleRegex(live, 'Global', false)
  assert.equal(restored.findRegex(live, 'Global').script.enabled, false)
  await restored.toggleRegex(live, 'Global', true)
  assert.equal(restored.findRegex(live, 'Global').script.enabled, true)
})

test('normalizes malformed persisted binding fields before prompt access', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-binding-normalize-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const seed = new SillyTavernStore({ fallbackWorkspace: workspace })
  await seed.ready
  const record = await seed.importCard(Buffer.from(JSON.stringify(minimalCard())), { fileName: 'binding.json' })
  const stateRoot = join(workspace, '.dsh', 'sillytavern')
  await mkdir(stateRoot, { recursive: true })
  await writeFile(join(stateRoot, 'bindings.json'), JSON.stringify({ schemaVersion: 1, sessions: {
    'session-malformed': { cardId: record.id, revision: 'bad', userPersona: null, variables: [], templateIds: 'bad', scriptInjections: [{ text: 42, order: 'bad' }], openingSwipeId: -5 },
    '../unsafe': { cardId: record.id },
  } }))
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const live = agent(workspace, 'session-malformed')
  await store.ensureSession(live)
  const binding = store.sessionView(live).binding
  assert.deepEqual(binding.userPersona, { name: 'User', description: '' })
  assert.deepEqual(binding.variables, {})
  assert.deepEqual(binding.templateIds, [])
  assert.deepEqual(binding.scriptInjections, [{ id: 'injection-0', text: '42', order: 0 }])
  assert.equal(binding.revision, 0)
  assert.equal(binding.openingSwipeId, 0)
  assert.doesNotThrow(() => store.promptState(live).binding.userPersona.name)
})

test('applies WORLD_INFO prompt-only Regex after worldbook activation without filtering replacement text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-regex-world-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  await store.ready
  const worldRegex = approve(regex({ id: 'world', name: 'World', placement: [5], findRegex: '/Archive lore/g', source: '{{charFirstMessage::1}}<script>world()</script>', promptOnly: true }))
  await store.saveRegexSources({ global: [worldRegex] })
  const record = await store.importCard(Buffer.from(JSON.stringify(minimalCard({
    alternate_greetings: ['ALT OPENING'],
    character_book: { entries: [{ keys: [], constant: true, enabled: true, content: 'Archive lore', insertion_order: 1, extensions: {} }], extensions: {} },
  }))), { fileName: 'world.json' })
  const live = agent(workspace, 'session-world')
  await store.bind(live, record.id)
  const counted = []
  const prompt = await assembleSillyTavernPrompt(live, store.promptState(live), undefined, {
    countTokens: async text => { counted.push(text); return text.length },
  })
  assert.match(prompt.system, /ALT OPENING<script>world\(\)<\/script>/)
  assert.doesNotMatch(prompt.system, /Archive lore/)
  assert.match(counted[0], /ALT OPENING<script>world\(\)<\/script>/, 'macro and WORLD_INFO Regex output is what the budget tokenizer receives')
  assert.doesNotMatch(counted[0], /Archive lore/)
})
