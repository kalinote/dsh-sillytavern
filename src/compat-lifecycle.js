import { randomUUID } from 'node:crypto'

// A browser owns functions; the Host owns persistence and generation. Requests
// are acknowledged only after that browser has drained accepted writes.
export class CompatibilityLifecycle {
  constructor({ leaseMs = 15000, timeoutMs = 30000, now = Date.now } = {}) {
    this.sessions = new Map()
    this.leaseMs = leaseMs
    this.timeoutMs = timeoutMs
    this.now = now
  }

  session(id) {
    const key = String(id)
    if (!this.sessions.has(key)) this.sessions.set(key, { clients: new Map(), requests: new Map() })
    return this.sessions.get(key)
  }

  poll(sessionId, clientId) {
    const state = this.session(sessionId)
    state.clients.set(clientId, this.now())
    return [...state.requests.values()].filter(item => item.clientId === clientId).map(({ id, kind, payload }) => ({ id, kind, payload }))
  }

  disconnect(sessionId, clientId) {
    const state = this.session(sessionId)
    state.clients.delete(clientId)
    // Keep assigned requests until completion, abort, or timeout. A route
    // change remounts the iframe runtime with the same browser client id, and
    // poll() deliberately re-delivers these unfinished callbacks.
  }

  complete(sessionId, clientId, id, result, error) {
    const state = this.session(sessionId)
    const request = state.requests.get(id)
    if (!request || request.clientId !== clientId) return false
    state.clients.set(clientId, this.now())
    request.finish(error ? new Error(String(error)) : null, result)
    return true
  }

  clients(sessionId) {
    return [...this.session(sessionId).clients].filter(([, time]) => this.now() - time < this.leaseMs).map(([id]) => id)
  }

  async request(sessionId, kind, payload, signal, targets) {
    signal?.throwIfAborted()
    const state = this.session(sessionId)
    const clients = targets ?? this.clients(sessionId)
    const issued = []
    try { return await Promise.all(clients.map(clientId => new Promise((resolve, reject) => {
      const id = randomUUID()
      issued.push(id)
      let timer
      const aborted = () => finish(signal.reason ?? new Error('compatibility preparation aborted'))
      const finish = (error, value) => {
        if (!state.requests.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        if (error) reject(error)
        else resolve(value)
      }
      state.requests.set(id, { id, clientId, kind, payload: structuredClone(payload), finish })
      timer = setTimeout(() => finish(new Error(`compatibility ${kind} callback timed out`)), this.timeoutMs)
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted) aborted()
    }))) } catch (error) {
      for (const id of issued) state.requests.get(id)?.finish(error)
      throw error
    }
  }

  dispose(sessionId) {
    const entries = sessionId === undefined ? [...this.sessions] : [[String(sessionId), this.sessions.get(String(sessionId))]]
    for (const [id, state] of entries) {
      if (!state) continue
      for (const request of [...state.requests.values()]) request.finish(new Error('compatibility session disposed'))
      this.sessions.delete(id)
    }
  }
}
