import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/index.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(webRoot, '..', '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the historical-copy browser test')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; let lastError; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch (error) { lastError = error } await delay(100) } throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ''}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const apiPort = await freePort()
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === apiPort || cdpPort === vitePort) cdpPort = await freePort()
const origin = `http://127.0.0.1:${vitePort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-history-copy-profile-'))
const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-history-copy-downloads-'))
const referencePath = path.join(workspaceRoot, 'analysis', 'export-artifacts', 'history-copy-baseline.png')
const referenceBytes = await readFile(referencePath)
const referenceDataUrl = `data:image/png;base64,${referenceBytes.toString('base64')}`
let vite; let chrome; let apiServer; let browserSocket; let pageSocket

async function apiRequest(apiOrigin, pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiOrigin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json()
  return { status: response.status, payload, setCookie: response.headers.get('set-cookie') }
}

try {
  apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [origin] })
  await new Promise((resolve, reject) => apiServer.listen(apiPort, '127.0.0.1', resolve).once('error', reject))
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const password = 'Fuse-History-Copy-Test-42'
  const email = 'history-copy@example.test'
  const registered = await apiRequest(apiOrigin, '/api/auth/register', { method: 'POST', body: { name: 'History Copy Owner', email, password } })
  assert.equal(registered.status, 201)
  const login = await apiRequest(apiOrigin, '/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  const cookie = login.setCookie?.split(';')[0]
  assert.ok(cookie?.startsWith('fuse_session='))

  const initialName = 'REA - Laboratório Dream Lab Ampliado'
  const initialData = {
    id: 'history-copy-initial-fixture', name: initialName, type: 'design', width: 2400, height: 2400, updatedAt: new Date().toISOString(),
    pages: [{ id: 'history-copy-page-1', name: 'Página 1', background: '#ffffff', elements: [{ id: 'history-copy-image', type: 'image', name: 'Blue cube', src: referenceDataUrl, x: 0, y: 0, width: 2400, height: 2400, rotation: 0 }] }],
  }
  const created = await apiRequest(apiOrigin, '/api/documents', { method: 'POST', cookie, body: { name: initialName, data: initialData } })
  assert.equal(created.status, 201)
  const sourceId = created.payload.id
  const currentData = structuredClone(initialData)
  currentData.name = 'Current source after crop'
  currentData.pages[0].elements[0].crop = { x: 120, y: 120, width: 2160, height: 2160 }
  currentData.updatedAt = new Date().toISOString()
  const currentSave = await apiRequest(apiOrigin, `/api/documents/${encodeURIComponent(sourceId)}`, { method: 'PUT', cookie, body: { revision: 1, name: currentData.name, data: currentData } })
  assert.equal(currentSave.status, 200)
  assert.equal(currentSave.payload.revision, 2)
  const sourceBeforeCopy = (await apiRequest(apiOrigin, `/api/documents/${encodeURIComponent(sourceId)}`, { cookie })).payload

  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, env: { ...process.env, STUDIO_API_PORT: String(apiPort) }, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), 'blank page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })

  let browserId = 0; const browserPending = new Map(); const downloadEvents = []
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && browserPending.has(message.id)) { browserPending.get(message.id)(message); browserPending.delete(message.id) }
    if (message.method === 'Browser.downloadWillBegin' || message.method === 'Browser.downloadProgress') downloadEvents.push({ method: message.method, ...message.params })
  })
  async function sendBrowser(method, params = {}) { const id = ++browserId; const response = new Promise(resolve => browserPending.set(id, resolve)); browserSocket.send(JSON.stringify({ id, method, params })); return response }
  let pageId = 0; const pagePending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pagePending.has(message.id)) { pagePending.get(message.id)(message); pagePending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++pageId; const response = new Promise(resolve => pagePending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); const result = await response; if (result.error) throw new Error(`${method}: ${result.error.message}`); return result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }

  await sendBrowser('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true })
  const cookieResult = await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${origin}/`, path: '/', sameSite: 'Lax' })
  assert.equal(cookieResult.result.success, true)
  await send('Page.navigate', { url: `${origin}/design/${encodeURIComponent(sourceId)}/edit?storage=cloud` })
  await waitFor(() => evaluate(`!!document.querySelector('.studio-app') && document.querySelector('[aria-label="Nome do design"]')?.value === ${JSON.stringify(currentData.name)}`), 'current source opens in cloud editor')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'current source is saved before version copy')
  await evaluate("document.querySelector('[aria-label=\"Histórico de versões\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.history-version').length === 2"), 'initial and current revisions are visible')
  assert.equal(await evaluate("document.querySelector('.history-version:first-child').innerText.includes('Versão 2')"), true)
  assert.equal(await evaluate("document.querySelector('.history-version:last-child').innerText.includes('Versão 1')"), true)
  await evaluate("(()=>{const initial=[...document.querySelectorAll('.history-version')].find(item=>item.innerText.includes('Versão 1'));initial.querySelector('.history-version-actions button').click()})()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.history-open-copy'))"), 'copy of the initial historical revision is created')
  await evaluate("document.querySelector('.history-open-copy').click()")
  await waitFor(() => evaluate(`!!document.querySelector('.studio-app') && document.querySelector('[aria-label="Nome do design"]')?.value === ${JSON.stringify(`Cópia de ${initialName}`)}`), 'historical copy opens with a distinct title')
  const copies = (await apiRequest(apiOrigin, '/api/documents', { cookie })).payload.documents
  const copied = copies.find(document => document.id !== sourceId && document.name === `Cópia de ${initialName}`)
  assert.ok(copied, 'copy has a distinct cloud identity and observed title prefix')
  assert.notEqual(copied.id, sourceId)
  assert.equal(copied.revision, 1)
  assert.equal(copied.data.id, copied.id)
  assert.deepEqual(copied.data.pages, initialData.pages, 'copy reproduces the initial page content and image geometry without the source crop')
  assert.deepEqual((await apiRequest(apiOrigin, `/api/documents/${encodeURIComponent(sourceId)}`, { cookie })).payload, sourceBeforeCopy, 'copying the initial revision leaves the current source exactly unchanged')

  await evaluate(`(()=>{const input=document.querySelector('[aria-label="Nome do design"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Dream Lab Copy Renamed');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Nome do design\"]')?.value === 'Dream Lab Copy Renamed' && document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'renamed copy is saved in cloud')
  const renamed = await waitFor(async () => { const current = (await apiRequest(apiOrigin, `/api/documents/${encodeURIComponent(copied.id)}`, { cookie })).payload; return current.name === 'Dream Lab Copy Renamed' && current.revision === 2 ? current : null }, 'renamed historical copy persists')
  assert.deepEqual(renamed.data.pages, initialData.pages, 'rename changes only the copied title, not its historical page content')
  assert.deepEqual((await apiRequest(apiOrigin, `/api/documents/${encodeURIComponent(sourceId)}`, { cookie })).payload, sourceBeforeCopy, 'renaming the copy still leaves the current source unchanged')

  await evaluate("(()=>{const format=document.querySelector('.export-format');format.value='png';format.dispatchEvent(new Event('change',{bubbles:true}));const scale=document.querySelector('[aria-label=\"Tamanho da imagem\"]');scale.value='1';scale.dispatchEvent(new Event('change',{bubbles:true}));const background=document.querySelector('[aria-label=\"Fundo PNG\"]');background.value='opaque';background.dispatchEvent(new Event('change',{bubbles:true}))})()")
  assert.equal(await evaluate("document.querySelector('.export-format')?.value"), 'png')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Tamanho da imagem\"]')?.value"), '1')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Fundo PNG\"]')?.value"), 'opaque')
  await evaluate("document.querySelector('.export-button').click()")
  const begin = await waitFor(() => downloadEvents.find(item => item.method === 'Browser.downloadWillBegin'), 'scale-1 opaque PNG export handoff')
  assert.match(begin.suggestedFilename, /\.png$/i)
  await waitFor(() => downloadEvents.find(item => item.method === 'Browser.downloadProgress' && item.guid === begin.guid && item.state === 'completed'), 'PNG download completes')
  const downloaded = await waitFor(async () => { const bytes = await readFile(path.join(downloadDir, begin.guid)).catch(() => null); return bytes?.length ? bytes : null }, 'exported PNG file')
  assert.equal(downloaded.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'export is a PNG')
  const downloadedDataUrl = `data:image/png;base64,${downloaded.toString('base64')}`
  const pixelComparison = await evaluate(`(async()=>{const load=async source=>{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data}};const reference=await load(${JSON.stringify(referenceDataUrl)});const output=await load(${JSON.stringify(downloadedDataUrl)});if(reference.width!==output.width||reference.height!==output.height)return {width:output.width,height:output.height,referenceWidth:reference.width,referenceHeight:reference.height,differingPixels:null,meanAbsoluteRgbDifference:null};let differingPixels=0,totalDifference=0;for(let i=0;i<reference.pixels.length;i+=4){let changed=false;for(let c=0;c<3;c++){const delta=Math.abs(reference.pixels[i+c]-output.pixels[i+c]);totalDifference+=delta;if(delta)changed=true}if(changed)differingPixels++}return {width:output.width,height:output.height,referenceWidth:reference.width,referenceHeight:reference.height,differingPixels,meanAbsoluteRgbDifference:totalDifference/(reference.width*reference.height*3)}})()`)
  assert.deepEqual([pixelComparison.width, pixelComparison.height], [2400, 2400], `PNG scale 1 matches the observed 2400 square output size: ${JSON.stringify(pixelComparison)}`)
  assert.equal(pixelComparison.differingPixels, 0, `local export pixels match the retained initial PNG for this one raster fixture: ${JSON.stringify(pixelComparison)}`)
  console.log(JSON.stringify({ pass: true, case: 'history-copy-initial', sourceId, copyId: copied.id, renamedTitle: renamed.name, exportPixels: pixelComparison, limits: ['The source artwork is a retained full-page raster, so this validates historical-copy persistence/export for one image-only fixture, not general vector/text reconstruction.', 'PNG pixel equality is limited to this one 2400x2400 opaque scale-1 fixture; metadata and binary hashes are not compared.', 'No folder inheritance or copied collaboration history is claimed.'] }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite); await apiServer?.close()
  for (const directory of [profile, downloadDir]) for (let attempt = 0; attempt < 6; attempt++) { try { await rm(directory, { recursive: true, force: true }); break } catch { if (attempt < 5) await delay(150) } }
}
