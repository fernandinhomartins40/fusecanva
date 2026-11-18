import { describe, expect, it } from 'vitest'
import { NODE_TYPES, NodeSchema, parseFuseFile, SCHEMA_VERSION, validateFuseFile } from '../src/index.js'
import { box, makeFile, SAMPLE_NODES } from './samples.js'

describe('schemas', () => {
  it('SCHEMA_VERSION é 1 e há 15 tipos de nó', () => {
    expect(SCHEMA_VERSION).toBe(1)
    expect(NODE_TYPES).toHaveLength(15)
    expect(new Set(SAMPLE_NODES.map(node => node.type))).toEqual(new Set(NODE_TYPES))
  })

  it.each(SAMPLE_NODES.map(node => [node.type, node] as const))('nó %s válido', (_type, node) => {
    expect(NodeSchema.parse(node)).toEqual(node)
  })

  it('arquivo completo com todos os corpos valida', () => {
    const file = makeFile({
      kind: 'sheet',
      doc: { pageSetup: { preset: 'letter', margins: { top: 1, right: 1, bottom: 1, left: 1 } }, sections: [{ pageId: 'page-1', blocks: [{ id: 'b', type: 'paragraph', text: 'x' }] }] },
      sheets: [{ pageId: 'page-1', rowCount: 2, columnCount: 2, cells: { A1: { input: '=1+1', format: 'default' } }, frozen: { rows: 1, columns: 0 } }],
      timeline: { durationMs: 1000, fps: 30, clips: [{ id: 'c', pageId: 'page-1', assetId: 'a', name: 'n', kind: 'video', startMs: 0, durationMs: 1, sourceStartMs: 0, sourceDurationMs: 1, volume: 1 }] },
      site: { navigation: [{ pageId: 'page-1', label: 'Início' }], seo: { title: 'T', description: 'D' }, language: 'pt-BR' },
      extensions: { 'org.exemplo': { qualquer: true } },
    })
    expect(parseFuseFile(file)).toEqual(file)
  })

  it('rejeita tipo de nó desconhecido e chaves extras (strict)', () => {
    expect(NodeSchema.safeParse({ ...box, id: 'x', type: 'blob' }).success).toBe(false)
    expect(NodeSchema.safeParse({ ...SAMPLE_NODES[2], extra: 1 }).success).toBe(false)
  })

  it('rejeita path com número ímpar de coordenadas e referências A1 inválidas', () => {
    expect(NodeSchema.safeParse({ id: 'p', type: 'path', ...box, points: [1, 2, 3] }).success).toBe(false)
    const bad = makeFile({ sheets: [{ pageId: 'page-1', rowCount: 1, columnCount: 1, cells: { a1: { input: 'x' } } }] })
    expect(validateFuseFile(bad).ok).toBe(false)
  })

  it('detecta IDs duplicados de página e de nó (inclusive aninhados)', () => {
    const page = makeFile().pages[0]!
    const result = validateFuseFile(makeFile({ pages: [page, { ...page, children: [] }] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.message)).toEqual(expect.arrayContaining(['ID de página duplicado: page-1']))
    const nested = validateFuseFile(makeFile({ pages: [{ ...page, children: [...SAMPLE_NODES, { id: 'inner-shape', type: 'sticky', ...box, text: '', fill: '#fff', color: '#000', fontSize: 1 }] }] }))
    expect(nested.ok).toBe(false)
    if (!nested.ok) expect(nested.issues[0]?.message).toBe('ID de nó duplicado: inner-shape')
  })

  it('detecta referências a páginas inexistentes', () => {
    const result = validateFuseFile(makeFile({
      doc: { sections: [{ pageId: 'nope', blocks: [] }] },
      sheets: [{ pageId: 'nope', rowCount: 0, columnCount: 0, cells: {} }],
      timeline: { clips: [{ id: 'c', pageId: 'nope', assetId: 'a', name: 'n', kind: 'audio', startMs: 0, durationMs: 1, sourceStartMs: 0, sourceDurationMs: 1, volume: 1 }] },
      site: { navigation: [{ pageId: 'nope' }] },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.path)).toEqual(['doc.sections.0.pageId', 'sheets.0.pageId', 'timeline.clips.0.pageId', 'site.navigation.0.pageId'])
  })

  it('rejeita versão/format errados', () => {
    expect(validateFuseFile({ ...makeFile(), schemaVersion: 2 }).ok).toBe(false)
    expect(validateFuseFile({ ...makeFile(), format: 'other' }).ok).toBe(false)
    expect(() => parseFuseFile({})).toThrow()
  })
})
