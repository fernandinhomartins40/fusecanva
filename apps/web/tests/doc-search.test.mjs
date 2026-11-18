import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('Docs find and replace is literal, case-aware, spans pages and table cells, and preserves unrelated data', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const search = await vite.ssrLoadModule('/src/doc-search.ts')
    const document = {
      id: 'doc-1', name: 'Notes', type: 'doc', width: 794, height: 1123, updatedAt: 'old',
      pages: [
        { id: 'page-1', name: 'One', background: '#fff', elements: [], blocks: [
          { id: 'heading', type: 'heading', text: 'Draft draft (draft)', marks: [{ start: 0, end: 5, bold: true }] },
          { id: 'table', type: 'table', text: '', cells: [['draft', 'final'], ['DRAFT', 'draft']] },
        ] },
        { id: 'page-2', name: 'Two', background: '#fff', elements: [], blocks: [{ id: 'paragraph', type: 'paragraph', text: 'A draft remains.' }] },
      ],
    }
    assert.equal(search.countDocumentMatches(document, 'draft'), 7)
    assert.equal(search.countDocumentMatches(document, 'draft', true), 5)
    assert.equal(search.countDocumentMatches(document, '(draft)'), 1)
    const result = search.replaceDocumentMatches(document, 'draft', '$& plan', false)
    assert.equal(result.count, 7)
    assert.equal(result.document.pages[0].blocks[0].text, '$& plan $& plan ($& plan)')
    assert.deepEqual(result.document.pages[0].blocks[0].marks, [{ start: 0, end: 7, bold: true }])
    assert.deepEqual(result.document.pages[0].blocks[1].cells, [['$& plan', 'final'], ['$& plan', '$& plan']])
    assert.equal(result.document.pages[1].blocks[0].text, 'A $& plan remains.')
    assert.equal(result.document.pages[0].blocks[1].merges, undefined)
    assert.equal(result.document.updatedAt === 'old', false)
    const patches = search.getDocumentReplacementPatches(document, result.document)
    assert.deepEqual(patches.map(patch => [patch.pageId, patch.blocks.length, patch.cells.length]), [['page-1', 1, 3], ['page-2', 1, 0]])
    assert.deepEqual(search.splitDocumentReplacementPatch(patches[0], 2).map(patch => patch.blocks.length + patch.cells.length), [2, 2])
    const byteLimited = search.splitDocumentReplacementPatch(patches[1], 100, 1)
    assert.equal(byteLimited.length, 1)
    assert.deepEqual(byteLimited[0].blocks[0], patches[1].blocks[0])
    assert.deepEqual(search.replaceDocumentMatches(document, 'missing', 'x'), { document, count: 0 })
  } finally {
    await vite.close()
  }
})

test('Docs replacement preserves formatting on an unaffected suffix across an inline-mark boundary', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { replaceDocumentMatches } = await vite.ssrLoadModule('/src/doc-search.ts')
    const document = {
      id: 'doc-inline', name: 'Inline', type: 'doc', width: 794, height: 1123, updatedAt: 'old',
      pages: [{ id: 'page', name: 'One', background: '#fff', elements: [], blocks: [{
        id: 'paragraph', type: 'paragraph', text: 'AxyZ',
        marks: [{ start: 1, end: 3, bold: true }, { start: 2, end: 4, italic: true }],
      }] }],
    }
    const { document: replaced, count } = replaceDocumentMatches(document, 'xy', 'insert')
    assert.equal(count, 1)
    assert.equal(replaced.pages[0].blocks[0].text, 'AinsertZ')
    assert.deepEqual(replaced.pages[0].blocks[0].marks, [
      { start: 1, end: 7, bold: true },
      { start: 7, end: 8, italic: true },
    ])
  } finally {
    await vite.close()
  }
})
