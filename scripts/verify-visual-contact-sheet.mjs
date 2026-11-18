import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const rows = fs.readFileSync(path.join(root, 'VISUAL-REFERENCE-INDEX.csv'), 'utf8').trimEnd().split(/\r?\n/).slice(1)
const imageRows = rows.map(line => {
  const [, source, kind, mediaType, sha256] = line.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)"/)
  return { source, kind, mediaType, sha256 }
})
let missing = 0
let badHashes = 0
const hashes = new Set()
for (const row of imageRows) {
  const extension = row.mediaType === 'image/jpeg' ? '.jpg' : row.mediaType === 'image/webp' ? '.webp' : '.png'
  const file = row.kind === 'embedded-image'
    ? path.join(root, 'visual-references', `${row.sha256}${extension}`)
    : path.join(root, 'analysis', ...row.source.split('/'))
  if (!fs.existsSync(file)) {
    missing += 1
    continue
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (hash !== row.sha256) badHashes += 1
  hashes.add(row.sha256)
}
const html = fs.readFileSync(path.join(root, 'visual-references', 'index.html'), 'utf8')
const cardCount = (html.match(/<article class="card"/g) ?? []).length
const extractedCount = fs.readdirSync(path.join(root, 'visual-references')).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).length
const result = { indexedEntries: imageRows.length, contactSheetCards: cardCount, uniqueHashes: hashes.size, extractedUniqueFiles: extractedCount, missingFiles: missing, hashMismatches: badHashes }
console.log(JSON.stringify(result, null, 2))
if (cardCount !== imageRows.length || missing || badHashes) process.exitCode = 1
