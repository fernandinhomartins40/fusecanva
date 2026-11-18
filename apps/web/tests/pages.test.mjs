import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('page duplication regenerates nested IDs and page ordering/deletion stay valid', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const original = {
      id: 'design-1', name: 'Design', type: 'doc', width: 794, height: 1123, updatedAt: '',
      pages: [
        { id: 'page-1', name: 'Page 1', background: '#fff', hidden: true, elements: [{ id: 'text-1', type: 'text', text: 'Hello' }, { id: 'note-1', type: 'sticky-note', text: 'Note' }], connectors: [{ id: 'connector-1', fromId: 'text-1', toId: 'note-1', color: '#7464e8', strokeWidth: 4 }], groups: [{ id: 'group-1', name: 'Group 1', elementIds: ['text-1', 'note-1'] }], blocks: [
          { id: 'block-1', type: 'paragraph', text: 'Hello' },
          { id: 'table-1', type: 'table', text: '', cells: [['A', 'B']], merges: [{ row: 0, column: 0, colSpan: 2 }] },
        ] },
        { id: 'page-2', name: 'Page 2', background: '#000', elements: [], blocks: [{ id: 'block-2', type: 'paragraph', text: 'Other page' }] },
      ],
    }
    const duplicated = pages.duplicateDesignPage(original, 0)
    assert.equal(duplicated.pageIndex, 1)
    assert.equal(duplicated.document.pages.length, 3)
    const copy = duplicated.document.pages[1]
    assert.notEqual(copy.id, original.pages[0].id)
    assert.equal(copy.hidden, true, 'page duplication preserves section visibility metadata')
    assert.equal(original.pages[0].hidden, true, 'duplicating a section never mutates the original')
    assert.notEqual(copy.elements[0].id, original.pages[0].elements[0].id)
    assert.notEqual(copy.connectors[0].id, original.pages[0].connectors[0].id)
    assert.equal(copy.connectors[0].fromId, copy.elements[0].id)
    assert.equal(copy.connectors[0].toId, copy.elements[1].id)
    assert.notEqual(copy.groups[0].id, original.pages[0].groups[0].id)
    assert.deepEqual(copy.groups[0].elementIds, copy.elements.map(element => element.id))
    assert.notEqual(copy.blocks[0].id, original.pages[0].blocks[0].id)
    assert.notEqual(copy.blocks[1].id, original.pages[0].blocks[1].id)
    assert.deepEqual(copy.blocks[1].cells, [['A', 'B']])
    copy.blocks[1].cells[0][0] = 'Changed copy'
    assert.equal(original.pages[0].blocks[1].cells[0][0], 'A')

    const moved = pages.moveDesignPage(duplicated.document, 1, 2)
    assert.equal(moved.pageIndex, 2)
    assert.equal(moved.document.pages[2].id, copy.id)
    const deleted = pages.deleteDesignPage(moved.document, 2)
    assert.equal(deleted.pageIndex, 1)
    assert.deepEqual(deleted.document.pages.map(page => page.id), ['page-1', 'page-2'])
    assert.equal(pages.deleteDesignPage({ ...original, pages: [original.pages[0]] }, 0), null)
  } finally {
    await vite.close()
  }
})

test('duplicating a video scene copies its timeline clips with fresh clip identities', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const source = {
      id: 'video-1', name: 'Video', type: 'video', width: 1920, height: 1080, updatedAt: '',
      pages: [{
        id: 'scene-1', name: 'Scene 1', background: '#000', elements: [],
        timelineClips: [{ id: 'clip-1', assetId: 'asset-1', name: 'Music', kind: 'audio', startMs: 120, durationMs: 900, sourceDurationMs: 2000, sourceStartMs: 80, volume: 0.7 }],
      }],
    }
    const result = pages.duplicateDesignPage(source, 0)
    const sourceClip = source.pages[0].timelineClips[0]
    const duplicateClip = result.document.pages[1].timelineClips[0]
    assert.notEqual(duplicateClip.id, sourceClip.id)
    assert.equal(duplicateClip.assetId, sourceClip.assetId)
    assert.deepEqual({ ...duplicateClip, id: sourceClip.id }, sourceClip)
    duplicateClip.startMs = 300
    assert.equal(sourceClip.startMs, 120, 'editing a duplicated clip never mutates the source scene')
  } finally {
    await vite.close()
  }
})

test('whole project copy regenerates nested identities and internal references while retaining content and media IDs', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { duplicateDesignDocument } = await vite.ssrLoadModule('/src/pages.ts')
    const source = {
      id: 'source', name: 'Source', type: 'site', width: 1440, height: 900, updatedAt: '2026-10-01T00:00:00.000Z',
      archivedAt: '2026-10-01T00:00:00.000Z', trashedAt: undefined,
      pages: [
        { id: 'home', name: 'Home', background: '#fff', elements: [
          { id: 'link', type: 'text', name: 'Go', text: 'Go', href: '#site-section-contact', x: 0, y: 0, width: 80, height: 30, rotation: 0, fontSize: 16, fontFamily: 'Arial', color: '#000', bold: false },
          { id: 'image', type: 'image', name: 'Logo', src: 'data:image/png;base64,AA==', assetId: 'asset-shared', x: 0, y: 40, width: 100, height: 100, rotation: 0 },
        ], groups: [{ id: 'group-source', name: 'Logo group', elementIds: ['link', 'image'] }], connectors: [{ id: 'connector-source', fromId: 'link', toId: 'image', color: '#000', strokeWidth: 2 }], timelineClips: [{ id: 'clip-source', assetId: 'asset-audio', name: 'Audio', kind: 'audio', startMs: 0, durationMs: 1000, sourceDurationMs: 1000, sourceStartMs: 0, volume: 1 }] },
        { id: 'contact', name: 'Contact', background: '#eee', elements: [], blocks: [{ id: 'block-source', type: 'paragraph', text: 'Email' }] },
      ],
    }
    const copy = duplicateDesignDocument(source, 'Source copy')
    assert.notEqual(copy.id, source.id)
    assert.equal(copy.name, 'Source copy')
    assert.equal(Object.hasOwn(copy, 'archivedAt'), false)
    assert.equal(Object.hasOwn(copy, 'trashedAt'), false)
    assert.notEqual(copy.pages[0].id, source.pages[0].id)
    assert.notEqual(copy.pages[1].id, source.pages[1].id)
    const [link, image] = copy.pages[0].elements
    assert.notEqual(link.id, source.pages[0].elements[0].id)
    assert.equal(link.href, `#site-section-${copy.pages[1].id}`)
    assert.equal(image.assetId, 'asset-shared')
    assert.equal(copy.pages[0].connectors[0].fromId, link.id)
    assert.equal(copy.pages[0].connectors[0].toId, image.id)
    assert.deepEqual(copy.pages[0].groups[0].elementIds, [link.id, image.id])
    assert.notEqual(copy.pages[0].timelineClips[0].id, source.pages[0].timelineClips[0].id)
    assert.equal(copy.pages[0].timelineClips[0].assetId, 'asset-audio')
    assert.notEqual(copy.pages[1].blocks[0].id, source.pages[1].blocks[0].id)
    assert.equal(copy.pages[1].blocks[0].text, 'Email')
  } finally {
    await vite.close()
  }
})
