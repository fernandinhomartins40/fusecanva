import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Accessibility, Activity, Aperture, Bell, CaseSensitive, Archive, ArchiveRestore, ArrowDown, ArrowUp, ArrowRight, ArrowUpRight, AlignLeft, Bold, Check, Circle, CircleAlert, Clock3, Cloud, Copy, Crop, Download, Eraser, Eye, EyeOff, FileText, Film, Focus, Folder, FolderOpen, Group as GroupIcon, Heading, Heading1, Heading2, Highlighter, Hexagon, History, House, Image as ImageIcon, Italic, Layers, LayoutGrid, LayoutTemplate, Link2, List, LogIn, Maximize, Menu, MessageCircle, Monitor, Music2, NotebookPen, Minus, MousePointer2, Move, Pause, PenLine, PenTool, Pencil, Play, Plus, Presentation, Redo2, Scissors, Search, Scan, ScanFace, Shapes, Settings2, Sheet, Share2, Smartphone, Sparkles, Square, Star, Sticker, Strikethrough, Table2, Timer, Trash2, Triangle, Type, Underline, Undo2, Ungroup as UngroupIcon, Upload, WandSparkles, X, Zap, Globe, ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Pilcrow, Mail, SearchX, RefreshCw, FlipHorizontal2, FlipVertical2, UsersRound, TableProperties, MoreHorizontal } from 'lucide-react'
import Konva from 'konva'
import { Arrow, Circle as KonvaCircle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Shape as KonvaCustomShape, Stage, Text as KonvaText, Transformer } from 'react-konva'
import { patchSelectedTextTypography, type DesignDocument, type DesignElement, type DesignPage, type DocBlock, type DocBlockType, type DocTableBorderStyle, type ImageAnimationSettings, type ImageElement, type MediaAsset, type ProjectFolder, type SheetChart, type StarterTemplateId, type VideoTimelineClip, type WhiteboardAnchor } from './model'
import { createBlankDocument, createFreeDrawElement, createId, createIsoTimestamp, createStarterDocument, createStickyNoteElement, createTypedBlankDocument, getCurrentTimeMilliseconds, STARTER_TEMPLATES } from './model'
import { STARTER_TEMPLATE_LICENSES, STARTER_TEMPLATE_METADATA, STARTER_TEMPLATE_PALETTES, STARTER_TEMPLATE_TYPES, type StarterTemplateLicense, type StarterTemplatePalette, type StarterTemplateType } from './model'
import { createPdfBytes, createPdfDocSemantics, createPdfPageDescriptions, createPdfPageSemantics, renderDocumentCanvases, renderPageCanvas, safeFileName } from './export'
import { hasUnpersistedChanges, mergeConcurrentDocuments } from './collaboration'
import { reducePresenceMessage } from './presence-state.mjs'
import { countDocumentMatches, getDocumentReplacementPatches, replaceDocumentMatches, splitDocumentReplacementPatch } from './doc-search'
import { getDocTextRuns, isSafeDocImage, remapDocInlineMarks, toggleDocInlineMark, type DocMarkKind } from './doc-format'
import { normalizeSiteHref, siteSectionAnchors } from './site-links'
import { BUILT_IN_ILLUSTRATIONS, BUILT_IN_ILLUSTRATION_CATEGORIES } from './built-in-assets'
import { createImageFilter, IMAGE_FILTER_PRESETS, type ImageFilterPreset } from './image-filters'
import { createImageStyleFilter, type ImageStylePreset } from './image-styles'
import { isEditedToday, readProjectsFilters, writeProjectsFilters, type ProjectsFilters } from './project-filters.mjs'
import { createImageColorAdjustmentFilter, estimateAutoImageAdjustment } from './image-adjustments'
import { eraseFreeDrawElements, getDrawingToolStyle, normalizeDrawingColor, type DrawingTool } from './drawing-tools'
import { AccessibleCanvasObjectList } from './AccessibleCanvasObjectList'
import { toAccessibleCanvasObject } from './canvas-navigation'
import { PrintSandboxHost } from './PrintSandbox'
import { createImageMaskFilter, imageMaskPointsToSvgPath, screenToNormalizedImagePoint, type ImageMaskMode } from './image-masks'
import { isStrokeVectorShape, VECTOR_SHAPE_LABELS, VECTOR_SHAPES, vectorLineArrowheadPoints, vectorShapePath, vectorShapePoints, type VectorShapeKind } from './vector-shapes'
import { clampCrop, normalizedCropFromSource, sourceCropFromNormalized, type NormalizedCrop, type SourceCrop } from './image-crop'
import { getAudioClipPlaybackState, getVideoClipLayout, getVideoClipOpacity, getVideoClipTransform, removeVideoOpacityKeyframe, removeVideoTransformKeyframe, setVideoOpacityKeyframe, setVideoOpacityKeyframeEasing, setVideoTransformKeyframe, setVideoTransformKeyframeEasing, splitVideoTimelineClipAt, type VideoAnimationEasing } from './video-composition'
import { getAudioBeatMarkers, getAudioWaveformRangePeaks, mapAudioBeatMarkersToTimeline } from './audio-waveform'
import { isVideoExportFormatSupported, resolveVideoExportMimeType, type VideoExportFormat } from './video-export'
import { arrangeWhiteboardElements, createWhiteboardGroup, moveWhiteboardElements, removeWhiteboardElements, selectionForElement, ungroupWhiteboardSelection, type WhiteboardArrangement } from './groups'
import { createBlankDesignPage, deleteDesignPage, duplicateDesignDocument, duplicateDesignPage, moveDesignPage, setSiteSectionVisibility } from './pages'
import { clampPresentationPage, getPresenterView } from './presentation'
import { WhiteboardToolDock } from './WhiteboardToolDock'
import { VideoKeyframeEasingControl } from './VideoKeyframeEasingControl'
import { DreamLabPanel } from './DreamLabPanel'
import { AIConnectorsPanel } from './AIConnectorsPanel'
import { TeamRosterPanel } from './TeamRosterPanel'
import { TeamGroupsSettingsRoute, TeamPeopleSettingsRoute, TeamProfileSettingsRoute } from './TeamPeopleSettingsPage'
import { TeamIntegrationsPanel } from './TeamIntegrationsPanel'
import { TeamPermissionsSettings } from './TeamPermissionsSettings'
import { TeamAiAppManager } from './TeamAiAppManager'
import type { DreamLabImage } from './dream-lab.mjs'
import { persistSitePreviewMobileFit, persistSitePreviewViewport, readSitePreviewPreferences } from './site-preview-preferences'
import { drawQrScene, qrSvg } from './qr-code'
import { EDITOR_ZOOM_OPTIONS, createEditorZoomState, getEditorZoomDisplayValue, isEditorZoomOptionSelected, selectEditorZoomOption, zoomCanvasAtPinch, type CanvasGesturePoint, type EditorZoomState } from './editor-zoom'
import { centerWhiteboard, clampWhiteboardZoom, connectorPoints, elementsIntersectingRect, fitWhiteboardZoom, moveWhiteboardElementToEdge, normalizeWhiteboardRect, remoteWhiteboardSelectionElements, snapConnectorAnchor, swapWhiteboardLineEndpoints, zoomWhiteboardAtPoint, type WhiteboardPoint, type WhiteboardRect } from './whiteboard'
import { appendTableColumn, appendTableRow, extendTableSelection, isCellMerged, mergeTableSelection, moveTableCellBorders, moveTableCellImages, moveTableMerges, moveTableRow, moveTableRowIndex, removeTableColumn, removeTableRow, setTableCell, shiftTableCellBordersAfterColumnRemoval, shiftTableCellBordersAfterRowRemoval, shiftTableCellImagesAfterColumnRemoval, shiftTableCellImagesAfterRowRemoval, shiftTableMergesAfterColumnRemoval, shiftTableMergesAfterRowRemoval, shouldAppendTableRow, unmergeTableCell, type TableSelection } from './table'
import { recordDocumentChange, recordDocumentCheckpoint, redoDocumentChange, undoDocumentChange } from './documentHistory'
import { columnLabel, evaluateSheet, fillSheetDown, formatSheetCellValue, mergeSheetRange, pasteSheetRange, renameSheetReferences, setSheetCell, translateCopiedSheetRange, unmergeSheetCell, type SheetNumberFormat } from './sheet'
import { getSheetChartDomain, getSheetChartPoints } from './sheet-charts'
import { deleteCloudDraft, deleteDocument, deleteDocuments, deleteMediaAsset, deleteProjectFolder, listDocuments, listMediaAssets, listProjectFolders, listStoredMediaAssets, readCloudDraft, readDocument, writeCloudDraft, writeDocument, writeMediaAsset, writeProjectFolder } from './persistence'
import { fingerprintImageUpload, validateImageDimensions, validateImageUpload, validateTimelineMediaUpload } from './media'
import { sanitizeImportedSvg } from './svg-import'
import { MAX_CSV_IMPORT_BYTES, parseCsv, serializeCsv } from './csv'
import { StudioApiError, acceptRemoteInvitation, acceptRemoteTeamInvitation, applyRemoteOperation, completePasswordReset, copyRemoteDocumentVersion, createRemoteDocument, createRemoteProjectFolder, createRemoteInvitation, createRemoteTeam, createRemoteTeamInvitation, deleteRemoteDocument, deleteRemoteMediaAsset, deleteRemoteTeamMediaAsset, deleteRemoteProjectFolder, emptyRemoteTrash, generateRemoteText, getExternalProviderStatus, getRemoteSitePublication, getRemoteDocument, getRemoteDocumentAccess, getRemoteInvitation, getRemoteTeam, getRemoteTeamAudit, getRemoteTeamInvitation, getSession, getPublicSharedDocument, grantRemotePermission, listRemoteCollaborators, listRemoteComments, listRemoteDocumentVersions, listRemoteDocuments, listRemoteInvitations, listRemoteMediaAssets, listRemoteNotifications, listRemotePermissions, listRemoteProjectFolders, listRemoteTeamMediaAssets, listRemoteTeams, listRemoteTeamInvitations, moveRemoteDocumentToFolder, postRemoteComment, publishRemoteSite, removeRemoteTeamMember, requestPasswordReset, restoreRemoteDocumentVersion, revokeRemoteInvitation, revokeRemoteTeamInvitation, revokeRemotePermission, saveRemoteDocument, saveRemoteMediaAsset, saveRemoteTeamMediaAsset, sendRemoteCursor, sendRemotePresentationState, sendRemoteSelection, setRemoteCommentResolved, setRemoteNotificationRead, setRemoteDocumentAccessSuspended, setRemoteTeamMemberRole, updateRemoteProjectFolder, updateRemotePublicLink, signIn, signOut, signUp, subscribeRemoteDocument, subscribeRemoteNotifications, type RemoteNotificationEvent, type CollaborativeOperation, type DocBlockStructureOperation, type DocBlockTextOperation, type DocTableCellOperation, type RemoteAuditEvent, type RemoteComment, type RemoteCollaborator, type RemoteNotification, type RemoteDocument, type RemoteDocumentVersion, type RemoteInvitation, type RemotePermission, type RemotePresence, type RemotePresentation, type RemoteSelection, type ReceivedRemoteInvitation, type ReceivedTeamInvitation, type RemoteProjectFolder, type RemoteTeam, type RemoteTeamInvitation, type RemoteTeamMember, type SheetOperation, type StudioUser, type VideoTimelineClipPatch, type ExternalProviderStatus, type RemoteSitePublicationState } from './api'
import './App.css'
import './Hub.css'
import { AppsMarketplace } from './AppsMarketplace'
import { BulkCreatePanel } from './BulkCreatePanel'
import { generateBulkDocuments } from './bulk-create.mjs'
import { applyAuditedBrandPalette, applyAuditedBrandTypography, BRAND_KITS, createBrandTitleElement } from './brand-kit.mjs'
import { buildAiRequestPrompt, getAiBrandContext, getAiPromptLimit, type AiBrandContext, type AiComposerAttachment } from './ai-brand-context.mjs'
import { AiComposerAttachments } from './AiComposerAttachments'
import './BrandKit.css'
import { applyBrandReviewFixes } from './brand-review.mjs'
import { BrandAssistantReview } from './BrandAssistantReview'
import './BrandAssistantReview.css'

const EMPTY_VIDEO_TIMELINE_CLIPS: VideoTimelineClip[] = []
type AiChatMessage = { role: 'user' | 'assistant'; text: string; mode?: 'sandbox' | 'openai-compatible'; brandKitName?: string; attachmentNames?: string[] }
function getAiChatStorageKey(documentId: string) { return `fuse-ai-chat:${documentId}` }
function readAiChat(documentId: string): AiChatMessage[] {
  try {
    const stored = sessionStorage.getItem(getAiChatStorageKey(documentId))
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is AiChatMessage => item && typeof item === 'object' && ['user', 'assistant'].includes((item as AiChatMessage).role) && typeof (item as AiChatMessage).text === 'string' && (item as AiChatMessage).text.length <= 20_000).slice(-40) : []
  } catch { return [] }
}
function saveAiChat(documentId: string, messages: AiChatMessage[]) {
  try { sessionStorage.setItem(getAiChatStorageKey(documentId), JSON.stringify(messages.slice(-40))) } catch { /* Chat persistence is best effort when storage is unavailable. */ }
}

type VideoExportAudioGraph = {
  context: AudioContext
  sources: Map<HTMLMediaElement, { source: MediaElementAudioSourceNode; destinations: Set<MediaStreamAudioDestinationNode> }>
  destinations: Set<MediaStreamAudioDestinationNode>
}

function connectMediaToVideoExport(graph: VideoExportAudioGraph, media: HTMLMediaElement) {
  let connection = graph.sources.get(media)
  if (!connection) {
    const source = graph.context.createMediaElementSource(media)
    source.connect(graph.context.destination)
    connection = { source, destinations: new Set() }
    graph.sources.set(media, connection)
  }
  for (const destination of graph.destinations) {
    if (connection.destinations.has(destination)) continue
    connection.source.connect(destination)
    connection.destinations.add(destination)
  }
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function AudioFadeControl({ label, seconds, maxSeconds, disabled, onCommit }: {
  label: 'Entrada gradual' | 'Saída gradual'
  seconds: number
  maxSeconds: number
  disabled: boolean
  onCommit: (seconds: number) => void
}) {
  const maximum = Number.isFinite(maxSeconds) ? Math.max(0, maxSeconds) : 0
  const value = Number.isFinite(seconds) ? Math.max(0, Math.min(maximum, seconds)) : 0
  const [draft, setDraft] = useState(value.toFixed(1))

  useEffect(() => { setDraft(value.toFixed(1)) }, [value])

  function commitDraft() {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(1))
      return
    }
    const next = Math.round(Math.max(0, Math.min(maximum, parsed)) * 10) / 10
    setDraft(next.toFixed(1))
    if (next !== value) onCommit(next)
  }

  return <div className="video-audio-fade-control">
    <span>{label}</span>
    <input type="range" min="0" max={maximum} step="0.1" value={value} aria-label={label} disabled={disabled} onChange={event => {
      const next = Number(event.target.value)
      setDraft(next.toFixed(1))
      onCommit(next)
    }} />
    <input type="number" min="0" max={maximum} step="0.1" value={draft} aria-label={label} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commitDraft()
        event.currentTarget.blur()
      }
    }} />
  </div>
}

function invitationDeliveryNotice(status: 'sent' | 'link-only' | 'failed'): string {
  if (status === 'sent') return 'Convite criado e enviado por e-mail. O link também está disponível para copiar.'
  if (status === 'failed') return 'Convite criado, mas o e-mail não foi enviado. Compartilhe o link ou verifique a configuração do provedor.'
  return 'Convite criado. O envio por e-mail está desativado; compartilhe o link.'
}

function VectorShapePreview({ element, className, style }: { element: Extract<DesignElement, { type: 'shape' }>; className: string; style?: CSSProperties }) {
  const qr = qrSvg(element)
  if (qr) return <img aria-hidden="true" className={className} src={`data:image/svg+xml,${encodeURIComponent(qr)}`} style={{ ...style, objectFit: 'contain', background: element.qrConfig?.background ?? '#ffffff', borderRadius: 0 }} />
  if (element.shape === 'rect' || element.shape === 'ellipse') return <span aria-hidden="true" className={className} style={{ ...style, background: element.fill, borderRadius: style?.borderRadius ?? (element.shape === 'ellipse' ? '50%' : element.cornerRadius) }} />
  const stroke = isStrokeVectorShape(element.shape)
  return <svg className={className} viewBox={`0 0 ${element.width} ${element.height}`} preserveAspectRatio="none" style={{ ...style, overflow: 'visible', background: 'transparent', borderRadius: 0 }} aria-hidden="true"><path d={vectorShapePath(element.shape, element.width, element.height, element.curveOffset)} fill={stroke ? 'none' : element.fill} stroke={stroke ? element.fill : 'none'} strokeWidth={stroke ? element.strokeWidth ?? 8 : 0} strokeLinecap={element.curveOffset ? 'butt' : 'round'} strokeLinejoin="round" />{stroke && element.startArrow && <polygon points={vectorLineArrowheadPoints(element.width, element.height, element.curveOffset, true).join(',')} fill={element.fill} />}{stroke && element.endArrow && <polygon points={vectorLineArrowheadPoints(element.width, element.height, element.curveOffset).join(',')} fill={element.fill} />}</svg>
}

const VECTOR_SHAPE_ICONS: Record<VectorShapeKind, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  star: Star,
  hexagon: Hexagon,
  line: Minus,
  arrow: ArrowRight,
  'speech-bubble': MessageCircle,
}

function teamAuditLabel(action: string, details: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    'team.created': 'criou a equipe',
    'team.member.role_changed': `alterou o papel para ${String(details.role ?? '')}`,
    'team.member.removed': 'removeu uma pessoa da equipe',
    'team.member.left': 'saiu da equipe',
    'team.invitation.created': `criou um convite para ${String(details.email ?? '')}`,
    'team.invitation.revoked': 'revogou um convite',
    'team.invitation.accepted': 'aceitou o convite da equipe',
    'document.created': `criou o projeto “${String(details.name ?? '')}”`,
    'document.deleted': `excluiu permanentemente o projeto “${String(details.name ?? '')}”`,
    'document.updated': `atualizou um projeto (revisão ${String(details.revision ?? '')})`,
    'document.operation': `editou um projeto (${String(details.operation ?? '')})`,
    'document.permission.granted': `concedeu ${String(details.role ?? '')} a ${String(details.email ?? '')}`,
    'document.permission.revoked': 'removeu acesso a um projeto',
    'document.invitation.created': `convidou ${String(details.email ?? '')} para um projeto`,
    'document.comment.created': 'adicionou um comentário',
    'document.comment.replied': 'respondeu a um comentário',
    'document.comment.resolved': 'resolveu um comentário',
    'document.comment.reopened': 'reabriu um comentário',
    'document.presentation.started': `iniciou uma apresentação no slide ${String(Number(details.pageIndex ?? 0) + 1)}`,
    'document.presentation.slide_changed': `avançou para o slide ${String(Number(details.pageIndex ?? 0) + 1)}`,
    'document.presentation.ended': 'encerrou uma apresentação',
  }
  return labels[action] ?? action
}

function readImageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível carregar este arquivo.'))
    reader.onerror = () => reject(new Error('Não foi possível carregar este arquivo.'))
    reader.readAsDataURL(file)
  })
}

function readTimelineMediaMetadata(file: File): Promise<{ width: number; height: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const isVideo = file.type.startsWith('video/')
    const media = isVideo ? document.createElement('video') : document.createElement('audio')
    const source = URL.createObjectURL(file)
    const cleanup = () => { media.onloadedmetadata = null; media.onerror = null; URL.revokeObjectURL(source); media.removeAttribute('src'); media.load() }
    media.preload = 'metadata'
    media.onloadedmetadata = () => {
      const durationMs = Math.round(media.duration * 1000)
      const width = isVideo ? (media as HTMLVideoElement).videoWidth : 1
      const height = isVideo ? (media as HTMLVideoElement).videoHeight : 1
      cleanup()
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 86_400_000 || width <= 0 || height <= 0 || width * height > 32_000_000) {
        reject(new Error('A mídia excede os limites de duração ou resolução suportados.'))
        return
      }
      resolve({ width, height, durationMs })
    }
    media.onerror = () => { cleanup(); reject(new Error('Não foi possível decodificar este vídeo ou áudio no navegador.')) }
    media.src = source
  })
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Não foi possível decodificar esta imagem.'))
    image.src = src
  })
}

type EditorState = {
  document: DesignDocument
  pageIndex: number
  selectedId: string | null
  selectedIds: string[]
  undoStack: DesignDocument[]
  redoStack: DesignDocument[]
}

type AccessibilityIssue = {
  id: string
  pageId: string
  pageIndex: number
  pageName: string
  elementId: string
  elementName: string
  kind: 'alt' | 'typography'
  title: string
  detail: string
}

type Action =
  | { type: 'load'; document: DesignDocument }
  | { type: 'select'; id: string | null; ids?: string[] }
  | { type: 'page'; index: number }
  | { type: 'change'; update: (document: DesignDocument) => DesignDocument }
  | { type: 'record-undo' }
  | { type: 'sync'; document: DesignDocument }
  | { type: 'undo' }
  | { type: 'redo' }

const EMPTY_DOC_BLOCKS: DocBlock[] = []
const EMPTY_SHEET_MERGES: NonNullable<DesignPage['cellMerges']> = []
const EMPTY_SHEET_FORMATS: NonNullable<DesignPage['cellFormats']> = {}

function SpreadsheetChartView({ chart, values }: { chart: SheetChart; values: string[][] }) {
  const points = getSheetChartPoints(chart, values)
  const domain = getSheetChartDomain(points)
  const width = 720, height = 330, left = 56, right = 18, top = 24, bottom = 58
  const plotWidth = width - left - right, plotHeight = height - top - bottom
  const y = (value: number) => top + (domain.max - value) / (domain.max - domain.min) * plotHeight
  const zeroY = y(0)
  const categoryCount = Math.max(0, chart.range.endRow - chart.range.startRow)
  const seriesCount = Math.max(1, chart.range.endColumn - chart.range.startColumn)
  const categories = Array.from({ length: categoryCount }, (_, index) => values[chart.range.startRow + index + 1]?.[chart.range.startColumn]?.trim() || `Linha ${index + 2}`)
  const series = Array.from({ length: seriesCount }, (_, index) => values[chart.range.startRow]?.[chart.range.startColumn + index + 1]?.trim() || `Série ${index + 1}`)
  const colors = ['#7d2ae8', '#00a89d', '#ff8a00', '#e84d88', '#2d7ff9', '#7f8c2e']
  const pointAt = (seriesIndex: number, rowIndex: number) => points.find(point => point.seriesIndex === seriesIndex && point.rowIndex === rowIndex)
  return <figure className="sheet-chart" aria-label={`Gráfico ${chart.type === 'bar' ? 'de barras' : 'de linhas'}: ${chart.title}`}>
    <figcaption>{chart.title || 'Gráfico sem título'}</figcaption>
    {points.length ? <div className="sheet-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chart.type === 'bar' ? 'Gráfico de barras' : 'Gráfico de linhas'} com ${categories.length} categorias e ${series.length} séries`}>
      {[0, 1, 2, 3, 4].map(index => { const value = domain.min + (domain.max - domain.min) * index / 4; const lineY = y(value); return <g key={index}><line x1={left} x2={width - right} y1={lineY} y2={lineY} stroke="#e7e5eb" /><text x={left - 8} y={lineY + 4} textAnchor="end" className="chart-tick">{Number(value.toFixed(1))}</text></g> })}
      {chart.type === 'bar' ? categories.map((label, rowIndex) => {
        const groupWidth = plotWidth / Math.max(1, categoryCount)
        const barWidth = Math.min(42, groupWidth * .72 / seriesCount)
        return <g key={`${label}-${rowIndex}`}>{series.map((seriesName, seriesIndex) => { const point = pointAt(seriesIndex, rowIndex); if (!point) return null; const barX = left + groupWidth * rowIndex + groupWidth * .14 + seriesIndex * barWidth; const barY = Math.min(y(point.value), zeroY); const barHeight = Math.max(1, Math.abs(y(point.value) - zeroY)); return <rect key={seriesName} x={barX} y={barY} width={barWidth - 2} height={barHeight} rx="3" fill={colors[seriesIndex % colors.length]}><title>{`${label} - ${seriesName}: ${point.value}`}</title></rect> })}<text x={left + groupWidth * (rowIndex + .5)} y={height - 28} textAnchor="middle" className="chart-tick">{label.slice(0, 14)}</text></g>
      }) : series.map((seriesName, seriesIndex) => {
        const coords = categories.map((_, rowIndex) => { const point = pointAt(seriesIndex, rowIndex); if (!point) return null; const x = left + plotWidth * (rowIndex + .5) / Math.max(1, categoryCount); return { x, y: y(point.value), point } }).filter((point): point is { x: number; y: number; point: NonNullable<ReturnType<typeof pointAt>> } => Boolean(point))
        return <g key={seriesName}><polyline points={coords.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{coords.map(({ x, y: pointY, point }) => <circle key={point.rowIndex} cx={x} cy={pointY} r="4" fill={colors[seriesIndex % colors.length]}><title>{`${point.label} - ${seriesName}: ${point.value}`}</title></circle>)}</g>
      })}
      {chart.type === 'line' && categories.map((label, index) => <text key={`${label}-${index}`} x={left + plotWidth * (index + .5) / Math.max(1, categoryCount)} y={height - 28} textAnchor="middle" className="chart-tick">{label.slice(0, 14)}</text>)}
      {series.map((seriesName, index) => <g key={`legend-${seriesName}`}><rect x={left + index * 140} y={height - 12} width="10" height="10" rx="2" fill={colors[index % colors.length]} /><text x={left + 15 + index * 140} y={height - 3} className="chart-legend">{seriesName.slice(0, 18)}</text></g>)}
    </svg></div> : <p className="sheet-chart-empty">Nenhum valor numérico válido nessa faixa. Edite as células para atualizar o gráfico.</p>}
  </figure>
}

function SpreadsheetEditorPanel({ page, pageIndex, pages, canEdit, change, onSheetOperation, onSelectSheet, onAddSheet, onDeleteSheet, onRenameSheet }: { page: DesignPage; pageIndex: number; pages: DesignPage[]; canEdit: boolean; change: (update: (document: DesignDocument) => DesignDocument) => void; onSheetOperation?: (pageId: string, operation: SheetOperation) => void; onSelectSheet: (index: number) => void; onAddSheet: () => void; onDeleteSheet: () => void; onRenameSheet: (name: string) => boolean }) {
  const cells = page.cells ?? Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => ''))
  const merges = page.cellMerges ?? EMPTY_SHEET_MERGES
  const formats = page.cellFormats ?? EMPTY_SHEET_FORMATS
  const { values, errors } = useMemo(() => evaluateSheet(cells, merges, pages.map(sheet => ({ name: sheet.name, cells: sheet.cells ?? [], merges: sheet.cellMerges })), page.name), [cells, merges, pages, page.name])
  const [range, setRange] = useState({ anchorRow: 0, anchorColumn: 0, focusRow: 0, focusColumn: 0 })
  const selected = { row: range.focusRow, column: range.focusColumn }
  const [draft, setDraft] = useState<string | null>(null)
  const [mergeNotice, setMergeNotice] = useState('')
  const [cellContextMenu, setCellContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar')
  const charts = page.charts ?? []
  const inputRef = useRef<HTMLInputElement>(null)
  const cellContextMenuRef = useRef<HTMLDivElement>(null)
  const cellContextMenuTriggerRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const preserveRangeOnFocusRef = useRef(false)
  const rowCount = Math.max(30, cells.length)
  const columnCount = Math.max(12, ...cells.map(row => row.length))
  const raw = cells[selected.row]?.[selected.column] ?? ''
  const address = `${columnLabel(selected.column)}${selected.row + 1}`
  const selectedRange = { start: Math.min(range.anchorColumn, range.focusColumn), end: Math.max(range.anchorColumn, range.focusColumn) }
  const hasSelectedRange = range.anchorRow !== range.focusRow || range.anchorColumn !== range.focusColumn
  const selectedRowStart = Math.min(range.anchorRow, range.focusRow)
  const selectedRowEnd = Math.max(range.anchorRow, range.focusRow)
  const selectedColumnStart = Math.min(range.anchorColumn, range.focusColumn)
  const selectedColumnEnd = Math.max(range.anchorColumn, range.focusColumn)
  const canMergeRange = selectedRowEnd > selectedRowStart || selectedRange.end > selectedRange.start
  const chartRangeValid = selectedRowEnd > selectedRowStart && selectedColumnEnd > selectedColumnStart && (selectedRowEnd - selectedRowStart + 1) * (selectedColumnEnd - selectedColumnStart + 1) <= 2000
  const activeMerge = merges.find(merge => selected.row >= merge.row && selected.row < merge.row + (merge.rowSpan ?? 1) && selected.column >= merge.column && selected.column < merge.column + merge.colSpan)
  const appendRow = () => {
    onSheetOperation?.(page.id, { type: 'sheet.rows.append' })
    change(document => updatePage(document, pageIndex, current => ({ ...current, cells: [...(current.cells ?? cells), Array.from({ length: columnCount }, () => '')] })))
  }
  const appendColumn = () => {
    onSheetOperation?.(page.id, { type: 'sheet.columns.append' })
    change(document => updatePage(document, pageIndex, current => ({ ...current, cells: (current.cells ?? cells).map(row => [...Array.from({ length: columnCount }, (_, column) => row[column] ?? ''), '']) })))
  }
  const commit = (row: number, column: number, value: string) => {
    change(document => updatePage(document, pageIndex, current => ({ ...current, cells: setSheetCell(current.cells ?? cells, row, column, value) })))
    onSheetOperation?.(page.id, { type: 'sheet.cells.set', cells: [{ row, column, value }] })
  }
  const setActiveCell = (row: number, column: number) => setRange({ anchorRow: row, anchorColumn: column, focusRow: row, focusColumn: column })
  const storeChart = (chartId: string, chart: SheetChart | null) => {
    change(document => updatePage(document, pageIndex, current => ({ ...current, charts: chart ? (current.charts ?? []).some(item => item.id === chartId) ? (current.charts ?? []).map(item => item.id === chartId ? chart : item) : [...(current.charts ?? []), chart] : (current.charts ?? []).filter(item => item.id !== chartId) })))
    onSheetOperation?.(page.id, { type: 'sheet.chart.set', chartId, chart })
  }
  const createChart = () => {
    if (!canEdit || !chartRangeValid) return
    const chart: SheetChart = { id: createId('sheet-chart'), type: chartType, title: 'Gráfico', range: { startRow: selectedRowStart, startColumn: selectedColumnStart, endRow: selectedRowEnd, endColumn: selectedColumnEnd } }
    storeChart(chart.id, chart)
    setMergeNotice('Gráfico criado. Os dados acompanham as células da faixa selecionada.')
  }
  const mergeSelection = () => {
    const next = mergeSheetRange(cells, merges, range)
    if (!next) { setMergeNotice('A mesclagem exige uma faixa vazia, contígua e sem sobreposição.'); return }
    const expandedCells = setSheetCell(cells, selectedRowEnd, selectedRange.end, cells[selectedRowEnd]?.[selectedRange.end] ?? '')
    change(document => updatePage(document, pageIndex, current => ({ ...current, cells: expandedCells, cellMerges: next })))
    const merge = next.find(item => item.row === selectedRowStart && item.column === selectedRange.start)
    if (merge) onSheetOperation?.(page.id, { type: 'sheet.merge.set', merge })
    setActiveCell(selectedRowStart, selectedRange.start)
    setMergeNotice('Faixa mesclada.')
  }
  const unmergeSelection = () => {
    const next = unmergeSheetCell(merges, selected.row, selected.column)
    if (!next) return
    onSheetOperation?.(page.id, { type: 'sheet.merge.remove', row: selected.row, column: selected.column })
    change(document => updatePage(document, pageIndex, current => ({ ...current, cellMerges: next })))
    setMergeNotice('Faixa desfeita; o conteúdo permanece na célula inicial.')
  }
  const showCellContextMenu = (row: number, column: number, x: number, y: number, trigger: HTMLInputElement) => {
    const insideCurrentSelection = row >= selectedRowStart && row <= selectedRowEnd && column >= selectedRange.start && column <= selectedRange.end
    if (!insideCurrentSelection) setActiveCell(row, column)
    cellContextMenuTriggerRef.current = trigger
    setCellContextMenu({ x, y })
  }
  const closeCellContextMenu = (restoreFocus = false) => {
    setCellContextMenu(null)
    if (restoreFocus) {
      preserveRangeOnFocusRef.current = true
      requestAnimationFrame(() => cellContextMenuTriggerRef.current?.focus())
    }
  }
  const handleCellContextMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeCellContextMenu(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    if (!items.length) return
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[nextIndex]?.focus()
  }
  useEffect(() => {
    if (!cellContextMenu) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.sheet-cell-context-menu')) return
      setCellContextMenu(null)
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    requestAnimationFrame(() => cellContextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [cellContextMenu])
  const applyNumberFormat = (format: SheetNumberFormat) => {
    const top = Math.min(range.anchorRow, range.focusRow)
    const bottom = Math.max(range.anchorRow, range.focusRow)
    const left = Math.min(range.anchorColumn, range.focusColumn)
    const right = Math.max(range.anchorColumn, range.focusColumn)
    onSheetOperation?.(page.id, { type: 'sheet.formats.set', formats: Array.from({ length: bottom - top + 1 }, (_, rowOffset) => Array.from({ length: right - left + 1 }, (_, columnOffset) => ({ row: top + rowOffset, column: left + columnOffset, value: format }))).flat() })
    change(document => updatePage(document, pageIndex, current => {
    const next = { ...(current.cellFormats ?? formats) }
    for (let row = top; row <= bottom; row += 1) for (let column = left; column <= right; column += 1) {
      const key = `${row}:${column}`
      if (format === 'default') delete next[key]
      else next[key] = format
    }
    return { ...current, cellFormats: next }
    }))
  }
  const fillRangeDown = () => {
    if (!hasSelectedRange || merges.some(merge => selectedRowStart < merge.row + (merge.rowSpan ?? 1) && selectedRowEnd + 1 > merge.row && selectedRange.start < merge.column + merge.colSpan && selectedRange.end + 1 > merge.column)) return
    const nextCells = fillSheetDown(cells, range)
    const top = Math.min(range.anchorRow, range.focusRow)
    const bottom = Math.max(range.anchorRow, range.focusRow)
    const left = Math.min(range.anchorColumn, range.focusColumn)
    const right = Math.max(range.anchorColumn, range.focusColumn)
    const operations = Array.from({ length: bottom - top + 1 }, (_, rowOffset) => Array.from({ length: right - left + 1 }, (_, columnOffset) => ({ row: top + rowOffset, column: left + columnOffset, value: nextCells[top + rowOffset]?.[left + columnOffset] ?? '' }))).flat()
    change(document => updatePage(document, pageIndex, current => ({ ...current, cells: nextCells })))
    onSheetOperation?.(page.id, { type: 'sheet.cells.set', cells: operations })
  }
  const moveTo = (row: number, column: number) => {
    const next = { row: Math.max(0, Math.min(rowCount - 1, row)), column: Math.max(0, Math.min(columnCount - 1, column)) }
    setActiveCell(next.row, next.column)
    setDraft(null)
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-sheet-cell="${next.row}:${next.column}"]`)?.focus())
  }
  const commitSheetName = () => {
    const input = renameInputRef.current
    if (input) {
      const accepted = onRenameSheet(input.value)
      setMergeNotice(accepted ? 'Nome da planilha salvo.' : 'Esse nome já existe ou é inválido.')
      if (!accepted) input.value = page.name
    }
  }
  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, row: number, column: number) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      showCellContextMenu(row, column, bounds.left, bounds.bottom, event.currentTarget)
      return
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      // Drop the cell's transient edit buffer before the editor-level history
      // reducer restores the committed document snapshot.
      setDraft(null)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      if (draft !== null) commit(row, column, draft)
      setActiveCell(Math.max(0, Math.min(rowCount - 1, row + (event.key === 'Enter' || !event.shiftKey ? 1 : -1))), Math.max(0, Math.min(columnCount - 1, column + (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0))))
      setDraft(null)
      requestAnimationFrame(() => {
        const nextRow = Math.max(0, Math.min(rowCount - 1, row + (event.key === 'Enter' || !event.shiftKey ? 1 : -1)))
        const nextColumn = Math.max(0, Math.min(columnCount - 1, column + (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0)))
        document.querySelector<HTMLInputElement>(`[data-sheet-cell="${nextRow}:${nextColumn}"]`)?.focus()
      })
    } else if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      const nextRow = Math.max(0, Math.min(rowCount - 1, row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)))
      const nextColumn = Math.max(0, Math.min(columnCount - 1, column + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)))
      setRange(current => ({ ...current, focusRow: nextRow, focusColumn: nextColumn }))
      preserveRangeOnFocusRef.current = true
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-sheet-cell="${nextRow}:${nextColumn}"]`)?.focus())
    } else if (event.key === 'Escape') {
      setDraft(null)
      event.currentTarget.blur()
    }
  }
  const handleCellCopy = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const [focusedRow, focusedColumn] = (event.currentTarget.dataset.sheetCell ?? '').split(':').map(Number)
    const hasFocusedCell = Number.isInteger(focusedRow) && Number.isInteger(focusedColumn)
    const top = hasSelectedRange ? Math.min(range.anchorRow, range.focusRow) : hasFocusedCell ? focusedRow : range.focusRow
    const bottom = hasSelectedRange ? Math.max(range.anchorRow, range.focusRow) : hasFocusedCell ? focusedRow : range.focusRow
    const left = hasSelectedRange ? Math.min(range.anchorColumn, range.focusColumn) : hasFocusedCell ? focusedColumn : range.focusColumn
    const right = hasSelectedRange ? Math.max(range.anchorColumn, range.focusColumn) : hasFocusedCell ? focusedColumn : range.focusColumn
    const copied = Array.from({ length: bottom - top + 1 }, (_, rowOffset) => Array.from({ length: right - left + 1 }, (_, columnOffset) => cells[top + rowOffset]?.[left + columnOffset] ?? ''))
    const visible = Array.from({ length: bottom - top + 1 }, (_, rowOffset) => Array.from({ length: right - left + 1 }, (_, columnOffset) => values[top + rowOffset]?.[left + columnOffset] ?? ''))
    try {
      event.clipboardData.setData('text/plain', visible.map(line => line.join('\t')).join('\n'))
      event.clipboardData.setData('application/x-fuse-studio-sheet-range+json', JSON.stringify({ version: 1, sourceRow: top, sourceColumn: left, cells: copied }))
      event.preventDefault()
    } catch {
      // Keep the browser's native single-cell copy when clipboard formats are restricted.
    }
  }
  const handleCellPaste = (event: React.ClipboardEvent<HTMLInputElement>, row: number, column: number) => {
    const text = event.clipboardData.getData('text/plain')
    let matrix: string[][]
    const internal = event.clipboardData.getData('application/x-fuse-studio-sheet-range+json')
    if (internal) {
      try {
        const payload = JSON.parse(internal) as { version?: number; sourceRow?: number; sourceColumn?: number; cells?: unknown }
        if (payload.version === 1 && Number.isInteger(payload.sourceRow) && Number.isInteger(payload.sourceColumn) && Array.isArray(payload.cells) && payload.cells.every(line => Array.isArray(line) && line.every(value => typeof value === 'string'))) {
          matrix = translateCopiedSheetRange(payload.cells as string[][], payload.sourceRow!, payload.sourceColumn!, row, column)
        } else return
      } catch { return }
    } else {
      if (!text.includes('\t') && !/[\r\n]/.test(text)) return
      matrix = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'))
    }
    event.preventDefault()
    if (!matrix.length || matrix.length > 1000 || matrix.some(line => line.length > 200) || row + matrix.length > 1000 || column + Math.max(...matrix.map(line => line.length)) > 200) return
    change(document => updatePage(document, pageIndex, current => ({ ...current, cells: pasteSheetRange(current.cells ?? cells, row, column, matrix) })))
    onSheetOperation?.(page.id, { type: 'sheet.cells.set', cells: matrix.flatMap((line, rowOffset) => line.map((value, columnOffset) => ({ row: row + rowOffset, column: column + columnOffset, value }))) })
    setActiveCell(row, column)
    setDraft(matrix[0]?.[0] ?? '')
  }
  return <section className="sheet-editor" aria-label="Editor de planilha">
    <nav className="sheet-tabs" aria-label="Abas da planilha">{pages.map((sheet, index) => <button type="button" key={sheet.id} className={index === pageIndex ? 'active' : ''} aria-current={index === pageIndex ? 'page' : undefined} onClick={() => onSelectSheet(index)}>{sheet.name || `Planilha ${index + 1}`}</button>)}<button type="button" className="sheet-add-tab" disabled={!canEdit || pages.length >= 100} onClick={onAddSheet} aria-label="Adicionar planilha"><Plus size={15} aria-hidden="true" /></button><button type="button" className="sheet-delete-tab" disabled={!canEdit || pages.length <= 1} onClick={onDeleteSheet} aria-label="Excluir planilha atual">Excluir aba</button><label className="sheet-rename-tab">Nome da aba<input ref={renameInputRef} key={page.id} aria-label="Nome da planilha" defaultValue={page.name} maxLength={31} disabled={!canEdit} onKeyDown={event => { if (event.key === 'Enter') commitSheetName() }} /></label><button type="button" className="sheet-save-name" onClick={commitSheetName} disabled={!canEdit} aria-label="Salvar nome da planilha">Salvar</button></nav>
    <div className="sheet-toolbar"><div className="sheet-name"><span className="panel-kicker">PLANILHA</span><strong>{page.name || `Planilha ${pageIndex + 1}`}</strong></div><div className="sheet-formula-bar"><span className="sheet-address">{address}</span><span className="sheet-fx">fx</span><input aria-label={`Conteúdo da célula ${address}`} value={draft ?? raw} disabled={!canEdit} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== null && draft !== raw) commit(selected.row, selected.column, draft); setDraft(null) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDraft(null) } else if (event.key === 'Enter') { event.preventDefault(); if (draft !== null) commit(selected.row, selected.column, draft); moveTo(selected.row + 1, selected.column) } }} /></div><div className="sheet-actions"><button type="button" disabled={!canEdit || cells.length >= 1000} onClick={appendRow}><Plus size={13} aria-hidden="true" /> Linha</button><button type="button" disabled={!canEdit || columnCount >= 200} onClick={appendColumn}><Plus size={13} aria-hidden="true" /> Coluna</button><button type="button" disabled={!canEdit || !canMergeRange} onClick={mergeSelection}>Mesclar faixa</button><button type="button" disabled={!canEdit || !activeMerge} onClick={unmergeSelection}>Desfazer mesclagem</button><button type="button" disabled={!canEdit || !hasSelectedRange} onClick={fillRangeDown}>Preencher para baixo</button><label className="sheet-format-control">Formato de números<select aria-label="Formato de números" value={formats[`${selected.row}:${selected.column}`] ?? 'default'} disabled={!canEdit} onChange={event => applyNumberFormat(event.target.value as SheetNumberFormat)}><option value="default">Padrão</option><option value="percentage">Porcentagem</option><option value="currency">Moeda</option><option value="date">Data</option><option value="time">Hora</option><option value="datetime">Data e hora</option></select></label><span role="status">{mergeNotice || (errors.length ? `${errors.length} tipo(s) de erro na planilha` : 'Todas as alterações são salvas automaticamente')}</span></div></div>
    <div className="sheet-grid-scroll"><table className="sheet-grid"><thead><tr><th className="sheet-corner" />{Array.from({ length: columnCount }, (_, column) => <th key={column} scope="col">{columnLabel(column)}</th>)}</tr></thead><tbody>{Array.from({ length: rowCount }, (_, row) => <tr key={row}><th scope="row" className="sheet-row-number">{row + 1}</th>{Array.from({ length: columnCount }, (_, column) => {
      const isActive = selected.row === row && selected.column === column
      const isCovered = merges.some(merge => row >= merge.row && row < merge.row + (merge.rowSpan ?? 1) && column >= merge.column && column < merge.column + merge.colSpan && (row !== merge.row || column !== merge.column))
      if (isCovered) return null
      const merge = merges.find(item => item.row === row && item.column === column)
      const isInSelection = row >= Math.min(range.anchorRow, range.focusRow) && row <= Math.max(range.anchorRow, range.focusRow) && column >= selectedRange.start && column <= selectedRange.end
      const cellAddress = `${columnLabel(column)}${row + 1}`
      const cellValue = values[row]?.[column] ?? ''
      const cellError = typeof cellValue === 'string' && cellValue.startsWith('#') ? cellValue : null
      const cellErrorId = cellError ? `sheet-cell-error-${row}-${column}` : undefined
      const displayValue = formatSheetCellValue(cellValue, formats[`${row}:${column}`])
      return <td key={column} colSpan={merge?.colSpan ?? 1} rowSpan={merge?.rowSpan ?? 1} className={`${isActive ? 'sheet-cell-active' : ''}${isInSelection ? ' sheet-cell-range' : ''}${cellError ? ' sheet-cell-error' : ''}`}>
        <input ref={isActive ? inputRef : undefined} data-sheet-cell={`${row}:${column}`} data-formula-error-code={cellError ?? undefined} aria-label={cellAddress} aria-invalid={cellError ? true : undefined} aria-describedby={cellErrorId} title={cellError ? `Erro de fórmula: ${cellError}` : undefined} value={isActive && draft !== null ? draft : displayValue} disabled={!canEdit} onCopy={event => handleCellCopy(event)} onPaste={event => handleCellPaste(event, row, column)} onMouseDown={event => { if (event.shiftKey) preserveRangeOnFocusRef.current = true }} onContextMenu={event => { event.preventDefault(); showCellContextMenu(row, column, event.clientX, event.clientY, event.currentTarget) }} onFocus={() => { if (preserveRangeOnFocusRef.current) { preserveRangeOnFocusRef.current = false; setRange(current => ({ ...current, focusRow: row, focusColumn: column })) } else setActiveCell(row, column); setDraft(cells[row]?.[column] ?? '') }} onClick={event => { if (event.shiftKey) setRange(current => ({ ...current, focusRow: row, focusColumn: column })) }} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== null && draft !== (cells[row]?.[column] ?? '')) commit(row, column, draft); setDraft(null) }} onKeyDown={event => handleCellKeyDown(event, row, column)} />
        {cellError && <><span className="sheet-error-indicator" aria-hidden="true"><CircleAlert size={12} strokeWidth={2.5} aria-hidden="true" /></span><span id={cellErrorId} className="visually-hidden">Erro de fórmula: {cellError}</span></>}
      </td>
    })}</tr>)}</tbody></table></div>
    {cellContextMenu && <div ref={cellContextMenuRef} className="sheet-cell-context-menu" role="menu" aria-label="Menu de contexto da planilha" style={{ left: Math.max(8, Math.min(cellContextMenu.x, window.innerWidth - 236)), top: Math.max(8, Math.min(cellContextMenu.y, window.innerHeight - 92)) }} onKeyDown={handleCellContextMenuKeyDown}>
      <button type="button" role="menuitem" disabled={!canEdit || !canMergeRange} onClick={() => { const anchor = { row: selectedRowStart, column: selectedRange.start }; mergeSelection(); closeCellContextMenu(); preserveRangeOnFocusRef.current = true; requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-sheet-cell="${anchor.row}:${anchor.column}"]`)?.focus()) }}>Mesclar células</button>
      <button type="button" role="menuitem" disabled={!canEdit || !activeMerge} onClick={() => { unmergeSelection(); closeCellContextMenu(true) }}>Desfazer mesclagem de célula</button>
    </div>}
    <section className="sheet-charts" aria-label="Gráficos da planilha">
      <div className="sheet-chart-toolbar"><div><strong>Gráficos</strong><p>Selecione uma faixa com cabeçalhos na primeira linha e categorias na primeira coluna.</p></div><label>Tipo<select aria-label="Tipo do novo gráfico" value={chartType} disabled={!canEdit} onChange={event => setChartType(event.target.value as 'bar' | 'line')}><option value="bar">Barras</option><option value="line">Linhas</option></select></label><button type="button" className="primary-button" disabled={!canEdit || !chartRangeValid || charts.length >= 100} onClick={createChart}>Criar gráfico da seleção</button></div>
      {!chartRangeValid && <p className="sheet-chart-hint" role="status">Para criar um gráfico, selecione pelo menos duas linhas e duas colunas na grade.</p>}
      <div className="sheet-chart-list">{charts.map(chart => <article className="sheet-chart-card" key={chart.id}>
        <div className="sheet-chart-controls"><label>Título<input aria-label={`Título do gráfico ${chart.title}`} defaultValue={chart.title} maxLength={120} disabled={!canEdit} onBlur={event => { const title = event.currentTarget.value; if (title !== chart.title) storeChart(chart.id, { ...chart, title }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label><label>Tipo<select aria-label={`Tipo do gráfico ${chart.title}`} value={chart.type} disabled={!canEdit} onChange={event => storeChart(chart.id, { ...chart, type: event.target.value as 'bar' | 'line' })}><option value="bar">Barras</option><option value="line">Linhas</option></select></label><button type="button" disabled={!canEdit} onClick={() => storeChart(chart.id, null)} aria-label={`Excluir gráfico ${chart.title}`}>Excluir</button></div>
        <SpreadsheetChartView chart={chart} values={values} />
      </article>)}</div>
    </section>
  </section>
}

function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'load':
      return { document: action.document, pageIndex: 0, selectedId: null, selectedIds: [], undoStack: [], redoStack: [] }
    case 'select':
      return { ...state, selectedId: action.id, selectedIds: action.ids ?? (action.id ? [action.id] : []) }
    case 'page':
      return { ...state, pageIndex: Math.max(0, Math.min(action.index, state.document.pages.length - 1)), selectedId: null, selectedIds: [] }
    case 'change':
      return { ...state, ...recordDocumentChange(state, action.update(state.document)) }
    case 'record-undo':
      return { ...state, ...recordDocumentCheckpoint(state) }
    case 'sync':
      return { ...state, document: action.document }
    case 'undo': {
      if (state.undoStack.length === 0) return state
      return { ...state, ...undoDocumentChange(state), selectedId: null, selectedIds: [] }
    }
    case 'redo': {
      if (state.redoStack.length === 0) return state
      return { ...state, ...redoDocumentChange(state), selectedId: null, selectedIds: [] }
    }
  }
}

function updatePage(document: DesignDocument, pageIndex: number, update: (page: DesignPage) => DesignPage): DesignDocument {
  const pages = [...document.pages]
  pages[pageIndex] = update(pages[pageIndex])
  return { ...document, pages, updatedAt: new Date().toISOString() }
}

function updateElement(document: DesignDocument, pageIndex: number, elementId: string, update: (element: DesignElement) => DesignElement): DesignDocument {
  return updatePage(document, pageIndex, page => ({
    ...page,
    elements: page.elements.map(element => element.id === elementId ? update(element) : element),
  }))
}

function ImageNode({ element, register, onSelect, onMove, onTransform, canEdit, compareOriginal = false, animationProgress = 1 }: {
  element: ImageElement
  register: (id: string, node: Konva.Node | null) => void
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onMove: (x: number, y: number) => void
  onTransform: (node: Konva.Node) => void
  canEdit: boolean
  compareOriginal?: boolean
  animationProgress?: number
}) {
  const [image, setImage] = useState<HTMLImageElement | undefined>()
  const [brightnessFilter, setBrightnessFilter] = useState<Konva.Filter | null>(null)
  const imageNodeRef = useRef<Konva.Image>(null)
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const dragCancelledRef = useRef(false)
  const renderedElement = compareOriginal ? { ...element, brightness: 0, contrast: 0, saturation: 0, opacity: 100, flipX: false, flipY: false, filterPreset: undefined, imageStylePreset: undefined, maskStrokes: [] } : element
  const selectedImageFilter = useMemo(() => renderedElement.filterPreset ? createImageFilter(renderedElement.filterPreset) : null, [renderedElement.filterPreset])
  const selectedImageStyleFilter = useMemo(() => renderedElement.imageStylePreset ? createImageStyleFilter(renderedElement.imageStylePreset) : null, [renderedElement.imageStylePreset])
  const selectedColorAdjustmentFilter = useMemo(() => createImageColorAdjustmentFilter(renderedElement.contrast ?? 0, renderedElement.saturation ?? 0), [renderedElement.contrast, renderedElement.saturation])
  const selectedImageMask = useMemo(() => createImageMaskFilter(renderedElement.maskStrokes ?? [], element.width, element.height), [renderedElement.maskStrokes, element.width, element.height])

  useEffect(() => {
    const source = new window.Image()
    source.onload = () => setImage(source)
    source.src = element.src
    return () => { source.onload = null }
  }, [element.src])

  useEffect(() => {
    setBrightnessFilter(() => (renderedElement.brightness ?? 0) === 0 ? null : Konva.Filters.Brightness)
  }, [renderedElement.brightness])

  useEffect(() => {
    const node = imageNodeRef.current
    if (!node || !image) return
    if ((renderedElement.brightness ?? 0) !== 0 || selectedImageFilter || selectedImageStyleFilter || selectedImageMask || selectedColorAdjustmentFilter) node.cache()
    else node.clearCache()
    node.getLayer()?.batchDraw()
  }, [renderedElement.brightness, selectedImageFilter, selectedImageStyleFilter, selectedImageMask, selectedColorAdjustmentFilter, image])

  const animation = compareOriginal ? null : renderedElement.animation
  const boundedProgress = Math.max(0, Math.min(1, animationProgress))
  const easedProgress = 1 - Math.pow(1 - boundedProgress, 3)
  const entering = animation?.phase === 'enter'
  const animationAmount = animation ? (entering ? 1 - easedProgress : easedProgress) : 0
  const directionalDistance = (animation?.direction === 'left' || animation?.direction === 'right' ? element.width : element.height) * .35
  const animatedX = animation?.direction === 'left' ? -directionalDistance * animationAmount : animation?.direction === 'right' ? directionalDistance * animationAmount : 0
  const animatedY = animation?.direction === 'up' ? -directionalDistance * animationAmount : animation?.direction === 'down' ? directionalDistance * animationAmount : 0
  const visibility = animation ? entering ? easedProgress : 1 - easedProgress : 1
  return <KonvaImage
    ref={node => { imageNodeRef.current = node; register(element.id, node) }}
    image={image}
    crop={renderedElement.crop ?? undefined}
    x={element.x + animatedX}
    y={element.y + animatedY}
    width={element.width}
    height={element.height}
    rotation={element.rotation}
    opacity={Math.max(0, Math.min(100, renderedElement.opacity ?? 100)) / 100 * visibility}
    filters={[...(selectedImageMask ? [selectedImageMask] : []), ...(renderedElement.filterPreset && selectedImageFilter ? [selectedImageFilter] : []), ...(selectedImageStyleFilter ? [selectedImageStyleFilter] : []), ...(selectedColorAdjustmentFilter ? [selectedColorAdjustmentFilter] : []), ...((renderedElement.brightness ?? 0) !== 0 && brightnessFilter ? [brightnessFilter] : [])]}
    brightness={1 + (renderedElement.brightness ?? 0) / 100}
    scaleX={renderedElement.flipX ? -1 : 1}
    scaleY={renderedElement.flipY ? -1 : 1}
    offsetX={renderedElement.flipX ? element.width : 0}
    offsetY={renderedElement.flipY ? element.height : 0}
    draggable={canEdit && (!animation || boundedProgress >= 1)}
    listening={canEdit && (!animation || boundedProgress >= 1)}
    onClick={event => onSelect(event as Konva.KonvaEventObject<MouseEvent | TouchEvent>)}
    onTap={event => onSelect(event as Konva.KonvaEventObject<MouseEvent | TouchEvent>)}
    onDragStart={event => { dragOriginRef.current = { x: event.target.x(), y: event.target.y() }; dragCancelledRef.current = false }}
    onTouchCancel={event => {
      dragCancelledRef.current = true
      const origin = dragOriginRef.current ?? { x: element.x, y: element.y }
      event.target.position(origin)
      event.target.getLayer()?.batchDraw()
    }}
    onPointerCancel={event => {
      dragCancelledRef.current = true
      const origin = dragOriginRef.current ?? { x: element.x, y: element.y }
      event.target.position(origin)
      event.target.getLayer()?.batchDraw()
    }}
    onDragEnd={event => {
      const cancelled = dragCancelledRef.current || event.evt.type === 'touchcancel' || event.evt.type === 'pointercancel'
      const origin = dragOriginRef.current ?? { x: element.x, y: element.y }
      if (cancelled) {
        event.target.position(origin)
        event.target.getLayer()?.batchDraw()
      } else onMove(event.target.x(), event.target.y())
      dragOriginRef.current = null
      dragCancelledRef.current = false
    }}
    onTransformEnd={event => onTransform(event.target)}
  />
}

const IMAGE_SCOPE_OPTIONS = ['Tudo', 'Elemento', 'Área', 'Primeiro plano', 'Fundo', 'Texto']
const IMAGE_SCOPE_ICONS = [Layers, MousePointer2, Focus, ScanFace, Square, Type] as const
const IMAGE_FILTER_LABELS: Record<ImageFilterPreset, string> = { soft: 'Suave', vintage: 'Vintage', mono: 'Mono', 'color-pop': 'Toque de cor', duotone: 'Duotone' }
const IMAGE_STYLE_LABELS: Record<ImageStylePreset, string> = { recorte: 'Recorte', gravura: 'Gravura', rabisco: 'Rabisco' }
function ImageCropDialog({ element, onClose, onApply }: { element: ImageElement; onClose: () => void; onApply: (crop: SourceCrop | null, sourceWidth: number, sourceHeight: number) => void }) {
  const [natural, setNatural] = useState({ width: element.sourceWidth ?? 0, height: element.sourceHeight ?? 0 })
  const [available, setAvailable] = useState({ width: Math.min(640, Math.max(260, window.innerWidth - 48)), height: 380 })
  const initialCrop = normalizedCropFromSource(element.crop, element.sourceWidth ?? 1, element.sourceHeight ?? 1)
  const [crop, setCropState] = useState<NormalizedCrop>(initialCrop)
  const cropRef = useRef(initialCrop)
  const selectedAspectRef = useRef<number | null>(null)
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; crop: NormalizedCrop } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const scale = natural.width > 0 && natural.height > 0 ? Math.min(available.width / natural.width, available.height / natural.height) : 1
  const previewSize = { width: natural.width * scale, height: natural.height * scale }

  function setCrop(next: NormalizedCrop) { cropRef.current = next; setCropState(next) }

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    const onResize = () => setAvailable({ width: Math.min(640, Math.max(260, window.innerWidth - 48)), height: 380 })
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('resize', onResize) }
  }, [onClose])

  function setAspect(aspect: number) {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    selectedAspectRef.current = aspect
    const sourceAspect = natural.width / Math.max(1, natural.height)
    const current = cropRef.current
    let width = current.width
    let height = current.height
    const currentAspect = sourceAspect * current.width / current.height
    if (currentAspect > aspect) width = current.height * aspect / sourceAspect
    else height = current.width * sourceAspect / aspect
    const next = clampCrop({ x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height })
    cropRef.current = next
    setCrop(next)
  }
  function handleCropPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const target = event.target as HTMLElement
    selectedAspectRef.current = null
    dragRef.current = { mode: target.closest('[data-crop-resize]') ? 'resize' : 'move', startX: event.clientX, startY: event.clientY, crop: cropRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function handleCropPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || previewSize.width <= 0 || previewSize.height <= 0) return
    const dx = (event.clientX - drag.startX) / previewSize.width
    const dy = (event.clientY - drag.startY) / previewSize.height
    const next = drag.mode === 'move'
      ? clampCrop({ ...drag.crop, x: drag.crop.x + dx, y: drag.crop.y + dy })
      : clampCrop({ ...drag.crop, width: drag.crop.width + dx, height: drag.crop.height + dy })
    cropRef.current = next
    setCrop(next)
  }

  const stageStyle: CSSProperties = { width: previewSize.width, height: previewSize.height }
  const rectStyle: CSSProperties = { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }
  return <div className="crop-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-dialog-title">
      <header><div><span className="panel-kicker">AJUSTAR ENQUADRAMENTO</span><h2 id="crop-dialog-title">Cortar imagem</h2></div><button ref={closeRef} className="asset-close" type="button" onClick={onClose} aria-label="Fechar recorte"><X size={18} /></button></header>
      <div className="crop-dialog-content">
        <div className="crop-ratios" role="group" aria-label="Proporção do recorte"><button type="button" onClick={() => { selectedAspectRef.current = null; setCrop({ x: 0, y: 0, width: 1, height: 1 }) }}>Original</button><button type="button" onClick={() => setAspect(1)}>1:1</button><button type="button" onClick={() => setAspect(16 / 9)}>16:9</button><button type="button" onClick={() => setAspect(4 / 3)}>4:3</button><button type="button" onClick={() => setAspect(9 / 16)}>9:16</button></div>
        <div className="crop-preview-well"><div className="crop-image-stage" style={stageStyle} onPointerMove={handleCropPointerMove} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
          <img src={element.src} alt="Prévia da imagem para recorte" draggable={false} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
          {natural.width > 0 && <div className="crop-shade" aria-hidden="true"><i style={{ left: 0, top: 0, width: '100%', height: `${crop.y * 100}%` }} /><i style={{ left: 0, top: `${(crop.y + crop.height) * 100}%`, width: '100%', height: `${(1 - crop.y - crop.height) * 100}%` }} /><i style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} /><i style={{ left: `${(crop.x + crop.width) * 100}%`, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} /></div>}
          {natural.width > 0 && <div className="crop-selection" style={rectStyle} onPointerDown={handleCropPointerDown} aria-label="Área selecionada; arraste para mover"><span className="crop-grid-line horizontal one" /><span className="crop-grid-line horizontal two" /><span className="crop-grid-line vertical one" /><span className="crop-grid-line vertical two" /><button type="button" data-crop-resize="true" className="crop-resize-handle" aria-label="Redimensionar recorte" /></div>}
        </div></div>
        <p className="crop-help">Arraste a área para reposicionar. Use a alça no canto para redimensionar.</p>
      </div>
      <footer><button type="button" className="crop-restore" onClick={() => { selectedAspectRef.current = null; const full = { x: 0, y: 0, width: 1, height: 1 }; cropRef.current = full; setCrop(full) }}>Restaurar original</button><div><button type="button" className="crop-cancel" onClick={onClose}>Cancelar</button><button type="button" className="share-button" disabled={!natural.width || !natural.height} onClick={() => { const applied = cropRef.current; onApply(applied.width >= .999 && applied.height >= .999 ? null : sourceCropFromNormalized(applied, natural.width, natural.height), natural.width, natural.height) }}>Aplicar</button></div></footer>
    </section>
  </div>
}

const IMAGE_TOOL_CARDS = [
  { name: 'Ajustar', Icon: Scan },
  { name: 'Camadas Mágicas', Icon: Layers, badge: 'Novo' },
  { name: 'Edição Mágica', Icon: WandSparkles, badge: 'Pro' },
  { name: 'Otimizar', Icon: Zap, badge: 'Novo' },
  { name: 'Removedor de Fundo', Icon: ScanFace, badge: 'Pro' },
  { name: 'Borracha Mágica', Icon: Eraser, badge: 'Pro' },
  { name: 'Imagem a vídeo', Icon: Play },
  { name: 'Gerador de Fundo', Icon: Aperture, badge: 'Pro' },
]

function ImageMaskEditor({ element, canEdit, onUpdate, onNotice }: { element: ImageElement; canEdit: boolean; onUpdate: (patch: Partial<ImageElement>) => void; onNotice: (message: string) => void }) {
  const [mode, setMode] = useState<ImageMaskMode>('erase')
  const [brushSize, setBrushSize] = useState(20)
  const [draftPoints, setDraftPoints] = useState<number[]>([])
  const draftPointsRef = useRef<number[]>([])
  const activePointerRef = useRef<number | null>(null)
  const strokes = element.maskStrokes ?? []
  const crop = element.crop
  const sourceWidth = element.sourceWidth ?? element.width
  const sourceHeight = element.sourceHeight ?? element.height
  const imageStyle: CSSProperties = crop ? {
    width: `${sourceWidth / crop.width * 100}%`, height: `${sourceHeight / crop.height * 100}%`,
    left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%`,
  } : { width: '100%', height: '100%', left: 0, top: 0 }
  const pathFor = (points: number[]) => imageMaskPointsToSvgPath(points, element.width / element.height)
  const pointFromEvent = (event: { currentTarget: SVGSVGElement; clientX: number; clientY: number }) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return screenToNormalizedImagePoint(event.clientX, event.clientY, rect)
  }
  const handlePointerDown = (event: { currentTarget: SVGSVGElement; clientX: number; clientY: number; pointerId: number; preventDefault: () => void }) => {
    if (!canEdit) return
    event.preventDefault()
    activePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    if (!point) return
    draftPointsRef.current = point
    setDraftPoints(draftPointsRef.current)
  }
  const handlePointerMove = (event: { currentTarget: SVGSVGElement; clientX: number; clientY: number; pointerId: number }) => {
    if (activePointerRef.current !== event.pointerId) return
    if (draftPointsRef.current.length >= 2_000) return
    const point = pointFromEvent(event)
    if (!point) return
    draftPointsRef.current = [...draftPointsRef.current, ...point]
    setDraftPoints(draftPointsRef.current)
  }
  const handlePointerUp = (event: { pointerId: number }) => {
    if (activePointerRef.current !== event.pointerId) return
    activePointerRef.current = null
    const points = draftPointsRef.current
    draftPointsRef.current = []
    setDraftPoints([])
    if (points.length >= 2) {
      const strokePoints = points.length === 2 ? [...points, ...points] : points
      onUpdate({ maskStrokes: [...strokes, { mode, size: brushSize * 0.0025, points: strokePoints }].slice(-100) })
      onNotice(mode === 'erase' ? 'Traço de borracha aplicado.' : 'Área restaurada.')
    }
  }
  const removeLastStroke = () => { onUpdate({ maskStrokes: strokes.slice(0, -1) }); onNotice('Último traço removido.') }
  const clearStrokes = () => { onUpdate({ maskStrokes: [] }); onNotice('Máscara limpa.') }

  return <section className="image-mask-editor" aria-label="Borracha manual de imagem">
    <p>Apague pixels ou restaure partes da imagem. A máscara é editável e não altera o arquivo original.</p>
    <div className="image-mask-mode" role="group" aria-label="Modo do pincel">
      <button type="button" aria-pressed={mode === 'erase'} disabled={!canEdit} onClick={() => setMode('erase')}><Eraser size={15} aria-hidden="true" /> Apagar</button>
      <button type="button" aria-pressed={mode === 'restore'} disabled={!canEdit} onClick={() => setMode('restore')}><Undo2 size={15} aria-hidden="true" /> Restaurar</button>
    </div>
    <label htmlFor="image-mask-brush-size">Tamanho do pincel <output>{brushSize}</output></label>
    <div className="image-mask-size-controls"><input id="image-mask-brush-size" aria-label="Tamanho" type="range" min="1" max="100" step="1" value={brushSize} disabled={!canEdit} onChange={event => setBrushSize(Number(event.target.value))} /><input aria-label="Tamanho" type="number" min="1" max="100" step="1" value={brushSize} disabled={!canEdit} onChange={event => setBrushSize(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></div>
    <div className="image-mask-preview" style={{ aspectRatio: `${element.width} / ${element.height}` }}>
      <img src={element.src} alt="" draggable={false} style={imageStyle} />
      <svg className="image-mask-canvas" viewBox={`0 0 1000 ${1000 * element.height / element.width}`} preserveAspectRatio="none" role="img" aria-label="Prévia da máscara; desenhe sobre a imagem" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
        {strokes.map((stroke, index) => <path key={index} d={pathFor(stroke.points)} fill="none" stroke={stroke.mode === 'erase' ? '#ff625d' : '#4de2b5'} strokeWidth={stroke.size * 1000} strokeLinecap="round" strokeLinejoin="round" opacity=".76" aria-hidden="true" />)}
        {draftPoints.length >= 2 && <path d={pathFor(draftPoints.length === 2 ? [...draftPoints, ...draftPoints] : draftPoints)} fill="none" stroke={mode === 'erase' ? '#ff625d' : '#4de2b5'} strokeWidth={brushSize * 2.5} strokeLinecap="round" strokeLinejoin="round" opacity=".82" aria-hidden="true" />}
      </svg>
    </div>
    <div className="image-mask-actions">
      <button type="button" disabled={!canEdit || !strokes.length} onClick={removeLastStroke}>Desfazer traço</button>
      <button type="button" disabled={!canEdit || !strokes.length} onClick={clearStrokes}>Limpar máscara</button>
    </div>
    <small>{strokes.length} traço(s) salvo(s). Use Apagar e Restaurar para editar a transparência.</small>
  </section>
}

function ImageAnimationEditor({ element, canEdit, playing, progress, onUpdate, onPreview }: {
  element: ImageElement
  canEdit: boolean
  playing: boolean
  progress: number
  onUpdate: (patch: Partial<ImageElement>) => void
  onPreview: () => void
}) {
  const settings: ImageAnimationSettings = element.animation ?? { effect: 'elevation', phase: 'enter', speed: 'slow', direction: 'down' }
  const update = (patch: Partial<ImageAnimationSettings>) => onUpdate({ animation: { ...settings, ...patch } })
  return <section className="image-animation-editor" aria-label="Animação da imagem">
    <p>A animação é aplicada à imagem selecionada e pode ser pré-visualizada antes da exportação.</p>
    <button type="button" className={`image-animation-effect${element.animation ? ' active' : ''}`} aria-pressed={Boolean(element.animation)} disabled={!canEdit} onClick={() => onUpdate({ animation: element.animation ? null : { effect: 'elevation', phase: 'enter', speed: 'slow', direction: 'down' } })}>
      <span className="image-animation-effect-icon" aria-hidden="true"><Sparkles size={18} /></span><span><strong>Elevação</strong><small>Movimento suave com entrada gradual</small></span>{element.animation && <span className="image-animation-pro">Pro</span>}
    </button>
    <label>Momento<select aria-label="Momento da animação" value={settings.phase} disabled={!canEdit || !element.animation} onChange={event => update({ phase: event.target.value as ImageAnimationSettings['phase'] })}><option value="enter">Entrando</option><option value="exit">Saindo</option></select></label>
    <label>Velocidade<select aria-label="Velocidade da animação" value={settings.speed} disabled={!canEdit || !element.animation} onChange={event => update({ speed: event.target.value as ImageAnimationSettings['speed'] })}><option value="slow">Lenta</option><option value="medium">Média</option><option value="fast">Rápida</option></select></label>
    <label>Direção<select aria-label="Direção da animação" value={settings.direction} disabled={!canEdit || !element.animation} onChange={event => update({ direction: event.target.value as ImageAnimationSettings['direction'] })}><option value="down">Para baixo</option><option value="up">Para cima</option><option value="left">Da esquerda</option><option value="right">Da direita</option></select></label>
    <div className="image-animation-preview-row"><button type="button" disabled={!element.animation} onClick={onPreview}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? 'Pausar prévia' : 'Pré-visualizar'}</button><output aria-label="Progresso da animação">{Math.round(progress * 100)}%</output></div>
    <button type="button" className="image-animation-remove" disabled={!canEdit || !element.animation} onClick={() => onUpdate({ animation: null })}>Remover animação</button>
  </section>
}

function ImageColorAdjustmentControls({ element, prefix, canEdit, onUpdate }: { element: ImageElement; prefix: string; canEdit: boolean; onUpdate: (patch: Partial<ImageElement>) => void }) {
  const [drafts, setDrafts] = useState<Partial<Record<'brightness' | 'contrast' | 'saturation', string>>>({})
  const controls = [
    { key: 'brightness' as const, label: 'Brilho' },
    { key: 'contrast' as const, label: 'Contraste' },
    { key: 'saturation' as const, label: 'Saturação' },
  ]
  const commit = (key: 'brightness' | 'contrast' | 'saturation', raw: string) => {
    const value = Math.max(-100, Math.min(100, Number(raw) || 0))
    setDrafts(current => ({ ...current, [key]: undefined }))
    onUpdate({ [key]: value })
  }
  return <div className="image-color-adjustment-controls">{controls.map(({ key, label }) => {
    const id = `${prefix}-${key}`
    return <div className="image-adjustment-field" key={key}><label htmlFor={`${id}-slider`}>{label}</label><div className="image-adjustment-control"><input id={`${id}-slider`} aria-label={label} type="range" min="-100" max="100" step="1" value={element[key] ?? 0} disabled={!canEdit} onChange={event => { setDrafts(current => ({ ...current, [key]: undefined })); onUpdate({ [key]: Number(event.target.value) }) }} /><input aria-label={label} type="text" role="spinbutton" inputMode="numeric" value={drafts[key] ?? String(element[key] ?? 0)} disabled={!canEdit} onChange={event => setDrafts(current => ({ ...current, [key]: event.target.value.replace(/[^\d-]/g, '').slice(0, 4) }))} onBlur={event => { if (drafts[key] !== undefined) commit(key, event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></div></div>
  })}</div>
}

function ImageEditPanel({ element, canEdit, compareOriginal, initialNotice, initialMode = 'tools', animationPlaying, animationProgress, onAnimationPreview, onCompareChange, onClose, onUpdate }: {
  element: ImageElement
  canEdit: boolean
  compareOriginal: boolean
  initialNotice: string
  initialMode?: 'tools' | 'adjust' | 'mask' | 'animation'
  animationPlaying: boolean
  animationProgress: number
  onAnimationPreview: () => void
  onCompareChange: (comparing: boolean) => void
  onClose: () => void
  onUpdate: (patch: Partial<ImageElement>) => void
}) {
  const [view, setView] = useState<'tools' | 'adjust' | 'mask' | 'animation'>(initialMode)
  const [scope, setScope] = useState('Tudo')
  const [notice, setNotice] = useState(initialNotice)
  const [autoAdjustBusy, setAutoAdjustBusy] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const scopeRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => { closeButtonRef.current?.focus() }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const activateTool = (name: string) => {
    setNotice('')
    if (name === 'Ajustar') { setView('adjust'); return }
    if (name === 'Borracha Mágica') { setView('mask'); return }
    setNotice(`${name}: esta ferramenta ainda não está conectada neste editor.`)
  }
  const applyAutomaticAdjustment = async () => {
    if (!canEdit || autoAdjustBusy) return
    setAutoAdjustBusy(true)
    setNotice('Analisando a imagem…')
    try {
      const image = new Image()
      image.decoding = 'async'
      image.src = element.src
      await image.decode()
      const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Leitura de pixels indisponível')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const estimate = estimateAutoImageAdjustment(context.getImageData(0, 0, canvas.width, canvas.height).data)
      if (!estimate) { setNotice('Não foi possível estimar ajustes para esta imagem.'); return }
      onUpdate(estimate)
      setNotice(`Ajuste aplicado: brilho ${estimate.brightness}, contraste ${estimate.contrast}, saturação ${estimate.saturation}.`)
    } catch {
      setNotice('Não foi possível analisar esta imagem no navegador.')
    } finally { setAutoAdjustBusy(false) }
  }
  const resetAdjustments = () => onUpdate({ brightness: 0, contrast: 0, saturation: 0, opacity: 100, filterPreset: undefined, imageStylePreset: undefined })

  return <aside ref={panelRef} className="image-edit-panel" role="dialog" aria-modal="true" aria-labelledby="image-edit-panel-title" aria-label="Editar imagem" onKeyDown={event => {
    if (event.key !== 'Tab') return
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
  }}>
    <header className="image-edit-panel-header">
      <div className="image-edit-panel-title">{view !== 'tools' && <button type="button" className="image-edit-back" onClick={() => setView('tools')}><ChevronLeft size={16} aria-hidden="true" /> <span>Voltar</span></button>}<h2 id="image-edit-panel-title">{view === 'adjust' ? 'Ajustar' : view === 'mask' ? 'Borracha' : view === 'animation' ? 'Animar' : 'Editar imagem'}</h2></div>
      <div className="image-edit-panel-actions">
        <button type="button" className={`image-compare-button ${compareOriginal ? 'active' : ''}`} aria-label="Comparar (manter pressionado)" title="Comparar (manter pressionado)" onPointerDown={event => { event.preventDefault(); onCompareChange(true) }} onPointerUp={() => onCompareChange(false)} onPointerCancel={() => onCompareChange(false)} onPointerLeave={() => onCompareChange(false)} onBlur={() => onCompareChange(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onCompareChange(true) } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') onCompareChange(false) }}><Focus size={16} /></button>
        <button ref={closeButtonRef} type="button" className="image-edit-close" aria-label="Fechar editor de imagem" onClick={onClose}><X size={18} /></button>
      </div>
    </header>
    <div className="image-edit-panel-content">
      <section className="image-edit-section" aria-labelledby="image-scope-heading">
        <h3 id="image-scope-heading">Selecionar</h3>
        <div className="image-scope-control"><div className="image-scope-row" ref={scopeRowRef}>
          {IMAGE_SCOPE_OPTIONS.map((option, index) => {
            const ScopeIcon = IMAGE_SCOPE_ICONS[index]
            return <button key={option} type="button" role="switch" aria-checked={scope === option} className={`image-scope-switch ${scope === option ? 'selected' : ''}`} onClick={() => setScope(option)}><ScopeIcon size={14} strokeWidth={1.8} aria-hidden="true" />{option}</button>
          })}
        </div><button type="button" className="image-scope-next" aria-label="Próximas opções de seleção" onClick={() => scopeRowRef.current?.scrollBy({ left: scopeRowRef.current.clientWidth * .8, behavior: 'smooth' })}><ChevronRight size={16} aria-hidden="true" /></button></div>
      </section>

      {view === 'mask' ? <ImageMaskEditor element={element} canEdit={canEdit} onUpdate={onUpdate} onNotice={setNotice} /> : view === 'animation' ? <ImageAnimationEditor element={element} canEdit={canEdit} playing={animationPlaying} progress={animationProgress} onUpdate={onUpdate} onPreview={onAnimationPreview} /> : view === 'tools' ? <>
        <section className="image-edit-section" aria-labelledby="image-tools-heading">
          <div className="image-edit-section-heading"><h3 id="image-tools-heading">Ferramentas</h3><button type="button" onClick={() => setNotice('As ferramentas disponíveis nesta captura estão listadas abaixo.')}>Ver tudo</button></div>
          <div className="image-tool-gallery">{IMAGE_TOOL_CARDS.map(({ name, Icon, badge }) => <button key={name} type="button" className="image-tool-card" aria-label={badge ? `${name} - ${badge}` : name} onClick={() => activateTool(name)}><span className={`image-tool-icon image-tool-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll(' ', '-')}`} aria-hidden="true"><Icon size={24} strokeWidth={1.8} /></span>{badge && <span className={`image-tool-badge ${badge === 'Pro' ? 'pro' : 'new'}`}>{badge}</span>}<span className="image-tool-name">{name}</span></button>)}</div>
        </section>
        <section className="image-edit-section" aria-labelledby="image-style-heading"><div className="image-edit-section-heading"><h3 id="image-style-heading">Cópia de estilo</h3><button type="button" onClick={() => setNotice('Os estilos desta galeria são aproximações locais: Recorte, Gravura e Rabisco.')}>Ver tudo</button></div><div className="image-style-gallery"><button type="button" className={`image-style-card${!element.imageStylePreset ? ' active' : ''}`} aria-pressed={!element.imageStylePreset} disabled={!canEdit} onClick={() => { onUpdate({ imageStylePreset: undefined }); setNotice('Estilo removido.') }}><span className="image-style-thumb original"><ImageIcon size={17} aria-hidden="true" /></span>Nenhum</button>{(['recorte', 'gravura', 'rabisco'] as const).map((preset, index) => { const Icon = [Crop, Scan, Pencil][index]; return <button key={preset} type="button" className={`image-style-card${element.imageStylePreset === preset ? ' active' : ''}`} aria-pressed={element.imageStylePreset === preset} disabled={!canEdit} onClick={() => { onUpdate({ imageStylePreset: preset }); setNotice(`${IMAGE_STYLE_LABELS[preset]} aplicado.`) }}><span className={`image-style-thumb ${preset === 'recorte' ? 'sketch' : preset === 'gravura' ? 'engraving' : 'scribble'}`}><Icon size={17} aria-hidden="true" /></span>{IMAGE_STYLE_LABELS[preset]}</button> })}</div></section>
        <section className="image-edit-section" aria-labelledby="image-filters-heading"><div className="image-edit-section-heading"><h3 id="image-filters-heading">Filtros</h3><button type="button" onClick={() => setNotice('Os cinco filtros desta galeria estão disponíveis; selecione uma opção para aplicar ou remover o efeito.')}>Ver tudo</button></div><div className="image-filter-gallery"><button type="button" className={`image-filter-card${!element.filterPreset ? ' active' : ''}`} aria-pressed={!element.filterPreset} disabled={!canEdit} onClick={() => { onUpdate({ filterPreset: undefined }); setNotice('Filtro removido.') }}><span className="filter-preview original" aria-hidden="true"><ImageIcon size={17} /></span>Nenhum</button>{IMAGE_FILTER_PRESETS.map(preset => <button key={preset} type="button" className={`image-filter-card${element.filterPreset === preset ? ' active' : ''}`} aria-pressed={element.filterPreset === preset} disabled={!canEdit} onClick={() => { onUpdate({ filterPreset: preset }); setNotice(`${IMAGE_FILTER_LABELS[preset]} aplicado.`) }}><span className={`filter-preview ${preset}`} aria-hidden="true"><ImageIcon size={17} /></span>{IMAGE_FILTER_LABELS[preset]}</button>)}</div></section>
      </> : <>
        <div className="image-adjust-subheading"><span>Comparar (manter pressionado)</span><button type="button" className="image-compare-text" aria-pressed={compareOriginal} onPointerDown={event => { event.preventDefault(); onCompareChange(true) }} onPointerUp={() => onCompareChange(false)} onPointerLeave={() => onCompareChange(false)} onPointerCancel={() => onCompareChange(false)} onBlur={() => onCompareChange(false)}>Comparar</button></div>
        <button type="button" className="image-auto-adjust" disabled={!canEdit || autoAdjustBusy} aria-busy={autoAdjustBusy} onClick={() => void applyAutomaticAdjustment()}><Sparkles size={15} aria-hidden="true" />{autoAdjustBusy ? 'Analisando imagem…' : 'Ajuste automático'}</button>
        <div className="image-adjustment-group"><h3>Iluminação</h3><ImageColorAdjustmentControls element={element} prefix="image-panel" canEdit={canEdit} onUpdate={onUpdate} /></div>
        <div className="image-adjustment-group"><h3>Balanço de brancos</h3><p>Temperatura - Matiz <span>Não configurados</span></p></div>
        <button type="button" className="image-adjust-reset" disabled={!canEdit || (element.brightness ?? 0) === 0 && (element.contrast ?? 0) === 0 && (element.saturation ?? 0) === 0 && (element.opacity ?? 100) === 100 && !element.filterPreset && !element.imageStylePreset} onClick={resetAdjustments}>Redefinir ajustes</button>
      </>}
      {notice && <p className="image-edit-notice" role="status">{notice}</p>}
    </div>
  </aside>
}

function readEditableSelection(root: HTMLElement): { start: number; end: number } | null {
  const selection = globalThis.getSelection()
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null
  const offsetOf = (node: Node, offset: number) => {
    const range = globalThis.document.createRange()
    range.selectNodeContents(root)
    range.setEnd(node, offset)
    return range.toString().length
  }
  const anchor = offsetOf(selection.anchorNode, selection.anchorOffset)
  const focus = offsetOf(selection.focusNode, selection.focusOffset)
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
}

function restoreEditableSelection(root: HTMLElement, start: number, end: number) {
  const walker = globalThis.document.createTreeWalker(root, globalThis.NodeFilter.SHOW_TEXT)
  let current: Node | null
  let startNode: Node | null = null
  let endNode: Node | null = null
  let startOffset = 0
  let endOffset = 0
  let consumed = 0
  while ((current = walker.nextNode())) {
    const length = current.textContent?.length ?? 0
    if (!startNode && start <= consumed + length) { startNode = current; startOffset = Math.max(0, start - consumed) }
    if (end <= consumed + length) { endNode = current; endOffset = Math.max(0, end - consumed); break }
    consumed += length
  }
  const selection = globalThis.getSelection()
  if (!selection) return
  const range = globalThis.document.createRange()
  if (!startNode || !endNode) {
    range.selectNodeContents(root)
    range.collapse(start === 0)
  } else {
    range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length ?? 0))
    range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length ?? 0))
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

function DocumentEditorPanel({ document, pageIndex, canEdit, change, onRecordUndo, onPageChange, onAddPage, onDuplicatePage, onMovePage, onDeletePage, presence, currentUserId, onSelection, onTableCellOperation, onBlockTextOperation, onBlockStructureOperation }: {
  document: DesignDocument
  pageIndex: number
  canEdit: boolean
  change: (update: (document: DesignDocument) => DesignDocument) => void
  onRecordUndo?: () => void
  onPageChange: (index: number) => void
  onAddPage: () => void
  onDuplicatePage: () => void
  onMovePage: (targetIndex: number) => void
  onDeletePage: () => void
  presence: RemotePresence[]
  currentUserId?: string
  onSelection: (selection: RemoteSelection | null) => void
  onTableCellOperation?: (pageId: string, operation: DocTableCellOperation) => void
  onBlockTextOperation?: (pageId: string, operation: DocBlockTextOperation) => void
  onBlockStructureOperation?: (pageId: string, operation: DocBlockStructureOperation) => void
}) {
  type VisualDocPage = { blocks: DocBlock[]; sourcePageIndex: number; expandedHeight?: number }
  const [visualPages, setVisualPages] = useState<VisualDocPage[]>(() => document.pages.map((page, index) => ({ blocks: page.blocks ?? [], sourcePageIndex: index })))
  const [selectedBlockId, setSelectedBlockId] = useState(document.pages[pageIndex].blocks?.[0]?.id ?? null)
  const [selectedCell, setSelectedCell] = useState<{ blockId: string; row: number; column: number } | null>(null)
  const [tableBorderPopoverOpen, setTableBorderPopoverOpen] = useState(false)
  const [tableBorderStylePickerOpen, setTableBorderStylePickerOpen] = useState(false)
  const [tableBorderStyleDraft, setTableBorderStyleDraft] = useState<DocTableBorderStyle | null>(null)
  const [tableBorderThicknessDraft, setTableBorderThicknessDraft] = useState<string | null>(null)
  const [docSelectionPageId, setDocSelectionPageId] = useState<string | null>(null)
  const [tableSelection, setTableSelection] = useState<TableSelection | null>(null)
  const [tableQuickActionsOpen, setTableQuickActionsOpen] = useState(false)
  const [tableQuickActionSize, setTableQuickActionSize] = useState({ rows: 3, columns: 4 })
  const tableQuickActionTriggerRef = useRef<HTMLButtonElement>(null)
  const tableQuickActionGridRef = useRef<HTMLDivElement>(null)
  const [tableQuickActionNarrow, setTableQuickActionNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [caseSensitiveSearch, setCaseSensitiveSearch] = useState(false)
  const [replaceNotice, setReplaceNotice] = useState('')
  const [textSelection, setTextSelection] = useState<{ blockId: string; start: number; end: number } | null>(null)
  const [docOutlineOpen, setDocOutlineOpen] = useState(false)
  const [docInspectorOpen, setDocInspectorOpen] = useState(false)
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [docBottomPanel, setDocBottomPanel] = useState<'notes' | 'timer' | null>(null)
  const [docNotes, setDocNotes] = useState(() => { try { return window.localStorage.getItem(`fuse-doc-notes:${document.id}`) ?? '' } catch { return '' } })
  const [docxImportBusy, setDocxImportBusy] = useState(false)
  const [docxImportError, setDocxImportError] = useState('')
  const docxInputRef = useRef<HTMLInputElement>(null)
  const [docTimerSeconds, setDocTimerSeconds] = useState(5 * 60)
  const [docTimerRunning, setDocTimerRunning] = useState(false)
  const visiblePageRef = useRef<HTMLElement>(null)
  const measurePageRef = useRef<HTMLElement>(null)
  const pendingFocusRef = useRef<{ blockId: string; start: number; end: number } | null>(null)
  const pendingCellFocusRef = useRef<{ blockId: string; row: number; column: number } | null>(null)
  const pendingTableCellOperationsRef = useRef(new Map<string, number>())
  useEffect(() => {
    const query = window.matchMedia('(max-width: 560px)')
    const update = () => setTableQuickActionNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useLayoutEffect(() => {
    if (tableQuickActionsOpen) tableQuickActionGridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
  }, [tableQuickActionsOpen])
  const pageMargins = document.docPageSetup?.margins ?? { top: 96, right: 96, bottom: 96, left: 96 }
  const setPageMargin = (side: 'top' | 'right' | 'bottom' | 'left', centimeters: number) => {
    const value = Math.max(0, Math.min(5.08, centimeters)) * (96 / 2.54)
    change(current => ({ ...current, docPageSetup: { preset: 'a4', margins: { ...(current.docPageSetup?.margins ?? pageMargins), [side]: value } } }))
  }
  const pendingBlockTextOperationsRef = useRef(new Map<string, number>())
  useEffect(() => {
    try { window.localStorage.setItem(`fuse-doc-notes:${document.id}`, docNotes) } catch { /* Notes stay available in the open editor when storage is unavailable. */ }
  }, [docNotes, document.id])
  useEffect(() => {
    if (!docTimerRunning) return
    const interval = window.setInterval(() => setDocTimerSeconds(seconds => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(interval)
  }, [docTimerRunning])
  useEffect(() => {
    if (docTimerSeconds === 0) setDocTimerRunning(false)
  }, [docTimerSeconds])
  const adjustDocTimerMinutes = (minutes: number) => {
    if (docTimerRunning) return
    setDocTimerSeconds(seconds => Math.max(60, Math.min(24 * 60 * 60, seconds + minutes * 60)))
  }
  const measureVisualPages = useCallback((): VisualDocPage[] => {
    const visiblePage = visiblePageRef.current
    const measurePage = measurePageRef.current
    if (!visiblePage || !measurePage) return document.pages.map((page, index) => ({ blocks: page.blocks ?? [], sourcePageIndex: index }))
    measurePage.style.width = `${visiblePage.offsetWidth}px`
    measurePage.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(textarea => {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    })

    const pageStyle = getComputedStyle(measurePage)
    const title = measurePage.querySelector<HTMLElement>('.doc-page-title')
    const addButton = measurePage.querySelector<HTMLElement>('.doc-page-add')
    const titleStyle = title ? getComputedStyle(title) : null
    const addStyle = addButton ? getComputedStyle(addButton) : null
    const topChrome = Number.parseFloat(pageStyle.paddingTop) + (title?.offsetHeight ?? 0) + Number.parseFloat(titleStyle?.marginBottom ?? '0')
    const bottomChrome = Number.parseFloat(pageStyle.paddingBottom) + (addButton?.offsetHeight ?? 0) + Number.parseFloat(addStyle?.marginTop ?? '0') + Number.parseFloat(addStyle?.marginBottom ?? '0')
    const capacity = Math.max(120, measurePage.clientHeight - topChrome - bottomChrome)
    const heights = new Map<string, number>()
    measurePage.querySelectorAll<HTMLElement>('.doc-block[data-doc-block-id]').forEach(element => {
      const id = element.dataset.docBlockId
      if (id) heights.set(id, element.offsetHeight + Number.parseFloat(getComputedStyle(element).marginBottom || '0'))
    })
    const pages: VisualDocPage[] = []
    for (const [sourceIndex, sourcePage] of document.pages.entries()) {
      const source = sourcePage.blocks ?? []
      if (source.length === 0) { pages.push({ blocks: [], sourcePageIndex: sourceIndex }); continue }
      let current: DocBlock[] = []
      let used = 0
      const finish = () => {
        if (current.length) pages.push({ blocks: current, sourcePageIndex: sourceIndex })
        current = []
        used = 0
      }
      for (const block of source) {
        const blockHeight = heights.get(block.id) ?? 44
        if (current.length > 0 && used + blockHeight > capacity) finish()
        if (blockHeight > capacity) {
          finish()
          pages.push({ blocks: [block], sourcePageIndex: sourceIndex, expandedHeight: measurePage.clientHeight + blockHeight - capacity })
        } else {
          current.push(block)
          used += blockHeight
        }
      }
      finish()
    }
    return pages
  }, [document.pages])

  const sourceVisualIndex = visualPages.findIndex(page => page.sourcePageIndex === pageIndex)
  const selectedVisualIndex = selectedBlockId ? visualPages.findIndex(page => page.blocks.some(block => block.id === selectedBlockId)) : -1
  const visualPageIndex = selectedVisualIndex >= 0 && visualPages[selectedVisualIndex].sourcePageIndex === pageIndex
    ? selectedVisualIndex
    : Math.max(0, sourceVisualIndex)
  const visualPage = visualPages[visualPageIndex] ?? { blocks: document.pages[pageIndex].blocks ?? EMPTY_DOC_BLOCKS, sourcePageIndex: pageIndex }
  const blocks = visualPage.blocks
  const sourcePageIndex = visualPage.sourcePageIndex
  const sourcePageId = document.pages[sourcePageIndex]?.id
  const activeBlockId = blocks.some(block => block.id === selectedBlockId) ? selectedBlockId : blocks[0]?.id ?? null
  const selectedBlock = blocks.find(block => block.id === activeBlockId) ?? blocks[0]
  const borderCell = selectedBlock?.type === 'table' ? selectedCell?.blockId === selectedBlock.id ? selectedCell : { row: 0, column: 0 } : null
  const selectedCellBorders = borderCell && selectedBlock?.type === 'table' ? selectedBlock.cellBorders?.[`${borderCell.row}:${borderCell.column}`] : undefined
  const activeTableBorderStyle = tableBorderStyleDraft ?? selectedCellBorders?.top?.style ?? 'solid'
  const activeTableBorderThickness = tableBorderThicknessDraft ?? String(selectedCellBorders?.top?.width ?? 2)

  useEffect(() => {
    if (!sourcePageId || docSelectionPageId !== sourcePageId || !activeBlockId) {
      onSelection(null)
      return
    }
    const cell = selectedCell?.blockId === activeBlockId ? selectedCell : null
    const selection: RemoteSelection = cell
      ? { pageId: sourcePageId, elementId: activeBlockId, kind: 'table-cell', row: cell.row, column: cell.column }
      : { pageId: sourcePageId, elementId: activeBlockId, kind: 'doc-block' }
    const timeout = window.setTimeout(() => onSelection(selection), 250)
    return () => window.clearTimeout(timeout)
  }, [sourcePageId, docSelectionPageId, activeBlockId, selectedCell, onSelection])

  useLayoutEffect(() => {
    const nextPages = measureVisualPages()
    setVisualPages(current => {
      const unchanged = current.length === nextPages.length && current.every((page, index) => {
        const next = nextPages[index]
        return page.sourcePageIndex === next.sourcePageIndex && page.expandedHeight === next.expandedHeight
          && page.blocks.length === next.blocks.length && page.blocks.every((block, blockIndex) => block === next.blocks[blockIndex])
      })
      return unchanged ? current : nextPages
    })
  }, [document.pages, document.docPageSetup?.margins, measureVisualPages])

  useEffect(() => {
    const visiblePage = visiblePageRef.current
    if (!visiblePage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setVisualPages(measureVisualPages()))
    observer.observe(visiblePage)
    return () => observer.disconnect()
  }, [measureVisualPages])

  useLayoutEffect(() => {
    const pendingCell = pendingCellFocusRef.current
    if (pendingCell) {
      const field = [...(visiblePageRef.current?.querySelectorAll<HTMLTextAreaElement>('textarea[data-table-id]') ?? [])]
        .find(textarea => textarea.dataset.tableId === pendingCell.blockId && Number(textarea.dataset.tableRow) === pendingCell.row && Number(textarea.dataset.tableColumn) === pendingCell.column)
      if (field) {
        field.focus()
        pendingCellFocusRef.current = null
        return
      }
    }
    const pending = pendingFocusRef.current
    if (!pending) return
    const field = [...(visiblePageRef.current?.querySelectorAll<HTMLElement>('[data-edit-block-id]') ?? [])]
      .find(element => element.dataset.editBlockId === pending.blockId)
    if (!field) return
    field.focus()
    restoreEditableSelection(field, pending.start, pending.end)
    pendingFocusRef.current = null
  }, [visualPages, selectedBlockId])

  function updateBlocks(update: (current: DocBlock[]) => DocBlock[]) {
    change(current => updatePage(current, sourcePageIndex, currentPage => ({ ...currentPage, blocks: update(currentPage.blocks ?? []) })))
  }

  async function importDocx(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setDocxImportBusy(true)
    setDocxImportError('')
    try {
      const { parseDocx } = await import('./docx-import')
      const imported = await parseDocx(await file.arrayBuffer(), file.name)
      const importedBlocks = imported.blocks.map(block => ({ ...block, id: createId('block') }))
      if (!importedBlocks.length) throw new Error('O arquivo não contém conteúdo que possa ser importado.')
      const currentBlocks = document.pages[sourcePageIndex]?.blocks ?? []
      const replacePlaceholder = currentBlocks.length === 1 && currentBlocks[0].type === 'paragraph' && !currentBlocks[0].text.trim()
      const afterBlockId = replacePlaceholder ? null : currentBlocks.at(-1)?.id ?? null
      const resultingBlocks = replacePlaceholder ? importedBlocks : [...currentBlocks, ...importedBlocks]
      const resultingDocument = { ...document, pages: document.pages.map((page, index) => index === sourcePageIndex ? { ...page, blocks: resultingBlocks } : page) }
      const resultingImageBytes = resultingBlocks.reduce((total, block) => {
        if (block.type !== 'image') return total
        const base64 = block.image?.src.match(/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+=*)$/)?.[1] ?? ''
        return total + Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
      }, 0)
      if (onBlockStructureOperation && resultingImageBytes > 8 * 1024 * 1024) throw new Error('As imagens desta página ultrapassariam o limite cloud de 8 MB. Remova imagens existentes ou importe um DOCX menor.')
      if (onBlockStructureOperation && new TextEncoder().encode(JSON.stringify(resultingDocument)).byteLength > 12 * 1024 * 1024) throw new Error('O documento cloud ultrapassaria o limite de 12 MB após importar este DOCX. Reduza o tamanho ou número de imagens e tente novamente.')
      updateBlocks(current => replacePlaceholder ? importedBlocks : [...current, ...importedBlocks])
      if (onBlockStructureOperation && sourcePageId) {
        onBlockStructureOperation(sourcePageId, { type: 'doc.blocks.insert', blocks: importedBlocks, afterBlockId, ...(replacePlaceholder && currentBlocks[0] ? { replaceEmptyBlockId: currentBlocks[0].id } : {}) })
      }
      setSelectedBlockId(importedBlocks[0].id)
      setDocSelectionPageId(sourcePageId ?? null)
      setReplaceNotice(`${importedBlocks.length} blocos importados de ${file.name}.`)
      if (document.pages.length === 1 && currentBlocks.length === 1 && !currentBlocks[0].text.trim() && imported.title) {
        change(current => ({ ...current, name: imported.title, updatedAt: new Date().toISOString() }))
      }
    } catch (error) {
      setDocxImportError(error instanceof Error ? error.message : 'Não foi possível importar este arquivo DOCX.')
    } finally {
      setDocxImportBusy(false)
      input.value = ''
    }
  }

  function addBlock(type: DocBlockType) {
    const block: DocBlock = {
      id: createId('block'), type, text: '',
      ...(type === 'table' ? { cells: Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => '')), cellPadding: 8, tableSpacing: 0, borderColor: '#d9d9d9', borderWidth: 1 } : {}),
    }
    const selectedIndex = blocks.findIndex(item => item.id === selectedBlockId)
    const afterBlockId = selectedIndex < 0 ? blocks.at(-1)?.id ?? null : blocks[selectedIndex].id
    updateBlocks(current => {
      const selectedIndex = current.findIndex(item => item.id === selectedBlockId)
      const next = [...current]
      next.splice(selectedIndex < 0 ? next.length : selectedIndex + 1, 0, block)
      return next
    })
    setSelectedBlockId(block.id)
    setDocSelectionPageId(sourcePageId ?? null)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.block.insert', block, afterBlockId })
  }

  function insertQuickTable(rows: number, columns: number) {
    const block: DocBlock = { id: createId('block'), type: 'table', text: '', cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')), cellPadding: 8, tableSpacing: 0, borderColor: '#d9d9d9', borderWidth: 1 }
    pendingCellFocusRef.current = { blockId: block.id, row: 0, column: 0 }
    const beforeBlockId = selectedBlockId
    const sourceBlocks = document.pages[sourcePageIndex]?.blocks ?? []
    const beforeIndex = sourceBlocks.findIndex(item => item.id === beforeBlockId)
    const afterBlockId = beforeIndex > 0 ? sourceBlocks[beforeIndex - 1].id : null
    updateBlocks(current => { const index = current.findIndex(item => item.id === beforeBlockId); const next = [...current]; next.splice(index < 0 ? next.length : index, 0, block); return next })
    setSelectedBlockId(block.id)
    setSelectedCell({ blockId: block.id, row: 0, column: 0 })
    setDocSelectionPageId(sourcePageId ?? null)
    setTableQuickActionsOpen(false)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.block.insert', block, afterBlockId })
  }

  function closeQuickTable() {
    setTableQuickActionsOpen(false)
    requestAnimationFrame(() => tableQuickActionTriggerRef.current?.focus())
  }

  function handleQuickTableGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLButtonElement ? event.target : null
    const dimensions = target?.dataset.tableDimensions?.match(/^(\d+)x(\d+)$/)
    if (!dimensions) return
    let column = Number(dimensions[1])
    let row = Number(dimensions[2])
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      insertQuickTable(row, column)
      return
    }
    if (event.key === 'ArrowLeft') column = Math.max(1, column - 1)
    else if (event.key === 'ArrowRight') column = Math.min(8, column + 1)
    else if (event.key === 'ArrowUp') row = Math.max(1, row - 1)
    else if (event.key === 'ArrowDown') row = Math.min(8, row + 1)
    else if (event.key === 'Home') { column = 1; if (event.ctrlKey || event.metaKey) row = 1 }
    else if (event.key === 'End') { column = 8; if (event.ctrlKey || event.metaKey) row = 8 }
    else return
    event.preventDefault()
    setTableQuickActionSize({ rows: row, columns: column })
    tableQuickActionGridRef.current?.querySelector<HTMLButtonElement>(`button[data-table-dimensions="${column}x${row}"]`)?.focus()
  }

  function patchBlock(id: string, patch: Partial<DocBlock>) {
    updateBlocks(current => current.map(block => block.id === id ? { ...block, ...patch } : block))
  }

  function applyTableCellBorder(block: DocBlock) {
    if (block.type !== 'table') return
    const cell = selectedCell?.blockId === block.id ? selectedCell : { blockId: block.id, row: 0, column: 0 }
    const thickness = Math.max(0, Math.min(16, Number(activeTableBorderThickness) || 0))
    const key = `${cell.row}:${cell.column}`
    const currentCell = block.cellBorders?.[key] ?? {}
    const border = { style: activeTableBorderStyle, width: thickness }
    patchBlock(block.id, { cellBorders: { ...(block.cellBorders ?? {}), [key]: { ...currentCell, top: border, right: border, bottom: border, left: border } } })
    setTableBorderStylePickerOpen(false)
    setTableBorderStyleDraft(null)
    setTableBorderThicknessDraft(null)
  }

  const matchCount = countDocumentMatches(document, findQuery, caseSensitiveSearch)

  function replaceAllMatches() {
    const result = replaceDocumentMatches(document, findQuery, replaceQuery, caseSensitiveSearch)
    if (!result.count) {
      setReplaceNotice(findQuery ? 'Nenhuma correspondência para substituir.' : 'Digite um termo para localizar.')
      return
    }
    const patches = getDocumentReplacementPatches(document, result.document).flatMap(patch => splitDocumentReplacementPatch(patch))
    if (onBlockStructureOperation) {
      // Record the pre-operation document for Undo without scheduling a snapshot:
      // the individual collaborative operations are the canonical cloud writes.
      onRecordUndo?.()
      for (const patch of patches) onBlockStructureOperation(patch.pageId, { type: 'doc.replace.apply', blocks: patch.blocks, cells: patch.cells })
    } else change(() => result.document)
    setReplaceNotice(`${result.count} ${result.count === 1 ? 'substituição aplicada' : 'substituições aplicadas'}.`)
  }

  function updateTableCell(id: string, rowIndex: number, columnIndex: number, value: string) {
    updateBlocks(current => current.map(block => {
      if (block.id !== id || block.type !== 'table') return block
      return { ...block, cells: setTableCell(block.cells ?? [], rowIndex, columnIndex, value) }
    }))
    if (onTableCellOperation && sourcePageId) {
      const key = `${id}:${rowIndex}:${columnIndex}`
      const prior = pendingTableCellOperationsRef.current.get(key)
      if (prior !== undefined) window.clearTimeout(prior)
      const timer = window.setTimeout(() => {
        pendingTableCellOperationsRef.current.delete(key)
        onTableCellOperation(sourcePageId, { type: 'doc.table.cell.set', blockId: id, row: rowIndex, column: columnIndex, value })
      }, 180)
      pendingTableCellOperationsRef.current.set(key, timer)
    }
  }

  function addTableRow(id: string) {
    const table = blocks.find(block => block.id === id && block.type === 'table')
    if (!table || table.type !== 'table') return
    const cells = table.cells ?? []
    pendingCellFocusRef.current = { blockId: id, row: cells.length, column: 0 }
    updateBlocks(current => current.map(block => block.id === id && block.type === 'table' ? { ...block, cells: appendTableRow(block.cells ?? []) } : block))
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: id, action: 'row.append' })
  }

  function addTableColumn(id: string) {
    const table = blocks.find(block => block.id === id && block.type === 'table')
    if (!table || table.type !== 'table') return
    pendingCellFocusRef.current = { blockId: id, row: 0, column: table.cells?.[0]?.length ?? 0 }
    updateBlocks(current => current.map(block => block.id === id && block.type === 'table' ? { ...block, cells: appendTableColumn(block.cells ?? []) } : block))
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: id, action: 'column.append' })
  }

  function deleteTableRow(id: string, rowIndex: number) {
    updateBlocks(current => current.map(block => block.id === id && block.type === 'table' ? { ...block, cells: removeTableRow(block.cells ?? [], rowIndex), merges: shiftTableMergesAfterRowRemoval(block.merges ?? [], rowIndex), cellBorders: shiftTableCellBordersAfterRowRemoval(block.cellBorders, rowIndex), cellImages: shiftTableCellImagesAfterRowRemoval(block.cellImages, rowIndex) } : block))
    setSelectedCell(current => current?.blockId === id ? { ...current, row: Math.max(0, current.row - (current.row >= rowIndex ? 1 : 0)) } : current)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: id, action: 'row.delete', row: rowIndex })
  }

  function moveSelectedTableRow(id: string, fromIndex: number, toIndex: number) {
    const table = blocks.find(block => block.id === id && block.type === 'table')
    if (!table || table.type !== 'table' || fromIndex < 0 || toIndex < 0 || fromIndex >= (table.cells?.length ?? 0) || toIndex >= (table.cells?.length ?? 0) || fromIndex === toIndex) return
    updateBlocks(current => current.map(block => block.id === id && block.type === 'table' ? {
      ...block,
      cells: moveTableRow(block.cells ?? [], fromIndex, toIndex),
      merges: moveTableMerges(block.merges ?? [], fromIndex, toIndex),
      cellBorders: moveTableCellBorders(block.cellBorders, fromIndex, toIndex),
      cellImages: moveTableCellImages(block.cellImages, fromIndex, toIndex),
    } : block))
    setSelectedCell(current => current?.blockId === id ? { ...current, row: moveTableRowIndex(current.row, fromIndex, toIndex) } : current)
    setTableSelection(current => current ? { ...current, anchorRow: moveTableRowIndex(current.anchorRow, fromIndex, toIndex), focusRow: moveTableRowIndex(current.focusRow, fromIndex, toIndex) } : current)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: id, action: 'row.move', from: fromIndex, to: toIndex })
  }

  function deleteTableColumn(id: string, columnIndex: number) {
    updateBlocks(current => current.map(block => block.id === id && block.type === 'table' ? { ...block, cells: removeTableColumn(block.cells ?? [], columnIndex), merges: shiftTableMergesAfterColumnRemoval(block.merges ?? [], columnIndex), cellBorders: shiftTableCellBordersAfterColumnRemoval(block.cellBorders, columnIndex), cellImages: shiftTableCellImagesAfterColumnRemoval(block.cellImages, columnIndex) } : block))
    setSelectedCell(current => current?.blockId === id ? { ...current, column: Math.max(0, current.column - (current.column >= columnIndex ? 1 : 0)) } : current)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: id, action: 'column.delete', column: columnIndex })
  }

  function handleTableKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>, block: DocBlock, rowIndex: number, columnIndex: number) {
    if (block.type !== 'table') return
    if (event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      const selection = extendTableSelection(tableSelection, rowIndex, columnIndex, event.key, block.cells?.length ?? 0, block.cells?.[rowIndex]?.length ?? 0)
      if (selection) setTableSelection(selection)
      return
    }
    const lastRow = (block.cells?.length ?? 0) - 1
    const lastColumn = (block.cells?.[rowIndex]?.length ?? 0) - 1
    const enterAtLastCell = event.key === 'Enter' && !event.shiftKey && !(event.ctrlKey || event.metaKey) && rowIndex === lastRow && columnIndex === lastColumn
    if (shouldAppendTableRow(event.key, event.shiftKey, event.ctrlKey || event.metaKey, rowIndex, columnIndex, block.cells ?? []) || enterAtLastCell) {
      event.preventDefault()
      addTableRow(block.id)
    }
  }

  function mergeSelectedCells(block: DocBlock) {
    if (block.type !== 'table' || !tableSelection) return
    const result = mergeTableSelection(block.cells ?? [], block.merges ?? [], tableSelection)
    if (!result) return
    updateBlocks(current => current.map(item => item.id === block.id && item.type === 'table' ? { ...item, ...result } : item))
    const column = Math.min(tableSelection.anchorColumn, tableSelection.focusColumn)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: block.id, action: 'merge', row: tableSelection.anchorRow, column, colSpan: Math.abs(tableSelection.anchorColumn - tableSelection.focusColumn) + 1 })
    setSelectedCell({ blockId: block.id, row: tableSelection.anchorRow, column })
    setTableSelection({ anchorRow: tableSelection.anchorRow, anchorColumn: column, focusRow: tableSelection.anchorRow, focusColumn: column })
  }

  function unmergeSelectedCell(block: DocBlock) {
    if (block.type !== 'table' || selectedCell?.blockId !== block.id) return
    updateBlocks(current => current.map(item => item.id === block.id && item.type === 'table' ? { ...item, merges: unmergeTableCell(item.merges ?? [], selectedCell.row, selectedCell.column) } : item))
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.table.structure', blockId: block.id, action: 'unmerge', row: selectedCell.row, column: selectedCell.column })
  }

  function renderTable(block: DocBlock, interactive: boolean) {
    if (block.type !== 'table') return null
    const merges = block.merges ?? []
    const hasCellBorderOverrides = Object.keys(block.cellBorders ?? {}).length > 0
    return <table className="doc-table" style={{ ['--cell-padding' as string]: `${block.cellPadding ?? 8}px`, ['--table-border-color' as string]: block.borderColor ?? '#d9d9d9', ['--table-border-width' as string]: `${block.borderWidth ?? 1}px`, borderCollapse: (block.tableSpacing ?? 0) > 0 ? 'separate' : 'collapse', borderSpacing: `${block.tableSpacing ?? 0}px` }}><tbody>{(block.cells ?? []).map((row, rowIndex) => <tr key={`${block.id}-row-${rowIndex}`}>{row.map((cell, columnIndex) => {
      const origin = merges.find(merge => merge.row === rowIndex && merge.column === columnIndex)
      if (!origin && isCellMerged(merges, rowIndex, columnIndex)) return null
      const inRange = tableSelection?.anchorRow === rowIndex && tableSelection.focusRow === rowIndex
        && columnIndex >= Math.min(tableSelection.anchorColumn, tableSelection.focusColumn)
        && columnIndex <= Math.max(tableSelection.anchorColumn, tableSelection.focusColumn)
      const remoteCellUser = presence.find(user => user.id !== currentUserId && user.selection?.kind === 'table-cell' && user.selection.pageId === sourcePageId && user.selection.elementId === block.id && user.selection.row === rowIndex && user.selection.column === columnIndex)
      const cellBorders = block.cellBorders?.[`${rowIndex}:${columnIndex}`]
      const borderColor = block.borderColor ?? '#d9d9d9'
      const borderEdges = [
        { edge: 'top' as const, opposite: 'bottom' as const, adjacent: rowIndex > 0 ? block.cellBorders?.[`${rowIndex - 1}:${columnIndex}`]?.bottom : undefined, direction: '90deg', position: 'left top', size: (width: number) => `100% ${width}px` },
        { edge: 'right' as const, opposite: 'left' as const, adjacent: columnIndex + 1 < row.length ? block.cellBorders?.[`${rowIndex}:${columnIndex + 1}`]?.left : undefined, direction: '180deg', position: 'right top', size: (width: number) => `${width}px 100%` },
        { edge: 'bottom' as const, opposite: 'top' as const, adjacent: rowIndex + 1 < block.cells!.length ? block.cellBorders?.[`${rowIndex + 1}:${columnIndex}`]?.top : undefined, direction: '90deg', position: 'left bottom', size: (width: number) => `100% ${width}px` },
        { edge: 'left' as const, opposite: 'right' as const, adjacent: columnIndex > 0 ? block.cellBorders?.[`${rowIndex}:${columnIndex - 1}`]?.right : undefined, direction: '180deg', position: 'left top', size: (width: number) => `${width}px 100%` },
      ]
      const borderPaint = hasCellBorderOverrides ? borderEdges.flatMap(({ edge, adjacent, direction, position, size }) => {
        const border = cellBorders?.[edge] ?? adjacent ?? { style: 'solid' as const, width: block.borderWidth ?? 1 }
        if (border.style === 'none' || border.width <= 0) return []
        const dash = border.style === 'long-dashes' ? 8 : border.style === 'dashes' ? 2 : border.width
        const gap = border.style === 'dots' ? Math.max(1, border.width * 1.6) : border.style === 'long-dashes' ? 4 : border.style === 'dashes' ? 2 : 0
        const image = gap ? `repeating-linear-gradient(${direction}, ${borderColor} 0 ${dash}px, transparent ${dash}px ${dash + gap}px)` : `linear-gradient(${direction}, ${borderColor}, ${borderColor})`
        return [{ image, size: size(border.width), position }]
      }) : []
      const cellStyle: CSSProperties = {
        ...(remoteCellUser ? { ['--remote-cell-color' as string]: '#df735f' } : {}),
        ...(hasCellBorderOverrides ? {
          borderColor: 'transparent',
          backgroundImage: borderPaint.map(paint => paint.image).join(', ') || 'none',
          backgroundSize: borderPaint.map(paint => paint.size).join(', '),
          backgroundPosition: borderPaint.map(paint => paint.position).join(', '),
          backgroundRepeat: 'no-repeat',
          backgroundOrigin: 'border-box',
        } : {}),
      }
      const cellImages = Array.from({ length: origin?.colSpan ?? 1 }, (_, offset) => block.cellImages?.[`${rowIndex}:${columnIndex + offset}`] ?? []).flat()
      return <td key={`${block.id}-${rowIndex}-${columnIndex}`} colSpan={origin?.colSpan ?? 1} rowSpan={origin?.rowSpan ?? 1} title={remoteCellUser ? `${remoteCellUser.name} selecionou esta célula` : undefined} className={`${interactive && inRange ? 'doc-table-cell-selected' : ''}${remoteCellUser ? ' doc-table-cell-remote-selected' : ''}`} style={cellStyle}>
        <textarea
          {...(interactive ? { 'data-table-id': block.id, 'data-table-row': rowIndex, 'data-table-column': columnIndex } : { tabIndex: -1 })}
          aria-label={`Linha ${rowIndex + 1}, coluna ${columnIndex + 1}`}
          rows={Math.max(1, cell.split('\n').length, Math.ceil(cell.length / 18))}
          value={cell}
          readOnly={!interactive || !canEdit}
          onMouseDown={interactive ? event => {
            if (event.shiftKey) setTableSelection(current => current ? { ...current, focusRow: rowIndex, focusColumn: columnIndex } : { anchorRow: rowIndex, anchorColumn: columnIndex, focusRow: rowIndex, focusColumn: columnIndex })
            else setTableSelection({ anchorRow: rowIndex, anchorColumn: columnIndex, focusRow: rowIndex, focusColumn: columnIndex })
          } : undefined}
          onFocus={interactive ? () => { setDocSelectionPageId(sourcePageId ?? null); setSelectedBlockId(block.id); setSelectedCell({ blockId: block.id, row: rowIndex, column: columnIndex }); setTableSelection(current => current?.anchorRow === rowIndex ? current : { anchorRow: rowIndex, anchorColumn: columnIndex, focusRow: rowIndex, focusColumn: columnIndex }) } : undefined}
          onKeyDown={interactive ? event => handleTableKeyDown(event, block, rowIndex, columnIndex) : undefined}
          onChange={interactive ? event => updateTableCell(block.id, rowIndex, columnIndex, event.target.value) : undefined}
        />
        {cellImages.length > 0 && <div className="doc-table-cell-images">
          {cellImages.map((image, imageIndex) => <img
            key={`${block.id}-${rowIndex}-${columnIndex}-image-${imageIndex}`}
            src={image.src}
            alt={image.alt}
            width={Math.max(1, Math.round(image.width))}
            height={Math.max(1, Math.round(image.height))}
            loading="lazy"
          />)}
        </div>}
      </td>
    })}</tr>)}</tbody></table>
  }

  function editBlock(id: string, text: string, field: HTMLElement) {
    const selection = readEditableSelection(field)
    if (selection) pendingFocusRef.current = { blockId: id, ...selection }
    const currentBlock = blocks.find(block => block.id === id)
    if (!currentBlock || currentBlock.type === 'table') return
    const marks = remapDocInlineMarks(currentBlock.text, text, currentBlock.marks)
    updateBlocks(current => current.map(block => block.id === id ? { ...block, text, marks } : block))
    if (onBlockTextOperation && sourcePageId) {
      const prior = pendingBlockTextOperationsRef.current.get(id)
      if (prior !== undefined) window.clearTimeout(prior)
      const timer = window.setTimeout(() => {
        pendingBlockTextOperationsRef.current.delete(id)
        onBlockTextOperation(sourcePageId, { type: 'doc.block.text.set', blockId: id, text, marks })
      }, 180)
      pendingBlockTextOperationsRef.current.set(id, timer)
    }
  }

  function captureTextSelection(id: string, field: HTMLElement) {
    const selection = readEditableSelection(field)
    setTextSelection(selection ? { blockId: id, ...selection } : null)
  }

  function selectionHasInlineMark(kind: DocMarkKind) {
    if (!selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image' || !textSelection || textSelection.blockId !== selectedBlock.id || textSelection.end <= textSelection.start) return false
    const selectedRuns = getDocTextRuns(selectedBlock.text, selectedBlock.marks).filter(run => run.end > textSelection.start && run.start < textSelection.end)
    return selectedRuns.length > 0 && selectedRuns.every(run => run[kind])
  }

  function applyInlineMark(kind: DocMarkKind, selection = textSelection) {
    if (!canEdit || !selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image' || !selection || selection.blockId !== selectedBlock.id || selection.end <= selection.start) return
    const { start, end } = selection
    pendingFocusRef.current = { blockId: selectedBlock.id, start, end }
    const marks = toggleDocInlineMark(selectedBlock.marks, start, end, kind)
    patchBlock(selectedBlock.id, { marks })
    if (onBlockTextOperation && sourcePageId) {
      const pending = pendingBlockTextOperationsRef.current.get(selectedBlock.id)
      if (pending !== undefined) window.clearTimeout(pending)
      pendingBlockTextOperationsRef.current.delete(selectedBlock.id)
      onBlockTextOperation(sourcePageId, { type: 'doc.block.text.set', blockId: selectedBlock.id, text: selectedBlock.text, marks })
    }
  }

  function removeBlock(id: string) {
    if (blocks.length <= 1) return
    updateBlocks(current => {
      return current.filter(block => block.id !== id)
    })
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.block.delete', blockId: id })
    setSelectedBlockId(null)
    setDocSelectionPageId(null)
  }

  function changeBlockType(id: string, type: DocBlockType) {
    const current = blocks.find(block => block.id === id)
    if (!current || current.type === 'table' || current.type === 'image' || type === 'table' || type === 'image' || current.type === type) return
    patchBlock(id, { type })
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.block.type.set', blockId: id, blockType: type })
  }

  function moveBlock(id: string, direction: -1 | 1) {
    const sourceBlocks = document.pages[sourcePageIndex]?.blocks ?? []
    const index = sourceBlocks.findIndex(block => block.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sourceBlocks.length) return
    const next = [...sourceBlocks]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateBlocks(() => next)
    if (onBlockStructureOperation && sourcePageId) onBlockStructureOperation(sourcePageId, { type: 'doc.blocks.reorder', blockIds: next.map(block => block.id) })
  }

  function goToPage(index: number) {
    const next = visualPages[index]
    if (!next) return
    setDocSelectionPageId(null)
    setSelectedBlockId(next.blocks[0]?.id ?? null)
    onPageChange(next.sourcePageIndex)
  }

  function selectDocImage(blockId: string) {
    setDocSelectionPageId(sourcePageId ?? null)
    setSelectedBlockId(blockId)
    setSelectedCell(null)
  }

  function renderDocImage(block: DocBlock, index: number, interactive = true) {
    const image = block.image
    if (!isSafeDocImage(image)) return <div className="doc-image-unavailable" role="img" aria-label={`Imagem ${index + 1} indisponível`} style={{ padding: 12, color: '#777487', border: '1px dashed #c8c4d0', borderRadius: 6 }}>Imagem do documento indisponível</div>
    const selected = selectedBlock?.id === block.id
    const label = image.alt.trim() ? `Selecionar imagem: ${image.alt}` : `Selecionar imagem ${index + 1} sem descrição`
    const imageStyle: CSSProperties = { display: 'block', width: '100%', height: 'auto', maxWidth: `${image.width}px` }
    const contents = <img src={image.src} alt={image.alt} width={Math.max(1, Math.round(image.width))} height={Math.max(1, Math.round(image.height))} draggable={false} style={imageStyle} />
    const width = `min(100%, ${Math.max(1, image.width)}px)`
    if (!interactive) return <div className="doc-image-preview" style={{ width, maxWidth: '100%', margin: '6px 0' }}>{contents}</div>
    return <button type="button" className="doc-image-select" aria-label={label} aria-pressed={selected} title={image.alt || label} onFocus={() => selectDocImage(block.id)} onClick={() => selectDocImage(block.id)} style={{ display: 'block', boxSizing: 'border-box', width, maxWidth: '100%', margin: '6px 0', padding: 0, border: selected ? '2px solid #7b61ff' : '2px solid transparent', borderRadius: 5, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>{contents}</button>
  }

  return <div className={`doc-editor-layout ${docOutlineOpen ? 'doc-outline-open' : ''} ${docInspectorOpen ? 'doc-inspector-open' : ''}`}>
    <aside className="doc-outline" aria-label="Estrutura do documento">
      <nav className="doc-tool-rail" aria-label="Ferramentas do documento">
        <button type="button" aria-label="Estrutura" aria-expanded={docOutlineOpen} onClick={() => setDocOutlineOpen(open => !open)}><AlignLeft size={20} aria-hidden="true" /><small>Estrutura</small></button>
        {canEdit && <><button type="button" aria-label="Importar DOCX ao final do documento" title="Importar DOCX ao final do documento" disabled={docxImportBusy} onClick={() => docxInputRef.current?.click()}><Upload size={20} aria-hidden="true" /><small>{docxImportBusy ? 'Importando' : 'Importar'}</small></button><input ref={docxInputRef} className="visually-hidden" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="Escolher arquivo DOCX" onChange={event => void importDocx(event)} /><button type="button" aria-label="Adicionar título" onClick={() => addBlock('heading')}><Heading size={20} aria-hidden="true" /><small>Título</small></button><button type="button" aria-label="Adicionar texto" onClick={() => addBlock('paragraph')}><Type size={20} aria-hidden="true" /><small>Texto</small></button><button type="button" aria-label="Adicionar lista" onClick={() => addBlock('bullet')}><List size={20} aria-hidden="true" /><small>Lista</small></button><button type="button" aria-label="Adicionar tabela" onClick={() => addBlock('table')}><Table2 size={20} aria-hidden="true" /><small>Tabela</small></button></>}
      </nav>
      {docxImportError && <p className="doc-import-error" role="alert">{docxImportError}</p>}
      <div className="doc-outline-drawer">
      <span className="panel-kicker">ESTRUTURA</span>
      <h2>Documento</h2>
      <div className="doc-outline-pages">{document.pages.map((page, sourceIndex) => <section key={page.id} className="doc-outline-page-group">
        <button type="button" className="doc-outline-page" aria-current={sourceIndex === pageIndex ? 'page' : undefined} onClick={() => { const firstBlock = page.blocks?.[0]; setDocSelectionPageId(page.id); setSelectedBlockId(firstBlock?.id ?? null); setSelectedCell(null); onPageChange(sourceIndex) }}>Página {sourceIndex + 1}</button>
        <div className="doc-outline-list">{(page.blocks ?? []).map((block, index) => <button key={block.id} type="button" data-doc-block-id={block.id} data-doc-page-index={sourceIndex} aria-pressed={docSelectionPageId === page.id && selectedBlockId === block.id} className={selectedBlockId === block.id ? 'selected' : ''} onClick={() => { setDocSelectionPageId(page.id); setSelectedBlockId(block.id); setSelectedCell(null); onPageChange(sourceIndex) }}>
          <span aria-hidden="true">{block.type === 'table' ? <Table2 size={15} /> : block.type === 'image' ? <ImageIcon size={15} /> : block.type === 'heading' ? <Heading1 size={15} /> : block.type === 'subheading' ? <Heading2 size={15} /> : block.type === 'bullet' ? <List size={15} /> : <Pilcrow size={15} />}</span>{block.type === 'table' ? `Tabela ${block.cells?.length ?? 0} × ${block.cells?.[0]?.length ?? 0}` : block.type === 'image' ? `Imagem: ${block.image?.alt?.trim() || `Imagem ${index + 1}`}` : block.text.trim().split('\n')[0] || `Bloco ${index + 1}`}
        </button>)}</div>
      </section>)}</div>
      {canEdit && <div className="doc-add-blocks"><button onClick={() => addBlock('heading')}><Plus size={13} aria-hidden="true" /> Título</button><button onClick={() => addBlock('paragraph')}><Plus size={13} aria-hidden="true" /> Texto</button><button onClick={() => addBlock('bullet')}><Plus size={13} aria-hidden="true" /> Lista</button><button onClick={() => addBlock('quote')}><Plus size={13} aria-hidden="true" /> Citação</button><button onClick={() => addBlock('table')}><Plus size={13} aria-hidden="true" /> Tabela 4 × 3</button></div>}
      </div>
    </aside>
    <section className="doc-workspace" aria-label="Editor de documento">
      <div className="doc-toolbar" role="toolbar" aria-label="Formatação do bloco">
        <button type="button" className="doc-outline-toggle" aria-label="Abrir estrutura do documento" aria-expanded={docOutlineOpen} onClick={() => setDocOutlineOpen(open => !open)}>Estrutura</button>
        <label>Estilo<select aria-label="Estilo do bloco" disabled={!canEdit || !selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image'} value={selectedBlock?.type ?? 'paragraph'} onChange={event => selectedBlock && changeBlockType(selectedBlock.id, event.target.value as DocBlockType)}>
          <option value="paragraph">Parágrafo</option><option value="heading">Título</option><option value="subheading">Subtítulo</option><option value="quote">Citação</option><option value="bullet">Lista</option><option value="table">Tabela</option><option value="image">Imagem</option>
        </select></label>
        <div className="doc-inline-format" aria-label="Formatação do texto selecionado">
          <button type="button" aria-label="Negrito" aria-keyshortcuts="Control+B Meta+B" aria-pressed={selectionHasInlineMark('bold')} title="Negrito" disabled={!canEdit || !selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image' || !textSelection || textSelection.blockId !== selectedBlock.id || textSelection.end <= textSelection.start} onMouseDown={event => event.preventDefault()} onClick={() => applyInlineMark('bold')}><Bold size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="Itálico" aria-keyshortcuts="Control+I Meta+I" aria-pressed={selectionHasInlineMark('italic')} title="Itálico" disabled={!canEdit || !selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image' || !textSelection || textSelection.blockId !== selectedBlock.id || textSelection.end <= textSelection.start} onMouseDown={event => event.preventDefault()} onClick={() => applyInlineMark('italic')}><Italic size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="Sublinhado" aria-keyshortcuts="Control+U Meta+U" aria-pressed={selectionHasInlineMark('underline')} title="Sublinhado" disabled={!canEdit || !selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image' || !textSelection || textSelection.blockId !== selectedBlock.id || textSelection.end <= textSelection.start} onMouseDown={event => event.preventDefault()} onClick={() => applyInlineMark('underline')}><Underline size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="Tachado" aria-keyshortcuts="Control+Shift+X Meta+Shift+X" aria-pressed={selectionHasInlineMark('strike')} title="Tachado" disabled={!canEdit || !selectedBlock || selectedBlock.type === 'table' || selectedBlock.type === 'image' || !textSelection || textSelection.blockId !== selectedBlock.id || textSelection.end <= textSelection.start} onMouseDown={event => event.preventDefault()} onClick={() => applyInlineMark('strike')}><Strikethrough size={15} aria-hidden="true" /></button>
        </div>
        {canEdit && selectedBlock?.type === 'table' && <div className="doc-table-border-control"><button type="button" aria-label="Borda" aria-expanded={tableBorderPopoverOpen} onClick={() => { const opening = !tableBorderPopoverOpen; setTableBorderPopoverOpen(opening); setTableBorderStylePickerOpen(opening) }}>Borda</button>{tableBorderPopoverOpen && <div className="doc-table-border-popover" role="dialog" aria-label="Bordas da tabela" onKeyDown={event => { if (event.key === 'Escape') { setTableBorderPopoverOpen(false); setTableBorderStylePickerOpen(false) } }}>
          <button type="button" className="doc-table-border-style-trigger" aria-label="Estilo da borda" aria-expanded={tableBorderStylePickerOpen} onClick={() => setTableBorderStylePickerOpen(open => !open)}>Estilo da borda <span aria-hidden="true"><TableProperties size={14} aria-hidden="true" /></span></button>
          {tableBorderStylePickerOpen && <div role="radiogroup" aria-label="Estilo da borda" className="doc-table-border-style-options">{([{ value: 'none', label: 'Sem borda' }, { value: 'solid', label: 'Sólida' }, { value: 'long-dashes', label: 'Traços longos' }, { value: 'dashes', label: 'Traços curtos' }, { value: 'dots', label: 'Pontos' }] as const).map(option => <button key={option.value} type="button" role="radio" data-border-style={option.value} aria-label={option.label} title={option.label} aria-checked={activeTableBorderStyle === option.value} onClick={() => setTableBorderStyleDraft(option.value)}>{option.label}</button>)}</div>}
          <label>Espessura<div className="doc-border-thickness-controls"><input aria-label="Controle da espessura da borda" type="range" min="0" max="16" step="1" value={activeTableBorderThickness} onChange={event => setTableBorderThicknessDraft(event.target.value)} /><input aria-label="Espessura da borda" type="number" min="0" max="16" value={activeTableBorderThickness} onChange={event => setTableBorderThicknessDraft(event.target.value)} /></div></label>
          <button type="button" className="doc-table-border-all" onClick={() => applyTableCellBorder(selectedBlock)}>Todas as bordas</button>
        </div>}</div>}
        <div className="doc-search-tools" role="search" aria-label="Localizar e substituir no documento">
          <input type="search" aria-label="Localizar texto" placeholder="Localizar" value={findQuery} onChange={event => { setFindQuery(event.target.value); setReplaceNotice('') }} />
          <input type="text" aria-label="Substituir por" placeholder="Substituir por" value={replaceQuery} onChange={event => setReplaceQuery(event.target.value)} />
          <label className="doc-case-toggle"><input type="checkbox" checked={caseSensitiveSearch} onChange={event => setCaseSensitiveSearch(event.target.checked)} /><CaseSensitive size={12} aria-hidden="true" /><span className="visually-hidden">Diferenciar maiúsculas e minúsculas</span></label>
          <span className="doc-search-count" role="status">{findQuery ? `${matchCount} ${matchCount === 1 ? 'resultado' : 'resultados'}` : 'Localizar'}</span>
          <button type="button" disabled={!canEdit || matchCount === 0} onClick={replaceAllMatches}>Substituir tudo</button>
          {replaceNotice && <span className="doc-search-notice" role="status">{replaceNotice}</span>}
        </div>
        <span className="doc-toolbar-hint">As alterações são salvas automaticamente</span>
        {canEdit && <div className="doc-quick-table-actions" style={{ position: 'relative' }}>
          <button ref={tableQuickActionTriggerRef} type="button" className="doc-inspector-toggle" aria-label="Ações rápidas" aria-haspopup="dialog" aria-controls="doc-quick-table-dialog" aria-expanded={tableQuickActionsOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) tableQuickActionsOpen ? closeQuickTable() : setTableQuickActionsOpen(true) } }} onClick={() => tableQuickActionsOpen ? closeQuickTable() : setTableQuickActionsOpen(true)}><Table2 size={15} aria-hidden="true" /> Ações rápidas</button>
          {tableQuickActionsOpen && <div id="doc-quick-table-dialog" role="dialog" aria-labelledby="doc-quick-table-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeQuickTable() } }} style={{ position: tableQuickActionNarrow ? 'fixed' : 'absolute', zIndex: 20, right: tableQuickActionNarrow ? 'auto' : 0, left: tableQuickActionNarrow ? 2 : 'auto', top: tableQuickActionNarrow ? 104 : 'calc(100% + 8px)', width: tableQuickActionNarrow ? 'min(386px, calc(100vw - 4px))' : 230, maxHeight: tableQuickActionNarrow ? 'calc(100dvh - 112px)' : undefined, overflowY: tableQuickActionNarrow ? 'auto' : undefined, boxSizing: 'border-box', padding: tableQuickActionNarrow ? 8 : 12, border: '1px solid #dedbe5', borderRadius: 10, background: '#fff', boxShadow: '0 12px 32px #17151f2b' }}>
            <strong id="doc-quick-table-title" aria-live="polite" aria-atomic="true" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Inserir tabela × {tableQuickActionSize.columns} × {tableQuickActionSize.rows}</strong>
            <div ref={tableQuickActionGridRef} role="grid" aria-label="Grade de dimensões da tabela" aria-rowcount={8} aria-colcount={8} onKeyDown={handleQuickTableGridKeyDown} style={{ display: 'grid', gap: tableQuickActionNarrow ? 2 : 3, overflowX: 'auto' }}>
              {Array.from({ length: 8 }, (_, rowIndex) => <div role="row" key={rowIndex} style={{ display: 'grid', gridTemplateColumns: tableQuickActionNarrow ? 'repeat(8, 44px)' : 'repeat(8, 1fr)', gap: tableQuickActionNarrow ? 2 : 3 }}>
                {Array.from({ length: 8 }, (_, columnIndex) => { const column = columnIndex + 1; const row = rowIndex + 1; const selected = column <= tableQuickActionSize.columns && row <= tableQuickActionSize.rows; const active = column === tableQuickActionSize.columns && row === tableQuickActionSize.rows; return <button key={`${row}:${column}`} type="button" role="gridcell" aria-rowindex={row} aria-colindex={column} aria-selected={active} tabIndex={active ? 0 : -1} data-table-dimensions={`${column}x${row}`} aria-label={`${column} colunas por ${row} linhas`} title={`${column} × ${row}`} onMouseEnter={() => setTableQuickActionSize({ rows: row, columns: column })} onFocus={() => setTableQuickActionSize({ rows: row, columns: column })} onClick={() => insertQuickTable(row, column)} style={{ height: tableQuickActionNarrow ? 44 : 17, minWidth: 0, padding: 0, border: '1px solid #d8d5e1', borderRadius: 2, background: selected ? '#8b7cf6' : '#fff', cursor: 'pointer' }} /> })}
              </div>)}
            </div>
            <button type="button" onClick={() => insertQuickTable(tableQuickActionSize.rows, tableQuickActionSize.columns)} style={{ marginTop: 9 }}>Inserir {tableQuickActionSize.columns} × {tableQuickActionSize.rows}</button>
          </div>}
        </div>}
        <button type="button" className="doc-inspector-toggle" aria-label="Propriedades do documento" aria-expanded={docInspectorOpen} onClick={() => setDocInspectorOpen(open => !open)}>Propriedades</button>
      </div>
      <div className="doc-scroll">
        <article ref={visiblePageRef} className="doc-page" aria-label={`Página ${visualPageIndex + 1}`} style={{ '--doc-margin-top': `${pageMargins.top}px`, '--doc-margin-right': `${pageMargins.right}px`, '--doc-margin-bottom': `${pageMargins.bottom}px`, '--doc-margin-left': `${pageMargins.left}px`, ...(visualPage.expandedHeight ? { height: `${visualPage.expandedHeight}px` } : {}) } as CSSProperties}>
          <div className="doc-page-title">{document.name}</div>
          {blocks.map((block, index) => {
            const remoteBlockUser = presence.find(user => user.id !== currentUserId && user.selection?.kind === 'doc-block' && user.selection.pageId === sourcePageId && user.selection.elementId === block.id)
            return <div key={block.id} data-doc-block-id={block.id} className={`doc-block doc-block-${block.type} ${selectedBlock?.id === block.id ? 'active' : ''} ${remoteBlockUser ? 'remote-selected' : ''}`}>
            {remoteBlockUser && <span className="doc-remote-selection-label">{remoteBlockUser.name}</span>}
            {block.type === 'table' ? <>{renderTable(block, true)}{canEdit && <div className="doc-inline-table-actions"><button type="button" onClick={() => addTableRow(block.id)}><Plus size={13} aria-hidden="true" /> Linha</button><button type="button" onClick={() => addTableColumn(block.id)}><Plus size={13} aria-hidden="true" /> Coluna</button><button type="button" disabled={(block.cells?.length ?? 0) <= 1 || (block.merges ?? []).some(merge => merge.row === (selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1))} onClick={() => deleteTableRow(block.id, selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1)}><Minus size={13} aria-hidden="true" /> Linha</button><button type="button" disabled={(block.cells?.[0]?.length ?? 0) <= 1 || (block.merges ?? []).some(merge => (selectedCell?.blockId === block.id ? selectedCell.column : (block.cells?.[0]?.length ?? 1) - 1) >= merge.column && (selectedCell?.blockId === block.id ? selectedCell.column : (block.cells?.[0]?.length ?? 1) - 1) < merge.column + merge.colSpan)} onClick={() => deleteTableColumn(block.id, selectedCell?.blockId === block.id ? selectedCell.column : (block.cells?.[0]?.length ?? 1) - 1)}><Minus size={13} aria-hidden="true" /> Coluna</button><button type="button" aria-label={`Mover linha ${(selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1) + 1} para cima`} title="Mover linha para cima" disabled={(selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1) <= 0} onClick={() => { const row = selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1; moveSelectedTableRow(block.id, row, row - 1) }}><ArrowUp size={13} aria-hidden="true" /> Mover linha para cima</button><button type="button" aria-label={`Mover linha ${(selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1) + 1} para baixo`} title="Mover linha para baixo" disabled={(selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1) >= (block.cells?.length ?? 1) - 1} onClick={() => { const row = selectedCell?.blockId === block.id ? selectedCell.row : (block.cells?.length ?? 1) - 1; moveSelectedTableRow(block.id, row, row + 1) }}><ArrowDown size={13} aria-hidden="true" /> Mover linha para baixo</button><button type="button" disabled={!tableSelection || tableSelection.anchorRow !== tableSelection.focusRow || tableSelection.anchorColumn === tableSelection.focusColumn || (block.merges ?? []).some(merge => tableSelection.anchorRow === merge.row && Math.min(tableSelection.anchorColumn, tableSelection.focusColumn) <= merge.column + merge.colSpan - 1 && Math.max(tableSelection.anchorColumn, tableSelection.focusColumn) >= merge.column)} onClick={() => mergeSelectedCells(block)}>Mesclar seleção</button><button type="button" disabled={selectedCell?.blockId !== block.id || !(block.merges ?? []).some(merge => merge.row === selectedCell.row && selectedCell.column >= merge.column && selectedCell.column < merge.column + merge.colSpan)} onClick={() => unmergeSelectedCell(block)}>Desfazer mesclagem</button><span>Shift+clique ou Shift+←/→ seleciona células - Tab no fim adiciona linha</span></div>}</> : block.type === 'image' ? renderDocImage(block, index) : <>
            {block.type === 'bullet' && <List className="doc-bullet" aria-hidden="true" size={15} />}
            <div ref={root => {
              if (!root) return
              const signature = JSON.stringify([block.text, block.marks ?? []])
              if (root.dataset.modelSignature === signature) return
              const fragment = globalThis.document.createDocumentFragment()
              for (const run of getDocTextRuns(block.text, block.marks)) {
                const span = globalThis.document.createElement('span')
                if (run.bold) span.style.fontWeight = '700'
                if (run.italic) span.style.fontStyle = 'italic'
                if (run.underline || run.strike) span.style.textDecorationLine = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ')
                span.textContent = run.text
                fragment.append(span)
              }
              root.replaceChildren(fragment)
              root.dataset.modelSignature = signature
            }} className="doc-editable-text" contentEditable={canEdit ? 'plaintext-only' : false} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-readonly={!canEdit}
              aria-label={`${block.type === 'heading' ? 'Título' : block.type === 'subheading' ? 'Subtítulo' : block.type === 'bullet' ? 'Item de lista' : block.type === 'quote' ? 'Citação' : 'Parágrafo'} ${index + 1}`}
              data-edit-block-id={block.id}
              data-placeholder={block.type === 'heading' ? 'Título do documento' : block.type === 'subheading' ? 'Subtítulo' : block.type === 'bullet' ? 'Item da lista' : block.type === 'quote' ? 'Escreva uma citação' : 'Comece a escrever…'}
              onFocus={event => { setDocSelectionPageId(sourcePageId ?? null); setSelectedBlockId(block.id); setSelectedCell(null); captureTextSelection(block.id, event.currentTarget) }}
              onKeyDown={event => {
                if (!(event.ctrlKey || event.metaKey)) return
                const key = event.key.toLocaleLowerCase()
                const mark: DocMarkKind | null = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' && !event.shiftKey ? 'underline' : key === 'x' && event.shiftKey ? 'strike' : null
                if (!mark) return
                event.preventDefault()
                const selection = readEditableSelection(event.currentTarget)
                if (!selection) return
                setTextSelection({ blockId: block.id, ...selection })
                applyInlineMark(mark, { blockId: block.id, ...selection })
              }}
              onKeyUp={event => captureTextSelection(block.id, event.currentTarget)}
              onMouseUp={event => captureTextSelection(block.id, event.currentTarget)}
              onInput={event => editBlock(block.id, event.currentTarget.innerText.replace(/\r\n/g, '\n'), event.currentTarget)}
            /></>}
          </div>
          })}
          {canEdit && <button className="doc-page-add" onClick={() => addBlock('paragraph')}><Plus size={13} aria-hidden="true" /> Adicionar parágrafo</button>}
        </article>
        <article ref={measurePageRef} className="doc-page doc-measure-page" aria-hidden="true" inert style={{ '--doc-margin-top': `${pageMargins.top}px`, '--doc-margin-right': `${pageMargins.right}px`, '--doc-margin-bottom': `${pageMargins.bottom}px`, '--doc-margin-left': `${pageMargins.left}px` } as CSSProperties}>
          <div className="doc-page-title">{document.name}</div>
          {document.pages.flatMap(page => page.blocks ?? []).map((block, index) => <div key={block.id} data-doc-block-id={block.id} className={`doc-block doc-block-${block.type}`}>
            {block.type === 'table' ? renderTable(block, false) : block.type === 'image' ? renderDocImage(block, index, false) : <>
            {block.type === 'bullet' && <List className="doc-bullet" aria-hidden="true" size={15} />}
            <div className="doc-editable-text" aria-hidden="true">{getDocTextRuns(block.text, block.marks).map(run => <span key={`${run.start}-${run.end}`} style={{ fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? 'italic' : undefined, textDecorationLine: run.underline || run.strike ? [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') : undefined }}>{run.text}</span>)}</div>
            </>}
          </div>)}
          {canEdit && <button className="doc-page-add"><Plus size={13} aria-hidden="true" /> Adicionar par??grafo</button>}
        </article>
      </div>
      {docBottomPanel && <section className={`doc-bottom-panel doc-bottom-panel-${docBottomPanel}`} aria-label={docBottomPanel === 'notes' ? 'Notas privadas' : 'Temporizador'}>
        <header><strong>{docBottomPanel === 'notes' ? <><NotebookPen size={15} aria-hidden="true" /> Notas privadas</> : <><Timer size={15} aria-hidden="true" /> Temporizador</>}</strong><button type="button" aria-label="Fechar painel inferior" onClick={() => setDocBottomPanel(null)}><X size={15} aria-hidden="true" /></button></header>
        {docBottomPanel === 'notes' ? <><textarea aria-label="Notas privadas neste dispositivo" value={docNotes} onChange={event => setDocNotes(event.target.value)} placeholder="Anotacoes privadas neste dispositivo" /><small>Salvas somente neste dispositivo.</small></> : <div className="doc-timer-controls"><button type="button" aria-label="Diminuir um minuto" title="Diminuir um minuto" disabled={docTimerRunning || docTimerSeconds <= 60} onClick={() => adjustDocTimerMinutes(-1)}><Minus size={15} aria-hidden="true" /></button><output aria-label="Tempo restante">{String(Math.floor(docTimerSeconds / 60)).padStart(2, '0')}:{String(docTimerSeconds % 60).padStart(2, '0')}</output><button type="button" aria-label="Aumentar um minuto" title="Aumentar um minuto" disabled={docTimerRunning || docTimerSeconds >= 24 * 60 * 60} onClick={() => adjustDocTimerMinutes(1)}><Plus size={15} aria-hidden="true" /></button><button type="button" aria-label={docTimerRunning ? 'Pausar temporizador' : 'Iniciar temporizador'} onClick={() => setDocTimerRunning(running => !running)}>{docTimerRunning ? 'Pausar' : 'Iniciar'}</button><button type="button" aria-label="Redefinir temporizador" onClick={() => { setDocTimerRunning(false); setDocTimerSeconds(5 * 60) }}>Redefinir</button></div>}
      </section>}
      <footer className="doc-page-footer" aria-label="Barra inferior do documento">
        <div className="doc-footer-utilities">
          <button type="button" aria-pressed={docBottomPanel === 'notes'} onClick={() => setDocBottomPanel(panel => panel === 'notes' ? null : 'notes')}><NotebookPen size={16} aria-hidden="true" /> Notas</button>
          <button type="button" aria-pressed={docOutlineOpen} onClick={() => setDocOutlineOpen(open => !open)}><List size={16} aria-hidden="true" /> {"\u00cdndice"}</button>
          <button type="button" aria-pressed={docBottomPanel === 'timer'} onClick={() => setDocBottomPanel(panel => panel === 'timer' ? null : 'timer')}><Timer size={16} aria-hidden="true" /> Temporizador</button>
        </div>
        <div className="doc-footer-pagination"><button aria-label="Pagina anterior" disabled={visualPageIndex === 0} onClick={() => goToPage(visualPageIndex - 1)}><ChevronLeft size={15} aria-hidden="true" /></button><span>Paginas <strong>{visualPageIndex + 1}/{visualPages.length}</strong></span><button aria-label="Proxima pagina" disabled={visualPageIndex === visualPages.length - 1} onClick={() => goToPage(visualPageIndex + 1)}><ChevronRight size={15} aria-hidden="true" /></button></div>
        <div className="doc-footer-page-actions">{canEdit && <><button className="doc-page-action" aria-label="Duplicar pagina" onClick={onDuplicatePage}><Copy size={14} aria-hidden="true" /></button><button className="doc-page-action" aria-label="Mover pagina para a esquerda" disabled={pageIndex === 0} onClick={() => onMovePage(pageIndex - 1)}><ArrowLeft size={14} aria-hidden="true" /></button><button className="doc-page-action" aria-label="Mover pagina para a direita" disabled={pageIndex === document.pages.length - 1} onClick={() => onMovePage(pageIndex + 1)}><ArrowRight size={14} aria-hidden="true" /></button><button className="doc-page-action" aria-label="Excluir pagina" disabled={document.pages.length <= 1} onClick={onDeletePage}><Trash2 size={14} aria-hidden="true" /></button><button className="doc-new-page" aria-label="Nova pagina" onClick={onAddPage}><Plus size={14} aria-hidden="true" /></button></>}</div>
      </footer>
    </section>
    <aside className="doc-inspector"><span className="panel-kicker">DOCUMENTO</span><h2>{selectedBlock ? 'Bloco selecionado' : 'Texto'}</h2><p>{selectedBlock ? `${selectedBlock.type === 'image' ? 'Imagem' : selectedBlock.type === 'table' ? 'Tabela' : selectedBlock.type === 'heading' ? 'Título' : selectedBlock.type === 'subheading' ? 'Subtítulo' : selectedBlock.type === 'quote' ? 'Citação' : selectedBlock.type === 'bullet' ? 'Item de lista' : 'Parágrafo'} - ${selectedBlock.type === 'image' ? `${selectedBlock.image?.width ?? 0} × ${selectedBlock.image?.height ?? 0}` : selectedBlock.type === 'table' ? `${selectedBlock.cells?.length ?? 0} × ${selectedBlock.cells?.[0]?.length ?? 0}` : selectedBlock.text.length} ${selectedBlock.type === 'image' ? 'px' : selectedBlock.type === 'table' ? 'células' : 'caracteres'}` : 'Selecione um bloco para editar.'}</p>
      {canEdit && selectedBlock?.type === 'table' && <div className="doc-table-controls"><label>Espaçamento<input aria-label="Espaçamento da tabela" type="number" min="0" max="32" value={selectedBlock.tableSpacing ?? 0} onChange={event => patchBlock(selectedBlock.id, { tableSpacing: Math.max(0, Math.min(32, Number(event.target.value) || 0)) })} /></label><label>Preenchimento<input aria-label="Preenchimento das células" type="number" min="0" max="32" value={selectedBlock.cellPadding ?? 8} onChange={event => patchBlock(selectedBlock.id, { cellPadding: Math.max(0, Math.min(32, Number(event.target.value) || 0)) })} /></label><label>Cor da borda<input aria-label="Cor da borda da tabela" type="color" value={selectedBlock.borderColor ?? '#d9d9d9'} onChange={event => patchBlock(selectedBlock.id, { borderColor: event.target.value })} /></label></div>}
      {canEdit && selectedBlock && <div className="doc-block-order-controls"><button type="button" aria-label="Mover bloco para cima" disabled={(document.pages[sourcePageIndex]?.blocks ?? []).findIndex(block => block.id === selectedBlock.id) <= 0} onClick={() => moveBlock(selectedBlock.id, -1)}>Mover para cima</button><button type="button" aria-label="Mover bloco para baixo" disabled={(document.pages[sourcePageIndex]?.blocks ?? []).findIndex(block => block.id === selectedBlock.id) >= (document.pages[sourcePageIndex]?.blocks?.length ?? 0) - 1} onClick={() => moveBlock(selectedBlock.id, 1)}>Mover para baixo</button></div>}
      {canEdit && selectedBlock && <button className="doc-delete-block" disabled={blocks.length <= 1} onClick={() => removeBlock(selectedBlock.id)}>Excluir bloco</button>}
      <div className="doc-format-help"><strong>Formato do documento</strong><span>A4 - {document.width} × {document.height} px</span><span>Margens: {Object.values(pageMargins).map(value => `${(value * 2.54 / 96).toFixed(2)} cm`).join(' - ')}</span><button type="button" aria-expanded={pageSetupOpen} aria-controls="doc-page-setup" onClick={() => setPageSetupOpen(open => !open)}>Configurar página</button>{pageSetupOpen && <section id="doc-page-setup" className="doc-page-setup" aria-label="Configuração da página"><strong>Configuração da página</strong><label>Formato<select aria-label="Formato da página" value="a4" disabled><option value="a4">A4 - 21 × 29,7 cm</option></select></label>{(['top', 'right', 'bottom', 'left'] as const).map((side, index) => <label key={side}>{['Superior', 'Direita', 'Inferior', 'Esquerda'][index]}<span className="doc-page-margin-input"><input aria-label={`Margem ${['superior', 'direita', 'inferior', 'esquerda'][index]} em centímetros`} type="number" min="0" max="5.08" step="0.01" value={(pageMargins[side] * 2.54 / 96).toFixed(2)} disabled={!canEdit} onChange={event => setPageMargin(side, Number(event.target.value) || 0)} /><span>cm</span></span></label>)}<small>21 × 29,7 cm - A4 retrato</small></section>}<span>{document.pages.length} {document.pages.length === 1 ? 'página' : 'páginas'}</span></div>
    </aside>
  </div>
}

function PresentationSlideThumbnail({ document, pageIndex, active, onClick, disabled = false }: { document: DesignDocument; pageIndex: number; active: boolean; onClick: () => void; disabled?: boolean }) {
  const page = document.pages[pageIndex]
  return <button className={`presentation-slide-row ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} aria-label={`Abrir slide ${pageIndex + 1}: ${page.name}`} aria-current={active ? 'page' : undefined}>
    <span className="presentation-slide-thumb" style={{ background: page.background }}>
      {page.elements.slice(0, 8).map(element => {
        const style: CSSProperties = { left: `${element.x / document.width * 100}%`, top: `${element.y / document.height * 100}%`, width: `${element.width / document.width * 100}%`, height: `${element.height / document.height * 100}%` }
        if (element.type === 'shape') return <VectorShapePreview key={element.id} element={element} className="presentation-slide-thumb-shape" style={{ ...style, position: 'absolute', borderRadius: element.shape === 'ellipse' ? '50%' : 0 }} />
        if (element.type === 'image') return <img key={element.id} src={element.src} alt="" style={style} />
        if (element.type === 'sticky-note') return <i key={element.id} className="presentation-slide-thumb-text" style={{ ...style, color: element.color, background: element.fill }}>{element.text}</i>
        if (element.type === 'free-draw') return <svg key={element.id} style={{ ...style, position: 'absolute', overflow: 'visible' }} viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none"><polyline points={Array.from({ length: element.points.length / 2 }, (_, index) => `${element.points[index * 2]},${element.points[index * 2 + 1]}`).join(' ')} fill="none" stroke={element.color} strokeWidth={Math.max(6, element.strokeWidth)} opacity={element.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" /></svg>
        return <i key={element.id} className="presentation-slide-thumb-text" style={{ ...style, color: element.color, background: `${element.color}22`, fontWeight: element.bold ? 700 : 400 }}>{element.text}</i>
      })}
    </span>
    <span className="presentation-slide-label"><b>{pageIndex + 1}</b><span>{page.name || `Slide ${pageIndex + 1}`}</span></span>
  </button>
}

function PresentationOverlay({ document, pageIndex, onPageChange, onClose, canControlSlides }: { document: DesignDocument; pageIndex: number; onPageChange: (index: number) => void; onClose: () => void; canControlSlides: boolean }) {
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [presenterMode, setPresenterMode] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const presentationDialogRef = useRef<HTMLElement>(null)
  const presenterView = getPresenterView(document, pageIndex)
  const page = presenterView.page

  useEffect(() => {
    const previouslyFocused = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
    presentationDialogRef.current?.focus()
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setStageSize({ width: rect.width, height: rect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      else if (event.key === 'Tab') {
        const dialog = presentationDialogRef.current
        if (!dialog) return
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0)
        const activeIndex = focusable.indexOf(window.document.activeElement as HTMLElement)
        if (focusable.length === 0) {
          event.preventDefault()
          dialog.focus()
        } else if (event.shiftKey && activeIndex <= 0) {
          event.preventDefault()
          focusable[focusable.length - 1].focus()
        } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
          event.preventDefault()
          focusable[0].focus()
        }
      }
      else if (!canControlSlides) return
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); onPageChange(clampPresentationPage(pageIndex + 1, document.pages.length)) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); onPageChange(clampPresentationPage(pageIndex - 1, document.pages.length)) }
      else if (event.key === 'Home') { event.preventDefault(); onPageChange(clampPresentationPage(0, document.pages.length)) }
      else if (event.key === 'End') { event.preventDefault(); onPageChange(clampPresentationPage(document.pages.length - 1, document.pages.length)) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canControlSlides, document.pages.length, onClose, onPageChange, pageIndex])

  return <section ref={presentationDialogRef} tabIndex={-1} className={`presentation-overlay ${presenterMode ? 'presenter-mode' : ''}`} style={{ '--slide-ratio': String(document.width / document.height) } as CSSProperties} role="dialog" aria-modal="true" aria-label={`${document.name} — apresentação`} onTouchStart={event => setTouchStart(event.changedTouches[0]?.clientX ?? null)} onTouchEnd={event => {
    if (touchStart === null) return
    const delta = event.changedTouches[0].clientX - touchStart
    if (canControlSlides && Math.abs(delta) > 45) onPageChange(clampPresentationPage(pageIndex + (delta < 0 ? 1 : -1), document.pages.length))
    setTouchStart(null)
  }}>
    <div className="presentation-stage" ref={stageRef} style={{ aspectRatio: `${document.width} / ${document.height}`, background: page?.background ?? '#fff' }}>
      {(page?.elements ?? []).map(element => {
        const style: CSSProperties = {
          left: `${element.x / document.width * 100}%`, top: `${element.y / document.height * 100}%`,
          width: `${element.width / document.width * 100}%`, height: `${element.height / document.height * 100}%`,
          transform: `rotate(${element.rotation}deg)`,
        }
        if (element.type === 'image') return <img key={element.id} className="presentation-element" src={element.src} alt={element.name} style={{ ...style, objectFit: 'contain' }} />
        if (element.type === 'shape') return <VectorShapePreview key={element.id} element={element} className="presentation-element" style={{ ...style, borderRadius: element.shape === 'ellipse' ? '50%' : `${element.cornerRadius / document.width * 100}%` }} />
        if (element.type === 'sticky-note') return <span key={element.id} className="presentation-element presentation-text" style={{ ...style, padding: '2%', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'pre-wrap', color: element.color, background: element.fill, fontSize: `${element.fontSize * stageSize.height / document.height}px` }}>{element.text}</span>
        if (element.type === 'free-draw') return <svg key={element.id} className="presentation-element" style={style} viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none"><polyline points={Array.from({ length: element.points.length / 2 }, (_, index) => `${element.points[index * 2]},${element.points[index * 2 + 1]}`).join(' ')} fill="none" stroke={element.color} strokeWidth={element.strokeWidth} opacity={element.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" /></svg>
        return <span key={element.id} className="presentation-element presentation-text" style={{ ...style, color: element.color, fontSize: `${element.fontSize * stageSize.height / document.height}px`, fontFamily: element.fontFamily, fontWeight: element.bold ? 700 : 400 }}>{element.text}</span>
      })}
    </div>
    {presenterMode && <aside className="presenter-panel" aria-label="Painel do apresentador">
      <section><span className="panel-kicker">NOTAS DO APRESENTADOR</span><h2>{page?.name}</h2><p className="presenter-note-copy">{page?.presenterNotes?.trim() || 'Este slide ainda não tem notas.'}</p></section>
      <section className="presenter-next"><span className="panel-kicker">PRÓXIMO SLIDE</span>{presenterView.nextPage ? <PresentationSlideThumbnail document={document} pageIndex={presenterView.pageIndex + 1} active={false} disabled={!canControlSlides} onClick={() => onPageChange(presenterView.pageIndex + 1)} /> : <p>Este é o último slide.</p>}</section>
    </aside>}
    <div className="presentation-controls"><button onClick={() => onPageChange(clampPresentationPage(pageIndex - 1, document.pages.length))} disabled={!canControlSlides || pageIndex === 0} aria-label="Slide anterior"><ChevronLeft size={16} aria-hidden="true" /></button><span>Slide {pageIndex + 1} de {document.pages.length}</span><button onClick={() => onPageChange(clampPresentationPage(pageIndex + 1, document.pages.length))} disabled={!canControlSlides || pageIndex === document.pages.length - 1} aria-label="Próximo slide"><ChevronRight size={16} aria-hidden="true" /></button><button className="presenter-mode-toggle" onClick={() => setPresenterMode(mode => !mode)} aria-pressed={presenterMode}>{presenterMode ? 'Tela limpa' : 'Modo apresentador'}</button><button className="presentation-close" onClick={onClose}>Sair <kbd>Esc</kbd></button></div>
  </section>
}

function sitePublicationSlug(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '') || 'meu-site'
}

function SitePublicationDialog({ document, documentId, onClose }: { document: DesignDocument; documentId: string; onClose: () => void }) {
  const [providerStatus, setProviderStatus] = useState<ExternalProviderStatus['sitePublication'] | null>(null)
  const [slug, setSlug] = useState(() => sitePublicationSlug(document.name))
  const [confirmed, setConfirmed] = useState(false)
  const [publicationState, setPublicationState] = useState<RemoteSitePublicationState | null>(null)
  const [loading, setLoading] = useState(true)
  const [publicationLoading, setPublicationLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const validSlug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug.trim().toLowerCase())

  useEffect(() => {
    let active = true
    getExternalProviderStatus().then(status => { if (active) setProviderStatus(status.sitePublication) })
      .catch(() => { if (active) setError('Não foi possível verificar a configuração do provedor.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    getRemoteSitePublication(documentId).then(state => {
      if (!active) return
      setPublicationState(state)
      if (state.publication) setSlug(state.publication.slug)
    }).catch(() => { if (active) setError('Não foi possível carregar a publicação salva.') })
      .finally(() => { if (active) setPublicationLoading(false) })
    return () => { active = false }
  }, [documentId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !publishing) { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, publishing])

  async function submitPublication() {
    setPublishing(true)
    setError('')
    try {
      const publication = await publishRemoteSite(documentId, slug.trim().toLowerCase())
      setPublicationState({ publication, currentRevision: publication.publishedRevision, isOutdated: false })
      setSlug(publication.slug)
      setConfirmed(false)
      try {
        const state = await getRemoteSitePublication(documentId)
        setPublicationState(state)
      } catch { /* Keep the successful provider response visible if refreshing saved status fails. */ }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível publicar o site.') }
    finally { setPublishing(false) }
  }

  return <div className="site-publish-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !publishing) onClose() }}>
    <section className="site-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="site-publish-title" aria-describedby="site-publish-description">
      <header><div><span className="panel-kicker">PUBLICAÇÃO DO SITE</span><h2 id="site-publish-title">{confirmed ? 'Confirmar publicação' : 'Publicar site'}</h2></div><button type="button" className="asset-close" aria-label="Fechar publicação" disabled={publishing} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
      {publicationState?.publication && <div className={`site-publish-deployment${publicationState.isOutdated ? ' stale' : ''}`} role="status"><strong>{publicationState.isOutdated ? 'A publicação está desatualizada' : 'Site publicado'}</strong><a href={publicationState.publication.url} target="_blank" rel="noopener noreferrer">{publicationState.publication.url}</a><small>ID da implantação: <code>{publicationState.publication.deploymentId}</code></small><small>Publicado em {new Date(publicationState.publication.publishedAt).toLocaleString('pt-BR')}</small>{publicationState.isOutdated && <span className="site-publish-stale">O rascunho tem alterações posteriores à versão publicada. Publique novamente para atualizar o site.</span>}</div>}
      <>
        <p id="site-publish-description">O provedor receberá as seções visíveis de <strong>{document.name}</strong>. Seções ocultas e notas do apresentador ficam de fora.</p>
        <label className="site-publish-slug">Endereço do site<input autoFocus type="text" aria-label="Identificador do site" value={slug} maxLength={63} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event => { setSlug(event.target.value); setConfirmed(false); setError('') }} aria-invalid={Boolean(slug.trim()) && !validSlug} aria-describedby="site-publish-slug-help" /></label>
        <small id="site-publish-slug-help" className="site-publish-help">Use 1–63 letras minúsculas, números ou hífens internos.</small>
        {loading ? <p className="site-publish-provider" role="status">Verificando a configuração do provedor…</p> : providerStatus?.configured ? <p className="site-publish-provider ready" role="status">Provedor de publicação configurado.</p> : <div className="site-publish-provider missing" role="status"><strong>Publicação indisponível</strong><span>Configure um provedor de hospedagem para habilitar o envio.</span>{providerStatus?.missing.map(item => <code key={item}>{item}</code>)}</div>}
        {error && <p className="site-publish-error" role="alert">{error}</p>}
        <footer>{confirmed ? <><button type="button" onClick={() => setConfirmed(false)} disabled={publishing}>Voltar</button><button type="button" className="primary-button" disabled={publishing || loading || publicationLoading || !providerStatus?.configured || !validSlug} onClick={() => void submitPublication()}>{publishing ? 'Publicando…' : 'Confirmar e publicar'}</button></> : <><button type="button" onClick={onClose} disabled={publishing}>Cancelar</button><button type="button" className="primary-button" disabled={loading || publicationLoading || !providerStatus?.configured || !validSlug} onClick={() => { setError(''); setConfirmed(true) }}>{publicationState?.isOutdated ? 'Publicar alterações' : publicationState?.publication ? 'Publicar novamente' : 'Continuar'}</button></>}</footer>
      </>
      <p className="site-publish-unverified">Controle novo; aparência e comportamento visual ainda não foram validados contra uma referência do Canva.</p>
    </section>
  </div>
}

function SitePreviewOverlay({ document, onClose }: { document: DesignDocument; onClose: () => void }) {
  const [preferences] = useState(() => readSitePreviewPreferences(document.id))
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>(preferences.viewportMode)
  const [expandedNavigation, setExpandedNavigation] = useState(false)
  const [mobileFit, setMobileFit] = useState(preferences.mobileFit)
  const sectionAnchors = siteSectionAnchors(document.pages.map(sitePage => sitePage.id))
  useEffect(() => { persistSitePreviewViewport(document.id, viewportMode) }, [document.id, viewportMode])
  useEffect(() => { persistSitePreviewMobileFit(document.id, mobileFit) }, [document.id, mobileFit])
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null)
  return <div className="site-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="site-preview-dialog" role="dialog" aria-modal="true" aria-label="Prévia responsiva do site">
    <header><div><span className="panel-kicker">PRÉVIA DO SITE</span><h2>{document.name}</h2></div><div className="site-preview-controls" role="group" aria-label="Tamanho da prévia"><button type="button" aria-pressed={viewportMode === 'desktop'} onClick={() => setViewportMode('desktop')}><Monitor size={16} aria-hidden="true" />Desktop</button><button type="button" aria-pressed={viewportMode === 'mobile'} onClick={() => setViewportMode('mobile')}><Smartphone size={16} aria-hidden="true" />Celular</button>{viewportMode === 'mobile' && <button type="button" aria-label="Ajuste para dispositivos móveis" aria-pressed={mobileFit} onClick={() => setMobileFit(value => !value)}>Ajuste móvel</button>}<button type="button" className="site-preview-close" onClick={onClose} aria-label="Fechar prévia"><X size={18} aria-hidden="true" /></button></div></header>
      <div className="site-preview-scroll"><div id="site-top" className={`site-preview-frame ${viewportMode}`} style={{ maxWidth: viewportMode === 'mobile' ? 390 : 1200 }}>
        <nav className="site-preview-nav" aria-label="Navegação do site" onKeyDown={event => { if (event.key === 'Escape' && expandedNavigation) { event.preventDefault(); setExpandedNavigation(false); mobileMenuToggleRef.current?.focus() } }}><a className="site-preview-brand" href="#site-top">{document.name}</a>{viewportMode === 'mobile' && <button ref={mobileMenuToggleRef} type="button" className="site-preview-menu-toggle" aria-label={expandedNavigation ? 'Fechar menu de navegação' : 'Abrir menu de navegação'} aria-expanded={expandedNavigation} onClick={() => setExpandedNavigation(open => !open)}>{expandedNavigation ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}</button>}<div className={expandedNavigation ? 'expanded' : ''}>{document.pages.filter(sitePage => !sitePage.hidden).map(sitePage => <a key={sitePage.id} href={`#${sectionAnchors[sitePage.id]}`} onClick={() => setExpandedNavigation(false)}>{sitePage.name}</a>)}</div></nav>
        {document.pages.map((sitePage, pageIndex) => sitePage.hidden ? null : <section className="site-preview-section" id={sectionAnchors[sitePage.id]} key={sitePage.id} aria-label={`${sitePage.name}, seção ${pageIndex + 1}`} style={{ aspectRatio: `${document.width} / ${document.height}`, background: sitePage.background }}>
          {sitePage.elements.map(element => {
            const style: CSSProperties = { position: 'absolute', left: `${element.x / document.width * 100}%`, top: `${element.y / document.height * 100}%`, width: `${element.width / document.width * 100}%`, height: `${element.height / document.height * 100}%`, transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined }
            if (element.type === 'shape') return <VectorShapePreview key={element.id} element={element} className="site-preview-element" style={{ ...style, borderRadius: element.shape === 'ellipse' ? '50%' : element.cornerRadius }} />
            if (element.type === 'image') return <img key={element.id} className="site-preview-element" src={element.src} alt={element.name} style={{ ...style, objectFit: 'cover', opacity: (element.opacity ?? 100) / 100 }} />
            if (element.type === 'free-draw') return <svg key={element.id} className="site-preview-element" viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none" style={style} aria-hidden="true"><polyline points={Array.from({ length: element.points.length / 2 }, (_, index) => `${element.points[index * 2]},${element.points[index * 2 + 1]}`).join(' ')} fill="none" stroke={element.color} strokeWidth={element.strokeWidth} opacity={element.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" /></svg>
            const text = element.type === 'text' || element.type === 'sticky-note' ? element.text : ''
            const color = element.type === 'text' || element.type === 'sticky-note' ? element.color : '#26233d'
            const fontSize = element.type === 'text' || element.type === 'sticky-note' ? element.fontSize : 16
            const background = element.type === 'sticky-note' ? element.fill : 'transparent'
            const bold = element.type === 'text' ? element.bold : false
            const copyStyle: CSSProperties = { ...style, ...(viewportMode === 'mobile' && !mobileFit && element.type === 'text' ? { width: `${element.width / document.width * 60}%`, whiteSpace: 'nowrap' as const, overflowWrap: 'normal' as const } : {}), color, background, fontSize: `${fontSize / document.width * 100}cqw`, fontFamily: element.type === 'text' ? element.fontFamily : 'Arial, sans-serif', fontWeight: bold ? 700 : 400, whiteSpace: viewportMode === 'mobile' && !mobileFit && element.type === 'text' ? 'nowrap' : 'pre-wrap', overflowWrap: 'anywhere' }
            const href = element.type === 'text' ? normalizeSiteHref(element.href) : null
            if (href) return <a key={element.id} className="site-preview-element site-preview-copy site-preview-link" href={href} target={/^https?:/i.test(href) ? '_blank' : undefined} rel={/^https?:/i.test(href) ? 'noopener noreferrer' : undefined} style={copyStyle}>{text}</a>
            return <div key={element.id} className="site-preview-element site-preview-copy" style={copyStyle}>{text}</div>
          })}
        </section>)}
      </div></div>
      <footer>Prévia local responsiva. Publicação e domínio externos ainda não estão conectados.</footer>
    </section>
  </div>
}

function DesignEditor({ documentId, storageMode, onExit, onShare, onCreateBulkProjects, currentUserId }: { documentId: string; storageMode: 'local' | 'cloud'; onExit: (nextDocumentId?: string, returnToLocalLibrary?: boolean) => void; onShare?: () => void; onCreateBulkProjects: (source: DesignDocument, pages: DesignPage[], teamId: string | null) => Promise<{ created: number; failed: number }>; currentUserId?: string }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, (): EditorState => ({
    document: createBlankDocument(), pageIndex: 0, selectedId: null, selectedIds: [], undoStack: [], redoStack: [],
  }))
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved')
  const [saveRetryToken, setSaveRetryToken] = useState(0)
  const [remoteConflict, setRemoteConflict] = useState<RemoteDocument | null>(null)
  const [remoteRole, setRemoteRole] = useState<RemoteDocument['role'] | null>(null)
  const [remoteTeamId, setRemoteTeamId] = useState<string | null>(null)
  const [permissionNotice, setPermissionNotice] = useState('')
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<RemoteComment[]>([])
  const [commentCollaborators, setCommentCollaborators] = useState<RemoteCollaborator[]>([])
  const [commentNotifications, setCommentNotifications] = useState<RemoteNotification[]>([])
  const [notificationsUnread, setNotificationsUnread] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiConversation, setAiConversation] = useState<AiChatMessage[]>(() => readAiChat(documentId))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiAddMenuOpen, setAiAddMenuOpen] = useState(false)
  const [aiAttachmentPickerMode, setAiAttachmentPickerMode] = useState<'upload' | 'designs' | null>(null)
  const [aiAttachments, setAiAttachments] = useState<AiComposerAttachment[]>([])
  const [aiBrandContextOpen, setAiBrandContextOpen] = useState(false)
  const [aiBrandContextDraftKitId, setAiBrandContextDraftKitId] = useState('default')
  const [aiAppliedBrandContext, setAiAppliedBrandContext] = useState<AiBrandContext | null>(null)
  const aiAddMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const aiAddMenuWrapRef = useRef<HTMLDivElement>(null)
  const aiBrandKitSelectRef = useRef<HTMLSelectElement>(null)
  const [aiImageOpen, setAiImageOpen] = useState(false)
  const [aiImageDreamLabTab, setAiImageDreamLabTab] = useState(false)
  const [aiImagePrompt, setAiImagePrompt] = useState('')
  const [aiImagePreview, setAiImagePreview] = useState<{ mimeType: string; dataUrl: string; width: number; height: number; mode: 'sandbox' | 'openai-compatible' } | null>(null)
  const [aiImageBusy, setAiImageBusy] = useState(false)
  const [aiImageError, setAiImageError] = useState('')
  const [aiDirectoryTab, setAiDirectoryTab] = useState<'apps' | 'connectors'>('apps')
  const aiAppsTabRef = useRef<HTMLButtonElement>(null)
  const aiConnectorsTabRef = useRef<HTMLButtonElement>(null)
  const aiPromptInputRef = useRef<HTMLTextAreaElement>(null)
  const latestAiResponse = [...aiConversation].reverse().find(message => message.role === 'assistant')
  const aiText = latestAiResponse?.text ?? ''
  const handleAiDirectoryTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'apps' : event.key === 'End' ? 'connectors' : aiDirectoryTab === 'apps' ? 'connectors' : 'apps'
    setAiDirectoryTab(next)
    if (next === 'apps') aiAppsTabRef.current?.focus()
    else aiConnectorsTabRef.current?.focus()
  }
  const [commentsBusy, setCommentsBusy] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyVersions, setHistoryVersions] = useState<RemoteDocumentVersion[]>([])
  const [historyCurrentRevision, setHistoryCurrentRevision] = useState(0)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null)
  const [historyCopiedDocument, setHistoryCopiedDocument] = useState<RemoteDocument | null>(null)
  const [copyingRevision, setCopyingRevision] = useState<number | null>(null)
  const [presence, setPresence] = useState<RemotePresence[]>([])
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting')
  const [exportFormat, setExportFormat] = useState<'pdf' | 'png' | 'jpeg' | 'svg' | 'pptx' | VideoExportFormat | 'gif' | 'csv' | 'xlsx' | 'docx'>('pdf')
  const [exportImageScale, setExportImageScale] = useState<1 | 2 | 3>(2)
  const [exportJpegQuality, setExportJpegQuality] = useState<'low' | 'medium' | 'high'>('high')
  const [exportPngBackground, setExportPngBackground] = useState<'opaque' | 'transparent'>('opaque')
  const [pdfAdvancedOpen, setPdfAdvancedOpen] = useState(false)
  const [pdfCompact, setPdfCompact] = useState(true)
  const [pdfPasswordEnabled, setPdfPasswordEnabled] = useState(false)
  const [pdfPassword, setPdfPassword] = useState('')
  const [pdfPasswordCopied, setPdfPasswordCopied] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [videoPlayheadMs, setVideoPlayheadMs] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [selectedVideoTimelineClipId, setSelectedVideoTimelineClipId] = useState<string | null>(null)
  const [beatMarkersVisible, setBeatMarkersVisible] = useState(false)
  const videoPlayheadRef = useRef(0)
  const [siteLinkNotice, setSiteLinkNotice] = useState('')
  const [siteLinkDrafts, setSiteLinkDrafts] = useState<Record<string, string>>({})
  const [sitePublicationOpen, setSitePublicationOpen] = useState(false)
  const remoteRevisionRef = useRef(0)
  const remoteConflictRef = useRef(false)
  const pageInsertSnapshotRecoveryRef = useRef(false)
  const remoteSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingCollaborativeOperationIdsRef = useRef(new Set<string>())
  const pendingDesignElementPatchesRef = useRef(new Map<string, { timer: number; patch: Partial<DesignElement> }>())
  const pendingDesignPagePatchesRef = useRef(new Map<string, { timer: number; patch: Partial<Pick<DesignPage, 'name' | 'background' | 'hidden'>>; baseRevision: number }>())
  const pendingPresenterNotesRef = useRef(new Map<string, { timer: number; notes: string; baseRevision: number }>())
  const persistedDocumentRef = useRef<DesignDocument | null>(null)
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [teamAssets, setTeamAssets] = useState<MediaAsset[]>([])
  const [teamAssetsTeamId, setTeamAssetsTeamId] = useState<string | null>(null)
  const [assetPanelOpen, setAssetPanelOpen] = useState(false)
  const [assetQuery, setAssetQuery] = useState('')
  const [assetCategory, setAssetCategory] = useState('Todas')
  const [assetError, setAssetError] = useState('')
  const [assetBusy, setAssetBusy] = useState(false)
  const [imageEditPanelOpen, setImageEditPanelOpen] = useState(false)
  const [imageEditInitialMode, setImageEditInitialMode] = useState<'tools' | 'adjust' | 'mask' | 'animation'>('tools')
  const [imageCropOpen, setImageCropOpen] = useState(false)
  const [compareImageOriginal, setCompareImageOriginal] = useState(false)
  const [replaceSelectedImageId, setReplaceSelectedImageId] = useState<string | null>(null)
  const [imageEditNotice, setImageEditNotice] = useState('')
  const [imageOpacityDraft, setImageOpacityDraft] = useState<{ elementId: string; value: string } | null>(null)
  const [altTextEditorId, setAltTextEditorId] = useState<string | null>(null)
  const [altTextDraft, setAltTextDraft] = useState('')
  const [altTextDecorativeDraft, setAltTextDecorativeDraft] = useState(false)
  const [brandKitOpen, setBrandKitOpen] = useState(false)
  const [brandKitMenuOpen, setBrandKitMenuOpen] = useState(false)
  const [brandResourceCategory, setBrandResourceCategory] = useState('Cores')
  const [brandAssistantOpen, setBrandAssistantOpen] = useState(false)
  const [accessibilitySavedDocument, setAccessibilitySavedDocument] = useState<DesignDocument | null>(null)
  const [accessibilityOpen, setAccessibilityOpen] = useState(false)
  const [accessibilityTargetId, setAccessibilityTargetId] = useState<string | null>(null)
  const [accessibilitySelectedIssues, setAccessibilitySelectedIssues] = useState<string[]>([])
  const [accessibilityAltDrafts, setAccessibilityAltDrafts] = useState<Record<string, string>>({})
  const [accessibilityBatchAltOpen, setAccessibilityBatchAltOpen] = useState(false)
  const [accessibilityFilter, setAccessibilityFilter] = useState<'all' | 'alt' | 'typography'>('all')
  const accessibilityTriggerRef = useRef<HTMLButtonElement>(null)
  const accessibilityDialogRef = useRef<HTMLElement>(null)
  const accessibilityCloseRef = useRef<HTMLButtonElement>(null)
  const [imageTransparencyOpen, setImageTransparencyOpen] = useState(false)
  const [imageFlipMenuOpen, setImageFlipMenuOpen] = useState(false)
  const [presentationOpen, setPresentationOpen] = useState(false)
  const [sitePreviewOpen, setSitePreviewOpen] = useState(false)
  const [presentationPage, setPresentationPage] = useState(0)
  const [presenterNotesOpen, setPresenterNotesOpen] = useState(false)
  const [localPresentationActive, setLocalPresentationActive] = useState(false)
  const [followingPresentationId, setFollowingPresentationId] = useState<string | null>(null)
  const [remotePresentation, setRemotePresentation] = useState<RemotePresentation | null>(null)
  const [viewport, setViewport] = useState({ width: 960, height: 720 })
  const [viewportMeasured, setViewportMeasured] = useState(false)
  const [whiteboardZoom, setWhiteboardZoom] = useState(0.55)
  const [editorZoom, setEditorZoom] = useState<EditorZoomState>(() => createEditorZoomState(54, 'fit-page'))
  const [editorZoomMenuOpen, setEditorZoomMenuOpen] = useState(false)
  const [whiteboardPosition, setWhiteboardPosition] = useState({ x: 0, y: 0 })
  const [editorCanvasPan, setEditorCanvasPan] = useState({ x: 0, y: 0 })
  const [whiteboardTool, setWhiteboardTool] = useState<'select' | 'pan' | 'connector' | 'draw'>('select')
  const [qrDrafts, setQrDrafts] = useState<Record<string, string>>({})
  const [qrErrors, setQrErrors] = useState<Record<string, string>>({})
  const [editorToolsOpen, setEditorToolsOpen] = useState(false)
  const [editorTool, setEditorTool] = useState<'select' | 'drawing' | 'shapes' | 'lines' | 'sticky' | 'text' | 'signature' | 'tables'>('select')
  const [drawingImplement, setDrawingImplement] = useState<DrawingTool>(() => readDrawingPreferences().implement)
  const [drawingColor, setDrawingColor] = useState(() => readDrawingPreferences().color)
  const [drawingSize, setDrawingSize] = useState(() => readDrawingPreferences().size)
  const [drawingSettingsOpen, setDrawingSettingsOpen] = useState(false)
  const drawingColorInputRef = useRef<HTMLInputElement>(null)
  const editorToolsTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileEditorToolsTriggerRef = useRef<HTMLButtonElement>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [connectorStartId, setConnectorStartId] = useState<string | null>(null)
  const [connectorStartAnchor, setConnectorStartAnchor] = useState<WhiteboardAnchor | undefined>(undefined)
  const [selectedConnectorSelection, setSelectedConnectorSelection] = useState<{ pageId: string; connectorId: string } | null>(null)
  const [marquee, setMarquee] = useState<WhiteboardRect | null>(null)
  const marqueeStartRef = useRef<WhiteboardPoint | null>(null)
  const marqueeAdditiveRef = useRef(false)
  const [activeStrokePreview, setActiveStrokePreview] = useState<number[] | null>(null)
  const activeStrokeRef = useRef<number[] | null>(null)
  const [activeStrokePreviewStyle, setActiveStrokePreviewStyle] = useState<{ color: string; strokeWidth: number; opacity: number } | null>(null)
  const activeStrokeStyleRef = useRef<{ color: string; strokeWidth: number; opacity: number; eraser: boolean } | null>(null)
  const canvasPinchGestureRef = useRef<{ touchIds: [number, number]; startPosition: CanvasGesturePoint; startZoom: number; startMidpoint: CanvasGesturePoint; startDistance: number } | null>(null)
  const multiTouchGestureRef = useRef(false)
  const whiteboardInitializedRef = useRef<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const editorZoomTriggerRef = useRef<HTMLButtonElement>(null)
  const editorZoomMenuRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Record<string, Konva.Node | null>>({})
  const imageInputRef = useRef<HTMLInputElement>(null)
  const timelineMediaInputRef = useRef<HTMLInputElement>(null)
  const timelineAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const timelineVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const videoAudioGraphRef = useRef<VideoExportAudioGraph | null>(null)
  const currentDocumentRef = useRef(state.document)
  const cursorSentAtRef = useRef(0)
  const cursorActiveRef = useRef(false)
  const lastTouchSelectAtRef = useRef(0)
  const selectionCommandsRef = useRef<{ duplicate: () => void; remove: () => void; move: (dx: number, dy: number) => void }>({ duplicate: () => {}, remove: () => {}, move: () => {} })

  useEffect(() => { currentDocumentRef.current = state.document }, [state.document])
  useEffect(() => {
    try { window.localStorage.setItem(DRAWING_PREFERENCES_KEY, JSON.stringify({ implement: drawingImplement, color: drawingColor, size: drawingSize })) } catch {}
  }, [drawingImplement, drawingColor, drawingSize])
  useEffect(() => {
    if (!aiOpen || !aiAddMenuOpen) return
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !aiAddMenuWrapRef.current?.contains(event.target)) {
        setAiAddMenuOpen(false)
        aiAddMenuTriggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismissOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer)
  }, [aiOpen, aiAddMenuOpen])
  useEffect(() => {
    if (!editorZoomMenuOpen) return
    const frame = window.requestAnimationFrame(() => editorZoomMenuRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [editorZoomMenuOpen, editorZoom])

  const isDoc = state.document.type === 'doc'
  const isVideo = state.document.type === 'video'
  const isWhiteboard = state.document.type === 'whiteboard'
  const isSheet = state.document.type === 'sheet'
  const isSite = state.document.type === 'site'
  const isCanvasDrawing = !isWhiteboard && !isDoc && !isSheet && !isVideo && editorTool === 'drawing'
  const isZoomableCanvas = isWhiteboard || state.document.type === 'design' || state.document.type === 'presentation'
  const page = state.document.pages[state.pageIndex]
  const siteSectionAnchorById = useMemo(() => siteSectionAnchors(state.document.pages.map(sitePage => sitePage.id)), [state.document.pages])
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false)
  const selected = page.elements.find(element => element.id === state.selectedId) ?? null
  const selectedConnectorId = selectedConnectorSelection?.pageId === page.id ? selectedConnectorSelection.connectorId : null
  const selectedConnector = isWhiteboard ? page.connectors?.find(connector => connector.id === selectedConnectorId) ?? null : null
  function setSelectedConnectorId(connectorId: string | null) {
    setSelectedConnectorSelection(connectorId ? { pageId: page.id, connectorId } : null)
  }
  function navigateToPage(index: number) {
    setSelectedConnectorSelection(null)
    dispatch({ type: 'page', index })
  }
  const accessibilityReviewDocument = saveStatus === 'saved' ? state.document : accessibilitySavedDocument ?? state.document
  const accessibilityIssues = useMemo<AccessibilityIssue[]>(() => accessibilityReviewDocument.pages.flatMap((reviewPage, pageIndex): AccessibilityIssue[] => reviewPage.elements.flatMap((element): AccessibilityIssue[] => {
    if (element.type === 'image' && !element.decorative && !element.altText?.trim()) return [{ id: `${reviewPage.id}:${element.id}:alt`, pageId: reviewPage.id, pageIndex, pageName: reviewPage.name, elementId: element.id, elementName: element.name, kind: 'alt', title: 'Adicionar texto alternativo', detail: 'Imagem sem descrição alternativa.' }]
    if (element.type === 'text' && element.fontSize < 12) return [{ id: `${reviewPage.id}:${element.id}:type`, pageId: reviewPage.id, pageIndex, pageName: reviewPage.name, elementId: element.id, elementName: element.name, kind: 'typography', title: 'Texto pequeno', detail: `${element.fontSize} unidades - recomendação local: 12 unidades ou mais.` }]
    return []
  })), [accessibilityReviewDocument])
  const selectedTypographyIssues = accessibilityIssues.filter(issue => issue.kind === 'typography' && accessibilitySelectedIssues.includes(issue.id))
  const selectedAltIssues = accessibilityIssues.filter(issue => issue.kind === 'alt' && accessibilitySelectedIssues.includes(issue.id))
  const canSaveSelectedAccessibilityAltText = selectedAltIssues.length > 0 && selectedAltIssues.every(issue => {
    const description = accessibilityAltDrafts[issue.id]?.trim() ?? ''
    return description.length > 0 && description.length <= 250
  })
  useEffect(() => {
    if (!accessibilityOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    accessibilityCloseRef.current?.focus()
    const handleAccessibilityDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAccessibilityOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = accessibilityDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleAccessibilityDialogKey)
    return () => {
      window.removeEventListener('keydown', handleAccessibilityDialogKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [accessibilityOpen])
  useEffect(() => {
    if (!accessibilityTargetId) return
    const timer = window.setTimeout(() => setAccessibilityTargetId(null), 2800)
    return () => window.clearTimeout(timer)
  }, [accessibilityTargetId])
  const selectedGroup = page.groups?.find(group => group.elementIds.some(id => state.selectedIds.includes(id))) ?? null
  const canCreateGroup = isWhiteboard && state.selectedIds.length > 1 && !(page.groups ?? []).some(group => group.elementIds.some(id => state.selectedIds.includes(id)))
  const fitPagePercent = Math.max(12, Math.min((viewport.width - 48) / state.document.width, (viewport.height - 114) / state.document.height, 1) * 100)
  const fitEditorPercent = Math.max(10, Math.min((viewport.width - 24) / state.document.width, (viewport.height - 24) / state.document.height, 3) * 100)
  const displayedZoom = editorZoom.mode === 'fit-page' ? fitPagePercent : editorZoom.mode === 'fit-editor' ? fitEditorPercent : editorZoom.percentage
  const scale = isWhiteboard ? whiteboardZoom : displayedZoom / 100
  const centeredEditorPageOffset = { x: Math.round((viewport.width - state.document.width * scale) / 2), y: Math.round((viewport.height - state.document.height * scale) / 2) }
  const pageOffset = isWhiteboard ? whiteboardPosition : { x: centeredEditorPageOffset.x + editorCanvasPan.x, y: centeredEditorPageOffset.y + editorCanvasPan.y }
  const layerNames = useMemo(() => [...page.elements].reverse(), [page.elements])
  const visiblePageElements = isVideo ? page.elements.filter(element => {
    const start = element.startMs ?? 0
    const end = start + (element.durationMs ?? videoDurationMs)
    return videoPlayheadMs >= start && videoPlayheadMs < end
  }) : page.elements
  const canEdit = storageMode === 'local' || remoteRole === 'owner' || remoteRole === 'editor'
  const canTransform = canEdit && (!isWhiteboard || whiteboardTool === 'select') && !isCanvasDrawing
  const canComment = storageMode === 'cloud' && ['owner', 'editor', 'commenter'].includes(remoteRole ?? '')

  function selectEditorZoom(optionId: string) {
    setEditorZoom(current => selectEditorZoomOption(current, optionId, { fitPage: fitPagePercent, fitEditor: fitEditorPercent }))
    setEditorCanvasPan({ x: 0, y: 0 })
    setEditorZoomMenuOpen(false)
    editorZoomTriggerRef.current?.focus()
  }

  function handleEditorZoomMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = Array.from(editorZoomMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditorZoomMenuOpen(false)
      editorZoomTriggerRef.current?.focus()
      return
    }
    let nextIndex = currentIndex
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + options.length) % options.length
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = options.length - 1
    else return
    event.preventDefault()
    options[nextIndex]?.focus()
  }

  const videoDurationMs = Math.min(86_400_000, Math.max(1000, state.document.videoDurationMs ?? 10_000))
  const hasAnimatedImages = page.elements.some(element => element.type === 'image' && Boolean(element.animation))
  const playbackDurationMs = isVideo ? videoDurationMs : 5000
  const imageAnimationProgress = (animation: ImageAnimationSettings) => {
    if (!videoPlaying && !exportBusy) return animation.phase === 'enter' ? 1 : 0
    const duration = { slow: 3000, medium: 2000, fast: 1000 }[animation.speed]
    return Math.max(0, Math.min(1, videoPlayheadMs / duration))
  }
  const videoTimelineClips = page.timelineClips ?? EMPTY_VIDEO_TIMELINE_CLIPS
  const mp4HasAudio = isVideo && videoTimelineClips.length > 0
  const mp4ExportSupported = typeof MediaRecorder !== 'undefined' && isVideoExportFormatSupported('mp4', mp4HasAudio, type => MediaRecorder.isTypeSupported(type))
  const selectedVideoTimelineClip = videoTimelineClips.find(clip => clip.id === selectedVideoTimelineClipId)
  const canSplitSelectedVideoTimelineClip = Boolean(selectedVideoTimelineClip && splitVideoTimelineClipAt(selectedVideoTimelineClip, videoPlayheadMs, 'split-preview'))
  const findTimelineAsset = useCallback((assetId: string) => assets.find(asset => asset.id === assetId) ?? teamAssets.find(asset => asset.id === assetId), [assets, teamAssets])
  const activeVideoClips = useMemo(() => videoTimelineClips.filter(clip => clip.kind === 'video' && videoPlayheadMs >= clip.startMs && videoPlayheadMs < clip.startMs + clip.durationMs)
    .sort((left, right) => (left.trackIndex ?? 0) - (right.trackIndex ?? 0) || left.startMs - right.startMs || left.id.localeCompare(right.id)), [videoPlayheadMs, videoTimelineClips])
  const activeVideoAssets = useMemo(() => activeVideoClips.map(clip => ({ clip, asset: findTimelineAsset(clip.assetId) })).filter((entry): entry is { clip: VideoTimelineClip; asset: MediaAsset } => Boolean(entry.asset)), [activeVideoClips, findTimelineAsset])
  const activeVideoIds = useMemo(() => new Set(activeVideoAssets.map(entry => entry.clip.id)), [activeVideoAssets])
  const allVideoAssets = useMemo(() => videoTimelineClips.filter(clip => clip.kind === 'video').map(clip => ({ clip, asset: findTimelineAsset(clip.assetId) })).filter((entry): entry is { clip: VideoTimelineClip; asset: MediaAsset } => Boolean(entry.asset))
    .sort((left, right) => (left.clip.trackIndex ?? 0) - (right.clip.trackIndex ?? 0) || left.clip.startMs - right.clip.startMs || left.clip.id.localeCompare(right.clip.id)), [findTimelineAsset, videoTimelineClips])
  const [audioWaveforms, setAudioWaveforms] = useState<Record<string, { key: string; peaks: number[] }>>({})
  useEffect(() => {
    const audioClips = videoTimelineClips.filter(clip => clip.kind === 'audio')
    if (!audioClips.length) return
    let cancelled = false
    const decodeWaveforms = async () => {
      const next: Record<string, { key: string; peaks: number[] }> = {}
      const clipsByAsset = new Map<string, VideoTimelineClip[]>()
      for (const clip of audioClips) clipsByAsset.set(clip.assetId, [...(clipsByAsset.get(clip.assetId) ?? []), clip])
      const context = typeof AudioContext === 'undefined' ? null : new AudioContext()
      if (!context) return
      try {
        for (const [assetId, clips] of clipsByAsset) {
          const asset = findTimelineAsset(assetId)
          // Keep timeline preview decoding within a bounded working set; longer
          // audio remains playable, but this version omits its decorative peaks.
          if (!asset || !asset.mimeType.startsWith('audio/') || clips.some(clip => clip.sourceDurationMs > 600_000)) continue
          try {
            const response = await fetch(asset.src)
            if (!response.ok) continue
            const decoded = await context.decodeAudioData(await response.arrayBuffer())
            for (const clip of clips) {
              const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel))
              next[clip.id] = { key: `${clip.id}:${clip.assetId}:${clip.sourceStartMs}:${clip.durationMs}`, peaks: getAudioWaveformRangePeaks(channels, decoded.sampleRate, clip.sourceStartMs, clip.durationMs, 72) }
            }
          } catch { /* Unsupported or unavailable source media has no decorative waveform. */ }
        }
      } finally {
        await context.close().catch(() => undefined)
        if (!cancelled) setAudioWaveforms(next)
      }
    }
    void decodeWaveforms()
    return () => { cancelled = true }
  }, [findTimelineAsset, videoTimelineClips])
  useEffect(() => {
    if ((!isVideo && !hasAnimatedImages) || !videoPlaying || exportBusy) return
    const startedAt = performance.now()
    const startingPosition = videoPlayheadRef.current
    let frame = 0
    const tick = (now: number) => {
      const next = startingPosition + now - startedAt
      if (next >= playbackDurationMs) {
        videoPlayheadRef.current = playbackDurationMs
        setVideoPlayheadMs(playbackDurationMs)
        setVideoPlaying(false)
        return
      }
      videoPlayheadRef.current = next
      setVideoPlayheadMs(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isVideo, hasAnimatedImages, videoPlaying, playbackDurationMs, exportBusy])

  useEffect(() => {
    for (const clip of videoTimelineClips.filter(item => item.kind === 'video')) {
      const video = timelineVideoRefs.current[clip.id]
      if (!video) continue
      if (!activeVideoIds.has(clip.id)) { if (!video.paused) video.pause(); continue }
      const targetTime = (clip.sourceStartMs + videoPlayheadMs - clip.startMs) / 1000
      if (Math.abs(video.currentTime - targetTime) > 0.35 && Number.isFinite(video.duration)) video.currentTime = Math.min(targetTime, Math.max(0, video.duration - 0.04))
      video.volume = clip.volume
      if (videoPlaying && video.paused) void video.play().catch(() => undefined)
      else if (!videoPlaying && !video.paused) video.pause()
    }
    for (const clip of videoTimelineClips.filter(item => item.kind === 'audio')) {
      const audio = timelineAudioRefs.current[clip.id]
      if (!audio) continue
      const playback = getAudioClipPlaybackState(clip, videoPlayheadMs)
      if (!playback.active || playback.sourceTimeMs === null) { if (!audio.paused) audio.pause(); continue }
      const mediaDurationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : clip.sourceDurationMs
      const boundedSourceTimeMs = Math.min(playback.sourceTimeMs, Math.max(0, mediaDurationMs - 20))
      const targetTime = boundedSourceTimeMs / 1000
      if (Math.abs(audio.currentTime - targetTime) > 0.4) audio.currentTime = targetTime
      audio.volume = playback.gain
      if (videoPlaying && audio.paused) void audio.play().catch(() => undefined)
      else if (!videoPlaying && !audio.paused) audio.pause()
    }
    const graph = exportBusy ? videoAudioGraphRef.current : null
    if (graph) {
      for (const media of Object.values(timelineAudioRefs.current)) if (media) connectMediaToVideoExport(graph, media)
    }
  }, [activeVideoIds, exportBusy, videoPlayheadMs, videoPlaying, videoTimelineClips])

  useEffect(() => {
    if (!ready || storageMode !== 'cloud' || isDoc) return
    const selection = state.selectedId ? { pageId: page.id, elementId: state.selectedId, kind: 'element' as const } : null
    const timeout = window.setTimeout(() => { void sendRemoteSelection(documentId, selection).catch(() => {}) }, selection ? 400 : 0)
    return () => window.clearTimeout(timeout)
  }, [ready, storageMode, isDoc, documentId, page.id, state.selectedId])

  const publishDocumentSelection = useCallback((selection: RemoteSelection | null) => {
    if (storageMode === 'cloud') void sendRemoteSelection(documentId, selection).catch(() => {})
  }, [documentId, storageMode])

  function zoomWhiteboard(nextZoom: number, pointer = { x: viewport.width / 2, y: viewport.height / 2 }) {
    const next = zoomWhiteboardAtPoint(whiteboardPosition, whiteboardZoom, pointer, nextZoom)
    setWhiteboardZoom(next.zoom)
    setWhiteboardPosition(next.position)
  }

  function readStageTouches(touches: TouchList) {
    const rect = stageRef.current?.container().getBoundingClientRect()
    if (!rect) return []
    return Array.from(touches, touch => ({ id: touch.identifier, x: touch.clientX - rect.left, y: touch.clientY - rect.top }))
  }

  function beginCanvasPinch(event: TouchEvent) {
    if (!isZoomableCanvas || event.touches.length < 2) return false
    const touches = readStageTouches(event.touches).slice(0, 2)
    if (touches.length < 2) return false
    event.preventDefault()
    canvasPinchGestureRef.current = {
      touchIds: [touches[0].id, touches[1].id],
      startPosition: { ...pageOffset },
      startZoom: scale,
      startMidpoint: { x: (touches[0].x + touches[1].x) / 2, y: (touches[0].y + touches[1].y) / 2 },
      startDistance: Math.max(1, Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y)),
    }
    multiTouchGestureRef.current = true
    stageRef.current?.stopDrag()
    marqueeStartRef.current = null
    setMarquee(null)
    if (activeStrokeRef.current) {
      activeStrokeRef.current = null
      setActiveStrokePreview(null)
    }
    return true
  }

  function updateCanvasPinch(event: TouchEvent) {
    if (!multiTouchGestureRef.current) return false
    event.preventDefault()
    const gesture = canvasPinchGestureRef.current
    if (!gesture || event.touches.length < 2) return true
    const currentTouches = readStageTouches(event.touches)
    const first = currentTouches.find(touch => touch.id === gesture.touchIds[0])
    const second = currentTouches.find(touch => touch.id === gesture.touchIds[1])
    if (!first || !second) return true
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
    const next = zoomCanvasAtPinch(gesture.startPosition, gesture.startZoom, gesture.startMidpoint, gesture.startDistance, midpoint, distance, isWhiteboard ? 0.08 : 0.1, 3)
    if (isWhiteboard) {
      setWhiteboardZoom(next.zoom)
      setWhiteboardPosition(next.position)
    } else {
      setEditorZoom(createEditorZoomState(next.zoom * 100, 'percentage'))
      const centered = { x: Math.round((viewport.width - state.document.width * next.zoom) / 2), y: Math.round((viewport.height - state.document.height * next.zoom) / 2) }
      setEditorCanvasPan({ x: next.position.x - centered.x, y: next.position.y - centered.y })
    }
    return true
  }

  function endCanvasPinch(event: TouchEvent) {
    if (!multiTouchGestureRef.current) return false
    event.preventDefault()
    if (event.touches.length < 2) canvasPinchGestureRef.current = null
    if (event.touches.length === 0) window.setTimeout(() => { multiTouchGestureRef.current = false }, 0)
    return true
  }

  function fitWhiteboard() {
    const zoom = fitWhiteboardZoom(state.document.width, state.document.height, viewport.width, viewport.height)
    setWhiteboardZoom(zoom)
    setWhiteboardPosition(centerWhiteboard(state.document.width, state.document.height, viewport.width, viewport.height, zoom))
  }

  function toggleWhiteboardPan() {
    const nextTool = whiteboardTool === 'pan' ? 'select' : 'pan'
    setWhiteboardTool(nextTool)
    setConnectorStartId(null)
    setConnectorStartAnchor(undefined)
    setSelectedConnectorId(null)
    if (nextTool === 'pan') dispatch({ type: 'select', id: null })
  }

  function toggleConnectorTool() {
    const nextTool = whiteboardTool === 'connector' ? 'select' : 'connector'
    setWhiteboardTool(nextTool)
    setConnectorStartId(null)
    setConnectorStartAnchor(undefined)
    setSelectedConnectorId(null)
    dispatch({ type: 'select', id: null })
  }

  function toggleWhiteboardDraw() {
    const nextTool = whiteboardTool === 'draw' ? 'select' : 'draw'
    setWhiteboardTool(nextTool)
    setConnectorStartId(null)
    setConnectorStartAnchor(undefined)
    setSelectedConnectorId(null)
    dispatch({ type: 'select', id: null })
  }

  function getWhiteboardPointerPoint() {
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return null
    return { x: (pointer.x - pageOffset.x) / scale, y: (pointer.y - pageOffset.y) / scale }
  }

  function beginWhiteboardStroke() {
    const whiteboardDraw = isWhiteboard && whiteboardTool === 'draw'
    if ((!whiteboardDraw && !isCanvasDrawing) || !canEdit) return false
    const point = getWhiteboardPointerPoint()
    if (!point) return true
    const style = whiteboardDraw
      ? { color: '#29263d', strokeWidth: 8, opacity: 1, eraser: false }
      : getDrawingToolStyle(drawingImplement, drawingColor, drawingSize)
    const points = [point.x, point.y]
    activeStrokeRef.current = points
    activeStrokeStyleRef.current = style
    setActiveStrokePreviewStyle({ color: style.color, strokeWidth: style.strokeWidth, opacity: style.opacity })
    setActiveStrokePreview(points)
    return true
  }

  function extendWhiteboardStroke() {
    const points = activeStrokeRef.current
    if (!points) return
    const point = getWhiteboardPointerPoint()
    if (!point) return
    const last = points.length - 2
    if (Math.hypot(point.x - points[last], point.y - points[last + 1]) < 1.5 / scale) return
    const next = [...points, point.x, point.y]
    activeStrokeRef.current = next
    setActiveStrokePreview(next)
  }

  function finishWhiteboardStroke() {
    const points = activeStrokeRef.current
    if (!points) return
    const style = activeStrokeStyleRef.current
    activeStrokeRef.current = null
    activeStrokeStyleRef.current = null
    setActiveStrokePreview(null)
    setActiveStrokePreviewStyle(null)
    if (!style) return
    if (style.eraser) {
      const erasure = eraseFreeDrawElements(page.elements.filter(element => element.type === 'free-draw'), points, style.strokeWidth)
      if (!erasure.changedIds.length) return
      const erasedIdSet = new Set(erasure.changedIds)
      const fragmentsBySource = new Map(erasure.replacements.map(replacement => [replacement.sourceId, replacement.fragments]))
      const nextElements = page.elements.flatMap(element => erasedIdSet.has(element.id) ? fragmentsBySource.get(element.id) ?? [] : [element])
      change(document => updatePage(document, state.pageIndex, current => ({ ...current, elements: current.elements.flatMap(element => erasedIdSet.has(element.id) ? fragmentsBySource.get(element.id) ?? [] : [element]) })))
      if (state.selectedIds.some(id => erasedIdSet.has(id))) dispatch({ type: 'select', id: null })
      applyCollaborativeOperation(page.id, { type: 'design.elements.delete', elementIds: erasure.changedIds })
      for (let offset = 0; offset < erasure.fragments.length; offset += 100) {
        applyCollaborativeOperation(page.id, { type: 'design.elements.create', elements: erasure.fragments.slice(offset, offset + 100) })
      }
      if (erasure.fragments.length) applyCollaborativeOperation(page.id, { type: 'design.elements.reorder', elementIds: nextElements.map(element => element.id) })
      return
    }
    const stroke = createFreeDrawElement(points, style.color, style.strokeWidth, style.opacity)
    if (stroke) addElement(stroke)
  }

  function beginMarquee(additive: boolean) {
    if (!isWhiteboard || whiteboardTool !== 'select' || !canEdit) return false
    const point = getWhiteboardPointerPoint()
    if (!point) return false
    marqueeStartRef.current = point
    marqueeAdditiveRef.current = additive || multiSelectMode
    setMarquee({ x: point.x, y: point.y, width: 0, height: 0 })
    return true
  }

  function extendMarquee() {
    const start = marqueeStartRef.current
    const point = getWhiteboardPointerPoint()
    if (!start || !point) return
    setMarquee(normalizeWhiteboardRect(start, point))
  }

  function finishMarquee() {
    const start = marqueeStartRef.current
    if (!start) return
    const point = getWhiteboardPointerPoint() ?? start
    const rect = normalizeWhiteboardRect(start, point)
    const selectedIds = elementsIntersectingRect(page.elements, rect).flatMap(id => selectionForElement(page, id))
    const uniqueIds = [...new Set(selectedIds)]
    const result = marqueeAdditiveRef.current
      ? [...new Set([...state.selectedIds, ...uniqueIds])]
      : uniqueIds
    selectElements(result)
    marqueeStartRef.current = null
    setMarquee(null)
  }

  function handleCanvasElementClick(id: string, additive = false, fromTouch = false, pointerPoint?: { x: number; y: number }) {
    if (isCanvasDrawing) return
    if (fromTouch && multiTouchGestureRef.current) return
    const now = getCurrentTimeMilliseconds()
    if (fromTouch) lastTouchSelectAtRef.current = now
    else if (now - lastTouchSelectAtRef.current < 450) return
    if (isWhiteboard && whiteboardTool === 'draw') return
    if (whiteboardTool !== 'connector') setSelectedConnectorId(null)
    if (!isWhiteboard || whiteboardTool !== 'connector') {
      const groupIds = isWhiteboard ? selectionForElement(page, id) : [id]
      if (additive || multiSelectMode) {
        const alreadySelected = groupIds.every(groupId => state.selectedIds.includes(groupId))
        selectElements(alreadySelected ? state.selectedIds.filter(selectedId => !groupIds.includes(selectedId)) : [...state.selectedIds, ...groupIds])
      } else selectElements(groupIds)
      return
    }
    if (!canEdit) return
    if (!connectorStartId) {
      setConnectorStartId(id)
      const element = page.elements.find(item => item.id === id)
      setConnectorStartAnchor(element && pointerPoint ? snapConnectorAnchor(element, pointerPoint) : undefined)
      return
    }
    if (connectorStartId === id) {
      setConnectorStartId(null)
      setConnectorStartAnchor(undefined)
      return
    }
    const endElement = page.elements.find(item => item.id === id)
    const toAnchor = endElement && pointerPoint ? snapConnectorAnchor(endElement, pointerPoint) : undefined
    const connector = { id: createId('connector'), fromId: connectorStartId, toId: id, fromAnchor: connectorStartAnchor, toAnchor, color: '#7464e8', strokeWidth: 4 }
    if (storageMode === 'cloud') applyCollaborativeOperation(page.id, { type: 'design.connector.create', connector })
    else change(document => updatePage(document, state.pageIndex, current => ({ ...current, connectors: [...(current.connectors ?? []), connector] })))
    setSelectedConnectorId(connector.id)
    setConnectorStartId(null)
    setConnectorStartAnchor(undefined)
    setWhiteboardTool('select')
  }

  function insertionPosition(width: number, height: number, fallbackX: number, fallbackY: number) {
    if (!isWhiteboard) return { x: fallbackX, y: fallbackY }
    return {
      x: (viewport.width / 2 - whiteboardPosition.x) / whiteboardZoom - width / 2,
      y: (viewport.height / 2 - whiteboardPosition.y) / whiteboardZoom - height / 2,
    }
  }

  function publishCursor(pageId: string | null, x?: number, y?: number) {
    if (storageMode !== 'cloud') return
    if (!pageId) {
      if (!cursorActiveRef.current) return
      cursorActiveRef.current = false
      void sendRemoteCursor(documentId, null).catch(() => {})
      return
    }
    const now = getCurrentTimeMilliseconds()
    if (pageId && now - cursorSentAtRef.current < 60) return
    cursorSentAtRef.current = now
    cursorActiveRef.current = true
    void sendRemoteCursor(documentId, pageId, x, y).catch(() => {})
  }

  function publishCursorFromStage(position: { x: number; y: number } | null) {
    if (storageMode !== 'cloud' || !position) return
    const x = (position.x - pageOffset.x) / scale
    const y = (position.y - pageOffset.y) / scale
    if (x < 0 || y < 0 || x > state.document.width || y > state.document.height) publishCursor(null)
    else publishCursor(page.id, x / state.document.width, y / state.document.height)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (storageMode === 'cloud') {
          try {
            const remote = await getRemoteDocument(documentId)
            if (cancelled) return
            const remoteDocument = { ...remote.data, id: remote.id, name: remote.name }
            remoteRevisionRef.current = remote.revision
            setRemoteRole(remote.role)
            setRemoteTeamId(remote.teamId ?? null)
            setPersistedDocument(remoteDocument)
            let workingDocument = remoteDocument
            const draft = await readCloudDraft(documentId)
            if (cancelled) return
            if (draft) {
              const merged = mergeConcurrentDocuments(draft.base, draft.document, remoteDocument)
              if (merged.ok) {
                workingDocument = merged.value
                if (JSON.stringify(workingDocument) === JSON.stringify(remoteDocument)) void deleteCloudDraft(documentId)
                else setSaveStatus('saving')
              } else {
                workingDocument = draft.document
                remoteConflictRef.current = true
                setRemoteConflict(remote)
                setSaveStatus('error')
              }
            }
            setSelectedConnectorSelection(null)
            dispatch({ type: 'load', document: workingDocument })
          } catch (error) {
            if (error instanceof StudioApiError) {
              if (!cancelled) setLoadError(error.message)
              return
            }
            const draft = await readCloudDraft(documentId).catch(() => undefined)
            if (cancelled) return
            if (draft) {
              remoteRevisionRef.current = draft.baseRevision
              setRemoteRole(draft.role)
              setPersistedDocument(draft.base)
              dispatch({ type: 'load', document: draft.document })
              setSaveStatus('error')
              setPermissionNotice('Modo sem conexao: seu rascunho esta salvo neste dispositivo e sera sincronizado quando a rede voltar.')
            } else setLoadError(error instanceof Error ? error.message : 'Ãao foi possivel abrir este projeto.')
          }
        } else {
          const local = await readDocument(documentId)
          if (cancelled) return
          if (local) {
            setPersistedDocument(local)
            setSelectedConnectorSelection(null)
            dispatch({ type: 'load', document: local })
          } else setLoadError('Este projeto nao foi encontrado neste dispositivo.')
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Ãao foi possivel abrir este projeto.')
      } finally { if (!cancelled) setReady(true) }
    }
    void load()
    return () => { cancelled = true }
  }, [documentId, storageMode, loadAttempt])

  useEffect(() => {
    if (!ready || storageMode !== 'cloud') return
    try {
      const pending = JSON.parse(sessionStorage.getItem('fuse-pending-comment-navigation') ?? 'null') as { documentId?: string; commentId?: string } | null
      if (!pending || pending.documentId !== documentId || !pending.commentId) return
      sessionStorage.removeItem('fuse-pending-comment-navigation')
      void listRemoteComments(documentId).then(items => {
        setComments(items)
        const target = items.find(item => item.id === pending.commentId)
        const thread = target?.parentId ? items.find(item => item.id === target.parentId) : target
        if (!thread) return
        if (thread.pageId) {
          const pageIndex = state.document.pages.findIndex(page => page.id === thread.pageId)
        if (pageIndex >= 0) navigateToPage(pageIndex)
        }
        dispatch({ type: 'select', id: thread.elementId })
        setCommentsOpen(true)
        window.setTimeout(() => document.querySelector(`[data-comment-id="${CSS.escape(thread.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
      }).catch(() => {})
    } catch { /* Ignore malformed or unavailable session navigation state. */ }
  }, [documentId, ready, state.document.pages, storageMode])

  useEffect(() => {
    let cancelled = false
    const loadAssets = storageMode === 'cloud' ? listRemoteMediaAssets(documentId, true) : listMediaAssets()
    loadAssets
      .then(items => { if (!cancelled) setAssets(items) })
      .catch(() => { if (!cancelled) setAssetError(storageMode === 'cloud' ? 'Não foi possível carregar a biblioteca compartilhada.' : 'Não foi possível carregar a biblioteca de mídia.') })
    return () => { cancelled = true }
  }, [documentId, storageMode])

  useEffect(() => {
    let cancelled = false
    if (storageMode !== 'cloud' || !remoteTeamId) return
    listRemoteTeamMediaAssets(remoteTeamId)
      .then(items => { if (!cancelled) { setTeamAssets(items); setTeamAssetsTeamId(remoteTeamId) } })
      .catch(() => { if (!cancelled) setAssetError('Não foi possível carregar a biblioteca de mídia da equipe.') })
    return () => { cancelled = true }
  }, [remoteTeamId, storageMode])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) {
        setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
        setViewportMeasured(true)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ready])

  useEffect(() => {
    if (!ready || !viewportMeasured || !isWhiteboard || whiteboardInitializedRef.current === state.document.id) return
    const zoom = clampWhiteboardZoom(0.55)
    setWhiteboardZoom(zoom)
    setWhiteboardPosition(centerWhiteboard(state.document.width, state.document.height, viewport.width, viewport.height, zoom))
    whiteboardInitializedRef.current = state.document.id
  }, [ready, viewportMeasured, isWhiteboard, state.document.id, state.document.width, state.document.height, viewport.width, viewport.height])

  useEffect(() => {
    const persisted = persistedDocumentRef.current
    if (!ready || loadError || storageMode !== 'cloud' || !persisted || !hasUnpersistedChanges(state.document, persisted)) return
    const timeout = window.setTimeout(() => {
      void writeCloudDraft({ documentId, baseRevision: remoteRevisionRef.current, role: remoteRole ?? 'viewer', base: persisted, document: state.document, updatedAt: new Date().toISOString() })
        .catch(() => setPermissionNotice('Ãao foi possivel salvar o rascunho offline neste dispositivo. Mantenha esta aba aberta para evitar perder alteracoes.'))
    }, 100)
    return () => window.clearTimeout(timeout)
  }, [ready, loadError, state.document, storageMode, documentId, remoteRole])

  useEffect(() => {
    const hasChanges = storageMode === 'local'
      ? state.document !== persistedDocumentRef.current
      : hasUnpersistedChanges(state.document, persistedDocumentRef.current)
    if (!ready || loadError || !hasChanges || (storageMode === 'cloud' && (remoteConflictRef.current || pendingCollaborativeOperationIdsRef.current.size > 0))) return
    const timeout = window.setTimeout(() => {
      if (storageMode === 'local') {
        writeDocument(state.document)
          .then(() => { setPersistedDocument(state.document); setSaveStatus('saved') })
          .catch(() => setSaveStatus('error'))
        return
      }
      remoteSaveQueueRef.current = remoteSaveQueueRef.current.then(async () => {
        if (remoteConflictRef.current || pendingCollaborativeOperationIdsRef.current.size > 0) return
        const snapshot = currentDocumentRef.current
        if (!hasUnpersistedChanges(snapshot, persistedDocumentRef.current)) { setSaveStatus('saved'); void deleteCloudDraft(documentId, snapshot).catch(() => {}); return }
        try {
          const saved = await saveRemoteDocument(documentId, remoteRevisionRef.current, snapshot)
          if (saved.revision < remoteRevisionRef.current) return
          const savedDocument = { ...saved.data, id: saved.id, name: saved.name }
          const reconciled = mergeConcurrentDocuments(snapshot, currentDocumentRef.current, savedDocument)
          if (!reconciled.ok) {
            remoteConflictRef.current = true
            setRemoteConflict(await getRemoteDocument(documentId).catch(() => saved))
            setSaveStatus('error')
            return
          }
          remoteRevisionRef.current = saved.revision
          setPersistedDocument(savedDocument)
          pageInsertSnapshotRecoveryRef.current = false
          setPermissionNotice('')
          if (!hasUnpersistedChanges(reconciled.value, savedDocument)) void deleteCloudDraft(documentId, snapshot).catch(() => {})
          if (JSON.stringify(currentDocumentRef.current) !== JSON.stringify(reconciled.value)) {
            dispatch({ type: 'change', update: () => reconciled.value })
            setSaveStatus('saving')
          } else setSaveStatus('saved')
        } catch (error) {
          setSaveStatus('error')
          if (error instanceof StudioApiError && error.status === 409 && error.payload.current) {
            remoteConflictRef.current = true
            setRemoteConflict(error.payload.current as RemoteDocument)
          }
        }
      })
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [ready, loadError, state.document, storageMode, documentId, saveRetryToken])

  useEffect(() => {
    if (!ready || loadError || storageMode !== 'cloud') return
    let cancelled = false
    let refreshing = false
    let refreshQueued = false
    const refresh = async () => {
      if (cancelled || remoteConflictRef.current) return
      if (refreshing) { refreshQueued = true; return }
      refreshing = true
      try {
        const remote = await getRemoteDocument(documentId)
        if (cancelled) return
        if (remote.revision <= remoteRevisionRef.current) {
          const current = currentDocumentRef.current
          const persisted = persistedDocumentRef.current
          if (hasUnpersistedChanges(current, persisted)) {
            setSaveStatus('saving')
            setSaveRetryToken(token => token + 1)
          }
          return
        }
        const remoteDocument = { ...remote.data, id: remote.id, name: remote.name }
        const current = currentDocumentRef.current
        const persisted = persistedDocumentRef.current
        const hasNoLocalChanges = current === persisted
          || JSON.stringify(current) === JSON.stringify(persisted)
          || JSON.stringify(current) === JSON.stringify(remoteDocument)
        if (hasNoLocalChanges) {
          remoteRevisionRef.current = remote.revision
          setPersistedDocument(remoteDocument)
          setRemoteRole(remote.role)
          setPermissionNotice('')
          if (current !== remoteDocument) { setSelectedConnectorSelection(null); dispatch({ type: 'load', document: remoteDocument }) }
          setSaveStatus('saved')
        } else {
          const base = persistedDocumentRef.current
          const merged = base ? mergeConcurrentDocuments(base, current, remoteDocument) : { ok: false as const, conflicts: ['document'] }
          if (merged.ok) {
            remoteRevisionRef.current = remote.revision
            setPersistedDocument(remoteDocument)
            setRemoteRole(remote.role)
            setPermissionNotice('')
            dispatch({ type: 'change', update: () => merged.value })
            setSaveStatus('saving')
          } else {
            remoteConflictRef.current = true
            setRemoteConflict(remote)
          }
        }
      } catch (error) {
        if (!cancelled && error instanceof StudioApiError && (error.status === 403 || error.status === 404)) {
          remoteConflictRef.current = true
          setRemoteRole('viewer')
          setPermissionNotice('Seu acesso a este projeto mudou. Salve seu trabalho como uma cópia local para preservá-lo.')
        }
      } finally {
        refreshing = false
        if (refreshQueued && !cancelled) {
          refreshQueued = false
          queueMicrotask(() => { void refresh() })
        }
      }
    }
    setRealtimeStatus('connecting')
    const source = subscribeRemoteDocument(documentId, event => {
      let message: { type?: string; revision?: number; operationId?: string; role?: RemoteDocument['role']; users?: RemotePresence[]; userId?: string; name?: string; cursor?: RemotePresence['cursor']; selection?: RemotePresence['selection']; presenting?: boolean; pageIndex?: number | null }
      try { message = JSON.parse(event.data) as typeof message } catch { return }
      if (message.type === 'document.deleted') {
        source.close()
        setRealtimeStatus('offline')
        setPresence([])
        remoteConflictRef.current = true
        setRemoteRole('viewer')
        setSaveStatus('error')
        setPermissionNotice('Este projeto foi excluído permanentemente em outra sessão. Salve seu trabalho como uma cópia local para preservá-lo.')
        return
      }
      if (message.type === 'presence.updated' || message.type === 'cursor.updated' || message.type === 'selection.updated') {
        setPresence(current => reducePresenceMessage(current, message))
      }
      if (message.type === 'presentation.updated' && message.userId && message.userId !== currentUserId) {
        if (message.presenting && Number.isInteger(message.pageIndex)) {
          const nextPresentation = { userId: message.userId, name: message.name ?? 'Colaborador', pageIndex: message.pageIndex as number, presenting: true as const }
          setRemotePresentation(nextPresentation)
          if (followingPresentationId === message.userId) setPresentationPage(nextPresentation.pageIndex)
        } else {
          setRemotePresentation(current => current?.userId === message.userId ? null : current)
          if (followingPresentationId === message.userId) {
            setFollowingPresentationId(null)
            setPresentationOpen(false)
          }
        }
      }
      if (message.type === 'document.updated' && !(message.operationId && pendingCollaborativeOperationIdsRef.current.has(message.operationId))) void refresh()
      if (message.type === 'sheet.cells.updated' && !(message.operationId && pendingCollaborativeOperationIdsRef.current.has(message.operationId))) void refresh()
      if (message.type === 'sheet.operation.updated' && !(message.operationId && pendingCollaborativeOperationIdsRef.current.has(message.operationId))) void refresh()
      if (message.type === 'comments.updated' && commentsOpen) {
        void listRemoteComments(documentId).then(setComments).catch(() => setCommentsError('Não foi possível atualizar os comentários.'))
      }
      if (message.type === 'access.changed' && message.role) {
        setRemoteRole(message.role)
        if (!['owner', 'editor'].includes(message.role) && currentDocumentRef.current !== persistedDocumentRef.current) {
          remoteConflictRef.current = true
          setPermissionNotice('Seu acesso mudou enquanto havia alterações locais. Salve seu trabalho como uma cópia local.')
        }
      }
      if (message.type === 'access.revoked' || message.type === 'auth.expired') {
        source.close()
        setRealtimeStatus('offline')
        setPresence([])
        remoteConflictRef.current = true
        setRemoteRole('viewer')
        setPermissionNotice(message.type === 'auth.expired'
          ? 'Sua sessão expirou. Entre novamente mais tarde; salve seu trabalho como uma cópia local para preservá-lo.'
          : 'Seu acesso foi revogado. Salve seu trabalho como uma cópia local para preservá-lo.')
      }
    }, () => {
      setRealtimeStatus('connected')
      void refresh()
      if (pendingCollaborativeOperationIdsRef.current.size === 0 && hasUnpersistedChanges(currentDocumentRef.current, persistedDocumentRef.current)) setSaveRetryToken(token => token + 1)
    }, () => setRealtimeStatus('reconnecting'))
    return () => { cancelled = true; source.close(); setPresence([]); setRealtimeStatus('offline') }
  }, [commentsOpen, currentUserId, documentId, followingPresentationId, loadError, ready, storageMode])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return
    const selectedNodes = state.selectedIds.length === 1 ? state.selectedIds.map(id => nodeRefs.current[id]).filter((node): node is Konva.Node => Boolean(node)) : []
    transformer.nodes(selectedNodes)
    transformer.getLayer()?.batchDraw()
  }, [state.selectedId, state.selectedIds, page.elements])

  const change = useCallback((update: (document: DesignDocument) => DesignDocument) => {
    if (!canEdit) return
    setSaveStatus('saving')
    const next = update(currentDocumentRef.current)
    currentDocumentRef.current = next
    dispatch({ type: 'change', update: () => next })
  }, [canEdit])

  async function openVersionHistory() {
    setHistoryOpen(true)
    setHistoryCopiedDocument(null)
    if (currentDocumentRef.current !== persistedDocumentRef.current) {
      setHistoryVersions([])
      setHistoryError('Salve as alterações atuais antes de abrir o histórico.')
      return
    }
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const result = await listRemoteDocumentVersions(documentId)
      setHistoryVersions(result.versions)
      setHistoryCurrentRevision(result.currentRevision)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.')
    } finally { setHistoryBusy(false) }
  }

  async function restoreVersion(version: RemoteDocumentVersion) {
    if (!canEdit || currentDocumentRef.current !== persistedDocumentRef.current) return
    setRestoringRevision(version.revision)
    setHistoryError('')
    try {
      const restored = await restoreRemoteDocumentVersion(documentId, version.revision, historyCurrentRevision)
      const next = { ...restored.data, id: restored.id, name: restored.name, updatedAt: restored.updatedAt }
      currentDocumentRef.current = next
      setPersistedDocument(next)
      remoteRevisionRef.current = restored.revision
      remoteConflictRef.current = false
      setSelectedConnectorSelection(null)
      dispatch({ type: 'load', document: next })
      setRemoteRole(restored.role)
      setSaveStatus('saved')
      setHistoryOpen(false)
      setHistoryVersions([])
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Não foi possível restaurar esta versão.')
      if (error instanceof StudioApiError && error.status === 409 && error.payload.current) setRemoteConflict(error.payload.current as RemoteDocument)
    } finally { setRestoringRevision(null) }
  }

  async function copyVersion(version: RemoteDocumentVersion) {
    setCopyingRevision(version.revision)
    setHistoryError('')
    try {
      setHistoryCopiedDocument(await copyRemoteDocumentVersion(documentId, version.revision))
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Não foi possível copiar esta versão.')
    } finally { setCopyingRevision(null) }
  }

  const applyCollaborativeOperation = useCallback((pageId: string, operation: CollaborativeOperation, baseRevision?: number) => {
    if (storageMode !== 'cloud' || !canEdit) return
    const operationId = createId('sheet-op')
    pendingCollaborativeOperationIdsRef.current.add(operationId)
    remoteSaveQueueRef.current = remoteSaveQueueRef.current.then(async () => {
      try {
        if (remoteConflictRef.current || pageInsertSnapshotRecoveryRef.current) return
        const saved = await applyRemoteOperation(documentId, { operationId, baseRevision: baseRevision ?? remoteRevisionRef.current, pageId, ...operation })
        if (saved.revision < remoteRevisionRef.current) return
        const remoteDocument = { ...saved.document, id: documentId }
        const base = persistedDocumentRef.current
        const merged = base ? mergeConcurrentDocuments(base, currentDocumentRef.current, remoteDocument) : { ok: false as const, conflicts: ['document'] }
        if (!merged.ok) {
          remoteConflictRef.current = true
          setRemoteConflict(await getRemoteDocument(documentId).catch(() => ({ id: documentId, name: remoteDocument.name, data: remoteDocument, revision: saved.revision, role: remoteRole ?? 'editor', accessSuspended: false, ownerId: '', createdAt: '', updatedAt: remoteDocument.updatedAt })))
          setSaveStatus('error')
          return
        }
        const reconciledDocument = { ...merged.value, updatedAt: remoteDocument.updatedAt }
        remoteRevisionRef.current = saved.revision
        setPersistedDocument(remoteDocument)
        const shouldSync = JSON.stringify(currentDocumentRef.current) !== JSON.stringify(reconciledDocument)
        currentDocumentRef.current = reconciledDocument
        if (shouldSync) dispatch({ type: 'sync', document: reconciledDocument })
        setSaveStatus(JSON.stringify(reconciledDocument) === JSON.stringify(remoteDocument) ? 'saved' : 'saving')
      } catch (error) {
        setSaveStatus('error')
        if (operation.type === 'design.page.insert') {
          pageInsertSnapshotRecoveryRef.current = true
          if (error instanceof StudioApiError && error.status === 409 && error.payload.current) {
            const current = error.payload.current as RemoteDocument
            remoteRevisionRef.current = current.revision
            setPersistedDocument({ ...current.data, id: current.id, name: current.name })
          }
        } else if (error instanceof StudioApiError && error.status === 409 && error.payload.current) {
          remoteConflictRef.current = true
          setRemoteConflict(error.payload.current as RemoteDocument)
        }
      } finally {
        pendingCollaborativeOperationIdsRef.current.delete(operationId)
        if (pendingCollaborativeOperationIdsRef.current.size === 0) setSaveRetryToken(token => token + 1)
      }
    })
  }, [canEdit, documentId, remoteRole, storageMode])

  function updateSelectedConnector(patch: Extract<CollaborativeOperation, { type: 'design.connector.patch' }>['patch']) {
    if (!selectedConnector || !canEdit) return
    const connectorId = selectedConnector.id
    change(document => updatePage(document, state.pageIndex, current => ({
      ...current,
      connectors: (current.connectors ?? []).map(connector => {
        if (connector.id !== connectorId) return connector
        const updated = { ...connector, ...patch }
        for (const key of ['fromAnchor', 'toAnchor'] as const) if (patch[key] === null) delete updated[key]
        return updated
      }),
    })))
    applyCollaborativeOperation(page.id, { type: 'design.connector.patch', connectorId, patch })
  }

  function scheduleDesignElementPatch(pageId: string, elementId: string, patch: Partial<DesignElement>) {
    if (storageMode !== 'cloud' || !canEdit) return
    const key = `${pageId}:${elementId}`
    const pending = pendingDesignElementPatchesRef.current.get(key)
    if (pending) window.clearTimeout(pending.timer)
    const combinedPatch = { ...(pending?.patch ?? {}), ...patch }
    const timer = window.setTimeout(() => {
      pendingDesignElementPatchesRef.current.delete(key)
      applyCollaborativeOperation(pageId, { type: 'design.element.patch', elementId, patch: combinedPatch })
    }, 180)
    pendingDesignElementPatchesRef.current.set(key, { timer, patch: combinedPatch })
  }

  function scheduleDesignElementDiffs(pageId: string, before: DesignElement[], after: DesignElement[]) {
    const beforeById = new Map(before.map(element => [element.id, element]))
    for (const element of after) {
      const previous = beforeById.get(element.id)
      if (!previous) continue
      const previousValues = previous as unknown as Record<string, unknown>
      const nextValues = element as unknown as Record<string, unknown>
      const patch: Record<string, unknown> = {}
      for (const key of new Set([...Object.keys(previous), ...Object.keys(element)])) {
        if (JSON.stringify(previousValues[key]) !== JSON.stringify(nextValues[key])) patch[key] = nextValues[key]
      }
      if (Object.keys(patch).length) scheduleDesignElementPatch(pageId, element.id, patch as Partial<DesignElement>)
    }
  }

  function updateVideoTiming(element: DesignElement, field: 'startMs' | 'durationMs', seconds: number) {
    if (!canEdit || !Number.isFinite(seconds)) return
    const value = Math.max(field === 'durationMs' ? 0.1 : 0, Math.min(videoDurationMs / 1000, seconds))
    const patch = { [field]: Math.round(value * 1000) }
    change(document => updatePage(document, state.pageIndex, current => ({
      ...current,
      elements: current.elements.map(item => item.id === element.id ? { ...item, ...patch } : item),
    })))
    scheduleDesignElementPatch(page.id, element.id, patch)
  }

  function schedulePresenterNotes(pageId: string, notes: string) {
    if (storageMode !== 'cloud' || !canEdit) return
    const pending = pendingPresenterNotesRef.current.get(pageId)
    if (pending) window.clearTimeout(pending.timer)
    const baseRevision = pending?.baseRevision ?? remoteRevisionRef.current
    const timer = window.setTimeout(() => {
      pendingPresenterNotesRef.current.delete(pageId)
      applyCollaborativeOperation(pageId, { type: 'design.page.notes.set', notes }, baseRevision)
    }, 240)
    pendingPresenterNotesRef.current.set(pageId, { timer, notes, baseRevision })
  }

  function scheduleDesignPagePatch(pageId: string, patch: Partial<Pick<DesignPage, 'name' | 'background' | 'hidden'>>) {
    if (storageMode !== 'cloud' || !canEdit) return
    const pending = pendingDesignPagePatchesRef.current.get(pageId)
    if (pending) window.clearTimeout(pending.timer)
    const combinedPatch = { ...(pending?.patch ?? {}), ...patch }
    const baseRevision = pending?.baseRevision ?? remoteRevisionRef.current
    const timer = window.setTimeout(() => {
      pendingDesignPagePatchesRef.current.delete(pageId)
      applyCollaborativeOperation(pageId, { type: 'design.page.patch', patch: combinedPatch }, baseRevision)
    }, 220)
    pendingDesignPagePatchesRef.current.set(pageId, { timer, patch: combinedPatch, baseRevision })
  }

  function addElement(element: DesignElement) {
    if (isWhiteboard && whiteboardTool !== 'draw') setWhiteboardTool('select')
    const preparedElement: DesignElement = isVideo ? { ...element, startMs: 0, durationMs: videoDurationMs } : element
    change(document => updatePage(document, state.pageIndex, current => ({ ...current, elements: [...current.elements, preparedElement] })))
    if (JSON.stringify(preparedElement).length <= 200_000) applyCollaborativeOperation(page.id, { type: 'design.elements.create', elements: [preparedElement] })
    dispatch({ type: 'select', id: preparedElement.id })
  }

  function selectElements(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter(id => page.elements.some(element => element.id === id))
    dispatch({ type: 'select', id: uniqueIds.at(-1) ?? null, ids: uniqueIds })
  }

  function toggleMultipleSelection() {
    setMultiSelectMode(active => !active)
    setWhiteboardTool('select')
    setConnectorStartId(null)
  }

  function groupSelectedElements() {
    const grouped = createWhiteboardGroup(page, state.selectedIds)
    if (grouped) {
      change(document => updatePage(document, state.pageIndex, () => grouped))
      applyCollaborativeOperation(page.id, { type: 'design.groups.set', groups: grouped.groups ?? [] })
    }
  }

  function ungroupSelectedElements() {
    const ungrouped = ungroupWhiteboardSelection(page, state.selectedIds)
    change(document => updatePage(document, state.pageIndex, current => ({ ...current, groups: ungrouped.groups ?? [] })))
    applyCollaborativeOperation(page.id, { type: 'design.groups.set', groups: ungrouped.groups ?? [] })
  }

  function moveSelectionBy(dx: number, dy: number) {
    if (state.selectedIds.length === 0) return
    change(document => updatePage(document, state.pageIndex, current => isWhiteboard
      ? moveWhiteboardElements(current, state.selectedIds, dx, dy)
      : { ...current, elements: current.elements.map(element => state.selectedIds.includes(element.id) ? { ...element, x: element.x + dx, y: element.y + dy } : element) }))
    for (const elementId of state.selectedIds) {
      const element = page.elements.find(item => item.id === elementId)
      if (element) scheduleDesignElementPatch(page.id, elementId, { x: element.x + dx, y: element.y + dy })
    }
  }

  function arrangeSelection(event: ChangeEvent<HTMLSelectElement>) {
    const arrangement = event.currentTarget.value as WhiteboardArrangement | ''
    event.currentTarget.value = ''
    if (!arrangement || !canEdit || !isWhiteboard || state.selectedIds.length < (arrangement.startsWith('distribute-') ? 3 : 2)) return
    const arrangedElements = arrangeWhiteboardElements(page.elements, state.selectedIds, arrangement)
    change(document => updatePage(document, state.pageIndex, current => ({
      ...current,
      elements: arrangeWhiteboardElements(current.elements, state.selectedIds, arrangement),
    })))
    for (const elementId of state.selectedIds) {
      const before = page.elements.find(element => element.id === elementId)
      const after = arrangedElements.find(element => element.id === elementId)
      if (before && after && (before.x !== after.x || before.y !== after.y)) {
        scheduleDesignElementPatch(page.id, elementId, { x: after.x, y: after.y })
      }
    }
  }

  function addText() {
    const position = insertionPosition(420, 72, 180, 430)
    addElement({ id: createId('text'), type: 'text', name: 'Texto', ...position, width: 420, height: 72, rotation: 0, text: 'Digite seu texto', fontSize: 36, fontFamily: 'Arial', color: '#29263d', bold: true })
  }

  function insertBrandTitle() {
    if (!canEdit) return
    const selectedTextIds = state.selectedIds.filter(id => page.elements.some(element => element.id === id && element.type === 'text'))
    if (selectedTextIds.length) {
      const stylePatch = { fontSize: 42.6667, fontFamily: 'Arial', color: '#000000', bold: true }
      change(document => updatePage(document, state.pageIndex, current => ({ ...current, elements: applyAuditedBrandTypography(current.elements, selectedTextIds) })))
      selectedTextIds.forEach(id => scheduleDesignElementPatch(page.id, id, stylePatch))
      return
    }
    const position = insertionPosition(420, 72, 180, 430)
    addElement(createBrandTitleElement({ id: createId('brand-title'), x: position.x, y: position.y }))
  }

  function applyBrandPalette() {
    if (!canEdit) return
    const updatedPages = state.document.pages.map(documentPage => ({ ...documentPage, elements: applyAuditedBrandPalette(documentPage.elements) }))
    change(document => ({
      ...document,
      pages: updatedPages,
      updatedAt: new Date().toISOString(),
    }))
    for (let index = 0; index < state.document.pages.length; index++) {
      scheduleDesignElementDiffs(state.document.pages[index].id, state.document.pages[index].elements, updatedPages[index].elements)
    }
  }

  function applyBrandReview(issueKeys: string[]) {
    const before = page.elements
    const after = applyBrandReviewFixes(before, issueKeys)
    if (after === before) return
    change(document => updatePage(document, state.pageIndex, current => ({ ...current, elements: applyBrandReviewFixes(current.elements, issueKeys) })))
    scheduleDesignElementDiffs(page.id, before, after)
  }

  function appendBulkGeneratedPages(generatedPages: DesignPage[]) {
    if (!generatedPages.length) return
    const afterPageId = state.document.pages.at(-1)?.id
    const nextPageIndex = state.document.pages.length + generatedPages.length - 1
    if (afterPageId) {
      let insertionAnchor = afterPageId
      for (const generatedPage of generatedPages) {
        if (JSON.stringify(generatedPage).length > 200_000) break
        applyCollaborativeOperation(page.id, { type: 'design.page.insert', page: generatedPage, afterPageId: insertionAnchor })
        insertionAnchor = generatedPage.id
      }
    }
    change(document => ({ ...document, pages: [...document.pages, ...generatedPages], updatedAt: new Date().toISOString() }))
    navigateToPage(nextPageIndex)
  }

  function addStickyNote() {
    const position = insertionPosition(260, 220, 210, 410)
    addElement(createStickyNoteElement(position.x, position.y))
  }

  function addShape(shape: VectorShapeKind) {
    const width = shape === 'line' ? 240 : shape === 'arrow' ? 240 : 210
    const height = shape === 'line' ? 16 : shape === 'arrow' ? 90 : 170
    const position = insertionPosition(width, height, 240, 430)
    addElement({ id: createId(shape), type: 'shape', shape, name: VECTOR_SHAPE_LABELS[shape], ...position, width, height, rotation: 0, fill: '#8e7cf5', cornerRadius: shape === 'rect' ? 20 : 0, ...(shape === 'line' ? { strokeWidth: 8 } : {}), ...(isWhiteboard && shape === 'rect' ? { qrConfig: { pattern: 'blocks' as const, foreground: '#000000', background: '#ffffff', logo: 'none' as const, corner: 0 } } : {}) })
  }

  function addMediaAsset(asset: MediaAsset) {
    if (replaceSelectedImageId) {
      const target = page.elements.find(element => element.id === replaceSelectedImageId)
      if (target?.type === 'image') {
        change(document => updateElement(document, state.pageIndex, target.id, element => element.type === 'image' ? { ...element, name: asset.name, assetId: asset.id, src: asset.src, sourceWidth: asset.width, sourceHeight: asset.height, crop: null, height: element.width * asset.height / asset.width } : element))
        scheduleDesignElementPatch(page.id, target.id, { name: asset.name, assetId: asset.id, src: asset.src, sourceWidth: asset.width, sourceHeight: asset.height, crop: null, height: target.width * asset.height / asset.width } as Partial<DesignElement>)
        setReplaceSelectedImageId(null)
        setAssetPanelOpen(false)
        return
      }
      setReplaceSelectedImageId(null)
    }
    const factor = Math.min(1, 420 / asset.width, 420 / asset.height)
    const width = asset.width * factor
    const height = asset.height * factor
    const position = insertionPosition(width, height, 190, 410)
    addElement({ id: createId('image'), type: 'image', name: asset.name, assetId: asset.id, ...position, width, height, rotation: 0, src: asset.src, sourceWidth: asset.width, sourceHeight: asset.height })
    setAssetPanelOpen(false)
  }

  function setVideoTimelineClips(clips: VideoTimelineClip[]) {
    const currentClips = page.timelineClips ?? []
    change(document => updatePage(document, state.pageIndex, current => ({ ...current, timelineClips: clips })))
    if (storageMode !== 'cloud' || !canEdit) return
    const currentById = new Map(currentClips.map(clip => [clip.id, clip]))
    const nextById = new Map(clips.map(clip => [clip.id, clip]))
    for (const clip of clips) {
      const previous = currentById.get(clip.id)
      if (!previous) {
        applyCollaborativeOperation(page.id, { type: 'design.video.clip.create', clip })
        continue
      }
      const changedFields = (['startMs', 'durationMs', 'sourceStartMs', 'volume', 'fadeInMs', 'fadeOutMs', 'trackIndex', 'opacity', 'fitMode', 'scale', 'offsetX', 'offsetY', 'opacityKeyframes', 'transformKeyframes', 'animationEasing'] as const).filter(key => key === 'opacityKeyframes' || key === 'transformKeyframes' ? JSON.stringify(previous[key] ?? []) !== JSON.stringify(clip[key] ?? []) : previous[key] !== clip[key])
      const patch = Object.fromEntries(changedFields.map(key => [key, clip[key]])) as VideoTimelineClipPatch
      if (Object.keys(patch).length) applyCollaborativeOperation(page.id, { type: 'design.video.clip.patch', clipId: clip.id, patch })
    }
    for (const clip of currentClips) {
      if (!nextById.has(clip.id)) applyCollaborativeOperation(page.id, { type: 'design.video.clip.delete', clipId: clip.id })
    }
  }

  function splitSelectedVideoTimelineClip() {
    const selectedClip = (page.timelineClips ?? []).find(clip => clip.id === selectedVideoTimelineClipId)
    if (!selectedClip || !canEdit) return
    const split = splitVideoTimelineClipAt(selectedClip, videoPlayheadMs, createId('clip'))
    if (!split) return
    const clips = [...(page.timelineClips ?? [])]
    const index = clips.findIndex(clip => clip.id === selectedClip.id)
    clips.splice(index, 1, split.first, split.second)
    setVideoTimelineClips(clips)
    setSelectedVideoTimelineClipId(split.second.id)
  }

  function addVideoTimelineClip(asset: MediaAsset, sourceDurationMs: number) {
    if (!isVideo || !canEdit) return
    const startMs = Math.min(videoPlayheadRef.current, Math.max(0, videoDurationMs - 100))
    const durationMs = Math.min(sourceDurationMs, videoDurationMs - startMs)
    if (durationMs <= 0) { setAssetError('Mova o indicador para dentro da duração do projeto antes de inserir esta mídia.'); return }
    const kind = asset.mimeType.startsWith('video/') ? 'video' : 'audio'
    const occupiedTracks = new Set((page.timelineClips ?? []).filter(clip => clip.kind === 'video' && clip.startMs < startMs + durationMs && clip.startMs + clip.durationMs > startMs).map(clip => clip.trackIndex ?? 0))
    let trackIndex = 0
    while (kind === 'video' && occupiedTracks.has(trackIndex)) trackIndex += 1
    const clip: VideoTimelineClip = { id: createId('clip'), assetId: asset.id, name: asset.name, kind, startMs, durationMs, sourceDurationMs, sourceStartMs: 0, volume: 1, trackIndex }
    setVideoTimelineClips([...(page.timelineClips ?? []), clip])
  }

  function updateVideoOpacityKeyframe(clipId: string, timeMs: number, opacity: number) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId && clip.kind === 'video')
    if (!target || !canEdit || timeMs < 0 || timeMs > target.durationMs) return
    const opacityKeyframes = setVideoOpacityKeyframe(target.opacityKeyframes, timeMs, opacity)
    if (opacityKeyframes.length > 100) { setAssetError('Cada clipe pode ter até 100 quadros-chave de opacidade.'); return }
    setVideoTimelineClips(clips.map(clip => clip.id === clipId ? { ...clip, opacityKeyframes } : clip))
  }

  function removeVideoOpacityKeyframeAt(clipId: string, timeMs: number) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId && clip.kind === 'video')
    if (!target || !canEdit || !target.opacityKeyframes?.some(keyframe => keyframe.timeMs === timeMs)) return
    const opacityKeyframes = removeVideoOpacityKeyframe(target.opacityKeyframes, timeMs)
    setVideoTimelineClips(clips.map(clip => clip.id === clipId ? { ...clip, opacityKeyframes } : clip))
  }

  function updateVideoOpacityKeyframeEasing(clipId: string, timeMs: number, easing: VideoAnimationEasing | null) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId && clip.kind === 'video')
    if (!target || !canEdit || !target.opacityKeyframes?.some(keyframe => keyframe.timeMs === timeMs)) return
    const opacityKeyframes = setVideoOpacityKeyframeEasing(target.opacityKeyframes, timeMs, easing)
    setVideoTimelineClips(clips.map(clip => clip.id === clipId ? { ...clip, opacityKeyframes } : clip))
  }

  function updateVideoTransformKeyframe(clipId: string, timeMs: number, field: 'scale' | 'offsetX' | 'offsetY', value: number) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId && clip.kind === 'video')
    if (!target || !canEdit || timeMs < 0 || timeMs > target.durationMs || !Number.isFinite(value)) return
    const current = getVideoClipTransform(target, timeMs)
    const transformKeyframes = setVideoTransformKeyframe(target.transformKeyframes, timeMs, { ...current, [field]: value })
    if (transformKeyframes.length > 100) { setAssetError('Cada clipe pode ter até 100 quadros-chave de enquadramento.'); return }
    setVideoTimelineClips(clips.map(clip => clip.id === clipId ? { ...clip, transformKeyframes } : clip))
  }

  function removeVideoTransformKeyframeAt(clipId: string, timeMs: number) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId && clip.kind === 'video')
    if (!target || !canEdit || !target.transformKeyframes?.some(keyframe => keyframe.timeMs === timeMs)) return
    const transformKeyframes = removeVideoTransformKeyframe(target.transformKeyframes, timeMs)
    setVideoTimelineClips(clips.map(clip => clip.id === clipId ? { ...clip, transformKeyframes } : clip))
  }

  function updateVideoTransformKeyframeEasing(clipId: string, timeMs: number, easing: VideoAnimationEasing | null) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId && clip.kind === 'video')
    if (!target || !canEdit || !target.transformKeyframes?.some(keyframe => keyframe.timeMs === timeMs)) return
    const transformKeyframes = setVideoTransformKeyframeEasing(target.transformKeyframes, timeMs, easing)
    setVideoTimelineClips(clips.map(clip => clip.id === clipId ? { ...clip, transformKeyframes } : clip))
  }

  function updateVideoTimelineClip(clipId: string, field: 'startMs' | 'durationMs' | 'sourceStartMs' | 'volume' | 'fadeInMs' | 'fadeOutMs' | 'trackIndex' | 'opacity' | 'fitMode' | 'scale' | 'offsetX' | 'offsetY' | 'animationEasing', value: number | string) {
    const clips = page.timelineClips ?? []
    const target = clips.find(clip => clip.id === clipId)
    if (!target || !canEdit || (field === 'fitMode' ? !['contain', 'cover'].includes(String(value)) : field === 'animationEasing' ? !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(String(value)) : !Number.isFinite(value))) return
    const numericValue = Number(value)
    if (field !== 'fitMode' && field !== 'animationEasing' && !Number.isFinite(numericValue)) return
    const nextValue = field === 'fitMode' ? value === 'cover' ? 'cover' : 'contain'
      : field === 'animationEasing' ? value as VideoTimelineClip['animationEasing']
      : field === 'volume' ? Math.max(0, Math.min(1, numericValue))
        : field === 'opacity' ? Math.max(0, Math.min(100, Math.round(numericValue)))
          : field === 'scale' ? Math.max(50, Math.min(300, Math.round(numericValue)))
            : field === 'offsetX' || field === 'offsetY' ? Math.max(-100, Math.min(100, Math.round(numericValue)))
              : Math.max(field === 'durationMs' ? 100 : 0, Math.min(field === 'trackIndex' ? 999 : field === 'fadeInMs' || field === 'fadeOutMs' ? target.durationMs : 86_400_000, Math.round(numericValue)))
    const next = clips.map(clip => {
      if (clip.id !== clipId) return clip
      const changed = { ...clip, [field]: nextValue }
      if (field === 'startMs') changed.durationMs = Math.min(changed.durationMs, Math.max(100, videoDurationMs - changed.startMs), changed.sourceDurationMs - changed.sourceStartMs)
      if (field === 'durationMs') changed.durationMs = Math.min(changed.durationMs, changed.sourceDurationMs - changed.sourceStartMs)
      if (field === 'sourceStartMs') {
        changed.sourceStartMs = Math.min(numericValue, Math.max(0, changed.sourceDurationMs - 100))
        changed.durationMs = Math.min(changed.durationMs, changed.sourceDurationMs - changed.sourceStartMs)
      }
      if (field === 'startMs' || field === 'durationMs' || field === 'sourceStartMs') {
        changed.opacityKeyframes = changed.opacityKeyframes?.filter(keyframe => keyframe.timeMs <= changed.durationMs)
        changed.transformKeyframes = changed.transformKeyframes?.filter(keyframe => keyframe.timeMs <= changed.durationMs)
      }
      return changed
    })
    setVideoTimelineClips(next)
  }

  function removeVideoTimelineClip(clipId: string) {
    setVideoTimelineClips((page.timelineClips ?? []).filter(clip => clip.id !== clipId))
  }

  async function handleTimelineMediaFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try { validateTimelineMediaUpload(file) }
    catch (error) { setAssetError(error instanceof Error ? error.message : 'Este arquivo de mídia não pode ser usado.'); return }
    if (!isVideo || !canEdit) return
    setAssetBusy(true)
    setAssetError('')
    try {
      const metadata = await readTimelineMediaMetadata(file)
      const fingerprint = await fingerprintImageUpload(file)
      const storedAssets = storageMode === 'cloud' ? [...assets, ...teamAssets] : await listStoredMediaAssets()
      let storedAsset = storedAssets.find(asset => asset.fingerprint === fingerprint && asset.mimeType === file.type)
      if (!storedAsset) {
        const rawSrc = await readImageDataUrl(file)
        const src = rawSrc.replace(/^data:[^;,]+/, `data:${file.type}`)
        const asset: MediaAsset = { id: createId('asset'), name: file.name || (file.type.startsWith('video/') ? 'Vídeo' : 'Áudio'), mimeType: file.type, width: metadata.width, height: metadata.height, src, fingerprint, createdAt: createIsoTimestamp() }
        if (storageMode === 'cloud' && remoteTeamId) {
          const shared = await saveRemoteTeamMediaAsset(remoteTeamId, asset)
          setTeamAssets(current => [shared, ...current.filter(item => item.id !== shared.id)])
          setTeamAssetsTeamId(remoteTeamId)
          storedAsset = await saveRemoteMediaAsset(documentId, { ...shared, scope: 'document' })
        } else storedAsset = storageMode === 'cloud' ? await saveRemoteMediaAsset(documentId, asset) : (await writeMediaAsset(asset), asset)
      } else if (storageMode === 'cloud') {
        if (remoteTeamId) {
          const shared = storedAsset.scope === 'team' ? storedAsset : await saveRemoteTeamMediaAsset(remoteTeamId, storedAsset)
          setTeamAssets(current => [shared, ...current.filter(item => item.id !== shared.id)])
          setTeamAssetsTeamId(remoteTeamId)
          storedAsset = await saveRemoteMediaAsset(documentId, { ...shared, scope: 'document' })
        } else storedAsset = await saveRemoteMediaAsset(documentId, storedAsset)
      } else if (storedAsset.libraryVisible === 0) {
        storedAsset = { ...storedAsset, libraryVisible: 1 }
        await writeMediaAsset(storedAsset)
      }
      setAssets(current => [storedAsset!, ...current.filter(item => item.id !== storedAsset!.id)])
      addVideoTimelineClip(storedAsset, metadata.durationMs)
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Não foi possível adicionar esta mídia à timeline.')
    } finally { setAssetBusy(false) }
  }

  async function addTeamMediaAsset(asset: MediaAsset) {
    setAssetBusy(true)
    setAssetError('')
    try {
      const documentAsset = await saveRemoteMediaAsset(documentId, { ...asset, scope: 'document' })
      setAssets(current => [documentAsset, ...current.filter(item => item.id !== documentAsset.id)])
      addMediaAsset(documentAsset)
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Não foi possível usar esta mídia da equipe neste projeto.')
    } finally {
      setAssetBusy(false)
    }
  }

  async function addBuiltInIllustration(assetId: string) {
    const illustration = BUILT_IN_ILLUSTRATIONS.find(asset => asset.id === assetId)
    if (!illustration) return
    setAssetBusy(true)
    setAssetError('')
    try {
      const existing = assets.find(asset => asset.id === illustration.id)
        ?? (storageMode === 'cloud' ? undefined : (await listStoredMediaAssets()).find(asset => asset.id === illustration.id))
      const fingerprint = await fingerprintImageUpload(new Blob([illustration.src], { type: 'text/plain' }))
      const asset: MediaAsset = existing ? { ...existing, fingerprint, libraryVisible: 1 } : {
        id: illustration.id,
        name: illustration.name,
        mimeType: illustration.mimeType,
        width: illustration.width,
        height: illustration.height,
        src: illustration.src,
        fingerprint,
        createdAt: createIsoTimestamp(),
      }
      let storedAsset: MediaAsset
      if (storageMode === 'cloud' && remoteTeamId) {
        const sharedAsset = await saveRemoteTeamMediaAsset(remoteTeamId, asset)
        setTeamAssets(current => [sharedAsset, ...current.filter(item => item.id !== sharedAsset.id)])
        setTeamAssetsTeamId(remoteTeamId)
        storedAsset = await saveRemoteMediaAsset(documentId, { ...sharedAsset, scope: 'document' })
      } else storedAsset = storageMode === 'cloud' ? await saveRemoteMediaAsset(documentId, asset) : (await writeMediaAsset(asset), asset)
      setAssets(current => [storedAsset, ...current.filter(item => item.id !== storedAsset.id)])
      addMediaAsset(storedAsset)
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Não foi possível adicionar esta ilustração.')
    } finally {
      setAssetBusy(false)
    }
  }

  async function handleImageFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      validateImageUpload(file)
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Este arquivo de imagem não pode ser usado.')
      return
    }
    setAssetBusy(true)
    setAssetError('')
    try {
      const fingerprint = await fingerprintImageUpload(file)
      const storedAssets = storageMode === 'cloud' ? [...assets, ...teamAssets] : await listStoredMediaAssets()
      const duplicate = storedAssets.find(asset => asset.fingerprint === fingerprint)
      if (duplicate) {
        if (storageMode === 'cloud' && remoteTeamId) {
          const sharedAsset = duplicate.scope === 'team' ? duplicate : await saveRemoteTeamMediaAsset(remoteTeamId, duplicate)
          setTeamAssets(current => [sharedAsset, ...current.filter(item => item.id !== sharedAsset.id)])
          setTeamAssetsTeamId(remoteTeamId)
          const documentAsset = await saveRemoteMediaAsset(documentId, { ...sharedAsset, scope: 'document' })
          setAssets(current => [documentAsset, ...current.filter(item => item.id !== documentAsset.id)])
          addMediaAsset(documentAsset)
          return
        }
        const reusableAsset: MediaAsset = duplicate.libraryVisible === 0 ? { ...duplicate, libraryVisible: 1 as const } : duplicate
        if (reusableAsset !== duplicate) await writeMediaAsset(reusableAsset)
        addMediaAsset(reusableAsset)
        setAssets(await listMediaAssets())
        return
      }

      const src = file.type.toLowerCase() === 'image/svg+xml'
        ? sanitizeImportedSvg(await file.text()).dataUrl
        : await readImageDataUrl(file)
      const dimensions = await readImageDimensions(src)
      validateImageDimensions(dimensions.width, dimensions.height)
      const previousAsset = storedAssets.find(asset => asset.src === src)
      if (previousAsset) {
        const updatedAsset: MediaAsset = { ...previousAsset, fingerprint, libraryVisible: 1 }
        if (storageMode !== 'cloud') await writeMediaAsset(updatedAsset)
        addMediaAsset(updatedAsset)
        setAssets(storedAssets.map(asset => asset.id === updatedAsset.id ? updatedAsset : asset))
        return
      }

      const asset: MediaAsset = { id: createId('asset'), name: file.name || 'Imagem', mimeType: file.type, width: dimensions.width, height: dimensions.height, src, fingerprint, createdAt: createIsoTimestamp() }
      let storedAsset: MediaAsset
      if (storageMode === 'cloud' && remoteTeamId) {
        const sharedAsset = await saveRemoteTeamMediaAsset(remoteTeamId, asset)
        setTeamAssets(current => [sharedAsset, ...current.filter(item => item.id !== sharedAsset.id)])
        setTeamAssetsTeamId(remoteTeamId)
        storedAsset = await saveRemoteMediaAsset(documentId, { ...sharedAsset, scope: 'document' })
      } else storedAsset = storageMode === 'cloud' ? await saveRemoteMediaAsset(documentId, asset) : (await writeMediaAsset(asset), asset)
      setAssets(current => [storedAsset, ...current.filter(existing => existing.id !== storedAsset.id)])
      addMediaAsset(storedAsset)
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Não foi possível salvar esta imagem na biblioteca local.')
    } finally {
      setAssetBusy(false)
    }
  }

  async function removeMediaAsset(asset: MediaAsset) {
    if (state.document.pages.some(currentPage => currentPage.timelineClips?.some(clip => clip.assetId === asset.id))) {
      setAssetError('Remova primeiro este clipe da timeline para poder retirar a mídia da biblioteca.')
      return
    }
    try {
      if (storageMode === 'cloud') {
        await deleteRemoteMediaAsset(documentId, asset.id)
        setAssets(await listRemoteMediaAssets(documentId))
      } else {
        await deleteMediaAsset(asset.id)
        setAssets(await listMediaAssets())
      }
      setAssetError('')
    } catch {
      setAssetError('Não foi possível remover esta mídia da biblioteca.')
    }
  }

  async function removeTeamMediaAsset(asset: MediaAsset) {
    if (!remoteTeamId || remoteRole !== 'owner') return
    try {
      await deleteRemoteTeamMediaAsset(remoteTeamId, asset.id)
      setTeamAssets(await listRemoteTeamMediaAssets(remoteTeamId))
      setTeamAssetsTeamId(remoteTeamId)
      setAssetError('')
    } catch {
      setAssetError('Não foi possível remover esta mídia da biblioteca da equipe.')
    }
  }

  const visibleAssets = useMemo(() => assets.filter(asset => asset.libraryVisible !== 0 && asset.mimeType.startsWith('image/') && asset.name.toLocaleLowerCase('pt-BR').includes(assetQuery.trim().toLocaleLowerCase('pt-BR'))), [assets, assetQuery])
  const visibleTeamAssets = useMemo(() => remoteTeamId && teamAssetsTeamId === remoteTeamId ? teamAssets.filter(asset => asset.mimeType.startsWith('image/') && asset.name.toLocaleLowerCase('pt-BR').includes(assetQuery.trim().toLocaleLowerCase('pt-BR'))) : [], [remoteTeamId, teamAssetsTeamId, teamAssets, assetQuery])
  const visibleIllustrations = useMemo(() => BUILT_IN_ILLUSTRATIONS.filter(asset => (assetCategory === 'Todas' || asset.category === assetCategory) && `${asset.name} ${asset.category} ${asset.tags.join(' ')}`.toLocaleLowerCase('pt-BR').includes(assetQuery.trim().toLocaleLowerCase('pt-BR'))), [assetCategory, assetQuery])

  function setPersistedDocument(document: DesignDocument) {
    persistedDocumentRef.current = document
    setAccessibilitySavedDocument(document)
  }

  function updateSelected(patch: Partial<DesignElement>) {
    if (!state.selectedId) return
    const targetIds = state.selectedIds.length > 1 && selected?.type === 'text' && Object.keys(patch).every(key => ['fontSize', 'fontFamily', 'color', 'bold', 'kerning', 'lineSpacing'].includes(key))
      ? state.selectedIds.filter(id => page.elements.find(element => element.id === id)?.type === 'text')
      : [state.selectedId]
    change(document => {
      if (targetIds.length > 1) return updatePage(document, state.pageIndex, current => ({ ...current, elements: patchSelectedTextTypography(current.elements, targetIds, patch as Parameters<typeof patchSelectedTextTypography>[2]) }))
      return updateElement(document, state.pageIndex, state.selectedId!, element => ({ ...element, ...patch } as DesignElement))
    })
    targetIds.forEach(id => scheduleDesignElementPatch(page.id, id, patch))
  }

  function updateQrConfiguration(patch: Partial<NonNullable<Extract<DesignElement, { type: 'shape' }>['qrConfig']>>) {
    if (selected?.type !== 'shape') return
    const defaults: NonNullable<Extract<DesignElement, { type: 'shape' }>['qrConfig']> = { pattern: 'blocks', foreground: '#000000', background: '#ffffff', logo: 'none', corner: 0 }
    updateSelected({ qrConfig: { ...defaults, ...selected.qrConfig, ...patch } })
  }

  function applyQrDestination() {
    if (!selected || selected.type !== 'shape' || !selected.qrConfig) return
    const value = (qrDrafts[selected.id] ?? selected.qrConfig.url ?? '').trim()
    if (!value) { updateQrConfiguration({ url: undefined }); setQrErrors(errors => ({ ...errors, [selected.id]: '' })); return }
    try {
      const parsed = new URL(value)
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error('invalid url')
      updateQrConfiguration({ url: parsed.href })
      setQrErrors(errors => ({ ...errors, [selected.id]: '' }))
      setQrDrafts(drafts => ({ ...drafts, [selected.id]: parsed.href }))
    } catch {
      setQrErrors(errors => ({ ...errors, [selected.id]: 'Insira uma URL http:// ou https:// válida.' }))
    }
  }

  function openAccessibilityIssue(issue: AccessibilityIssue) {
    const target = accessibilityReviewDocument.pages[issue.pageIndex]?.elements.find(element => element.id === issue.elementId)
    if (issue.kind === 'alt' && target?.type === 'image') {
      setAltTextDraft(target.altText ?? '')
      setAltTextDecorativeDraft(target.decorative ?? false)
      setAltTextEditorId(target.id)
      setAccessibilityOpen(false)
    }
    navigateToPage(issue.pageIndex)
    dispatch({ type: 'select', id: issue.elementId })
    setAccessibilityTargetId(issue.elementId)
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.layer-row[data-element-id="${CSS.escape(issue.elementId)}"]`)?.focus())
  }

  function correctSelectedAccessibilityTypography() {
    if (!canEdit) return
    const corrections = selectedTypographyIssues.filter(issue => {
      const element = currentDocumentRef.current.pages[issue.pageIndex]?.elements.find(candidate => candidate.id === issue.elementId)
      return element?.type === 'text' && element.fontSize < 12
    })
    if (!corrections.length) return
    const correctedIds = new Set(corrections.map(issue => issue.id))
    change(document => ({
      ...document,
      pages: document.pages.map((documentPage, pageIndex) => {
        const targetIds = new Set(corrections.filter(issue => issue.pageIndex === pageIndex).map(issue => issue.elementId))
        if (!targetIds.size) return documentPage
        return { ...documentPage, elements: documentPage.elements.map(element => targetIds.has(element.id) && element.type === 'text' && element.fontSize < 12 ? { ...element, fontSize: 12 } : element) }
      }),
      updatedAt: new Date().toISOString(),
    }))
    corrections.forEach(issue => scheduleDesignElementPatch(issue.pageId, issue.elementId, { fontSize: 12 }))
    setAccessibilitySelectedIssues(selectedIds => selectedIds.filter(id => !correctedIds.has(id)))
    const lastCorrection = corrections.at(-1)
    if (lastCorrection) {
      navigateToPage(lastCorrection.pageIndex)
      dispatch({ type: 'select', id: lastCorrection.elementId })
      setAccessibilityTargetId(lastCorrection.elementId)
    }
  }

  function saveSelectedAccessibilityAltText() {
    if (!canEdit || saveStatus !== 'saved' || !canSaveSelectedAccessibilityAltText) return
    const corrections = selectedAltIssues.flatMap(issue => {
      const target = currentDocumentRef.current.pages[issue.pageIndex]?.elements.find(element => element.id === issue.elementId)
      const description = accessibilityAltDrafts[issue.id]?.trim() ?? ''
      return target?.type === 'image' && !target.decorative && !target.altText?.trim() && description.length > 0 && description.length <= 250 ? [{ issue, description }] : []
    })
    if (corrections.length !== selectedAltIssues.length) return
    change(document => ({
      ...document,
      pages: document.pages.map(documentPage => {
        const descriptions = new Map<string, string>(corrections.filter(({ issue }) => issue.pageId === documentPage.id).map(({ issue, description }) => [issue.elementId, description] as const))
        if (!descriptions.size) return documentPage
        return { ...documentPage, elements: documentPage.elements.map(element => element.type === 'image' && descriptions.has(element.id) ? { ...element, altText: descriptions.get(element.id)!, decorative: false } : element) }
      }),
      updatedAt: new Date().toISOString(),
    }))
    corrections.forEach(({ issue, description }) => scheduleDesignElementPatch(issue.pageId, issue.elementId, { altText: description, decorative: false }))
    const correctedIds = new Set(corrections.map(({ issue }) => issue.id))
    setAccessibilitySelectedIssues(selectedIds => selectedIds.filter(id => !correctedIds.has(id)))
    setAccessibilityAltDrafts({})
    setAccessibilityBatchAltOpen(false)
  }

  function applyImageCrop(crop: SourceCrop | null, sourceWidth: number, sourceHeight: number) {
    if (selected?.type !== 'image') return
    const visibleCrop = crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
    updateSelected({ crop, sourceWidth, sourceHeight, height: selected.width * visibleCrop.height / visibleCrop.width })
    setImageCropOpen(false)
  }

  function moveElement(id: string, x: number, y: number) {
    const element = page.elements.find(item => item.id === id)
    if (!element) return
    const ids = state.selectedIds.includes(id) ? state.selectedIds : selectionForElement(page, id)
    const dx = x - element.x
    const dy = y - element.y
    change(document => updatePage(document, state.pageIndex, current => isWhiteboard
      ? moveWhiteboardElements(current, ids, dx, dy)
      : { ...current, elements: current.elements.map(item => ids.includes(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item) }))
    for (const selectedId of ids) {
      const selectedElement = page.elements.find(item => item.id === selectedId)
      if (selectedElement) scheduleDesignElementPatch(page.id, selectedId, { x: selectedElement.x + dx, y: selectedElement.y + dy })
    }
  }

  function transformElement(id: string, node: Konva.Node) {
    const element = page.elements.find(item => item.id === id)
    if (!element) return
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const patch: Partial<DesignElement> = {
      x: node.x(), y: node.y(), rotation: node.rotation(),
      width: Math.max(24, node.width() * scaleX), height: Math.max(24, node.height() * scaleY),
      ...(element.type === 'free-draw' ? { points: element.points.map((point, index) => point * (index % 2 === 0 ? scaleX : scaleY)), strokeWidth: element.strokeWidth * (Math.abs(scaleX) + Math.abs(scaleY)) / 2 } : {}),
    }
    change(document => updateElement(document, state.pageIndex, id, element => ({ ...element, ...patch } as DesignElement)))
    scheduleDesignElementPatch(page.id, id, patch)
  }

  async function exportVideo(filename: string, format: VideoExportFormat | 'gif') {
    if (!stageRef.current) throw new Error('A prévia do vídeo ainda não está pronta.')
    const isGif = format === 'gif'
    if (!isGif && (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function')) throw new Error('Este navegador não oferece gravação de vídeo a partir da prévia.')
    const durationMs = isVideo ? state.document.videoDurationMs ?? 5000 : 5000
    if (isGif && durationMs > 10_000) throw new Error('A exportação GIF está limitada a 10 segundos neste navegador. Exporte o vídeo completo em WebM ou MP4.')
    if (durationMs > 600_000) throw new Error('A exportação pelo navegador está limitada a 10 minutos por arquivo.')
    const hasAudio = !isGif && isVideo && videoTimelineClips.length > 0
    const mimeType = isGif ? null : resolveVideoExportMimeType(format, hasAudio, type => MediaRecorder.isTypeSupported(type))
    if (!isGif && !mimeType) throw new Error(format === 'mp4' ? 'MP4 não está disponível: este navegador não oferece um codificador compatível.' : 'Este navegador não tem um codificador WebM compatível.')

    setExportBusy(true)
    setExportError('')
    const pixelRatio = isGif
      ? Math.min(1, 480 / Math.max(state.document.width, state.document.height))
      : isVideo
      ? Math.min(2, 2048 / Math.max(state.document.width, state.document.height))
      : 2400 / Math.max(state.document.width, state.document.height)
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = Math.max(1, Math.round(state.document.width * pixelRatio))
    outputCanvas.height = Math.max(1, Math.round(state.document.height * pixelRatio))
    const outputContext = outputCanvas.getContext('2d')
    if (!outputContext) { setExportBusy(false); throw new Error('Não foi possível preparar a resolução do vídeo.') }

    const stage = stageRef.current
    const transformer = transformerRef.current
    const wasTransformerVisible = transformer?.visible() ?? false
    const captureFrameRate = isGif ? 10 : 30
    const captureDurationMs = isGif ? durationMs : durationMs + (isVideo ? 0 : 250)
    const videoStream = isGif ? null : outputCanvas.captureStream(captureFrameRate)
    let audioDestination: MediaStreamAudioDestinationNode | null = null
    let exportAudioGraph: VideoExportAudioGraph | null = null
    const recorderRef: { current: MediaRecorder | null } = { current: null }
    let animationFrame = 0
    let videoAudioContext: AudioContext | null = null
    const cleanup = () => {
      cancelAnimationFrame(animationFrame)
      setVideoPlaying(false)
      if (transformer && wasTransformerVisible) transformer.show()
      stage.batchDraw()
      if (audioDestination) {
        for (const audioTrack of audioDestination.stream.getAudioTracks()) audioTrack.stop()
        if (exportAudioGraph) {
          exportAudioGraph.destinations.delete(audioDestination)
          for (const connection of exportAudioGraph.sources.values()) {
            if (!connection.destinations.delete(audioDestination)) continue
            connection.source.disconnect(audioDestination)
          }
        }
      }
      for (const track of videoStream?.getTracks() ?? []) track.stop()
      setExportBusy(false)
    }

    try {
      const mediaElements = videoTimelineClips.filter(clip => clip.kind === 'audio').map(clip => timelineAudioRefs.current[clip.id]).filter((media): media is HTMLMediaElement => Boolean(media))
      const videoElements = videoTimelineClips.filter(clip => clip.kind === 'video').map(clip => timelineVideoRefs.current[clip.id]).filter((media): media is HTMLVideoElement => Boolean(media))
      if (!isGif && (mediaElements.length || videoElements.length)) {
        let graph = videoAudioGraphRef.current
        if (!graph) {
          graph = { context: new AudioContext(), sources: new Map(), destinations: new Set() }
          videoAudioGraphRef.current = graph
        }
        exportAudioGraph = graph
        videoAudioContext = graph.context
        audioDestination = graph.context.createMediaStreamDestination()
        graph.destinations.add(audioDestination)
        for (const media of mediaElements) connectMediaToVideoExport(graph, media)
        for (const video of videoElements) connectMediaToVideoExport(graph, video)
        if (!mediaElements.length && !videoElements.length) {
          graph.destinations.delete(audioDestination)
          for (const track of audioDestination.stream.getTracks()) track.stop()
          audioDestination = null
        }
        await graph.context.resume()
        if (audioDestination && videoStream) for (const audioTrack of audioDestination.stream.getAudioTracks()) videoStream.addTrack(audioTrack)
      }

      const chunks: BlobPart[] = []
      const recording = isGif ? null : new Promise<Blob>((resolve, reject) => {
        if (!videoStream || !mimeType) { reject(new Error('A captura de vídeo não foi preparada.')); return }
        recorderRef.current = new MediaRecorder(videoStream, { mimeType, videoBitsPerSecond: 8_000_000, ...(audioDestination ? { audioBitsPerSecond: 192_000 } : {}) })
        recorderRef.current.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
        recorderRef.current.onerror = () => reject(new Error('O navegador interrompeu a codificação do vídeo.'))
        recorderRef.current.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
        recorderRef.current.start(250)
      })
      const gifFrames: Array<{ data: Uint8ClampedArray; width: number; height: number; delayMs: number }> = []
      videoPlayheadRef.current = 0
      setVideoPlayheadMs(0)
      setVideoPlaying(true)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      transformer?.hide()
      stage.batchDraw()
      const startedAt = performance.now()
      let nextCaptureAt = 0
      let lastGifFrameTime = 0
      const gifDuration = Math.max(10, Math.round(durationMs / 10) * 10)
      await new Promise<void>((resolve, reject) => {
        const drawFrame = () => {
          try {
            const wallElapsed = performance.now() - startedAt
            const elapsed = Math.min(durationMs, wallElapsed)
            videoPlayheadRef.current = elapsed
            setVideoPlayheadMs(elapsed)
            const activeClips = videoTimelineClips.filter(clip => clip.kind === 'video' && elapsed >= clip.startMs && elapsed < clip.startMs + clip.durationMs)
              .sort((left, right) => (left.trackIndex ?? 0) - (right.trackIndex ?? 0) || left.startMs - right.startMs || left.id.localeCompare(right.id))
            outputContext.fillStyle = activeClips.length ? '#000000' : page.background
            outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height)
            for (const clip of activeClips) {
              const video = timelineVideoRefs.current[clip.id]
              if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue
              const transform = getVideoClipTransform(clip, elapsed - clip.startMs)
              const animatedClip = { ...clip, ...transform }
              const layout = getVideoClipLayout(animatedClip, state.document.width, state.document.height, video.videoWidth, video.videoHeight)
              outputContext.save()
              outputContext.beginPath()
              outputContext.rect(0, 0, outputCanvas.width, outputCanvas.height)
              outputContext.clip()
              outputContext.globalAlpha = getVideoClipOpacity(clip, elapsed - clip.startMs) / 100
              outputContext.drawImage(video, layout.x * pixelRatio, layout.y * pixelRatio, layout.width * pixelRatio, layout.height * pixelRatio)
              outputContext.restore()
            }
            stage.batchDraw()
            const frame = stage.toCanvas({ x: pageOffset.x, y: pageOffset.y, width: state.document.width * scale, height: state.document.height * scale, pixelRatio: pixelRatio / scale })
            outputContext.drawImage(frame, 0, 0, outputCanvas.width, outputCanvas.height)
            if (isGif && wallElapsed >= nextCaptureAt) {
              const frameTime = gifFrames.length ? Math.min(gifDuration, Math.round(elapsed / 10) * 10) : 0
              if (frameTime < gifDuration) {
                const frame = outputContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height)
                if (gifFrames.length) gifFrames[gifFrames.length - 1].delayMs = frameTime - lastGifFrameTime
                gifFrames.push({ data: frame.data, width: outputCanvas.width, height: outputCanvas.height, delayMs: 0 })
                lastGifFrameTime = frameTime
                setExportStatus(`Preparando GIF: ${gifFrames.length} quadros capturados.`)
              }
              nextCaptureAt = (Math.floor(elapsed / (1000 / captureFrameRate)) + 1) * (1000 / captureFrameRate)
            }
            if (wallElapsed >= captureDurationMs) {
              if (isGif && gifFrames.length) gifFrames[gifFrames.length - 1].delayMs = gifDuration - lastGifFrameTime
              if (!isGif && recorderRef.current?.state === 'recording') recorderRef.current.stop()
              resolve()
              return
            }
            animationFrame = requestAnimationFrame(drawFrame)
          } catch (error) { reject(error) }
        }
        animationFrame = requestAnimationFrame(drawFrame)
      })
      let blob: Blob
      if (isGif) {
        const { encodeGif } = await import('./gif-export')
        const bytes = await encodeGif(gifFrames, { repeat: 0, onProgress: (completed, total) => setExportStatus(`Codificando GIF: ${completed} de ${total} quadros.`) })
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        blob = new Blob([buffer], { type: 'image/gif' })
      } else blob = await recording!
      if (!blob.size) throw new Error(`O arquivo ${format.toUpperCase()} ficou vazio (quadros=${gifFrames.length}, chunks=${chunks.length}, video=${videoStream?.getVideoTracks().map(track => track.readyState).join(',') ?? 'n/a'}, audio=${videoStream?.getAudioTracks().map(track => track.readyState).join(',') ?? 'n/a'}, canvas=${outputCanvas.width}x${outputCanvas.height}).`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${filename}.${format}`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setExportError('')
    } catch (error) {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      throw error
    } finally {
      cleanup()
      if (videoAudioContext?.state === 'suspended') void videoAudioContext.resume()
    }
  }

  async function exportDesign() {
    if (exportBusy) return
    setExportBusy(true)
    setExportError('')
    setExportStatus('Gerando o arquivo…')
    try {
      const currentExportFormat = isSheet
        ? exportFormat === 'xlsx' ? 'xlsx' : 'csv'
        : exportFormat === 'csv' || exportFormat === 'xlsx' || (!isDoc && exportFormat === 'docx') ? 'pdf' : exportFormat
      const filename = safeFileName(state.document.name)
      if ((currentExportFormat === 'webm' || currentExportFormat === 'mp4' || currentExportFormat === 'gif') && (isVideo || hasAnimatedImages)) {
        await exportVideo(filename, currentExportFormat)
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        return
      }
      if (isSheet && currentExportFormat === 'xlsx') {
        const { writeExcelWorkbook } = await import('./excel')
        const bytes = await writeExcelWorkbook(state.document.pages)
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.xlsx`
        link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportError('')
        return
      }
      if (isSheet) {
        const csv = serializeCsv(page.cells ?? [])
        const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.csv`
        link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportError('')
        return
      }
      if (isDoc && currentExportFormat === 'docx') {
        const { createDocxPagesBytes } = await import('./docx-export')
        const pages = state.document.pages.map(documentPage => documentPage.blocks ?? [])
        const bytes = await createDocxPagesBytes(pages, state.document.name)
        const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const url = URL.createObjectURL(new Blob([blobBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.docx`
        link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportError('')
        return
      }
      if (currentExportFormat === 'pptx' && state.document.type === 'presentation') {
        const { createPptxBytes } = await import('./pptx-export')
        const pageCanvases = await Promise.all(state.document.pages.map(documentPage => renderPageCanvas(state.document, documentPage)))
        const bytes = await createPptxBytes(state.document.width, state.document.height, pageCanvases.map(canvas => canvas.toDataURL('image/png')), state.document.pages)
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.pptx`
        link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportError('')
        return
      }
      if (currentExportFormat === 'pdf') {
        if (pdfPasswordEnabled) throw new Error('Proteção por senha não está disponível: este exportador não criptografa PDFs. Desative a opção para exportar sem proteção.')
        const renderedDocPages = isDoc ? await renderDocumentCanvases(state.document) : undefined
        const pageCanvases = renderedDocPages
          ? renderedDocPages.map(item => item.canvas)
          : await Promise.all(state.document.pages.map(documentPage => renderPageCanvas(state.document, documentPage)))
        const pageSemantics = renderedDocPages
          ? renderedDocPages.map(item => createPdfDocSemantics(item.semanticBlocks))
          : state.document.pages.map(documentPage => createPdfPageSemantics(documentPage, state.document.type))
        const pageDescriptions = renderedDocPages
          ? renderedDocPages.map(item => createPdfPageDescriptions({ ...state.document, pages: [state.document.pages[item.sourcePageIndex]] })[0])
          : createPdfPageDescriptions(state.document)
        const pageImages = pageCanvases.map(canvas => isDoc
          ? { data: canvas.toDataURL('image/png'), width: canvas.width / 2, height: canvas.height / 2 }
          : canvas.toDataURL('image/png'))
        const pdfBytes = await createPdfBytes(state.document.width, state.document.height, pageImages, pdfCompact, pageDescriptions, pageSemantics)
        const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.pdf`
        link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportError('')
        return
      }
      if (currentExportFormat === 'svg') {
        let svg: string
        if (isDoc) {
          const { renderDocContinuousSvg } = await import('./doc-svg-export')
          svg = renderDocContinuousSvg(state.document, state.pageIndex).svg
        } else {
          const { renderPageSvg } = await import('./svg-export')
          svg = await renderPageSvg(state.document, page)
        }
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}-pagina-${state.pageIndex + 1}.svg`
        link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportError('')
        return
      }
      const transparentPng = currentExportFormat === 'png' && exportPngBackground === 'transparent' && !isDoc && !isSheet && !isVideo
      const nativeRasterPage = exportFormat === 'png' && exportImageScale === 1 && !isDoc && !isSheet && !isVideo
        && page.elements.length === 1 && page.elements[0].type === 'image'
        && page.elements[0].x === 0 && page.elements[0].y === 0
        && page.elements[0].width === state.document.width && page.elements[0].height === state.document.height
        && page.elements[0].rotation === 0 && !page.elements[0].crop
        && !page.elements[0].flipX && !page.elements[0].flipY
        && !page.elements[0].filterPreset && !page.elements[0].maskStrokes?.length
        && !(page.elements[0].brightness ?? 0) && !(page.elements[0].contrast ?? 0) && !(page.elements[0].saturation ?? 0)
      const canvas = isDoc
        ? (await renderDocumentCanvases(state.document, true)).find(item => item.sourcePageIndex === state.pageIndex)!.canvas
        : await renderPageCanvas(state.document, page, transparentPng ? null : undefined, nativeRasterPage ? 1 : undefined)
      const sourceScale = canvas.width / state.document.width
      const targetWidth = Math.max(1, Math.round(state.document.width * exportImageScale))
      const targetHeight = Math.max(1, Math.round(canvas.height / sourceScale * exportImageScale))
      if (targetWidth * targetHeight > 64_000_000) throw new Error('A resolucao escolhida excede o limite seguro de exportacao do navegador.')
      let outputCanvas = canvas
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        outputCanvas = document.createElement('canvas')
        outputCanvas.width = targetWidth
        outputCanvas.height = targetHeight
        const outputContext = outputCanvas.getContext('2d')
        if (!outputContext) throw new Error('Ãao foi possivel preparar a resolucao escolhida.')
        outputContext.drawImage(canvas, 0, 0, targetWidth, targetHeight)
      }
      const mime = currentExportFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
      const jpegQuality = exportJpegQuality === 'low' ? 0.55 : exportJpegQuality === 'medium' ? 0.78 : 0.94
      const data = outputCanvas.toDataURL(mime, jpegQuality)
      const link = document.createElement('a')
      link.href = data
      link.download = `${filename}-pagina-${state.pageIndex + 1}.${currentExportFormat === 'jpeg' ? 'jpg' : 'png'}`
      link.click()
        setExportStatus('Download iniciado no navegador. Verifique se o arquivo foi salvo no dispositivo.')
      setExportError('')
    } catch (error) {
      setExportError(error instanceof Error ? `Falha na exportação: ${error.message}` : 'Falha ao exportar o documento.')
    } finally {
      setExportBusy(false)
    }
  }

  async function saveAndExit() {
    setSaveStatus('saving')
    try {
      if (persistedDocumentRef.current !== state.document) {
        if (storageMode === 'cloud') {
          await remoteSaveQueueRef.current
          if (remoteConflictRef.current) return
          const saved = await saveRemoteDocument(documentId, remoteRevisionRef.current, state.document)
          remoteRevisionRef.current = saved.revision
        } else {
          await writeDocument(state.document)
        }
        setPersistedDocument(state.document)
      }
      setSaveStatus('saved')
      onExit()
    } catch (error) {
      setSaveStatus('error')
      if (error instanceof StudioApiError && error.status === 409 && error.payload.current) {
        remoteConflictRef.current = true
        setRemoteConflict(error.payload.current as RemoteDocument)
      }
    }
  }

  async function reloadRemoteConflict() {
    try {
      const remote = await getRemoteDocument(documentId)
      const document = { ...remote.data, id: remote.id, name: remote.name }
      remoteRevisionRef.current = remote.revision
      setPersistedDocument(document)
      remoteConflictRef.current = false
      setRemoteConflict(null)
      setPermissionNotice('')
      setSaveStatus('saved')
      setSelectedConnectorSelection(null)
      dispatch({ type: 'load', document })
    } catch {
      setSaveStatus('error')
    }
  }

  async function saveConflictAsLocalCopy() {
    const copy = { ...state.document, id: createId('design'), name: `${state.document.name} — cópia local`, archivedAt: undefined, trashedAt: undefined }
    try {
      await writeDocument(copy)
      onExit(undefined, true)
    } catch {
      setSaveStatus('error')
    }
  }

  async function openComments() {
    if (storageMode !== 'cloud') return
    setCommentsOpen(true)
    setCommentsBusy(true)
    setCommentsError('')
    try {
      const [nextComments, collaborators, notificationResult] = await Promise.all([listRemoteComments(documentId), listRemoteCollaborators(documentId), listRemoteNotifications()])
      setComments(nextComments)
      setCommentCollaborators(collaborators)
      setCommentNotifications(notificationResult.notifications)
      setNotificationsUnread(notificationResult.unreadCount)
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : 'Não foi possível carregar os comentários.')
    } finally {
      setCommentsBusy(false)
    }
  }

  function updateCommentDraft(value: string, caret: number) {
    setCommentDraft(value)
    const beforeCaret = value.slice(0, caret)
    const token = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/)
    setMentionQuery(token ? token[1] : null)
  }

  function insertCommentMention(email: string) {
    const input = commentInputRef.current
    const caret = input?.selectionStart ?? commentDraft.length
    const at = commentDraft.lastIndexOf('@', caret)
    const start = at >= 0 && (at === 0 || /\s/.test(commentDraft[at - 1])) ? at : caret
    const next = `${commentDraft.slice(0, start)}@${email} ${commentDraft.slice(caret)}`
    const nextCaret = start + email.length + 2
    setCommentDraft(next)
    setMentionQuery(null)
    requestAnimationFrame(() => { commentInputRef.current?.focus(); commentInputRef.current?.setSelectionRange(nextCaret, nextCaret) })
  }

  async function openNotificationTarget(notification: RemoteNotification) {
    try {
      if (!notification.readAt) {
        await setRemoteNotificationRead(notification.id, true)
        setCommentNotifications(current => current.map(item => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))
        setNotificationsUnread(current => Math.max(0, current - 1))
      }
      if (notification.documentId !== documentId) {
        sessionStorage.setItem('fuse-pending-comment-navigation', JSON.stringify({ documentId: notification.documentId, commentId: notification.commentId }))
        onExit(notification.documentId)
        return
      }
      const currentComments = comments.length ? comments : await listRemoteComments(documentId)
      if (!comments.length) setComments(currentComments)
      const target = currentComments.find(item => item.id === notification.commentId)
      const thread = target?.parentId ? currentComments.find(item => item.id === target.parentId) : target
      if (!thread) return
      setNotificationsOpen(false)
      setCommentsOpen(true)
      jumpToComment(thread)
      window.setTimeout(() => document.querySelector(`[data-comment-id="${CSS.escape(thread.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : 'Não foi possível abrir a notificação.')
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canComment || !commentDraft.trim()) return
    setCommentsBusy(true)
    setCommentsError('')
    try {
      const parent = comments.find(item => item.id === replyTo)
      const comment = await postRemoteComment(documentId, commentDraft, parent?.pageId ?? page.id, parent?.elementId ?? state.selectedId, replyTo)
      setComments(current => [...current.filter(item => item.id !== comment.id), comment])
      setCommentDraft('')
      setReplyTo(null)
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : 'Não foi possível publicar o comentário.')
    } finally {
      setCommentsBusy(false)
    }
  }

  async function toggleCommentResolved(comment: RemoteComment) {
    if (!canComment || comment.parentId || resolvingCommentId) return
    setResolvingCommentId(comment.id)
    setCommentsError('')
    try {
      const state = await setRemoteCommentResolved(documentId, comment.id, !comment.resolvedAt)
      setComments(current => current.map(item => item.id === comment.id ? { ...item, resolvedAt: state.resolvedAt, resolvedBy: state.resolvedBy } : item))
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : 'Não foi possível atualizar a conversa.')
    } finally {
      setResolvingCommentId(null)
    }
  }

  function openAiBrandContext() {
    setAiAddMenuOpen(false)
    setAiBrandContextDraftKitId(BRAND_KITS.find(kit => kit.id === state.document.brandKitId)?.id ?? 'default')
    setAiBrandContextOpen(true)
    setAiError('')
    requestAnimationFrame(() => aiBrandKitSelectRef.current?.focus())
  }

  function cancelAiBrandContext() {
    setAiBrandContextOpen(false)
    setAiBrandContextDraftKitId(BRAND_KITS.find(kit => kit.id === state.document.brandKitId)?.id ?? 'default')
    aiAddMenuTriggerRef.current?.focus()
  }

  function applyAiBrandContext() {
    const context = getAiBrandContext(aiBrandContextDraftKitId)
    if (!context?.hasResources) return
    setAiAppliedBrandContext(context)
    setAiBrandContextOpen(false)
    const remaining = getAiPromptLimit(context)
    setAiError(aiPrompt.trim().length > remaining ? `Reduza o pedido para ${remaining} caracteres antes de enviar com este kit.` : '')
    aiPromptInputRef.current?.focus()
  }

  function removeAiBrandContext() {
    setAiAppliedBrandContext(null)
    setAiError('')
  }

  function openAiAttachmentPicker(mode: 'upload' | 'designs') {
    setAiAddMenuOpen(false)
    setAiAttachmentPickerMode(mode)
    setAiError('')
  }

  async function generateAiDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = aiPrompt.trim()
    if (!canEdit || storageMode !== 'cloud' || prompt.length < 3 || aiBusy) return
    const promptLimit = getAiPromptLimit(aiAppliedBrandContext, aiAttachments)
    if (prompt.length > promptLimit) {
      setAiError(`Reduza o pedido para ${promptLimit} caracteres antes de enviar com este kit.`)
      return
    }
    const requestPrompt = buildAiRequestPrompt(prompt, aiAppliedBrandContext, aiAttachments)
    setAiBusy(true)
    setAiError('')
    const priorConversation = aiConversation
    const baseConversation = aiConversation.at(-1)?.role === 'user' ? aiConversation.slice(0, -1) : aiConversation
    const pendingConversation: AiChatMessage[] = [...baseConversation, { role: 'user' as const, text: prompt, ...(aiAppliedBrandContext ? { brandKitName: aiAppliedBrandContext.kitName } : {}), ...(aiAttachments.length ? { attachmentNames: aiAttachments.map(item => item.name) } : {}) }].slice(-40)
    setAiConversation(pendingConversation)
    saveAiChat(documentId, pendingConversation)
    try {
      const generated = await generateRemoteText(documentId, requestPrompt)
      const completedConversation: AiChatMessage[] = [...pendingConversation, { role: 'assistant' as const, text: generated.text, mode: generated.mode }].slice(-40)
      setAiConversation(completedConversation)
      saveAiChat(documentId, completedConversation)
      setAiPrompt('')
    } catch (error) {
      setAiConversation(priorConversation)
      saveAiChat(documentId, priorConversation)
      setAiError(error instanceof Error ? error.message : 'Não foi possível gerar o texto.')
    } finally {
      setAiBusy(false)
    }
  }

  function closeAiChat() {
    setAiOpen(false)
    setAiPrompt('')
    setAiConversation([])
    setAiAddMenuOpen(false)
    setAiBrandContextOpen(false)
    setAiBrandContextDraftKitId(BRAND_KITS.find(kit => kit.id === state.document.brandKitId)?.id ?? 'default')
    setAiAppliedBrandContext(null)
    setAiAttachmentPickerMode(null)
    setAiAttachments([])
    setAiError('')
    try { sessionStorage.removeItem(getAiChatStorageKey(documentId)) } catch { /* The chat is cleared in memory even when session storage is unavailable. */ }
  }

  async function generateAiImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || storageMode !== 'cloud' || aiImagePrompt.trim().length < 3) return
    setAiImageBusy(true)
    setAiImageError('')
    setAiImagePreview(null)
    try {
      const response = await fetch('/api/ai/image', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId, prompt: aiImagePrompt.trim() }) })
      const payload = await response.json() as { error?: string; mimeType?: string; dataUrl?: string; width?: number; height?: number; mode?: 'sandbox' | 'openai-compatible' }
      if (!response.ok) throw new Error(payload.error || 'Não foi possível gerar a imagem.')
      if (!payload.dataUrl || !payload.mimeType || !payload.width || !payload.height || !payload.mode) throw new Error('O servidor retornou uma imagem inválida.')
      setAiImagePreview({ mimeType: payload.mimeType, dataUrl: payload.dataUrl, width: payload.width, height: payload.height, mode: payload.mode })
    } catch (error) {
      setAiImageError(error instanceof Error ? error.message : 'Não foi possível gerar a imagem.')
    } finally { setAiImageBusy(false) }
  }

  async function insertAiImage() {
    if (!aiImagePreview || !canEdit || storageMode !== 'cloud' || assetBusy) return
    setAssetBusy(true)
    setAiImageError('')
    try {
      const blob = await (await fetch(aiImagePreview.dataUrl)).blob()
      const asset: MediaAsset = {
        id: createId('ai-image'), name: 'Imagem gerada', mimeType: aiImagePreview.mimeType,
        width: aiImagePreview.width, height: aiImagePreview.height, src: aiImagePreview.dataUrl,
        fingerprint: await fingerprintImageUpload(blob), createdAt: createIsoTimestamp(),
      }
      const stored = await saveRemoteMediaAsset(documentId, asset)
      setAssets(current => [stored, ...current.filter(item => item.id !== stored.id)])
      addMediaAsset(stored)
      setAiImageOpen(false)
      setAiImagePreview(null)
    } catch (error) {
      setAiImageError(error instanceof Error ? error.message : 'Não foi possível inserir a imagem no projeto.')
    } finally { setAssetBusy(false) }
  }

  async function generateDreamLabImage(prompt: string): Promise<DreamLabImage> {
    if (!canEdit || storageMode !== 'cloud') throw new Error('A geração requer um projeto cloud editável.')
    const response = await fetch('/api/ai/image', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId, prompt }) })
    const payload = await response.json() as { error?: string; mimeType?: string; dataUrl?: string; width?: number; height?: number; mode?: 'sandbox' | 'openai-compatible' }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível gerar a imagem.')
    if (!payload.dataUrl || !payload.mimeType || !payload.width || !payload.height || !payload.mode) throw new Error('O servidor retornou uma imagem inválida.')
    return { dataUrl: payload.dataUrl, mimeType: payload.mimeType, width: payload.width, height: payload.height, mode: payload.mode }
  }

  async function insertDreamLabImage(image: DreamLabImage, prompt: string) {
    if (!canEdit || storageMode !== 'cloud' || assetBusy) return
    setAssetBusy(true)
    try {
      const blob = await (await fetch(image.dataUrl)).blob()
      const asset: MediaAsset = {
        id: createId('dream-lab-image'), name: prompt.trim().slice(0, 80) || 'Imagem Dream Lab', mimeType: image.mimeType,
        width: image.width, height: image.height, src: image.dataUrl,
        fingerprint: await fingerprintImageUpload(blob), createdAt: createIsoTimestamp(),
      }
      const stored = await saveRemoteMediaAsset(documentId, asset)
      setAssets(current => [stored, ...current.filter(item => item.id !== stored.id)])
      addMediaAsset(stored)
      setAiImageOpen(false)
      setAiImageDreamLabTab(false)
      setAiImagePreview(null)
    } catch (error) {
      setAiImageError(error instanceof Error ? error.message : 'Não foi possível inserir a imagem no projeto.')
    } finally { setAssetBusy(false) }
  }

  async function copyAiDraft() {
    try {
      await navigator.clipboard.writeText(aiText)
    } catch {
      setAiError('Não foi possível acessar a área de transferência neste navegador.')
    }
  }

  function insertAiDraft() {
    if (!aiText.trim() || !canEdit) return
    if (isDoc) {
      const id = createId('block')
      const block = { id, type: 'paragraph' as const, text: aiText.trim() }
      const afterBlockId = page.blocks?.at(-1)?.id ?? null
      change(document => updatePage(document, state.pageIndex, current => ({ ...current, blocks: [...(current.blocks ?? []), block] })))
      applyCollaborativeOperation(page.id, { type: 'doc.block.insert', block, afterBlockId })
    } else {
      const position = insertionPosition(480, 160, 160, 360)
      const element: DesignElement = { id: createId('text'), type: 'text', name: 'Texto gerado', ...position, width: 480, height: 160, rotation: 0, text: aiText.trim(), fontSize: 28, fontFamily: 'Arial', color: '#29263d', bold: false }
      addElement(element)
    }
    closeAiChat()
  }

  function jumpToComment(comment: RemoteComment) {
    if (comment.pageId) {
      const index = state.document.pages.findIndex(item => item.id === comment.pageId)
      if (index >= 0) navigateToPage(index)
    }
    dispatch({ type: 'select', id: comment.elementId })
    setCommentsOpen(false)
  }

  async function startPresentation() {
    let synchronizeWithTeam = false
    if (storageMode === 'cloud') {
      try {
        await sendRemotePresentationState(documentId, 0)
        synchronizeWithTeam = true
        setPermissionNotice('')
      } catch (error) {
        if (error instanceof StudioApiError && error.status === 409) {
          setPermissionNotice(error.message)
          return
        }
        setPermissionNotice('A apresentação será local nesta sessão porque a sincronização não está disponível.')
      }
    }
    setFollowingPresentationId(null)
    setLocalPresentationActive(synchronizeWithTeam)
    setPresentationPage(0)
    setPresentationOpen(true)
  }

  function changePresentationPage(index: number) {
    const nextIndex = clampPresentationPage(index, state.document.pages.length)
    setPresentationPage(nextIndex)
    if (localPresentationActive && storageMode === 'cloud') void sendRemotePresentationState(documentId, nextIndex).catch(error => {
      if (error instanceof StudioApiError && error.status === 409) {
        setLocalPresentationActive(false)
        setPresentationOpen(false)
        setPermissionNotice(error.message)
      }
    })
  }

  function stopPresentation() {
    if (localPresentationActive && storageMode === 'cloud') void sendRemotePresentationState(documentId, null).catch(() => {})
    setPresentationOpen(false)
    setLocalPresentationActive(false)
    setFollowingPresentationId(null)
  }

  function followRemotePresentation() {
    if (!remotePresentation) return
    setLocalPresentationActive(false)
    setFollowingPresentationId(remotePresentation.userId)
    setPresentationPage(remotePresentation.pageIndex)
    setPresentationOpen(true)
  }

  function addPage() {
    const newPage = createBlankDesignPage(state.document)
    change(document => ({ ...document, pages: [...document.pages, newPage], updatedAt: new Date().toISOString() }))
    const afterPageId = state.document.pages.at(-1)?.id
    if (afterPageId) applyCollaborativeOperation(afterPageId, { type: 'design.page.insert', page: newPage, afterPageId })
    navigateToPage(state.document.pages.length)
  }

  function addSheet() {
    if (state.document.type !== 'sheet' || state.document.pages.length >= 100) return
    let sheetNumber = state.document.pages.length + 1
    while (state.document.pages.some(sheet => sheet.name === `Planilha ${sheetNumber}`)) sheetNumber += 1
    const newPage: DesignPage = { ...createBlankDesignPage(state.document), name: `Planilha ${sheetNumber}`, cells: Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => '')) }
    const afterPageId = state.document.pages.at(-1)?.id
    change(document => ({ ...document, pages: [...document.pages, newPage], updatedAt: new Date().toISOString() }))
    if (afterPageId) applyCollaborativeOperation(afterPageId, { type: 'design.page.insert', page: newPage, afterPageId })
    navigateToPage(state.document.pages.length)
  }

  function renameCurrentSheet(name: string): boolean {
    const trimmed = name.trim()
    if (state.document.type !== 'sheet' || !trimmed || trimmed.length > 31 || /[\\/?*:[\]]/.test(trimmed) || trimmed.startsWith("'") || trimmed.endsWith("'") || state.document.pages.some((sheet, index) => index !== state.pageIndex && sheet.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return false
    const previousName = page.name
    const updatedPages = state.document.pages.map(sheet => {
      const originalCells = sheet.cells ?? []
      const cells = renameSheetReferences(originalCells, previousName, trimmed)
      if (cells === originalCells && sheet.id !== page.id) return sheet
      const updated = { ...sheet, ...(sheet.id === page.id ? { name: trimmed } : {}), ...(cells === originalCells ? {} : { cells }) }
      if (cells === originalCells) return updated
      const changedCells = cells.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) => value !== sheet.cells?.[rowIndex]?.[columnIndex] ? [{ row: rowIndex, column: columnIndex, value }] : []))
      for (let offset = 0; offset < changedCells.length; offset += 500) applyCollaborativeOperation(sheet.id, { type: 'sheet.cells.set', cells: changedCells.slice(offset, offset + 500) })
      return updated
    })
    change(document => ({ ...document, pages: updatedPages, updatedAt: new Date().toISOString() }))
    scheduleDesignPagePatch(page.id, { name: trimmed })
    return true
  }

  function duplicateCurrentPage() {
    const result = duplicateDesignPage(state.document, state.pageIndex)
    if (!result) return
    change(() => result.document)
    const duplicate = result.document.pages[result.pageIndex]
    if (duplicate && JSON.stringify(duplicate).length <= 200_000) applyCollaborativeOperation(page.id, { type: 'design.page.insert', page: duplicate, afterPageId: page.id, sourcePageId: page.id })
    navigateToPage(result.pageIndex)
  }

  function moveCurrentPage(targetIndex: number) {
    const result = moveDesignPage(state.document, state.pageIndex, targetIndex)
    if (!result) return
    change(() => result.document)
    applyCollaborativeOperation(page.id, { type: 'design.pages.reorder', pageIds: result.document.pages.map(item => item.id) })
    navigateToPage(result.pageIndex)
  }

  function deleteCurrentPage() {
    const result = deleteDesignPage(state.document, state.pageIndex)
    if (!result) return
    change(() => result.document)
    applyCollaborativeOperation(result.document.pages[result.pageIndex].id, { type: 'design.page.delete', targetPageId: page.id })
    navigateToPage(result.pageIndex)
  }

  function removeSelected() {
    if (!state.selectedIds.length) return
    const elementIds = [...state.selectedIds]
    change(document => updatePage(document, state.pageIndex, current => isWhiteboard
      ? removeWhiteboardElements(current, elementIds)
      : { ...current, elements: current.elements.filter(element => !elementIds.includes(element.id)) }))
    applyCollaborativeOperation(page.id, { type: 'design.elements.delete', elementIds })
    dispatch({ type: 'select', id: null })
  }

  function duplicateSelected() {
    if (!state.selectedIds.length) return
    const selectedSet = new Set(state.selectedIds)
    const originals = page.elements.filter(element => selectedSet.has(element.id))
    const duplicates = originals.map(element => ({ ...structuredClone(element), id: createId(element.type), name: `${element.name} — cópia`, x: element.x + 24, y: element.y + 24 } as DesignElement))
    const idMap = new Map(originals.map((element, index) => [element.id, duplicates[index].id]))
    const duplicateConnectors = (page.connectors ?? []).flatMap(connector => {
      const fromId = idMap.get(connector.fromId)
      const toId = idMap.get(connector.toId)
      return fromId && toId ? [{ ...connector, id: createId('connector'), fromId, toId }] : []
    })
    const duplicateGroups = (page.groups ?? []).flatMap(group => {
      const elementIds = group.elementIds.map(id => idMap.get(id))
      return elementIds.every((id): id is string => Boolean(id)) ? [{ ...group, id: createId('group'), name: `${group.name} — cópia`, elementIds }] : []
    })
    change(document => updatePage(document, state.pageIndex, current => ({
      ...current,
      elements: [...current.elements, ...duplicates],
      connectors: [...(current.connectors ?? []), ...duplicateConnectors],
      groups: [...(current.groups ?? []), ...duplicateGroups],
    })))
    if (JSON.stringify({ elements: duplicates, groups: duplicateGroups, connectors: duplicateConnectors }).length <= 200_000) {
      applyCollaborativeOperation(page.id, { type: 'design.elements.create', elements: duplicates, groups: duplicateGroups, connectors: duplicateConnectors })
    }
    dispatch({ type: 'select', id: duplicates.at(-1)?.id ?? null, ids: duplicates.map(element => element.id) })
  }

  function moveLayer(direction: 'forward' | 'backward') {
    if (!selected) return
    const index = page.elements.findIndex(element => element.id === selected.id)
    const target = direction === 'forward' ? index + 1 : index - 1
    if (index < 0 || target < 0 || target >= page.elements.length) return
    const elements = [...page.elements]
    ;[elements[index], elements[target]] = [elements[target], elements[index]]
    const elementIds = elements.map(element => element.id)
    change(document => updatePage(document, state.pageIndex, current => ({ ...current, elements: elementIds.map(id => current.elements.find(element => element.id === id)).filter((element): element is DesignElement => Boolean(element)) })))
    applyCollaborativeOperation(page.id, { type: 'design.elements.reorder', elementIds })
  }

  function moveSelectedLayerToEdge(edge: 'back' | 'front') {
    if (!isWhiteboard || !selected || !canEdit) return
    const elements = moveWhiteboardElementToEdge(page.elements, selected.id, edge)
    if (elements === page.elements) return
    const elementIds = elements.map(element => element.id)
    change(document => updatePage(document, state.pageIndex, current => ({ ...current, elements })))
    applyCollaborativeOperation(page.id, { type: 'design.elements.reorder', elementIds })
  }

  useEffect(() => {
    selectionCommandsRef.current = { duplicate: duplicateSelected, remove: removeSelected, move: moveSelectionBy }
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target
      const isSheetCell = target instanceof HTMLElement && Boolean(target.closest('.sheet-grid'))
      const isEditingText = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )
      // A selected spreadsheet cell is the editor surface itself: keep global
      // undo/redo active there so Ctrl+Z reverts the committed cell operation.
      if (isEditingText && !isSheetCell) return

      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setSaveStatus('saving')
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        setSaveStatus('saving')
        dispatch({ type: 'redo' })
        return
      }
      if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        selectionCommandsRef.current.duplicate()
        return
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && state.selectedIds.length) {
        event.preventDefault()
        selectionCommandsRef.current.remove()
        return
      }
      if (state.selectedIds.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0
        const dy = event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0
        selectionCommandsRef.current.move(dx, dy)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.selectedIds])

  if (!ready) return <main className="editor-loading" role="status">Abrindo projeto…</main>
  if (loadError) return <main className="editor-load-error"><div><span><CircleAlert size={24} aria-hidden="true" /></span><h1>Não foi possível abrir</h1><p>{loadError}</p><button type="button" onClick={() => { setLoadError(''); setReady(false); setLoadAttempt(attempt => attempt + 1) }}>Tentar novamente</button><button type="button" onClick={() => onExit()}>Voltar aos projetos</button></div></main>

  return <main className="studio-app">
    <header className="topbar">
      <button className="brand" type="button" onClick={() => void saveAndExit()} aria-label="Salvar e voltar aos projetos"><span className="brand-mark">f</span><span className="brand-name">fuse<span>studio</span></span></button>
      <div className="document-title">
        <input aria-label={isDoc ? 'Nome do documento' : isSite ? 'Nome do site' : isVideo ? 'Nome do vídeo' : 'Nome do design'} value={state.document.name} disabled={!canEdit} onChange={event => change(document => ({ ...document, name: event.target.value, updatedAt: new Date().toISOString() }))} />
        <span className={`save-state ${saveStatus}`}><i />{!canEdit ? 'Somente leitura' : saveStatus === 'saving' ? 'Salvando' : saveStatus === 'error' ? 'Falha ao salvar' : storageMode === 'cloud' ? 'Salvo na nuvem' : 'Salvo neste dispositivo'}</span>
      </div>
      <div className="top-actions">
      <button className="icon-button" aria-label="Desfazer" title="Desfazer" disabled={!state.undoStack.length} onClick={() => { setSaveStatus('saving'); dispatch({ type: 'undo' }) }}><Undo2 size={17} /></button>
      <button className="icon-button" aria-label="Refazer" title="Refazer" disabled={!state.redoStack.length} onClick={() => { setSaveStatus('saving'); dispatch({ type: 'redo' }) }}><Redo2 size={17} /></button>
      {storageMode === 'cloud' && <button className="icon-button history-button" aria-label="Histórico de versões" title="Histórico de versões" disabled={!canEdit} onClick={() => void openVersionHistory()}><History size={17} /></button>}
        <span className="avatar" aria-label="Você">V</span>
        {storageMode === 'cloud' && <div className={`realtime-presence ${realtimeStatus}`} aria-label={realtimeStatus === 'connected' ? `${presence.length} participantes conectados` : realtimeStatus === 'reconnecting' ? 'Reconectando colaboração' : realtimeStatus === 'offline' ? 'Colaboração desconectada' : 'Conectando colaboração'} title={presence.map(user => `${user.name}${user.connections > 1 ? ` (${user.connections} abas)` : ''}`).join(', ') || 'Nenhum participante conectado'}>
          <span className="realtime-indicator" aria-hidden="true" />
          <span>{realtimeStatus === 'connected' ? `${presence.length} online` : realtimeStatus === 'reconnecting' ? 'Reconectando' : realtimeStatus === 'offline' ? 'Offline' : 'Conectando'}</span>
          <span className="presence-avatars" aria-hidden="true">{presence.slice(0, 4).map(user => <i key={user.id} title={user.name}>{user.name.trim().charAt(0).toLocaleUpperCase() || '?'}</i>)}{presence.length > 4 && <i>+{presence.length - 4}</i>}</span>
        </div>}
        <button className="share-button" type="button" title={storageMode === 'cloud' ? 'Gerenciar acesso ao projeto' : 'Compartilhamento na nuvem'} disabled={storageMode !== 'cloud' || remoteRole !== 'owner'} onClick={onShare}>Compartilhar</button>
        <button className="comment-button" type="button" disabled={storageMode !== 'cloud'} onClick={() => void openComments()}>Comentários{comments.length ? ` - ${comments.length}` : ''}</button>
        <button className="comment-button ai-button" type="button" disabled={!canEdit || storageMode !== 'cloud' || isSheet} title={storageMode !== 'cloud' ? 'A conversa de IA requer um projeto cloud editável' : undefined} onClick={() => { setAiError(''); setAiOpen(true) }}>IA para texto</button>
        <button className="comment-button ai-button" type="button" disabled={!canEdit || storageMode !== 'cloud' || isDoc || isSheet || isVideo} title={storageMode !== 'cloud' ? 'A geração requer um projeto cloud editável' : 'Gerar imagem'} onClick={() => { setAiImageError(''); setAiImageDreamLabTab(false); setAiImageOpen(true) }}>Gerar imagem</button>
        {state.document.type === 'presentation' && <button className="present-notes-button" type="button" onClick={() => setPresenterNotesOpen(true)}>Notas</button>}
        {remotePresentation && !presentationOpen && <button className="remote-presentation-button" type="button" onClick={followRemotePresentation}>Seguir {remotePresentation.name} - slide {remotePresentation.pageIndex + 1}</button>}
        {state.document.type === 'presentation' && <button className="present-button" type="button" onClick={startPresentation}>Apresentar</button>}
        {isSite && <button className="present-button site-preview-open" type="button" onClick={() => setSitePreviewOpen(true)}>Pré-visualizar site</button>}
        {isSite && <button className="present-button site-publish-open" type="button" disabled={storageMode !== 'cloud' || remoteRole !== 'owner'} title={storageMode !== 'cloud' ? 'Salve este site na nuvem para publicar.' : remoteRole !== 'owner' ? 'Somente quem administra este site pode publicá-lo.' : 'Publicar uma versão das seções visíveis.'} onClick={() => setSitePublicationOpen(true)}><Globe size={14} aria-hidden="true" />Publicar site</button>}
        {!isDoc && !isSheet && !isVideo && <button className="comment-button print-sandbox-trigger" type="button" onClick={() => window.dispatchEvent(new Event('fuse:open-print-sandbox'))}>Gráfica - cartões</button>}
        {!isSheet && exportFormat === 'pdf' && <button className="export-option" aria-expanded={pdfAdvancedOpen} disabled={exportBusy} onClick={() => setPdfAdvancedOpen(open => !open)}>Configurações avançadas</button>}
        <button className="export-button" disabled={exportBusy} aria-busy={exportBusy} aria-keyshortcuts="Enter Space" aria-describedby={exportError ? 'export-error' : exportStatus ? 'export-status' : undefined} onClick={() => void exportDesign()}><Download size={15} aria-hidden="true" /> {exportBusy ? 'Exportando…' : exportError ? 'Tentar novamente' : `Exportar ${isSheet ? exportFormat === 'xlsx' ? 'XLSX' : 'CSV' : exportFormat === 'pdf' || exportFormat === 'csv' || exportFormat === 'xlsx' || (exportFormat === 'docx' && !isDoc) ? 'PDF' : exportFormat.toUpperCase()}`}</button>
        <select className="export-format" aria-label="Formato de exportação" value={isSheet ? exportFormat === 'xlsx' ? 'xlsx' : 'csv' : exportFormat === 'csv' || exportFormat === 'xlsx' || (exportFormat === 'docx' && !isDoc) ? 'pdf' : exportFormat} onChange={event => { setExportError(''); setExportStatus(''); setExportFormat(event.target.value as 'pdf' | 'png' | 'jpeg' | 'svg' | 'pptx' | 'webm' | 'mp4' | 'gif' | 'csv' | 'xlsx' | 'docx') }} disabled={exportBusy}>
          {isSheet ? <><option value="csv">CSV - aba atual</option><option value="xlsx">XLSX - todas as abas</option></> : <><option value="pdf">PDF - todas as páginas</option>{isDoc && <option value="docx">DOCX - documento editável</option>}<option value="png">PNG - página atual</option><option value="jpeg">JPG - página atual</option><option value="svg">SVG - pagina atual</option>{state.document.type === 'presentation' && <option value="pptx">PPTX - toda a apresentação</option>}{(isVideo || hasAnimatedImages) && <option value="gif">GIF - animação até 10 s - 10 fps, sem áudio</option>}{(isVideo || hasAnimatedImages) && <option value="webm">{isVideo ? 'WebM - vídeo completo' : 'WebM - animação 5 s - até 30 fps'}</option>}{(isVideo || hasAnimatedImages) && <option value="mp4" disabled={!mp4ExportSupported}>{mp4ExportSupported ? (isVideo ? 'MP4 - vídeo completo' : 'MP4 - animação 5 s - até 30 fps') : 'MP4 - indisponível neste navegador'}</option>}</>}
        </select>
        {!isSheet && (exportFormat === 'png' || exportFormat === 'jpeg') && <select className="export-option" aria-label="Tamanho da imagem" value={exportImageScale} disabled={exportBusy} onChange={event => setExportImageScale(Number(event.target.value) as 1 | 2 | 3)}><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></select>}
        {!isSheet && exportFormat === 'pdf' && pdfAdvancedOpen && <section className="pdf-advanced-settings" aria-label="Configurações avançadas do PDF">
          <label>Predefinição <select aria-label="Predefinição PDF" value="digital" disabled><option value="digital">Digital</option></select></label>
          <label>Páginas <select aria-label="Páginas PDF" value="all" disabled><option value="all">Todas as páginas</option></select></label>
          <label><input type="checkbox" checked={pdfCompact} disabled={exportBusy} onChange={event => setPdfCompact(event.target.checked)} /> Compactar PDF</label>
          <label title="Indisponível neste exportador"><input type="checkbox" disabled /> Baixar páginas como arquivos separados</label>
          <label title="Indisponível: o PDF é composto por páginas raster"><input type="checkbox" disabled /> Achatar PDF</label>
          <label title="O renderer não exporta notas"><input type="checkbox" disabled /> Incluir notas</label>
          <label title="O renderer não preserva ordem de leitura semântica"><input type="checkbox" disabled /> Manter a ordem de leitura das camadas</label>
          <label><input type="checkbox" checked={pdfPasswordEnabled} disabled={exportBusy} onChange={event => {
            const enabled = event.target.checked
            setPdfPasswordEnabled(enabled)
            setPdfPassword(enabled ? Array.from(crypto.getRandomValues(new Uint8Array(16)), value => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[value % 57]).join('') : '')
            setPdfPasswordCopied(false)
          }} /> Proteção por senha</label>
          {pdfPasswordEnabled && <div className="pdf-password-controls"><input aria-label="Senha sugerida" readOnly value={pdfPassword} /><span role="status">Senha forte</span><button type="button" onClick={() => { void navigator.clipboard?.writeText(pdfPassword).then(() => setPdfPasswordCopied(true)).catch(() => setExportError('Não foi possível copiar a senha neste navegador.')) }}>Copiar senha</button>{pdfPasswordCopied && <span role="status">Copiada</span>}<p>Exportação bloqueada enquanto a proteção estiver ativada: criptografia de PDF não está implementada.</p></div>}
          <label><input type="checkbox" disabled /> Salvar configurações de download</label>
        </section>}
        {!isDoc && !isSheet && !isVideo && exportFormat === 'png' && <select className="export-option" aria-label="Fundo PNG" value={exportPngBackground} disabled={exportBusy} onChange={event => setExportPngBackground(event.target.value as 'opaque' | 'transparent')}><option value="opaque">Fundo original</option><option value="transparent">Transparente</option></select>}
        {!isSheet && exportFormat === 'jpeg' && <select className="export-option" aria-label="Qualidade JPEG" value={exportJpegQuality} disabled={exportBusy} onChange={event => setExportJpegQuality(event.target.value as 'low' | 'medium' | 'high')}><option value="low">Qualidade baixa</option><option value="medium">Qualidade média</option><option value="high">Qualidade alta</option></select>}
        {exportError && <span id="export-error" className="export-error" role="alert">{exportError}</span>}
        {!exportError && exportStatus && <span id="export-status" className="export-progress" role="status" aria-live="polite" aria-atomic="true">{exportStatus}</span>}
        {permissionNotice && <span className="permission-notice" role="status">{permissionNotice}</span>}
        {permissionNotice && <button className="permission-copy" onClick={() => void saveConflictAsLocalCopy()}>Salvar cópia local</button>}
      </div>
    </header>

    <PrintSandboxHost documentId={documentId} />
    <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/*" onChange={event => void handleImageFile(event)} aria-label="Enviar imagem para a biblioteca" />
    <input ref={timelineMediaInputRef} className="visually-hidden" type="file" accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,audio/flac,audio/aac" onChange={event => void handleTimelineMediaFile(event)} aria-label="Adicionar vídeo ou áudio à timeline" />

    <section className={`editor-layout ${state.document.type === 'design' ? 'design-canvas-layout' : ''} ${isDoc ? 'doc-layout' : ''} ${isSheet ? 'sheet-layout' : ''} ${imageEditPanelOpen && selected?.type === 'image' ? 'image-edit-mode' : ''}`}>
      {isDoc ? <DocumentEditorPanel document={state.document} pageIndex={state.pageIndex} canEdit={canEdit} change={change} onRecordUndo={() => dispatch({ type: 'record-undo' })} onPageChange={navigateToPage} onAddPage={addPage} onDuplicatePage={duplicateCurrentPage} onMovePage={moveCurrentPage} onDeletePage={deleteCurrentPage} presence={presence} currentUserId={currentUserId} onSelection={publishDocumentSelection} onTableCellOperation={storageMode === 'cloud' ? applyCollaborativeOperation : undefined} onBlockTextOperation={storageMode === 'cloud' ? applyCollaborativeOperation : undefined} onBlockStructureOperation={storageMode === 'cloud' ? applyCollaborativeOperation : undefined} /> : isSheet ? <SpreadsheetEditorPanel key={page.id} page={page} pageIndex={state.pageIndex} pages={state.document.pages} canEdit={canEdit} change={change} onSheetOperation={storageMode === 'cloud' ? applyCollaborativeOperation : undefined} onSelectSheet={navigateToPage} onAddSheet={addSheet} onDeleteSheet={deleteCurrentPage} onRenameSheet={renameCurrentSheet} /> : <>
      <aside className="tools-panel" aria-label="Ferramentas do editor">
        <div className="panel-kicker">CRIAR</div>
        <div className={`editor-tools-entry${editorToolsOpen ? ' mobile-open' : ''}`}>
          <div role="tablist" aria-label="Painéis do editor">
            <button ref={editorToolsTriggerRef} type="button" role="tab" id="editor-tools-tab" aria-controls="editor-tools-panel" aria-selected={editorToolsOpen} className={`tool-button editor-tools-tab${editorToolsOpen ? ' active' : ''}`} onClick={() => setEditorToolsOpen(open => !open)}>
              <span className="tool-icon"><Shapes size={19} aria-hidden="true" /></span><span>Ferramentas</span>
            </button>
          </div>
          {editorToolsOpen && <section id="editor-tools-panel" role="tabpanel" aria-labelledby={viewport.width <= 760 ? 'mobile-editor-tools-trigger' : 'editor-tools-tab'} className="editor-tools-subpanel">
            <header><strong>Ferramentas</strong><button type="button" aria-label="Fechar" title="Fechar" onClick={() => { setEditorToolsOpen(false); (window.matchMedia('(max-width: 760px)').matches ? mobileEditorToolsTriggerRef.current : editorToolsTriggerRef.current)?.focus() }}><X size={16} aria-hidden="true" /></button></header>
            <div className="editor-tools-inventory">
              <button type="button" aria-label="Selecionar" title="Selecionar" aria-pressed={editorTool === 'select'} onClick={() => { setEditorTool('select'); setWhiteboardTool('select') }}><MousePointer2 size={17} aria-hidden="true" />Selecionar</button>
              <button type="button" aria-label="Desenho" title="Desenho" aria-pressed={editorTool === 'drawing'} aria-expanded={editorTool === 'drawing'} onClick={() => setEditorTool(tool => tool === 'drawing' ? 'select' : 'drawing')}><Pencil size={17} aria-hidden="true" />Desenho</button>
              <button type="button" aria-label="Formas" title="Formas" aria-pressed={editorTool === 'shapes'} onClick={() => { setEditorTool('shapes'); addShape('rect') }}><Shapes size={17} aria-hidden="true" />Formas</button>
              <button type="button" aria-label="Linhas" title="Linhas" aria-pressed={editorTool === 'lines'} onClick={() => { setEditorTool('lines'); addShape('line') }}><Minus size={17} aria-hidden="true" />Linhas</button>
              <button type="button" aria-label="Notas autoadesivas" title="Notas autoadesivas" aria-pressed={editorTool === 'sticky'} onClick={() => { setEditorTool('sticky'); addStickyNote() }}><Sticker size={17} aria-hidden="true" />Notas autoadesivas</button>
              <button type="button" aria-label="Texto" title="Texto" aria-pressed={editorTool === 'text'} onClick={() => { setEditorTool('text'); addText() }}><Type size={17} aria-hidden="true" />Texto</button>
              <button type="button" aria-label="Assinatura" title="Assinatura" aria-pressed={editorTool === 'signature'} onClick={() => setEditorTool('signature')}><PenTool size={17} aria-hidden="true" />Assinatura</button>
              <button type="button" aria-label="Tabelas" title="Tabelas" aria-pressed={editorTool === 'tables'} onClick={() => setEditorTool('tables')}><Table2 size={17} aria-hidden="true" />Tabelas</button>
            </div>
            {editorTool === 'drawing' && <section className="drawing-subtools" aria-label="Opções de Desenho">
              <div role="group" aria-label="Implemento de desenho">
                <button type="button" aria-pressed={drawingImplement === 'Lápis'} onClick={() => setDrawingImplement('Lápis')}><Pencil size={16} aria-hidden="true" />Lápis</button>
                <button type="button" aria-pressed={drawingImplement === 'Caneta'} onClick={() => setDrawingImplement('Caneta')}><PenLine size={16} aria-hidden="true" />Caneta</button>
                <button type="button" aria-pressed={drawingImplement === 'Marcador'} onClick={() => setDrawingImplement('Marcador')}><Highlighter size={16} aria-hidden="true" />Marcador</button>
                <button type="button" aria-pressed={drawingImplement === 'Borracha'} onClick={() => setDrawingImplement('Borracha')}><Eraser size={16} aria-hidden="true" />Borracha</button>
              </div>
              <button className="drawing-color-control" type="button" aria-label={`Cor do traço ${drawingColor}`} title={`Cor do traço ${drawingColor}`} onClick={() => { const input = drawingColorInputRef.current; if (!input) return; try { input.showPicker() } catch { input.click() } }}><span aria-hidden="true" style={{ '--drawing-color': drawingColor } as CSSProperties} />Cor <code>{drawingColor}</code></button>
              <input ref={drawingColorInputRef} className="drawing-color-input" type="color" aria-label="Selecionar cor do traço" value={drawingColor} onChange={event => setDrawingColor(event.target.value)} />
              <button className="drawing-settings-control" type="button" aria-label="Configurações" aria-expanded={drawingSettingsOpen} onClick={() => setDrawingSettingsOpen(open => !open)}><Settings2 size={16} aria-hidden="true" />Configurações</button>
              {drawingSettingsOpen && <div className="drawing-settings-panel"><label htmlFor="drawing-size">Espessura <output>{drawingSize}</output><input id="drawing-size" type="range" min="1" max="20" step="1" value={drawingSize} onChange={event => setDrawingSize(Number(event.target.value))} /></label></div>}
            </section>}
          </section>}
        </div>
        {isWhiteboard ? <WhiteboardToolDock activeTool={whiteboardTool} disabled={!canEdit} onActivate={tool => {
          setWhiteboardTool(tool)
          setConnectorStartId(null)
          setConnectorStartAnchor(undefined)
          if (tool !== 'select') setSelectedConnectorId(null)
          if (tool !== 'select') dispatch({ type: 'select', id: null })
        }} /> : <button className={`tool-button ${whiteboardTool === 'select' ? 'active' : ''}`} aria-label="Selecionar" aria-pressed={whiteboardTool === 'select'} title="Selecionar" onClick={() => setWhiteboardTool('select')}><span className="tool-icon"><MousePointer2 size={19} aria-hidden="true" /></span><span>Selecionar</span></button>}
        {isWhiteboard && whiteboardTool === 'connector' && <p className="connector-hint" role="status">{connectorStartId ? 'Clique perto do ponto da borda onde o conector deve terminar.' : 'Clique no primeiro objeto, perto do ponto da borda onde o conector deve começar.'}</p>}
        {isWhiteboard && <button className={`tool-button ${multiSelectMode ? 'active' : ''}`} aria-pressed={multiSelectMode} onClick={toggleMultipleSelection} title="Selecionar vários objetos"><span className="tool-icon"><LayoutGrid size={19} aria-hidden="true" /></span><span>Seleção múltipla</span></button>}
        <button className="tool-button" onClick={addText} disabled={!canEdit}><span className="tool-icon text-icon"><Type size={19} aria-hidden="true" /></span><span>Texto</span></button>
        <button className={`tool-button ${brandKitOpen ? 'active' : ''}`} type="button" aria-expanded={brandKitOpen} onClick={() => setBrandKitOpen(open => !open)}><span className="tool-icon"><Aperture size={19} aria-hidden="true" /></span><span>Marca</span></button>
        {!isDoc && !isSheet && !isVideo && <button className={`tool-button ${bulkCreateOpen ? 'active' : ''}`} type="button" aria-haspopup="dialog" aria-expanded={bulkCreateOpen} onClick={() => setBulkCreateOpen(true)} disabled={!canEdit}><span className="tool-icon"><Copy size={19} aria-hidden="true" /></span><span>Criar em lote</span></button>}
        {bulkCreateOpen && <BulkCreatePanel page={page} onClose={() => setBulkCreateOpen(false)} onGenerate={appendBulkGeneratedPages} onGenerateIndividual={pages => onCreateBulkProjects(state.document, pages, remoteTeamId)} />}
        {brandKitOpen && <section className="brand-kit-panel" aria-label="Kit de marca">
          <header className="brand-kit-header"><div><span className="panel-kicker">IDENTIDADE</span><strong>Kit de marca</strong></div><button type="button" aria-label="Fechar kit de marca" onClick={() => setBrandKitOpen(false)}><X size={16} aria-hidden="true" /></button></header>
          {(state.document.brandKitId ?? 'default') === 'rea-laboratory' && <>
            <button type="button" className="brand-assistant-open" aria-expanded={brandAssistantOpen} onClick={() => setBrandAssistantOpen(open => !open)}>{brandAssistantOpen ? 'Fechar revisão da marca' : 'Revisar design'}</button>
            {brandAssistantOpen && <BrandAssistantReview elements={page.elements} canEdit={canEdit} onApply={applyBrandReview} pageLabel={page.name + ' (p\u00e1gina atual)'} />}
          </>}
          <div className="brand-kit-selector-wrap">
            <button type="button" className="brand-kit-selector" aria-haspopup="listbox" aria-expanded={brandKitMenuOpen} onClick={() => setBrandKitMenuOpen(open => !open)}>
              <span><small>Kit selecionado</small><strong>{BRAND_KITS.find(kit => kit.id === (state.document.brandKitId ?? 'default'))?.name ?? BRAND_KITS[0].name}</strong></span><ChevronDown size={15} aria-hidden="true" />
            </button>
            {brandKitMenuOpen && <div className="brand-kit-menu" role="listbox" aria-label="Kits de marca disponíveis">{BRAND_KITS.map(kit => <button key={kit.id} type="button" role="option" aria-selected={(state.document.brandKitId ?? 'default') === kit.id} onClick={() => { change(document => ({ ...document, brandKitId: kit.id, updatedAt: new Date().toISOString() })); setBrandKitMenuOpen(false); setBrandResourceCategory('Cores') }}>{kit.name}{kit.id === 'rea-laboratory' && <small>Laboratório auditado</small>}</button>)}</div>}
          </div>
          <div className="brand-kit-categories" role="tablist" aria-label="Categorias do kit de marca">{(BRAND_KITS.find(kit => kit.id === (state.document.brandKitId ?? 'default')) ?? BRAND_KITS[0]).resources.map(category => <button key={category} type="button" role="tab" aria-selected={brandResourceCategory === category} className={brandResourceCategory === category ? 'selected' : ''} onClick={() => setBrandResourceCategory(category)}>{category}</button>)}</div>
          {(state.document.brandKitId ?? 'default') === 'rea-laboratory' && brandResourceCategory === 'Cores' ? <div className="brand-kit-content"><p className="brand-kit-observation">Paleta do laboratório</p><button type="button" className="brand-palette-card" onClick={applyBrandPalette} disabled={!canEdit}><span className="brand-palette-swatches"><i style={{ background: '#123456' }} /><i style={{ background: '#2d4a6f' }} /><i style={{ background: '#b29365' }} /></span><span><strong>Paleta de cores</strong><small>Aplicar às cores mapeadas do design</small></span><span className="brand-palette-apply">Aplicar</span></button><p className="brand-kit-footnote">Mapeamentos observados em um design de laboratório. Identidade e geometria dos elementos são preservadas.</p></div> : (state.document.brandKitId ?? 'default') === 'rea-laboratory' && brandResourceCategory === 'Fontes' ? <div className="brand-kit-content"><p className="brand-kit-observation">Estilos de texto</p><button type="button" className="brand-type-style" onClick={insertBrandTitle} disabled={!canEdit}><span className="brand-type-preview">Aa</span><span><strong>Título da marca</strong><small>{state.selectedIds.some(id => page.elements.some(element => element.id === id && element.type === 'text')) ? 'Aplicar ao texto selecionado - negrito - 32 pt' : 'Inserir titulo - negrito - 32 pt'}</small></span><Plus size={16} aria-hidden="true" /></button><p className="brand-kit-footnote">Com texto selecionado, aplica o estilo preservando conteudo e geometria; sem texto selecionado, insere um novo elemento.</p></div> : <div className="brand-kit-empty"><span className="brand-kit-empty-mark"><Aperture size={20} aria-hidden="true" /></span><strong>{brandResourceCategory === 'Logotipos' || brandResourceCategory === 'Modelos' ? `Nenhum ${brandResourceCategory.toLocaleLowerCase('pt-BR')} salvo` : `Nenhum recurso de ${brandResourceCategory.toLocaleLowerCase('pt-BR')} disponível`}</strong><p>Este kit de laboratório não expõe recursos adicionais nesta categoria.</p></div>}
        </section>}
        {isWhiteboard && <button className="tool-button" onClick={addStickyNote} disabled={!canEdit}><span className="tool-icon sticky-note-icon"><Sticker size={19} aria-hidden="true" /></span><span>Nota adesiva</span></button>}
        <div className="shape-tools" role="group" aria-label="Inserir formas vetoriais"><span className="shape-tools-label">Formas</span><div>{VECTOR_SHAPES.map(shape => { const ShapeIcon = VECTOR_SHAPE_ICONS[shape]; return <button key={shape} type="button" aria-label={`Inserir ${VECTOR_SHAPE_LABELS[shape]}`} title={VECTOR_SHAPE_LABELS[shape]} onClick={() => addShape(shape)} disabled={!canEdit}><ShapeIcon size={18} strokeWidth={1.8} aria-hidden="true" /></button> })}</div></div>
        <button className={`tool-button ${assetPanelOpen ? 'active' : ''}`} onClick={() => setAssetPanelOpen(open => !open)} aria-expanded={assetPanelOpen} disabled={!canEdit}><span className="tool-icon"><ImageIcon size={19} aria-hidden="true" /></span><span>Uploads</span></button>
        <button ref={accessibilityTriggerRef} className={`tool-button ${accessibilityOpen ? 'active' : ''}`} type="button" aria-haspopup="dialog" aria-expanded={accessibilityOpen} onClick={() => { setAccessibilityOpen(true); setAccessibilitySelectedIssues([]); setAccessibilityAltDrafts({}); setAccessibilityBatchAltOpen(false); setAccessibilityFilter('all') }}><span className="tool-icon"><Accessibility size={19} aria-hidden="true" /></span><span>Acessibilidade</span>{accessibilityIssues.length > 0 && <span className="accessibility-tool-count" aria-label={`${accessibilityIssues.length} itens para revisar`}>{accessibilityIssues.length}</span>}</button>
        {state.document.type === 'presentation' && <>
          <div className="tools-separator" />
          <div className="presentation-slide-heading"><span className="panel-kicker">SLIDES - {state.document.pages.length}</span><button type="button" onClick={addPage} disabled={!canEdit} aria-label="Adicionar slide"><Plus size={15} aria-hidden="true" /></button></div>
          <div className="presentation-slide-list" aria-label="Navegação de slides">
            {state.document.pages.map((slide, index) => <PresentationSlideThumbnail key={slide.id} document={state.document} pageIndex={index} active={index === state.pageIndex} onClick={() => navigateToPage(index)} />)}
          </div>
        </>}
        <div className="tools-separator" />
        {!isDoc && !isSheet && <label className="page-background-control">Fundo da página<input type="color" aria-label="Cor de fundo da página" value={/^#[0-9a-f]{6}$/i.test(page.background) ? page.background : '#ffffff'} disabled={!canEdit} onChange={event => { const background = event.target.value; change(document => updatePage(document, state.pageIndex, current => ({ ...current, background }))); scheduleDesignPagePatch(page.id, { background }) }} /></label>}
        <div className="panel-kicker">{state.document.type === 'presentation' ? 'ELEMENTOS DO SLIDE' : isWhiteboard ? 'ELEMENTOS DO QUADRO' : 'CAMADAS'}</div>
        <div className="layers-list">
          <AccessibleCanvasObjectList
            label="Camadas da página"
            items={[
              ...layerNames.map(toAccessibleCanvasObject),
              ...(page.connectors ?? []).map((connector, index) => ({ id: connector.id, name: `Conector ${index + 1}`, kind: 'connector' as const, ariaLabel: `Selecionar conector ${index + 1}` })),
            ]}
            selectedIds={[...state.selectedIds, ...(selectedConnectorId ? [selectedConnectorId] : [])]}
            accessibilityTargetId={accessibilityTargetId}
            onActivate={(id, additive) => {
              if (page.connectors?.some(connector => connector.id === id)) { setSelectedConnectorId(id); dispatch({ type: 'select', id: null }); return }
              handleCanvasElementClick(id, additive)
            }}
            emptyMessage="Sua página está vazia."
          />
        </div>
        {state.document.type !== 'presentation' && <button className="add-page" onClick={addPage}><span><Plus size={14} aria-hidden="true" /></span> {isWhiteboard ? 'Adicionar quadro' : isSite ? 'Adicionar seção' : 'Adicionar página'}</button>}
      </aside>

      <section className="canvas-workspace" aria-label="Área de edição" data-connector-count={isWhiteboard ? page.connectors?.length ?? 0 : undefined}>
        <span className="visually-hidden" role="status" aria-live="polite">{accessibilityTargetId ? `Revisão de acessibilidade: ${page.elements.find(element => element.id === accessibilityTargetId)?.name ?? 'elemento'} selecionado na página ${state.pageIndex + 1}.` : ''}</span>
        <div className="workspace-label"><div><span className="canvas-dot" />{state.document.type === 'presentation' ? <input className="slide-name-field" aria-label="Nome do slide" value={page.name} disabled={!canEdit} onChange={event => { const name = event.target.value; change(document => updatePage(document, state.pageIndex, current => ({ ...current, name }))); scheduleDesignPagePatch(page.id, { name }) }} /> : isWhiteboard ? <input className="slide-name-field" aria-label="Nome do quadro" value={page.name} disabled={!canEdit} onChange={event => { const name = event.target.value; change(document => updatePage(document, state.pageIndex, current => ({ ...current, name }))); scheduleDesignPagePatch(page.id, { name }) }} /> : isSite ? <input className="slide-name-field" aria-label="Nome da seção" value={page.name} disabled={!canEdit} onChange={event => { const name = event.target.value; change(document => updatePage(document, state.pageIndex, current => ({ ...current, name }))); scheduleDesignPagePatch(page.id, { name }) }} /> : isVideo ? <input className="slide-name-field" aria-label="Nome da cena" value={page.name} disabled={!canEdit} onChange={event => { const name = event.target.value; change(document => updatePage(document, state.pageIndex, current => ({ ...current, name }))); scheduleDesignPagePatch(page.id, { name }) }} /> : <>Página {state.pageIndex + 1}</>} <span className="muted-dot">·</span> {state.document.width} × {state.document.height}</div>{isWhiteboard ? <div className="whiteboard-zoom-controls" aria-label="Controles de zoom"><button onClick={() => zoomWhiteboard(whiteboardZoom / 1.2)} aria-label="Diminuir zoom"><Minus size={14} aria-hidden="true" /></button><span>{Math.round(scale * 100)}%</span><button onClick={() => zoomWhiteboard(whiteboardZoom * 1.2)} aria-label="Aumentar zoom"><Plus size={14} aria-hidden="true" /></button><button className="whiteboard-fit" onClick={fitWhiteboard}><Maximize size={14} aria-hidden="true" /> Enquadrar</button></div> : <div className="editor-zoom"><button ref={editorZoomTriggerRef} type="button" className="zoom-label" role="combobox" aria-label="Op??es de zoom" aria-haspopup="listbox" aria-expanded={editorZoomMenuOpen} aria-controls="editor-zoom-options" aria-valuetext={`${Math.round(displayedZoom)}%`} onClick={() => setEditorZoomMenuOpen(open => !open)}>{getEditorZoomDisplayValue(createEditorZoomState(displayedZoom, editorZoom.mode))}<ChevronDown size={12} aria-hidden="true" /></button>{editorZoomMenuOpen && <div ref={editorZoomMenuRef} id="editor-zoom-options" className="editor-zoom-menu" role="listbox" aria-label="Op??es de zoom" onKeyDown={handleEditorZoomMenuKeyDown}>{EDITOR_ZOOM_OPTIONS.map(option => <button key={option.id} type="button" role="option" aria-selected={isEditorZoomOptionSelected(editorZoom, option.id)} onClick={() => selectEditorZoom(option.id)}>{option.label}</button>)}</div>}</div>}</div>
        {selected?.type === 'image' && <div className="image-quick-toolbar" role="toolbar" aria-label="Ferramentas rápidas da imagem">
          <button type="button" className="selected" onClick={() => { setImageEditInitialMode('tools'); setImageEditNotice(''); setImageEditPanelOpen(true) }}>Editar</button>
          <button type="button" disabled={!canEdit} onClick={() => setImageCropOpen(true)}><Crop size={14} /> Cortar</button>
          <button type="button" onClick={() => { setReplaceSelectedImageId(selected.id); setAssetPanelOpen(true) }}><ImageIcon size={14} /> Substituir</button>
          <button type="button" aria-pressed={false} onClick={() => { setImageEditInitialMode('tools'); setImageEditNotice('A remoção automática de fundo exige um processador de imagem configurado.'); setImageEditPanelOpen(true) }}>Removedor de Fundo Pro</button>
          <button type="button" aria-haspopup="menu" aria-expanded={imageFlipMenuOpen} onClick={() => setImageFlipMenuOpen(open => !open)}>Inverter</button>
          {imageFlipMenuOpen && <div className="image-quick-flip-menu" role="menu"><button type="button" role="menuitem" disabled={!canEdit} onClick={() => updateSelected({ flipX: !selected.flipX })}>Inverter horizontal</button><button type="button" role="menuitem" disabled={!canEdit} onClick={() => updateSelected({ flipY: !selected.flipY })}>Inverter vertical</button></div>}
          <button type="button" disabled={!canEdit} onClick={() => { setImageEditInitialMode('mask'); setImageEditNotice(''); setImageEditPanelOpen(true) }}>Borracha</button>
          <button type="button" onClick={() => { setImageEditNotice('Filtros e efeitos adicionais ainda não estão conectados.'); setImageEditPanelOpen(true) }}>Efeitos</button>
          <button type="button" disabled={!canEdit} onClick={() => { setImageEditInitialMode('animation'); setImageEditNotice(''); setImageEditPanelOpen(true) }}>Animar</button>
          <button type="button" onClick={() => { const positionInput = document.querySelector<HTMLInputElement>('.position-grid input'); positionInput?.scrollIntoView({ block: 'nearest' }); positionInput?.focus() }}>Posição</button>
        </div>}
        <div className="canvas-viewport" ref={viewportRef} data-canvas-zoom={scale} data-canvas-offset-x={pageOffset.x} data-canvas-offset-y={pageOffset.y} data-whiteboard-zoom={isWhiteboard ? whiteboardZoom : undefined} data-whiteboard-position-x={isWhiteboard ? whiteboardPosition.x : undefined} data-whiteboard-position-y={isWhiteboard ? whiteboardPosition.y : undefined}>
          {isVideo && <div className="video-media-stack">{allVideoAssets.map(({ clip, asset }) => {
            const active = activeVideoIds.has(clip.id)
            const transform = getVideoClipTransform(clip, videoPlayheadMs - clip.startMs)
            const layout = getVideoClipLayout({ ...clip, ...transform }, state.document.width, state.document.height, asset.width, asset.height)
            const viewportStyle: CSSProperties = { left: pageOffset.x, top: pageOffset.y, width: state.document.width * scale, height: state.document.height * scale, zIndex: 1 + (clip.trackIndex ?? 0), opacity: getVideoClipOpacity(clip, videoPlayheadMs - clip.startMs) / 100, visibility: active ? 'visible' : 'hidden' }
            const mediaStyle: CSSProperties = { left: layout.x * scale, top: layout.y * scale, width: layout.width * scale, height: layout.height * scale, zIndex: 1 + (clip.trackIndex ?? 0) }
            return <div key={clip.id} className="video-media-viewport" style={viewportStyle}><video ref={node => { timelineVideoRefs.current[clip.id] = node }} className="video-media-preview" src={asset.src} aria-label={`Pr\u00e9via da faixa ${((clip.trackIndex ?? 0) + 1)}: ${clip.name}`} playsInline preload={active ? 'auto' : 'none'} style={mediaStyle} onLoadedMetadata={event => { const player = event.currentTarget; const offset = (clip.sourceStartMs + videoPlayheadRef.current - clip.startMs) / 1000; if (Number.isFinite(player.duration)) player.currentTime = Math.min(offset, Math.max(0, player.duration - 0.04)); if (videoPlaying && active) void player.play().catch(() => undefined) }} /></div>
          })}</div>}
          {isVideo && videoTimelineClips.filter(clip => clip.kind === 'audio').map(clip => { const asset = findTimelineAsset(clip.assetId); return asset ? <audio key={clip.id} ref={node => { timelineAudioRefs.current[clip.id] = node }} src={asset.src} preload="auto" /> : null })}
          {isWhiteboard && (whiteboardTool === 'connector' || whiteboardTool === 'draw') && <div className="canvas-interaction-hint" role="status">{whiteboardTool === 'draw' ? 'Desenhe com o mouse, caneta ou toque.' : connectorStartId ? 'Clique perto do ponto da borda onde o conector deve terminar.' : 'Clique no primeiro objeto, perto do ponto da borda onde o conector deve começar.'}</div>}
          <Stage ref={stageRef} width={viewport.width} height={viewport.height} onWheel={event => {
            if (!isWhiteboard) return
            event.evt.preventDefault()
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) return
            zoomWhiteboard(whiteboardZoom * (event.evt.deltaY > 0 ? 0.9 : 1.1), pointer)
          }} onMouseMove={event => {
            extendMarquee()
            extendWhiteboardStroke()
            const position = event.target.getStage()?.getPointerPosition() ?? null
            publishCursorFromStage(position)
          }} onMouseLeave={() => { finishWhiteboardStroke(); finishMarquee(); publishCursor(null) }} onMouseDown={event => { if (beginWhiteboardStroke()) return; if (event.target === event.target.getStage() || event.target === event.target.getStage()?.findOne('Rect')) { if (beginMarquee(event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey)) return; dispatch({ type: 'select', id: null }) } }} onMouseUp={() => { finishWhiteboardStroke(); finishMarquee() }} onTouchStart={event => { if (beginCanvasPinch(event.evt)) return; if (multiTouchGestureRef.current) { event.evt.preventDefault(); return } if (beginWhiteboardStroke()) return; if (event.target === event.target.getStage() || event.target === event.target.getStage()?.findOne('Rect')) { if (beginMarquee(false)) return; dispatch({ type: 'select', id: null }) } }} onTouchMove={event => { if (updateCanvasPinch(event.evt)) return; if (multiTouchGestureRef.current) { event.evt.preventDefault(); return } extendMarquee(); extendWhiteboardStroke(); publishCursorFromStage(event.target.getStage()?.getPointerPosition() ?? null) }} onTouchEnd={event => { if (endCanvasPinch(event.evt)) return; finishWhiteboardStroke(); finishMarquee(); publishCursor(null) }} onTouchCancel={event => { if (endCanvasPinch(event.evt)) return; finishWhiteboardStroke(); finishMarquee(); publishCursor(null) }}>
            <Layer>
              <Group x={pageOffset.x} y={pageOffset.y} scaleX={scale} scaleY={scale} draggable={isWhiteboard && whiteboardTool === 'pan'} onDragEnd={event => { if (isWhiteboard) setWhiteboardPosition({ x: event.target.x(), y: event.target.y() }) }}>
                <Rect width={state.document.width} height={state.document.height} fill={isVideo && activeVideoClips.length ? 'rgba(0,0,0,0)' : page.background} shadowColor="#25213d" shadowBlur={24} shadowOpacity={0.12} shadowOffsetY={7} onClick={() => { if (isCanvasDrawing) return; setSelectedConnectorId(null); dispatch({ type: 'select', id: null }) }} onTap={() => { if (isCanvasDrawing) return; setSelectedConnectorId(null); dispatch({ type: 'select', id: null }) }} />
                {(page.connectors ?? []).map(connector => {
                  const points = connectorPoints(page, connector)
                  if (!points) return null
                  const connectorSelected = selectedConnectorId === connector.id
                  return <Group key={connector.id}>
                    {connectorSelected && <Arrow points={points} stroke="#f1a347" fill="#f1a347" strokeWidth={connector.strokeWidth + 8 / scale} lineCap="round" lineJoin="round" pointerLength={14} pointerWidth={14} listening={false} />}
                    <Arrow points={points} stroke={connector.color} fill={connector.color} strokeWidth={connector.strokeWidth} lineCap="round" lineJoin="round" pointerLength={12} pointerWidth={12} hitStrokeWidth={16} onClick={() => { setSelectedConnectorId(connector.id); dispatch({ type: 'select', id: null }) }} onTap={() => { setSelectedConnectorId(connector.id); dispatch({ type: 'select', id: null }) }} />
                  </Group>
                })}
                {marquee && <Rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="rgba(120,103,232,0.12)" stroke="#7867e8" strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />}
                {activeStrokePreview && activeStrokePreviewStyle && <Line x={0} y={0} points={activeStrokePreview} stroke={activeStrokePreviewStyle.color} strokeWidth={activeStrokePreviewStyle.strokeWidth} opacity={activeStrokePreviewStyle.opacity} lineCap="round" lineJoin="round" tension={0.35} listening={false} />}
                {visiblePageElements.map(element => {
                  const common = {
                    ref: (node: Konva.Node | null) => { nodeRefs.current[element.id] = node },
                    x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation,
                    draggable: canTransform,
                    onClick: (event: Konva.KonvaEventObject<MouseEvent>) => handleCanvasElementClick(element.id, event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey, false, getWhiteboardPointerPoint() ?? undefined),
                    onTap: () => handleCanvasElementClick(element.id, multiSelectMode, true, getWhiteboardPointerPoint() ?? undefined),
                    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => moveElement(element.id, event.target.x(), event.target.y()),
                    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => transformElement(element.id, event.target),
                  }
                  if (element.type === 'free-draw') return <Line key={element.id} {...common} points={element.points} stroke={element.color} strokeWidth={element.strokeWidth} opacity={element.opacity ?? 1} lineCap="round" lineJoin="round" tension={0.35} />
                  if (element.type === 'text') return <KonvaText key={element.id} {...common} text={element.text} fontSize={element.fontSize} fontFamily={element.fontFamily} fill={element.color} fontStyle={element.bold ? 'bold' : 'normal'} letterSpacing={element.kerning ?? 0} lineHeight={element.lineSpacing ?? 1.2} verticalAlign="middle" wrap="word" padding={2} />
                  if (element.type === 'image') return <ImageNode key={element.id} element={element} animationProgress={element.animation ? imageAnimationProgress(element.animation) : 1} compareOriginal={compareImageOriginal && selected?.id === element.id} register={(id, node) => { nodeRefs.current[id] = node }} onSelect={event => { const isTouch = 'touches' in event.evt; const additive = isTouch ? multiSelectMode : event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey; handleCanvasElementClick(element.id, additive, isTouch, getWhiteboardPointerPoint() ?? undefined) }} onMove={(x, y) => moveElement(element.id, x, y)} onTransform={node => transformElement(element.id, node)} canEdit={canTransform && !videoPlaying} />
                  if (element.type === 'sticky-note') return <Group key={element.id} {...common}><Rect width={element.width} height={element.height} fill={element.fill} shadowColor="#342f1f" shadowBlur={8} shadowOpacity={0.16} shadowOffset={{ x: 1, y: 3 }} /><KonvaText x={element.fontSize * 0.8} y={element.fontSize * 0.8} width={element.width - element.fontSize * 1.6} height={element.height - element.fontSize * 1.6} text={element.text} fontSize={element.fontSize} fontFamily="Arial" fill={element.color} wrap="word" /></Group>
                  if (element.type === 'shape' && element.shape === 'line' && element.curveOffset) return <KonvaCustomShape key={element.id} {...common} fill={element.fill} stroke={element.fill} strokeWidth={element.strokeWidth ?? 4} hitStrokeWidth={32} lineCap="butt" lineJoin="round" sceneFunc={(context, node) => {
                    const y = element.height / 2
                    const controlY = y + element.curveOffset! * 2 / 3
                    context.beginPath()
                    context.moveTo(0, y)
                    context.bezierCurveTo(element.width / 3, controlY, element.width * 2 / 3, controlY, element.width, y)
                    context.strokeShape(node)
                    for (const points of [element.startArrow ? vectorLineArrowheadPoints(element.width, element.height, element.curveOffset, true) : null, element.endArrow ? vectorLineArrowheadPoints(element.width, element.height, element.curveOffset) : null]) {
                      if (!points) continue
                      context.beginPath()
                      context.moveTo(points[0], points[1])
                      context.lineTo(points[2], points[3])
                      context.lineTo(points[4], points[5])
                      context.closePath()
                      context.fillShape(node)
                    }
                  }} />
                  if (element.type === 'shape' && element.shape === 'line') return <Arrow key={element.id} {...common} points={vectorShapePoints('line', element.width, element.height)} stroke={element.fill} fill={element.fill} strokeWidth={element.strokeWidth ?? 8} pointerAtBeginning={Boolean(element.startArrow)} pointerAtEnding={Boolean(element.endArrow)} pointerLength={Math.min(20, (element.strokeWidth ?? 8) * 2.5)} pointerWidth={Math.min(20, (element.strokeWidth ?? 8) * 2.5)} lineCap="round" lineJoin="round" />
                  if (element.type === 'shape' && element.qrConfig?.url) return <KonvaCustomShape key={element.id} {...common} fill={element.qrConfig.background} sceneFunc={context => drawQrScene(context, element)} />
                  if (element.shape !== 'ellipse' && element.shape !== 'rect') {
                    const points = vectorShapePoints(element.shape, element.width, element.height)
                    const strokeShape = isStrokeVectorShape(element.shape)
                    return <KonvaCustomShape key={element.id} {...common} fill={strokeShape ? undefined : element.fill} stroke={strokeShape ? element.fill : undefined} strokeWidth={strokeShape ? element.strokeWidth ?? 8 : 0} lineCap="round" lineJoin="round" sceneFunc={(context, node) => {
                      context.beginPath()
                      context.moveTo(points[0], points[1])
                      for (let index = 2; index < points.length; index += 2) context.lineTo(points[index], points[index + 1])
                      if (!strokeShape) context.closePath()
                      context.fillStrokeShape(node)
                    }} />
                  }
                  return element.shape === 'ellipse'
                    ? <Ellipse key={element.id} {...common} radiusX={element.width / 2} radiusY={element.height / 2} fill={element.fill} />
                    : <Rect key={element.id} {...common} cornerRadius={element.cornerRadius} fill={element.fill} />
                })}
                {isWhiteboard && whiteboardTool === 'select' && (page.connectors ?? []).flatMap(connector => {
                  if (selectedConnectorId !== connector.id) return []
                  const points = connectorPoints(page, connector)
                  if (!points) return []
                  return (['fromAnchor', 'toAnchor'] as const).flatMap((endpoint, index) => {
                    const elementId = endpoint === 'fromAnchor' ? connector.fromId : connector.toId
                    const element = page.elements.find(item => item.id === elementId)
                    if (!element) return []
                    const pointIndex = index === 0 ? 0 : 2
                    return [<KonvaCircle key={`${connector.id}-${endpoint}`} x={points[pointIndex]} y={points[pointIndex + 1]} radius={8 / scale} fill="#ffffff" stroke="#f1a347" strokeWidth={2 / scale} hitStrokeWidth={8 / scale} draggable={canEdit} onDragEnd={event => {
                      const anchor = snapConnectorAnchor(element, { x: event.target.x(), y: event.target.y() })
                      updateSelectedConnector(endpoint === 'fromAnchor' ? { fromAnchor: anchor } : { toAnchor: anchor })
                    }} />]
                  })
                })}
                {accessibilityTargetId && page.elements.find(element => element.id === accessibilityTargetId) && (() => {
                  const target = page.elements.find(element => element.id === accessibilityTargetId)!
                  return <Rect key={`accessibility-target-${target.id}`} x={target.x} y={target.y} width={target.width} height={target.height} rotation={target.rotation} stroke="#e8792f" strokeWidth={4 / scale} dash={[8 / scale, 4 / scale]} listening={false} />
                })()}
                {state.selectedIds.length > 1 && state.selectedIds.map(id => visiblePageElements.find(element => element.id === id)).filter((element): element is DesignElement => Boolean(element)).map(element => <Rect key={`multi-${element.id}`} x={element.x} y={element.y} width={element.width} height={element.height} rotation={element.rotation} stroke="#7867e8" strokeWidth={2 / scale} dash={[5 / scale, 3 / scale]} listening={false} />)}
                <Transformer ref={transformerRef} rotateEnabled={canTransform && state.selectedIds.length === 1} resizeEnabled={canTransform && state.selectedIds.length === 1} keepRatio={false} enabledAnchors={canTransform && state.selectedIds.length === 1 ? undefined : []} anchorSize={9} anchorCornerRadius={4} borderStroke="#7867e8" anchorStroke="#7867e8" anchorFill="#ffffff" />
                {presence.filter(user => user.id !== currentUserId && user.cursor?.pageId === page.id).map((user, index) => {
                  const x = user.cursor!.x * state.document.width
                  const y = user.cursor!.y * state.document.height
                  const color = ['#6c5ce7', '#df735f', '#299b83', '#4478bd'][index % 4]
                  return <Group id={`remote-cursor-${user.id}`} key={`cursor-${user.id}`} x={x} y={y} listening={false}>
                    <Ellipse radiusX={5} radiusY={5} fill={color} stroke="#fff" strokeWidth={2} shadowColor="#28243d" shadowBlur={4} shadowOpacity={0.25} />
                    <KonvaText x={8} y={7} text={user.name} fontSize={11} fontFamily="Arial" fill={color} padding={4} />
                  </Group>
                })}
                {presence.filter(user => user.id !== currentUserId && user.selection?.kind !== 'doc-block' && user.selection?.kind !== 'table-cell' && user.selection?.pageId === page.id).map((user, index) => {
                  const selectedElements = remoteWhiteboardSelectionElements(page, user.selection!.elementId)
                  if (!selectedElements.length) return null
                  const color = ['#6c5ce7', '#df735f', '#299b83', '#4478bd'][index % 4]
                  return <Group key={`selection-${user.id}`} listening={false}>{selectedElements.map((element, elementIndex) => <Group key={element.id}>
                    <Rect x={element.x} y={element.y} width={element.width} height={element.height} rotation={element.rotation} stroke={color} strokeWidth={3 / scale} dash={[5 / scale, 3 / scale]} />
                    {elementIndex === 0 && <KonvaText x={element.x} y={element.y - 20 / scale} text={user.name} fontSize={12 / scale} fontFamily="Arial" fill={color} />}
                  </Group>)}
                  </Group>
                })}
              </Group>
            </Layer>
          </Stage>
          <div className="page-indicator">{state.pageIndex + 1} / {state.document.pages.length}</div>
        </div>
        {isVideo && <section className="video-timeline" aria-label="Linha do tempo do vídeo">
          <header className="video-timeline-header"><div><span className="panel-kicker">VÍDEO</span><strong>Camadas e mídia</strong></div><button type="button" className="video-add-media" disabled={!canEdit || assetBusy} onClick={() => timelineMediaInputRef.current?.click()}><Plus size={14} aria-hidden="true" />{assetBusy ? 'Preparando…' : 'Adicionar mídia'}</button><button type="button" className="video-split-clip" aria-label="Dividir clipe selecionado" disabled={!canEdit || !canSplitSelectedVideoTimelineClip} title="Divide o clipe no cursor sem alterar a mídia de origem." onClick={splitSelectedVideoTimelineClip}><Scissors size={14} aria-hidden="true" /><span>Dividir</span></button><button type="button" className="video-beat-markers-toggle" aria-label="Exibir marcadores de ritmo" aria-pressed={beatMarkersVisible} title="Estimativa local baseada na forma de onda; o algoritmo original não foi recuperado." disabled={!videoTimelineClips.some(clip => clip.kind === 'audio')} onClick={() => setBeatMarkersVisible(visible => !visible)}><Activity size={14} aria-hidden="true" /><span>Marcadores de ritmo</span></button><label>Duração <input aria-label="Duração do vídeo em segundos" type="number" min="1" max="86400" step="0.5" value={(videoDurationMs / 1000).toFixed(1)} disabled={!canEdit} onChange={event => { const seconds = Number(event.target.value); if (!Number.isFinite(seconds)) return; const durationMs = Math.max(1000, Math.min(86_400_000, Math.round(seconds * 1000))); change(document => ({ ...document, videoDurationMs: durationMs })); if (videoPlayheadRef.current > durationMs) { videoPlayheadRef.current = durationMs; setVideoPlayheadMs(next => Math.min(next, durationMs)) } }} /> s</label></header>
          <div className="video-transport"><button type="button" aria-label={videoPlaying ? 'Pausar prévia' : 'Reproduzir prévia'} onClick={() => { if (videoPlayheadRef.current >= videoDurationMs) { videoPlayheadRef.current = 0; setVideoPlayheadMs(0) } setVideoPlaying(value => !value) }}>{videoPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}</button><span>{(videoPlayheadMs / 1000).toFixed(2)} s</span><input aria-label="Posição da reprodução" type="range" min="0" max={videoDurationMs} step="50" value={Math.min(videoPlayheadMs, videoDurationMs)} onChange={event => { const next = Number(event.target.value); videoPlayheadRef.current = next; setVideoPlayheadMs(next) }} /><span>{(videoDurationMs / 1000).toFixed(1)} s</span></div>
          {assetError && <p className="video-timeline-error" role="alert">{assetError}</p>}
          <div className="video-track-list">{page.elements.map(element => <div className="video-track-row" key={element.id}>
            <button type="button" className="video-track-name" onClick={() => dispatch({ type: 'select', id: element.id })} aria-label={`Selecionar camada ${element.name}`}>{element.name}</button>
            <label>Início <input aria-label={`Início de ${element.name} em segundos`} type="number" min="0" max={(videoDurationMs / 1000).toFixed(1)} step="0.1" value={((element.startMs ?? 0) / 1000).toFixed(1)} disabled={!canEdit} onChange={event => updateVideoTiming(element, 'startMs', Number(event.target.value))} /></label>
            <label>Duração <input aria-label={`Duração de ${element.name} em segundos`} type="number" min="0.1" max={(videoDurationMs / 1000).toFixed(1)} step="0.1" value={((element.durationMs ?? videoDurationMs) / 1000).toFixed(1)} disabled={!canEdit} onChange={event => updateVideoTiming(element, 'durationMs', Number(event.target.value))} /></label>
            <div className="video-clip-track" aria-label={`Clipe de ${element.name}`}><span style={{ left: `${Math.min(100, (element.startMs ?? 0) / videoDurationMs * 100)}%`, width: `${Math.max(1, Math.min(100, (element.durationMs ?? videoDurationMs) / videoDurationMs * 100))}%` }} /></div>
          </div>)}{videoTimelineClips.map(clip => <div className={`video-track-row video-media-row ${clip.kind}${selectedVideoTimelineClipId === clip.id ? ' is-selected' : ''}`} key={clip.id}>
            <button type="button" className="video-track-name" onClick={() => { setSelectedVideoTimelineClipId(clip.id); videoPlayheadRef.current = clip.startMs; setVideoPlayheadMs(clip.startMs) }} aria-label={`Selecionar clipe ${clip.name}`} aria-pressed={selectedVideoTimelineClipId === clip.id}>{clip.kind === 'video' ? <Film size={13} aria-hidden="true" /> : <Music2 size={13} aria-hidden="true" />}{clip.name}</button>
            <label>Início <input aria-label={`Início de ${clip.name} em segundos`} type="number" min="0" max={(videoDurationMs / 1000).toFixed(1)} step="0.1" value={(clip.startMs / 1000).toFixed(1)} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'startMs', Number(event.target.value) * 1000)} /></label>
            {clip.kind === 'video' && <label>Faixa <input aria-label={`Faixa de ${clip.name}`} type="number" min="1" max="1000" step="1" value={(clip.trackIndex ?? 0) + 1} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'trackIndex', Number(event.target.value) - 1)} /></label>}
            {clip.kind === 'video' && <>
              <label>Opacidade base <input aria-label={`Opacidade base de ${clip.name}`} type="range" min="0" max="100" value={clip.opacity ?? 100} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'opacity', Number(event.target.value))} /><output>{clip.opacity ?? 100}%</output></label>
              <label>Curva da animação <select aria-label={`Curva da animação de ${clip.name}`} value={clip.animationEasing ?? 'linear'} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'animationEasing', event.target.value)}><option value="linear">Linear</option><option value="ease-in">Entrada suave</option><option value="ease-out">Saída suave</option><option value="ease-in-out">Entrada e saída suaves</option></select></label>
              {(() => { const localTime = Math.max(0, Math.min(clip.durationMs, videoPlayheadMs - clip.startMs)); const opacity = getVideoClipOpacity(clip, localTime); const currentKeyframe = clip.opacityKeyframes?.find(keyframe => keyframe.timeMs === localTime); const atKeyframe = Boolean(currentKeyframe); const hasFollowingKeyframe = Boolean(currentKeyframe && clip.opacityKeyframes?.some(keyframe => keyframe.timeMs > currentKeyframe.timeMs)); return <div className="video-opacity-keyframes"><button type="button" disabled={!canEdit || videoPlayheadMs < clip.startMs || videoPlayheadMs > clip.startMs + clip.durationMs || atKeyframe || (clip.opacityKeyframes?.length ?? 0) >= 100} onClick={() => updateVideoOpacityKeyframe(clip.id, localTime, opacity)}>Adicionar quadro-chave</button><label>Opacidade no cursor <input aria-label={`Opacidade animada de ${clip.name}`} type="range" min="0" max="100" value={Math.round(opacity)} disabled={!canEdit || !atKeyframe} onChange={event => updateVideoOpacityKeyframe(clip.id, localTime, Number(event.target.value))} /><output>{Math.round(opacity)}%</output></label><VideoKeyframeEasingControl clipName={clip.name} motion="opacidade" keyframeTimeMs={currentKeyframe?.timeMs ?? null} easing={currentKeyframe?.easing} clipEasing={clip.animationEasing} hasFollowingKeyframe={hasFollowingKeyframe} disabled={!canEdit} onChange={easing => updateVideoOpacityKeyframeEasing(clip.id, localTime, easing)} /><small>{clip.opacityKeyframes?.length ?? 0} quadros-chave</small><button type="button" disabled={!canEdit || !atKeyframe} onClick={() => removeVideoOpacityKeyframeAt(clip.id, localTime)}>Remover quadro-chave no cursor</button></div> })()}
            </>}
            {clip.kind === 'video' && <label>Enquadrar <select aria-label={`Enquadramento de ${clip.name}`} value={clip.fitMode ?? 'contain'} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'fitMode', event.target.value)}><option value="contain">Conter</option><option value="cover">Preencher</option></select></label>}
            {clip.kind === 'video' && <label>Escala <input aria-label={`Escala de ${clip.name}`} type="range" min="50" max="300" value={clip.scale ?? 100} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'scale', Number(event.target.value))} /><output>{clip.scale ?? 100}%</output></label>}
            {clip.kind === 'video' && <label>X <input aria-label={`Deslocamento horizontal de ${clip.name}`} type="range" min="-100" max="100" value={clip.offsetX ?? 0} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'offsetX', Number(event.target.value))} /><output>{clip.offsetX ?? 0}%</output></label>}
            {clip.kind === 'video' && <label>Y <input aria-label={`Deslocamento vertical de ${clip.name}`} type="range" min="-100" max="100" value={clip.offsetY ?? 0} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'offsetY', Number(event.target.value))} /><output>{clip.offsetY ?? 0}%</output></label>}
            {clip.kind === 'video' && (() => { const localTime = Math.max(0, Math.min(clip.durationMs, videoPlayheadMs - clip.startMs)); const transform = getVideoClipTransform(clip, localTime); const currentKeyframe = clip.transformKeyframes?.find(keyframe => keyframe.timeMs === localTime); const atKeyframe = Boolean(currentKeyframe); const hasFollowingKeyframe = Boolean(currentKeyframe && clip.transformKeyframes?.some(keyframe => keyframe.timeMs > currentKeyframe.timeMs)); return <div className="video-transform-keyframes"><button type="button" disabled={!canEdit || videoPlayheadMs < clip.startMs || videoPlayheadMs > clip.startMs + clip.durationMs || atKeyframe || (clip.transformKeyframes?.length ?? 0) >= 100} onClick={() => updateVideoTransformKeyframe(clip.id, localTime, 'scale', transform.scale)}>Adicionar quadro de enquadramento</button><label>Escala animada <input aria-label={`Escala animada de ${clip.name}`} type="range" min="50" max="300" value={Math.round(transform.scale)} disabled={!canEdit || !atKeyframe} onChange={event => updateVideoTransformKeyframe(clip.id, localTime, 'scale', Number(event.target.value))} /><output>{Math.round(transform.scale)}%</output></label><label>X animado <input aria-label={`Deslocamento X animado de ${clip.name}`} type="range" min="-100" max="100" value={Math.round(transform.offsetX)} disabled={!canEdit || !atKeyframe} onChange={event => updateVideoTransformKeyframe(clip.id, localTime, 'offsetX', Number(event.target.value))} /><output>{Math.round(transform.offsetX)}%</output></label><label>Y animado <input aria-label={`Deslocamento Y animado de ${clip.name}`} type="range" min="-100" max="100" value={Math.round(transform.offsetY)} disabled={!canEdit || !atKeyframe} onChange={event => updateVideoTransformKeyframe(clip.id, localTime, 'offsetY', Number(event.target.value))} /><output>{Math.round(transform.offsetY)}%</output></label><VideoKeyframeEasingControl clipName={clip.name} motion="enquadramento" keyframeTimeMs={currentKeyframe?.timeMs ?? null} easing={currentKeyframe?.easing} clipEasing={clip.animationEasing} hasFollowingKeyframe={hasFollowingKeyframe} disabled={!canEdit} onChange={easing => updateVideoTransformKeyframeEasing(clip.id, localTime, easing)} /><small>{clip.transformKeyframes?.length ?? 0} pontos de enquadramento</small><button type="button" disabled={!canEdit || !atKeyframe} onClick={() => removeVideoTransformKeyframeAt(clip.id, localTime)}>Remover enquadramento no cursor</button></div> })()}            <label>Início da mídia <input aria-label={`Início da mídia de ${clip.name} em segundos`} type="number" min="0" max={((clip.sourceDurationMs - clip.durationMs) / 1000).toFixed(1)} step="0.1" value={(clip.sourceStartMs / 1000).toFixed(1)} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'sourceStartMs', Number(event.target.value) * 1000)} /></label>
            <label>Duração <input aria-label={`Duração de ${clip.name} em segundos`} type="number" min="0.1" max={(clip.sourceDurationMs / 1000).toFixed(1)} step="0.1" value={(clip.durationMs / 1000).toFixed(1)} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'durationMs', Number(event.target.value) * 1000)} /></label>
            <label>Volume <input aria-label={`Volume de ${clip.name}`} type="range" min="0" max="100" value={Math.round(clip.volume * 100)} disabled={!canEdit} onChange={event => updateVideoTimelineClip(clip.id, 'volume', Number(event.target.value) / 100)} /></label>
            {clip.kind === 'audio' && <>
              <AudioFadeControl label="Entrada gradual" seconds={(clip.fadeInMs ?? 0) / 1000} maxSeconds={clip.durationMs / 1000} disabled={!canEdit} onCommit={seconds => updateVideoTimelineClip(clip.id, 'fadeInMs', seconds * 1000)} />
              <AudioFadeControl label="Saída gradual" seconds={(clip.fadeOutMs ?? 0) / 1000} maxSeconds={clip.durationMs / 1000} disabled={!canEdit} onCommit={seconds => updateVideoTimelineClip(clip.id, 'fadeOutMs', seconds * 1000)} />
            </>}
            <div className={`video-clip-track${clip.kind === 'audio' ? ' audio-waveform-track' : ''}`} aria-label={`Clipe de ${clip.name}`}><span className="media-clip" style={{ left: `${Math.min(100, clip.startMs / videoDurationMs * 100)}%`, width: `${Math.max(1, Math.min(100, clip.durationMs / videoDurationMs * 100))}%` }}>{clip.kind === 'audio' && (() => { const waveform = audioWaveforms[clip.id]; const key = `${clip.id}:${clip.assetId}:${clip.sourceStartMs}:${clip.durationMs}`; const asset = findTimelineAsset(clip.assetId); if (waveform?.key !== key) return !asset ? <span className="audio-waveform-fallback">Áudio indisponível</span> : null; const beatMarkers = beatMarkersVisible ? mapAudioBeatMarkersToTimeline(getAudioBeatMarkers(waveform.peaks), waveform.peaks.length, clip) : []; return <svg className="audio-waveform" viewBox="0 0 100 16" preserveAspectRatio="none" role="img" aria-label={`Forma de onda de ${clip.name}${beatMarkersVisible ? `, ${beatMarkers.length} marcadores de ritmo estimados` : ''}`} data-source-start-ms={clip.sourceStartMs} data-clip-start-ms={clip.startMs} data-clip-duration-ms={clip.durationMs}>{waveform.peaks.map((peak, index) => { const height = Math.max(1, peak * 13); return <rect key={index} x={index * (100 / waveform.peaks.length)} y={(16 - height) / 2} width={Math.max(0.35, 70 / waveform.peaks.length)} height={height} rx="0.25" /> })}{beatMarkers.map((marker, index) => { const x = marker.clipProgress * 100; return <line key={`beat-${index}`} className="audio-beat-marker" data-source-time-ms={marker.sourceTimeMs} data-timeline-time-ms={marker.timelineTimeMs} x1={x} x2={x} y1="0.5" y2="15.5" /> })}</svg> })()}</span></div>
            <button type="button" className="video-remove-clip" aria-label={`Remover ${clip.name} da timeline`} disabled={!canEdit} onClick={() => removeVideoTimelineClip(clip.id)}><X size={14} aria-hidden="true" /></button>
          </div>)}{!page.elements.length && !videoTimelineClips.length && <p className="video-timeline-empty">Adicione texto, formas, imagens, vídeo ou áudio para montar o projeto.</p>}</div>
        </section>}
        <footer className={`page-footer${isSite ? ' site-page-footer' : ''}`}><button aria-label={isWhiteboard ? 'Quadro anterior' : 'Página anterior'} disabled={state.pageIndex === 0} onClick={() => navigateToPage(state.pageIndex - 1)}><ChevronLeft size={16} aria-hidden="true" /></button><span>{isWhiteboard ? `Quadro ${state.pageIndex + 1} de ${state.document.pages.length}` : `Página ${state.pageIndex + 1} de ${state.document.pages.length}`}{isSite && ` - ${page.hidden ? 'Oculta no site' : 'Visível no site'}`}</span><button aria-label={isWhiteboard ? 'Próximo quadro' : 'Próxima página'} disabled={state.pageIndex === state.document.pages.length - 1} onClick={() => navigateToPage(state.pageIndex + 1)}><ChevronRight size={16} aria-hidden="true" /></button>{canEdit && <>{isSite && <button className="page-action" type="button" aria-label="Adicionar seção" onClick={addPage}><Plus size={14} aria-hidden="true" /><span>Adicionar seção</span></button>}<button className="page-action" onClick={duplicateCurrentPage} title={isWhiteboard ? 'Duplicar quadro' : 'Duplicar página'}><Copy size={14} aria-hidden="true" /><span>Duplicar</span></button>{isSite && <button className="page-action" type="button" aria-label={page.hidden ? "Mostrar seção no site" : "Ocultar seção no site"} aria-pressed={Boolean(page.hidden)} disabled={!canEdit} onClick={() => { const hidden = !page.hidden; change(document => setSiteSectionVisibility(document, state.pageIndex, hidden) ?? document); scheduleDesignPagePatch(page.id, { hidden }) }} title={page.hidden ? "Mostrar seção no site" : "Ocultar seção no site"}>{page.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />} {page.hidden ? "Mostrar seção" : "Ocultar seção"}</button>}<button className="page-action" aria-label="Mover página para a esquerda" disabled={state.pageIndex === 0} onClick={() => moveCurrentPage(state.pageIndex - 1)}><ArrowLeft size={14} aria-hidden="true" /></button><button className="page-action" aria-label="Mover página para a direita" disabled={state.pageIndex === state.document.pages.length - 1} onClick={() => moveCurrentPage(state.pageIndex + 1)}><ArrowRight size={14} aria-hidden="true" /></button><button className="page-action" onClick={deleteCurrentPage} disabled={state.document.pages.length <= 1}><Trash2 size={14} aria-hidden="true" /><span>Excluir</span></button></>}</footer>
      </section>

      <aside className={`inspector-panel ${selected || selectedConnector ? 'has-selection' : ''}`} aria-label={selectedConnector ? 'Propriedades do conector' : 'Propriedades do elemento'}>
        {selectedConnector ? <>
          <div className="inspector-heading"><div><span className="panel-kicker">QUADRO BRANCO - CONECTOR</span><h2>Conector selecionado</h2></div></div>
          <label className="field-label" htmlFor="connector-color">Cor do conector</label>
          <input id="connector-color" aria-label="Cor do conector" type="color" value={/^#[0-9a-f]{6}$/i.test(selectedConnector.color) ? selectedConnector.color : '#7464e8'} disabled={!canEdit} onChange={event => updateSelectedConnector({ color: event.target.value })} />
          <label className="field-label" htmlFor="connector-stroke-width">Espessura do conector</label>
          <div className="number-field"><input id="connector-stroke-width" aria-label="Espessura do conector" type="number" min="1" max="128" step="1" value={selectedConnector.strokeWidth} disabled={!canEdit} onChange={event => updateSelectedConnector({ strokeWidth: Math.max(1, Math.min(128, Number(event.target.value) || 1)) })} /><span>px</span></div>
          {(['fromAnchor', 'toAnchor'] as const).map((endpoint, index) => {
            const anchor = selectedConnector[endpoint]
            const prefix = index === 0 ? 'Início' : 'Fim'
            return <fieldset className="connector-anchor-fields" key={endpoint}>
              <legend>Âncora de {prefix.toLocaleLowerCase('pt-BR')}</legend>
              <label>{prefix} X <input aria-label={`Âncora ${prefix} X`} type="number" min="0" max="1" step="0.01" value={anchor?.x ?? 0.5} disabled={!canEdit} onChange={event => updateSelectedConnector({ [endpoint]: { x: Math.max(0, Math.min(1, Number(event.target.value) || 0)), y: anchor?.y ?? 0.5 } })} /></label>
              <label>{prefix} Y <input aria-label={`Âncora ${prefix} Y`} type="number" min="0" max="1" step="0.01" value={anchor?.y ?? 0.5} disabled={!canEdit} onChange={event => updateSelectedConnector({ [endpoint]: { x: anchor?.x ?? 0.5, y: Math.max(0, Math.min(1, Number(event.target.value) || 0)) } })} /></label>
              <button type="button" disabled={!canEdit || !anchor} onClick={() => updateSelectedConnector({ [endpoint]: null })}>Usar encaixe automático</button>
            </fieldset>
          })}
        </> : selected ? <>
          <div className="inspector-heading"><div><span className="panel-kicker">{selectedGroup?.name ?? 'PROPRIEDADES'}</span><h2>{state.selectedIds.length > 1 ? `${state.selectedIds.length} objetos selecionados` : selected.name}</h2></div><button className="delete-button" onClick={removeSelected} disabled={!canEdit} aria-label="Excluir seleção" title="Excluir seleção"><Trash2 size={16} aria-hidden="true" /></button></div>
          {state.selectedIds.length > 1 && <p className="selection-help">Mover, duplicar e excluir atuam sobre todos. As propriedades abaixo editam o objeto principal.</p>}
          <div className="element-actions" aria-label="Ações do elemento">
            <button onClick={duplicateSelected} disabled={!canEdit} aria-label="Duplicar elemento" title="Duplicar (Ctrl+D)">Duplicar</button>
            <button onClick={() => moveLayer('backward')} disabled={!canEdit || state.selectedIds.length > 1} aria-label="Enviar camada para trás" title="Enviar para trás"><ArrowDown size={14} aria-hidden="true" /> Camada</button>
            <button onClick={() => moveLayer('forward')} disabled={!canEdit || state.selectedIds.length > 1} aria-label="Trazer camada para frente" title="Trazer para frente"><ArrowUp size={14} aria-hidden="true" /> Camada</button>
            {isWhiteboard && <button onClick={() => moveSelectedLayerToEdge('back')} disabled={!canEdit || state.selectedIds.length !== 1 || page.elements[0]?.id === selected.id} aria-label="Enviar camada para trás de todas" title="Enviar para trás de todas"><ArrowDown size={14} aria-hidden="true" /> Fundo</button>}
            {isWhiteboard && <button onClick={() => moveSelectedLayerToEdge('front')} disabled={!canEdit || state.selectedIds.length !== 1 || page.elements.at(-1)?.id === selected.id} aria-label="Trazer camada para frente de todas" title="Trazer para frente de todas"><ArrowUp size={14} aria-hidden="true" /> Topo</button>}
          </div>
          {isWhiteboard && <div className="element-actions" aria-label="Agrupamento">{canCreateGroup && <button onClick={groupSelectedElements} disabled={!canEdit}>Agrupar {state.selectedIds.length}</button>}{selectedGroup && <button onClick={ungroupSelectedElements} disabled={!canEdit}>Desagrupar</button>}</div>}
          {isWhiteboard && state.selectedIds.length > 1 && <label className="arrangement-control"><span>Alinhar seleção</span><select aria-label="Alinhar ou distribuir seleção" defaultValue="" disabled={!canEdit} onChange={arrangeSelection}><option value="">Escolher ação…</option><option value="left">Alinhar à esquerda</option><option value="center-x">Centralizar horizontalmente</option><option value="right">Alinhar à direita</option><option value="top">Alinhar ao topo</option><option value="center-y">Centralizar verticalmente</option><option value="bottom">Alinhar à base</option><option value="distribute-x" disabled={state.selectedIds.length < 3}>Distribuir horizontalmente</option><option value="distribute-y" disabled={state.selectedIds.length < 3}>Distribuir verticalmente</option></select></label>}
          {selected.type === 'free-draw' ? <>
            <label className="field-label" htmlFor="free-draw-color">Cor do traço</label>
            <div className="color-field"><input id="free-draw-color" type="color" value={selected.color} disabled={!canEdit} onChange={event => updateSelected({ color: event.target.value })} /><code>{selected.color.toUpperCase()}</code></div>
            <label className="field-label" htmlFor="free-draw-width">Espessura</label>
            <div className="number-field"><input id="free-draw-width" type="number" min="1" max="64" value={selected.strokeWidth} disabled={!canEdit} onChange={event => updateSelected({ strokeWidth: Math.max(1, Math.min(64, Number(event.target.value) || 1)) })} /><span>px</span></div>
            <label className="field-label" htmlFor="free-draw-opacity">Opacidade</label>
            <div className="number-field"><input id="free-draw-opacity" type="range" min="0" max="100" value={Math.round((selected.opacity ?? 1) * 100)} disabled={!canEdit} onChange={event => updateSelected({ opacity: Number(event.target.value) / 100 })} /><span>{Math.round((selected.opacity ?? 1) * 100)}%</span></div>
          </> : selected.type === 'sticky-note' ? <>
            <label className="field-label" htmlFor="sticky-note-content">Conteúdo da nota</label>
            <textarea id="sticky-note-content" rows={5} value={selected.text} disabled={!canEdit} onChange={event => updateSelected({ text: event.target.value })} />
            <label className="field-label" htmlFor="sticky-note-fill">Cor da nota</label>
            <div className="color-field"><input id="sticky-note-fill" type="color" value={selected.fill} disabled={!canEdit} onChange={event => updateSelected({ fill: event.target.value })} /><code>{selected.fill.toUpperCase()}</code></div>
            <label className="field-label" htmlFor="sticky-note-text-color">Cor do texto</label>
            <div className="color-field"><input id="sticky-note-text-color" type="color" value={selected.color} disabled={!canEdit} onChange={event => updateSelected({ color: event.target.value })} /><code>{selected.color.toUpperCase()}</code></div>
            <label className="field-label" htmlFor="sticky-note-font-size">Tamanho do texto</label>
            <div className="number-field"><input id="sticky-note-font-size" type="number" min="12" max="64" value={selected.fontSize} disabled={!canEdit} onChange={event => updateSelected({ fontSize: Math.max(12, Math.min(64, Number(event.target.value) || 12)) })} /><span>px</span></div>
          </> : selected.type === 'text' ? <>
            <label className="field-label" htmlFor="text-content">Texto</label>
            <textarea id="text-content" rows={3} value={selected.text} disabled={!canEdit} onChange={event => updateSelected({ text: event.target.value })} />
            <label className="field-label" htmlFor="font-size">Tamanho</label>
            <div className="number-field"><input id="font-size" type="number" min="8" max="160" value={selected.fontSize} disabled={!canEdit} onChange={event => updateSelected({ fontSize: Number(event.target.value) || 8 })} /><span>px</span></div>
            <label className="field-label" htmlFor="text-kerning">Espaçamento entre letras</label>
            <div className="typography-control">
              <input id="text-kerning-slider" aria-label="Ajustar espaçamento entre letras" type="range" min="-10" max="40" step="0.5" value={selected.kerning ?? 0} disabled={!canEdit} onChange={event => updateSelected({ kerning: Number(event.target.value) })} />
              <div className="number-field"><input id="text-kerning" aria-label="Espaçamento entre letras" type="number" min="-10" max="40" step="0.5" value={selected.kerning ?? 0} disabled={!canEdit} onChange={event => updateSelected({ kerning: Math.max(-10, Math.min(40, Number(event.target.value) || 0)) })} /><span>px</span></div>
            </div>
            <label className="field-label" htmlFor="text-line-spacing">Espaçamento entre linhas</label>
            <div className="typography-control">
              <input id="text-line-spacing-slider" aria-label="Ajustar espaçamento entre linhas" type="range" min="0.5" max="3" step="0.05" value={selected.lineSpacing ?? 1.2} disabled={!canEdit} onChange={event => updateSelected({ lineSpacing: Number(event.target.value) })} />
              <div className="number-field"><input id="text-line-spacing" aria-label="Espaçamento entre linhas" type="number" min="0.5" max="3" step="0.05" value={selected.lineSpacing ?? 1.2} disabled={!canEdit} onChange={event => updateSelected({ lineSpacing: Math.max(0.5, Math.min(3, Number(event.target.value) || 1.2)) })} /><span>×</span></div>
            </div>
            <label className="field-label" htmlFor="text-color">Cor do texto</label>
            <div className="color-field"><input id="text-color" type="color" value={selected.color} disabled={!canEdit} onChange={event => updateSelected({ color: event.target.value })} /><code>{selected.color.toUpperCase()}</code></div>
            <label className="toggle-row"><input type="checkbox" checked={selected.bold} disabled={!canEdit} onChange={event => updateSelected({ bold: event.target.checked })} /><span>Negrito</span></label>
            {isSite && <><label className="field-label" htmlFor="site-text-link">Link do site</label><input id="site-text-link" type="text" aria-label="Link do site" value={siteLinkDrafts[selected.id] ?? selected.href ?? ''} placeholder="#seção, https://, mailto: ou tel:" disabled={!canEdit} onChange={event => { const draft = event.currentTarget.value; setSiteLinkNotice(''); setSiteLinkDrafts(drafts => ({ ...drafts, [selected.id]: draft })) }} onBlur={event => { const rawHref = event.currentTarget.value; const normalizedHref = normalizeSiteHref(rawHref); setSiteLinkDrafts(drafts => { const next = { ...drafts }; delete next[selected.id]; return next }); if (rawHref.trim() && !normalizedHref) { setSiteLinkNotice('Link inválido. Use #seção, um caminho relativo, http(s), mailto ou tel.'); return } setSiteLinkNotice(''); const nextHref = normalizedHref ?? ''; if (nextHref !== (selected.href ?? '')) updateSelected({ href: nextHref || undefined }) }} /><label className="field-label" htmlFor="site-section-link">Ou vincular a uma seção visível</label><select id="site-section-link" aria-label="Vincular a uma seção visível" value={normalizeSiteHref(selected.href) ?? ''} disabled={!canEdit} onChange={event => { const href = event.currentTarget.value; setSiteLinkDrafts(drafts => { const next = { ...drafts }; delete next[selected.id]; return next }); setSiteLinkNotice(''); if (href !== (selected.href ?? '')) updateSelected({ href: href || undefined }) }}><option value="">Sem link de seção</option>{state.document.pages.filter(sitePage => !sitePage.hidden).map(sitePage => <option key={sitePage.id} value={`#${siteSectionAnchorById[sitePage.id]}`}>{sitePage.name}</option>)}</select>{siteLinkNotice && <p className="site-link-notice" role="status">{siteLinkNotice}</p>}</>}
          </> : selected.type === 'shape' ? <>
            {isWhiteboard && selected.qrConfig && <section className="qr-editor" aria-label="Configuração do QR code">
              <h3>QR codes dinâmicos</h3>
              <label className="field-label" htmlFor="qr-url">URL</label>
              <input id="qr-url" type="url" value={qrDrafts[selected.id] ?? selected.qrConfig.url ?? ''} aria-invalid={Boolean(qrErrors[selected.id])} onChange={event => { setQrDrafts(drafts => ({ ...drafts, [selected.id]: event.target.value })); setQrErrors(errors => ({ ...errors, [selected.id]: '' })) }} onKeyDown={event => { if (event.key === 'Enter') applyQrDestination() }} placeholder="https://" />
              {qrErrors[selected.id] && <p role="alert">{qrErrors[selected.id]}</p>}
              <button type="button" disabled={!canEdit} onClick={applyQrDestination}>Aplicar URL</button>
              <label className="field-label">Padrão</label><div className="qr-patterns" role="group" aria-label="Padrão do QR code">{([['blocks', 'Blocos'], ['rounded', 'Quadrados arredondados'], ['circles', 'Círculos'], ['crosses', 'Cruzes'], ['stars', 'Estrelas'], ['hearts', 'Corações']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={(selected.qrConfig?.pattern ?? 'blocks') === value} onClick={() => updateQrConfiguration({ pattern: value })}>{label}</button>)}</div>
              <label className="field-label" htmlFor="qr-name">Nome (opcional)</label><input id="qr-name" value={selected.qrConfig?.name ?? ''} onChange={event => updateQrConfiguration({ name: event.target.value })} />
              <label className="field-label" htmlFor="qr-expiration">Data de referência (opcional)</label><input id="qr-expiration" type="date" value={selected.qrConfig?.expiration ?? ''} onChange={event => updateQrConfiguration({ expiration: event.target.value })} /><small>É uma anotação no projeto. A expiração automática exige um serviço de redirecionamento hospedado.</small>
              <label className="field-label" htmlFor="qr-foreground">Cor do QR</label><input id="qr-foreground" type="color" value={selected.qrConfig?.foreground ?? '#000000'} onChange={event => updateQrConfiguration({ foreground: event.target.value })} />
              <label className="field-label" htmlFor="qr-background">Cor do fundo</label><input id="qr-background" type="color" value={selected.qrConfig?.background ?? '#ffffff'} onChange={event => updateQrConfiguration({ background: event.target.value })} />
              {selected.qrConfig.url && <button type="button" disabled={!canEdit} onClick={() => { setQrDrafts(drafts => ({ ...drafts, [selected.id]: '' })); updateQrConfiguration({ url: undefined }); setQrErrors(errors => ({ ...errors, [selected.id]: '' })) }}>Remover destino</button>}
              <small>O destino fica codificado no próprio QR. Para mudar a URL depois de compartilhar ou imprimir, substitua o QR no material.</small>
            </section>}
            <label className="field-label" htmlFor="shape-color">{selected.shape === 'line' ? 'Cor da linha' : 'Preenchimento'}</label>
            <div className="color-field"><input id="shape-color" type="color" value={selected.fill} disabled={!canEdit} onChange={event => updateSelected({ fill: event.target.value })} /><code>{selected.fill.toUpperCase()}</code></div>
            <label className="field-label" htmlFor="shape-kind">Tipo</label>
            <select id="shape-kind" aria-label="Tipo de forma" value={selected.shape} disabled={!canEdit} onChange={event => { const shape = event.target.value as VectorShapeKind; updateSelected({ shape, name: VECTOR_SHAPE_LABELS[shape], ...(shape === 'line' ? { strokeWidth: selected.strokeWidth ?? 8 } : {}) }) }}>{VECTOR_SHAPES.map(shape => <option value={shape} key={shape}>{VECTOR_SHAPE_LABELS[shape]}</option>)}</select>
            {selected.shape === 'line' && <label className="field-label" htmlFor="shape-stroke-width">Espessura da linha<input id="shape-stroke-width" aria-label="Espessura da linha" type="number" min="1" max="128" value={selected.strokeWidth ?? 8} disabled={!canEdit} onChange={event => updateSelected({ strokeWidth: Math.max(1, Math.min(128, Number(event.target.value) || 1)) })} /></label>}
            {isWhiteboard && selected.shape === 'line' && <label className="field-label" htmlFor="line-curve-mode">Traçado<select id="line-curve-mode" aria-label="Traçado da linha" value={selected.curveOffset ? 'curve' : 'straight'} disabled={!canEdit} onChange={event => updateSelected({ curveOffset: event.target.value === 'curve' ? -96 : null })}><option value="straight">Reta</option><option value="curve">Curva</option></select></label>}
            {isWhiteboard && selected.shape === 'line' && <>
              <button type="button" className="secondary-button" aria-label="Trocar extremidades da linha" aria-description={`Seta inicial ${selected.startArrow ? 'presente' : 'ausente'}; seta final ${selected.endArrow ? 'presente' : 'ausente'}.`} disabled={!canEdit} onClick={() => updateSelected(swapWhiteboardLineEndpoints(selected))}>Trocar extremidades</button>
              <label className="field-label" htmlFor="line-start-marker">Marcação inicial</label>
              <select id="line-start-marker" aria-label="Marcação inicial" value={selected.startArrow ? 'arrow' : 'none'} disabled={!canEdit} onChange={event => updateSelected({ startArrow: event.target.value === 'arrow' })}><option value="none">Nenhuma</option><option value="arrow">Seta</option></select>
              <label className="field-label" htmlFor="line-end-marker">Marcação final</label>
              <select id="line-end-marker" aria-label="Marcação final" value={selected.endArrow ? 'arrow' : 'none'} disabled={!canEdit} onChange={event => updateSelected({ endArrow: event.target.value === 'arrow' })}><option value="none">Nenhuma</option><option value="arrow">Seta</option></select>
            </>}
          </> : selected.type === 'image' ? <>
            <div className="image-inspector"><span className="image-preview"><ImageIcon size={20} aria-hidden="true" /></span><p>Imagem adicionada ao documento</p><small>Arraste para mover ou use as alças para redimensionar.</small><button type="button" className="image-open-editor" onClick={() => { setImageEditNotice(''); setImageEditPanelOpen(true) }}>Editar imagem</button></div>
            <section className="alt-text-section" aria-label="Acessibilidade da imagem">
              {altTextEditorId !== selected.id ? <button type="button" className="alt-text-open" aria-expanded="false" onClick={() => { setAltTextDraft(selected.altText ?? ''); setAltTextDecorativeDraft(selected.decorative ?? false); setAltTextEditorId(selected.id) }}>Texto alternativo <span>{selected.decorative ? 'Decorativa' : selected.altText?.trim() ? 'Definido' : 'Adicionar'}</span></button> : <div className="alt-text-editor" aria-label="Editor de texto alternativo">
                <label htmlFor="image-alt-text">Descreva esta imagem</label>
                <textarea id="image-alt-text" aria-label="Texto alternativo" maxLength={250} rows={3} value={altTextDraft} disabled={!canEdit || altTextDecorativeDraft} onChange={event => setAltTextDraft(event.target.value)} placeholder="Descreva o conteúdo e a finalidade da imagem" />
                <div className="alt-text-count" aria-live="polite">{altTextDraft.length}/250</div>
                <label className="alt-text-decorative"><input type="checkbox" checked={altTextDecorativeDraft} disabled={!canEdit} onChange={event => setAltTextDecorativeDraft(event.target.checked)} /><span>Marcar como decorativa</span></label>
                <div className="alt-text-actions"><button type="button" onClick={() => setAltTextEditorId(null)}>Cancelar</button><button type="button" disabled={!canEdit} onClick={() => { updateSelected({ altText: altTextDecorativeDraft ? '' : altTextDraft.trim(), decorative: altTextDecorativeDraft }); setAltTextEditorId(null) }}>Salvar</button></div>
              </div>}
            </section>
            <div className="image-adjustment-heading"><span>Ajustar imagem</span><button type="button" disabled={!canEdit || (selected.opacity ?? 100) === 100 && (selected.brightness ?? 0) === 0 && (selected.contrast ?? 0) === 0 && (selected.saturation ?? 0) === 0 && !selected.filterPreset} onClick={() => { setImageOpacityDraft(null); updateSelected({ opacity: 100, brightness: 0, contrast: 0, saturation: 0, filterPreset: undefined }) }}>Redefinir ajustes</button></div>
            <ImageColorAdjustmentControls element={selected} prefix="image-inspector" canEdit={canEdit} onUpdate={updateSelected} />
            <button type="button" className="image-transparency-trigger" aria-expanded={imageTransparencyOpen} onClick={() => setImageTransparencyOpen(open => !open)}><Circle size={14} aria-hidden="true" /> Transparência <span>{selected.opacity ?? 100}</span></button>
            {imageTransparencyOpen && <div className="image-transparency-popover"><label htmlFor="image-opacity-slider">Transparência</label><div className="image-opacity-control"><input id="image-opacity-slider" aria-label="Transparência" type="range" min="0" max="100" step="1" value={selected.opacity ?? 100} disabled={!canEdit} onChange={event => { setImageOpacityDraft(null); updateSelected({ opacity: Number(event.target.value) }) }} /><input aria-label="Transparência" type="text" role="spinbutton" inputMode="numeric" value={imageOpacityDraft?.elementId === selected.id ? imageOpacityDraft.value : String(selected.opacity ?? 100)} disabled={!canEdit} onChange={event => setImageOpacityDraft({ elementId: selected.id, value: event.target.value.replace(/\D/g, '').slice(0, 3) })} onBlur={() => { if (imageOpacityDraft?.elementId !== selected.id) return; const value = Math.max(0, Math.min(100, Number(imageOpacityDraft.value) || 0)); setImageOpacityDraft(null); updateSelected({ opacity: value }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></div></div>}
            <div className="image-adjustment-heading"><span>Inverter</span><button type="button" className="image-flip-trigger" aria-expanded={imageFlipMenuOpen} aria-haspopup="true" onClick={() => setImageFlipMenuOpen(open => !open)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setImageFlipMenuOpen(open => !open) } }}><FlipHorizontal2 size={14} aria-hidden="true" /> Inverter</button></div>
            {imageFlipMenuOpen && <div className="image-flip-controls" role="menu"><button type="button" role="menuitem" disabled={!canEdit} onClick={() => updateSelected({ flipX: !selected.flipX })}><FlipHorizontal2 size={14} aria-hidden="true" /> Inverter horizontal</button><button type="button" role="menuitem" disabled={!canEdit} onClick={() => updateSelected({ flipY: !selected.flipY })}><FlipVertical2 size={14} aria-hidden="true" /> Inverter vertical</button></div>}
          </> : <div className="image-inspector"><span className="image-preview"><ImageIcon size={20} aria-hidden="true" /></span><p>Elemento selecionado</p></div>}
          <div className="inspector-divider" />
          <div className="position-grid"><label><span>X</span><input type="number" value={Math.round(selected.x)} disabled={!canEdit} onChange={event => updateSelected({ x: Number(event.target.value) })} /></label><label><span>Y</span><input type="number" value={Math.round(selected.y)} disabled={!canEdit} onChange={event => updateSelected({ y: Number(event.target.value) })} /></label></div>
        </> : <div className="inspector-empty"><div className="inspector-empty-icon"><Sparkles size={23} aria-hidden="true" /></div><h2>Selecione um elemento</h2><p>Escolha um item na página para editar texto, cor e posição.</p></div>}
      </aside>
      {imageEditPanelOpen && selected?.type === 'image' && <ImageEditPanel element={selected} canEdit={canEdit} compareOriginal={compareImageOriginal} initialNotice={imageEditNotice} initialMode={imageEditInitialMode} animationPlaying={videoPlaying && Boolean(selected.animation)} animationProgress={selected.animation && videoPlaying ? imageAnimationProgress(selected.animation) : 0} onAnimationPreview={() => { if (videoPlaying) setVideoPlaying(false); else { videoPlayheadRef.current = 0; setVideoPlayheadMs(0); setVideoPlaying(true) } }} onCompareChange={setCompareImageOriginal} onClose={() => { setCompareImageOriginal(false); setImageEditPanelOpen(false); setImageEditNotice('') }} onUpdate={patch => updateSelected(patch)} />}
      {imageCropOpen && selected?.type === 'image' && <ImageCropDialog element={selected} onClose={() => setImageCropOpen(false)} onApply={applyImageCrop} />}
      </>}
    </section>

    {assetPanelOpen && <div className="asset-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAssetPanelOpen(false) }}>
      <section className="asset-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-dialog-title">
        <header className="asset-dialog-heading"><div><span className="panel-kicker">{remoteTeamId ? 'ARQUIVOS DA EQUIPE' : 'SEUS ARQUIVOS'}</span><h2 id="asset-dialog-title">Biblioteca de mídia</h2></div><button className="asset-close" onClick={() => setAssetPanelOpen(false)} aria-label="Fechar biblioteca"><X size={18} /></button></header>
        <div className="asset-dialog-tools">
          <label className="project-search"><span><Search size={15} aria-hidden="true" /></span><input type="search" value={assetQuery} onChange={event => setAssetQuery(event.target.value)} placeholder="Buscar mídia" aria-label="Buscar mídia" /></label>
          <button className="asset-upload" onClick={() => imageInputRef.current?.click()} disabled={assetBusy}><Plus size={14} aria-hidden="true" /> {assetBusy ? 'Preparando…' : remoteTeamId ? 'Enviar para equipe' : 'Enviar imagem'}</button>
        </div>
        <div className="asset-category-list" aria-label="Categorias de ilustrações">
          {BUILT_IN_ILLUSTRATION_CATEGORIES.map(category => <button key={category} type="button" aria-pressed={assetCategory === category} onClick={() => setAssetCategory(category)}>{category}</button>)}
        </div>
        {assetError && <p className="asset-message" role="alert">{assetError}</p>}
        {assetBusy && <p className="asset-progress" role="status">Verificando a imagem e salvando na biblioteca…</p>}
        <div className="asset-library-scroll">
        {visibleIllustrations.length > 0 && <section className="asset-library-section" aria-label={'Ilustra\u00e7\u00f5es prontas'}><h3>Ilustrações prontas <span>{visibleIllustrations.length}</span></h3><div className="asset-grid">{visibleIllustrations.map(asset => <article className="asset-card" key={asset.id}>
          <button className="asset-use" onClick={() => void addBuiltInIllustration(asset.id)} disabled={assetBusy} aria-label={`Adicionar ${asset.name} ao design`}><img src={asset.src} alt="" /><span>{asset.name}</span><small>{asset.category}</small></button>
        </article>)}</div></section>}
        {visibleTeamAssets.length > 0 && <section className="asset-library-section" aria-label="Biblioteca da equipe"><h3>Biblioteca da equipe <span>{visibleTeamAssets.length}</span></h3><div className="asset-grid">{visibleTeamAssets.map(asset => <article className="asset-card" key={`team-${asset.id}`}>
          <button className="asset-use" onClick={() => void addTeamMediaAsset(asset)} disabled={assetBusy} aria-label={`Adicionar ${asset.name} da equipe ao design`}><img src={asset.src} alt="" /><span>{asset.name}</span><small>{asset.width} × {asset.height} - Equipe</small></button>
          {remoteRole === 'owner' && <button className="asset-remove" onClick={() => void removeTeamMediaAsset(asset)} aria-label={`Remover ${asset.name} da biblioteca da equipe`} title="Remover da equipe"><X size={18} /></button>}
        </article>)}</div></section>}
        {visibleAssets.length ? <section className="asset-library-section" aria-label="Seus uploads"><h3>Seus uploads <span>{visibleAssets.length}</span></h3><div className="asset-grid">{visibleAssets.map(asset => <article className="asset-card" key={asset.id}>
          <button className="asset-use" onClick={() => addMediaAsset(asset)} aria-label={`Adicionar ${asset.name} ao design`}><img src={asset.src} alt="" /><span>{asset.name}</span><small>{asset.width} × {asset.height}</small></button>
          <button className="asset-remove" onClick={() => void removeMediaAsset(asset)} aria-label={`Remover ${asset.name} da biblioteca`} title="Remover da biblioteca"><X size={18} /></button>
        </article>)}</div></section> : null}
        {!visibleIllustrations.length && !visibleTeamAssets.length && !visibleAssets.length && <div className="asset-empty"><ImageIcon size={22} aria-hidden="true" /><h3>{assetQuery ? 'Nenhuma mídia encontrada' : 'Sua biblioteca está vazia'}</h3><p>{assetQuery ? 'Tente outro termo ou categoria.' : 'Envie uma imagem para usar em vários designs.'}</p>{!assetQuery && <button disabled={assetBusy} onClick={() => imageInputRef.current?.click()}>Enviar primeira imagem</button>}</div>}
        </div>
        <footer className="asset-dialog-footer">{storageMode === 'cloud' ? remoteTeamId ? 'Mídias da equipe e deste projeto, compartilhadas conforme as permissões' : 'Biblioteca compartilhada com colaboradores autorizados' : 'Arquivos guardados neste navegador'} - até 10 MB e 32 megapixels - imagens idênticas reutilizam a mesma mídia</footer>
      </section>
    </div>}

    {remoteConflict && <div className="conflict-backdrop" role="presentation"><section className="conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
      <span className="conflict-icon"><RefreshCw size={19} aria-hidden="true" /></span><h2 id="conflict-title">Este projeto mudou em outra sessão</h2>
      <p>Para não sobrescrever as alterações da outra pessoa, carregue a versão mais recente ou salve seu trabalho como um projeto local separado.</p>
      <div><button className="conflict-reload" onClick={() => void reloadRemoteConflict()}>Carregar versão mais recente</button><button className="conflict-copy" onClick={() => void saveConflictAsLocalCopy()}>Salvar minha cópia neste dispositivo</button></div>
    </section></div>}

    {accessibilityOpen && <div className="accessibility-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAccessibilityOpen(false) }}><section ref={accessibilityDialogRef} className="accessibility-dialog" role="dialog" aria-modal="true" aria-labelledby="accessibility-title">
      <header><div><span className="panel-kicker">REVISÃO DO DESIGN</span><h2 id="accessibility-title">Acessibilidade</h2><p>Verificações locais para ajudar a revisar este projeto. Ãao substituem uma avaliação de conformidade.</p></div><button ref={accessibilityCloseRef} className="asset-close" type="button" onClick={() => setAccessibilityOpen(false)} aria-label="Fechar revisão de acessibilidade"><X size={18} /></button></header>
      <div className="accessibility-summary" aria-label="Contagem de itens por categoria">
        <button type="button" className={accessibilityFilter === 'alt' ? 'chosen' : ''} aria-pressed={accessibilityFilter === 'alt'} onClick={() => setAccessibilityFilter(accessibilityFilter === 'alt' ? 'all' : 'alt')}><strong>{accessibilityIssues.filter(issue => issue.kind === 'alt').length}</strong><span>Texto alternativo</span></button>
        <button type="button" className={accessibilityFilter === 'typography' ? 'chosen' : ''} aria-pressed={accessibilityFilter === 'typography'} onClick={() => setAccessibilityFilter(accessibilityFilter === 'typography' ? 'all' : 'typography')}><strong>{accessibilityIssues.filter(issue => issue.kind === 'typography').length}</strong><span>Texto pequeno</span></button>
        <button type="button" className="unavailable" disabled aria-label="Verificação de contraste indisponível"><strong>—</strong><span>Contraste - indisponível</span></button>
      </div>
      {saveStatus !== 'saved' && <p className="accessibility-save-note" role="status">Os totais mostram a última versão salva. Aguarde o salvamento para atualizar a revisão.</p>}
      <div className="accessibility-issue-heading"><strong>{accessibilityFilter === 'alt' ? 'Imagens sem descrição' : accessibilityFilter === 'typography' ? 'Textos pequenos' : 'Itens para revisar'}</strong><span>{accessibilityIssues.filter(issue => accessibilityFilter === 'all' || issue.kind === accessibilityFilter).length}</span></div>
      <div className="accessibility-issue-list">{accessibilityIssues.filter(issue => accessibilityFilter === 'all' || issue.kind === accessibilityFilter).map(issue => <article className="accessibility-issue" key={issue.id}>
        <label><input type="checkbox" aria-label={`Selecionar ${issue.title.toLocaleLowerCase('pt-BR')}: ${issue.elementName}, ${issue.pageName}`} checked={accessibilitySelectedIssues.includes(issue.id)} onChange={event => { const checked = event.currentTarget.checked; setAccessibilitySelectedIssues(selectedIds => checked ? [...new Set([...selectedIds, issue.id])] : selectedIds.filter(id => id !== issue.id)); if (!checked) setAccessibilityAltDrafts(drafts => { const next = { ...drafts }; delete next[issue.id]; return next }); setAccessibilityBatchAltOpen(false) }} /><span><strong>{issue.title}</strong><small>{issue.elementName} - {issue.pageName}</small><small>{issue.detail}</small></span></label>
        <button type="button" onClick={() => openAccessibilityIssue(issue)}>{issue.kind === 'alt' ? 'Adicionar descrição' : 'Revisar texto'}</button>
      </article>)}{accessibilityIssues.filter(issue => accessibilityFilter === 'all' || issue.kind === accessibilityFilter).length === 0 && <p className="accessibility-no-issues">Nenhum item nesta categoria na última versão salva.</p>}</div>
      {accessibilityBatchAltOpen && selectedAltIssues.length > 0 && <section className="accessibility-batch-alt-editor" role="region" aria-label="Editar descrições alternativas selecionadas" style={{ display: 'grid', gap: 8, maxHeight: 250, overflow: 'auto', flex: '0 1 auto', padding: 10, border: '1px solid #e8e5ef', borderRadius: 8, background: '#fdfcff' }}>
        <strong>Preencha uma descrição para cada imagem</strong>
        {selectedAltIssues.map(issue => { const value = accessibilityAltDrafts[issue.id] ?? ''; return <label key={issue.id} style={{ display: 'grid', gap: 4 }}><span style={{ color: '#504d61', fontSize: 11 }}>{issue.elementName} - {issue.pageName}</span><textarea aria-label={`Texto alternativo para ${issue.elementName}, ${issue.pageName}`} maxLength={250} rows={2} value={value} onChange={event => { const nextValue = event.currentTarget.value; setAccessibilityAltDrafts(drafts => ({ ...drafts, [issue.id]: nextValue })) }} placeholder="Descreva o conteúdo e a finalidade da imagem" style={{ width: '100%', boxSizing: 'border-box', padding: 8, border: '1px solid #dcd7ee', borderRadius: 6, color: '#353247', background: '#fff', font: 'inherit', resize: 'vertical' }} /><small aria-live="polite" style={{ color: '#777386', fontSize: 10 }}>{value.length}/250</small></label> })}
      </section>}
      <footer><span>{accessibilitySelectedIssues.length} selecionado(s)</span><div className="accessibility-review-actions"><button type="button" disabled={!accessibilitySelectedIssues.length} onClick={() => { const issue = accessibilityIssues.find(item => accessibilitySelectedIssues.includes(item.id)); if (issue) openAccessibilityIssue(issue) }}>Revisar seleção</button>{selectedAltIssues.length > 0 && <button type="button" className="accessibility-batch-alt-toggle" onClick={() => setAccessibilityBatchAltOpen(open => !open)} aria-expanded={accessibilityBatchAltOpen}>{accessibilityBatchAltOpen ? 'Fechar descrições' : 'Editar descrições'} ({selectedAltIssues.length})</button>}{accessibilityBatchAltOpen && selectedAltIssues.length > 0 && <button type="button" className="accessibility-batch-alt-save accessibility-batch-fix" disabled={!canEdit || saveStatus !== 'saved' || !canSaveSelectedAccessibilityAltText} onClick={saveSelectedAccessibilityAltText}>Salvar descrições ({selectedAltIssues.length})</button>}<button type="button" className="accessibility-batch-fix" disabled={!canEdit || saveStatus !== 'saved' || !selectedTypographyIssues.length} onClick={correctSelectedAccessibilityTypography}>Corrigir tipografia ({selectedTypographyIssues.length})</button></div></footer>
    </section></div>}
    {historyOpen && <div className="comments-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !restoringRevision) setHistoryOpen(false) }}><section className="comments-dialog history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <header><div><span className="panel-kicker">VERSÕES DO PROJETO</span><h2 id="history-title">Histórico</h2></div><button className="asset-close" onClick={() => setHistoryOpen(false)} aria-label="Fechar histórico" disabled={Boolean(restoringRevision)}><X size={18} /></button></header>
      <p className="comment-context">Cada restauração cria uma nova versão. Alterações locais pendentes precisam ser salvas antes de abrir o histórico.</p>
      {historyError && <p className="asset-message" role="alert">{historyError}</p>}
      <div className="history-version-list" aria-label="Versões salvas">{historyBusy ? <p role="status">Carregando versões…</p> : historyVersions.map(version => <article className="history-version" key={version.revision}>
        <div><strong>{version.name || 'Projeto sem título'}</strong><span>Versão {version.revision}{version.revision === historyCurrentRevision ? ' - atual' : ''}</span><small>{new Date(version.createdAt).toLocaleString('pt-BR')} - {version.createdByName ?? 'Colaborador'}</small></div>
        <div className="history-version-actions"><button type="button" disabled={Boolean(copyingRevision) || Boolean(restoringRevision)} onClick={() => void copyVersion(version)}>{copyingRevision === version.revision ? 'Copiando…' : 'Fazer uma cópia'}</button>{version.revision !== historyCurrentRevision && <button type="button" disabled={!canEdit || Boolean(restoringRevision) || Boolean(copyingRevision)} onClick={() => void restoreVersion(version)}>{restoringRevision === version.revision ? 'Restaurando…' : 'Restaurar'}</button>}</div>
      </article>)}</div>
      <footer>{historyCopiedDocument ? <><span>Cópia criada: {historyCopiedDocument.name}</span><button type="button" className="history-open-copy" onClick={() => onExit(historyCopiedDocument.id)}>Abrir cópia</button></> : 'O histórico mantém até 100 versões recentes do projeto.'}</footer>
    </section></div>}

      {aiOpen && <div className="comments-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !aiBusy) closeAiChat() }}><section className="comments-dialog ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-title">
<header><div><span className="panel-kicker">ASSISTENTE DE TEXTO</span><h2 id="ai-title">Criar um rascunho</h2></div><button className="asset-close" onClick={closeAiChat} aria-label="Fechar assistente de IA" disabled={aiBusy}><X size={18} /></button></header>
      <div role="tablist" aria-label="AI directory" className="ai-directory-tabs"><button ref={aiAppsTabRef} type="button" id="ai-apps-tab" role="tab" tabIndex={aiDirectoryTab === 'apps' ? 0 : -1} aria-selected={aiDirectoryTab === 'apps'} aria-controls="ai-apps-panel" onKeyDown={handleAiDirectoryTabKeyDown} onClick={() => setAiDirectoryTab('apps')}>Apps</button><button ref={aiConnectorsTabRef} type="button" id="ai-connectors-tab" role="tab" tabIndex={aiDirectoryTab === 'connectors' ? 0 : -1} aria-selected={aiDirectoryTab === 'connectors'} aria-controls="ai-connectors-panel" onKeyDown={handleAiDirectoryTabKeyDown} onClick={() => setAiDirectoryTab('connectors')}>Connectors</button></div>{aiDirectoryTab === 'connectors' ? <AIConnectorsPanel id="ai-connectors-panel" onBack={() => setAiDirectoryTab('apps')} onClose={() => { closeAiChat(); setAiDirectoryTab('apps') }} returnFocusRef={aiPromptInputRef} /> : <><section className="ai-quick-actions" aria-labelledby="ai-quick-actions-title"><h3 id="ai-quick-actions-title">O que você quer fazer com esse design?</h3><div><button type="button" disabled>Recrie essa página</button><button type="button" disabled>Adicione um fundo</button><button type="button" disabled>Altere o estilo</button><button type="button" disabled>Conectar um app</button></div></section><div className="ai-chat-log" role="log" aria-label="Conversa com Canva IA" aria-live="polite" aria-busy={aiBusy}>{aiConversation.length === 0 && <p className="ai-chat-empty">Comece uma conversa com o Canva IA.</p>}{aiConversation.map((message, index) => <article className={"ai-chat-message ai-chat-" + message.role} key={index}><strong>{message.role === 'user' ? 'Você' : 'Canva IA'}</strong>{message.brandKitName && <span className="ai-chat-brand-context">Marca aplicada: {message.brandKitName}</span>}{message.attachmentNames?.length ? <span className="ai-chat-brand-context">Anexos: {message.attachmentNames.join(', ')}</span> : null}<p>{message.text}</p>{message.role === 'assistant' && index === aiConversation.length - 1 && <div className="ai-chat-message-actions"><button className="conflict-copy" type="button" onClick={insertAiDraft}>Inserir no documento</button><button className="comment-anchor" type="button" onClick={() => void copyAiDraft()}>Copiar texto</button><span>{message.mode === 'sandbox' ? 'Demonstração local' : 'Provedor configurado'}</span></div>}</article>)}{aiBusy && <p className="ai-chat-loading" role="status">Canva IA - Carregando</p>}</div><form id="ai-apps-panel" role="tabpanel" aria-labelledby="ai-apps-tab" className="ai-form" onSubmit={event => void generateAiDraft(event)}><label className="visually-hidden" htmlFor="ai-prompt">Escreva para o Canva IA</label><textarea ref={aiPromptInputRef} id="ai-prompt" value={aiPrompt} maxLength={getAiPromptLimit(aiAppliedBrandContext, aiAttachments)} onChange={event => setAiPrompt(event.target.value)} aria-label="Escreva para o Canva IA" placeholder="Qual será nossa próxima tarefa?" required minLength={3} />{aiAttachments.length > 0 && <div className="ai-attachments-list" aria-label="Anexos do pedido">{aiAttachments.map(attachment => <span className="ai-attachment-chip" key={attachment.id}><span>{attachment.name}</span><button type="button" aria-label={`Remover anexo ${attachment.name}`} onClick={() => setAiAttachments(items => items.filter(item => item.id !== attachment.id))}>&times;</button></span>)}</div>}<AiComposerAttachments mode={aiAttachmentPickerMode} attachments={aiAttachments} onChange={setAiAttachments} onClose={() => setAiAttachmentPickerMode(null)} />{aiAppliedBrandContext && <div className="ai-brand-context-applied" role="status"><span><strong>Marca aplicada: {aiAppliedBrandContext.kitName}</strong><small>{aiAppliedBrandContext.summary}</small></span><button type="button" onClick={removeAiBrandContext}>Remover</button></div>}{aiBrandContextOpen && <section className="ai-brand-context" aria-label="Aplicar kit de marca" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelAiBrandContext() } }}><label htmlFor="ai-brand-kit-select">Kit de marca</label><select ref={aiBrandKitSelectRef} id="ai-brand-kit-select" aria-label="Kit de marca para a IA" value={aiBrandContextDraftKitId} onChange={event => setAiBrandContextDraftKitId(event.target.value)}>{BRAND_KITS.map(kit => <option key={kit.id} value={kit.id}>{kit.name}</option>)}</select><p>{getAiBrandContext(aiBrandContextDraftKitId)?.summary ?? 'Kit indisponível.'}</p>{!getAiBrandContext(aiBrandContextDraftKitId)?.hasResources && <small>Este kit ainda não tem paleta ou tipografia salvas.</small>}<div><button type="button" onClick={cancelAiBrandContext}>Cancelar</button><button type="button" disabled={!getAiBrandContext(aiBrandContextDraftKitId)?.hasResources} onClick={applyAiBrandContext}>Aplicar</button></div></section>}<div className="ai-form-actions"><div className="ai-add-menu-wrap" ref={aiAddMenuWrapRef}><button ref={aiAddMenuTriggerRef} className="ai-add-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={aiAddMenuOpen} aria-controls="ai-add-menu" onClick={() => { const opening = !aiAddMenuOpen; setAiAddMenuOpen(opening); if (opening) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#ai-add-menu [role="menuitem"]')?.focus()) }}><Plus size={14} aria-hidden="true" /> Adicione algo ao seu pedido</button>{aiAddMenuOpen && <div id="ai-add-menu" className="ai-add-menu" role="menu" aria-label="Adições ao pedido" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setAiAddMenuOpen(false); aiAddMenuTriggerRef.current?.focus() } else if (event.key === 'Tab') { const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); const index = items.indexOf(document.activeElement as HTMLButtonElement); if (event.shiftKey && index === 0) { event.preventDefault(); items.at(-1)?.focus() } else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus() } } }}><button type="button" role="menuitem" aria-disabled="false" onClick={() => openAiAttachmentPicker('upload')}>Fazer upload</button><button type="button" role="menuitem" aria-disabled="false" onClick={() => openAiAttachmentPicker('designs')}>Adicionar designs do Canva</button><button type="button" role="menuitem" aria-disabled="false" onClick={openAiBrandContext}>Aplicar a marca</button><button type="button" role="menuitem" aria-disabled="true" title="Ação ainda não conectada">Conectar apps</button></div>}</div><button className="ai-chat-voice" type="button" disabled>Chat por voz</button><button className="share-button" type="submit" disabled={aiBusy || storageMode !== 'cloud' || aiPrompt.trim().length < 3 || aiPrompt.trim().length > getAiPromptLimit(aiAppliedBrandContext, aiAttachments)}>{aiBusy ? 'Carregando' : 'Enviar'}</button></div></form>
      {aiError && <p className="asset-message" role="alert">{aiError}</p>}
      
      </>}
      <p className="comment-context">A conversa fica nesta sessão do navegador; não sincroniza com outros usuários nem com o servidor. Fechar o assistente limpa a conversa desta sessão.</p>
    </section></div>}

    {aiImageOpen && <div className="comments-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !aiImageBusy) setAiImageOpen(false) }}><section className="comments-dialog ai-dialog ai-image-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-image-title">
      <header><div><span className="panel-kicker">GERAÇÃO DE IMAGEM</span><h2 id="ai-image-title">Criar imagem</h2></div><button className="asset-close" type="button" onClick={() => setAiImageOpen(false)} aria-label="Fechar geração de imagem" disabled={aiImageBusy}><X size={18} /></button></header>
      {aiImageError && <p className="asset-message" role="alert">{aiImageError}</p>}
      <div className="ai-image-mode-tabs" role="tablist" aria-label="Modo de geração de imagem"><button type="button" role="tab" aria-selected={!aiImageDreamLabTab} onClick={() => setAiImageDreamLabTab(false)}>Geração</button><button type="button" role="tab" aria-selected={aiImageDreamLabTab} onClick={() => setAiImageDreamLabTab(true)}>Dream Lab</button></div>
      {aiImageDreamLabTab ? <DreamLabPanel generate={generateDreamLabImage} onInsert={insertDreamLabImage} /> : <>
      <form className="ai-form" onSubmit={event => void generateAiImage(event)}><label htmlFor="ai-image-prompt">Descreva a imagem</label><textarea id="ai-image-prompt" value={aiImagePrompt} maxLength={2000} minLength={3} required onChange={event => setAiImagePrompt(event.target.value)} placeholder="Ex.: ilustração editorial de uma cidade ao amanhecer" /><button className="share-button" type="submit" disabled={aiImageBusy || aiImagePrompt.trim().length < 3}>{aiImageBusy ? 'Gerando…' : 'Gerar prévia'}</button></form>
      {aiImagePreview && <section className="ai-image-preview" aria-label="Prévia da imagem gerada"><div className="ai-result-meta"><strong>Prévia - {aiImagePreview.width} × {aiImagePreview.height}</strong><span>{aiImagePreview.mode === 'sandbox' ? 'Sandbox determinístico - sem serviço externo' : 'Provedor configurado'}</span></div><img src={aiImagePreview.dataUrl} alt={`Prévia gerada para: ${aiImagePrompt}`} /><button className="conflict-copy" type="button" disabled={assetBusy} onClick={() => void insertAiImage()}>{assetBusy ? 'Inserindo…' : 'Inserir no projeto'}</button></section>}
      <p className="comment-context">A geração usa o sandbox visual determinístico no servidor por padrão. Um provedor externo só é chamado quando configurado no servidor. A imagem só entra no projeto após sua ação.</p>
      </>}
    </section></div>}

    {commentsOpen && <div className="comments-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCommentsOpen(false) }}><section className="comments-dialog" role="dialog" aria-modal="true" aria-labelledby="comments-title">
      <header><div><span className="panel-kicker">CONVERSA DO PROJETO</span><h2 id="comments-title">{notificationsOpen ? 'Notificações' : 'Comentários'}</h2></div><div className="comment-header-actions"><button className={`comment-notification-toggle${notificationsOpen ? ' is-active' : ''}`} type="button" onClick={() => setNotificationsOpen(value => !value)} aria-label={`Notificações${notificationsUnread ? `, ${notificationsUnread} não lidas` : ''}`} title="Notificações"><Bell size={17} />{notificationsUnread > 0 && <span>{notificationsUnread > 99 ? '99+' : notificationsUnread}</span>}</button><button className="asset-close" onClick={() => setCommentsOpen(false)} aria-label="Fechar comentários"><X size={18} /></button></div></header>
      {commentsError && <p className="asset-message" role="alert">{commentsError}</p>}
      {notificationsOpen && <div className="comments-list notifications-list" aria-label="Central de notificações">{commentNotifications.length ? commentNotifications.map(notification => <article className={`comment-notification${notification.readAt ? '' : ' is-unread'}`} key={notification.id}><button type="button" onClick={() => void openNotificationTarget(notification)}><span className="home-avatar">{notification.actorName.slice(0, 1).toUpperCase()}</span><span><strong>{notification.actorName}</strong> mencionou você em <strong>{notification.documentName}</strong><small>{notification.commentContent}</small><small>{formatShortDate(notification.createdAt)} - {notification.readAt ? 'Lida' : 'Não lida'}</small></span></button><button className="comment-anchor" type="button" onClick={() => void setRemoteNotificationRead(notification.id, !notification.readAt).then(result => { setCommentNotifications(items => items.map(item => item.id === notification.id ? { ...item, readAt: result.readAt } : item)); setNotificationsUnread(count => Math.max(0, count + (notification.readAt ? 1 : -1))) })}>{notification.readAt ? 'Marcar não lida' : 'Marcar lida'}</button></article>) : <p className="comments-empty">Você não tem notificações.</p>}</div>}
      <div className="comments-list" style={{ display: notificationsOpen ? 'none' : undefined }}>{commentsBusy && comments.length === 0 ? <p className="comments-empty">Carregando comentários…</p> : comments.filter(comment => !comment.parentId).map(comment => <article data-comment-id={comment.id} className={`comment-item${comment.resolvedAt ? ' comment-item-resolved' : ''}`} key={comment.id}>
        <span className="home-avatar">{comment.authorName.slice(0, 1).toUpperCase()}</span><div><div className="comment-meta"><strong>{comment.authorName}</strong><small>{formatShortDate(comment.createdAt)}</small></div>{comment.resolvedAt && <span className="comment-resolved-label">Resolvido</span>}<p>{comment.content.split(/(@[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g).map((part, index) => { const person = part.startsWith('@') ? commentCollaborators.find(item => item.email?.toLowerCase() === part.slice(1).toLowerCase()) : undefined; return person ? <span className="comment-mention" key={`${index}-${part}`} title={part}>{`@${person.name}`}</span> : part })}</p>{comment.elementId && <button className="comment-anchor" onClick={() => jumpToComment(comment)}>Ver elemento comentado</button>}
          {comments.filter(reply => reply.parentId === comment.id).map(reply => <div className="comment-reply" key={reply.id}><div className="comment-meta"><strong>{reply.authorName}</strong><small>{formatShortDate(reply.createdAt)}</small></div><p>{reply.content}</p></div>)}
          {canComment && <div className="comment-actions"><button className="comment-anchor" onClick={() => { setReplyTo(comment.id); setCommentDraft('') }}>Responder</button><button className="comment-anchor" onClick={() => void toggleCommentResolved(comment)} disabled={resolvingCommentId === comment.id}>{comment.resolvedAt ? 'Reabrir conversa' : 'Resolver'}</button></div>}
        </div>
      </article>)}{!commentsBusy && comments.length === 0 && <p className="comments-empty">Ainda não há comentários neste projeto.</p>}</div>
      {canComment ? <form className="comment-form" style={{ display: notificationsOpen ? 'none' : undefined }} onSubmit={event => void submitComment(event)}>{replyTo && <p className="comment-context">Respondendo à conversa <button type="button" className="comment-anchor" onClick={() => setReplyTo(null)}>Cancelar resposta</button></p>}<div className="comment-input-wrap"><textarea ref={commentInputRef} value={commentDraft} maxLength={5000} onChange={event => updateCommentDraft(event.target.value, event.target.selectionStart)} placeholder={replyTo ? 'Escreva uma resposta…' : state.selectedId ? 'Comente sobre o elemento selecionado…' : 'Escreva um comentário…'} aria-label={replyTo ? 'Resposta ao comentário' : 'Novo comentário'} required />{mentionQuery !== null && <div className="mention-suggestions" role="listbox" aria-label="Colaboradores para mencionar">{commentCollaborators.filter(person => person.email && person.id !== currentUserId && `${person.name} ${person.email}`.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6).map(person => <button type="button" role="option" key={person.id} onMouseDown={event => event.preventDefault()} onClick={() => insertCommentMention(person.email!)}><span className="home-avatar">{person.name.slice(0, 1).toUpperCase()}</span><span>{person.name}<small>{person.email}</small></span></button>)}{!commentCollaborators.some(person => person.email && person.id !== currentUserId && `${person.name} ${person.email}`.toLowerCase().includes(mentionQuery.toLowerCase())) && <p>Nenhum colaborador encontrado.</p>}</div>}</div><button type="submit" disabled={commentsBusy || !commentDraft.trim()}>Enviar</button></form> : <p className="comment-readonly">Seu acesso permite ler os comentários, mas não publicar.</p>}
      <p className="comment-context">{state.selectedId ? `Novo comentário vinculado a ${selected?.name ?? 'este elemento'}.` : `Novo comentário nesta página: ${page.name}.`}</p>
    </section></div>}

    {sitePreviewOpen && isSite && <SitePreviewOverlay document={state.document} onClose={() => setSitePreviewOpen(false)} />}
    {sitePublicationOpen && isSite && storageMode === 'cloud' && remoteRole === 'owner' && <SitePublicationDialog document={state.document} documentId={documentId} onClose={() => setSitePublicationOpen(false)} />}
    {presentationOpen && state.document.type === 'presentation' && <PresentationOverlay document={state.document} pageIndex={presentationPage} onPageChange={changePresentationPage} onClose={stopPresentation} canControlSlides={!followingPresentationId} />}
    {presenterNotesOpen && state.document.type === 'presentation' && <div className="presenter-notes-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPresenterNotesOpen(false) }}><section className="presenter-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="presenter-notes-title"><header><div><span className="panel-kicker">SLIDE {state.pageIndex + 1} DE {state.document.pages.length}</span><h2 id="presenter-notes-title">Notas do apresentador - {page.name}</h2></div><button className="asset-close" onClick={() => setPresenterNotesOpen(false)} aria-label="Fechar notas"><X size={18} /></button></header><textarea aria-label={`Notas do apresentador de ${page.name}`} maxLength={100000} value={page.presenterNotes ?? ''} disabled={!canEdit} onChange={event => { const notes = event.target.value; change(document => updatePage(document, state.pageIndex, current => ({ ...current, presenterNotes: notes }))); schedulePresenterNotes(page.id, notes) }} placeholder="Escreva lembretes e pontos de fala para este slide…" /><footer>{canEdit ? 'As notas são salvas junto com a apresentação e não aparecem no modo de apresentação.' : 'Notas em modo somente leitura.'}</footer></section></div>}

    {!isDoc && <nav className="mobile-tools" aria-label="Ferramentas móveis">
      <button ref={mobileEditorToolsTriggerRef} id="mobile-editor-tools-trigger" className={editorToolsOpen ? 'mobile-tool-active mobile-tools-launcher' : 'mobile-tools-launcher'} type="button" aria-controls="editor-tools-panel" aria-expanded={editorToolsOpen} onClick={() => setEditorToolsOpen(open => !open)}><Shapes size={17} aria-hidden="true" />Ferramentas</button>
      <button onClick={() => dispatch({ type: 'select', id: null })}><MousePointer2 size={17} aria-hidden="true" />Selecionar</button>
      {isWhiteboard && <button className={multiSelectMode ? 'mobile-tool-active' : ''} aria-pressed={multiSelectMode} onClick={toggleMultipleSelection}><LayoutGrid size={17} aria-hidden="true" />Vários</button>}
      {canCreateGroup && <button onClick={groupSelectedElements} disabled={!canEdit}><GroupIcon size={17} aria-hidden="true" />Agrupar</button>}
      {selectedGroup && <button onClick={ungroupSelectedElements} disabled={!canEdit}><UngroupIcon size={17} aria-hidden="true" />Desagrupar</button>}
      {isWhiteboard && state.selectedIds.length > 1 && <select className="mobile-arrangement-select" aria-label="Alinhar ou distribuir seleção" defaultValue="" disabled={!canEdit} onChange={arrangeSelection}><option value="">Alinhar…</option><option value="left">Esquerda</option><option value="center-x">Centro horizontal</option><option value="right">Direita</option><option value="top">Topo</option><option value="center-y">Centro vertical</option><option value="bottom">Base</option><option value="distribute-x" disabled={state.selectedIds.length < 3}>Distribuir horizontal</option><option value="distribute-y" disabled={state.selectedIds.length < 3}>Distribuir vertical</option></select>}
      {isWhiteboard && <button className={whiteboardTool === 'pan' ? 'mobile-tool-active' : ''} aria-pressed={whiteboardTool === 'pan'} onClick={toggleWhiteboardPan}><Move size={17} aria-hidden="true" />Mover</button>}
      {isWhiteboard && <button className={whiteboardTool === 'connector' ? 'mobile-tool-active' : ''} aria-pressed={whiteboardTool === 'connector'} onClick={toggleConnectorTool}><ArrowUpRight size={17} aria-hidden="true" />Conector</button>}
      {isWhiteboard && <button className={whiteboardTool === 'draw' ? 'mobile-tool-active' : ''} aria-pressed={whiteboardTool === 'draw'} onClick={toggleWhiteboardDraw}><Pencil size={17} aria-hidden="true" />Desenhar</button>}
      {state.selectedIds.length > 0 && <button onClick={duplicateSelected} disabled={!canEdit}><Copy size={17} aria-hidden="true" />Duplicar</button>}
      {state.selectedIds.length > 0 && <button onClick={removeSelected} disabled={!canEdit}><Trash2 size={17} aria-hidden="true" />Excluir</button>}
      <button onClick={addText} disabled={!canEdit}><Type size={17} aria-hidden="true" />Texto</button>
      {isWhiteboard && <button onClick={addStickyNote} disabled={!canEdit}><Sticker size={17} aria-hidden="true" />Nota</button>}
      <button onClick={() => addShape('rect')} disabled={!canEdit}><Square size={17} aria-hidden="true" />Forma</button>
      <select className="mobile-shape-select" aria-label="Inserir forma vetorial" defaultValue="" disabled={!canEdit} onChange={event => { if (event.target.value) addShape(event.target.value as VectorShapeKind); event.currentTarget.value = '' }}><option value="" disabled>Mais formas</option>{VECTOR_SHAPES.filter(shape => shape !== 'rect').map(shape => <option value={shape} key={shape}>{VECTOR_SHAPE_LABELS[shape]}</option>)}</select>
      <button onClick={() => setAssetPanelOpen(open => !open)} aria-expanded={assetPanelOpen} disabled={!canEdit}><ImageIcon size={17} aria-hidden="true" />Imagem</button>
      <button onClick={addPage} disabled={!canEdit}><Plus size={17} aria-hidden="true" />Página</button>
      {state.document.type === 'presentation' && <button onClick={startPresentation}><Presentation size={17} aria-hidden="true" />Apresentar</button>}
      {remotePresentation && <button onClick={followRemotePresentation}><Play size={17} aria-hidden="true" />Seguir</button>}
      {state.document.type === 'presentation' && <button onClick={() => setPresenterNotesOpen(true)}><Sticker size={17} aria-hidden="true" />Notas</button>}
      <button onClick={() => void openComments()} disabled={storageMode !== 'cloud'}><MessageCircle size={17} aria-hidden="true" />Comentários</button>
    </nav>}
  </main>
}

function ProjectPreview({ document }: { document: DesignDocument }) {
  const page = document.pages[0]
  return <div className="project-preview" aria-hidden="true">
    <div className="project-page" style={{ background: page?.background ?? '#fff' }}>
      {document.type === 'doc' && <div className="project-doc-preview"><strong>{document.name}</strong>{(page?.blocks ?? []).slice(0, 4).map(block => <span key={block.id} className={`project-doc-${block.type}`}>{block.text || (block.type === 'heading' ? 'Título do documento' : 'Comece a escrever…')}</span>)}</div>}
      {!!page?.connectors?.length && <svg className="preview-connectors" viewBox={`0 0 ${document.width} ${document.height}`} preserveAspectRatio="none" aria-hidden="true">{page.connectors.map(connector => {
        const points = connectorPoints(page, connector)
        if (!points) return null
        return <g key={connector.id}><defs><marker id={`preview-arrow-${connector.id}`} markerWidth="32" markerHeight="32" refX="28" refY="16" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 32 16 L 0 32 z" fill={connector.color} /></marker></defs><line x1={points[0]} y1={points[1]} x2={points[2]} y2={points[3]} stroke={connector.color} strokeWidth={Math.max(connector.strokeWidth, 18)} markerEnd={`url(#preview-arrow-${connector.id})`} /></g>
      })}</svg>}
      {document.type !== 'doc' && (page?.elements ?? []).slice(0, 8).map(element => {
        const style = {
          left: `${element.x / document.width * 100}%`,
          top: `${element.y / document.height * 100}%`,
          width: `${element.width / document.width * 100}%`,
          height: `${element.height / document.height * 100}%`,
          transform: `rotate(${element.rotation}deg)`,
        }
        if (element.type === 'sticky-note') return <span key={element.id} className="preview-shape preview-sticky-note" style={{ ...style, background: element.fill, color: element.color, fontSize: `${Math.max(4, element.fontSize * 176 / document.height)}px`, padding: 3, overflow: 'hidden' }}>{element.text}</span>
        if (element.type === 'free-draw') return <svg key={element.id} className="preview-stroke" style={style} viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none"><polyline points={Array.from({ length: element.points.length / 2 }, (_, index) => `${element.points[index * 2]},${element.points[index * 2 + 1]}`).join(' ')} fill="none" stroke={element.color} strokeWidth={element.strokeWidth} opacity={element.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" /></svg>
        if (element.type === 'shape') return <VectorShapePreview key={element.id} element={element} className="preview-shape" style={{ ...style, borderRadius: element.shape === 'ellipse' ? '50%' : `${element.cornerRadius / document.width * 100}%` }} />
        if (element.type === 'image') return <img key={element.id} className="preview-image" src={element.src} style={style} alt="" />
        return <span key={element.id} className="preview-text" style={{ ...style, color: element.color, fontSize: `${Math.max(4, element.fontSize * 176 / document.height)}px`, fontWeight: element.bold ? 700 : 400 }}>{element.text}</span>
      })}
      {document.type !== 'doc' && !page?.elements.length && <span className="preview-empty-mark" aria-hidden="true"><Sparkles size={25} strokeWidth={1.8} /></span>}
    </div>
  </div>
}

function PublicShareViewer({ token, onClose }: { token: string; onClose: () => void }) {
  const [sharedName, setSharedName] = useState('')
  const [pageImages, setPageImages] = useState<string[]>([])
  const [videoOverlay, setVideoOverlay] = useState('')
  const [sharedDocument, setSharedDocument] = useState<DesignDocument | null>(null)
  const [timelineMedia, setTimelineMedia] = useState<Record<string, { name: string; mimeType: string; width: number; height: number; src: string }>>({})
  const [playhead, setPlayhead] = useState(0)
  const playheadRef = useRef(0)
  const [playbackEpoch, setPlaybackEpoch] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  useEffect(() => {
    let cancelled = false
    getPublicSharedDocument(token).then(async result => {
      const pages = result.document.type === 'site' ? result.document.pages.filter(page => !page.hidden) : result.document.pages
      setSharedDocument(result.document)
      setTimelineMedia(result.timelineMedia ?? {})
      if (result.document.type === 'video') {
        setPageImages([])
        if (!cancelled) setSharedName(result.name)
        return
      }
      const images: string[] = []
      for (const page of pages) {
        const canvas = await renderPageCanvas(result.document, page)
        if (cancelled) return
        images.push(canvas.toDataURL('image/png'))
        setPageImages([...images])
      }
      if (!cancelled) setSharedName(result.name)
    }).catch(() => {
      if (!cancelled) setError('Este link foi revogado, está suspenso ou não existe.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  const inferredDuration = Math.max(10_000, ...((sharedDocument?.pages ?? []).flatMap(page => page.timelineClips ?? []).map(clip => clip.startMs + clip.durationMs)))
  const sceneDuration = Math.max(1000, Math.min(86_400_000, sharedDocument?.videoDurationMs ?? inferredDuration))
  const sceneCount = Math.max(1, sharedDocument?.pages.length ?? 1)
  const videoDuration = Math.min(86_400_000, sceneDuration * sceneCount)
  const sceneIndex = Math.min(sceneCount - 1, Math.floor(playhead / sceneDuration))
  const scenePlayhead = Math.min(sceneDuration, playhead - sceneIndex * sceneDuration)
  const currentPage = sharedDocument?.pages[sceneIndex]
  const clips = currentPage?.timelineClips ?? EMPTY_VIDEO_TIMELINE_CLIPS
  const activeElements = currentPage?.elements.filter(element => {
    const start = element.startMs ?? 0
    const end = start + (element.durationMs ?? sceneDuration)
    return scenePlayhead >= start && scenePlayhead < end
  }) ?? []
  const activeElementKey = activeElements.map(element => element.id).join('|')
  const activeVideos = clips.filter(clip => clip.kind === 'video' && scenePlayhead >= clip.startMs && scenePlayhead < clip.startMs + clip.durationMs)
    .sort((left, right) => (left.trackIndex ?? 0) - (right.trackIndex ?? 0) || left.startMs - right.startMs || left.id.localeCompare(right.id))
  const activeVideoMedia = activeVideos.map(clip => ({ clip, media: timelineMedia[clip.assetId] })).filter((entry): entry is { clip: VideoTimelineClip; media: { name: string; mimeType: string; width: number; height: number; src: string } } => Boolean(entry.media))

  useEffect(() => {
    if (!sharedDocument || sharedDocument.type !== 'video' || !currentPage) return
    let cancelled = false
    const activeIds = new Set(activeElementKey ? activeElementKey.split('|') : [])
    const page = { ...currentPage, elements: currentPage.elements.filter(element => activeIds.has(element.id)) }
    renderPageCanvas(sharedDocument, page, null).then(canvas => {
      if (!cancelled) setVideoOverlay(canvas.toDataURL('image/png'))
    }).catch(() => { if (!cancelled) setVideoOverlay('') })
    return () => { cancelled = true }
  }, [sharedDocument, currentPage, sceneIndex, activeElementKey, sceneDuration])

  useEffect(() => {
    if (!playing) return
    const startedAt = performance.now()
    const startingPosition = playheadRef.current
    let frame = 0
    const tick = (now: number) => {
      const next = startingPosition + now - startedAt
      if (next >= videoDuration) { playheadRef.current = videoDuration; setPlayhead(videoDuration); setPlaying(false); return }
      playheadRef.current = next
      setPlayhead(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, videoDuration, playbackEpoch])

  useEffect(() => {
    const activeIds = new Set(activeVideoMedia.map(entry => entry.clip.id))
    for (const clip of clips.filter(item => item.kind === 'video')) {
      const video = videoRefs.current[clip.id]
      if (!video) continue
      if (!activeIds.has(clip.id)) { if (!video.paused) video.pause(); continue }
      const targetTime = (clip.sourceStartMs + scenePlayhead - clip.startMs) / 1000
      if (Number.isFinite(video.duration) && Math.abs(video.currentTime - targetTime) > 0.4) video.currentTime = Math.min(targetTime, Math.max(0, video.duration - 0.04))
      video.volume = clip.volume
      if (playing && video.paused) void video.play().catch(() => undefined)
      else if (!playing && !video.paused) video.pause()
    }
    for (const clip of clips.filter(item => item.kind === 'audio')) {
      const audio = audioRefs.current[clip.id]
      if (!audio) continue
      const playback = getAudioClipPlaybackState(clip, scenePlayhead)
      if (!playback.active || playback.sourceTimeMs === null) { if (!audio.paused) audio.pause(); continue }
      const targetTime = playback.sourceTimeMs / 1000
      if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - targetTime) > 0.4) audio.currentTime = Math.min(targetTime, Math.max(0, audio.duration - 0.02))
      audio.volume = playback.gain
      if (playing && audio.paused) void audio.play().catch(() => undefined)
      else if (!playing && !audio.paused) audio.pause()
    }
  }, [activeVideoMedia, scenePlayhead, playing, clips, timelineMedia])

  return <main className="public-share-shell">
    <header className="public-share-header"><span className="public-share-brand"><span className="brand-mark">f</span> fuse<span>studio</span></span><span>Visualização compartilhada</span><button type="button" onClick={onClose}>Fechar</button></header>
    <div className="public-share-content">{sharedName && <h1>{sharedName}</h1>}{loading && !pageImages.length && <p role="status">Carregando visualização…</p>}{error && <p role="alert">{error}</p>}
      {sharedDocument?.type !== 'video' && pageImages.map((src, index) => <figure className="public-share-page" key={`${token}-${index}`}><img src={src} alt={`${sharedName || 'Projeto compartilhado'}, página ${index + 1}`} /><figcaption>Página {index + 1}</figcaption></figure>)}
      {sharedDocument?.type === 'video' && currentPage && <section className="public-share-video" aria-label="Prévia do vídeo compartilhado">
        <div className="public-share-video-stage" style={{ aspectRatio: `${sharedDocument.width} / ${sharedDocument.height}` }}>
          {activeVideoMedia.map(({ clip, media }) => {
            const transform = getVideoClipTransform(clip, scenePlayhead - clip.startMs)
            const layout = getVideoClipLayout({ ...clip, ...transform }, sharedDocument?.width ?? 160, sharedDocument?.height ?? 90, media.width, media.height)
            const viewportStyle: CSSProperties = { zIndex: 1 + (clip.trackIndex ?? 0), opacity: getVideoClipOpacity(clip, scenePlayhead - clip.startMs) / 100 }
            const mediaStyle: CSSProperties = { left: `${layout.x / (sharedDocument?.width ?? 160) * 100}%`, top: `${layout.y / (sharedDocument?.height ?? 90) * 100}%`, width: `${layout.width / (sharedDocument?.width ?? 160) * 100}%`, height: `${layout.height / (sharedDocument?.height ?? 90) * 100}%`, zIndex: 1 + (clip.trackIndex ?? 0) }
            return <div key={clip.id} className="public-share-video-track-viewport" style={viewportStyle}><video ref={node => { videoRefs.current[clip.id] = node }} className="public-share-video-media" src={media.src} aria-label={`Pr\u00e9via da faixa ${((clip.trackIndex ?? 0) + 1)}: ${media.name}`} playsInline preload="auto" style={mediaStyle} /></div>
          })}
          {!activeVideoMedia.length && <div className="public-share-video-empty">{clips.length ? 'Não há mídia ativa neste trecho.' : 'Este vídeo ainda não tem clipes na timeline.'}</div>}
          {videoOverlay && <img className="public-share-video-overlay" src={videoOverlay} alt={`Elementos visuais ativos da cena ${sceneIndex + 1}`} />}
          {clips.filter(clip => clip.kind === 'audio').map(clip => { const media = timelineMedia[clip.assetId]; return media ? <audio key={clip.id} ref={element => { audioRefs.current[clip.id] = element }} src={media.src} preload="auto" /> : null })}
        </div>
        <div className="public-share-video-controls"><button type="button" aria-label={playing ? 'Pausar vídeo' : 'Reproduzir vídeo'} onClick={() => { if (playhead >= videoDuration) { playheadRef.current = 0; setPlayhead(0) } setPlaying(value => !value) }}>{playing ? 'Pausar' : 'Reproduzir'}</button><span className="public-share-scene-label">Cena {sceneIndex + 1} / {sceneCount}</span><span>{(playhead / 1000).toFixed(1)} s</span><input aria-label="Posição da reprodução" type="range" min="0" max={videoDuration} step="50" value={Math.min(playhead, videoDuration)} onChange={event => { const next = Number(event.target.value); playheadRef.current = next; setPlayhead(next); setPlaybackEpoch(value => value + 1) }} /><span>{(videoDuration / 1000).toFixed(1)} s</span></div>
      </section>}
    </div>
    <footer className="public-share-footer">Acesso somente para visualização. Faça login e peça acesso ao proprietário para editar.</footer>
  </main>
}

const DRAWING_PREFERENCES_KEY = 'fuse-drawing-preferences-v1'

function readDrawingPreferences(): { implement: DrawingTool; color: string; size: number } {
  try {
    const value = JSON.parse(window.localStorage.getItem(DRAWING_PREFERENCES_KEY) ?? 'null') as { implement?: unknown; color?: unknown; size?: unknown } | null
    const implement = ['Lápis', 'Caneta', 'Marcador', 'Borracha'].includes(String(value?.implement)) ? value!.implement as DrawingTool : 'Caneta'
    const color = normalizeDrawingColor(typeof value?.color === 'string' ? value.color : '#e7191f')
    const size = typeof value?.size === 'number' && Number.isFinite(value.size) ? Math.max(1, Math.min(20, value.size)) : 4
    return { implement, color, size }
  } catch {
    return { implement: 'Caneta', color: '#e7191f', size: 4 }
  }
}

function App() {
  const [documents, setDocuments] = useState<DesignDocument[]>([])
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([])
  const [remoteProjectFolders, setRemoteProjectFolders] = useState<RemoteProjectFolder[]>([])
  const [copyingProjectFolderId, setCopyingProjectFolderId] = useState<string | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => window.location.pathname.match(/^\/(?:folder|cloud-folder)\/([^/]+)$/)?.[1] ?? null)
  const [activeFolderCloud, setActiveFolderCloud] = useState(() => window.location.pathname.startsWith('/cloud-folder/'))
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [folderTeamScopeId, setFolderTeamScopeId] = useState('')
  const [folderNameEditing, setFolderNameEditing] = useState(false)
  const folderRenameCancelledRef = useRef(false)
  const [folderDetailsOpen, setFolderDetailsOpen] = useState(() => !window.location.pathname.startsWith('/cloud-folder/'))
  const [folderFavoritesOnly, setFolderFavoritesOnly] = useState(false)
  const [pendingMoveDocument, setPendingMoveDocument] = useState<DesignDocument | null>(null)
  const [moveFolderQuery, setMoveFolderQuery] = useState('')
  const [remoteDocuments, setRemoteDocuments] = useState<RemoteDocument[]>([])
  const [teams, setTeams] = useState<RemoteTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [teamDialogOpen, setTeamDialogOpen] = useState(false)
  const [domainDialogOpen, setDomainDialogOpen] = useState(false)
  const [domainDraft, setDomainDraft] = useState('')
  const [teamIntegrationsOpen, setTeamIntegrationsOpen] = useState(false)
  const [teamIntegrationIdsByTeam, setTeamIntegrationIdsByTeam] = useState<Record<string, string[]>>({})
  const [teamDialogMembers, setTeamDialogMembers] = useState<RemoteTeamMember[]>([])
  const [teamMemberBusyId, setTeamMemberBusyId] = useState<string | null>(null)
  const [teamInvitations, setTeamInvitations] = useState<RemoteTeamInvitation[]>([])
  const [teamInvitationBusyId, setTeamInvitationBusyId] = useState<string | null>(null)
  const [teamAuditEvents, setTeamAuditEvents] = useState<RemoteAuditEvent[]>([])
  const [teamAuditCursor, setTeamAuditCursor] = useState<string | null>(null)
  const [teamAuditBusy, setTeamAuditBusy] = useState(false)
  const [teamInviteLink, setTeamInviteLink] = useState('')
  const [teamInviteNotice, setTeamInviteNotice] = useState('')
  const [teamError, setTeamError] = useState('')
  const [receivedTeamInvitation, setReceivedTeamInvitation] = useState<ReceivedTeamInvitation | null>(null)
  const [teamInvitationToken, setTeamInvitationToken] = useState(() => new URLSearchParams(window.location.search).get('teamInvite') ?? '')
  const [activeId, setActiveId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/design\/([^/]+)(?:\/edit)?\/?$/)
    if (!match) return null
    try { return decodeURIComponent(match[1]) } catch { return null }
  })
  const [activeStorageMode, setActiveStorageMode] = useState<'local' | 'cloud'>(() => new URLSearchParams(window.location.search).get('storage') === 'cloud' ? 'cloud' : 'local')
  const [libraryMode, setLibraryMode] = useState<'local' | 'cloud'>(() => window.location.pathname.startsWith('/cloud-folder/') ? 'cloud' : 'local')
  const [user, setUser] = useState<StudioUser | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return window.localStorage.getItem('fuse-account-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  const [homeNotifications, setHomeNotifications] = useState<RemoteNotification[]>([])
  const [homeNotificationsUnread, setHomeNotificationsUnread] = useState(0)
  const [homeNotificationsOpen, setHomeNotificationsOpen] = useState(false)
  const [homeNotificationsError, setHomeNotificationsError] = useState('')
  const [homeSection, setHomeSection] = useState<'home' | 'projects'>(() => window.location.hash === '#home-projects' ? 'projects' : 'home')
  const [authOpen, setAuthOpen] = useState(() => new URLSearchParams(window.location.search).has('resetPassword'))
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'request-reset' | 'reset-sent' | 'complete-reset'>(() => new URLSearchParams(window.location.search).has('resetPassword') ? 'complete-reset' : 'login')
  const [authResetToken, setAuthResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetPassword') ?? '')
  const [authNotice, setAuthNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [shareDocument, setShareDocument] = useState<RemoteDocument | null>(null)
  const [shareSubview, setShareSubview] = useState<'summary' | 'settings' | 'people'>('summary')
  const [sharePublicLinkEnabled, setSharePublicLinkEnabled] = useState(false)
  const [createdPublicShareUrl, setCreatedPublicShareUrl] = useState('')
  const [publicShareToken, setPublicShareToken] = useState(() => new URLSearchParams(window.location.search).get('view') ?? '')
  const shareTriggerRef = useRef<HTMLElement | null>(null)
  const shareCloseRef = useRef<HTMLButtonElement | null>(null)
  const [sharePermissions, setSharePermissions] = useState<RemotePermission[]>([])
  const [shareInvitations, setShareInvitations] = useState<RemoteInvitation[]>([])
  const [createdInvitationLink, setCreatedInvitationLink] = useState('')
  const [receivedInvitation, setReceivedInvitation] = useState<ReceivedRemoteInvitation | null>(null)
  const [invitationToken, setInvitationToken] = useState(() => new URLSearchParams(window.location.search).get('invite') ?? '')
  const [invitationBusy, setInvitationBusy] = useState(false)
  const [invitationError, setInvitationError] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState('')
  const [shareNotice, setShareNotice] = useState('')
  const [remoteBusy, setRemoteBusy] = useState(true)
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('query') ?? new URLSearchParams(window.location.search).get('q') ?? '')
  const [folderTypeFilter, setFolderTypeFilter] = useState<'all' | NonNullable<DesignDocument['type']>>('all')
  const [folderSort, setFolderSort] = useState<'recent' | 'name'>('recent')
  const [appsMarketplaceOpen, setAppsMarketplaceOpen] = useState(() => window.location.pathname === '/your-apps' || window.location.pathname.startsWith('/your-apps/'))
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(() => new URLSearchParams(window.location.search).get('templates') === '1')
  const [templateQuery, setTemplateQuery] = useState(() => new URLSearchParams(window.location.search).get('template_query') ?? '')
  const [templateLanguage, setTemplateLanguage] = useState<'all' | 'pt'>(() => new URLSearchParams(window.location.search).get('template_language') === 'pt' ? 'pt' : 'all')
  const [templateCategory, setTemplateCategory] = useState(() => new URLSearchParams(window.location.search).get('template_category') ?? 'all')
  const [templateType, setTemplateType] = useState<StarterTemplateType>(() => STARTER_TEMPLATE_TYPES.includes(new URLSearchParams(window.location.search).get('template_type') as StarterTemplateType) ? new URLSearchParams(window.location.search).get('template_type') as StarterTemplateType : 'all')
  const [templatePalette, setTemplatePalette] = useState<StarterTemplatePalette>(() => STARTER_TEMPLATE_PALETTES.includes(new URLSearchParams(window.location.search).get('template_palette') as StarterTemplatePalette) ? new URLSearchParams(window.location.search).get('template_palette') as StarterTemplatePalette : 'all')
  const [templateLicense, setTemplateLicense] = useState<StarterTemplateLicense>(() => STARTER_TEMPLATE_LICENSES.includes(new URLSearchParams(window.location.search).get('template_license') as StarterTemplateLicense) ? new URLSearchParams(window.location.search).get('template_license') as StarterTemplateLicense : 'all')
  const [selectedTemplateId, setSelectedTemplateId] = useState<StarterTemplateId | null>(null)
  const [templatePreviewPageIndex, setTemplatePreviewPageIndex] = useState(0)
  const [templateActionMenuOpen, setTemplateActionMenuOpen] = useState(false)
  const templateReturnFocusRef = useRef<HTMLElement | null>(null)
  const templatePreviewReturnFocusRef = useRef<HTMLElement | null>(null)
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState<string[]>([])
  const [projectFilter, setProjectFilter] = useState<'recent' | 'archived' | 'trash'>('recent')
  const [projectsFilters, setProjectsFilters] = useState<ProjectsFilters>(() => readProjectsFilters(window.location.search))
  const [designSearchScope, setDesignSearchScope] = useState(() => new URLSearchParams(window.location.search).has('adj'))
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<{ mode: 'local'; id: string; name: string; updatedAt: string } | { mode: 'cloud'; id: string; name: string; revision: number } | null>(null)
  const [permanentDeleteBusy, setPermanentDeleteBusy] = useState(false)
  const [pendingTrashEmpty, setPendingTrashEmpty] = useState<{ mode: 'local'; documents: Array<{ id: string; updatedAt: string }>; count: number } | { mode: 'cloud'; documents: Array<{ id: string; revision: number }>; count: number } | null>(null)
  const [trashEmptyBusy, setTrashEmptyBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [remoteError, setRemoteError] = useState('')
  const [csvImportBusy, setCsvImportBusy] = useState(false)
  const [csvImportError, setCsvImportError] = useState('')
  const csvInputRef = useRef<HTMLInputElement>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)
  const pptxInputRef = useRef<HTMLInputElement>(null)
  const anyImportInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([listDocuments(), listProjectFolders()])
      .then(([savedDocuments, savedFolders]) => { setDocuments(savedDocuments); setProjectFolders(savedFolders) })
      .catch(() => setError('Não foi possível abrir seus projetos neste dispositivo.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onPopState = () => {
      setActiveFolderId(window.location.pathname.match(/^\/(?:folder|cloud-folder)\/([^/]+)$/)?.[1] ?? null)
      setActiveFolderCloud(window.location.pathname.startsWith('/cloud-folder/'))
      const match = window.location.pathname.match(/^\/design\/([^/]+)(?:\/edit)?\/?$/)
      if (match) {
        try { setActiveId(decodeURIComponent(match[1])) } catch { setActiveId(null) }
        setActiveStorageMode(new URLSearchParams(window.location.search).get('storage') === 'cloud' ? 'cloud' : 'local')
      } else setActiveId(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const isDesignRoute = /^\/design\/[^/]+(?:\/edit)?\/?$/.test(window.location.pathname)
    if (activeId) {
      const pathname = `/design/${encodeURIComponent(activeId)}/edit`
      const search = activeStorageMode === 'cloud' ? '?storage=cloud' : ''
      if (`${window.location.pathname}${window.location.search}` !== `${pathname}${search}`) window.history.pushState({}, '', `${pathname}${search}`)
    } else if (isDesignRoute) window.history.pushState({}, '', '/#home-projects')
  }, [activeId, activeStorageMode])

  useEffect(() => {
    if (!templateGalleryOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (templateActionMenuOpen) setTemplateActionMenuOpen(false)
        else if (selectedTemplateId) setSelectedTemplateId(null)
        else closeTemplateGallery()
        return
      }
      if (event.key !== 'Tab') return
      const topLayer = document.querySelector<HTMLElement>(selectedTemplateId ? '.template-preview-dialog' : '.template-dialog')
      const focusable = topLayer ? [...topLayer.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')].filter(element => element.getAttribute('aria-hidden') !== 'true') : []
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !topLayer?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !topLayer?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [templateGalleryOpen, templateActionMenuOpen, selectedTemplateId, templateQuery, templateLanguage, templateCategory, templateType, templatePalette, templateLicense])

  useLayoutEffect(() => {
    if (!templateGalleryOpen) {
      const returnTarget = templateReturnFocusRef.current
      if (returnTarget?.isConnected) returnTarget.focus()
      templateReturnFocusRef.current = null
      return
    }
    if (selectedTemplateId) {
      document.querySelector<HTMLButtonElement>('.template-preview-close')?.focus()
      return
    }
    if (templatePreviewReturnFocusRef.current?.isConnected) {
      templatePreviewReturnFocusRef.current.focus()
      templatePreviewReturnFocusRef.current = null
      return
    }
    document.querySelector<HTMLInputElement>('.template-search input')?.focus()
  }, [templateGalleryOpen, selectedTemplateId])

  useEffect(() => {
    if (!invitationToken) return
    setAuthOpen(!user)
    if (!user) return
    let cancelled = false
    setInvitationBusy(true)
    setInvitationError('')
    getRemoteInvitation(invitationToken)
      .then(invitation => { if (!cancelled) { setReceivedInvitation(invitation); setAuthOpen(false) } })
      .catch(error => { if (!cancelled) setInvitationError(error instanceof Error ? error.message : 'Não foi possível abrir este convite.') })
      .finally(() => { if (!cancelled) setInvitationBusy(false) })
    return () => { cancelled = true }
  }, [invitationToken, user])

  useEffect(() => {
    getSession()
      .then(async current => { setUser(current); const [docs, teamList, folders] = await Promise.all([listRemoteDocuments(), listRemoteTeams(), listRemoteProjectFolders()]); setRemoteDocuments(docs); setTeams(teamList); setRemoteProjectFolders(folders) })
      .catch(error => {
        if (error instanceof StudioApiError && error.status === 401) return
        setRemoteError('API indisponível. Inicie `npm.cmd run server` para usar a nuvem.')
      })
      .finally(() => setRemoteBusy(false))
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const refresh = () => listRemoteNotifications()
      .then(result => {
        if (cancelled) return
        setHomeNotifications(result.notifications)
        setHomeNotificationsUnread(result.unreadCount)
        setHomeNotificationsError('')
      })
      .catch(error => {
        if (!cancelled) setHomeNotificationsError(error instanceof Error ? error.message : 'Não foi possível carregar as notificações.')
      })
    void refresh()
    const source = subscribeRemoteNotifications(event => {
      let update: RemoteNotificationEvent
      try { update = JSON.parse(event.data) as RemoteNotificationEvent } catch { return }
      if (update.type === 'notification.created') void refresh()
    }, () => { void refresh() })
    return () => { cancelled = true; source.close() }
  }, [user])

  useEffect(() => {
    if (!teamInvitationToken || !user) return
    let cancelled = false
    getRemoteTeamInvitation(teamInvitationToken).then(invitation => { if (!cancelled) { setReceivedTeamInvitation(invitation); setAuthOpen(false) } }).catch(error => { if (!cancelled) setTeamError(error instanceof Error ? error.message : 'Não foi possível abrir o convite da equipe.') })
    return () => { cancelled = true }
  }, [teamInvitationToken, user])

  async function refreshDocuments() {
    const result = await listDocuments()
    setDocuments(result)
    return result
  }

  async function refreshProjectFolders() {
    const result = await listProjectFolders()
    setProjectFolders(result)
    return result
  }

  function openProjectFolder(folder: ProjectFolder) {
    setFolderDetailsOpen(true)
    setActiveFolderId(folder.id)
    setActiveFolderCloud(false)
    setLibraryMode('local')
    setProjectFilter('recent')
    setQuery('')
    window.history.pushState({}, '', `/folder/${encodeURIComponent(folder.id)}`)
  }

  function openRemoteProjectFolder(folder: RemoteProjectFolder) {
    setFolderDetailsOpen(false)
    setActiveFolderId(folder.id)
    setActiveFolderCloud(true)
    setLibraryMode('cloud')
    setProjectFilter('recent')
    setQuery('')
    window.history.pushState({}, '', `/cloud-folder/${encodeURIComponent(folder.id)}`)
  }

  function closeProjectFolder() {
    setActiveFolderId(null)
    setActiveFolderCloud(false)
    window.history.pushState({}, '', '/')
    setFolderNameEditing(false)
  }

  async function createProjectFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = folderNameDraft.trim()
    if (!name) return
    const now = new Date().toISOString()
    const folder: ProjectFolder = { id: createId('folder'), name, createdAt: now, updatedAt: now, favorite: false }
    try {
      if (libraryMode === 'cloud') {
        const remoteFolder = await createRemoteProjectFolder(name, folderTeamScopeId || undefined)
        setRemoteProjectFolders(current => [...current, remoteFolder].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR')))
        setFolderDialogOpen(false)
        setFolderNameDraft('')
        setError('')
        return
      }
      await writeProjectFolder(folder)
      await refreshProjectFolders()
      setFolderDialogOpen(false)
      setFolderNameDraft('')
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a pasta.') }
  }

  async function renameProjectFolder(folder: ProjectFolder, nameValue: string) {
    const name = nameValue.trim()
    if (!name || name === folder.name) { setFolderNameDraft(folder.name); return }
    try {
      await writeProjectFolder({ ...folder, name, updatedAt: new Date().toISOString() })
      await refreshProjectFolders()
      setFolderNameDraft(name)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível renomear a pasta.') }
  }

  async function renameRemoteProjectFolder(folder: RemoteProjectFolder, nameValue: string) {
    const name = nameValue.trim()
    if (!name || name === folder.name) { setFolderNameDraft(folder.name); return }
    try {
      const updated = await updateRemoteProjectFolder(folder.id, { name })
      setRemoteProjectFolders(current => current.map(item => item.id === folder.id ? updated : item))
      setFolderNameDraft(name)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível renomear a pasta na nuvem.') }
  }

  async function toggleRemoteProjectFolderFavorite(folder: RemoteProjectFolder) {
    try {
      const updated = await updateRemoteProjectFolder(folder.id, { favorite: !folder.favorite })
      setRemoteProjectFolders(current => current.map(item => item.id === folder.id ? updated : item).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR')))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o favorito.') }
  }

  async function removeRemoteProjectFolder(folder: RemoteProjectFolder) {
    try {
      await deleteRemoteProjectFolder(folder.id)
      setRemoteProjectFolders(current => current.filter(item => item.id !== folder.id))
      if (activeFolderCloud && activeFolderId === folder.id) closeProjectFolder()
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mova os projetos para fora antes de excluir a pasta.') }
  }

  async function toggleProjectFolderFavorite(folder: ProjectFolder) {
    try {
      await writeProjectFolder({ ...folder, favorite: !folder.favorite, updatedAt: new Date().toISOString() })
      await refreshProjectFolders()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o favorito.') }
  }

  async function duplicateProjectFolder(folder: ProjectFolder) {
    if (copyingProjectFolderId) return
    setCopyingProjectFolderId(folder.id)
    const now = new Date().toISOString()
    const copy: ProjectFolder = { ...folder, id: createId('folder'), name: `${folder.name} — cópia`, createdAt: now, updatedAt: now, favorite: false }
    const folderDocuments = documents.filter(document => document.folderId === folder.id && !document.trashedAt)
    const copies = folderDocuments.map(document => ({ ...duplicateDesignDocument(document, `${document.name} — cópia`), folderId: copy.id }))
    const savedCopies: DesignDocument[] = []
    let folderSaved = false
    try {
      await writeProjectFolder(copy)
      folderSaved = true
      for (const duplicate of copies) { await writeDocument(duplicate); savedCopies.push(duplicate) }
      await Promise.all([refreshProjectFolders(), refreshDocuments()])
      setError('')
    } catch (cause) {
      let rollbackFailed = false
      try {
        if (savedCopies.length) {
          const rollbackAt = new Date().toISOString()
          const rollbackDocuments = savedCopies.map(document => ({ ...document, folderId: undefined, trashedAt: rollbackAt, updatedAt: rollbackAt }))
          for (const document of rollbackDocuments) await writeDocument(document)
          await deleteDocuments(rollbackDocuments.map(document => ({ id: document.id, updatedAt: document.updatedAt })))
        }
        if (folderSaved) await deleteProjectFolder(copy.id)
        await Promise.all([refreshProjectFolders(), refreshDocuments()])
      } catch { rollbackFailed = true }
      const message = cause instanceof Error ? cause.message : 'Não foi possível duplicar a pasta e seus projetos.'
      setError(rollbackFailed ? `${message} Não foi possível confirmar a limpeza da cópia incompleta; atualize a biblioteca e revise os itens criados.` : message)
    } finally { setCopyingProjectFolderId(null) }
  }

  async function duplicateRemoteProjectFolder(folder: RemoteProjectFolder) {
    if (copyingProjectFolderId) return
    setCopyingProjectFolderId(folder.id)
    setRemoteError('')
    const sourceDocuments = remoteDocuments.filter(document => document.data.folderId === folder.id && !document.data.trashedAt)
    let copy: RemoteProjectFolder | undefined
    const createdDocuments: RemoteDocument[] = []
    try {
      const sourceAssets = await Promise.all(sourceDocuments.map(document => listRemoteMediaAssets(document.id, true)))
      copy = await createRemoteProjectFolder(`${folder.name} — cópia`, folder.teamId ?? undefined)
      for (let index = 0; index < sourceDocuments.length; index += 1) {
        const source = sourceDocuments[index]
        const duplicate = duplicateDesignDocument(source.data, `${source.name} — cópia`)
        delete duplicate.folderId
        const created = await createRemoteDocument(duplicate, folder.teamId ?? undefined)
        createdDocuments.push(created)
        const placed = await moveRemoteDocumentToFolder(created, copy.id)
        createdDocuments[createdDocuments.length - 1] = placed
        for (const asset of sourceAssets[index]) await saveRemoteMediaAsset(placed.id, asset)
      }
      await refreshRemoteDocuments()
      setRemoteError('')
    } catch (cause) {
      const rollbackTargets: Array<{ id: string; revision: number }> = []
      let rollbackError = false
      for (const created of [...createdDocuments].reverse()) {
        try {
          const rollbackAt = new Date().toISOString()
          const trashedData = { ...created.data, updatedAt: rollbackAt, trashedAt: rollbackAt }
          delete trashedData.folderId
          const trashed = await saveRemoteDocument(created.id, created.revision, trashedData)
          rollbackTargets.push({ id: trashed.id, revision: trashed.revision })
        } catch { rollbackError = true }
      }
      if (rollbackTargets.length) {
        try { await emptyRemoteTrash(rollbackTargets) } catch { rollbackError = true }
      }
      if (copy) {
        try { await deleteRemoteProjectFolder(copy.id) } catch { rollbackError = true }
      }
      await refreshRemoteDocuments()
      const message = cause instanceof Error ? cause.message : 'Não foi possível duplicar a pasta e seus projetos.'
      setRemoteError(rollbackError ? `${message} A limpeza da cópia incompleta não terminou; atualize a biblioteca e tente novamente.` : message)
    } finally { setCopyingProjectFolderId(null) }
  }

  async function removeProjectFolder(folder: ProjectFolder) {
    try {
      await deleteProjectFolder(folder.id)
      await refreshProjectFolders()
      if (activeFolderId === folder.id) closeProjectFolder()
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'A pasta precisa estar vazia para ser excluída.') }
  }

  async function moveDocumentToFolder(document: DesignDocument, folderId: string | null): Promise<boolean> {
    if ((document.folderId ?? null) === folderId) return true
    try {
      if (libraryMode === 'cloud') {
        const remote = remoteDocuments.find(item => item.id === document.id)
        if (!remote) throw new Error('O projeto da nuvem não está mais disponível.')
        const updated = await moveRemoteDocumentToFolder(remote, folderId)
        setRemoteDocuments(current => current.map(item => item.id === updated.id ? updated : item))
        setError('')
        return true
      }
      const updated: DesignDocument = { ...document, updatedAt: new Date().toISOString() }
      if (folderId) updated.folderId = folderId
      else delete updated.folderId
      await writeDocument(updated)
      await refreshDocuments()
      setError('')
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível mover o projeto.'); return false }
  }

  async function refreshRemoteDocuments() {
    if (!user) return []
    setRemoteBusy(true)
    try {
      const [result, folders] = await Promise.all([listRemoteDocuments(), listRemoteProjectFolders()])
      setRemoteDocuments(result)
      setRemoteProjectFolders(folders)
      setTeams(await listRemoteTeams())
      setRemoteError('')
      return result
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Não foi possível atualizar seus projetos na nuvem.')
      return []
    } finally {
      setRemoteBusy(false)
    }
  }

  async function refreshHomeNotifications() {
    if (!user) return
    try {
      const result = await listRemoteNotifications()
      setHomeNotifications(result.notifications)
      setHomeNotificationsUnread(result.unreadCount)
      setHomeNotificationsError('')
    } catch (error) {
      setHomeNotificationsError(error instanceof Error ? error.message : 'Não foi possível carregar as notificações.')
    }
  }

  async function setHomeNotificationRead(notification: RemoteNotification, read: boolean) {
    if (Boolean(notification.readAt) === read) return
    try {
      const updated = await setRemoteNotificationRead(notification.id, read)
      setHomeNotifications(items => items.map(item => item.id === notification.id ? { ...item, readAt: updated.readAt } : item))
      setHomeNotificationsUnread(count => Math.max(0, count + (read ? -1 : 1)))
    } catch (error) {
      setHomeNotificationsError(error instanceof Error ? error.message : 'Não foi possível atualizar a notificação.')
    }
  }

  async function openHomeNotification(notification: RemoteNotification) {
    try {
      if (!notification.readAt) {
        const updated = await setRemoteNotificationRead(notification.id, true)
        setHomeNotifications(items => items.map(item => item.id === notification.id ? { ...item, readAt: updated.readAt } : item))
        setHomeNotificationsUnread(count => Math.max(0, count - 1))
      }
      sessionStorage.setItem('fuse-pending-comment-navigation', JSON.stringify({ documentId: notification.documentId, commentId: notification.commentId }))
      setHomeNotificationsOpen(false)
      setLibraryMode('cloud')
      setProjectFilter('recent')
      setActiveStorageMode('cloud')
      setActiveId(notification.documentId)
    } catch (error) {
      setHomeNotificationsError(error instanceof Error ? error.message : 'Não foi possível abrir a conversa mencionada.')
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const confirmation = String(form.get('password-confirmation') ?? '')
    setAuthBusy(true)
    setRemoteBusy(true)
    setRemoteError('')
    setAuthNotice('')
    try {
      if (authMode === 'request-reset') {
        await requestPasswordReset(email)
        setAuthMode('reset-sent')
        setAuthNotice('Se a conta existir, enviaremos as instruções para redefinir a senha.')
        return
      }
      if (authMode === 'complete-reset') {
        if (password !== confirmation) throw new Error('As senhas não coincidem.')
        await completePasswordReset(authResetToken, password)
        setAuthResetToken('')
        const url = new URL(window.location.href)
        url.searchParams.delete('resetPassword')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
        setAuthMode('login')
        setAuthNotice('Senha redefinida. Entre com a nova senha.')
        return
      }
      const account = authMode === 'register' ? await signUp(name, email, password) : await signIn(email, password)
      setUser(account)
      setAuthOpen(false)
      setLibraryMode('cloud')
      const [result, folders] = await Promise.all([listRemoteDocuments(), listRemoteProjectFolders()])
      setRemoteDocuments(result)
      setRemoteProjectFolders(folders)
      setTeams(await listRemoteTeams())
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Não foi possível entrar.')
    } finally {
      setAuthBusy(false)
      setRemoteBusy(false)
    }
  }

  async function logout() {
    try {
      await signOut()
      setUser(null)
      setHomeNotifications([])
      setHomeNotificationsUnread(0)
      setHomeNotificationsOpen(false)
      setRemoteDocuments([])
      setRemoteProjectFolders([])
      setTeams([])
      setSelectedTeamId(null)
      setActiveFolderId(null)
      setActiveFolderCloud(false)
      setLibraryMode('local')
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Não foi possível sair da conta.')
    }
  }

  async function createProject(type: 'design' | 'doc' | 'presentation' | 'whiteboard' | 'sheet' | 'video' | 'site' = 'design') {
    try {
      const document = createTypedBlankDocument(type)
      await writeDocument(document)
      await refreshDocuments()
      setError('')
      setActiveId(document.id)
    } catch {
      setError('Não foi possível criar o projeto. Verifique o espaço disponível no navegador.')
    }
  }

  async function createRemoteProject(type: 'design' | 'doc' | 'presentation' | 'whiteboard' | 'sheet' | 'video' | 'site' = 'design') {
    try {
      const document = createTypedBlankDocument(type)
      const saved = await createRemoteDocument(document)
      await refreshRemoteDocuments()
      setRemoteError('')
      setActiveStorageMode('cloud')
      setActiveId(saved.id)
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Não foi possível criar o projeto na nuvem.')
    }
  }

  async function createRemoteProjectForTeam(teamId: string) {
    try {
      const document = createTypedBlankDocument('design')
      const saved = await createRemoteDocument(document, teamId)
      await refreshRemoteDocuments()
      setRemoteError('')
      setActiveStorageMode('cloud')
      setActiveId(saved.id)
    } catch (error) { setRemoteError(error instanceof Error ? error.message : 'Não foi possível criar o projeto da equipe.') }
  }

  async function openTeamDialog(team: RemoteTeam) {
    setSelectedTeamId(team.id)
    setTeamDialogOpen(true)
    setTeamError('')
    setTeamInviteLink('')
    setTeamInviteNotice('')
    try {
      const [details, invitations] = await Promise.all([
        getRemoteTeam(team.id),
        team.role === 'admin' ? listRemoteTeamInvitations(team.id) : Promise.resolve([]),
      ])
      setTeamDialogMembers(details.members)
      setTeamInvitations(invitations)
      const audit = team.role === 'admin' ? await getRemoteTeamAudit(team.id) : { events: [], nextBefore: null }
      setTeamAuditEvents(audit.events)
      setTeamAuditCursor(audit.nextBefore)
    }
    catch (error) { setTeamError(error instanceof Error ? error.message : 'Não foi possível carregar a equipe.') }
  }

  function openTeamIntegrations(teamId: string) {
    let ids = teamIntegrationIdsByTeam[teamId]
    if (!ids) {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(`fuse-team-integrations:${teamId}`) ?? '[]')
        ids = Array.isArray(parsed) && parsed.every(id => typeof id === 'string') ? parsed : []
      } catch { ids = [] }
      setTeamIntegrationIdsByTeam(current => ({ ...current, [teamId]: ids ?? [] }))
    }
    setTeamIntegrationsOpen(true)
  }

  function saveTeamIntegrations(teamId: string, ids: string[]) {
    setTeamIntegrationIdsByTeam(current => ({ ...current, [teamId]: ids }))
    try { localStorage.setItem(`fuse-team-integrations:${teamId}`, JSON.stringify(ids)) } catch { /* device storage may be unavailable */ }
    setTeamIntegrationsOpen(false)
  }

  async function changeTeamRole(member: RemoteTeamMember, role: RemoteTeamMember['role']) {
    if (!selectedTeamId || member.id === user?.id || teamMemberBusyId) return
    setTeamMemberBusyId(member.id)
    setTeamError('')
    try {
      await setRemoteTeamMemberRole(selectedTeamId, member.id, role)
      const [details, teamList] = await Promise.all([getRemoteTeam(selectedTeamId), listRemoteTeams()])
      setTeamDialogMembers(details.members)
      setTeams(teamList)
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Não foi possível alterar o papel.')
    } finally { setTeamMemberBusyId(null) }
  }

  async function removeTeamMember(member: RemoteTeamMember) {
    if (!selectedTeamId || teamMemberBusyId) return
    const leaving = member.id === user?.id
    const action = leaving ? 'Sair da equipe' : 'Remover integrante'
    if (!window.confirm(`${action}: ${member.name}?`)) return
    const teamId = selectedTeamId
    setTeamMemberBusyId(member.id)
    setTeamError('')
    try {
      await removeRemoteTeamMember(teamId, member.id)
      if (leaving) {
        setTeamDialogOpen(false)
        setSelectedTeamId(null)
        setTeamDialogMembers([])
        await refreshRemoteDocuments()
      } else {
        const [details, teamList] = await Promise.all([getRemoteTeam(teamId), listRemoteTeams()])
        setTeamDialogMembers(details.members)
        setTeams(teamList)
      }
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Não foi possível atualizar os integrantes.')
    } finally { setTeamMemberBusyId(null) }
  }

  async function submitCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const team = await createRemoteTeam(String(form.get('team-name') ?? '').trim())
      setTeams(await listRemoteTeams())
      setSelectedTeamId(team.id)
      setTeamDialogOpen(true)
      setTeamDialogMembers([{ ...user!, role: 'admin', joinedAt: team.createdAt }])
      setTeamInvitations([])
      setTeamAuditEvents([])
      setTeamAuditCursor(null)
      setTeamInviteLink('')
      setTeamInviteNotice('')
      setTeamError('')
      event.currentTarget.reset()
    } catch (error) { setTeamError(error instanceof Error ? error.message : 'Não foi possível criar a equipe.') }
  }

  async function inviteTeamMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTeamId) return
    const form = new FormData(event.currentTarget)
    try {
      const invitation = await createRemoteTeamInvitation(selectedTeamId, String(form.get('team-email') ?? '').trim())
      const link = new URL(window.location.href)
      link.searchParams.set('teamInvite', invitation.token)
      setTeamInviteLink(link.toString())
      setTeamInviteNotice(invitationDeliveryNotice(invitation.delivery.status))
      setTeamInvitations(await listRemoteTeamInvitations(selectedTeamId))
      event.currentTarget.reset()
      setTeamError('')
    } catch (error) { setTeamError(error instanceof Error ? error.message : 'Não foi possível convidar a pessoa.') }
  }

  async function cancelTeamInvite(invitation: RemoteTeamInvitation) {
    if (!selectedTeamId || teamInvitationBusyId) return
    setTeamInvitationBusyId(invitation.id)
    setTeamError('')
    try {
      await revokeRemoteTeamInvitation(selectedTeamId, invitation.id)
      const [invitations, audit] = await Promise.all([listRemoteTeamInvitations(selectedTeamId), getRemoteTeamAudit(selectedTeamId)])
      setTeamInvitations(invitations)
      setTeamAuditEvents(audit.events)
      setTeamAuditCursor(audit.nextBefore)
      setTeamInviteLink('')
      setTeamInviteNotice('')
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : 'Não foi possível revogar o convite.')
    } finally { setTeamInvitationBusyId(null) }
  }

  async function acceptTeamInvite() {
    if (!teamInvitationToken) return
    try {
      await acceptRemoteTeamInvitation(teamInvitationToken)
      const [teamList, docs, folders] = await Promise.all([listRemoteTeams(), listRemoteDocuments(), listRemoteProjectFolders()])
      setTeams(teamList)
      setRemoteDocuments(docs)
      setRemoteProjectFolders(folders)
      setLibraryMode('cloud')
      setProjectFilter('recent')
      setSelectedTeamId(receivedTeamInvitation?.teamId ?? null)
      setReceivedTeamInvitation(null)
      setTeamInvitationToken('')
      const url = new URL(window.location.href)
      url.searchParams.delete('teamInvite')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    } catch (error) { setTeamError(error instanceof Error ? error.message : 'Não foi possível aceitar o convite.') }
  }

  async function loadOlderTeamAudit() {
    if (!selectedTeamId || !teamAuditCursor || teamAuditBusy) return
    setTeamAuditBusy(true)
    try {
      const next = await getRemoteTeamAudit(selectedTeamId, 50, teamAuditCursor)
      setTeamAuditEvents(current => [...current, ...next.events])
      setTeamAuditCursor(next.nextBefore)
      setTeamError('')
    } catch (error) { setTeamError(error instanceof Error ? error.message : 'Não foi possível carregar a atividade anterior.') }
    finally { setTeamAuditBusy(false) }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setCsvImportBusy(true)
    setCsvImportError('')
    try {
      if (file.size > MAX_CSV_IMPORT_BYTES) throw new Error('O arquivo CSV deve ter no máximo 5 MB.')
      const cells = parseCsv(await file.text())
      const document = createTypedBlankDocument('sheet')
      const importedName = file.name.replace(/\.csv$/i, '').trim().slice(0, 80)
      document.name = importedName || 'Planilha importada'
      document.pages[0].cells = cells
      if (libraryMode === 'cloud') {
        const saved = await createRemoteDocument(document)
        await refreshRemoteDocuments()
        setActiveStorageMode('cloud')
        setActiveId(saved.id)
      } else {
        await writeDocument(document)
        await refreshDocuments()
        setActiveStorageMode('local')
        setActiveId(document.id)
      }
    } catch (error) {
      setCsvImportError(error instanceof Error ? error.message : 'Não foi possível importar este CSV.')
    } finally {
      setCsvImportBusy(false)
    }
  }

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setCsvImportBusy(true)
    setCsvImportError('')
    try {
      const { MAX_EXCEL_IMPORT_BYTES, parseExcelWorkbook } = await import('./excel')
      if (file.size > MAX_EXCEL_IMPORT_BYTES) throw new Error('O arquivo Excel deve ter no máximo 5 MB.')
      const sheets = await parseExcelWorkbook(await file.arrayBuffer())
      const document = createTypedBlankDocument('sheet')
      const importedName = file.name.replace(/\.xlsx$/i, '').trim().slice(0, 80)
      document.name = importedName || 'Planilha importada'
      document.pages = sheets.map((sheet, index) => ({
        id: createId('page'), name: sheet.name || `Planilha ${index + 1}`, background: '#ffffff', elements: [],
        cells: sheet.cells, ...(sheet.cellMerges.length ? { cellMerges: sheet.cellMerges } : {}),
        ...(Object.keys(sheet.cellFormats).length ? { cellFormats: sheet.cellFormats } : {}),
      }))
      if (libraryMode === 'cloud') {
        const saved = await createRemoteDocument(document)
        await refreshRemoteDocuments()
        setActiveStorageMode('cloud')
        setActiveId(saved.id)
      } else {
        await writeDocument(document)
        await refreshDocuments()
        setActiveStorageMode('local')
        setActiveId(document.id)
      }
    } catch (error) {
      setCsvImportError(error instanceof Error ? error.message : 'Não foi possível importar este arquivo Excel.')
    } finally {
      setCsvImportBusy(false)
    }
  }

  async function importPptx(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setCsvImportBusy(true)
    setCsvImportError('')
    try {
      const { parsePptx } = await import('./pptx-import')
      const imported = await parsePptx(await file.arrayBuffer(), file.name)
      const document = { ...imported, id: createId('document'), updatedAt: new Date().toISOString() }
      if (libraryMode === 'cloud') {
        const saved = await createRemoteDocument(document)
        await refreshRemoteDocuments()
        setActiveStorageMode('cloud')
        setActiveId(saved.id)
      } else {
        await writeDocument(document)
        await refreshDocuments()
        setActiveStorageMode('local')
        setActiveId(document.id)
      }
    } catch (error) {
      setCsvImportError(error instanceof Error ? `Falha ao importar PPTX: ${error.message}` : 'Não foi possível importar esta apresentação.')
    } finally {
      setCsvImportBusy(false)
    }
  }

  async function createTemplateProject(templateId: StarterTemplateId) {
    const document = createStarterDocument(templateId)
    closeTemplateGallery()
    if (libraryMode === 'cloud') {
      try {
        const saved = await createRemoteDocument(document)
        await refreshRemoteDocuments()
        setRemoteError('')
        setActiveStorageMode('cloud')
        setActiveId(saved.id)
      } catch (error) {
        setRemoteError(error instanceof Error ? error.message : 'Não foi possível criar um projeto a partir deste modelo.')
      }
      return
    }
    try {
      await writeDocument(document)
      await refreshDocuments()
      setError('')
      setActiveStorageMode('local')
      setActiveId(document.id)
    } catch {
      setError('Não foi possível criar um projeto a partir deste modelo. Verifique o espaço disponível no navegador.')
    }
  }

  function syncTemplateRoute(open: boolean, nextQuery = templateQuery, nextLanguage = templateLanguage, nextCategory = templateCategory, nextType = templateType, nextPalette = templatePalette, nextLicense = templateLicense) {
    const url = new URL(window.location.href)
    if (open) url.searchParams.set('templates', '1')
    else url.searchParams.delete('templates')
    if (nextQuery) url.searchParams.set('template_query', nextQuery)
    else url.searchParams.delete('template_query')
    if (nextLanguage === 'all') url.searchParams.delete('template_language')
    else url.searchParams.set('template_language', nextLanguage)
    if (nextCategory === 'all') url.searchParams.delete('template_category')
    else url.searchParams.set('template_category', nextCategory)
    if (nextType === 'all') url.searchParams.delete('template_type')
    else url.searchParams.set('template_type', nextType)
    if (nextPalette === 'all') url.searchParams.delete('template_palette')
    else url.searchParams.set('template_palette', nextPalette)
    if (nextLicense === 'all') url.searchParams.delete('template_license')
    else url.searchParams.set('template_license', nextLicense)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function syncProjectSearchRoute(nextQuery: string) {
    const url = new URL(window.location.href)
    if (nextQuery) { url.pathname = '/projects/search'; url.searchParams.set('query', nextQuery); url.searchParams.delete('q') }
    else { url.searchParams.delete('query'); url.searchParams.delete('q') }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function syncProjectsFilters(next: ProjectsFilters) {
    setProjectsFilters(next)
    const url = new URL(window.location.href)
    const encoded = writeProjectsFilters(next)
    if (encoded) url.searchParams.set('ui', encoded)
    else url.searchParams.delete('ui')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function openDesignSearchScope() {
    const url = new URL(window.location.href)
    url.pathname = '/projects/search'
    url.searchParams.set('adj', 'eyJGIjoiQSJ9')
    url.searchParams.set('forceQuery', '')
    setDesignSearchScope(true)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function clearProjectsFilters() {
    setQuery('')
    setProjectsFilters({ category: 'all', edited: 'any' })
    setDesignSearchScope(false)
    const url = new URL(window.location.href)
    url.pathname = '/projects'
    for (const key of ['query', 'q', 'ui', 'adj', 'forceQuery']) url.searchParams.delete(key)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function openTemplateGallery() {
    if (document.activeElement instanceof HTMLElement) templateReturnFocusRef.current = document.activeElement
    setTemplateGalleryOpen(true)
    syncTemplateRoute(true)
  }

  function openAppsMarketplace() {
    setAppsMarketplaceOpen(true)
    window.history.pushState(window.history.state, '', '/your-apps')
  }

  function closeTemplateGallery() {
    setTemplateGalleryOpen(false)
    setSelectedTemplateId(null)
    setTemplateActionMenuOpen(false)
    syncTemplateRoute(false)
  }

  async function duplicateRemoteProject(remote: RemoteDocument) {
    try {
      const document = duplicateDesignDocument(remote.data, `${remote.name} \u2014 c\u00f3pia`)
      const created = await createRemoteDocument(document)
      const referencedAssets = await listRemoteMediaAssets(remote.id, true)
      for (const asset of referencedAssets) await saveRemoteMediaAsset(created.id, asset)
      await refreshRemoteDocuments()
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel duplicar o projeto remoto.')
    }
  }
  async function openShareDialog(remote: RemoteDocument) {
    shareTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShareSubview('summary')
    setShareDocument(remote)
    setSharePermissions([])
    setShareInvitations([])
    setSharePublicLinkEnabled(false)
    setCreatedPublicShareUrl('')
    setCreatedInvitationLink('')
    setShareError('')
    setShareNotice('')
    setShareBusy(true)
    try {
      const [permissions, invitations, accessSettings] = await Promise.all([listRemotePermissions(remote.id), listRemoteInvitations(remote.id), getRemoteDocumentAccess(remote.id)])
      setSharePermissions(permissions)
      setShareInvitations(invitations)
      setSharePublicLinkEnabled(accessSettings.publicLinkEnabled)
      setCreatedPublicShareUrl('')
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível carregar os acessos.')
    } finally {
      setShareBusy(false)
    }
  }

  useEffect(() => {
    if (!shareDocument) {
      shareTriggerRef.current?.focus()
      shareTriggerRef.current = null
      return
    }
    shareCloseRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setShareDocument(null)
      setShareSubview('summary')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shareDocument])

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!shareDocument) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('invite-email') ?? '').trim()
    const role = String(form.get('invite-role') ?? 'editor') as 'viewer' | 'commenter' | 'editor'
    setShareBusy(true)
    setShareError('')
    setCreatedInvitationLink('')
    try {
      const invite = await createRemoteInvitation(shareDocument.id, email, role)
      const link = new URL(window.location.href)
      link.searchParams.set('invite', invite.token)
      setCreatedInvitationLink(link.toString())
      setShareInvitations(await listRemoteInvitations(shareDocument.id))
      setShareNotice(`${invitationDeliveryNotice(invite.delivery.status)} Convite para ${invite.email}; expira em 7 dias.`)
      event.currentTarget.reset()
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível criar o convite.')
    } finally { setShareBusy(false) }
  }

  async function cancelInvitation(invitation: RemoteInvitation) {
    if (!shareDocument) return
    setShareBusy(true)
    setShareError('')
    try {
      await revokeRemoteInvitation(shareDocument.id, invitation.id)
      setShareInvitations(await listRemoteInvitations(shareDocument.id))
      setShareNotice(`Convite para ${invitation.email} revogado.`)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível revogar o convite.')
    } finally { setShareBusy(false) }
  }

  async function acceptInvitation() {
    if (!invitationToken) return
    setInvitationBusy(true)
    setInvitationError('')
    try {
      const accepted = await acceptRemoteInvitation(invitationToken)
      await refreshRemoteDocuments()
      setLibraryMode('cloud')
      setActiveStorageMode('cloud')
      setActiveId(accepted.documentId)
      setReceivedInvitation(null)
      setInvitationToken('')
      const url = new URL(window.location.href)
      url.searchParams.delete('invite')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    } catch (error) {
      setInvitationError(error instanceof Error ? error.message : 'Não foi possível aceitar o convite.')
    } finally { setInvitationBusy(false) }
  }

  async function grantAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!shareDocument) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('share-email') ?? '').trim()
    const role = String(form.get('share-role') ?? 'viewer') as 'viewer' | 'commenter' | 'editor'
    setShareBusy(true)
    setShareError('')
    try {
      await grantRemotePermission(shareDocument.id, email, role)
      setSharePermissions(await listRemotePermissions(shareDocument.id))
      setShareNotice('Acesso concedido ou atualizado.')
      event.currentTarget.reset()
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível conceder acesso.')
    } finally {
      setShareBusy(false)
    }
  }

  async function configurePublicShareLink(action: 'enable' | 'rotate' | 'revoke') {
    if (!shareDocument || shareBusy) return
    setShareBusy(true)
    setShareError('')
    setShareNotice('')
    try {
      const result = await updateRemotePublicLink(shareDocument.id, action)
      setSharePublicLinkEnabled(result.publicLinkEnabled)
      if (result.token) {
        const link = new URL(window.location.pathname, window.location.origin)
        link.searchParams.set('view', result.token)
        setCreatedPublicShareUrl(link.toString())
        setShareNotice('Link criado. Qualquer pessoa com ele pode visualizar o projeto sem conta; editar permanece restrito a colaboradores.')
      } else {
        setCreatedPublicShareUrl('')
        setShareNotice(action === 'revoke' ? 'Link público revogado.' : 'Já existe um link ativo. Gere um novo para copiá-lo; o link anterior será revogado.')
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível atualizar o link público.')
    } finally { setShareBusy(false) }
  }

  async function toggleDocumentAccessSuspension() {
    if (!shareDocument || shareBusy) return
    const suspended = !shareDocument.accessSuspended
    setShareBusy(true)
    setShareError('')
    setShareNotice('')
    try {
      const accessSuspended = await setRemoteDocumentAccessSuspended(shareDocument.id, suspended)
      setShareDocument(current => current ? { ...current, accessSuspended } : current)
      setRemoteDocuments(current => current.map(document => document.id === shareDocument.id ? { ...document, accessSuspended } : document))
      setShareNotice(accessSuspended ? 'Acesso suspenso para as pessoas da equipe e colaboradores.' : 'Acesso reaberto. As pessoas podem voltar a abrir o projeto.')
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível atualizar o acesso.')
    } finally { setShareBusy(false) }
  }

  async function updateAccessRole(permission: RemotePermission, role: 'viewer' | 'commenter' | 'editor') {
    if (!shareDocument || permission.role === role) return
    setShareBusy(true)
    setShareError('')
    setShareNotice('')
    try {
      await grantRemotePermission(shareDocument.id, permission.email, role)
      setSharePermissions(await listRemotePermissions(shareDocument.id))
      const roleLabel = role === 'viewer' ? 'visualizador' : role === 'commenter' ? 'comentarista' : 'editor'
      setShareNotice(`${permission.name} agora tem acesso de ${roleLabel}.`)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível atualizar o acesso.')
      setSharePermissions(await listRemotePermissions(shareDocument.id).catch(() => sharePermissions))
    } finally {
      setShareBusy(false)
    }
  }

  async function revokeAccess(permission: RemotePermission) {
    if (!shareDocument) return
    setShareBusy(true)
    setShareError('')
    try {
      await revokeRemotePermission(shareDocument.id, permission.id)
      setSharePermissions(await listRemotePermissions(shareDocument.id))
      setShareNotice(`Acesso de ${permission.name} removido.`)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Não foi possível revogar o acesso.')
    } finally {
      setShareBusy(false)
    }
  }

  async function duplicateProject(document: DesignDocument) {
    try {
      const duplicate = duplicateDesignDocument(document, `${document.name} \u2014 c\u00f3pia`)
      await writeDocument(duplicate)
      await refreshDocuments()
      setError('')
    } catch {
      setError('N\u00e3o foi poss\u00edvel duplicar este projeto.')
    }
  }
  async function setArchived(document: DesignDocument, archived: boolean) {
    try {
      const updated: DesignDocument = { ...document, updatedAt: new Date().toISOString() }
      if (archived) { updated.archivedAt = updated.updatedAt; delete updated.trashedAt }
      else delete updated.archivedAt
      await writeDocument(updated)
      await refreshDocuments()
      setError('')
    } catch {
      setError('Não foi possível atualizar o projeto.')
    }
  }

  async function setRemoteArchived(remote: RemoteDocument, archived: boolean) {
    try {
      const updated = structuredClone(remote.data)
      updated.id = remote.id
      updated.name = remote.name
      updated.updatedAt = new Date().toISOString()
      if (archived) { updated.archivedAt = updated.updatedAt; delete updated.trashedAt }
      else delete updated.archivedAt
      await saveRemoteDocument(remote.id, remote.revision, updated)
      await refreshRemoteDocuments()
      setRemoteError('')
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Não foi possível atualizar o projeto na nuvem.')
    }
  }

  async function setTrashed(document: DesignDocument, trashed: boolean) {
    try {
      const updated: DesignDocument = { ...document, updatedAt: new Date().toISOString() }
      if (trashed) { updated.trashedAt = updated.updatedAt; delete updated.archivedAt }
      else delete updated.trashedAt
      await writeDocument(updated)
      await refreshDocuments()
      setError('')
    } catch {
      setError('N\u00e3o foi poss\u00edvel atualizar o projeto.')
    }
  }

  async function setRemoteTrashed(remote: RemoteDocument, trashed: boolean) {
    try {
      const updated = structuredClone(remote.data)
      updated.id = remote.id
      updated.name = remote.name
      updated.updatedAt = new Date().toISOString()
      if (trashed) { updated.trashedAt = updated.updatedAt; delete updated.archivedAt }
      else delete updated.trashedAt
      await saveRemoteDocument(remote.id, remote.revision, updated)
      await refreshRemoteDocuments()
      setRemoteError('')
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'N\u00e3o foi poss\u00edvel atualizar o projeto na nuvem.')
    }
  }

  async function permanentlyDeleteProject() {
    if (!pendingPermanentDelete || permanentDeleteBusy) return
    setPermanentDeleteBusy(true)
    try {
      if (pendingPermanentDelete.mode === 'local') {
        await deleteDocument(pendingPermanentDelete.id, pendingPermanentDelete.updatedAt)
        await refreshDocuments()
      } else {
        await deleteRemoteDocument(pendingPermanentDelete.id, pendingPermanentDelete.revision)
        await refreshRemoteDocuments()
      }
      setPendingPermanentDelete(null)
      setError('')
      setRemoteError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível excluir o projeto permanentemente.'
      if (pendingPermanentDelete.mode === 'local') setError(message)
      else setRemoteError(message)
    } finally {
      setPermanentDeleteBusy(false)
    }
  }

  async function emptyTrash() {
    if (!pendingTrashEmpty || trashEmptyBusy) return
    setTrashEmptyBusy(true)
    try {
      if (pendingTrashEmpty.mode === 'local') {
        await deleteDocuments(pendingTrashEmpty.documents)
        await refreshDocuments()
      } else {
        await emptyRemoteTrash(pendingTrashEmpty.documents)
        await refreshRemoteDocuments()
      }
      setPendingTrashEmpty(null)
      setError('')
      setRemoteError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível esvaziar a lixeira.'
      if (pendingTrashEmpty.mode === 'local') setError(message)
      else setRemoteError(message)
    } finally {
      setTrashEmptyBusy(false)
    }
  }

  const activeProjectFolder = projectFolders.find(folder => folder.id === activeFolderId) ?? null
  const activeFolderDocumentCount = activeFolderId ? documents.filter(document => document.folderId === activeFolderId && !document.trashedAt).length : 0
  const activeRemoteProjectFolder = remoteProjectFolders.find(folder => folder.id === activeFolderId) ?? null
  const activeRemoteFolderDocumentCount = activeFolderId ? remoteDocuments.filter(document => document.data.folderId === activeFolderId && !document.data.trashedAt).length : 0

  const visibleDocuments = useMemo(() => documents.filter(document => {
    const matchesArchive = projectFilter === 'trash' ? Boolean(document.trashedAt) : projectFilter === 'archived' ? Boolean(document.archivedAt) && !document.trashedAt : !document.archivedAt && !document.trashedAt
    const matchesQuery = (!query.trim() || document.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))) && (!designSearchScope || (document.type ?? 'design') === 'design')
    const matchesCategory = projectsFilters.category === 'all' || document.type === 'sheet'
    const matchesEditedDate = projectsFilters.edited === 'any' || isEditedToday(document.updatedAt)
    const matchesFolder = activeFolderId ? document.folderId === activeFolderId : true
    return matchesArchive && matchesQuery && matchesCategory && matchesEditedDate && matchesFolder
  }), [documents, query, projectFilter, activeFolderId, projectsFilters, designSearchScope])

  const visibleRemoteDocuments = useMemo(() => remoteDocuments.filter(document => (projectFilter === 'trash' ? Boolean(document.data.trashedAt) : projectFilter === 'archived' ? Boolean(document.data.archivedAt) && !document.data.trashedAt : !document.data.archivedAt && !document.data.trashedAt) && (!activeFolderCloud || document.data.folderId === activeFolderId) && (!activeRemoteProjectFolder || folderTypeFilter === 'all' || (document.data.type ?? 'design') === folderTypeFilter) && (projectsFilters.category === 'all' || document.data.type === 'sheet') && (projectsFilters.edited === 'any' || isEditedToday(document.data.updatedAt)) && (!query.trim() || document.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))) && (!designSearchScope || (document.data.type ?? 'design') === 'design')).sort((left, right) => activeRemoteProjectFolder && folderSort === 'name' ? left.name.localeCompare(right.name, 'pt-BR') : 0), [remoteDocuments, query, projectFilter, activeFolderCloud, activeFolderId, activeRemoteProjectFolder, folderTypeFilter, folderSort, projectsFilters, designSearchScope])
  const allLocalTrashDocuments = useMemo(() => documents.filter(document => Boolean(document.trashedAt)), [documents])
  const allRemoteTrashDocuments = useMemo(() => remoteDocuments.filter(document => Boolean(document.data.trashedAt) && document.role === 'owner'), [remoteDocuments])

  const visibleStarterTemplates = useMemo(() => {
    const normalizedQuery = templateQuery.trim().toLocaleLowerCase('pt-BR')
    return STARTER_TEMPLATES.filter(template => {
      const metadata = STARTER_TEMPLATE_METADATA[template.id]
      const matchesQuery = !normalizedQuery || `${template.name} ${template.description} ${template.category} ${metadata.tags.join(' ')}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery)
      const matchesCategory = templateCategory === 'all' || template.category === templateCategory
      const matchesLanguage = templateLanguage === 'all' || templateLanguage === 'pt'
      const matchesType = templateType === 'all' || metadata.type === templateType
      const matchesPalette = templatePalette === 'all' || metadata.palette === templatePalette
      const matchesLicense = templateLicense === 'all' || metadata.license === templateLicense
      return matchesQuery && matchesCategory && matchesLanguage && matchesType && matchesPalette && matchesLicense
    })
  }, [templateCategory, templateLanguage, templateLicense, templatePalette, templateQuery, templateType])
  const selectedStarterTemplate = useMemo(() => selectedTemplateId ? STARTER_TEMPLATES.find(template => template.id === selectedTemplateId) ?? null : null, [selectedTemplateId])
  const templatePreviewDocuments = useMemo(() => new Map(STARTER_TEMPLATES.map(template => [template.id, createStarterDocument(template.id)])), [])
  const selectedStarterDocument = selectedStarterTemplate ? templatePreviewDocuments.get(selectedStarterTemplate.id) ?? null : null
  const selectedStarterPreviewPage = selectedStarterDocument?.pages[templatePreviewPageIndex] ?? selectedStarterDocument?.pages[0] ?? null
  const selectedStarterPreviewDocument = selectedStarterDocument && selectedStarterPreviewPage
    ? { ...selectedStarterDocument, pages: [selectedStarterPreviewPage] }
    : null
  const templateCategories = useMemo(() => [...new Set(STARTER_TEMPLATES.map(template => template.category))], [])

  const folderDetailMode = Boolean(activeProjectFolder || activeRemoteProjectFolder)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem('fuse-account-theme', theme) } catch { /* Theme preference is optional when storage is unavailable. */ }
  }, [theme])

  useEffect(() => {
    if (!accountMenuOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountMenuOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [accountMenuOpen])

  async function createBulkIndividualProjects(source: DesignDocument, pages: DesignPage[], teamId: string | null) {
    const projects = generateBulkDocuments(source, pages, createId, createIsoTimestamp())
    let created = 0
    let mediaFailures = 0
    const cloud = activeStorageMode === 'cloud'
    const assetIdsByProject = projects.map(project => new Set(project.pages.flatMap(page => [
      ...page.elements.flatMap(element => element.type === 'image' && element.assetId ? [element.assetId] : []),
      ...(page.timelineClips ?? []).map(clip => clip.assetId),
    ])))
    let sourceAssets: MediaAsset[] = []
    if (cloud && assetIdsByProject.some(ids => ids.size)) {
      try { sourceAssets = await listRemoteMediaAssets(source.id, true) }
      catch { mediaFailures = assetIdsByProject.filter(ids => ids.size).length }
    }
    for (const [index, project] of projects.entries()) {
      try {
        let mediaDocumentId = project.id
        if (cloud) {
          const createdDocument = await createRemoteDocument(project, teamId ?? undefined)
          mediaDocumentId = createdDocument.id
          if (sourceAssets.length) {
            const assets = sourceAssets.filter(asset => assetIdsByProject[index].has(asset.id))
            try {
              for (const asset of assets) await saveRemoteMediaAsset(mediaDocumentId, asset)
            } catch {
              mediaFailures += 1
            }
            if ([...assetIdsByProject[index]].some(id => !assets.some(asset => asset.id === id))) mediaFailures += 1
          } else if (assetIdsByProject[index].size && mediaFailures === 0) mediaFailures += 1
        }
        else await writeDocument(project)
        created += 1
      } catch { /* Keep processing other records and report the partial result in the panel. */ }
    }
    if (created) {
      if (cloud) await refreshRemoteDocuments()
      else try { await refreshDocuments() } catch { /* The projects remain saved; the library refresh can be retried later. */ }
    }
    return { created, failed: projects.length - created, mediaFailed: Math.min(mediaFailures, projects.length) }
  }

  if (publicShareToken) return <PublicShareViewer token={publicShareToken} onClose={() => { setPublicShareToken(''); const url = new URL(window.location.href); url.searchParams.delete('view'); window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`) }} />

  if (activeId) return <DesignEditor key={`${activeStorageMode}:${activeId}`} documentId={activeId} storageMode={activeStorageMode} currentUserId={user?.id} onCreateBulkProjects={createBulkIndividualProjects} onShare={() => {
    const remote = remoteDocuments.find(document => document.id === activeId)
    if (remote) void openShareDialog(remote)
  }} onExit={(nextDocumentId, returnToLocalLibrary) => {
    if (nextDocumentId) {
      setActiveStorageMode('cloud')
      setLibraryMode('cloud')
      setActiveId(nextDocumentId)
      return
    }
    setActiveId(null)
    if (returnToLocalLibrary) {
      setActiveStorageMode('local')
      setLibraryMode('local')
      setProjectFilter('recent')
    }
    if (activeStorageMode === 'cloud') {
      void refreshRemoteDocuments()
      void refreshDocuments().catch(() => setError('Não foi possível atualizar a lista de projetos.'))
    } else void refreshDocuments().catch(() => setError('Não foi possível atualizar a lista de projetos.'))
  }} />

  if (window.location.pathname === '/settings/people') return <TeamPeopleSettingsRoute />
  if (window.location.pathname === '/settings/groups') return <TeamGroupsSettingsRoute />
  if (window.location.pathname === '/settings/team-profile') return <TeamProfileSettingsRoute />
  if (window.location.pathname === '/settings/permissions' || window.location.pathname === '/settings/controls') return <TeamPermissionsSettings />
  if (window.location.pathname === '/settings/apps/manage-ai-apps') return <TeamAiAppManager />

  if (window.location.pathname.startsWith('/settings/sso')) return <main className="home-shell">
    <div className="home-main" id="home-top">
      <header className="home-topbar"><div className="home-brand"><span className="brand-mark">f</span><span className="brand-name">fuse<span>studio</span></span></div><a href="/" className="home-top-link">Voltar ao início</a></header>
      <section className="share-dialog" aria-label="Configurações da equipe">
        <h1>Início único de sessão (SSO) e provisionamento</h1>
        <p>O início único de sessão (SSO) permite que usuários façam login usando o provedor de identidade da organização para acessar o Canva.</p>
        <div role="tablist" aria-label="Configurações de SSO"><button type="button" role="tab" aria-selected="true">Verificação de domínio</button><button type="button" role="tab" aria-selected="false" disabled>Início único de sessão</button></div>
        <section role="tabpanel" aria-label="Verificação de domínio"><p>O início único de sessão (SSO) exige um domínio registrado que será verificado para confirmar a titularidade. Nenhum domínio será enviado nesta demonstração.</p><button type="button" onClick={() => setDomainDialogOpen(true)}>Adicionar domínio</button></section>
      </section>
    </div>
    {domainDialogOpen && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDomainDialogOpen(false) }}><section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="domain-dialog-title"><button type="button" className="auth-close" aria-label="Fechar" onClick={() => setDomainDialogOpen(false)}><X size={18} aria-hidden="true" /></button><h2 id="domain-dialog-title">Enviar um novo domínio</h2><p>Informe o domínio que deseja verificar.</p><form onSubmit={event => event.preventDefault()}><label htmlFor="team-domain-draft">Domínio</label><input id="team-domain-draft" aria-label="Domínio" value={domainDraft} onChange={event => setDomainDraft(event.currentTarget.value)} autoComplete="off" /><button type="submit" disabled={!domainDraft.trim()}>Enviar domínio</button></form></section></div>}
  </main>

  return <main className={`home-shell${folderDetailMode ? ' folder-detail-mode' : ''}`}>
    <input ref={csvInputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={event => void importCsv(event)} aria-label="Importar arquivo CSV" />
    <input ref={excelInputRef} className="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => void importExcel(event)} aria-label="Importar arquivo Excel XLSX" />
    <input ref={pptxInputRef} className="visually-hidden" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={event => void importPptx(event)} aria-label="Importar apresentação PPTX" />
    <input ref={anyImportInputRef} className="visually-hidden" type="file" accept=".csv,.xlsx,.pptx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={event => { const name = event.currentTarget.files?.[0]?.name.toLowerCase() ?? ''; if (name.endsWith('.pptx')) void importPptx(event); else if (name.endsWith('.xlsx')) void importExcel(event); else void importCsv(event) }} aria-label="Importar CSV, XLSX ou PPTX" />
    <aside className="home-sidebar" aria-label="Navegação principal">
      <div className="home-sidebar-brand"><span className="brand-mark">f</span></div>
      <button className="home-side-action" onClick={() => void (libraryMode === 'local' ? createProject('design') : createRemoteProject('design'))}><Plus size={19} aria-hidden="true" /><small>Criar</small></button>
      <nav>
        <a className={homeSection === 'home' ? 'active' : undefined} href="#home-top" aria-current={homeSection === 'home' ? 'page' : undefined} onClick={() => setHomeSection('home')}><House size={19} aria-hidden="true" /><small>Início</small></a>
        <a className={homeSection === 'projects' ? 'active' : undefined} href="#home-projects" aria-current={homeSection === 'projects' ? 'page' : undefined} onClick={() => setHomeSection('projects')}><FolderOpen size={19} aria-hidden="true" /><small>Projetos</small></a>
        <button onClick={openTemplateGallery}><LayoutTemplate size={19} aria-hidden="true" /><small>Modelos</small></button>
        <button className={appsMarketplaceOpen ? 'active' : undefined} aria-current={appsMarketplaceOpen ? 'page' : undefined} onClick={openAppsMarketplace}><Shapes size={19} aria-hidden="true" /><small>Apps</small></button>
      </nav>
      <div className="home-sidebar-bottom">{user ? <span className="home-avatar" title={user.name}>{user.name.slice(0, 1).toUpperCase()}</span> : <button aria-label="Entrar ou criar conta" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}><LogIn size={19} aria-hidden="true" /><small>Entrar</small></button>}</div>
    </aside>
    {folderDetailMode && <aside className="project-folder-sidebar" aria-label="Navegação de projetos">
      <div className="project-folder-sidebar-brand"><span className="brand-mark">f</span><strong>fuse studio</strong></div>
      <nav>
        <button type="button" onClick={closeProjectFolder}><FolderOpen size={18} aria-hidden="true" /> Todos os projetos</button>
        <button type="button" onClick={() => { closeProjectFolder(); setProjectFilter('recent') }}><Clock3 size={18} aria-hidden="true" /> Recentes</button>
        <div className="project-folder-sidebar-section"><UsersRound size={17} aria-hidden="true" /><span>{activeRemoteProjectFolder?.teamId ? teams.find(team => team.id === activeRemoteProjectFolder.teamId)?.name ?? 'Equipe' : 'Pessoal'}</span></div>
        <button type="button" className="selected" aria-current="page"><Folder size={18} aria-hidden="true" /><span>{activeRemoteProjectFolder?.name ?? activeProjectFolder?.name}</span></button>
        <button type="button" onClick={() => { closeProjectFolder(); setProjectFilter('recent') }}><UsersRound size={18} aria-hidden="true" /> Compartilhado comigo</button>
        <button type="button" onClick={() => { closeProjectFolder(); setProjectFilter('archived') }}><Cloud size={18} aria-hidden="true" /> Disponível offline</button>
        <button type="button" onClick={() => { closeProjectFolder(); setProjectFilter('recent') }}><Link2 size={18} aria-hidden="true" /> Gerenciar links</button>
      </nav>
      <div className="project-folder-sidebar-hint"><button type="button" aria-label="Fechar dica" onClick={event => event.currentTarget.parentElement?.remove()}><X size={14} aria-hidden="true" /></button><strong>Marque projetos como favoritos</strong><span>Use a estrela para encontrar os itens mais importantes rapidamente.</span></div>
      <button type="button" className="project-folder-sidebar-trash" onClick={() => { closeProjectFolder(); setProjectFilter('trash') }}><Trash2 size={17} aria-hidden="true" /> Lixeira</button>
    </aside>}
    <div className="home-main" id="home-top">
    <header className="home-topbar">
      <div className="home-brand"><span className="brand-mark">f</span><span className="brand-name">fuse<span>studio</span></span></div>
      <div className="home-user">{user ? <>
        <button className="home-notifications-trigger" type="button" aria-haspopup="dialog" aria-expanded={homeNotificationsOpen} aria-label={`Notificações${homeNotificationsUnread ? `, ${homeNotificationsUnread} não lidas` : ''}`} title="Notificações" onClick={() => { const opening = !homeNotificationsOpen; setHomeNotificationsOpen(opening); if (opening) void refreshHomeNotifications() }}><Bell size={18} aria-hidden="true" />{homeNotificationsUnread > 0 && <span>{homeNotificationsUnread > 99 ? '99+' : homeNotificationsUnread}</span>}</button>
        <button className="home-account" type="button" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}><span className="home-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span><ChevronDown size={14} aria-hidden="true" /></button>
        {accountMenuOpen && <div className="account-menu" role="menu" aria-label="Conta e equipe">
          <div className="account-menu-heading"><strong>{user.name}</strong><small>{user.email}</small></div>
          <div className="account-menu-section"><span>Preferências</span><button type="button" className="account-menu-row" role="menuitem" aria-haspopup="menu" aria-expanded="true"><span>Tema</span><span>{theme === 'dark' ? 'Escuro' : 'Claro'} <ChevronRight size={14} aria-hidden="true" /></span></button>
            <div className="account-theme-options" role="group" aria-label="Tema">
              <button type="button" role="menuitemradio" aria-checked={theme === 'light'} onClick={() => setTheme('light')}><span className="theme-swatch theme-swatch-light" aria-hidden="true" />Claro{theme === 'light' && <Check className="theme-check" size={14} aria-hidden="true" />}</button>
              <button type="button" role="menuitemradio" aria-checked={theme === 'dark'} onClick={() => setTheme('dark')}><span className="theme-swatch theme-swatch-dark" aria-hidden="true" />Escuro{theme === 'dark' && <Check className="theme-check" size={14} aria-hidden="true" />}</button>
            </div>
          </div>
          <button type="button" role="menuitem" className="account-menu-row" onClick={() => { setLibraryMode(mode => mode === 'local' ? 'cloud' : 'local'); setProjectFilter('recent'); if (libraryMode === 'local') void refreshRemoteDocuments(); setAccountMenuOpen(false) }}>Armazenamento <span>{libraryMode === 'cloud' ? 'Nuvem' : 'Neste dispositivo'}</span></button>
          <button type="button" role="menuitem" className="account-menu-signout" onClick={() => { setAccountMenuOpen(false); void logout() }}>Sair</button>
        </div>}
        <button className="home-signout" onClick={() => void logout()}>Sair</button>
      </> : <button className="home-signin" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Entrar ou criar conta</button>}</div>
    </header>
    {homeNotificationsOpen && <div className="home-notifications-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setHomeNotificationsOpen(false) }}><section className="home-notifications-dialog" role="dialog" aria-modal="true" aria-labelledby="home-notifications-title"><header><div><span className="panel-kicker">COLABORAÇÃO</span><h2 id="home-notifications-title">Notificações</h2></div><div><button type="button" className="home-notifications-refresh" onClick={() => void refreshHomeNotifications()}>Atualizar</button><button type="button" className="asset-close" aria-label="Fechar notificações" onClick={() => setHomeNotificationsOpen(false)}><X size={18} aria-hidden="true" /></button></div></header>{homeNotificationsError && <p className="home-notifications-error" role="alert">{homeNotificationsError}</p>}<div className="home-notifications-list" aria-label="Notificações de menções">{homeNotifications.length ? homeNotifications.map(notification => <article className={`comment-notification${notification.readAt ? "" : " is-unread"}`} key={notification.id}><button type="button" onClick={() => void openHomeNotification(notification)}><span className="home-avatar">{notification.actorName.slice(0, 1).toUpperCase()}</span><span><strong>{notification.actorName}</strong> mencionou você em <strong>{notification.documentName}</strong><small>{notification.commentContent}</small><small>{formatShortDate(notification.createdAt)} - {notification.readAt ? "Lida" : "Ãao lida"}</small></span></button><button type="button" className="comment-anchor" onClick={() => void setHomeNotificationRead(notification, !notification.readAt)}>{notification.readAt ? "Marcar não lida" : "Marcar lida"}</button></article>) : <p className="home-notifications-empty">Voce não tem notificações.</p>}</div></section></div>}
    <section className="home-content">
      <div className="home-heading">
        <div><span className="home-eyebrow">SEU ESPACO CRIATIVO</span><h1>Bora fazer bonito?</h1><p>Crie designs, documentos e apresentacoes em um so lugar.</p></div>
      </div>
      <label className="project-search home-hero-search"><Search className="home-search-icon" size={19} aria-hidden="true" /><input type="search" maxLength={140} value={query} onChange={event => { const next = event.target.value; setQuery(next); syncProjectSearchRoute(next) }} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); syncProjectSearchRoute('') } }} placeholder="Busque seus projetos" aria-label="Busque designs, pastas e uploads" />{query && <button type="button" aria-label="Limpar busca" onClick={() => { setQuery(''); syncProjectSearchRoute('') }}><X size={15} aria-hidden="true" /></button>}</label>
      {query && <button type="button" className="project-search-scope" onClick={openDesignSearchScope}>Designs - Ver tudo</button>}
      <nav className="home-category-row" aria-label="Criar um projeto">
        <button onClick={openTemplateGallery}><span className="home-category-icon templates" aria-hidden="true"><LayoutTemplate size={22} /></span><small>Modelos</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('presentation') : createRemoteProject('presentation'))}><span className="home-category-icon presentation" aria-hidden="true"><Presentation size={22} /></span><small>{'Apresenta\u00e7\u00e3o'}</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('design') : createRemoteProject('design'))}><span className="home-category-icon social" aria-hidden="true"><ImageIcon size={22} /></span><small>Redes sociais</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('doc') : createRemoteProject('doc'))}><span className="home-category-icon document" aria-hidden="true"><FileText size={22} /></span><small>Documento</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('whiteboard') : createRemoteProject('whiteboard'))}><span className="home-category-icon board" aria-hidden="true"><Shapes size={22} /></span><small>Quadro branco</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('sheet') : createRemoteProject('sheet'))}><span className="home-category-icon sheet" aria-hidden="true"><Sheet size={22} /></span><small>Planilha</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('video') : createRemoteProject('video'))}><span className="home-category-icon video" aria-hidden="true"><Film size={22} /></span><small>Vídeo</small></button>
        <button onClick={() => void (libraryMode === 'local' ? createProject('site') : createRemoteProject('site'))}><span className="home-category-icon social" aria-hidden="true"><Globe size={22} /></span><small>Site</small></button>
        <button onClick={() => anyImportInputRef.current?.click()}><span className="home-category-icon upload" aria-hidden="true"><Upload size={22} /></span><small>Importar</small></button>
      </nav>
      {libraryMode === 'local' && <section className="project-folders" aria-label="Pastas de projetos">
        {activeProjectFolder ? <div className="project-folder-detail">
          <div className="project-folder-crumb"><button type="button" onClick={closeProjectFolder}>Projetos</button><span aria-hidden="true">/</span><span>{activeProjectFolder.name}</span></div>
          <div className="project-folder-detail-heading">
            <div className="project-folder-name-area">{folderNameEditing ? <input autoFocus aria-label="Nome da pasta" value={folderNameDraft} maxLength={100} onChange={event => setFolderNameDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void renameProjectFolder(activeProjectFolder, folderNameDraft); setFolderNameEditing(false) } if (event.key === 'Escape') { event.preventDefault(); folderRenameCancelledRef.current = true; setFolderNameDraft(activeProjectFolder.name); setFolderNameEditing(false) } }} onBlur={() => { if (folderRenameCancelledRef.current) { folderRenameCancelledRef.current = false; return } void renameProjectFolder(activeProjectFolder, folderNameDraft); setFolderNameEditing(false) }} /> : <h2>{activeProjectFolder.name}</h2>}<button type="button" className="project-folder-rename" onClick={() => { setFolderNameDraft(activeProjectFolder.name); setFolderNameEditing(true) }}>Renomear</button></div>
            <div className="project-folder-actions"><button type="button" aria-pressed={activeProjectFolder.favorite} onClick={() => void toggleProjectFolderFavorite(activeProjectFolder)}><Star size={16} fill={activeProjectFolder.favorite ? 'currentColor' : 'none'} aria-hidden="true" />{activeProjectFolder.favorite ? 'Favoritada' : 'Favoritar'}</button><button type="button" aria-expanded={folderDetailsOpen} onClick={() => setFolderDetailsOpen(open => !open)}>{folderDetailsOpen ? 'Ocultar detalhes' : 'Detalhes'}</button><button type="button" aria-label={`Fazer uma cópia de ${activeProjectFolder.name}`} disabled={copyingProjectFolderId === activeProjectFolder.id} onClick={() => void duplicateProjectFolder(activeProjectFolder)}><Copy size={15} aria-hidden="true" /> {copyingProjectFolderId === activeProjectFolder.id ? 'Copiando…' : 'Fazer uma cópia'}</button><button type="button" disabled={activeFolderDocumentCount > 0} title={activeFolderDocumentCount > 0 ? 'Mova os projetos para fora antes de excluir a pasta.' : undefined} onClick={() => void removeProjectFolder(activeProjectFolder)}><Trash2 size={15} aria-hidden="true" /> Excluir pasta</button></div>
          </div>
          {folderDetailsOpen && <div className="project-folder-metadata"><span><strong>Tipo</strong>Pasta</span><span><strong>Itens</strong>{activeFolderDocumentCount} {activeFolderDocumentCount === 1 ? 'projeto' : 'projetos'}</span><span><strong>Local</strong>Projetos neste dispositivo</span><span><strong>Criada</strong>{new Date(activeProjectFolder.createdAt).toLocaleDateString('pt-BR')}</span><span><strong>Editada</strong>{new Date(activeProjectFolder.updatedAt).toLocaleDateString('pt-BR')}</span></div>}
        </div> : <div className="project-folder-list-heading"><div><h2>{folderFavoritesOnly ? 'Pastas favoritas' : 'Pastas'}</h2><p>Organize seus projetos neste dispositivo.</p></div><div className="project-folder-list-actions"><button type="button" aria-pressed={folderFavoritesOnly} onClick={() => setFolderFavoritesOnly(value => !value)}><Star size={14} fill={folderFavoritesOnly ? 'currentColor' : 'none'} aria-hidden="true" /> {folderFavoritesOnly ? 'Todas as pastas' : 'Favoritas'}</button><button type="button" onClick={() => { setFolderNameDraft(''); setFolderDialogOpen(true) }}><Plus size={15} aria-hidden="true" /> Nova pasta</button></div></div>}
        {!activeProjectFolder && projectFolders.filter(folder => !folderFavoritesOnly || folder.favorite).length > 0 && <div className="project-folder-grid">{projectFolders.filter(folder => !folderFavoritesOnly || folder.favorite).map(folder => {
          const count = documents.filter(document => document.folderId === folder.id && !document.trashedAt).length
          return <article className="project-folder-card" key={folder.id}><button type="button" className="project-folder-open" onClick={() => openProjectFolder(folder)}><FolderOpen size={21} aria-hidden="true" /><strong>{folder.name}</strong><small>{count} {count === 1 ? 'projeto' : 'projetos'}</small></button><button type="button" className="project-folder-favorite" aria-label={`${folder.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}: ${folder.name}`} aria-pressed={folder.favorite} onClick={() => void toggleProjectFolderFavorite(folder)}><Star size={16} fill={folder.favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button><button type="button" className="project-folder-copy" aria-label={`Fazer uma cópia de ${folder.name}`} disabled={copyingProjectFolderId === folder.id} onClick={() => void duplicateProjectFolder(folder)}><Copy size={15} aria-hidden="true" /></button></article>
        })}</div>}
        {!activeProjectFolder && folderFavoritesOnly && !projectFolders.some(folder => folder.favorite) && <p className="project-folder-empty">As pastas que você favoritar aparecerão aqui.</p>}
      </section>}
      {libraryMode === 'cloud' && user && <section className="project-folders" aria-label="Pastas na nuvem">
        {activeFolderCloud && activeRemoteProjectFolder ? <div className="project-folder-detail">
          <div className="project-folder-crumb"><button type="button" onClick={closeProjectFolder}>Projetos na nuvem</button><span aria-hidden="true">/</span><span>{activeRemoteProjectFolder.name}</span></div>
          <div className="project-folder-detail-heading"><div className="project-folder-name-area">{folderNameEditing ? <input autoFocus aria-label="Nome da pasta" value={folderNameDraft} maxLength={100} onChange={event => setFolderNameDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void renameRemoteProjectFolder(activeRemoteProjectFolder, folderNameDraft); setFolderNameEditing(false) } if (event.key === 'Escape') { event.preventDefault(); folderRenameCancelledRef.current = true; setFolderNameDraft(activeRemoteProjectFolder.name); setFolderNameEditing(false) } }} onBlur={() => { if (folderRenameCancelledRef.current) { folderRenameCancelledRef.current = false; return } void renameRemoteProjectFolder(activeRemoteProjectFolder, folderNameDraft); setFolderNameEditing(false) }} /> : <h2>{activeRemoteProjectFolder.name}</h2>}<button type="button" className="project-folder-rename" onClick={() => { setFolderNameDraft(activeRemoteProjectFolder.name); setFolderNameEditing(true) }}>Renomear</button></div><div className="project-folder-actions"><button type="button" aria-pressed={activeRemoteProjectFolder.favorite} onClick={() => void toggleRemoteProjectFolderFavorite(activeRemoteProjectFolder)}><Star size={16} fill={activeRemoteProjectFolder.favorite ? 'currentColor' : 'none'} aria-hidden="true" />{activeRemoteProjectFolder.favorite ? 'Favoritada' : 'Favoritar'}</button><button type="button" aria-label={`Fazer uma cópia de ${activeRemoteProjectFolder.name}`} disabled={copyingProjectFolderId === activeRemoteProjectFolder.id} onClick={() => void duplicateRemoteProjectFolder(activeRemoteProjectFolder)}><Copy size={15} aria-hidden="true" /> {copyingProjectFolderId === activeRemoteProjectFolder.id ? 'Copiando…' : 'Fazer uma cópia'}</button><button type="button" disabled={activeRemoteFolderDocumentCount > 0} title={activeRemoteFolderDocumentCount > 0 ? 'Mova os projetos para fora antes de excluir a pasta.' : undefined} onClick={() => void removeRemoteProjectFolder(activeRemoteProjectFolder)}><Trash2 size={15} aria-hidden="true" /> Excluir pasta</button></div></div>
          {folderDetailsOpen && <div className="project-folder-metadata"><span><strong>Tipo</strong>Pasta compartilhada</span><span><strong>Itens</strong>{activeRemoteFolderDocumentCount} projetos</span><span><strong>Local</strong>{activeRemoteProjectFolder.teamId ? teams.find(team => team.id === activeRemoteProjectFolder.teamId)?.name ?? 'Equipe' : 'Nuvem pessoal'}</span><span><strong>Criada</strong>{new Date(activeRemoteProjectFolder.createdAt).toLocaleDateString('pt-BR')}</span></div>}
        </div> : <div className="project-folder-list-heading"><div><h2>Pastas na nuvem</h2><p>Organize projetos pessoais e compartilhados com sua equipe.</p></div><div className="project-folder-list-actions"><button type="button" aria-pressed={folderFavoritesOnly} onClick={() => setFolderFavoritesOnly(value => !value)}><Star size={14} fill={folderFavoritesOnly ? 'currentColor' : 'none'} aria-hidden="true" /> {folderFavoritesOnly ? 'Todas as pastas' : 'Favoritas'}</button><button type="button" onClick={() => { setFolderNameDraft(''); setFolderTeamScopeId(selectedTeamId ?? ''); setFolderDialogOpen(true) }}><Plus size={15} aria-hidden="true" /> Nova pasta</button></div></div>}
        {!activeFolderCloud && remoteProjectFolders.filter(folder => !folderFavoritesOnly || folder.favorite).length > 0 && <div className="project-folder-grid">{remoteProjectFolders.filter(folder => !folderFavoritesOnly || folder.favorite).map(folder => { const count = remoteDocuments.filter(document => document.data.folderId === folder.id && !document.data.trashedAt).length; const scope = folder.teamId ? teams.find(team => team.id === folder.teamId)?.name ?? 'Equipe' : 'Pessoal'; return <article className="project-folder-card" key={folder.id}><button type="button" className="project-folder-open" onClick={() => openRemoteProjectFolder(folder)}><FolderOpen size={21} aria-hidden="true" /><strong>{folder.name}</strong><small>{count} projetos - {scope}</small></button><button type="button" className="project-folder-favorite" aria-label={`${folder.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}: ${folder.name}`} aria-pressed={folder.favorite} onClick={() => void toggleRemoteProjectFolderFavorite(folder)}><Star size={16} fill={folder.favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button><button type="button" className="project-folder-copy" aria-label={`Fazer uma cópia de ${folder.name}`} disabled={copyingProjectFolderId === folder.id} onClick={() => void duplicateRemoteProjectFolder(folder)}><Copy size={15} aria-hidden="true" /></button></article>})}</div>}
        {!activeFolderCloud && folderFavoritesOnly && !remoteProjectFolders.some(folder => folder.favorite) && <p className="project-folder-empty">As pastas que você favoritar aparecerão aqui.</p>}
      </section>}
      <div className="home-projects-heading" id="home-projects"><h2>{activeProjectFolder ? `Projetos em ${activeProjectFolder.name}` : activeRemoteProjectFolder ? `Projetos em ${activeRemoteProjectFolder.name}` : libraryMode === 'local' ? 'Seus projetos' : 'Projetos compartilhados'}</h2><button onClick={() => void (libraryMode === 'local' ? createProject('design') : createRemoteProject('design'))}><Plus size={14} aria-hidden="true" /> Criar design</button></div>
      {error && <p className="home-error" role="alert">{error}</p>}
      {remoteError && <p className="home-error" role="alert">{remoteError}</p>}
      {csvImportError && <p className="home-error" role="alert">{csvImportError}</p>}
      {activeRemoteProjectFolder && <><div className="project-folder-content-toolbar"><label className="project-folder-search"><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={event => { const next = event.target.value; setQuery(next); syncProjectSearchRoute(next) }} placeholder="Busque nesta pasta" aria-label="Buscar nesta pasta" /></label><label className="project-folder-select">Tipo<select aria-label="Filtrar por tipo" value={folderTypeFilter} onChange={event => setFolderTypeFilter(event.target.value as typeof folderTypeFilter)}><option value="all">Todos os tipos</option><option value="design">Design</option><option value="presentation">Apresentação</option><option value="doc">Documento</option><option value="sheet">Planilha</option><option value="whiteboard">Quadro branco</option><option value="video">Vídeo</option><option value="site">Site</option></select></label><span className="project-folder-toolbar-spacer" /><label className="project-folder-select">Ordenar por<select aria-label="Ordenar projetos da pasta" value={folderSort} onChange={event => setFolderSort(event.target.value as typeof folderSort)}><option value="recent">Edições mais recentes</option><option value="name">Nome</option></select></label><button className="project-folder-view-button" type="button" aria-label="Visualização em lista" aria-pressed="true"><LayoutGrid size={17} aria-hidden="true" /></button></div><div className="project-folder-table-heading" aria-hidden="true"><span>Nome</span><span>Pessoas</span><span>Tipo</span><span>Editado</span><span /></div></>}
      <div className="home-toolbar">
        <div className="library-mode-tabs" aria-label="Local dos projetos">
          <button className={libraryMode === 'local' ? 'chosen' : ''} onClick={() => { setLibraryMode('local'); setProjectFilter('recent'); setActiveFolderId(null); setActiveFolderCloud(false); if (window.location.pathname.startsWith('/cloud-folder/')) window.history.pushState({}, '', '/') }}>Neste dispositivo</button>
          <button className={libraryMode === 'cloud' ? 'chosen' : ''} onClick={() => { if (user) { setLibraryMode('cloud'); setProjectFilter('recent'); setActiveFolderId(null); setActiveFolderCloud(false); if (window.location.pathname.startsWith('/folder/')) window.history.pushState({}, '', '/'); void refreshRemoteDocuments() } else { setAuthMode('login'); setAuthOpen(true) } }}>Nuvem</button>
        </div>
        <div className="project-filters" aria-label="Filtro de projetos">
          <button className={projectFilter === 'recent' ? 'chosen' : ''} onClick={() => setProjectFilter('recent')}>Recentes</button>
          <button className={projectFilter === 'archived' ? 'chosen' : ''} onClick={() => setProjectFilter('archived')}>Arquivados</button>
          <button className={projectFilter === 'trash' ? 'chosen' : ''} onClick={() => setProjectFilter('trash')}>Lixeira</button>
        </div>
        <div className="project-filters" aria-label="Filtros de busca">
          <button type="button" aria-pressed={projectsFilters.category === 'sheet'} onClick={() => syncProjectsFilters({ ...projectsFilters, category: projectsFilters.category === 'sheet' ? 'all' : 'sheet' })}>{projectsFilters.category === 'sheet' ? 'Categoria: Planilha' : 'Categoria'}</button>
          <button type="button" aria-pressed={projectsFilters.edited === 'today'} onClick={() => syncProjectsFilters({ ...projectsFilters, edited: projectsFilters.edited === 'today' ? 'any' : 'today' })}>{projectsFilters.edited === 'today' ? 'Data de edição: Hoje' : 'Data de edição'}</button>
          {(query || projectsFilters.category !== 'all' || projectsFilters.edited !== 'any' || designSearchScope) && <button type="button" onClick={clearProjectsFilters}>Limpar filtros</button>}
        </div>
        {projectFilter === 'trash' && libraryMode === 'local' && allLocalTrashDocuments.length > 0 && <button type="button" className="empty-trash-button" onClick={() => setPendingTrashEmpty({ mode: 'local', documents: allLocalTrashDocuments.map(document => ({ id: document.id, updatedAt: document.updatedAt })), count: allLocalTrashDocuments.length })}>Esvaziar lixeira</button>}
        {projectFilter === 'trash' && libraryMode === 'cloud' && allRemoteTrashDocuments.length > 0 && <button type="button" className="empty-trash-button" onClick={() => setPendingTrashEmpty({ mode: 'cloud', documents: allRemoteTrashDocuments.map(document => ({ id: document.id, revision: document.revision })), count: allRemoteTrashDocuments.length })}>Esvaziar lixeira</button>}
      </div>
      <div className="home-import-actions"><button onClick={() => csvInputRef.current?.click()} disabled={csvImportBusy}>Importar CSV</button><button onClick={() => excelInputRef.current?.click()} disabled={csvImportBusy}>Importar XLSX</button><button onClick={() => pptxInputRef.current?.click()} disabled={csvImportBusy}>Importar PPTX</button></div>
      {user && libraryMode === 'cloud' && <section className="teams-strip" aria-label="Suas equipes"><div><h2>Equipes</h2><form onSubmit={event => void submitCreateTeam(event)}><input name="team-name" placeholder="Nome da equipe" aria-label="Nome da nova equipe" minLength={2} maxLength={100} required /><button type="submit">Criar equipe</button></form></div>{teams.length ? <div className="teams-list">{teams.map(team => <button key={team.id} className={selectedTeamId === team.id ? 'chosen' : ''} onClick={() => void openTeamDialog(team)}>{team.name}<small>{team.memberCount} {team.memberCount === 1 ? 'integrante' : 'integrantes'} - {team.role === 'admin' ? 'admin' : 'membro'}</small></button>)}</div> : <p>Crie uma equipe para compartilhar projetos com seu grupo.</p>}</section>}
      {libraryMode === 'local' ? loading ? <div className="home-loading" role="status">Carregando projetos…</div> : visibleDocuments.length > 0 ? <div className="project-grid">
        {visibleDocuments.map(document => <article className="project-card" key={document.id}>
          <button className="project-open" onClick={() => { setActiveStorageMode('local'); setActiveId(document.id) }} aria-label={`Abrir ${document.name}`}>
            <ProjectPreview document={document} />
            <span className="project-card-copy"><strong>{document.name}</strong><small>{document.pages.length} {document.pages.length === 1 ? 'página' : 'páginas'} - {new Date(document.updatedAt).toLocaleDateString('pt-BR')}</small></span>
          </button>
          <div className="project-card-actions">
            <button onClick={() => { setPendingMoveDocument(document); setMoveFolderQuery('') }} aria-label={`Mover ${document.name} para uma pasta`} title="Mover para pasta"><FolderOpen size={15} aria-hidden="true" /></button>
            <button onClick={() => void duplicateProject(document)} aria-label={`Duplicar ${document.name}`} title="Duplicar"><Copy size={15} aria-hidden="true" /></button>
            {document.trashedAt ? <><button onClick={() => void setTrashed(document, false)} aria-label={`Restaurar ${document.name} da lixeira`} title="Restaurar da lixeira"><ArchiveRestore size={15} aria-hidden="true" /></button><button onClick={() => setPendingPermanentDelete({ mode: 'local', id: document.id, name: document.name, updatedAt: document.updatedAt })} aria-label={`Excluir ${document.name} permanentemente`} title="Excluir permanentemente"><Trash2 size={15} aria-hidden="true" /></button></> : <>
              <button onClick={() => void setArchived(document, !document.archivedAt)} aria-label={`${document.archivedAt ? 'Restaurar' : 'Arquivar'} ${document.name}`} title={document.archivedAt ? 'Restaurar' : 'Arquivar'}>{document.archivedAt ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}</button>
              <button onClick={() => void setTrashed(document, true)} aria-label={`Mover ${document.name} para a lixeira`} title="Mover para a lixeira"><Trash2 size={15} aria-hidden="true" /></button>
            </>}
          </div>
        </article>)}
      </div> : <div className="home-empty">
        <div className="home-empty-icon"><Sparkles size={24} aria-hidden="true" /></div>
        <h2>{query || projectsFilters.category !== 'all' || projectsFilters.edited !== 'any' ? 'Nenhum resultado encontrado' : projectFilter === 'trash' ? 'Lixeira vazia' : projectFilter === 'archived' ? 'Nenhum projeto arquivado' : 'Seu próximo projeto começa aqui'}</h2>
        <p>{query || projectsFilters.category !== 'all' || projectsFilters.edited !== 'any' ? 'Não encontramos projetos para estes filtros. Ajuste ou limpe os filtros para ver mais resultados.' : projectFilter === 'trash' ? 'Projetos removidos aparecer\u00e3o aqui.' : projectFilter === 'archived' ? 'Projetos arquivados aparecerão aqui.' : 'Crie um design em branco e comece a montar sua ideia.'}</p>
        {!query && projectFilter === 'recent' && <button onClick={() => void createProject()}>Criar primeiro design</button>}
      </div> : !user ? <div className="home-empty cloud-empty"><div className="home-empty-icon"><Cloud size={24} aria-hidden="true" /></div><h2>Entre para abrir seus projetos na nuvem</h2><p>Salve em uma conta para acessar documentos compartilhados.</p><button onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Entrar ou criar conta</button></div> : remoteBusy ? <div className="home-loading" role="status">Carregando projetos da nuvem…</div> : visibleRemoteDocuments.length ? <div className="project-grid">
        {visibleRemoteDocuments.map(remote => <article className={`project-card${activeRemoteProjectFolder ? ' folder-project-row' : ''}`} key={remote.id}>
          <button className="project-open" onClick={() => { setActiveStorageMode('cloud'); setActiveId(remote.id) }} aria-label={`Abrir ${remote.name}`}>
            <ProjectPreview document={{ ...remote.data, id: remote.id, name: remote.name }} />
            <span className="project-card-copy"><strong>{remote.name}</strong><small>{remote.role === 'owner' ? 'Seu projeto' : `Compartilhado - ${remote.role}`} - {formatShortDate(remote.updatedAt)}</small></span>
          </button>
          {activeRemoteProjectFolder && <><span className="folder-project-people">{remote.role === 'owner' ? 'Só você' : remote.role === 'editor' ? 'Você e equipe' : 'Compartilhado'}</span><span className="folder-project-type">{{ design: 'Design', presentation: 'Apresentação', doc: 'Documento', sheet: 'Planilha', whiteboard: 'Quadro branco', video: 'Vídeo', site: 'Site' }[remote.data.type ?? 'design']}</span><span className="folder-project-date">{formatShortDate(remote.updatedAt)}</span></>}
          {<div className="project-card-actions">{['owner', 'editor'].includes(remote.role) && <button onClick={() => { setPendingMoveDocument({ ...remote.data, id: remote.id, name: remote.name }); setMoveFolderQuery('') }} aria-label={`Mover ${remote.name} para uma pasta na nuvem`} title="Mover para pasta"><FolderOpen size={15} aria-hidden="true" /></button>}{remote.role === 'owner' && <><button onClick={() => void openShareDialog(remote)} aria-label={`Compartilhar ${remote.name}`} title="Compartilhar"><Share2 size={15} aria-hidden="true" /></button><button onClick={() => void duplicateRemoteProject(remote)} aria-label={`Duplicar ${remote.name}`} title="Duplicar"><Copy size={15} aria-hidden="true" /></button>{remote.data.trashedAt ? <><button onClick={() => void setRemoteTrashed(remote, false)} aria-label={`Restaurar ${remote.name} da lixeira`} title="Restaurar da lixeira"><ArchiveRestore size={15} aria-hidden="true" /></button><button onClick={() => setPendingPermanentDelete({ mode: 'cloud', id: remote.id, name: remote.name, revision: remote.revision })} aria-label={`Excluir ${remote.name} permanentemente`} title="Excluir permanentemente"><Trash2 size={15} aria-hidden="true" /></button></> : <><button onClick={() => void setRemoteArchived(remote, !remote.data.archivedAt)} aria-label={`${remote.data.archivedAt ? 'Restaurar' : 'Arquivar'} ${remote.name}`} title={remote.data.archivedAt ? 'Restaurar' : 'Arquivar'}>{remote.data.archivedAt ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}</button><button onClick={() => void setRemoteTrashed(remote, true)} aria-label={`Mover ${remote.name} para a lixeira`} title="Mover para a lixeira"><Trash2 size={15} aria-hidden="true" /></button></>}</>}</div>}
        </article>)}
      </div> : <div className="home-empty"><div className="home-empty-icon"><Cloud size={24} aria-hidden="true" /></div><h2>{query ? 'Nenhum projeto encontrado' : projectFilter === 'trash' ? 'Lixeira vazia' : projectFilter === 'archived' ? 'Nenhum projeto arquivado' : 'Sua nuvem está vazia'}</h2><p>{query ? 'Tente outro termo de busca.' : projectFilter === 'trash' ? 'Projetos removidos aparecer\u00e3o aqui.' : projectFilter === 'archived' ? 'Projetos arquivados na nuvem aparecerão aqui.' : 'Crie um projeto compartilhável para começar.'}</p>{!query && projectFilter === 'recent' && <button onClick={() => void createRemoteProject()}>Criar primeiro projeto</button>}</div>}
      <div className="home-next-modules"><span>OUTROS MÓDULOS</span><p>Apresentações básicas, quadros com pan/zoom e um editor inicial de Sites com prévia responsiva já estão disponíveis. Explore exemplos auditados de integrações em Apps; publicação externa exige um provedor configurado, enquanto domínio próprio e conexões externas seguem em implementação.</p></div>
    </section>
    {receivedTeamInvitation && <div className="auth-backdrop"><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="team-invite-title"><button className="auth-close" onClick={() => setReceivedTeamInvitation(null)} aria-label="Fechar convite"><X size={18} /></button><span className="auth-mark"><UsersRound size={19} aria-hidden="true" /></span><h2 id="team-invite-title">Convite para uma equipe</h2><p><strong>{receivedTeamInvitation.inviterName}</strong> convidou você para <strong>{receivedTeamInvitation.teamName}</strong>.</p><small>Convite enviado para {receivedTeamInvitation.email}; papel de {receivedTeamInvitation.role === 'admin' ? 'administrador' : 'integrante'}.</small>{teamError && <p className="auth-error" role="alert">{teamError}</p>}<button className="auth-submit" onClick={() => void acceptTeamInvite()}>Aceitar convite</button></section></div>}
    {teamDialogOpen && selectedTeamId && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setTeamDialogOpen(false) }}><section className="share-dialog team-dialog" role="dialog" aria-modal="true" aria-labelledby="team-dialog-title"><button className="auth-close" onClick={() => setTeamDialogOpen(false)} aria-label="Fechar equipe"><X size={18} /></button><span className="auth-mark"><UsersRound size={19} aria-hidden="true" /></span><h2 id="team-dialog-title">{teams.find(team => team.id === selectedTeamId)?.name ?? 'Equipe'}</h2><p>Integrantes e acesso a projetos compartilhados desta equipe.</p>{teamIntegrationsOpen ? <TeamIntegrationsPanel teamId={selectedTeamId} initialSelectedIds={teamIntegrationIdsByTeam[selectedTeamId] ?? []} onSave={ids => saveTeamIntegrations(selectedTeamId, ids)} onClose={() => setTeamIntegrationsOpen(false)} /> : <><TeamRosterPanel members={teamDialogMembers} currentUserId={user?.id ?? ''} teamRole={teams.find(team => team.id === selectedTeamId)?.role === 'admin' ? 'admin' : 'member'} busyMemberId={teamMemberBusyId} onRoleChange={(member, role) => void changeTeamRole(member, role)} onRemove={member => void removeTeamMember(member)} />{teams.find(team => team.id === selectedTeamId)?.role === 'admin' && <button type="button" className="team-integrations-open" onClick={() => openTeamIntegrations(selectedTeamId)}>Gerenciar integrações</button>}</>}{teams.find(team => team.id === selectedTeamId)?.role === 'admin' && <><a className="team-domain-settings-link" href="/settings/apps/manage-ai-apps">Gerenciar apps do Canva IA</a><a className="team-domain-settings-link" href="/settings/sso/domain-verification">Configurações de domínio e SSO</a></>}<button className="team-create-project" onClick={() => void createRemoteProjectForTeam(selectedTeamId)}>Criar projeto nesta equipe</button>{teams.find(team => team.id === selectedTeamId)?.role === 'admin' && <form className="share-form share-invitation-form" onSubmit={event => void inviteTeamMember(event)}><label>E-mail para convidar<input name="team-email" type="email" required /></label><button className="auth-submit" type="submit">Convidar integrante</button></form>}{teams.find(team => team.id === selectedTeamId)?.role === 'admin' && <div className="share-list team-invitations"><h3>Convites</h3>{teamInvitations.map(invitation => <div className="share-person" key={invitation.id}><span className="home-avatar"><Mail size={14} aria-hidden="true" /></span><span>{invitation.email}<small>{invitation.acceptedAt ? 'Aceito' : invitation.revokedAt ? 'Revogado' : invitation.expired ? 'Expirado' : `Pendente - ${invitation.role === 'admin' ? 'Administrador' : 'Integrante'}`}</small></span>{!invitation.acceptedAt && !invitation.revokedAt && !invitation.expired && <button type="button" aria-label={`Revogar convite para ${invitation.email}`} disabled={teamInvitationBusyId === invitation.id} onClick={() => void cancelTeamInvite(invitation)}>{teamInvitationBusyId === invitation.id ? 'Aguarde…' : 'Revogar'}</button>}</div>)}{teamInvitations.length === 0 && <p className="share-none">Nenhum convite enviado.</p>}</div>}{teamInviteLink && <div className="share-link-copy"><label htmlFor="team-invite-link">Link do convite</label><div><input id="team-invite-link" readOnly value={teamInviteLink} onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => void navigator.clipboard.writeText(teamInviteLink)}>Copiar</button></div></div>}<p className="share-notice">{teamInviteNotice || 'Convites expiram em 7 dias. Configure o provedor de e-mail para habilitar o envio automatico.'}</p>{teams.find(team => team.id === selectedTeamId)?.role === 'admin' && <div className="share-list team-audit"><h3>Atividade recente</h3>{teamAuditEvents.length ? teamAuditEvents.map(event => <div className="team-audit-event" key={event.id}><strong>{event.actorName}</strong><span>{teamAuditLabel(event.action, event.details)}</span><small>{new Date(event.createdAt).toLocaleString('pt-BR')}</small></div>) : <p className="share-none">Nenhuma atividade registrada.</p>}{teamAuditCursor && <button className="team-audit-more" disabled={teamAuditBusy} onClick={() => void loadOlderTeamAudit()}>{teamAuditBusy ? 'Carregando…' : 'Carregar atividade anterior'}</button>}</div>}{teamError && <p className="auth-error" role="alert">{teamError}</p>}</section></div>}
    {templateGalleryOpen && <div className="template-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeTemplateGallery() }}><section className="template-dialog" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <header className="template-heading">
        <div className="template-heading-copy"><span className="template-eyebrow">FUSE STUDIO / MODELOS</span><h2 id="template-title">Encontre um ponto de partida</h2><p>Explore modelos editaveis e abra uma previa antes de criar seu projeto.</p></div>
        <button className="template-close" onClick={closeTemplateGallery} aria-label="Fechar modelos"><X size={18} aria-hidden="true" /></button>
        <label className="template-search"><Search className="template-search-icon" size={17} aria-hidden="true" /><input type="search" value={templateQuery} onChange={event => { const next = event.target.value; setTemplateQuery(next); syncTemplateRoute(true, next) }} placeholder="Buscar modelos" aria-label="Buscar modelos" /><button type="button" disabled={!templateQuery} onClick={() => { setTemplateQuery(''); syncTemplateRoute(true, '') }} aria-label="Limpar busca"><X size={15} aria-hidden="true" /></button></label>
        <div className="template-discovery-controls"><div className="template-category-filters" role="group" aria-label="Filtrar modelos por categoria"><button className={templateCategory === 'all' ? 'chosen' : ''} onClick={() => { setTemplateCategory('all'); syncTemplateRoute(true, templateQuery, templateLanguage, 'all') }}>Tudo</button>{templateCategories.map(category => <button key={category} className={templateCategory === category ? 'chosen' : ''} onClick={() => { setTemplateCategory(category); syncTemplateRoute(true, templateQuery, templateLanguage, category) }}>{category}</button>)}</div><label className="template-select-filter">Tipo<select aria-label="Tipo dos modelos" value={templateType} onChange={event => { const next = event.target.value as StarterTemplateType; setTemplateType(next); syncTemplateRoute(true, templateQuery, templateLanguage, templateCategory, next) }}><option value="all">Todos os tipos</option><option value="design">Design</option><option value="presentation">Apresentação</option><option value="site">Site</option><option value="doc">Documento</option></select></label><label className="template-select-filter">Paleta<select aria-label="Paleta dos modelos" value={templatePalette} onChange={event => { const next = event.target.value as StarterTemplatePalette; setTemplatePalette(next); syncTemplateRoute(true, templateQuery, templateLanguage, templateCategory, templateType, next) }}><option value="all">Todas as cores</option><option value="violet">Violeta</option><option value="warm">Quentes</option><option value="green">Verdes</option><option value="dark">Escuras</option></select></label><label className="template-select-filter">Licença<select aria-label="Licença dos modelos" value={templateLicense} onChange={event => { const next = event.target.value as StarterTemplateLicense; setTemplateLicense(next); syncTemplateRoute(true, templateQuery, templateLanguage, templateCategory, templateType, templatePalette, next) }}><option value="all">Todas as licenças</option><option value="original">Originais Fuse Studio</option></select></label><label className="template-language">Idioma<select aria-label="Idioma dos modelos" value={templateLanguage} onChange={event => { const next = event.target.value as 'all' | 'pt'; setTemplateLanguage(next); syncTemplateRoute(true, templateQuery, next) }}><option value="all">Todos os idiomas</option><option value="pt">Português</option></select></label></div>
      </header>
      <div className="template-grid" aria-live="polite">{visibleStarterTemplates.map(template => <article className="template-card" key={template.id}>
        <button className="template-card-preview" onClick={event => { templatePreviewReturnFocusRef.current = event.currentTarget; setTemplatePreviewPageIndex(0); setSelectedTemplateId(template.id); setTemplateActionMenuOpen(false) }} aria-label={`Visualizar ${template.name}`}><ProjectPreview document={templatePreviewDocuments.get(template.id)!} /><span>Visualizar</span></button>
        <div className="template-card-copy"><span>{template.category} - {STARTER_TEMPLATE_METADATA[template.id].format} - Original Fuse Studio</span><h3>{template.name}</h3><p>{template.description}</p><div><button className={favoriteTemplateIds.includes(template.id) ? 'template-favorite is-favorite' : 'template-favorite'} aria-pressed={favoriteTemplateIds.includes(template.id)} onClick={() => setFavoriteTemplateIds(current => current.includes(template.id) ? current.filter(id => id !== template.id) : [...current, template.id])}>{favoriteTemplateIds.includes(template.id) ? 'Salvo' : 'Favoritar'}</button><button className="template-use" onClick={() => void createTemplateProject(template.id)}>Usar modelo</button></div></div>
      </article>)}{visibleStarterTemplates.length === 0 && <div className="template-empty" role="status"><span className="template-empty-mark" aria-hidden="true"><SearchX size={36} /></span><h3>Nenhum modelo encontrado</h3><p>{templateQuery ? <>Ãao encontramos resultados para <strong>?{templateQuery}?</strong>.</> : 'Ãao ha modelos nesta categoria e idioma.'}</p><button onClick={() => { setTemplateQuery(''); setTemplateCategory('all'); setTemplateLanguage('all'); setTemplateType('all'); setTemplatePalette('all'); setTemplateLicense('all'); syncTemplateRoute(true, '', 'all', 'all', 'all', 'all', 'all') }}>Limpar filtros</button></div>}</div>
      <footer className="template-footer">Catálogo inicial de modelos editáveis — resultados locais</footer>
    </section>
    {selectedStarterTemplate && selectedStarterDocument && selectedStarterPreviewDocument && <div className="template-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setSelectedTemplateId(null); setTemplateActionMenuOpen(false) } }}><section className="template-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="template-preview-title">
      <button className="template-close template-preview-close" onClick={() => { setSelectedTemplateId(null); setTemplateActionMenuOpen(false) }} aria-label="Fechar prévia"><X size={18} aria-hidden="true" /></button>
      <div className="template-preview-art"><ProjectPreview document={selectedStarterPreviewDocument} />{selectedStarterDocument.pages.length > 1 && <nav className="template-preview-pagination" aria-label="Páginas da prévia"><button type="button" aria-label="Página anterior da prévia" disabled={templatePreviewPageIndex === 0} onClick={() => setTemplatePreviewPageIndex(index => Math.max(0, index - 1))}>&lsaquo;</button><span aria-live="polite">Página {templatePreviewPageIndex + 1} de {selectedStarterDocument.pages.length}</span><button type="button" aria-label="Próxima página da prévia" disabled={templatePreviewPageIndex >= selectedStarterDocument.pages.length - 1} onClick={() => setTemplatePreviewPageIndex(index => Math.min(selectedStarterDocument.pages.length - 1, index + 1))}>&rsaquo;</button></nav>}</div>
      <aside className="template-preview-info"><span className="template-eyebrow">{selectedStarterTemplate.category}</span><h2 id="template-preview-title">{selectedStarterTemplate.name}</h2><p>{selectedStarterDocument.type === 'presentation' ? 'Apresentacao' : 'Design'} ? {selectedStarterDocument.width} ? {selectedStarterDocument.height} px</p><p>{selectedStarterTemplate.description}</p><div className="template-preview-actions"><button className="template-use" onClick={() => void createTemplateProject(selectedStarterTemplate.id)}>Personalizar este modelo</button><button className={favoriteTemplateIds.includes(selectedStarterTemplate.id) ? 'template-favorite is-favorite' : 'template-favorite'} aria-pressed={favoriteTemplateIds.includes(selectedStarterTemplate.id)} onClick={() => setFavoriteTemplateIds(current => current.includes(selectedStarterTemplate.id) ? current.filter(id => id !== selectedStarterTemplate.id) : [...current, selectedStarterTemplate.id])}>{favoriteTemplateIds.includes(selectedStarterTemplate.id) ? 'Salvo' : 'Favoritar'}</button><div className="template-action-wrap"><button className="template-more" aria-label="Mais opções do modelo" aria-expanded={templateActionMenuOpen} onClick={() => setTemplateActionMenuOpen(open => !open)}><MoreHorizontal size={18} aria-hidden="true" /></button>{templateActionMenuOpen && <div className="template-action-menu" role="menu"><button role="menuitem" onClick={() => void createTemplateProject(selectedStarterTemplate.id)}>Usar este modelo</button><button role="menuitem" onClick={() => { setFavoriteTemplateIds(current => current.includes(selectedStarterTemplate.id) ? current : [...current, selectedStarterTemplate.id]); setTemplateActionMenuOpen(false) }}>Adicionar aos favoritos</button></div>}</div></div></aside>
    </section></div>}
    </div>}
    {folderDialogOpen && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFolderDialogOpen(false) }}><section className="auth-dialog project-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="new-folder-title"><button type="button" className="auth-close" aria-label="Fechar" onClick={() => setFolderDialogOpen(false)}><X size={18} aria-hidden="true" /></button><span className="auth-mark"><FolderOpen size={19} aria-hidden="true" /></span><h2 id="new-folder-title">Criar pasta</h2><p>{libraryMode === 'cloud' ? 'Escolha se esta pasta fica na sua nuvem pessoal ou compartilhada com uma equipe.' : 'Crie uma pasta pessoal para organizar seus projetos neste dispositivo.'}</p><form onSubmit={event => void createProjectFolder(event)}><label>Nome da pasta<input autoFocus name="folder-name" value={folderNameDraft} onChange={event => setFolderNameDraft(event.target.value)} minLength={1} maxLength={100} required /></label>{libraryMode === 'cloud' && <label>Local<select value={folderTeamScopeId} onChange={event => setFolderTeamScopeId(event.target.value)}><option value="">Nuvem pessoal</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name} - compartilhada</option>)}</select></label>}<div className="permanent-delete-actions"><button type="button" className="auth-switch" onClick={() => setFolderDialogOpen(false)}>Cancelar</button><button type="submit" className="auth-submit">Criar pasta</button></div></form></section></div>}
    {pendingMoveDocument && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPendingMoveDocument(null) }}><section className="auth-dialog project-folder-dialog project-folder-picker" role="dialog" aria-modal="true" aria-labelledby="move-project-title"><button type="button" className="auth-close" aria-label="Fechar" onClick={() => setPendingMoveDocument(null)}><X size={18} aria-hidden="true" /></button><span className="auth-mark"><FolderOpen size={19} aria-hidden="true" /></span><h2 id="move-project-title">Mover projeto</h2><p><strong>{pendingMoveDocument.name}</strong> será movido para uma pasta {libraryMode === 'cloud' ? 'na nuvem' : 'neste dispositivo'}.</p><label>Buscar pasta<input type="search" value={moveFolderQuery} onChange={event => setMoveFolderQuery(event.target.value)} placeholder="Nome da pasta" /></label><div className="project-folder-picker-list"><button type="button" onClick={() => void moveDocumentToFolder(pendingMoveDocument, null).then(done => { if (done) setPendingMoveDocument(null) })}><FolderOpen size={17} aria-hidden="true" /><span>{libraryMode === 'cloud' ? 'Projetos na nuvem' : 'Meus projetos'}<small>Remover de qualquer pasta</small></span></button>{(libraryMode === 'cloud' ? remoteProjectFolders.filter(folder => folder.teamId === (remoteDocuments.find(item => item.id === pendingMoveDocument.id)?.teamId ?? null)) : projectFolders).filter(folder => folder.id !== pendingMoveDocument.folderId && folder.name.toLocaleLowerCase('pt-BR').includes(moveFolderQuery.trim().toLocaleLowerCase('pt-BR'))).map(folder => <button type="button" key={folder.id} onClick={() => void moveDocumentToFolder(pendingMoveDocument, folder.id).then(done => { if (done) setPendingMoveDocument(null) })}><FolderOpen size={17} aria-hidden="true" /><span>{folder.name}<small>{libraryMode === 'cloud' ? remoteDocuments.filter(document => document.data.folderId === folder.id && !document.data.trashedAt).length : documents.filter(document => document.folderId === folder.id && !document.trashedAt).length} projetos</small></span></button>)}{!(libraryMode === 'cloud' ? remoteProjectFolders : projectFolders).some(folder => folder.id !== pendingMoveDocument.folderId && folder.name.toLocaleLowerCase('pt-BR').includes(moveFolderQuery.trim().toLocaleLowerCase('pt-BR'))) && moveFolderQuery.trim() && <p role="status">Nenhuma pasta corresponde à busca.</p>}</div><button type="button" className="auth-switch" onClick={() => setPendingMoveDocument(null)}>Cancelar</button></section></div>}
    {appsMarketplaceOpen && <AppsMarketplace onClose={() => setAppsMarketplaceOpen(false)} />}
    {pendingTrashEmpty && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !trashEmptyBusy) setPendingTrashEmpty(null) }}><section className="auth-dialog permanent-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="empty-trash-title" aria-describedby="empty-trash-description"><span className="auth-mark"><Trash2 size={19} aria-hidden="true" /></span><h2 id="empty-trash-title">Esvaziar lixeira?</h2><p id="empty-trash-description">Serão excluídos permanentemente {pendingTrashEmpty.count} {pendingTrashEmpty.count === 1 ? 'projeto' : 'projetos'} e seus históricos. Esta ação não pode ser desfeita.</p><div className="permanent-delete-actions"><button type="button" className="auth-switch" disabled={trashEmptyBusy} onClick={() => setPendingTrashEmpty(null)}>Cancelar</button><button type="button" className="auth-submit permanent-delete-submit" disabled={trashEmptyBusy} onClick={() => void emptyTrash()}>{trashEmptyBusy ? 'Esvaziando…' : 'Esvaziar lixeira'}</button></div></section></div>}
    {pendingPermanentDelete && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !permanentDeleteBusy) setPendingPermanentDelete(null) }}><section className="auth-dialog permanent-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permanent-delete-title" aria-describedby="permanent-delete-description"><span className="auth-mark"><Trash2 size={19} aria-hidden="true" /></span><h2 id="permanent-delete-title">Excluir projeto permanentemente?</h2><p id="permanent-delete-description"><strong>{pendingPermanentDelete.name}</strong> e seu histórico serão removidos. Esta ação não pode ser desfeita.</p><div className="permanent-delete-actions"><button type="button" className="auth-switch" disabled={permanentDeleteBusy} onClick={() => setPendingPermanentDelete(null)}>Cancelar</button><button type="button" className="auth-submit permanent-delete-submit" disabled={permanentDeleteBusy} onClick={() => void permanentlyDeleteProject()}>{permanentDeleteBusy ? 'Excluindo…' : 'Excluir permanentemente'}</button></div></section></div>}
    {authOpen && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAuthOpen(false) }}><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Fechar"><X size={18} /></button>
      <span className="auth-mark">f</span><h2 id="auth-title">{authMode === 'request-reset' ? 'Redefinir senha' : authMode === 'reset-sent' ? 'Verifique seu e-mail' : authMode === 'complete-reset' ? 'Escolha uma nova senha' : authMode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h2><p>{authMode === 'request-reset' ? 'Enviaremos instruções se encontrarmos uma conta com esse e-mail.' : authMode === 'reset-sent' ? 'Se a conta existir, enviaremos as instruções para redefinir a senha.' : authMode === 'complete-reset' ? 'Escolha uma senha nova com pelo menos 10 caracteres.' : 'Acesse seus projetos remotos e colabore com sua equipe.'}</p>
      {authMode === 'reset-sent' ? <div className="auth-reset-sent" role="status">{authNotice}</div> : <form onSubmit={event => void submitAuth(event)}>
        {authMode === 'register' && <label>Seu nome<input name="name" autoComplete="name" required minLength={1} maxLength={80} /></label>}
        {authMode !== 'complete-reset' && <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>}
        {(authMode === 'login' || authMode === 'register' || authMode === 'complete-reset') && <label>{authMode === 'complete-reset' ? 'Nova senha' : 'Senha'}<input name="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={10} maxLength={128} required /></label>}
        {authMode === 'complete-reset' && <label>Repita a nova senha<input name="password-confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>}
        {authNotice && <p className="auth-reset-notice" role="status">{authNotice}</p>}
        {remoteError && <p className="auth-error" role="alert">{remoteError}</p>}
        <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Aguarde…' : authMode === 'request-reset' ? 'Enviar instruções' : authMode === 'complete-reset' ? 'Salvar nova senha' : authMode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        {authMode === 'login' && <button className="auth-recovery-link" type="button" onClick={() => { setRemoteError(''); setAuthNotice(''); setAuthMode('request-reset') }}>Esqueci minha senha</button>}
      </form>}
      <button className="auth-switch" onClick={() => { setRemoteError(''); setAuthNotice(''); setAuthMode(mode => mode === 'login' ? 'register' : 'login') }}>{authMode === 'login' ? 'Ainda não tem conta? Criar conta' : 'Voltar para entrar'}</button>
      {authMode === 'register' && <small>Cadastro local de desenvolvimento. A confirmação de conta por e-mail não está configurada.</small>}
    </section></div>}
    {invitationToken && user && !receivedInvitation && !invitationBusy && invitationError && <div className="auth-backdrop"><section className="auth-dialog" role="alertdialog" aria-modal="true" aria-labelledby="invite-error-title"><h2 id="invite-error-title">Convite indisponível</h2><p>{invitationError}</p><button className="auth-submit" onClick={() => { setInvitationToken(''); const url = new URL(window.location.href); url.searchParams.delete('invite'); window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`) }}>Fechar</button></section></div>}
    {receivedInvitation && <div className="auth-backdrop"><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button className="auth-close" onClick={() => { setReceivedInvitation(null); setInvitationToken('') }} aria-label="Fechar convite"><X size={18} /></button><span className="auth-mark"><UsersRound size={18} aria-hidden="true" /></span><h2 id="invite-title">Convite para colaborar</h2><p><strong>{receivedInvitation.ownerName}</strong> convidou você para <strong>{receivedInvitation.documentName}</strong> como {receivedInvitation.role === 'viewer' ? 'visualizador' : receivedInvitation.role === 'commenter' ? 'comentarista' : 'editor'}.</p><small>Convite enviado para {receivedInvitation.email}. Confirme que está usando esta conta.</small>{invitationError && <p className="auth-error" role="alert">{invitationError}</p>}<button className="auth-submit" disabled={invitationBusy} onClick={() => void acceptInvitation()}>{invitationBusy ? 'Aguarde…' : 'Aceitar convite'}</button></section></div>}
    {shareDocument && <div className="auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShareDocument(null) }}><section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button ref={shareCloseRef} className="auth-close" onClick={() => setShareDocument(null)} aria-label="Fechar compartilhamento"><X size={18} /></button>
      <span className="auth-mark"><UsersRound size={18} aria-hidden="true" /></span>{shareSubview !== 'summary' && <button type="button" className="share-back" onClick={() => setShareSubview('summary')}>Voltar</button>}<h2 id="share-title">{shareSubview === 'summary' ? 'Compartilhar projeto' : shareSubview === 'settings' ? 'Configurações de acesso' : 'Pessoas com acesso'}</h2><p className="share-project-name">{shareDocument.name}</p>
      {shareSubview === 'summary' ? <>
        <div className="share-section-nav"><button type="button" aria-label="Configurações de compartilhamento" onClick={() => setShareSubview('settings')}>Configurações de acesso</button><button type="button" aria-label="Pessoas com acesso" onClick={() => setShareSubview('people')}>Pessoas e convites</button></div>
        <form className="share-form" onSubmit={event => void grantAccess(event)}>
          <label>E-mail da conta<input name="share-email" type="email" autoComplete="off" required /></label>
          <label>Acesso<select name="share-role" defaultValue="editor"><option value="viewer">Visualizador</option><option value="commenter">Comentarista</option><option value="editor">Editor</option></select></label>
          <button className="auth-submit" type="submit" disabled={shareBusy}>{shareBusy ? 'Aguarde…' : 'Conceder acesso'}</button>
        </form>
        <p className="share-notice">A conta precisa estar cadastrada. O acesso é concedido imediatamente; nenhum e-mail é enviado.</p>
        <form className="share-form share-invitation-form" onSubmit={event => void createInvitation(event)}>
          <label>E-mail para convidar<input name="invite-email" type="email" autoComplete="off" required /></label>
          <label>Acesso<select name="invite-role" defaultValue="editor"><option value="viewer">Visualizador</option><option value="commenter">Comentarista</option><option value="editor">Editor</option></select></label>
          <button className="auth-submit" type="submit" disabled={shareBusy}>{shareBusy ? 'Aguarde…' : 'Criar convite por link'}</button>
        </form>
        <p className="share-notice">Convites expiram em 7 dias. Com o provedor configurado, são enviados por e-mail; caso contrário, compartilhe o link.</p>
        {createdInvitationLink && <div className="share-link-copy"><label htmlFor="created-invite-link">Link do convite</label><div><input id="created-invite-link" readOnly value={createdInvitationLink} onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => void navigator.clipboard.writeText(createdInvitationLink).then(() => setShareNotice('Link copiado.')).catch(() => setShareError('Não foi possível copiar automaticamente; selecione e copie o link.'))}>Copiar</button></div></div>}
      </> : shareSubview === 'settings' ? <section className="share-access-settings" aria-label="Configurações de acesso geral">
        <fieldset className="share-access-options"><legend>Quem pode acessar</legend>
          <label><input type="radio" name="share-access" value="private" checked={!sharePublicLinkEnabled} onChange={() => void configurePublicShareLink('revoke')} disabled={shareBusy} /><span><strong>Privado</strong><small>Somente pessoas adicionadas podem acessar.</small></span></label>
          <label><input type="radio" name="share-access" value="link" checked={sharePublicLinkEnabled} onChange={() => void configurePublicShareLink('enable')} disabled={shareBusy} /><span><strong>Qualquer pessoa com o link</strong><small>Visualizacao sem conta; o link permite somente ver, nao editar.</small></span></label>
        </fieldset>
        {sharePublicLinkEnabled && <div className="share-public-link"><strong>Link publico ativo</strong><p>Qualquer pessoa que receber este endereco pode ver o projeto enquanto o link estiver ativo.</p>{createdPublicShareUrl ? <div className="share-link-copy"><label htmlFor="created-public-share-link">Link publico</label><div><input id="created-public-share-link" readOnly value={createdPublicShareUrl} onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => void navigator.clipboard.writeText(createdPublicShareUrl).then(() => setShareNotice('Link copiado.')).catch(() => setShareError('Selecione e copie o link.'))}>Copiar</button></div></div> : <p className="share-notice">Por seguranca, o link atual nao pode ser recuperado. Gere um novo para copiar; o anterior sera revogado.</p>}<div className="share-public-link-actions"><button type="button" onClick={() => void configurePublicShareLink('rotate')} disabled={shareBusy}>Gerar novo link</button><button type="button" onClick={() => void configurePublicShareLink('revoke')} disabled={shareBusy}>Revogar link</button></div></div>}<button type="button" className="share-suspend-access" onClick={() => void toggleDocumentAccessSuspension()} disabled={shareBusy}>{shareDocument.accessSuspended ? 'Reabrir acesso' : 'Suspender acesso'}</button><p className="share-notice">{shareDocument.accessSuspended ? 'Somente pessoas proprietárias ou administradoras da equipe podem acessar enquanto estiver suspenso. Convites pendentes também ficam indisponíveis.' : 'Você pode bloquear temporariamente o acesso de colaboradores sem remover permissões nem convites.'}</p>
      </section> : <>
        <div className="share-list"><h3>Pessoas com acesso</h3><p className="share-owner"><span className="home-avatar">{user?.name.slice(0, 1).toUpperCase()}</span><span>{user?.name}<small>Proprietário</small></span></p>
          {sharePermissions.map(permission => <div className="share-person" key={permission.id}><span className="home-avatar">{permission.name.slice(0, 1).toUpperCase()}</span><span>{permission.name}<small>{permission.email}</small></span><select aria-label={`Papel de ${permission.name}`} value={permission.role} disabled={shareBusy} onChange={event => void updateAccessRole(permission, event.target.value as 'viewer' | 'commenter' | 'editor')}><option value="viewer">Visualizador</option><option value="commenter">Comentarista</option><option value="editor">Editor</option></select><button onClick={() => void revokeAccess(permission)} disabled={shareBusy} aria-label={`Revogar acesso de ${permission.name}`}>Remover</button></div>)}
          {!shareBusy && sharePermissions.length === 0 && <p className="share-none">Ninguém mais tem acesso ainda.</p>}
        </div>
        <div className="share-list"><h3>Convites</h3>{shareInvitations.filter(invitation => !invitation.acceptedAt).map(invitation => <div className="share-person" key={invitation.id}><span className="home-avatar"><Mail size={14} aria-hidden="true" /></span><span>{invitation.email}<small>{invitation.expired ? 'Expirado' : invitation.revokedAt ? 'Revogado' : `Pendente - ${invitation.role}`}</small></span>{!invitation.expired && !invitation.revokedAt && <button onClick={() => void cancelInvitation(invitation)} disabled={shareBusy}>Revogar</button>}</div>)}{!shareBusy && shareInvitations.filter(invitation => !invitation.acceptedAt && !invitation.revokedAt && !invitation.expired).length === 0 && <p className="share-none">Nenhum convite pendente.</p>}</div>
      </>}
      {shareError && <p className="auth-error" role="alert">{shareError}</p>}{shareNotice && <p className="share-status" role="status">{shareNotice}</p>}
    </section></div>}
    </div>
  </main>
}

export default App








