import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

function textContext() {
  return { font: '', measureText: text => ({ width: [...text].length * 8 }) }
}

test('SVG export preserves safe text hyperlinks and excludes unsupported protocols', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => ({ getContext: () => textContext() }) }
  try {
    const { renderPageSvg } = await vite.ssrLoadModule('/src/svg-export.ts')
    const documentModel = { id: 'doc', name: 'Site & Co', type: 'design', width: 320, height: 180, pages: [] }
    const page = { id: 'page', name: 'Page <A>', background: '#fff', elements: [
      { id: 'safe', type: 'text', name: 'CTA & More', x: 10, y: 20, width: 200, height: 40, rotation: 0, text: 'Open', href: 'https://example.com/?a=1&b=2', fontSize: 18, fontFamily: 'Arial', color: '#123456', bold: true },
      { id: 'unsafe', type: 'text', name: 'Bad link', x: 10, y: 80, width: 200, height: 40, rotation: 0, text: 'Ignore', href: 'javascript:alert(1)', fontSize: 18, fontFamily: 'Arial', color: '#123456', bold: false },
    ] }
    const svg = await renderPageSvg(documentModel, page)
    assert.match(svg, /<title id="svg-title">Site &amp; Co — Page &lt;A&gt;<\/title>/, 'SVG exposes an escaped document/page title')
    assert.match(svg, /<desc id="svg-description">2 design elements and 0 connectors\.<\/desc>/)
    assert.match(svg, /role="group" aria-label="CTA &amp; More"/, 'named elements retain accessible labels')
    assert.match(svg, /<a href="https:\/\/example\.com\/\?a=1&amp;b=2" xlink:href="https:\/\/example\.com\/\?a=1&amp;b=2">/)
    assert.match(svg, /<text[^>]*>Open<\/text>/)
    assert.doesNotMatch(svg, /javascript:/i)
    assert.equal((svg.match(/<a /g) ?? []).length, 1)
  } finally {
    globalThis.document = previousDocument
    await vite.close()
  }
})

test('SVG text export preserves letter spacing and line spacing when wrapping text', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => ({ getContext: () => textContext() }) }
  try {
    const { renderPageSvg } = await vite.ssrLoadModule('/src/svg-export.ts')
    const documentModel = { id: 'doc', name: 'Typography', type: 'design', width: 320, height: 180, pages: [] }
    const page = { id: 'page', name: 'Page', background: '#fff', elements: [
      { id: 'spaced', type: 'text', name: 'Spaced text', x: 10, y: 20, width: 45, height: 30, rotation: 0, text: 'AB CD', fontSize: 10, fontFamily: 'Arial', color: '#123456', bold: false, kerning: 2, lineSpacing: 1.5 },
    ] }
    const svg = await renderPageSvg(documentModel, page)
    const textNodes = [...svg.matchAll(/<text\b([^>]*)>(.*?)<\/text>/g)]
    assert.equal(textNodes.length, 2, 'letter spacing is included when the exporter decides where text wraps')
    assert.match(textNodes[0][1], /letter-spacing="2"/, 'the first SVG line carries the model letter spacing')
    assert.match(textNodes[1][1], /letter-spacing="2"/, 'the second SVG line carries the model letter spacing')
    assert.match(textNodes[1][1], /y="15"/, 'the SVG line baseline uses the saved 1.5 line-spacing multiplier')
    assert.deepEqual(textNodes.map(match => match[2]), ['AB', 'CD'])
  } finally {
    globalThis.document = previousDocument
    await vite.close()
  }
})

test('SVG embeds image alpha, flips and rotation from their model properties', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const previousDocument = globalThis.document
  const previousImage = globalThis.Image
  const calls = []
  const alphaValues = []
  let globalAlpha = 1
  const alphaStack = []
  const context = {
    get globalAlpha() { return globalAlpha },
    set globalAlpha(value) { globalAlpha = value; alphaValues.push(value) },
    filter: 'none',
    save: () => alphaStack.push(globalAlpha),
    restore: () => { globalAlpha = alphaStack.pop() },
    scale: (...args) => calls.push(['scale', ...args]),
    translate: (...args) => calls.push(['translate', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
  }
  class TestImage {
    async decode() {}
    set src(value) { this.source = value }
  }
  globalThis.Image = TestImage
  globalThis.document = { createElement: () => ({ getContext: () => context, toDataURL: () => 'data:image/png;base64,ZmFrZQ==' }) }
  try {
    const { renderPageSvg } = await vite.ssrLoadModule('/src/svg-export.ts')
    const documentModel = { id: 'doc', name: 'Canvas', type: 'design', width: 200, height: 120, pages: [] }
    const image = { id: 'portrait', type: 'image', name: 'Portrait', src: 'data:image/png;base64,c291cmNl', x: 10, y: 20, width: 80, height: 40, rotation: 45, opacity: 35, flipX: true, flipY: true }
    const svg = await renderPageSvg(documentModel, { id: 'page', name: 'Page', background: '#fff', elements: [image] })
    assert.ok(alphaValues.includes(0.35), 'opacity is applied before the PNG is embedded')
    assert.ok(calls.some(call => call[0] === 'translate' && call[1] === 80 && call[2] === 40), 'both flips translate around the image bounds')
    assert.ok(calls.some(call => call[0] === 'scale' && call[1] === -1 && call[2] === -1), 'both flips are applied to raster content')
    assert.match(svg, /rotate\(45 40 20\)/, 'the image rotation stays as an SVG transform')
    assert.match(svg, /href="data:image\/png;base64,ZmFrZQ=="/)
    assert.match(svg, /role="img" aria-label="Portrait"/, 'non-decorative images use their layer name when no alternative text is set')

    const decorative = { ...image, id: 'background', name: 'Background', decorative: true }
    const decorativeSvg = await renderPageSvg(documentModel, { id: 'decorative-page', name: 'Page', background: '#fff', elements: [decorative] })
    assert.match(decorativeSvg, /aria-hidden="true"/, 'decorative images are omitted from the accessible object tree')
    assert.doesNotMatch(decorativeSvg, /role="img" aria-label="Background"/)
  } finally {
    globalThis.document = previousDocument
    globalThis.Image = previousImage
    await vite.close()
  }
})
