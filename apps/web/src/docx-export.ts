import JSZip from 'jszip'
import type { DocBlock, DocBlockType, DocImage, DocInlineMark } from './model'
import { MAX_DOC_IMAGE_TOTAL_BYTES, assertSafeDocImage, decodeDocImageDataUrl } from './doc-format'

export const MAX_DOCX_EXPORT_BLOCKS = 10_000
export const MAX_DOCX_EXPORT_TEXT_CHARACTERS = 2_000_000
export const MAX_DOCX_EXPORT_BYTES = 10 * 1024 * 1024
export const MAX_DOCX_EXPORT_PAGES = 1_000
const MAX_DOCX_TABLE_CELLS = 100_000

const DOC_BLOCK_TYPES = new Set<DocBlockType>(['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'table', 'image'])

function xml(value: string): string {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    if ((point >= 0 && point <= 8) || point === 11 || point === 12 || (point >= 14 && point <= 31) || (point >= 0xd800 && point <= 0xdfff) || point === 0xfffe || point === 0xffff) {
      throw new Error('O conteúdo contém caracteres que não podem ser gravados em XML.')
    }
  }
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function validateBlocks(blocks: readonly DocBlock[]): number {
  if (!Array.isArray(blocks)) throw new Error('O conteúdo do documento está inválido.')
  if (blocks.length > MAX_DOCX_EXPORT_BLOCKS) throw new Error(`O DOCX aceita até ${MAX_DOCX_EXPORT_BLOCKS} blocos.`)
  let characters = 0
  let tableCells = 0
  let imageBytes = 0
  let imageCount = 0
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !DOC_BLOCK_TYPES.has(block.type) || typeof block.text !== 'string') throw new Error('O documento contém um bloco inválido ou não suportado.')
    characters += block.text.length
    if (block.type === 'image') {
      assertSafeDocImage(block.image)
      if (block.text !== '') throw new Error('Um bloco de imagem do documento deve ter o campo de texto vazio.')
      const { mime, bytes } = decodeDocImageDataUrl(block.image)
      const validPng = mime === 'image/png' && bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
      const validJpeg = mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
      if (!validPng && !validJpeg) throw new Error('Somente imagens PNG e JPEG válidas podem ser exportadas para DOCX.')
      imageBytes += bytes.byteLength
      imageCount += 1
      characters += block.image.alt.length
      if (imageBytes > MAX_DOC_IMAGE_TOTAL_BYTES || imageCount > 100) throw new Error('As imagens do DOCX excedem o limite agregado suportado.')
      continue
    }
    if (block.type === 'table') {
      if (!Array.isArray(block.cells) || block.cells.length === 0 || block.cells.some((row: unknown) => !Array.isArray(row))) throw new Error('A tabela contém linhas inválidas ou está vazia.')
      const cells = block.cells as string[][]
      const columns = Math.max(0, ...cells.map((row: string[]) => row.length))
      if (!columns || cells.some((row: string[]) => row.some((cell: unknown) => typeof cell !== 'string'))) throw new Error('A tabela contém células inválidas.')
      if (block.cellImages !== undefined) {
        if (!block.cellImages || typeof block.cellImages !== 'object' || Array.isArray(block.cellImages)) throw new Error('Invalid table cell images.')
        for (const [coordinate, images] of Object.entries(block.cellImages)) {
          const match = /^(\d+):(\d+)$/.exec(coordinate)
          const row = match ? Number(match[1]) : -1
          const column = match ? Number(match[2]) : -1
          if (!match || cells[row]?.[column] === undefined || !Array.isArray(images) || images.length === 0) throw new Error('Invalid table cell images.')
          for (const image of images) {
            assertSafeDocImage(image)
            const { mime, bytes } = decodeDocImageDataUrl(image)
            const validPng = mime === 'image/png' && bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
            const validJpeg = mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
            if (!validPng && !validJpeg) throw new Error('Only valid embedded PNG/JPEG images can be exported.')
            imageBytes += bytes.byteLength
            imageCount += 1
            characters += image.alt.length
            if (imageBytes > MAX_DOC_IMAGE_TOTAL_BYTES || imageCount > 100) throw new Error('Embedded DOCX images exceed the aggregate supported limit.')
          }
        }
      }
      const occupied = new Set<string>()
      for (const merge of block.merges ?? []) {
        const rowSpan = merge?.rowSpan ?? 1
        if (!merge || !Number.isInteger(merge.row) || !Number.isInteger(merge.column) || !Number.isInteger(merge.colSpan) || !Number.isInteger(rowSpan)
          || merge.row < 0 || merge.row + rowSpan > cells.length || merge.column < 0 || merge.colSpan < 1 || merge.colSpan + rowSpan < 3 || merge.column + merge.colSpan > columns
          || merge.column + merge.colSpan > cells[merge.row].length) throw new Error('Invalid table cell merge.')
        for (let row = merge.row; row < merge.row + rowSpan; row += 1) for (let column = merge.column; column < merge.column + merge.colSpan; column += 1) {
          const key = `${row}:${column}`
          if (occupied.has(key)) throw new Error('Table cell merges overlap.')
          occupied.add(key)
        }
      }
      tableCells += cells.length * columns
      for (const row of cells) for (const cell of row) characters += cell.length
    }
    if (block.marks !== undefined) {
      if (!Array.isArray(block.marks)) throw new Error('As marcações de texto do documento estão inválidas.')
      for (const mark of block.marks) {
        if (!mark || !Number.isInteger(mark.start) || !Number.isInteger(mark.end) || mark.start < 0 || mark.end > block.text.length || mark.end <= mark.start || (mark.bold !== undefined && typeof mark.bold !== 'boolean') || (mark.italic !== undefined && typeof mark.italic !== 'boolean') || (mark.underline !== undefined && typeof mark.underline !== 'boolean') || (mark.strike !== undefined && typeof mark.strike !== 'boolean') || !(mark.bold || mark.italic || mark.underline || mark.strike)) {
          throw new Error('O documento contém uma marcação em negrito/itálico inválida.')
        }
      }
    }
  }
  if (tableCells > MAX_DOCX_TABLE_CELLS) throw new Error('As tabelas do DOCX excedem 100.000 células.')
  if (characters > MAX_DOCX_EXPORT_TEXT_CHARACTERS) throw new Error('O conteúdo do DOCX excede 2 milhões de caracteres.')
  return characters
}

function textRuns(text: string, marks: readonly DocInlineMark[] = []): string {
  const boundaries = [...new Set([0, text.length, ...marks.flatMap(mark => [mark.start, mark.end])])].sort((left, right) => left - right)
  let output = ''
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const active = marks.filter(mark => mark.start <= start && mark.end >= end)
    const bold = active.some(mark => mark.bold)
    const italic = active.some(mark => mark.italic)
    const underline = active.some(mark => mark.underline)
    const strike = active.some(mark => mark.strike)
    const content = text.slice(start, end).replace(/\r\n?/g, '\n')
    const chunks = content.split(/([\n\t])/).filter(Boolean).map(chunk => chunk === '\n' ? '<w:br/>' : chunk === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${xml(chunk)}</w:t>`).join('')
    if (!chunks) continue
    output += `<w:r>${bold || italic || underline || strike ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}${strike ? '<w:strike/>' : ''}</w:rPr>` : ''}${chunks}</w:r>`
  }
  return output
}

function paragraphXml(type: Exclude<DocBlockType, 'table'>, text: string, marks: readonly DocInlineMark[] = []): string {
  const style = type === 'heading' ? '<w:pStyle w:val="Heading1"/>' : type === 'subheading' ? '<w:pStyle w:val="Heading2"/>' : type === 'quote' ? '<w:pStyle w:val="Quote"/>' : ''
  const numbering = type === 'bullet' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''
  const pPr = style || numbering ? `<w:pPr>${style}${numbering}</w:pPr>` : ''
  return `<w:p>${pPr}${textRuns(text, marks)}</w:p>`
}

function tableXml(block: DocBlock, byImageKey: Map<string, DocxImagePart>): string {
  const cells = block.cells as string[][]
  const columns = Math.max(...cells.map(row => row.length))
  const merges = block.merges ?? []
  const mergeAt = new Map(merges.map(merge => [`${merge.row}:${merge.column}`, merge]))
  const horizontalCovered = new Set<string>()
  const verticalAt = new Map<string, NonNullable<DocBlock['merges']>[number]>()
  for (const merge of merges) {
    const rowSpan = merge.rowSpan ?? 1
    for (let row = merge.row; row < merge.row + rowSpan; row += 1) {
      for (let column = merge.column + 1; column < merge.column + merge.colSpan; column += 1) horizontalCovered.add(`${row}:${column}`)
      if (row > merge.row) verticalAt.set(`${row}:${merge.column}`, merge)
    }
  }
  const rows = cells.map((row, rowIndex) => {
    let output = ''
    for (let column = 0; column < columns; column += 1) {
      if (horizontalCovered.has(`${rowIndex}:${column}`)) continue
      const origin = mergeAt.get(`${rowIndex}:${column}`)
      const verticalContinuation = verticalAt.get(`${rowIndex}:${column}`)
      const merge = origin ?? verticalContinuation
      const span = merge?.colSpan ?? 1
      const restart = origin && (origin.rowSpan ?? 1) > 1 ? '<w:vMerge w:val="restart"/>' : ''
      const continuation = verticalContinuation ? '<w:vMerge/>' : ''
      const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''
      let imageXml = ''
      if (!verticalContinuation) for (let imageColumn = column; imageColumn < column + span; imageColumn += 1) {
        const images = block.cellImages?.[`${rowIndex}:${imageColumn}`] ?? []
        for (const [imageIndex, image] of images.entries()) {
          const part = byImageKey.get(`${block.id}:cell:${rowIndex}:${imageColumn}:${imageIndex}`)
          if (!part) throw new Error('A table image was not prepared for DOCX export.')
          imageXml += imageParagraphXml(image, part)
        }
      }
      const text = verticalContinuation ? '' : row[column] ?? ''
      const cellWidth = 2400 * span
      output += `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${gridSpan}${restart}${continuation}</w:tcPr>${paragraphXml('paragraph', text)}${imageXml}</w:tc>`
    }
    return `<w:tr>${output}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`
}
type DocxImagePart = { key: string; relId: string; target: string; mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; docPrId: number }

function collectDocxImages(pages: readonly DocBlock[][]): { parts: DocxImagePart[]; byImageKey: Map<string, DocxImagePart> } {
  const parts: DocxImagePart[] = []
  const byImageKey = new Map<string, DocxImagePart>()
  let index = 0
  const addImage = (key: string, image: DocImage) => {
    const { mime, bytes } = decodeDocImageDataUrl(image)
    const extension = mime === 'image/png' ? 'png' : 'jpg'
    const part: DocxImagePart = { key, relId: `rId${index + 3}`, target: `media/fuse-image-${index + 1}.${extension}`, mime, bytes, docPrId: index + 1 }
    parts.push(part)
    byImageKey.set(key, part)
    index += 1
  }
  for (const block of pages.flat()) {
    if (block.type === 'image') addImage(block.id, block.image as DocImage)
    for (const [coordinate, images] of Object.entries(block.cellImages ?? {})) {
      for (const [imageIndex, image] of images.entries()) addImage(`${block.id}:cell:${coordinate}:${imageIndex}`, image)
    }
  }
  return { parts, byImageKey }
}

function imageParagraphXml(image: DocImage, part: DocxImagePart): string {
  const naturalCx = Math.max(1, Math.round(image.width * 9_525))
  const naturalCy = Math.max(1, Math.round(image.height * 9_525))
  const scale = Math.min(1, 5_943_600 / naturalCx, 8_229_600 / naturalCy)
  const cx = Math.max(1, Math.round(naturalCx * scale))
  const cy = Math.max(1, Math.round(naturalCy * scale))
  const alt = xml(image.alt)
  const name = `Imagem ${part.docPrId}`
  return `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${part.docPrId}" name="${name}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${part.docPrId}" name="${name}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${part.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function documentXml(pages: readonly DocBlock[][], byImageKey: Map<string, DocxImagePart>): string {
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  const body = pages.map(page => page.map(block => {
    if (block.type === 'table') return tableXml(block, byImageKey)
    if (block.type === 'image') {
      const part = byImageKey.get(block.id)
      if (!part) throw new Error('Uma imagem do documento não foi preparada para exportação.')
      return imageParagraphXml(block.image as DocImage, part)
    }
    return paragraphXml(block.type, block.text, block.marks ?? [])
  }).join('')).join(pageBreak)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`

function documentRelsXml(images: readonly DocxImagePart[]): string {
  const imageRelationships = images.map(image => `<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xml(image.target)}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${imageRelationships}</Relationships>`
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style></w:styles>`

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`

async function createDocxPackage(pages: readonly DocBlock[][], title: string): Promise<Uint8Array> {
  if (typeof title !== 'string') throw new Error('O título do DOCX deve ser texto.')
  if (pages.length > MAX_DOCX_EXPORT_PAGES) throw new Error(`O DOCX aceita até ${MAX_DOCX_EXPORT_PAGES} páginas.`)
  let blockCount = 0
  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error('As páginas do DOCX estão inválidas.')
    blockCount += page.length
    if (blockCount > MAX_DOCX_EXPORT_BLOCKS) throw new Error(`O DOCX aceita até ${MAX_DOCX_EXPORT_BLOCKS} blocos.`)
  }
  const blocks = pages.flat()
  validateBlocks(blocks)
  const { parts: imageParts, byImageKey } = collectDocxImages(pages)
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelsXml)
  zip.file('word/document.xml', documentXml(pages, byImageKey))
  zip.file('word/_rels/document.xml.rels', documentRelsXml(imageParts))
  for (const image of imageParts) zip.file(`word/${image.target}`, image.bytes)
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/numbering.xml', numberingXml)
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title.slice(0, 200))}</dc:title></cp:coreProperties>`)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  if (bytes.byteLength > MAX_DOCX_EXPORT_BYTES) throw new Error('O DOCX exportado excede o limite de 10 MB.')
  return bytes
}

/** Build an editable DOCX package from a single editor page, preserving the legacy API. */
export async function createDocxBytes(blocks: readonly DocBlock[], title = 'Documento'): Promise<Uint8Array> {
  return createDocxPackage([Array.from(blocks)], title)
}

/** Build an editable DOCX package while retaining explicit page boundaries from the editor. */
export async function createDocxPagesBytes(pages: readonly DocBlock[][], title = 'Documento'): Promise<Uint8Array> {
  if (!Array.isArray(pages) || pages.length > MAX_DOCX_EXPORT_PAGES) throw new Error(`O DOCX aceita até ${MAX_DOCX_EXPORT_PAGES} páginas.`)
  return createDocxPackage(pages, title)
}
