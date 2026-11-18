/**
 * Deterministic local approximations for the Recorte, Gravura, and Rabisco
 * style-copy cards. These are intentionally lightweight raster treatments;
 * the original Canva shaders were not exposed during the audit, so these do
 * not claim pixel-level parity with Canva.
 */
export const IMAGE_STYLE_PRESETS = ['recorte', 'gravura', 'rabisco'] as const
export type ImageStylePreset = typeof IMAGE_STYLE_PRESETS[number]

export interface RasterImageData {
  data: Uint8ClampedArray
  width: number
  height: number
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
const luminance = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b

function isValidRaster(image: RasterImageData) {
  return Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height)
    && image.width >= 0 && image.height >= 0
    && image.data instanceof Uint8ClampedArray
    && image.data.length >= image.width * image.height * 4
}

function applyRecorte(r: number, g: number, b: number) {
  const l = luminance(r, g, b)
  // Flatten tonal ranges into paper-like cutout layers while retaining a little hue.
  const level = Math.round(Math.max(0, Math.min(4, (l - 12) / 58)))
  const tone = [24, 75, 132, 194, 244][level]
  const chroma = .28
  return [tone + (r - l) * chroma, tone + (g - l) * chroma, tone + (b - l) * chroma] as const
}

function applyGravura(r: number, g: number, b: number, x: number, y: number) {
  const l = luminance(r, g, b)
  // Engraved ink cross-hatching: darker source regions receive denser parallel marks.
  const hatchA = ((x + y * 2) % 7) < 2
  const hatchB = ((x * 2 - y + 70000) % 11) < 2
  const density = 255 - l
  const ink = (hatchA && density > 52) || (hatchB && density > 142) || l < 34
  const paper = 236 - Math.max(0, 150 - l) * .12
  return ink ? [35, 37, 39] as const : [paper, paper * .975, paper * .91] as const
}

function applyRabisco(r: number, g: number, b: number, x: number, y: number) {
  const l = luminance(r, g, b)
  // Pencil sketch approximation using two broad, offset stroke directions and edge pressure.
  const stroke1 = ((x + y * 3) % 13) < 3
  const stroke2 = ((x * 3 - y * 2 + 130000) % 17) < 3
  const stroke3 = ((x + y * 5 + 260000) % 23) < 2
  const dark = (stroke1 && l < 206) || (stroke2 && l < 146) || (stroke3 && l < 92)
  const graphite = 42 + l * .31
  return dark ? [graphite, graphite * .98, graphite * .95] as const : [248, 247, 244] as const
}

/** Mutates and returns the same raster buffer. Pixels beyond width × height are untouched. */
export function applyImageStyle<T extends RasterImageData>(image: T, preset: ImageStylePreset): T {
  if (!isValidRaster(image)) throw new RangeError('Invalid raster dimensions or pixel buffer')
  const { data, width } = image
  const count = image.width * image.height
  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const next = preset === 'recorte' ? applyRecorte(r, g, b)
      : preset === 'gravura' ? applyGravura(r, g, b, x, y)
        : applyRabisco(r, g, b, x, y)
    data[i] = clamp(next[0]); data[i + 1] = clamp(next[1]); data[i + 2] = clamp(next[2])
    // Keep source transparency exactly as supplied.
  }
  return image
}

/** Creates a callback compatible with canvas/Konva raster filter pipelines. */
export function createImageStyleFilter(preset: ImageStylePreset) {
  return (image: RasterImageData) => applyImageStyle(image, preset)
}
