import type { DesignDocument, DocBlock } from './model'
import { replaceDocText } from './doc-format'

export type DocumentReplacementPatch = {
  pageId: string
  blocks: Array<{ blockId: string; text: string; marks: NonNullable<DocBlock['marks']> }>
  cells: Array<{ blockId: string; row: number; column: number; value: string }>
}

function makeLiteralPattern(query: string, caseSensitive: boolean): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, caseSensitive ? 'gu' : 'giu')
}

function replaceBlock(block: DocBlock, query: string, replacement: string, caseSensitive: boolean): { block: DocBlock; count: number } {
  const pattern = makeLiteralPattern(query, caseSensitive)
  const result = replaceDocText(block.text, block.marks, query, replacement, caseSensitive)
  let count = result.count
  const cells = block.cells?.map(row => row.map(cell => cell.replace(pattern, () => { count += 1; return replacement })))
  return { block: { ...block, text: result.text, marks: result.marks, ...(cells ? { cells } : {}) }, count }
}

export function countDocumentMatches(document: DesignDocument, query: string, caseSensitive = false): number {
  if (!query) return 0
  const pattern = makeLiteralPattern(query, caseSensitive)
  let count = 0
  for (const page of document.pages) for (const block of page.blocks ?? []) {
    const text = block.text.match(pattern)?.length ?? 0
    const cells = block.cells?.flat().reduce((total, cell) => total + (cell.match(pattern)?.length ?? 0), 0) ?? 0
    count += text + cells
  }
  return count
}

export function replaceDocumentMatches(document: DesignDocument, query: string, replacement: string, caseSensitive = false): { document: DesignDocument; count: number } {
  if (!query) return { document, count: 0 }
  let count = 0
  const pages = document.pages.map(page => {
    if (!page.blocks) return page
    const blocks = page.blocks.map(block => {
      const result = replaceBlock(block, query, replacement, caseSensitive)
      count += result.count
      return result.block
    })
    return { ...page, blocks }
  })
  return count ? { document: { ...document, pages, updatedAt: new Date().toISOString() }, count } : { document, count: 0 }
}

export function getDocumentReplacementPatches(before: DesignDocument, after: DesignDocument): DocumentReplacementPatch[] {
  const patches: DocumentReplacementPatch[] = []
  for (const page of after.pages) {
    const priorPage = before.pages.find(candidate => candidate.id === page.id)
    if (!priorPage) continue
    const priorBlocks = new Map((priorPage.blocks ?? []).map(block => [block.id, block]))
    const patch: DocumentReplacementPatch = { pageId: page.id, blocks: [], cells: [] }
    for (const block of page.blocks ?? []) {
      const prior = priorBlocks.get(block.id)
      if (!prior) continue
      if (block.type === 'table' && prior.type === 'table') {
        const rowCount = Math.max(block.cells?.length ?? 0, prior.cells?.length ?? 0)
        const columnCount = Math.max(0, ...(block.cells?.map(row => row.length) ?? []), ...(prior.cells?.map(row => row.length) ?? []))
        for (let row = 0; row < rowCount; row += 1) for (let column = 0; column < columnCount; column += 1) {
          const value = block.cells?.[row]?.[column] ?? ''
          if (value !== (prior.cells?.[row]?.[column] ?? '')) patch.cells.push({ blockId: block.id, row, column, value })
        }
      } else if (block.type !== 'table' && prior.type !== 'table'
        && (block.text !== prior.text || JSON.stringify(block.marks ?? []) !== JSON.stringify(prior.marks ?? []))) {
        patch.blocks.push({ blockId: block.id, text: block.text, marks: block.marks ?? [] })
      }
    }
    if (patch.blocks.length || patch.cells.length) patches.push(patch)
  }
  return patches
}

export function splitDocumentReplacementPatch(patch: DocumentReplacementPatch, maxItems = 20_000, maxBytes = 1_000_000): DocumentReplacementPatch[] {
  const encoder = new TextEncoder()
  const chunks: DocumentReplacementPatch[] = []
  let current: DocumentReplacementPatch = { pageId: patch.pageId, blocks: [], cells: [] }
  let bytes = encoder.encode(JSON.stringify({ type: 'doc.replace.apply', pageId: patch.pageId, blocks: [], cells: [] })).length
  const flush = () => {
    if (current.blocks.length || current.cells.length) chunks.push(current)
    current = { pageId: patch.pageId, blocks: [], cells: [] }
    bytes = encoder.encode(JSON.stringify({ type: 'doc.replace.apply', pageId: patch.pageId, blocks: [], cells: [] })).length
  }
  const add = (kind: 'blocks' | 'cells', update: DocumentReplacementPatch['blocks'][number] | DocumentReplacementPatch['cells'][number]) => {
    const updateBytes = encoder.encode(JSON.stringify(update)).length + 1
    if (current.blocks.length + current.cells.length >= maxItems || bytes + updateBytes > maxBytes) flush()
    if (kind === 'blocks') current.blocks.push(update as DocumentReplacementPatch['blocks'][number])
    else current.cells.push(update as DocumentReplacementPatch['cells'][number])
    bytes += updateBytes
  }
  for (const update of patch.blocks) add('blocks', update)
  for (const update of patch.cells) add('cells', update)
  flush()
  return chunks
}
