import { useEffect, useReducer, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUpRight, MousePointer2, Move, Pencil } from 'lucide-react'
import { initialWhiteboardToolDockState, reduceWhiteboardToolDock, WHITEBOARD_LINE_VARIANTS, type WhiteboardDockTool, type WhiteboardLineVariant, type WhiteboardToolDockState } from './whiteboard-tools'

type CanvasTool = 'select' | 'pan' | 'connector' | 'draw'

function dockToolForCanvasTool(tool: CanvasTool): WhiteboardDockTool {
  return tool === 'connector' ? 'lines' : tool === 'draw' ? 'drawing' : tool
}

function initialDockForCanvasTool(tool: CanvasTool): WhiteboardToolDockState {
  return { ...initialWhiteboardToolDockState, activeTool: dockToolForCanvasTool(tool) }
}

export function WhiteboardToolDock({ activeTool, onActivate, disabled = false }: {
  activeTool: CanvasTool
  onActivate: (tool: CanvasTool) => void
  disabled?: boolean
}) {
  const [dock, dispatch] = useReducer(reduceWhiteboardToolDock, activeTool, initialDockForCanvasTool)
  const connectorButtonRef = useRef<HTMLButtonElement>(null)
  const lineMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const modelTool = dockToolForCanvasTool(activeTool)
    if (dock.activeTool !== modelTool) dispatch({ type: 'activate', tool: modelTool })
  }, [activeTool, dock.activeTool])

  useEffect(() => {
    if (dock.lineMenuOpen) lineMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [dock.lineMenuOpen])

  useEffect(() => {
    if (!dock.lineMenuOpen) return
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !lineMenuRef.current?.contains(target) && !connectorButtonRef.current?.contains(target)) {
        dispatch({ type: 'close-line-menu' })
      }
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [dock.lineMenuOpen])

  function activate(tool: CanvasTool) {
    const nextTool = tool !== 'select' && activeTool === tool ? 'select' : tool
    const modelTool = dockToolForCanvasTool(nextTool)
    dispatch({ type: 'activate', tool: modelTool })
    onActivate(nextTool)
  }

  // The visible and accessible selected state must describe the same render.
  // Keep it derived from the canvas tool prop instead of the reducer mirror,
  // which is synchronized in an effect after a parent-driven tool change.
  function isActive(tool: CanvasTool) {
    return activeTool === tool
  }

  function openLineChoices() {
    dispatch({ type: dock.lineMenuOpen ? 'close-line-menu' : 'open-line-menu' })
    onActivate('connector')
  }

  function chooseLineVariant(variant: WhiteboardLineVariant) {
    dispatch({ type: 'choose-line-variant', variant })
    onActivate('connector')
    requestAnimationFrame(() => connectorButtonRef.current?.focus())
  }

  function handleLineMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    dispatch({ type: 'close-line-menu' })
    connectorButtonRef.current?.focus()
  }

  return <div className="whiteboard-tool-dock" role="group" aria-label="Ferramentas do quadro branco">
    <button type="button" className={`tool-button ${isActive('select') ? 'active' : ''}`} aria-label="Selecionar" aria-pressed={isActive('select')} title="Selecionar" disabled={disabled} onClick={() => activate('select')}><span className="tool-icon"><MousePointer2 size={19} aria-hidden="true" /></span><span>Selecionar</span></button>
    <button type="button" className={`tool-button ${isActive('pan') ? 'active' : ''}`} aria-label="Mover quadro" aria-pressed={isActive('pan')} title="Arrastar para mover o quadro" disabled={disabled} onClick={() => activate('pan')}><span className="tool-icon"><Move size={19} aria-hidden="true" /></span><span>Mover quadro</span></button>
    <div className="whiteboard-line-tool">
      <button ref={connectorButtonRef} type="button" className={`tool-button ${isActive('connector') ? 'active' : ''}`} aria-label="Conector" aria-pressed={isActive('connector')} aria-expanded={dock.lineMenuOpen} aria-controls="whiteboard-line-variants" title="Conectar dois elementos" disabled={disabled} onClick={openLineChoices}><span className="tool-icon"><ArrowUpRight size={19} aria-hidden="true" /></span><span>Conector</span></button>
      {dock.lineMenuOpen && <div ref={lineMenuRef} id="whiteboard-line-variants" className="whiteboard-line-menu" role="group" aria-label="Variações de linha" onKeyDown={handleLineMenuKeyDown}>{WHITEBOARD_LINE_VARIANTS.map(variant => <button key={variant.id} type="button" aria-pressed={dock.lineVariant === variant.id} className={dock.lineVariant === variant.id ? 'selected' : ''} disabled={disabled} onClick={() => chooseLineVariant(variant.id)}>{variant.label}</button>)}</div>}
    </div>
    <button type="button" className={`tool-button ${isActive('draw') ? 'active' : ''}`} aria-label="Desenho livre" aria-pressed={isActive('draw')} title="Desenhar à mão livre" disabled={disabled} onClick={() => activate('draw')}><span className="tool-icon"><Pencil size={19} aria-hidden="true" /></span><span>Desenho livre</span></button>
  </div>
}
