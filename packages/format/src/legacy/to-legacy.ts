// Conversão .fuse v1 -> formato atual (schemaVersion 0), para o app legado durante a transição.
// Para arquivos vindos de fromLegacy() o resultado é idêntico ao original. Recursos v1 sem equivalente legado
// (vídeo/áudio/tabela/gráfico/embed como nós, gradientes, frames...) são aproximados ou descartados com aviso.
import type { Clip, DocBlock, Sheet } from '../schema/content.js'
import type { AssetRef, FuseFile, Page } from '../schema/file.js'
import type { FuseNode } from '../schema/nodes.js'
import type { Paint } from '../schema/primitives.js'
import { parseCellRef, parseRangeRef } from '../sheet-refs.js'
import { LEGACY_EXTENSION, LEGACY_UNKNOWN_PLUGIN, LIBRARY_EXTENSION } from './from-legacy.js'
import type { LegacyDocument, LegacyElement, LegacyGroup, LegacyMediaAsset, LegacyPage } from './types.js'

type Json = Record<string, unknown>

export type ToLegacyWarning = { path: string; message: string }
export type ToLegacyResult = { document: LegacyDocument; assets: LegacyMediaAsset[]; warnings: ToLegacyWarning[] }

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key) && (record as Json)[key] !== undefined

function copy(target: Json, source: object, key: string, as: string = key): void {
  if (has(source, key)) target[as] = (source as Json)[key]
}

function legacyExt(holder: { extensions?: Record<string, unknown> | undefined }): Json {
  const value = holder.extensions?.[LEGACY_EXTENSION]
  return value && typeof value === 'object' ? (value as Json) : {}
}

function extra(holder: { extensions?: Record<string, unknown> | undefined }): Json {
  const value = legacyExt(holder)['extra']
  return value && typeof value === 'object' ? (value as Json) : {}
}

class Context {
  readonly warnings: ToLegacyWarning[] = []
  warn(path: string, message: string): void { this.warnings.push({ path, message }) }
}

function paintToColor(paint: Paint, ctx: Context, path: string): string {
  if (typeof paint === 'string') return paint
  ctx.warn(path, `Gradiente (${paint.type}) aproximado pela primeira cor.`)
  return paint.stops[0]?.color ?? '#000000'
}

type Offset = { x: number; y: number }

function baseOf(node: Exclude<FuseNode, { type: 'connector' }>, offset: Offset): Json {
  const out: Json = { ...extra(node), id: node.id, type: '', name: node.name ?? '' }
  out['x'] = node.x + offset.x
  out['y'] = node.y + offset.y
  out['width'] = node.width
  out['height'] = node.height
  out['rotation'] = node.rotation
  if (node.timing) {
    copy(out, node.timing, 'startMs')
    copy(out, node.timing, 'durationMs')
  }
  if (!has(node, 'name')) delete out['name']
  return out
}

type Flattened = { elements: LegacyElement[]; connectors: Json[]; groups: LegacyGroup[] }

function convertNodes(nodes: readonly FuseNode[], offset: Offset, ctx: Context, path: string, into: Flattened): string[] {
  const leafIds: string[] = []
  nodes.forEach((node, index) => {
    const at = `${path}.${index}`
    const element = convertNode(node, offset, ctx, at, into)
    if (element) { into.elements.push(element); leafIds.push(element.id) }
    if (node.type === 'group') leafIds.push(...groupLeafIds(node, into))
  })
  return leafIds

  function groupLeafIds(group: Extract<FuseNode, { type: 'group' }>, flattened: Flattened): string[] {
    return flattened.groups.find(candidate => candidate.id === group.id)?.elementIds ?? []
  }
}

function convertNode(node: FuseNode, offset: Offset, ctx: Context, path: string, into: Flattened): LegacyElement | null {
  const ext = legacyExt(node)
  if (node.opacity !== undefined && node.type !== 'image' && node.type !== 'path' && node.type !== 'group' && node.type !== 'frame') {
    ctx.warn(path, 'Opacidade do nó não suportada no formato legado.')
  }
  if (node.animation && node.type !== 'image') ctx.warn(path, 'Animação só é suportada em imagens no formato legado.')
  switch (node.type) {
    case 'text': {
      const out = baseOf(node, offset)
      out['type'] = 'text'
      out['text'] = node.text
      copy(out, node, 'link', 'href')
      out['fontSize'] = node.style.fontSize
      out['fontFamily'] = node.style.fontFamily
      out['color'] = node.style.color
      if (!ext['boldMissing']) out['bold'] = node.style.fontWeight >= 600
      copy(out, node.style, 'letterSpacing', 'kerning')
      copy(out, node.style, 'lineHeight', 'lineSpacing')
      if (node.marks?.length) ctx.warn(path, 'Marcas inline em texto de canvas não são suportadas no formato legado.')
      return out as LegacyElement
    }
    case 'shape': {
      const out = baseOf(node, offset)
      out['type'] = 'shape'
      out['shape'] = node.shape
      out['fill'] = paintToColor(node.fill, ctx, `${path}.fill`)
      out['cornerRadius'] = node.cornerRadius
      copy(out, node, 'strokeWidth')
      if (node.markers) {
        copy(out, node.markers, 'start', 'startArrow')
        copy(out, node.markers, 'end', 'endArrow')
      }
      copy(out, node, 'curveOffset')
      if (node.stroke) ctx.warn(path, 'Traço com cor própria não suportado; mantida apenas a espessura.')
      if (node.stroke && !has(node, 'strokeWidth')) out['strokeWidth'] = node.stroke.width
      return out as LegacyElement
    }
    case 'qr': {
      const shape = (ext['shape'] && typeof ext['shape'] === 'object' ? ext['shape'] : { shape: 'rect', fill: node.background, cornerRadius: 0 }) as Json
      const out: Json = { ...baseOf(node, offset), type: 'shape', ...shape }
      const qr: Json = { ...((ext['qrExtra'] as Json | undefined) ?? {}), pattern: node.pattern }
      copy(qr, node, 'data', 'url')
      copy(qr, node, 'label', 'name')
      copy(qr, node, 'expiresAt', 'expiration')
      Object.assign(qr, { foreground: node.foreground, background: node.background, logo: node.logo, corner: node.cornerRadius })
      out['qrConfig'] = qr
      return out as unknown as LegacyElement
    }
    case 'image': {
      const out = baseOf(node, offset)
      out['type'] = 'image'
      out['src'] = node.src ?? ''
      if (!has(node, 'src')) ctx.warn(path, 'Imagem sem src inline; resolva o ativo antes de abrir no app legado.')
      copy(out, node, 'alt', 'altText')
      copy(out, node, 'decorative')
      copy(out, node, 'assetId')
      copy(out, node, 'intrinsicWidth', 'sourceWidth')
      copy(out, node, 'intrinsicHeight', 'sourceHeight')
      copy(out, node, 'crop')
      copy(out, node, 'opacity')
      copy(out, node, 'flipX')
      copy(out, node, 'flipY')
      if (node.adjustments) for (const key of ['brightness', 'contrast', 'saturation']) copy(out, node.adjustments, key)
      copy(out, node, 'filter', 'filterPreset')
      copy(out, node, 'stylize', 'imageStylePreset')
      copy(out, node, 'mask', 'maskStrokes')
      if (node.animation) {
        if (node.animation.effect !== 'elevation' || node.animation.phase === 'emphasis' || !node.animation.direction) {
          ctx.warn(`${path}.animation`, 'Animação não suportada no formato legado; descartada.')
        } else out['animation'] = node.animation
      } else copy(out, node, 'animation')
      return out as LegacyElement
    }
    case 'sticky': {
      const out = baseOf(node, offset)
      Object.assign(out, { type: 'sticky-note', text: node.text, fill: node.fill, color: node.color, fontSize: node.fontSize })
      return out as LegacyElement
    }
    case 'path': {
      const out = baseOf(node, offset)
      out['type'] = 'free-draw'
      out['points'] = node.points
      out['color'] = node.stroke?.color ?? (node.fill !== undefined ? paintToColor(node.fill, ctx, `${path}.fill`) : '#000000')
      out['strokeWidth'] = node.stroke?.width ?? 1
      copy(out, node, 'opacity')
      if (node.d) ctx.warn(path, 'Path SVG (d) não suportado; usados apenas os pontos.')
      return out as LegacyElement
    }
    case 'connector': {
      const out: Json = { ...extra(node), id: node.id, fromId: node.from.nodeId, toId: node.to.nodeId }
      copy(out, node.from, 'anchor', 'fromAnchor')
      copy(out, node.to, 'anchor', 'toAnchor')
      out['color'] = node.stroke.color
      out['strokeWidth'] = node.stroke.width
      into.connectors.push(out)
      return null
    }
    case 'group': {
      const leafIds = convertNodes(node.children, offset, ctx, `${path}.children`, into)
      const group: Json = { ...extra(node), id: node.id }
      if (!ext['nameMissing']) group['name'] = node.name ?? ''
      group['elementIds'] = leafIds
      into.groups.push(group as LegacyGroup)
      return null
    }
    case 'frame': {
      ctx.warn(path, 'Frame achatado: filhos convertidos para coordenadas da página.')
      if (node.rotation) ctx.warn(path, 'Rotação de frame ignorada no achatamento.')
      if (node.fill !== undefined) {
        into.elements.push({
          id: node.id, type: 'shape', name: node.name ?? 'Frame', x: node.x + offset.x, y: node.y + offset.y, width: node.width, height: node.height,
          rotation: node.rotation, shape: 'rect', fill: paintToColor(node.fill, ctx, `${path}.fill`), cornerRadius: node.cornerRadius ?? 0,
        })
      }
      convertNodes(node.children, { x: offset.x + node.x, y: offset.y + node.y }, ctx, `${path}.children`, into)
      return null
    }
    case 'plugin': {
      if (node.pluginId === LEGACY_UNKNOWN_PLUGIN && node.data && typeof node.data === 'object') return node.data as LegacyElement
      ctx.warn(path, `Nó de plugin "${node.pluginId}" não suportado; descartado.`)
      return null
    }
    default:
      ctx.warn(path, `Nó do tipo "${node.type}" não suportado no formato legado; descartado.`)
      return null
  }
}

function clipToLegacy(clip: Clip): Json {
  const out: Json = { ...extra(clip), id: clip.id, assetId: clip.assetId, name: clip.name, kind: clip.kind }
  copy(out, clip, 'track', 'trackIndex')
  copy(out, clip, 'opacity')
  copy(out, clip, 'fit', 'fitMode')
  copy(out, clip, 'scale')
  copy(out, clip, 'offsetX')
  copy(out, clip, 'offsetY')
  copy(out, clip, 'opacityKeyframes')
  copy(out, clip, 'transformKeyframes')
  copy(out, clip, 'easing', 'animationEasing')
  for (const key of ['startMs', 'durationMs', 'sourceDurationMs', 'sourceStartMs', 'volume']) out[key] = (clip as unknown as Json)[key]
  copy(out, clip, 'fadeInMs')
  copy(out, clip, 'fadeOutMs')
  return out
}

function blockToLegacy(block: DocBlock): Json {
  const out: Json = { ...extra(block), id: block.id, type: block.type, text: block.text }
  copy(out, block, 'marks')
  copy(out, block, 'image')
  if (block.table) {
    copy(out, block.table, 'rows', 'cells')
    copy(out, block.table, 'cellImages')
    copy(out, block.table, 'merges')
    copy(out, block.table, 'cellPadding')
    copy(out, block.table, 'spacing', 'tableSpacing')
    copy(out, block.table, 'borderColor')
    copy(out, block.table, 'borderWidth')
    copy(out, block.table, 'cellBorders')
  }
  return out
}

function sheetToLegacy(sheet: Sheet, target: Json, ctx: Context, path: string): void {
  const ext = legacyExt(sheet)
  const rowLengths = Array.isArray(ext['rowLengths']) ? (ext['rowLengths'] as number[]) : null
  if (!ext['noCells']) {
    const grid: string[][] = Array.from({ length: sheet.rowCount }, (_, row) => Array.from({ length: rowLengths?.[row] ?? sheet.columnCount }, () => ''))
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (cell.input === undefined) continue
      const { row, column } = parseCellRef(ref)
      const line = grid[row]
      if (!line || column >= line.length) { ctx.warn(`${path}.cells.${ref}`, 'Célula fora da grade descartada.'); continue }
      line[column] = cell.input
    }
    target['cells'] = grid
  }
  copy(target, sheet, 'merges', 'cellMerges')
  const formats: Json = { ...((ext['cellFormatsExtra'] as Json | undefined) ?? {}) }
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (cell.format === undefined) continue
    const { row, column } = parseCellRef(ref)
    formats[`${row}:${column}`] = cell.format
  }
  if (ext['hasCellFormats'] || Object.keys(formats).length) target['cellFormats'] = formats
  if (sheet.charts) target['charts'] = sheet.charts.map(chart => ({ id: chart.id, type: chart.type, title: chart.title, range: parseRangeRef(chart.range) }))
  if (sheet.frozen) ctx.warn(`${path}.frozen`, 'Congelamento de linhas/colunas não suportado no formato legado.')
}

function pageToLegacy(page: Page, file: FuseFile, ctx: Context, path: string): LegacyPage {
  const ext = legacyExt(page)
  const out: Json = { ...extra(page), id: page.id, name: page.name, background: paintToColor(page.background, ctx, `${path}.background`) }
  copy(out, page, 'hidden')
  const into: Flattened = { elements: [], connectors: [], groups: [] }
  convertNodes(page.children, { x: 0, y: 0 }, ctx, `${path}.children`, into)
  if (!ext['elementsMissing']) out['elements'] = into.elements
  const emptyKeys = Array.isArray(ext['emptyKeys']) ? (ext['emptyKeys'] as string[]) : []

  const clips = (file.timeline?.clips ?? []).filter(clip => clip.pageId === page.id)
  if (clips.length || emptyKeys.includes('timelineClips')) out['timelineClips'] = clips.map(clipToLegacy)
  if (into.connectors.length || emptyKeys.includes('connectors')) out['connectors'] = into.connectors

  const looseGroups = Array.isArray(ext['looseGroups']) ? (ext['looseGroups'] as LegacyGroup[]) : []
  let groups = [...into.groups, ...looseGroups]
  const order = Array.isArray(ext['groupOrder']) ? (ext['groupOrder'] as string[]) : null
  if (order) {
    const remaining = [...groups]
    const sorted: LegacyGroup[] = []
    for (const id of order) {
      const index = remaining.findIndex(group => group.id === id)
      if (index >= 0) sorted.push(...remaining.splice(index, 1))
    }
    groups = [...sorted, ...remaining]
  }
  if (groups.length || emptyKeys.includes('groups')) out['groups'] = groups
  copy(out, page, 'notes', 'presenterNotes')

  const section = file.doc?.sections.find(candidate => candidate.pageId === page.id)
  if (section) out['blocks'] = section.blocks.map(blockToLegacy)
  const sheetIndex = file.sheets?.findIndex(candidate => candidate.pageId === page.id) ?? -1
  const sheet = sheetIndex >= 0 ? file.sheets?.[sheetIndex] : undefined
  if (sheet) sheetToLegacy(sheet, out, ctx, `sheets.${sheetIndex}`)
  return out as LegacyPage
}

/** AssetRef -> registro de mídia legado. */
export function toLegacyAsset(id: string, asset: AssetRef): LegacyMediaAsset {
  const ext = legacyExt(asset)
  const out: Json = { ...extra(asset), id, name: asset.name ?? '', mimeType: asset.mime, width: asset.width ?? 0, height: asset.height ?? 0, src: asset.src ?? '' }
  if (asset.sha256) out['fingerprint'] = asset.sha256
  else if (has(ext, 'fingerprint')) out['fingerprint'] = ext['fingerprint']
  if (has(ext, 'libraryVisibleRaw')) out['libraryVisible'] = ext['libraryVisibleRaw']
  else if (asset.libraryVisible !== undefined) out['libraryVisible'] = asset.libraryVisible ? 1 : 0
  out['createdAt'] = asset.createdAt ?? ''
  copy(out, asset, 'scope')
  return out as LegacyMediaAsset
}

/** Converte FuseFile v1 para o formato legado, com avisos de perdas. */
export function toLegacyWithReport(file: FuseFile): ToLegacyResult {
  const ctx = new Context()
  const ext = legacyExt(file)
  const library = (file.extensions?.[LIBRARY_EXTENSION] ?? {}) as Json
  const first = file.pages[0]
  const out: Json = { ...extra(file), id: file.id, name: file.meta.title }
  if (!ext['typeMissing']) out['type'] = file.kind
  copy(out, library, 'archivedAt')
  copy(out, library, 'trashedAt')
  copy(out, library, 'folderId')
  out['width'] = first?.width ?? (typeof ext['width'] === 'number' ? ext['width'] : 0)
  out['height'] = first?.height ?? (typeof ext['height'] === 'number' ? ext['height'] : 0)
  file.pages.forEach((page, index) => {
    if (first && (page.width !== first.width || page.height !== first.height)) ctx.warn(`pages.${index}`, 'Páginas com tamanhos diferentes: o formato legado usa o tamanho da primeira página.')
  })
  if (file.doc?.pageSetup) {
    const setup = file.doc.pageSetup
    if (setup.preset !== 'a4') ctx.warn('doc.pageSetup', `Formato de página "${setup.preset}" não suportado; usado A4.`)
    out['docPageSetup'] = { preset: 'a4', margins: setup.margins }
  }
  copy(out, file.timeline ?? {}, 'durationMs', 'videoDurationMs')
  out['pages'] = file.pages.map((page, index) => pageToLegacy(page, file, ctx, `pages.${index}`))
  out['updatedAt'] = file.meta.updatedAt
  copy(out, file.meta, 'brandKitId')
  const assets = Object.entries(file.assets).map(([id, asset]) => toLegacyAsset(id, asset))
  return { document: out as LegacyDocument, assets, warnings: ctx.warnings }
}

/** Converte FuseFile v1 para o documento legado (descarta avisos; use toLegacyWithReport para vê-los). */
export function toLegacy(file: FuseFile): LegacyDocument {
  return toLegacyWithReport(file).document
}
