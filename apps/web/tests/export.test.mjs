import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type)
  const crcInput = Buffer.concat([name, data])
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(crcInput), 8 + data.length)
  return chunk
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(1, 0)
ihdr.writeUInt32BE(1, 4)
ihdr[8] = 8
ihdr[9] = 6
const pixel = `data:image/png;base64,${Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 30, 120, 210, 255]))),
  pngChunk('IEND', Buffer.alloc(0)),
]).toString('base64')}`

test('PDF export produces one physical PDF page for each design page', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const exporter = await vite.ssrLoadModule('/src/export.ts')
    const altText = 'Descrição específica para a foto do projeto.'
    const descriptions = exporter.createPdfPageDescriptions({ pages: [{ id: 'page-1', name: 'Página', elements: [
      { id: 'text-1', type: 'text', text: 'Conteúdo longo. '.repeat(240), x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      { id: 'image-1', type: 'image', name: 'Foto', src: pixel, altText, decorative: false, x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      { id: 'image-2', type: 'image', name: 'Fundo', src: pixel, altText: 'Ignorar imagem decorativa', decorative: true, x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    ] }] })
    assert.ok(descriptions[0].includes(`Imagem: ${altText}`), 'explicit image alternative survives long page text')
    assert.ok(!descriptions[0].includes('Ignorar imagem decorativa'))
    await assert.rejects(exporter.createPdfBytes(0, 1123, [pixel]), /largura e altura maiores que zero/)
    await assert.rejects(exporter.createPdfBytes(794, 1123, [{ data: 'data:image/png;base64,AAAA', width: 794, height: 1123 }]), /assinatura PNG inválida/)
    await assert.rejects(exporter.createPdfBytes(794, 1123, [{ data: '', width: 794, height: 1123 }]), /imagem PNG inválida/)
    const corruptPng = Buffer.from(pixel.split(',')[1], 'base64')
    corruptPng[29] ^= 0xff
    await assert.rejects(exporter.createPdfBytes(794, 1123, [{ data: `data:image/png;base64,${corruptPng.toString('base64')}`, width: 794, height: 1123 }]), /assinatura PNG inválida/)
    const truncatedPng = Buffer.from(pixel.split(',')[1], 'base64').subarray(0, -12)
    await assert.rejects(exporter.createPdfBytes(794, 1123, [{ data: `data:image/png;base64,${truncatedPng.toString('base64')}`, width: 794, height: 1123 }]), /assinatura PNG inválida/)
    const pageDescriptions = ['Página inicial: título e apresentação.', 'Página final: ilustração descrita.']
    const bytes = await exporter.createPdfBytes(794, 1123, [pixel, pixel], true, pageDescriptions)
    const source = new TextDecoder().decode(bytes)
    assert.match(source, /^%PDF-/)
    assert.equal((source.match(/\/Type \/Page\b/g) ?? []).length, 2)
    assert.match(source, /\/MediaBox \[0 0 595\.5 842\.25\]/)
    const objectBody = (pdf, reference) => pdf.match(new RegExp(`(?:^|\\n)${reference} 0 obj\\n([\\s\\S]*?)\\nendobj`))?.[1] ?? ''
    const catalogRef = Number(source.match(/(\d+) 0 obj\s*<<\s*\/Type \/Catalog/)?.[1])
    const catalog = objectBody(source, catalogRef)
    const structureRootRef = Number(catalog.match(/\/StructTreeRoot (\d+) 0 R/)?.[1])
    const structureRoot = objectBody(source, structureRootRef)
    const documentRef = Number(structureRoot.match(/\/K (\d+) 0 R/)?.[1])
    const documentNode = objectBody(source, documentRef)
    const sectionRefs = [...(documentNode.match(/\/K \[([^\]]+)\]/)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map(match => Number(match[1]))
    assert.match(catalog, /\/MarkInfo << \/Marked true >>/)
    assert.match(catalog, /\/Lang \(pt-BR\)/)
    assert.match(structureRoot, /\/Type \/StructTreeRoot/, JSON.stringify({ catalogRef, structureRootRef, catalog, structureRoot }))
    assert.match(objectBody(source, Number(structureRoot.match(/\/ParentTree (\d+) 0 R/)?.[1])), /\/Nums \[0 \[\d+ 0 R\] 1 \[\d+ 0 R\]\]/)
    assert.equal(sectionRefs.length, 2, 'Document structure contains one section per output page')
    const figureRefs = sectionRefs.map(reference => { const section = objectBody(source, reference); return Number(section.match(/\/K \[(\d+) 0 R/)?.[1] ?? section.match(/\/K (\d+) 0 R/)?.[1]) })
    assert.equal(figureRefs.length, 2)
    for (const reference of figureRefs) {
      const figure = objectBody(source, reference)
      assert.match(figure, /\/S \/Figure/)
      assert.match(figure, /\/Type \/MCR/)
      assert.match(figure, /\/MCID 0/)
      assert.match(figure, /\/Alt <FEFF[0-9A-F]+>/, 'each raster page has a Unicode page description')
    }
    assert.match(source, /\/StructParents 0/)
    assert.match(source, /\/StructParents 1/)
    const uncompressed = new TextDecoder().decode(await exporter.createPdfBytes(794, 1123, [pixel, pixel], false, pageDescriptions))
    const pageContentObject = pdf => { const ref = pdf.match(/\/Contents (\d+) 0 R/)?.[1]; return ref ? pdf.match(new RegExp(`${ref} 0 obj([\\s\\S]*?)endobj`))?.[1] ?? '' : '' }
    assert.match(pageContentObject(source), /\/Filter \/FlateDecode/, 'Digital compact option uses jsPDF compression for page content streams')
    assert.doesNotMatch(pageContentObject(uncompressed), /\/Filter \/FlateDecode/, 'turning compression off emits uncompressed page content streams')
    assert.match(pageContentObject(uncompressed), /\/Figure <<\/MCID 0>> BDC[\s\S]*?EMC/, 'raster image drawing commands are enclosed by marked Figure content')
    assert.equal((source.match(/\/Type \/Page\b/g) ?? []).length, (uncompressed.match(/\/Type \/Page\b/g) ?? []).length, 'compression preference does not change document page count')
    const variablePageBytes = await exporter.createPdfBytes(794, 1123, [
      { data: pixel, width: 794, height: 1123 },
      { data: pixel, width: 794, height: 1600 },
    ])
    const variablePageSource = new TextDecoder().decode(variablePageBytes)
    assert.equal((variablePageSource.match(/\/Type \/Page\b/g) ?? []).length, 2)
    assert.match(variablePageSource, /\/MediaBox \[0 0 595\.5 1200\.?\]/)
    assert.equal(exporter.safeFileName(' Cartaz da manhã '), 'Cartaz-da-manhã')
    assert.equal(exporter.safeFileName('  '), 'design')
    const blocks = [
      { id: 'long-text', type: 'paragraph', text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau', marks: [{ start: 0, end: 5, bold: true }, { start: 6, end: 10, italic: true }] },
      { id: 'second-block', type: 'quote', text: 'The final words must remain after a page boundary.' },
    ]
    const pages = exporter.paginateDocBlocks(blocks, 250, 230, text => text.length * 8)
    assert.ok(pages.length > 1)
    const allBlocks = pages.flat()
    const exportedText = allBlocks.map(block => block.text).join(' ').replace(/\s+/g, ' ').trim()
    const sourceText = blocks.map(block => block.text).join(' ').replace(/\s+/g, ' ').trim()
    const longTextFragments = allBlocks.filter(block => block.id === 'long-text')
    assert.equal(exportedText, sourceText)
    assert.equal(longTextFragments.length, 1, 'blocos longos permanecem inteiros e ocupam uma folha ampliada')

    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const drawnText = []
    const drawnTextPositions = []
    const drawnFonts = []
    const drawnRects = []
    const drawnLines = []
    const drawnBorders = []
    let activeLineDash = []
    const drawingScales = []
    const drawnImages = []
    const filteredPixelResults = []
    const imageTransforms = []
    const drawingStateStack = []
    const filledRects = []
    const context = {
      globalAlpha: 1,
      filter: 'none',
      scale(x, y) { drawingScales.push([x, y]); imageTransforms.push(['scale', x, y]) }, fillRect(x, y, width, height) { filledRects.push({ x, y, width, height, color: this.fillStyle }) }, save() { drawingStateStack.push({ alpha: this.globalAlpha, filter: this.filter }) }, restore() { const state = drawingStateStack.pop(); this.globalAlpha = state?.alpha ?? 1; this.filter = state?.filter ?? 'none' }, translate(x, y) { imageTransforms.push(['translate', x, y]) }, rotate() {}, drawImage(image, ...args) { drawnImages.push({ src: image.src, alpha: this.globalAlpha, filter: this.filter, args }) }, getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray([30, 120, 210, 255]) } }, putImageData(imageData) { filteredPixelResults.push([...imageData.data]) }, strokeRect(x, y, width, height) { drawnRects.push({ x, y, width, height }) }, beginPath() {}, moveTo(x, y) { drawnLines.push([x, y]) }, lineTo(x, y) { drawnLines.push([x, y]) }, setLineDash(dash) { activeLineDash = [...dash] }, stroke() { drawnBorders.push({ width: this.lineWidth, dash: [...activeLineDash], lineCap: this.lineCap }) }, closePath() {}, fill() {},
      measureText(text) { return { width: text.length * 8 } },
      fillText(text, x, y) { drawnText.push(text); drawnTextPositions.push([text, x, y]) },
    }
    let currentFont = ''
    Object.defineProperty(context, 'font', { get: () => currentFont, set: value => { currentFont = value; drawnFonts.push(value) } })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
    })
    const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { src = ''; async decode() {} } })
    try {
      const doc = { id: 'doc-1', name: 'Long Doc', type: 'doc', width: 250, height: 230, updatedAt: '', pages: [{ id: 'page-1', name: 'Page 1', background: '#fff', elements: [], blocks }] }
      const printedPages = await exporter.renderDocumentCanvases(doc)
      assert.ok(printedPages.length > 1)
      assert.ok(drawnText.some(line => line.includes('tau')))
      assert.ok(drawnFonts.some(font => font.includes('700')))
      assert.ok(drawnFonts.some(font => font.includes('italic')))
      filledRects.length = 0
      await exporter.renderDocumentCanvases({ ...doc, pages: [{ ...doc.pages[0], blocks: [{ id: 'decorated-text', type: 'paragraph', text: 'Under strike', marks: [{ start: 0, end: 5, underline: true }, { start: 6, end: 12, strike: true }] }] }] })
      const textDecorations = filledRects.filter(rect => rect.width > 0 && rect.width < 100 && rect.height > 0 && rect.height <= 2)
      assert.equal(textDecorations.length, 2, 'underline and strikethrough are drawn into exported text canvases')
      assert.notEqual(textDecorations[0].y, textDecorations[1].y, 'underline and strikethrough occupy their distinct baselines')
      const continuous = await exporter.renderDocumentCanvases(doc, true)
      assert.equal(continuous.length, 1)
      assert.ok(continuous[0].canvas.height > doc.height * 2)

      const pageSetupBlocks = Array.from({ length: 40 }, (_, index) => ({ id: `margin-${index}`, type: 'paragraph', text: `Margin pagination block ${index + 1}` }))
      const defaultMarginPages = exporter.paginateDocBlocks(pageSetupBlocks, 794, 1123, text => text.length * 8)
      const customMargins = { top: 144, right: 168, bottom: 192, left: 120 }
      const customMarginPages = exporter.paginateDocBlocks(pageSetupBlocks, 794, 1123, text => text.length * 8, customMargins)
      assert.ok(customMarginPages.length > defaultMarginPages.length, 'larger saved page margins reduce the available pagination area')
      drawnTextPositions.length = 0
      const customMarginDoc = { ...doc, width: 794, height: 1123, docPageSetup: { preset: 'a4', margins: customMargins }, pages: [{ ...doc.pages[0], blocks: [{ id: 'margin-anchor', type: 'paragraph', text: 'Page margin anchor' }] }] }
      await exporter.renderDocumentCanvases(customMarginDoc)
      assert.ok(drawnTextPositions.some(([, x]) => x === customMargins.left), `PDF canvas places text at the configured left margin: ${JSON.stringify(drawnTextPositions.slice(0, 5))}`)

      const tableRows = Array.from({ length: 6 }, (_, row) => Array.from({ length: 4 }, (_, column) => `cell ${row + 1}-${column + 1}`))
      tableRows[0][0] = 'á,1'
      const tableBlock = { id: 'table-1', type: 'table', text: '', cells: tableRows, cellPadding: 6, borderColor: '#123456', borderWidth: 2 }
      const tablePages = exporter.paginateDocBlocks([tableBlock], 250, 230, text => text.length * 5)
      assert.ok(tablePages.length > 1)
      assert.deepEqual(tablePages.flatMap(page => page.flatMap(block => block.cells ?? [])), tableRows)
      const tableDocument = { ...doc, width: 794, height: 230, pages: [{ ...doc.pages[0], blocks: [tableBlock] }] }
      const tableCanvases = await exporter.renderDocumentCanvases(tableDocument)
      assert.ok(tableCanvases.length > 1)
      assert.ok(drawnText.includes('cell 6-4'))
      assert.ok(drawnText.includes('á,1'))
      const tableImage = { src: pixel, alt: 'Foto do produto na tabela', width: 120, height: 80 }
      const tableWithImages = { id: 'table-with-images', type: 'table', text: '', cells: [['Produto', '']], cellImages: { '0:1': [tableImage], '0:0': [{ ...tableImage, src: 'https://example.invalid/image.png', alt: 'URL externa deve ser ignorada' }] } }
      drawnImages.length = 0
      const tableImageDoc = { ...doc, width: 794, height: 1123, pages: [{ ...doc.pages[0], blocks: [tableWithImages] }] }
      const tableImageCanvases = await exporter.renderDocumentCanvases(tableImageDoc)
      const embeddedTableDraws = drawnImages.filter(item => item.src === pixel)
      assert.equal(embeddedTableDraws.length, 1, 'safe embedded table images render, while external image URLs are ignored')
      assert.equal(embeddedTableDraws[0].args.length, 4, 'table image is drawn within a bounded cell rectangle')
      assert.ok(embeddedTableDraws[0].args[2] <= 120 && embeddedTableDraws[0].args[3] <= 80)
      assert.ok(tableImageCanvases[0].canvas.height >= 1123 * 2, 'table image contributes to the rendered page height')
      const tableImageSemantics = exporter.createPdfDocSemantics([tableWithImages])
      assert.equal(tableImageSemantics[0].role, 'Table')
      assert.equal(tableImageSemantics[0].children[0].children[1].children[0].role, 'Figure')
      assert.equal(tableImageSemantics[0].children[0].children[1].children[0].alt, 'Foto do produto na tabela')
      assert.ok(exporter.createPdfPageDescriptions(tableImageDoc)[0].includes('Foto do produto na tabela'), 'page description includes the image alternative from the table cell')
      const longSentences = Array.from({ length: 60 }, (_, index) => `REA-LINHA-${String(index + 1).padStart(2, '0')} conte\u00fado de laborat\u00f3rio para verificar a quebra de uma c\u00e9lula de tabela em p\u00e1ginas A4.`)
      const longRow = { id: 'long-a4-table', type: 'table', text: '', cells: [['Produto', 'Quantidade', 'Pre\u00e7o', 'Estado'], ['Caneca', '2', '15,50', 'Em an\u00e1lise'], ['Bloco', '3', '8,00', 'Conclu\u00eddo'], ['Novo Produto', longSentences.join('\n'), '', 'A revisar']], cellPadding: 20, cellBorders: { '3:1': { top: { style: 'dots', width: 2 } } } }
      const followingHeading = { id: 'long-a4-following-heading', type: 'heading', text: 'REA DOCUMENTO DE LABORATORIO' }
      const longDoc = { ...doc, width: 794, height: 1123, pages: [{ ...doc.pages[0], blocks: [longRow, followingHeading] }] }
      const longDocPages = exporter.paginateDocBlocks(longDoc.pages[0].blocks, longDoc.width, longDoc.height, text => text.length * 8)
      assert.ok(longDocPages.length > 1, 'the oversized cell is split across pages in this deterministic mock-metrics fixture')
      const longTablePages = longDocPages.map(page => page.filter(block => block.type === 'table'))
      assert.equal(longDocPages.at(-1).at(-1).id, followingHeading.id, 'the next heading follows all overflow fragments')
      assert.ok(longTablePages[0][0].cells[0].includes('Produto'), 'the table header starts on page one')
      assert.ok(longTablePages.slice(1).every(page => page.every(table => !table.cells.some(row => row.includes('Produto')))), 'the table header is not duplicated on following pages')
      assert.ok(longTablePages.slice(1).flat().some(table => table.cellBorders?.['0:1']?.top?.style === 'dots'), 'cell border metadata follows the split row onto later pages')
      const longCellChunks = []
      let collectingLongRow = false
      for (const table of longTablePages.flat()) {
        for (const row of table.cells) {
          if (row[0] === 'Novo Produto') collectingLongRow = true
          if (collectingLongRow) longCellChunks.push(row[1] ?? '')
        }
      }
      const reconstructedLongCell = longCellChunks.join(' ')
      const reconstructedMarkers = [...reconstructedLongCell.matchAll(/REA-LINHA-(\d{2})/g)].map(match => Number(match[1]))
      assert.deepEqual(reconstructedMarkers, Array.from({ length: 60 }, (_, index) => index + 1), 'all sixty source markers remain once and in order across split row fragments')
      assert.equal(reconstructedLongCell.replace(/\s+/g, ' ').trim(), longSentences.join(' ').replace(/\s+/g, ' ').trim(), 'splitting the row preserves every complete sentence')
      drawnText.length = 0
      const longDocCanvases = await exporter.renderDocumentCanvases(longDoc)
      assert.equal(longDocCanvases.length, longDocPages.length, 'every paginated A4 page is rendered')
      assert.ok(longDocCanvases.every(({ canvas }) => canvas.height === 2246), `the long row flows across normal-height A4 canvases instead of overflowing a page: ${JSON.stringify(longDocCanvases.map(({ canvas }) => canvas.height / 2))}`)
      const renderedMarkers = [...drawnText.join('').matchAll(/REA-LINHA-(\d{2})/g)].map(match => Number(match[1]))
      assert.deepEqual(renderedMarkers, Array.from({ length: 60 }, (_, index) => index + 1), 'rendered PDF canvas retains all sixty markers in order')
      const longPdfBytes = await exporter.createPdfBytes(794, 1123, longDocCanvases.map(() => pixel))
      const longPdfSource = new TextDecoder().decode(longPdfBytes)
      assert.equal((longPdfSource.match(/\/Type \/Page\b/g) ?? []).length, longDocPages.length, 'the PDF contains one physical page per long-row fragment')
      assert.equal((longPdfSource.match(/\/MediaBox \[0 0 595\.5 842\.25\]/g) ?? []).length, longDocPages.length, 'every physical page keeps the normal A4 dimensions')
      const mergedLongRowText = (prefix, label) => Array.from({ length: 30 }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')} ${label} long merged-cell content preserves paragraph order across PDF page boundaries.`).join('\n')
      const multiLongRows = {
        id: 'multi-long-rows', type: 'table', text: '',
        cells: [['Item', 'Description', 'Status'], ['A', mergedLongRowText('MERGE-A', 'first row'), ''], ['B', mergedLongRowText('MERGE-B', 'second row'), '']],
        merges: [{ row: 1, column: 1, colSpan: 2 }, { row: 2, column: 1, colSpan: 2 }],
        cellBorders: { '1:1': { top: { style: 'dots', width: 2 } }, '2:1': { bottom: { style: 'dashes', width: 1 } } },
        cellPadding: 16, tableSpacing: 3,
      }
      const multiLongPages = exporter.paginateDocBlocks([multiLongRows], 794, 1123, text => text.length * 8)
      const multiLongFragments = multiLongPages.flatMap(page => page.filter(block => block.type === 'table'))
      assert.ok(multiLongPages.length >= 4, `two long merged rows paginate over multiple A4 pages: ${multiLongPages.length}`)
      assert.equal(multiLongFragments.flatMap(table => table.cells).filter(row => row[0] === 'Item').length, 1, 'the table header is emitted once across both long rows')
      const multiLongMarkers = [...multiLongFragments.flatMap(table => table.cells.flat().join(' ')).join(' ').matchAll(/MERGE-([AB])-(\d{2})/g)].map(match => `${match[1]}-${match[2]}`)
      assert.deepEqual(multiLongMarkers, [...Array.from({ length: 30 }, (_, index) => `A-${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 30 }, (_, index) => `B-${String(index + 1).padStart(2, '0')}`)], 'both merged row contents survive once and in source order')
      const mergedRowFragments = multiLongFragments.filter(table => table.cells.some(row => /MERGE-[AB]-\d{2}/.test(row[1] ?? '')))
      assert.ok(mergedRowFragments.length > 2 && mergedRowFragments.every(table => table.merges?.some(merge => merge.row === 0 && merge.column === 1 && merge.colSpan === 2)), 'horizontal merge metadata is remapped to each split row fragment')
      const multiLongDoc = { ...longDoc, pages: [{ ...longDoc.pages[0], blocks: [multiLongRows] }] }
      const multiLongCanvases = await exporter.renderDocumentCanvases(multiLongDoc)
      assert.equal(multiLongCanvases.length, multiLongPages.length, 'the canvas renderer emits each page for the multi-row merged table')
      assert.ok(multiLongCanvases.every(({ canvas }) => canvas.width === 1588 && canvas.height === 2246), 'all multi-row fragments retain physical A4 canvas dimensions')
      const multiLongPdf = new TextDecoder().decode(await exporter.createPdfBytes(794, 1123, multiLongCanvases.map(() => pixel)))
      assert.equal((multiLongPdf.match(/\/Type \/Page\b/g) ?? []).length, multiLongPages.length, 'the output PDF contains every multi-row fragment')
      assert.equal((multiLongPdf.match(/\/MediaBox \[0 0 595\.5 842\.25\]/g) ?? []).length, multiLongPages.length, 'all multi-row PDF pages keep A4 MediaBoxes')
      const dottedTable = { ...tableBlock, cellPadding: 20, tableSpacing: 0, cellBorders: { '0:0': { top: { style: 'dots', width: 2 }, right: { style: 'dots', width: 2 }, bottom: { style: 'dots', width: 2 }, left: { style: 'dots', width: 2 } } } }
      drawnBorders.length = 0
      await exporter.renderDocumentCanvases({ ...tableDocument, pages: [{ ...tableDocument.pages[0], blocks: [dottedTable] }] })
      assert.deepEqual(drawnBorders.slice(0, 4), Array.from({ length: 4 }, () => ({ width: 2, dash: [1, 3.2], lineCap: 'round' })), 'PDF canvas draws all four dotted A1 edges at thickness 2')
      const mixedBorderTable = { ...tableBlock, cellBorders: { '0:0': { top: { style: 'none', width: 2 }, right: { style: 'long-dashes', width: 2 }, bottom: { style: 'dashes', width: 2 }, left: { style: 'solid', width: 2 } } } }
      drawnBorders.length = 0
      await exporter.renderDocumentCanvases({ ...tableDocument, pages: [{ ...tableDocument.pages[0], blocks: [mixedBorderTable] }] })
      assert.deepEqual(drawnBorders.slice(0, 3), [{ width: 2, dash: [8, 4], lineCap: 'butt' }, { width: 2, dash: [2, 2], lineCap: 'butt' }, { width: 2, dash: [], lineCap: 'butt' }], 'PDF export skips borderless edges and distinguishes long, short, and solid strokes')
      drawnText.length = 0
      const sheetPage = { id: 'sheet-page', name: 'Planilha 1', background: '#fff', elements: [], cells: [['12', '8', '=SUM(A1:B1)'], ['', '', '=B2'], ['0.25', '12.5']], cellMerges: [{ row: 1, column: 0, colSpan: 2 }], cellFormats: { '2:0': 'percentage', '2:1': 'currency' } }
      const sheetCanvas = await exporter.renderPageCanvas({ id: 'sheet-1', name: 'Planilha', type: 'sheet', width: 800, height: 500, updatedAt: '', pages: [sheetPage] }, sheetPage)
      assert.deepEqual([sheetCanvas.width, sheetCanvas.height], [1600, 1000])
      assert.ok(drawnText.includes('20'))
      assert.ok(drawnText.includes('A'))
      assert.ok(drawnText.includes('0'))
      assert.ok(drawnText.includes('25%'))
      assert.ok(drawnText.some(text => text.includes('12,50')))
      drawnLines.length = 0
      drawnBorders.length = 0
      const vectorShapes = [
        { id: 'triangle', type: 'shape', name: 'Triangle', shape: 'triangle', x: 10, y: 10, width: 100, height: 80, rotation: 0, fill: '#7654ed', cornerRadius: 0 },
        { id: 'arrow', type: 'shape', name: 'Arrow', shape: 'arrow', x: 120, y: 10, width: 120, height: 50, rotation: 0, fill: '#f60', cornerRadius: 0 },
        { id: 'line', type: 'shape', name: 'Line', shape: 'line', x: 20, y: 120, width: 180, height: 12, rotation: 0, fill: '#245', cornerRadius: 0, strokeWidth: 6 },
      ]
      await exporter.renderPageCanvas({ id: 'vector-doc', name: 'Vectors', width: 300, height: 220, updatedAt: '', pages: [] }, { id: 'vector-page', name: 'Page', background: '#fff', elements: vectorShapes })
      assert.equal(drawnLines.length, 12, 'export draws the triangle, filled arrow, and open line as vector paths')
      assert.ok(drawnBorders.some(border => border.width === 6 && border.lineCap === 'round'), 'line vector keeps its editable stroke width in exports')
      const mergedRows = tableRows.map(row => [...row])
      mergedRows[0][0] = 'Header A\nHeader B\nHeader C\nHeader D'
      mergedRows[0].fill('', 1)
      const mergedTable = { ...tableBlock, cells: mergedRows, merges: [{ row: 0, column: 0, colSpan: 4 }] }
      const mergedCanvas = await exporter.renderDocumentCanvases({ ...tableDocument, pages: [{ ...tableDocument.pages[0], blocks: [mergedTable] }] })
      assert.ok(mergedCanvas.length > 1)
      assert.ok(drawnText.includes('Header D'))
      assert.ok(drawnRects.some(rect => Math.abs(rect.width - 602) < 1))

      drawnText.length = 0
      const presentationPage = {
        id: 'slide-1', name: 'Slide 1', background: '#fff', presenterNotes: 'PRIVATE SPEAKER NOTE',
        elements: [{ id: 'title', type: 'text', name: 'Title', text: 'Visible slide title', x: 20, y: 20, width: 300, height: 60, rotation: 0, fontSize: 28, fontFamily: 'Arial', color: '#000000', bold: true }],
      }
      await exporter.renderPageCanvas({ id: 'presentation-1', name: 'Presentation', type: 'presentation', width: 1280, height: 720, updatedAt: '', pages: [presentationPage] }, presentationPage)
      assert.ok(drawnText.includes('Visible slide title'))
      assert.ok(!drawnText.some(text => text.includes('PRIVATE SPEAKER NOTE')))
      const whiteboardPage = { id: 'board-page', name: 'Quadro 1', background: '#fff', elements: [] }
      const whiteboardCanvas = await exporter.renderPageCanvas({ id: 'board-1', name: 'Board', type: 'whiteboard', width: 3200, height: 2000, updatedAt: '', pages: [whiteboardPage] }, whiteboardPage)
      assert.deepEqual([whiteboardCanvas.width, whiteboardCanvas.height], [3200, 2000])
      assert.deepEqual(drawingScales.at(-1), [1, 1])
      drawnText.length = 0
      const note = { id: 'note-1', type: 'sticky-note', name: 'Nota', x: 80, y: 90, width: 260, height: 220, rotation: 0, text: 'Ideia compartilhada', fill: '#fff2a8', color: '#302d20', fontSize: 24 }
      const secondNote = { ...note, id: 'note-2', x: 500, text: 'Outra ideia' }
      const connector = { id: 'connector-1', fromId: note.id, toId: secondNote.id, color: '#7464e8', strokeWidth: 4 }
      const notePage = { ...whiteboardPage, elements: [note, secondNote], connectors: [connector] }
      await exporter.renderPageCanvas({ id: 'board-1', name: 'Board', type: 'whiteboard', width: 3200, height: 2000, updatedAt: '', pages: [notePage] }, notePage)
      assert.ok(drawnText.includes('Ideia compartilhada'))
      const stroke = { id: 'stroke-1', type: 'free-draw', name: 'Desenho livre', x: 30, y: 40, width: 20, height: 30, rotation: 0, points: [0, 0, 20, 30], color: '#29263d', strokeWidth: 8 }
      const strokePage = { ...whiteboardPage, elements: [stroke] }
      const beforeStrokeDraw = drawnLines.length
      await exporter.renderPageCanvas({ id: 'board-1', name: 'Board', type: 'whiteboard', width: 3200, height: 2000, updatedAt: '', pages: [strokePage] }, strokePage)
      assert.deepEqual(drawnLines.slice(beforeStrokeDraw), [[0, 0], [20, 30]])
      const flippedImage = { id: 'image-1', type: 'image', name: 'Raster', src: pixel, x: 10, y: 20, width: 40, height: 30, rotation: 0, opacity: 50, flipX: true, flipY: true, brightness: 20, crop: { x: 2, y: 3, width: 5, height: 7 } }
      const imagePage = { ...whiteboardPage, elements: [flippedImage] }
      await exporter.renderPageCanvas({ id: 'image-doc', name: 'Image', type: 'design', width: 320, height: 240, updatedAt: '', pages: [imagePage] }, imagePage)
      assert.deepEqual(drawnImages.at(-1), { src: pixel, alpha: 0.5, filter: 'brightness(120%)', args: [2, 3, 5, 7, 0, 0, 40, 30] }, 'crop, opacity, and brightness are applied in the export renderer')
      assert.ok(imageTransforms.some(transform => transform[0] === 'scale' && transform[1] === -1 && transform[2] === -1), 'horizontal and vertical flips are applied in export')
      imageTransforms.length = 0
      const verticalOnly = { ...flippedImage, opacity: 37, flipX: false, flipY: true, brightness: 0, crop: undefined }
      const verticalPage = { ...whiteboardPage, elements: [verticalOnly] }
      await exporter.renderPageCanvas({ id: 'image-vertical-doc', name: 'Vertical image', type: 'design', width: 320, height: 240, updatedAt: '', pages: [verticalPage] }, verticalPage)
      assert.ok(imageTransforms.some(transform => transform[0] === 'scale' && transform[1] === 1 && transform[2] === -1), 'vertical-only PNG rendering reflects across the horizontal axis')
      assert.ok(imageTransforms.some(transform => transform[0] === 'translate' && transform[2] === 30), 'vertical-only PNG rendering translates by the image height')
      assert.equal(drawnImages.at(-1).alpha, 0.37, 'PNG export applies the committed opacity to the raster')
      assert.ok(filledRects.some(rect => rect.color === '#fff'), 'opaque PNG export paints the original white page background beneath translucent image pixels')
      const filteredImage = { ...flippedImage, filterPreset: 'mono' }
      await exporter.renderPageCanvas({ id: 'image-filter-doc', name: 'Image filters', type: 'design', width: 320, height: 240, updatedAt: '', pages: [{ ...imagePage, elements: [filteredImage] }] }, { ...imagePage, elements: [filteredImage] })
      const exportedMono = filteredPixelResults.at(-1)
      assert.equal(exportedMono[0], exportedMono[1]); assert.equal(exportedMono[1], exportedMono[2]); assert.equal(exportedMono[3], 255, 'the export renderer applies the shared pixel filter and preserves alpha')
      const adjustedImage = { ...flippedImage, filterPreset: undefined, contrast: 0, saturation: -100 }
      const adjustedPage = { ...imagePage, elements: [adjustedImage] }
      await exporter.renderPageCanvas({ id: 'image-adjust-doc', name: 'Image adjustments', type: 'design', width: 320, height: 240, updatedAt: '', pages: [adjustedPage] }, adjustedPage)
      assert.deepEqual(filteredPixelResults.at(-1), [107, 107, 107, 255], 'export applies saturation adjustment to raster pixels and preserves alpha')
      const maskedImage = { ...flippedImage, filterPreset: undefined, maskStrokes: [{ mode: 'erase', size: .5, points: [.5, .5, .5, .5] }] }
      const maskedPage = { ...imagePage, elements: [maskedImage] }
      await exporter.renderPageCanvas({ id: 'image-mask-doc', name: 'Image mask', type: 'design', width: 320, height: 240, updatedAt: '', pages: [maskedPage] }, maskedPage)
      assert.equal(filteredPixelResults.at(-1)[3], 0, 'the export renderer applies manual erasure to image alpha')
    } finally {
      if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
      else delete globalThis.document
      if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage)
      else delete globalThis.Image
    }
  } finally {
    await vite.close()
  }
})

test('PDF semantic export maps Docs roles and Unicode content to tagged invisible text', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const exporter = await vite.ssrLoadModule('/src/export.ts')
    const docNodes = exporter.createPdfDocSemantics([
      { id: 'h', type: 'heading', text: 'Relatório Acessível' },
      { id: 'p', type: 'paragraph', text: 'Resumo com café e símbolos.' },
      { id: 'b', type: 'bullet', text: 'Item principal' },
      { id: 't', type: 'table', text: '', cells: [['Nome', 'Valor'], ['Ana', '42']], merges: [{ row: 0, column: 0, colSpan: 2 }] },
    ])
    assert.deepEqual(docNodes.map(node => node.role), ['H1', 'P', 'L', 'Table'])
    assert.equal(docNodes[2].children[0].children[0].role, 'LBody')
    assert.deepEqual(docNodes[3].children[0].children.map(cell => cell.text), ['Nome'], 'merged covered cells are omitted from the semantic table')
    assert.deepEqual(docNodes[3].children[1].children.map(cell => cell.text), ['Ana', '42'])
    const semantics = [
      ...docNodes,
      { role: 'Figure', alt: 'Foto: pessoa na praia.' },
    ]
    const bytes = await exporter.createPdfBytes(794, 1123, [pixel], false, ['Relatório: texto e imagem.'], [semantics])
    const source = new TextDecoder().decode(bytes)
    assert.match(source, /\/S \/H1/)
    assert.match(source, /\/S \/P/)
    assert.match(source, /\/S \/L\b/)
    assert.match(source, /\/S \/LI\b/)
    assert.match(source, /\/S \/LBody\b/)
    assert.match(source, /\/S \/Table\b/)
    assert.match(source, /\/S \/TR\b/)
    assert.match(source, /\/S \/TD\b/)
    assert.match(source, /\/S \/Figure\b[\s\S]*?\/Alt <FEFF[0-9A-F]+>/)
    assert.match(source, /\/Artifact BMC/)
    assert.match(source, /\/ActualText <FEFF[0-9A-F]+> >> BDC/)
    assert.match(source, /\/StructParents 0/)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const parsed = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, useSystemFonts: false }).promise
    const structTree = await (await parsed.getPage(1)).getStructTree()
    assert.ok(structTree)
    const roles = []
    const alternatives = []
    const visit = node => { roles.push(node.role); if (node.alt) alternatives.push(node.alt); for (const child of node.children ?? []) visit(child) }
    visit(structTree)
    for (const role of ['Document', 'Sect', 'H1', 'P', 'L', 'LI', 'LBody', 'Table', 'TR', 'TD', 'Figure']) assert.ok(roles.includes(role), `tag tree should expose ${role}`)
    assert.ok(alternatives.includes('Relatório Acessível'))
    assert.ok(alternatives.includes('Resumo com café e símbolos.'))
    assert.ok(alternatives.includes('Ana'))
    assert.ok(alternatives.includes('Foto: pessoa na praia.'))
  } finally {
    await vite.close()
  }
})

test('PPTX export creates a valid ordered Open XML package with presentation-sized raster slides', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const JSZip = (await import('jszip')).default
    const exporter = await vite.ssrLoadModule('/src/pptx-export.ts')
    const bytes = await exporter.createPptxBytes(1920, 1080, [pixel, pixel])
    const zip = await JSZip.loadAsync(bytes)
    const fileNames = Object.keys(zip.files)
    assert.ok(fileNames.includes('ppt/presentation.xml'))
    assert.ok(fileNames.includes('ppt/slideMasters/slideMaster1.xml'))
    assert.ok(fileNames.includes('ppt/slideLayouts/slideLayout1.xml'))
    assert.ok(fileNames.includes('ppt/slides/slide1.xml'))
    assert.ok(fileNames.includes('ppt/slides/slide2.xml'))
    assert.ok(fileNames.includes('ppt/media/slide1.png'))
    assert.ok(fileNames.includes('ppt/media/slide2.png'))
    const presentation = await zip.file('ppt/presentation.xml').async('string')
    assert.match(presentation, /<p:sldSz cx="9144000" cy="5143500"/)
    assert.equal((presentation.match(/<p:sldId /g) ?? []).length, 2)
    const relationships = await zip.file('ppt/_rels/presentation.xml.rels').async('string')
    assert.match(relationships, /Target="slides\/slide1.xml"/)
    assert.match(relationships, /Target="slides\/slide2.xml"/)
    const slide = await zip.file('ppt/slides/slide2.xml').async('string')
    assert.match(slide, /name="Slide 2"/)
    assert.match(slide, /r:embed="rId2"/)
    const embeddedPng = await zip.file('ppt/media/slide1.png').async('uint8array')
    assert.deepEqual([...embeddedPng.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    await assert.rejects(exporter.createPptxBytes(0, 1080, [pixel]), /dimensões/)
    await assert.rejects(exporter.createPptxBytes(1920, 1080, []), /ao menos um slide/)
    await assert.rejects(exporter.createPptxBytes(1920, 1080, ['data:image/jpeg;base64,AAAA']), /PNG válida/)
  } finally {
    await vite.close()
  }
})

