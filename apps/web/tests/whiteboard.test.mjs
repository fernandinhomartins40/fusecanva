import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('whiteboard starts in a large workspace and anchored zoom preserves the point under the pointer', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const model = await vite.ssrLoadModule('/src/model.ts')
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const board = await vite.ssrLoadModule('/src/whiteboard.ts')
    const vectors = await vite.ssrLoadModule('/src/vector-shapes.ts')
    assert.ok(vectors.VECTOR_SHAPES.includes('line'), 'the line is registered in the shared shape library')
    assert.equal(vectors.VECTOR_SHAPE_LABELS.line, 'Linha', 'the line library exposes a discoverable localized name')
    const document = model.createTypedBlankDocument('whiteboard')
    assert.equal(document.type, 'whiteboard')
    assert.deepEqual([document.width, document.height], [3200, 2000])
    assert.equal(document.name, 'Quadro sem título')
    assert.equal(document.pages[0].name, 'Quadro 1')
    assert.equal(pages.createBlankDesignPage(document).name, 'Quadro 2')
    const lineFixture = { id: 'line-fixture', type: 'shape', shape: 'line', x: 120, y: 160, width: 320, height: 8, rotation: 0, fill: '#202124', strokeWidth: 4, startArrow: false, endArrow: true, curveOffset: -96 }
    const noteFixture = model.createStickyNoteElement(500, 160)
    const qrFixture = { id: 'qr-fixture', type: 'shape', shape: 'rect', x: 500, y: 160, width: 120, height: 120, rotation: 0, fill: '#111111', cornerRadius: 0 }
    const qrSettingsFixture = { ...qrFixture, qrConfig: { pattern: 'circles', foreground: '#000000', background: '#ffffff', logo: 'none', corner: 0 } }
    const savedQrSettings = JSON.parse(JSON.stringify(qrSettingsFixture))
    assert.equal(savedQrSettings.qrConfig.pattern, 'circles', 'the pattern persists as element configuration')
    assert.equal('invalidUrlDraft' in savedQrSettings.qrConfig, false, 'URL draft text is excluded from persisted element configuration')
    const overlapLineFixture = { ...lineFixture, x: 520, y: 210, width: 140 }
    const overlapStack = [noteFixture, overlapLineFixture, qrFixture]
    const occludedLineHitArea = { x: overlapLineFixture.x + 40, y: overlapLineFixture.y + 3, width: 1, height: 1 }
    assert.deepEqual(board.elementsIntersectingRect(overlapStack, occludedLineHitArea), [noteFixture.id, overlapLineFixture.id, qrFixture.id], 'marquee selection can reach the line and other layers even when a top object covers their hit area')
    const backStack = board.moveWhiteboardElementToEdge(overlapStack, qrFixture.id, 'back')
    assert.deepEqual(backStack.map(element => element.id), [qrFixture.id, noteFixture.id, overlapLineFixture.id], 'sending the topmost overlapping object to the back leaves note and curved line above it')
    assert.equal(backStack[0], qrFixture, 'the back action preserves the layer record')
    const frontStack = board.moveWhiteboardElementToEdge(backStack, qrFixture.id, 'front')
    assert.deepEqual(frontStack.map(element => element.id), overlapStack.map(element => element.id), 'bringing the object back to the top restores the original z-order')
    assert.deepEqual(frontStack, overlapStack, 'back/top roundtrip preserves every element record')
    assert.deepEqual(board.elementsIntersectingRect(backStack, occludedLineHitArea), [qrFixture.id, noteFixture.id, overlapLineFixture.id], 'reordering changes only the reported paint order while every overlapping object remains selectable')
    assert.equal(board.moveWhiteboardElementToEdge(overlapStack, 'missing', 'back'), overlapStack, 'an unknown layer is a no-op')
    const swappedLine = board.swapWhiteboardLineEndpoints(lineFixture)
    assert.deepEqual([swappedLine.startArrow, swappedLine.endArrow], [true, false], 'endpoint swap moves the marker from final to initial')
    assert.deepEqual({ ...board.swapWhiteboardLineEndpoints(swappedLine) }, lineFixture, 'swapping twice restores the exact line fixture')
    assert.deepEqual([swappedLine.id, swappedLine.x, swappedLine.y, swappedLine.width, swappedLine.height, swappedLine.curveOffset], [lineFixture.id, lineFixture.x, lineFixture.y, lineFixture.width, lineFixture.height, lineFixture.curveOffset], 'marker swap preserves line identity, geometry, and curve')
    const serializedLineState = JSON.parse(JSON.stringify({ elements: [swappedLine, noteFixture] }))
    assert.deepEqual(serializedLineState.elements.map(element => element.id), [lineFixture.id, noteFixture.id], 'line marker edits preserve unrelated page content in persisted JSON')
    assert.deepEqual([serializedLineState.elements[0].startArrow, serializedLineState.elements[0].endArrow], [true, false], 'the swapped marker state survives a serialization roundtrip')
    assert.deepEqual(vectors.vectorLineArrowheadPoints(lineFixture.width, lineFixture.height, lineFixture.curveOffset, true).slice(0, 2), [0, lineFixture.height / 2], 'a curved initial marker remains at its endpoint')
    assert.deepEqual(vectors.vectorLineArrowheadPoints(lineFixture.width, lineFixture.height, lineFixture.curveOffset).slice(0, 2), [lineFixture.width, lineFixture.height / 2], 'a curved final marker remains at its endpoint')
    const note = model.createStickyNoteElement(140, 280)
    const secondNote = model.createStickyNoteElement(560, 320)
    const marquee = board.normalizeWhiteboardRect({ x: 500, y: 700 }, { x: 120, y: 250 })
    assert.deepEqual(marquee, { x: 120, y: 250, width: 380, height: 450 })
    assert.deepEqual(board.elementsIntersectingRect([note, secondNote], marquee), [note.id])
    assert.deepEqual(board.elementsIntersectingRect([note, secondNote], { x: 400, y: 500, width: 10, height: 10 }), [note.id])
    const stroke = model.createFreeDrawElement([10, 20, 30, 50])
    assert.equal(note.type, 'sticky-note')
    assert.deepEqual([note.x, note.y, note.width, note.height], [140, 280, 260, 220])
    assert.equal(note.text, 'Escreva uma ideia')
    document.pages[0].elements.push(note)
    assert.equal(document.pages[0].elements[0].fill, '#fff2a8')
    assert.deepEqual([stroke.x, stroke.y, stroke.width, stroke.height], [10, 20, 20, 30])
    assert.deepEqual(stroke.points, [0, 0, 20, 30])
    document.pages[0].elements.push(secondNote)
    const connector = { id: 'connector-1', fromId: note.id, toId: secondNote.id, color: '#7464e8', strokeWidth: 4 }
    document.pages[0].connectors = [connector]
    const connectorCoordinates = board.connectorPoints(document.pages[0], connector)
    assert.equal(connectorCoordinates[0], 400)
    assert.ok(Math.abs(connectorCoordinates[1] - 402.3809523809524) < 1e-9)
    assert.equal(connectorCoordinates[2], 560)
    assert.ok(Math.abs(connectorCoordinates[3] - 417.6190476190476) < 1e-9)
    const anchored = { ...connector, fromAnchor: { x: 1, y: 0.25 }, toAnchor: { x: 0, y: 0.75 } }
    assert.deepEqual(board.connectorPoints(document.pages[0], anchored), [400, 335, 560, 485])
    assert.deepEqual(board.snapConnectorAnchor(note, { x: 398, y: 340 }), { x: 1, y: 0.2727272727272727 })
    const movedPage = { ...document.pages[0], elements: [{ ...note, x: note.x + 30 }, secondNote] }
    assert.deepEqual(board.connectorPoints(movedPage, anchored), [430, 335, 560, 485])
    const rotated = { ...note, rotation: 90 }
    assert.deepEqual(board.connectorAnchorPoint(rotated, { x: 1, y: 0.5 }), { x: 270, y: 520 })
    const groupedPage = { ...document.pages[0], groups: [{ id: 'group-1', name: 'Pair', elementIds: [secondNote.id, 'deleted-member', note.id] }] }
    assert.deepEqual(board.remoteWhiteboardSelectionElements(groupedPage, secondNote.id).map(element => element.id), [note.id, secondNote.id], 'a remote selection resolves the whole group in page order and skips stale members')
    assert.deepEqual(board.remoteWhiteboardSelectionElements(document.pages[0], note.id).map(element => element.id), [note.id], 'an ungrouped remote selection resolves to its selected element')
    assert.deepEqual(board.remoteWhiteboardSelectionElements(document.pages[0], 'deleted-element'), [], 'a stale remote selection resolves to no visible elements')
    assert.deepEqual(board.retainValidConnectors({ ...document.pages[0], elements: [note] }), [])

    const position = { x: -130, y: 42 }
    const pointer = { x: 280, y: 360 }
    const zoom = 0.5
    const before = { x: (pointer.x - position.x) / zoom, y: (pointer.y - position.y) / zoom }
    const next = board.zoomWhiteboardAtPoint(position, zoom, pointer, 1.25)
    const after = { x: (pointer.x - next.position.x) / next.zoom, y: (pointer.y - next.position.y) / next.zoom }
    assert.ok(Math.abs(before.x - after.x) < 1e-9)
    assert.ok(Math.abs(before.y - after.y) < 1e-9)
    assert.equal(board.clampWhiteboardZoom(0), 0.08)
    assert.equal(board.clampWhiteboardZoom(6), 3)
    assert.equal(board.clampWhiteboardZoom(Number.NaN), 1, 'a non-finite zoom falls back to a usable default')
    assert.equal(board.clampWhiteboardZoom(Number.POSITIVE_INFINITY), 1)
    assert.deepEqual(board.zoomWhiteboardAtPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, Number.NaN, { x: Number.NEGATIVE_INFINITY, y: Number.NaN }, Number.NaN), { position: { x: 0, y: 0 }, zoom: 1 }, 'invalid saved transforms and pointer coordinates do not propagate NaN')
    assert.deepEqual(board.centerWhiteboard(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY, Number.NaN), { x: 0, y: 0 }, 'centering remains finite for malformed canvas and viewport dimensions')
    assert.equal(board.fitWhiteboardZoom(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY), 0.08, 'fit zoom falls back to its minimum for malformed extents')
    const fit = board.fitWhiteboardZoom(3200, 2000, 960, 720)
    assert.ok(fit > 0 && fit < 1)
    assert.ok(Number.isFinite(board.centerWhiteboard(3200, 2000, 390, 700, 0.55).x))
  } finally {
    await vite.close()
  }
})
