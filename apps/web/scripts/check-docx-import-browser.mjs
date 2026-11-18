import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
async function findChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge não encontrado; defina CHROME_PATH.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 25000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]) }

const chromePath = await findChrome()
const vitePort = await freePort()
const cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-docx-import-'))
let vite
let chrome
let browserSocket
let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const page = targets.find(target => target.type === 'page' && target.url.includes(`127.0.0.1:${vitePort}`))
  assert.ok(page, 'local editor page exists')
  pageSocket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++nextId; const response = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return response }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }

  await waitFor(async () => evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Documento'))"), 'local document creation')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Documento')).click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-tool-rail button[aria-label^=Importar]'))"), 'Docs editor import control')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7s8AAAAASUVORK5CYII=', 'base64')
  zip.file('word/media/browser-fixture.png', pngBytes)
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/browser-fixture.png"/></Relationships>')
  const imageDrawing = '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="190500" cy="95250"/><wp:docPr id="1" name="Browser fixture" descr="Browser fixture image"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  const tableImageDrawing = imageDrawing.replace('Browser fixture image', 'Table cell image').replace(/^<w:p>/, '').replace(/<\/w:p>$/, '')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX Heading</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold phrase</w:t></w:r></w:p>${imageDrawing}<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell C</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Cell D</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r>${tableImageDrawing}</w:p></w:tc><w:tc><w:p><w:r><w:t>Cell E</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>Cell F</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell G</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`)
  const archive = Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })).toString('base64')
  await evaluate("document.querySelector('.doc-tool-rail button[aria-label^=Importar]').click()")
  await evaluate(`(()=>{const raw=atob(${JSON.stringify(archive)});const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));const file=new File([bytes],'import-fixture.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector("input[type=file][accept*='.docx']");input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const imported = await waitFor(async () => evaluate("(()=>{const blocks=[...document.querySelectorAll('.doc-outline-list button')].map(button=>button.textContent.trim());const table=document.querySelector('.doc-block-table');const mergedCell=[...table?.querySelectorAll('td')??[]].find(cell=>cell.colSpan===2);return blocks.some(text=>text==='DOCX Heading')&&table?{blocks,rows:table.querySelectorAll('tr').length,cells:[...table.querySelectorAll('textarea')].map(cell=>cell.value),colSpan:mergedCell?.querySelector('textarea')?.value??null,rowSpan:[...table?.querySelectorAll('td')??[]].find(cell=>cell.rowSpan===2)?.querySelector('textarea')?.value??null,bold:document.querySelector('.doc-editable-text strong, .doc-editable-text span[style*=font-weight]')?.textContent??null}:null})()"), 'imported headings, rich text and table')
  assert.ok(imported.blocks.includes('DOCX Heading'), `heading imported: ${JSON.stringify(imported)}`)
  assert.equal(imported.rows, 3, 'DOCX table rows imported')
  assert.deepEqual(imported.cells, ['Cell A', 'Cell C', 'Cell D', 'Cell B', 'Cell E', 'Cell F', 'Cell G'], 'DOCX table cell text imported in order with covered merge cells omitted from the editor')
  assert.equal(imported.colSpan, 'Cell A', 'gridSpan renders as a merged editable cell')
  assert.equal(imported.rowSpan, 'Cell D', 'vMerge renders as a vertically merged editable cell')
  assert.equal(imported.bold, 'Bold phrase', 'bold inline run imported')
  const tableImage = await waitFor(async () => evaluate("(()=>{const image=document.querySelector('.doc-table-cell-images img');return image&&image.complete&&image.naturalWidth>0?{alt:image.alt,width:image.getAttribute('width'),height:image.getAttribute('height')}:null})()"), 'embedded table image rendered in its editable Docs cell')
  assert.deepEqual(tableImage, { alt: 'Table cell image', width: '20', height: '10' }, 'table image renders with alt text and source dimensions')
  const importedImage = await waitFor(async () => evaluate("(()=>{const image=[...document.querySelectorAll('.doc-image-select img')].find(item=>item.alt==='Browser fixture image');return image&&image.complete&&image.naturalWidth>0?{alt:image.alt,width:image.getAttribute('width'),height:image.getAttribute('height'),src:image.getAttribute('src')}:null})()"), 'embedded image rendered in Docs editor')
  assert.deepEqual({ alt: importedImage.alt, width: importedImage.width, height: importedImage.height }, { alt: 'Browser fixture image', width: '20', height: '10' }, 'DOCX image alt text and displayed dimensions imported')
  assert.equal(importedImage.src, `data:image/png;base64,${pngBytes.toString('base64')}`, 'DOCX image payload rendered from its embedded PNG')
  const storedTitle = await waitFor(async () => evaluate("(async()=>{const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return await new Promise((resolve,reject)=>{const request=database.transaction('documents','readonly').objectStore('documents').getAll();request.onsuccess=()=>resolve(request.result[0]?.name==='import-fixture'?request.result[0].name:null);request.onerror=()=>reject(request.error)})})()"), 'imported title saved in IndexedDB')
  assert.equal(storedTitle, 'import-fixture')
  await evaluate("document.querySelector('.doc-new-page').click()")
  const pageCount = await waitFor(async () => evaluate("(async()=>{const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return await new Promise((resolve,reject)=>{const request=database.transaction('documents','readonly').objectStore('documents').getAll();request.onsuccess=()=>{const count=request.result.find(document=>document.name==='import-fixture')?.pages.length??0;resolve(count===2?count:null)};request.onerror=()=>reject(request.error)})})()"), 'second Docs page persisted')
  assert.equal(pageCount, 2, 'Docs page insertion persisted before DOCX export')
  await evaluate("(()=>{const select=document.querySelector('select.export-format');select.value='docx';select.dispatchEvent(new Event('change',{bubbles:true}));const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__docxDownload={href:this.href,name:this.download};return click.call(this)}})()")
  await evaluate("document.querySelector('.export-button').click()")
  const exportedBase64 = await waitFor(async () => evaluate("(async()=>{if(!window.__docxDownload?.name.endsWith('.docx'))return null;const bytes=await(await fetch(window.__docxDownload.href)).arrayBuffer();return btoa(String.fromCharCode(...new Uint8Array(bytes)))})()"), 'DOCX export download')
  const exported = await JSZip.loadAsync(Buffer.from(exportedBase64, 'base64'))
  const exportedXml = await exported.file('word/document.xml')?.async('string')
  assert.ok(exportedXml?.includes('DOCX Heading'), 'DOCX export contains imported heading')
  assert.ok(exportedXml?.includes('Bold phrase'), 'DOCX export contains imported rich text')
  assert.ok(exportedXml?.includes('Cell A') && exportedXml.includes('Cell B'), 'DOCX export contains imported table cells')
  const exportedTable = exportedXml?.match(/<w:tbl>([\s\S]*?)<\/w:tbl>/)?.[1]
  assert.match(exportedTable ?? '', /<w:gridSpan w:val="2"\/>/, 'DOCX export retains the imported horizontal merge')
  assert.match(exportedTable ?? '', /<w:vMerge w:val="restart"\/>/, 'DOCX export retains the vertical merge origin')
  assert.match(exportedTable ?? '', /<w:vMerge\/>/, 'DOCX export retains the vertical merge continuation')
  const exportedTableRows = [...(exportedTable ?? '').matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map(row => (row[1].match(/<w:tc>/g) ?? []).length)
  assert.deepEqual(exportedTableRows, [2, 3, 3], 'DOCX export serializes horizontal and vertical merged rows without duplicate covered cells')
  assert.ok(exportedXml?.includes('Browser fixture image') && exportedXml.includes('<a:blip r:embed='), 'DOCX export contains the image DrawingML and alt text')
  const exportedRels = await exported.file('word/_rels/document.xml.rels')?.async('string')
  const imageRelationship = exportedRels?.match(/<Relationship\b(?=[^>]*\bType="[^"]+\/image")(?=[^>]*\bTarget="([^"]+)")(?=[^>]*\bId="([^"]+)")[^>]*\/>/)
  assert.ok(imageRelationship, 'DOCX export contains an internal image relationship')
  assert.ok(exportedXml?.includes(`r:embed="${imageRelationship[2]}"`), 'DOCX drawing references the exported image relationship')
  const exportedPng = await exported.file(`word/${imageRelationship[1]}`)?.async('nodebuffer')
  assert.deepEqual(exportedPng, pngBytes, 'DOCX export preserves the embedded PNG bytes')
  assert.equal((exportedXml?.match(/<w:br w:type="page"\/>/g) ?? []).length, 1, 'DOCX export preserves the editor page boundary')
  console.log('DOCX browser check passed: import, two-page editor state, editable export, page break, heading, bold text, table content and embedded table image.')
} finally {
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999998, method: 'Browser.close' })) } catch {} }
  pageSocket?.close()
  browserSocket?.close()
  await stop(vite)
  await stop(chrome)
  await rm(profileDir, { recursive: true, force: true })
}
