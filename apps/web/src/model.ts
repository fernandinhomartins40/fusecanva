import type { VectorShapeKind } from './vector-shapes'
import type { ImageFilterPreset } from './image-filters'
import type { ImageMaskStroke } from './image-masks'
import type { ImageStylePreset } from './image-styles'

export type ElementBase = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** Video timeline position. Omitted values mean the layer spans the full project. */
  startMs?: number
  durationMs?: number
}

export type TextElement = ElementBase & {
  type: 'text'
  text: string
  href?: string
  fontSize: number
  fontFamily: string
  color: string
  bold: boolean
  /** Letter spacing in pixels. Missing values use the browser's normal kerning. */
  kerning?: number
  /** Line spacing multiplier. Missing values preserve the 1.2 default. */
  lineSpacing?: number
}

export type ShapeElement = ElementBase & {
  type: 'shape'
  shape: VectorShapeKind
  fill: string
  cornerRadius: number
  strokeWidth?: number
  startArrow?: boolean
  endArrow?: boolean
  curveOffset?: number | null
  /** Editable, locally encoded QR destination and visual options. */
  qrConfig?: { pattern: 'blocks' | 'rounded' | 'circles' | 'crosses' | 'stars' | 'hearts'; url?: string; name?: string; expiration?: string; foreground: string; background: string; logo: 'none' | 'logo'; corner: number }
}

export type ImageAnimationSettings = {
  effect: 'elevation'
  phase: 'enter' | 'exit'
  speed: 'slow' | 'medium' | 'fast'
  direction: 'down' | 'up' | 'left' | 'right'
}

export type ImageElement = ElementBase & {
  type: 'image'
  src: string
  altText?: string
  decorative?: boolean
  assetId?: string
  sourceWidth?: number
  sourceHeight?: number
  crop?: { x: number; y: number; width: number; height: number } | null
  opacity?: number
  flipX?: boolean
  flipY?: boolean
  brightness?: number
  contrast?: number
  saturation?: number
  filterPreset?: ImageFilterPreset
  imageStylePreset?: ImageStylePreset
  maskStrokes?: ImageMaskStroke[]
  animation?: ImageAnimationSettings | null
}

export type StickyNoteElement = ElementBase & {
  type: 'sticky-note'
  text: string
  fill: string
  color: string
  fontSize: number
}

export type FreeDrawElement = ElementBase & {
  type: 'free-draw'
  points: number[]
  color: string
  strokeWidth: number
  opacity?: number
}

export type DesignElement = TextElement | ShapeElement | ImageElement | StickyNoteElement | FreeDrawElement

/** Apply text typography attributes to the selected text elements only. */
export function patchSelectedTextTypography(elements: DesignElement[], selectedIds: string[], patch: Partial<Pick<TextElement, 'fontSize' | 'fontFamily' | 'color' | 'bold' | 'kerning' | 'lineSpacing'>>): DesignElement[] {
  const targets = new Set(selectedIds)
  return elements.map(element => element.type === 'text' && targets.has(element.id) ? { ...element, ...patch } : element)
}

export function createStickyNoteElement(x: number, y: number): StickyNoteElement {
  return { id: createId('sticky-note'), type: 'sticky-note', name: 'Nota adesiva', x, y, width: 260, height: 220, rotation: 0, text: 'Escreva uma ideia', fill: '#fff2a8', color: '#302d20', fontSize: 24 }
}

export function createFreeDrawElement(points: number[], color = '#29263d', strokeWidth = 8, opacity = 1): FreeDrawElement | null {
  if (points.length < 2 || points.length % 2 !== 0 || points.some(point => !Number.isFinite(point))) return null
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null
  const xs = points.filter((_, index) => index % 2 === 0)
  const ys = points.filter((_, index) => index % 2 === 1)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(1, Math.max(...xs) - x)
  const height = Math.max(1, Math.max(...ys) - y)
  const localPoints = points.map((point, index) => point - (index % 2 === 0 ? x : y))
  if (localPoints.length === 2) localPoints.push(localPoints[0], localPoints[1])
  return { id: createId('stroke'), type: 'free-draw', name: 'Desenho livre', x, y, width, height, rotation: 0, points: localPoints, color, strokeWidth, ...(opacity < 1 ? { opacity } : {}) }
}

export type DesignPage = {
  id: string
  name: string
  background: string
  hidden?: boolean
  elements: DesignElement[]
  timelineClips?: VideoTimelineClip[]
  connectors?: WhiteboardConnector[]
  groups?: WhiteboardGroup[]
  presenterNotes?: string
  blocks?: DocBlock[]
  cells?: string[][]
  cellMerges?: SheetCellMerge[]
  cellFormats?: Record<string, 'default' | 'currency' | 'percentage' | 'date' | 'time' | 'datetime'>
  /** Charts are local editable spreadsheet objects derived from a stored cell range. */
  charts?: SheetChart[]
}

export type SheetChart = {
  id: string
  type: 'bar' | 'line'
  title: string
  range: { startRow: number; startColumn: number; endRow: number; endColumn: number }
}

export type VideoTimelineClip = {
  id: string
  assetId: string
  name: string
  kind: 'video' | 'audio'
  /** Visual stacking lane. Missing values from older documents are lane zero. */
  trackIndex?: number
  /** Visual clip opacity in percent; missing values preserve legacy full opacity. */
  opacity?: number
  /** Source fitting inside the scene viewport; legacy clips use contain. */
  fitMode?: 'contain' | 'cover'
  /** Source size relative to the fitted viewport, in percent. */
  scale?: number
  /** Horizontal/vertical framing offset as a percentage of the scene size. */
  offsetX?: number
  offsetY?: number
  /** Clip-relative opacity animation points; missing values mean no animation. */
  opacityKeyframes?: VideoOpacityKeyframe[]
  /** Clip-relative framing animation points. */
  transformKeyframes?: VideoTransformKeyframe[]
  /** Curve shared by opacity and framing keyframe segments; legacy clips are linear. */
  animationEasing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  startMs: number
  durationMs: number
  sourceDurationMs: number
  sourceStartMs: number
  volume: number
  /** Linear audio fade envelope in clip-relative milliseconds; absent values mean no fade. */
  fadeInMs?: number
  fadeOutMs?: number
}

/** Optional curve for the segment starting at this keyframe; absent uses the clip curve. */
export type VideoOpacityKeyframe = { timeMs: number; opacity: number; easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' }
/** Optional curve for the segment starting at this keyframe; absent uses the clip curve. */
export type VideoTransformKeyframe = { timeMs: number; scale: number; offsetX: number; offsetY: number; easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' }

export type WhiteboardAnchor = { x: number; y: number }
export type WhiteboardConnector = { id: string; fromId: string; toId: string; fromAnchor?: WhiteboardAnchor; toAnchor?: WhiteboardAnchor; color: string; strokeWidth: number }
export type WhiteboardGroup = { id: string; name: string; elementIds: string[] }

export type DocBlockType = 'paragraph' | 'heading' | 'subheading' | 'quote' | 'bullet' | 'table' | 'image'
export type DocInlineMark = { start: number; end: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }
/** Embedded raster image in a Docs block. src is a validated PNG/JPEG data URL. */
export type DocImage = { src: string; alt: string; width: number; height: number }
export type TableCellMerge = { row: number; column: number; colSpan: number; rowSpan?: number }
export type SheetCellMerge = { row: number; column: number; colSpan: number; rowSpan?: number }
export type DocTableBorderStyle = 'none' | 'solid' | 'long-dashes' | 'dashes' | 'dots'
export type DocTableCellBorder = { style: DocTableBorderStyle; width: number }
export type DocTableCellBorders = Record<string, Partial<Record<'top' | 'right' | 'bottom' | 'left', DocTableCellBorder>>>
export type DocBlock = { id: string; type: DocBlockType; text: string; marks?: DocInlineMark[]; image?: DocImage; cells?: string[][]; cellImages?: Record<string, DocImage[]>; merges?: TableCellMerge[]; cellPadding?: number; tableSpacing?: number; borderColor?: string; borderWidth?: number; cellBorders?: DocTableCellBorders }
export type DocPageSetup = { preset: 'a4'; margins: { top: number; right: number; bottom: number; left: number } }

export type DesignDocument = {
  id: string
  name: string
  type?: 'design' | 'doc' | 'presentation' | 'whiteboard' | 'sheet' | 'video' | 'site'
  archivedAt?: string
  trashedAt?: string
  folderId?: string
  width: number
  height: number
  docPageSetup?: DocPageSetup
  videoDurationMs?: number
  pages: DesignPage[]
  updatedAt: string
  /** Selected local brand kit identity; kit resources remain application-owned. */
  brandKitId?: string
}

export type ProjectFolder = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  favorite: boolean
}

export type MediaAsset = {
  id: string
  name: string
  mimeType: string
  width: number
  height: number
  src: string
  fingerprint?: string
  libraryVisible?: 0 | 1
  createdAt: string
  scope?: 'document' | 'team'
}

export function createBlankDocument(name = 'Design sem título'): DesignDocument {
  const now = new Date().toISOString()
  return {
    id: createId('design'),
    name,
    type: 'design',
    width: 794,
    height: 1123,
    updatedAt: now,
    pages: [{ id: createId('page'), name: 'Página 1', background: '#ffffff', elements: [] }],
  }
}

export const STARTER_TEMPLATES = [
  { id: 'editorial', name: 'Editorial lavanda', description: 'Capa limpa para uma ideia, artigo ou apresentação.', category: 'Editorial' },
  { id: 'campaign', name: 'Campanha noturna', description: 'Composição de alto contraste para divulgar um lançamento.', category: 'Marketing' },
  { id: 'event', name: 'Convite criativo', description: 'Cartaz editável para encontro, oficina ou evento.', category: 'Eventos' },
  { id: 'social-post', name: 'Post geométrico', description: 'Publicação quadrada com destaque para mensagem e chamada.', category: 'Redes sociais' },
  { id: 'story', name: 'Story em movimento', description: 'Tela vertical para anúncio, enquete ou novidade.', category: 'Redes sociais' },
  { id: 'banner', name: 'Banner panorama', description: 'Faixa horizontal para campanha, cabeçalho ou divulgação.', category: 'Marketing' },
  { id: 'quote', name: 'Frase em destaque', description: 'Composição tipográfica para compartilhar uma citação.', category: 'Editorial' },
  { id: 'portfolio', name: 'Portfólio essencial', description: 'Página de apresentação para trabalho e contato profissional.', category: 'Negócios' },
  { id: 'presentation-cover', name: 'Abertura de apresentação', description: 'Slide de abertura com título, contexto e identidade visual.', category: 'Apresentações' },
  { id: 'menu', name: 'Menu da casa', description: 'Cardápio editável com seções, itens e preços.', category: 'Negócios' },
  { id: 'site-portfolio', name: 'Portfólio online', description: 'Site de apresentação com navegação, projetos e contato.', category: 'Sites' },
  { id: 'doc-briefing', name: 'Briefing de projeto', description: 'Documento de briefing com objetivo, público, escopo e próximos passos.', category: 'Documentos' },
] as const

export type StarterTemplateId = typeof STARTER_TEMPLATES[number]['id']

export const STARTER_TEMPLATE_PALETTES = ['all', 'violet', 'warm', 'green', 'dark'] as const
export type StarterTemplatePalette = typeof STARTER_TEMPLATE_PALETTES[number]
export const STARTER_TEMPLATE_TYPES = ['all', 'design', 'presentation', 'site', 'doc'] as const
export type StarterTemplateType = typeof STARTER_TEMPLATE_TYPES[number]
export const STARTER_TEMPLATE_LICENSES = ['all', 'original'] as const
export type StarterTemplateLicense = typeof STARTER_TEMPLATE_LICENSES[number]

export const STARTER_TEMPLATE_METADATA = {
  editorial: { type: 'design', format: 'portrait', palette: 'violet', license: 'original', tags: ['capa', 'artigo', 'texto'] },
  campaign: { type: 'design', format: 'portrait', palette: 'dark', license: 'original', tags: ['lançamento', 'campanha', 'marketing'] },
  event: { type: 'design', format: 'portrait', palette: 'warm', license: 'original', tags: ['cartaz', 'convite', 'evento'] },
  'social-post': { type: 'design', format: 'square', palette: 'warm', license: 'original', tags: ['instagram', 'post', 'social'] },
  story: { type: 'design', format: 'story', palette: 'violet', license: 'original', tags: ['story', 'vertical', 'social'] },
  banner: { type: 'design', format: 'landscape', palette: 'green', license: 'original', tags: ['faixa', 'cabeçalho', 'marketing'] },
  quote: { type: 'design', format: 'portrait', palette: 'green', license: 'original', tags: ['frase', 'citação', 'tipografia'] },
  portfolio: { type: 'design', format: 'portrait', palette: 'warm', license: 'original', tags: ['portfólio', 'currículo', 'negócios'] },
  'presentation-cover': { type: 'presentation', format: 'landscape', palette: 'violet', license: 'original', tags: ['slide', 'apresentação', 'capa'] },
  menu: { type: 'design', format: 'portrait', palette: 'warm', license: 'original', tags: ['cardápio', 'restaurante', 'negócios'] },
  'site-portfolio': { type: 'site', format: 'landscape', palette: 'green', license: 'original', tags: ['site', 'portfólio', 'página', 'contato'] },
  'doc-briefing': { type: 'doc', format: 'portrait', palette: 'violet', license: 'original', tags: ['documento', 'briefing', 'projeto', 'escopo'] },
} as const satisfies Record<StarterTemplateId, { type: Exclude<StarterTemplateType, 'all'>; format: 'portrait' | 'square' | 'story' | 'landscape'; palette: Exclude<StarterTemplatePalette, 'all'>; license: Exclude<StarterTemplateLicense, 'all'>; tags: readonly string[] }>

export function createStarterDocument(templateId: StarterTemplateId = 'editorial'): DesignDocument {
  const isDoc = templateId === 'doc-briefing'
  const document = isDoc ? createTypedBlankDocument('doc') : createBlankDocument(STARTER_TEMPLATES.find(template => template.id === templateId)?.name ?? 'Design de exemplo')
  document.name = STARTER_TEMPLATES.find(template => template.id === templateId)?.name ?? 'Design de exemplo'
  const page = document.pages[0]
  if (templateId === 'site-portfolio') {
    document.type = 'site'
    document.width = 1440
    document.height = 900
    page.name = 'Início'
    page.background = '#f4f1ec'
    const sectionId = createId('page')
    page.elements = [
      { id: createId('shape'), type: 'shape', shape: 'rect', name: 'Cabeçalho verde', x: 0, y: 0, width: 1440, height: 360, rotation: 0, fill: '#29483f', cornerRadius: 0 },
      { id: createId('text'), type: 'text', name: 'Nome', text: 'Seu nome criativo', x: 96, y: 96, width: 860, height: 120, rotation: 0, fontSize: 64, fontFamily: 'Arial', color: '#ffffff', bold: true },
      { id: createId('text'), type: 'text', name: 'Especialidade', text: 'Design · estratégia · direção de arte', x: 104, y: 236, width: 860, height: 52, rotation: 0, fontSize: 26, fontFamily: 'Arial', color: '#d4e5d9', bold: false },
      { id: createId('text'), type: 'text', name: 'Chamada para ação', text: 'Conheça meu trabalho', x: 106, y: 560, width: 620, height: 72, rotation: 0, fontSize: 40, fontFamily: 'Arial', color: '#29483f', bold: true, href: `#site-section-${sectionId}` },
    ]
    document.pages.push({ id: sectionId, name: 'Contato', background: '#ffffff', elements: [
      { id: createId('text'), type: 'text', name: 'Contato', text: 'Vamos criar algo juntos?\nola@exemplo.com', x: 100, y: 220, width: 980, height: 180, rotation: 0, fontSize: 44, fontFamily: 'Arial', color: '#29483f', bold: true },
    ] })
    return document
  }
  if (templateId === 'doc-briefing') {
    page.name = 'Briefing'
    page.blocks = [
      { id: createId('block'), type: 'heading', text: 'Briefing de projeto' },
      { id: createId('block'), type: 'paragraph', text: 'Use este documento para alinhar o objetivo, o público e o resultado esperado.' },
      { id: createId('block'), type: 'subheading', text: 'Objetivo' },
      { id: createId('block'), type: 'paragraph', text: 'Que mudança ou resultado este projeto deve produzir?' },
      { id: createId('block'), type: 'subheading', text: 'Público' },
      { id: createId('block'), type: 'paragraph', text: 'Quem precisa receber esta mensagem ou usar este produto?' },
      { id: createId('block'), type: 'subheading', text: 'Escopo e referências' },
      { id: createId('block'), type: 'bullet', text: 'Entregáveis, formatos e canais' },
      { id: createId('block'), type: 'bullet', text: 'Referências, restrições e itens fora do escopo' },
      { id: createId('block'), type: 'subheading', text: 'Próximos passos' },
      { id: createId('block'), type: 'paragraph', text: 'Responsável: __________    Prazo: __________' },
    ]
    return document
  }
  if (templateId === 'social-post') { document.width = 1080; document.height = 1080 }
  if (templateId === 'story') { document.width = 1080; document.height = 1920 }
  if (templateId === 'banner') { document.width = 1600; document.height = 600 }
  if (templateId === 'presentation-cover') {
    document.type = 'presentation'
    document.width = 1280
    document.height = 720
    page.name = 'Slide 1'
  }
  const shape = (name: string, x: number, y: number, width: number, height: number, fill: string, shapeType: 'rect' | 'ellipse' = 'rect', cornerRadius = 0): ShapeElement => ({
    id: createId('shape'), type: 'shape', shape: shapeType, name, x, y, width, height, rotation: 0, fill, cornerRadius,
  })
  const text = (name: string, value: string, x: number, y: number, width: number, height: number, fontSize: number, color: string, bold = false): TextElement => ({
    id: createId('text'), type: 'text', name, text: value, x, y, width, height, rotation: 0, fontSize, fontFamily: 'Arial', color, bold,
  })

  if (templateId === 'social-post') {
    page.background = '#f5eee6'
    page.elements = [shape('Bloco ameixa', 0, 0, 1080, 340, '#53324e'), shape('Sol laranja', 730, 150, 230, 230, '#f4a261', 'ellipse'), shape('Ponto lavanda', 120, 720, 150, 150, '#a995cf', 'ellipse'), text('Tema', 'IDEIA DA SEMANA', 86, 72, 750, 48, 25, '#ffffff', true), text('Mensagem', 'Pequenos passos,\ngrandes caminhos.', 90, 410, 850, 220, 70, '#53324e', true), text('Ação', '@SEUPROJETO  ·  SAIBA MAIS', 96, 900, 760, 46, 21, '#53324e', true)]
  } else if (templateId === 'story') {
    page.background = '#ede7f7'
    page.elements = [shape('Fundo ameixa', 0, 0, 1080, 1050, '#53324e'), shape('Sol coral', 115, 1110, 850, 650, '#ee806c', 'ellipse'), text('Marca', 'NOVIDADE', 84, 92, 820, 50, 26, '#d8c9f3', true), text('Mensagem', 'Uma nova\nforma de criar', 84, 350, 850, 360, 88, '#ffffff', true), text('Detalhes', 'Conheça ideias e ferramentas para o próximo projeto.', 92, 790, 770, 120, 34, '#f1eafa'), text('Ação', 'DESLIZE PARA DESCOBRIR  →', 100, 1690, 850, 60, 26, '#53324e', true)]
  } else if (templateId === 'banner') {
    page.background = '#122a31'
    page.elements = [shape('Faixa marfim', 0, 0, 880, 600, '#f4eee4'), shape('Círculo verde', 1060, 92, 410, 410, '#65a69a', 'ellipse'), shape('Ponto coral', 1190, 210, 150, 150, '#ed8069', 'ellipse'), text('Selo', 'EDIÇÃO ESPECIAL', 74, 58, 650, 45, 21, '#547e74', true), text('Título', 'Novas ideias\ncomeçam aqui', 74, 150, 820, 190, 54, '#122a31', true), text('Descrição', 'Inspire seu próximo projeto com a gente.', 82, 390, 680, 60, 24, '#435b5a'), text('Ação', 'EXPLORAR  →', 850, 474, 570, 50, 24, '#ffffff', true)]
  } else if (templateId === 'quote') {
    page.background = '#f3eadc'
    page.elements = [shape('Cartão escuro', 58, 74, 678, 970, '#273d37', 'rect', 28), shape('Aspas', 110, 132, 170, 170, '#df9a6d', 'ellipse'), text('Aspa decorativa', '“', 134, 112, 150, 190, 140, '#273d37', true), text('Citação', 'A criatividade\né a inteligência\na divertir-se.', 108, 350, 580, 360, 50, '#fff8ec', true), text('Autoria', '— ALBERT EINSTEIN', 116, 820, 540, 54, 20, '#dfb99b', true), shape('Ponto coral', 590, 880, 88, 88, '#e27e69', 'ellipse')]
  } else if (templateId === 'portfolio') {
    page.background = '#f4f1ec'
    page.elements = [shape('Cabeçalho verde', 0, 0, 794, 330, '#29483f'), shape('Retrato abstrato', 505, 70, 210, 210, '#dfa17d', 'ellipse'), shape('Ponto claro', 582, 120, 84, 84, '#f4d8bb', 'ellipse'), text('Área', 'PORTFÓLIO  /  2026', 52, 45, 430, 42, 17, '#d4e5d9', true), text('Nome', 'Seu nome\ncriativo', 50, 116, 510, 156, 48, '#ffffff', true), text('Especialidade', 'Design · Estratégia · Direção de arte', 58, 402, 650, 48, 22, '#29483f', true), shape('Linha', 58, 490, 676, 4, '#dfa17d'), text('Sobre', 'Transformo desafios em experiências visuais claras, cuidadosas e memoráveis.', 60, 545, 650, 128, 22, '#59645e'), text('Contato', 'OLA@EXEMPLO.COM  ·  PORTFOLIO.COM', 62, 930, 670, 40, 15, '#29483f', true)]
  } else if (templateId === 'presentation-cover') {
    page.background = '#27233b'
    page.elements = [shape('Plano violeta', 820, 0, 460, 720, '#8065db'), shape('Arco coral', 940, 410, 240, 240, '#f58c72', 'ellipse'), shape('Ponto creme', 1060, 478, 92, 92, '#f4dfb5', 'ellipse'), text('Série', 'ESTRATÉGIA  /  2026', 72, 68, 690, 48, 20, '#c9baf3', true), text('Título', 'O próximo\ncapítulo', 68, 185, 760, 230, 72, '#ffffff', true), text('Subtítulo', 'Ideias para construir o que vem depois.', 76, 482, 700, 60, 25, '#ddd8e9'), text('Rodapé', 'APRESENTADO POR SUA EQUIPE', 78, 648, 620, 28, 14, '#c9baf3', true)]
  } else if (templateId === 'menu') {
    page.background = '#fff8ed'
    page.elements = [shape('Cabeçalho verde', 0, 0, 794, 255, '#254a3f'), text('Marca', 'CAFÉ  /  COZINHA', 55, 42, 660, 36, 16, '#dfc6a1', true), text('Título', 'Menu da casa', 52, 100, 680, 82, 42, '#ffffff', true), text('Seção 1', 'PARA COMEÇAR', 54, 316, 680, 34, 17, '#b66d4f', true), text('Itens 1', 'Pão da casa  ......................  R$ 18\nSalada da estação ............... R$ 26', 56, 370, 680, 106, 17, '#403d35'), text('Seção 2', 'PRATOS PRINCIPAIS', 55, 550, 680, 34, 17, '#b66d4f', true), text('Itens 2', 'Risoto de cogumelos .......... R$ 48\nMassa ao molho da casa ....... R$ 42', 57, 604, 680, 106, 17, '#403d35'), text('Nota', 'INGREDIENTES FRESCOS · FEITO COM CARINHO', 57, 970, 680, 28, 13, '#697266', true)]
  } else if (templateId === 'campaign') {
    page.background = '#20203b'
    page.elements = [
      shape('Faixa violeta', 0, 0, 794, 350, '#6f5cdf'),
      shape('Selo coral', 540, 600, 180, 180, '#ff896f', 'ellipse'),
      text('Chamada', 'NOVO\nCAPÍTULO', 68, 98, 640, 210, 68, '#ffffff', true),
      text('Descrição', 'Uma campanha começa com uma boa história.', 74, 385, 590, 78, 24, '#eeeaff'),
      text('Ação', 'DESCUBRA MAIS  →', 76, 520, 440, 50, 18, '#ffffff', true),
      text('Selo', '2026', 565, 657, 140, 52, 24, '#29263d', true),
    ]
  } else if (templateId === 'event') {
    page.background = '#fff8ef'
    page.elements = [
      shape('Cartão central', 58, 72, 678, 960, '#ffffff', 'rect', 24),
      shape('Faixa coral', 58, 72, 678, 24, '#ff896f', 'rect', 12),
      shape('Círculo decorativo', 500, 630, 190, 190, '#eeeaff', 'ellipse'),
      text('Tipo de evento', 'ENCONTRO ABERTO', 102, 160, 570, 44, 17, '#7464e8', true),
      text('Título', 'IDEIAS EM\nMOVIMENTO', 98, 246, 570, 194, 56, '#29263d', true),
      text('Descrição', 'Uma tarde para aprender, compartilhar e criar junto.', 104, 493, 520, 100, 23, '#625f75'),
      text('Data', 'SÁBADO · 14H', 104, 720, 420, 52, 20, '#29263d', true),
      text('Local', 'ESTÚDIO CRIATIVO · CENTRO', 104, 779, 490, 42, 13, '#777487'),
    ]
  } else {
    page.background = '#ffffff'
    page.elements = [
      shape('Bloco lavanda', 78, 76, 638, 300, '#eeeaff', 'rect', 32),
      text('Título', 'Ideias que\nganham forma', 112, 121, 590, 140, 44, '#29263d', true),
      text('Subtítulo', 'Um espaço para criar, testar e compartilhar.', 118, 278, 500, 50, 18, '#625f75'),
      shape('Círculo coral', 250, 520, 286, 286, '#ff896f', 'ellipse'),
      text('Texto do círculo', 'Comece por aqui', 263, 635, 260, 54, 22, '#ffffff', true),
    ]
  }

  return document
}

export function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

export function createIsoTimestamp(): string {
  return new Date().toISOString()
}

export function getCurrentTimeMilliseconds(): number {
  return Date.now()
}

export function createTypedBlankDocument(type: DesignDocument['type']): DesignDocument {
  const document = createBlankDocument(type === 'doc' ? 'Documento sem título' : 'Design sem título')
  document.type = type
  if (type === 'presentation') {
    document.name = 'Apresentação sem título'
    document.width = 1280
    document.height = 720
    document.pages[0].name = 'Slide 1'
  }
  if (type === 'video') {
    document.name = 'Vídeo sem título'
    document.width = 1920
    document.height = 1080
    document.pages[0].name = 'Cena 1'
    document.videoDurationMs = 10_000
  }
  if (type === 'whiteboard') {
    document.name = 'Quadro sem título'
    document.width = 3200
    document.height = 2000
    document.pages[0].name = 'Quadro 1'
  }
  if (type === 'doc') {
    document.docPageSetup = { preset: 'a4', margins: { top: 96, right: 96, bottom: 96, left: 96 } }
    document.pages[0].blocks = [{ id: createId('block'), type: 'paragraph', text: '' }]
  }
  if (type === 'sheet') {
    document.name = 'Planilha sem título'
    document.width = 1600
    document.height = 900
    document.pages[0].name = 'Planilha 1'
    document.pages[0].cells = Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => ''))
  }
  if (type === 'site') {
    const contactPageId = createId('page')
    document.name = 'Site sem título'
    document.width = 1440
    document.height = 900
    document.pages[0].name = 'Início'
    document.pages[0].background = '#f5f4fa'
    document.pages[0].elements = [
      { id: createId('shape'), type: 'shape', name: 'Fundo do botão', x: 120, y: 475, width: 260, height: 76, rotation: 0, shape: 'rect', fill: '#7054df', cornerRadius: 14 },
      { id: createId('text'), type: 'text', name: 'Título principal', x: 120, y: 150, width: 1000, height: 140, rotation: 0, text: 'Sua ideia, em destaque', fontSize: 72, fontFamily: 'Arial', color: '#26233d', bold: true },
      { id: createId('text'), type: 'text', name: 'Texto de apresentação', x: 120, y: 320, width: 760, height: 100, rotation: 0, text: 'Apresente seu trabalho com um site claro, responsivo e fácil de personalizar.', fontSize: 28, fontFamily: 'Arial', color: '#635e73', bold: false },
      { id: createId('text'), type: 'text', name: 'Chamada para ação', x: 146, y: 490, width: 220, height: 48, rotation: 0, text: 'Entre em contato', href: `#site-section-${contactPageId}`, fontSize: 24, fontFamily: 'Arial', color: '#ffffff', bold: true },
    ]
    document.pages.push({
      id: contactPageId,
      name: 'Contato',
      background: '#26233d',
      elements: [
        { id: createId('text'), type: 'text', name: 'Título de contato', x: 120, y: 145, width: 1000, height: 130, rotation: 0, text: 'Vamos conversar?', fontSize: 68, fontFamily: 'Arial', color: '#ffffff', bold: true },
        { id: createId('text'), type: 'text', name: 'Mensagem de contato', x: 120, y: 315, width: 760, height: 100, rotation: 0, text: 'Conte um pouco sobre a sua ideia e vamos criar algo juntos.', fontSize: 28, fontFamily: 'Arial', color: '#e5e2f2', bold: false },
        { id: createId('text'), type: 'text', name: 'E-mail de contato', x: 120, y: 485, width: 540, height: 60, rotation: 0, text: 'contato@example.com', href: 'mailto:contato@example.com', fontSize: 28, fontFamily: 'Arial', color: '#ffffff', bold: true },
      ],
    })
  }
  return document
}
