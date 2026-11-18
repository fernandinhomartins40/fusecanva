import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { deflateSync } from 'node:zlib'
import { createServer } from 'vite'

const slide = (name, body, background = '') => `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld name="${name}">${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp>${body}</p:sp></p:spTree></p:cSld></p:sld>`
const rect = (id, name, x, y, width, height, color, geometry = 'rect') => `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr>`
const textbox = (id, name, text, x = 0) => `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${text}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody>`

function png(width = 1, height = 1) {
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
  const chunk = (name, data) => { const type = Buffer.from(name); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([len, type, data, crc]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const scanline = Buffer.alloc(1 + width * 4 * height)
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanline)), chunk('IEND', Buffer.alloc(0))])
}

function jpeg(width = 1, height = 1) {
  const bytes = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xd9])
  bytes[7] = (height >>> 8) & 255; bytes[8] = height & 255; bytes[9] = (width >>> 8) & 255; bytes[10] = width & 255
  return bytes
}

async function pptxBuffer({ external = false, withNotes = true, unsupported = false, geometries, pictureBytes, pictureTarget = "../media/photo.png", pictureRef = "rIdImg", pictureCount = 1 } = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="5143500"/><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>')
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`)
  const secondShape = unsupported
    ? '<p:pic><p:nvPicPr/><p:blipFill/><p:spPr/></p:pic>'
    : `<p:sp>${textbox(2, 'Título', 'Olá &amp; mundo', 914400)}</p:sp>`
  let firstSlideShapes = geometries
    ? geometries.map((geometry, index) => `<p:sp>${rect(index + 2, `Forma ${index + 1}`, 914400, 1828800, 1828800, 914400, '00AABB', geometry)}</p:sp>`).join('')
    : `<p:sp>${rect(2, 'Cartão', 914400, 1828800, 1828800, 914400, '00AABB')}</p:sp>`
  if (pictureBytes) for (let n = 0; n < pictureCount; n++) firstSlideShapes += `<p:pic><p:nvPicPr><p:cNvPr id="${9+n}" name="Foto" descr="Texto alternativo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${pictureRef}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="900000"><a:off x="2743200" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  zip.file('ppt/slides/slide1.xml', slide('Primeiro', firstSlideShapes))
  zip.file('ppt/slides/slide2.xml', slide('Segundo', secondShape, '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:bgPr></p:bg>'))
  if (withNotes) {
    zip.file('ppt/slides/_rels/slide2.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>')
    zip.file('ppt/notesSlides/notesSlide2.xml', `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp>${textbox(2, 'Notes', 'Presenter notes')}</p:sp></p:spTree></p:cSld></p:notes>`)
  }
  if (external) zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/></Relationships>')
  if (pictureBytes) {
    zip.file(`ppt/media/photo.${pictureTarget.toLowerCase().endsWith('.jpg') ? 'jpg' : 'png'}`, pictureBytes)
    zip.file('ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${pictureRef}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${pictureTarget}"/></Relationships>`)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

test('PPTX import preserves slide order, dimensions, basic objects, names, solid colors, and notes', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parsePptx } = await vite.ssrLoadModule('/src/pptx-import.ts')
    const document = await parsePptx(await pptxBuffer(), 'Board.pptx')
    assert.equal(document.type, 'presentation')
    assert.equal(document.name, 'Board')
    assert.deepEqual([document.width, document.height], [960, 540])
    assert.deepEqual(document.pages.map(page => page.name), ['Segundo', 'Primeiro'], 'slide order follows presentation relationships, not filenames')
    assert.equal(document.pages[0].background, '#abcdef')
    assert.deepEqual(document.pages[0].elements[0], {
      id: 'pptx-1-1', type: 'text', name: 'Título', x: 96, y: 0, width: 96, height: 48, rotation: 0,
      text: 'Olá & mundo', fontSize: 32, fontFamily: 'Aptos', color: '#123456', bold: true,
    })
    assert.equal(document.pages[0].presenterNotes, 'Presenter notes')
    assert.deepEqual(document.pages[1].elements[0], {
      id: 'pptx-2-1', type: 'shape', name: 'Cartão', x: 96, y: 192, width: 192, height: 96,
      rotation: 0, shape: 'rect', fill: '#00aabb', cornerRadius: 0,
    })
  } finally { await vite.close() }
})

test('PPTX import maps unambiguous DrawingML rectangle, ellipse, triangle, and star5 presets', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parsePptx } = await vite.ssrLoadModule('/src/pptx-import.ts')
    const document = await parsePptx(await pptxBuffer({ geometries: ['rect', 'ellipse', 'triangle', 'star5'] }))
    const shapes = document.pages[1].elements
    assert.deepEqual(shapes.map(shape => shape.type === 'shape' ? shape.shape : null), ['rect', 'ellipse', 'triangle', 'star'])
    assert.ok(shapes.every(shape => shape.type === 'shape' && shape.fill === '#00aabb' && shape.width === 192 && shape.height === 96 && shape.rotation === 0))
  } finally { await vite.close() }
})

test('PPTX import resolves embedded PNG/JPEG and preserves editable image geometry and alternative text', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parsePptx } = await vite.ssrLoadModule('/src/pptx-import.ts')
    for (const [bytes, mime] of [[png(), 'image/png'], [jpeg(), 'image/jpeg']]) {
      const document = await parsePptx(await pptxBuffer({ pictureBytes: bytes, pictureTarget: mime === 'image/png' ? '../media/photo.png' : '../media/photo.jpg' }))
      const image = document.pages[1].elements[1]
      assert.equal(image.type, 'image')
      assert.equal(image.src, `data:${mime};base64,${bytes.toString('base64')}`)
      assert.deepEqual([image.x, image.y, image.width, image.height, image.rotation], [288, 96, 192, 96, 15])
      assert.deepEqual([image.sourceWidth, image.sourceHeight, image.altText, image.name], [1, 1, 'Texto alternativo', 'Foto'])
    }
    await assert.rejects(async () => parsePptx(await pptxBuffer({ pictureBytes: png(), pictureTarget: '../media/missing.png' })), /parte ausente/)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ pictureBytes: Buffer.concat([png(), Buffer.alloc(8 * 1024 * 1024)]) })), /limite de 8 MB/)
    const oversizedDimensions = png(); oversizedDimensions.writeUInt32BE(5000, 16); oversizedDimensions.writeUInt32BE(4000, 20)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ pictureBytes: oversizedDimensions })), /16 megapixels/)
    const atPixelLimit = png(); atPixelLimit.writeUInt32BE(4000, 16); atPixelLimit.writeUInt32BE(4000, 20)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ pictureBytes: atPixelLimit, pictureCount: 2 })), /64 MB de mem.ria decodificada/)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ pictureBytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })), /PNG ou JPEG/)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ pictureBytes: png(), pictureTarget: 'https://example.test/image.png' })))
  } finally { await vite.close() }
})

test('PPTX import rejects external relationships, unsupported slide objects, malformed XML, and invalid packages', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parsePptx } = await vite.ssrLoadModule('/src/pptx-import.ts')
    await assert.rejects(() => parsePptx(new Uint8Array([1, 2, 3]).buffer), /ZIP/)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ external: true })), /externa/)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ unsupported: true, withNotes: false })), /tipos de objeto/)
    await assert.rejects(async () => parsePptx(await pptxBuffer({ geometries: ['hexagon'] })), /geometria/)
    const adjusted = await JSZip.loadAsync(await pptxBuffer({ geometries: ['star5'] }))
    const slideXml = await adjusted.file('ppt/slides/slide1.xml').async('string')
    adjusted.file('ppt/slides/slide1.xml', slideXml.replace('<a:avLst/>', '<a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst>'))
    await assert.rejects(async () => parsePptx(await adjusted.generateAsync({ type: 'arraybuffer' })), /ajustes personalizados/)
    const unsafe = await pptxBuffer()
    const zip = await JSZip.loadAsync(unsafe)
    zip.file('ppt/slides/slide1.xml', '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><p:sld/>')
    await assert.rejects(async () => parsePptx(await zip.generateAsync({ type: 'arraybuffer' })))
  } finally { await vite.close() }
})



