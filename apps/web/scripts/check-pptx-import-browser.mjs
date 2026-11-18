import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { deflateSync } from 'node:zlib'
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

function createPng() {
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
  const chunk = (name, data) => { const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, checksum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))])
}

async function createFixture() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="5143500"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>')
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>')
  const makeSlide = (name, color, x, picture = false) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld name="${name}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="${name} shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr></p:sp>${picture ? '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Embedded portrait" descr="A small red sample image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="900000"><a:off x="2743200" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' : ''}</p:spTree></p:cSld></p:sld>`
  zip.file('ppt/slides/slide1.xml', makeSlide('Opening', '0099AA', 914400, true))
  zip.file('ppt/slides/slide2.xml', makeSlide('Closing', 'AA5500', 2743200))
  zip.file('ppt/media/photo.png', createPng())
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/></Relationships>')
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

const chromePath = await findChrome()
const vitePort = await freePort()
const cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-pptx-import-'))
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
  assert.ok(page, 'local home page exists')
  pageSocket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++nextId; const response = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return response }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }

  await waitFor(async () => evaluate("Boolean(document.querySelector('.home-import-actions button'))"), 'home import controls')
  const fixture = (await createFixture()).toString('base64')
  await evaluate("[...document.querySelectorAll('.home-category-row button')].find(button=>button.textContent.includes('Importar')).click()")
  await evaluate(`(()=>{const raw=atob(${JSON.stringify(fixture)});const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));const file=new File([bytes],'presentation-fixture.pptx',{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector("input[type=file][accept*='.csv,.xlsx,.pptx']");input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const imported = await waitFor(async () => evaluate("(async()=>{const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return await new Promise((resolve,reject)=>{const request=database.transaction('documents','readonly').objectStore('documents').getAll();request.onsuccess=()=>{const item=request.result.find(document=>document.name==='presentation-fixture');resolve(item?.type==='presentation'&&item.pages.length===2?item:null)};request.onerror=()=>reject(request.error)})})()"), 'imported slides saved as a presentation')
  assert.deepEqual(imported.pages.map(page => page.name), ['Opening', 'Closing'])
  assert.deepEqual(imported.pages.map(page => page.elements[0].fill), ['#0099aa', '#aa5500'])
  const image = imported.pages[0].elements.find(element => element.type === 'image')
  assert.ok(image, 'embedded raster persisted as an editable image element')
  assert.equal(image.src, `data:image/png;base64,${createPng().toString('base64')}`)
  assert.deepEqual([image.sourceWidth, image.sourceHeight, image.x, image.y, image.width, image.height, image.rotation, image.altText], [1, 1, 288, 96, 192, 96, 15, 'A small red sample image'])
  await waitFor(async () => evaluate("Boolean(document.querySelector('.studio-app'))"), 'imported presentation editor')
  console.log('PPTX browser check passed: home import, local persistence, two-slide order, editable shapes, and embedded PNG image geometry/alt text.')
} finally {
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999998, method: 'Browser.close' })) } catch {} }
  pageSocket?.close()
  browserSocket?.close()
  await stop(vite)
  await stop(chrome)
  await rm(profileDir, { recursive: true, force: true })
}
