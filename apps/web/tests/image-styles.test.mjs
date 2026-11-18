import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('local image style approximations are deterministic, distinct, bounded, and preserve alpha', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { applyImageStyle, createImageStyleFilter, IMAGE_STYLE_PRESETS } = await vite.ssrLoadModule('/src/image-styles.ts')
    assert.deepEqual(IMAGE_STYLE_PRESETS, ['recorte', 'gravura', 'rabisco'])
    const input = new Uint8ClampedArray([
      20, 40, 70, 0, 80, 100, 120, 91, 150, 130, 90, 173, 230, 210, 180, 255,
      45, 160, 210, 64, 195, 75, 35, 128, 110, 110, 110, 255, 255, 255, 255, 32,
    ])
    const results = new Map()
    for (const preset of IMAGE_STYLE_PRESETS) {
      const data = new Uint8ClampedArray(input)
      const raster = { data, width: 4, height: 2 }
      assert.equal(applyImageStyle(raster, preset), raster, 'operation mutates and returns the same raster')
      assert.deepEqual([...data].filter((_, i) => i % 4 === 3), [...input].filter((_, i) => i % 4 === 3), 'all alpha bytes remain exact')
      assert.ok([...data].every(Number.isFinite) && [...data].every(channel => channel >= 0 && channel <= 255))
      results.set(preset, [...data])
      const repeated = new Uint8ClampedArray(input)
      createImageStyleFilter(preset)({ data: repeated, width: 4, height: 2 })
      assert.deepEqual([...repeated], [...data], 'repeated invocation gives the same pixels')
    }
    assert.equal(new Set([...results.values()].map(pixels => pixels.join(','))).size, 3, 'each style has a distinguishable treatment')

    const padded = new Uint8ClampedArray([...input, 13, 27, 39, 51])
    applyImageStyle({ data: padded, width: 4, height: 2 }, 'gravura')
    assert.deepEqual([...padded.slice(-4)], [13, 27, 39, 51], 'data after declared raster bounds is untouched')
    assert.throws(() => applyImageStyle({ data: new Uint8ClampedArray(4), width: 2, height: 1 }, 'rabisco'), RangeError)
  } finally { await vite.close() }
})
