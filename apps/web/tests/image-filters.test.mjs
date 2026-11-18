import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('image filters transform pixels deterministically and preserve alpha', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { applyImageFilter, IMAGE_FILTER_PRESETS } = await vite.ssrLoadModule('/src/image-filters.ts')
    assert.deepEqual(IMAGE_FILTER_PRESETS, ['soft', 'vintage', 'mono', 'color-pop', 'duotone'])
    const source = [220, 40, 80, 73]
    const results = new Map()
    for (const preset of IMAGE_FILTER_PRESETS) {
      const data = new Uint8ClampedArray(source)
      applyImageFilter({ data }, preset)
      assert.equal(data[3], 73)
      results.set(preset, [...data.slice(0, 3)])
    }
    assert.equal(results.size, 5)
    assert.equal(new Set([...results.values()].map(rgb => rgb.join(','))).size, 5, 'each preset produces a distinct color transformation')
    const mono = results.get('mono')
    assert.equal(mono[0], mono[1]); assert.equal(mono[1], mono[2])
    const shadow = new Uint8ClampedArray([0, 0, 0, 255])
    applyImageFilter({ data: shadow }, 'duotone')
    assert.deepEqual([...shadow], [31, 43, 92, 255])
    const highlight = new Uint8ClampedArray([255, 255, 255, 255])
    applyImageFilter({ data: highlight }, 'duotone')
    assert.deepEqual([...highlight], [250, 198, 103, 255])
  } finally { await vite.close() }
})

test('image contrast and saturation adjust RGB pixels in a bounded range and preserve alpha', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { applyImageColorAdjustments, createImageColorAdjustmentFilter } = await vite.ssrLoadModule('/src/image-adjustments.ts')
    const neutral = new Uint8ClampedArray([200, 50, 20, 73])
    applyImageColorAdjustments({ data: neutral })
    assert.deepEqual([...neutral], [200, 50, 20, 73], 'zero adjustments leave source pixels unchanged')
    const saturated = new Uint8ClampedArray([200, 50, 20, 73])
    createImageColorAdjustmentFilter(0, 100)({ data: saturated })
    assert.deepEqual([...saturated], [255, 20, 0, 73], 'saturation is increased around luminance and RGB is clamped')
    const flatContrast = new Uint8ClampedArray([20, 120, 240, 91])
    applyImageColorAdjustments({ data: flatContrast }, -100, 0)
    assert.deepEqual([...flatContrast], [128, 128, 128, 91], 'minimum contrast maps RGB to the midpoint without changing alpha')
    assert.equal(createImageColorAdjustmentFilter(0, 0), null, 'neutral adjustment does not install a render filter')
  } finally { await vite.close() }
})

test('automatic image adjustment estimates conservative brightness, contrast, and saturation from visible pixels', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { estimateAutoImageAdjustment } = await vite.ssrLoadModule('/src/image-adjustments.ts')
    const brightGray = new Uint8ClampedArray([250, 250, 250, 255, 248, 248, 248, 255])
    assert.deepEqual(estimateAutoImageAdjustment(brightGray), { brightness: -30, contrast: 0, saturation: 0 })
    const flatColor = new Uint8ClampedArray([180, 60, 20, 255, 185, 65, 25, 255, 190, 70, 30, 255])
    const estimate = estimateAutoImageAdjustment(flatColor)
    assert.ok(estimate.brightness > 0 && estimate.contrast > 0, 'low-mid-level narrow-range pixels receive lift and contrast')
    assert.equal(estimate.saturation, -25, 'strongly saturated pixels are gently reduced')
    assert.equal(estimateAutoImageAdjustment(new Uint8ClampedArray([0, 0, 0, 0])), null, 'transparent pixels do not produce an adjustment')
    assert.equal(estimateAutoImageAdjustment([]), null, 'empty image data safely returns no estimate')
    for (const value of Object.values(estimate)) assert.ok(value >= -100 && value <= 100)
  } finally { await vite.close() }
})

test('manual image masks erase alpha, restore later strokes, and validate bounded normalized paths', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createImageMaskFilter, isValidImageMaskStrokes } = await vite.ssrLoadModule('/src/image-masks.ts')
    const erase = { mode: 'erase', size: .5, points: [.5, .5, .5, .5] }
    const restore = { mode: 'restore', size: .5, points: [.5, .5, .5, .5] }
    const makePixels = () => ({ width: 3, height: 1, data: new Uint8ClampedArray([30, 60, 90, 255, 40, 70, 100, 255, 50, 80, 110, 255]) })
    const erased = makePixels()
    createImageMaskFilter([erase], 100, 100)(erased)
    assert.deepEqual([...erased.data].filter((_, index) => index % 4 === 3), [170, 0, 170], 'eraser keeps partially covered edge pixels antialiased')
    const restored = makePixels()
    createImageMaskFilter([erase, restore], 100, 100)(restored)
    const restoredAlpha = [...restored.data].filter((_, index) => index % 4 === 3)
    assert.equal(restoredAlpha[1], 255, 'fully covered pixels restore their original alpha')
    assert.ok(restoredAlpha[0] > 170 && restoredAlpha[0] < 255, 'partially covered pixels restore softly at the brush edge')
    assert.equal(isValidImageMaskStrokes([erase, restore]), true)
    assert.equal(isValidImageMaskStrokes([{ ...erase, size: .0025 }]), true, 'the smallest slider value remains a valid normalized brush diameter')
    assert.equal(isValidImageMaskStrokes([{ ...erase, points: [1.1, .5] }]), false)
    assert.equal(isValidImageMaskStrokes([{ ...erase, size: .001 }]), false, 'sub-minimum brush diameters are rejected')
    assert.equal(isValidImageMaskStrokes(Array.from({ length: 101 }, () => erase)), false)
  } finally { await vite.close() }
})

test('manual image masks compute one-pixel soft brush coverage at the raster edge', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createImageMaskFilter } = await vite.ssrLoadModule('/src/image-masks.ts')
    const stroke = { mode: 'erase', size: .4, points: [.5, .5, .5, .5] }
    const pixels = { width: 5, height: 5, data: new Uint8ClampedArray(5 * 5 * 4).fill(255) }
    for (let index = 0; index < pixels.data.length; index += 4) pixels.data[index + 3] = 255
    createImageMaskFilter([stroke], 5, 5)(pixels)
    const alphaAt = (x, y) => pixels.data[(y * pixels.width + x) * 4 + 3]
    assert.equal(alphaAt(2, 2), 0, 'the center of the brush is fully erased')
    assert.equal(alphaAt(3, 2), 128, 'a pixel centered on the edge gets half coverage')
    assert.equal(alphaAt(4, 2), 255, 'pixels beyond the antialias transition remain unchanged')
  } finally { await vite.close() }
})

test('manual mask pointer mapping accounts for rendered image zoom and pan', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { screenToNormalizedImagePoint } = await vite.ssrLoadModule('/src/image-masks.ts')
    const zoomedAndPannedImage = { left: 130, top: 75, width: 800, height: 400 }
    assert.deepEqual(screenToNormalizedImagePoint(330, 175, zoomedAndPannedImage), [.25, .25], 'pointer position is normalized against the rendered, translated and scaled image bounds')
    assert.deepEqual(screenToNormalizedImagePoint(930, 375, zoomedAndPannedImage), [1, .75])
    assert.deepEqual(screenToNormalizedImagePoint(100, 25, zoomedAndPannedImage), [0, 0], 'points beyond the panned image clamp to its edge')
    assert.equal(screenToNormalizedImagePoint(130, 75, { ...zoomedAndPannedImage, width: 0 }), null, 'empty image bounds cannot produce mask coordinates')
  } finally { await vite.close() }
})

test('manual mask preview scales normalized path coordinates uniformly for rectangular images', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { imageMaskPointsToSvgPath } = await vite.ssrLoadModule('/src/image-masks.ts')
    assert.equal(imageMaskPointsToSvgPath([.25, .25, .75, .75], 2), 'M 250 125 L 750 375', 'landscape y coordinates scale with the SVG viewBox height')
    assert.equal(imageMaskPointsToSvgPath([.25, .25, .75, .75], .5), 'M 250 500 L 750 1500', 'portrait y coordinates scale with the SVG viewBox height')
    assert.equal(imageMaskPointsToSvgPath([.25, .25, .75, .75], 1), 'M 250 250 L 750 750', 'square images retain the original coordinate mapping')
    assert.equal(imageMaskPointsToSvgPath([.25, .25], 2), '', 'incomplete strokes are not rendered')
    assert.equal(imageMaskPointsToSvgPath([.25, .25, .75, .75], 0), '', 'invalid image aspect ratios are not rendered')
  } finally { await vite.close() }
})
