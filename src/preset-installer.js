import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMPOSITION_FILE = 'agent.cordis.yml'
const METADATA_FILE = 'preset.yml'
const MARKER_FILE = '.dsh-sillytavern-managed.json'
const MANAGER = 'dsh-sillytavern'
const DEFAULT_PRESET_ID = 'sillytavern'
const DEFAULT_SOURCE_DIR = fileURLToPath(new URL('../preset/', import.meta.url))

async function exists(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function fingerprint(composition, metadata) {
  return createHash('sha256').update(composition).update('\0').update(metadata).digest('hex')
}

async function writeAtomic(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  try { await rename(temporary, path) } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

async function tightenDirectory(dir) {
  await chmod(dir, 0o700)
  for (const file of [COMPOSITION_FILE, METADATA_FILE, MARKER_FILE]) {
    const path = join(dir, file)
    if (await exists(path)) await chmod(path, 0o600)
  }
}

async function writeManagedDirectory(dir, bundled) {
  await mkdir(dir, { recursive: false, mode: 0o700 })
  await writeFile(join(dir, COMPOSITION_FILE), bundled.composition, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(dir, METADATA_FILE), bundled.metadata, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(dir, MARKER_FILE), `${JSON.stringify(bundled.marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await tightenDirectory(dir)
}

async function bundledPreset(sourceDir, version) {
  const composition = await readFile(join(sourceDir, COMPOSITION_FILE), 'utf8')
  const metadata = await readFile(join(sourceDir, METADATA_FILE), 'utf8')
  const bundledFingerprint = fingerprint(composition, metadata)
  return {
    composition,
    metadata,
    marker: { schemaVersion: 1, managedBy: MANAGER, version, fingerprint: bundledFingerprint },
    fingerprint: bundledFingerprint,
  }
}

async function currentFingerprint(dir) {
  const composition = await readOptional(join(dir, COMPOSITION_FILE))
  const metadata = await readOptional(join(dir, METADATA_FILE))
  if (composition === undefined || metadata === undefined) return undefined
  return fingerprint(composition, metadata)
}

async function readMarker(dir) {
  const text = await readOptional(join(dir, MARKER_FILE))
  if (text === undefined) return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

async function replaceManagedDirectory(dir, bundled, expectedFingerprint) {
  if (await currentFingerprint(dir) !== expectedFingerprint) throw new Error('the installed sillytavern preset changed while it was being updated')
  const root = dirname(dir)
  const token = randomUUID()
  const stage = join(root, `.sillytavern-stage-${token}`)
  const backup = join(root, `.sillytavern-backup-${token}`)
  await writeManagedDirectory(stage, bundled)
  try {
    await rename(dir, backup)
    try { await rename(stage, dir) } catch (error) {
      await rename(backup, dir).catch(() => undefined)
      throw error
    }
    await rm(backup, { recursive: true, force: true })
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function writableRootViaRoster(agentPresets, presetId) {
  const presets = await agentPresets.list()
  const source = presets.find(preset => preset.trust === 'system') ?? presets[0]
  if (source === undefined) throw new Error('cannot install the sillytavern preset because the deployment exposes no source preset')
  const bootstrapId = `${presetId}-install-${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await agentPresets.copy(source.id, bootstrapId, `${presetId} installer probe`)
  try {
    const probe = await agentPresets.resolve(bootstrapId)
    return dirname(dirname(probe.path))
  } finally {
    await agentPresets.remove(bootstrapId).catch(() => undefined)
  }
}

export async function installBundledPreset(agentPresets, options = {}) {
  const presetId = options.presetId ?? DEFAULT_PRESET_ID
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR
  const version = String(options.version ?? '0.0.0')
  const bundled = await bundledPreset(sourceDir, version)
  const existing = (await agentPresets.list()).find(preset => preset.id === presetId)

  if (existing !== undefined) {
    if (existing.trust !== 'user') throw new Error(`cannot install preset "${presetId}" because a deployment preset already owns that id`)
    const dir = dirname(existing.path)
    const installedFingerprint = await currentFingerprint(dir)
    const marker = await readMarker(dir)
    if (installedFingerprint === bundled.fingerprint) {
      if (marker?.managedBy !== MANAGER || marker.fingerprint !== bundled.fingerprint || marker.version !== version) {
        await writeAtomic(join(dir, MARKER_FILE), `${JSON.stringify(bundled.marker, null, 2)}\n`)
      }
      return { status: 'current', presetId, path: existing.path, version }
    }
    if (marker?.managedBy !== MANAGER || marker.fingerprint !== installedFingerprint) {
      throw new Error(`preset "${presetId}" already exists and was not safely managed by ${MANAGER}; refusing to overwrite it`)
    }
    await replaceManagedDirectory(dir, bundled, installedFingerprint)
    return { status: 'updated', presetId, path: join(dir, COMPOSITION_FILE), version }
  }

  const root = await writableRootViaRoster(agentPresets, presetId)
  const dir = join(root, presetId)
  const stage = join(root, `.sillytavern-stage-${randomUUID()}`)
  await writeManagedDirectory(stage, bundled)
  try {
    await rename(stage, dir)
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    if ((await agentPresets.list()).some(preset => preset.id === presetId)) return installBundledPreset(agentPresets, options)
    throw error
  }
  return { status: 'installed', presetId, path: join(dir, COMPOSITION_FILE), version }
}
