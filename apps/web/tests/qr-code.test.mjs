import assert from 'node:assert/strict'
import test from 'node:test'
import jsQR from 'jsqr'
import { createServer } from 'vite'

test('QR destination produces a standards-sized matrix with finder patterns', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createQrMatrix } = await vite.ssrLoadModule('/src/qr-code.ts')
    const matrix = createQrMatrix('https://example.com/campaign?source=board')
    assert.ok(matrix)
    assert.ok(matrix.size >= 21)
    assert.equal(matrix.data.length, matrix.size * matrix.size)
    for (const [offsetX, offsetY] of [[0, 0], [matrix.size - 7, 0], [0, matrix.size - 7]]) {
      const finder = (x, y) => matrix.data[(offsetY + y) * matrix.size + offsetX + x]
      assert.deepEqual(Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => finder(x, y))), [
        [1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1],
        [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1],
      ])
    }
    assert.equal(createQrMatrix(''), null)
    const scale = 8, quiet = 4, pixels = (matrix.size + quiet * 2) * scale
    const rgba = new Uint8ClampedArray(pixels * pixels * 4)
    for (let y = 0; y < pixels; y += 1) for (let x = 0; x < pixels; x += 1) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < matrix.size && my < matrix.size && matrix.data[my * matrix.size + mx] === 1
      const offset = (y * pixels + x) * 4
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = dark ? 0 : 255
      rgba[offset + 3] = 255
    }
    assert.equal(jsQR(rgba, pixels, pixels, { inversionAttempts: 'dontInvert' })?.data, 'https://example.com/campaign?source=board')
  } finally { await vite.close() }
})

test('QR SVG export includes quiet zone, destination matrix, and persisted colors', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { qrSvg } = await vite.ssrLoadModule('/src/qr-code.ts')
    const element = { type: 'shape', shape: 'rect', id: 'qr-1', name: 'QR', x: 20, y: 30, width: 240, height: 240, rotation: 0, fill: '#fff', cornerRadius: 0, qrConfig: { url: 'https://example.com', pattern: 'blocks', foreground: '#111111', background: '#fefefe', logo: 'none', corner: 0 } }
    const svg = qrSvg(element)
    assert.match(svg, /viewBox="0 0 37 37"/)
    assert.match(svg, /fill="#111111"/)
    assert.match(svg, /fill="#fefefe"/)
    assert.match(svg, /translate\(4 4\)/)
    assert.match(svg, /<path/)
  } finally { await vite.close() }
})
