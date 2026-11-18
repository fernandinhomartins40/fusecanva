import { describe, expect, it } from 'vitest'
import { toLegacy, toLegacyWithReport, type FuseFile } from '../src/index.js'
import { makeFile, SAMPLE_NODES } from './samples.js'

describe('toLegacy de arquivos v1 nativos', () => {
  const file: FuseFile = makeFile({
    kind: 'doc',
    doc: { pageSetup: { preset: 'letter', margins: { top: 1, right: 2, bottom: 3, left: 4 } }, sections: [{ pageId: 'page-1', blocks: [{ id: 'b', type: 'paragraph', text: 'x' }] }] },
    sheets: [{ pageId: 'page-1', rowCount: 1, columnCount: 1, cells: { A1: { input: 'v' }, C9: { input: 'fora' }, B1: { format: 'date' } }, frozen: { rows: 1, columns: 0 } }],
    pages: [
      { id: 'page-1', name: 'P1', width: 800, height: 600, background: { type: 'linear-gradient', angle: 0, stops: [{ offset: 0, color: '#123456' }, { offset: 1, color: '#000' }] }, children: SAMPLE_NODES },
      { id: 'page-2', name: 'P2', width: 100, height: 100, background: '#fff', children: [
        { id: 'opaque-text', type: 'text', x: 0, y: 0, width: 1, height: 1, rotation: 0, text: 't', style: { fontFamily: 'Inter', fontSize: 10, fontWeight: 400, color: '#000' }, opacity: 0.5, animation: { effect: 'fade', phase: 'enter', speed: 'fast' } },
        { id: 'img-noanim', type: 'image', x: 0, y: 0, width: 1, height: 1, rotation: 0, src: 'x', animation: { effect: 'elevation', phase: 'enter', speed: 'fast' } },
        { id: 'img-null', type: 'image', x: 0, y: 0, width: 1, height: 1, rotation: 0, src: 'x', animation: null, adjustments: { brightness: 1 } },
        { id: 'path-fill', type: 'path', x: 0, y: 0, width: 1, height: 1, rotation: 0, points: [0, 0], fill: '#abc' },
        { id: 'path-bare', type: 'path', x: 0, y: 0, width: 1, height: 1, rotation: 0, points: [0, 0] },
        { id: 'qr-bare', type: 'qr', x: 0, y: 0, width: 1, height: 1, rotation: 0, pattern: 'hearts', foreground: '#000', background: '#fafafa', logo: 'none', cornerRadius: 3 },
        { id: 'shape-stroke', type: 'shape', x: 0, y: 0, width: 1, height: 1, rotation: 0, shape: 'rect', fill: '#000', cornerRadius: 0, stroke: { color: '#f00', width: 3 } },
        { id: 'frame-rot', type: 'frame', x: 10, y: 10, width: 5, height: 5, rotation: 15, children: [] },
      ] },
    ],
  })
  const { document, warnings } = toLegacyWithReport(file)
  const page1 = document.pages[0]!
  const page2 = document.pages[1]!
  const messages = warnings.map(warning => `${warning.path}: ${warning.message}`)

  it('achata frames (com retângulo de fundo) e desloca filhos', () => {
    const frameRect = page1.elements.find(element => element.id === 'frame')
    expect(frameRect).toMatchObject({ type: 'shape', shape: 'rect', fill: '#fff', name: 'Frame' })
    expect(page1.elements.find(element => element.id === 'inner-shape')).toMatchObject({ x: 0, y: 0 })
    expect(messages.some(message => message.includes('Frame achatado'))).toBe(true)
    expect(messages.some(message => message.includes('Rotação de frame'))).toBe(true)
  })

  it('grupos nativos viram grupos legados com IDs das folhas', () => {
    expect(page1.groups).toEqual([{ id: 'group', name: '', elementIds: ['grouped-text'] }])
  })

  it('descarta nós sem equivalente com aviso', () => {
    const ids = page1.elements.map(element => element.id)
    for (const dropped of ['video', 'audio', 'table', 'chart', 'embed', 'plugin']) expect(ids).not.toContain(dropped)
    expect(messages.filter(message => message.includes('não suportado no formato legado; descartado')).length).toBeGreaterThanOrEqual(5)
    expect(messages.some(message => message.includes('org.exemplo.mapa'))).toBe(true)
  })

  it('aproxima gradientes, traços e conectores', () => {
    expect(page1.background).toBe('#123456')
    expect(page1.elements.find(element => element.id === 'shape')).toMatchObject({ fill: '#fff' })
    expect(page1.connectors).toEqual([{ id: 'connector', fromId: 'sticky', toId: 'text', toAnchor: { x: 0.5, y: 0 }, color: '#333', strokeWidth: 2 }])
    expect(page2.elements.find(element => element.id === 'shape-stroke')).toMatchObject({ strokeWidth: 3 })
    expect(page2.elements.find(element => element.id === 'path-fill')).toMatchObject({ type: 'free-draw', color: '#abc', strokeWidth: 1 })
    expect(page2.elements.find(element => element.id === 'path-bare')).toMatchObject({ color: '#000000' })
    expect(page2.elements.find(element => element.id === 'qr-bare')).toMatchObject({ type: 'shape', shape: 'rect', fill: '#fafafa', qrConfig: { pattern: 'hearts', corner: 3 } })
    expect(page1.elements.find(element => element.id === 'image')).toMatchObject({ src: '', assetId: 'asset-1' })
  })

  it('animações e opacidade não suportadas geram aviso', () => {
    expect(messages.some(message => message.includes('Opacidade do nó'))).toBe(true)
    expect(messages.some(message => message.includes('Animação só é suportada'))).toBe(true)
    expect(page2.elements.find(element => element.id === 'img-noanim')).not.toHaveProperty('animation')
    expect(page2.elements.find(element => element.id === 'img-null')).toMatchObject({ animation: null, brightness: 1 })
  })

  it('doc, planilha e páginas de tamanhos diferentes', () => {
    expect(document.docPageSetup).toEqual({ preset: 'a4', margins: { top: 1, right: 2, bottom: 3, left: 4 } })
    expect(page1.blocks).toEqual([{ id: 'b', type: 'paragraph', text: 'x' }])
    expect(page1.cells).toEqual([['v']])
    expect(page1.cellFormats).toEqual({ '0:1': 'date' })
    expect(document.width).toBe(800)
    for (const fragment of ['Formato de página "letter"', 'Célula fora da grade', 'Congelamento', 'tamanhos diferentes', 'Marcas inline', 'Path SVG', 'Traço com cor', 'Gradiente']) {
      expect(messages.some(message => message.includes(fragment)), fragment).toBe(true)
    }
  })

  it('toLegacy é atalho sem avisos', () => {
    expect(toLegacy(file)).toEqual(document)
  })
})
