// Corpos de conteúdo não-canvas: documento (DocBody), planilha (Sheet), linha do tempo (Timeline) e site (SiteMeta).
import { z } from 'zod'
import { ColorSchema, EasingSchema, ExtensionsSchema, FiniteSchema, IdSchema, TextMarkSchema } from './primitives.js'

// ---------------------------------------------------------------- DocBody

export const DocImageSchema = z.object({
  /** URL da imagem (data:, http(s) ou "fuse-asset:<sha256>"). */
  src: z.string(),
  alt: z.string(),
  width: FiniteSchema,
  height: FiniteSchema,
}).strict()
export type DocImage = z.infer<typeof DocImageSchema>

export const DOC_BLOCK_TYPES = ['paragraph', 'heading', 'subheading', 'quote', 'bullet', 'table', 'image'] as const
export const DocBorderStyleSchema = z.enum(['none', 'solid', 'long-dashes', 'dashes', 'dots'])
export const DocCellBorderSchema = z.object({ style: DocBorderStyleSchema, width: z.number().min(0) }).strict()
export const DocCellBordersSchema = z.object({
  top: DocCellBorderSchema.optional(),
  right: DocCellBorderSchema.optional(),
  bottom: DocCellBorderSchema.optional(),
  left: DocCellBorderSchema.optional(),
}).strict()

export const CellMergeSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  colSpan: z.number().int().min(1),
  rowSpan: z.number().int().min(1).optional(),
}).strict()
export type CellMerge = z.infer<typeof CellMergeSchema>

/** Tabela embutida num bloco de documento. Chaves de célula no formato "linha:coluna" (base 0). */
export const DocTableSchema = z.object({
  rows: z.array(z.array(z.string())).optional(),
  cellImages: z.record(z.string(), z.array(DocImageSchema)).optional(),
  merges: z.array(CellMergeSchema).optional(),
  cellPadding: z.number().min(0).optional(),
  spacing: z.number().min(0).optional(),
  borderColor: ColorSchema.optional(),
  borderWidth: z.number().min(0).optional(),
  cellBorders: z.record(z.string(), DocCellBordersSchema).optional(),
}).strict()
export type DocTable = z.infer<typeof DocTableSchema>

export const DocBlockSchema = z.object({
  id: IdSchema,
  type: z.enum(DOC_BLOCK_TYPES),
  text: z.string(),
  marks: z.array(TextMarkSchema).optional(),
  image: DocImageSchema.optional(),
  table: DocTableSchema.optional(),
  extensions: ExtensionsSchema.optional(),
}).strict()
export type DocBlock = z.infer<typeof DocBlockSchema>

export const PageSetupSchema = z.object({
  preset: z.enum(['a4', 'a5', 'letter', 'legal', 'custom']),
  width: FiniteSchema.optional(),
  height: FiniteSchema.optional(),
  margins: z.object({ top: FiniteSchema, right: FiniteSchema, bottom: FiniteSchema, left: FiniteSchema }).strict(),
}).strict()
export type PageSetup = z.infer<typeof PageSetupSchema>

/** Uma seção de documento vinculada a uma página de FuseFile.pages. */
export const DocSectionSchema = z.object({
  pageId: IdSchema,
  blocks: z.array(DocBlockSchema),
}).strict()

export const DocBodySchema = z.object({
  pageSetup: PageSetupSchema.optional(),
  sections: z.array(DocSectionSchema),
}).strict()
export type DocBody = z.infer<typeof DocBodySchema>

// ---------------------------------------------------------------- Sheet

/** Referência de célula A1 (coluna em letras, linha base 1). */
export const CellRefSchema = z.string().regex(/^[A-Z]{1,4}[1-9][0-9]{0,6}$/, 'Referência A1 inválida')
/** Faixa A1 (ex.: "A1:C10"). */
export const RangeRefSchema = z.string().regex(/^[A-Z]{1,4}[1-9][0-9]{0,6}:[A-Z]{1,4}[1-9][0-9]{0,6}$/, 'Faixa A1 inválida')

export const NumberFormatSchema = z.enum(['default', 'currency', 'percentage', 'date', 'time', 'datetime'])

export const SheetCellSchema = z.object({
  /** Entrada do usuário. Fórmulas começam com "=". */
  input: z.string().optional(),
  format: NumberFormatSchema.optional(),
}).strict()
export type SheetCell = z.infer<typeof SheetCellSchema>

export const SheetChartSchema = z.object({
  id: IdSchema,
  type: z.enum(['bar', 'line']),
  title: z.string(),
  range: RangeRefSchema,
}).strict()

/** Grade esparsa: apenas células com conteúdo ou formato são gravadas. */
export const SheetSchema = z.object({
  /** Página de FuseFile.pages que contém a planilha (aba). */
  pageId: IdSchema,
  rowCount: z.number().int().min(0),
  columnCount: z.number().int().min(0),
  cells: z.record(CellRefSchema, SheetCellSchema),
  merges: z.array(CellMergeSchema).optional(),
  charts: z.array(SheetChartSchema).optional(),
  frozen: z.object({ rows: z.number().int().min(0), columns: z.number().int().min(0) }).strict().optional(),
  extensions: ExtensionsSchema.optional(),
}).strict()
export type Sheet = z.infer<typeof SheetSchema>

// ---------------------------------------------------------------- Timeline

export const OpacityKeyframeSchema = z.object({
  timeMs: z.number().min(0),
  opacity: FiniteSchema,
  easing: EasingSchema.optional(),
}).strict()

export const TransformKeyframeSchema = z.object({
  timeMs: z.number().min(0),
  scale: FiniteSchema,
  offsetX: FiniteSchema,
  offsetY: FiniteSchema,
  easing: EasingSchema.optional(),
}).strict()

export const ClipSchema = z.object({
  id: IdSchema,
  /** Cena (página) a que o clipe pertence. */
  pageId: IdSchema,
  assetId: IdSchema,
  name: z.string(),
  kind: z.enum(['video', 'audio']),
  /** Faixa de empilhamento. Ausente = 0. */
  track: z.number().int().min(0).optional(),
  startMs: z.number().min(0),
  durationMs: z.number().min(0),
  sourceStartMs: z.number().min(0),
  sourceDurationMs: z.number().min(0),
  /** Volume 0..1 (pode exceder 1 para ganho). */
  volume: z.number().min(0),
  fadeInMs: z.number().min(0).optional(),
  fadeOutMs: z.number().min(0).optional(),
  /** Opacidade visual em percentual (0..100). */
  opacity: z.number().min(0).max(100).optional(),
  fit: z.enum(['contain', 'cover']).optional(),
  /** Escala em percentual relativo ao viewport ajustado. */
  scale: FiniteSchema.optional(),
  offsetX: FiniteSchema.optional(),
  offsetY: FiniteSchema.optional(),
  easing: EasingSchema.optional(),
  opacityKeyframes: z.array(OpacityKeyframeSchema).optional(),
  transformKeyframes: z.array(TransformKeyframeSchema).optional(),
  extensions: ExtensionsSchema.optional(),
}).strict()
export type Clip = z.infer<typeof ClipSchema>

export const TimelineSchema = z.object({
  durationMs: z.number().min(0).optional(),
  fps: z.number().positive().optional(),
  clips: z.array(ClipSchema),
}).strict()
export type Timeline = z.infer<typeof TimelineSchema>

// ---------------------------------------------------------------- Site

export const SiteMetaSchema = z.object({
  /** Ordem de navegação (IDs de páginas). */
  navigation: z.array(z.object({ pageId: IdSchema, label: z.string().optional() }).strict()),
  seo: z.object({
    title: z.string().max(512).optional(),
    description: z.string().max(4096).optional(),
    imageAssetId: IdSchema.optional(),
  }).strict().optional(),
  faviconAssetId: IdSchema.optional(),
  language: z.string().max(35).optional(),
}).strict()
export type SiteMeta = z.infer<typeof SiteMetaSchema>
