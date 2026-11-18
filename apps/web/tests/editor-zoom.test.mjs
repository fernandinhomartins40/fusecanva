import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

async function loadZoom() {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  return { vite, zoom: await vite.ssrLoadModule('/src/editor-zoom.ts') }
}

test('zoom menu exposes the observed fit choices and percentage presets', async () => {
  const { vite, zoom } = await loadZoom()
  try {
    assert.deepEqual(zoom.EDITOR_ZOOM_OPTIONS.map((option) => option.id), [
      'fit-page', 'fit-editor', 'zoom-300', 'zoom-200', 'zoom-125', 'zoom-100', 'zoom-75', 'zoom-50', 'zoom-25', 'zoom-10',
    ])
    assert.equal(zoom.EDITOR_ZOOM_OPTIONS[0].label, 'Ver inteiro')
    assert.equal(zoom.EDITOR_ZOOM_OPTIONS[1].label, 'Ajustar ao editor')
    assert.deepEqual(zoom.EDITOR_ZOOM_OPTIONS.slice(2).map(({ label }) => label), ['300%', '200%', '125%', '100%', '75%', '50%', '25%', '10%'])
  } finally { await vite.close() }
})

test('preset selection updates the displayed zoom and selected listbox option', async () => {
  const { vite, zoom } = await loadZoom()
  try {
    const initial = zoom.createEditorZoomState(38, 'fit-page')
    const selected = zoom.selectEditorZoomOption(initial, 'zoom-100')
    assert.deepEqual(selected, { mode: 'percentage', percentage: 100 })
    assert.equal(zoom.getEditorZoomDisplayValue(selected), '100%')
    assert.equal(zoom.isEditorZoomOptionSelected(selected, 'zoom-100'), true)
    assert.equal(zoom.isEditorZoomOptionSelected(selected, 'fit-page'), false)
    assert.equal(zoom.isEditorZoomOptionSelected(selected, 'zoom-75'), false)
  } finally { await vite.close() }
})

test('fit modes keep their identity and use caller-calculated viewport percentages', async () => {
  const { vite, zoom } = await loadZoom()
  try {
    const whole = zoom.selectEditorZoomOption(zoom.createEditorZoomState(100), 'fit-page', { fitPage: 54, fitEditor: 81 })
    assert.deepEqual(whole, { mode: 'fit-page', percentage: 54 })
    assert.equal(zoom.getEditorZoomDisplayValue(whole), '54%')
    assert.equal(zoom.isEditorZoomOptionSelected(whole, 'fit-page'), true)
    assert.equal(zoom.isEditorZoomOptionSelected(whole, 'zoom-50'), false)

    const editor = zoom.selectEditorZoomOption(whole, 'fit-editor', { fitPage: 54, fitEditor: 81 })
    assert.deepEqual(editor, { mode: 'fit-editor', percentage: 81 })
    assert.equal(zoom.isEditorZoomOptionSelected(editor, 'fit-editor'), true)
    assert.equal(zoom.isEditorZoomOptionSelected(editor, 'fit-page'), false)
    assert.deepEqual(zoom.selectEditorZoomOption(whole, 'fit-page'), { mode: 'fit-page', percentage: 54 }, 'observed A4 viewport fallback is 54%')
  } finally { await vite.close() }
})

test('zoom values are bounded and invalid selections are rejected', async () => {
  const { vite, zoom } = await loadZoom()
  try {
    assert.equal(zoom.clampEditorZoom(-20), 10)
    assert.equal(zoom.clampEditorZoom(999), 300)
    assert.equal(zoom.createEditorZoomState(Number.NaN).percentage, 100)
    assert.equal(zoom.createEditorZoomState(38, 'fit-page').percentage, 38)
    assert.throws(() => zoom.selectEditorZoomOption(zoom.createEditorZoomState(), 'zoom-37'), RangeError)
  } finally { await vite.close() }
})

test('pinch zoom preserves the world point under a moving midpoint while panning', async () => {
  const { vite, zoom } = await loadZoom()
  try {
    const position = { x: -120, y: 38 }
    const scale = 0.54
    const startMidpoint = { x: 140, y: 320 }
    const currentMidpoint = { x: 180, y: 300 }
    const startDistance = 80
    const currentDistance = 120
    const next = zoom.zoomCanvasAtPinch(position, scale, startMidpoint, startDistance, currentMidpoint, currentDistance)
    const beforeAnchor = { x: (startMidpoint.x - position.x) / scale, y: (startMidpoint.y - position.y) / scale }
    const afterAnchor = { x: (currentMidpoint.x - next.position.x) / next.zoom, y: (currentMidpoint.y - next.position.y) / next.zoom }
    assert.ok(Math.abs(next.zoom - 0.81) < 1e-12)
    assert.ok(Math.abs(beforeAnchor.x - afterAnchor.x) < 1e-9)
    assert.ok(Math.abs(beforeAnchor.y - afterAnchor.y) < 1e-9)
  } finally { await vite.close() }
})

test('pinch zoom clamps to editor or whiteboard bounds and handles a zero-distance gesture', async () => {
  const { vite, zoom } = await loadZoom()
  try {
    const position = { x: 0, y: 0 }
    const center = { x: 120, y: 200 }
    assert.equal(zoom.zoomCanvasAtPinch(position, 2.9, center, 20, center, 80, 0.1, 3).zoom, 3)
    assert.equal(zoom.zoomCanvasAtPinch(position, 0.09, center, 80, center, 10, 0.08, 3).zoom, 0.08)
    assert.deepEqual(zoom.zoomCanvasAtPinch(position, 0.5, center, 0, center, 0).zoom, 0.5)
  } finally { await vite.close() }
})
