import { createHash } from 'node:crypto'

const MODERN_PATH = 'data.extensions.tavern_helper.scripts'
const LEGACY_PATH = 'data.extensions.TavernHelper_scripts'

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return structuredClone(value)
}

function fieldBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeButtons(value, fallbackEnabled = true) {
  const input = record(value) ? value : {}
  return {
    enabled: fieldBoolean(input.enabled, fallbackEnabled),
    buttons: (Array.isArray(input.buttons) ? input.buttons : []).map(button => ({
      name: String(button?.name ?? ''),
      visible: fieldBoolean(button?.visible, true),
    })),
  }
}

function normalizeData(value) {
  return record(value) ? clone(value) : {}
}

function normalizeExportWith(value) {
  const input = record(value) ? value : {}
  return {
    data: fieldBoolean(input.data, true),
    button: fieldBoolean(input.button, true),
  }
}

function stableGeneratedId(path, originalId, content) {
  const material = `${path}\0${String(originalId ?? '')}\0${content}`
  return `script-${createHash('sha256').update(material).digest('hex').slice(0, 16)}`
}

function runtimeId(originalId, path, content, used) {
  const original = String(originalId ?? '').trim()
  let id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(original)
    ? original
    : stableGeneratedId(path, original, content)
  if (used.has(id)) id = stableGeneratedId(path, original, content)
  let suffix = 2
  const base = id
  while (used.has(id)) {
    id = `${base.slice(0, 120)}-${suffix}`
    suffix += 1
  }
  used.add(id)
  return id
}

function descriptor(path, type, value) {
  return {
    path,
    type,
    id: String(value?.id ?? ''),
    name: String(value?.name ?? ''),
  }
}

function createReport() {
  return {
    schemaVersion: 1,
    sources: [],
    found: [],
    converted: [],
    skipped: [],
    losses: [],
  }
}

function reportLoss(report, path, fields, reason) {
  report.losses.push({ path, fields, reason })
}

function normalizeModernScript(value, context) {
  const { path, folder, report, usedIds, format } = context
  if (!record(value)) {
    report.skipped.push({ path, reason: 'script entry is not an object' })
    return null
  }
  const content = String(value.content ?? '')
  const originalId = String(value.id ?? '')
  const id = runtimeId(originalId, path, content, usedIds)
  const scriptEnabled = fieldBoolean(value.enabled, false)
  const folderEnabled = folder === null ? true : folder.enabled
  const effectiveEnabled = scriptEnabled && folderEnabled
  const name = String(value.name ?? '')
  const button = normalizeButtons(value.button)
  const data = normalizeData(value.data)
  const exportWith = normalizeExportWith(value.export_with)
  const metadata = {
    format,
    path,
    id: originalId,
    enabled: scriptEnabled,
    folder: folder === null ? null : clone(folder),
  }
  const found = descriptor(path, 'script', value)
  report.found.push(found)
  const reason = folder !== null && !folder.enabled
    ? 'content converted to JavaScript source; script remains disabled because its folder is disabled'
    : `content converted to JavaScript source; enabled=${scriptEnabled} preserved`
  report.converted.push({ ...found, runtimeId: id, enabled: { script: scriptEnabled, folder: folder?.enabled ?? null, effective: effectiveEnabled }, reason })
  if (id !== originalId) {
    reportLoss(report, path, ['id'], originalId === ''
      ? 'source id was absent; generated a stable runtime id'
      : 'source id could not be used uniquely by the runtime; the original id remains in tavernHelper.id')
  }
  if (!record(value.button) && value.button !== undefined) reportLoss(report, path, ['button'], 'invalid button metadata was normalized to TavernHelper defaults')
  if (!record(value.data) && value.data !== undefined) reportLoss(report, path, ['data'], 'invalid data metadata was normalized to an empty object')
  if (!record(value.export_with) && value.export_with !== undefined) reportLoss(report, path, ['export_with'], 'invalid export_with metadata was normalized to TavernHelper defaults')
  return {
    type: 'script',
    id,
    name,
    kind: 'javascript',
    enabled: effectiveEnabled,
    approvedHash: null,
    source: content,
    content,
    info: String(value.info ?? ''),
    button,
    data,
    export_with: exportWith,
    folder: folder === null ? null : clone(folder),
    tavernHelper: metadata,
  }
}

function modernFolder(value, path, format, report, usedIds) {
  const found = descriptor(path, 'folder', value)
  report.found.push(found)
  if (!Array.isArray(value.scripts)) {
    report.skipped.push({ ...found, reason: 'folder scripts is not an array' })
    return []
  }
  const folder = {
    type: 'folder',
    id: String(value.id ?? ''),
    name: String(value.name ?? ''),
    enabled: fieldBoolean(value.enabled, false),
    icon: String(value.icon ?? 'fa-solid fa-folder'),
    color: String(value.color ?? ''),
    path,
  }
  return value.scripts.flatMap((script, index) => {
    const childPath = `${path}.scripts[${index}]`
    if (script?.type === 'folder') {
      report.skipped.push({ ...descriptor(childPath, 'folder', script), reason: 'TavernHelper folders may contain scripts, not nested folders' })
      return []
    }
    const normalized = normalizeModernScript(script, { path: childPath, folder, report, usedIds, format })
    return normalized === null ? [] : [normalized]
  })
}

function parseModernTree(value, path, format, report, usedIds) {
  if (!record(value)) {
    report.skipped.push({ path, reason: 'script tree entry is not an object' })
    return []
  }
  if (value.type === 'folder') return modernFolder(value, path, format, report, usedIds)
  if (value.type !== 'script') {
    report.skipped.push({ ...descriptor(path, String(value.type ?? 'unknown'), value), reason: 'script tree type must be script or folder' })
    return []
  }
  const normalized = normalizeModernScript(value, { path, folder: null, report, usedIds, format })
  return normalized === null ? [] : [normalized]
}

function legacyScriptData(value, path, folder, report, usedIds) {
  if (!record(value)) {
    report.skipped.push({ path, reason: 'legacy script entry is not an object' })
    return null
  }
  if (typeof value.content !== 'string') reportLoss(report, path, ['content'], 'legacy content was absent or not a string; converted to a string with an empty default')
  if (typeof value.enabled !== 'boolean') reportLoss(report, path, ['enabled'], 'legacy enabled was absent or not a boolean; defaulted to false')
  const modern = {
    type: 'script',
    enabled: fieldBoolean(value.enabled, false),
    name: String(value.name ?? ''),
    id: String(value.id ?? ''),
    content: String(value.content ?? ''),
    info: String(value.info ?? ''),
    button: { enabled: true, buttons: Array.isArray(value.buttons) ? value.buttons : [] },
    data: normalizeData(value.data),
    export_with: { data: true, button: true },
  }
  reportLoss(report, path, ['button.enabled', 'export_with'], 'legacy schema did not store these fields; TavernHelper migration defaults were applied')
  return normalizeModernScript(modern, { path, folder, report, usedIds, format: 'tavern-helper-legacy' })
}

function parseLegacyTree(value, path, report, usedIds) {
  if (!record(value)) {
    report.skipped.push({ path, reason: 'legacy script tree entry is not an object' })
    return []
  }
  if (value.type === 'folder' && Array.isArray(value.value)) {
    const found = descriptor(path, 'folder', value)
    report.found.push(found)
    const folder = {
      type: 'folder',
      id: String(value.id ?? ''),
      name: String(value.name ?? ''),
      enabled: true,
      icon: String(value.icon ?? 'fa-solid fa-folder'),
      color: String(value.color ?? ''),
      path,
    }
    reportLoss(report, path, ['enabled'], 'legacy folder schema did not store enabled; TavernHelper migration defaulted it to true')
    return value.value.flatMap((script, index) => {
      const normalized = legacyScriptData(script, `${path}.value[${index}]`, folder, report, usedIds)
      return normalized === null ? [] : [normalized]
    })
  }
  if (value.type === 'script' && Object.hasOwn(value, 'value')) {
    const normalized = legacyScriptData(value.value, `${path}.value`, null, report, usedIds)
    return normalized === null ? [] : [normalized]
  }
  if (value.type === 'script' || value.type === 'folder') return parseModernTree(value, path, 'tavern-helper', report, usedIds)
  if (Object.hasOwn(value, 'value')) {
    if (!record(value.value)) { report.skipped.push({ path, reason: 'unknown legacy wrapper has no script object in value' }); return [] }
    reportLoss(report, path, ['type'], `unknown legacy wrapper ${String(value.type)} was unpacked from value`)
    const normalized = legacyScriptData(value.value, `${path}.value`, null, report, usedIds)
    return normalized === null ? [] : [normalized]
  }
  const normalized = legacyScriptData(value, path, null, report, usedIds)
  return normalized === null ? [] : [normalized]
}

function sourceObject(value) {
  if (!record(value)) return null
  for (const field of ['source', 'code', 'script', 'html', 'content']) {
    if (typeof value[field] === 'string') return { field, source: value[field] }
  }
  return null
}

function genericScript(value, path, report, usedIds, explicitSource) {
  const sourceEntry = explicitSource ?? sourceObject(value)
  if (sourceEntry === null || sourceEntry.source.trim() === '') {
    report.skipped.push({ ...descriptor(path, 'script', value), reason: 'fallback script has no non-empty source, code, script, html, or content field' })
    return null
  }
  const object = record(value) ? value : {}
  const content = sourceEntry.source
  const originalId = String(object.id ?? '')
  const id = runtimeId(originalId, path, content, usedIds)
  const enabled = object.enabled !== false && object.disabled !== true
  const kind = sourceEntry.field === 'html' || /<html|<body|<!doctype/i.test(content) ? 'html' : 'javascript'
  const name = String(object.name ?? object.label ?? path.split('.').at(-1) ?? 'Imported script')
  const found = { path, type: 'script', id: originalId, name }
  report.found.push(found)
  report.converted.push({ ...found, runtimeId: id, enabled: { script: enabled, folder: null, effective: enabled }, reason: `${sourceEntry.field} imported through generic fallback as ${kind}` })
  const unavailable = ['info', 'button', 'data', 'export_with', 'folder'].filter(field => !Object.hasOwn(object, field))
  if (!Object.hasOwn(object, 'id')) unavailable.unshift('id')
  if (!Object.hasOwn(object, 'enabled') && !Object.hasOwn(object, 'disabled')) unavailable.push('enabled')
  if (unavailable.length > 0) reportLoss(report, path, unavailable, 'generic fallback source did not provide complete TavernHelper metadata')
  return {
    id,
    name,
    kind,
    enabled,
    approvedHash: null,
    source: content,
    ...(Object.hasOwn(object, 'content') || Object.hasOwn(object, 'info') || Object.hasOwn(object, 'button') || Object.hasOwn(object, 'data') || Object.hasOwn(object, 'export_with') ? {
      type: 'script',
      content,
      info: String(object.info ?? ''),
      button: normalizeButtons(object.button),
      data: normalizeData(object.data),
      export_with: normalizeExportWith(object.export_with),
      folder: null,
      tavernHelper: { format: 'generic-fallback', path, id: originalId, enabled, folder: null },
    } : {}),
  }
}

function genericFallback(extensions, report, usedIds) {
  const scripts = []
  const stack = Object.entries(extensions).reverse().flatMap(([key, value]) => {
    if (key === 'regex_scripts' || key === 'tavern_helper' || key === 'TavernHelper_scripts') return []
    return [{ value, path: `data.extensions.${key}`, eligible: /^(?:scripts?|javascript|html|renderer|slash)$/i.test(key) }]
  })
  while (stack.length > 0) {
    const current = stack.pop()
    const { value, path, eligible } = current
    if (typeof value === 'string') {
      if (eligible) {
        const normalized = genericScript({}, path, report, usedIds, { field: 'source', source: value })
        if (normalized !== null) scripts.push(normalized)
      }
      continue
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push({ value: value[index], path: `${path}[${index}]`, eligible })
      continue
    }
    if (!record(value)) continue
    if (eligible && value.type === 'folder' && Array.isArray(value.scripts)) {
      scripts.push(...modernFolder(value, path, 'generic-fallback', report, usedIds))
      continue
    }
    const source = eligible ? sourceObject(value) : null
    if (source !== null) {
      const normalized = genericScript(value, path, report, usedIds, source)
      if (normalized !== null) scripts.push(normalized)
      continue
    }
    const entries = Object.entries(value)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]
      if (key === 'regex_scripts') continue
      stack.push({ value: child, path: `${path}.${key}`, eligible: eligible || /^(?:scripts?|javascript|html|renderer|slash)$/i.test(key) })
    }
  }
  return scripts
}

export function extractCardScriptImports(card) {
  const report = createReport()
  const usedIds = new Set()
  const extensions = record(card?.data?.extensions) ? card.data.extensions : {}
  const modern = record(extensions.tavern_helper) ? extensions.tavern_helper.scripts : undefined
  let scripts = []
  if (modern !== undefined) {
    report.sources.push({ path: MODERN_PATH, format: 'tavern-helper' })
    if (Array.isArray(modern)) {
      scripts = modern.flatMap((tree, index) => parseModernTree(tree, `${MODERN_PATH}[${index}]`, 'tavern-helper', report, usedIds))
    } else {
      report.skipped.push({ path: MODERN_PATH, reason: 'TavernHelper scripts is not an array' })
    }
  } else if (Object.hasOwn(extensions, 'TavernHelper_scripts')) {
    report.sources.push({ path: LEGACY_PATH, format: 'tavern-helper-legacy' })
    if (Array.isArray(extensions.TavernHelper_scripts)) {
      scripts = extensions.TavernHelper_scripts.flatMap((tree, index) => parseLegacyTree(tree, `${LEGACY_PATH}[${index}]`, report, usedIds))
    } else {
      report.skipped.push({ path: LEGACY_PATH, reason: 'legacy TavernHelper scripts is not an array' })
    }
  } else {
    report.sources.push({ path: 'data.extensions', format: 'generic-fallback' })
    scripts = genericFallback(extensions, report, usedIds)
  }
  report.summary = {
    found: report.found.filter(item => item.type === 'script').length,
    folders: report.found.filter(item => item.type === 'folder').length,
    converted: report.converted.length,
    skipped: report.skipped.length,
    losses: report.losses.length,
  }
  return { scripts, report }
}

export function preserveImportedScriptMetadata(script, source) {
  if (!record(script?.tavernHelper)) return {}
  return {
    type: 'script',
    content: String(source),
    info: String(script.info ?? ''),
    button: normalizeButtons(script.button),
    data: normalizeData(script.data),
    export_with: normalizeExportWith(script.export_with),
    folder: script.folder === null ? null : record(script.folder) ? clone(script.folder) : null,
    tavernHelper: clone(script.tavernHelper),
  }
}
