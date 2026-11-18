export const VECTOR_SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'hexagon', 'line', 'arrow', 'speech-bubble'] as const
export type VectorShapeKind = typeof VECTOR_SHAPES[number]

export const VECTOR_SHAPE_LABELS: Record<VectorShapeKind, string> = {
  rect: 'Retângulo', ellipse: 'Elipse', triangle: 'Triângulo', star: 'Estrela', hexagon: 'Hexágono', line: 'Linha', arrow: 'Seta', 'speech-bubble': 'Balão',
}

export function isStrokeVectorShape(kind: VectorShapeKind): boolean {
  return kind === 'line'
}

export function vectorShapePoints(kind: VectorShapeKind, width: number, height: number): number[] {
  if (kind === 'triangle') return [0, height, width / 2, 0, width, height]
  if (kind === 'hexagon') return [width * .25, 0, width * .75, 0, width, height / 2, width * .75, height, width * .25, height, 0, height / 2]
  if (kind === 'line') return [0, height / 2, width, height / 2]
  if (kind === 'arrow') return [0, height * .34, width * .63, height * .34, width * .63, height * .08, width, height / 2, width * .63, height * .92, width * .63, height * .66, 0, height * .66]
  if (kind === 'speech-bubble') return [width * .08, height * .08, width * .92, height * .08, width * .92, height * .72, width * .58, height * .72, width * .36, height * .96, width * .39, height * .72, width * .08, height * .72]
  const points: number[] = []
  const count = kind === 'star' ? 10 : 4
  const rx = width / 2
  const ry = height / 2
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count
    const radius = kind === 'star' && index % 2 === 1 ? .44 : .96
    points.push(width / 2 + Math.cos(angle) * rx * radius, height / 2 + Math.sin(angle) * ry * radius)
  }
  return points
}

export function vectorLinePath(width: number, height: number, curveOffset?: number | null): string {
  const y = height / 2
  if (!curveOffset) return `M0 ${y} L${width} ${y}`
  const controlY = y + curveOffset * 2 / 3
  return `M0 ${y} C${width / 3} ${controlY} ${width * 2 / 3} ${controlY} ${width} ${y}`
}

export function vectorLineArrowheadPoints(width: number, height: number, curveOffset?: number | null, atStart = false, length = 12, headWidth = 12): number[] {
  const y = height / 2
  const controlY = y + (curveOffset ?? 0) * 2 / 3
  const dx = width / 3
  const dy = y - controlY
  const magnitude = Math.hypot(dx, dy) || 1
  const unitX = dx / magnitude
  const unitY = dy / magnitude
  const tipX = atStart ? 0 : width
  const tipY = y
  const baseX = tipX + (atStart ? 1 : -1) * unitX * length
  const baseY = tipY + (atStart ? 1 : -1) * unitY * length
  const perpendicularX = -unitY * headWidth / 2
  const perpendicularY = unitX * headWidth / 2
  return [tipX, tipY, baseX + perpendicularX, baseY + perpendicularY, baseX - perpendicularX, baseY - perpendicularY]
}

export function vectorShapePath(kind: VectorShapeKind, width: number, height: number, curveOffset?: number | null): string {
  if (kind === 'line') return vectorLinePath(width, height, curveOffset)
  const points = vectorShapePoints(kind, width, height)
  const commands = points.reduce<string[]>((result, value, index) => {
    if (index % 2 === 0) result.push(`${index === 0 ? 'M' : 'L'}${value.toFixed(2)}`)
    else result[result.length - 1] += ` ${value.toFixed(2)}`
    return result
  }, [])
  return `${commands.join(' ')} Z`
}
