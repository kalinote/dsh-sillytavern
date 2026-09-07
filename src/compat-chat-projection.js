// The ledger owns ordinary chat floors. Protocol messages travel with the
// native floor that precedes them, so moving text cannot orphan a tool result.
export function projectCompatibilityChat(options, events, projection) {
  if (!Array.isArray(options?.messages) || !Array.isArray(projection?.messages)) return options
  const idBySeq = new Map()
  for (const event of events) {
    const message = event?.type === 'user/message' ? event.data : event?.type === 'assistant/message' ? event.data?.message : null
    if (typeof message?.id === 'string') idBySeq.set(event.seq, message.id)
  }
  const owned = new Set((projection.seenSourceSeqs ?? projection.messages.map(item => item.sourceSeq)).map(seq => idBySeq.get(seq)).filter(id => id !== undefined))
  const groups = new Map()
  const slots = []
  let group
  const isProtocol = message => message?.role === 'tool' || message?.role === 'function' || (Array.isArray(message?.content) && message.content.some(block => block?.type === 'tool-result' || block?.type === 'tool-call'))
  for (const message of options.messages) {
    if (owned.has(message.id)) {
      group = { native: message, following: [] }
      groups.set(message.id, group)
      slots.push({ group })
    } else if (group && isProtocol(message)) group.following.push(message)
    else { slots.push({ message }); group = undefined }
  }
  const retained = new Set()
  const ordered = []
  for (const item of projection.messages) {
    if (item.origin === 'native' || item.sourceSeq != null) {
      const id = idBySeq.get(item.sourceSeq)
      const nativeGroup = groups.get(id)
      // Compacted or otherwise absent history must never be resurrected.
      if (!nativeGroup) continue
      retained.add(id)
      const native = nativeGroup.native
      const protocol = Array.isArray(native.content) && native.content.some(block => block?.type === 'tool-call')
      if (item.is_hidden === true) {
        if (protocol) ordered.push([{ ...native, content: native.content.filter(block => block?.type !== 'text') }, ...nativeGroup.following])
        continue
      }
      const text = String(item.message ?? '')
      let replaced = false
      const content = Array.isArray(native.content) ? native.content.flatMap(block => {
        if (block?.type !== 'text') return [block]
        if (replaced) return []
        replaced = true
        return [{ ...block, text }]
      }) : [{ type: 'text', text }]
      if (Array.isArray(native.content) && !replaced && text !== '') content.unshift({ type: 'text', text })
      if (protocol && item.role !== native.role) {
        ordered.push([{ ...native, id: `${native.id}-compat-text`, role: item.role, content: [{ type: 'text', text }] },
          { ...native, content: native.content.filter(block => block?.type !== 'text') }, ...nativeGroup.following])
      } else ordered.push([{ ...native, role: item.role, content }, ...nativeGroup.following])
    } else if (item.is_hidden !== true) ordered.push([{
      id: `dsh-sillytavern-compat-${item.uid}`,
      role: item.role,
      content: [{ type: 'text', text: String(item.message ?? '') }],
      source: { kind: 'plugin', plugin: 'dsh-sillytavern', form: 'compatibility-message' },
    }])
  }
  // Deleted tool-bearing floors retain only the protocol portion. Ordinary
  // text and image floors disappear entirely; their tombstones remain owned.
  const residual = nativeGroup => {
    const native = nativeGroup.native
    if (retained.has(native.id) || !Array.isArray(native.content) || !native.content.some(block => block?.type === 'tool-call')) return []
    return [{ ...native, content: native.content.filter(block => block?.type !== 'text') }, ...nativeGroup.following]
  }
  const messages = []
  let cursor = 0
  let remainingSlots = slots.filter(slot => slot.group).length
  for (const slot of slots) {
    if (slot.message) messages.push(slot.message)
    else {
      if (cursor < ordered.length) messages.push(...ordered[cursor++])
      messages.push(...residual(slot.group))
      remainingSlots -= 1
      if (remainingSlots === 0) while (cursor < ordered.length) messages.push(...ordered[cursor++])
    }
  }
  while (cursor < ordered.length) messages.push(...ordered[cursor++])
  return { ...options, messages }
}
