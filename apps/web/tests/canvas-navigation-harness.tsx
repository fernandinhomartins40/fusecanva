import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AccessibleCanvasObjectList } from '../src/AccessibleCanvasObjectList'
import '../src/App.css'
import type { AccessibleCanvasObject } from '../src/canvas-navigation'
import './canvas-navigation-harness.css'

const items: AccessibleCanvasObject[] = [
  { id: 'title', kind: 'text', name: 'Título do cartaz', ariaLabel: 'Título, texto: Festival de verão' },
  { id: 'photo', kind: 'image', name: 'Fotografia', ariaLabel: 'Fotografia, texto alternativo: Praia ao pôr do sol' },
  ...Array.from({ length: 10 }, (_, index) => ({ id: `shape-${index + 1}`, kind: 'shape' as const, name: `Forma ${index + 1}` })),
]

// Mirrors the editor's window-level arrow shortcuts so the browser check catches
// listbox navigation leaking into canvas movement commands.
window.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
  const count = Number(document.documentElement.dataset.canvasArrowCommands ?? 0)
  document.documentElement.dataset.canvasArrowCommands = String(count + 1)
})

function Harness() {
  const [selectedIds, setSelectedIds] = useState<string[]>(['title'])
  const [announcement, setAnnouncement] = useState('Título do cartaz selecionado')
  return <main>
    <h1>Navegação de camadas</h1>
    <AccessibleCanvasObjectList items={items} selectedIds={selectedIds} label="Camadas da página" onActivate={(id, additive) => {
      const item = items.find(candidate => candidate.id === id)!
      setSelectedIds(current => additive ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id])
      setAnnouncement(`${item.name} selecionado`)
    }} />
    <p role="status" aria-live="polite">{announcement}</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<Harness />)
