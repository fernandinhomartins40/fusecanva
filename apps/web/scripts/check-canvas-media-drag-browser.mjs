import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
async function getChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
  else child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
}

const chromePath = await getChrome()
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-media-drag-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const targets = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page')
  pageSocket = new WebSocket(targets.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); const result = await response; if (result.error) throw new Error(`${method}: ${result.error.message}`); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function readDocument() { return evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('documents','readonly').objectStore('documents').get('media-drag-browser');q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=()=>reject(q.error)}})") }
  async function canvasHash() { const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }); return createHash('sha256').update(Buffer.from(shot.result.data, 'base64')).digest('hex') }
  async function drag(point, dest) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dest.x, y: dest.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 }); }

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home ready')
  const svg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="60"%3E%3Crect width="80" height="60" fill="%23e44"/%3E%3C/svg%3E'
  const documentFixture = { id: 'media-drag-browser', name: 'Media drag pointer fixture', type: 'design', width: 794, height: 1123, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Page 1', background: '#fff', elements: [{ id: 'image-drag', type: 'image', name: 'Draggable red image', src: svg, x: 120, y: 180, width: 220, height: 165, rotation: 0, sourceWidth: 80, sourceHeight: 60 }, { id: 'image-stable', type: 'image', name: 'Unrelated blue image', src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="60"%3E%3Crect width="80" height="60" fill="%23008"/%3E%3C/svg%3E', x: 490, y: 660, width: 120, height: 90, rotation: 0, sourceWidth: 80, sourceHeight: 60 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(documentFixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'fixture project')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Media drag pointer fixture')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace') && !!document.querySelector('.layer-row')"), 'design editor')
  const baseline = await readDocument()
  assert.deepEqual(baseline.pages[0].elements.map(({ id, x, y }) => ({ id, x, y })), [{ id: 'image-drag', x: 120, y: 180 }, { id: 'image-stable', x: 490, y: 660 }])
  const rect = await evaluate("(()=>{const p=document.querySelector('.canvas-viewport').getBoundingClientRect();const c=document.querySelector('.canvas-workspace canvas').getBoundingClientRect();const scale=Math.min((p.width-48)/794,(p.height-114)/1123,1);const ox=Math.round((p.width-794*scale)/2);const oy=Math.round((p.height-1123*scale)/2);return{left:c.left+ox+(120+80)*scale,top:c.top+oy+(180+70)*scale,scale}})()")
  const start = { x: rect.left, y: rect.top }
  const end = { x: start.x + 72, y: start.y + 48 }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
  const beforeDragHash = await canvasHash()
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + 26, y: start.y + 18, button: 'left', buttons: 1 })
  const duringDragHash = await canvasHash()
  assert.notEqual(duringDragHash, beforeDragHash, 'intermediate pointer movement changes the rendered canvas')
  assert.deepEqual((await readDocument()).pages[0].elements.map(({ x, y }) => ({ x, y })), [{ x: 120, y: 180 }, { x: 490, y: 660 }], 'drag remains transient before pointerup commit')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 })
  await waitFor(async () => (await readDocument()).pages[0].elements[0].x !== 120, 'pointerup geometry save')
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo')"), 'local save completion')
  const moved = await readDocument()
  assert.ok(Math.abs(moved.pages[0].elements[0].x - 120 - 72 / rect.scale) < 2, 'the final model x coordinate reflects the measured drag offset')
  assert.ok(Math.abs(moved.pages[0].elements[0].y - 180 - 48 / rect.scale) < 2, 'the final model y coordinate reflects the measured drag offset')
  assert.deepEqual({ x: moved.pages[0].elements[1].x, y: moved.pages[0].elements[1].y }, { x: 490, y: 660 }, 'unrelated image geometry remains unchanged')
  await evaluate("document.querySelector('[aria-label=Desfazer]').click()")
  await waitFor(async () => { const doc = await readDocument(); return doc.pages[0].elements[0].x === 120 && doc.pages[0].elements[0].y === 180 }, 'undo restores original geometry')
  await evaluate("document.querySelector('[aria-label=Refazer]').click()")
  await waitFor(async () => { const doc = await readDocument(); return doc.pages[0].elements[0].x === moved.pages[0].elements[0].x && doc.pages[0].elements[0].y === moved.pages[0].elements[0].y }, 'redo restores moved geometry')

  await send('Page.reload')
  await waitFor(() => evaluate("document.readyState==='complete' && (!!document.querySelector('.canvas-workspace') || !!document.querySelector('.project-open') && !document.querySelector('.home-loading'))"), 'app route after reload')
  if (!(await evaluate("!!document.querySelector('.canvas-workspace')"))) await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Media drag pointer fixture')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace')"), 'reopened design')
  const reopened = await readDocument()
  assert.deepEqual({ x: reopened.pages[0].elements[0].x, y: reopened.pages[0].elements[0].y }, { x: moved.pages[0].elements[0].x, y: moved.pages[0].elements[0].y }, 'moved geometry persists after reopening the same local design')

  // CDP touch input exercises Chromium's touch and pointer cancellation path, unlike a
  // manually dispatched DOM PointerEvent. Observe the events that reach the canvas.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await evaluate("window.__mediaCancelEvents=[];for(const type of ['pointercancel','touchcancel'])window.addEventListener(type,event=>window.__mediaCancelEvents.push({type:event.type,pointerType:event.pointerType??null}),true)")
  const cancelPoint = await evaluate("(()=>{const p=document.querySelector('.canvas-viewport').getBoundingClientRect();const c=document.querySelector('.canvas-workspace canvas').getBoundingClientRect();const s=Math.min((p.width-48)/794,(p.height-114)/1123,1);const ox=Math.round((p.width-794*s)/2);const oy=Math.round((p.height-1123*s)/2);return{x:c.left+ox+(" + moved.pages[0].elements[0].x + "+100)*s,y:c.top+oy+(" + moved.pages[0].elements[0].y + "+90)*s}})()")
  const beforeCancelHash = await canvasHash()
  const touch = (x, y) => ({ x, y, id: 1, radiusX: 6, radiusY: 6, force: 0.8 })
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(cancelPoint.x, cancelPoint.y)] })
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(cancelPoint.x + 32, cancelPoint.y + 20)] })
  const duringCancelHash = await canvasHash()
  assert.notEqual(duringCancelHash, beforeCancelHash, 'CDP touch movement changes the rendered canvas before cancellation')
  assert.deepEqual({ x: (await readDocument()).pages[0].elements[0].x, y: (await readDocument()).pages[0].elements[0].y }, { x: moved.pages[0].elements[0].x, y: moved.pages[0].elements[0].y }, 'touch drag remains transient before release/cancel')
  await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await waitFor(() => evaluate("window.__mediaCancelEvents.some(event=>event.type==='touchcancel' || event.type==='pointercancel')"), 'browser-generated touchcancel/pointercancel event')
  const cancelEvents = await evaluate('window.__mediaCancelEvents')
  const cancelOutcome = await readDocument()
  assert.deepEqual({ x: cancelOutcome.pages[0].elements[0].x, y: cancelOutcome.pages[0].elements[0].y }, { x: moved.pages[0].elements[0].x, y: moved.pages[0].elements[0].y }, 'browser cancellation restores the saved element position without a model commit')
  await waitFor(async () => (await evaluate("document.querySelector('.save-state').textContent")) !== 'Salvando', 'cancelled drag leaves save state settled')
  await delay(100)
  assert.equal(await canvasHash(), beforeCancelHash, 'browser cancellation restores the original rendered canvas position')
  assert.equal(await evaluate("document.querySelector('.undo-button')?.disabled ?? document.querySelector('[aria-label=Desfazer]')?.disabled"), true, 'a cancelled drag does not create a new undo entry after reopening')
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await send('Emulation.clearDeviceMetricsOverride')
  console.log(JSON.stringify({ ok: true, intermediateCanvasChanged: true, pointerupCommit: { before: { x: baseline.pages[0].elements[0].x, y: baseline.pages[0].elements[0].y }, after: { x: moved.pages[0].elements[0].x, y: moved.pages[0].elements[0].y } }, unrelatedImageUnchanged: true, persistedAfterReload: true, undoRedo: true, cancelledTouch: { events: cancelEvents, modelRestored: true, canvasRestored: true, noUndoEntry: true } }, null, 2))
} finally {
  try { pageSocket?.close() } catch {}
  try { browserSocket?.close() } catch {}
  await stop(chrome)
  await stop(vite)
  await rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined)
}
