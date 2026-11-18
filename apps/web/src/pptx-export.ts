import JSZip from 'jszip'
import type { DesignElement, DesignPage } from './model'

const EMU_PER_INCH = 914400
const SLIDE_WIDTH_EMU = 10 * EMU_PER_INCH

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!)
}

function pngBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('Cada slide precisa ser uma imagem PNG válida.')
  const binary = atob(match[1])
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < signature.length || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('A imagem de um slide não contém uma assinatura PNG válida.')
  }
  return bytes
}

function slideXml(index: number, width: number, height: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Slide ${index + 1}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide ${index + 1}" descr="Rendered presentation slide ${index + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function colorHex(value: string): string | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())
  if (!match) return null
  return (match[1].length === 3 ? [...match[1]].map(character => character + character).join('') : match[1]).toUpperCase()
}

type EmbeddedRaster = { bytes: Uint8Array; extension: 'png' | 'jpg'; relationshipId: string; target: string }
type EditableElement = { xml: string; raster?: EmbeddedRaster }

function rasterImage(src: string, relationshipId: string, target: string): EmbeddedRaster | null {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src)
  if (!match) return null
  const binary = atob(match[2])
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const validPng = match[1] === 'png' && bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  const validJpeg = match[1] === 'jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (!validPng && !validJpeg) return null
  return { bytes, extension: validPng ? 'png' : 'jpg', relationshipId, target }
}

function freeDrawSegments(points: number[]) {
  const count = points.length / 2
  const point = (index: number) => ({ x: points[index * 2], y: points[index * 2 + 1] })
  if (count === 2) return [{ type: 'line' as const, ...point(1) }]
  const controls = Array.from({ length: count - 2 }, (_, index) => {
    const previous = point(index)
    const current = point(index + 1)
    const next = point(index + 2)
    const before = Math.hypot(current.x - previous.x, current.y - previous.y)
    const after = Math.hypot(next.x - current.x, next.y - current.y)
    const total = before + after
    if (total === 0) return [current, current] as const
    const beforeFactor = 0.35 * before / total
    const afterFactor = 0.35 * after / total
    return [
      { x: current.x - beforeFactor * (next.x - previous.x), y: current.y - beforeFactor * (next.y - previous.y) },
      { x: current.x + afterFactor * (next.x - previous.x), y: current.y + afterFactor * (next.y - previous.y) },
    ] as const
  })
  const segments: Array<{ type: 'quadratic' | 'cubic'; controlX?: number; controlY?: number; control1X?: number; control1Y?: number; control2X?: number; control2Y?: number; x: number; y: number }> = [
    { type: 'quadratic', controlX: controls[0][0].x, controlY: controls[0][0].y, ...point(1) },
  ]
  for (let index = 1; index < count - 2; index += 1) {
    const outgoing = controls[index - 1][1]
    const incoming = controls[index][0]
    segments.push({ type: 'cubic', control1X: outgoing.x, control1Y: outgoing.y, control2X: incoming.x, control2Y: incoming.y, ...point(index + 1) })
  }
  const lastControl = controls[controls.length - 1][1]
  segments.push({ type: 'quadratic', controlX: lastControl.x, controlY: lastControl.y, ...point(count - 1) })
  return segments
}

function strokedPathXml(points: Array<{ x: number; y: number }>, geometryWidth: number, geometryHeight: number, color: string, strokeWidth: number, scaleX: number): string | null {
  if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x > geometryWidth || point.y > geometryHeight)) return null
  const pathScale = 1000
  const width = Math.max(1, Math.round(geometryWidth * pathScale))
  const height = Math.max(1, Math.round(geometryHeight * pathScale))
  const pointXml = (point: { x: number; y: number }) => `<a:pt x="${Math.round(point.x * pathScale)}" y="${Math.round(point.y * pathScale)}"/>`
  let commands = `<a:moveTo>${pointXml(points[0])}</a:moveTo>`
  if (points.length === 2) commands += `<a:lnTo>${pointXml(points[1])}</a:lnTo>`
  else {
    let cursor = points[0]
    for (const segment of freeDrawSegments(points.flatMap(point => [point.x, point.y]))) {
      if (segment.type === 'line') commands += `<a:lnTo>${pointXml(segment)}</a:lnTo>`
      else {
        const end = { x: segment.x, y: segment.y }
        const control1 = segment.type === 'cubic'
          ? { x: segment.control1X!, y: segment.control1Y! }
          : { x: cursor.x + (segment.controlX! - cursor.x) * 2 / 3, y: cursor.y + (segment.controlY! - cursor.y) * 2 / 3 }
        const control2 = segment.type === 'cubic'
          ? { x: segment.control2X!, y: segment.control2Y! }
          : { x: end.x + (segment.controlX! - end.x) * 2 / 3, y: end.y + (segment.controlY! - end.y) * 2 / 3 }
        commands += `<a:cubicBezTo>${pointXml(control1)}${pointXml(control2)}${pointXml(end)}</a:cubicBezTo>`
        cursor = end
      }
    }
  }
  const line = `<a:ln w="${Math.max(1, Math.round(strokeWidth * scaleX))}" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln>`
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${width}" b="${height}"/><a:pathLst><a:path w="${width}" h="${height}" fill="none" stroke="1">${commands}</a:path></a:pathLst></a:custGeom>${line}`
}

function editableElementXml(element: DesignElement, index: number, scaleX: number, scaleY: number, imageTarget: string): EditableElement | null {
  const id = index + 2
  const x = Math.round(element.x * scaleX)
  const y = Math.round(element.y * scaleY)
  const width = Math.max(1, Math.round(element.width * scaleX))
  const height = Math.max(1, Math.round(element.height * scaleY))
  const rotation = Math.round(element.rotation * 60000)
  const transform = `<a:xfrm${rotation ? ` rot="${rotation}"` : ''}><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
  const nonVisual = `<p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(element.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  if (element.type === 'shape' && (element.shape === 'rect' || element.shape === 'ellipse')) {
    const fill = colorHex(element.fill)
    if (!fill || element.cornerRadius !== 0 || (element.strokeWidth ?? 0) !== 0) return null
    return { xml: `<p:sp>${nonVisual}<p:spPr>${transform}<a:prstGeom prst="${element.shape}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>` }
  }
  if (element.type === 'shape' && element.shape === 'line') {
    if (element.curveOffset || element.startArrow || element.endArrow) return null
    const color = colorHex(element.fill)
    const strokeWidth = element.strokeWidth ?? 8
    if (!color || !Number.isFinite(strokeWidth) || strokeWidth <= 0 || element.width <= 0 || element.height <= 0) return null
    const path = strokedPathXml([{ x: 0, y: element.height / 2 }, { x: element.width, y: element.height / 2 }], element.width, element.height, color, strokeWidth, scaleX)
    return path ? { xml: `<p:sp>${nonVisual}<p:spPr>${transform}${path}</p:spPr></p:sp>` } : null
  }
  if (element.type === 'text') {
    const color = colorHex(element.color)
    if (!color || !Number.isFinite(element.fontSize) || element.fontSize <= 0 || !element.fontFamily.trim()) return null
    const fontSize = Math.max(1, Math.round(element.fontSize * scaleX * 72 / EMU_PER_INCH))
    const paragraphs = element.text.split(/\r?\n/).map(line => `<a:p><a:pPr/><a:r><a:rPr lang="en-US" sz="${fontSize}" b="${element.bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${escapeXml(element.fontFamily)}"/></a:rPr><a:t xml:space="preserve">${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${fontSize}"/></a:p>`).join('')
    return { xml: `<p:sp>${nonVisual}<p:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>` }
  }
  if (element.type === 'image') {
    if ((element.opacity !== undefined && element.opacity !== 100) || (element.flipX ?? false) || (element.flipY ?? false)
      || (element.crop !== undefined && element.crop !== null) || (element.brightness !== undefined) || (element.contrast !== undefined)
      || (element.saturation !== undefined) || (element.filterPreset !== undefined) || (element.maskStrokes?.length ?? 0) > 0
      || (element.animation !== undefined && element.animation !== null)) return null
    const raster = rasterImage(element.src, `rId${index + 2}`, imageTarget)
    if (!raster) return null
    const picNv = `<p:nvPicPr><p:cNvPr id="${id}" name="${escapeXml(element.name)}"${element.altText ? ` descr="${escapeXml(element.altText)}"` : ''}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    const xml = `<p:pic>${picNv}<p:blipFill><a:blip r:embed="${raster.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    return { xml, raster }
  }
  if (element.type === 'free-draw') {
    const color = colorHex(element.color)
    if (!color || element.points.length < 4 || element.points.length % 2 !== 0 || element.points.length > 10000
      || !Number.isFinite(element.strokeWidth) || element.strokeWidth <= 0 || element.width <= 0 || element.height <= 0) return null
    const points = Array.from({ length: element.points.length / 2 }, (_, pointIndex) => ({ x: element.points[pointIndex * 2], y: element.points[pointIndex * 2 + 1] }))
    const path = strokedPathXml(points, element.width, element.height, color, element.strokeWidth, scaleX)
    return path ? { xml: `<p:sp>${nonVisual}<p:spPr>${transform}${path}</p:spPr></p:sp>` } : null
  }
  return null
}

function editableSlideXml(index: number, page: DesignPage, widthEmu: number, heightEmu: number, designWidth: number, designHeight: number): { xml: string; rasters: EmbeddedRaster[] } | null {
  const background = colorHex(page.background)
  if (!background || page.elements.length > 200) return null
  const objects = page.elements.map((element, elementIndex) => editableElementXml(element, elementIndex, widthEmu / designWidth, heightEmu / designHeight, `../media/slide${index + 1}-image${elementIndex + 1}.${element.type === 'image' && element.src.startsWith('data:image/jpeg;') ? 'jpg' : 'png'}`))
  if (objects.some(object => object === null)) return null
  const rasters = objects.flatMap(object => object?.raster ? [object.raster] : [])
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Slide ${index + 1}"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${objects.map(object => object!.xml).join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  return { xml, rasters }
}

const presentationMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`

const presentationLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fuse"><a:themeElements><a:clrScheme name="Fuse"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="7652E8"/></a:accent1><a:accent2><a:srgbClr val="EC796A"/></a:accent2><a:accent3><a:srgbClr val="5B9B89"/></a:accent3><a:accent4><a:srgbClr val="E5BD5A"/></a:accent4><a:accent5><a:srgbClr val="3B6683"/></a:accent5><a:accent6><a:srgbClr val="9B6E9A"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Fuse"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Fuse"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

/** Build a standards-based PPTX with editable native slides when supported and full-slide PNG fallback otherwise. */
export async function createPptxBytes(width: number, height: number, slides: string[], editablePages?: DesignPage[]): Promise<ArrayBuffer> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('As dimensões da apresentação precisam ser positivas.')
  }
  if (slides.length === 0) throw new Error('A apresentação precisa ter ao menos um slide.')
  if (slides.length > 500) throw new Error('A apresentação excede o limite de 500 slides por arquivo.')

  if (editablePages && editablePages.length !== slides.length) throw new Error('The editable page count must match the slide count.')
  const slideHeightEmu = Math.max(1, Math.round(SLIDE_WIDTH_EMU * height / width))
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`)
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE_WIDTH_EMU}" cy="${slideHeightEmu}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`)
  zip.file('ppt/slideMasters/slideMaster1.xml', presentationMaster)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>')
  zip.file('ppt/slideLayouts/slideLayout1.xml', presentationLayout)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>')
  zip.file('ppt/theme/theme1.xml', theme)
  slides.forEach((dataUrl, index) => {
    const nativeSlide = editablePages && editableSlideXml(index, editablePages[index], SLIDE_WIDTH_EMU, slideHeightEmu, width, height)
    zip.file(`ppt/slides/slide${index + 1}.xml`, nativeSlide?.xml ?? slideXml(index, SLIDE_WIDTH_EMU, slideHeightEmu))
    const imageRelationship = nativeSlide
      ? nativeSlide.rasters.map(raster => `<Relationship Id="${raster.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${raster.target}"/>`).join('')
      : '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/slide' + (index + 1) + '.png"/>'
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' + imageRelationship + '</Relationships>')
    if (nativeSlide) nativeSlide.rasters.forEach(raster => zip.file(`ppt/media/${raster.target.split('/').at(-1)}`, raster.bytes))
    else zip.file(`ppt/media/slide${index + 1}.png`, pngBytes(dataUrl))
  })
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml('Apresentação')}</dc:title><dc:creator>Fuse</dc:creator></cp:coreProperties>`)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
