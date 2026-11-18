/** Local tool-dock state model. Variant labels describe the reconstructed glyphs,
 * not recovered product terminology from the partial reference capture.
 */
export const WHITEBOARD_LINE_VARIANTS = [
  { id: 'straight', label: 'Linha reta' },
  { id: 'elbowed', label: 'Linha angular' },
  { id: 'curved', label: 'Linha curva' },
] as const

export type WhiteboardLineVariant = typeof WHITEBOARD_LINE_VARIANTS[number]['id']
export type WhiteboardDockTool = 'select' | 'pan' | 'drawing' | 'shapes' | 'lines' | 'sticky' | 'text' | 'signature' | 'tables'

export type WhiteboardToolDockState = {
  activeTool: WhiteboardDockTool
  lineMenuOpen: boolean
  lineVariant: WhiteboardLineVariant
}

export const initialWhiteboardToolDockState: WhiteboardToolDockState = {
  activeTool: 'select',
  lineMenuOpen: false,
  lineVariant: 'straight',
}

export type WhiteboardToolDockAction =
  | { type: 'activate'; tool: WhiteboardDockTool }
  | { type: 'open-line-menu' }
  | { type: 'close-line-menu' }
  | { type: 'choose-line-variant'; variant: WhiteboardLineVariant }

/** Keep one dock tool active and make returning to selection close line choices. */
export function reduceWhiteboardToolDock(state: WhiteboardToolDockState, action: WhiteboardToolDockAction): WhiteboardToolDockState {
  if (action.type === 'open-line-menu') {
    return { ...state, activeTool: 'lines', lineMenuOpen: true }
  }
  if (action.type === 'close-line-menu') return { ...state, lineMenuOpen: false }
  if (action.type === 'choose-line-variant') {
    return { activeTool: 'lines', lineMenuOpen: false, lineVariant: action.variant }
  }
  return {
    ...state,
    activeTool: action.tool,
    lineMenuOpen: action.tool === 'select' ? false : state.lineMenuOpen,
  }
}
