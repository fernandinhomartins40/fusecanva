import assert from 'node:assert/strict'
import test from 'node:test'
import { reducePresenceMessage } from '../src/presence-state.mjs'

const cursor = { pageId: 'page-1', x: 0.25, y: 0.75 }
const selection = { pageId: 'page-1', elementId: 'shape-1', kind: 'element' }

test('cursor and selection events arriving before the presence snapshot are retained', () => {
  let presence = [{ id: 'owner', name: 'Owner', connections: 1, cursor: null, selection: null }]
  presence = reducePresenceMessage(presence, { type: 'cursor.updated', userId: 'editor', name: 'Editor', cursor })
  presence = reducePresenceMessage(presence, { type: 'selection.updated', userId: 'editor', name: 'Editor', selection })

  presence = reducePresenceMessage(presence, { type: 'presence.updated', users: [
    { id: 'owner', name: 'Owner', connections: 1 },
    { id: 'editor', name: 'Editor', connections: 2 },
  ] })

  assert.deepEqual(presence, [
    { id: 'owner', name: 'Owner', connections: 1, cursor: null, selection: null },
    { id: 'editor', name: 'Editor', connections: 2, cursor, selection },
  ])
})

test('presence snapshots remove departed collaborators and later cursor clear events keep the list stable', () => {
  let presence = reducePresenceMessage([], { type: 'cursor.updated', userId: 'editor', cursor })
  presence = reducePresenceMessage(presence, { type: 'selection.updated', userId: 'editor', selection })
  presence = reducePresenceMessage(presence, { type: 'presence.updated', users: [] })
  assert.deepEqual(presence, [], 'departed collaborators are removed by the authoritative snapshot')
  assert.deepEqual(reducePresenceMessage(presence, { type: 'cursor.updated', userId: 'editor', cursor: null }), [], 'cursor clears for departed users do not recreate presence')
})

test('selection and cursor clearing retain collaborator metadata for connected users', () => {
  let presence = reducePresenceMessage([], { type: 'cursor.updated', userId: 'editor', name: 'Editor', cursor })
  presence = reducePresenceMessage(presence, { type: 'selection.updated', userId: 'editor', selection })
  presence = reducePresenceMessage(presence, { type: 'selection.updated', userId: 'editor', selection: null })
  presence = reducePresenceMessage(presence, { type: 'cursor.updated', userId: 'editor', cursor: null })
  assert.deepEqual(presence, [{ id: 'editor', name: 'Editor', connections: 1, cursor: null, selection: null }])
})
