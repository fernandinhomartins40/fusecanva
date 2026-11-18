import JSZip from 'jszip'
import type { DesignDocument, DesignElement, DesignPage } from './model'
import type { VectorShapeKind } from './vector-shapes'

export const MAX_PPTX_IMPORT_BYTES = 50 * 1024 * 1024
export const MAX_PPTX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_PPTX_ENTRIES = 2000
const MAX_PPTX_XML_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_IMAGE_PIXELS = 16_000_000
const MAX_TOTAL_DECODED_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 12_000
const EMU_PER_INCH = 914400
const CSS_PIXELS_PER_INCH = 96

type Relationship = { id: string; type: string; target: string }

function fail(message: string): never { throw new Error(message) }

function inspectZipDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minEocd = Math.max(0, bytes.byteLength - 65_557)
  let eocd = -1
  for (let offset = bytes.byteLength - 22; offset >= minEocd; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0 || eocd + 22 > bytes.byteLength) fail('O arquivo não é um PPTX ou ZIP válido.')
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskEntries = view.getUint16(eocd + 8, true)
  const entryCount = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  const commentLength = view.getUint16(eocd + 20, true)
  if (disk || centralDisk || diskEntries !== entryCount || entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff || eocd + 22 + commentLength > bytes.byteLength) {
    fail('O PPTX usa uma estrutura ZIP inválida ou ainda não suportada.')
  }
  if (!entryCount || entryCount > MAX_PPTX_ENTRIES || centralOffset + centralSize > eocd) fail('O PPTX contém uma estrutura ZIP inválida ou excessivamente grande.')
  let offset = centralOffset
  let expanded = 0
  const names = new Set<string>()
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) fail('O PPTX contém uma tabela ZIP inválida.')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentSize = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd + extraLength + commentSize > eocd) fail('O PPTX contém uma entrada ZIP inválida.')
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameEnd))
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.')) fail('O PPTX contém um caminho ZIP inválido.')
    if (names.has(name)) fail('O PPTX contém nomes ZIP duplicados.')
    names.add(name)
    if (flags & 1 || ![0, 8].includes(method) || uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) fail('O PPTX usa criptografia ou compressão ZIP não suportada.')
    expanded += uncompressedSize
    if (expanded > MAX_PPTX_UNCOMPRESSED_BYTES) fail('O conteúdo descompactado do PPTX excede 100 MB.')
    const lower = name.toLowerCase()
    if (/\.(?:bin|vba|vbs|js|exe|dll|ocx|hta)$/i.test(lower) || /(?:^|\/)(?:embeddings|activex|ctrlprops|customui|macrosheets|vbaproject)(?:\/|\.|$)/i.test(lower)) fail('O PPTX contém conteúdo ativo ou incorporado que não é aceito.')
    offset = nameEnd + extraLength + commentSize
  }
  if (offset !== centralOffset + centralSize) fail('O PPTX contém uma tabela ZIP inconsistente.')
}

function assertWellFormedXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) fail('O PPTX contém XML com declarações não permitidas.')
  const tokenPattern = /<\?(?:[^?]|\?(?!>))*\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>/g
  const stack: string[] = []
  let cursor = 0
  let roots = 0
  for (const match of xml.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    const text = xml.slice(cursor, index)
    if (text.includes('<') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(text)) fail('O PPTX contém XML malformado.')
    const token = match[0]
    cursor = index + token.length
    if (token.startsWith('<?') || token.startsWith('<!--') || token.startsWith('<![CDATA[')) continue
    if (token.startsWith('</')) {
      const closing = token.match(/^<\/([\w:.-]+)\s*>$/)?.[1]
      if (!closing || stack.pop() !== closing) fail('O PPTX contém XML malformado.')
      continue
    }
    const selfClosing = /\/\s*>$/.test(token)
    const open = token.slice(1, token.lastIndexOf('>')).replace(/\/\s*$/, '').trimEnd().match(/^([\w:.-]+)(?:\s[\s\S]*)?$/)?.[1]
    if (!open) fail('O PPTX contém XML malformado.')
    if (!stack.length) roots += 1
    if (!selfClosing) stack.push(open)
  }
  const tail = xml.slice(cursor)
  if (tail.includes('<') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(tail) || stack.length || roots !== 1) fail('O PPTX contém XML malformado.')
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const cp = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD'
      return String.fromCodePoint(cp)
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()] ?? entity
  })
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
}

function tagContent(xml: string, tagName: string): string | null {
  return xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`))?.[1] ?? null
}

function emuToPx(value: string | undefined, label: string): number {
  const emu = Number(value)
  const px = emu / EMU_PER_INCH * CSS_PIXELS_PER_INCH
  if (!Number.isFinite(px) || px <= 0 || px > 20_000) fail(`O PPTX contém ${label} fora dos limites aceitos.`)
  return px
}

function resolvePart(sourcePart: string, target: string): string {
  if (!target || target.startsWith('//') || /[?#%\\]/.test(target)) fail('O PPTX contém um destino de relacionamento inválido.')
  const raw = target.startsWith('/') ? target.slice(1) : `${sourcePart.split('/').slice(0, -1).join('/')}/${target}`
  const parts: string[] = []
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') { if (!parts.length) fail('O PPTX contém um relacionamento fora do pacote.'); parts.pop() }
    else parts.push(segment)
  }
  return parts.join('/')
}

function parseRelationships(xml: string, sourcePart: string): Relationship[] {
  if (!/^\s*<Relationships\b/.test(xml)) fail('O PPTX contém um arquivo de relacionamentos inválido.')
  const result: Relationship[] = []
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const tag = match[0]
    if (attr(tag, 'TargetMode')?.toLowerCase() === 'external') fail('O PPTX contém uma referência externa, que não é aceita.')
    const id = attr(tag, 'Id'), type = attr(tag, 'Type'), target = attr(tag, 'Target')
    if (!id || !type || !target || result.some(item => item.id === id)) fail('O PPTX contém um relacionamento incompleto ou duplicado.')
    result.push({ id, type, target: resolvePart(sourcePart, target) })
  }
  return result
}

function parseSolidColor(xml: string, defaultColor: string | null): string | null {
  if (/<a:(?:schemeClr|srgbClr|sysClr|prstClr)\b/i.test(xml) && !/<a:srgbClr\b/i.test(xml)) fail('O PPTX usa uma cor de tema que ainda não é preservada.')
  const fill = xml.match(/<a:solidFill\b[^>]*>([\s\S]*?)<\/a:solidFill>/i)?.[1]
  if (!fill) return /<a:noFill\b/i.test(xml) ? null : defaultColor
  const colorTag = fill.match(/<a:srgbClr\b[^>]*\/?\s*>/i)?.[0]
  const color = colorTag && attr(colorTag, 'val')
  if (!color || !/^[\da-f]{6}$/i.test(color) || /<a:(?:alpha|alphaOff|alphaMod|tint|shade|lum|sat|hue|comp|inv|gray|gamma|invGamma)\b/i.test(fill)) fail('O PPTX usa preenchimento que não pode ser preservado com segurança.')
  return `#${color.toLowerCase()}`
}

type TextStyle = { fontSize: number; fontFamily: string; color: string; bold: boolean }
function runStyle(properties: string): TextStyle {
  const sizeTag = properties.match(/<a:(?:rPr|defRPr|endParaRPr)\b[^>]*>/)?.[0]
  const size = sizeTag ? attr(sizeTag, 'sz') : undefined
  const fontTag = properties.match(/<a:latin\b[^>]*\/?\s*>/)?.[0]
  const family = fontTag ? attr(fontTag, 'typeface') : undefined
  const color = parseSolidColor(properties, null)
  if (/<a:(?:ea|cs)\b/i.test(properties) || /<a:(?:highlight|effectLst|effectDag|uFill|ln)\b/i.test(properties)) fail('O PPTX contém estilo de texto ainda não preservado.')
  if (!size || !family || !color) fail('O PPTX depende de estilo de texto herdado que não pode ser preservado com segurança.')
  return {
    fontSize: Number(size) / 100 * 96 / 72,
    fontFamily: family,
    color,
    bold: Boolean(sizeTag && /\bb\s*=\s*["']1["']/i.test(sizeTag)),
  }
}

function parseTextBody(body: string): { text: string; style: TextStyle } | null {
  if (/<a:(?:fld|br|buChar|buAutoNum|buBlip)\b/i.test(body)) fail('O PPTX contém campos ou listas de texto não preservados.')
  if (/<a:(?:bodyPr|pPr)\b(?=[^>]*\s+[\w:-]+\s*=)[^>]*>/i.test(body)) fail('O PPTX contém alinhamento ou espaçamento de texto não preservado.')
  const paragraphXml = [...body.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(match => match[1])
  const lines: string[] = []
  let commonStyle: TextStyle | null = null
  for (const paragraph of paragraphXml) {
    const runs = [...paragraph.matchAll(/<a:(r|defRPr|endParaRPr)\b[^>]*>([\s\S]*?)<\/a:\1\s*>/g)]
    const pieces: string[] = []
    for (const run of runs) {
      const kind = run[1]
      if (kind !== 'r') continue
      const text = run[2].match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/)?.[1]
      const props = run[2].match(/<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/)?.[0] ?? ''
      const style = runStyle(props)
      if (commonStyle && (style.fontSize !== commonStyle.fontSize || style.fontFamily !== commonStyle.fontFamily || style.color !== commonStyle.color || style.bold !== commonStyle.bold)) fail('O PPTX contém formatação mista que não pode ser preservada fielmente.')
      commonStyle ??= style
      if (text !== undefined) pieces.push(decodeXml(text))
    }
    const paragraphText = pieces.join('')
    if (paragraphText) lines.push(paragraphText)
  }
  if (!lines.length) return null
  return { text: lines.join('\n'), style: commonStyle ?? runStyle('') }
}

function parseShape(shapeXml: string, nextId: () => string, scale: number): DesignElement {
  if (/<p:(?:graphicFrame|pic|grpSp|cxnSp|contentPart)\b|<a:(?:blip|prstTxWarp|custGeom|effectLst|effectDag)\b/i.test(shapeXml)) fail('O slide contém imagem, grupo, gráfico ou geometria não preservada.')
  const nv = shapeXml.match(/<p:cNvPr\b[^>]*\/?\s*>/)?.[0]
  const name = nv ? attr(nv, 'name')?.trim() : ''
  const shapeProperties = shapeXml.match(/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/)?.[1]
  const transform = shapeProperties?.match(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/)?.[0]
  const off = transform?.match(/<a:off\b[^>]*\/?\s*>/)?.[0]
  const ext = transform?.match(/<a:ext\b[^>]*\/?\s*>/)?.[0]
  if (!shapeProperties || !transform || !off || !ext) fail('O slide contém uma forma sem geometria suportada.')
  if (/<a:ln\b/i.test(shapeProperties)) fail('O slide contém contorno de forma não preservado.')
  if (attr(transform, 'flipH') === '1' || attr(transform, 'flipV') === '1') fail('O slide contém uma forma invertida não preservada.')
  const x = Number(attr(off, 'x')) / EMU_PER_INCH * CSS_PIXELS_PER_INCH * scale
  const y = Number(attr(off, 'y')) / EMU_PER_INCH * CSS_PIXELS_PER_INCH * scale
  const width = emuToPx(attr(ext, 'cx'), 'largura da forma') * scale
  const height = emuToPx(attr(ext, 'cy'), 'altura da forma') * scale
  const rotation = Number(attr(transform, 'rot') ?? 0) / 60_000
  if (![x, y, rotation, width, height].every(Number.isFinite) || Math.abs(x) > 20_000 || Math.abs(y) > 20_000 || Math.abs(rotation) > 360) fail('O slide contém uma transformação fora dos limites aceitos.')
  const shapeName = name || 'Objeto importado'
  const shapeType = shapeProperties.match(/<a:prstGeom\b[^>]*>/)?.[0]
  const preset = shapeType ? attr(shapeType, 'prst') : undefined
  const presetToModel: Record<string, VectorShapeKind> = { rect: 'rect', ellipse: 'ellipse', triangle: 'triangle', star5: 'star' }
  const modelShape = preset ? presetToModel[preset] : undefined
  if (!modelShape) fail('O slide contém uma geometria que não é preservada com segurança.')
  if (/<a:gd\b/i.test(shapeProperties)) fail('O slide contém uma geometria com ajustes personalizados não preservados.')
  const textBody = shapeXml.match(/<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/)?.[1]
  const parsedText = textBody ? parseTextBody(textBody) : null
  const fill = parseSolidColor(shapeProperties, null)
  const style = parsedText?.style ?? { fontSize: 18, fontFamily: 'Arial', color: '#000000', bold: false }
  const id = nextId()
  if (parsedText) {
    if (fill !== null || /<a:ln\b/i.test(shapeProperties)) fail('Caixas de texto com fundo ou contorno não são preservadas.')
    return { id, type: 'text', name: shapeName, x, y, width, height, rotation, text: parsedText.text, fontSize: style.fontSize * scale, fontFamily: style.fontFamily, color: style.color, bold: style.bold }
  }
  return { id, type: 'shape', name: shapeName, x, y, width, height, rotation, shape: modelShape, fill: fill ?? 'transparent', cornerRadius: 0 }
}

type ImageBudget = { encodedBytes: number; decodedBytes: number }

function imageDimensions(data: Uint8Array): { mime: 'image/png' | 'image/jpeg'; width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (data.length >= 33 && signature.every((byte, index) => data[index] === byte)) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(8) !== 13 || String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR') fail('A imagem PNG incorporada tem cabeçalho inválido.')
    let offset = 8, ended = false, hasData = false
    while (offset + 12 <= data.length) {
      const size = view.getUint32(offset)
      if (size > data.length - offset - 12) fail('A imagem PNG incorporada está truncada ou malformada.')
      const kind = String.fromCharCode(...data.subarray(offset + 4, offset + 8))
      if (kind === 'acTL') fail('PNG animado não é aceito na importação.')
      if (kind === 'IDAT') hasData = true
      offset += size + 12
      if (kind === 'IEND') { ended = true; break }
    }
    if (!ended || !hasData) fail('A imagem PNG incorporada está incompleta.')
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset < data.length) {
      if (data[offset] !== 0xff) fail('A imagem JPEG incorporada tem segmentos inválidos.')
      while (data[offset] === 0xff) offset += 1
      const marker = data[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > data.length) fail('A imagem JPEG incorporada está truncada.')
      const length = (data[offset] << 8) | data[offset + 1]
      if (length < 2 || offset + length > data.length) fail('A imagem JPEG incorporada está truncada ou malformada.')
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) fail('A imagem JPEG incorporada tem dimensões inválidas.')
        return { mime: 'image/jpeg', height: (data[offset + 3] << 8) | data[offset + 4], width: (data[offset + 5] << 8) | data[offset + 6] }
      }
      offset += length
    }
  }
  fail('A apresentação contém mídia que não é PNG ou JPEG raster estático.')
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, Math.min(data.length, offset + 0x8000)))
  return btoa(binary)
}

async function parsePicture(picXml: string, slideRels: Relationship[], zip: JSZip, nextId: () => string, scale: number, budget: ImageBudget): Promise<DesignElement> {
  if (/<a:(?:srcRect|tile|effectLst|effectDag)\b/i.test(picXml) || /<a:blip\b[^>]*\b(?:link|cstate)\s*=/i.test(picXml)) fail('A imagem contém corte, efeito ou configuração não preservada.')
  const blip = picXml.match(/<a:blip\b[^>]*\/?\s*>/)?.[0]
  const embedId = blip && attr(blip, 'r:embed')
  const relationship = embedId ? slideRels.find(item => item.id === embedId && item.type.endsWith('/image')) : undefined
  if (relationship && !/\.(?:png|jpe?g)$/i.test(relationship.target)) fail('Embedded SVG, GIF, and other media formats are not accepted.')
  if (!relationship) fail('A imagem do slide não aponta para uma mídia raster incorporada válida.')
  const entry = zip.file(relationship.target)
  if (!entry) fail('A imagem incorporada aponta para um arquivo ausente.')
  const bytes = await entry.async('uint8array')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('Uma imagem incorporada excede o limite de 8 MB ou está vazia.')
  budget.encodedBytes += bytes.length
  if (budget.encodedBytes > MAX_TOTAL_IMAGE_BYTES) fail('As imagens incorporadas excedem o limite total de 24 MB.')
  const { mime, width: sourceWidth, height: sourceHeight } = imageDimensions(bytes)
  if ((mime === 'image/png') !== /\.png$/i.test(relationship.target)) fail('The image extension does not match its content.')
  const pixels = sourceWidth * sourceHeight
  if (!Number.isSafeInteger(pixels) || sourceWidth < 1 || sourceHeight < 1 || sourceWidth > MAX_IMAGE_DIMENSION || sourceHeight > MAX_IMAGE_DIMENSION || pixels > MAX_IMAGE_PIXELS) fail('As dimensões da imagem excedem os limites de 12.000 px ou 16 megapixels.')
  budget.decodedBytes += pixels * 4
  if (budget.decodedBytes > MAX_TOTAL_DECODED_IMAGE_BYTES) fail('As imagens excedem o limite total de 64 MB de memória decodificada.')
  const nv = picXml.match(/<p:cNvPr\b[^>]*\/?\s*>/)?.[0]
  const name = nv ? attr(nv, 'name')?.trim() : ''
  const altText = nv ? (attr(nv, 'descr') ?? attr(nv, 'title'))?.trim() : undefined
  const spPr = picXml.match(/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/)?.[1]
  const transform = spPr?.match(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/)?.[0]
  const off = transform?.match(/<a:off\b[^>]*\/?\s*>/)?.[0]
  const ext = transform?.match(/<a:ext\b[^>]*\/?\s*>/)?.[0]
  if (!transform || !off || !ext || attr(transform, 'flipH') === '1' || attr(transform, 'flipV') === '1') fail('A imagem não possui geometria suportada ou está invertida.')
  const geometry = spPr?.match(/<a:prstGeom\b[^>]*>/)?.[0]
  if (!geometry || attr(geometry, 'prst') !== 'rect') fail('A imagem usa uma máscara que não é preservada.')
  const x = Number(attr(off, 'x')) / EMU_PER_INCH * CSS_PIXELS_PER_INCH * scale
  const y = Number(attr(off, 'y')) / EMU_PER_INCH * CSS_PIXELS_PER_INCH * scale
  const width = emuToPx(attr(ext, 'cx'), 'largura da imagem') * scale
  const height = emuToPx(attr(ext, 'cy'), 'altura da imagem') * scale
  const rotation = Number(attr(transform, 'rot') ?? 0) / 60_000
  if (![x, y, rotation, width, height].every(Number.isFinite) || Math.abs(x) > 20_000 || Math.abs(y) > 20_000 || Math.abs(rotation) > 360) fail('A imagem contém uma transformação fora dos limites aceitos.')
  return { id: nextId(), type: 'image', name: name || 'Imagem importada', src: `data:${mime};base64,${bytesToBase64(bytes)}`, altText: altText || undefined, sourceWidth, sourceHeight, x, y, width, height, rotation }
}

async function parseSlide(xml: string, slideRels: Relationship[], zip: JSZip, slideNumber: number, scale: number, budget: ImageBudget): Promise<DesignPage> {
  if (/<p:(?:graphicFrame|grpSp|cxnSp|contentPart|oleObj|control)\b|<a:(?:hlinkClick|hlinkHover|audioFile|videoFile|graphicData|custGeom)\b/i.test(xml)) fail(`O slide ${slideNumber} contém conteúdo não preservado.`)
  if (/<a:(?:schemeClr|sysClr|prstClr)\b/i.test(xml)) fail(`O slide ${slideNumber} usa cores de tema que não são preservadas.`)
  const unsupported = slideRels.find(rel => !rel.type.endsWith('/notesSlide') && !rel.type.endsWith('/slideLayout') && !rel.type.endsWith('/image'))
  if (unsupported) fail(`O slide ${slideNumber} contém um relacionamento com conteúdo não suportado.`)
  const slideName = attr(xml.match(/<p:cSld\b[^>]*>/)?.[0] ?? '', 'name')?.trim() || `Slide ${slideNumber}`
  const bg = xml.match(/<p:bg\b[^>]*>([\s\S]*?)<\/p:bg>/)?.[1] ?? ''
  const background = parseSolidColor(bg, '#ffffff') ?? '#ffffff'
  const shapeTree = tagContent(xml, 'p:spTree')
  if (!shapeTree) fail(`O slide ${slideNumber} não contém uma árvore de formas válida.`)
  const shapes = [...shapeTree.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g)]
  const allDrawable = [...shapeTree.matchAll(/<p:(sp|pic|graphicFrame|grpSp|cxnSp|contentPart)\b[^>]*>[\s\S]*?<\/p:\1\s*>/g)]
  const pictures = [...shapeTree.matchAll(/<p:pic\b[^>]*>[\s\S]*?<\/p:pic\s*>/g)]
  if (allDrawable.length !== shapes.length + pictures.length) fail(`O slide ${slideNumber} cont?m tipos de objeto n?o suportados.`)
  let elementIndex = 0
  const nextId = () => `pptx-${slideNumber}-${++elementIndex}`
  const ordered: Array<{ index: number; xml: string; kind: 'shape' | 'picture' }> = [
    ...[...shapeTree.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp\s*>/g)].map(match => ({ index: match.index ?? 0, xml: match[0], kind: 'shape' as const })),
    ...pictures.map(match => ({ index: match.index ?? 0, xml: match[0], kind: 'picture' as const })),
  ].sort((a, b) => a.index - b.index)
  const elements: DesignElement[] = []
  for (const item of ordered) elements.push(item.kind === 'shape' ? parseShape(item.xml, nextId, scale) : await parsePicture(item.xml, slideRels, zip, nextId, scale, budget))
  const notesRelationship = slideRels.find(rel => rel.type.endsWith('/notesSlide'))
  if (notesRelationship) {
    const notesXml = zip.file(notesRelationship.target)
    if (!notesXml) fail(`As notas do slide ${slideNumber} apontam para um arquivo ausente.`)
    const xmlText = await notesXml.async('string')
    if (/<p:(?:pic|graphicFrame|grpSp|cxnSp|oleObj|control)\b|<a:(?:blip|hlinkClick|audioFile|videoFile)\b/i.test(xmlText)) fail('As notas contêm objetos não suportados.')
    const bodyShapes = [...xmlText.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g)]
    const parts: string[] = []
    for (const item of bodyShapes) {
      if (/<p:ph\b[^>]*\btype\s*=\s*["'](?:sldNum|dt|hdr|ftr)["']/i.test(item[0])) continue
      const body = item[0].match(/<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/)?.[1]
      if (body) {
        const parsed = parseTextBody(body)
        if (parsed?.text.trim()) parts.push(parsed.text)
      }
    }
    const presenterNotes = parts.join('\n').trim() || undefined
    return { id: `pptx-page-${slideNumber}`, name: slideName, background, elements, ...(presenterNotes ? { presenterNotes } : {}) }
  }
  return { id: `pptx-page-${slideNumber}`, name: slideName, background, elements }
}

async function readXml(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  if (!entry) fail(`O pacote PPTX não contém ${path}.`)
  const value = await entry.async('string')
  if (new TextEncoder().encode(value).byteLength > MAX_PPTX_XML_BYTES) fail(`O XML ${path} excede o limite de 10 MB.`)
  assertWellFormedXml(value)
  return value
}

export async function parsePptx(source: ArrayBuffer, filename = 'Apresentação.pptx'): Promise<DesignDocument> {
  if (!source.byteLength) fail('O arquivo PPTX está vazio.')
  if (source.byteLength > MAX_PPTX_IMPORT_BYTES) fail('O PPTX deve ter no máximo 50 MB.')
  inspectZipDirectory(new Uint8Array(source))
  let zip: JSZip
  try { zip = await JSZip.loadAsync(source, { checkCRC32: true }) } catch { fail('Não foi possível abrir este PPTX. Verifique se o arquivo está danificado.') }
  for (const path of Object.keys(zip.files).filter(name => name.endsWith('.xml') || name.endsWith('.rels'))) {
    const xml = await readXml(zip, path)
    if (path.endsWith('.rels')) {
      const owner = path === '_rels/.rels' ? '' : path.replace(/\/_rels\//, '/').slice(0, -5)
      for (const relationship of parseRelationships(xml, owner)) if (!zip.file(relationship.target)) fail(`O PPTX contém um relacionamento para uma parte ausente: ${relationship.target}.`)
    }
  }
  const types = await readXml(zip, '[Content_Types].xml')
  if (!/<Override\b(?=[^>]*\bPartName\s*=\s*["']\/ppt\/presentation\.xml["'])(?=[^>]*\bContentType\s*=\s*["']application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation\.main\+xml["'])[^>]*>/i.test(types)) fail('O arquivo não está identificado como uma apresentação PPTX válida.')
  const rootRelsXml = await readXml(zip, '_rels/.rels')
  const rootRels = parseRelationships(rootRelsXml, '')
  const presentationRel = rootRels.find(rel => rel.type.endsWith('/officeDocument'))
  if (!presentationRel || presentationRel.target !== 'ppt/presentation.xml') fail('O PPTX não aponta para uma apresentação principal suportada.')
  const presentationXml = await readXml(zip, presentationRel.target)
  const presRelsPath = 'ppt/_rels/presentation.xml.rels'
  const presRels = parseRelationships(await readXml(zip, presRelsPath), 'ppt/presentation.xml')
  const sizeTag = presentationXml.match(/<p:sldSz\b[^>]*\/?\s*>/)?.[0]
  if (!sizeTag) fail('O PPTX não define as dimensões dos slides.')
  const width = emuToPx(attr(sizeTag, 'cx'), 'largura do slide')
  const height = emuToPx(attr(sizeTag, 'cy'), 'altura do slide')
  const scale = Math.min(1, 4000 / Math.max(width, height))
  const slideIds = [...presentationXml.matchAll(/<p:sldId\b[^>]*\/?\s*>/g)]
  if (!slideIds.length || slideIds.length > 500) fail('O PPTX deve conter entre 1 e 500 slides.')
  const pages: DesignPage[] = []
  const imageBudget: ImageBudget = { encodedBytes: 0, decodedBytes: 0 }
  for (let index = 0; index < slideIds.length; index += 1) {
    const relId = attr(slideIds[index][0], 'r:id')
    const relationship = presRels.find(rel => rel.id === relId && rel.type.endsWith('/slide'))
    if (!relationship) fail(`O slide ${index + 1} não possui um relacionamento válido.`)
    const slideXml = await readXml(zip, relationship.target)
    const slideRelsPath = `${relationship.target.split('/').slice(0, -1).join('/')}/_rels/${relationship.target.split('/').at(-1)}.rels`
    const slideRels = zip.file(slideRelsPath) ? parseRelationships(await readXml(zip, slideRelsPath), relationship.target) : []
    const page = await parseSlide(slideXml, slideRels, zip, index + 1, scale, imageBudget)
    pages.push(page)
  }
  const title = filename.replace(/\.pptx$/i, '').trim().slice(0, 100) || 'Apresentação importada'
  return { id: 'pptx-imported', name: title, type: 'presentation', width: width * scale, height: height * scale, updatedAt: new Date().toISOString(), pages }
}
