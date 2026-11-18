// Lint de fronteiras do monorepo (ADR-001, plano v2 §3 "Regra de ouro").
// Falha quando um arquivo importa:
//   1. outro pacote @fuse/* por caminho profundo (@fuse/x/src/..., @fuse/x/dist/...);
//   2. arquivos de outro pacote/app por caminho relativo (../../packages/x/...);
//   3. um app a partir de um pacote (packages/* nunca dependem de apps/*).
// Uso: node tooling/check-boundaries.mjs
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'artifacts', 'coverage', '.data'])
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

async function* walk(dir) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (SOURCE.test(entry.name)) yield full
  }
}

const workspaceOf = file => {
  const [scope, name] = path.relative(repoRoot, file).split(path.sep)
  return scope === 'apps' || scope === 'packages' ? `${scope}/${name}` : null
}

const violations = []
for (const scope of ['apps', 'packages']) {
  for await (const file of walk(path.join(repoRoot, scope))) {
    const owner = workspaceOf(file)
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(SPECIFIER)) {
      const spec = match[1]
      const line = text.slice(0, match.index).split('\n').length
      const where = `${path.relative(repoRoot, file).split(path.sep).join('/')}:${line}`
      const deep = /^@fuse\/[^/]+\/(?:src|dist|lib)(?:\/|$)/.test(spec)
      if (deep) violations.push(`${where} import profundo "${spec}" (use a API publica do pacote)`)
      if (spec.startsWith('.')) {
        const target = workspaceOf(path.resolve(path.dirname(file), spec))
        if (target && target !== owner) violations.push(`${where} import relativo cruza fronteira ${owner} -> ${target} ("${spec}")`)
      }
      if (owner?.startsWith('packages/') && /^@fuse\/(?:web|server|worker|cli|docs-site)(?:\/|$)/.test(spec)) {
        violations.push(`${where} pacote nao pode depender de app ("${spec}")`)
      }
    }
  }
}

if (violations.length) {
  console.error(`check-boundaries: ${violations.length} violacao(oes)\n` + violations.map(v => `  - ${v}`).join('\n'))
  process.exit(1)
}
console.log('check-boundaries: ok')
