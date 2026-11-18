// Nós do canvas (design, apresentação, quadro, vídeo, site).
import { z } from 'zod'
import {
  ColorSchema, ExtensionsSchema, FiniteSchema, IdSchema, NodeAnimationSchema, PaintSchema, PointSchema,
  RectSchema, StrokeSchema, TextMarkSchema, TextStyleSchema, TimingSchema,
} from './primitives.js'

/** Campos comuns a todos os nós. */
const nodeCommon = {
  id: IdSchema,
  name: z.string().max(1024).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  /** Opacidade 0..1. Ausente = 1. */
  opacity: z.number().min(0).max(1).optional(),
  timing: TimingSchema.optional(),
  animation: NodeAnimationSchema.nullable().optional(),
  extensions: ExtensionsSchema.optional(),
}

/**
 * Caixa do nó. x/y são relativos ao espaço de coordenadas do Frame ancestral mais próximo
 * (ou da página). Grupos não criam espaço de coordenadas próprio.
 */
const box = {
  x: FiniteSchema,
  y: FiniteSchema,
  width: FiniteSchema,
  height: FiniteSchema,
  /** Rotação em graus, sentido horário, em torno do canto superior esquerdo. */
  rotation: FiniteSchema,
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
}

export const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'star', 'hexagon', 'line', 'arrow', 'speech-bubble'] as const
export const ShapeKindSchema = z.enum(SHAPE_KINDS)

export const ShapeNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('shape'),
  shape: ShapeKindSchema,
  fill: PaintSchema,
  cornerRadius: z.number().min(0),
  /** Espessura do traço (formas de linha usam `fill` como cor do traço). */
  strokeWidth: z.number().min(0).optional(),
  stroke: StrokeSchema.optional(),
  markers: z.object({ start: z.boolean().optional(), end: z.boolean().optional() }).strict().optional(),
  /** Deslocamento da curva de linhas; null = reta explícita. */
  curveOffset: FiniteSchema.nullable().optional(),
}).strict()

export const PathNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('path'),
  /** Pares x,y planos, relativos à caixa do nó. */
  points: z.array(FiniteSchema).refine(points => points.length % 2 === 0, 'points deve ter número par de valores'),
  /** Alternativa vetorial: dados de path SVG relativos à caixa. */
  d: z.string().max(1_000_000).optional(),
  closed: z.boolean().optional(),
  tool: z.enum(['freehand', 'pen', 'highlighter']).optional(),
  stroke: StrokeSchema.optional(),
  fill: PaintSchema.optional(),
}).strict()

export const TextNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('text'),
  text: z.string(),
  style: TextStyleSchema,
  marks: z.array(TextMarkSchema).optional(),
  link: z.string().max(4096).optional(),
  autoSize: z.enum(['none', 'height', 'width']).optional(),
}).strict()

export const ImageAdjustmentsSchema = z.object({
  brightness: FiniteSchema.optional(),
  contrast: FiniteSchema.optional(),
  saturation: FiniteSchema.optional(),
}).strict()

export const MaskStrokeSchema = z.object({
  mode: z.enum(['erase', 'restore']),
  size: z.number().min(0),
  /** Pares x,y normalizados (0..1) em relação à imagem. */
  points: z.array(FiniteSchema),
}).strict()

export const ImageNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('image'),
  /** Chave em FuseFile.assets. Preferido para arquivos .fuse. */
  assetId: IdSchema.optional(),
  /** URL inline (http(s), data:, ou "fuse-asset:<sha256>" dentro de um pacote). */
  src: z.string().optional(),
  alt: z.string().max(10_000).optional(),
  decorative: z.boolean().optional(),
  intrinsicWidth: FiniteSchema.optional(),
  intrinsicHeight: FiniteSchema.optional(),
  crop: RectSchema.nullable().optional(),
  adjustments: ImageAdjustmentsSchema.optional(),
  filter: z.enum(['soft', 'vintage', 'mono', 'color-pop', 'duotone']).optional(),
  stylize: z.enum(['recorte', 'gravura', 'rabisco']).optional(),
  mask: z.array(MaskStrokeSchema).optional(),
}).strict()

export const VideoNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('video'),
  assetId: IdSchema.optional(),
  src: z.string().optional(),
  posterAssetId: IdSchema.optional(),
  trimStartMs: z.number().min(0).optional(),
  trimEndMs: z.number().min(0).optional(),
  muted: z.boolean().optional(),
  loop: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  fit: z.enum(['contain', 'cover']).optional(),
}).strict()

export const AudioNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('audio'),
  assetId: IdSchema.optional(),
  src: z.string().optional(),
  volume: z.number().min(0).max(1).optional(),
  loop: z.boolean().optional(),
}).strict()

export const StickyNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('sticky'),
  text: z.string(),
  fill: ColorSchema,
  color: ColorSchema,
  fontSize: z.number().positive(),
  author: z.string().max(256).optional(),
}).strict()

export const ConnectorEndSchema = z.object({
  nodeId: IdSchema,
  /** Âncora normalizada (0..1) na caixa do nó de destino. Ausente = automática. */
  anchor: PointSchema.optional(),
}).strict()

export const ConnectorNodeSchema = z.object({
  ...nodeCommon,
  type: z.literal('connector'),
  from: ConnectorEndSchema,
  to: ConnectorEndSchema,
  stroke: StrokeSchema,
  routing: z.enum(['straight', 'curved', 'elbow']).optional(),
  markers: z.object({ start: z.enum(['none', 'arrow', 'dot']).optional(), end: z.enum(['none', 'arrow', 'dot']).optional() }).strict().optional(),
  label: z.string().max(10_000).optional(),
}).strict()

export const TableCellSchema = z.object({
  text: z.string(),
  marks: z.array(TextMarkSchema).optional(),
  fill: ColorSchema.optional(),
}).strict()

export const TableNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('table'),
  rows: z.array(z.array(TableCellSchema)),
  columnWidths: z.array(z.number().min(0)).optional(),
  rowHeights: z.array(z.number().min(0)).optional(),
  merges: z.array(z.object({ row: z.number().int().min(0), column: z.number().int().min(0), rowSpan: z.number().int().min(1), colSpan: z.number().int().min(1) }).strict()).optional(),
  style: TextStyleSchema.optional(),
  border: StrokeSchema.optional(),
}).strict()

export const ChartNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut', 'scatter']),
  title: z.string().max(1024).optional(),
  data: z.object({
    categories: z.array(z.string()),
    series: z.array(z.object({ name: z.string(), values: z.array(FiniteSchema.nullable()), color: ColorSchema.optional() }).strict()),
  }).strict(),
  /** Vínculo opcional a uma faixa de planilha do mesmo arquivo. */
  source: z.object({ sheetId: IdSchema, range: z.string().min(1) }).strict().optional(),
}).strict()

export const EmbedNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('embed'),
  url: z.string().min(1).max(4096),
  provider: z.string().max(256).optional(),
  title: z.string().max(1024).optional(),
  posterAssetId: IdSchema.optional(),
}).strict()

export const QrNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('qr'),
  /** Conteúdo codificado (normalmente uma URL). */
  data: z.string().max(4096).optional(),
  label: z.string().max(1024).optional(),
  expiresAt: z.string().max(64).optional(),
  pattern: z.enum(['blocks', 'rounded', 'circles', 'crosses', 'stars', 'hearts']),
  foreground: ColorSchema,
  background: ColorSchema,
  logo: z.enum(['none', 'logo']),
  cornerRadius: z.number().min(0),
}).strict()

export const PluginNodeSchema = z.object({
  ...nodeCommon,
  ...box,
  type: z.literal('plugin'),
  /** Identificador do plugin dono (ex.: "org.exemplo.mapa"). */
  pluginId: z.string().min(1).max(256),
  pluginVersion: z.string().max(64).optional(),
  /** Dados opacos validados pelo plugin dono. */
  data: z.unknown(),
  /** Imagem de fallback para leitores sem o plugin. */
  previewAssetId: IdSchema.optional(),
}).strict()

const FrameFields = {
  ...nodeCommon,
  ...box,
  type: z.literal('frame'),
  fill: PaintSchema.optional(),
  cornerRadius: z.number().min(0).optional(),
  clipContent: z.boolean().optional(),
}
const GroupFields = {
  ...nodeCommon,
  ...box,
  type: z.literal('group'),
}
const FrameNodeBaseSchema = z.object(FrameFields).strict()
const GroupNodeBaseSchema = z.object(GroupFields).strict()

export type ShapeNode = z.infer<typeof ShapeNodeSchema>
export type PathNode = z.infer<typeof PathNodeSchema>
export type TextNode = z.infer<typeof TextNodeSchema>
export type ImageNode = z.infer<typeof ImageNodeSchema>
export type VideoNode = z.infer<typeof VideoNodeSchema>
export type AudioNode = z.infer<typeof AudioNodeSchema>
export type StickyNode = z.infer<typeof StickyNodeSchema>
export type ConnectorNode = z.infer<typeof ConnectorNodeSchema>
export type TableNode = z.infer<typeof TableNodeSchema>
export type ChartNode = z.infer<typeof ChartNodeSchema>
export type EmbedNode = z.infer<typeof EmbedNodeSchema>
export type QrNode = z.infer<typeof QrNodeSchema>
export type PluginNode = z.infer<typeof PluginNodeSchema>
/** Contêiner com espaço de coordenadas próprio (prancheta, seção de site, cena). */
export type FrameNode = z.infer<typeof FrameNodeBaseSchema> & { children: FuseNode[] }
/** Agrupamento lógico; filhos ficam no espaço de coordenadas do pai. */
export type GroupNode = z.infer<typeof GroupNodeBaseSchema> & { children: FuseNode[] }
export type FuseNode =
  | FrameNode | GroupNode | ShapeNode | PathNode | TextNode | ImageNode | VideoNode | AudioNode
  | StickyNode | ConnectorNode | TableNode | ChartNode | EmbedNode | QrNode | PluginNode
export type NodeType = FuseNode['type']

const lazyChildren = z.array(z.lazy((): z.ZodType<FuseNode> => NodeSchema))
export const FrameNodeSchema = z.object({ ...FrameFields, children: lazyChildren }).strict()
export const GroupNodeSchema = z.object({ ...GroupFields, children: lazyChildren }).strict()

export const NodeSchema: z.ZodType<FuseNode> = z.discriminatedUnion('type', [
  FrameNodeSchema, GroupNodeSchema, ShapeNodeSchema, PathNodeSchema, TextNodeSchema, ImageNodeSchema,
  VideoNodeSchema, AudioNodeSchema, StickyNodeSchema, ConnectorNodeSchema, TableNodeSchema, ChartNodeSchema,
  EmbedNodeSchema, QrNodeSchema, PluginNodeSchema,
])

export const NODE_TYPES = [
  'frame', 'group', 'shape', 'path', 'text', 'image', 'video', 'audio', 'sticky', 'connector', 'table', 'chart', 'embed', 'qr', 'plugin',
] as const satisfies readonly NodeType[]
