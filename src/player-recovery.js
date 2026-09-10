function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  return (message?.content || []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
}

// Inbox claims precede user/message persistence. Keep that distinction when a
// prompt hook fails, so an accepted player action remains recoverable on reload.
export function playerRecovery(events) {
  const queues = { 'next-turn': [], 'next-step': [] }
  const turns = []
  let current = null
  for (const event of events) {
    const data = event.data || {}
    if (event.type === 'turn/start') current = { turn: data.turn, startSeq: event.seq, inputs: [], assistantIds: [], assistantSeqs: [] }
    if (event.type === 'agent/inbox/spliced') {
      const queue = queues[data.target] || (queues[data.target] = [])
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...(data.inserted || []))
      if (current && data.outcome !== 'canceled') {
        for (const message of removed) {
          if (message?.source?.kind === 'user') current.inputs.push({ id: message.id, target: data.target, text: messageText(message), content: message.content, persisted: false })
        }
      }
    }
    if (event.type === 'user/message' && current) {
      const prior = current.inputs.find(message => message.id === data.id)
      if (prior) { prior.persisted = true; prior.seq = event.seq }
      else if (data.source?.kind === 'user' || data.source === undefined) current.inputs.push({ id: data.id, text: messageText(data), content: data.content, persisted: true, seq: event.seq })
    }
    if (event.type === 'assistant/message' && current) {
      if (data.message?.id) current.assistantIds.push(data.message.id)
      current.assistantSeqs.push(event.seq)
    }
    if (event.type === 'turn/end' && current) {
      const text = current.inputs.map(message => message.text).filter(Boolean).join('\n')
      const retryText = current.inputs.filter(message => message.target === 'next-turn').map(message => message.text).filter(Boolean).join('\n')
      const steeringText = current.inputs.filter(message => message.target === 'next-step').map(message => message.text).filter(Boolean).join('\n')
      turns.push({ ...current, endSeq: event.seq, reason: data.reason?.kind, error: data.reason?.error ?? null, text, retryText, steeringText })
      current = null
    }
  }
  return { turns, failedTurns: turns.filter(turn => turn.reason === 'error') }
}
