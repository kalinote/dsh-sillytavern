/** A mounted event view owns one sequential, revision-aware polling source. */
function createEventExplorerSource({ load, interval = 2000, schedule = setTimeout, cancel = clearTimeout,
  isVisible = () => true, subscribeVisibility = () => () => {} }) {
  const initial = () => ({ document: null, loading: true, refreshing: false, error: null })
  let state = initial()
  const listeners = new Set()
  let timer
  let current
  let disposed = false
  let unwatch

  function publish(next) {
    state = next
    for (const listener of listeners) listener()
  }

  function clearTimer() {
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }

  function queue() {
    clearTimer()
    if (!disposed && listeners.size > 0 && isVisible()) {
      timer = schedule(() => { timer = undefined; void refresh(false) }, interval)
    }
  }

  function refresh(manual = true) {
    if (disposed || listeners.size === 0) return Promise.resolve()
    if (current !== undefined) return current.promise
    clearTimer()
    const run = { controller: new AbortController(), promise: undefined }
    current = run
    if (manual && state.document !== null) publish({ ...state, refreshing: true })
    run.promise = Promise.resolve().then(() => load(state.document?.revision, run.controller.signal)).then(value => {
      if (current !== run || run.controller.signal.aborted) return
      const document = value.unchanged ? state.document : value.document
      if (document !== state.document || state.loading || state.refreshing || state.error !== null) {
        publish({ document, loading: false, refreshing: false, error: null })
      }
    }).catch(error => {
      if (current !== run || run.controller.signal.aborted) return
      publish({ ...state, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (current !== run) return
      current = undefined
      queue()
    })
    return run.promise
  }

  function stop() {
    clearTimer()
    const run = current
    current = undefined
    run?.controller.abort()
    unwatch?.()
    unwatch = undefined
    state = initial()
  }

  return {
    getSnapshot: () => state,
    refresh: () => refresh(true),
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      if (listeners.size === 1) {
        unwatch = subscribeVisibility(() => {
          if (isVisible()) void refresh(false)
          else clearTimer()
        })
        void refresh(false)
      }
      return () => { listeners.delete(listener); if (listeners.size === 0) stop() }
    },
    dispose() { disposed = true; stop(); listeners.clear() },
  }
}

module.exports = { createEventExplorerSource }
