import { evaluateFormula } from './formula'
import { excelDateParts, parseExcelDateText, excelSerialToDate } from './sheet-dates'

export type SheetCells = string[][]

export function columnLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) return ''
  let value = index + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + value % 26) + label
    value = Math.floor(value / 26)
  }
  return label
}

export function parseCellAddress(address: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(address.trim())
  if (!match) return null
  let column = 0
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}

export function translateSheetFormula(formula: string, rowDelta: number, columnDelta: number): string {
  if (!formula.startsWith('=') || (!rowDelta && !columnDelta)) return formula
  const referencePattern = /"(?:[^"]|"")*"|(?<![A-Z0-9_.])((?:(?:'(?:[^']|'')+'|[A-Z_][A-Z0-9_.]*)!)?)(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)(?![A-Z0-9_])/gi
  return formula.replace(referencePattern, (match, sheet: string | undefined, absoluteColumn: string | undefined, label: string | undefined, absoluteRow: string | undefined, rowText: string | undefined) => {
    if (!label || !rowText) return match
    const address = parseCellAddress(`${label}${rowText}`)
    if (!address) return match
    const nextColumn = address.column + (absoluteColumn ? 0 : columnDelta)
    const nextRow = address.row + (absoluteRow ? 0 : rowDelta)
    if (nextColumn < 0 || nextRow < 0) return '#REF!'
    return `${sheet ?? ''}${absoluteColumn ?? ''}${columnLabel(nextColumn)}${absoluteRow ?? ''}${nextRow + 1}`
  })
}

export function translateCopiedSheetRange(pasted: string[][], sourceRow: number, sourceColumn: number, targetRow: number, targetColumn: number): string[][] {
  if (!pasted.length) return pasted
  return pasted.map(row => row.map(value => translateSheetFormula(value, targetRow - sourceRow, targetColumn - sourceColumn)))
}

function rawCell(cells: SheetCells, row: number, column: number): string {
  return cells[row]?.[column] ?? ''
}

export type SheetCellMerge = { row: number; column: number; colSpan: number; rowSpan?: number }
export type SheetNumberFormat = 'default' | 'currency' | 'percentage' | 'date' | 'time' | 'datetime'
export type SheetRange = { anchorRow: number; anchorColumn: number; focusRow: number; focusColumn: number }
export type SheetReference = { name: string; cells: SheetCells; merges?: SheetCellMerge[] }

const MAX_SHEET_ROWS = 1000
const MAX_SHEET_COLUMNS = 200

function isValidSheetMerge(merge: SheetCellMerge): boolean {
  const rowSpan = merge.rowSpan ?? 1
  return Number.isInteger(merge.row)
    && Number.isInteger(merge.column)
    && Number.isInteger(merge.colSpan)
    && Number.isInteger(rowSpan)
    && merge.row >= 0
    && merge.column >= 0
    && merge.colSpan >= 1
    && rowSpan >= 1
    && merge.row + rowSpan <= MAX_SHEET_ROWS
    && merge.column + merge.colSpan <= MAX_SHEET_COLUMNS
    && (merge.colSpan > 1 || rowSpan > 1)
}

function validSheetMerges(merges: SheetCellMerge[] | undefined): SheetCellMerge[] {
  return (merges ?? []).filter(isValidSheetMerge)
}

export function renameSheetReferences(cells: SheetCells, previousName: string, nextName: string): SheetCells {
  if (!previousName || !nextName || previousName.toLocaleLowerCase() === nextName.toLocaleLowerCase()) return cells
  const formatName = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(nextName) ? nextName : `'${nextName.replace(/'/g, "''")}'`
  let changed = false
  const renamed = cells.map(row => row.map(value => {
    if (!value.trim().startsWith('=')) return value
    const next = value.replace(/'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!/g, (reference, quotedName: string | undefined, plainName: string | undefined) => {
      const referencedName = (quotedName?.replace(/''/g, "'") ?? plainName ?? '').toLocaleLowerCase()
      if (referencedName !== previousName.toLocaleLowerCase()) return reference
      changed = true
      return `${formatName}!`
    })
    return next
  }))
  return changed ? renamed : cells
}

export function evaluateSheet(cells: SheetCells, merges: SheetCellMerge[] = [], workbook: SheetReference[] = [], activeSheetName = ''): { values: string[][]; errors: string[] } {
  const sheets = workbook.length ? workbook : [{ name: activeSheetName, cells, merges }]
  const activeIndex = sheets.findIndex(sheet => sheet.name.toLocaleLowerCase() === activeSheetName.toLocaleLowerCase())
  const currentIndex = activeIndex < 0 ? 0 : activeIndex
  const cache = new Map<string, number | string | boolean>()
  const errors = new Set<string>()
  const coveredCells = sheets.map(sheet => new Set(validSheetMerges(sheet.merges).flatMap(merge => Array.from({ length: merge.rowSpan ?? 1 }, (_, rowOffset) => Array.from({ length: merge.colSpan }, (_, columnOffset) => ({ row: merge.row + rowOffset, column: merge.column + columnOffset })).filter(point => point.row !== merge.row || point.column !== merge.column).map(point => `${point.row}:${point.column}`)).flat())))
  const resolveReference = (token: string): { sheetIndex: number; row: number; column: number } | null => {
    const bang = token.lastIndexOf('!')
    const sheetName = bang < 0 ? null : token.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'")
    const address = parseCellAddress(bang < 0 ? token : token.slice(bang + 1))
    if (!address) return null
    const sheetIndex = sheetName === null ? currentIndex : sheets.findIndex(sheet => sheet.name.toLocaleLowerCase() === sheetName.toLocaleLowerCase())
    return sheetIndex < 0 ? null : { sheetIndex, ...address }
  }
  const evaluateCell = (sheetIndex: number, row: number, column: number, trail: Set<string>): number | string | boolean => {
    const key = `${sheetIndex}:${row}:${column}`
    if (coveredCells[sheetIndex]?.has(`${row}:${column}`)) return 0
    if (cache.has(key)) return cache.get(key)!
    const source = rawCell(sheets[sheetIndex]?.cells ?? [], row, column).trim()
    if (!source.startsWith('=')) {
      if (!source) return ''
      const number = Number(source)
      return Number.isFinite(number) ? number : source
    }
    if (trail.has(key)) { errors.add('#CYCLE!'); return '#CYCLE!' }
    const nextTrail = new Set(trail).add(key)
    const expression = source.slice(1).trim()
    const ref = resolveReference(expression)
    if (ref) {
      const result = evaluateCell(ref.sheetIndex, ref.row, ref.column, nextTrail)
      cache.set(key, result)
      return result
    }
    const formulaResult = evaluateFormula(expression, {
      resolveReference,
      resolveRange: (start, endToken) => {
        const resolvedEnd = resolveReference(endToken)
        const end = resolvedEnd && !endToken.includes('!') ? { ...resolvedEnd, sheetIndex: start.sheetIndex } : resolvedEnd
        if (!end || end.sheetIndex !== start.sheetIndex || (Math.abs(end.row - start.row) + 1) * (Math.abs(end.column - start.column) + 1) > 10000) return null
        const points: Array<{ sheetIndex: number; row: number; column: number }> = []
        for (let rangeRow = Math.min(start.row, end.row); rangeRow <= Math.max(start.row, end.row); rangeRow += 1) {
          for (let rangeColumn = Math.min(start.column, end.column); rangeColumn <= Math.max(start.column, end.column); rangeColumn += 1) points.push({ sheetIndex: start.sheetIndex, row: rangeRow, column: rangeColumn })
        }
        return { kind: 'range', points }
      },
      evaluateReference: point => evaluateCell(point.sheetIndex, point.row, point.column, nextTrail),
    })
    if (typeof formulaResult === 'string' && formulaResult.startsWith('#')) errors.add(formulaResult)
    cache.set(key, formulaResult)
    return formulaResult
  }
  const height = Math.max(cells.length, 1)
  const width = Math.max(1, ...cells.map(row => row.length))
  const values = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => {
    const result = evaluateCell(currentIndex, row, column, new Set())
    return typeof result === 'number' ? String(Number(result.toFixed(10))) : typeof result === 'boolean' ? String(result).toUpperCase() : result
  }))
  return { values, errors: [...errors] }
}

export function formatSheetCellValue(value: string, format: SheetNumberFormat = 'default', locale = 'pt-BR'): string {
  if (format === 'default' || !value || value.startsWith('#')) return value
  const numeric = Number(value)
  const serial = Number.isFinite(numeric) ? numeric : parseExcelDateText(value)
  if (['date', 'time', 'datetime'].includes(format)) {
    if (serial === null) return value
    const parts = excelDateParts(serial)
    if (!parts) return value
    const fakeLeapDay = parts.year === 1900 && parts.month === 2 && parts.day === 29
    const date = excelSerialToDate(serial)
    const dateText = fakeLeapDay ? '29/02/1900' : date ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date) : ''
    const timeText = date ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date) : `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
    return format === 'date' ? dateText : format === 'time' ? timeText : `${dateText} ${timeText}`.trim()
  }
  if (!Number.isFinite(numeric)) return value
  if (format === 'currency') return new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' }).format(numeric)
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(numeric)
}

export function fillSheetDown(cells: SheetCells, range: SheetRange): SheetCells {
  const top = Math.min(range.anchorRow, range.focusRow)
  const bottom = Math.max(range.anchorRow, range.focusRow)
  const left = Math.min(range.anchorColumn, range.focusColumn)
  const right = Math.max(range.anchorColumn, range.focusColumn)
  if (bottom <= top || top < 0 || left < 0 || bottom >= 1000 || right >= 200) return cells
  const result = cells.map(row => [...row])
  for (let row = top + 1; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const source = cells[top]?.[column] ?? ''
      const delta = row - top
      const value = translateSheetFormula(source, delta, 0)
      while (result.length <= row) result.push([])
      while (result[row].length <= column) result[row].push('')
      result[row][column] = value
    }
  }
  return result
}

export function setSheetCell(cells: SheetCells, row: number, column: number, value: string): SheetCells {
  if (!Number.isInteger(row) || row < 0 || row >= 1000 || !Number.isInteger(column) || column < 0 || column >= 200) return cells
  const height = Math.max(cells.length, row + 1)
  const width = Math.max(1, column + 1, ...cells.map(item => item.length))
  return Array.from({ length: height }, (_, rowIndex) => Array.from({ length: width }, (_, columnIndex) => rowIndex === row && columnIndex === column ? value : cells[rowIndex]?.[columnIndex] ?? ''))
}

export function pasteSheetRange(cells: SheetCells, startRow: number, startColumn: number, pasted: string[][]): SheetCells {
  if (!Number.isInteger(startRow) || startRow < 0 || !Number.isInteger(startColumn) || startColumn < 0 || !pasted.length) return cells
  const width = Math.max(0, ...pasted.map(row => row.length))
  if (!width || startRow + pasted.length > 1000 || startColumn + width > 200 || pasted.some(row => row.length > 200)) return cells
  const height = Math.max(cells.length, startRow + pasted.length)
  const result = Array.from({ length: height }, (_, row) => [...(cells[row] ?? [])])
  for (let row = 0; row < pasted.length; row += 1) {
    const targetRow = result[startRow + row]
    while (targetRow.length < startColumn + width) targetRow.push('')
    for (let column = 0; column < pasted[row].length; column += 1) targetRow[startColumn + column] = pasted[row][column]
  }
  return result
}

export function mergeSheetRange(cells: SheetCells, merges: SheetCellMerge[], range: SheetRange): SheetCellMerge[] | null {
  const top = Math.min(range.anchorRow, range.focusRow)
  const bottom = Math.max(range.anchorRow, range.focusRow)
  const left = Math.min(range.anchorColumn, range.focusColumn)
  const right = Math.max(range.anchorColumn, range.focusColumn)
  if (![top, bottom, left, right].every(Number.isInteger) || top < 0 || bottom >= MAX_SHEET_ROWS || left < 0 || right >= MAX_SHEET_COLUMNS || (top === bottom && left === right)) return null
  const rowSpan = bottom - top + 1
  const colSpan = right - left + 1
  const overlaps = validSheetMerges(merges).some(merge => top < merge.row + (merge.rowSpan ?? 1)
    && bottom + 1 > merge.row
    && left < merge.column + merge.colSpan
    && right + 1 > merge.column)
  if (overlaps) return null
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      if ((row !== top || column !== left) && (cells[row]?.[column] ?? '') !== '') return null
    }
  }
  return [...merges, { row: top, column: left, colSpan, ...(rowSpan > 1 ? { rowSpan } : {}) }]
}

export function mergeSheetCells(cells: SheetCells, merges: SheetCellMerge[], row: number, startColumn: number, endColumn: number): SheetCellMerge[] | null {
  return mergeSheetRange(cells, merges, { anchorRow: row, anchorColumn: startColumn, focusRow: row, focusColumn: endColumn })
}

export function unmergeSheetCell(merges: SheetCellMerge[], row: number, column: number): SheetCellMerge[] | null {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= MAX_SHEET_ROWS || column < 0 || column >= MAX_SHEET_COLUMNS) return null
  const target = merges.find(merge => isValidSheetMerge(merge) && row >= merge.row && row < merge.row + (merge.rowSpan ?? 1) && column >= merge.column && column < merge.column + merge.colSpan)
  return target ? merges.filter(merge => merge !== target) : null
}
