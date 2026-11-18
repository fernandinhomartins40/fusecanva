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
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run this browser test.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label) { const end = Date.now() + 25000; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const vitePort = await freePort(); const cdpPort = await freePort(); const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-mobile-nav-'))
let vite; let browser; let socket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=390,844', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome')
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json().then(items => items.find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`))), 'page')
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await waitFor(() => evaluate("!!document.querySelector('.home-sidebar a[href=\"#home-projects\"]') && !document.querySelector('.home-loading')"), 'home library')
  assert.equal(await evaluate("matchMedia('(max-width: 700px)').matches"), true, 'mobile navigation breakpoint is active')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.home-sidebar')).position"), 'fixed', 'bottom navigation stays available while content scrolls')
  assert.equal(await evaluate("document.querySelector('.home-sidebar a[href=\"#home-top\"]')?.getAttribute('aria-current')"), 'page')
  await evaluate("document.querySelector('.home-sidebar a[href=\"#home-projects\"]')?.click()")
  await waitFor(() => evaluate("location.hash==='#home-projects' && document.querySelector('.home-sidebar a[href=\"#home-projects\"]')?.getAttribute('aria-current')==='page'"), 'projects selected')
  assert.equal(await evaluate("document.querySelector('.home-sidebar a[href=\"#home-projects\"]')?.classList.contains('active')"), true)
  await evaluate("document.querySelector('.home-sidebar a[href=\"#home-top\"]')?.click()")
  await waitFor(() => evaluate("location.hash==='#home-top' && document.querySelector('.home-sidebar a[href=\"#home-top\"]')?.getAttribute('aria-current')==='page'"), 'home selected')
  assert.equal(await evaluate("document.querySelector('.home-sidebar a[href=\"#home-projects\"]')?.hasAttribute('aria-current')"), false)
  await evaluate("document.querySelector('.home-sidebar a[href=\"#home-projects\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('.home-projects-heading')?.getBoundingClientRect().top < innerHeight"), 'projects section in view')
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, 'mobile round trip has no horizontal page overflow')
  await evaluate("document.querySelector('.home-projects-heading button')?.click()")
  await waitFor(() => evaluate("/^\\/design\\/[^/]+\\/edit$/.test(location.pathname) && !!document.querySelector('.studio-app')"), 'new project opens at its document route')
  const routeSnapshot = await evaluate("({url:location.pathname+location.search,id:decodeURIComponent(location.pathname.split('/')[2]),name:document.querySelector('.document-title input')?.value})")
  await evaluate('location.reload()')
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') && document.querySelector('.document-title input')?.value"), 'direct editor route reload')
  assert.deepEqual(await evaluate("({url:location.pathname+location.search,id:decodeURIComponent(location.pathname.split('/')[2]),name:document.querySelector('.document-title input')?.value})"), routeSnapshot, 'direct route reload restores the same document identity and title')
  assert.equal(await evaluate("matchMedia('(max-width: 700px)').matches && document.documentElement.scrollWidth <= innerWidth"), true, 'direct editor route remains responsive without horizontal page overflow')
  await evaluate("document.querySelector('.brand[aria-label=\\\"Salvar e voltar aos projetos\\\"]')?.click()")
  await waitFor(() => evaluate("!document.querySelector('.studio-app') && document.querySelector('.home-sidebar') && !location.pathname.startsWith('/design/')"), 'editor returns to the library route')
  await evaluate('history.back()')
  await waitFor(() => evaluate("/^\\/design\\/[^/]+\\/edit$/.test(location.pathname) && !!document.querySelector('.studio-app')"), 'browser Back restores the editor route')
  await evaluate('history.forward()')
  await waitFor(() => evaluate("!document.querySelector('.studio-app') && !location.pathname.startsWith('/design/')"), 'browser Forward restores the library route')
  console.log('PASS mobile Home/Projects navigation, direct editor URL and reload identity, browser Back/Forward, active accessibility state, fixed bottom bar, and no horizontal overflow at 390×844')
} finally {
  try { socket?.close() } catch {}
  for (const child of [browser, vite]) if (child && child.exitCode === null) { if (process.platform === 'win32') { try { (await import('node:child_process')).execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM') }
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
