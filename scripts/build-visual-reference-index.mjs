import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corpus = path.join(root, 'analysis')
const output = path.join(root, 'VISUAL-REFERENCE-INDEX.csv')
const args = process.argv.slice(2)
const extractIndex = args.indexOf('--extract')
const extractSource = extractIndex >= 0 ? args[extractIndex + 1] : null
const extractDirectory = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'visual-references')

if (extractIndex >= 0 && !extractSource) throw new Error('Usage: node scripts/build-visual-reference-index.mjs --extract <analysis-relative-source> [--out <directory>]')

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(fullPath)
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name) || /\.evidence\.json$/i.test(entry.name) || /screenshot.*\.json$/i.test(entry.name)) yield fullPath
  }
}

function csv(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

const rows = []
for (const file of walk(corpus)) {
  const relative = path.relative(corpus, file).split(path.sep).join('/')
  if (/\.(png|jpe?g|webp)$/i.test(file)) {
    const bytes = fs.readFileSync(file)
    rows.push({
      source: relative,
      kind: 'raster-file',
      mediaType: `image/${path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg')}`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      width: '',
      height: '',
      bytes: bytes.length,
    })
    continue
  }
  if (!/\.json$/i.test(file)) continue

  const raw = fs.readFileSync(file, 'utf8')
  const artifactMatch = raw.match(/"artifact"\s*:\s*\{(?=[\s\S]{0,1400}?"data_base64")([\s\S]{0,1400}?)"data_base64"\s*:\s*"([A-Za-z0-9+/=]+)"/)
  if (!artifactMatch) continue
  const artifactHead = artifactMatch[1]
  const base64 = artifactMatch[2]
  const mediaType = artifactHead.match(/"media_type"\s*:\s*"([^"]+)"/)?.[1]
  if (!mediaType?.startsWith('image/')) continue
  const hash = artifactHead.match(/"sha256"\s*:\s*"([a-f0-9]{64})"/)?.[1] ?? crypto.createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')
  const width = raw.match(/"viewport"\s*:\s*\{[^}]{0,300}?"width"\s*:\s*(\d+)/)?.[1] ?? ''
  const height = raw.match(/"viewport"\s*:\s*\{[^}]{0,300}?"height"\s*:\s*(\d+)/)?.[1] ?? ''
  const bytes = artifactHead.match(/"bytes"\s*:\s*(\d+)/)?.[1] ?? Buffer.byteLength(base64, 'base64')
  rows.push({
    source: relative,
    kind: 'embedded-image',
    mediaType,
    sha256: hash,
    width,
    height,
    bytes,
  })
}

if (extractSource) {
  const relative = path.posix.normalize(extractSource.replaceAll('\\', '/'))
  if (relative.startsWith('../') || path.posix.isAbsolute(relative)) throw new Error('Reference must be a relative path inside analysis/')
  const source = path.join(corpus, ...relative.split('/'))
  const indexEntry = rows.find(row => row.source === relative)
  if (!indexEntry) throw new Error(`Image reference not found in analysis: ${relative}`)

  let bytes
  if (indexEntry.kind === 'raster-file') bytes = fs.readFileSync(source)
  else {
    const raw = fs.readFileSync(source, 'utf8')
    const match = raw.match(/"artifact"\s*:\s*\{(?=[\s\S]{0,1400}?"data_base64")([\s\S]{0,1400}?)"data_base64"\s*:\s*"([A-Za-z0-9+/=]+)"/)
    if (!match) throw new Error(`Embedded image artifact missing: ${relative}`)
    bytes = Buffer.from(match[2], 'base64')
  }
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== indexEntry.sha256) throw new Error(`SHA-256 mismatch for ${relative}: expected ${indexEntry.sha256}, got ${actualHash}`)
  fs.mkdirSync(extractDirectory, { recursive: true })
  const extension = indexEntry.mediaType === 'image/jpeg' ? '.jpg' : indexEntry.mediaType === 'image/webp' ? '.webp' : '.png'
  const destination = path.join(extractDirectory, `${actualHash}${extension}`)
  if (fs.existsSync(destination)) {
    const existingHash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')
    if (existingHash !== actualHash) throw new Error(`Existing destination has unexpected content: ${destination}`)
    console.log(`Verified existing extraction ${relative} -> ${path.relative(root, destination)} (${actualHash}, ${bytes.length} bytes).`)
  } else {
    fs.writeFileSync(destination, bytes, { flag: 'wx' })
    console.log(`Extracted ${relative} -> ${path.relative(root, destination)} (${actualHash}, ${bytes.length} bytes).`)
  }
  process.exit(0)
}

rows.sort((a, b) => a.source.localeCompare(b.source))
const columns = ['source', 'kind', 'mediaType', 'sha256', 'width', 'height', 'bytes']
const content = [columns.join(','), ...rows.map(row => columns.map(key => csv(row[key])).join(','))].join('\n') + '\n'
fs.writeFileSync(output, content, 'utf8')
console.log(`Indexed ${rows.length} visual references (${rows.filter(row => row.kind === 'embedded-image').length} embedded, ${rows.filter(row => row.kind === 'raster-file').length} raster files).`)
console.log(`Wrote ${path.relative(root, output)}; source corpus left unchanged.`)
