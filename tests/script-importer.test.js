import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { extractCardScriptImports } from '../src/script-importer.js'
import { SillyTavernStore } from '../src/store.js'
import { minimalCard } from './helpers.js'

function modernScript(overrides = {}) {
  return {
    type: 'script',
    enabled: true,
    name: 'Status logic',
    id: 'status-logic',
    content: 'globalThis.statusReady = true',
    info: 'Keeps the status panel current.',
    button: { enabled: false, buttons: [{ name: 'Refresh', visible: false }] },
    data: { nested: { count: 2 }, list: ['a', 'b'] },
    export_with: { data: false, button: true },
    ...overrides,
  }
}

test('imports the official TavernHelper script tree without losing content, metadata, or enabled states', () => {
  const card = minimalCard({
    extensions: {
      tavern_helper: {
        scripts: [
          modernScript(),
          modernScript({ id: 'same-body', name: 'Same body, separate script' }),
          {
            type: 'folder',
            enabled: false,
            name: 'Disabled folder',
            id: 'folder-disabled',
            icon: 'fa-solid fa-box-archive',
            color: '#123456',
            scripts: [modernScript({ id: 'folder-child', name: 'Folder child', enabled: true, content: 'folderChild()' })],
          },
          { type: 'unknown', id: 'unknown-node', name: 'Unknown node' },
        ],
      },
    },
  })
  const { scripts, report } = extractCardScriptImports(card)

  assert.equal(scripts.length, 3, 'scripts sharing a body remain distinct because their metadata and ids differ')
  assert.equal(scripts[0].source, card.data.extensions.tavern_helper.scripts[0].content)
  assert.equal(scripts[0].content, scripts[0].source)
  assert.equal(scripts[0].id, 'status-logic')
  assert.equal(scripts[0].enabled, true)
  assert.equal(scripts[0].info, 'Keeps the status panel current.')
  assert.deepEqual(scripts[0].button, { enabled: false, buttons: [{ name: 'Refresh', visible: false }] })
  assert.deepEqual(scripts[0].data, { nested: { count: 2 }, list: ['a', 'b'] })
  assert.deepEqual(scripts[0].export_with, { data: false, button: true })
  assert.equal(scripts[2].enabled, false, 'a disabled folder suppresses execution')
  assert.equal(scripts[2].tavernHelper.enabled, true, 'the child enabled state remains available separately')
  assert.deepEqual(scripts[2].folder, {
    type: 'folder', id: 'folder-disabled', name: 'Disabled folder', enabled: false,
    icon: 'fa-solid fa-box-archive', color: '#123456', path: 'data.extensions.tavern_helper.scripts[2]',
  })
  assert.deepEqual(report.summary, { found: 3, folders: 1, converted: 3, skipped: 1, losses: 0 })
  assert.match(report.skipped[0].reason, /type must be script or folder/)
  assert.equal(report.converted[2].enabled.effective, false)
})

test('uses stable ids and imports every script without count or traversal-depth truncation', () => {
  const official = Array.from({ length: 48 }, (_, index) => modernScript({
    id: index === 0 ? undefined : `script-${index}`,
    name: `Script ${index}`,
    content: `run(${index})`,
  }))
  const card = minimalCard({ extensions: { tavern_helper: { scripts: official } } })
  const first = extractCardScriptImports(card)
  const second = extractCardScriptImports(card)
  assert.equal(first.scripts.length, 48)
  assert.equal(new Set(first.scripts.map(script => script.id)).size, 48)
  assert.deepEqual(first.scripts.map(script => script.id), second.scripts.map(script => script.id), 'generated ids are deterministic')

  let nested = { scripts: [{ name: 'Deep fallback', code: 'deepFallback()' }] }
  for (let index = 0; index < 20; index += 1) nested = { [`level_${index}`]: nested }
  const fallback = extractCardScriptImports(minimalCard({ extensions: { vendor: nested } }))
  assert.equal(fallback.scripts.length, 1)
  assert.equal(fallback.scripts[0].source, 'deepFallback()')
  assert.equal(fallback.report.sources[0].format, 'generic-fallback')
})

test('normalizes the official legacy shapes and reports unavailable metadata', () => {
  const raw = {
    enabled: true,
    name: 'Legacy top level',
    id: 'legacy-top',
    content: 'legacyTop() ',
    info: 'legacy info',
    buttons: [{ name: 'Run', visible: true }],
    data: { counter: 4 },
  }
  const card = minimalCard({
    extensions: {
      TavernHelper_scripts: [
        raw,
        { type: 'script', value: { ...raw, id: 'legacy-wrapper', name: 'Wrapped' } },
        {
          type: 'folder', id: 'legacy-folder', name: 'Legacy folder', icon: 'folder-icon', color: '#abcdef',
          value: [{ ...raw, id: 'legacy-child', name: 'Child', enabled: false }],
        },
      ],
    },
  })
  const { scripts, report } = extractCardScriptImports(card)

  assert.equal(scripts.length, 3)
  assert.equal(scripts[0].enabled, true)
  assert.deepEqual(scripts[0].button, { enabled: true, buttons: [{ name: 'Run', visible: true }] })
  assert.deepEqual(scripts[0].export_with, { data: true, button: true })
  assert.equal(scripts[2].enabled, false)
  assert.equal(scripts[2].folder.id, 'legacy-folder')
  assert.equal(scripts[2].folder.enabled, true)
  assert.equal(report.sources[0].format, 'tavern-helper-legacy')
  assert.equal(report.summary.converted, 3)
  assert.equal(report.summary.losses, 4, 'each legacy script plus the legacy folder reports synthesized fields')
  assert.ok(report.losses.some(loss => loss.fields.includes('export_with')))
  assert.ok(report.losses.some(loss => loss.path.endsWith('[2]') && loss.fields.includes('enabled')))
})

test('store persists the import report and full metadata while retaining hash approval semantics beyond 32 scripts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-script-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const store = new SillyTavernStore({ fallbackWorkspace: workspace })
  const scriptTrees = Array.from({ length: 40 }, (_, index) => modernScript({
    id: `official-${index}`,
    name: `Official ${index}`,
    content: `globalThis.imported_${index} = true`,
    enabled: index % 2 === 0,
  }))
  const bytes = Buffer.from(JSON.stringify(minimalCard({ extensions: { tavern_helper: { scripts: scriptTrees } } })))
  const imported = await store.importCard(bytes, { fileName: 'official.json' })

  assert.equal(imported.scripts.length, 40)
  assert.deepEqual(imported.scriptImportReport.summary, { found: 40, folders: 0, converted: 40, skipped: 0, losses: 0 })
  assert.equal(imported.scripts[0].enabled, true)
  assert.equal(imported.scripts[1].enabled, false)
  assert.equal(imported.scripts[0].approvedHash, createHash('sha256').update(`javascript\0${scriptTrees[0].content}`).digest('hex'))
  assert.equal(imported.scripts[1].approvedHash, null)
  assert.deepEqual(imported.scripts[0].data, scriptTrees[0].data)
  assert.deepEqual(imported.scripts[0].button, scriptTrees[0].button)
  assert.deepEqual(imported.scripts[0].export_with, scriptTrees[0].export_with)
  const compatibilityPath = join(workspace, '.dsh', 'sillytavern', 'compatibility.json')
  const compatibility = JSON.parse(await readFile(compatibilityPath, 'utf8'))
  const scriptDataKey = `${imported.id}\u001fofficial-0`
  assert.deepEqual(compatibility.variables.scripts[scriptDataKey], scriptTrees[0].data, 'script data initializes its compatibility variable scope')
  compatibility.variables.scripts[scriptDataKey] = { userValue: 'keep me' }
  await writeFile(compatibilityPath, `${JSON.stringify(compatibility)}\n`, 'utf8')
  await store.importCard(bytes, { fileName: 'official.json' })
  const reimportedCompatibility = JSON.parse(await readFile(compatibilityPath, 'utf8'))
  assert.deepEqual(reimportedCompatibility.variables.scripts[scriptDataKey], { userValue: 'keep me' }, 'reimport never resets an existing script variable scope')

  const updated = await store.updateCard(imported.id, { scripts: imported.scripts })
  assert.equal(updated.scripts.length, 40, 'manager round trips are not capped at 32 scripts')
  const changed = await store.updateCard(imported.id, {
    scripts: updated.scripts.map((script, index) => index === 0 ? { ...script, source: `${script.source}\nchanged()` } : script),
  })
  assert.equal(changed.scripts[0].enabled, false)
  assert.equal(changed.scripts[0].approvedHash, null)
  assert.equal(changed.scripts[0].content, changed.scripts[0].source, 'preserved TavernHelper content follows an edited runtime source')

  const reloaded = new SillyTavernStore({ fallbackWorkspace: workspace })
  await reloaded.ready
  const record = reloaded.getCard(imported.id)
  assert.equal(record.scripts.length, 40)
  assert.deepEqual(record.scripts[0].button, scriptTrees[0].button)
  assert.deepEqual(record.scriptImportReport, imported.scriptImportReport)
})

test('unwraps unknown legacy wrappers and reports coercion without silently dropping source', () => {
  const { scripts, report } = extractCardScriptImports(minimalCard({ extensions: {
    TavernHelper_scripts: [{ type: 'legacy-custom', value: { id: 'wrapped', content: 42, enabled: 'true' } }],
  } }))
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].source, '42')
  assert.ok(report.losses.some(item => item.fields.includes('type')))
  assert.ok(report.losses.some(item => item.fields.includes('content')))
  assert.ok(report.losses.some(item => item.fields.includes('enabled')))
})
