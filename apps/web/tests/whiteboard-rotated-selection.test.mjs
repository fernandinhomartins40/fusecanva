import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const shape = (overrides = {}) => ({
  id: 'shape-1',
  type: 'shape',
  name: 'Retângulo',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  rotation: 0,
  fill: '#fff',
  cornerRadius: 0,
  ...overrides,
})

test('whiteboard marquee selection follows rotated element geometry, including edge contact and degenerate frames', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const board = await vite.ssrLoadModule('/src/whiteboard.ts')
    const rotated = shape({ x: 0, y: 40, rotation: 45 })

    // The rotated bar reaches below its unrotated frame, so a marquee there must find it.
    assert.deepEqual(board.elementsIntersectingRect([rotated], { x: 76, y: 76, width: 4, height: 4 }), ['shape-1'])
    // This point is inside the old axis-aligned frame but outside the rotated bar itself.
    assert.deepEqual(board.elementsIntersectingRect([rotated], { x: 6, y: 48, width: 4, height: 4 }), [])

    const axisAligned = shape({ width: 10, height: 10 })
    assert.deepEqual(board.elementsIntersectingRect([axisAligned], { x: 10, y: 4, width: 0, height: 2 }), ['shape-1'], 'touching edges count as an intersection')

    const lineFrame = shape({ x: 0, y: 0, width: 100, height: 0, rotation: 45 })
    assert.deepEqual(board.elementsIntersectingRect([lineFrame], { x: 61, y: 11, width: 4, height: 4 }), ['shape-1'], 'a zero-height element can still be hit')
    assert.deepEqual(board.elementsIntersectingRect([lineFrame], { x: 4, y: 45, width: 2, height: 2 }), [], 'the line frame does not behave like its full unrotated box')

    assert.deepEqual(board.elementsIntersectingRect([shape({ x: Number.NaN })], { x: 0, y: 0, width: 10, height: 10 }), [], 'invalid geometry is ignored instead of poisoning marquee results')
  } finally {
    await vite.close()
  }
})
