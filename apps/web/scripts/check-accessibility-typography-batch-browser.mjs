import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 60000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 3000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const vitePort = await freePort(); const cdpPort = await freePort(); const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-accessibility-typography-'))
let vite; let chrome; let socket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, `--window-size=1280,900`, `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'page target')
  const pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home')
  const doc = { id: 'accessibility-batch-browser', name: 'Cross page typography fixture', type: 'design', width: 794, height: 1123, updatedAt: new Date().toISOString(), pages: [
    { id: 'page-1', name: 'Page 1', background: '#fff', elements: [{ id: 'text-1', type: 'text', name: 'Cover caption', x: 32, y: 40, width: 220, height: 32, rotation: 0, text: 'Small type one', fontSize: 8, fontFamily: 'Arial', color: '#555', bold: false }] },
    { id: 'page-2', name: 'Page 2', background: '#fff', elements: [{ id: 'text-2', type: 'text', name: 'Inside caption', x: 32, y: 40, width: 220, height: 32, rotation: 0, text: 'Small type two', fontSize: 10, fontFamily: 'Arial', color: '#555', bold: false }] },
  ] }
  await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(doc)});tx.oncomplete=()=>{r.result.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded design')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.inspector-panel')"), 'editor')
  await evaluate("[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Acessibilidade')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.accessibility-dialog')"), 'accessibility review')
  await evaluate("document.querySelectorAll('.accessibility-summary button')[1].click()")
  assert.equal(await evaluate("document.querySelectorAll('.accessibility-issue').length===2 && document.querySelectorAll('.accessibility-issue input[type=checkbox]').length===2 && [...document.querySelectorAll('.accessibility-issue')].some(issue=>issue.textContent.includes('Page 1')) && [...document.querySelectorAll('.accessibility-issue')].some(issue=>issue.textContent.includes('Page 2'))"), true, 'review exposes a typography issue on each page')
  await evaluate("document.querySelectorAll('.accessibility-issue input[type=checkbox]')[0].click()")
  await evaluate("document.querySelector('.accessibility-issue>button').click()")
  await waitFor(() => evaluate("!!document.querySelector('.accessibility-dialog') && document.querySelector('.page-footer').textContent.includes('1 de 2') && document.querySelector('.layer-row.selected')?.textContent.includes('Cover caption')"), 'navigate to first issue without closing review')
  assert.equal(await evaluate("document.querySelector('.accessibility-dialog>footer span').textContent==='1 selecionado(s)'"), true, 'cross-page issue selection is retained during navigation')
  await evaluate("document.querySelectorAll('.accessibility-issue input[type=checkbox]')[1].click()")
  assert.equal(await evaluate("document.querySelector('.accessibility-dialog>footer span').textContent==='2 selecionado(s)' && document.querySelector('.accessibility-batch-fix').textContent.includes('(2)')"), true, 'issues on separate pages are selected together')
  await evaluate("document.querySelector('.accessibility-batch-fix').click()")
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo') && document.querySelector('.accessibility-summary button:nth-child(2) strong').textContent==='0'"), 'batch correction save')
  assert.equal(await evaluate("!!document.querySelector('.accessibility-dialog') && document.querySelector('.accessibility-no-issues')?.textContent.includes('Nenhum item') && document.querySelector('.accessibility-dialog>footer span').textContent==='0 selecionado(s)'"), true, 'saved correction updates issue list, category count and selection count')
  assert.equal(await evaluate("document.querySelector('.page-footer').textContent.includes('2 de 2') && document.querySelector('.layer-row.selected')?.textContent.includes('Inside caption')"), true, 'editor focuses the last corrected text on its page')
  async function sizes() { return evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('documents','readonly');const get=tx.objectStore('documents').get('accessibility-batch-browser');get.onsuccess=()=>{r.result.close();resolve(get.result.pages.map(page=>page.elements.map(element=>element.fontSize)))};get.onerror=()=>reject(get.error)}})") }
  assert.deepEqual(await sizes(), [[12], [12]], 'batch correction persists both page values')
  await evaluate("document.querySelector('.accessibility-dialog header button').click()")
  await evaluate("document.querySelector('[aria-label=Desfazer]').click()")
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo')"), 'batch undo save')
  assert.deepEqual(await sizes(), [[8], [10]], 'one undo restores both pre-correction values across pages')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'library after reload')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.inspector-panel')"), 'reopened editor')
  await evaluate("[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Acessibilidade')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.accessibility-dialog')"), 'review after reopen')
  await evaluate("document.querySelectorAll('.accessibility-summary button')[1].click()")
  assert.equal(await evaluate("document.querySelectorAll('.accessibility-issue').length===2 && document.querySelectorAll('.accessibility-issue input[type=checkbox]').length===2"), true, 'undo state and both issues persist after reopening the design')
  pageSocket.close()
  console.log('PASS cross-page typography review, retained multi-selection, batch correction, saved issue counts, single Undo, and reopen roundtrip')
} finally {
  socket?.close(); await stop(chrome); await stop(vite)
  if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
