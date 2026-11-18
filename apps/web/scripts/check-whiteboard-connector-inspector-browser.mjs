import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
async function findChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the text typography browser test.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 2000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const chromePath = await findChrome()
const vitePort = await freePort(), cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-whiteboard-connector-browser-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1440,1100', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function dragCanvasPoint(from, to) {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let step = 1; step <= 10; step += 1) {
      await delay(16)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10, button: 'left', buttons: 1 })
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 })
  }
  async function canvasPoint(worldX, worldY) {
    return evaluate(`(()=>{const viewport=document.querySelector('.canvas-viewport');const rect=viewport.getBoundingClientRect();const zoom=Number(viewport.dataset.whiteboardZoom);const x=Number(viewport.dataset.whiteboardPositionX);const y=Number(viewport.dataset.whiteboardPositionY);if(!Number.isFinite(zoom)||!Number.isFinite(x)||!Number.isFinite(y))throw new Error('whiteboard transform data is missing');return{x:rect.left+x+${worldX}*zoom,y:rect.top+y+${worldY}*zoom}})()`)
  }
  async function returnToLibraryAfterReload(label) {
    await waitFor(() => evaluate("!document.querySelector('.home-loading') && (!!document.querySelector('.project-open') || !!document.querySelector('[data-connector-id=\\\"connector-1\\\"]'))"), `${label}: restored whiteboard`)
    if (await evaluate("!document.querySelector('.project-open') && !!document.querySelector('[data-connector-id=\\\"connector-1\\\"]')")) await evaluate("document.querySelector('.brand').click()")
    try { await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), `${label}: library is ready`) }
    catch (error) { console.error(`${label} route diagnostic:`, await evaluate("JSON.stringify({url:location.href,title:document.title,body:document.body.innerText.slice(0,600),loading:!!document.querySelector('.home-loading'),projects:document.querySelectorAll('.project-open').length,brand:!!document.querySelector('.brand'),save:document.querySelector('.save-state')?.textContent})")); throw error }
  }

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  const fixture = { id: 'whiteboard-connector-browser', name: 'Connector inspector fixture', type: 'whiteboard', width: 1200, height: 900, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Board 1', background: '#ffffff', elements: [{ id: 'shape-1', type: 'shape', name: 'Start', shape: 'rect', x: 100, y: 140, width: 160, height: 100, rotation: 0, fill: '#8e7cf5', cornerRadius: 10 }, { id: 'shape-2', type: 'shape', name: 'Finish', shape: 'rect', x: 500, y: 140, width: 160, height: 100, rotation: 0, fill: '#8e7cf5', cornerRadius: 10 }, { id: 'shape-qr', type: 'shape', name: 'QR destination', shape: 'rect', x: 820, y: 140, width: 180, height: 180, rotation: 0, fill: '#ffffff', cornerRadius: 0, qrConfig: { pattern: 'blocks', foreground: '#000000', background: '#ffffff', logo: 'none', corner: 0 } }], connectors: [{ id: 'connector-1', fromId: 'shape-1', toId: 'shape-2', fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.5 }, color: '#7464e8', strokeWidth: 4 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded whiteboard')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('[data-connector-id=\\\"connector-1\\\"]') && !!document.querySelector('.inspector-panel')"), 'whiteboard connector layer')
  await evaluate("document.querySelector('[data-connector-id=\\\"connector-1\\\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('#connector-color') && !!document.querySelector('#connector-stroke-width')"), 'connector inspector')

  const setValue = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('missing '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value})()`)
  assert.equal(await setValue('#connector-color', '#ff3366'), '#ff3366')
  assert.equal(await setValue('#connector-stroke-width', '9'), '9')
  assert.equal(await setValue('[aria-label="Âncora Início Y"]', '0.25'), '0.25')
  assert.equal(await setValue('[aria-label="Âncora Fim X"]', '0.15'), '0.15')
  await waitFor(() => evaluate("document.querySelector('#connector-color')?.value==='#ff3366' && document.querySelector('#connector-stroke-width')?.value==='9' && document.querySelector('[aria-label=\\\"Âncora Início Y\\\"]')?.value==='0.25' && document.querySelector('[aria-label=\\\"Âncora Fim X\\\"]')?.value==='0.15' && document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'connector style and anchors saved')
  const readSaved = () => evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('whiteboard-connector-browser');get.onsuccess=()=>{db.close();const item=get.result.pages[0].connectors[0];resolve([item.color,item.strokeWidth,item.fromAnchor,item.toAnchor])};get.onerror=()=>reject(get.error)}})")
  assert.deepEqual(await readSaved(), ['#ff3366', 9, { x: 1, y: 0.25 }, { x: 0.15, y: 0.5 }], 'connector properties persist in the local document model')
  await send('Page.reload')
  await returnToLibraryAfterReload('connector reload')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('[data-connector-id=\\\"connector-1\\\"]')"), 'reopened whiteboard')
  await evaluate("document.querySelector('[data-connector-id=\\\"connector-1\\\"]').click()")
  await waitFor(() => evaluate("document.querySelector('#connector-color')?.value==='#ff3366' && document.querySelector('#connector-stroke-width')?.value==='9' && document.querySelector('[aria-label=\\\"Âncora Início Y\\\"]')?.value==='0.25' && document.querySelector('[aria-label=\\\"Âncora Fim X\\\"]')?.value==='0.15'"), 'connector inspector values restore')
  const connectorHandleState = async () => evaluate("JSON.stringify({inputs:[...document.querySelectorAll('.connector-anchor-fields input')].map(input=>input.value),save:document.querySelector('.save-state')?.textContent,zoom:document.querySelector('.canvas-viewport')?.dataset.whiteboardZoom,offset:[document.querySelector('.canvas-viewport')?.dataset.whiteboardPositionX,document.querySelector('.canvas-viewport')?.dataset.whiteboardPositionY]})")
  await dragCanvasPoint(await canvasPoint(260, 165), await canvasPoint(180, 240))
  try {
    await waitFor(() => evaluate("document.querySelectorAll('.connector-anchor-fields input')[0]?.value==='0.5' && document.querySelectorAll('.connector-anchor-fields input')[1]?.value==='1' && document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'drag connector start handle using the rendered canvas transform')
  } catch (error) { console.error('Start handle drag diagnostic:', await connectorHandleState()); throw error }
  await dragCanvasPoint(await canvasPoint(524, 190), await canvasPoint(660, 190))
  try {
    await waitFor(() => evaluate("document.querySelectorAll('.connector-anchor-fields input')[2]?.value==='1' && document.querySelectorAll('.connector-anchor-fields input')[3]?.value==='0.5' && document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'drag connector end handle using the rendered canvas transform')
  } catch (error) { console.error('End handle drag diagnostic:', await connectorHandleState()); throw error }
  const afterHandleDrag = await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('whiteboard-connector-browser');get.onsuccess=()=>{db.close();const item=get.result.pages[0].connectors[0];resolve([item.fromAnchor,item.toAnchor])};get.onerror=()=>reject(get.error)}})")
  assert.deepEqual(afterHandleDrag, [{ x: 0.5, y: 1 }, { x: 1, y: 0.5 }], 'direct canvas drags persist both snapped connector anchors')
  console.log('PASS both connector handles drag to snapped anchors and persist through IndexedDB')
  await evaluate("document.querySelector('.layer-row[data-element-id=\"shape-qr\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('#qr-url')"), 'QR destination inspector')
  await setValue('#qr-url', 'not-a-url')
  await evaluate("document.querySelector('.qr-editor button').click()")
  assert.equal(await evaluate("document.querySelector('#qr-url')?.getAttribute('aria-invalid')==='true'"), true, 'invalid QR destination is rejected')
  await setValue('#qr-url', 'https://example.test/campaign')
  await evaluate("[...document.querySelectorAll('.qr-editor button')].find(button=>button.textContent==='Aplicar URL').click()")
  await evaluate("[...document.querySelectorAll('.qr-patterns button')].find(button=>button.textContent==='Círculos').click()")
  await waitFor(() => evaluate("document.querySelector('#qr-url')?.value==='https://example.test/campaign' && document.querySelector('.qr-patterns button[aria-pressed=\"true\"]')?.textContent==='Círculos' && document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'QR destination and pattern save')
  const readQr = () => evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('whiteboard-connector-browser');get.onsuccess=()=>{db.close();const qr=get.result.pages[0].elements.find(element=>element.id==='shape-qr').qrConfig;resolve([qr.url,qr.pattern,qr.foreground,qr.background])};get.onerror=()=>reject(get.error)}})")
  assert.deepEqual(await readQr(), ['https://example.test/campaign', 'circles', '#000000', '#ffffff'], 'QR destination and style persist in the local project model')
  await send('Page.reload')
  await returnToLibraryAfterReload('QR reload')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.layer-row[data-element-id=\"shape-qr\"]')"), 'reopened whiteboard with QR')
  await evaluate("document.querySelector('.layer-row[data-element-id=\"shape-qr\"]').click()")
  await waitFor(() => evaluate("document.querySelector('#qr-url')?.value==='https://example.test/campaign' && document.querySelector('.qr-patterns button[aria-pressed=\"true\"]')?.textContent==='Círculos'"), 'QR inspector values restore')
  console.log('PASS whiteboard connector inspector and QR editor: both direct connector anchor drags snap and persist, connector style/anchor fields, QR destination/pattern, invalid URL rejection, and reload roundtrips')
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-whiteboard-connector-browser-')) for (let attempt = 0; attempt < 10; attempt += 1) { try { await rm(resolvedProfile, { recursive: true, force: true }); break } catch { await delay(100) } }
}
