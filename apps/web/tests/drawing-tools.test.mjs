import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createServer } from 'vite'

let tools
let renderPageSvg
let vite

before(async () => {
  vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  tools = await vite.ssrLoadModule('/src/drawing-tools.ts')
  ;({ renderPageSvg } = await vite.ssrLoadModule('/src/svg-export.ts'))
})

after(async () => { await vite?.close() })

function stroke(overrides = {}) {
  return { id: 'stroke-1', type: 'free-draw', name: 'Test stroke', x: 10, y: 20, width: 30, height: 1, rotation: 0, points: [0, 0, 30, 0], color: '#123456', strokeWidth: 2, ...overrides }
}

test('drawing subtool labels map to stable width, opacity and eraser behavior', () => {
  assert.deepEqual(tools.getDrawingToolStyle('Lápis', '#E7191F', 4), { color: '#e7191f', strokeWidth: 2, opacity: 0.82, eraser: false })
  assert.deepEqual(tools.getDrawingToolStyle('Caneta', '#abc', 4), { color: '#aabbcc', strokeWidth: 4, opacity: 1, eraser: false })
  assert.deepEqual(tools.getDrawingToolStyle('Marcador', '#112233', 4), { color: '#112233', strokeWidth: 12, opacity: 0.28, eraser: false })
  assert.deepEqual(tools.getDrawingToolStyle('Borracha', '#112233', 4), { color: '#7867e8', strokeWidth: 12, opacity: 0.35, eraser: true })
})

test('drawing style clamps size and falls back to a safe hex color', () => {
  assert.deepEqual(tools.getDrawingToolStyle('Caneta', 'red', 100), { color: '#e7191f', strokeWidth: 40, opacity: 1, eraser: false })
  assert.equal(tools.getDrawingToolStyle('Marcador', '#abc', 0).strokeWidth, 3)
  assert.equal(tools.getDrawingToolStyle('Caneta', '#abcdef', Number.NaN).strokeWidth, 4)
  assert.equal(tools.normalizeDrawingColor(' #AbC '), '#aabbcc')
})

test('eraser finds crossed, close and thick free-draw strokes but ignores shapes and distant strokes', () => {
  const elements = [
    stroke(),
    stroke({ id: 'shape-1', type: 'shape' }),
    stroke({ id: 'distant', y: 80 }),
    stroke({ id: 'nearby', y: 25 }),
    stroke({ id: 'thick', y: 29, strokeWidth: 10 }),
  ]
  assert.deepEqual(tools.findFreeDrawElementsIntersectingPath(elements, [25, 5, 25, 24], 4), ['stroke-1', 'nearby', 'thick'])
})

test('eraser collision preserves rotated free-draw element geometry', () => {
  const rotated = stroke({ id: 'rotated', x: 10, y: 10, width: 20, height: 1, rotation: 90, points: [0, 0, 20, 0] })
  const hitAtRotatedPath = tools.findFreeDrawElementsIntersectingPath([rotated], [20.5, 2, 20.5, 19], 1)
  const missAtOriginalPath = tools.findFreeDrawElementsIntersectingPath([rotated], [10, 30, 30, 30], 1)
  assert.deepEqual(hitAtRotatedPath, ['rotated'])
  assert.deepEqual(missAtOriginalPath, [])
})

test('eraser rejects malformed paths and non-positive widths without deleting anything', () => {
  const elements = [stroke()]
  assert.deepEqual(tools.findFreeDrawElementsIntersectingPath(elements, [10, 20, Number.NaN, 20], 4), [])
  assert.deepEqual(tools.findFreeDrawElementsIntersectingPath(elements, [10, 20, 20], 4), [])
  assert.deepEqual(tools.findFreeDrawElementsIntersectingPath(elements, [10, 20, 20, 20], 0), [])
})

test('eraser splits only the crossed portion of a straight stroke and preserves model style', () => {
  const source = stroke({ x: 0, y: 20, width: 100, points: [0, 0, 100, 0], color: '#123456', strokeWidth: 2, opacity: 0.4 })
  const result = tools.eraseFreeDrawElements([source], [50, 15, 50, 25], 6, (_sourceId, index) => `fragment-${index}`)
  assert.deepEqual(result.changedIds, ['stroke-1'])
  assert.equal(result.fragments.length, 2)
  assert.deepEqual(result.replacements.map(replacement => [replacement.sourceId, replacement.fragments.map(fragment => fragment.id)]), [['stroke-1', ['fragment-0', 'fragment-1']]])
  assert.deepEqual(result.fragments.map(fragment => ({ id: fragment.id, x: fragment.x, width: fragment.width, points: fragment.points })), [
    { id: 'fragment-0', x: 0, width: 46, points: [0, 0, 46, 0] },
    { id: 'fragment-1', x: 54, width: 46, points: [0, 0, 46, 0] },
  ])
  for (const fragment of result.fragments) {
    assert.equal(fragment.type, 'free-draw')
    assert.equal(fragment.rotation, 0)
    assert.equal(fragment.color, '#123456')
    assert.equal(fragment.strokeWidth, 2)
    assert.equal(fragment.opacity, 0.4)
    assert.equal(fragment.points.length % 2, 0)
    assert.ok(fragment.points.every(Number.isFinite))
  }
})

test('eraser makes multiple local cuts without discarding untouched polyline segments', () => {
  const source = stroke({ x: 0, y: 0, width: 120, height: 1, points: [0, 0, 40, 0, 80, 0, 120, 0] })
  const result = tools.eraseFreeDrawElements([source], [30, -5, 30, 5, 90, 5, 90, -5], 4, (_id, index) => `piece-${index}`)
  assert.deepEqual(result.changedIds, ['stroke-1'])
  assert.equal(result.fragments.length, 3)
  const extents = result.fragments.map(fragment => [fragment.x, fragment.x + Math.max(...fragment.points.filter((_, index) => index % 2 === 0))])
  assert.ok(extents[0][0] === 0 && extents[0][1] < 30)
  assert.ok(extents[1][0] > 30 && extents[1][1] < 90)
  assert.ok(extents[2][0] > 90 && Math.abs(extents[2][1] - 120) < 1e-8)
})

test('rotated strokes split in page coordinates while preserving their rendered untouched geometry', () => {
  const rotated = stroke({ x: 10, y: 10, width: 20, height: 1, rotation: 90, points: [0, 0, 20, 0], strokeWidth: 2 })
  const result = tools.eraseFreeDrawElements([rotated], [10, 10, 30, 10], 4, (_id, index) => `rotated-piece-${index}`)
  assert.deepEqual(result.changedIds, ['stroke-1'])
  assert.equal(result.fragments.length, 2)
  assert.ok(result.fragments.every(fragment => fragment.rotation === 0), 'replacement strokes are normalized into editable page coordinates')
  const extents = result.fragments.map(fragment => {
    const xs = fragment.points.filter((_, index) => index % 2 === 0).map(x => fragment.x + x)
    const ys = fragment.points.filter((_, index) => index % 2 === 1).map(y => fragment.y + y)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  })
  assert.ok(extents.every(extent => Math.abs(extent.minX - 20.5) < 1e-8 && Math.abs(extent.maxX - 20.5) < 1e-8))
  assert.ok(extents[0].maxY < 7.01)
  assert.ok(extents[1].minY > 12.99)
  assert.ok(Math.abs(extents[0].minY - 0.5) < 1e-8)
  assert.ok(Math.abs(extents[1].maxY - 20.5) < 1e-8)
})

test('erasing a degenerate point removes only that mark and leaves distant degenerate marks unchanged', () => {
  const dot = stroke({ x: 10, y: 10, width: 1, height: 1, points: [0, 0, 0, 0] })
  const erased = tools.eraseFreeDrawElements([dot], [10, 10], 4, () => 'dot-fragment')
  assert.deepEqual(erased.changedIds, ['stroke-1'])
  assert.deepEqual(erased.fragments, [])
  assert.deepEqual(erased.replacements, [{ sourceId: 'stroke-1', fragments: [] }])
  const missed = tools.eraseFreeDrawElements([dot], [30, 30], 4, () => 'dot-fragment')
  assert.deepEqual(missed, { changedIds: [], fragments: [], replacements: [] })
})

test('partial erasure output remains valid editable SVG free-draw content', async () => {
  const source = stroke({ x: 0, y: 20, width: 100, points: [0, 0, 100, 0], color: '#123456', strokeWidth: 2, opacity: 0.4 })
  const { fragments } = tools.eraseFreeDrawElements([source], [50, 15, 50, 25], 6, (_id, index) => `svg-fragment-${index}`)
  const svg = await renderPageSvg(
    { id: 'drawing-doc', name: 'Drawing', type: 'design', width: 120, height: 60, pages: [] },
    { id: 'drawing-page', name: 'Page', background: '#fff', elements: fragments },
  )
  assert.equal((svg.match(/<path /g) ?? []).length, 2)
  assert.equal((svg.match(/stroke="#123456"/g) ?? []).length, 2)
  assert.equal((svg.match(/stroke-opacity="0.4"/g) ?? []).length, 2)
  assert.match(svg, /translate\(0 20\)/)
  assert.match(svg, /translate\(54 20\)/)
})
