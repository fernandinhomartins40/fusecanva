import test from 'node:test'
import assert from 'node:assert/strict'
import { upscaleDimensions, validateDreamLabImage } from '../src/dream-lab.mjs'

const valid = { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', mimeType: 'image/svg+xml', width: 512, height: 512, mode: 'sandbox' }

test('Dream Lab validates supported provider and sandbox images', () => {
  assert.equal(validateDreamLabImage(valid), valid)
  assert.throws(() => validateDreamLabImage({ ...valid, dataUrl: 'https://example.test/image.png' }), /inválido/)
  assert.throws(() => validateDreamLabImage({ ...valid, mimeType: 'image/gif' }), /não é compatível/)
  assert.throws(() => validateDreamLabImage({ ...valid, width: 12001 }), /limites/)
})

test('local upscale dimensions are capped at 2×, 16 megapixels and 12000px edges', () => {
  assert.deepEqual(upscaleDimensions(512, 512), { width: 1024, height: 1024, scale: 2 })
  const large = upscaleDimensions(3000, 3000)
  assert.ok(large.width * large.height <= 16_000_000)
  assert.ok(large.width <= 12000 && large.height <= 12000)
  assert.throws(() => upscaleDimensions(12000, 12000), /limite de resolução/)
  assert.throws(() => upscaleDimensions(10, 10, 4), /até 2×/)
})
