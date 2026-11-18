import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

function canvasContext() {
  return {
    font: '',
    measureText: text => ({ width: [...text].length * 7 }),
  }
}

async function withExporter(callback) {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const previousDocument = globalThis.document
  const context = canvasContext()
  globalThis.document = { createElement: () => ({ getContext: () => context }) }
  try {
    const exporter = await vite.ssrLoadModule('/src/doc-svg-export.ts')
    await callback(exporter.renderDocPageSvgs, exporter.renderDocContinuousSvg)
  } finally {
    globalThis.document = previousDocument
    await vite.close()
  }
}

test('Docs SVG keeps semantic text, inline marks, merged table cells, borders, and embedded images vectorized', async () => {
  await withExporter(renderDocPageSvgs => {
    const image = { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Produto em destaque', width: 1, height: 1 }
    const documentModel = {
      id: 'doc', name: 'Resumo técnico', type: 'doc', width: 794, height: 1123,
      docPageSetup: { preset: 'a4', margins: { top: 60, right: 64, bottom: 70, left: 64 } },
      pages: [{ id: 'page', name: 'Página principal', background: '#fffefc', blocks: [
        { id: 'heading', type: 'heading', text: 'Título marcado', marks: [{ start: 0, end: 5, bold: true, italic: true, underline: true, strike: true }] },
        { id: 'paragraph', type: 'paragraph', text: 'Texto vetorial independente de raster.' },
        { id: 'table', type: 'table', text: '', cells: [['Mesclada', '', 'Item']], merges: [{ row: 0, column: 0, colSpan: 2 }], cellPadding: 6, tableSpacing: 4, borderColor: '#778899', borderWidth: 1, cellBorders: { '0:0': { top: { style: 'dots', width: 2 }, bottom: { style: 'none', width: 1 } } }, cellImages: { '0:2': [image] } },
        { id: 'image', type: 'image', text: '', image },
      ] }],
    }
    const pages = renderDocPageSvgs(documentModel, 0)
    assert.equal(pages.length, 1)
    assert.deepEqual({ sourcePageIndex: pages[0].sourcePageIndex, pageIndex: pages[0].pageIndex, width: pages[0].width, height: pages[0].height }, { sourcePageIndex: 0, pageIndex: 0, width: 794, height: 1123 })
    assert.match(pages[0].svg, /<title>Resumo técnico — Página principal<\/title>/)
    assert.match(pages[0].svg, /data-doc-block-type="heading" role="heading" aria-level="1"/)
    assert.match(pages[0].svg, /font-weight="700" font-style="italic"[^>]*text-decoration="underline line-through"/)
    assert.match(pages[0].svg, /<text[^>]*>Texto\s*<\/text>/)
    assert.match(pages[0].svg, /<g role="table"/)
    assert.match(pages[0].svg, /data-colspan="2"/)
    assert.match(pages[0].svg, /stroke-dasharray="1 2"/)
    assert.match(pages[0].svg, /role="img" aria-label="Produto em destaque"/)
    assert.equal((pages[0].svg.match(/<image\b/g) ?? []).length, 2, 'only source images remain raster; document text and tables are SVG primitives')
    assert.doesNotMatch(pages[0].svg, /foreignObject/)
  })
})

test('Docs SVG preserves page dimensions, margins, and source order across physical and continuous pages', async () => {
  await withExporter((renderDocPageSvgs, renderDocContinuousSvg) => {
    const longText = Array.from({ length: 850 }, (_, index) => `word${index}`).join(' ')
    const documentModel = {
      id: 'long-doc', name: 'Long document', type: 'doc', width: 794, height: 1123,
      docPageSetup: { preset: 'a4', margins: { top: 90, right: 80, bottom: 100, left: 70 } },
      pages: [{ id: 'page', name: 'Page 1', background: '#ffffff', blocks: [
        { id: 'first', type: 'heading', text: 'Opening heading' },
        { id: 'long', type: 'paragraph', text: longText },
        { id: 'last', type: 'subheading', text: 'Closing section' },
      ] }],
    }
    const pages = renderDocPageSvgs(documentModel, 0)
    assert.ok(pages.length > 1, 'long Docs content becomes separately sized physical SVG pages')
    assert.deepEqual(pages.map(page => page.pageIndex), pages.map((_, index) => index))
    assert.ok(pages.every(page => page.svg.includes(`width="794" height="${page.height}"`)))
    assert.ok(pages.some(page => page.height > 1123), 'an oversized text block expands its physical SVG viewport instead of being clipped')
    assert.ok(pages[0].svg.includes('x="70"'), 'text starts at the saved left margin')
    assert.ok(pages[0].svg.includes('Opening heading'))
    assert.ok(pages.at(-1).svg.includes('Closing section'), 'later content remains present on a later page')
    const continuous = renderDocContinuousSvg(documentModel, 0)
    const expectedHeight = pages.reduce((height, page) => height + page.height, 0)
    assert.equal(continuous.height, expectedHeight)
    assert.match(continuous.svg, new RegExp(`height="${expectedHeight}"`), 'single-file export preserves each physical page height')
    assert.equal((continuous.svg.match(/<svg x="0" y="/g) ?? []).length, pages.length, 'the continuous document contains one nested SVG viewport per page')
    assert.ok(continuous.svg.indexOf('Opening heading') < continuous.svg.indexOf('Closing section'), 'all page content remains in source order')
  })
})

test('Docs SVG paginates consecutive oversized table rows without losing or duplicating merged-cell lines', async () => {
  await withExporter(renderDocPageSvgs => {
    const firstRowLines = Array.from({ length: 125 }, (_, index) => `FIRST_${String(index).padStart(3, '0')}`)
    const secondRowLines = Array.from({ length: 117 }, (_, index) => `SECOND_${String(index).padStart(3, '0')}`)
    const documentModel = {
      id: 'two-long-rows', name: 'Two long rows', type: 'doc', width: 794, height: 1123,
      docPageSetup: { preset: 'a4', margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      pages: [{ id: 'page', name: 'Page 1', background: '#ffffff', blocks: [
        { id: 'long-table', type: 'table', text: '', cells: [
          [firstRowLines.join('\n'), ''],
          [secondRowLines.join('\n'), ''],
        ],
        merges: [{ row: 0, column: 0, colSpan: 2 }, { row: 1, column: 0, colSpan: 2 }],
        cellPadding: 8, tableSpacing: 4 },
      ] }],
    }

    const pages = renderDocPageSvgs(documentModel, 0)
    assert.ok(pages.length >= 5, 'both oversized rows are split over multiple physical pages')
    assert.ok(pages.every(page => page.height === 1123), 'ordinary row fragments fit within the configured A4 page')
    const svg = pages.map(page => page.svg).join('\n')
    const textRuns = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1])
    const renderedText = textRuns.join('\n')
    const assertExactlyOnce = (marker, expectedIndex) => {
      const occurrences = renderedText.split(marker).length - 1
      assert.equal(occurrences, 1, `${marker} is emitted once across page fragments`)
      assert.ok(renderedText.indexOf(marker) >= expectedIndex, `${marker} stays in source order`)
      return renderedText.indexOf(marker)
    }
    let previous = -1
    for (const marker of firstRowLines) previous = assertExactlyOnce(marker, previous + 1)
    for (const marker of secondRowLines) previous = assertExactlyOnce(marker, previous + 1)
    assert.match(pages[0].svg, /data-colspan="2"/)
    assert.ok(pages.some(page => /data-doc-cell="0:0"/.test(page.svg)), 'merged table row fragments preserve their cell structure')
  })
})
