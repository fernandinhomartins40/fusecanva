import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createServer } from 'vite'

let navigation
let vite

before(async () => {
  vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  navigation = await vite.ssrLoadModule('/src/canvas-navigation.ts')
})

after(async () => { await vite?.close() })

const items = [{ id: 'back' }, { id: 'middle' }, { id: 'front' }]

test('canvas layer keyboard navigation uses order, boundaries, and valid fallback', () => {
  assert.equal(navigation.getCanvasNavigationTarget(items, 'middle', 'ArrowDown'), items[2])
  assert.equal(navigation.getCanvasNavigationTarget(items, 'middle', 'ArrowUp'), items[0])
  assert.equal(navigation.getCanvasNavigationTarget(items, 'middle', 'Home'), items[0])
  assert.equal(navigation.getCanvasNavigationTarget(items, 'middle', 'End'), items[2])
  assert.equal(navigation.getCanvasNavigationTarget(items, 'front', 'ArrowDown'), items[2])
  assert.equal(navigation.getCanvasNavigationTarget(items, 'back', 'ArrowUp'), items[0])
  assert.equal(navigation.getCanvasNavigationTarget(items, null, 'ArrowDown'), items[0])
  assert.equal(navigation.getCanvasNavigationTarget(items, 'missing', 'ArrowUp'), items[2])
  assert.equal(navigation.getCanvasNavigationTarget([], null, 'Home'), null)
})

test('accessible canvas labels expose text and image alternatives with bounded announcements', () => {
  const base = { id: 'object-1', name: 'Objeto', x: 0, y: 0, width: 100, height: 40, rotation: 0 }
  assert.deepEqual(navigation.toAccessibleCanvasObject({ ...base, type: 'text', text: '  Olá\n mundo  ', fontSize: 20, fontFamily: 'Arial', color: '#000000', bold: false }), {
    id: 'object-1', name: 'Objeto', kind: 'text', ariaLabel: 'Objeto, texto: Olá mundo',
  })
  assert.equal(navigation.toAccessibleCanvasObject({ ...base, type: 'image', src: 'data:image/png;base64,AA==', altText: 'Praia ao pôr do sol' }).ariaLabel, 'Objeto, texto alternativo: Praia ao pôr do sol')
  assert.equal(navigation.toAccessibleCanvasObject({ ...base, type: 'image', src: '', decorative: true }).ariaLabel, 'Objeto, imagem decorativa')
  assert.equal(navigation.toAccessibleCanvasObject({ ...base, type: 'image', src: '' }).ariaLabel, 'Objeto, imagem sem texto alternativo')
  assert.ok(navigation.toAccessibleCanvasObject({ ...base, type: 'text', text: 'a'.repeat(400), fontSize: 20, fontFamily: 'Arial', color: '#000000', bold: false }).ariaLabel.length < 140)
})
