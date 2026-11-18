import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_CATEGORIES, APPS_AUDIT_COVERAGE, AUDITED_APP_CATEGORIES, DEMO_APPS, MARKETPLACE_APP_CATALOG, buildAppsRoute, filterApps, normalizeCategory, parseAppsRoute } from '../src/apps-catalog.mjs';

test('catalog exposes the twelve audited discovery categories with unique route keys', () => {
  assert.equal(APP_CATEGORIES.length, 12);
  assert.equal(new Set(APP_CATEGORIES.map(({ id }) => id)).size, APP_CATEGORIES.length);
  assert.equal(new Set(APP_CATEGORIES.map(({ route }) => route)).size, APP_CATEGORIES.length);
  assert.equal(APP_CATEGORIES.at(-1).id, 'all-apps');
  assert.equal(APP_CATEGORIES[1].route, 'audio-and-voiceover');
  assert.equal(APP_CATEGORIES[7].route, 'file-and-data');
  assert.equal(buildAppsRoute({ category: 'for-you' }), '/your-apps');
  assert.deepEqual(AUDITED_APP_CATEGORIES, APP_CATEGORIES);
});

test('category filters are deterministic and all-apps/for-you expose the local demo collection', () => {
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'marketing' }).map(({ id }) => id), ['hootsuite', 'qr-codes-dinamicos', 'me-qr-codes', 'youtube', 'dynamic-qr-codes', 'later', 'qr-code-scanner', 'sprout-social']);
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'communication' }).map(({ id }) => id), ['mailchimp']);
  assert.equal(filterApps(DEMO_APPS, { category: 'all-apps' }).length, DEMO_APPS.length);
  assert.equal(filterApps(DEMO_APPS, { category: 'for-you' }).length, DEMO_APPS.length);
  assert.equal(filterApps(DEMO_APPS, { category: 'unknown' }).length, DEMO_APPS.length);
});

test('search normalizes accents, case and whitespace across names, descriptions and tags', () => {
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: '  VIDEO  ' }).map(({ id }) => id), ['youtube']);
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: 'comercio' }).map(({ id }) => id), ['shopify-connect']);
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: 'GIPHY' }).map(({ id }) => id), ['giphy']);
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: 'sem resultado' }), []);
});

test('search matches every word regardless of order and across searchable fields', () => {
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: '  dinâmicos   QR  ' }).map(({ id }) => id), ['qr-codes-dinamicos', 'dynamic-qr-codes']);
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: 'comércio Shopify' }).map(({ id }) => id), ['shopify-connect']);
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: 'qr inexistente' }), []);
});

test('QR search returns the observed local examples in the recorded order', () => {
  assert.deepEqual(filterApps(DEMO_APPS, { category: 'all-apps', query: 'QR Code' }).map(({ name }) => name), ['QR codes dinâmicos', 'ME-QR Codes', 'Dynamic QR Codes', 'QR Code Scanner']);
});

test('name sort is stable by localized title and recommendation metadata remains explicit', () => {
  const sorted = filterApps(DEMO_APPS, { category: 'all-apps', sort: 'name' });
  assert.deepEqual(sorted.map(({ name }) => name), [...sorted.map(({ name }) => name)].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  assert.equal(filterApps(DEMO_APPS)[0].id, 'hootsuite');
  assert.ok(DEMO_APPS.every((app) => app.recommendation.reason && Number.isFinite(app.recommendation.rank)));
});

test('route state parses and serializes category, search and sort with URL encoding', () => {
  const state = parseAppsRoute('https://fuse.invalid/your-apps/video-and-animation?q=ação%20social&sort=name');
  assert.deepEqual(state, { category: 'video-animation', query: 'ação social', sort: 'name' });
  assert.deepEqual(parseAppsRoute('/your-apps/not-a-category'), { category: 'for-you', query: '', sort: 'recommended' });
  assert.equal(buildAppsRoute(state), '/your-apps/video-and-animation?q=a%C3%A7%C3%A3o+social&sort=name');
  assert.equal(buildAppsRoute({}), '/your-apps');
});

test('demo entries cannot be mistaken for installed or connected third-party apps', () => {
  for (const app of DEMO_APPS) {
    assert.equal(app.source, 'audit-example');
    assert.equal(app.catalogStatus, 'demo-only');
    assert.equal(app.integrationStatus, 'not-connected');
    assert.equal(typeof app.provider, 'string');
    assert.ok(app.capabilities.length > 0);
    assert.equal(typeof app.featured, 'boolean');
  }
  assert.equal(MARKETPLACE_APP_CATALOG, DEMO_APPS);
  assert.equal(normalizeCategory('marketing'), 'marketing');
  assert.equal(normalizeCategory('made-up'), 'for-you');
});

test('Apps catalog exposes bounded audit coverage without implying unique integrations', () => {
  assert.deepEqual(APPS_AUDIT_COVERAGE, {
    observedCategoryRoutes: 10,
    listedCardOccurrences: 544,
    normalizedLabels: 457,
    fullScrollInventories: 1,
    allAppsViewportNames: 99,
    uniqueIdentityResolved: false,
  });
  assert.ok(DEMO_APPS.every((app) => app.catalogStatus === 'demo-only' && app.integrationStatus === 'not-connected'));
});
