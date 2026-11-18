import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { mergeConcurrentDocuments as mergeOnServer } from '../server/document-merge.mjs'

test('three-way document merge combines independent edits and reports overlapping edits', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const collaboration = await vite.ssrLoadModule('/src/collaboration.ts')
    const base = {
      name: 'Design',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pages: [{ id: 'page-1', elements: [
        { id: 'text-1', type: 'text', text: 'Title', color: '#111' },
        { id: 'shape-1', type: 'shape', fill: '#fff' },
      ] }],
    }
    assert.equal(collaboration.hasUnpersistedChanges(base, base), false)
    assert.equal(collaboration.hasUnpersistedChanges(structuredClone(base), base), false)
    assert.equal(collaboration.hasUnpersistedChanges({ title: 'Docs', color: '#fff' }, { color: '#fff', title: 'Docs' }), false, 'JSON object key order does not count as a document edit')
    assert.equal(collaboration.hasUnpersistedChanges({ ...base, name: 'Offline draft' }, base), true)
    const reorderedKeysBase = { name: 'Design', metadata: { owner: 'Ana', color: '#fff' } }
    const reorderedKeysLocal = { metadata: { color: '#fff', owner: 'Ana' }, name: 'Design' }
    const reorderedKeysRemote = { name: 'Design', metadata: { owner: 'Ana', color: '#000' } }
    const reorderedKeysMerge = collaboration.mergeConcurrentDocuments(reorderedKeysBase, reorderedKeysLocal, reorderedKeysRemote)
    assert.equal(reorderedKeysMerge.ok, true, 'Object key order does not create a merge conflict')
    assert.equal(reorderedKeysMerge.value.metadata.color, '#000')
    const local = structuredClone(base)
    local.updatedAt = '2026-01-01T00:00:01.000Z'
    local.pages[0].elements[0].text = 'Local title'
    local.pages[0].elements.push({ id: 'shape-local', type: 'shape', fill: '#f00' })
    const remote = structuredClone(base)
    remote.updatedAt = '2026-01-01T00:00:02.000Z'
    remote.pages[0].elements[1].fill = '#00f'
    remote.pages[0].elements.push({ id: 'text-remote', type: 'text', text: 'Remote note' })
    const merged = collaboration.mergeConcurrentDocuments(base, local, remote)
    assert.equal(merged.ok, true)
    assert.deepEqual(mergeOnServer(base, local, remote), merged)
    assert.equal(merged.value.pages[0].elements.find(item => item.id === 'text-1').text, 'Local title')
    assert.equal(merged.value.pages[0].elements.find(item => item.id === 'shape-1').fill, '#00f')
    assert.equal(merged.value.updatedAt, remote.updatedAt)
    assert.ok(merged.value.pages[0].elements.some(item => item.id === 'shape-local'))
    assert.ok(merged.value.pages[0].elements.some(item => item.id === 'text-remote'))
    const submittedSnapshot = structuredClone(base)
    const newerLocal = structuredClone(submittedSnapshot)
    newerLocal.pages[0].elements[0].text = 'Typed after request'
    const canonicalServerSave = structuredClone(submittedSnapshot)
    canonicalServerSave.pages[0].elements[1].fill = '#00aaff'
    const reconciled = collaboration.mergeConcurrentDocuments(submittedSnapshot, newerLocal, canonicalServerSave)
    assert.equal(reconciled.ok, true)
    assert.equal(reconciled.value.pages[0].elements[0].text, 'Typed after request')
    assert.equal(reconciled.value.pages[0].elements[1].fill, '#00aaff')

    const overlappingRemote = structuredClone(base)
    overlappingRemote.pages[0].elements[0].text = 'Remote title'
    const conflict = collaboration.mergeConcurrentDocuments(base, local, overlappingRemote)
    assert.equal(conflict.ok, false)
    assert.deepEqual(mergeOnServer(base, local, overlappingRemote), conflict)
    assert.ok(conflict.conflicts.includes('pages[page-1].elements[text-1].text'))

    const textBase = { type: 'doc', pages: [{ id: 'doc-page', blocks: [{ id: 'paragraph', type: 'paragraph', text: 'Open tasks' }] }] }
    const textLocal = structuredClone(textBase)
    textLocal.pages[0].blocks[0].text = 'Open tasks urgent'
    const textRemote = structuredClone(textBase)
    textRemote.pages[0].blocks[0].text = 'Team: Open tasks'
    const mergedText = collaboration.mergeConcurrentDocuments(textBase, textLocal, textRemote)
    assert.equal(mergedText.ok, true)
    assert.equal(mergedText.value.pages[0].blocks[0].text, 'Team: Open tasks urgent')
    assert.deepEqual(mergeOnServer(textBase, textLocal, textRemote), mergedText)

    const inlineBase = { type: 'doc', pages: [{ id: 'doc-page', blocks: [{ id: 'inline', type: 'paragraph', text: 'Open tasks', marks: [{ start: 0, end: 4, bold: true }] }] }] }
    const inlineLocal = structuredClone(inlineBase)
    inlineLocal.pages[0].blocks[0].text = 'Team: Open tasks'
    inlineLocal.pages[0].blocks[0].marks = [{ start: 0, end: 6, italic: true }, { start: 6, end: 10, bold: true }]
    const inlineRemote = structuredClone(inlineBase)
    inlineRemote.pages[0].blocks[0].text = 'Open tasks urgent'
    inlineRemote.pages[0].blocks[0].marks = [{ start: 0, end: 4, bold: true }, { start: 11, end: 17, italic: true }]
    const inlineMerge = collaboration.mergeConcurrentDocuments(inlineBase, inlineLocal, inlineRemote)
    assert.equal(inlineMerge.ok, true)
    assert.equal(inlineMerge.value.pages[0].blocks[0].text, 'Team: Open tasks urgent')
    assert.deepEqual(inlineMerge.value.pages[0].blocks[0].marks, [
      { start: 0, end: 6, italic: true },
      { start: 6, end: 10, bold: true },
      { start: 17, end: 23, italic: true },
    ])
    assert.deepEqual(mergeOnServer(inlineBase, inlineLocal, inlineRemote), inlineMerge)

    const overlapTextLocal = structuredClone(textBase)
    overlapTextLocal.pages[0].blocks[0].text = 'Open task'
    const overlapTextRemote = structuredClone(textBase)
    overlapTextRemote.pages[0].blocks[0].text = 'Open tasks!'
    const overlapText = collaboration.mergeConcurrentDocuments(textBase, overlapTextLocal, overlapTextRemote)
    assert.equal(overlapText.ok, false)
    assert.deepEqual(mergeOnServer(textBase, overlapTextLocal, overlapTextRemote), overlapText)

    const insertBase = { title: 'AB' }
    const insertLocal = { title: 'AXB' }
    const insertRemote = { title: 'AYB' }
    assert.equal(collaboration.mergeConcurrentDocuments(insertBase, insertLocal, insertRemote).ok, false)

    const unicodeMerge = collaboration.mergeConcurrentDocuments({ text: 'A😀B' }, { text: 'Ax😀B' }, { text: 'A😀By' })
    assert.equal(unicodeMerge.ok, true)
    assert.equal(unicodeMerge.value.text, 'Ax😀By')
    assert.deepEqual(mergeOnServer({ text: 'A😀B' }, { text: 'Ax😀B' }, { text: 'A😀By' }), unicodeMerge)
    const multiHunkMerge = collaboration.mergeConcurrentDocuments({ text: 'ABCD' }, { text: 'XABCDY' }, { text: 'ABCZD' })
    assert.equal(multiHunkMerge.ok, true)
    assert.equal(multiHunkMerge.value.text, 'XABCZDY')
    assert.deepEqual(mergeOnServer({ text: 'ABCD' }, { text: 'XABCDY' }, { text: 'ABCZD' }), multiHunkMerge)

    const sheetBase = { type: 'sheet', pages: [{ id: 'sheet-page', cells: [['', ''], ['', '']], cellMerges: [], cellFormats: {} }] }
    const sheetLocal = structuredClone(sheetBase)
    const sheetRemote = structuredClone(sheetBase)
    sheetLocal.pages[0].cells[0][0] = 'Owner'
    sheetRemote.pages[0].cells[0][1] = 'Editor'
    const sheetMerged = collaboration.mergeConcurrentDocuments(sheetBase, sheetLocal, sheetRemote)
    assert.equal(sheetMerged.ok, true)
    assert.deepEqual(sheetMerged.value.pages[0].cells[0], ['Owner', 'Editor'])
    assert.deepEqual(mergeOnServer(sheetBase, sheetLocal, sheetRemote), sheetMerged)

    const sameCellRemote = structuredClone(sheetBase)
    sameCellRemote.pages[0].cells[0][0] = 'Editor overwrite'
    const sameCellConflict = collaboration.mergeConcurrentDocuments(sheetBase, sheetLocal, sameCellRemote)
    assert.equal(sameCellConflict.ok, false)
    assert.ok(sameCellConflict.conflicts.includes('pages[sheet-page].cells[0][0]'))
    assert.deepEqual(mergeOnServer(sheetBase, sheetLocal, sameCellRemote), sameCellConflict)

    const docTableBase = { type: 'doc', pages: [{ id: 'doc-page', blocks: [{ id: 'table-1', type: 'table', text: '', cells: [['A', 'B']] }] }] }
    const docTableLocal = structuredClone(docTableBase)
    const docTableRemote = structuredClone(docTableBase)
    docTableLocal.pages[0].blocks[0].cells[0][0] = 'Owner edit'
    docTableRemote.pages[0].blocks[0].cells[0][1] = 'Editor edit'
    const docTableMerge = collaboration.mergeConcurrentDocuments(docTableBase, docTableLocal, docTableRemote)
    assert.equal(docTableMerge.ok, true)
    assert.deepEqual(docTableMerge.value.pages[0].blocks[0].cells[0], ['Owner edit', 'Editor edit'])
    assert.deepEqual(mergeOnServer(docTableBase, docTableLocal, docTableRemote), docTableMerge)

    const disjointMergesLocal = structuredClone(sheetBase)
    const disjointMergesRemote = structuredClone(sheetBase)
    disjointMergesLocal.pages[0].cellMerges = [{ row: 0, column: 0, colSpan: 2 }]
    disjointMergesRemote.pages[0].cellMerges = [{ row: 1, column: 0, colSpan: 2 }]
    const mergeRanges = collaboration.mergeConcurrentDocuments(sheetBase, disjointMergesLocal, disjointMergesRemote)
    assert.equal(mergeRanges.ok, true)
    assert.equal(mergeRanges.value.pages[0].cellMerges.length, 2)
    const overlappingMergeRemote = structuredClone(sheetBase)
    overlappingMergeRemote.pages[0].cellMerges = [{ row: 0, column: 1, colSpan: 2 }]
    const overlappingRanges = collaboration.mergeConcurrentDocuments(sheetBase, disjointMergesLocal, overlappingMergeRemote)
    assert.equal(overlappingRanges.ok, false)
    assert.ok(overlappingRanges.conflicts.includes('pages[sheet-page].cellMerges (overlap)'))

    const verticalMergeBase = structuredClone(sheetBase)
    const verticalMergeLocal = structuredClone(sheetBase)
    const horizontalOverlapRemote = structuredClone(sheetBase)
    verticalMergeLocal.pages[0].cellMerges = [{ row: 0, column: 0, colSpan: 1, rowSpan: 2 }]
    horizontalOverlapRemote.pages[0].cellMerges = [{ row: 1, column: 0, colSpan: 2 }]
    const verticalOverlap = collaboration.mergeConcurrentDocuments(verticalMergeBase, verticalMergeLocal, horizontalOverlapRemote)
    assert.equal(verticalOverlap.ok, false, 'a concurrent horizontal merge conflicts with a vertical merge covering its row')
    assert.ok(verticalOverlap.conflicts.includes('pages[sheet-page].cellMerges (overlap)'))
    assert.deepEqual(mergeOnServer(verticalMergeBase, verticalMergeLocal, horizontalOverlapRemote), verticalOverlap)
  } finally {
    await vite.close()
  }
})
