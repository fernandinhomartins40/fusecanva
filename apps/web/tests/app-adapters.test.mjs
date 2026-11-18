import test from 'node:test';
import assert from 'node:assert/strict';
import { AppAdapterError, AppAdapterRegistry } from '../src/app-adapters.mjs';

const manifest = {
  id: 'drive-demo', name: 'Drive Demo', provider: 'Local Sandbox',
  requestedCapabilities: ['media.read', 'content.insert'],
};
const fullConsent = { accepted: true, capabilities: ['media.read', 'content.insert'] };
const config = { enabled: true, adapter: 'sandbox-local', allowedCapabilities: ['media.read', 'content.insert'] };

test('missing configuration never runs an adapter action', async () => {
  const registry = new AppAdapterRegistry({});
  await assert.rejects(registry.connect(manifest, fullConsent), { code: 'not-configured' });
  assert.equal(registry.state(manifest.id), 'error');
  await assert.rejects(registry.perform(manifest.id, 'catalog.search', 'photo', {
    consent: fullConsent, capability: 'media.read',
  }), { code: 'not-connected' });
});

test('omitted registry configuration fails closed as an unconfigured adapter', async () => {
  const registry = new AppAdapterRegistry();
  await assert.rejects(registry.connect(manifest, fullConsent), { code: 'not-configured' });
  assert.equal(registry.state(manifest.id), 'error');
});

test('explicit decline records cancelled and performs no action', async () => {
  const registry = new AppAdapterRegistry({ [manifest.id]: config });
  assert.equal(await registry.connect(manifest, { accepted: false, capabilities: [] }), 'cancelled');
  assert.equal(registry.state(manifest.id), 'cancelled');
  await assert.rejects(registry.perform(manifest.id, 'content.insert', {}, {
    consent: { accepted: true, capabilities: ['content.insert'] }, capability: 'content.insert',
  }), { code: 'not-connected' });
});

test('sandbox search is deterministic and an unconfigured capability is denied', async () => {
  const registry = new AppAdapterRegistry({ [manifest.id]: {
    ...config, allowedCapabilities: ['media.read'],
  } });
  assert.equal(await registry.connect(manifest, fullConsent), 'connected');
  const context = { consent: fullConsent, capability: 'media.read' };
  assert.deepEqual(await registry.perform(manifest.id, 'catalog.search', 'photo', context), ['local-photo-sample']);
  assert.deepEqual(await registry.perform(manifest.id, 'catalog.search', 'photo', context), ['local-photo-sample']);
  await assert.rejects(registry.perform(manifest.id, 'content.insert', {}, {
    consent: fullConsent, capability: 'content.insert',
  }), (error) => error instanceof AppAdapterError && error.code === 'capability-denied');
});

test('revocation clears connection and denies subsequent actions', async () => {
  const registry = new AppAdapterRegistry({ [manifest.id]: config });
  await registry.connect(manifest, fullConsent);
  await registry.revoke(manifest.id);
  assert.equal(registry.state(manifest.id), 'disconnected');
  await assert.rejects(registry.perform(manifest.id, 'catalog.search', '', {
    consent: fullConsent, capability: 'media.read',
  }), { code: 'not-connected' });
});
