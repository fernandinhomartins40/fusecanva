// Tipos primitivos compartilhados por todo o formato .fuse v1.
import { z } from 'zod'

/** Identificador estável (páginas, nós, blocos, clipes). Opaco: nenhum significado no conteúdo. */
export const IdSchema = z.string().min(1).max(256).describe('Identificador estável e opaco.')
export type Id = z.infer<typeof IdSchema>

/** Data/hora ISO-8601 (ex.: 2026-11-18T12:00:00.000Z). */
export const IsoDateTimeSchema = z.string().min(1).max(64).describe('Data/hora ISO-8601.')

/** Cor CSS (hex #rrggbb[aa] recomendado; aceita qualquer cor CSS por compatibilidade). */
export const ColorSchema = z.string().min(1).max(128).describe('Cor CSS. Recomendado: #rrggbb ou #rrggbbaa.')
export type Color = z.infer<typeof ColorSchema>

export const FiniteSchema = z.number().finite()

export const GradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: ColorSchema,
}).strict()

export const LinearGradientSchema = z.object({
  type: z.literal('linear-gradient'),
  /** Ângulo em graus, 0 = de baixo para cima (convenção CSS). */
  angle: FiniteSchema,
  stops: z.array(GradientStopSchema).min(2),
}).strict()

export const RadialGradientSchema = z.object({
  type: z.literal('radial-gradient'),
  stops: z.array(GradientStopSchema).min(2),
}).strict()

/** Pintura: cor sólida (string) ou gradiente. */
export const PaintSchema = z.union([ColorSchema, LinearGradientSchema, RadialGradientSchema])
export type Paint = z.infer<typeof PaintSchema>

/**
 * Extensões com namespace (ex.: "fuse.legacy", "org.exemplo.plugin").
 * Leitores DEVEM preservar extensões desconhecidas ao regravar o arquivo.
 */
export const ExtensionsSchema = z.record(z.string().min(1).max(128), z.unknown())
  .describe('Dados de extensão por namespace. Leitores devem preservar chaves desconhecidas.')
export type Extensions = z.infer<typeof ExtensionsSchema>

export const PointSchema = z.object({ x: FiniteSchema, y: FiniteSchema }).strict()
export type Point = z.infer<typeof PointSchema>

export const RectSchema = z.object({
  x: FiniteSchema,
  y: FiniteSchema,
  width: FiniteSchema,
  height: FiniteSchema,
}).strict()
export type Rect = z.infer<typeof RectSchema>

export const EasingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out'])
export type Easing = z.infer<typeof EasingSchema>

export const StrokeSchema = z.object({
  color: ColorSchema,
  width: z.number().min(0),
  cap: z.enum(['butt', 'round', 'square']).optional(),
  join: z.enum(['miter', 'round', 'bevel']).optional(),
  dash: z.array(z.number().min(0)).optional(),
}).strict()
export type Stroke = z.infer<typeof StrokeSchema>

export const TextAlignSchema = z.enum(['left', 'center', 'right', 'justify'])

export const TextStyleSchema = z.object({
  fontFamily: z.string().min(1).max(256),
  fontSize: z.number().positive(),
  /** Peso CSS 100..900. 400 = normal, 700 = negrito. */
  fontWeight: z.number().int().min(1).max(1000),
  italic: z.boolean().optional(),
  color: ColorSchema,
  /** Espaçamento entre letras em px. Ausente = kerning normal da fonte. */
  letterSpacing: FiniteSchema.optional(),
  /** Multiplicador da altura de linha. Ausente = 1.2. */
  lineHeight: z.number().positive().optional(),
  align: TextAlignSchema.optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
}).strict()
export type TextStyle = z.infer<typeof TextStyleSchema>

/** Faixa de marcas inline sobre um texto (índices em unidades UTF-16, fim exclusivo). */
export const TextMarkSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  color: ColorSchema.optional(),
  link: z.string().max(4096).optional(),
}).strict()
export type TextMark = z.infer<typeof TextMarkSchema>

/** Animação de entrada/saída de um nó. */
export const NodeAnimationSchema = z.object({
  effect: z.enum(['elevation', 'fade', 'slide', 'pop', 'wipe']),
  phase: z.enum(['enter', 'exit', 'emphasis']),
  speed: z.enum(['slow', 'medium', 'fast']),
  direction: z.enum(['down', 'up', 'left', 'right']).optional(),
}).strict()
export type NodeAnimation = z.infer<typeof NodeAnimationSchema>

/** Janela temporal do nó (vídeo/animação). Ausente = o nó ocupa todo o projeto. */
export const TimingSchema = z.object({
  startMs: z.number().min(0).optional(),
  durationMs: z.number().min(0).optional(),
}).strict()
export type Timing = z.infer<typeof TimingSchema>
