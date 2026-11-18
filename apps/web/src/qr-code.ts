import QRCode from 'qrcode'
import type { ShapeElement } from './model'

export type QrModuleShape = 'blocks' | 'rounded' | 'circles' | 'crosses' | 'stars' | 'hearts'

export function createQrMatrix(value: string): { size: number; data: Uint8Array } | null {
  if (!value.trim()) return null
  const qr = QRCode.create(value, { errorCorrectionLevel: 'H' })
  return { size: qr.modules.size, data: Uint8Array.from(qr.modules.data) }
}

function matrixPath(size: number, data: Uint8Array, shape: QrModuleShape): string {
  const commands: string[] = []
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (!data[y * size + x]) continue
    if (shape === 'circles') commands.push(`M${x + .5} ${y + .5}a.43 .43 0 1 0 .86 0a.43 .43 0 1 0-.86 0`)
    else if (shape === 'rounded') commands.push(`M${x + .12} ${y}h.76a.12 .12 0 0 1 .12 .12v.76a.12 .12 0 0 1-.12 .12h-.76a.12 .12 0 0 1-.12-.12v-.76a.12 .12 0 0 1 .12-.12z`)
    else if (shape === 'crosses') commands.push(`M${x + .38} ${y}h.24v.38h.38v.24h-.38v.38h-.24v-.38h-.38v-.24h.38z`)
    else if (shape === 'stars') commands.push(`M${x + .5} ${y}l.14 .34l.36 .02l-.28 .23l.1 .36l-.32-.2l-.32 .2l.1-.36l-.28-.23l.36-.02z`)
    else if (shape === 'hearts') commands.push(`M${x + .5} ${y + .86}l-.34-.32c-.55-.52-.12-1.12.34-.76c.46-.36.89.24.34.76z`)
    else commands.push(`M${x} ${y}h1v1h-1z`)
  }
  return commands.join('')
}

export function qrSvg(element: ShapeElement): string | null {
  const config = element.qrConfig
  if (!config?.url) return null
  const matrix = createQrMatrix(config.url)
  if (!matrix) return null
  const quiet = 4
  const viewSize = matrix.size + quiet * 2
  const shape = config.pattern ?? 'blocks'
  const foreground = /^#[0-9a-f]{6}$/i.test(config.foreground) ? config.foreground : '#000000'
  const background = /^#[0-9a-f]{6}$/i.test(config.background) ? config.background : '#ffffff'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="${background}"/><path transform="translate(${quiet} ${quiet})" d="${matrixPath(matrix.size, matrix.data, shape)}" fill="${foreground}"/></svg>`
}

export function drawQrCanvas(context: CanvasRenderingContext2D, element: ShapeElement): void {
  const config = element.qrConfig
  if (!config?.url) return
  const matrix = createQrMatrix(config.url)
  if (!matrix) return
  const quiet = 4
  const fullSize = matrix.size + quiet * 2
  const module = Math.min(element.width, element.height) / fullSize
  const left = (element.width - matrix.size * module) / 2
  const top = (element.height - matrix.size * module) / 2
  context.fillStyle = config.background
  context.fillRect(0, 0, element.width, element.height)
  context.fillStyle = config.foreground
  for (let y = 0; y < matrix.size; y += 1) for (let x = 0; x < matrix.size; x += 1) {
    if (!matrix.data[y * matrix.size + x]) continue
    const px = left + x * module
    const py = top + y * module
    if (config.pattern === 'circles') {
      context.beginPath()
      context.arc(px + module / 2, py + module / 2, module * .43, 0, Math.PI * 2)
      context.fill()
    } else if (config.pattern === 'rounded') {
      context.beginPath()
      context.roundRect(px + module * .08, py + module * .08, module * .84, module * .84, module * .12)
      context.fill()
    }
    else if (config.pattern === 'crosses') {
      context.fillRect(px + module * .38, py, module * .24, module)
      context.fillRect(px, py + module * .38, module, module * .24)
    } else if (config.pattern === 'stars') {
      context.beginPath()
      for (let point = 0; point < 10; point += 1) {
        const radius = point % 2 ? module * .2 : module * .46
        const angle = -Math.PI / 2 + point * Math.PI / 5
        const tx = px + module / 2 + Math.cos(angle) * radius
        const ty = py + module / 2 + Math.sin(angle) * radius
        if (point) context.lineTo(tx, ty)
        else context.moveTo(tx, ty)
      }
      context.closePath()
      context.fill()
    } else if (config.pattern === 'hearts') {
      context.beginPath()
      context.moveTo(px + module * .5, py + module * .9)
      context.bezierCurveTo(px - module * .04, py + module * .5, px + module * .15, py + module * .04, px + module * .5, py + module * .32)
      context.bezierCurveTo(px + module * .85, py + module * .04, px + module * 1.04, py + module * .5, px + module * .5, py + module * .9)
      context.fill()
    } else context.fillRect(px, py, module, module)
  }
}

export function drawQrScene(context: import('konva/lib/Context').Context, element: ShapeElement): void {
  drawQrCanvas(context._context, element)
}
