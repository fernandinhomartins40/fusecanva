import type { FuseFile, FuseNode } from '../src/index.js'

export const box = { x: 0, y: 0, width: 100, height: 50, rotation: 0 }
export const style = { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, color: '#111111' }

/** Um exemplo válido de cada tipo de nó. */
export const SAMPLE_NODES: FuseNode[] = [
  { id: 'frame', type: 'frame', ...box, fill: { type: 'linear-gradient', angle: 90, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] }, clipContent: true, children: [
    { id: 'inner-shape', type: 'shape', ...box, shape: 'ellipse', fill: '#ff0000', cornerRadius: 0 },
  ] },
  { id: 'group', type: 'group', ...box, children: [{ id: 'grouped-text', type: 'text', ...box, text: 'oi', style }] },
  { id: 'shape', type: 'shape', ...box, shape: 'star', fill: { type: 'radial-gradient', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] }, cornerRadius: 2, stroke: { color: '#000', width: 2, dash: [4, 2] } },
  { id: 'path', type: 'path', ...box, points: [0, 0, 10, 10], d: 'M0 0 L10 10', closed: false, stroke: { color: '#000', width: 1 } },
  { id: 'text', type: 'text', ...box, text: 'Olá', style: { ...style, italic: true, align: 'center' }, marks: [{ start: 0, end: 1, bold: true, link: 'https://example.org' }] },
  { id: 'image', type: 'image', ...box, assetId: 'asset-1', alt: 'x', crop: null, animation: { effect: 'fade', phase: 'emphasis', speed: 'slow' } },
  { id: 'video', type: 'video', ...box, assetId: 'asset-v', trimStartMs: 0, trimEndMs: 1000, muted: true, loop: true, volume: 0.5, fit: 'cover' },
  { id: 'audio', type: 'audio', ...box, src: 'https://example.org/a.mp3', volume: 1, loop: false },
  { id: 'sticky', type: 'sticky', ...box, text: 'nota', fill: '#ff0', color: '#000', fontSize: 20, author: 'Ana' },
  { id: 'connector', type: 'connector', from: { nodeId: 'sticky' }, to: { nodeId: 'text', anchor: { x: 0.5, y: 0 } }, stroke: { color: '#333', width: 2 }, routing: 'elbow', markers: { end: 'arrow' }, label: 'segue' },
  { id: 'table', type: 'table', ...box, rows: [[{ text: 'a' }, { text: 'b', fill: '#eee' }]], columnWidths: [50, 50], merges: [{ row: 0, column: 0, rowSpan: 1, colSpan: 2 }] },
  { id: 'chart', type: 'chart', ...box, chartType: 'pie', title: 'Fatias', data: { categories: ['a', 'b'], series: [{ name: 's', values: [1, null] }] }, source: { sheetId: 'page-1', range: 'A1:B2' } },
  { id: 'embed', type: 'embed', ...box, url: 'https://example.org/video', provider: 'example', title: 'Vídeo' },
  { id: 'qr', type: 'qr', ...box, data: 'https://example.org', pattern: 'blocks', foreground: '#000', background: '#fff', logo: 'none', cornerRadius: 0 },
  { id: 'plugin', type: 'plugin', ...box, pluginId: 'org.exemplo.mapa', pluginVersion: '1.0.0', data: { lat: 1, lng: 2 } },
]

export function makeFile(overrides: Partial<FuseFile> = {}): FuseFile {
  return {
    format: 'fuse',
    schemaVersion: 1,
    id: 'file-1',
    kind: 'design',
    meta: { title: 'Teste', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', locale: 'pt-BR', tags: ['a'] },
    pages: [{ id: 'page-1', name: 'Página 1', width: 800, height: 600, background: '#ffffff', children: SAMPLE_NODES }],
    assets: { 'asset-1': { sha256: 'a'.repeat(64), mime: 'image/png', width: 10, height: 10, license: { id: 'CC0-1.0' }, origin: { kind: 'upload' } } },
    styles: {
      colors: [{ id: 'c1', name: 'Primária', value: '#5b4bff' }],
      textStyles: [{ id: 't1', name: 'Título', style }],
      effects: [{ id: 'e1', name: 'Sombra', effect: { type: 'shadow', color: '#0004', x: 0, y: 2, blur: 8 } }, { id: 'e2', name: 'Desfoque', effect: { type: 'blur', radius: 4 } }],
    },
    ...overrides,
  }
}

