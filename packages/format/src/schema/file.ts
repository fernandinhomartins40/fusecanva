// Raiz do formato .fuse v1: FuseFile, Page, AssetRef e styles.
import { z } from 'zod'
import { DocBodySchema, SheetSchema, SiteMetaSchema, TimelineSchema } from './content.js'
import { NodeSchema, type FuseNode } from './nodes.js'
import { ColorSchema, ExtensionsSchema, FiniteSchema, IdSchema, IsoDateTimeSchema, PaintSchema, TextStyleSchema } from './primitives.js'

export const FORMAT_ID = 'fuse' as const
/** Versão atual do schema. Cada incremento exige uma migração pura v(n) -> v(n+1). */
export const SCHEMA_VERSION = 1 as const

export const DOCUMENT_KINDS = ['design', 'presentation', 'doc', 'whiteboard', 'sheet', 'video', 'site'] as const
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS)
export type DocumentKind = z.infer<typeof DocumentKindSchema>

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 em hexadecimal minúsculo')

export const AssetRefSchema = z.object({
  /** Hash do conteúdo binário. Obrigatório para ativos empacotados em assets/<sha256>. */
  sha256: Sha256Schema.optional(),
  mime: z.string().min(1).max(256),
  name: z.string().max(1024).optional(),
  width: FiniteSchema.optional(),
  height: FiniteSchema.optional(),
  durationMs: z.number().min(0).optional(),
  bytes: z.number().int().min(0).optional(),
  /** URL externa ou data: quando o ativo não está empacotado. */
  src: z.string().optional(),
  license: z.object({
    /** Identificador SPDX ou "proprietary" / "unknown". */
    id: z.string().min(1).max(128),
    attribution: z.string().max(4096).optional(),
    url: z.string().max(4096).optional(),
  }).strict().optional(),
  origin: z.object({
    kind: z.enum(['upload', 'url', 'generated', 'plugin', 'import', 'stock']),
    url: z.string().max(4096).optional(),
    provider: z.string().max(256).optional(),
  }).strict().optional(),
  createdAt: IsoDateTimeSchema.optional(),
  /** Escopo de biblioteca: o ativo pertence a este documento ou à equipe. */
  scope: z.enum(['document', 'team']).optional(),
  /** Visível na biblioteca de mídia. */
  libraryVisible: z.boolean().optional(),
  extensions: ExtensionsSchema.optional(),
}).strict()
export type AssetRef = z.infer<typeof AssetRefSchema>

export const ColorTokenSchema = z.object({ id: IdSchema, name: z.string(), value: ColorSchema }).strict()
export const TextStyleTokenSchema = z.object({ id: IdSchema, name: z.string(), style: TextStyleSchema }).strict()
export const EffectTokenSchema = z.object({
  id: IdSchema,
  name: z.string(),
  effect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('shadow'), color: ColorSchema, x: FiniteSchema, y: FiniteSchema, blur: z.number().min(0), spread: FiniteSchema.optional() }).strict(),
    z.object({ type: z.literal('blur'), radius: z.number().min(0) }).strict(),
  ]),
}).strict()

export const StylesSchema = z.object({
  colors: z.array(ColorTokenSchema),
  textStyles: z.array(TextStyleTokenSchema),
  effects: z.array(EffectTokenSchema),
  /** Kit de marca vinculado (os recursos do kit vivem no servidor/biblioteca). */
  brandKitId: IdSchema.optional(),
}).strict()
export type Styles = z.infer<typeof StylesSchema>

export const PageSchema = z.object({
  id: IdSchema,
  name: z.string(),
  width: FiniteSchema,
  height: FiniteSchema,
  background: PaintSchema,
  hidden: z.boolean().optional(),
  /** Notas do apresentador. */
  notes: z.string().optional(),
  children: z.array(NodeSchema),
  extensions: ExtensionsSchema.optional(),
}).strict()
export type Page = z.infer<typeof PageSchema>

export const MetaSchema = z.object({
  title: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** Tag BCP 47 (ex.: pt-BR). */
  locale: z.string().min(2).max(35),
  brandKitId: IdSchema.optional(),
  tags: z.array(z.string().max(256)),
}).strict()
export type Meta = z.infer<typeof MetaSchema>

const FuseFileObjectSchema = z.object({
  format: z.literal(FORMAT_ID),
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: IdSchema,
  kind: DocumentKindSchema,
  meta: MetaSchema,
  pages: z.array(PageSchema),
  doc: DocBodySchema.optional(),
  sheets: z.array(SheetSchema).optional(),
  timeline: TimelineSchema.optional(),
  site: SiteMetaSchema.optional(),
  assets: z.record(IdSchema, AssetRefSchema),
  styles: StylesSchema,
  extensions: ExtensionsSchema.optional(),
}).strict()

/** Percorre todos os nós (pré-ordem), incluindo filhos de Frame/Group. */
export function* walkNodes(nodes: readonly FuseNode[]): Generator<FuseNode> {
  for (const node of nodes) {
    yield node
    if (node.type === 'frame' || node.type === 'group') yield* walkNodes(node.children)
  }
}

export const FuseFileSchema = FuseFileObjectSchema.superRefine((file, ctx) => {
  const pageIds = new Set<string>()
  file.pages.forEach((page, index) => {
    if (pageIds.has(page.id)) ctx.addIssue({ code: 'custom', message: `ID de página duplicado: ${page.id}`, path: ['pages', index, 'id'] })
    pageIds.add(page.id)
  })
  const nodeIds = new Set<string>()
  file.pages.forEach((page, pageIndex) => {
    for (const node of walkNodes(page.children)) {
      if (nodeIds.has(node.id)) ctx.addIssue({ code: 'custom', message: `ID de nó duplicado: ${node.id}`, path: ['pages', pageIndex, 'children'] })
      nodeIds.add(node.id)
    }
  })
  const checkPageRef = (pageId: string, path: (string | number)[]) => {
    if (!pageIds.has(pageId)) ctx.addIssue({ code: 'custom', message: `Referência a página inexistente: ${pageId}`, path })
  }
  file.doc?.sections.forEach((section, index) => checkPageRef(section.pageId, ['doc', 'sections', index, 'pageId']))
  file.sheets?.forEach((sheet, index) => checkPageRef(sheet.pageId, ['sheets', index, 'pageId']))
  file.timeline?.clips.forEach((clip, index) => checkPageRef(clip.pageId, ['timeline', 'clips', index, 'pageId']))
  file.site?.navigation.forEach((item, index) => checkPageRef(item.pageId, ['site', 'navigation', index, 'pageId']))
})
export type FuseFile = z.infer<typeof FuseFileObjectSchema>

/** Valida um objeto já migrado. Lança ZodError em caso de erro. */
export function parseFuseFile(input: unknown): FuseFile {
  return FuseFileSchema.parse(input)
}

export type ValidationIssue = { path: string; message: string }
export type ValidationResult = { ok: true; file: FuseFile } | { ok: false; issues: ValidationIssue[] }

/** Valida sem lançar; devolve problemas com caminho legível ("pages.0.children.3.fill"). */
export function validateFuseFile(input: unknown): ValidationResult {
  const result = FuseFileSchema.safeParse(input)
  if (result.success) return { ok: true, file: result.data }
  return { ok: false, issues: result.error.issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message })) }
}
