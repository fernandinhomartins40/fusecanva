import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

test('text kerning and line spacing survive model snapshots and affect PNG rendering', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const drawn = []
  const positions = []
  const ctx = {
    fillStyle: '', textBaseline: '', globalAlpha: 1, filter: 'none',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, setLineDash() {},
    measureText: text => ({ width: [...text].length * 8 }),
    fillText(text, x, y) { drawn.push(text); positions.push([text, x, y]) },
  }
  Object.defineProperty(ctx, 'font', { configurable: true, get: () => '', set: () => {} })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } })
  try {
    const exporter = await vite.ssrLoadModule('/src/export.ts')
    const { patchSelectedTextTypography } = await vite.ssrLoadModule('/src/model.ts')
    const selectedPatch = patchSelectedTextTypography([
      { id: 'one', type: 'text', text: 'A', kerning: 0, lineSpacing: 1.2 },
      { id: 'two', type: 'text', text: 'B', kerning: 0, lineSpacing: 1.2 },
      { id: 'shape', type: 'shape', fill: '#fff' },
    ], ['one', 'shape'], { kerning: 1.5, lineSpacing: 1.8 })
    assert.deepEqual(selectedPatch.map(element => element.kerning ?? null), [1.5, 0, null])
    assert.equal(selectedPatch[0].lineSpacing, 1.8)
    assert.equal(selectedPatch[1].lineSpacing, 1.2)
    assert.equal(selectedPatch[2].fill, '#fff')
    const text = { id: 't1', type: 'text', name: 'Título', text: 'AB\nCD', x: 10, y: 10, width: 200, height: 100, rotation: 0, fontSize: 20, fontFamily: 'Arial', color: '#000', bold: false, kerning: 2, lineSpacing: 1.75 }
    const doc = { id: 'd1', name: 'Teste', type: 'design', width: 320, height: 240, updatedAt: '', pages: [{ id: 'p1', name: 'Página 1', background: '#fff', elements: [text] }] }
    const normalized = structuredClone(doc)
    assert.equal(normalized.pages[0].elements[0].kerning, 2)
    assert.equal(normalized.pages[0].elements[0].lineSpacing, 1.75)
    await exporter.renderPageCanvas(normalized, normalized.pages[0])
    assert.deepEqual(drawn, ['A B', 'C D'])
    assert.equal(positions[1][2] - positions[0][2], 35)
    const legacy = { ...text }
    delete legacy.kerning
    delete legacy.lineSpacing
    drawn.length = 0
    positions.length = 0
    const legacyPage = { ...normalized.pages[0], elements: [legacy] }
    await exporter.renderPageCanvas(normalized, legacyPage)
    assert.deepEqual(drawn, ['AB', 'CD'])
    assert.equal(positions[1][2] - positions[0][2], 24)
  } finally {
    await vite.close()
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
  }
})
