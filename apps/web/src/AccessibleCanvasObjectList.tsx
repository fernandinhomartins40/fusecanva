import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Image as ImageIcon, Pencil, Shapes, Sticker, Type } from 'lucide-react'
import { getCanvasNavigationTarget, type AccessibleCanvasObject } from './canvas-navigation'
import './AccessibleCanvasObjectList.css'

type Props = {
  items: readonly AccessibleCanvasObject[]
  selectedIds: readonly string[]
  label: string
  emptyMessage?: string
  accessibilityTargetId?: string | null
  onActivate: (id: string, additive: boolean) => void
}

const ICONS = {
  text: Type,
  shape: Shapes,
  image: ImageIcon,
  'free-draw': Pencil,
  'sticky-note': Sticker,
  connector: ArrowRight,
} as const

/** Keyboard-operable equivalent of the canvas layer list, using the listbox pattern. */
export function AccessibleCanvasObjectList({ items, selectedIds, label, emptyMessage = 'Nenhum objeto nesta página.', accessibilityTargetId = null, onActivate }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(selectedIds.at(-1) ?? items[0]?.id ?? null)
  const selectedSignature = selectedIds.join('\u0000')

  useEffect(() => {
    if (activeId && items.some(item => item.id === activeId)) return
    const next = selectedIds.find(id => items.some(item => item.id === id)) ?? items[0]?.id ?? null
    setActiveId(next)
  }, [items, selectedSignature, activeId])

  const focusItem = (id: string) => {
    setActiveId(id)
    listRef.current?.querySelector<HTMLElement>(`[data-canvas-object-id="${CSS.escape(id)}"]`)?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      const active = items.find(item => item.id === activeId)
      if (!active) return
      event.preventDefault()
      event.stopPropagation()
      onActivate(active.id, event.shiftKey || event.metaKey || event.ctrlKey)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const target = getCanvasNavigationTarget(items, activeId, event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End')
    if (!target) return
    event.preventDefault()
    // The editor's global arrow shortcuts move the currently selected layer.
    // A listbox arrow key should only navigate/select a row, never move artwork.
    event.stopPropagation()
    focusItem(target.id)
    onActivate(target.id, event.shiftKey)
  }

  if (!items.length) return <div className="accessible-canvas-object-empty">{emptyMessage}</div>

  return <div ref={listRef} className="accessible-canvas-object-list" role="listbox" aria-label={label} aria-multiselectable="true" onKeyDown={handleKeyDown}>
    {items.map(item => {
      const Icon = ICONS[item.kind]
      const selected = selectedIds.includes(item.id)
      return <div
        key={item.id}
        id={`canvas-object-${item.id}`}
        data-element-id={item.kind === 'connector' ? undefined : item.id}
        data-connector-id={item.kind === 'connector' ? item.id : undefined}
        data-canvas-object-id={item.id}
        role="option"
        aria-selected={selected}
        aria-label={accessibilityTargetId === item.id ? `${item.ariaLabel ?? item.name}, selecionado pela revisão de acessibilidade` : item.ariaLabel ?? item.name}
        data-accessibility-target={accessibilityTargetId === item.id ? 'true' : undefined}
        tabIndex={activeId === item.id ? 0 : -1}
        className={`layer-row accessible-canvas-object${selected ? ' selected' : ''}`}
        title={item.name}
        onFocus={() => setActiveId(item.id)}
        onClick={event => { setActiveId(item.id); onActivate(item.id, event.shiftKey || event.metaKey || event.ctrlKey) }}
      >
        <span className="layer-symbol" aria-hidden="true"><Icon size={15} strokeWidth={1.8} /></span>
        <span className="accessible-canvas-object-name">{item.name}</span>
      </div>
    })}
  </div>
}
