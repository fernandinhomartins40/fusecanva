import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { createServer } from 'vite'

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function imageDrawing(relId, alt, widthEmu, heightEmu) {
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="1" name="Fixture" descr="${alt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

async function docxFixture({ body, relationships, media = {} }) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr/></w:body></w:document>`)
  zip.file('word/_rels/document.xml.rels', `<Relationships>${relationships}</Relationships>`)
  for (const [path, bytes] of Object.entries(media)) zip.file(`word/media/${path}`, bytes)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', 'base64')
// Minimal JPEG SOF fixture with a 3x2 frame; image import validates its raster header.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00])

test('DOCX embedded PNG and JPEG images import in order and survive export-import roundtrip', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const rels = [
      '<Relationship Id="rPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/>',
      '<Relationship Id="rJpeg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.jpg"/>',
    ].join('')
    const body = `<w:p><w:r><w:t>Before</w:t></w:r>${imageDrawing('rPng', 'Pixel icon', 171450, 342900)}<w:r><w:t>between</w:t></w:r>${imageDrawing('rJpeg', 'Portrait', 257175, 428625)}<w:r><w:t>After</w:t></w:r></w:p>`
    const source = await docxFixture({ body, relationships: rels, media: { 'pixel.png': png, 'photo.jpg': jpeg } })
    const imported = await parseDocx(asArrayBuffer(source), 'Images.docx')

    assert.deepEqual(imported.blocks.map(block => block.type), ['paragraph', 'image', 'paragraph', 'image', 'paragraph'])
    assert.equal(imported.blocks[0].text, 'Before')
    assert.equal(imported.blocks[2].text, 'between')
    assert.equal(imported.blocks[4].text, 'After')
    assert.deepEqual(imported.blocks[1].image, { src: `data:image/png;base64,${png.toString('base64')}`, alt: 'Pixel icon', width: 18, height: 36 })
    assert.deepEqual(imported.blocks[3].image, { src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, alt: 'Portrait', width: 27, height: 45 })

    const roundTrip = await parseDocx(asArrayBuffer(await createDocxBytes(imported.blocks)), 'Images-roundtrip.docx')
    assert.deepEqual(roundTrip.blocks.map(block => block.type), imported.blocks.map(block => block.type))
    assert.deepEqual(roundTrip.blocks.filter(block => block.type === 'image').map(block => block.image), imported.blocks.filter(block => block.type === 'image').map(block => block.image))
    assert.deepEqual(roundTrip.blocks.filter(block => block.type === 'paragraph').map(block => block.text), ['Before', 'between', 'After'])
  } finally { await vite.close() }
})

test('DOCX embedded images inside editable table cells preserve cell, alt text, bytes, and dimensions', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const { createDocxBytes } = await vite.ssrLoadModule('/src/docx-export.ts')
    const relationships = '<Relationship Id="rCell" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cell.png"/>'
    const body = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Logo</w:t></w:r>${imageDrawing('rCell', 'Marca da equipe', 190500, 95250)}</w:p></w:tc><w:tc><w:p><w:r><w:t>Texto alternativo</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    const fixture = await docxFixture({ body, relationships, media: { 'cell.png': png } })
    const imported = await parseDocx(asArrayBuffer(fixture), 'Tabela-com-imagem.docx')
    const table = imported.blocks[0]
    assert.equal(table.type, 'table')
    assert.deepEqual(table.cells, [['Logo', 'Texto alternativo']])
    assert.deepEqual(table.cellImages, { '0:0': [{ src: `data:image/png;base64,${png.toString('base64')}`, alt: 'Marca da equipe', width: 20, height: 10 }] })

    const exported = await createDocxBytes(imported.blocks)
    const zip = await JSZip.loadAsync(exported)
    const xml = await zip.file('word/document.xml').async('string')
    assert.match(xml, /<w:t\b[^>]*>Logo<\/w:t>[\s\S]*<pic:blipFill>/, 'cell text and embedded drawing are serialized in the same table cell')
    const mediaBytes = await zip.file('word/media/fuse-image-1.png').async('uint8array')
    assert.deepEqual(Buffer.from(mediaBytes), png)
    const roundTrip = await parseDocx(asArrayBuffer(exported), 'Tabela-com-imagem-roundtrip.docx')
    assert.deepEqual(roundTrip.blocks[0].cells, table.cells)
    assert.deepEqual(roundTrip.blocks[0].cellImages, table.cellImages)
  } finally { await vite.close() }
})

test('DOCX image import rejects external relationships and invalid embedded raster bytes', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseDocx } = await vite.ssrLoadModule('/src/docx-import.ts')
    const external = await docxFixture({
      body: `<w:p>${imageDrawing('rExternal', 'remote', 9525, 9525)}</w:p>`,
      relationships: '<Relationship Id="rExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/image.png" TargetMode="External"/>',
    })
    await assert.rejects(() => parseDocx(asArrayBuffer(external)), /Imagens externas vinculadas/)

    const invalidBytes = await docxFixture({
      body: `<w:p>${imageDrawing('rBad', 'invalid', 9525, 9525)}</w:p>`,
      relationships: '<Relationship Id="rBad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/bad.png"/>',
      media: { 'bad.png': Buffer.from('not a PNG raster') },
    })
    await assert.rejects(() => parseDocx(asArrayBuffer(invalidBytes)))
  } finally { await vite.close() }
})
