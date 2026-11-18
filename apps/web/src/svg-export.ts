import type { DesignDocument, DesignElement, DesignPage, FreeDrawElement, ShapeElement, StickyNoteElement, TextElement } from './model'
import { connectorPoints } from './whiteboard'
import { renderImageElementPng } from './export'
import { isStrokeVectorShape, vectorLineArrowheadPoints, vectorShapePath } from './vector-shapes'
import { normalizeSiteHref } from './site-links'
import { qrSvg } from './qr-code'

const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const number = (value: number) => Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0'

function wrapText(text: string, width: number, font: string, letterSpacing = 0): string[] {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Nao foi possivel medir o texto para SVG.')
  context.font = font
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      const measuredWidth = context.measureText(candidate).width + Math.max(0, [...candidate].length - 1) * letterSpacing
      if (line && measuredWidth > width) {
        lines.push(line)
        line = word
      } else line = candidate
    }
    lines.push(line)
  }
  return lines
}

function textSvg(element: TextElement): string {
  const weight = element.bold ? 700 : 400
  const font = `${weight} ${element.fontSize}px "${element.fontFamily.replace(/["\\]/g, '')}", sans-serif`
  const letterSpacing = Number.isFinite(element.kerning) ? element.kerning! : 0
  const lines = wrapText(element.text, element.width, font, letterSpacing)
  const lineHeight = element.fontSize * (Number.isFinite(element.lineSpacing) ? element.lineSpacing! : 1.2)
  const spacingAttribute = letterSpacing ? ` letter-spacing="${number(letterSpacing)}"` : ''
  const body = lines.flatMap((line, index) => index * lineHeight + lineHeight <= element.height + .5
    ? [`<text x="0" y="${number(index * lineHeight)}" dominant-baseline="hanging" font-family="${xml(element.fontFamily)}" font-size="${number(element.fontSize)}" font-weight="${weight}" fill="${xml(element.color)}"${spacingAttribute}>${xml(line)}</text>`]
    : []).join('')
  const href = normalizeSiteHref(element.href)
  const linkedBody = href ? `<a href="${xml(href)}" xlink:href="${xml(href)}">${body}</a>` : body
  return `<defs><clipPath id="clip-${xml(element.id)}"><rect width="${number(element.width)}" height="${number(element.height)}"/></clipPath></defs><g clip-path="url(#clip-${xml(element.id)})">${linkedBody}</g>`
}

function stickyNoteSvg(element: StickyNoteElement): string {
  const padding = Math.max(12, element.fontSize * .8)
  const lineHeight = element.fontSize * 1.35
  const font = `400 ${element.fontSize}px Arial, sans-serif`
  const lines = wrapText(element.text, element.width - padding * 2, font)
  const body = lines.flatMap((line, index) => padding + index * lineHeight + lineHeight <= element.height - padding + .5
    ? [`<text x="${number(padding)}" y="${number(padding + index * lineHeight)}" dominant-baseline="hanging" font-family="Arial, sans-serif" font-size="${number(element.fontSize)}" fill="${xml(element.color)}">${xml(line)}</text>`]
    : []).join('')
  return `<rect width="${number(element.width)}" height="${number(element.height)}" fill="${xml(element.fill)}"/><defs><clipPath id="clip-${xml(element.id)}"><rect width="${number(element.width)}" height="${number(element.height)}"/></clipPath></defs><g clip-path="url(#clip-${xml(element.id)})">${body}</g>`
}

function shapeSvg(element: ShapeElement): string {
  const qr = qrSvg(element)
  if (qr) return qr
  if (element.shape === 'rect') return `<rect width="${number(element.width)}" height="${number(element.height)}" rx="${number(Math.max(0, Math.min(element.cornerRadius, element.width / 2, element.height / 2)))}" fill="${xml(element.fill)}"/>`
  if (element.shape === 'ellipse') return `<ellipse cx="${number(element.width / 2)}" cy="${number(element.height / 2)}" rx="${number(element.width / 2)}" ry="${number(element.height / 2)}" fill="${xml(element.fill)}"/>`
  const path = vectorShapePath(element.shape, element.width, element.height, element.curveOffset)
  if (isStrokeVectorShape(element.shape)) {
    const width = element.strokeWidth ?? 8
    const lineCap = element.curveOffset ? 'butt' : 'round'
    const head = (atStart: boolean) => `<polygon points="${vectorLineArrowheadPoints(element.width, element.height, element.curveOffset, atStart).map(number).join(',')}" fill="${xml(element.fill)}"/>`
    return `<path d="${path}" fill="none" stroke="${xml(element.fill)}" stroke-width="${number(width)}" stroke-linecap="${lineCap}" stroke-linejoin="round"/>${element.startArrow ? head(true) : ''}${element.endArrow ? head(false) : ''}`
  }
  return isStrokeVectorShape(element.shape)
    ? `<path d="${path}" fill="none" stroke="${xml(element.fill)}" stroke-width="${number(element.strokeWidth ?? 8)}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${path}" fill="${xml(element.fill)}"/>`
}

function freeDrawSvg(element: FreeDrawElement): string {
  if (element.points.length < 4) return ''
  const points = Array.from({ length: element.points.length / 2 }, (_, index) => ({ x: element.points[index * 2], y: element.points[index * 2 + 1] }))
  let path = `M${number(points[0].x)} ${number(points[0].y)}`
  // The editor draws freehand layers with Konva tension=.35. Keep the SVG
  // export on the same curve: quadratic caps at the endpoints and cubic
  // segments between interior points, using Konva's distance-weighted handles.
  if (points.length > 2) {
    const tension = 0.35
    const controlPoints = (previous: typeof points[number], current: typeof points[number], next: typeof points[number]) => {
      const before = Math.hypot(current.x - previous.x, current.y - previous.y)
      const after = Math.hypot(next.x - current.x, next.y - current.y)
      const total = before + after
      if (!total) return [current, current] as const
      const beforeFactor = tension * before / total
      const afterFactor = tension * after / total
      return [
        { x: current.x - beforeFactor * (next.x - previous.x), y: current.y - beforeFactor * (next.y - previous.y) },
        { x: current.x + afterFactor * (next.x - previous.x), y: current.y + afterFactor * (next.y - previous.y) },
      ] as const
    }
    const controls = points.slice(1, -1).map((point, index) => controlPoints(points[index], point, points[index + 2]))
    const first = controls[0][0]
    path += ` Q${number(first.x)} ${number(first.y)} ${number(points[1].x)} ${number(points[1].y)}`
    for (let index = 1; index < points.length - 2; index += 1) {
      const outgoing = controls[index - 1][1]
      const [incoming] = controls[index]
      path += ` C${number(outgoing.x)} ${number(outgoing.y)} ${number(incoming.x)} ${number(incoming.y)} ${number(points[index + 1].x)} ${number(points[index + 1].y)}`
    }
    const last = controls[controls.length - 1][1]
    path += ` Q${number(last.x)} ${number(last.y)} ${number(points.at(-1)!.x)} ${number(points.at(-1)!.y)}`
  } else {
    for (const point of points.slice(1)) path += ` L${number(point.x)} ${number(point.y)}`
  }
  return `<path d="${path}" fill="none" stroke="${xml(element.color)}" stroke-width="${number(element.strokeWidth)}"${element.opacity !== undefined && element.opacity < 1 ? ` stroke-opacity="${number(element.opacity)}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`
}

async function elementSvg(element: DesignElement): Promise<string> {
  let body: string
  if (element.type === 'shape') body = shapeSvg(element)
  else if (element.type === 'text') body = textSvg(element)
  else if (element.type === 'sticky-note') body = stickyNoteSvg(element)
  else if (element.type === 'free-draw') body = freeDrawSvg(element)
  else body = `<image width="${number(element.width)}" height="${number(element.height)}" href="${await renderImageElementPng(element)}" preserveAspectRatio="none"/>`
  const centerX = element.width / 2
  const centerY = element.height / 2
  const accessibility = element.type === 'image'
    ? element.decorative ? ' aria-hidden="true"' : ` role="img" aria-label="${xml(element.altText?.trim() || element.name)}"`
    : ` role="group" aria-label="${xml(element.name)}"`
  return `<g transform="translate(${number(element.x)} ${number(element.y)}) rotate(${number(element.rotation)} ${number(centerX)} ${number(centerY)})"${accessibility}>${body}</g>`
}

function connectorSvg(page: DesignPage, connector: NonNullable<DesignPage['connectors']>[number]): string {
  const points = connectorPoints(page, connector)
  if (!points) return ''
  const [fromX, fromY, toX, toY] = points
  const angle = Math.atan2(toY - fromY, toX - fromX)
  const arrowLength = Math.max(10, connector.strokeWidth * 3)
  const firstX = toX - arrowLength * Math.cos(angle - Math.PI / 6)
  const firstY = toY - arrowLength * Math.sin(angle - Math.PI / 6)
  const secondX = toX - arrowLength * Math.cos(angle + Math.PI / 6)
  const secondY = toY - arrowLength * Math.sin(angle + Math.PI / 6)
  return `<g fill="${xml(connector.color)}" stroke="${xml(connector.color)}" stroke-width="${number(connector.strokeWidth)}" stroke-linecap="round"><path d="M${number(fromX)} ${number(fromY)} L${number(toX)} ${number(toY)}"/><path d="M${number(toX)} ${number(toY)} L${number(firstX)} ${number(firstY)} L${number(secondX)} ${number(secondY)} Z"/></g>`
}

export async function renderPageSvg(documentModel: DesignDocument, page: DesignPage): Promise<string> {
  if (!(documentModel.width > 0 && documentModel.height > 0) || !Number.isFinite(documentModel.width + documentModel.height)) throw new Error('As dimensoes do documento nao sao validas para SVG.')
  const connectors = (page.connectors ?? []).map(connector => connectorSvg(page, connector)).join('')
  const elements = (await Promise.all(page.elements.map(elementSvg))).join('')
  const title = `${documentModel.name} — ${page.name}`
  const description = `${page.elements.length} design elements and ${(page.connectors ?? []).length} connectors.`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${number(documentModel.width)}" height="${number(documentModel.height)}" viewBox="0 0 ${number(documentModel.width)} ${number(documentModel.height)}"><title id="svg-title">${xml(title)}</title><desc id="svg-description">${xml(description)}</desc><rect width="100%" height="100%" fill="${xml(page.background)}"/>${connectors}${elements}</svg>`
  if (new Blob([svg]).size > 64_000_000) throw new Error('O SVG excede o limite seguro de 64 MB.')
  return svg
}

export function wrapRasterPageAsSvg(width: number, height: number, pngDataUrl: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><image width="100%" height="100%" href="${pngDataUrl}" preserveAspectRatio="none"/></svg>`
  if (new Blob([svg]).size > 64_000_000) throw new Error('O SVG excede o limite seguro de 64 MB.')
  return svg
}
