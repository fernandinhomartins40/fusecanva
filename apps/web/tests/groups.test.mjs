import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('whiteboard groups preserve members, move together, ungroup, and clean references on deletion', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const groups = await vite.ssrLoadModule('/src/groups.ts')
    const page = {
      id: 'page-1', name: 'Board', background: '#fff',
      elements: [
        { id: 'note-1', type: 'sticky-note', x: 10, y: 20, width: 100, height: 100 },
        { id: 'shape-1', type: 'shape', x: 160, y: 60, width: 80, height: 60 },
        { id: 'shape-2', type: 'shape', x: 300, y: 60, width: 80, height: 60 },
      ],
      connectors: [{ id: 'connector-1', fromId: 'note-1', toId: 'shape-1', color: '#7464e8', strokeWidth: 4 }],
    }
    const grouped = groups.createWhiteboardGroup(page, ['note-1', 'shape-1'])
    assert.equal(grouped.groups.length, 1)
    assert.deepEqual(groups.selectionForElement(grouped, 'shape-1'), ['note-1', 'shape-1'])
    assert.equal(groups.createWhiteboardGroup(grouped, ['note-1', 'shape-2']), null)

    const distributed = groups.arrangeWhiteboardElements(page.elements, ['note-1', 'shape-1', 'shape-2'], 'distribute-x')
    assert.deepEqual(distributed.map(({ x, y }) => [x, y]), [[10, 20], [165, 60], [300, 60]])
    const alignedLeft = groups.arrangeWhiteboardElements(page.elements, ['note-1', 'shape-1'], 'left')
    assert.deepEqual(alignedLeft.map(({ x, y }) => [x, y]), [[10, 20], [10, 60], [300, 60]])
    const rotatedAlignment = groups.arrangeWhiteboardElements([
      { id: 'rotated', type: 'shape', x: 0, y: 0, width: 100, height: 20, rotation: 90 },
      { id: 'plain', type: 'shape', x: 100, y: 30, width: 20, height: 80, rotation: 0 },
    ], ['rotated', 'plain'], 'left')
    assert.equal(rotatedAlignment[1].x, 40)

    const moved = groups.moveWhiteboardElements(grouped, ['note-1', 'shape-1'], 12, -5)
    assert.deepEqual(moved.elements.map(({ x, y }) => [x, y]), [[22, 15], [172, 55], [300, 60]])
    const ungrouped = groups.ungroupWhiteboardSelection(moved, ['note-1'])
    assert.deepEqual(ungrouped.groups, [])

    const removed = groups.removeWhiteboardElements(grouped, ['note-1'])
    assert.equal(removed.elements.some(element => element.id === 'note-1'), false)
    assert.deepEqual(removed.connectors, [])
    assert.deepEqual(removed.groups, [])
  } finally {
    await vite.close()
  }
})
