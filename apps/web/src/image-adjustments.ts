export function applyImageColorAdjustments(imageData: ImageData, contrast = 0, saturation = 0) {
  const contrastFactor = 1 + Math.max(-100, Math.min(100, contrast)) / 100
  const saturationFactor = 1 + Math.max(-100, Math.min(100, saturation)) / 100
  if (contrastFactor === 1 && saturationFactor === 1) return
  const pixels = imageData.data
  for (let index = 0; index < pixels.length; index += 4) {
    let red = (pixels[index] - 127.5) * contrastFactor + 127.5
    let green = (pixels[index + 1] - 127.5) * contrastFactor + 127.5
    let blue = (pixels[index + 2] - 127.5) * contrastFactor + 127.5
    if (saturationFactor !== 1) {
      const luminance = .2126 * red + .7152 * green + .0722 * blue
      red = luminance + (red - luminance) * saturationFactor
      green = luminance + (green - luminance) * saturationFactor
      blue = luminance + (blue - luminance) * saturationFactor
    }
    pixels[index] = Math.max(0, Math.min(255, red))
    pixels[index + 1] = Math.max(0, Math.min(255, green))
    pixels[index + 2] = Math.max(0, Math.min(255, blue))
  }
}

export function createImageColorAdjustmentFilter(contrast: number, saturation: number) {
  if (contrast === 0 && saturation === 0) return null
  return (imageData: ImageData) => applyImageColorAdjustments(imageData, contrast, saturation)
}

export type AutoImageAdjustment = { brightness: number; contrast: number; saturation: number }

/** Estimate a conservative local enhancement from a bounded sample of decoded image pixels. */
export function estimateAutoImageAdjustment(data: ArrayLike<number>): AutoImageAdjustment | null {
  if (data.length < 4) return null
  const histogram = new Uint32Array(256)
  let count = 0
  let saturationTotal = 0
  let colorCount = 0
  for (let index = 0; index + 3 < data.length; index += 4) {
    const alpha = Number(data[index + 3])
    if (!Number.isFinite(alpha) || alpha < 16) continue
    const red = Number(data[index]), green = Number(data[index + 1]), blue = Number(data[index + 2])
    if (![red, green, blue].every(Number.isFinite)) continue
    const luminance = Math.max(0, Math.min(255, Math.round(.2126 * red + .7152 * green + .0722 * blue)))
    histogram[luminance] += 1
    count += 1
    const maximum = Math.max(red, green, blue)
    if (maximum > 24) {
      saturationTotal += (maximum - Math.min(red, green, blue)) / maximum
      colorCount += 1
    }
  }
  if (!count) return null
  const percentile = (fraction: number) => {
    const target = Math.max(0, Math.ceil(count * fraction) - 1)
    let seen = 0
    for (let value = 0; value < histogram.length; value += 1) {
      seen += histogram[value]
      if (seen > target) return value
    }
    return 255
  }
  const low = percentile(.02)
  const median = percentile(.5)
  const high = percentile(.98)
  const spread = high - low
  const contrastFactor = spread > 2 ? Math.max(.75, Math.min(1.4, 220 / spread)) : 1
  const contrast = Math.round((contrastFactor - 1) * 100)
  const correctedMedian = 127.5 + (median - 127.5) * (1 + contrast / 100)
  const brightness = Math.round(Math.max(-30, Math.min(30, (132 / Math.max(40, correctedMedian) - 1) * 100)))
  const meanSaturation = colorCount ? saturationTotal / colorCount : 0
  const saturation = meanSaturation < .08
    ? 0
    : Math.round(Math.max(-25, Math.min(30, (.32 / meanSaturation - 1) * 100)))
  return { brightness, contrast, saturation }
}
