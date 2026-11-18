import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('Docs first-row table merge supports Undo and Redo as one document change', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const history = await vite.ssrLoadModule('/src/documentHistory.ts')
    const table = await vite.ssrLoadModule('/src/table.ts')
    const beforeMerge = {
      type: 'doc',
      pages: [{ id: 'page-1', blocks: [{ id: 'table-1', type: 'table', cells: [['Product', 'Quantity', 'Price', 'State'], ['Lamp', '2', '12', 'Ready']] }] }],
    }
    const merge = table.mergeTableSelection(beforeMerge.pages[0].blocks[0].cells, [], { anchorRow: 0, anchorColumn: 0, focusRow: 0, focusColumn: 3 })
    const mergedDocument = {
      ...beforeMerge,
      pages: [{ ...beforeMerge.pages[0], blocks: [{ ...beforeMerge.pages[0].blocks[0], ...merge }] }],
    }
    const initialHistory = { document: beforeMerge, undoStack: [], redoStack: [] }
    const afterMerge = history.recordDocumentChange(initialHistory, mergedDocument)

    assert.deepEqual(afterMerge.document.pages[0].blocks[0].merges, [{ row: 0, column: 0, colSpan: 4 }])
    assert.equal(afterMerge.document.pages[0].blocks[0].cells[0][0], 'Product\nQuantity\nPrice\nState')

    const afterUndo = history.undoDocumentChange(afterMerge)
    assert.strictEqual(afterUndo.document, beforeMerge, 'Undo restores the complete unmerged first row')
    assert.deepEqual(afterUndo.document.pages[0].blocks[0].cells[0], ['Product', 'Quantity', 'Price', 'State'])
    assert.deepEqual(afterUndo.document.pages[0].blocks[0].merges ?? [], [])

    const afterRedo = history.redoDocumentChange(afterUndo)
    assert.strictEqual(afterRedo.document, mergedDocument, 'Redo restores the merged first row')
    assert.deepEqual(afterRedo.document.pages[0].blocks[0].merges, [{ row: 0, column: 0, colSpan: 4 }])
    assert.deepEqual(history.undoDocumentChange({ ...afterRedo, undoStack: [] }), { ...afterRedo, undoStack: [] }, 'Undo is a no-op when its stack is empty')
  } finally {
    await vite.close()
  }
})
