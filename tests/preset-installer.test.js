import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { installBundledPreset } from '../src/preset-installer.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-st-preset-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const systemRoot = join(root, 'system')
  const userRoot = join(root, 'user')
  const sourceDir = join(root, 'bundled')
  await mkdir(join(systemRoot, 'minimal'), { recursive: true })
  await mkdir(userRoot, { recursive: true })
  await mkdir(sourceDir, { recursive: true })
  await writeFile(join(systemRoot, 'minimal', 'agent.cordis.yml'), '- id: persona\n  name: minimal\n', 'utf8')
  await writeFile(join(systemRoot, 'minimal', 'preset.yml'), 'name: Minimal\n', 'utf8')
  await writeFile(join(sourceDir, 'agent.cordis.yml'), '- id: tavern\n  name: dsh-sillytavern/agent\n', 'utf8')
  await writeFile(join(sourceDir, 'preset.yml'), 'name: 酒馆模式\n', 'utf8')

  const roster = {
    async list() {
      const values = [{ id: 'minimal', trust: 'system', path: join(systemRoot, 'minimal', 'agent.cordis.yml') }]
      for (const id of await readdir(userRoot)) {
        values.push({ id, trust: 'user', path: join(userRoot, id, 'agent.cordis.yml') })
      }
      return values
    },
    async resolve(id) {
      const value = (await this.list()).find(item => item.id === id)
      if (value === undefined) throw new Error(`preset ${id} not found`)
      return value
    },
    async copy(from, id) {
      const source = await this.resolve(from)
      await cp(join(source.path, '..'), join(userRoot, id), { recursive: true, force: false, errorOnExist: true })
    },
    async remove(id) { await rm(join(userRoot, id), { recursive: true, force: true }) },
  }
  return { roster, sourceDir, userRoot }
}

test('automatically installs, discovers, and idempotently adopts the bundled preset', async t => {
  const { roster, sourceDir, userRoot } = await fixture(t)
  const installed = await installBundledPreset(roster, { sourceDir, version: '0.2.0' })
  assert.equal(installed.status, 'installed')
  assert.equal(await readFile(join(userRoot, 'sillytavern', 'agent.cordis.yml'), 'utf8'), '- id: tavern\n  name: dsh-sillytavern/agent\n')
  const marker = JSON.parse(await readFile(join(userRoot, 'sillytavern', '.dsh-sillytavern-managed.json'), 'utf8'))
  assert.equal(marker.managedBy, 'dsh-sillytavern')
  assert.equal(marker.version, '0.2.0')
  assert.ok((await roster.list()).some(preset => preset.id === 'sillytavern'))
  assert.equal((await installBundledPreset(roster, { sourceDir, version: '0.2.0' })).status, 'current')
  assert.equal((await readdir(userRoot)).some(id => id.includes('-install-')), false, 'writable-root probes are cleaned up')
})

test('updates an unmodified managed preset but refuses to overwrite user edits', async t => {
  const { roster, sourceDir, userRoot } = await fixture(t)
  await installBundledPreset(roster, { sourceDir, version: '0.2.0' })
  await writeFile(join(sourceDir, 'agent.cordis.yml'), '- id: tavern-v2\n  name: dsh-sillytavern/agent\n', 'utf8')
  const updated = await installBundledPreset(roster, { sourceDir, version: '0.2.1' })
  assert.equal(updated.status, 'updated')
  assert.match(await readFile(join(userRoot, 'sillytavern', 'agent.cordis.yml'), 'utf8'), /tavern-v2/)
  await writeFile(join(userRoot, 'sillytavern', 'agent.cordis.yml'), '- id: user-customized\n  name: custom\n', 'utf8')
  await assert.rejects(installBundledPreset(roster, { sourceDir, version: '0.2.2' }), /refusing to overwrite/)
})

test('adopts an identical pre-existing manual installation without replacing it', async t => {
  const { roster, sourceDir, userRoot } = await fixture(t)
  await cp(sourceDir, join(userRoot, 'sillytavern'), { recursive: true })
  const result = await installBundledPreset(roster, { sourceDir, version: '0.2.0' })
  assert.equal(result.status, 'current')
  const marker = JSON.parse(await readFile(join(userRoot, 'sillytavern', '.dsh-sillytavern-managed.json'), 'utf8'))
  assert.equal(marker.version, '0.2.0')
})
