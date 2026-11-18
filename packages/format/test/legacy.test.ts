import { describe, expect, it } from 'vitest'
import {
  fromLegacy, fromLegacyAsset, LEGACY_EXTENSION, LEGACY_UNKNOWN_PLUGIN, LIBRARY_EXTENSION, migrate, toLegacy, toLegacyAsset,
  toLegacyWithReport, validateFuseFile, walkNodes, type FuseNode, type LegacyDocument,
} from '../src/index.js'
import { asJson, loadFixture, loadLegacyFixtures, loadMediaAssets } from './helpers.js'

const fixtures = loadLegacyFixtures()

describe('fixtures legadas', () => {
  it('encontra todas as fixtures (19 geradas + 3 manuais)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(22)
  })

  describe.each(fixtures)('$name', ({ document }) => {
    const file = fromLegacy(document)

    it('fromLegacy produz FuseFile v1 válido', () => {
      const result = validateFuseFile(file)
      if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
      expect(file.format).toBe('fuse')
      expect(file.schemaVersion).toBe(1)
      expect(file.id).toBe(document.id)
    })

    it('roundtrip toLegacy(fromLegacy(doc)) === doc, sem avisos', () => {
      const { document: back, warnings } = toLegacyWithReport(file)
      expect(warnings).toEqual([])
      expect(asJson(back)).toEqual(asJson(document))
    })

    it('roundtrip fromLegacy(toLegacy(file)) === file', () => {
      expect(asJson(fromLegacy(toLegacy(file)))).toEqual(asJson(file))
    })

    it('sobrevive a JSON.stringify/parse e migrate()', () => {
      const serialized = asJson(file)
      expect(asJson(migrate(serialized))).toEqual(serialized)
      expect(asJson(migrate(asJson(document)))).toEqual(serialized)
    })

    it('é puro (não altera a entrada)', () => {
      const before = JSON.stringify(document)
      fromLegacy(document)
      toLegacy(file)
      expect(JSON.stringify(document)).toBe(before)
    })
  })
})

describe('mapeamento detalhado (kitchen-sink)', () => {
  const legacy = loadFixture('handmade/kitchen-sink.json')
  const file = fromLegacy(legacy)
  const board = file.pages[0]!
  const nodes = [...walkNodes(board.children)]
  const byId = (id: string): FuseNode => {
    const node = nodes.find(candidate => candidate.id === id)
    if (!node) throw new Error(`nó ${id} ausente`)
    return node
  }

  it('metadados, biblioteca e extras do documento', () => {
    expect(file.kind).toBe('whiteboard')
    expect(file.meta).toMatchObject({ title: 'Todos os recursos', brandKitId: 'brand-kit-1', locale: 'pt-BR', tags: [] })
    expect(file.extensions?.[LIBRARY_EXTENSION]).toEqual({ folderId: 'folder-1', archivedAt: '2026-10-01T10:00:00.000Z' })
    expect(file.extensions?.[LEGACY_EXTENSION]).toEqual({ extra: { legacyClientFlag: { nested: [1, 2, 3] } } })
    expect(board.width).toBe(3200)
    expect(board.notes).toBe('Falar sobre o fluxo.')
  })

  it('texto vira TextNode com estilo tipográfico', () => {
    expect(byId('text-1')).toMatchObject({
      type: 'text', link: 'https://example.org', timing: { startMs: 0, durationMs: 3000 },
      style: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, color: '#111111', letterSpacing: -0.5, lineHeight: 1.4 },
    })
  })

  it('forma com qrConfig vira QrNode; linha preserva marcadores', () => {
    expect(byId('qr-1')).toMatchObject({ type: 'qr', data: 'https://example.org/qr', label: 'Meu QR', pattern: 'rounded', cornerRadius: 12 })
    expect(byId('line-1')).toMatchObject({ type: 'shape', shape: 'line', markers: { start: false, end: true }, curveOffset: null, strokeWidth: 4 })
  })

  it('imagem, nota adesiva, desenho livre e elemento desconhecido', () => {
    expect(byId('image-1')).toMatchObject({ type: 'image', alt: 'Pixel', adjustments: { brightness: 10, contrast: -5, saturation: 20 }, filter: 'vintage', stylize: 'gravura' })
    expect(byId('sticky-1').type).toBe('sticky')
    expect(byId('stroke-1')).toMatchObject({ type: 'path', tool: 'freehand', stroke: { color: '#29263d', width: 8 }, opacity: 0.5 })
    expect(byId('mystery-1')).toMatchObject({ type: 'plugin', pluginId: LEGACY_UNKNOWN_PLUGIN })
  })

  it('conectores viram nós; grupo contíguo é aninhado e o não contíguo fica em extensão', () => {
    expect(byId('conn-1')).toMatchObject({ type: 'connector', from: { nodeId: 'sticky-1', anchor: { x: 0, y: 0.5 } }, to: { nodeId: 'text-1' } })
    const group = byId('group-nested')
    expect(group.type).toBe('group')
    if (group.type === 'group') {
      expect(group.children.map(child => child.id)).toEqual(['sticky-1', 'stroke-1'])
      expect({ x: group.x, y: group.y, width: group.width, height: group.height }).toEqual({ x: 900, y: 100, width: 260, height: 350 })
    }
    const ext = board.extensions?.[LEGACY_EXTENSION] as Record<string, unknown>
    expect(ext['looseGroups']).toEqual([legacy.pages[0]!.groups![0]])
    expect(ext['groupOrder']).toEqual(['group-loose', 'group-nested'])
  })

  it('timeline, documento e planilha esparsa', () => {
    expect(file.timeline?.durationMs).toBe(12000)
    expect(file.timeline?.clips.map(clip => [clip.id, clip.pageId, clip.track])).toEqual([['clip-1', 'page-scene', 1], ['clip-2', 'page-scene', undefined]])
    expect(file.doc?.pageSetup?.margins.top).toBe(72)
    expect(file.doc?.sections[0]?.blocks.find(block => block.id === 'block-4')?.table).toMatchObject({ rows: [['A', 'B'], ['1', '2']], spacing: 2 })
    const sheet = file.sheets?.[0]
    expect(sheet).toMatchObject({ pageId: 'page-sheet', rowCount: 4, columnCount: 3 })
    expect(sheet?.cells).toEqual({
      A1: { input: 'Mês' }, B1: { input: 'Vendas' }, A2: { input: 'Jan' }, B2: { input: '10', format: 'currency' },
      A3: { input: 'Fev' }, B3: { input: '=B2*2' }, H6: { format: 'percentage' },
    })
    expect(sheet?.charts?.[0]?.range).toBe('A1:B3')
    expect(sheet?.extensions?.[LEGACY_EXTENSION]).toMatchObject({ rowLengths: [3, 2, 3, 3], cellFormatsExtra: { bogus: 'date' } })
  })

  it('documento sem type e sem páginas', () => {
    const untyped = fromLegacy(loadFixture('handmade/untyped-minimal.json'))
    expect(untyped.kind).toBe('design')
    expect(untyped.extensions?.[LEGACY_EXTENSION]).toEqual({ typeMissing: true })
    const empty = fromLegacy(loadFixture('handmade/no-pages.json'))
    expect(empty.extensions?.[LEGACY_EXTENSION]).toEqual({ width: 1080, height: 1080 })
    expect(toLegacy(empty)).toMatchObject({ width: 1080, height: 1080, trashedAt: '2025-02-01T00:00:00.000Z' })
  })

  it('site recebe navegação derivada das páginas', () => {
    const site = fromLegacy(loadFixture('legacy/blank-site.json'))
    expect(site.site?.navigation.map(item => item.pageId)).toEqual(site.pages.map(page => page.id))
  })

  it('locale configurável', () => {
    expect(fromLegacy(legacy, { locale: 'en' }).meta.locale).toBe('en')
  })
})

describe('ativos de mídia legados', () => {
  const media = loadMediaAssets()

  it('fromLegacyAsset/toLegacyAsset fazem roundtrip', () => {
    for (const asset of media) expect(asJson(toLegacyAsset(asset.id, fromLegacyAsset(asset)))).toEqual(asJson(asset))
  })

  it('fingerprint SHA-256 vira sha256; outros ficam em extensão', () => {
    const [sha, other, none] = media.map(fromLegacyAsset)
    expect(sha?.sha256).toBe('0'.repeat(64))
    expect(sha?.libraryVisible).toBe(true)
    expect(other?.sha256).toBeUndefined()
    expect(other?.extensions?.[LEGACY_EXTENSION]).toEqual({ fingerprint: 'legacy-md5-abc' })
    expect(none?.extensions?.[LEGACY_EXTENSION]).toEqual({ extra: { owner: 'user-1' } })
  })

  it('fromLegacy com assets preenche FuseFile.assets e toLegacyWithReport devolve os registros', () => {
    const file = fromLegacy(loadFixture('handmade/kitchen-sink.json'), { assets: media })
    expect(Object.keys(file.assets)).toEqual(['asset-1', 'asset-2', 'asset-3'])
    expect(validateFuseFile(file).ok).toBe(true)
    expect(asJson(toLegacyWithReport(file).assets)).toEqual(asJson(media))
  })

  it('toLegacyAsset usa padrões quando faltam campos e preserva libraryVisible fora do padrão', () => {
    expect(toLegacyAsset('x', { mime: 'image/png' })).toEqual({ id: 'x', name: '', mimeType: 'image/png', width: 0, height: 0, src: '', createdAt: '' })
    const odd = fromLegacyAsset({ id: 'y', name: 'n', mimeType: 'image/png', width: 1, height: 1, src: '', createdAt: '', libraryVisible: 2 as unknown as 1 })
    expect(toLegacyAsset('y', odd).libraryVisible).toBe(2)
  })
})

describe('casos de borda do migrador', () => {
  const base = (pages: LegacyDocument['pages']): LegacyDocument => ({ id: 'd', name: 'n', type: 'design', width: 10, height: 10, updatedAt: '2025-01-01T00:00:00.000Z', pages })
  const element = (id: string) => ({ id, type: 'sticky-note' as const, name: id, x: 0, y: 0, width: 1, height: 1, rotation: 0, text: '', fill: '#fff', color: '#000', fontSize: 10 })

  it('grupos inválidos (vazios, duplicados, sobrepostos, fora de ordem) ficam soltos e voltam idênticos', () => {
    const doc = base([{
      id: 'p', name: 'p', background: '#fff', elements: [element('a'), element('b'), element('c')],
      groups: [
        { id: 'g1', name: 'ok', elementIds: ['a', 'b'] },
        { id: 'g2', name: 'sobreposto', elementIds: ['b', 'c'] },
        { id: 'g3', name: 'vazio', elementIds: [] },
        { id: 'g4', name: 'fora de ordem', elementIds: ['c', 'a'] },
        { id: 'g1', name: 'id repetido', elementIds: ['c'] },
        { id: 'a', name: 'colide com elemento', elementIds: ['c'] },
      ],
    }])
    const file = fromLegacy(doc)
    expect(validateFuseFile(file).ok).toBe(true)
    expect(file.pages[0]!.children.map(node => node.type)).toEqual(['group', 'sticky'])
    expect(asJson(toLegacy(file))).toEqual(asJson(doc))
  })

  it('grupo sem nome e elemento texto sem bold são preservados', () => {
    const doc = base([{
      id: 'p', name: 'p', background: '#fff',
      elements: [{ id: 't', type: 'text', name: 't', x: 0, y: 0, width: 1, height: 1, rotation: 0, text: 'x', fontSize: 10, fontFamily: 'Inter', color: '#000' } as never],
      groups: [{ id: 'g', elementIds: ['t'] } as never],
    }])
    expect(asJson(toLegacy(fromLegacy(doc)))).toEqual(asJson(doc))
  })

  it('página sem elements e planilha sem cells', () => {
    const doc = base([{ id: 'p', name: 'p', background: '#fff', cellMerges: [], charts: [] } as never])
    const file = fromLegacy(doc)
    expect(file.sheets?.[0]).toMatchObject({ rowCount: 0, columnCount: 0, merges: [], charts: [] })
    expect(asJson(toLegacy(file))).toEqual(asJson(doc))
  })

  it('elemento desconhecido sem id recebe id determinístico', () => {
    const doc = base([{ id: 'p', name: 'p', background: '#fff', elements: [{ type: 'alien', x: 'bad' } as never] }])
    const file = fromLegacy(doc)
    expect(file.pages[0]!.children[0]).toMatchObject({ id: 'legacy-unknown-p-0', type: 'plugin', x: 0 })
    expect(asJson(toLegacy(file))).toEqual(asJson(doc))
  })
})
