/** Keep an SSE connection out of the back/forward cache while preserving its subscription. */
export function createPageEventStream(url, handlers, environment = {}) {
  const page = environment.page ?? window
  const EventSourceClass = environment.EventSource ?? EventSource
  let source = null
  let paused = false
  let closed = false

  function closeSource() {
    const current = source
    source = null
    current?.close()
  }

  function close() {
    if (closed) return
    closed = true
    closeSource()
    page.removeEventListener('pagehide', onPageHide)
    page.removeEventListener('pageshow', onPageShow)
  }

  function connect() {
    if (closed || paused || source) return
    const current = new EventSourceClass(url)
    source = current
    current.onmessage = event => {
      if (closed || current !== source) return
      const terminal = handlers.isTerminal?.(event) === true
      try { handlers.onMessage(event) } finally { if (terminal) close() }
    }
    current.onopen = event => { if (!closed && current === source) handlers.onOpen?.(event) }
    current.onerror = event => { if (!closed && current === source) handlers.onError?.(event) }
  }

  function onPageHide() {
    if (closed || paused) return
    paused = true
    closeSource()
  }

  function onPageShow() {
    if (closed || !paused) return
    paused = false
    try { handlers.onResume?.() } finally { connect() }
  }

  page.addEventListener('pagehide', onPageHide)
  page.addEventListener('pageshow', onPageShow)
  connect()
  return { close }
}
