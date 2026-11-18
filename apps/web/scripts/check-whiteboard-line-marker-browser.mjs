import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of candidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the whiteboard marker browser test')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort(), cdpPort = await freePort()
const origin = `http://127.0.0.1:${vitePort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-whiteboard-markers-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1100', origin], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith(origin)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); const result = await response; if (result.error) throw new Error(result.error.message); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled local library')
  const fixture = { id: 'whiteboard-marker-browser', name: 'Marker roundtrip fixture', type: 'whiteboard', width: 1200, height: 800, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Board 1', background: '#ffffff', elements: [{ id: 'line-1', type: 'shape', name: 'Audit arrow line', shape: 'line', x: 160, y: 180, width: 340, height: 8, rotation: 0, fill: '#202124', strokeWidth: 4, startArrow: false, endArrow: true, curveOffset: -96 }, { id: 'note-1', type: 'sticky-note', name: 'Unrelated note', x: 600, y: 200, width: 220, height: 160, rotation: 0, fill: '#fff2a8', text: 'Keep this note unchanged' }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('documents'))db.createObjectStore('documents',{keyPath:'id'});if(!db.objectStoreNames.contains('assets')){const store=db.createObjectStore('assets',{keyPath:'id'});store.createIndex('libraryVisible','libraryVisible')}if(!db.objectStoreNames.contains('projectFolders'))db.createObjectStore('projectFolders',{keyPath:'id'});if(!db.objectStoreNames.contains('cloudDrafts'))db.createObjectStore('cloudDrafts',{keyPath:'documentId'})};request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Abrir Marker roundtrip fixture\"]')"), 'seeded whiteboard project')
  await evaluate("document.querySelector('[aria-label=\"Abrir Marker roundtrip fixture\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace .whiteboard-zoom-controls')"), 'whiteboard editor')
  await evaluate("document.querySelector('.whiteboard-tool-dock button[aria-label=\"Conector\"]')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.whiteboard-line-menu')"), 'line variant discovery menu')
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.whiteboard-line-menu button')].map(button=>({name:button.textContent.trim(),type:button.type,pressed:button.getAttribute('aria-pressed')}))"), [
    { name: 'Linha reta', type: 'button', pressed: 'true' },
    { name: 'Linha angular', type: 'button', pressed: 'false' },
    { name: 'Linha curva', type: 'button', pressed: 'false' },
  ], 'three distinct line choices have accessible names and expose the current choice')
  await evaluate("document.querySelector('.whiteboard-line-menu button:nth-child(3)')?.focus()")
  assert.equal(await evaluate("document.activeElement?.textContent?.trim()"), 'Linha curva', 'line choices are reachable by keyboard focus')
  await evaluate("document.querySelector('.whiteboard-line-menu button:nth-child(3)')?.click()")
  await waitFor(() => evaluate("!document.querySelector('.whiteboard-line-menu')&&document.querySelector('.whiteboard-tool-dock button[aria-label=\"Conector\"]')?.getAttribute('aria-pressed')==='true'"), 'keyboard choice closes menu and keeps line-creation mode active')
  await evaluate("document.querySelector('.whiteboard-tool-dock button[aria-label=\"Conector\"]')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.whiteboard-line-menu')&&document.querySelector('.whiteboard-line-menu button:nth-child(3)')?.getAttribute('aria-pressed')==='true'"), 'chosen variant remains selected when discovery menu is reopened')
  await evaluate("document.querySelector('.whiteboard-tool-dock button[aria-label=\"Selecionar\"]')?.click()")
  await waitFor(() => evaluate("!document.querySelector('.whiteboard-line-menu')&&document.querySelector('.whiteboard-tool-dock button[aria-label=\"Selecionar\"]')?.getAttribute('aria-pressed')==='true'"), 'selection mode closes line choices and is distinguishable from line creation')
  await evaluate("document.querySelector('.layer-row[data-element-id=\"line-1\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-start-marker')?.value==='none'&&document.querySelector('#line-end-marker')?.value==='arrow'"), 'audited final-endpoint marker and inspector')
  await evaluate("document.querySelector('[aria-label=\"Trocar extremidades da linha\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-start-marker')?.value==='arrow'&&document.querySelector('#line-end-marker')?.value==='none'"), 'marker moves to the initial endpoint')
  await waitFor(() => evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('documents').objectStore('documents').get('whiteboard-marker-browser');q.onsuccess=()=>{const d=q.result;db.close();resolve(d?.pages?.[0]?.elements?.[0]?.startArrow===true&&d?.pages?.[0]?.elements?.[0]?.endArrow===false)};q.onerror=()=>reject(q.error)}})"), 'swapped marker saved locally')
  const swapped = await evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('documents').objectStore('documents').get('whiteboard-marker-browser');q.onsuccess=()=>{const d=q.result;db.close();resolve(d)};q.onerror=()=>reject(q.error)}})")
  assert.deepEqual([swapped.pages[0].elements[0].id, swapped.pages[0].elements[0].x, swapped.pages[0].elements[0].y, swapped.pages[0].elements[0].width, swapped.pages[0].elements[0].height, swapped.pages[0].elements[0].curveOffset, swapped.pages[0].elements[0].startArrow, swapped.pages[0].elements[0].endArrow], ['line-1', 160, 180, 340, 8, -96, true, false], 'swap preserves line identity, geometry, curve and moves only the marker')
  assert.equal(swapped.pages[0].elements[1].text, 'Keep this note unchanged', 'unrelated whiteboard content is unchanged')
  await evaluate('location.reload()')
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace .whiteboard-zoom-controls')"), 'reopened whiteboard')
  await evaluate("document.querySelector('.layer-row[data-element-id=\"line-1\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-start-marker')?.value==='arrow'&&document.querySelector('#line-end-marker')?.value==='none'"), 'swapped marker survives reload')
  console.log('PASS named line variants are focusable/discoverable and dismiss into selection mode; endpoint marker swap preserves line geometry, curve, identity and unrelated note after reload')
} finally {
  try { pageSocket?.close() } catch {}
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
  await stop(chrome); await stop(vite); await rm(profile, { recursive: true, force: true }).catch(() => {})
}
