import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const freeDraw = (points, overrides = {}) => ({
  id: 'stroke-1', type: 'free-draw', name: 'Stroke', x: 12, y: 18,
  width: 30, height: 20, rotation: 0, points, color: '#123456', strokeWidth: 6,
  ...overrides,
})

const documentModel = { width: 200, height: 100 }
const pageFor = element => ({ id: 'page-1', name: 'Page', background: '#fff', elements: [element] })

test('SVG freehand export matches editor tension, model stroke styles, and edge cases', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { renderPageSvg } = await vite.ssrLoadModule('/src/svg-export.ts')
    const curved = await renderPageSvg(documentModel, pageFor(freeDraw([0, 0, 10, 10, 20, 0])))
    assert.match(curved, /<path d="M0 0 Q6\.5 10 10 10 Q13\.5 10 20 0" fill="none" stroke="#123456" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"\/>/)
    assert.doesNotMatch(curved, /<polyline/)

    const straight = await renderPageSvg(documentModel, pageFor(freeDraw([1, 2, 8, 9], { color: '#aabbcc', strokeWidth: 2.5 })))
    assert.match(straight, /d="M1 2 L8 9"[^>]*stroke="#aabbcc"[^>]*stroke-width="2\.5"/)

    const translucent = await renderPageSvg(documentModel, pageFor(freeDraw([1, 2, 8, 9], { opacity: 0.28 })))
    assert.match(translucent, /stroke-opacity="0\.28"/)

    const repeated = await renderPageSvg(documentModel, pageFor(freeDraw([0, 0, 0, 0, 10, 5, 10, 5])))
    assert.match(repeated, /<path d="M0 0 Q0 0 0 0 C3\.5 1\.75 6\.5 3\.25 10 5 Q10 5 10 5"/)
    assert.doesNotMatch(repeated, /NaN|Infinity/)
  } finally {
    await vite.close()
  }
})
