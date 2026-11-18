import { GIFEncoder, applyPalette, quantize, type GifPalette } from 'gifenc'

export interface GifRasterFrame {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  /** Delay in milliseconds. GIF stores delays in 10 ms units. */
  delayMs?: number
}

export interface GifExportOptions {
  /** 0 repeats forever, -1 plays once, a positive value is the repeat count. */
  repeat?: number
  /** Total palette colors, including a transparency entry when used. */
  maxColors?: number
  /** Alpha values at or below this threshold become transparent. Default: 127. */
  alphaThreshold?: number
  /** Maximum sampled source pixels used to build a shared animation palette. */
  paletteSampleLimit?: number
  /** Optional abort signal checked between encoded frames. */
  signal?: AbortSignal
  /** Called after each frame is encoded. */
  onProgress?: (completed: number, total: number) => void
}

const GIF_MAX_DIMENSION = 65_535
const DEFAULT_PALETTE_SAMPLE_LIMIT = 120_000
const MAX_PALETTE_SAMPLE_LIMIT = 1_000_000

function assertFrame(frame: GifRasterFrame, index: number) {
  if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height)
    || frame.width < 1 || frame.height < 1
    || frame.width > GIF_MAX_DIMENSION || frame.height > GIF_MAX_DIMENSION) {
    throw new RangeError(`GIF frame ${index + 1} has invalid dimensions`)
  }
  const pixelCount = frame.width * frame.height
  if (!Number.isSafeInteger(pixelCount) || frame.data.length !== pixelCount * 4) {
    throw new RangeError(`GIF frame ${index + 1} must contain exactly width × height × 4 RGBA bytes`)
  }
}

function alignedFrameData(frame: GifRasterFrame): Uint8Array | Uint8ClampedArray {
  // gifenc treats the supplied view's entire backing ArrayBuffer as pixel data.
  // Copy only subviews so unrelated bytes outside the frame cannot be encoded.
  return frame.data.byteOffset === 0 && frame.data.byteLength === frame.data.buffer.byteLength
    ? frame.data
    : frame.data.slice()
}

function paletteFrameData(frame: GifRasterFrame, transparent: boolean, alphaThreshold: number) {
  const data = alignedFrameData(frame)
  if (!transparent) return data

  // GIF transparency is binary. Normalize alpha before nearest-palette lookup
  // so the threshold used to construct the palette is also used per frame.
  const normalized = new Uint8Array(data)
  for (let offset = 0; offset < normalized.length; offset += 4) {
    if (normalized[offset + 3] <= alphaThreshold) {
      normalized[offset] = 0
      normalized[offset + 1] = 0
      normalized[offset + 2] = 0
      normalized[offset + 3] = 0
    } else {
      normalized[offset + 3] = 255
    }
  }
  return normalized
}

function sampleAnimationPixels(frames: readonly GifRasterFrame[], limit: number): Uint8Array {
  const framePixelCount = frames[0].width * frames[0].height
  const totalPixels = framePixelCount * frames.length
  const sampleCount = Math.min(totalPixels, limit)
  const samples = new Uint8Array(sampleCount * 4)
  // Spread samples across the entire animation so the shared palette does not
  // overfit only to the first frame.
  const stride = Math.max(1, Math.floor(totalPixels / sampleCount))
  let outputIndex = 0
  for (let sourcePixel = 0; sourcePixel < totalPixels && outputIndex < sampleCount; sourcePixel += stride) {
    const frameIndex = Math.floor(sourcePixel / framePixelCount)
    const pixelIndex = sourcePixel % framePixelCount
    const sourceOffset = pixelIndex * 4
    const targetOffset = outputIndex * 4
    samples[targetOffset] = frames[frameIndex].data[sourceOffset]
    samples[targetOffset + 1] = frames[frameIndex].data[sourceOffset + 1]
    samples[targetOffset + 2] = frames[frameIndex].data[sourceOffset + 2]
    samples[targetOffset + 3] = frames[frameIndex].data[sourceOffset + 3]
    outputIndex++
  }
  return outputIndex === sampleCount ? samples : samples.subarray(0, outputIndex * 4)
}

function containsTransparentPixel(frames: readonly GifRasterFrame[], alphaThreshold: number) {
  for (const frame of frames) {
    for (let alphaOffset = 3; alphaOffset < frame.data.length; alphaOffset += 4) {
      if (frame.data[alphaOffset] <= alphaThreshold) return true
    }
  }
  return false
}

function makePalette(frames: readonly GifRasterFrame[], options: Required<Pick<GifExportOptions, 'maxColors' | 'alphaThreshold' | 'paletteSampleLimit'>>): GifPalette {
  const sample = sampleAnimationPixels(frames, options.paletteSampleLimit)
  const hasTransparency = containsTransparentPixel(frames, options.alphaThreshold)
  if (!hasTransparency) return quantize(sample, options.maxColors, { format: 'rgb565' })

  // Sampling may skip isolated transparent pixels, so reserve the transparent
  // entry explicitly in the shared palette sample.
  sample[0] = 0
  sample[1] = 0
  sample[2] = 0
  sample[3] = 0

  return quantize(sample, options.maxColors, {
    format: 'rgba4444',
    oneBitAlpha: options.alphaThreshold,
    clearAlpha: true,
    clearAlphaThreshold: options.alphaThreshold,
    clearAlphaColor: 0,
  })
}

function findTransparentIndex(palette: GifPalette): number | null {
  const index = palette.findIndex(color => color.length > 3 && color[3] < 128)
  return index < 0 ? null : index
}

/**
 * Encode same-sized RGBA frames into an animated GIF using a shared palette.
 * The output is local and synchronous per frame; a task yield occurs between
 * frames so the caller can show progress or cancel large exports.
 */
export async function encodeGif(frames: readonly GifRasterFrame[], options: GifExportOptions = {}): Promise<Uint8Array> {
  if (frames.length === 0) throw new RangeError('A GIF needs at least one frame')
  if (frames.length > 1000) throw new RangeError('A GIF cannot exceed 1000 frames')

  const width = frames[0].width
  const height = frames[0].height
  frames.forEach((frame, index) => {
    assertFrame(frame, index)
    if (frame.width !== width || frame.height !== height) throw new RangeError('All GIF frames must have the same dimensions')
    if (frame.delayMs !== undefined && (!Number.isFinite(frame.delayMs) || frame.delayMs < 0)) throw new RangeError(`GIF frame ${index + 1} has an invalid delay`)
  })

  const maxColors = options.maxColors ?? 256
  const alphaThreshold = options.alphaThreshold ?? 127
  const paletteSampleLimit = options.paletteSampleLimit ?? DEFAULT_PALETTE_SAMPLE_LIMIT
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 256) throw new RangeError('maxColors must be an integer from 2 to 256')
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) throw new RangeError('alphaThreshold must be an integer from 0 to 255')
  if (!Number.isSafeInteger(paletteSampleLimit) || paletteSampleLimit < 1) throw new RangeError('paletteSampleLimit must be a positive safe integer')
  if (paletteSampleLimit > MAX_PALETTE_SAMPLE_LIMIT) throw new RangeError(`paletteSampleLimit cannot exceed ${MAX_PALETTE_SAMPLE_LIMIT}`)
  if (options.repeat !== undefined && (!Number.isInteger(options.repeat) || options.repeat < -1 || options.repeat > 65_535)) throw new RangeError('repeat must be -1 or an integer from 0 to 65535')
  for (const [index, frame] of frames.entries()) {
    if (frame.delayMs !== undefined && frame.delayMs > 655_350) throw new RangeError(`GIF frame ${index + 1} delay cannot exceed 655350 ms`)
  }

  const palette = makePalette(frames, { maxColors, alphaThreshold, paletteSampleLimit })
  const transparentIndex = findTransparentIndex(palette)
  const paletteFormat = palette.some(color => color.length > 3) ? 'rgba4444' : 'rgb565'
  const gif = GIFEncoder()

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    if (options.signal?.aborted) throw new DOMException('GIF export cancelled', 'AbortError')
    const frame = frames[frameIndex]
    const pixels = paletteFrameData(frame, transparentIndex !== null, alphaThreshold)
    const indexes = applyPalette(pixels, palette, paletteFormat)
    const isFirst = frameIndex === 0
    gif.writeFrame(indexes, width, height, {
      ...(isFirst ? { palette, repeat: options.repeat ?? 0 } : {}),
      delay: frame.delayMs ?? 100,
      ...(transparentIndex === null ? {} : { transparent: true, transparentIndex }),
      dispose: transparentIndex === null ? 1 : 2,
    })
    options.onProgress?.(frameIndex + 1, frames.length)
    if (frameIndex + 1 < frames.length) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }

  gif.finish()
  return gif.bytes()
}
