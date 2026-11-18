import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

function decodePng(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('Input is not a PNG image')
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer[24]
  const colorType = buffer[25]
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`)
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const compressed = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') compressed.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
    if (type === 'IEND') break
  }
  const raw = inflateSync(Buffer.concat(compressed))
  const pixels = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const rowStart = y * stride
    const rawStart = y * (stride + 1) + 1
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawStart + x]
      const left = x >= channels ? pixels[rowStart + x - channels] : 0
      const above = y > 0 ? pixels[rowStart + x - stride] : 0
      const upperLeft = y > 0 && x >= channels ? pixels[rowStart + x - stride - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = above
      else if (filter === 3) predictor = Math.floor((left + above) / 2)
      else if (filter === 4) {
        const p = left + above - upperLeft
        const distances = [Math.abs(p - left), Math.abs(p - above), Math.abs(p - upperLeft)]
        predictor = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? above : upperLeft
      } else if (filter !== 0) throw new Error(`Unsupported PNG row filter ${filter}`)
      pixels[rowStart + x] = (value + predictor) & 0xff
    }
  }
  return { width, height, channels, stride, pixels }
}

const [referencePath, actualPath, rectArg] = process.argv.slice(2)
if (!referencePath || !actualPath) throw new Error('Usage: node scripts/compare-png-region.mjs <reference.png> <actual.png> [x,y,width,height]')
const [reference, actual] = await Promise.all([readFile(referencePath), readFile(actualPath)].map(async promise => decodePng(await promise)))
if (reference.width !== actual.width || reference.height !== actual.height || reference.channels !== actual.channels) throw new Error('Images must have matching dimensions and color channels')
const [x = 0, y = 0, width = reference.width, height = reference.height] = rectArg?.split(',').map(Number) ?? []
if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > reference.width || y + height > reference.height) throw new Error('Comparison region is outside the image bounds')
let absoluteError = 0
let squaredError = 0
let differingPixels = 0
const pixelCount = width * height
for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) {
  let pixelError = 0
  const offset = row * reference.stride + column * reference.channels
  for (let channel = 0; channel < 3; channel += 1) {
    const delta = Math.abs(reference.pixels[offset + channel] - actual.pixels[offset + channel])
    absoluteError += delta
    squaredError += delta * delta
    pixelError += delta
  }
  if (pixelError / 3 > 16) differingPixels += 1
}
const channelCount = pixelCount * 3
console.log(JSON.stringify({ width: reference.width, height: reference.height, region: { x, y, width, height }, meanAbsoluteRgbError: Number((absoluteError / channelCount).toFixed(3)), rootMeanSquareRgbError: Number(Math.sqrt(squaredError / channelCount).toFixed(3)), pixelsOver16RgbErrorPercent: Number((differingPixels / pixelCount * 100).toFixed(2)) }, null, 2))
