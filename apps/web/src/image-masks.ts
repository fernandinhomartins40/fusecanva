export type ImageMaskMode = 'erase' | 'restore'
export type ImageMaskStroke = { mode: ImageMaskMode; size: number; points: number[] }
export type ImageMaskImageRect = { left: number; top: number; width: number; height: number }

/** Render normalized mask coordinates in an SVG viewBox whose scaling stays uniform for the image aspect ratio. */
export function imageMaskPointsToSvgPath(points: number[], imageAspectRatio: number): string {
  if (points.length < 4 || points.length % 2 !== 0 || !Number.isFinite(imageAspectRatio) || imageAspectRatio <= 0) return ''
  const verticalScale = 1 / imageAspectRatio
  return `M ${points[0] * 1000} ${points[1] * 1000 * verticalScale} ${Array.from({ length: points.length / 2 - 1 }, (_, index) => `L ${points[(index + 1) * 2] * 1000} ${points[(index + 1) * 2 + 1] * 1000 * verticalScale}`).join(' ')}`
}

/** Map a screen pointer to normalized image coordinates using the rendered image bounds.
 * The bounds should be measured after layout transforms, so zoom and pan are reflected.
 */
export function screenToNormalizedImagePoint(clientX: number, clientY: number, imageRect: ImageMaskImageRect): [number, number] | null {
  if (![clientX, clientY, imageRect.left, imageRect.top, imageRect.width, imageRect.height].every(Number.isFinite)
    || imageRect.width <= 0 || imageRect.height <= 0) return null
  return [
    Math.max(0, Math.min(1, (clientX - imageRect.left) / imageRect.width)),
    Math.max(0, Math.min(1, (clientY - imageRect.top) / imageRect.height)),
  ]
}

export function createImageMaskFilter(strokes: ImageMaskStroke[], elementWidth: number, elementHeight: number) {
  if (!strokes.length || elementWidth <= 0 || elementHeight <= 0) return null
  return (imageData: ImageData) => {
    const { width, height, data } = imageData
    if (!width || !height) return
    const originalAlpha = new Uint8ClampedArray(width * height)
    for (let pixel = 0; pixel < originalAlpha.length; pixel += 1) originalAlpha[pixel] = data[pixel * 4 + 3]
    for (const stroke of strokes) {
      const points = stroke.points
      if (points.length < 2) continue
      const radiusX = Math.max(.5, stroke.size * width / 2)
      const radiusY = Math.max(.5, stroke.size * elementWidth / elementHeight * height / 2)
      const segmentCount = Math.max(1, (points.length / 2) - 1)
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const startIndex = segment * 2
        const endIndex = Math.min(startIndex + 2, points.length - 2)
        const x1 = points[startIndex] * width, y1 = points[startIndex + 1] * height
        const x2 = points[endIndex] * width, y2 = points[endIndex + 1] * height
        const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radiusX))
        const maxX = Math.min(width - 1, Math.ceil(Math.max(x1, x2) + radiusX))
        const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radiusY))
        const maxY = Math.min(height - 1, Math.ceil(Math.max(y1, y2) + radiusY))
        const dx = x2 - x1, dy = y2 - y1
        const lengthSquared = dx * dx / (radiusX * radiusX) + dy * dy / (radiusY * radiusY)
        for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
          const offsetX = x + .5 - x1, offsetY = y + .5 - y1
          const amount = lengthSquared ? Math.max(0, Math.min(1, (offsetX * dx / (radiusX * radiusX) + offsetY * dy / (radiusY * radiusY)) / lengthSquared)) : 0
          const nearestX = x1 + amount * dx, nearestY = y1 + amount * dy
          const normalizedX = (x + .5 - nearestX) / radiusX, normalizedY = (y + .5 - nearestY) / radiusY
          const signedDistance = (Math.hypot(normalizedX, normalizedY) - 1) * Math.min(radiusX, radiusY)
          const coverage = Math.max(0, Math.min(1, .5 - signedDistance))
          if (!coverage) continue
          const pixel = y * width + x
          const alphaIndex = pixel * 4 + 3
          const original = originalAlpha[pixel]
          data[alphaIndex] = stroke.mode === 'erase'
            ? data[alphaIndex] * (1 - coverage)
            : data[alphaIndex] + (original - data[alphaIndex]) * coverage
        }
      }
    }
  }
}

export function isValidImageMaskStrokes(value: unknown): value is ImageMaskStroke[] {
  return Array.isArray(value) && value.length <= 100 && value.every(stroke => stroke && typeof stroke === 'object'
    && (stroke.mode === 'erase' || stroke.mode === 'restore')
    && typeof stroke.size === 'number' && Number.isFinite(stroke.size) && stroke.size >= .0025 && stroke.size <= .5
    && Array.isArray(stroke.points) && stroke.points.length >= 2 && stroke.points.length <= 2_000 && stroke.points.length % 2 === 0
    && stroke.points.every((point: unknown) => typeof point === 'number' && Number.isFinite(point) && point >= 0 && point <= 1))
}
