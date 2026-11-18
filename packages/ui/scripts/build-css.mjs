// Gera dist/tokens.css a partir dos tokens compilados e monta dist/styles.css (tokens + componentes).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const { buildTokensCss } = await import(new URL('../dist/tokens/css.js', import.meta.url).href)

const tokens = buildTokensCss()
const components = await readFile(join(root, 'src/styles/components.css'), 'utf8')

await mkdir(dist, { recursive: true })
await writeFile(join(dist, 'tokens.css'), tokens, 'utf8')
await writeFile(join(dist, 'components.css'), components, 'utf8')
await writeFile(join(dist, 'styles.css'), `${tokens}\n${components}`, 'utf8')
console.log('css: dist/tokens.css, dist/components.css, dist/styles.css')
