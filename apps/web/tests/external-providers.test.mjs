import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createExternalProviderClients, isPublicProviderAddress } from '../server/external-providers.mjs'

test('external provider configuration requires HTTPS endpoint and server token without contacting services', () => {
  let calls = 0
  const fetchStub = async () => { calls++; throw new Error('unexpected fetch') }
  const providers = createExternalProviderClients({
    SITE_PUBLISHER_URL: 'https://publisher.example.test/deploy',
    PRINT_CHECKOUT_URL: 'https://127.0.0.1/session',
    PRINT_CHECKOUT_TOKEN: 'test-secret',
  }, fetchStub)

  assert.equal(providers.sitePublisher, null, 'a URL without its token leaves publication disabled')
  assert.equal(providers.printCheckoutProvider, null, 'HTTP endpoints are rejected even with a token')
  assert.deepEqual(providers.status.sitePublication, { configured: false, missing: ['SITE_PUBLISHER_TOKEN'] })
  assert.deepEqual(providers.status.printCheckout, { configured: false, missing: ['PRINT_CHECKOUT_URL (HTTPS URL to a public host required)'] })
  assert.equal(calls, 0)
})

test('provider targets reject loopback, private, and link-local addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.3', '172.16.0.1', '192.168.1.20', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicProviderAddress(address), false, `${address} must be rejected`)
  }
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicProviderAddress(address), true, `${address} is a public test address`)
})

test('environment example documents each provider as optional and server-only', () => {
  const sample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  for (const name of ['SITE_PUBLISHER_URL', 'SITE_PUBLISHER_TOKEN', 'PRINT_CHECKOUT_URL', 'PRINT_CHECKOUT_TOKEN']) {
    assert.match(sample, new RegExp(`^# ${name}=$`, 'm'), `${name} is documented but unset`)
    assert.doesNotMatch(sample, new RegExp(`^${name}=`, 'm'), `${name} stays disabled in the example`)
  }
  assert.match(sample, /server-side environment/)
  assert.match(sample, /Endpoints must use HTTPS and resolve only to public addresses/)
})

test('configured providers use an injected request transport and keep credentials out of status', async () => {
  const calls = []
  const providers = createExternalProviderClients({
    SITE_PUBLISHER_URL: 'https://publisher.example.test/deploy',
    SITE_PUBLISHER_TOKEN: 'site-secret-for-test',
    PRINT_CHECKOUT_URL: 'https://checkout.example.test/session',
    PRINT_CHECKOUT_TOKEN: 'print-secret-for-test',
  }, async (url, token, payload) => {
    calls.push({ url, token, payload })
    return url.includes('publisher') ? { url: 'https://sites.example.test/demo', deploymentId: 'deploy-1' } : { checkoutUrl: 'https://pay.example.test/session-1', sessionId: 'session-1' }
  })

  assert.deepEqual(providers.status, {
    sitePublication: { configured: true, missing: [] },
    printCheckout: { configured: true, missing: [] },
  })
  assert.equal(JSON.stringify(providers.status).includes('secret'), false)
  assert.deepEqual(await providers.sitePublisher.publish({ documentId: 'site-1', slug: 'demo', site: { pages: [] } }), { url: 'https://sites.example.test/demo', deploymentId: 'deploy-1' })
  assert.deepEqual(await providers.printCheckoutProvider.createCheckout({ documentId: 'design-1', product: 'business-card', options: {}, document: {} }), { checkoutUrl: 'https://pay.example.test/session-1', sessionId: 'session-1' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].token, 'site-secret-for-test')
  assert.equal(calls[1].token, 'print-secret-for-test')
  assert.equal(calls[0].url, 'https://publisher.example.test/deploy')
  assert.equal(calls[1].url, 'https://checkout.example.test/session')
})
