import assert from 'node:assert/strict'
import test from 'node:test'
import { deliverInvitationEmail } from '../server/email-provider.mjs'

const invitation = {
  kind: 'team',
  email: 'person@example.test',
  token: 'private-token',
  targetName: 'Design Team <North>',
  inviterName: 'Alex & Sam',
  roleLabel: 'integrante',
}

test('invitation email delivery stays link-only unless a provider is explicitly configured', async () => {
  let called = false
  const result = await deliverInvitationEmail(invitation, { env: {}, fetchImpl: async () => { called = true } })
  assert.deepEqual(result, { status: 'link-only', reason: 'provider-disabled' })
  assert.equal(called, false)
})

test('Resend adapter sends a scoped team-acceptance URL with escaped HTML and no credential leakage', async () => {
  const env = {
    STUDIO_EMAIL_PROVIDER: 'resend',
    STUDIO_EMAIL_API_KEY: 'test-secret',
    STUDIO_EMAIL_FROM: 'Fuse Studio <hello@example.test>',
    STUDIO_PUBLIC_APP_URL: 'https://studio.example.test/workspace?theme=dark',
  }
  let request
  const result = await deliverInvitationEmail(invitation, { env, fetchImpl: async (url, options) => {
    request = { url, options }
    return { ok: true, status: 200 }
  } })
  assert.deepEqual(result, { status: 'sent' })
  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret')
  const body = JSON.parse(request.options.body)
  assert.deepEqual(body.to, ['person@example.test'])
  assert.equal(body.from, env.STUDIO_EMAIL_FROM)
  assert.equal(body.subject, 'Convite para a equipe Design Team <North>')
  assert.match(body.text, /https:\/\/studio\.example\.test\/workspace\?theme=dark&teamInvite=private-token/)
  assert.match(body.html, /Design Team &lt;North&gt;/)
  assert.match(body.html, /Alex &amp; Sam/)
  assert.match(body.html, /href="https:\/\/studio\.example\.test\/workspace\?theme=dark&amp;teamInvite=private-token"/)
  assert.equal(JSON.stringify(result).includes('test-secret'), false)
})

test('document invitations use the invite route and report misconfiguration and provider failures safely', async () => {
  const base = { STUDIO_EMAIL_PROVIDER: 'resend', STUDIO_EMAIL_API_KEY: 'key', STUDIO_EMAIL_FROM: 'hello@example.test', STUDIO_PUBLIC_APP_URL: 'https://studio.example.test' }
  const documentResult = await deliverInvitationEmail({ ...invitation, kind: 'document', targetName: 'Briefing', roleLabel: 'editor' }, {
    env: base,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.match(body.text, /\?invite=private-token/)
      return { ok: true, status: 200 }
    },
  })
  assert.deepEqual(documentResult, { status: 'sent' })
  assert.deepEqual(await deliverInvitationEmail(invitation, { env: { ...base, STUDIO_EMAIL_API_KEY: '' }, fetchImpl: async () => { throw new Error('must not be called') } }), { status: 'failed', reason: 'provider-misconfigured' })
  assert.deepEqual(await deliverInvitationEmail(invitation, { env: base, fetchImpl: async () => ({ ok: false, status: 503 }) }), { status: 'failed', reason: 'provider-rejected' })
  assert.deepEqual(await deliverInvitationEmail(invitation, { env: base, fetchImpl: async () => { throw new Error('network unavailable') } }), { status: 'failed', reason: 'provider-unavailable' })
})
