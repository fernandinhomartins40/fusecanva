import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageEventStream } from '../src/sse-lifecycle.mjs'

class Page extends EventTarget {
  listeners = new Map()
  addEventListener(type, listener, options) { this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1); super.addEventListener(type, listener, options) }
  removeEventListener(type, listener, options) { this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1); super.removeEventListener(type, listener, options) }
}

class FakeEventSource {
  static instances = []
  constructor(url) { this.url = url; this.closed = false; FakeEventSource.instances.push(this) }
  close() { this.closed = true }
  open() { this.onopen?.(new Event('open')) }
  message(type, extra = {}) { this.onmessage?.({ data: JSON.stringify({ type, ...extra }) }) }
}

test('page-bound SSE pauses on pagehide, resumes once on pageshow and permanently closes on terminal events', () => {
  FakeEventSource.instances = []
  const page = new Page()
  const received = []
  let opens = 0; let resumes = 0
  const stream = createPageEventStream('/events', {
    onMessage: event => received.push(JSON.parse(event.data).type),
    onOpen: () => { opens += 1 },
    onResume: () => { resumes += 1 },
    isTerminal: event => JSON.parse(event.data).type === 'auth.expired',
  }, { page, EventSource: FakeEventSource })
  const first = FakeEventSource.instances[0]
  first.open(); first.message('team.updated')
  page.dispatchEvent(new Event('pagehide'))
  assert.equal(first.closed, true)
  first.message('stale')
  page.dispatchEvent(new Event('pagehide'))
  page.dispatchEvent(new Event('pageshow'))
  page.dispatchEvent(new Event('pageshow'))
  assert.equal(FakeEventSource.instances.length, 2, 'duplicate lifecycle events do not create duplicate connections')
  const second = FakeEventSource.instances[1]
  second.open(); second.message('auth.expired')
  assert.deepEqual(received, ['team.updated', 'auth.expired'])
  assert.equal(opens, 2)
  assert.equal(resumes, 1)
  assert.equal(second.closed, true)
  assert.deepEqual([...page.listeners.entries()], [['pagehide', 0], ['pageshow', 0]], 'terminal events remove lifecycle listeners')
  page.dispatchEvent(new Event('pagehide')); page.dispatchEvent(new Event('pageshow'))
  assert.equal(FakeEventSource.instances.length, 2, 'terminal closure cannot reopen on restoration')
  stream.close()
})

test('nonterminal team revocation keeps the aggregate stream alive and manual close removes listeners', () => {
  FakeEventSource.instances = []
  const page = new Page()
  const events = []
  const stream = createPageEventStream('/team-events', {
    onMessage: event => events.push(JSON.parse(event.data)),
    isTerminal: event => JSON.parse(event.data).type === 'auth.expired',
  }, { page, EventSource: FakeEventSource })
  const source = FakeEventSource.instances[0]
  source.message('access.revoked', { teamId: 'one' })
  source.message('team.updated', { teamId: 'two' })
  assert.deepEqual(events.map(event => event.type), ['access.revoked', 'team.updated'])
  assert.equal(source.closed, false)
  stream.close(); stream.close()
  assert.equal(source.closed, true)
  assert.deepEqual([...page.listeners.values()], [0, 0])
  page.dispatchEvent(new Event('pagehide')); page.dispatchEvent(new Event('pageshow'))
  assert.equal(FakeEventSource.instances.length, 1)
})
