import type { DesignDocument, DesignElement, DesignPage, DocBlock, DocImage, FreeDrawElement, ImageElement, ShapeElement, StickyNoteElement, TextElement } from './model'
import { connectorPoints } from './whiteboard'
import { getDocTextRuns } from './doc-format'
import { columnLabel, evaluateSheet, formatSheetCellValue } from './sheet'
import { applyImageFilter } from './image-filters'
import { applyImageColorAdjustments } from './image-adjustments'
import { applyImageStyle } from './image-styles'
import { isSafeDocImage } from './doc-format'
import { createImageMaskFilter } from './image-masks'
import { isStrokeVectorShape, vectorLineArrowheadPoints, vectorShapePoints } from './vector-shapes'
import { drawQrCanvas } from './qr-code'

const EXPORT_SCALE = 2
const DOC_TABLE_FONT_SIZE = 16
const DOC_TABLE_LINE_HEIGHT = 22
const DOC_TABLE_PARAGRAPH_GAP = 16
const DEFAULT_DOC_MARGINS = { top: 96, right: 96, bottom: 96, left: 96 }
function docMargins(document: DesignDocument) { return document.width < 400 ? { top: 74, right: 72, bottom: 130, left: 72 } : document.docPageSetup?.margins ?? DEFAULT_DOC_MARGINS }
type ExportDocBlock = DocBlock & { exportCellLines?: Array<Array<string[] | undefined> | undefined>; cellImages?: Record<string, DocImage[]> }

export function safeFileName(name: string): string {
  return name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-') || 'design'
}

function pngChunkCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function validatePngDataUri(data: string): { width: number; height: number } | null {
  const match = typeof data === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data) : null
  if (!match) return null
  let binary: string
  try { binary = atob(match[1]) } catch { return null }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 8 || signature.some((byte, offset) => bytes[offset] !== byte)) return null

  let offset = 8
  let width = 0
  let height = 0
  let sawHeader = false
  let sawData = false
  let sawEnd = false
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const crcStart = dataStart + length
    const next = crcStart + 4
    if (next > bytes.length) return null
    const type = String.fromCharCode(bytes[typeStart], bytes[typeStart + 1], bytes[typeStart + 2], bytes[typeStart + 3])
    if (pngChunkCrc(bytes, typeStart, crcStart) !== new DataView(bytes.buffer, bytes.byteOffset + crcStart, 4).getUint32(0)) return null
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return null
      const header = new DataView(bytes.buffer, bytes.byteOffset + dataStart, 13)
      width = header.getUint32(0)
      height = header.getUint32(4)
      if (width === 0 || height === 0) return null
      sawHeader = true
    } else if (type === 'IHDR') return null
    if (type === 'IDAT') sawData = true
    if (type === 'IEND') {
      if (length !== 0 || !sawData) return null
      sawEnd = true
      offset = next
      break
    }
    offset = next
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== bytes.length) return null
  return { width, height }
}

function validatePdfPage(width: number, height: number, data: string, index: number) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`A página ${index + 1} precisa ter largura e altura maiores que zero.`)
  }
  if (!validatePngDataUri(data)) throw new Error(`Não foi possível exportar a página ${index + 1}: imagem PNG inválida; assinatura PNG inválida ou arquivo incompleto.`)
}

export function createPdfPageDescriptions(document: DesignDocument): string[] {
  return document.pages.map((page, index) => {
    const semanticDescriptions: string[] = []
    const visibleParts: string[] = []
    for (const element of page.elements) {
      if (element.type === 'text' || element.type === 'sticky-note') {
        if (element.text.trim()) visibleParts.push(element.text.trim())
      } else if (element.type === 'image' && !element.decorative && element.altText?.trim()) semanticDescriptions.push(`Imagem: ${element.altText.trim()}`)
      else if (element.type === 'shape' && element.qrConfig?.name?.trim()) semanticDescriptions.push(`Código QR: ${element.qrConfig.name.trim()}`)
    }
    for (const block of page.blocks ?? []) {
      if (block.text.trim()) visibleParts.push(block.text.trim())
      if (block.type === 'image' && isSafeDocImage(block.image)) semanticDescriptions.push(`Imagem: ${cleanPdfSemanticText(block.image.alt) || 'sem descrição alternativa'}`)
      if (block.type === 'table') for (const images of Object.values((block as ExportDocBlock).cellImages ?? {})) {
        if (Array.isArray(images)) for (const image of images) if (isSafeDocImage(image)) semanticDescriptions.push(`Imagem em tabela: ${cleanPdfSemanticText(image.alt) || 'sem descri\u00e7\u00e3o alternativa'}`)
      }
      for (const row of block.cells ?? []) for (const cell of row) if (cell.trim()) visibleParts.push(cell.trim())
    }
    for (const row of page.cells ?? []) for (const cell of row) if (cell.trim()) visibleParts.push(cell.trim())
    // Keep explicit alternatives before generic page text because the description is capped below.
    const visibleText = [...semanticDescriptions, ...visibleParts].join('. ').replace(/\s+/g, ' ').trim()
    const summary = visibleText
      ? `Página ${index + 1}: ${page.name}. Conteúdo textual do modelo: ${visibleText}. A arte é exportada como imagem rasterizada; esta descrição não confirma a ordem de leitura visual.`
      : `Página ${index + 1}: ${page.name}. Conteúdo visual exportado como imagem rasterizada, sem texto alternativo específico para esta página.`
    return [...summary].slice(0, 3000).join('')
  })
}

export type PdfSemanticRole = 'H1' | 'H2' | 'P' | 'BlockQuote' | 'L' | 'LI' | 'LBody' | 'Table' | 'TR' | 'TH' | 'TD' | 'Figure'
export type PdfSemanticNode = { role: PdfSemanticRole; text?: string; alt?: string; children?: PdfSemanticNode[] }

function hasPdfSemanticContent(node: PdfSemanticNode): boolean {
  return Boolean(node.text?.trim() || node.alt?.trim() || node.children?.some(hasPdfSemanticContent))
}

function fallbackPdfPageFigure(pageDescriptions: string[] | undefined, index: number): PdfSemanticNode {
  const alt = pageDescriptions?.[index]?.trim() || `Page ${index + 1}, exported as raster artwork; the visual composition is not fully described by text.`
  return { role: 'Figure', alt }
}

function cleanPdfSemanticText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000)
}

function semanticTable(rows: string[][]): PdfSemanticNode {
  return { role: 'Table', children: rows.map(row => ({ role: 'TR', children: row.map(text => ({ role: 'TD', text: cleanPdfSemanticText(text) })) })) }
}

function semanticDocTable(block: ExportDocBlock): PdfSemanticNode {
  return {
    role: 'Table',
    children: (block.cells ?? []).map((row, rowIndex) => ({
      role: 'TR',
      children: row.flatMap((text, columnIndex) => {
        const covered = (block.merges ?? []).some(merge => merge.row === rowIndex && columnIndex > merge.column && columnIndex < merge.column + merge.colSpan)
        if (covered) return []
        const images = safeDocCellImages(block, rowIndex, columnIndex).map(image => ({ role: 'Figure' as const, alt: cleanPdfSemanticText(image.alt) || 'Imagem sem descri\u00e7\u00e3o alternativa.' }))
        return [{ role: 'TD' as const, text: cleanPdfSemanticText(text), ...(images.length ? { children: images } : {}) }]
      }),
    })),
  }
}

export function createPdfPageSemantics(page: DesignPage, type: DesignDocument['type'] = 'design'): PdfSemanticNode[] {
  if (type === 'doc') return createPdfDocSemantics(page.blocks ?? [])
  if (type === 'sheet') {
    const { values } = evaluateSheet(page.cells ?? [['']], page.cellMerges ?? [])
    const rows = values.map((row, rowIndex) => row.map((value, columnIndex) => formatSheetCellValue(value, page.cellFormats?.[`${rowIndex}:${columnIndex}`])))
    return rows.some(row => row.some(cell => cell.trim())) ? [semanticTable(rows)] : []
  }
  const items: Array<{ y: number; x: number; order: number; node: PdfSemanticNode }> = []
  page.elements.forEach((element, order) => {
    if ((element.type === 'text' || element.type === 'sticky-note') && element.text.trim()) items.push({ y: element.y, x: element.x, order, node: { role: 'P', text: cleanPdfSemanticText(element.text) } })
    else if (element.type === 'image' && !element.decorative) items.push({ y: element.y, x: element.x, order, node: { role: 'Figure', alt: cleanPdfSemanticText(element.altText?.trim() || 'Imagem sem descrição textual fornecida.') } })
    else if (element.type === 'shape' && element.qrConfig?.name?.trim()) items.push({ y: element.y, x: element.x, order, node: { role: 'Figure', alt: `Código QR: ${cleanPdfSemanticText(element.qrConfig.name)}` } })
  })
  const nodes = items.sort((a, b) => a.y - b.y || a.x - b.x || a.order - b.order).map(item => item.node)
  if ((page.cells ?? []).length) {
    const rows = page.cells!.map(row => row.map(cell => cleanPdfSemanticText(cell)))
    if (rows.some(row => row.some(cell => cell))) nodes.push(semanticTable(rows))
  }
  return nodes
}

export function createPdfDocSemantics(blocks: DocBlock[]): PdfSemanticNode[] {
  return blocks.flatMap(block => {
    if (block.type === 'table') {
      const table = semanticDocTable(block as ExportDocBlock)
      return hasPdfSemanticContent(table) ? [table] : []
    }
    if (block.type === 'image') {
      if (!isSafeDocImage(block.image)) return []
      return [{ role: 'Figure' as const, alt: cleanPdfSemanticText(block.image.alt) || 'Imagem sem descrição alternativa.' }]
    }
    const text = cleanPdfSemanticText(block.text)
    if (!text) return []
    if (block.type === 'heading') return [{ role: 'H1' as const, text }]
    if (block.type === 'subheading') return [{ role: 'H2' as const, text }]
    if (block.type === 'quote') return [{ role: 'BlockQuote' as const, text }]
    if (block.type === 'bullet') return [{ role: 'L' as const, children: [{ role: 'LI' as const, children: [{ role: 'LBody' as const, text }] }] }]
    return [{ role: 'P' as const, text }]
  })
}

function semanticLeaves(nodes: PdfSemanticNode[]): PdfSemanticNode[] {
  const hasContent = (node: PdfSemanticNode): boolean => Boolean(node.text?.trim() || node.alt?.trim() || node.children?.some(hasContent))
  return nodes.filter(hasContent).flatMap(node => node.children?.length ? semanticLeaves(node.children) : [node])
}

function pdfUnicodeHex(value: string): string {
  const units = Array.from(value).flatMap(character => {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0xffff) return [codePoint]
    const adjusted = codePoint - 0x10000
    return [0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff)]
  })
  return `FEFF${units.map(unit => unit.toString(16).padStart(4, '0')).join('').toUpperCase()}`
}

export async function createPdfBytes(width: number, height: number, pageImages: Array<string | { data: string; width: number; height: number }>, compact = true, pageDescriptions?: string[], pageSemantics?: PdfSemanticNode[][]): Promise<ArrayBuffer> {
  if (pageImages.length === 0) throw new Error('O documento precisa ter ao menos uma página.')
  pageImages.forEach((page, index) => {
    const current = typeof page === 'string' ? { data: page, width, height } : page
    validatePdfPage(current.width, current.height, current.data, index)
  })
  const { jsPDF } = await import('jspdf')
  const dimensions = (page: string | { data: string; width: number; height: number }) => typeof page === 'string' ? { data: page, width, height } : page
  const first = dimensions(pageImages[0])
  const firstWidth = first.width * 0.75
  const firstHeight = first.height * 0.75
  const firstOrientation = first.width > first.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ orientation: firstOrientation, unit: 'pt', format: [firstWidth, firstHeight], compress: compact })
  pdf.setLanguage('pt-BR')
  const pdfInternal = pdf.internal as typeof pdf.internal & {
    newAdditionalObject: () => { objId: number; content: string }
    events: { subscribe: (name: string, callback: (data?: { objId?: number; pageNumber?: number }) => void) => unknown }
    write: (value: string) => unknown
  }
  let structRoot: ReturnType<typeof pdfInternal.newAdditionalObject> | undefined
  let parentTree: ReturnType<typeof pdfInternal.newAdditionalObject> | undefined
  let documentStruct: ReturnType<typeof pdfInternal.newAdditionalObject> | undefined
  type TaggedTree = { node: PdfSemanticNode; object: ReturnType<typeof pdfInternal.newAdditionalObject>; children: TaggedTree[]; mcid?: number }
  let pageStructs: Array<{ section: ReturnType<typeof pdfInternal.newAdditionalObject>; trees: TaggedTree[]; leaves: TaggedTree[] }> = []
  const pageRefs: number[] = []
  pdfInternal.events.subscribe('putPage', event => {
    const pageNumber = event?.pageNumber ?? pageRefs.length + 1
    pageRefs[pageNumber - 1] = event?.objId ?? 0
    pdfInternal.write(`/StructParents ${pageNumber - 1}`)
  })
  pdfInternal.events.subscribe('postPutPages', () => {
    structRoot = pdfInternal.newAdditionalObject()
    parentTree = pdfInternal.newAdditionalObject()
    documentStruct = pdfInternal.newAdditionalObject()
    pageStructs = pageImages.map((_, index) => {
      const section = pdfInternal.newAdditionalObject()
      const leaves: TaggedTree[] = []
      let nextMcid = 0
      const build = (node: PdfSemanticNode): TaggedTree => {
        const object = pdfInternal.newAdditionalObject()
        const children = (node.children ?? []).filter(hasPdfSemanticContent).map(build)
        const tree: TaggedTree = { node, object, children }
        if (!children.length) { tree.mcid = nextMcid++; leaves.push(tree) }
        return tree
      }
      // Empty semantic nodes do not describe the raster page. Treat them the same as
      // missing semantics so the page image still has a reachable Figure in the tree.
      const suppliedSemantics = (pageSemantics?.[index] ?? []).filter(hasPdfSemanticContent)
      const roots = suppliedSemantics.length ? suppliedSemantics : [fallbackPdfPageFigure(pageDescriptions, index)]
      const trees = roots.map(build)
      return { section, trees, leaves }
    })
    const refs = (objectId: number) => `${objectId} 0 R`
    const structChildren: string[] = []
    const parentEntries: string[] = []
    pageStructs.forEach((objects, index) => {
      const pageRef = refs(pageRefs[index])
      const writeTree = (tree: TaggedTree, parentId: number) => {
        const { node, object, children, mcid } = tree
        const kid = children.length ? `[${children.map(child => refs(child.object.objId)).join(' ')}]` : `<< /Type /MCR /Pg ${pageRef} /MCID ${mcid} >>`
        const alt = node.role === 'Figure' && node.alt?.trim() ? ` /Alt <${pdfUnicodeHex(cleanPdfSemanticText(node.alt))}>` : ''
        const actual = !children.length ? ` /ActualText <${pdfUnicodeHex(cleanPdfSemanticText(node.text ?? node.alt ?? ''))}>` : ''
        object.content = `<< /Type /StructElem /S /${node.role} /P ${refs(parentId)} /Pg ${pageRef} /K ${kid}${alt}${actual} >>`
        children.forEach(child => writeTree(child, object.objId))
      }
      objects.trees.forEach(tree => writeTree(tree, objects.section.objId))
      objects.section.content = `<< /Type /StructElem /S /Sect /P ${refs(documentStruct!.objId)} /Pg ${pageRef} /K [${objects.trees.map(tree => refs(tree.object.objId)).join(' ')}] >>`
      structChildren.push(refs(objects.section.objId))
      parentEntries.push(`${index} [${objects.leaves.map(leaf => refs(leaf.object.objId)).join(' ')}]`)
    })
    documentStruct.content = `<< /Type /StructElem /S /Document /P ${refs(structRoot.objId)} /K [${structChildren.join(' ')}] >>`
    parentTree.content = `<< /Nums [${parentEntries.join(' ')}] >>`
    structRoot.content = `<< /Type /StructTreeRoot /K ${refs(documentStruct.objId)} /ParentTree ${refs(parentTree.objId)} /ParentTreeNextKey ${pageStructs.length} >>`
  })
  pdfInternal.events.subscribe('putCatalog', () => {
    pdfInternal.write(`/MarkInfo << /Marked true >>`)
    if (structRoot) pdfInternal.write(`/StructTreeRoot ${structRoot.objId} 0 R`)
  })
  pageImages.forEach((page, index) => {
    const current = dimensions(page)
    const pageWidth = current.width * 0.75
    const pageHeight = current.height * 0.75
    const orientation = current.width > current.height ? 'landscape' : 'portrait'
    if (index > 0) pdf.addPage([pageWidth, pageHeight], orientation)
    const semantics = (pageSemantics?.[index] ?? []).filter(hasPdfSemanticContent)
    if (semantics.length) pdfInternal.write('/Artifact BMC')
    else pdfInternal.write('/Figure <</MCID 0>> BDC')
    pdf.addImage(current.data, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
    pdfInternal.write('EMC')
    if (semantics.length) {
      pdf.setFontSize(1)
      for (const [mcid, node] of semanticLeaves(semantics).entries()) {
        const text = cleanPdfSemanticText(node.text ?? node.alt ?? '')
        if (!text) continue
        pdfInternal.write(`/${node.role} << /MCID ${mcid} /ActualText <${pdfUnicodeHex(text)}> >> BDC`)
        pdf.text(text, -1000, -1000, { renderingMode: 'invisible' })
        pdfInternal.write('EMC')
      }
    }
  })
  return pdf.output('arraybuffer')
}

function roundRect(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.roundRect(0, 0, width, height, r)
}

function drawShape(context: CanvasRenderingContext2D, element: ShapeElement) {
  if (element.qrConfig?.url) { drawQrCanvas(context, element); return }
  if (element.shape === 'ellipse') {
    context.beginPath()
    context.ellipse(0, 0, element.width / 2, element.height / 2, 0, 0, Math.PI * 2)
    context.fillStyle = element.fill
    context.fill()
  } else if (element.shape === 'rect') {
    roundRect(context, element.width, element.height, element.cornerRadius)
    context.fillStyle = element.fill
    context.fill()
  } else {
    if (element.shape === 'line') {
      const middleY = element.height / 2
      context.beginPath()
      if (element.curveOffset) {
        const controlY = middleY + element.curveOffset * 2 / 3
        context.moveTo(0, middleY)
        context.bezierCurveTo(element.width / 3, controlY, element.width * 2 / 3, controlY, element.width, middleY)
      } else {
        context.moveTo(0, middleY)
        context.lineTo(element.width, middleY)
      }
      context.strokeStyle = element.fill
      context.lineWidth = element.strokeWidth ?? 8
      context.lineCap = element.curveOffset ? 'butt' : 'round'
      context.lineJoin = 'round'
      context.stroke()
      for (const points of [element.startArrow ? vectorLineArrowheadPoints(element.width, element.height, element.curveOffset, true) : null, element.endArrow ? vectorLineArrowheadPoints(element.width, element.height, element.curveOffset) : null]) {
        if (!points) continue
        context.beginPath()
        context.moveTo(points[0], points[1])
        context.lineTo(points[2], points[3])
        context.lineTo(points[4], points[5])
        context.closePath()
        context.fillStyle = element.fill
        context.fill()
      }
      return
    }
    const points = vectorShapePoints(element.shape, element.width, element.height)
    context.beginPath()
    context.moveTo(points[0], points[1])
    for (let index = 2; index < points.length; index += 2) context.lineTo(points[index], points[index + 1])
    if (!isStrokeVectorShape(element.shape)) {
      context.closePath()
      context.fillStyle = element.fill
      context.fill()
    } else {
      context.strokeStyle = element.fill
      context.lineWidth = element.strokeWidth ?? 8
      context.lineCap = 'round'
      context.stroke()
    }
  }
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else line = candidate
    }
    lines.push(line)
  }
  return lines
}

function drawText(context: CanvasRenderingContext2D, element: TextElement) {
  context.fillStyle = element.color
  context.font = `${element.bold ? '700' : '400'} ${element.fontSize}px "${element.fontFamily.replace(/["\\]/g, '')}", sans-serif`
  context.textBaseline = 'top'
  const lineHeight = element.fontSize * (element.lineSpacing ?? 1.2)
  const text = element.kerning ? [...element.text].map(character => character).join('\u200a'.repeat(Math.max(0, Math.round(element.kerning * 4)))) : element.text
  wrapText(context, text, element.width).forEach((line, index) => {
    const y = index * lineHeight
    if (y + lineHeight <= element.height + 0.5) context.fillText(line, 0, y)
  })
}

function drawStickyNote(context: CanvasRenderingContext2D, element: StickyNoteElement) {
  context.fillStyle = element.fill
  context.fillRect(0, 0, element.width, element.height)
  context.fillStyle = element.color
  context.font = `400 ${element.fontSize}px Arial, sans-serif`
  context.textBaseline = 'top'
  const padding = Math.max(12, element.fontSize * 0.8)
  wrapText(context, element.text, element.width - padding * 2).forEach((line, index) => {
    const y = padding + index * element.fontSize * 1.35
    if (y + element.fontSize * 1.35 <= element.height - padding + 0.5) context.fillText(line, padding, y)
  })
}

export type FreeDrawCurveSegment =
  | { type: 'line'; x: number; y: number }
  | { type: 'quadratic'; controlX: number; controlY: number; x: number; y: number }
  | { type: 'cubic'; control1X: number; control1Y: number; control2X: number; control2Y: number; x: number; y: number }

/** Return the same open cardinal-spline segments that Konva Line uses for tension=.35. */
export function freeDrawCurveSegments(points: number[], tension = 0.35): FreeDrawCurveSegment[] {
  const pointCount = Math.floor(points.length / 2)
  if (pointCount < 2) return []
  const point = (index: number) => ({ x: points[index * 2], y: points[index * 2 + 1] })
  if (pointCount === 2) return [{ type: 'line', ...point(1) }]
  const controls = Array.from({ length: pointCount - 2 }, (_, index) => {
    const previous = point(index)
    const current = point(index + 1)
    const next = point(index + 2)
    const before = Math.hypot(current.x - previous.x, current.y - previous.y)
    const after = Math.hypot(next.x - current.x, next.y - current.y)
    const total = before + after
    if (total === 0) return [current, current] as const
    const beforeFactor = tension * before / total
    const afterFactor = tension * after / total
    return [
      { x: current.x - beforeFactor * (next.x - previous.x), y: current.y - beforeFactor * (next.y - previous.y) },
      { x: current.x + afterFactor * (next.x - previous.x), y: current.y + afterFactor * (next.y - previous.y) },
    ] as const
  })
  const segments: FreeDrawCurveSegment[] = [
    { type: 'quadratic', controlX: controls[0][0].x, controlY: controls[0][0].y, ...point(1) },
  ]
  for (let index = 1; index < pointCount - 2; index += 1) {
    const outgoing = controls[index - 1][1]
    const incoming = controls[index][0]
    const end = point(index + 1)
    segments.push({ type: 'cubic', control1X: outgoing.x, control1Y: outgoing.y, control2X: incoming.x, control2Y: incoming.y, ...end })
  }
  const lastControl = controls[controls.length - 1][1]
  segments.push({ type: 'quadratic', controlX: lastControl.x, controlY: lastControl.y, ...point(pointCount - 1) })
  return segments
}

function drawFreeDraw(context: CanvasRenderingContext2D, element: FreeDrawElement) {
  if (element.points.length < 4) return
  context.beginPath()
  context.globalAlpha *= element.opacity ?? 1
  context.strokeStyle = element.color
  context.lineWidth = element.strokeWidth
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.moveTo(element.points[0], element.points[1])
  for (const segment of freeDrawCurveSegments(element.points)) {
    if (segment.type === 'line') context.lineTo(segment.x, segment.y)
    else if (segment.type === 'quadratic') context.quadraticCurveTo(segment.controlX, segment.controlY, segment.x, segment.y)
    else context.bezierCurveTo(segment.control1X, segment.control1Y, segment.control2X, segment.control2Y, segment.x, segment.y)
  }
  context.stroke()
}

function drawConnector(context: CanvasRenderingContext2D, page: DesignPage, connector: NonNullable<DesignPage['connectors']>[number]) {
  const points = connectorPoints(page, connector)
  if (!points) return
  const [fromX, fromY, toX, toY] = points
  const angle = Math.atan2(toY - fromY, toX - fromX)
  const arrowLength = Math.max(10, connector.strokeWidth * 3)
  context.save()
  context.strokeStyle = connector.color
  context.fillStyle = connector.color
  context.lineWidth = connector.strokeWidth
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(fromX, fromY)
  context.lineTo(toX, toY)
  context.stroke()
  context.beginPath()
  context.moveTo(toX, toY)
  context.lineTo(toX - arrowLength * Math.cos(angle - Math.PI / 6), toY - arrowLength * Math.sin(angle - Math.PI / 6))
  context.lineTo(toX - arrowLength * Math.cos(angle + Math.PI / 6), toY - arrowLength * Math.sin(angle + Math.PI / 6))
  context.closePath()
  context.fill()
  context.restore()
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

async function drawImage(context: CanvasRenderingContext2D, element: ImageElement) {
  const image = await loadImage(element.src)
  let imageSource: CanvasImageSource = image
  if (element.filterPreset || element.imageStylePreset || element.maskStrokes?.length || element.contrast || element.saturation) {
    const filteredCanvas = document.createElement('canvas')
    const outputScale = Math.min(4, 4096 / Math.max(element.width, element.height))
    filteredCanvas.width = Math.max(1, Math.round(element.width * outputScale))
    filteredCanvas.height = Math.max(1, Math.round(element.height * outputScale))
    const filteredContext = filteredCanvas.getContext('2d', { willReadFrequently: true })
    if (!filteredContext) throw new Error('Não foi possível preparar o filtro da imagem.')
    if (element.crop) filteredContext.drawImage(image, element.crop.x, element.crop.y, element.crop.width, element.crop.height, 0, 0, filteredCanvas.width, filteredCanvas.height)
    else filteredContext.drawImage(image, 0, 0, filteredCanvas.width, filteredCanvas.height)
    const pixels = filteredContext.getImageData(0, 0, filteredCanvas.width, filteredCanvas.height)
    const maskFilter = element.maskStrokes?.length ? createImageMaskFilter(element.maskStrokes, element.width, element.height) : null
    maskFilter?.(pixels)
    if (element.filterPreset) applyImageFilter(pixels, element.filterPreset)
    applyImageColorAdjustments(pixels, element.contrast ?? 0, element.saturation ?? 0)
    if (element.imageStylePreset) applyImageStyle(pixels, element.imageStylePreset)
    filteredContext.putImageData(pixels, 0, 0)
    imageSource = filteredCanvas
  }
  const flipX = element.flipX ? -1 : 1
  const flipY = element.flipY ? -1 : 1
  context.save()
  context.globalAlpha *= Math.max(0, Math.min(100, element.opacity ?? 100)) / 100
  context.filter = (element.brightness ?? 0) === 0 ? 'none' : `brightness(${100 + (element.brightness ?? 0)}%)`
  context.translate(element.flipX ? element.width : 0, element.flipY ? element.height : 0)
  context.scale(flipX, flipY)
  if (imageSource === image && element.crop) context.drawImage(imageSource, element.crop.x, element.crop.y, element.crop.width, element.crop.height, 0, 0, element.width, element.height)
  else context.drawImage(imageSource, 0, 0, element.width, element.height)
  context.restore()
}

export async function renderImageElementPng(element: ImageElement): Promise<string> {
  const outputScale = Math.min(EXPORT_SCALE, 4096 / Math.max(1, element.width, element.height))
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(element.width * outputScale))
  canvas.height = Math.max(1, Math.round(element.height * outputScale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Nao foi possivel preparar a imagem para SVG.')
  context.scale(outputScale, outputScale)
  await drawImage(context, element)
  return canvas.toDataURL('image/png')
}

async function drawElement(context: CanvasRenderingContext2D, element: DesignElement) {
  context.save()
  context.translate(element.x + element.width / 2, element.y + element.height / 2)
  context.rotate(element.rotation * Math.PI / 180)
  context.translate(-element.width / 2, -element.height / 2)
  if (element.type === 'shape') drawShape(context, element)
  else if (element.type === 'text') drawText(context, element)
  else if (element.type === 'sticky-note') drawStickyNote(context, element)
  else if (element.type === 'free-draw') drawFreeDraw(context, element)
  else await drawImage(context, element)
  context.restore()
}

type MeasureDocLine = (text: string, fontSize: number, fontWeight: '400' | '700') => number

function docTextMetrics(block: DocBlock) {
  const fontSize = block.type === 'heading' ? 32 : block.type === 'subheading' ? 23 : 15
  const fontWeight: '400' | '700' = block.type === 'heading' || block.type === 'subheading' ? '700' : '400'
  const lineHeight = fontSize * (block.type === 'heading' ? 1.22 : block.type === 'subheading' ? 1.3 : 1.55)
  return { fontSize, fontWeight, lineHeight }
}

function docImageSize(block: DocBlock, maxWidth: number, maxHeight: number) {
  if (!isSafeDocImage(block.image)) return null
  const scale = Math.min(1, maxWidth / block.image.width, maxHeight / block.image.height)
  return { width: block.image.width * scale, height: block.image.height * scale }
}

function safeDocCellImages(block: ExportDocBlock, row: number, column: number): DocImage[] {
  const images = block.cellImages?.[`${row}:${column}`]
  return Array.isArray(images) ? images.filter(isSafeDocImage) : []
}

function docCellImageLayouts(block: ExportDocBlock, row: number, column: number, maxWidth: number, maxHeight: number): Array<{ image: DocImage; width: number; height: number }> {
  const images = safeDocCellImages(block, row, column)
  if (!images.length || maxWidth <= 0 || maxHeight <= 0) return []
  const gap = 6
  const perImageHeight = Math.max(1, (maxHeight - gap * Math.max(0, images.length - 1)) / images.length)
  return images.map(image => {
    const scale = Math.min(1, maxWidth / image.width, perImageHeight / image.height)
    return { image, width: Math.max(1, image.width * scale), height: Math.max(1, image.height * scale) }
  })
}

function docCellImageHeight(layouts: Array<{ image: DocImage; width: number; height: number }>): number {
  return layouts.reduce((height, item) => height + item.height, 0) + 6 * Math.max(0, layouts.length - 1)
}

function wrapDocText(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) { lines.push(''); continue }
    let line = ''
    for (const word of words) {
      if (measure(word) > maxWidth) {
        if (line) { lines.push(line); line = '' }
        let part = ''
        for (const character of Array.from(word)) {
          if (part && measure(part + character) > maxWidth) { lines.push(part); part = character }
          else part += character
        }
        line = part
        continue
      }
      const candidate = line ? `${line} ${word}` : word
      if (line && measure(candidate) > maxWidth) { lines.push(line); line = word }
      else line = candidate
    }
    lines.push(line)
  }
  return lines
}

function wrapDocCellText(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const paragraphs = text.split('\n')
  return paragraphs.flatMap((paragraph, index) => [
    ...wrapDocText(paragraph, maxWidth, measure),
    ...(index < paragraphs.length - 1 ? [''] : []),
  ])
}

function docCellLineHeight(line: string): number {
  return line === '' ? DOC_TABLE_PARAGRAPH_GAP : DOC_TABLE_LINE_HEIGHT
}

function docCellLinesHeight(lines: string[]): number {
  return lines.reduce((height, line) => height + docCellLineHeight(line), 0)
}

function docCellFragmentEnd(cells: string[][], start: number, availableHeight: number): number {
  let usedHeight = 0
  let end = start
  const lineCount = Math.max(1, ...cells.map(lines => lines.length))
  while (end < lineCount) {
    const lineHeight = Math.max(0, ...cells.map(lines => lines[end] === undefined ? 0 : docCellLineHeight(lines[end])))
    if (end > start && usedHeight + lineHeight > availableHeight) break
    if (end === start && lineHeight > availableHeight) break
    usedHeight += lineHeight
    end += 1
  }
  return end
}

function docTableTrailingGap(blocks: DocBlock[], index: number): number {
  const next = blocks[index + 1]
  if (!next) return 0
  if (next.type === 'table' && next.id === blocks[index].id) return 0
  return 12
}

function drawDocText(context: CanvasRenderingContext2D, block: DocBlock, x: number, y: number, maxWidth: number, fontSize: number, baseBold: boolean, baseItalic: boolean): number {
  const lineHeight = docTextMetrics(block).lineHeight
  let cursorX = x
  let cursorY = y
  const baseFontWeight = baseBold ? 700 : 400
  for (const run of getDocTextRuns(block.text, block.marks)) {
    context.font = `${run.italic || baseItalic ? 'italic ' : ''}${run.bold ? 700 : baseFontWeight} ${fontSize}px Arial, sans-serif`
    const paragraphs = run.text.split('\n')
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const tokens = paragraph.match(/\S+\s*/gu) ?? []
      for (const token of tokens) {
        const width = context.measureText(token).width
        if (cursorX > x && cursorX + width > maxWidth) { cursorY += lineHeight; cursorX = x }
        context.fillText(token, cursorX, cursorY)
        if (run.underline || run.strike) {
          const decorationHeight = Math.max(1, fontSize / 16)
          if (run.underline) context.fillRect(cursorX, cursorY + Math.max(1, fontSize / 12), width, decorationHeight)
          if (run.strike) context.fillRect(cursorX, cursorY - fontSize * 0.32, width, decorationHeight)
        }
        cursorX += width
      }
      if (paragraphIndex < paragraphs.length - 1) { cursorY += lineHeight; cursorX = x }
    })
  }
  return Math.max(1, Math.floor((cursorY - y) / lineHeight) + 1)
}

function drawTableCellBorders(context: CanvasRenderingContext2D, block: DocBlock, row: number, column: number, x: number, y: number, width: number, height: number): void {
  const overrides = block.cellBorders?.[`${row}:${column}`]
  if (!overrides) {
    context.lineWidth = Math.max(0.5, block.borderWidth ?? 1)
    context.strokeStyle = block.borderColor ?? '#d9d9d9'
    context.strokeRect(x, y, width, height)
    return
  }
  const edges = {
    top: { from: [x, y], to: [x + width, y] },
    right: { from: [x + width, y], to: [x + width, y + height] },
    bottom: { from: [x, y + height], to: [x + width, y + height] },
    left: { from: [x, y], to: [x, y + height] },
  } as const
  for (const [edge, segment] of Object.entries(edges) as Array<[keyof typeof edges, typeof edges.top]>) {
    const border = overrides[edge] ?? { style: 'solid' as const, width: block.borderWidth ?? 1 }
    if (border.style === 'none') continue
    context.lineWidth = Math.max(0.5, border.width)
    context.strokeStyle = block.borderColor ?? '#d9d9d9'
    context.lineCap = border.style === 'dots' ? 'round' : 'butt'
    context.setLineDash(border.style === 'dots' ? [1, Math.max(1, border.width * 1.6)] : border.style === 'long-dashes' ? [8, 4] : border.style === 'dashes' ? [2, 2] : [])
    context.beginPath()
    context.moveTo(segment.from[0], segment.from[1])
    context.lineTo(segment.to[0], segment.to[1])
    context.stroke()
  }
  context.setLineDash([])
  context.lineCap = 'butt'
}

export function paginateDocBlocks(blocks: DocBlock[], pageWidth: number, pageHeight: number, measure: MeasureDocLine, margins = DEFAULT_DOC_MARGINS): DocBlock[][] {
  const pageMargins = pageWidth < 400 ? { top: 74, right: 72, bottom: 130, left: 72 } : margins
  const maxWidth = pageWidth - pageMargins.left - pageMargins.right
  const top = pageMargins.top
  const bottom = pageHeight - pageMargins.bottom
  const pages: DocBlock[][] = []
  let currentPage: DocBlock[] = []
  let y = top
  const finishPage = () => { pages.push(currentPage); currentPage = []; y = top }

  for (const block of blocks) {
    if (block.type === 'table') {
      const rows = block.cells ?? []
      const columns = Math.max(1, ...rows.map(row => row.length))
      const tableSpacing = Math.max(0, block.tableSpacing ?? 0)
      const cellWidth = Math.max(20, (maxWidth - tableSpacing * (columns - 1)) / columns)
      const cellPadding = Math.max(0, block.cellPadding ?? 8)
      let tableFragment: string[][] = []
      let tableLineFragments: NonNullable<ExportDocBlock['exportCellLines']> = []
      let fragmentHeight = 0
      let tableFragmentStart = 0
      const finishTableFragment = () => {
        if (tableFragment.length) {
          const fragmentEnd = tableFragmentStart + tableFragment.length
          const merges = (block.merges ?? []).filter(merge => merge.row >= tableFragmentStart && merge.row < fragmentEnd).map(merge => ({ ...merge, row: merge.row - tableFragmentStart }))
          const cellBorders = Object.fromEntries(Object.entries(block.cellBorders ?? {}).flatMap(([key, borders]) => {
            const [row, column] = key.split(':').map(Number)
            return Number.isInteger(row) && row >= tableFragmentStart && row < fragmentEnd ? [[`${row - tableFragmentStart}:${column}`, borders]] : []
          }))
          const cellImages = Object.fromEntries(Object.entries((block as ExportDocBlock).cellImages ?? {}).flatMap(([key, images]) => {
            const [row, column] = key.split(':').map(Number)
            return Number.isInteger(row) && row >= tableFragmentStart && row < fragmentEnd ? [[`${row - tableFragmentStart}:${column}`, images]] : []
          }))
          currentPage.push({ ...block, cells: tableFragment, merges, cellBorders, ...(Object.keys(cellImages).length ? { cellImages } : {}), ...(tableLineFragments.some(Boolean) ? { exportCellLines: tableLineFragments } : {}) })
          tableFragmentStart = fragmentEnd
        }
        tableFragment = []
        tableLineFragments = []
        fragmentHeight = 0
      }
      for (const [rowIndex, row] of rows.entries()) {
        const wrappedCells = row.map((cell, columnIndex) => {
          const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === columnIndex)
          const covered = (block.merges ?? []).some(item => item.row === rowIndex && columnIndex > item.column && columnIndex < item.column + item.colSpan)
          if (covered) return []
          return wrapDocCellText(cell, Math.max(20, cellWidth * (merge?.colSpan ?? 1) + tableSpacing * Math.max(0, (merge?.colSpan ?? 1) - 1) - cellPadding * 2), text => measure(text, DOC_TABLE_FONT_SIZE, '400'))
        })
        const imageBlock = block as ExportDocBlock
        const maxTextHeight = Math.max(1, ...wrappedCells.map(docCellLinesHeight))
        const maxCellImageHeight = Math.max(1, bottom - top - tableSpacing - cellPadding * 2 - maxTextHeight - 6)
        const cellImageLayouts = Array.from({ length: columns }, (_, columnIndex) => {
          const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === columnIndex)
          const span = merge?.colSpan ?? 1
          const mergedWidth = cellWidth * span + tableSpacing * Math.max(0, span - 1) - cellPadding * 2
          return docCellImageLayouts(imageBlock, rowIndex, columnIndex, Math.max(1, mergedWidth), maxCellImageHeight)
        })
        const rowHasImages = cellImageLayouts.some(layouts => layouts.length > 0)
        const rowContentHeight = Math.max(1, ...wrappedCells.map((lines, columnIndex) => docCellLinesHeight(lines) + docCellImageHeight(cellImageLayouts[columnIndex] ?? []) + ((cellImageLayouts[columnIndex]?.length ?? 0) ? 6 : 0)))
        const rowHeight = Math.max(30, rowContentHeight + cellPadding * 2)
        const fullPageContentHeight = bottom - top - tableSpacing - cellPadding * 2
        if (!rowHasImages && bottom - top >= 300 && rowContentHeight > fullPageContentHeight) {
          let availableHeight = bottom - y - fragmentHeight - tableSpacing - cellPadding * 2
          let lineEnd = docCellFragmentEnd(wrappedCells, 0, availableHeight)
          if (lineEnd < 1) {
            finishTableFragment()
            if (currentPage.length) finishPage()
            availableHeight = fullPageContentHeight
            lineEnd = docCellFragmentEnd(wrappedCells, 0, availableHeight)
          } else if (tableFragment.length) {
            const previousTableHeight = fragmentHeight
            finishTableFragment()
            y += previousTableHeight
            availableHeight = bottom - y - tableSpacing - cellPadding * 2
            lineEnd = docCellFragmentEnd(wrappedCells, 0, availableHeight)
          }
          const totalLines = Math.max(1, ...wrappedCells.map(lines => lines.length))
          let lineOffset = 0
          while (lineOffset < totalLines) {
            if (lineOffset > 0) lineEnd = docCellFragmentEnd(wrappedCells, lineOffset, fullPageContentHeight)
            if (lineEnd <= lineOffset) lineEnd = Math.min(totalLines, lineOffset + 1)
            const rowFragment = wrappedCells.map(lines => lines.slice(lineOffset, lineEnd).join('\n'))
            tableFragmentStart = rowIndex
            tableFragment = [rowFragment]
            tableLineFragments = [wrappedCells.map(lines => lines.slice(lineOffset, lineEnd))]
            const fragmentContentHeight = Math.max(1, ...wrappedCells.map(lines => docCellLinesHeight(lines.slice(lineOffset, lineEnd))))
            fragmentHeight = Math.max(30, fragmentContentHeight + cellPadding * 2) + tableSpacing
            const renderedFragmentHeight = fragmentHeight
            const isLastFragment = lineEnd === totalLines
            finishTableFragment()
            lineOffset = lineEnd
            if (!isLastFragment) finishPage()
            else y += renderedFragmentHeight + 12
          }
          continue
        }
        if (y + fragmentHeight + rowHeight + tableSpacing > bottom && (currentPage.length || tableFragment.length)) {
          finishTableFragment()
          finishPage()
        }
        tableFragment.push([...row])
        tableLineFragments.push(undefined)
        fragmentHeight += rowHeight + tableSpacing
      }
      const tableHeight = fragmentHeight
      finishTableFragment()
      y += tableHeight + 12
      continue
    }
    if (block.type === 'image') {
      const imageSize = docImageSize(block, maxWidth, Math.max(1, bottom - top - 19))
      if (!imageSize) continue
      const blockHeight = imageSize.height + 19
      if (y + blockHeight > bottom && currentPage.length) finishPage()
      currentPage.push(block)
      y += blockHeight
      continue
    }
    const { fontSize, fontWeight, lineHeight } = docTextMetrics(block)
    const lines = wrapDocText(block.text, maxWidth, text => measure(text, fontSize, fontWeight))
    const blockHeight = lines.length * lineHeight + (block.type === 'heading' ? 13 : 19)
    if (y + blockHeight > bottom && currentPage.length) finishPage()
    currentPage.push({ ...block, text: lines.join('\n') })
    y += blockHeight
  }
  if (currentPage.length || pages.length === 0) pages.push(currentPage)
  return pages
}

function createDocCanvas(document: DesignDocument, background: string): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = Math.round(document.width * EXPORT_SCALE)
  canvas.height = Math.round(document.height * EXPORT_SCALE)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Nao foi possivel preparar o canvas de exportacao.')
  context.scale(EXPORT_SCALE, EXPORT_SCALE)
  context.fillStyle = background
  context.fillRect(0, 0, document.width, document.height)
  context.textBaseline = 'top'
  return { canvas, context }
}

export async function renderDocumentCanvases(document: DesignDocument, continuous = false): Promise<Array<{ canvas: HTMLCanvasElement; sourcePageIndex: number; semanticBlocks: DocBlock[] }>> {
  const result: Array<{ canvas: HTMLCanvasElement; sourcePageIndex: number; semanticBlocks: DocBlock[] }> = []
  const margins = docMargins(document)
  const contentWidth = Math.max(80, document.width - margins.left - margins.right)
  for (const [sourcePageIndex, page] of document.pages.entries()) {
    const measurement = globalThis.document.createElement('canvas').getContext('2d')
    if (!measurement) throw new Error('Nao foi possivel medir o texto do documento.')
    const blocks = page.blocks ?? []
    const measure = (text: string, fontSize: number, fontWeight: '400' | '700') => {
      measurement.font = `${fontWeight} ${fontSize}px Arial, sans-serif`
      return measurement.measureText(text).width
    }
    let pageHeight = document.height
    if (continuous) {
      let contentHeight = margins.top
      for (const [blockIndex, block] of blocks.entries()) {
        if (block.type === 'table') {
          const rows = block.cells ?? []
          const columns = Math.max(1, ...rows.map(row => row.length))
          const tableSpacing = Math.max(0, block.tableSpacing ?? 0)
          const cellWidth = Math.max(20, (contentWidth - tableSpacing * (columns - 1)) / columns)
          const cellPadding = Math.max(0, block.cellPadding ?? 8)
          for (const row of rows) {
            const rowIndex = rows.indexOf(row)
            const wrapped = Array.from({ length: columns }, (_, index) => {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === index)
              return wrapDocCellText(row[index] ?? '', Math.max(20, cellWidth * (merge?.colSpan ?? 1) + tableSpacing * Math.max(0, (merge?.colSpan ?? 1) - 1) - cellPadding * 2), text => measure(text, DOC_TABLE_FONT_SIZE, '400'))
            })
            const imageBlock = block as ExportDocBlock
            const imageLayouts = Array.from({ length: columns }, (_, columnIndex) => {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === columnIndex)
              const span = merge?.colSpan ?? 1
              const mergedWidth = cellWidth * span + tableSpacing * Math.max(0, span - 1) - cellPadding * 2
              return docCellImageLayouts(imageBlock, rowIndex, columnIndex, Math.max(1, mergedWidth), Number.MAX_SAFE_INTEGER)
            })
            const rowHeight = Math.max(30, Math.max(1, ...wrapped.map((lines, columnIndex) => Math.max(1, lines.length) * DOC_TABLE_LINE_HEIGHT + docCellImageHeight(imageLayouts[columnIndex] ?? []) + ((imageLayouts[columnIndex]?.length ?? 0) ? 6 : 0))) + cellPadding * 2)
            contentHeight += rowHeight + tableSpacing
          }
          contentHeight += docTableTrailingGap(blocks, blockIndex)
          continue
        }
        if (block.type === 'image') {
          const imageSize = docImageSize(block, contentWidth, Number.MAX_SAFE_INTEGER)
          if (imageSize) contentHeight += imageSize.height + 19
          continue
        }
        const { fontSize, fontWeight, lineHeight } = docTextMetrics(block)
        const lines = wrapDocText(block.text, contentWidth, text => measure(text, fontSize, fontWeight))
        contentHeight += lines.length * lineHeight + (block.type === 'heading' ? 13 : 19)
      }
      pageHeight = Math.max(document.height, Math.ceil(contentHeight + margins.bottom))
    }
    const paginated = paginateDocBlocks(blocks, document.width, pageHeight, measure, margins)
    const renderedBulletIds = new Set<string>()
    for (const blocks of paginated) {
      let renderedContentHeight = margins.top
      for (const [blockIndex, block] of blocks.entries()) {
        if (block.type === 'table') {
          const rows = block.cells ?? []
          const columns = Math.max(1, ...rows.map(row => row.length))
          const tableSpacing = Math.max(0, block.tableSpacing ?? 0)
          const cellWidth = Math.max(20, (contentWidth - tableSpacing * (columns - 1)) / columns)
          const padding = Math.max(0, block.cellPadding ?? 8)
          const exportCellLines = (block as ExportDocBlock).exportCellLines
          for (const [rowIndex, row] of rows.entries()) {
            const wrappedCells = Array.from({ length: columns }, (_, column) => {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === column)
              const covered = (block.merges ?? []).some(item => item.row === rowIndex && column > item.column && column < item.column + item.colSpan)
              return covered ? [] : exportCellLines?.[rowIndex]?.[column] ?? wrapDocCellText(row[column] ?? '', Math.max(20, cellWidth * (merge?.colSpan ?? 1) + tableSpacing * Math.max(0, (merge?.colSpan ?? 1) - 1) - padding * 2), text => measure(text, DOC_TABLE_FONT_SIZE, '400'))
            })
            const imageBlock = block as ExportDocBlock
            const maxTextHeight = Math.max(1, ...wrappedCells.map(docCellLinesHeight))
            const maxCellImageHeight = Math.max(1, pageHeight - margins.top - margins.bottom - tableSpacing - padding * 2 - maxTextHeight - 6)
            const imageLayouts = Array.from({ length: columns }, (_, columnIndex) => {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === columnIndex)
              const span = merge?.colSpan ?? 1
              const mergedWidth = cellWidth * span + tableSpacing * Math.max(0, span - 1) - padding * 2
              return docCellImageLayouts(imageBlock, rowIndex, columnIndex, Math.max(1, mergedWidth), maxCellImageHeight)
            })
            renderedContentHeight += Math.max(30, Math.max(1, ...wrappedCells.map((lines, columnIndex) => docCellLinesHeight(lines) + docCellImageHeight(imageLayouts[columnIndex] ?? []) + ((imageLayouts[columnIndex]?.length ?? 0) ? 6 : 0))) + padding * 2) + tableSpacing
          }
          renderedContentHeight += docTableTrailingGap(blocks, blockIndex)
        } else {
          if (block.type === 'image') {
            const imageSize = docImageSize(block, contentWidth, Math.max(1, pageHeight - margins.top - margins.bottom - 19))
            if (imageSize) renderedContentHeight += imageSize.height + 19
            continue
          }
          const { fontSize, fontWeight, lineHeight } = docTextMetrics(block)
          const lines = wrapDocText(block.text, contentWidth, text => measure(text, fontSize, fontWeight))
          renderedContentHeight += lines.length * lineHeight + (block.type === 'heading' ? 13 : 19)
        }
      }
      const canvasDocument = { ...document, height: Math.max(document.height, Math.ceil(renderedContentHeight + margins.bottom)) }
      const { canvas, context } = createDocCanvas(canvasDocument, page.background)
      let y = margins.top
      for (const [blockIndex, block] of blocks.entries()) {
        if (block.type === 'table') {
          const rows = block.cells ?? []
          const columns = Math.max(1, ...rows.map(row => row.length))
          const tableSpacing = Math.max(0, block.tableSpacing ?? 0)
          const cellWidth = Math.max(20, (contentWidth - tableSpacing * (columns - 1)) / columns)
          const cellPadding = Math.max(0, block.cellPadding ?? 8)
          context.font = `400 ${DOC_TABLE_FONT_SIZE}px Arial, sans-serif`
          const exportCellLines = (block as ExportDocBlock).exportCellLines
          for (const [rowIndex, row] of rows.entries()) {
            const wrapped = Array.from({ length: columns }, (_, index) => {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === index)
              const covered = (block.merges ?? []).some(item => item.row === rowIndex && index > item.column && index < item.column + item.colSpan)
              return covered ? [] : exportCellLines?.[rowIndex]?.[index] ?? wrapDocCellText(row[index] ?? '', Math.max(20, cellWidth * (merge?.colSpan ?? 1) + tableSpacing * Math.max(0, (merge?.colSpan ?? 1) - 1) - cellPadding * 2), text => measure(text, DOC_TABLE_FONT_SIZE, '400'))
            })
            const imageBlock = block as ExportDocBlock
            const maxTextHeight = Math.max(1, ...wrapped.map(docCellLinesHeight))
            const maxCellImageHeight = Math.max(1, pageHeight - margins.top - margins.bottom - tableSpacing - cellPadding * 2 - maxTextHeight - 6)
            const imageLayouts = Array.from({ length: columns }, (_, columnIndex) => {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === columnIndex)
              const span = merge?.colSpan ?? 1
              const mergedWidth = cellWidth * span + tableSpacing * Math.max(0, span - 1) - cellPadding * 2
              return docCellImageLayouts(imageBlock, rowIndex, columnIndex, Math.max(1, mergedWidth), maxCellImageHeight)
            })
            const rowHeight = Math.max(30, Math.max(1, ...wrapped.map((lines, columnIndex) => docCellLinesHeight(lines) + docCellImageHeight(imageLayouts[columnIndex] ?? []) + ((imageLayouts[columnIndex]?.length ?? 0) ? 6 : 0))) + cellPadding * 2)
            for (let column = 0; column < columns;) {
              const merge = (block.merges ?? []).find(item => item.row === rowIndex && item.column === column)
              if ((block.merges ?? []).some(item => item.row === rowIndex && column > item.column && column < item.column + item.colSpan)) { column += 1; continue }
              const span = merge?.colSpan ?? 1
              const x = margins.left + column * (cellWidth + tableSpacing)
              const width = cellWidth * span + tableSpacing * Math.max(0, span - 1)
              context.fillStyle = '#ffffff'
              context.fillRect(x, y, width, rowHeight)
              drawTableCellBorders(context, block, rowIndex, column, x, y, width, rowHeight)
              context.fillStyle = '#29263d'
              let lineY = y + cellPadding
              wrapped[column].forEach(line => {
                if (line) context.fillText(line, x + cellPadding, lineY)
                lineY += docCellLineHeight(line)
              })
              const images = imageLayouts[column] ?? []
              let imageY = lineY + (images.length ? 6 : 0)
              for (const item of images) {
                const image = await loadImage(item.image.src)
                context.drawImage(image, x + cellPadding, imageY, item.width, item.height)
                imageY += item.height + 6
              }
              column += span
            }
            y += rowHeight + tableSpacing
          }
          y += docTableTrailingGap(blocks, blockIndex)
          continue
        }
        if (block.type === 'image') {
          const imageSize = docImageSize(block, contentWidth, Math.max(1, pageHeight - margins.top - margins.bottom - 19))
          if (!imageSize) continue
          const image = await loadImage(block.image!.src)
          context.drawImage(image, margins.left, y, imageSize.width, imageSize.height)
          y += imageSize.height + 19
          continue
        }
        const { fontSize, fontWeight, lineHeight } = docTextMetrics(block)
        context.font = `${fontWeight} ${fontSize}px Arial, sans-serif`
        context.fillStyle = block.type === 'quote' ? '#625f75' : '#29263d'
        const showBullet = block.type === 'bullet' && !renderedBulletIds.has(block.id)
        if (showBullet) renderedBulletIds.add(block.id)
        const textX = showBullet ? margins.left + 20 : margins.left
        if (showBullet) context.fillText('•', margins.left, y)
        const lineCount = drawDocText(context, block, textX, y, document.width - margins.right, fontSize, block.type === 'heading' || block.type === 'subheading', block.type === 'quote')
        y += lineCount * lineHeight
        y += block.type === 'heading' ? 13 : 19
      }
      result.push({ canvas, sourcePageIndex, semanticBlocks: blocks })
    }
  }
  return result
}

export async function renderPageCanvas(document: DesignDocument, page: DesignPage, backgroundOverride?: string | null, scaleOverride?: number): Promise<HTMLCanvasElement> {
  if (document.type === 'doc') return (await renderDocumentCanvases({ ...document, pages: [page] }))[0].canvas
  if (document.type === 'sheet') return renderSheetCanvas(document, page)
  const exportScale = document.type === 'whiteboard' ? 1 : scaleOverride ?? EXPORT_SCALE
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = Math.round(document.width * exportScale)
  canvas.height = Math.round(document.height * exportScale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar o canvas de exportação.')
  context.scale(exportScale, exportScale)
  const background = backgroundOverride === undefined ? page.background : backgroundOverride
  if (background !== null) {
    context.fillStyle = background
    context.fillRect(0, 0, document.width, document.height)
  }
  for (const connector of page.connectors ?? []) drawConnector(context, page, connector)
  for (const element of page.elements) await drawElement(context, element)
  return canvas
}

function renderSheetCanvas(document: DesignDocument, page: DesignPage): HTMLCanvasElement {
  const cells = page.cells ?? [['']]
  const merges = page.cellMerges ?? []
  const { values } = evaluateSheet(cells, merges)
  const rowCount = Math.max(1, values.length)
  const columnCount = Math.max(1, ...values.map(row => row.length))
  const scale = EXPORT_SCALE
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = Math.round(document.width * scale)
  canvas.height = Math.round(document.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar o canvas da planilha.')
  context.scale(scale, scale)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, document.width, document.height)
  const left = 52
  const top = 40
  const headerHeight = 28
  const rowHeight = Math.min(32, Math.max(20, (document.height - top - headerHeight - 24) / rowCount))
  const columnWidth = Math.max(54, (document.width - left - 24) / columnCount)
  context.font = '12px Arial, sans-serif'
  context.textBaseline = 'middle'
  context.textAlign = 'center'
  context.fillStyle = '#f2f2f5'
  context.fillRect(left, top, columnWidth * columnCount, headerHeight)
  context.fillRect(0, top, left, headerHeight + rowHeight * rowCount)
  context.fillStyle = '#6d6a78'
  for (let column = 0; column < columnCount; column += 1) context.fillText(columnLabel(column), left + column * columnWidth + columnWidth / 2, top + headerHeight / 2)
  context.textAlign = 'right'
  for (let row = 0; row < rowCount; row += 1) context.fillText(String(row + 1), left - 9, top + headerHeight + row * rowHeight + rowHeight / 2)
  context.strokeStyle = '#e1e0e6'
  context.lineWidth = 1
  for (let column = 0; column <= columnCount; column += 1) {
    const x = left + column * columnWidth
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + headerHeight)
    for (let row = 0; row < rowCount; row += 1) {
      const coveredByMerge = merges.some(merge => column > merge.column && column < merge.column + merge.colSpan && row >= merge.row && row < merge.row + (merge.rowSpan ?? 1))
      if (coveredByMerge) continue
      context.moveTo(x, top + headerHeight + row * rowHeight)
      context.lineTo(x, top + headerHeight + (row + 1) * rowHeight)
    }
    context.stroke()
  }
  for (let row = 0; row <= rowCount + 1; row += 1) {
    const y = top + (row === 0 ? 0 : headerHeight + (row - 1) * rowHeight)
    context.beginPath()
    if (row === 0 || row === rowCount + 1) {
      context.moveTo(0, y)
      context.lineTo(left + columnWidth * columnCount, y)
    } else {
      context.moveTo(0, y); context.lineTo(left, y)
      const cellBoundary = row - 1
      for (let column = 0; column < columnCount; column += 1) {
        const coveredByMerge = merges.some(merge => cellBoundary > merge.row && cellBoundary < merge.row + (merge.rowSpan ?? 1) && column >= merge.column && column < merge.column + merge.colSpan)
        if (coveredByMerge) continue
        context.moveTo(left + column * columnWidth, y)
        context.lineTo(left + (column + 1) * columnWidth, y)
      }
    }
    context.stroke()
  }
  context.textAlign = 'left'
  context.fillStyle = '#343241'
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      if (merges.some(merge => row >= merge.row && row < merge.row + (merge.rowSpan ?? 1) && column >= merge.column && column < merge.column + merge.colSpan && (row !== merge.row || column !== merge.column))) continue
      const value = formatSheetCellValue(values[row]?.[column] ?? '', page.cellFormats?.[`${row}:${column}`])
      if (!value) continue
      context.fillStyle = value.startsWith('#') ? '#b83245' : '#343241'
      const merge = merges.find(item => item.row === row && item.column === column)
      const rowSpan = merge?.rowSpan ?? 1
      context.fillText(value, left + column * columnWidth + 7, top + headerHeight + row * rowHeight + rowHeight * rowSpan / 2, columnWidth * (merge?.colSpan ?? 1) - 14)
    }
  }
  return canvas
}
