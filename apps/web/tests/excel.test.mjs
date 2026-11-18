import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { createServer } from 'vite'

async function makeBuffer(workbook) {
  const value = await workbook.xlsx.writeBuffer()
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

test('XLSX import preserves workbook sheets, formulas, supported formats and horizontal merges', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseExcelWorkbook, writeExcelWorkbook } = await vite.ssrLoadModule('/src/excel.ts')
    const workbook = new ExcelJS.Workbook()
    const sales = workbook.addWorksheet('Vendas')
    sales.getCell('A1').value = 'Produto'
    sales.getCell('B1').value = 2
    sales.getCell('C1').value = { formula: 'B1*3', result: 6 }
    sales.getCell('B1').numFmt = 'R$ #,##0.00'
    sales.getCell('D1').value = new Date('2026-10-21T00:00:00.000Z')
    sales.getCell('D1').numFmt = 'dd/mm/yyyy'
    sales.getCell('E1').value = 0.5
    sales.getCell('E1').numFmt = 'hh:mm:ss'
    sales.getCell('F1').value = new Date('2026-10-21T13:15:30.000Z')
    sales.getCell('F1').numFmt = 'dd/mm/yyyy hh:mm:ss'
    sales.mergeCells('A2:B2')
    sales.getCell('A2').value = 'Total'
    const summary = workbook.addWorksheet('Resumo anual')
    summary.getCell('A1').value = { formula: "'Vendas'!B1+'Vendas'!C1", result: 8 }
    summary.getCell('A2').value = 0.25
    summary.getCell('A2').numFmt = '0.00%'

    const sheets = await parseExcelWorkbook(await makeBuffer(workbook))
    assert.equal(sheets.length, 2)
    assert.equal(sheets[0].name, 'Vendas')
    assert.deepEqual(sheets[0].cells, [['Produto', '2', '=B1*3', '2026-10-21T00:00:00.000Z', '0.5', '2026-10-21T13:15:30.000Z'], ['Total', '', '', '', '', '']])
    assert.deepEqual(sheets[0].cellMerges, [{ row: 1, column: 0, colSpan: 2 }])
    assert.deepEqual(sheets[0].cellFormats, { '0:1': 'currency', '0:3': 'date', '0:4': 'time', '0:5': 'datetime' })
    assert.deepEqual(sheets[1].cells, [["='Vendas'!B1+'Vendas'!C1"], ['0.25']])
    assert.deepEqual(sheets[1].cellFormats, { '1:0': 'percentage' })
    const output = await writeExcelWorkbook(sheets)
    const roundTrip = await parseExcelWorkbook(output)
    assert.deepEqual(roundTrip.map(sheet => sheet.name), ['Vendas', 'Resumo anual'])
    assert.deepEqual(roundTrip[0].cells[0], ['Produto', '2', '=B1*3', '2026-10-21T00:00:00.000Z', '0.5', '2026-10-21T13:15:30.000Z'])
    assert.deepEqual(roundTrip[0].cellMerges, [{ row: 1, column: 0, colSpan: 2 }])
    assert.deepEqual(roundTrip[0].cellFormats, { '0:1': 'currency', '0:3': 'date', '0:4': 'time', '0:5': 'datetime' })
    assert.equal(roundTrip[0].cells[0][3], '2026-10-21T00:00:00.000Z')
    assert.deepEqual(roundTrip[1].cells[0], ["='Vendas'!B1+'Vendas'!C1"])
    assert.deepEqual(roundTrip[1].cellFormats, { '1:0': 'percentage' })
    const identifierRoundTrip = await parseExcelWorkbook(await writeExcelWorkbook([{ name: 'Códigos', cells: [['00123']] }]))
    assert.equal(identifierRoundTrip[0].cells[0][0], '00123')
  } finally { await vite.close() }
})

test('XLSX import rejects oversized files and excessive worksheets and round-trips vertical merges', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { MAX_EXCEL_IMPORT_BYTES, parseExcelWorkbook, writeExcelWorkbook } = await vite.ssrLoadModule('/src/excel.ts')
    await assert.rejects(parseExcelWorkbook(new ArrayBuffer(MAX_EXCEL_IMPORT_BYTES + 1)), /5 MB/)
    const manySheets = new ExcelJS.Workbook()
    for (let index = 0; index < 101; index += 1) manySheets.addWorksheet(`Sheet ${index + 1}`)
    await assert.rejects(parseExcelWorkbook(await makeBuffer(manySheets)), /100 abas/)
    const tooManyRows = new ExcelJS.Workbook()
    tooManyRows.addWorksheet('Rows').getCell(1001, 1).value = 'x'
    await assert.rejects(parseExcelWorkbook(await makeBuffer(tooManyRows)), /1.000 linhas/)
    const tooManyColumns = new ExcelJS.Workbook()
    tooManyColumns.addWorksheet('Columns').getCell(1, 201).value = 'x'
    await assert.rejects(parseExcelWorkbook(await makeBuffer(tooManyColumns)), /200 colunas/)
    const verticalMerge = new ExcelJS.Workbook()
    const verticalSheet = verticalMerge.addWorksheet('Vertical')
    verticalSheet.mergeCells('A1:A2')
    verticalSheet.getCell('A1').value = 'Mesclado'
    verticalSheet.getCell('B1').value = 'Vizinho'
    const importedVertical = await parseExcelWorkbook(await makeBuffer(verticalMerge))
    assert.deepEqual(importedVertical[0].cells, [['Mesclado', 'Vizinho'], ['', '']], 'merged bounds define imported rows even when covered rows have no values')
    assert.deepEqual(importedVertical[0].cellMerges, [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }])
    const exportedVertical = await parseExcelWorkbook(await writeExcelWorkbook(importedVertical))
    assert.deepEqual(exportedVertical[0].cellMerges, importedVertical[0].cellMerges, 'vertical merge range survives export and reimport')
    await assert.rejects(writeExcelWorkbook([{ name: 'Planilha inválida', cells: [['x']] }, { name: 'Planilha inválida', cells: [['y']] }]), /nome da aba/)
  } finally { await vite.close() }
})
