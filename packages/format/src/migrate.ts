// Migrações puras entre versões do schema. A versão 0 é o formato legado (sem `format: 'fuse'`).
import { FORMAT_ID, FuseFileSchema, SCHEMA_VERSION, type FuseFile } from './schema/file.js'
import { fromLegacy, type FromLegacyOptions } from './legacy/from-legacy.js'
import { isLegacyDocument, type LegacyDocument } from './legacy/types.js'

export type FuseFormatErrorCode = 'unrecognized' | 'unsupported-version' | 'invalid' | 'package'

export class FuseFormatError extends Error {
  readonly code: FuseFormatErrorCode
  constructor(code: FuseFormatErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FuseFormatError'
    this.code = code
  }
}

/** Uma migração recebe o JSON na versão n e devolve o JSON na versão n+1. Deve ser pura. */
export type Migration = (input: unknown, options: MigrateOptions) => unknown

export type MigrateOptions = FromLegacyOptions

/** Registro de migrações: chave = versão de origem. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  0: (input: unknown, options: MigrateOptions) => fromLegacy(input as LegacyDocument, options),
})

/** Descobre a versão do schema de um JSON arbitrário (0 = legado). */
export function detectSchemaVersion(input: unknown): number {
  if (isLegacyDocument(input)) return 0
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    if (record['format'] === FORMAT_ID && typeof record['schemaVersion'] === 'number' && Number.isInteger(record['schemaVersion']) && record['schemaVersion'] >= 1) {
      return record['schemaVersion']
    }
  }
  throw new FuseFormatError('unrecognized', 'Conteúdo não reconhecido como documento .fuse nem como documento legado.')
}

/**
 * Leva qualquer versão conhecida até a atual e valida. Lança FuseFormatError
 * ("unsupported-version" para arquivos de versões futuras, "invalid" para falhas de schema).
 */
export function migrate(input: unknown, options: MigrateOptions = {}): FuseFile {
  let version = detectSchemaVersion(input)
  if (version > SCHEMA_VERSION) {
    throw new FuseFormatError('unsupported-version', `Arquivo na versão ${version}; esta biblioteca lê até a versão ${SCHEMA_VERSION}. Atualize o Fuse Studio.`)
  }
  let current = input
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new FuseFormatError('unsupported-version', `Sem migração a partir da versão ${version}.`)
    current = step(current, options)
    version += 1
  }
  const result = FuseFileSchema.safeParse(current)
  if (!result.success) {
    const detail = result.error.issues.slice(0, 5).map(issue => `${issue.path.map(String).join('.') || '(raiz)'}: ${issue.message}`).join('; ')
    throw new FuseFormatError('invalid', `Documento inválido após migração: ${detail}`, { cause: result.error })
  }
  return result.data
}
