const POSITIONS = new Set(['none', 'in_chat'])
const ROLES = new Set(['system', 'assistant', 'user'])

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function freeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freeze(child, seen)
  return Object.freeze(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boolean(value, fallback, label) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

function identifier(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null
  const id = String(value ?? '').trim()
  if (id === '') throw new TypeError(`${label} must be a non-empty string`)
  return id
}

function orderOf(value) {
  if (value === undefined) return 0
  const order = Number(value)
  if (!Number.isFinite(order)) throw new TypeError('injection order must be finite')
  return order
}

function depthOf(value) {
  if (value === undefined) return 0
  const depth = Number(value)
  if (!Number.isSafeInteger(depth) || depth < 0) throw new TypeError('injection depth must be a non-negative safe integer')
  return depth
}

export function normalizeInjectionDescriptor(input, defaults = {}) {
  if (!isRecord(input)) throw new TypeError('injection descriptor must be an object')
  if (!isRecord(defaults)) throw new TypeError('injection defaults must be an object')
  if (input.filter !== undefined && typeof input.filter !== 'function') throw new TypeError('injection filter must be a function')
  const position = input.position ?? defaults.position ?? 'in_chat'
  if (!POSITIONS.has(position)) throw new TypeError('injection position must be none or in_chat')
  const role = input.role ?? defaults.role ?? 'system'
  if (!ROLES.has(role)) throw new TypeError('injection role must be system, assistant, or user')
  const hasFilter = typeof input.filter === 'function' || boolean(input.hasFilter ?? defaults.hasFilter, false, 'injection hasFilter')
  const ownerFrameId = identifier(input.ownerFrameId ?? defaults.ownerFrameId, 'injection ownerFrameId', !hasFilter)
  const descriptor = {
    id: identifier(input.id, 'injection id'),
    position,
    depth: depthOf(input.depth ?? defaults.depth),
    role,
    content: String(input.content ?? input.text ?? defaults.content ?? ''),
    should_scan: boolean(input.should_scan ?? defaults.should_scan, false, 'injection should_scan'),
    once: boolean(input.once ?? defaults.once, false, 'injection once'),
    ownerFrameId,
    hasFilter,
    order: orderOf(input.order ?? defaults.order),
  }
  return freeze(descriptor)
}

function projectionItem(descriptor) {
  return {
    id: descriptor.id,
    content: descriptor.content,
    order: descriptor.order,
  }
}

export function projectInjectionDescriptors(descriptors) {
  if (!Array.isArray(descriptors)) throw new TypeError('injection descriptors must be an array')
  const normalized = descriptors.map(descriptor => normalizeInjectionDescriptor(descriptor))
  const ordered = normalized.map((descriptor, sequence) => ({ descriptor, sequence }))
    .sort((left, right) => left.descriptor.order - right.descriptor.order || left.sequence - right.sequence || left.descriptor.id.localeCompare(right.descriptor.id))
  const scan = []
  const messages = []
  for (const { descriptor } of ordered) {
    if (descriptor.should_scan) scan.push(freeze({ ...projectionItem(descriptor), position: descriptor.position }))
    if (descriptor.position === 'in_chat') messages.push(freeze({
      ...projectionItem(descriptor),
      depth: descriptor.depth,
      role: descriptor.role,
    }))
  }
  return freeze({ scan, messages })
}

function normalizedIds(values, label) {
  const input = Array.isArray(values) || values instanceof Set ? [...values] : [values]
  const ids = []
  const seen = new Set()
  for (const value of input) {
    const id = identifier(value, label)
    if (!seen.has(id)) { seen.add(id); ids.push(id) }
  }
  return ids
}

export class CompatibilityInjectionManager {
  #entries = new Map()
  #leases = new Map()
  #onceClaims = new Map()
  #sequence = 0
  #version = 0

  #entryView(entry) {
    return entry === undefined ? null : freeze(clone(entry.descriptor))
  }

  #leaseView(lease) {
    const descriptors = lease.items.map(item => clone(item.descriptor))
    return freeze({
      generationId: lease.generationId,
      descriptors,
      ids: descriptors.map(descriptor => descriptor.id),
      projection: projectInjectionDescriptors(descriptors),
    })
  }

  upsert(descriptors, defaults = {}) {
    const input = Array.isArray(descriptors) ? descriptors : [descriptors]
    const normalized = input.map(descriptor => normalizeInjectionDescriptor(descriptor, defaults))
    const batchIds = new Set()
    for (const descriptor of normalized) {
      if (batchIds.has(descriptor.id)) throw new TypeError(`duplicate injection id ${descriptor.id}`)
      batchIds.add(descriptor.id)
    }
    const insertedIds = []
    const updatedIds = []
    for (const descriptor of normalized) {
      const previous = this.#entries.get(descriptor.id)
      const entry = {
        descriptor,
        sequence: previous?.sequence ?? ++this.#sequence,
        version: ++this.#version,
      }
      this.#entries.set(descriptor.id, entry)
      if (previous === undefined) insertedIds.push(descriptor.id)
      else updatedIds.push(descriptor.id)
    }
    return freeze({
      ids: normalized.map(descriptor => descriptor.id),
      insertedIds,
      updatedIds,
      descriptors: normalized.map(clone),
      changed: normalized.length > 0,
    })
  }

  uninject(ids) {
    const requestedIds = normalizedIds(ids, 'injection id')
    const removedIds = []
    const missingIds = []
    for (const id of requestedIds) {
      if (this.#entries.delete(id)) removedIds.push(id)
      else missingIds.push(id)
      const claimedBy = this.#onceClaims.get(id)
      if (claimedBy !== undefined) this.#onceClaims.delete(id)
      for (const lease of this.#leases.values()) lease.items = lease.items.filter(item => item.descriptor.id !== id)
    }
    return freeze({ ids: requestedIds, removedIds, missingIds, changed: removedIds.length > 0 })
  }

  lease(generationId, eligibleIds) {
    const id = identifier(generationId, 'generationId')
    const existing = this.#leases.get(id)
    if (existing !== undefined) return this.#leaseView(existing)
    const eligible = eligibleIds === undefined ? new Set() : new Set(normalizedIds(eligibleIds, 'eligible injection id'))
    const items = [...this.#entries.values()]
      .sort((left, right) => left.descriptor.order - right.descriptor.order || left.sequence - right.sequence || left.descriptor.id.localeCompare(right.descriptor.id))
      .filter(entry => !entry.descriptor.hasFilter || eligible.has(entry.descriptor.id))
      .filter(entry => !entry.descriptor.once || !this.#onceClaims.has(entry.descriptor.id))
      .map(entry => ({ descriptor: entry.descriptor, version: entry.version }))
    for (const item of items) if (item.descriptor.once) this.#onceClaims.set(item.descriptor.id, id)
    const lease = { generationId: id, items }
    this.#leases.set(id, lease)
    return this.#leaseView(lease)
  }

  admit(generationId) {
    const id = identifier(generationId, 'generationId')
    const lease = this.#leases.get(id)
    if (lease === undefined) return freeze({ generationId: id, admitted: false, consumedIds: [], descriptors: [], projection: projectInjectionDescriptors([]) })
    this.#leases.delete(id)
    const consumedIds = []
    for (const item of lease.items) {
      if (!item.descriptor.once) continue
      if (this.#onceClaims.get(item.descriptor.id) === id) this.#onceClaims.delete(item.descriptor.id)
      const current = this.#entries.get(item.descriptor.id)
      if (current?.version === item.version) {
        this.#entries.delete(item.descriptor.id)
        consumedIds.push(item.descriptor.id)
      }
    }
    const view = this.#leaseView(lease)
    return freeze({ generationId: id, admitted: true, consumedIds, descriptors: view.descriptors, projection: view.projection })
  }

  release(generationId) {
    const id = identifier(generationId, 'generationId')
    const lease = this.#leases.get(id)
    if (lease === undefined) return freeze({ generationId: id, released: false, releasedIds: [] })
    this.#leases.delete(id)
    const releasedIds = []
    for (const item of lease.items) {
      if (!item.descriptor.once || this.#onceClaims.get(item.descriptor.id) !== id) continue
      this.#onceClaims.delete(item.descriptor.id)
      releasedIds.push(item.descriptor.id)
    }
    return freeze({ generationId: id, released: true, releasedIds })
  }

  get(id) {
    return this.#entryView(this.#entries.get(String(id ?? '')))
  }

  list() {
    return [...this.#entries.values()]
      .sort((left, right) => left.descriptor.order - right.descriptor.order || left.sequence - right.sequence || left.descriptor.id.localeCompare(right.descriptor.id))
      .map(entry => this.#entryView(entry))
  }
}
