import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('raster freehand exports use Konva tension curves with quadratic caps and cubic interior spans', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { freeDrawCurveSegments } = await vite.ssrLoadModule('/src/export.ts')
    assert.deepEqual(freeDrawCurveSegments([0, 0]), [])
    assert.deepEqual(freeDrawCurveSegments([0, 0, 10, 20]), [{ type: 'line', x: 10, y: 20 }], 'Konva bypasses tension for a two-point line')

    assert.deepEqual(freeDrawCurveSegments([0, 0, 10, 20, 30, 0]), [
      { type: 'quadratic', controlX: 5.364056378821345, controlY: 20, x: 10, y: 20 },
      { type: 'quadratic', controlX: 15.864056378821346, controlY: 20, x: 30, y: 0 },
    ])

    const segments = freeDrawCurveSegments([0, 0, 10, 0, 30, 20, 40, 20])
    assert.equal(segments.length, 3)
    assert.deepEqual(segments.map(({ type }) => type), ['quadratic', 'cubic', 'quadratic'])
    assert.deepEqual(segments[1], {
      type: 'cubic',
      control1X: 17.757359312880716,
      control1Y: 5.171572875253809,
      control2X: 22.242640687119284,
      control2Y: 14.828427124746192,
      x: 30,
      y: 20,
    })

    assert.deepEqual(freeDrawCurveSegments([1, 1, 1, 1, 1, 1]), [
      { type: 'quadratic', controlX: 1, controlY: 1, x: 1, y: 1 },
      { type: 'quadratic', controlX: 1, controlY: 1, x: 1, y: 1 },
    ], 'coincident points remain finite, as in Konva')
  } finally { await vite.close() }
})
