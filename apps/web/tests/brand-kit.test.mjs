import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAuditedBrandPalette, applyAuditedBrandTypography, AUDITED_BRAND_PALETTE, BRAND_KITS, createBrandTitleElement } from '../src/brand-kit.mjs'

test('brand kit exposes the audited lab identity and resource categories', () => {
  assert.equal(BRAND_KITS.find(kit => kit.id === 'rea-laboratory').name, 'REA — Laboratório Marca')
  assert.equal(BRAND_KITS.find(kit => kit.id === 'rea-laboratory').resources.length, 6)
})

test('audited palette changes modeled fills and text colors without changing structure or geometry', () => {
  const elements = [
    { id: 'text', type: 'text', text: 'Olá', color: '#b29365', x: 2, y: 3, width: 80, height: 20 },
    { id: 'shape', type: 'shape', fill: '#B29365', x: 8, y: 9, width: 10, height: 11 },
    { id: 'accent', type: 'shape', fill: '#75511c', x: 9, y: 10, width: 10, height: 11 },
    { id: 'image', type: 'image', src: 'data:image/png;base64,AA==', x: 1, y: 2, width: 5, height: 6 },
  ]
  const next = applyAuditedBrandPalette(elements)
  assert.deepEqual(next.map(({ id, type, x, y, width, height }) => ({ id, type, x, y, width, height })), elements.map(({ id, type, x, y, width, height }) => ({ id, type, x, y, width, height })))
  assert.equal(next[0].color, '#2d4a6f')
  assert.equal(next[1].fill, '#2d4a6f')
  assert.equal(next[2].fill, '#123456')
  assert.equal(next[3].src, elements[3].src)
  assert.equal(AUDITED_BRAND_PALETTE.scope, 'one-laboratory-application')
})

test('brand title uses the observed content, weight and 32pt-equivalent size', () => {
  const title = createBrandTitleElement({ id: 'title-1', x: 3, y: 4 })
  assert.deepEqual([title.id, title.text, title.bold, title.fontSize, title.x, title.y], ['title-1', 'Inserir um título', true, 42.6667, 3, 4])
})

test('brand typography applies only to selected text and preserves text content and geometry', () => {
  const elements = [
    { id: 'text-a', type: 'text', text: 'Keep this copy', x: 11, y: 12, width: 240, height: 44, rotation: 7, fontSize: 18, fontFamily: 'Georgia', color: '#334455', bold: false },
    { id: 'shape', type: 'shape', fill: '#abc', x: 1, y: 2, width: 30, height: 40 },
    { id: 'text-b', type: 'text', text: 'Leave unselected', fontSize: 21, fontFamily: 'Arial', color: '#123', bold: false },
  ]
  const next = applyAuditedBrandTypography(elements, ['text-a'])
  assert.deepEqual(next[0], { ...elements[0], fontSize: 42.6667, fontFamily: 'Arial', color: '#000000', bold: true })
  assert.deepEqual(next[1], elements[1])
  assert.deepEqual(next[2], elements[2])
  assert.deepEqual(elements[0], { id: 'text-a', type: 'text', text: 'Keep this copy', x: 11, y: 12, width: 240, height: 44, rotation: 7, fontSize: 18, fontFamily: 'Georgia', color: '#334455', bold: false })
})
