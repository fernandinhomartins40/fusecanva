import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('Docs table cell, row and column operations preserve topology and values', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const table = await vite.ssrLoadModule('/src/table.ts')
    const initial = [['á,1', 'B'], ['C', 'D']]
    const changed = table.setTableCell(initial, 1, 0, 'Novo valor')
    assert.equal(changed[1][0], 'Novo valor')
    assert.equal(changed[0][0], 'á,1')

    const withRow = table.appendTableRow(changed)
    assert.deepEqual(withRow[2], ['', ''])
    const withColumn = table.appendTableColumn(withRow)
    assert.ok(withColumn.every(row => row.length === 3))
    assert.deepEqual(table.removeTableRow(withColumn, 1), [withColumn[0], withColumn[2]])
    const rowsForMove = [['Header A', 'Header B'], ['Row 1 A', 'Row 1 B'], ['Row 2 A', 'Row 2 B']]
    assert.deepEqual(table.moveTableRow(rowsForMove, 0, 1), [rowsForMove[1], rowsForMove[0], rowsForMove[2]], 'moving down preserves every cell value and row association')
    assert.deepEqual(table.moveTableRow(rowsForMove, 1, 0), [rowsForMove[1], rowsForMove[0], rowsForMove[2]], 'moving up restores the original adjacent order')
    assert.deepEqual(table.moveTableRow(rowsForMove, -1, 0), rowsForMove, 'invalid row indexes leave the table unchanged')
    const rowMerges = [{ row: 0, column: 0, colSpan: 2 }, { row: 2, column: 1, colSpan: 2 }]
    assert.deepEqual(table.moveTableMerges(rowMerges, 0, 1), [{ row: 1, column: 0, colSpan: 2 }, { row: 2, column: 1, colSpan: 2 }], 'merged cells follow their moved rows and later rows shift in the opposite direction')
    assert.deepEqual(table.removeTableColumn(withColumn, 0).map(row => row.length), [2, 2, 2])
    const borderA = { top: { style: 'dots', width: 2 } }
    const borderB = { left: { style: 'long-dashes', width: 1 } }
    const borderC = { right: { style: 'solid', width: 3 } }
    const cellBorders = { '0:0': borderA, '1:1': borderB, '3:2': borderC }
    const rowBorders = { '0:0': borderA, '1:1': borderB, '2:0': borderC }
    assert.deepEqual(table.moveTableCellBorders(rowBorders, 0, 1), { '1:0': borderA, '0:1': borderB, '2:0': borderC }, 'cell border metadata follows moved rows while unrelated rows remain fixed')
    assert.deepEqual(table.shiftTableCellBordersAfterRowRemoval(cellBorders, 1), { '0:0': borderA, '2:2': borderC })
    assert.deepEqual(table.shiftTableCellBordersAfterColumnRemoval(cellBorders, 1), { '0:0': borderA, '3:1': borderC })
    const imageA = { alt: 'A' }
    const imageB = { alt: 'B' }
    const imageC = { alt: 'C' }
    const cellImages = { '0:0': [imageA], '1:1': [imageB], '2:2': [imageC] }
    assert.deepEqual(table.moveTableCellImages(cellImages, 0, 2), { '2:0': [imageA], '0:1': [imageB], '1:2': [imageC] }, 'images follow their rows when rows move')
    assert.deepEqual(table.shiftTableCellImagesAfterRowRemoval(cellImages, 1), { '0:0': [imageA], '1:2': [imageC] }, 'images in a deleted row are discarded and later rows shift up')
    assert.deepEqual(table.shiftTableCellImagesAfterColumnRemoval(cellImages, 1), { '0:0': [imageA], '2:1': [imageC] }, 'images in a deleted column are discarded and later columns shift left')
    assert.equal(table.removeTableRow([['only']], 0).length, 1)
    assert.deepEqual(table.removeTableColumn([['only']], 0), [['only']])
    assert.equal(table.shouldAppendTableRow('Tab', false, false, 1, 1, initial), true)
    assert.equal(table.shouldAppendTableRow('Tab', true, false, 1, 1, initial), false)
    assert.equal(table.shouldAppendTableRow('Enter', false, true, 0, 0, initial), true)
    assert.equal(table.shouldAppendTableRow('Tab', false, false, 0, 1, initial), false)
    assert.equal(table.shouldAppendTableRow('Tab', false, false, 1, 0, [['Header', 'Value', 'Note'], ['Last row']]), true, 'Tab from the final existing cell appends after a ragged shorter last row')
    assert.equal(table.shouldAppendTableRow('Tab', false, false, 1, 1, [['Header'], ['Last', 'cell']]), true, 'Tab from a ragged longer last row uses that row’s actual final cell')
    assert.equal(table.shouldAppendTableRow('Tab', false, false, 0, 2, [['Header', 'Value', 'Note'], ['Last row']]), false, 'intermediate rows do not append when Tab reaches their final cell')
    assert.equal(table.shouldAppendTableRow('Tab', true, false, 1, 0, [['Header', 'Value'], ['Last row']]), false, 'Shift+Tab keeps reverse navigation at the table edge')
    assert.equal(table.shouldAppendTableRow('Tab', false, false, 0, 0, [[]]), false, 'an empty row has no final cell that can trigger appending')

    const labels = [['Name', 'ID', 'Role', 'Location'], ['Ana', '2', 'Editor', 'Remote']]
    const merged = table.mergeTableSelection(labels, [], { anchorRow: 0, anchorColumn: 0, focusRow: 0, focusColumn: 3 })
    assert.deepEqual(merged.merges, [{ row: 0, column: 0, colSpan: 4 }])
    assert.equal(merged.cells[0][0], 'Name\nID\nRole\nLocation')
    assert.deepEqual(merged.cells[0].slice(1), ['', '', ''])
    assert.deepEqual(merged.cells[1], labels[1])
    assert.equal(table.mergeTableSelection(labels, [], { anchorRow: 0, anchorColumn: 0, focusRow: 1, focusColumn: 0 }), null)
    assert.equal(table.isCellMerged(merged.merges, 0, 2), true)
    assert.equal(table.mergeTableSelection(merged.cells, merged.merges, { anchorRow: 0, anchorColumn: 1, focusRow: 0, focusColumn: 3 }), null)
    const unmerged = table.unmergeTableCell(merged.merges, 0, 2)
    assert.deepEqual(unmerged, [])
    assert.equal(merged.cells[0][0], 'Name\nID\nRole\nLocation')
    assert.deepEqual(table.extendTableSelection(null, 0, 1, 'ArrowRight', 2, 4), { anchorRow: 0, anchorColumn: 1, focusRow: 0, focusColumn: 2 })
    assert.deepEqual(table.extendTableSelection({ anchorRow: 0, anchorColumn: 1, focusRow: 0, focusColumn: 2 }, 0, 2, 'ArrowRight', 2, 4), { anchorRow: 0, anchorColumn: 1, focusRow: 0, focusColumn: 3 })
    assert.equal(table.extendTableSelection({ anchorRow: 0, anchorColumn: 1, focusRow: 0, focusColumn: 0 }, 0, 0, 'ArrowLeft', 2, 4).focusColumn, 0)
  } finally {
    await vite.close()
  }
})
