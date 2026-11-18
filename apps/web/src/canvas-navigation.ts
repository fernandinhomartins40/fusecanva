import type { DesignElement } from './model'

export type CanvasNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export type AccessibleCanvasObject = {
  id: string
  name: string
  kind: 'text' | 'shape' | 'image' | 'free-draw' | 'sticky-note' | 'connector'
  ariaLabel?: string
}

function boundedText(value: string, maxLength = 160): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

/** Derive a useful screen-reader name directly from the editable element model. */
export function toAccessibleCanvasObject(element: DesignElement): AccessibleCanvasObject {
  if (element.type === 'text') {
    const excerpt = boundedText(element.text, 120)
    return { id: element.id, kind: 'text', name: element.name, ariaLabel: excerpt ? `${element.name}, texto: ${excerpt}` : `${element.name}, texto vazio` }
  }
  if (element.type === 'image') {
    if (element.decorative) return { id: element.id, kind: 'image', name: element.name, ariaLabel: `${element.name}, imagem decorativa` }
    const alt = boundedText(element.altText ?? '')
    return { id: element.id, kind: 'image', name: element.name, ariaLabel: alt ? `${element.name}, texto alternativo: ${alt}` : `${element.name}, imagem sem texto alternativo` }
  }
  if (element.type === 'shape') return { id: element.id, kind: 'shape', name: element.name, ariaLabel: `${element.name}, forma ${element.shape}` }
  if (element.type === 'sticky-note') return { id: element.id, kind: 'sticky-note', name: element.name, ariaLabel: `${element.name}, nota: ${boundedText(element.text)}` }
  return { id: element.id, kind: 'free-draw', name: element.name, ariaLabel: `${element.name}, traço livre` }
}

/** Resolve the next keyboard focus target in a layer list without wrapping. */
export function getCanvasNavigationTarget<T extends { id: string }>(
  items: readonly T[],
  currentId: string | null,
  key: CanvasNavigationKey,
): T | null {
  if (items.length === 0) return null
  if (key === 'Home') return items[0]
  if (key === 'End') return items.at(-1) ?? null
  const currentIndex = items.findIndex(item => item.id === currentId)
  const safeIndex = currentIndex < 0 ? (key === 'ArrowDown' ? -1 : items.length) : currentIndex
  const nextIndex = key === 'ArrowDown' ? Math.min(items.length - 1, safeIndex + 1) : Math.max(0, safeIndex - 1)
  return items[nextIndex] ?? null
}
