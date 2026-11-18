import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { createServer } from 'vite'
import { generateBulkDocuments, generateBulkPages, parseBulkDelimited } from '../src/bulk-create.mjs'

test('bulk import parses quoted commas, escaped quotes and tabs', () => {
  assert.deepEqual(parseBulkDelimited('\uFEFFNome,Mensagem\r\nAna,"Olá, mundo"\r\nBia,"Ela disse ""oi"""'), [
    ['Nome', 'Mensagem'], ['Ana', 'Olá, mundo'], ['Bia', 'Ela disse "oi"'],
  ])
  assert.deepEqual(parseBulkDelimited('Nome\tCargo\nCaio\tDesigner'), [['Nome', 'Cargo'], ['Caio', 'Designer']])
})

test('bulk import preserves quoted multiline fields and CRLF records', () => {
  assert.deepEqual(parseBulkDelimited('Nome;Observação\r\nAna;"linha 1\r\nlinha 2"\r\nBia;"texto; com delimitador"\r\n'), [
    ['Nome', 'Observação'], ['Ana', 'linha 1\r\nlinha 2'], ['Bia', 'texto; com delimitador'],
  ])
  assert.deepEqual(parseBulkDelimited('Nome,"Nota, interna"\nLia,"A\nB"\n'), [
    ['Nome', 'Nota, interna'], ['Lia', 'A\nB'],
  ])
})

test('bulk import rejects an unterminated quoted field with a useful error', () => {
  assert.throws(() => parseBulkDelimited('Nome,Nota\nLia,"texto sem fim'), /campo entre aspas sem fechamento/)
})

test('bulk generation consumes records from an explicitly selected XLSX worksheet', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Rascunho').addRows([['Campo'], ['Ignorar']])
  workbook.addWorksheet('Campanha').addRows([['Nome', 'E-mail'], ['Lia', 'lia@example.com'], ['Noah', 'noah@example.com']])
  const bytes = await workbook.xlsx.writeBuffer()
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseExcelWorkbook } = await vite.ssrLoadModule('/src/excel.ts')
    const sheets = await parseExcelWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.equal(sheets.length, 2)
    const selected = sheets[1]
    const [fields, ...records] = selected.cells
    assert.deepEqual(fields, ['Nome', 'E-mail'])
    let serial = 0
    const page = { id: 'source', name: 'Convite', background: '#fff', elements: [{ id: 'heading', type: 'text', text: 'Nome aqui', x: 0, y: 0, width: 100, height: 30 }] }
    const variants = generateBulkPages(page, records, { heading: fields.indexOf('Nome') }, kind => `${kind}-${++serial}`)
    assert.deepEqual(variants.map(item => item.elements[0].text), ['Lia', 'Noah'])
  } finally { await vite.close() }
})

test('bulk XLSX import uses cached formula results but exposes formulas without a cached result', async () => {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Valores')
  worksheet.addRow(['Nome', 'Total em cache', 'Total sem cache'])
  worksheet.addRow(['Lia', { formula: '1+2', result: 3 }, { formula: 'A2&"!"' }])
  const bytes = await workbook.xlsx.writeBuffer()
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseExcelWorkbook } = await vite.ssrLoadModule('/src/excel.ts')
    const [normalImport] = await parseExcelWorkbook(source)
    const [bulkImport] = await parseExcelWorkbook(source, { formulaMode: 'cached-result' })
    assert.deepEqual(normalImport.cells[1], ['Lia', '=1+2', '=A2&"!"'], 'normal spreadsheet import retains editable formulas')
    assert.deepEqual(bulkImport.cells[1], ['Lia', '3', '=A2&"!"'], 'bulk import substitutes cached values and leaves uncached formulas visible for review')
  } finally { await vite.close() }
})

test('bulk generation creates one identity-safe page per record and substitutes only bound text', () => {
  const page = { id: 'source', name: 'Convite', background: '#fff', elements: [
    { id: 'heading', type: 'text', text: 'Nome aqui', x: 10, y: 15, width: 200, height: 30, color: '#123', fontSize: 28, fontFamily: 'Arial', bold: true },
    { id: 'shape', type: 'shape', shape: 'rect', x: 20, y: 50, width: 80, height: 40, fill: '#f00' },
  ], connectors: [{ id: 'connector-source', fromId: 'heading', toId: 'shape', color: '#222', strokeWidth: 2 }], groups: [{ id: 'group-source', name: 'Grupo', elementIds: ['heading', 'shape'] }] }
  let serial = 0
  const variants = generateBulkPages(page, [['Ana'], ['Bia']], { heading: 0 }, kind => `${kind}-${++serial}`)
  assert.equal(variants.length, 2)
  assert.deepEqual(variants.map(item => item.elements[0].text), ['Ana', 'Bia'])
  assert.deepEqual(variants.map(item => item.elements[0].bold), [true, true])
  assert.equal(variants[0].elements[1].fill, '#f00')
  assert.notEqual(variants[0].id, variants[1].id)
  assert.notEqual(variants[0].elements[0].id, variants[1].elements[0].id)
  assert.equal(variants[0].connectors[0].fromId, variants[0].elements[0].id, 'connector references are remapped to cloned elements')
  assert.equal(variants[0].groups[0].elementIds[1], variants[0].elements[1].id, 'group membership follows cloned element identities')
  assert.equal(page.elements[0].text, 'Nome aqui', 'generation leaves the source page unchanged')
})

test('bulk individual output creates separate active projects while retaining folder and page identity', () => {
  const source = { id: 'source-project', name: 'Convites', type: 'design', width: 800, height: 600, folderId: 'folder-1', archivedAt: 'old', pages: [], updatedAt: 'old-time' }
  const pages = [{ id: 'page-a', name: 'Convites · 1', elements: [] }, { id: 'page-b', name: 'Convites · 2', elements: [] }]
  let serial = 0
  const documents = generateBulkDocuments(source, pages, kind => `${kind}-${++serial}`, '2026-10-23T12:00:00.000Z')
  assert.equal(documents.length, 2)
  assert.deepEqual(documents.map(document => document.id), ['design-1', 'design-2'])
  assert.deepEqual(documents.map(document => document.name), ['Convites · 1', 'Convites · 2'])
  assert.deepEqual(documents.map(document => document.pages[0].id), ['page-a', 'page-b'])
  assert.ok(documents.every(document => document.pages.length === 1 && document.width === 800 && document.folderId === 'folder-1' && document.updatedAt === '2026-10-23T12:00:00.000Z' && !document.archivedAt))
  assert.equal(source.archivedAt, 'old', 'generation does not mutate its source')
})
