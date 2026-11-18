import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII='

test('PPTX emits native text and basic shapes, while unsupported slides use raster fallback', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const JSZip = (await import('jszip')).default
    const exporter = await vite.ssrLoadModule('/src/pptx-export.ts')
    const base = { id: 'one', name: 'Title', x: 10, y: 20, width: 300, height: 80, rotation: 0 }
    const editablePage = {
      id: 'slide-a', name: 'Native', background: '#fff', elements: [
        { ...base, type: 'text', text: 'Hello <world>', fontSize: 32, fontFamily: 'Arial', color: '#123456', bold: true },
        { ...base, id: 'two', name: 'Oval', type: 'shape', shape: 'ellipse', fill: '#abc', cornerRadius: 0 },
      ],
    }
    const fallbackPage = {
      id: 'slide-b', name: 'Image', background: '#ffffff', elements: [
        { ...base, type: 'image', src: 'data:image/png;base64,AA==', altText: 'not represented natively' },
      ],
    }
    const bytes = await exporter.createPptxBytes(1920, 1080, [pixel, pixel], [editablePage, fallbackPage])
    const zip = await JSZip.loadAsync(bytes)
    const nativeXml = await zip.file('ppt/slides/slide1.xml').async('string')
    assert.match(nativeXml, /<a:srgbClr val="FFFFFF"\/>/)
    assert.match(nativeXml, /<a:prstGeom prst="ellipse"/)
    assert.match(nativeXml, /name="Title"/)
    assert.match(nativeXml, /Hello &lt;world&gt;/)
    assert.match(nativeXml, /sz="12" b="1"/)
    assert.equal(zip.file('ppt/media/slide1.png'), null)
    const fallbackXml = await zip.file('ppt/slides/slide2.xml').async('string')
    assert.match(fallbackXml, /<p:pic>/)
    assert.ok(zip.file('ppt/media/slide2.png'))
    await assert.rejects(exporter.createPptxBytes(1920, 1080, [pixel, pixel], [editablePage]), /page count/)
  } finally {
    await vite.close()
  }
})

test('PPTX embeds supported PNG images as native picture objects with ordered slide relationships', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const JSZip = (await import('jszip')).default
    const exporter = await vite.ssrLoadModule('/src/pptx-export.ts')
    const image = {
      id: 'photo', name: 'Photo & caption', type: 'image', x: 50, y: 60, width: 400, height: 300, rotation: 15,
      src: pixel, altText: 'A sample photo',
    }
    const pages = [
      { id: 'first', name: 'First', background: '#ffffff', elements: [] },
      { id: 'second', name: 'Second', background: '#ffffff', elements: [image] },
      { id: 'third', name: 'Third', background: '#ffffff', elements: [{ ...image, id: 'unsupported', crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }] },
    ]
    const bytes = await exporter.createPptxBytes(1920, 1080, [pixel, pixel, pixel], pages)
    const zip = await JSZip.loadAsync(bytes)
    const presentationRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string')
    const slideIds = [...presentationRels.matchAll(/Id="rId\d+" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slide" Target="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(slideIds, ['slides/slide1.xml', 'slides/slide2.xml', 'slides/slide3.xml'])

    const nativeSlide = await zip.file('ppt/slides/slide2.xml').async('string')
    assert.match(nativeSlide, /<p:pic>/)
    assert.match(nativeSlide, /descr="A sample photo"/)
    assert.match(nativeSlide, /r:embed="rId2"/)
    assert.match(nativeSlide, /rot="900000"/)
    const rels = await zip.file('ppt/slides/_rels/slide2.xml.rels').async('string')
    assert.match(rels, /Id="rId2"[^>]+Target="\.\.\/media\/slide2-image1\.png"/)
    const embedded = await zip.file('ppt/media/slide2-image1.png').async('uint8array')
    assert.deepEqual([...embedded.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const contentTypes = await zip.file('[Content_Types].xml').async('string')
    assert.match(contentTypes, /Extension="png" ContentType="image\/png"/)
    const fallbackXml = await zip.file('ppt/slides/slide3.xml').async('string')
    assert.match(fallbackXml, /r:embed="rId2"/)
    assert.ok(zip.file('ppt/media/slide3.png'))
  } finally {
    await vite.close()
  }
})

test('PPTX preserves editable straight lines and free-draw spline geometry, while complex lines fall back', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const JSZip = (await import('jszip')).default
    const exporter = await vite.ssrLoadModule('/src/pptx-export.ts')
    const line = {
      id: 'line', name: 'Straight', type: 'shape', shape: 'line', x: 5, y: 8, width: 240, height: 16, rotation: 0,
      fill: '#8e7cf5', cornerRadius: 0, strokeWidth: 8, curveOffset: null,
    }
    const freeDraw = {
      id: 'spline', name: 'Spline', type: 'free-draw', x: 10, y: 20, width: 100, height: 80, rotation: 0,
      points: [0, 0, 30, 60, 70, 20, 100, 80], color: '#336699', strokeWidth: 4,
    }
    const unsupportedArrow = { ...line, id: 'arrow-line', name: 'Arrow line', endArrow: true }
    const pages = [
      { id: 'supported', name: 'Supported', background: '#ffffff', elements: [line, freeDraw] },
      { id: 'fallback-arrow', name: 'Arrow fallback', background: '#ffffff', elements: [unsupportedArrow] },
    ]
    const bytes = await exporter.createPptxBytes(1920, 1080, [pixel, pixel], pages)
    const zip = await JSZip.loadAsync(bytes)
    const supported = await zip.file('ppt/slides/slide1.xml').async('string')
    assert.match(supported, /name="Straight"/)
    assert.match(supported, /<a:moveTo><a:pt x="0" y="8000"\/><\/a:moveTo><a:lnTo><a:pt x="240000" y="8000"\/><\/a:lnTo>/)
    assert.match(supported, /<a:srgbClr val="8E7CF5"\/>/)
    assert.match(supported, /<a:ln w="38100" cap="rnd"/)
    assert.match(supported, /name="Spline"/)
    assert.match(supported, /<a:cubicBezTo>/)
    assert.match(supported, /<a:pt x="100000" y="80000"\/><\/a:cubicBezTo>/)
    assert.match(supported, /<a:srgbClr val="336699"\/>/)
    assert.match(supported, /<a:ln w="19050" cap="rnd"/)
    assert.doesNotMatch(supported, /NaN|undefined/)
    const fallback = await zip.file('ppt/slides/slide2.xml').async('string')
    assert.match(fallback, /<p:pic>/)
    assert.ok(zip.file('ppt/media/slide2.png'))
  } finally {
    await vite.close()
  }
})
