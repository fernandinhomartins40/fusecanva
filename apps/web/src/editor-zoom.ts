/** Zoom menu contract reconstructed from the retained Canva editor evidence.
 * Fit percentages are supplied by the caller because they depend on the page
 * and viewport; the corpus observed 54% for “Ver inteiro” in one fixture.
 */
export const EDITOR_ZOOM_MIN = 10
export const EDITOR_ZOOM_MAX = 300

export const EDITOR_ZOOM_PRESETS = [300, 200, 125, 100, 75, 50, 25, 10] as const

export type EditorZoomMode = 'percentage' | 'fit-page' | 'fit-editor'
export type EditorZoomState = Readonly<{ mode: EditorZoomMode; percentage: number }>
export type CanvasGesturePoint = Readonly<{ x: number; y: number }>
export type CanvasGestureTransform = Readonly<{ zoom: number; position: CanvasGesturePoint }>
export type EditorZoomOption = Readonly<{
  id: string
  label: string
  mode: Exclude<EditorZoomMode, 'percentage'> | 'percentage'
  percentage?: number
}>

export const EDITOR_ZOOM_OPTIONS: readonly EditorZoomOption[] = Object.freeze([
  Object.freeze({ id: 'fit-page', label: 'Ver inteiro', mode: 'fit-page' as const }),
  Object.freeze({ id: 'fit-editor', label: 'Ajustar ao editor', mode: 'fit-editor' as const }),
  ...EDITOR_ZOOM_PRESETS.map((percentage) => Object.freeze({
    id: `zoom-${percentage}`,
    label: `${percentage}%`,
    mode: 'percentage' as const,
    percentage,
  })),
])

export function clampEditorZoom(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, value))
}

/** Make a valid viewport zoom state. Fit percentages may be non-preset values. */
export function createEditorZoomState(percentage = 100, mode: EditorZoomMode = 'percentage'): EditorZoomState {
  const safeMode: EditorZoomMode = mode === 'fit-page' || mode === 'fit-editor' ? mode : 'percentage'
  return Object.freeze({ mode: safeMode, percentage: clampEditorZoom(percentage) })
}

/** Select an observed menu entry, close the menu, and retain fit-mode identity. */
export function selectEditorZoomOption(
  _state: EditorZoomState,
  optionId: string,
  fitPercentages: Readonly<{ fitPage?: number; fitEditor?: number }> = {},
): EditorZoomState {
  if (optionId === 'fit-page') {
    return createEditorZoomState(fitPercentages.fitPage ?? 54, 'fit-page')
  }
  if (optionId === 'fit-editor') {
    return createEditorZoomState(fitPercentages.fitEditor ?? 100, 'fit-editor')
  }
  const option = EDITOR_ZOOM_OPTIONS.find((candidate) => candidate.id === optionId)
  if (!option || option.mode !== 'percentage' || option.percentage === undefined) {
    throw new RangeError(`Unknown editor zoom option: ${optionId}`)
  }
  return createEditorZoomState(option.percentage, 'percentage')
}

/** ARIA selected state for each listbox option; reopening the menu is stable. */
export function isEditorZoomOptionSelected(state: EditorZoomState, optionId: string): boolean {
  if (state.mode === 'fit-page' || state.mode === 'fit-editor') return optionId === state.mode
  return optionId === `zoom-${state.percentage}`
}

export function getEditorZoomDisplayValue(state: EditorZoomState): string {
  return `${Math.round(state.percentage)}%`
}

/**
 * Compute a two-finger canvas transform from the gesture's initial frame.
 * The world point under the initial midpoint follows the moving midpoint,
 * while the distance ratio scales the canvas. Bounds are expressed in the
 * same units as `zoom` (for example, 0.1–3 for editor scale or 0.08–3 for
 * whiteboard scale).
 */
export function zoomCanvasAtPinch(
  position: CanvasGesturePoint,
  zoom: number,
  startMidpoint: CanvasGesturePoint,
  startDistance: number,
  currentMidpoint: CanvasGesturePoint,
  currentDistance: number,
  minimumZoom = 0.1,
  maximumZoom = 3,
): CanvasGestureTransform {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const safeDistance = Number.isFinite(startDistance) && startDistance > 0 ? startDistance : 1
  const safeCurrentDistance = Number.isFinite(currentDistance) && currentDistance > 0 ? currentDistance : safeDistance
  const safeMin = Number.isFinite(minimumZoom) && minimumZoom > 0 ? minimumZoom : 0.1
  const safeMax = Number.isFinite(maximumZoom) && maximumZoom >= safeMin ? maximumZoom : Math.max(safeMin, 3)
  const nextZoom = Math.min(safeMax, Math.max(safeMin, safeZoom * safeCurrentDistance / safeDistance))
  const safePosition = {
    x: Number.isFinite(position.x) ? position.x : 0,
    y: Number.isFinite(position.y) ? position.y : 0,
  }
  const safeStart = {
    x: Number.isFinite(startMidpoint.x) ? startMidpoint.x : 0,
    y: Number.isFinite(startMidpoint.y) ? startMidpoint.y : 0,
  }
  const safeCurrent = {
    x: Number.isFinite(currentMidpoint.x) ? currentMidpoint.x : safeStart.x,
    y: Number.isFinite(currentMidpoint.y) ? currentMidpoint.y : safeStart.y,
  }
  const worldAnchor = {
    x: (safeStart.x - safePosition.x) / safeZoom,
    y: (safeStart.y - safePosition.y) / safeZoom,
  }
  return {
    zoom: nextZoom,
    position: {
      x: safeCurrent.x - worldAnchor.x * nextZoom,
      y: safeCurrent.y - worldAnchor.y * nextZoom,
    },
  }
}
