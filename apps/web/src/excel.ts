import ExcelJS from 'exceljs'
import { parseCellAddress, type SheetCellMerge, type SheetCells, type SheetNumberFormat } from './sheet'
import { excelSerialToDate, parseExcelDateText } from './sheet-dates'

export const MAX_EXCEL_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_EXCEL_SHEETS = 100
const MAX_EXCEL_ROWS = 1000
const MAX_EXCEL_COLUMNS = 200
const MAX_EXCEL_CELLS = 500_000

export type ImportedExcelSheet = { name: string; cells: SheetCells; cellMerges: SheetCellMerge[]; cellFormats: Record<string, SheetNumberFormat> }

type ExcelFormulaImportMode = 'formula' | 'cached-result'

function toCellText(value: ExcelJS.CellValue, formulaMode: ExcelFormulaImportMode = 'formula'): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every(item => item && typeof item === 'object' && 'text' in item)) return value.map(item => item.text).join('')
  if (typeof value === 'object') {
    if ('formula' in value && typeof value.formula === 'string') {
      if (formulaMode === 'cached-result' && 'result' in value && value.result !== undefined) return toCellText(value.result, formulaMode)
      return `=${value.formula}`
    }
    if ('sharedFormula' in value && typeof value.sharedFormula === 'string') {
      if (formulaMode === 'cached-result' && 'result' in value && value.result !== undefined) return toCellText(value.result, formulaMode)
      return `=${value.sharedFormula}`
    }
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('error' in value && typeof value.error === 'string') return value.error
    if ('hyperlink' in value && typeof value.hyperlink === 'string') return String(value.text ?? value.hyperlink)
  }
  return String(value)
}

function formatFromExcelNumberFormat(value: string | undefined): SheetNumberFormat {
  if (!value) return 'default'
  const clean = value.replace(/"[^"]*"|\\.|_.|\*./g, '').replace(/\[[^\]]*\]/g, '').toLowerCase()
  if (value.includes('%')) return 'percentage'
  const currencyFormat = value.replace(/\[\$-[^\]]+\]/gi, '')
  if (/\p{Sc}|R\$/u.test(currencyFormat)) return 'currency'
  const hasDate = /[dy]/.test(clean) || /(^|[^a-z])m{1,4}([^a-z]|$)/.test(clean) && /[-/]/.test(clean)
  const hasTime = /h{1,2}|s{1,2}|am\/pm/.test(clean)
  if (hasDate && hasTime) return 'datetime'
  if (hasDate) return 'date'
  if (hasTime) return 'time'
  return 'default'
}

function parseMerge(range: string): SheetCellMerge {
  const parts = range.split(':')
  if (parts.length !== 2) throw new Error('A planilha contém uma mesclagem inválida.')
  const start = parseCellAddress(parts[0])
  const end = parseCellAddress(parts[1])
  if (!start || !end || end.row < start.row || end.column < start.column || (end.row === start.row && end.column === start.column)) {
    throw new Error('A planilha contém uma mesclagem inválida.')
  }
  return {
    row: start.row,
    column: start.column,
    colSpan: end.column - start.column + 1,
    ...(end.row > start.row ? { rowSpan: end.row - start.row + 1 } : {}),
  }
}

export async function parseExcelWorkbook(source: ArrayBuffer, options: { formulaMode?: ExcelFormulaImportMode } = {}): Promise<ImportedExcelSheet[]> {
  if (source.byteLength > MAX_EXCEL_IMPORT_BYTES) throw new Error('O arquivo Excel deve ter no máximo 5 MB.')
  if (source.byteLength === 0) throw new Error('O arquivo Excel está vazio.')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(source)
  if (workbook.worksheets.length === 0) throw new Error('O arquivo Excel não contém planilhas.')
  if (workbook.worksheets.length > MAX_EXCEL_SHEETS) throw new Error(`O arquivo Excel aceita até ${MAX_EXCEL_SHEETS} abas.`)

  let totalCells = 0
  return workbook.worksheets.map((worksheet, index) => {
    let lastRow = 0
    let lastColumn = 0
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (_cell, columnNumber) => {
        lastRow = Math.max(lastRow, rowNumber)
        lastColumn = Math.max(lastColumn, columnNumber)
      })
    })

    const cellMerges = (worksheet.model.merges ?? []).map(parseMerge)
    for (const merge of cellMerges) {
      lastRow = Math.max(lastRow, merge.row + (merge.rowSpan ?? 1))
      lastColumn = Math.max(lastColumn, merge.column + merge.colSpan)
    }
    const rows = Math.max(1, lastRow)
    const columns = Math.max(1, lastColumn)
    if (rows > MAX_EXCEL_ROWS) throw new Error(`A aba “${worksheet.name}” excede ${MAX_EXCEL_ROWS.toLocaleString('pt-BR')} linhas.`)
    if (columns > MAX_EXCEL_COLUMNS) throw new Error(`A aba “${worksheet.name}” excede ${MAX_EXCEL_COLUMNS} colunas.`)
    totalCells += rows * columns
    if (totalCells > MAX_EXCEL_CELLS) throw new Error('O arquivo Excel excede o limite de 500 mil células.')

    const cells = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''))
    const cellFormats: Record<string, SheetNumberFormat> = {}
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (cell.isMerged && cell.master.address !== cell.address) return
        const rowIndex = rowNumber - 1
        const columnIndex = columnNumber - 1
        const format = formatFromExcelNumberFormat(cell.numFmt)
        const value = cell.value
        const cachedFormulaValue = options.formulaMode === 'cached-result' && value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value) && 'result' in value && value.result !== undefined
          ? value.result
          : undefined
        const valueToImport = cachedFormulaValue === undefined ? value : cachedFormulaValue
        if (format === 'time' && valueToImport instanceof Date) {
          const seconds = valueToImport.getUTCHours() * 3600 + valueToImport.getUTCMinutes() * 60 + valueToImport.getUTCSeconds() + valueToImport.getUTCMilliseconds() / 1000
          cells[rowIndex][columnIndex] = String(seconds / 86400)
        } else cells[rowIndex][columnIndex] = toCellText(value, options.formulaMode)
        if (format !== 'default') cellFormats[`${rowIndex}:${columnIndex}`] = format
      })
    })
    return { name: worksheet.name || `Planilha ${index + 1}`, cells, cellMerges, cellFormats }
  })
}

export async function writeExcelWorkbook(sheets: Array<{ name: string; cells?: SheetCells; cellMerges?: SheetCellMerge[]; cellFormats?: Record<string, SheetNumberFormat> }>): Promise<ArrayBuffer> {
  if (!sheets.length || sheets.length > MAX_EXCEL_SHEETS) throw new Error(`O arquivo Excel aceita de 1 a ${MAX_EXCEL_SHEETS} abas.`)
  const workbook = new ExcelJS.Workbook()
  const usedNames = new Set<string>()
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const name = sheet.name.trim()
    if (!name || name.length > 31 || /[\\/?*:[\]]/.test(name) || name.startsWith("'") || name.endsWith("'") || usedNames.has(name.toLocaleLowerCase())) {
      throw new Error(`O nome da aba “${name}” não é válido para Excel.`)
    }
    usedNames.add(name.toLocaleLowerCase())
    const worksheet = workbook.addWorksheet(name)
    for (const [rowIndex, row] of (sheet.cells ?? []).entries()) {
      for (const [columnIndex, value] of row.entries()) {
        if (value === '') continue
        const cell = worksheet.getCell(rowIndex + 1, columnIndex + 1)
        const numberFormat = sheet.cellFormats?.[`${rowIndex}:${columnIndex}`]
        if (value.startsWith('=')) cell.value = { formula: value.slice(1) }
        else if (numberFormat === 'date' || numberFormat === 'datetime') {
          const serial = parseExcelDateText(value)
          cell.value = serial === null ? value : excelSerialToDate(serial) ?? serial
        }
        else if (value.trim() !== '' && Number.isFinite(Number(value)) && String(Number(value)) === value) cell.value = Number(value)
        else cell.value = value
        if (numberFormat === 'currency') cell.numFmt = 'R$ #,##0.00'
        else if (numberFormat === 'percentage') cell.numFmt = '0.00%'
        else if (numberFormat === 'date') cell.numFmt = 'dd/mm/yyyy'
        else if (numberFormat === 'time') cell.numFmt = 'hh:mm:ss'
        else if (numberFormat === 'datetime') cell.numFmt = 'dd/mm/yyyy hh:mm:ss'
      }
    }
    for (const merge of sheet.cellMerges ?? []) worksheet.mergeCells(
      merge.row + 1,
      merge.column + 1,
      merge.row + (merge.rowSpan ?? 1),
      merge.column + merge.colSpan,
    )
    if (sheetIndex === 0) workbook.views = [{ x: 0, y: 0, width: 10_000, height: 10_000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]
  }
  workbook.calcProperties.fullCalcOnLoad = true
  const bytes = await workbook.xlsx.writeBuffer()
  const result = new Uint8Array(bytes)
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)
}
