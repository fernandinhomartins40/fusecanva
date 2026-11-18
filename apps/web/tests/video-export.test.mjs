import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('video export selects a genuinely supported MP4 or WebM encoder and preserves container identity', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const videoExport = await vite.ssrLoadModule('/src/video-export.ts')
    assert.equal(videoExport.resolveVideoExportMimeType('mp4', true, type => type === 'video/mp4;codecs=avc1.4D401E,mp4a.40.2'), 'video/mp4;codecs=avc1.4D401E,mp4a.40.2')
    assert.equal(videoExport.resolveVideoExportMimeType('mp4', false, type => type.startsWith('video/mp4;codecs=avc1.42E01E')), 'video/mp4;codecs=avc1.42E01E')
    assert.equal(videoExport.resolveVideoExportMimeType('mp4', true, () => false), null, 'an unsupported browser does not receive an MP4 MIME type')
    assert.equal(videoExport.resolveVideoExportMimeType('webm', true, type => type === 'video/webm;codecs=vp8,opus'), 'video/webm;codecs=vp8,opus')
    assert.equal(videoExport.isVideoExportFormatSupported('mp4', false, type => type === 'video/mp4'), true)
    assert.equal(videoExport.isVideoExportFormatSupported('mp4', true, () => false), false)
  } finally { await vite.close() }
})
