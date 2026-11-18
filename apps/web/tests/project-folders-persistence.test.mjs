import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { createServer } from 'vite'

test('project folders persist, sort favorites, and prevent deleting folders with active designs', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const persistence = await vite.ssrLoadModule('/src/persistence.ts')
    const model = await vite.ssrLoadModule('/src/model.ts')
    const stamp = new Date().toISOString()
    const normal = { id: 'folder-test-normal', name: 'Projetos', createdAt: stamp, updatedAt: stamp, favorite: false }
    const favorite = { id: 'folder-test-favorite', name: 'Favoritos', createdAt: stamp, updatedAt: stamp, favorite: true }
    await persistence.writeProjectFolder(normal)
    await persistence.writeProjectFolder(favorite)
    assert.deepEqual((await persistence.listProjectFolders()).slice(0, 2).map(folder => folder.id), [favorite.id, normal.id])

    const design = model.createBlankDocument('Projeto guardado')
    design.id = 'folder-test-design'
    design.folderId = normal.id
    await persistence.writeDocument(design)
    assert.equal((await persistence.listDocuments()).find(document => document.id === design.id).folderId, normal.id)
    await assert.rejects(persistence.deleteProjectFolder(normal.id), /pasta não está vazia/i)

    await persistence.writeDocument({ ...design, folderId: favorite.id, updatedAt: new Date(Date.now() + 1000).toISOString() })
    assert.equal((await persistence.listDocuments()).find(document => document.id === design.id).folderId, favorite.id)
    await persistence.deleteProjectFolder(normal.id)
    assert.equal((await persistence.listProjectFolders()).some(folder => folder.id === normal.id), false)
  } finally {
    await vite.close()
  }
})
