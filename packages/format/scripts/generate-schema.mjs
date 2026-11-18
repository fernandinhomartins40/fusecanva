// Gera packages/format/schema/fuse-file.v<N>.schema.json a partir do build (dist/). Uso: pnpm --filter @fuse/format schema:generate
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildJsonSchema, SCHEMA_VERSION } from '../dist/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'schema', `fuse-file.v${SCHEMA_VERSION}.schema.json`)
mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(buildJsonSchema(), null, 2) + '\n', 'utf8')
console.log(`JSON Schema gravado em ${path.relative(root, target)}`)
