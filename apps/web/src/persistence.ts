import type { DesignDocument, MediaAsset, ProjectFolder } from './model'

const DATABASE = 'fuse-studio'
const STORE = 'documents'
const ASSET_STORE = 'assets'
const FOLDER_STORE = 'projectFolders'
const CLOUD_DRAFT_STORE = 'cloudDrafts'
const DATABASE_VERSION = 5

export type CloudDraft = { documentId: string; baseRevision: number; role: 'owner' | 'editor' | 'commenter' | 'viewer'; base: DesignDocument; document: DesignDocument; updatedAt: string }

let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' })
      const assets = database.objectStoreNames.contains(ASSET_STORE)
        ? request.transaction!.objectStore(ASSET_STORE)
        : database.createObjectStore(ASSET_STORE, { keyPath: 'id' })
      if (!assets.indexNames.contains('libraryVisible')) assets.createIndex('libraryVisible', 'libraryVisible')
      if (!database.objectStoreNames.contains(FOLDER_STORE)) database.createObjectStore(FOLDER_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(CLOUD_DRAFT_STORE)) database.createObjectStore(CLOUD_DRAFT_STORE, { keyPath: 'documentId' })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => {
      databasePromise = undefined
      reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'))
    }
    request.onblocked = () => {
      databasePromise = undefined
      reject(new Error('Feche as outras abas do Fuse Studio para atualizar o armazenamento local.'))
    }
  })

  return databasePromise
}

export async function readCloudDraft(documentId: string): Promise<CloudDraft | undefined> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CLOUD_DRAFT_STORE, 'readonly')
    const request = transaction.objectStore(CLOUD_DRAFT_STORE).get(documentId)
    request.onsuccess = () => resolve(request.result as CloudDraft | undefined)
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível recuperar o rascunho local.'))
  })
}

export async function writeCloudDraft(draft: CloudDraft): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CLOUD_DRAFT_STORE, 'readwrite')
    transaction.objectStore(CLOUD_DRAFT_STORE).put(draft)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível guardar o rascunho cloud neste dispositivo.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('A gravação do rascunho local foi interrompida.'))
  })
}

export async function deleteCloudDraft(documentId: string, expectedDocument?: DesignDocument): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CLOUD_DRAFT_STORE, 'readwrite')
    const store = transaction.objectStore(CLOUD_DRAFT_STORE)
    const request = store.get(documentId)
    request.onsuccess = () => {
      const draft = request.result as CloudDraft | undefined
      if (!draft || (expectedDocument && JSON.stringify(draft.document) !== JSON.stringify(expectedDocument))) return
      store.delete(documentId)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível limpar o rascunho cloud.'))
  })
}

export async function listProjectFolders(): Promise<ProjectFolder[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FOLDER_STORE, 'readonly')
    const request = transaction.objectStore(FOLDER_STORE).getAll()
    request.onsuccess = () => resolve((request.result as ProjectFolder[]).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR')))
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível carregar as pastas.'))
  })
}

export async function writeProjectFolder(folder: ProjectFolder): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FOLDER_STORE, 'readwrite')
    transaction.objectStore(FOLDER_STORE).put(folder)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar a pasta.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('O salvamento da pasta foi interrompido.'))
  })
}

export async function deleteProjectFolder(id: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FOLDER_STORE, STORE], 'readwrite')
    const folders = transaction.objectStore(FOLDER_STORE)
    const documents = transaction.objectStore(STORE)
    const request = documents.getAll()
    request.onsuccess = () => {
      const folderDocuments = (request.result as DesignDocument[]).filter(document => document.folderId === id)
      const assigned = folderDocuments.some(document => !document.trashedAt)
      if (assigned) {
        transaction.abort()
        return
      }
      for (const document of folderDocuments) {
        delete document.folderId
        documents.put(document)
      }
      folders.delete(id)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível excluir a pasta.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('A pasta não está vazia ou não pôde ser excluída.'))
  })
}

export async function readDocument(id: string): Promise<DesignDocument | undefined> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, ASSET_STORE], 'readonly')
    const documentRequest = transaction.objectStore(STORE).get(id)
    const assetsStore = transaction.objectStore(ASSET_STORE)
    documentRequest.onsuccess = () => {
      const document = documentRequest.result as DesignDocument | undefined
      if (!document) { resolve(undefined); return }
      hydrateDocumentAssets(document, assetsStore, resolve, reject)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível carregar o design.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('O carregamento do design foi interrompido.'))
  })
}

export async function listDocuments(): Promise<DesignDocument[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, ASSET_STORE], 'readonly')
    const documentsRequest = transaction.objectStore(STORE).getAll()
    const assetsStore = transaction.objectStore(ASSET_STORE)
    documentsRequest.onsuccess = () => {
      const documents = documentsRequest.result as DesignDocument[]
      hydrateDocumentListAssets(documents, assetsStore, hydrated => resolve(hydrated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), reject)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível listar seus projetos.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('A listagem de projetos foi interrompida.'))
  })
}

export async function deleteDocument(id: string, updatedAt: string): Promise<void> {
  await deleteDocuments([{ id, updatedAt }])
}

export async function deleteDocuments(documentsToDelete: Array<{ id: string; updatedAt: string }>): Promise<void> {
  const byId = new Map(documentsToDelete.map(document => [document.id, document.updatedAt]))
  const documentIds = [...byId.keys()]
  if (!documentIds.length) return
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, ASSET_STORE], 'readwrite')
    const documentsStore = transaction.objectStore(STORE)
    const assetsStore = transaction.objectStore(ASSET_STORE)
    const documentsRequest = documentsStore.getAll()
    const hiddenAssetKeysRequest = assetsStore.index('libraryVisible').getAllKeys(0)
    let validationError: Error | undefined
    documentsRequest.onsuccess = () => {
      const documents = documentsRequest.result as DesignDocument[]
      const deleting = new Set(documentIds)
      const currentDocuments = new Map(documents.map(document => [document.id, document]))
      const stale = documentIds.some(id => {
        const current = currentDocuments.get(id)
        return !current || !current.trashedAt || current.updatedAt !== byId.get(id)
      })
      if (stale) {
        validationError = new Error('Um projeto mudou ou saiu da lixeira. Atualize a lista antes de excluir.')
        transaction.abort()
        return
      }
      for (const id of documentIds) documentsStore.delete(id)
      hiddenAssetKeysRequest.onsuccess = () => {
        const remainingDocuments = documents.filter(document => !deleting.has(document.id))
        const referencedAssets = collectReferencedAssetIds(remainingDocuments)
        for (const assetId of hiddenAssetKeysRequest.result as IDBValidKey[]) {
          if (!referencedAssets.has(String(assetId))) assetsStore.delete(assetId)
        }
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(validationError ?? transaction.error ?? new Error('Não foi possível excluir o projeto.'))
    transaction.onabort = () => reject(validationError ?? transaction.error ?? new Error('A exclusão do projeto foi interrompida.'))
  })
}

export async function writeDocument(document: DesignDocument): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, ASSET_STORE], 'readwrite')
    const documentsStore = transaction.objectStore(STORE)
    const assetsStore = transaction.objectStore(ASSET_STORE)
    const documentRequest = documentsStore.get(document.id)
    const assetKeysRequest = assetsStore.getAllKeys()
    const hiddenAssetKeysRequest = assetsStore.index('libraryVisible').getAllKeys(0)
    let previousDocument: DesignDocument | undefined
    let assetKeys: IDBValidKey[] | undefined
    let hiddenAssetKeys: IDBValidKey[] | undefined
    let pending = 3
    const save = () => {
      pending -= 1
      if (pending !== 0) return

      const availableAssets = new Set((assetKeys as IDBValidKey[]).map(String))
      const storedDocument = stripStoredMediaSources(document, availableAssets)
      documentsStore.put(storedDocument)

      const previousAssetIds = collectReferencedAssetIds(previousDocument ? [previousDocument] : [])
      const currentAssetIds = collectReferencedAssetIds([document])
      const hiddenCandidates = (hiddenAssetKeys as IDBValidKey[]).filter(assetId => previousAssetIds.has(String(assetId)) && !currentAssetIds.has(String(assetId)))
      if (hiddenCandidates.length === 0) return

      const allDocumentsRequest = documentsStore.getAll()
      allDocumentsRequest.onsuccess = () => {
        const referencedAssets = collectReferencedAssetIds((allDocumentsRequest.result as DesignDocument[]).filter(existing => existing.id !== document.id).concat(document))
        for (const assetId of hiddenCandidates) {
          if (!referencedAssets.has(String(assetId))) assetsStore.delete(assetId)
        }
      }
    }
    documentRequest.onsuccess = () => { previousDocument = documentRequest.result as DesignDocument | undefined; save() }
    assetKeysRequest.onsuccess = () => { assetKeys = assetKeysRequest.result; save() }
    hiddenAssetKeysRequest.onsuccess = () => { hiddenAssetKeys = hiddenAssetKeysRequest.result; save() }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar o design.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('O salvamento foi interrompido.'))
  })
}

export async function listMediaAssets(): Promise<MediaAsset[]> {
  return (await listStoredMediaAssets()).filter(asset => asset.libraryVisible !== 0)
}

export async function listStoredMediaAssets(): Promise<MediaAsset[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction(ASSET_STORE, 'readonly').objectStore(ASSET_STORE).getAll()
    request.onsuccess = () => resolve((request.result as MediaAsset[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    request.onerror = () => reject(request.error ?? new Error('Não foi possível listar as mídias.'))
  })
}

export async function writeMediaAsset(asset: MediaAsset): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE, 'readwrite')
    transaction.objectStore(ASSET_STORE).put(asset)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar esta mídia.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('O salvamento da mídia foi interrompido.'))
  })
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, ASSET_STORE], 'readwrite')
    const documentsRequest = transaction.objectStore(STORE).getAll()
    const assetsStore = transaction.objectStore(ASSET_STORE)
    const assetRequest = assetsStore.get(id)
    let documents: DesignDocument[] | undefined
    let asset: MediaAsset | undefined
    let pending = 2
    const removeFromLibrary = () => {
      pending -= 1
      if (pending !== 0 || !asset) return
      const isUsed = (documents as DesignDocument[]).some(document => document.pages.some(page => page.elements.some(element => element.type === 'image' && element.assetId === id)))
      if (isUsed) assetsStore.put({ ...asset, libraryVisible: 0 })
      else assetsStore.delete(id)
    }
    documentsRequest.onsuccess = () => { documents = documentsRequest.result as DesignDocument[]; removeFromLibrary() }
    assetRequest.onsuccess = () => { asset = assetRequest.result as MediaAsset | undefined; removeFromLibrary() }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível remover esta mídia.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('A remoção da mídia foi interrompida.'))
  })
}

function collectUnhydratedAssetIds(documents: DesignDocument[]): Set<string> {
  return new Set(documents.flatMap(document => document.pages.flatMap(page => page.elements.flatMap(element =>
    element.type === 'image' && !element.src && element.assetId ? [element.assetId] : [],
  ))))
}

function collectReferencedAssetIds(documents: DesignDocument[]): Set<string> {
  return new Set(documents.flatMap(document => document.pages.flatMap(page => [
    ...page.elements.flatMap(element => element.type === 'image' && element.assetId ? [element.assetId] : []),
    ...(page.timelineClips ?? []).map(clip => clip.assetId),
  ])))
}

function hydrateDocumentAssets(
  document: DesignDocument,
  assetsStore: IDBObjectStore,
  resolve: (document: DesignDocument) => void,
  reject: (error: Error) => void,
): void {
  hydrateDocumentListAssets([document], assetsStore, documents => resolve(documents[0]), reject)
}

function hydrateDocumentListAssets(
  documents: DesignDocument[],
  assetsStore: IDBObjectStore,
  resolve: (documents: DesignDocument[]) => void,
  reject: (error: Error) => void,
): void {
  const assetIds = collectUnhydratedAssetIds(documents)
  const hydrated = documents.map(document => structuredClone(document))
  if (assetIds.size === 0) { resolve(hydrated); return }
  const assets = new Map<string, MediaAsset>()
  let pending = assetIds.size
  for (const assetId of assetIds) {
    const request = assetsStore.get(assetId)
    request.onsuccess = () => {
      const asset = request.result as MediaAsset | undefined
      if (asset) assets.set(assetId, asset)
      pending -= 1
      if (pending === 0) resolve(hydrated.map(document => hydrateDocumentAssetsFromMap(document, assets)))
    }
    request.onerror = () => reject(request.error ?? new Error('Não foi possível carregar uma mídia do documento.'))
  }
}

function hydrateDocumentAssetsFromMap(document: DesignDocument, assets: Map<string, MediaAsset>): DesignDocument {
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.type !== 'image' || element.src || !element.assetId) continue
      const asset = assets.get(element.assetId)
      if (asset) element.src = asset.src
    }
  }
  return document
}

function stripStoredMediaSources(document: DesignDocument, assets: Set<string>): DesignDocument {
  const stored = structuredClone(document)
  for (const page of stored.pages) {
    for (const element of page.elements) {
      if (element.type === 'image' && element.assetId && assets.has(element.assetId)) element.src = ''
    }
  }
  return stored
}
