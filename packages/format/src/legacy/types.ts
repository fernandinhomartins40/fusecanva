// Tipos do formato atual (pré-v1) do Fuse Studio, gravado no IndexedDB ("fuse-studio", store "documents")
// e na coluna documents.data_json do SQLite. Espelham apps/web/src/model.ts estruturalmente; este pacote
// não importa o app (fronteira de pacotes). O formato legado é tratado como schemaVersion 0.

export type LegacyEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type LegacyElementBase = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  startMs?: number
  durationMs?: number
}

export type LegacyTextElement = LegacyElementBase & {
  type: 'text'
  text: string
  href?: string
  fontSize: number
  fontFamily: string
  color: string
  bold: boolean
  kerning?: number
  lineSpacing?: number
}

export type LegacyQrConfig = {
  pattern: 'blocks' | 'rounded' | 'circles' | 'crosses' | 'stars' | 'hearts'
  url?: string
  name?: string
  expiration?: string
  foreground: string
  background: string
  logo: 'none' | 'logo'
  corner: number
}

export type LegacyShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'hexagon' | 'line' | 'arrow' | 'speech-bubble'

export type LegacyShapeElement = LegacyElementBase & {
  type: 'shape'
  shape: LegacyShapeKind
  fill: string
  cornerRadius: number
  strokeWidth?: number
  startArrow?: boolean
  endArrow?: boolean
  curveOffset?: number | null
  qrConfig?: LegacyQrConfig
}

export type LegacyImageAnimation = {
  effect: 'elevation'
  phase: 'enter' | 'exit'
  speed: 'slow' | 'medium' | 'fast'
  direction: 'down' | 'up' | 'left' | 'right'
}

export type LegacyMaskStroke = { mode: 'erase' | 'restore'; size: number; points: number[] }

export type LegacyImageElement = LegacyElementBase & {
  type: 'image'
  src: string
  altText?: string
  decorative?: boolean
  assetId?: string
  sourceWidth?: number
  sourceHeight?: number
  crop?: { x: number; y: number; width: number; height: number } | null
  opacity?: number
  flipX?: boolean
  flipY?: boolean
  brightness?: number
  contrast?: number
  saturation?: number
  filterPreset?: 'soft' | 'vintage' | 'mono' | 'color-pop' | 'duotone'
  imageStylePreset?: 'recorte' | 'gravura' | 'rabisco'
  maskStrokes?: LegacyMaskStroke[]
  animation?: LegacyImageAnimation | null
}

export type LegacyStickyNoteElement = LegacyElementBase & {
  type: 'sticky-note'
  text: string
  fill: string
  color: string
  fontSize: number
}

export type LegacyFreeDrawElement = LegacyElementBase & {
  type: 'free-draw'
  points: number[]
  color: string
  strokeWidth: number
  opacity?: number
}

export type LegacyElement = LegacyTextElement | LegacyShapeElement | LegacyImageElement | LegacyStickyNoteElement | LegacyFreeDrawElement

export type LegacyOpacityKeyframe = { timeMs: number; opacity: number; easing?: LegacyEasing }
export type LegacyTransformKeyframe = { timeMs: number; scale: number; offsetX: number; offsetY: number; easing?: LegacyEasing }

export type LegacyTimelineClip = {
  id: string
  assetId: string
  name: string
  kind: 'video' | 'audio'
  trackIndex?: number
  opacity?: number
  fitMode?: 'contain' | 'cover'
  scale?: number
  offsetX?: number
  offsetY?: number
  opacityKeyframes?: LegacyOpacityKeyframe[]
  transformKeyframes?: LegacyTransformKeyframe[]
  animationEasing?: LegacyEasing
  startMs: number
  durationMs: number
  sourceDurationMs: number
  sourceStartMs: number
  volume: number
  fadeInMs?: number
  fadeOutMs?: number
}

export type LegacyAnchor = { x: number; y: number }
export type LegacyConnector = { id: string; fromId: string; toId: string; fromAnchor?: LegacyAnchor; toAnchor?: LegacyAnchor; color: string; strokeWidth: number }
export type LegacyGroup = { id: string; name: string; elementIds: string[] }

export type LegacyDocBlockType = 'paragraph' | 'heading' | 'subheading' | 'quote' | 'bullet' | 'table' | 'image'
export type LegacyInlineMark = { start: number; end: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }
export type LegacyDocImage = { src: string; alt: string; width: number; height: number }
export type LegacyCellMerge = { row: number; column: number; colSpan: number; rowSpan?: number }
export type LegacyBorderStyle = 'none' | 'solid' | 'long-dashes' | 'dashes' | 'dots'
export type LegacyCellBorder = { style: LegacyBorderStyle; width: number }
export type LegacyCellBorders = Record<string, Partial<Record<'top' | 'right' | 'bottom' | 'left', LegacyCellBorder>>>
export type LegacyDocBlock = {
  id: string
  type: LegacyDocBlockType
  text: string
  marks?: LegacyInlineMark[]
  image?: LegacyDocImage
  cells?: string[][]
  cellImages?: Record<string, LegacyDocImage[]>
  merges?: LegacyCellMerge[]
  cellPadding?: number
  tableSpacing?: number
  borderColor?: string
  borderWidth?: number
  cellBorders?: LegacyCellBorders
}
export type LegacyDocPageSetup = { preset: 'a4'; margins: { top: number; right: number; bottom: number; left: number } }

export type LegacyCellFormat = 'default' | 'currency' | 'percentage' | 'date' | 'time' | 'datetime'
export type LegacySheetChart = {
  id: string
  type: 'bar' | 'line'
  title: string
  range: { startRow: number; startColumn: number; endRow: number; endColumn: number }
}

export type LegacyPage = {
  id: string
  name: string
  background: string
  hidden?: boolean
  elements: LegacyElement[]
  timelineClips?: LegacyTimelineClip[]
  connectors?: LegacyConnector[]
  groups?: LegacyGroup[]
  presenterNotes?: string
  blocks?: LegacyDocBlock[]
  cells?: string[][]
  cellMerges?: LegacyCellMerge[]
  cellFormats?: Record<string, LegacyCellFormat>
  charts?: LegacySheetChart[]
}

export type LegacyDocumentType = 'design' | 'doc' | 'presentation' | 'whiteboard' | 'sheet' | 'video' | 'site'

export type LegacyDocument = {
  id: string
  name: string
  type?: LegacyDocumentType
  archivedAt?: string
  trashedAt?: string
  folderId?: string
  width: number
  height: number
  docPageSetup?: LegacyDocPageSetup
  videoDurationMs?: number
  pages: LegacyPage[]
  updatedAt: string
  brandKitId?: string
}

/** Registro do store "assets" do IndexedDB / tabela de mídia. */
export type LegacyMediaAsset = {
  id: string
  name: string
  mimeType: string
  width: number
  height: number
  src: string
  fingerprint?: string
  libraryVisible?: 0 | 1
  createdAt: string
  scope?: 'document' | 'team'
}

/** Heurística: o valor tem a forma de um documento legado (sem `format: 'fuse'`)? */
export function isLegacyDocument(value: unknown): value is LegacyDocument {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record['format'] === undefined && typeof record['id'] === 'string' && Array.isArray(record['pages'])
}
