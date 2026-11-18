import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppServer } from '../server/index.mjs'

const ORIGIN = 'http://127.0.0.1:5173'

async function startApi(options = {}) {
  const server = createAppServer({ databasePath: ':memory:', allowedOrigins: [ORIGIN], ...options })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    server,
    async request(path, { method = 'GET', body, cookie } = {}) {
      const headers = { origin: ORIGIN }
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (cookie) headers.cookie = cookie
      const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: response.status, payload: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
    },
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

async function registerAndLogin(api, email) {
  const registered = await api.request('/api/auth/register', { method: 'POST', body: { name: 'Recovery Test', email, password: 'original-password-123' } })
  assert.equal(registered.status, 201)
  const loggedIn = await api.request('/api/auth/login', { method: 'POST', body: { email, password: 'original-password-123' } })
  assert.equal(loggedIn.status, 200)
  return loggedIn.cookie
}

test('password reset requests avoid account enumeration and use only the injected email adapter', async () => {
  const deliveries = []
  const api = await startApi({ passwordResetEmailSender: async message => { deliveries.push(message); return { status: 'sent' } } })
  try {
    await registerAndLogin(api, 'recovery@example.test')
    const known = await api.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'recovery@example.test' } })
    const unknown = await api.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'missing@example.test' } })
    assert.equal(known.status, 202)
    assert.deepEqual(known.payload, unknown.payload)
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0].email, 'recovery@example.test')
    assert.equal(deliveries[0].name, 'Recovery Test')
    assert.match(deliveries[0].token, /^[A-Za-z0-9_-]{40,}$/)
    assert.equal('token' in known.payload, false)
  } finally { await api.close() }
})

test('password reset replaces the password once and revokes existing sessions', async () => {
  let delivery
  const api = await startApi({ passwordResetEmailSender: async message => { delivery = message; return { status: 'link-only' } } })
  try {
    const oldCookie = await registerAndLogin(api, 'reset-once@example.test')
    await api.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'reset-once@example.test' } })
    assert.ok(delivery?.token)
    const changed = await api.request('/api/auth/password-reset/complete', { method: 'POST', body: { token: delivery.token, password: 'replacement-password-456' } })
    assert.equal(changed.status, 200)
    assert.equal((await api.request('/api/auth/me', { cookie: oldCookie })).status, 401)
    assert.equal((await api.request('/api/auth/login', { method: 'POST', body: { email: 'reset-once@example.test', password: 'original-password-123' } })).status, 401)
    const newLogin = await api.request('/api/auth/login', { method: 'POST', body: { email: 'reset-once@example.test', password: 'replacement-password-456' } })
    assert.equal(newLogin.status, 200)
    const replay = await api.request('/api/auth/password-reset/complete', { method: 'POST', body: { token: delivery.token, password: 'another-password-789' } })
    assert.equal(replay.status, 400)
  } finally { await api.close() }
})

test('a newer password reset invalidates older links and enforces password bounds', async () => {
  const deliveries = []
  const api = await startApi({ passwordResetEmailSender: async message => { deliveries.push(message); return { status: 'sent' } } })
  try {
    await registerAndLogin(api, 'reset-replace@example.test')
    await api.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'reset-replace@example.test' } })
    await api.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'reset-replace@example.test' } })
    assert.equal(deliveries.length, 2)
    assert.notEqual(deliveries[0].token, deliveries[1].token)
    const shortPassword = await api.request('/api/auth/password-reset/complete', { method: 'POST', body: { token: deliveries[1].token, password: 'short' } })
    assert.equal(shortPassword.status, 400)
    const staleLink = await api.request('/api/auth/password-reset/complete', { method: 'POST', body: { token: deliveries[0].token, password: 'valid-password-123' } })
    assert.equal(staleLink.status, 400)
    const currentLink = await api.request('/api/auth/password-reset/complete', { method: 'POST', body: { token: deliveries[1].token, password: 'valid-password-123' } })
    assert.equal(currentLink.status, 200)
  } finally { await api.close() }
})
