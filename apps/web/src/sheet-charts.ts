import type { SheetChart } from './model'

export type SheetChartPoint = { label: string; value: number; series: string; seriesIndex: number; rowIndex: number }

/** Resolve a chart's stored range against calculated sheet values. The first row
 * names series and the first column labels categories; non-numeric cells are skipped. */
export function getSheetChartPoints(chart: SheetChart, values: string[][]): SheetChartPoint[] {
  const { startRow, startColumn, endRow, endColumn } = chart.range
  const result: SheetChartPoint[] = []
  for (let column = startColumn + 1; column <= endColumn; column += 1) {
    const series = values[startRow]?.[column]?.trim() || `Série ${column - startColumn}`
    for (let row = startRow + 1; row <= endRow; row += 1) {
      const raw = (values[row]?.[column] ?? '').trim()
      const normalized = raw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
      const value = normalized === '' ? Number.NaN : Number(normalized)
      if (!Number.isFinite(value)) continue
      result.push({ label: values[row]?.[startColumn]?.trim() || `Linha ${row + 1}`, value, series, seriesIndex: column - startColumn - 1, rowIndex: row - startRow - 1 })
    }
  }
  return result
}

export function getSheetChartDomain(points: SheetChartPoint[]): { min: number; max: number } {
  if (!points.length) return { min: 0, max: 1 }
  const minValue = Math.min(0, ...points.map(point => point.value))
  const maxValue = Math.max(0, ...points.map(point => point.value))
  if (minValue === maxValue) return { min: minValue - 1, max: maxValue + 1 }
  const padding = (maxValue - minValue) * 0.08
  return { min: minValue - padding, max: maxValue + padding }
}
