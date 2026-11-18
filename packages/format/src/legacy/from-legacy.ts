// Migrador do formato atual (schemaVersion 0) para .fuse v1.
// Contrato: toLegacy(fromLegacy(doc)) reproduz `doc` (igualdade profunda JSON) para documentos válidos.
// Campos sem equivalente direto no v1 são preservados em extensions["fuse.legacy"].
import type { CellMerge, Clip, DocBlock, DocBody, Sheet, SheetCell, Timeline } from '../schema/content.js'
import type { AssetRef, FuseFile, Page } from '../schema/file.js'
import { FORMAT_ID, SCHEMA_VERSION } from '../schema/file.js'
import type { ConnectorNode, FuseNode, GroupNode } from '../schema/nodes.js'
import { parseRowColumnKey, toCellRef, toRangeRef } from '../sheet-refs.js'
import type {
  LegacyConnector, LegacyDocBlock, LegacyDocument, LegacyElement, LegacyGroup, LegacyMediaAsset, LegacyPage, LegacyTimelineClip,
} from './types.js'

export const LEGACY_EXTENSION = 'fuse.legacy'
export const LIBRARY_EXTENSION = 'fuse.library'
/** pluginId usado para preservar elementos legados de tipo desconhecido. */
export const LEGACY_UNKNOWN_PLUGIN = 'fuse.legacy.unknown-element'

type Json = Record<string, unknown>

export type FromLegacyOptions = {
  /** Registros do store de mídia para preencher FuseFile.assets. */
  assets?: readonly LegacyMediaAsset[]
  /** Locale de meta.locale (padrão "pt-BR"). */
  locale?: string
}

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key) && (record as Json)[key] !== undefined

/** Copia `source[key]` para `target[as]` somente se presente. */
function copy(target: Json, source: object, key: string, as: string = key): void {
  if (has(source, key)) target[as] = (source as Json)[key]
}

/** Chaves fora da lista conhecida (preservadas para roundtrip sem perda). */
function rest(source: object, known: readonly string[]): Json | undefined {
  const extra: Json = {}
  for (const [key, value] of Object.entries(source)) if (!known.includes(key) && value !== undefined) extra[key] = value
  return Object.keys(extra).length ? extra : undefined
}

function withLegacyExtension(target: Json, payload: Json): void {
  const clean = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  if (Object.keys(clean).length) target['extensions'] = { [LEGACY_EXTENSION]: clean }
}

const BASE_KEYS = ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'startMs', 'durationMs'] as const
const TEXT_KEYS = [...BASE_KEYS, 'text', 'href', 'fontSize', 'fontFamily', 'color', 'bold', 'kerning', 'lineSpacing']
const SHAPE_KEYS = [...BASE_KEYS, 'shape', 'fill', 'cornerRadius', 'strokeWidth', 'startArrow', 'endArrow', 'curveOffset', 'qrConfig']
const QR_KEYS = ['pattern', 'url', 'name', 'expiration', 'foreground', 'background', 'logo', 'corner']
const IMAGE_KEYS = [...BASE_KEYS, 'src', 'altText', 'decorative', 'assetId', 'sourceWidth', 'sourceHeight', 'crop', 'opacity', 'flipX', 'flipY',
  'brightness', 'contrast', 'saturation', 'filterPreset', 'imageStylePreset', 'maskStrokes', 'animation']
const STICKY_KEYS = [...BASE_KEYS, 'text', 'fill', 'color', 'fontSize']
const FREE_DRAW_KEYS = [...BASE_KEYS, 'points', 'color', 'strokeWidth', 'opacity']
const CONNECTOR_KEYS = ['id', 'fromId', 'toId', 'fromAnchor', 'toAnchor', 'color', 'strokeWidth']
const GROUP_KEYS = ['id', 'name', 'elementIds']
const CLIP_KEYS = ['id', 'assetId', 'name', 'kind', 'trackIndex', 'opacity', 'fitMode', 'scale', 'offsetX', 'offsetY', 'opacityKeyframes',
  'transformKeyframes', 'animationEasing', 'startMs', 'durationMs', 'sourceDurationMs', 'sourceStartMs', 'volume', 'fadeInMs', 'fadeOutMs']
const BLOCK_KEYS = ['id', 'type', 'text', 'marks', 'image', 'cells', 'cellImages', 'merges', 'cellPadding', 'tableSpacing', 'borderColor', 'borderWidth', 'cellBorders']
const PAGE_KEYS = ['id', 'name', 'background', 'hidden', 'elements', 'timelineClips', 'connectors', 'groups', 'presenterNotes', 'blocks', 'cells',
  'cellMerges', 'cellFormats', 'charts']
const DOCUMENT_KEYS = ['id', 'name', 'type', 'archivedAt', 'trashedAt', 'folderId', 'width', 'height', 'docPageSetup', 'videoDurationMs', 'pages',
  'updatedAt', 'brandKitId']
const ASSET_KEYS = ['id', 'name', 'mimeType', 'width', 'height', 'src', 'fingerprint', 'libraryVisible', 'createdAt', 'scope']

function baseFields(element: LegacyElement): Json {
  const node: Json = { id: element.id }
  copy(node, element, 'name')
  for (const key of ['x', 'y', 'width', 'height', 'rotation']) node[key] = (element as unknown as Json)[key]
  if (has(element, 'startMs') || has(element, 'durationMs')) {
    const timing: Json = {}
    copy(timing, element, 'startMs')
    copy(timing, element, 'durationMs')
    node['timing'] = timing
  }
  return node
}

function convertElement(element: LegacyElement, index: number, pageId: string): FuseNode {
  const raw = element as unknown as Json
  switch (element.type) {
    case 'text': {
      const node: Json = { ...baseFields(element), type: 'text', text: element.text }
      const style: Json = { fontFamily: element.fontFamily, fontSize: element.fontSize, fontWeight: element.bold ? 700 : 400, color: element.color }
      copy(style, element, 'kerning', 'letterSpacing')
      copy(style, element, 'lineSpacing', 'lineHeight')
      node['style'] = style
      copy(node, element, 'href', 'link')
      withLegacyExtension(node, { extra: rest(element, TEXT_KEYS), boldMissing: has(element, 'bold') ? undefined : true })
      return node as FuseNode
    }
    case 'shape': {
      if (element.qrConfig) {
        const qr = element.qrConfig
        const node: Json = { ...baseFields(element), type: 'qr' }
        copy(node, qr, 'url', 'data')
        copy(node, qr, 'name', 'label')
        copy(node, qr, 'expiration', 'expiresAt')
        Object.assign(node, { pattern: qr.pattern, foreground: qr.foreground, background: qr.background, logo: qr.logo, cornerRadius: qr.corner })
        const shape: Json = {}
        for (const key of ['shape', 'fill', 'cornerRadius', 'strokeWidth', 'startArrow', 'endArrow', 'curveOffset']) copy(shape, element, key)
        withLegacyExtension(node, { shape, extra: rest(element, SHAPE_KEYS), qrExtra: rest(qr, QR_KEYS) })
        return node as FuseNode
      }
      const node: Json = { ...baseFields(element), type: 'shape', shape: element.shape, fill: element.fill, cornerRadius: element.cornerRadius }
      copy(node, element, 'strokeWidth')
      if (has(element, 'startArrow') || has(element, 'endArrow')) {
        const markers: Json = {}
        copy(markers, element, 'startArrow', 'start')
        copy(markers, element, 'endArrow', 'end')
        node['markers'] = markers
      }
      copy(node, element, 'curveOffset')
      withLegacyExtension(node, { extra: rest(element, SHAPE_KEYS) })
      return node as FuseNode
    }
    case 'image': {
      const node: Json = { ...baseFields(element), type: 'image' }
      copy(node, element, 'assetId')
      copy(node, element, 'src')
      copy(node, element, 'altText', 'alt')
      copy(node, element, 'decorative')
      copy(node, element, 'sourceWidth', 'intrinsicWidth')
      copy(node, element, 'sourceHeight', 'intrinsicHeight')
      copy(node, element, 'crop')
      copy(node, element, 'opacity')
      copy(node, element, 'flipX')
      copy(node, element, 'flipY')
      if (has(element, 'brightness') || has(element, 'contrast') || has(element, 'saturation')) {
        const adjustments: Json = {}
        for (const key of ['brightness', 'contrast', 'saturation']) copy(adjustments, element, key)
        node['adjustments'] = adjustments
      }
      copy(node, element, 'filterPreset', 'filter')
      copy(node, element, 'imageStylePreset', 'stylize')
      copy(node, element, 'maskStrokes', 'mask')
      copy(node, element, 'animation')
      withLegacyExtension(node, { extra: rest(element, IMAGE_KEYS) })
      return node as FuseNode
    }
    case 'sticky-note': {
      const node: Json = { ...baseFields(element), type: 'sticky', text: element.text, fill: element.fill, color: element.color, fontSize: element.fontSize }
      withLegacyExtension(node, { extra: rest(element, STICKY_KEYS) })
      return node as FuseNode
    }
    case 'free-draw': {
      const node: Json = { ...baseFields(element), type: 'path', points: element.points, tool: 'freehand', stroke: { color: element.color, width: element.strokeWidth } }
      copy(node, element, 'opacity')
      withLegacyExtension(node, { extra: rest(element, FREE_DRAW_KEYS) })
      return node as FuseNode
    }
    default: {
      // Tipo desconhecido: preservado como PluginNode opaco.
      const num = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] : 0)
      const node: Json = {
        id: typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : `legacy-unknown-${pageId}-${index}`,
        type: 'plugin', x: num('x'), y: num('y'), width: num('width'), height: num('height'), rotation: num('rotation'),
        pluginId: LEGACY_UNKNOWN_PLUGIN, data: raw,
      }
      if (typeof raw['name'] === 'string') node['name'] = raw['name']
      return node as FuseNode
    }
  }
}

function convertConnector(connector: LegacyConnector): ConnectorNode {
  const from: Json = { nodeId: connector.fromId }
  copy(from, connector, 'fromAnchor', 'anchor')
  const to: Json = { nodeId: connector.toId }
  copy(to, connector, 'toAnchor', 'anchor')
  const node: Json = { id: connector.id, type: 'connector', from, to, stroke: { color: connector.color, width: connector.strokeWidth } }
  withLegacyExtension(node, { extra: rest(connector, CONNECTOR_KEYS) })
  return node as ConnectorNode
}

function boundsOf(nodes: readonly FuseNode[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const node of nodes) {
    if (node.type === 'connector') continue
    minX = Math.min(minX, node.x); minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width); maxY = Math.max(maxY, node.y + node.height)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Aninha grupos legados (lista plana de elementIds) como GroupNode quando os membros são contíguos na ordem de
 * desenho e não pertencem a outro grupo. Caso contrário o grupo é preservado em extensions (sem alterar o z-order).
 */
function nestGroups(children: FuseNode[], groups: readonly LegacyGroup[]): { children: FuseNode[]; loose: LegacyGroup[] } {
  const loose: LegacyGroup[] = []
  const claimed = new Set<string>()
  let current = children
  const usedIds = new Set<string>(children.map(node => node.id))
  for (const group of groups) {
    const ids = Array.isArray(group.elementIds) ? group.elementIds : []
    const indexes = ids.map(id => current.findIndex(node => node.id === id))
    const first = indexes[0] ?? -1
    const valid = ids.length > 0
      && typeof group.id === 'string' && group.id.length > 0 && !usedIds.has(group.id)
      && new Set(ids).size === ids.length
      && ids.every(id => !claimed.has(id))
      && indexes.every((index, position) => index === first + position && index >= 0)
      && indexes.every(index => current[index]?.type !== 'connector' && current[index]?.type !== 'group')
    if (!valid) { loose.push(group); continue }
    const members = current.slice(first, first + ids.length)
    const node: Json = { id: group.id, type: 'group', ...boundsOf(members), rotation: 0, children: members }
    copy(node, group, 'name')
    withLegacyExtension(node, { extra: rest(group, GROUP_KEYS), nameMissing: has(group, 'name') ? undefined : true })
    current = [...current.slice(0, first), node as GroupNode, ...current.slice(first + ids.length)]
    ids.forEach(id => claimed.add(id))
    usedIds.add(group.id)
  }
  return { children: current, loose }
}

function convertClip(clip: LegacyTimelineClip, pageId: string): Clip {
  const out: Json = { id: clip.id, pageId, assetId: clip.assetId, name: clip.name, kind: clip.kind }
  copy(out, clip, 'trackIndex', 'track')
  for (const key of ['startMs', 'durationMs', 'sourceStartMs', 'sourceDurationMs', 'volume']) out[key] = (clip as unknown as Json)[key]
  copy(out, clip, 'fadeInMs')
  copy(out, clip, 'fadeOutMs')
  copy(out, clip, 'opacity')
  copy(out, clip, 'fitMode', 'fit')
  copy(out, clip, 'scale')
  copy(out, clip, 'offsetX')
  copy(out, clip, 'offsetY')
  copy(out, clip, 'animationEasing', 'easing')
  copy(out, clip, 'opacityKeyframes')
  copy(out, clip, 'transformKeyframes')
  withLegacyExtension(out, { extra: rest(clip, CLIP_KEYS) })
  return out as Clip
}

function convertBlock(block: LegacyDocBlock): DocBlock {
  const out: Json = { id: block.id, type: block.type, text: block.text }
  copy(out, block, 'marks')
  copy(out, block, 'image')
  const tableKeys = ['cells', 'cellImages', 'merges', 'cellPadding', 'tableSpacing', 'borderColor', 'borderWidth', 'cellBorders']
  if (tableKeys.some(key => has(block, key))) {
    const table: Json = {}
    copy(table, block, 'cells', 'rows')
    copy(table, block, 'cellImages')
    copy(table, block, 'merges')
    copy(table, block, 'cellPadding')
    copy(table, block, 'tableSpacing', 'spacing')
    copy(table, block, 'borderColor')
    copy(table, block, 'borderWidth')
    copy(table, block, 'cellBorders')
    out['table'] = table
  }
  withLegacyExtension(out, { extra: rest(block, BLOCK_KEYS) })
  return out as DocBlock
}

function convertSheet(page: LegacyPage): Sheet {
  const grid = Array.isArray(page.cells) ? page.cells : []
  const rowCount = grid.length
  const rowLengths = grid.map(row => (Array.isArray(row) ? row.length : 0))
  const columnCount = rowLengths.reduce((max, length) => Math.max(max, length), 0)
  const cells: Record<string, SheetCell> = {}
  grid.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    if (value !== '') cells[toCellRef(rowIndex, columnIndex)] = { input: value }
  }))
  const formatsExtra: Json = {}
  if (page.cellFormats) {
    for (const [key, format] of Object.entries(page.cellFormats)) {
      const coordinates = parseRowColumnKey(key)
      if (!coordinates) { formatsExtra[key] = format; continue }
      const ref = toCellRef(coordinates.row, coordinates.column)
      cells[ref] = { ...cells[ref], format }
    }
  }
  const sheet: Json = { pageId: page.id, rowCount, columnCount, cells }
  if (has(page, 'cellMerges')) sheet['merges'] = page.cellMerges as CellMerge[]
  if (has(page, 'charts')) {
    sheet['charts'] = (page.charts ?? []).map(chart => {
      const out: Json = { id: chart.id, type: chart.type, title: chart.title, range: toRangeRef(chart.range) }
      return out
    })
  }
  withLegacyExtension(sheet, {
    noCells: has(page, 'cells') ? undefined : true,
    rowLengths: rowLengths.some(length => length !== columnCount) ? rowLengths : undefined,
    hasCellFormats: has(page, 'cellFormats') ? true : undefined,
    cellFormatsExtra: Object.keys(formatsExtra).length ? formatsExtra : undefined,
  })
  return sheet as Sheet
}

/** Converte um registro de mídia legado em AssetRef. */
export function fromLegacyAsset(asset: LegacyMediaAsset): AssetRef {
  const out: Json = { mime: asset.mimeType }
  copy(out, asset, 'name')
  copy(out, asset, 'width')
  copy(out, asset, 'height')
  copy(out, asset, 'src')
  const fingerprint = asset.fingerprint
  const fingerprintIsSha = typeof fingerprint === 'string' && /^[0-9a-f]{64}$/.test(fingerprint)
  if (fingerprintIsSha) out['sha256'] = fingerprint
  copy(out, asset, 'createdAt')
  copy(out, asset, 'scope')
  if (has(asset, 'libraryVisible')) out['libraryVisible'] = asset.libraryVisible === 1
  out['origin'] = { kind: 'import' }
  withLegacyExtension(out, {
    extra: rest(asset, ASSET_KEYS),
    fingerprint: has(asset, 'fingerprint') && !fingerprintIsSha ? fingerprint : undefined,
    libraryVisibleRaw: has(asset, 'libraryVisible') && asset.libraryVisible !== 0 && asset.libraryVisible !== 1 ? asset.libraryVisible : undefined,
  })
  return out as AssetRef
}

/** Converte um documento legado (IndexedDB v3+/SQLite data_json) em FuseFile v1. Função pura. */
export function fromLegacy(document: LegacyDocument, options: FromLegacyOptions = {}): FuseFile {
  const width = document.width
  const height = document.height
  const pages: Page[] = []
  const clips: Clip[] = []
  const sections: DocBody['sections'] = []
  const sheets: Sheet[] = []
  let hasTimelineKey = false

  for (const legacyPage of document.pages) {
    let children: FuseNode[] = (legacyPage.elements ?? []).map((element, index) => convertElement(element, index, legacyPage.id))
    for (const connector of legacyPage.connectors ?? []) children.push(convertConnector(connector))
    const groups = legacyPage.groups ?? []
    const nested = nestGroups(children, groups)
    children = nested.children
    const page: Json = { id: legacyPage.id, name: legacyPage.name, width, height, background: legacyPage.background }
    copy(page, legacyPage, 'hidden')
    copy(page, legacyPage, 'presenterNotes', 'notes')
    page['children'] = children

    const emptyKeys = (['timelineClips', 'connectors', 'groups'] as const)
      .filter(key => Array.isArray(legacyPage[key]) && (legacyPage[key] as unknown[]).length === 0)
    withLegacyExtension(page, {
      extra: rest(legacyPage, PAGE_KEYS),
      emptyKeys: emptyKeys.length ? [...emptyKeys] : undefined,
      looseGroups: nested.loose.length ? nested.loose : undefined,
      groupOrder: groups.length > 1 ? groups.map(group => group.id) : undefined,
      elementsMissing: Array.isArray(legacyPage.elements) ? undefined : true,
    })
    pages.push(page as Page)

    if (has(legacyPage, 'timelineClips')) hasTimelineKey = true
    for (const clip of legacyPage.timelineClips ?? []) clips.push(convertClip(clip, legacyPage.id))
    if (has(legacyPage, 'blocks')) sections.push({ pageId: legacyPage.id, blocks: (legacyPage.blocks ?? []).map(convertBlock) })
    if (['cells', 'cellMerges', 'cellFormats', 'charts'].some(key => has(legacyPage, key))) sheets.push(convertSheet(legacyPage))
  }

  const kind = document.type ?? 'design'
  const meta: Json = { title: document.name, createdAt: document.updatedAt, updatedAt: document.updatedAt, locale: options.locale ?? 'pt-BR', tags: [] }
  copy(meta, document, 'brandKitId')

  const file: Json = {
    format: FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    id: document.id,
    kind,
    meta,
    pages,
  }
  if (sections.length || has(document, 'docPageSetup')) {
    const doc: Json = { sections }
    copy(doc, document, 'docPageSetup', 'pageSetup')
    file['doc'] = doc
  }
  if (sheets.length) file['sheets'] = sheets
  if (hasTimelineKey || clips.length || has(document, 'videoDurationMs')) {
    const timeline: Json = { clips }
    copy(timeline, document, 'videoDurationMs', 'durationMs')
    file['timeline'] = timeline as Timeline
  }
  if (kind === 'site') file['site'] = { navigation: pages.map(page => ({ pageId: page.id })) }

  const assets: Record<string, AssetRef> = {}
  for (const asset of options.assets ?? []) assets[asset.id] = fromLegacyAsset(asset)
  file['assets'] = assets
  file['styles'] = { colors: [], textStyles: [], effects: [] }

  const extensions: Json = {}
  const library: Json = {}
  copy(library, document, 'folderId')
  copy(library, document, 'archivedAt')
  copy(library, document, 'trashedAt')
  if (Object.keys(library).length) extensions[LIBRARY_EXTENSION] = library
  const legacy: Json = {}
  if (!has(document, 'type')) legacy['typeMissing'] = true
  if (!pages.length) { legacy['width'] = width; legacy['height'] = height }
  const extra = rest(document, DOCUMENT_KEYS)
  if (extra) legacy['extra'] = extra
  if (Object.keys(legacy).length) extensions[LEGACY_EXTENSION] = legacy
  if (Object.keys(extensions).length) file['extensions'] = extensions

  return file as FuseFile
}
