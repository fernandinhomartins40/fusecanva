import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { createServer } from 'vite'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

test('legacy local documents migrate to current schema, rehydrate shared media and reclaim unused assets', async () => {
  const oldRequest = indexedDB.open('fuse-studio', 1)
  oldRequest.onupgradeneeded = () => oldRequest.result.createObjectStore('documents', { keyPath: 'id' })
  const oldDatabase = await requestResult(oldRequest)
  const fixture = {
    id: 'preserved-design',
    name: 'Documento existente',
    width: 794,
    height: 1123,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pages: [{ id: 'page-1', name: 'Página 1', background: '#ffffff', elements: [{ id: 'legacy-image', type: 'image', name: 'legado.png', assetId: 'legacy-asset', src: 'data:image/png;base64,AA==', x: 8, y: 12, width: 32, height: 24, rotation: 0 }] }],
  }
  const transaction = oldDatabase.transaction('documents', 'readwrite')
  transaction.objectStore('documents').put(fixture)
  await transactionComplete(transaction)
  oldDatabase.close()

  const oldAsset = {
    id: 'asset-from-v2',
    name: 'anterior.png',
    mimeType: 'image/png',
    width: 16,
    height: 12,
    src: 'data:image/png;base64,AA==',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  const versionTwoRequest = indexedDB.open('fuse-studio', 2)
  versionTwoRequest.onupgradeneeded = () => versionTwoRequest.result.createObjectStore('assets', { keyPath: 'id' })
  const versionTwoDatabase = await requestResult(versionTwoRequest)
  const versionTwoTransaction = versionTwoDatabase.transaction('assets', 'readwrite')
  versionTwoTransaction.objectStore('assets').put(oldAsset)
  await transactionComplete(versionTwoTransaction)
  versionTwoDatabase.close()

  const vite = await createServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
  const openedDatabases = []
  const originalOpen = indexedDB.open.bind(indexedDB)
  indexedDB.open = (...args) => {
    const request = originalOpen(...args)
    request.addEventListener('success', () => openedDatabases.push(request.result))
    return request
  }

  try {
    const store = await vite.ssrLoadModule('/src/persistence.ts')
    const model = await vite.ssrLoadModule('/src/model.ts')
    const previous = await store.readDocument(fixture.id)
    assert.equal(previous?.name, fixture.name)
    assert.deepEqual(previous?.pages, fixture.pages)
    assert.deepEqual(await store.listMediaAssets(), [oldAsset])
    await store.deleteMediaAsset(oldAsset.id)
    assert.deepEqual(await store.listMediaAssets(), [])

    const image = {
      id: 'asset-1',
      name: 'amostra.png',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      src: 'data:image/png;base64,AA==',
      createdAt: '2026-01-02T00:00:00.000Z',
    }
    await store.writeMediaAsset(image)
    assert.deepEqual(await store.listMediaAssets(), [image])
    await store.deleteMediaAsset(image.id)
    assert.deepEqual(await store.listMediaAssets(), [])

    const referencedAsset = { ...image, id: 'asset-used-by-design', fingerprint: 'same-bytes' }
    await store.writeMediaAsset(referencedAsset)
    const imageDocument = model.createTypedBlankDocument('design')
    imageDocument.pages[0].presenterNotes = 'Nota compatível com conteúdo adicional por página.'
    imageDocument.pages[0].elements.push({ id: 'image-element', type: 'image', name: referencedAsset.name, assetId: referencedAsset.id, src: referencedAsset.src, x: 0, y: 0, width: 640, height: 480, rotation: 0 })
    await store.writeDocument(imageDocument)
    assert.equal((await store.readDocument(imageDocument.id)).pages[0].elements[0].src, referencedAsset.src)
    assert.equal((await store.readDocument(imageDocument.id)).pages[0].presenterNotes, imageDocument.pages[0].presenterNotes)
    assert.equal((await store.listDocuments()).find(document => document.id === imageDocument.id).pages[0].elements[0].src, referencedAsset.src)

    const secondImageDocument = structuredClone(imageDocument)
    secondImageDocument.id = 'second-image-document'
    secondImageDocument.name = 'Segundo documento com mídia'
    await store.writeDocument(secondImageDocument)

    const rawDatabase = await requestResult(indexedDB.open('fuse-studio'))
    const rawDocument = await requestResult(rawDatabase.transaction('documents', 'readonly').objectStore('documents').get(imageDocument.id))
    assert.equal(rawDocument.pages[0].elements[0].src, '')
    rawDatabase.close()

    await store.deleteMediaAsset(referencedAsset.id)
    assert.deepEqual(await store.listMediaAssets(), [])
    assert.equal((await store.listStoredMediaAssets())[0].libraryVisible, 0)
    assert.equal((await store.readDocument(imageDocument.id)).pages[0].elements[0].src, referencedAsset.src)
    assert.equal((await store.listDocuments()).find(document => document.id === imageDocument.id).pages[0].elements[0].src, referencedAsset.src)
    const revivedAsset = { ...(await store.listStoredMediaAssets())[0], libraryVisible: 1 }
    await store.writeMediaAsset(revivedAsset)
    assert.deepEqual(await store.listMediaAssets(), [revivedAsset])
    await store.deleteMediaAsset(referencedAsset.id)
    const documentWithoutImage = structuredClone(imageDocument)
    documentWithoutImage.pages[0].elements = []
    await store.writeDocument(documentWithoutImage)
    assert.equal((await store.listStoredMediaAssets()).length, 1)
    assert.equal((await store.readDocument(secondImageDocument.id)).pages[0].elements[0].src, referencedAsset.src)
    const secondDocumentWithoutImage = structuredClone(secondImageDocument)
    secondDocumentWithoutImage.pages[0].elements = []
    await store.writeDocument(secondDocumentWithoutImage)
    assert.deepEqual(await store.listStoredMediaAssets(), [])
    const cleanupDatabase = await requestResult(indexedDB.open('fuse-studio'))
    const cleanupTransaction = cleanupDatabase.transaction('documents', 'readwrite')
    cleanupTransaction.objectStore('documents').delete(imageDocument.id)
    cleanupTransaction.objectStore('documents').delete(secondImageDocument.id)
    await transactionComplete(cleanupTransaction)
    cleanupDatabase.close()

    const nextDocument = { ...fixture, id: 'new-design', name: 'Novo documento' }
    await store.writeDocument(nextDocument)
    assert.deepEqual((await store.listDocuments()).map(document => document.id), ['new-design', 'preserved-design'])

    const nonemptyTrashItem = { ...fixture, id: 'trash-lifecycle', name: 'Projeto não vazio', archivedAt: '2026-10-21T12:00:00.000Z' }
    await store.writeDocument(nonemptyTrashItem)
    const trashedLocal = { ...nonemptyTrashItem, archivedAt: undefined, trashedAt: '2026-10-21T12:01:00.000Z' }
    delete trashedLocal.archivedAt
    await store.writeDocument(trashedLocal)
    const restoredLocal = { ...(await store.readDocument(trashedLocal.id)) }
    delete restoredLocal.trashedAt
    await store.writeDocument(restoredLocal)
    assert.equal((await store.readDocument(restoredLocal.id)).pages[0].elements[0].assetId, 'legacy-asset', 'restoring a local project retains its referenced media')
    const { archivedAt: _archivedAt, trashedAt: _trashedAt, ...activeCopyData } = trashedLocal
    const activeCopy = { ...activeCopyData, id: 'trash-lifecycle-copy', name: 'Projeto não vazio — cópia' }
    await store.writeDocument(activeCopy)
    const persistedCopy = await store.readDocument(activeCopy.id)
    assert.equal(persistedCopy.pages[0].elements[0].assetId, 'legacy-asset')
    assert.equal(Object.hasOwn(persistedCopy, 'trashedAt'), false)

    const deletionAsset = { ...image, id: 'hidden-shared-asset', libraryVisible: 0 }
    await store.writeMediaAsset(deletionAsset)
    const deletionDocuments = ['delete-source', 'delete-retained'].map(id => ({ ...model.createTypedBlankDocument('design'), id, trashedAt: '2026-10-21T12:02:00.000Z', pages: [{ id: `${id}-page`, background: '#ffffff', elements: [{ id: `${id}-image`, type: 'image', name: deletionAsset.name, assetId: deletionAsset.id, src: deletionAsset.src, x: 0, y: 0, width: 10, height: 10, rotation: 0 }] }] }))
    for (const document of deletionDocuments) await store.writeDocument(document)
    await store.deleteDocument(deletionDocuments[0].id, deletionDocuments[0].updatedAt)
    assert.equal(await store.readDocument(deletionDocuments[0].id), undefined)
    assert.equal((await store.readDocument(deletionDocuments[1].id)).pages[0].elements[0].src, deletionAsset.src, 'deleting one project keeps media referenced by another project')
    await store.deleteDocument(deletionDocuments[1].id, deletionDocuments[1].updatedAt)
    assert.equal(await store.readDocument(deletionDocuments[1].id), undefined)
    assert.equal((await store.listStoredMediaAssets()).some(asset => asset.id === deletionAsset.id), false, 'unreferenced hidden media is reclaimed after the last project is deleted')

    const batchAsset = { ...image, id: 'batch-hidden-asset', libraryVisible: 0 }
    await store.writeMediaAsset(batchAsset)
    const batchDocuments = ['empty-trash-a', 'empty-trash-b'].map(id => ({ ...model.createTypedBlankDocument('design'), id, trashedAt: '2026-10-21T12:03:00.000Z', pages: [{ id: `${id}-page`, background: '#ffffff', elements: [{ id: `${id}-image`, type: 'image', name: batchAsset.name, assetId: batchAsset.id, src: batchAsset.src, x: 0, y: 0, width: 10, height: 10, rotation: 0 }] }] }))
    for (const document of batchDocuments) await store.writeDocument(document)
    await store.deleteDocuments(batchDocuments.map(document => ({ id: document.id, updatedAt: document.updatedAt })))
    assert.ok((await Promise.all(batchDocuments.map(document => store.readDocument(document.id)))).every(document => document === undefined))
    assert.equal((await store.listStoredMediaAssets()).some(asset => asset.id === batchAsset.id), false, 'batch deletion releases hidden media after its final references are removed')

    const changedTrashProject = { ...model.createTypedBlankDocument('design'), id: 'changed-trash-project', trashedAt: '2026-10-21T12:04:00.000Z' }
    await store.writeDocument(changedTrashProject)
    const deleteConfirmationSnapshot = await store.readDocument(changedTrashProject.id)
    const restoredDuringConfirmation = { ...deleteConfirmationSnapshot, updatedAt: new Date(Date.parse(deleteConfirmationSnapshot.updatedAt) + 1000).toISOString() }
    delete restoredDuringConfirmation.trashedAt
    await store.writeDocument(restoredDuringConfirmation)
    await assert.rejects(store.deleteDocument(changedTrashProject.id, deleteConfirmationSnapshot.updatedAt), /mudou ou saiu da lixeira/)
    assert.ok(await store.readDocument(changedTrashProject.id), 'a local delete confirmation cannot remove a project that has since left the trash')

    const typedDocument = model.createTypedBlankDocument('doc')
    assert.equal(typedDocument.type, 'doc')
    assert.equal(typedDocument.pages[0].blocks[0].type, 'paragraph')

    const cloudBase = model.createTypedBlankDocument('sheet')
    const cloudDraftDocument = structuredClone(cloudBase)
    cloudDraftDocument.pages[0].cells[0][0] = 'Pending offline edit'
    const cloudDraft = { documentId: cloudBase.id, baseRevision: 7, role: 'owner', base: cloudBase, document: cloudDraftDocument, updatedAt: '2026-10-24T00:00:00.000Z' }
    await store.writeCloudDraft(cloudDraft)
    assert.deepEqual(await store.readCloudDraft(cloudBase.id), cloudDraft, 'cloud drafts persist separately from the local project library')
    await store.deleteCloudDraft(cloudBase.id, cloudBase)
    assert.deepEqual(await store.readCloudDraft(cloudBase.id), cloudDraft, 'a stale save cannot delete a newer offline draft')
    await store.deleteCloudDraft(cloudBase.id, cloudDraftDocument)
    assert.equal(await store.readCloudDraft(cloudBase.id), undefined, 'a matching remote save clears its exact local draft')

    assert.ok(model.STARTER_TEMPLATES.length >= 12)
    assert.equal(new Set(model.STARTER_TEMPLATES.map(template => template.id)).size, model.STARTER_TEMPLATES.length)
    assert.equal(new Set(model.STARTER_TEMPLATES.map(template => template.name)).size, model.STARTER_TEMPLATES.length)
    for (const template of model.STARTER_TEMPLATES) {
      const metadata = model.STARTER_TEMPLATE_METADATA[template.id]
      assert.ok(metadata, `template ${template.id} has explicit discovery metadata`)
      assert.ok(metadata.tags.length > 0)
      assert.ok(['portrait', 'square', 'story', 'landscape'].includes(metadata.format))
      assert.ok(['violet', 'warm', 'green', 'dark'].includes(metadata.palette))
      assert.equal(metadata.license, 'original', 'catalog assets identify their original Fuse Studio license class')
    }
    const templates = model.STARTER_TEMPLATES.map(template => model.createStarterDocument(template.id))
    const ids = templates.map(document => [document.id, ...document.pages.map(page => page.id), ...document.pages.flatMap(page => page.elements.map(element => element.id))])
    for (const document of templates.filter(item => item.type === 'doc')) ids.push(document.pages.flatMap(page => (page.blocks ?? []).map(block => block.id)))
    for (const templateIds of ids) assert.equal(new Set(templateIds).size, templateIds.length)
    assert.equal(new Set(ids.flat()).size, ids.flat().length)
    assert.deepEqual(templates.map(document => document.name), model.STARTER_TEMPLATES.map(template => template.name))
    assert.deepEqual([templates.find(document => document.name === 'Post geométrico').width, templates.find(document => document.name === 'Post geométrico').height], [1080, 1080])
    assert.deepEqual([templates.find(document => document.name === 'Story em movimento').width, templates.find(document => document.name === 'Story em movimento').height], [1080, 1920])
    assert.deepEqual([templates.find(document => document.name === 'Banner panorama').width, templates.find(document => document.name === 'Banner panorama').height], [1600, 600])
    assert.equal(templates.find(document => document.name === 'Abertura de apresentação').type, 'presentation')
    const siteTemplate = templates.find(document => document.name === 'Portfólio online')
    assert.equal(siteTemplate.type, 'site')
    assert.equal(siteTemplate.width, 1440)
    assert.equal(siteTemplate.pages.length, 2)
    assert.ok(siteTemplate.pages[0].elements.some(element => element.type === 'text' && element.href === `#site-section-${siteTemplate.pages[1].id}`))
    const briefingTemplate = templates.find(document => document.name === 'Briefing de projeto')
    assert.equal(briefingTemplate.type, 'doc')
    assert.ok(briefingTemplate.pages[0].blocks.some(block => block.type === 'heading' && block.text === 'Briefing de projeto'))
    assert.ok(briefingTemplate.pages[0].blocks.some(block => block.type === 'bullet'))

    const media = await vite.ssrLoadModule('/src/media.ts')
    assert.doesNotThrow(() => media.validateImageUpload(new Blob(['png'], { type: 'image/png' })))
    assert.throws(() => media.validateImageUpload(new Blob(['text'], { type: 'text/plain' })), /imagem válido/)
    assert.throws(() => media.validateImageUpload(new Blob([], { type: 'image/png' })), /vazio/)
    assert.throws(() => media.validateImageDimensions(8000, 8000), /32 megapixels/)
    assert.deepEqual(media.validateImageDimensions(6000, 5000), undefined)
    const duplicateBytes = new Blob(['same image bytes'], { type: 'image/png' })
    const fingerprint = await media.fingerprintImageUpload(duplicateBytes)
    assert.equal(fingerprint, await media.fingerprintImageUpload(new Blob(['same image bytes'], { type: 'image/png' })))
    assert.notEqual(fingerprint, await media.fingerprintImageUpload(new Blob(['different image'], { type: 'image/png' })))

    typedDocument.pages[0].blocks.push({ id: 'table-persisted', type: 'table', text: '', cells: [['á,1', 'B'], ['C', 'D']], merges: [{ row: 0, column: 0, colSpan: 2 }], cellPadding: 20, borderColor: '#123456', borderWidth: 2 })
    await store.writeDocument(typedDocument)
    assert.deepEqual((await store.readDocument(typedDocument.id)).pages[0].blocks, typedDocument.pages[0].blocks)

    const activeDatabase = openedDatabases.find(database => database.name === 'fuse-studio' && database.version === 5)
    assert.ok(activeDatabase)
    activeDatabase.onversionchange()
    assert.ok((await store.listDocuments()).some(document => document.id === typedDocument.id), 'storage reopens after its connection closes for a schema update in another tab')
  } finally {
    indexedDB.open = originalOpen
    await vite.close()
  }
})
