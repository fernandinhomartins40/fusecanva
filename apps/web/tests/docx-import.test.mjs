import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { createServer } from 'vite'

async function docxBuffer(documentXml, { withMainType = true } = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', withMainType
    ? '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    : '<Types><Default Extension="xml" ContentType="application/xml"/></Types>')
  zip.file('word/document.xml', documentXml)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

const document = body => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`

test('DOCX import maps headings, paragraph text, inline bold/italic, and simple tables', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const source = await docxBuffer(document(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Resumo &amp; título</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Texto </w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>destacado</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nome</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Valor</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    ))
    const result = await parseDocx(source, 'Relatório.docx')
    assert.equal(result.title, 'Relatório')
    assert.deepEqual(result.blocks.map(block => block.type), ['heading', 'paragraph', 'table'])
    assert.equal(result.blocks[0].text, 'Resumo & título')
    assert.equal(result.blocks[1].text, 'Texto destacado')
    assert.deepEqual(result.blocks[1].marks, [{ start: 6, end: 15, bold: true, italic: true }])
    assert.deepEqual(result.blocks[2].cells, [['Nome', 'Valor'], ['A', '']])
    assert.equal(new Set(result.blocks.map(block => block.id)).size, result.blocks.length)
  } finally { await vite.close() }
})

test('DOCX import preserves underline and strike per run and ignores explicitly disabled marks', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const source = await docxBuffer(document('<w:p>' +
      '<w:r><w:t>A</w:t></w:r>' +
      '<w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t>BC</w:t></w:r>' +
      '<w:r><w:rPr><w:i/><w:strike/></w:rPr><w:t>DE</w:t></w:r>' +
      '<w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>F</w:t></w:r>' +
      '<w:r><w:rPr><w:strike w:val="0"/></w:rPr><w:t>G</w:t></w:r>' +
      '<w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>H</w:t></w:r>' +
      '</w:p>'))
    const result = await parseDocx(source)
    assert.equal(result.blocks[0].text, 'ABCDEFGH')
    assert.deepEqual(result.blocks[0].marks, [
      { start: 1, end: 3, bold: true, underline: true },
      { start: 3, end: 5, italic: true, strike: true },
    ])
  } finally { await vite.close() }
})

test('DOCX import recognizes quote, subtitle, and numbered-list paragraphs as reusable block types', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const source = await docxBuffer(document(
      '<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>Subtítulo</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>Citação</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>'
    ))
    const result = await parseDocx(source)
    assert.deepEqual(result.blocks.map(block => block.type), ['subheading', 'quote', 'bullet'])
  } finally { await vite.close() }
})

test('DOCX table horizontal merges round-trip through gridSpan as editable Docs cells', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const body = '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Cabeçalho</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Nome</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qtd.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Valor</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const imported = await parseDocx(await docxBuffer(document(body)))
    assert.deepEqual(imported.blocks[0].cells, [['Cabeçalho', '', 'Total'], ['Nome', 'Qtd.', 'Valor']])
    assert.deepEqual(imported.blocks[0].merges, [{ row: 0, column: 0, colSpan: 2 }])
    const exported = await createDocxBytes(imported.blocks)
    const zip = await JSZip.loadAsync(exported)
    const xml = await zip.file('word/document.xml').async('string')
    assert.match(xml, /<w:gridSpan w:val="2"\/>/)
    const roundTrip = await parseDocx(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
    assert.deepEqual(roundTrip.blocks[0].cells, imported.blocks[0].cells)
    assert.deepEqual(roundTrip.blocks[0].merges, imported.blocks[0].merges)
    const orphanContinuation = await docxBuffer(document('<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>'))
    await assert.rejects(() => parseDocx(orphanContinuation), /vertical merge continuation has no matching origin/)
  } finally { await vite.close() }
})

test('DOCX table vertical merges round-trip through vMerge as editable Docs cells', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const body = '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Grupo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Superior</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>Inferior</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Outro grupo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Final</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const imported = await parseDocx(await docxBuffer(document(body)))
    assert.deepEqual(imported.blocks[0].cells, [['Grupo', 'Superior'], ['', 'Inferior'], ['Outro grupo', 'Final']])
    assert.deepEqual(imported.blocks[0].merges, [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }])
    const exported = await createDocxBytes(imported.blocks)
    const zip = await JSZip.loadAsync(exported)
    const xml = await zip.file('word/document.xml').async('string')
    assert.match(xml, /<w:vMerge w:val="restart"\/>/)
    assert.match(xml, /<w:vMerge\/>/)
    const roundTrip = await parseDocx(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
    assert.deepEqual(roundTrip.blocks[0].cells, imported.blocks[0].cells)
    assert.deepEqual(roundTrip.blocks[0].merges, imported.blocks[0].merges)
  } finally { await vite.close() }
})

test('DOCX import rejects invalid archives, incomplete packages, unsafe XML, and oversized input', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    await assert.rejects(() => parseDocx(new Uint8Array([1, 2, 3]).buffer), /DOCX ou ZIP válido/)
    const wrongContentType = await docxBuffer(document('<w:p><w:r><w:t>Text</w:t></w:r></w:p>'), { withMainType: false })
    await assert.rejects(() => parseDocx(wrongContentType), /identificado como um documento DOCX válido/)
    const unsafeXml = await docxBuffer('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><w:document><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>')
    await assert.rejects(() => parseDocx(unsafeXml), /declarações não permitidas/)
    await assert.rejects(() => parseDocx(new ArrayBuffer(10 * 1024 * 1024 + 1)), /no máximo 10 MB/)
  } finally { await vite.close() }
})

test('DOCX import checks the uncompressed ZIP footprint before loading document contents', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const large = 'x'.repeat(41 * 1024 * 1024)
    const source = await docxBuffer(document(`<w:p><w:r><w:t>${large}</w:t></w:r></w:p>`))
    await assert.rejects(() => parseDocx(source), /descompactado do DOCX excede 40 MB/)
  } finally { await vite.close() }
})
