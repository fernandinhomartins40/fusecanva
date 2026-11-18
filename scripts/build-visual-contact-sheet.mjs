import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexFile = path.join(root, 'VISUAL-REFERENCE-INDEX.csv')
const outputDirectory = path.join(root, 'visual-references')
const outputFile = path.join(outputDirectory, 'index.html')

function parseCsvLine(line) {
  const fields = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted && char === '"' && line[index + 1] === '"') {
      field += '"'
      index += 1
    } else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else field += char
  }
  fields.push(field)
  return fields
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

if (!fs.existsSync(indexFile)) throw new Error('VISUAL-REFERENCE-INDEX.csv is missing; run scripts/build-visual-reference-index.mjs first.')
const [headerLine, ...lines] = fs.readFileSync(indexFile, 'utf8').trimEnd().split(/\r?\n/)
const headers = parseCsvLine(headerLine)
const records = lines.map(line => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])))
fs.mkdirSync(outputDirectory, { recursive: true })

let copied = 0
let verified = 0
const cards = []
for (const record of records) {
  const extension = record.mediaType === 'image/jpeg' ? '.jpg' : record.mediaType === 'image/webp' ? '.webp' : '.png'
  const fileName = `${record.sha256}${extension}`
  const destination = path.join(outputDirectory, fileName)
  if (record.kind === 'embedded-image') {
    const evidencePath = path.join(root, 'analysis', ...record.source.split('/'))
    const sourceJson = fs.readFileSync(evidencePath, 'utf8')
    const match = sourceJson.match(/"artifact"\s*:\s*\{(?=[\s\S]{0,1400}?"data_base64")([\s\S]{0,1400}?)"data_base64"\s*:\s*"([A-Za-z0-9+/=]+)"/)
    if (!match) throw new Error(`Embedded image not found in ${record.source}`)
    const bytes = Buffer.from(match[2], 'base64')
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex')
    if (actualHash !== record.sha256) throw new Error(`Hash mismatch for ${record.source}: ${actualHash}`)
    if (fs.existsSync(destination)) {
      const existingHash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')
      if (existingHash !== actualHash) throw new Error(`Existing extracted file has wrong hash: ${destination}`)
      verified += 1
    } else {
      fs.writeFileSync(destination, bytes, { flag: 'wx' })
      copied += 1
    }
  } else {
    const sourcePath = path.join(root, 'analysis', ...record.source.split('/'))
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')
    if (actualHash !== record.sha256) throw new Error(`Hash mismatch for ${record.source}: ${actualHash}`)
    record.sourceUrl = `../analysis/${record.source.split('/').map(encodeURIComponent).join('/')}`
    verified += 1
  }
  record.previewUrl = record.sourceUrl ?? `./${fileName}`
  cards.push(`<article class="card" data-kind="${escapeHtml(record.kind)}" data-source="${escapeHtml(record.source.toLowerCase())}" data-width="${escapeHtml(record.width)}" data-height="${escapeHtml(record.height)}"><a class="image-link" href="${escapeHtml(record.previewUrl)}" target="_blank" rel="noreferrer"><img loading="lazy" src="${escapeHtml(record.previewUrl)}" alt="Referência ${escapeHtml(record.source)}"></a><div class="meta"><div class="source">${escapeHtml(record.source)}</div><div class="details">${escapeHtml(record.kind)} · ${escapeHtml(record.width || '?')} × ${escapeHtml(record.height || '?')} · ${escapeHtml(record.mediaType)} · ${escapeHtml(record.bytes)} bytes</div><code>${escapeHtml(record.sha256)}</code></div></article>`)
}

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Referências visuais — Fuse Canva</title>
<style>
:root{color-scheme:dark;font:14px/1.45 system-ui,sans-serif;background:#111116;color:#f3f1f7}*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;z-index:2;padding:18px 22px;background:#1d1b24f2;backdrop-filter:blur(12px);border-bottom:1px solid #393641}.top h1{margin:0 0 4px;font-size:20px}.top p{margin:0 0 13px;color:#bab5c2}.filters{display:flex;gap:8px;flex-wrap:wrap}.filters input,.filters select{min-height:38px;padding:0 11px;border:1px solid #494552;border-radius:8px;color:#f7f5fb;background:#292731}.filters input{flex:1;min-width:220px}.count{align-self:center;color:#c7bddc;margin-left:auto}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:16px}.card{min-width:0;overflow:hidden;border:1px solid #393641;border-radius:9px;background:#201f26}.image-link{height:170px;display:grid;place-items:center;background:#141319}.image-link img{display:block;max-width:100%;max-height:100%;object-fit:contain}.meta{padding:10px}.source{overflow-wrap:anywhere;color:#f0edf5;font-size:11px;font-weight:600}.details{margin:5px 0;color:#aaa5b2;font-size:10px}.meta code{display:block;overflow:hidden;text-overflow:ellipsis;color:#9186b0;font-size:9px;white-space:nowrap}.empty{padding:60px;text-align:center;color:#c7c0d0}@media(max-width:600px){.top{padding:13px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:8px}.image-link{height:125px}.meta{padding:7px}.source{font-size:9px}.details{font-size:8px}.count{width:100%;margin-left:0}}
</style></head><body><header class="top"><h1>Referências visuais auditadas</h1><p>Inventário de imagens do corpus; capturas de interface são evidência, não uma biblioteca de assets reutilizáveis. Abra uma imagem para ver em tamanho original.</p><div class="filters"><input id="query" type="search" placeholder="Filtrar pelo nome ou caminho de origem"><select id="kind"><option value="">Todos os tipos</option><option value="raster-file">Arquivos raster (515)</option><option value="embedded-image">Imagens embutidas (190)</option></select><span class="count" id="count"></span></div></header><main class="grid" id="grid">${cards.join('')}</main><script>const cards=[...document.querySelectorAll('.card')],query=document.querySelector('#query'),kind=document.querySelector('#kind'),count=document.querySelector('#count');function filter(){let visible=0;for(const card of cards){const match=card.dataset.source.includes(query.value.trim().toLowerCase())&&(!kind.value||card.dataset.kind===kind.value);card.hidden=!match;if(match)visible++}count.textContent=visible+' de '+cards.length+' referências'}query.addEventListener('input',filter);kind.addEventListener('change',filter);filter()</script></body></html>`
fs.writeFileSync(outputFile, html, 'utf8')
console.log(`Built ${path.relative(root, outputFile)} with ${cards.length} references; extracted ${copied} embedded images, verified ${verified} existing images.`)
