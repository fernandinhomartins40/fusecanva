import assert from 'node:assert/strict'
import test from 'node:test'
import { deliverPasswordResetEmail } from '../server/email-provider.mjs'

const reset = { email: 'person@example.test', name: 'A & B', token: 'opaque-token', expiresAt: '2026-10-27T12:30:00.000Z' }
const env = { STUDIO_EMAIL_PROVIDER: 'resend', STUDIO_EMAIL_API_KEY: 'test-secret', STUDIO_EMAIL_FROM: 'Studio <hello@example.test>', STUDIO_PUBLIC_APP_URL: 'https://studio.example.test/' }

test('password reset email remains disabled without an explicit provider', async () => {
  let called = false
  const result = await deliverPasswordResetEmail(reset, { env: {}, fetchImpl: async () => { called = true } })
  assert.deepEqual(result, { status: 'link-only', reason: 'provider-disabled' })
  assert.equal(called, false)
})

test('configured password reset email sends a one-time token link with escaped HTML', async () => {
  let request
  const result = await deliverPasswordResetEmail(reset, { env, fetchImpl: async (url, options) => { request = { url, ...options }; return { ok: true } } })
  assert.deepEqual(result, { status: 'sent' })
  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.equal(request.headers.Authorization, 'Bearer test-secret')
  const body = JSON.parse(request.body)
  assert.deepEqual(body.to, ['person@example.test'])
  assert.match(body.text, /resetPassword=opaque-token/)
  assert.match(body.html, /resetPassword=opaque-token/)
  assert.match(body.html, /A &amp; B/)
  assert.match(body.html, /30 minutos/)
  assert.doesNotMatch(JSON.stringify(body), /test-secret/)
})

test('password reset email reports provider failure without leaking exception details', async () => {
  const result = await deliverPasswordResetEmail(reset, { env, fetchImpl: async () => { throw new Error('provider secret detail') } })
  assert.deepEqual(result, { status: 'failed', reason: 'provider-unavailable' })
})
