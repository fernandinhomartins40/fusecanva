import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Chrome/Edge is required; set CHROME_PATH')

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label, timeoutMs = 25_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    try { (await import('node:child_process')).execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
}

const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-hover-roundtrip-'))
let vite
let chrome
let socket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json().then(items => items.find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`))), 'page target')
  socket = new WebSocket(target?.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  async function pointerMove(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }); await delay(180) }

  await waitFor(() => evaluate("!!document.querySelector('.home-projects-heading button') && !document.querySelector('.home-loading')"), 'local project library')
  await evaluate("document.querySelector('.home-projects-heading button').click()")
  await waitFor(() => evaluate("!!document.querySelector('#editor-tools-tab')"), 'editor tools tab')

  const documentSignals = () => evaluate("({url:location.href,pages:document.querySelectorAll('.page-footer').length,images:document.querySelectorAll('.canvas-viewport img').length,save:document.querySelector('.save-state')?.textContent?.trim()??null,selected:document.querySelectorAll('.canvas-viewport [data-selected=true]').length})")
  const initialSignals = await documentSignals()
  const results = []
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900, mobile: false }, { name: 'mobile-width-emulation', width: 390, height: 844, mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await delay(350)
    const probe = await evaluate("(()=>{const el=document.querySelector('#editor-tools-tab');if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {visible:!!(r.width&&r.height&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight),bounds:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},media:matchMedia('(max-width: 700px)').matches,text:el.innerText.trim(),ariaSelected:el.getAttribute('aria-selected'),title:el.getAttribute('title'),baseline:{color:s.color,background:s.backgroundColor,borderColor:s.borderColor,boxShadow:s.boxShadow,outline:s.outline}}})()")
    if (!probe?.visible) {
      results.push({ viewport: viewport.name, available: false, probe, documentSignals: await documentSignals() })
      continue
    }
    const center = { x: Math.round(probe.bounds.x + probe.bounds.width / 2), y: Math.round(probe.bounds.y + probe.bounds.height / 2) }
    await pointerMove(viewport.width - 5, viewport.height - 5)
    const baseline = await evaluate("(()=>{const el=document.querySelector('#editor-tools-tab'),s=getComputedStyle(el);return {hover:el.matches(':hover'),focus:document.activeElement===el,ariaSelected:el.getAttribute('aria-selected'),color:s.color,background:s.backgroundColor,borderColor:s.borderColor,boxShadow:s.boxShadow,outline:s.outline,tooltip:document.querySelector('[role=tooltip]')?.textContent?.trim()??null}})()")
    await pointerMove(center.x, center.y)
    const hovered = await evaluate("(()=>{const el=document.querySelector('#editor-tools-tab'),s=getComputedStyle(el);return {hover:el.matches(':hover'),focus:document.activeElement===el,ariaSelected:el.getAttribute('aria-selected'),color:s.color,background:s.backgroundColor,borderColor:s.borderColor,boxShadow:s.boxShadow,outline:s.outline,tooltip:document.querySelector('[role=tooltip]')?.textContent?.trim()??null}})()")
    await pointerMove(viewport.width - 5, viewport.height - 5)
    const exit = await evaluate("(()=>{const el=document.querySelector('#editor-tools-tab'),s=getComputedStyle(el);return {hover:el.matches(':hover'),focus:document.activeElement===el,ariaSelected:el.getAttribute('aria-selected'),color:s.color,background:s.backgroundColor,borderColor:s.borderColor,boxShadow:s.boxShadow,outline:s.outline,tooltip:document.querySelector('[role=tooltip]')?.textContent?.trim()??null}})()")
    const signals = await documentSignals()
    results.push({ viewport: viewport.name, available: true, probe, pointerCenter: center, baseline, hovered, exit, documentSignals: signals })
  }

  const desktop = results.find(item => item.viewport === 'desktop' && item.available)
  assert.ok(desktop, 'shared toolbar control is visible on the desktop viewport')
  assert.equal(desktop.baseline.hover, false, 'real pointer begins outside the toolbar control')
  assert.equal(desktop.hovered.hover, true, 'CDP mouse movement enters the identified toolbar control')
  assert.notEqual(desktop.hovered.background, desktop.baseline.background, 'hover visibly changes the control background')
  assert.equal(desktop.hovered.focus, false, 'pointer hover does not imply keyboard focus')
  assert.equal(desktop.hovered.ariaSelected, desktop.baseline.ariaSelected, 'hover leaves tab selection unchanged')
  assert.equal(desktop.exit.hover, false, 'moving to neutral surface exits hover')
  assert.equal(desktop.exit.background, desktop.baseline.background, 'background returns to baseline on pointer exit')
  assert.equal(desktop.exit.color, desktop.baseline.color, 'text/icon color returns to baseline on pointer exit')
  assert.deepEqual(desktop.documentSignals, initialSignals, 'hover roundtrip leaves document-level signals unchanged')
  for (const result of results.filter(item => item.available)) assert.equal(result.probe.ariaSelected, 'false', `${result.viewport} tab begins closed`)

  const mobile = results.find(item => item.viewport === 'mobile-width-emulation')
  assert.ok(mobile, 'mobile width probe ran')
  assert.equal(mobile.available, false, 'the desktop Ferramentas control is hidden at the measured mobile viewport')
  assert.deepEqual(mobile.documentSignals, initialSignals, 'mobile viewport probe leaves document-level signals unchanged')
  console.log(JSON.stringify({ result: 'PARTIAL_DESKTOP_ROUNDTRIP_MOBILE_CONTROL_HIDDEN', control: '#editor-tools-tab (Ferramentas tab)', method: 'Chromium CDP Input.dispatchMouseEvent mouseMoved', reference: 'No paired Canva fixture used; this records implementation behavior only.', initialDocumentSignals: initialSignals, viewports: results }, null, 2))
} finally {
  socket?.close()
  await stop(chrome)
  await stop(vite)
  if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profileDir).startsWith('fuse-hover-roundtrip-')) await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
