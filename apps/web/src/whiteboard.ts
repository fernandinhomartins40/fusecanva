import type { DesignElement, DesignPage, WhiteboardAnchor, WhiteboardConnector } from './model'

export type WhiteboardPoint = { x: number; y: number }
export type WhiteboardRect = { x: number; y: number; width: number; height: number }

/** Exchange endpoint markers without changing the line's geometry or identity. */
export function swapWhiteboardLineEndpoints<T extends { startArrow?: boolean; endArrow?: boolean }>(line: T): T {
  return { ...line, startArrow: line.endArrow, endArrow: line.startArrow }
}

/** Reorder one whiteboard item without cloning or changing any element record.
 * The final array item is the topmost canvas layer, matching Konva render order.
 */
export function moveWhiteboardElementToEdge<T extends { id: string }>(elements: T[], elementId: string, edge: 'back' | 'front'): T[] {
  const index = elements.findIndex(element => element.id === elementId)
  if (index < 0 || elements.length < 2 || (edge === 'back' && index === 0) || (edge === 'front' && index === elements.length - 1)) return elements
  const next = [...elements]
  const [element] = next.splice(index, 1)
  next.splice(edge === 'back' ? 0 : next.length, 0, element)
  return next
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function positiveExtent(value: number): number {
  return Math.max(1, finiteOr(value, 1))
}

export function normalizeWhiteboardRect(start: WhiteboardPoint, end: WhiteboardPoint): WhiteboardRect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

function rotatedElementCorners(element: DesignElement): WhiteboardPoint[] {
  const left = Math.min(element.x, element.x + element.width)
  const right = Math.max(element.x, element.x + element.width)
  const top = Math.min(element.y, element.y + element.height)
  const bottom = Math.max(element.y, element.y + element.height)
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 }
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ].map(point => rotateAround(point, center, element.rotation))
}

function rectCorners(rect: WhiteboardRect): WhiteboardPoint[] {
  const left = Math.min(rect.x, rect.x + rect.width)
  const right = Math.max(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const bottom = Math.max(rect.y, rect.y + rect.height)
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
}

function polygonsIntersect(first: WhiteboardPoint[], second: WhiteboardPoint[]): boolean {
  const axes: WhiteboardPoint[] = []
  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]
      const end = polygon[(index + 1) % polygon.length]
      const dx = end.x - start.x
      const dy = end.y - start.y
      if (dx === 0 && dy === 0) continue
      // Both edge directions and their normals keep the test correct for
      // degenerate rectangles (lines and points), as well as ordinary quads.
      axes.push({ x: dx, y: dy }, { x: -dy, y: dx })
    }
  }
  if (axes.length === 0) axes.push({ x: 1, y: 0 }, { x: 0, y: 1 })
  return axes.every(axis => {
    const project = (polygon: WhiteboardPoint[]) => polygon.map(point => point.x * axis.x + point.y * axis.y)
    const firstProjection = project(first)
    const secondProjection = project(second)
    const firstMin = Math.min(...firstProjection)
    const firstMax = Math.max(...firstProjection)
    const secondMin = Math.min(...secondProjection)
    const secondMax = Math.max(...secondProjection)
    return firstMax >= secondMin && secondMax >= firstMin
  })
}

export function elementsIntersectingRect(elements: DesignElement[], rect: WhiteboardRect): string[] {
  const selection = rectCorners(rect)
  return elements.filter(element => {
    if (![element.x, element.y, element.width, element.height, element.rotation, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false
    return polygonsIntersect(rotatedElementCorners(element), selection)
  }).map(element => element.id)
}

/** Resolve a remote selection to the visible members of its whiteboard group. */
export function remoteWhiteboardSelectionElements(page: DesignPage, elementId: string): DesignElement[] {
  const group = page.groups?.find(candidate => candidate.elementIds.includes(elementId))
  const memberIds = new Set(group?.elementIds ?? [elementId])
  return page.elements.filter(element => memberIds.has(element.id))
}

function elementCenter(element: DesignElement): WhiteboardPoint {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
}

function rotateAround(point: WhiteboardPoint, center: WhiteboardPoint, degrees: number): WhiteboardPoint {
  const radians = degrees * Math.PI / 180
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians) }
}

export function snapConnectorAnchor(element: DesignElement, pointer: WhiteboardPoint): WhiteboardAnchor {
  const center = elementCenter(element)
  const local = rotateAround(pointer, center, -element.rotation)
  const x = Math.max(0, Math.min(1, (local.x - element.x) / Math.max(element.width, 1)))
  const y = Math.max(0, Math.min(1, (local.y - element.y) / Math.max(element.height, 1)))
  const distances = [x, 1 - x, y, 1 - y]
  const side = distances.indexOf(Math.min(...distances))
  if (side === 0) return { x: 0, y }
  if (side === 1) return { x: 1, y }
  if (side === 2) return { x, y: 0 }
  return { x, y: 1 }
}

export function connectorAnchorPoint(element: DesignElement, anchor: WhiteboardAnchor): WhiteboardPoint {
  const center = elementCenter(element)
  return rotateAround({ x: element.x + element.width * anchor.x, y: element.y + element.height * anchor.y }, center, element.rotation)
}

function connectorEndpoint(element: DesignElement, anchor: WhiteboardAnchor | undefined, other: DesignElement): WhiteboardPoint {
  const center = elementCenter(element)
  if (anchor) return connectorAnchorPoint(element, anchor)
  const otherCenter = elementCenter(other)
  const dx = otherCenter.x - center.x
  const dy = otherCenter.y - center.y
  if (dx === 0 && dy === 0) return center
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(element.width / 2, 1), Math.abs(dy) / Math.max(element.height / 2, 1))
  return rotateAround({ x: center.x + dx * scale, y: center.y + dy * scale }, center, element.rotation)
}

export function connectorPoints(page: DesignPage, connector: WhiteboardConnector): number[] | null {
  const from = page.elements.find(element => element.id === connector.fromId)
  const to = page.elements.find(element => element.id === connector.toId)
  if (!from || !to || from.id === to.id) return null
  if (!connector.fromAnchor && !connector.toAnchor && elementCenter(from).x === elementCenter(to).x && elementCenter(from).y === elementCenter(to).y) return null
  const start = connectorEndpoint(from, connector.fromAnchor, to)
  const end = connectorEndpoint(to, connector.toAnchor, from)
  return [start.x, start.y, end.x, end.y]
}

export function retainValidConnectors(page: DesignPage, connectors: WhiteboardConnector[] = page.connectors ?? []): WhiteboardConnector[] {
  const elementIds = new Set(page.elements.map(element => element.id))
  return connectors.filter(connector => connector.fromId !== connector.toId && elementIds.has(connector.fromId) && elementIds.has(connector.toId))
}

export function clampWhiteboardZoom(zoom: number): number {
  return Math.max(0.08, Math.min(3, finiteOr(zoom, 1)))
}

export function zoomWhiteboardAtPoint(position: WhiteboardPoint, zoom: number, pointer: WhiteboardPoint, nextZoom: number): { position: WhiteboardPoint; zoom: number } {
  const currentPosition = { x: finiteOr(position.x, 0), y: finiteOr(position.y, 0) }
  const safePointer = { x: finiteOr(pointer.x, 0), y: finiteOr(pointer.y, 0) }
  const currentZoom = clampWhiteboardZoom(zoom)
  const boundedZoom = clampWhiteboardZoom(nextZoom)
  const worldPoint = { x: (safePointer.x - currentPosition.x) / currentZoom, y: (safePointer.y - currentPosition.y) / currentZoom }
  return {
    zoom: boundedZoom,
    position: { x: safePointer.x - worldPoint.x * boundedZoom, y: safePointer.y - worldPoint.y * boundedZoom },
  }
}

export function centerWhiteboard(boardWidth: number, boardHeight: number, viewportWidth: number, viewportHeight: number, zoom = 0.55): WhiteboardPoint {
  const safeZoom = clampWhiteboardZoom(zoom)
  return { x: (positiveExtent(viewportWidth) - positiveExtent(boardWidth) * safeZoom) / 2, y: (positiveExtent(viewportHeight) - positiveExtent(boardHeight) * safeZoom) / 2 }
}

export function fitWhiteboardZoom(boardWidth: number, boardHeight: number, viewportWidth: number, viewportHeight: number): number {
  const safeBoardWidth = positiveExtent(boardWidth)
  const safeBoardHeight = positiveExtent(boardHeight)
  const safeViewportWidth = positiveExtent(viewportWidth)
  const safeViewportHeight = positiveExtent(viewportHeight)
  return clampWhiteboardZoom(Math.min((safeViewportWidth - 96) / safeBoardWidth, (safeViewportHeight - 96) / safeBoardHeight, 1))
}
