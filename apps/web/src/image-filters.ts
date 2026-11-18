export const IMAGE_FILTER_PRESETS = ['soft', 'vintage', 'mono', 'color-pop', 'duotone'] as const
export type ImageFilterPreset = typeof IMAGE_FILTER_PRESETS[number]

function clamp(value: number) { return Math.max(0, Math.min(255, value)) }

export function applyImageFilter(imageData: ImageData, preset: ImageFilterPreset) {
  const pixels = imageData.data
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2]
    const luminance = .2126 * red + .7152 * green + .0722 * blue
    let next: [number, number, number]
    if (preset === 'mono') next = [luminance, luminance, luminance]
    else if (preset === 'duotone') {
      const amount = luminance / 255
      next = [31 + (250 - 31) * amount, 43 + (198 - 43) * amount, 92 + (103 - 92) * amount]
    } else if (preset === 'vintage') {
      next = [red * .393 + green * .769 + blue * .189, red * .349 + green * .686 + blue * .168, red * .272 + green * .534 + blue * .131]
      next = next.map(channel => channel * .58 + luminance * .42 + 3) as [number, number, number]
    } else {
      const saturation = preset === 'color-pop' ? 1.55 : .86
      const contrast = preset === 'color-pop' ? 1.1 : .92
      const lift = preset === 'soft' ? 5 : 0
      next = [red, green, blue].map(channel => (luminance + (channel - luminance) * saturation - 128) * contrast + 128 + lift) as [number, number, number]
    }
    pixels[index] = clamp(next[0]); pixels[index + 1] = clamp(next[1]); pixels[index + 2] = clamp(next[2])
  }
}

export function createImageFilter(preset: ImageFilterPreset) {
  return (imageData: ImageData) => applyImageFilter(imageData, preset)
}
