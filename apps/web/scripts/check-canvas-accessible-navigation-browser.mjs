import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the canvas accessibility browser check')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value }
async function waitFor(check, label) { const deadline = Date.now() + 30000; while (Date.now() < deadline) { try { const result = await check(); if (result) return result } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-canvas-a11y-'))
const vitePort = await freePort(), debugPort = await freePort()
let vite, chrome, socket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/tests/canvas-navigation-harness.html`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/tests/canvas-navigation-harness.html`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('canvas-navigation-harness.html')), 'page target')
  socket = new WebSocket(target?.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })) })
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await waitFor(() => evaluate("document.querySelectorAll('[role=option]').length===12"), 'canvas object list')
  assert.deepEqual(await evaluate("({role:document.querySelector('[role=listbox]').getAttribute('aria-label'),firstName:document.querySelector('[role=option]').getAttribute('aria-label'),selected:document.querySelectorAll('[aria-selected=true]').length})"), { role: 'Camadas da página', firstName: 'Título, texto: Festival de verão', selected: 1 })
  await evaluate("document.querySelector('[role=option]').focus()")
  const press = async (key, shiftKey = false) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, ...(shiftKey ? { modifiers: 8 } : {}) })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, ...(shiftKey ? { modifiers: 8 } : {}) })
  }
  await press('ArrowDown')
  assert.deepEqual(await evaluate("({focus:document.activeElement.dataset.canvasObjectId,selected:document.activeElement.getAttribute('aria-selected'),status:document.querySelector('[role=status]').textContent})"), { focus: 'photo', selected: 'true', status: 'Fotografia selecionado' })
  assert.equal(await evaluate("document.documentElement.dataset.canvasArrowCommands ?? '0'"), '0', 'listbox ArrowDown never reaches editor canvas-movement shortcuts')
  await press('Home')
  assert.equal(await evaluate("document.activeElement.dataset.canvasObjectId"), 'title')
  await press('ArrowDown', true)
  assert.equal(await evaluate("document.querySelectorAll('[aria-selected=true]').length"), 2, 'Shift+ArrowDown extends the selection')
  assert.equal(await evaluate("document.documentElement.dataset.canvasArrowCommands ?? '0'"), '0', 'range navigation never moves the selected artwork')
  await press('End')
  assert.deepEqual(await evaluate("({focus:document.activeElement.dataset.canvasObjectId,selected:document.activeElement.getAttribute('aria-selected')})"), { focus: 'shape-10', selected: 'true' })

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("window.dispatchEvent(new Event('resize'))")
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'mobile viewport has no horizontal overflow')
  await press('Home')
  await press('End')
  const mobile = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,focus:document.activeElement.dataset.canvasObjectId,scrollTop:document.querySelector('[role=listbox]').scrollTop,focusedWithinList:!!document.activeElement.closest('[role=listbox]')})")
  assert.equal(mobile.width, 390)
  assert.equal(mobile.scrollWidth, 390)
  assert.equal(mobile.focus, 'shape-10')
  assert.ok(mobile.scrollTop > 0, 'End scrolls the last object into view in the mobile layer list')
  assert.equal(mobile.focusedWithinList, true)
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=option]')).minHeight"), '44px', 'mobile layer rows meet a 44px touch target')
  console.log('PASS accessible canvas layers: named listbox, object descriptions, roving keyboard focus, selection, range selection, and 44px mobile touch targets with scrolling at 390px')
} finally {
  socket?.close()
  for (const child of [chrome, vite]) if (child?.pid) { try { if (process.platform === 'win32') { const { execFileSync } = await import('node:child_process'); execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } else child.kill('SIGTERM') } catch {} }
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
