import type { DesignPage, WhiteboardGroup } from './model'
import { createId } from './model'

export type WhiteboardArrangement = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'distribute-x' | 'distribute-y'

type ElementBounds = { left: number; right: number; top: number; bottom: number }

function rotatedBounds(element: DesignPage['elements'][number]): ElementBounds {
  const radians = (element.rotation ?? 0) * Math.PI / 180
  const width = Math.abs(element.width * Math.cos(radians)) + Math.abs(element.height * Math.sin(radians))
  const height = Math.abs(element.width * Math.sin(radians)) + Math.abs(element.height * Math.cos(radians))
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  return { left: centerX - width / 2, right: centerX + width / 2, top: centerY - height / 2, bottom: centerY + height / 2 }
}

export function arrangeWhiteboardElements(elements: DesignPage['elements'], elementIds: string[], arrangement: WhiteboardArrangement): DesignPage['elements'] {
  const selected = new Set(elementIds)
  const items = elements.filter(element => selected.has(element.id)).map(element => ({ element, bounds: rotatedBounds(element) }))
  if (items.length < 2) return elements
  const bounds = items.map(item => item.bounds)
  const left = Math.min(...bounds.map(item => item.left))
  const right = Math.max(...bounds.map(item => item.right))
  const top = Math.min(...bounds.map(item => item.top))
  const bottom = Math.max(...bounds.map(item => item.bottom))
  const deltas = new Map<string, { x: number; y: number }>()

  if (arrangement === 'distribute-x' || arrangement === 'distribute-y') {
    const horizontal = arrangement === 'distribute-x'
    if (items.length < 3) return elements
    const sorted = [...items].sort((a, b) => horizontal ? a.bounds.left - b.bounds.left : a.bounds.top - b.bounds.top)
    const start = horizontal ? sorted[0].bounds.left : sorted[0].bounds.top
    const end = horizontal ? sorted.at(-1)!.bounds.right : sorted.at(-1)!.bounds.bottom
    const totalSize = sorted.reduce((sum, item) => sum + (horizontal ? item.bounds.right - item.bounds.left : item.bounds.bottom - item.bounds.top), 0)
    const gap = (end - start - totalSize) / (sorted.length - 1)
    let cursor = start
    for (const item of sorted) {
      const current = horizontal ? item.bounds.left : item.bounds.top
      const delta = cursor - current
      deltas.set(item.element.id, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta })
      cursor += (horizontal ? item.bounds.right - item.bounds.left : item.bounds.bottom - item.bounds.top) + gap
    }
  } else {
    for (const item of items) {
      let dx = 0
      let dy = 0
      if (arrangement === 'left') dx = left - item.bounds.left
      else if (arrangement === 'center-x') dx = (left + right - item.bounds.left - item.bounds.right) / 2
      else if (arrangement === 'right') dx = right - item.bounds.right
      else if (arrangement === 'top') dy = top - item.bounds.top
      else if (arrangement === 'center-y') dy = (top + bottom - item.bounds.top - item.bounds.bottom) / 2
      else if (arrangement === 'bottom') dy = bottom - item.bounds.bottom
      deltas.set(item.element.id, { x: dx, y: dy })
    }
  }
  return elements.map(element => {
    const delta = deltas.get(element.id)
    return delta ? { ...element, x: element.x + delta.x, y: element.y + delta.y } : element
  })
}

export function selectionForElement(page: DesignPage, elementId: string): string[] {
  return page.groups?.find(group => group.elementIds.includes(elementId))?.elementIds ?? [elementId]
}

export function createWhiteboardGroup(page: DesignPage, elementIds: string[]): DesignPage | null {
  const uniqueIds = [...new Set(elementIds)].filter(id => page.elements.some(element => element.id === id))
  if (uniqueIds.length < 2 || (page.groups ?? []).some(group => group.elementIds.some(id => uniqueIds.includes(id)))) return null
  const group: WhiteboardGroup = { id: createId('group'), name: `Grupo ${(page.groups?.length ?? 0) + 1}`, elementIds: uniqueIds }
  return { ...page, groups: [...(page.groups ?? []), group] }
}

export function ungroupWhiteboardSelection(page: DesignPage, elementIds: string[]): DesignPage {
  const selected = new Set(elementIds)
  return { ...page, groups: (page.groups ?? []).filter(group => !group.elementIds.some(id => selected.has(id))) }
}

export function moveWhiteboardElements(page: DesignPage, elementIds: string[], dx: number, dy: number): DesignPage {
  const moving = new Set(elementIds)
  return { ...page, elements: page.elements.map(element => moving.has(element.id) ? { ...element, x: element.x + dx, y: element.y + dy } : element) }
}

export function removeWhiteboardElements(page: DesignPage, elementIds: string[]): DesignPage {
  const removed = new Set(elementIds)
  const elements = page.elements.filter(element => !removed.has(element.id))
  const groups = (page.groups ?? []).flatMap(group => {
    const remaining = group.elementIds.filter(id => !removed.has(id))
    return remaining.length > 1 ? [{ ...group, elementIds: remaining }] : []
  })
  const connectors = (page.connectors ?? []).filter(connector => !removed.has(connector.fromId) && !removed.has(connector.toId))
  return { ...page, elements, groups, connectors }
}
