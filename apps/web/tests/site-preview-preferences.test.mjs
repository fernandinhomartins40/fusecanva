import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('site preview viewport and mobile-fit preferences persist independently per document', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const preferences = await vite.ssrLoadModule('/src/site-preview-preferences.ts')
    const values = new Map([['fuse-site-mobile-fit:legacy-site', 'false']])
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    }

    assert.deepEqual(preferences.readSitePreviewPreferences('site-a', storage), { viewportMode: 'desktop', mobileFit: true })
    preferences.persistSitePreviewViewport('site-a', 'mobile', storage)
    preferences.persistSitePreviewMobileFit('site-a', false, storage)
    assert.deepEqual(preferences.readSitePreviewPreferences('site-a', storage), { viewportMode: 'mobile', mobileFit: false })
    assert.deepEqual(preferences.readSitePreviewPreferences('site-b', storage), { viewportMode: 'desktop', mobileFit: true })
    assert.deepEqual(preferences.readSitePreviewPreferences('legacy-site', storage), { viewportMode: 'desktop', mobileFit: false }, 'existing mobile-fit preference key remains compatible')
    assert.equal(values.get('fuse-site-preview-viewport:site-a'), 'mobile')
    assert.equal(values.get('fuse-site-mobile-fit:site-a'), 'false')
  } finally {
    await vite.close()
  }
})

test('site preview preferences fall back safely when local storage is unavailable', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const preferences = await vite.ssrLoadModule('/src/site-preview-preferences.ts')
    const blockedStorage = {
      getItem() { throw new Error('storage blocked') },
      setItem() { throw new Error('storage blocked') },
    }
    assert.deepEqual(preferences.readSitePreviewPreferences('site-a', blockedStorage), { viewportMode: 'desktop', mobileFit: true })
    assert.doesNotThrow(() => preferences.persistSitePreviewViewport('site-a', 'mobile', blockedStorage))
    assert.doesNotThrow(() => preferences.persistSitePreviewMobileFit('site-a', false, blockedStorage))
  } finally {
    await vite.close()
  }
})
