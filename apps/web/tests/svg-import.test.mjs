import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('SVG import accepts a safe vector subset and derives dimensions from viewBox', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { sanitizeImportedSvg } = await vite.ssrLoadModule('/src/svg-import.ts')
    const result = sanitizeImportedSvg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><path d="M1 2 L20 14" fill="none" stroke="#123456" stroke-width="2" /></svg>')
    assert.equal(result.width, 24)
    assert.equal(result.height, 16)
    assert.match(result.dataUrl, /^data:image\/svg\+xml;charset=utf-8,/)
    assert.match(decodeURIComponent(result.dataUrl.split(',')[1]), /<path d="M1 2 L20 14"/)
  } finally { await vite.close() }
})

test('SVG import preserves common editable stroke styles and validated transform lists', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { sanitizeImportedSvg } = await vite.ssrLoadModule('/src/svg-import.ts')
    const source = '<svg width="120" height="80"><g transform="translate(4 5) rotate(15,10,10) scale(.5), skewX(2)" vector-effect="non-scaling-stroke"><path d="M0 0 C10 0 10 20 20 20" fill="none" stroke="#123456" stroke-width="2" stroke-dasharray="4 2" stroke-dashoffset="-1" stroke-miterlimit="4" shape-rendering="geometricPrecision" /></g></svg>'
    const result = sanitizeImportedSvg(source)
    const imported = decodeURIComponent(result.dataUrl.split(',')[1])
    assert.match(imported, /transform="translate\(4 5\) rotate\(15,10,10\) scale\(\.5\), skewX\(2\)"/)
    assert.match(imported, /stroke-dasharray="4 2"/)
    assert.match(imported, /stroke-dashoffset="-1"/)
    assert.match(imported, /vector-effect="non-scaling-stroke"/)
  } finally { await vite.close() }
})

test('SVG import rejects active content, external references, unsupported elements, and invalid dimensions', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { sanitizeImportedSvg } = await vite.ssrLoadModule('/src/svg-import.ts')
    for (const svg of [
      '<svg width="10" height="10"><script>alert(1)</script></svg>',
      '<svg width="10" height="10" onload="alert(1)"><path d="M0 0"/></svg>',
      '<svg width="10" height="10"><image href="https://example.com/x.png"/></svg>',
      '<svg width="10" height="10"><path d="M0 0" fill="url(https://example.com/x)"/></svg>',
      '<svg width="10" height="10"><text>unsafe subset</text></svg>',
      '<svg width="10%" height="10%"><path d="M0 0"/></svg>',
      '<svg width="10" height="10"><path transform="translate(1) scale(NaN)" d="M0 0"/></svg>',
      '<svg width="10" height="10"><path transform="matrix(1,0,0,1,2)" d="M0 0"/></svg>',
      '<svg width="10" height="10"><path stroke-dasharray="2, nope" d="M0 0"/></svg>',
    ]) assert.throws(() => sanitizeImportedSvg(svg))
  } finally { await vite.close() }
})

test('SVG import enforces its markup size bound', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { sanitizeImportedSvg } = await vite.ssrLoadModule('/src/svg-import.ts')
    assert.throws(() => sanitizeImportedSvg(`<svg width="1" height="1">${'x'.repeat(10 * 1024 * 1024)}</svg>`), /10 MB/)
  } finally { await vite.close() }
})
