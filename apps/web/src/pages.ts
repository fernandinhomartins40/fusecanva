import type { DesignDocument, DesignPage } from './model'
import { createId } from './model'

export function createBlankDesignPage(document: DesignDocument): DesignPage {
  const pageNumber = document.pages.length + 1
  return {
    id: createId('page'),
    name: `${document.type === 'presentation' ? 'Slide' : document.type === 'whiteboard' ? 'Quadro' : document.type === 'site' ? 'Seção' : document.type === 'video' ? 'Cena' : 'Página'} ${pageNumber}`,
    background: '#ffffff',
    elements: [],
    ...(document.type === 'doc' ? { blocks: [{ id: createId('block'), type: 'paragraph' as const, text: '' }] } : {}),
  }
}

export function setSiteSectionVisibility(document: DesignDocument, index: number, hidden: boolean): DesignDocument | null {
  if (document.type !== 'site' || !Number.isInteger(index) || index < 0 || index >= document.pages.length) return null
  const page = document.pages[index]
  if (Boolean(page.hidden) === hidden) return document
  const pages = [...document.pages]
  if (hidden) pages[index] = { ...page, hidden: true }
  else {
    const visiblePage = { ...page }
    delete visiblePage.hidden
    pages[index] = visiblePage
  }
  return { ...document, pages, updatedAt: new Date().toISOString() }
}

export function duplicateDesignDocument(document: DesignDocument, name: string): DesignDocument {
  const pageIds = new Map(document.pages.map(page => [page.id, createId('page')]))
  const pages = document.pages.map(source => {
    const elementIds = new Map(source.elements.map(element => [element.id, createId(element.type)]))
    const elements = source.elements.map(element => {
      const duplicate = { ...structuredClone(element), id: elementIds.get(element.id)! }
      if (duplicate.type === 'text' && duplicate.href) {
        for (const [sourcePageId, duplicatePageId] of pageIds) {
          if (duplicate.href === `#site-section-${sourcePageId}`) duplicate.href = `#site-section-${duplicatePageId}`
        }
      }
      return duplicate
    })
    const connectors = source.connectors?.flatMap(connector => {
      const fromId = elementIds.get(connector.fromId)
      const toId = elementIds.get(connector.toId)
      return fromId && toId ? [{ ...structuredClone(connector), id: createId('connector'), fromId, toId }] : []
    })
    const groups = source.groups?.flatMap(group => {
      const elementIdsInGroup = group.elementIds.map(id => elementIds.get(id))
      return elementIdsInGroup.every((id): id is string => Boolean(id))
        ? [{ ...structuredClone(group), id: createId('group'), elementIds: elementIdsInGroup }]
        : []
    })
    return {
      ...structuredClone(source),
      id: pageIds.get(source.id)!,
      elements,
      ...(source.blocks ? { blocks: source.blocks.map(block => ({ ...structuredClone(block), id: createId(block.type === 'table' ? 'table' : 'block') })) } : {}),
      ...(connectors ? { connectors } : {}),
      ...(groups ? { groups } : {}),
      ...(source.timelineClips ? { timelineClips: source.timelineClips.map(clip => ({ ...structuredClone(clip), id: createId('clip') })) } : {}),
    }
  })
  const duplicate = { ...structuredClone(document), id: createId('design'), name, updatedAt: new Date().toISOString(), pages }
  delete duplicate.archivedAt
  delete duplicate.trashedAt
  return duplicate
}

export function duplicateDesignPage(document: DesignDocument, index: number): { document: DesignDocument; pageIndex: number } | null {
  const source = document.pages[index]
  if (!source) return null
  const duplicatePageId = createId('page')
  const duplicate: DesignPage = {
    ...structuredClone(source),
    id: duplicatePageId,
    name: `${source.name} (cópia)`,
    elements: source.elements.map(element => {
      const copy = { ...structuredClone(element), id: createId(element.type) }
      if (document.type === 'site' && copy.type === 'text' && copy.href === `#site-section-${source.id}`) {
        copy.href = `#site-section-${duplicatePageId}`
      }
      return copy
    }),
    blocks: source.blocks?.map(block => ({ ...structuredClone(block), id: createId(block.type === 'table' ? 'table' : 'block') })),
    timelineClips: source.timelineClips?.map(clip => ({ ...structuredClone(clip), id: createId('clip') })),
  }
  if (source.connectors?.length) {
    const idMap = new Map(source.elements.map((element, elementIndex) => [element.id, duplicate.elements[elementIndex].id]))
    duplicate.connectors = source.connectors.flatMap(connector => {
      const fromId = idMap.get(connector.fromId)
      const toId = idMap.get(connector.toId)
      return fromId && toId ? [{ ...structuredClone(connector), id: createId('connector'), fromId, toId }] : []
    })
  }
  if (source.groups?.length) {
    const idMap = new Map(source.elements.map((element, elementIndex) => [element.id, duplicate.elements[elementIndex].id]))
    duplicate.groups = source.groups.flatMap(group => {
      const elementIds = group.elementIds.map(id => idMap.get(id))
      return elementIds.every((id): id is string => Boolean(id)) ? [{ ...structuredClone(group), id: createId('group'), elementIds }] : []
    })
  }
  const pages = [...document.pages]
  pages.splice(index + 1, 0, duplicate)
  return { document: { ...document, pages, updatedAt: new Date().toISOString() }, pageIndex: index + 1 }
}

export function moveDesignPage(document: DesignDocument, index: number, targetIndex: number): { document: DesignDocument; pageIndex: number } | null {
  if (!Number.isInteger(index) || !Number.isInteger(targetIndex) || index < 0 || targetIndex < 0 || index >= document.pages.length || targetIndex >= document.pages.length) return null
  if (index === targetIndex) return { document, pageIndex: index }
  const pages = [...document.pages]
  const [page] = pages.splice(index, 1)
  pages.splice(targetIndex, 0, page)
  return { document: { ...document, pages, updatedAt: new Date().toISOString() }, pageIndex: targetIndex }
}

export function deleteDesignPage(document: DesignDocument, index: number): { document: DesignDocument; pageIndex: number } | null {
  if (document.pages.length <= 1 || !Number.isInteger(index) || index < 0 || index >= document.pages.length) return null
  const pages = document.pages.filter((_, pageIndex) => pageIndex !== index)
  return { document: { ...document, pages, updatedAt: new Date().toISOString() }, pageIndex: Math.min(index, pages.length - 1) }
}
