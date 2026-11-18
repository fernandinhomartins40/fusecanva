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
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-text-typography-browser-'))
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

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  const fixture = { id: 'text-typography-browser', name: 'Typography fixture', type: 'design', width: 1200, height: 1200, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [{ id: 'text-1', type: 'text', name: 'Typography sample', text: 'AB\nCD', x: 80, y: 80, width: 800, height: 400, rotation: 0, fontSize: 64, fontFamily: 'Arial', color: '#000000', bold: false }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded design')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') && !!document.querySelector('.inspector-panel')"), 'text editor')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("!!document.querySelector('#text-kerning-slider') && !!document.querySelector('#text-line-spacing-slider')"), 'typography inspector sliders')

  const setRange = (selector, value) => evaluate(`(()=>{const input=document.querySelector('${selector}');if(!input)throw new Error('missing ${selector}');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'${value}');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value})()`)
  assert.equal(await setRange('#text-kerning-slider', '2.5'), '2.5')
  assert.equal(await setRange('#text-line-spacing-slider', '1.8'), '1.8')
  await waitFor(() => evaluate("document.querySelector('#text-kerning')?.value==='2.5' && document.querySelector('#text-line-spacing')?.value==='1.8' && document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'synced and saved typography values')
  const readSaved = () => evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('text-typography-browser');get.onsuccess=()=>{db.close();const item=get.result.pages[0].elements[0];resolve([item.kerning,item.lineSpacing])};get.onerror=()=>reject(get.error)}})")
  assert.deepEqual(await readSaved(), [2.5, 1.8], 'both inspector changes are stored on the text model')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'home after reload')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') && !!document.querySelector('.inspector-panel')"), 'reopened design')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("document.querySelector('#text-kerning-slider')?.value==='2.5' && document.querySelector('#text-line-spacing-slider')?.value==='1.8'"), 'restored typography controls')
  assert.deepEqual(await evaluate("[document.querySelector('#text-kerning').value,document.querySelector('#text-line-spacing').value]"), ['2.5', '1.8'], 'numeric fields and sliders both restore after reload')
  console.log('PASS text typography inspector: kerning and line spacing sliders sync with numeric controls and persist after reload/reopen')
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-text-typography-browser-')) for (let attempt = 0; attempt < 10; attempt += 1) { try { await rm(resolvedProfile, { recursive: true, force: true }); break } catch { await delay(100) } }
}
