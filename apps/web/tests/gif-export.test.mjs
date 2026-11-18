import assert from 'node:assert/strict'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { createServer } from 'vite'

let vite
let encodeGif

before(async () => {
  vite = await createServer({
    configFile: './vite.config.ts',
    resolve: { alias: { gifenc: path.resolve('node_modules/gifenc/dist/gifenc.esm.js') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
  ;({ encodeGif } = await vite.ssrLoadModule('/src/gif-export.ts'))
})

after(async () => { await vite?.close() })

function parseGif(bytes) {
  const data = Buffer.from(bytes)
  assert.equal(data.toString('ascii', 0, 6), 'GIF89a')
  const width = data.readUInt16LE(6)
  const height = data.readUInt16LE(8)
  const packed = data[10]
  let offset = 13
  if (packed & 0x80) offset += 3 * (2 << (packed & 0x07))
  const frames = []
  const controls = []
  const applicationExtensions = []
  let trailer = false

  const readSubBlocks = () => {
    const chunks = []
    while (offset < data.length) {
      const size = data[offset++]
      if (size === 0) break
      chunks.push(data.subarray(offset, offset + size))
      offset += size
    }
    return Buffer.concat(chunks)
  }

  while (offset < data.length) {
    const marker = data[offset++]
    if (marker === 0x3b) { trailer = true; break }
    if (marker === 0x21) {
      const label = data[offset++]
      if (label === 0xf9) {
        const size = data[offset++]
        assert.equal(size, 4)
        const flags = data[offset++]
        const delayCentiseconds = data.readUInt16LE(offset)
        offset += 2
        const transparentIndex = data[offset++]
        assert.equal(data[offset++], 0)
        controls.push({ flags, delayCentiseconds, transparentIndex })
      } else if (label === 0xff) {
        const size = data[offset++]
        const identifier = data.toString('ascii', offset, offset + size)
        offset += size
        applicationExtensions.push({ identifier, payload: readSubBlocks() })
      } else {
        if (label === 0x01) offset += data[offset] + 1
        readSubBlocks()
      }
      continue
    }
    if (marker === 0x2c) {
      const x = data.readUInt16LE(offset)
      const y = data.readUInt16LE(offset + 2)
      const frameWidth = data.readUInt16LE(offset + 4)
      const frameHeight = data.readUInt16LE(offset + 6)
      const descriptorFlags = data[offset + 8]
      offset += 9
      if (descriptorFlags & 0x80) offset += 3 * (2 << (descriptorFlags & 0x07))
      offset += 1 // LZW minimum code size
      readSubBlocks()
      frames.push({ x, y, width: frameWidth, height: frameHeight })
      continue
    }
    throw new Error(`Unexpected GIF block marker 0x${marker.toString(16)} at ${offset - 1}`)
  }
  return { width, height, frames, controls, applicationExtensions, trailer }
}

function rgbaFrame(colors, delayMs) {
  return { width: colors.length, height: 1, data: new Uint8ClampedArray(colors.flat()), delayMs }
}

test('GIF encoder writes GIF89a animation frames, loop, delays, and binary transparency', async () => {
  const progress = []
  const bytes = await encodeGif([
    rgbaFrame([[255, 0, 0, 255], [0, 0, 0, 0]], 80),
    rgbaFrame([[0, 255, 0, 255], [0, 0, 0, 0]], 120),
  ], { repeat: 0, onProgress: (completed, total) => progress.push([completed, total]) })
  const gif = parseGif(bytes)

  assert.deepEqual([gif.width, gif.height], [2, 1])
  assert.equal(gif.frames.length, 2)
  assert.deepEqual(gif.frames.map(frame => [frame.x, frame.y, frame.width, frame.height]), [[0, 0, 2, 1], [0, 0, 2, 1]])
  assert.deepEqual(gif.controls.map(control => control.delayCentiseconds), [8, 12])
  assert.ok(gif.controls.every(control => control.flags & 0x01), 'each frame declares a transparent palette index')
  assert.ok(gif.applicationExtensions.some(extension => extension.identifier === 'NETSCAPE2.0' && extension.payload.equals(Buffer.from([1, 0, 0]))), 'repeat=0 loops forever')
  assert.equal(gif.trailer, true)
  assert.deepEqual(progress, [[1, 2], [2, 2]])
})

test('GIF encoder rejects frame geometry mismatches and honors cancellation', async () => {
  const first = rgbaFrame([[255, 0, 0, 255]], 100)
  const second = { ...rgbaFrame([[0, 255, 0, 255], [0, 0, 255, 255]], 100), height: 1 }
  await assert.rejects(() => encodeGif([first, second]), /same dimensions/)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => encodeGif([first], { signal: controller.signal }), error => error?.name === 'AbortError')
})
