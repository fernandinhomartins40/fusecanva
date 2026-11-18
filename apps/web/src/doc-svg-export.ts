import type { DesignDocument, DocBlock, DocImage, DocInlineMark } from './model'
import { paginateDocBlocks } from './export'
import { getDocTextRuns, isSafeDocImage } from './doc-format'

const DEFAULT_MARGINS = { top: 96, right: 96, bottom: 96, left: 96 }
const TABLE_FONT_SIZE = 16
const TABLE_LINE_HEIGHT = 22
const TABLE_PARAGRAPH_GAP = 16
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const num = (value: number) => Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0'

type ExportDocBlock = DocBlock & { exportCellLines?: Array<Array<string[] | undefined> | undefined> }
export type DocSvgPage = { sourcePageIndex: number; pageIndex: number; width: number; height: number; svg: string }
type Margins = { top: number; right: number; bottom: number; left: number }
type RunToken = { text: string; start: number; end: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean }

function marginsFor(documentModel: DesignDocument): Margins {
  return documentModel.width < 400 ? { top: 74, right: 72, bottom: 130, left: 72 } : documentModel.docPageSetup?.margins ?? DEFAULT_MARGINS
}

function measureWith(context: CanvasRenderingContext2D, text: string, fontSize: number, weight: '400' | '700') {
  context.font = `${weight} ${fontSize}px Arial, sans-serif`
  return context.measureText(text).width
}

function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
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

function wrapCellText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const paragraphs = text.split('\n')
  return paragraphs.flatMap((paragraph, index) => [...wrapText(paragraph, maxWidth, measure), ...(index < paragraphs.length - 1 ? [''] : [])])
}

function cellLineHeight(line: string) { return line === '' ? TABLE_PARAGRAPH_GAP : TABLE_LINE_HEIGHT }
function linesHeight(lines: string[]) { return lines.reduce((height, line) => height + cellLineHeight(line), 0) }

function markedTokens(text: string, marks: DocInlineMark[] = []): RunToken[] {
  const tokens: RunToken[] = []
  for (const run of getDocTextRuns(text, marks)) {
    const pattern = /\S+\s*/gu
    let match: RegExpExecArray | null
    while ((match = pattern.exec(run.text))) {
      const start = run.start + match.index
      tokens.push({ text: match[0], start, end: start + match[0].length, bold: run.bold, italic: run.italic, underline: run.underline, strike: run.strike })
    }
    // Preserve explicit blank lines and whitespace-only paragraphs from the model.
    if (!run.text.trim() && run.text.includes('\n')) {
      const lineBreaks = [...run.text.matchAll(/\n/g)]
      for (const lineBreak of lineBreaks) {
        const start = run.start + (lineBreak.index ?? 0)
        tokens.push({ text: '\n', start, end: start + 1, bold: run.bold, italic: run.italic, underline: run.underline, strike: run.strike })
      }
    } else if (!run.text.trim() && !run.text.includes('\n') && run.text) {
      tokens.push({ text: run.text, start: run.start, end: run.end, bold: run.bold, italic: run.italic, underline: run.underline, strike: run.strike })
    }
  }
  return tokens.sort((left, right) => left.start - right.start)
}

function textBlockSvg(block: DocBlock, x: number, y: number, maxWidth: number): { svg: string; height: number } {
  const fontSize = block.type === 'heading' ? 32 : block.type === 'subheading' ? 23 : 15
  const lineHeight = fontSize * (block.type === 'heading' ? 1.22 : block.type === 'subheading' ? 1.3 : 1.55)
  const baseBold = block.type === 'heading' || block.type === 'subheading'
  const baseItalic = block.type === 'quote'
  const fill = block.type === 'quote' ? '#625f75' : '#29263d'
  const tokens = markedTokens(block.text, block.marks)
  const runs: string[] = []
  let cursorX = x
  let cursorY = y
  let lineCount = 1
  const startLine = () => { cursorY += lineHeight; cursorX = x; lineCount += 1 }
  for (const token of tokens) {
    if (token.text.includes('\n')) {
      const parts = token.text.split('\n')
      for (let index = 0; index < parts.length; index += 1) {
        if (parts[index]) {
          const width = measureStyled(parts[index], fontSize, token, baseBold, baseItalic)
          runs.push(styledText(parts[index], cursorX, cursorY, fontSize, token, baseBold, baseItalic, fill))
          cursorX += width
        }
        if (index < parts.length - 1) startLine()
      }
      continue
    }
    const width = measureStyled(token.text, fontSize, token, baseBold, baseItalic)
    if (cursorX > x && cursorX + width > x + maxWidth) startLine()
    runs.push(styledText(token.text, cursorX, cursorY, fontSize, token, baseBold, baseItalic, fill))
    cursorX += width
  }
  const height = lineCount * lineHeight
  const role = block.type === 'heading' || block.type === 'subheading' ? ' role="heading"' : block.type === 'quote' ? ' role="blockquote"' : block.type === 'bullet' ? ' role="listitem"' : ''
  const level = block.type === 'heading' ? ' aria-level="1"' : block.type === 'subheading' ? ' aria-level="2"' : ''
  return { svg: `<g data-doc-block-type="${block.type}"${role}${level}>${runs.join('')}</g>`, height }
}

function measureStyled(text: string, fontSize: number, token: RunToken, baseBold: boolean, baseItalic: boolean): number {
  const context = measureContext()
  context.font = `${token.italic || baseItalic ? 'italic ' : ''}${token.bold || baseBold ? 700 : 400} ${fontSize}px Arial, sans-serif`
  return context.measureText(text).width
}

function styledText(text: string, x: number, y: number, fontSize: number, token: RunToken, baseBold: boolean, baseItalic: boolean, fill: string): string {
  const decorations = [token.underline ? 'underline' : '', token.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  return `<text x="${num(x)}" y="${num(y)}" dominant-baseline="hanging" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${token.bold || baseBold ? 700 : 400}" font-style="${token.italic || baseItalic ? 'italic' : 'normal'}" fill="${fill}"${decorations ? ` text-decoration="${decorations}"` : ''}>${xml(text)}</text>`
}

function imageSvg(image: DocImage, x: number, y: number, width: number, height: number): string {
  if (!isSafeDocImage(image)) return ''
  return `<image x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" href="${xml(image.src)}" preserveAspectRatio="none" role="img" aria-label="${xml(image.alt || 'Imagem sem descricao alternativa')}"/>`
}

function safeCellImages(block: ExportDocBlock, row: number, column: number): DocImage[] {
  const images = block.cellImages?.[`${row}:${column}`]
  return Array.isArray(images) ? images.filter(isSafeDocImage) : []
}

function cellImageLayouts(images: DocImage[], maxWidth: number, maxHeight: number) {
  const gap = 6
  const perHeight = Math.max(1, (maxHeight - gap * Math.max(0, images.length - 1)) / Math.max(1, images.length))
  return images.map(image => {
    const scale = Math.min(1, maxWidth / image.width, perHeight / image.height)
    return { image, width: Math.max(1, image.width * scale), height: Math.max(1, image.height * scale) }
  })
}

function drawCellBorders(block: DocBlock, row: number, column: number, x: number, y: number, width: number, height: number): string {
  const borders = block.cellBorders?.[`${row}:${column}`]
  const color = xml(block.borderColor ?? '#d9d9d9')
  if (!borders) return `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="none" stroke="${color}" stroke-width="${num(Math.max(.5, block.borderWidth ?? 1))}"/>`
  const edges = {
    top: [x, y, x + width, y], right: [x + width, y, x + width, y + height],
    bottom: [x, y + height, x + width, y + height], left: [x, y, x, y + height],
  } as const
  return (Object.entries(edges) as Array<[keyof typeof edges, readonly number[]]>).map(([edge, coords]) => {
    const border = borders[edge] ?? { style: 'solid' as const, width: block.borderWidth ?? 1 }
    if (border.style === 'none') return ''
    const dash = border.style === 'dots' ? '1 2' : border.style === 'long-dashes' ? '8 4' : border.style === 'dashes' ? '2 2' : ''
    return `<path d="M${num(coords[0])} ${num(coords[1])} L${num(coords[2])} ${num(coords[3])}" fill="none" stroke="${color}" stroke-width="${num(Math.max(.5, border.width))}"${dash ? ` stroke-dasharray="${dash}"` : ''}${border.style === 'dots' ? ' stroke-linecap="round"' : ''}/>`
  }).join('')
}

function tableSvg(block: ExportDocBlock, x: number, y: number, contentWidth: number, pageHeight: number, topMargin: number, bottomMargin: number): { svg: string; height: number } {
  const rows = block.cells ?? []
  const columns = Math.max(1, ...rows.map(row => row.length))
  const spacing = Math.max(0, block.tableSpacing ?? 0)
  const cellWidth = Math.max(20, (contentWidth - spacing * (columns - 1)) / columns)
  const padding = Math.max(0, block.cellPadding ?? 8)
  let svg = ''
  let cursorY = y
  const measure = (text: string) => measureWith(measureContext(), text, TABLE_FONT_SIZE, '400')
  for (const [rowIndex, row] of rows.entries()) {
    svg += `<g role="row" aria-label="Linha ${rowIndex + 1}">`
    const lines = Array.from({ length: columns }, (_, column) => {
      const merge = block.merges?.find(item => item.row === rowIndex && item.column === column)
      const covered = block.merges?.some(item => item.row === rowIndex && column > item.column && column < item.column + item.colSpan)
      if (covered) return []
      const exported = block.exportCellLines?.[rowIndex]?.[column]
      return exported ?? wrapCellText(row[column] ?? '', Math.max(20, cellWidth * (merge?.colSpan ?? 1) + spacing * Math.max(0, (merge?.colSpan ?? 1) - 1) - padding * 2), measure)
    })
    const maxTextHeight = Math.max(1, ...lines.map(linesHeight))
    const maxImageHeight = Math.max(1, pageHeight - topMargin - bottomMargin - spacing - padding * 2 - maxTextHeight - 6)
    const imageLayouts = Array.from({ length: columns }, (_, column) => {
      const merge = block.merges?.find(item => item.row === rowIndex && item.column === column)
      const span = merge?.colSpan ?? 1
      const mergedWidth = cellWidth * span + spacing * Math.max(0, span - 1) - padding * 2
      return cellImageLayouts(safeCellImages(block, rowIndex, column), Math.max(1, mergedWidth), maxImageHeight)
    })
    const rowHeight = Math.max(30, Math.max(1, ...lines.map((cellLines, column) => linesHeight(cellLines) + (imageLayouts[column] ?? []).reduce((sum, image) => sum + image.height, 0) + ((imageLayouts[column]?.length ?? 0) ? 6 + 6 * (imageLayouts[column].length - 1) : 0))) + padding * 2)
    for (let column = 0; column < columns;) {
      const merge = block.merges?.find(item => item.row === rowIndex && item.column === column)
      if (block.merges?.some(item => item.row === rowIndex && column > item.column && column < item.column + item.colSpan)) { column += 1; continue }
      const span = merge?.colSpan ?? 1
      const cellX = x + column * (cellWidth + spacing)
      const width = cellWidth * span + spacing * Math.max(0, span - 1)
      const cellImages = imageLayouts[column] ?? []
      const cellLabel = row[column] || cellImages.map(layout => layout.image.alt).filter(Boolean).join(', ') || `Celula ${rowIndex + 1}, ${column + 1}`
      svg += `<g role="cell" aria-label="${xml(cellLabel)}">`
      svg += `<rect data-doc-cell="${rowIndex}:${column}" data-colspan="${span}" x="${num(cellX)}" y="${num(cursorY)}" width="${num(width)}" height="${num(rowHeight)}" fill="#ffffff"/>`
      svg += drawCellBorders(block, rowIndex, column, cellX, cursorY, width, rowHeight)
      let textY = cursorY + padding
      for (const line of lines[column] ?? []) {
        if (line) svg += `<text x="${num(cellX + padding)}" y="${num(textY)}" dominant-baseline="hanging" font-family="Arial, sans-serif" font-size="${TABLE_FONT_SIZE}" fill="#29263d">${xml(line)}</text>`
        textY += line === '' ? TABLE_PARAGRAPH_GAP : TABLE_LINE_HEIGHT
      }
      const images = cellImages
      let imageY = textY + (images.length ? 6 : 0)
      for (const layout of images) {
        svg += imageSvg(layout.image, cellX + padding, imageY, layout.width, layout.height)
        imageY += layout.height + 6
      }
      svg += '</g>'
      column += span
    }
    svg += '</g>'
    cursorY += rowHeight + spacing
  }
  return { svg: rows.length ? `<g role="table" aria-label="Tabela do documento">${svg}</g>` : '', height: rows.length ? cursorY - y : 0 }
}

let sharedMeasureCanvas: HTMLCanvasElement | null = null
function measureContext(): CanvasRenderingContext2D {
  sharedMeasureCanvas ??= document.createElement('canvas')
  const context = sharedMeasureCanvas.getContext('2d')
  if (!context) throw new Error('Nao foi possivel medir o texto para SVG.')
  return context
}

function physicalPageSvg(documentModel: DesignDocument, blocks: DocBlock[], sourcePageIndex: number, pageIndex: number): DocSvgPage {
  const margins = marginsFor(documentModel)
  const contentWidth = Math.max(80, documentModel.width - margins.left - margins.right)
  let y = margins.top
  let body = ''
  const bulletIds = new Set<string>()
  for (const [index, rawBlock] of blocks.entries()) {
    const block = rawBlock as ExportDocBlock
    if (block.type === 'table') {
      const rendered = tableSvg(block, margins.left, y, contentWidth, documentModel.height, margins.top, margins.bottom)
      body += rendered.svg
      const nextBlock = blocks[index + 1]
      y += rendered.height + (nextBlock && !(nextBlock.type === 'table' && nextBlock.id === block.id) ? 12 : 0)
      continue
    }
    if (block.type === 'image') {
      if (!isSafeDocImage(block.image)) continue
      const scale = Math.min(1, contentWidth / block.image.width, Math.max(1, documentModel.height - margins.top - margins.bottom - 19) / block.image.height)
      const width = block.image.width * scale
      const height = block.image.height * scale
      body += imageSvg(block.image, margins.left, y, width, height)
      y += height + 19
      continue
    }
    const showBullet = block.type === 'bullet' && !bulletIds.has(block.id)
    if (showBullet) { bulletIds.add(block.id); body += `<text x="${margins.left}" y="${num(y)}" dominant-baseline="hanging" font-family="Arial, sans-serif" font-size="15" fill="#29263d">&#8226;</text>` }
    const textX = showBullet ? margins.left + 20 : margins.left
    const rendered = textBlockSvg(block, textX, y, documentModel.width - margins.right - textX)
    body += rendered.svg
    y += rendered.height
    // Renderer applies the paragraph/heading gap after each text block.
    if (index < blocks.length) y += block.type === 'heading' ? 13 : 19
  }
  const pageHeight = Math.max(documentModel.height, Math.ceil(y + margins.bottom))
  const page = documentModel.pages[sourcePageIndex]
  const background = page?.background || '#ffffff'
  const title = `${documentModel.name} — ${page?.name ?? 'Página'}${pageIndex ? ` (${pageIndex + 1})` : ''}`
  const description = blocks.map(block => block.type === 'table' ? (block.cells ?? []).map(row => row.join(' | ')).join('. ') : block.type === 'image' ? block.image?.alt ?? 'Imagem' : block.text).filter(Boolean).join('. ').slice(0, 2_000)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(documentModel.width)}" height="${num(pageHeight)}" viewBox="0 0 ${num(documentModel.width)} ${num(pageHeight)}"><title>${xml(title)}</title><desc>${xml(description)}</desc><rect width="100%" height="100%" fill="${xml(background)}"/>${body}</svg>`
  if (new Blob([svg]).size > 64_000_000) throw new Error('O SVG excede o limite seguro de 64 MB.')
  return { sourcePageIndex, pageIndex, width: documentModel.width, height: pageHeight, svg }
}

/** Render a Docs design page as editable SVG pages. Text and table content remains vector; only embedded document images are raster. */
export function renderDocPageSvgs(documentModel: DesignDocument, sourcePageIndex: number): DocSvgPage[] {
  if (documentModel.type !== 'doc') throw new Error('A exportacao vetorial de Docs requer um documento Docs.')
  if (!(documentModel.width > 0 && documentModel.height > 0) || !Number.isFinite(documentModel.width + documentModel.height)) throw new Error('As dimensoes do documento nao sao validas para SVG.')
  const sourcePage = documentModel.pages[sourcePageIndex]
  if (!sourcePage) throw new Error('A pagina Docs selecionada nao existe.')
  const margins = marginsFor(documentModel)
  const context = measureContext()
  const measure = (text: string, fontSize: number, weight: '400' | '700') => {
    context.font = `${weight} ${fontSize}px Arial, sans-serif`
    return context.measureText(text).width
  }
  const physicalPages = paginateDocBlocks(sourcePage.blocks ?? [], documentModel.width, documentModel.height, measure, margins)
  const sourceBlocks = new Map((sourcePage.blocks ?? []).map(block => [block.id, block]))
  return physicalPages.map((blocks, pageIndex) => physicalPageSvg(documentModel, blocks.map(block => block.type === 'table' ? block : sourceBlocks.get(block.id) ?? block), sourcePageIndex, pageIndex))
}

/** Combine all physical pages from a stored Docs page into the tall SVG used by the current single-file export flow. */
export function renderDocContinuousSvg(documentModel: DesignDocument, sourcePageIndex: number): DocSvgPage {
  const pages = renderDocPageSvgs(documentModel, sourcePageIndex)
  const totalHeight = pages.reduce((height, page) => height + page.height, 0)
  let y = 0
  const nestedPages = pages.map(page => {
    const match = /^<svg\b[^>]*>([\s\S]*)<\/svg>$/.exec(page.svg)
    if (!match) throw new Error('Nao foi possivel combinar as paginas vetoriais do Docs.')
    const viewport = `<svg x="0" y="${num(y)}" width="${num(page.width)}" height="${num(page.height)}" viewBox="0 0 ${num(page.width)} ${num(page.height)}">${match[1]}</svg>`
    y += page.height
    return viewport
  }).join('')
  const sourcePage = documentModel.pages[sourcePageIndex]
  const title = `${documentModel.name} — ${sourcePage?.name ?? 'Página'} — documento completo`
  const description = `${pages.length} páginas vetoriais A4 em ordem de leitura.`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(documentModel.width)}" height="${num(totalHeight)}" viewBox="0 0 ${num(documentModel.width)} ${num(totalHeight)}"><title>${xml(title)}</title><desc>${xml(description)}</desc>${nestedPages}</svg>`
  if (new Blob([svg]).size > 64_000_000) throw new Error('O SVG excede o limite seguro de 64 MB.')
  return { sourcePageIndex, pageIndex: 0, width: documentModel.width, height: totalHeight, svg }
}

