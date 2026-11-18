import { createId, type FreeDrawElement } from './model'

export type DrawingTool = 'Lápis' | 'Caneta' | 'Marcador' | 'Borracha'

export type DrawingToolStyle = {
  color: string
  strokeWidth: number
  opacity: number
  eraser: boolean
}

const DEFAULT_COLOR = '#e7191f'

export function normalizeDrawingColor(color: string): string {
  const value = color.trim()
  const short = value.match(/^#([\da-f])([\da-f])([\da-f])$/i)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  const full = value.match(/^#([\da-f]{6})$/i)
  return full ? `#${full[1].toLowerCase()}` : DEFAULT_COLOR
}

export function getDrawingToolStyle(tool: DrawingTool, color: string, size: number): DrawingToolStyle {
  const normalizedColor = normalizeDrawingColor(color)
  const normalizedSize = Number.isFinite(size) ? Math.min(40, Math.max(1, size)) : 4
  switch (tool) {
    case 'Lápis':
      return { color: normalizedColor, strokeWidth: Math.max(1, normalizedSize * 0.5), opacity: 0.82, eraser: false }
    case 'Caneta':
      return { color: normalizedColor, strokeWidth: normalizedSize, opacity: 1, eraser: false }
    case 'Marcador':
      return { color: normalizedColor, strokeWidth: normalizedSize * 3, opacity: 0.28, eraser: false }
    case 'Borracha':
      return { color: '#7867e8', strokeWidth: normalizedSize * 3, opacity: 0.35, eraser: true }
  }
}

type Point = { x: number; y: number }

function worldPoint(element: FreeDrawElement, localX: number, localY: number): Point {
  const rotation = Number.isFinite(element.rotation) ? element.rotation * Math.PI / 180 : 0
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const dx = localX - element.width / 2
  const dy = localY - element.height / 2
  return {
    x: centerX + dx * Math.cos(rotation) - dy * Math.sin(rotation),
    y: centerY + dx * Math.sin(rotation) + dy * Math.cos(rotation),
  }
}

function pointsFromFlat(values: number[]): Point[] {
  const points: Point[] = []
  for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] })
  return points
}

type Interval = [number, number]

const EPSILON = 1e-9

function intersectIntervals(first: Interval | null, second: Interval | null): Interval | null {
  if (!first || !second) return null
  const start = Math.max(first[0], second[0])
  const end = Math.min(first[1], second[1])
  return start <= end + EPSILON ? [Math.max(0, start), Math.min(1, end)] : null
}

function linearRangeInterval(start: number, delta: number, min: number, max: number): Interval | null {
  if (Math.abs(delta) <= EPSILON) return start >= min - EPSILON && start <= max + EPSILON ? [0, 1] : null
  const first = (min - start) / delta
  const second = (max - start) / delta
  return [Math.max(0, Math.min(first, second)), Math.min(1, Math.max(first, second))]
}

/** Parameter interval of a line segment inside a circle. */
function circleInterval(start: Point, end: Point, center: Point, radius: number): Interval | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const fx = start.x - center.x
  const fy = start.y - center.y
  const a = dx * dx + dy * dy
  const c = fx * fx + fy * fy - radius * radius
  if (a <= EPSILON) return c <= EPSILON ? [0, 1] : null
  const b = 2 * (fx * dx + fy * dy)
  const discriminant = b * b - 4 * a * c
  if (discriminant < -EPSILON) return null
  const root = Math.sqrt(Math.max(0, discriminant))
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  return intersectIntervals([first, second], [0, 1])
}

/** Parameter interval inside the rounded capsule around an eraser segment. */
function capsuleInterval(start: Point, end: Point, capStart: Point, capEnd: Point, radius: number): Interval | null {
  const qx = capEnd.x - capStart.x
  const qy = capEnd.y - capStart.y
  const length = Math.hypot(qx, qy)
  if (length <= EPSILON) return circleInterval(start, end, capStart, radius)

  const dx = end.x - start.x
  const dy = end.y - start.y
  const sx = start.x - capStart.x
  const sy = start.y - capStart.y
  const unitX = qx / length
  const unitY = qy / length
  const projectionStart = sx * unitX + sy * unitY
  const projectionDelta = dx * unitX + dy * unitY
  const perpendicularStart = sx * -unitY + sy * unitX
  const perpendicularDelta = dx * -unitY + dy * unitX
  const along = linearRangeInterval(projectionStart, projectionDelta, 0, length)
  const across = linearRangeInterval(perpendicularStart, perpendicularDelta, -radius, radius)
  const strip = intersectIntervals(along, across)
  const firstCap = circleInterval(start, end, capStart, radius)
  const secondCap = circleInterval(start, end, capEnd, radius)
  return mergeIntervals([strip, firstCap, secondCap].filter((interval): interval is Interval => interval !== null))[0] ?? null
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.map(([start, end]) => [Math.max(0, start), Math.min(1, end)] as Interval)
    .filter(([start, end]) => start <= end + EPSILON)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Interval[] = []
  for (const current of sorted) {
    const previous = merged.at(-1)
    if (previous && current[0] <= previous[1] + EPSILON) previous[1] = Math.max(previous[1], current[1])
    else merged.push([...current])
  }
  return merged
}

function eraserIntervals(start: Point, end: Point, eraserPoints: Point[], radius: number): Interval[] {
  const capsules: Array<[Point, Point]> = eraserPoints.length === 1
    ? [[eraserPoints[0], eraserPoints[0]]]
    : eraserPoints.slice(1).map((point, index) => [eraserPoints[index], point])
  return mergeIntervals(capsules.flatMap(([capStart, capEnd]) => {
    const interval = capsuleInterval(start, end, capStart, capEnd, radius)
    return interval ? [interval] : []
  }))
}

function complementIntervals(cuts: Interval[]): Interval[] {
  const visible: Interval[] = []
  let cursor = 0
  for (const [start, end] of cuts) {
    if (start - cursor > EPSILON) visible.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (1 - cursor > EPSILON) visible.push([cursor, 1])
  return visible
}

function interpolate(start: Point, end: Point, t: number): Point {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
}

function pushDistinct(points: Point[], point: Point) {
  const previous = points.at(-1)
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > EPSILON) points.push(point)
}

function splitWorldPath(points: Point[], eraserPoints: Point[], radius: number): { hit: boolean; fragments: Point[][] } {
  if (points.length === 1) {
    const cuts = eraserIntervals(points[0], points[0], eraserPoints, radius)
    return cuts.length ? { hit: true, fragments: [] } : { hit: false, fragments: [[points[0], points[0]]] }
  }

  const fragments: Point[][] = []
  let active: Point[] | null = null
  let hit = false
  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    const start = points[segmentIndex]
    const end = points[segmentIndex + 1]
    const cuts = eraserIntervals(start, end, eraserPoints, radius)
    if (cuts.some(([a, b]) => b - a > EPSILON)) hit = true
    const visible = complementIntervals(cuts.filter(([a, b]) => b - a > EPSILON))
    if (!visible.length) {
      if (active) fragments.push(active)
      active = null
      continue
    }
    for (const [from, to] of visible) {
      const visibleStart = interpolate(start, end, from)
      const visibleEnd = interpolate(start, end, to)
      const joinsPrevious = active && from <= EPSILON && Math.hypot(active.at(-1)!.x - visibleStart.x, active.at(-1)!.y - visibleStart.y) <= 1e-6
      if (!joinsPrevious) {
        if (active) fragments.push(active)
        active = [visibleStart]
      }
      pushDistinct(active!, visibleEnd)
      if (to < 1 - EPSILON) {
        fragments.push(active!)
        active = null
      }
    }
  }
  if (active) fragments.push(active)
  return { hit, fragments: fragments.filter(fragment => fragment.length > 0) }
}

function toExportableFragment(source: FreeDrawElement, worldPoints: Point[], id: string): FreeDrawElement {
  const points = worldPoints.length === 1 ? [worldPoints[0], worldPoints[0]] : worldPoints
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(1, Math.max(...xs) - x)
  const height = Math.max(1, Math.max(...ys) - y)
  return {
    ...source,
    id,
    x,
    y,
    width,
    height,
    rotation: 0,
    points: points.flatMap(point => [point.x - x, point.y - y]),
  }
}

export type EraseFreeDrawResult = {
  changedIds: string[]
  fragments: FreeDrawElement[]
  replacements: Array<{ sourceId: string; fragments: FreeDrawElement[] }>
}

/** Remove just the portions covered by the eraser and return exportable replacement strokes. */
export function eraseFreeDrawElements(
  elements: readonly FreeDrawElement[],
  eraserPath: number[],
  eraserWidth: number,
  makeFragmentId: (sourceId: string, fragmentIndex: number) => string = () => createId('stroke'),
): EraseFreeDrawResult {
  if (eraserPath.length < 2 || eraserPath.length % 2 !== 0 || eraserPath.some(point => !Number.isFinite(point))) return { changedIds: [], fragments: [], replacements: [] }
  if (!Number.isFinite(eraserWidth) || eraserWidth <= 0) return { changedIds: [], fragments: [], replacements: [] }
  const eraserPoints = pointsFromFlat(eraserPath)
  const changedIds: string[] = []
  const fragments: FreeDrawElement[] = []
  const replacements: EraseFreeDrawResult['replacements'] = []
  for (const element of elements) {
    if (element.type !== 'free-draw' || !Array.isArray(element.points) || element.points.length < 2 || element.points.length % 2 !== 0) continue
    if (![element.x, element.y, element.width, element.height, element.rotation, element.strokeWidth, ...element.points].every(Number.isFinite)) continue
    const worldPoints = pointsFromFlat(element.points).map(point => worldPoint(element, point.x, point.y))
    const result = splitWorldPath(worldPoints, eraserPoints, eraserWidth / 2 + Math.max(0, element.strokeWidth) / 2)
    if (!result.hit) continue
    changedIds.push(element.id)
    const replacementsForElement = result.fragments.map((fragment, index) => toExportableFragment(element, fragment, makeFragmentId(element.id, index)))
    replacements.push({ sourceId: element.id, fragments: replacementsForElement })
    fragments.push(...replacementsForElement)
  }
  return { changedIds, fragments, replacements }
}

/** Return free-draw element IDs whose rendered centerline touches the eraser path. */
export function findFreeDrawElementsIntersectingPath(
  elements: readonly { id: string; type: string; x: number; y: number; width: number; height: number; rotation: number; points?: number[]; strokeWidth?: number }[],
  eraserPath: number[],
  eraserWidth: number,
): string[] {
  const typedElements = elements.filter((element): element is FreeDrawElement => element.type === 'free-draw'
    && Array.isArray(element.points))
  return eraseFreeDrawElements(typedElements, eraserPath, eraserWidth, () => 'probe').changedIds
}
