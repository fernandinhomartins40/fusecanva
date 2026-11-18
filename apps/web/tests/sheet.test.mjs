import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('spreadsheet formulas calculate references, ranges, precedence, dependencies and cycles', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, setSheetCell } = await vite.ssrLoadModule('/src/sheet.ts')
    let cells = [['10', '5', '=A1+B1*2', '=SUM(A1:B1)', '=AVERAGE(A1:B1)', '=SOMA(A1:B1)', '=MÉDIA(A1:B1)'], ['', '', '=C1/2', '=MAX(A1:B1)', '=COUNT(A1:B1)']]
    cells = setSheetCell(cells, 2, 0, '=A3')
    cells = setSheetCell(cells, 2, 1, '=A3')
    const result = evaluateSheet(cells)
    assert.deepEqual(result.values[0], ['10', '5', '20', '15', '7.5', '15', '7.5'])
    assert.deepEqual(result.values[1].slice(2, 5), ['10', '10', '2'])
    assert.equal(result.values[2][0], '#CYCLE!')
    assert.ok(result.errors.includes('#CYCLE!'))
  } finally { await vite.close() }
})

test('spreadsheet formulas resolve cross-sheet references, quoted names, ranges and workbook cycles', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, renameSheetReferences } = await vite.ssrLoadModule('/src/sheet.ts')
    const workbook = [
      { name: 'Dados', cells: [['10'], ['5']] },
      { name: 'Resumo 2026', cells: [["='Dados'!A1+'Dados'!A2", '=SUM(Dados!A1:A2)', '=Dados!A1*2', '=COUNTIF(\'Dados\'!A1:A2,">5")', '=VLOOKUP(5,\'Dados\'!A1:A2,1,FALSE)', '=INDEX(\'Dados\'!A1:A2,MATCH(5,\'Dados\'!A1:A2,0))']] },
    ]
    const summary = evaluateSheet(workbook[1].cells, [], workbook, 'Resumo 2026')
    assert.deepEqual(summary.values[0], ['15', '15', '20', '1', '5', '5'])
    assert.deepEqual(renameSheetReferences([["='Dados'!A1", '=Dados!A2', '=SUM(Dados!A1:A2)', 'Texto Dados!A1']], 'Dados', 'Fonte anual'), [["='Fonte anual'!A1", "='Fonte anual'!A2", "=SUM('Fonte anual'!A1:A2)", 'Texto Dados!A1']])
    workbook[0].cells[0][0] = "='Resumo 2026'!A1"
    const cyclic = evaluateSheet(workbook[1].cells, [], workbook, 'Resumo 2026')
    assert.equal(cyclic.values[0][0], '#CYCLE!')
    assert.ok(cyclic.errors.includes('#CYCLE!'))
    assert.equal(evaluateSheet([['=Missing!A1']]).values[0][0], '#REF!')
    const numberedTabs = [{ name: 'Planilha 2', cells: [['7']] }, { name: 'Planilha 1', cells: [["='Planilha 2'!A1*3"]] }]
    assert.equal(evaluateSheet(numberedTabs[1].cells, [], numberedTabs, 'Planilha 1').values[0][0], '21')
  } finally { await vite.close() }
})

test('spreadsheet formulas calculate common scalar functions, comparisons and exponentiation', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['2', '0', 'texto', '=2^3^2', '=IF(A1>1,"ok","não")', '=AND(A1>1,B1=0)', '=OR(B1<>0,TRUE)', '=NOT(FALSE)', '=A1>1', '=50%^2'],
      ['=ROUND(3.14159,2)', '=ABS(-5)', '=CONCAT("Canva ",A1)', '=COUNTA(A1:C1)', '=SUM(A1:B1)', '=IF(A1=2;"sim";"não")'],
    ])
    assert.deepEqual(result.values[0], ['2', '0', 'texto', '512', 'ok', 'TRUE', 'TRUE', 'TRUE', 'TRUE', '0.25'])
    assert.deepEqual(result.values[1].slice(0, 6), ['3.14', '5', 'Canva 2', '3', '2', 'sim'])
    assert.deepEqual(result.errors, [])
  } finally { await vite.close() }
})

test('spreadsheet formulas round away from or toward zero at positive and negative precisions', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([[
      '=ROUNDUP(1.231,2)', '=ROUNDUP(-1.231,2)', '=ROUNDDOWN(1.239,2)', '=ROUNDDOWN(-1.239,2)',
      '=ROUNDUP(123,-1)', '=ROUNDDOWN(123,-1)', '=ARREDONDAR.PARA.CIMA(1.21,1)', '=ARREDONDAR.PARA.BAIXO(-1.21,1)',
    ]])
    assert.deepEqual(result.values[0], ['1.24', '-1.24', '1.23', '-1.23', '130', '120', '1.3', '-1.2'])
    assert.deepEqual(result.errors, [])
  } finally { await vite.close() }
})

test('spreadsheet formulas compose nested functions, lazy branches, text operators and error handling', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([[
      '2', '0', '=IF(A1>1,IF(B1=0,SUM(A1:B1),0),0)', '=SUM(IF(A1>1,A1,B1),2,3)', '=IF(FALSE,1/0,2)', '=IFERROR(1/0,7)', '=A1&" items"', '=50%', '=POWER(2,3)+1', '=SUM(A1:B1)',
    ]])
    assert.deepEqual(result.values[0], ['2', '0', '2', '7', '2', '7', '2 items', '0.5', '9', '2'])
    assert.deepEqual(result.errors, [])
  } finally { await vite.close() }
})

test('spreadsheet conditional aggregates match numeric, text and wildcard criteria across ranges', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['2', '10', '=COUNTIF(A1:A5,">=5")', '=SUMIF(A1:A5,">5",B1:B5)', '=AVERAGEIF(A1:A5,">=5",B1:B5)', '=COUNTIF(A1:A5,"a*")', '=COUNTIFS(A1:A5,">=5",B1:B5,"<30")', '=SUMIFS(B1:B5,A1:A5,">=5",B1:B5,">20")', '=AVERAGEIFS(B1:B5,A1:A5,">=5")', '=CONT.SE(A1:A5;">=5")', '=SOMASE(A1:A5;">5";B1:B5)'],
      ['5', '20'],
      ['8', '30'],
      ['apple', '40'],
      ['', '50'],
    ])
    assert.deepEqual(result.values[0].slice(2), ['2', '30', '25', '1', '1', '30', '25', '2', '30'])
    assert.deepEqual(result.errors, [])
    const invalid = evaluateSheet([['1', '2', '=SUMIF(A1:A1,">0",B1:B2)']])
    assert.equal(invalid.values[0][2], '#VALUE!')
    assert.ok(invalid.errors.includes('#VALUE!'))
  } finally { await vite.close() }
})

test('spreadsheet lookups support exact and approximate vertical, horizontal and XLOOKUP modes', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['1', 'Ana', '100', '=VLOOKUP(3,A1:C4,2,FALSE)', '=VLOOKUP(4,A1:C4,3,TRUE)', '=XLOOKUP("Bob",B1:B4,C1:C4,"none")', '=XLOOKUP(4,A1:A4,B1:B4,"none",-1)', '=XLOOKUP(4,A1:A4,B1:B4,"none",1)', '=XLOOKUP("Z",B1:B4,C1:C4,"ausente")', '=VLOOKUP(3,A1:C4,4,FALSE)'],
      ['3', 'Bob', '300'],
      ['5', 'Cam', '500'],
      ['8', 'Dan', '800'],
      ['Q1', 'Q2', 'Q3', '=HLOOKUP("Q2",A5:C6,2,FALSE)'],
      ['10', '20', '30'],
    ])
    assert.deepEqual(result.values[0].slice(3), ['Bob', '300', '300', 'Bob', 'Cam', 'ausente', '#REF!'])
    assert.equal(result.values[4][3], '20')
    assert.ok(result.errors.includes('#REF!'))
    const missing = evaluateSheet([['=VLOOKUP(9,B1:C2,2,FALSE)', '1', 'x'], ['', '2', 'y']])
    assert.equal(missing.values[0][0], '#N/A')
    assert.ok(missing.errors.includes('#N/A'))
  } finally { await vite.close() }
})

test('spreadsheet INDEX and MATCH compose for exact and approximate row and column lookups', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['1', 'Ana', '100', '=INDEX(A1:C3,MATCH("Bob",B1:B3,0),3)', '=MATCH(4,A1:A3,1)', '=INDEX(A1:C3,2,2)', '=INDEX(A1:C3,4,1)', '=MATCH("missing",B1:B3,0)'],
      ['3', 'Bob', '300'],
      ['5', 'Cam', '500'],
      ['8', '', '=MATCH(4,A4:A6,-1)'],
      ['5'],
      ['3'],
    ])
    assert.deepEqual(result.values[0].slice(3), ['300', '2', 'Bob', '#REF!', '#N/A'])
    assert.equal(result.values[3][2], '2')
    assert.ok(result.errors.includes('#REF!'))
    assert.ok(result.errors.includes('#N/A'))
  } finally { await vite.close() }
})

test('spreadsheet date and time formulas use Excel serials and preserve display formats', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, formatSheetCellValue } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([[
      '=YEAR(DATE(2026,10,21))', '=MONTH(DATE(2026,10,21))', '=DAY(DATE(2026,10,21))', '=WEEKDAY(DATE(2026,10,21),2)', '=DATEVALUE("21/10/2026")=DATE(2026,10,21)', '=HOUR(TIME(13,15,30))', '=MINUTE(TIME(13,15,30))', '=SECOND(TIME(13,15,30))', '=NETWORKDAYS(DATE(2026,10,19),DATE(2026,10,23))', '=DAY(WORKDAY(DATE(2026,10,23),1))', '=DAY(EDATE(DATE(2024,1,31),1))', '=DAY(EOMONTH(DATE(2026,2,1),0))', '=DAY(DATE(1900,2,29))', '=HOUR(TIMEVALUE("1:15 PM"))', '=YEAR(DATEVALUE("2026-10-21T00:00:00+03:00"))', '=YEAR(DATE(-1,1,1))', '=DATEVALUE("2026-02-30")',
    ], ['2026-10-21T00:00:00.000Z', '=YEAR(A2)', '=A2=DATE(2026,10,21)', '=A2+1', '=TIME(13,15,30)']])
    assert.deepEqual(result.values[0], ['2026', '10', '21', '3', 'TRUE', '13', '15', '30', '5', '26', '29', '28', '29', '13', '2026', '#NUM!', '#VALUE!'])
    assert.deepEqual(result.values[1].slice(1, 3), ['2026', 'TRUE'])
    assert.equal(formatSheetCellValue(result.values[1][3], 'date'), '22/10/2026')
    assert.equal(formatSheetCellValue(result.values[1][4], 'time'), '13:15:30')
    assert.equal(formatSheetCellValue('60', 'date'), '29/02/1900')
    assert.ok(result.errors.includes('#NUM!'))
    assert.ok(result.errors.includes('#VALUE!'))
  } finally { await vite.close() }
})

test('spreadsheet fill-down adjusts relative formula rows while retaining absolute references', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { fillSheetDown, formatSheetCellValue } = await vite.ssrLoadModule('/src/sheet.ts')
    const cells = [['1', '=A1*2', '=$A1+$B$1'], ['', '', ''], ['', '', '']]
    const filled = fillSheetDown(cells, { anchorRow: 0, anchorColumn: 1, focusRow: 2, focusColumn: 2 })
    assert.deepEqual(filled.map(row => row.slice(1)), [['=A1*2', '=$A1+$B$1'], ['=A2*2', '=$A2+$B$1'], ['=A3*2', '=$A3+$B$1']])
    assert.equal(formatSheetCellValue('0.25', 'percentage'), '25%')
    assert.match(formatSheetCellValue('12.5', 'currency'), /R\$\s?12,50/)
    assert.equal(formatSheetCellValue('#DIV/0!', 'currency'), '#DIV/0!')
  } finally { await vite.close() }
})

test('spreadsheet addresses support base-26 columns and bounded rectangular cell writes', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { columnLabel, parseCellAddress, setSheetCell } = await vite.ssrLoadModule('/src/sheet.ts')
    assert.equal(columnLabel(0), 'A')
    assert.equal(columnLabel(25), 'Z')
    assert.equal(columnLabel(26), 'AA')
    assert.deepEqual(parseCellAddress('$AA$12'), { row: 11, column: 26 })
    assert.equal(parseCellAddress('A0'), null)
    const cells = setSheetCell([['x']], 1, 2, '=1+2')
    assert.deepEqual(cells, [['x', '', ''], ['', '', '=1+2']])
    assert.equal(setSheetCell(cells, 1000, 0, 'ignored'), cells)
  } finally { await vite.close() }
})

test('spreadsheet pastes bounded rectangular ranges without changing cells outside the target', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { pasteSheetRange } = await vite.ssrLoadModule('/src/sheet.ts')
    const initial = [['keep', 'outside', ''], ['', '', 'tail']]
    assert.deepEqual(pasteSheetRange(initial, 0, 1, [['A', 'B'], ['1', '=B2+1']]), [['keep', 'A', 'B'], ['', '1', '=B2+1']])
    assert.equal(pasteSheetRange(initial, 999, 0, [['x'], ['y']]), initial)
    assert.equal(pasteSheetRange(initial, 0, 199, [['x', 'y']]), initial)
    assert.equal(pasteSheetRange(initial, -1, 0, [['x']]), initial)
  } finally { await vite.close() }
})

test('internal spreadsheet copies translate relative formula references and retain absolute references and string literals', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { translateCopiedSheetRange, translateSheetFormula } = await vite.ssrLoadModule('/src/sheet.ts')
    assert.equal(translateSheetFormula('=SUM(A1:B2)+$C1+D$2+$E$3+"A1"', 1, 1), '=SUM(B2:C3)+$C2+E$2+$E$3+"A1"')
    assert.equal(translateSheetFormula("='Dados anuais'!A1+Dados!$B2", -1, -1), "=#REF!+Dados!$B1")
    assert.deepEqual(translateCopiedSheetRange([['=A1', '=$A1'], ['=A2', '="A1"']], 0, 0, 2, 1), [['=B3', '=$A3'], ['=B4', '="A1"']])
  } finally { await vite.close() }
})

test('horizontal sheet merges preserve anchor formulas, zero covered references, and unmerge cleanly', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, mergeSheetCells, unmergeSheetCell } = await vite.ssrLoadModule('/src/sheet.ts')
    const cells = [['', '', '=1+2', '', '=D1*2']]
    const merged = mergeSheetCells(cells, [], 0, 2, 3)
    assert.deepEqual(merged, [{ row: 0, column: 2, colSpan: 2 }])
    assert.equal(evaluateSheet(cells, merged).values[0][2], '3')
    assert.equal(evaluateSheet(cells, merged).values[0][3], '0')
    assert.equal(evaluateSheet(cells, merged).values[0][4], '0')
    assert.equal(mergeSheetCells([['', 'occupied']], [], 0, 0, 1), null)
    assert.deepEqual(unmergeSheetCell(merged, 0, 3), [])
    assert.equal(unmergeSheetCell([], 0, 0), null)
  } finally { await vite.close() }
})

test('rectangular sheet merges cover vertical cells, preserve the anchor, reject overlap, and unmerge from covered cells', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, mergeSheetRange, unmergeSheetCell } = await vite.ssrLoadModule('/src/sheet.ts')
    const cells = [['=2+3', '', 'tail'], ['', '', ''], ['', '', '']]
    const range = { anchorRow: 1, anchorColumn: 1, focusRow: 0, focusColumn: 0 }
    const merged = mergeSheetRange(cells, [], range)
    assert.deepEqual(merged, [{ row: 0, column: 0, colSpan: 2, rowSpan: 2 }])
    const result = evaluateSheet(cells, merged)
    assert.equal(result.values[0][0], '5')
    assert.equal(result.values[0][1], '0')
    assert.equal(result.values[1][0], '0')
    assert.equal(result.values[1][1], '0')
    assert.equal(mergeSheetRange(cells, [{ row: 1, column: 1, colSpan: 2 }], range), null)
    assert.equal(mergeSheetRange([['=1', ''], ['', 'occupied']], [], range), null)
    assert.deepEqual(unmergeSheetCell(merged, 1, 1), [])
  } finally { await vite.close() }
})

test('editing the final formula token recalculates dependencies through a rectangular merged anchor and undo restores values', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet, setSheetCell } = await vite.ssrLoadModule('/src/sheet.ts')
    const { recordDocumentChange, undoDocumentChange } = await vite.ssrLoadModule('/src/documentHistory.ts')
    const merge = { row: 6, column: 2, colSpan: 2, rowSpan: 2 }
    const before = { cells: Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => '')) }
    before.cells[0][0] = '=4+0'
    before.cells[0][2] = '=8/2'
    before.cells[6][2] = '=A1+C1'
    before.cells[6][4] = '=C7*2'
    before.cells[6][5] = '=D8*2'
    const changed = { ...before, cells: setSheetCell(before.cells, 0, 0, '=4+2') }
    const history = recordDocumentChange({ document: before, undoStack: [], redoStack: [] }, changed)
    const result = evaluateSheet(changed.cells, [merge])
    assert.deepEqual([result.values[0][0], result.values[6][2], result.values[6][4], result.values[6][5]], ['6', '10', '20', '0'])
    const undone = undoDocumentChange(history)
    const restored = evaluateSheet(undone.document.cells, [merge])
    assert.deepEqual([undone.document.cells[0][0], restored.values[0][0], restored.values[6][2], restored.values[6][4], restored.values[6][5]], ['=4+0', '4', '8', '16', '0'])
    assert.deepEqual(undone.redoStack, [changed])
  } finally { await vite.close() }
})

