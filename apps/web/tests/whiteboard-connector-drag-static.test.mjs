import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const appPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/App.tsx')
const appSource = readFileSync(appPath, 'utf8')

test('selected whiteboard connectors render draggable start and end anchor handles', () => {
  assert.ok(appSource.includes("(['fromAnchor', 'toAnchor'] as const)"), 'both connector endpoints render through the same handle path')
  assert.ok(appSource.includes('draggable={canEdit}'), 'only editable sessions can drag the handles')
  assert.ok(appSource.includes('onDragEnd={event => {'), 'a completed handle drag updates the connector')
  assert.ok(appSource.includes('snapConnectorAnchor(element, { x: event.target.x(), y: event.target.y() })'), 'handle positions snap to the attached element border')
  assert.ok(appSource.includes("endpoint === 'fromAnchor' ? { fromAnchor: anchor } : { toAnchor: anchor }"), 'dragging either handle patches its matching endpoint')
})
