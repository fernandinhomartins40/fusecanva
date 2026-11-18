// Geração do JSON Schema publicado (packages/format/schema/) a partir dos schemas Zod.
import { z } from 'zod'
import { FuseFileSchema, SCHEMA_VERSION } from './schema/file.js'

export const JSON_SCHEMA_ID = `urn:fuse-studio:format:fuse-file:v${SCHEMA_VERSION}`

/**
 * JSON Schema (draft 2020-12) do document.json. Regras entre campos (IDs únicos, referências a páginas)
 * não são expressáveis em JSON Schema e só são verificadas por validateFuseFile().
 */
export function buildJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(FuseFileSchema, { target: 'draft-2020-12', unrepresentable: 'any', cycles: 'ref', reused: 'inline' }) as Record<string, unknown>
  return {
    $schema: schema['$schema'],
    $id: JSON_SCHEMA_ID,
    title: `Fuse Studio document (.fuse) v${SCHEMA_VERSION}`,
    description: 'document.json de um pacote .fuse. Especificação: packages/format/README.md.',
    ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema')),
  }
}
