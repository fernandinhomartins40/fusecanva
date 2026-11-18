import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { createServer } from 'vite'

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

test('DOCX export creates an editable OPC package and round-trips supported Docs blocks', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const blocks = [
      { id: 'h', type: 'heading', text: 'R&D <Q> "One"' },
      { id: 's', type: 'subheading', text: 'Subheading' },
      { id: 'p', type: 'paragraph', text: 'Plain & formatted', marks: [{ start: 8, end: 12, bold: true, underline: true }, { start: 12, end: 17, italic: true, strike: true }, { start: 12, end: 14, bold: true }] },
      { id: 'q', type: 'quote', text: 'A quotation' },
      { id: 'b', type: 'bullet', text: 'List item' },
      { id: 't', type: 'table', text: '', cells: [['Name', 'Value'], ['A&B', '<5']] },
    ]
    const bytes = await createDocxBytes(blocks, 'A < B & C')
    assert.ok(bytes instanceof Uint8Array)
    const zip = await JSZip.loadAsync(bytes)
    for (const path of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml']) assert.ok(zip.file(path), `package includes ${path}`)
    const documentXml = await zip.file('word/document.xml').async('string')
    assert.match(documentXml, /R&amp;D &lt;Q&gt; &quot;One&quot;/)
    assert.match(documentXml, /<w:u w:val="single"\/>/, 'DOCX serializes underline as an explicit single underline')
    assert.match(documentXml, /<w:strike\/>/, 'DOCX serializes strikethrough')
    const roundTrip = await parseDocx(asArrayBuffer(bytes), 'A < B & C.docx')
    assert.equal(roundTrip.title, 'A < B & C')
    assert.deepEqual(roundTrip.blocks.map(block => block.type), blocks.map(block => block.type))
    assert.deepEqual(roundTrip.blocks.map(block => block.text), ['R&D <Q> "One"', 'Subheading', 'Plain & formatted', 'A quotation', 'List item', ''])
    assert.deepEqual(roundTrip.blocks[2].marks, [
      { start: 8, end: 12, bold: true, underline: true },
      { start: 12, end: 14, bold: true, italic: true, strike: true },
      { start: 14, end: 17, italic: true, strike: true },
    ])
    assert.deepEqual(roundTrip.blocks[5].cells, [['Name', 'Value'], ['A&B', '<5']])
  } finally { await vite.close() }
})

test('DOCX export preserves paragraph line breaks and tabs', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const bytes = await createDocxBytes([{ id: 'p', type: 'paragraph', text: 'one\ntwo\tthree' }])
    const result = await parseDocx(asArrayBuffer(bytes))
    assert.equal(result.blocks[0].text, 'one\ntwo\tthree')
  } finally { await vite.close() }
})

test('DOCX round-trip retains intentional empty paragraphs between supported text blocks', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const sourceBlocks = [
      { id: 'first', type: 'paragraph', text: 'Before the gap' },
      { id: 'gap', type: 'paragraph', text: '' },
      { id: 'last', type: 'heading', text: 'After the gap' },
    ]
    const result = await parseDocx(asArrayBuffer(await createDocxBytes(sourceBlocks)))
    assert.deepEqual(result.blocks.map(({ type, text }) => ({ type, text })), sourceBlocks.map(({ type, text }) => ({ type, text })))
  } finally { await vite.close() }
})

test('DOCX page export emits page breaks between model pages, including an empty page', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createDocxPagesBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const bytes = await createDocxPagesBytes([
      [{ id: 'first', type: 'heading', text: 'First page' }],
      [],
      [{ id: 'last', type: 'paragraph', text: 'Last page' }],
    ])
    const zip = await JSZip.loadAsync(bytes)
    const xml = await zip.file('word/document.xml').async('string')
    assert.equal((xml.match(/<w:br w:type="page"\/>/g) ?? []).length, 2)
    assert.ok(xml.indexOf('First page') < xml.indexOf('<w:br w:type="page"/>'))
    assert.ok(xml.indexOf('<w:br w:type="page"/>') < xml.indexOf('Last page'))
  } finally { await vite.close() }
})

test('DOCX page export enforces aggregate block and page limits', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createDocxPagesBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const blocks = Array.from({ length: 10_001 }, (_, index) => ({ id: String(index), type: 'paragraph', text: 'x' }))
    await assert.rejects(() => createDocxPagesBytes([blocks.slice(0, 5_000), blocks.slice(5_000)]), /até 10000 blocos/)
    await assert.rejects(() => createDocxPagesBytes(Array.from({ length: 1_001 }, () => [])), /até 1000 páginas/)
    const bigText = 'x'.repeat(1_000_001)
    await assert.rejects(() => createDocxPagesBytes([[{ id: 'one', type: 'paragraph', text: bigText }], [{ id: 'two', type: 'paragraph', text: bigText }]]), /2 milhões de caracteres/)
  } finally { await vite.close() }
})

test('DOCX export rejects invalid blocks, out-of-range marks, and oversized text', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    await assert.rejects(() => createDocxBytes([{ id: 'x', type: 'unsupported', text: 'bad' }]), /bloco inválido/)
    await assert.rejects(() => createDocxBytes([{ id: 'x', type: 'paragraph', text: 'abc', marks: [{ start: 0, end: 4, bold: true }] }]), /marcação.*inválida/)
    await assert.rejects(() => createDocxBytes([{ id: 'x', type: 'paragraph', text: 'x'.repeat(2_000_001) }]), /2 milhões/)
    await assert.rejects(() => createDocxBytes([{ id: 'x', type: 'table', text: '', cells: [] }]), /tabela.*inválidas/)
    await assert.rejects(() => createDocxBytes([{ id: 'x', type: 'table', text: '', cells: [['a']], merges: [{ row: 0, column: 0, colSpan: 2 }] }]), /table cell merge/)
    await assert.rejects(() => createDocxBytes([{ id: 'x', type: 'paragraph', text: 'bad\u0001xml' }]), /caracteres.*XML/)
  } finally { await vite.close() }
})
