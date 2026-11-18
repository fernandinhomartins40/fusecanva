import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the PDF cancellation browser test')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; let lastError; while (Date.now() < end) { try { const result = await check(); if (result) return result } catch (error) { lastError = error } await delay(100) } throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ''}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-pdf-cancel-profile-'))
const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-pdf-cancel-downloads-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  const origin = `http://127.0.0.1:${vitePort}`
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', origin], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })

  let browserId = 0; const browserPending = new Map(); const downloadEvents = []
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && browserPending.has(message.id)) { browserPending.get(message.id)(message); browserPending.delete(message.id) }
    if (message.method === 'Browser.downloadWillBegin' || message.method === 'Browser.downloadProgress') downloadEvents.push({ method: message.method, ...message.params })
  })
  async function sendBrowser(method, params = {}) { const id = ++browserId; const result = new Promise(resolve => browserPending.set(id, resolve)); browserSocket.send(JSON.stringify({ id, method, params })); return result }
  let pageId = 0; const pagePending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pagePending.has(message.id)) { pagePending.get(message.id)(message); pagePending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++pageId; const result = new Promise(resolve => pagePending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }

  await sendBrowser('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true })
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'local home')
  const seeded = await evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=1080;
    const context=canvas.getContext('2d');const image=context.createImageData(canvas.width,canvas.height);
    let seed=0x5eed1234;for(let i=0;i<image.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;image.data[i]=seed>>>24;seed=(seed*1664525+1013904223)>>>0;image.data[i+1]=seed>>>24;seed=(seed*1664525+1013904223)>>>0;image.data[i+2]=seed>>>24;image.data[i+3]=255}context.putImageData(image,0,0);
    const src=canvas.toDataURL('image/png');const {createBlankDocument}=await import('/src/model.ts');const {writeDocument}=await import('/src/persistence.ts');
    const design=createBlankDocument('PDF cancellation fixture');
    design.pages[0].elements=[{id:'pdf-noise-a',name:'Large raster fixture',type:'image',x:0,y:0,width:794,height:1123,rotation:0,src,sourceWidth:canvas.width,sourceHeight:canvas.height,crop:null}];
    design.pages.push({...design.pages[0],id:'pdf-cancel-page-2',name:'Page 2',elements:design.pages[0].elements.map(element=>({...element,id:'pdf-noise-b'}))});
    await writeDocument(design);window.__pdfCancelFixtureId=design.id;
    const original=await (await import('/src/persistence.ts')).readDocument(design.id);window.__pdfCancelBefore=JSON.stringify(original);
    history.pushState({},'','/design/'+encodeURIComponent(design.id)+'/edit');window.dispatchEvent(new PopStateEvent('popstate'));
    return {id:design.id,sourceBytes:Math.floor((src.length-src.indexOf(',')-1)*3/4),pages:design.pages.length,documentDigest:JSON.stringify(original).length}
  })()`)
  assert.equal(seeded.pages, 2, 'the disposable cancellation fixture has two pages')
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') && document.querySelectorAll('.page-indicator').length"), 'seeded design editor')
  await waitFor(() => evaluate("!!document.querySelector('.export-button') && !document.querySelector('.export-button').disabled"), 'PDF export control')
  assert.equal(await evaluate("document.querySelector('.export-format')?.value"), 'pdf', 'the fixture starts with PDF selected')
  const beforeExport = await evaluate(`(async()=>{const doc=await (await import('/src/persistence.ts')).readDocument(window.__pdfCancelFixtureId);return JSON.stringify(doc)})()`)
  assert.equal(beforeExport, await evaluate('window.__pdfCancelBefore'), 'the stored document matches its checkpoint before export')

  await evaluate("document.querySelector('.export-button').click()")
  const begin = await waitFor(() => downloadEvents.find(item => item.method === 'Browser.downloadWillBegin'), 'PDF download handoff')
  assert.match(begin.suggestedFilename, /\.pdf$/i, 'the handoff is the expected PDF file')
  assert.ok(begin.url.startsWith('blob:'), 'PDF is generated locally as a browser blob')
  const cancelResponse = await sendBrowser('Browser.cancelDownload', { guid: begin.guid })
  assert.ok(!cancelResponse.error, `Chrome accepts cancellation of the active PDF download: ${JSON.stringify(cancelResponse.error)}`)
  const canceled = await waitFor(() => downloadEvents.find(item => item.method === 'Browser.downloadProgress' && item.guid === begin.guid && item.state === 'canceled'), 'Chrome download cancellation')
  assert.equal(canceled.state, 'canceled')
  await waitFor(() => evaluate("!document.querySelector('.export-button')?.disabled"), 'export control returns to idle')

  const afterExport = await evaluate(`(async()=>{const doc=await (await import('/src/persistence.ts')).readDocument(window.__pdfCancelFixtureId);return JSON.stringify(doc)})()`)
  assert.equal(afterExport, beforeExport, 'canceling the download leaves the stored document byte-for-byte equivalent as JSON')
  await delay(300)
  const remainingFiles = await readdir(downloadDir)
  assert.deepEqual(remainingFiles, [], `canceled transfer leaves no completed or partial files: ${JSON.stringify(remainingFiles)}`)
  assert.equal(downloadEvents.some(item => item.method === 'Browser.downloadProgress' && item.guid === begin.guid && item.state === 'completed'), false, 'Chrome never completes or publishes the canceled artifact')
  assert.equal(await evaluate("document.querySelector('.export-error')?.textContent ?? ''"), '', 'cancellation does not become a document/export error')
  console.log(JSON.stringify({ pass: true, case: 'pdf-flatten-download-cancelled', verified: ['two-page local PDF reaches Chrome download handoff', 'Chrome cancels the active transfer', 'no completed or partial download remains', 'stored document matches its pre-export checkpoint', 'export control returns to idle'], limits: ['The observed REA cancellation was a capture-provider event; this test uses Chrome CDP cancellation', 'The local UI does not expose the audited flattened-PDF option', 'No export preference or browser download-history equivalence is claimed'] }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  for (const directory of [profile, downloadDir]) for (let attempt = 0; attempt < 6; attempt++) { try { await rm(directory, { recursive: true, force: true }); break } catch { if (attempt < 5) await delay(150) } }
}
