import JSZip from 'jszip'
import type { DocBlock, DocImage, DocInlineMark } from './model'
import { MAX_DOC_IMAGE_BYTES, MAX_DOC_IMAGE_DIMENSION, MAX_DOC_IMAGE_PIXELS, MAX_DOC_IMAGE_TOTAL_BYTES, decodeDocImageDataUrl, isSafeDocImage } from './doc-format'

export const MAX_DOCX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_DOCX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024
const MAX_DOCX_ENTRIES = 1000
const MAX_DOCUMENT_XML_BYTES = 12 * 1024 * 1024
const MAX_DOCUMENT_RELS_XML_BYTES = 1 * 1024 * 1024
const MAX_DOCX_TABLE_CELLS = 100_000

export type ImportedDocx = { title: string; blocks: DocBlock[] }

type ParagraphResult = { text: string; marks: DocInlineMark[]; type: DocBlock['type'] }

function readZipDirectory(bytes: Uint8Array): { entryCount: number; uncompressedBytes: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minEocd = Math.max(0, bytes.byteLength - 65_557)
  let eocd = -1
  for (let offset = bytes.byteLength - 22; offset >= minEocd; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0 || eocd + 22 > bytes.byteLength) throw new Error('O arquivo não é um DOCX ou ZIP válido.')
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskEntries = view.getUint16(eocd + 8, true)
  const entryCount = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  const commentLength = view.getUint16(eocd + 20, true)
  if (disk || centralDisk || diskEntries !== entryCount || entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff || eocd + 22 + commentLength > bytes.byteLength) {
    throw new Error('O DOCX usa um formato ZIP inválido ou ainda não suportado.')
  }
  if (entryCount > MAX_DOCX_ENTRIES || centralOffset + centralSize > eocd) throw new Error('O DOCX contém uma estrutura ZIP inválida ou excessivamente grande.')
  let offset = centralOffset
  let uncompressedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('O DOCX contém uma tabela ZIP inválida.')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentSize = view.getUint16(offset + 32, true)
    if (flags & 1 || ![0, 8].includes(method) || uncompressedSize === 0xffffffff) throw new Error('O DOCX usa criptografia ou compressão ZIP não suportada.')
    uncompressedBytes += uncompressedSize
    if (uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error('O conteúdo descompactado do DOCX excede 40 MB.')
    offset += 46 + nameLength + extraLength + commentSize
  }
  if (offset !== centralOffset + centralSize) throw new Error('O DOCX contém uma tabela ZIP inconsistente.')
  return { entryCount, uncompressedBytes }
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const codepoint = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      const validXmlCharacter = codepoint === 0x9 || codepoint === 0xa || codepoint === 0xd
        || (codepoint >= 0x20 && codepoint <= 0xd7ff)
        || (codepoint >= 0xe000 && codepoint <= 0xfffd)
        || (codepoint >= 0x10000 && codepoint <= 0x10ffff)
      if (!Number.isFinite(codepoint) || !validXmlCharacter) throw new Error('O DOCX contém uma referência a caractere inválido para XML 1.0.')
      return String.fromCodePoint(codepoint)
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()] ?? entity
  })
}

function assertWellFormedXml(xml: string): void {
  const tokenPattern = /<\?(?:[^?]|\?(?!>))*\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>/g
  const stack: string[] = []
  let cursor = 0
  let roots = 0
  for (const match of xml.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    const text = xml.slice(cursor, index)
    if (text.includes('<') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(text)) throw new Error('O XML do DOCX não está bem formado.')
    const token = match[0]
    cursor = index + token.length
    if (token.startsWith('<?') || token.startsWith('<!--') || token.startsWith('<![CDATA[')) continue
    if (token.startsWith('</')) {
      const closing = token.match(/^<\/([\w:.-]+)\s*>$/)?.[1]
      if (!closing || stack.pop() !== closing) throw new Error('O XML do DOCX não está bem formado.')
      continue
    }
    const selfClosing = /\/\s*>$/.test(token)
    const openingContent = token.slice(1, token.lastIndexOf('>')).replace(/\/\s*$/, '').trimEnd()
    const opening = openingContent.match(/^([\w:.-]+)(?:\s[\s\S]*)?$/)
    if (!opening) throw new Error('O XML do DOCX não está bem formado.')
    if (!stack.length) roots += 1
    if (!selfClosing) stack.push(opening[1])
  }
  const tail = xml.slice(cursor)
  if (tail.includes('<') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(tail) || stack.length || roots !== 1) throw new Error('O XML do DOCX não está bem formado.')
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
}

type ResolvedDocxImage = { image: DocImage; path: string }

function dimensionsFromRaster(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    if (offset + 2 > bytes.length) return null
    const segmentLength = bytes[offset] * 256 + bytes[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return null
      return { height: bytes[offset + 3] * 256 + bytes[offset + 4], width: bytes[offset + 5] * 256 + bytes[offset + 6] }
    }
    offset += segmentLength
  }
  return null
}

function mimeFromImagePath(path: string): 'image/png' | 'image/jpeg' | null {
  const extension = path.split('.').at(-1)?.toLowerCase()
  return extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null
}

function safeDocxImageTarget(target: string): string | null {
  // Relationship targets are relative to word/document.xml. Only simple in-package
  // media paths are accepted; URL schemes, traversal, escaping, and encoded paths
  // are intentionally not resolved.
  if (!target || target.includes('%') || target.includes('\\') || target.includes('?') || target.includes('#') || target.includes(':') || target.startsWith('/')) return null
  const parts = target.split('/')
  if (parts.length !== 2 || parts[0] !== 'media' || !/^[A-Za-z0-9_.-]{1,120}$/.test(parts[1]) || parts[1] === '.' || parts[1] === '..') return null
  return `word/${parts[0]}/${parts[1]}`
}

async function readDocumentImageRelationships(zip: JSZip): Promise<{ images: Map<string, ResolvedDocxImage>; external: Set<string> }> {
  const images = new Map<string, ResolvedDocxImage>()
  const external = new Set<string>()
  const relsFile = zip.file('word/_rels/document.xml.rels')
  if (!relsFile) return { images, external }
  const relsXml = await relsFile.async('string')
  if (new TextEncoder().encode(relsXml).byteLength > MAX_DOCUMENT_RELS_XML_BYTES || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(relsXml)) throw new Error('As relações de mídia do DOCX são inválidas ou excedem o limite suportado.')
  assertWellFormedXml(relsXml)
  if (!/<Relationships\b/.test(relsXml)) throw new Error('O DOCX contém uma lista de relações inválida.')
  const cachedByPath = new Map<string, ResolvedDocxImage>()
  let totalImageBytes = 0
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0]
    const type = attr(tag, 'Type') ?? ''
    if (!type.endsWith('/image')) continue
    const id = attr(tag, 'Id')
    const target = attr(tag, 'Target')
    if (!id || !/^[A-Za-z_][\w.-]{0,79}$/.test(id)) continue
    if ((attr(tag, 'TargetMode') ?? 'Internal').toLowerCase() === 'external') { external.add(id); continue }
    if (!target) continue
    const path = safeDocxImageTarget(target)
    if (!path) continue
    let resolved = cachedByPath.get(path)
    if (!resolved) {
      const mime = mimeFromImagePath(path)
      const file = zip.file(path)
      if (!mime || !file) continue
      const bytes = await file.async('uint8array')
      if (!bytes.length || bytes.length > MAX_DOC_IMAGE_BYTES) throw new Error('Uma imagem embutida no DOCX excede 5 MB.')
      const dimensions = dimensionsFromRaster(bytes, mime)
      if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > MAX_DOC_IMAGE_DIMENSION || dimensions.height > MAX_DOC_IMAGE_DIMENSION || dimensions.width * dimensions.height > MAX_DOC_IMAGE_PIXELS) {
        throw new Error('Uma imagem embutida no DOCX não é PNG/JPEG válido ou excede os limites de dimensão.')
      }
      totalImageBytes += bytes.byteLength
      if (totalImageBytes > MAX_DOC_IMAGE_TOTAL_BYTES) throw new Error('As imagens embutidas no DOCX excedem 8 MB no total.')
      const base64 = await file.async('base64')
      resolved = { path, image: { src: `data:${mime};base64,${base64}`, alt: '', width: dimensions.width, height: dimensions.height } }
      cachedByPath.set(path, resolved)
    }
    images.set(id, resolved)
  }
  return { images, external }
}

function drawingImageBlock(drawingXml: string, nextId: () => string, relationships: Awaited<ReturnType<typeof readDocumentImageRelationships>>): DocBlock {
  const blip = drawingXml.match(/<a:blip\b[^>]*\/?>/)?.[0]
  if (!blip) throw new Error('Formas, gráficos e desenhos vetoriais DOCX ainda não são importados; mantenha apenas imagens PNG/JPEG incorporadas.')
  const relationId = attr(blip, 'r:embed')
  if (!relationId) {
    const linkedId = attr(blip, 'r:link')
    if (linkedId) throw new Error('Imagens vinculadas não são importadas; incorpore a imagem no DOCX e tente novamente.')
    throw new Error('O desenho DOCX não tem uma relação interna de imagem incorporada.')
  }
  const resolved = relationships.images.get(relationId)
  if (!resolved) {
    if (relationships.external.has(relationId)) throw new Error('Imagens externas vinculadas não são importadas; incorpore a imagem no DOCX e tente novamente.')
    throw new Error('Uma imagem do DOCX aponta para uma mídia interna ausente ou não suportada.')
  }
  const extent = drawingXml.match(/<wp:extent\b[^>]*\/?>/)?.[0]
  const cx = Number(attr(extent ?? '', 'cx'))
  const cy = Number(attr(extent ?? '', 'cy'))
  const docPr = drawingXml.match(/<wp:docPr\b[^>]*\/?>/)?.[0] ?? drawingXml.match(/<pic:cNvPr\b[^>]*\/?>/)?.[0] ?? ''
  const alt = decodeXml(attr(docPr, 'descr') ?? attr(docPr, 'title') ?? '').slice(0, 2_000)
  const image: DocImage = {
    ...resolved.image,
    alt,
    width: Number.isFinite(cx) && cx > 0 ? cx / 9_525 : resolved.image.width,
    height: Number.isFinite(cy) && cy > 0 ? cy / 9_525 : resolved.image.height,
  }
  if (!isSafeDocImage(image)) throw new Error('Uma imagem do DOCX tem dimensões exibidas inválidas ou grandes demais.')
  return { id: nextId(), type: 'image', text: '', image }
}

function extractRunText(xml: string): string {
  let text = ''
  for (const token of xml.matchAll(/<w:(t|tab|br|cr)\b([^>]*)\/?\s*>(?:([\s\S]*?)<\/w:\1\s*>)?/g)) {
    const kind = token[1]
    if (kind === 't') text += decodeXml(token[3] ?? '')
    else if (kind === 'tab') text += '\t'
    else text += '\n'
  }
  return text
}

function enabledRunMark(properties: string, name: 'b' | 'i' | 'u' | 'strike'): boolean {
  const tag = properties.match(new RegExp(`<w:${name}\\b[^>]*\\/?\\s*>`))
  if (!tag) return false
  const value = attr(tag[0], 'w:val')?.toLowerCase()
  return value !== '0' && value !== 'false' && !(name === 'u' && value === 'none')
}

function runMarkProperties(properties: string): Pick<DocInlineMark, 'bold' | 'italic' | 'underline' | 'strike'> {
  const bold = enabledRunMark(properties, 'b')
  const italic = enabledRunMark(properties, 'i')
  const underline = enabledRunMark(properties, 'u')
  const strike = enabledRunMark(properties, 'strike')
  return { ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}), ...(strike ? { strike: true } : {}) }
}

function parseParagraph(xml: string): ParagraphResult {
  const properties = xml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/)?.[1] ?? ''
  const styleTag = properties.match(/<w:pStyle\b[^>]*\/?\s*>/)
  const style = styleTag ? attr(styleTag[0], 'w:val')?.toLowerCase() ?? '' : ''
  let type: DocBlock['type'] = 'paragraph'
  if (/heading\s*1|^title$/.test(style)) type = 'heading'
  else if (/heading\s*[2-9]|^subtitle$/.test(style)) type = 'subheading'
  else if (/quote/.test(style)) type = 'quote'
  else if (/<w:numPr\b/.test(properties)) type = 'bullet'

  const runs = [...xml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)]
  let text = ''
  const marks: DocInlineMark[] = []
  for (const run of runs) {
    const content = run[1]
    const runProperties = content.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/)?.[1] ?? ''
    const runText = extractRunText(content)
    if (!runText) continue
    const start = text.length
    text += runText
    const runMarks = runMarkProperties(runProperties)
    if (Object.keys(runMarks).length) marks.push({ start, end: text.length, ...runMarks })
  }
  return { text, marks, type }
}

function paragraphBlocks(xml: string, nextId: () => string, relationships: Awaited<ReturnType<typeof readDocumentImageRelationships>>): DocBlock[] {
  // Empty paragraphs carry intentional vertical spacing and are representable as empty Docs blocks.
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
  const output: DocBlock[] = []
  for (const paragraph of paragraphs) {
    const parsed = parseParagraph(paragraph[0])
    if (/<w:pict\b/.test(paragraph[0])) throw new Error('Imagens VML legadas do DOCX ainda não são importadas; salve-as como PNG/JPEG incorporadas.')
    if (!/<w:drawing\b/.test(paragraph[0])) {
      output.push({ id: nextId(), type: parsed.type, text: parsed.text, ...(parsed.marks.length ? { marks: parsed.marks } : {}) })
      continue
    }
    const paragraphOutputStart = output.length
    for (const run of paragraph[0].matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const content = run[1]
      const runProperties = content.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/)?.[1] ?? ''
      const runMarks = runMarkProperties(runProperties)
      let cursor = 0
      const drawings = [...content.matchAll(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g)]
      const appendText = (segment: string) => {
        const text = extractRunText(segment)
        if (!text) return
        output.push({ id: nextId(), type: parsed.type, text, ...(Object.keys(runMarks).length ? { marks: [{ start: 0, end: text.length, ...runMarks }] } : {}) })
      }
      for (const drawing of drawings) {
        const index = drawing.index ?? cursor
        appendText(content.slice(cursor, index))
        const image = drawingImageBlock(drawing[0], nextId, relationships)
        output.push(image)
        cursor = index + drawing[0].length
      }
      appendText(content.slice(cursor))
    }
    if (output.length === paragraphOutputStart) output.push({ id: nextId(), type: parsed.type, text: parsed.text, ...(parsed.marks.length ? { marks: parsed.marks } : {}) })
  }
  return output
}

function tableBlock(xml: string, nextId: () => string, relationships: Awaited<ReturnType<typeof readDocumentImageRelationships>>): DocBlock {
  const merges: NonNullable<DocBlock['merges']> = []
  const cellImages: NonNullable<DocBlock['cellImages']> = {}
  let tableCellCount = 0
  let activeVerticalMerges = new Map<number, NonNullable<DocBlock['merges']>[number]>()
  const rows = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((rowMatch, rowIndex) => {
    const row: string[] = []
    const nextVerticalMerges = new Map<number, NonNullable<DocBlock['merges']>[number]>()
    let column = 0
    for (const cell of rowMatch[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      const properties = cell[1].match(/<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/)?.[1] ?? ''
      const gridSpanTag = properties.match(/<w:gridSpan\b[^>]*\/?\s*>/)?.[0]
      const rawSpan = Number(attr(gridSpanTag ?? '', 'w:val') ?? '1')
      if (!Number.isInteger(rawSpan) || rawSpan < 1 || rawSpan > 1000) throw new Error('Invalid DOCX horizontal merge.')
      const verticalTag = properties.match(/<w:vMerge\b[^>]*\/?\s*>/)?.[0]
      const verticalValue = verticalTag ? attr(verticalTag, 'w:val') ?? 'continue' : null
      if (verticalValue !== null && verticalValue !== 'continue' && verticalValue !== 'restart') throw new Error('Invalid DOCX vertical merge.')
      tableCellCount += rawSpan
      if (tableCellCount > MAX_DOCX_TABLE_CELLS) throw new Error('The DOCX table exceeds 100,000 cells.')
      let value = ''
      if (verticalValue === 'continue') {
        const merge = activeVerticalMerges.get(column)
        if (!merge || merge.colSpan !== rawSpan) throw new Error('DOCX vertical merge continuation has no matching origin cell.')
        merge.rowSpan = (merge.rowSpan ?? 1) + 1
        nextVerticalMerges.set(column, merge)
      } else {
        const blocks = paragraphBlocks(cell[1], nextId, relationships)
        const images = blocks.filter(block => block.type === 'image').flatMap(block => block.image ? [block.image] : [])
        if (images.length) cellImages[rowIndex + ':' + column] = images
        value = blocks.filter(block => block.type !== 'image').map(block => block.text).join('\n')
        if (verticalValue === 'restart') {
          const merge = { row: rowIndex, column, colSpan: rawSpan, rowSpan: 1 }
          merges.push(merge)
          nextVerticalMerges.set(column, merge)
        } else if (rawSpan > 1) {
          merges.push({ row: rowIndex, column, colSpan: rawSpan })
        }
      }
      row.push(value)
      for (let covered = 1; covered < rawSpan; covered += 1) row.push('')
      column += rawSpan
      if (column > 1000) throw new Error('The DOCX table exceeds the 1,000-column limit.')
    }
    activeVerticalMerges = nextVerticalMerges
    return row
  })
  const width = Math.max(0, ...rows.map(row => row.length))
  if (!rows.length || !width) throw new Error('The DOCX contains an empty or invalid table.')
  const validMerges = merges.filter(merge => merge.colSpan > 1 || (merge.rowSpan ?? 1) > 1)
  return { id: nextId(), type: 'table', text: '', cells: rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? '')), ...(Object.keys(cellImages).length ? { cellImages } : {}), ...(validMerges.length ? { merges: validMerges } : {}) }
}
function validateImportedImageUse(blocks: readonly DocBlock[]): void {
  let count = 0
  let totalBytes = 0
  const images = blocks.flatMap(block => [
    ...(block.type === 'image' && block.image ? [block.image] : []),
    ...Object.values(block.cellImages ?? {}).flat(),
  ])
  for (const image of images) {
    if (!isSafeDocImage(image)) throw new Error('The DOCX contains an invalid or oversized image.')
    count += 1
    totalBytes += decodeDocImageDataUrl(image).bytes.byteLength
    if (count > 100) throw new Error('The DOCX exceeds 100 embedded images.')
    if (totalBytes > MAX_DOC_IMAGE_TOTAL_BYTES) throw new Error('The DOCX embedded images exceed 8 MB in total.')
  }
}

export async function parseDocx(source: ArrayBuffer, filename = 'Documento.docx'): Promise<ImportedDocx> {
  if (source.byteLength === 0) throw new Error('O arquivo DOCX está vazio.')
  if (source.byteLength > MAX_DOCX_IMPORT_BYTES) throw new Error('O DOCX deve ter no máximo 10 MB.')
  const bytes = new Uint8Array(source)
  readZipDirectory(bytes)
  let zip: JSZip
  try { zip = await JSZip.loadAsync(source, { checkCRC32: true }) } catch { throw new Error('Não foi possível abrir este DOCX. Verifique se o arquivo não está danificado.') }
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('O arquivo não contém o documento principal do Word.')
  const contentTypesFile = zip.file('[Content_Types].xml')
  if (!contentTypesFile) throw new Error('O arquivo não possui os tipos de conteúdo obrigatórios do DOCX.')
  const contentTypes = await contentTypesFile.async('string')
  if (!/<Override\b(?=[^>]*\bPartName\s*=\s*["']\/word\/document\.xml["'])(?=[^>]*\bContentType\s*=\s*["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["'])[^>]*>/i.test(contentTypes)) {
    throw new Error('O arquivo não está identificado como um documento DOCX válido.')
  }
  const documentXml = await documentFile.async('string')
  if (new TextEncoder().encode(documentXml).byteLength > MAX_DOCUMENT_XML_BYTES) throw new Error('O conteúdo principal do DOCX excede o limite de 12 MB.')
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(documentXml)) throw new Error('O XML principal do DOCX é inválido ou contém declarações não permitidas.')
  assertWellFormedXml(documentXml)
  if (!/<w:document\b/.test(documentXml) || !/<w:body\b/.test(documentXml)) throw new Error('O XML principal do DOCX não contém um documento Word válido.')
  const body = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)?.[1]
  if (!body) throw new Error('O DOCX não contém um corpo de documento válido.')
  const relationships = await readDocumentImageRelationships(zip)
  let id = 0
  const nextId = () => `docx-${++id}`
  const blocks: DocBlock[] = []
  const topLevelPattern = /<w:(p|tbl)\b[^>]*>[\s\S]*?<\/w:\1>/g
  for (const match of body.matchAll(topLevelPattern)) {
    if (match[1] === 'p') blocks.push(...paragraphBlocks(match[0], nextId, relationships))
    else blocks.push(tableBlock(match[0], nextId, relationships))
  }
  validateImportedImageUse(blocks)
  if (!blocks.length) throw new Error('O DOCX não contém parágrafos ou tabelas com conteúdo.')
  return { title: filename.replace(/\.docx$/i, '').trim().slice(0, 100) || 'Documento importado', blocks }
}
