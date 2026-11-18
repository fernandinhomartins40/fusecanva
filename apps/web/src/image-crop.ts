export type NormalizedCrop = { x: number; y: number; width: number; height: number }
export type SourceCrop = { x: number; y: number; width: number; height: number }

export function clampCrop(crop: NormalizedCrop, minimum = 0.02): NormalizedCrop {
  const width = Math.max(minimum, Math.min(1, crop.width))
  const height = Math.max(minimum, Math.min(1, crop.height))
  return {
    x: Math.max(0, Math.min(1 - width, crop.x)),
    y: Math.max(0, Math.min(1 - height, crop.y)),
    width,
    height,
  }
}

export function sourceCropFromNormalized(crop: NormalizedCrop, sourceWidth: number, sourceHeight: number): SourceCrop {
  const rect = clampCrop(crop)
  const x = Math.max(0, Math.min(sourceWidth - 1, Math.round(rect.x * sourceWidth)))
  const y = Math.max(0, Math.min(sourceHeight - 1, Math.round(rect.y * sourceHeight)))
  const width = Math.max(1, Math.min(sourceWidth - x, Math.round(rect.width * sourceWidth)))
  const height = Math.max(1, Math.min(sourceHeight - y, Math.round(rect.height * sourceHeight)))
  return { x, y, width, height }
}

export function normalizedCropFromSource(crop: SourceCrop | null | undefined, sourceWidth: number, sourceHeight: number): NormalizedCrop {
  if (!crop) return { x: 0, y: 0, width: 1, height: 1 }
  return clampCrop({ x: crop.x / sourceWidth, y: crop.y / sourceHeight, width: crop.width / sourceWidth, height: crop.height / sourceHeight })
}
