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
const candidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of candidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Chrome/Edge is required; set CHROME_PATH')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-account-theme-'))
let api; let vite; let browser; let socket
try {
  api = spawn(process.execPath, [path.join(root, 'server/index.mjs')], { cwd: root, env: { ...process.env, PORT: String(vitePort + 1000), APP_ORIGINS: `http://127.0.0.1:${vitePort}`, STUDIO_DB_PATH: path.join(profile, 'theme.sqlite'), STUDIO_PUBLIC_APP_URL: `http://127.0.0.1:${vitePort}` }, windowsHide: true, stdio: 'ignore' })
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, env: { ...process.env, STUDIO_API_PORT: String(vitePort + 1000) }, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  const apiPort = vitePort + 1000
  await waitFor(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/health`).catch(() => null))?.ok, 'API')
  await fetch(`http://127.0.0.1:${apiPort}/api/auth/register`, { method: 'POST', headers: { origin: `http://127.0.0.1:${vitePort}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Theme QA', email: 'theme@example.test', password: 'ThemeTest123!' }) }).then(async response => { if (!response.ok) throw new Error(`Fixture account setup failed: ${response.status} ${await response.text()}`) })
  const browserPort = await freePort()
  browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${browserPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${browserPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json().then(items => items.find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`))), 'page target')
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`)
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row button') && !document.querySelector('.home-loading')"), 'home')
  await click('.home-signin'); await waitFor(() => evaluate("!!document.querySelector('.auth-dialog')"), 'login dialog')
  await evaluate("(()=>{const form=document.querySelector('.auth-dialog form');form.elements.email.value='theme@example.test';form.elements.password.value='ThemeTest123!';form.requestSubmit()})()")
  await click('.auth-submit'); await waitFor(() => evaluate("!!document.querySelector('.home-account')"), 'fixture account login')
  assert.equal(await evaluate("document.documentElement.dataset.theme"), 'dark', 'dark is the initial theme')
  await click('.home-account'); await waitFor(() => evaluate("!!document.querySelector('.account-theme-options')"), 'account theme options')
  assert.equal(await evaluate("document.querySelector('[role=menuitemradio][aria-checked=true]')?.textContent.includes('Escuro')"), true, 'current theme is exposed accessibly')
  await click('.account-theme-options button[aria-checked=false]'); await waitFor(() => evaluate("document.documentElement.dataset.theme==='light' && localStorage.getItem('fuse-account-theme')==='light'"), 'light theme persisted')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.home-shell')).backgroundColor"), 'rgb(250, 249, 252)', 'light theme changes the application surface')
  await click('.account-theme-options button[aria-checked=false]'); await waitFor(() => evaluate("document.documentElement.dataset.theme==='dark' && localStorage.getItem('fuse-account-theme')==='dark'"), 'dark theme restored')
  await evaluate('location.reload()'); await waitFor(() => evaluate("!!document.querySelector('.home-account') && document.documentElement.dataset.theme==='dark'"), 'dark theme survives reload')
  await click('.home-account'); await click('.account-theme-options button[aria-checked=false]'); await waitFor(() => evaluate("document.documentElement.dataset.theme==='light'"), 'light theme selected for reload')
  await evaluate('location.reload()'); await waitFor(() => evaluate("!!document.querySelector('.home-account') && document.documentElement.dataset.theme==='light'"), 'light theme survives reload')
  await click('.home-account'); await click('.account-theme-options button[aria-checked=false]'); await waitFor(() => evaluate("document.documentElement.dataset.theme==='dark'"), 'dark theme selected for mobile')
  await click('.home-account')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await waitFor(() => evaluate("innerWidth===390 && document.querySelector('.home-account')?.getBoundingClientRect().width>=44"), 'mobile account controls')
  const mobileHeader = await evaluate("(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {account:rect('.home-account'),notifications:rect('.home-notifications-trigger'),title:rect('.home-heading h1'),scrollWidth:document.documentElement.scrollWidth}})()")
  assert.ok([mobileHeader.account,mobileHeader.notifications].every(rect=>rect.width>=44 && rect.height>=44 && rect.left>=0 && rect.right<=390), 'mobile account and notifications are visible 44px touch targets')
  assert.ok(mobileHeader.scrollWidth<=390, 'mobile account header does not create horizontal overflow')
  assert.ok(mobileHeader.account.bottom<=mobileHeader.title.top || mobileHeader.account.left>=mobileHeader.title.right, 'account control does not overlap the mobile title')
  await click('.home-account')
  const mobileMenu = await evaluate("(()=>{const r=document.querySelector('.account-menu').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()")
  assert.ok(mobileMenu.left>=0 && mobileMenu.right<=390 && mobileMenu.bottom<=844, 'account menu remains inside the mobile viewport')
  console.log('Account theme browser checks passed: initial dark, accessible selected state, dark→light→dark, visible surface changes, local persistence and reload restoration.')
} finally {
  socket?.close()
  for (const child of [browser, vite, api]) { if (!child || child.exitCode !== null || child.signalCode !== null) continue; if (process.platform === 'win32') { try { const { execFileSync } = await import('node:child_process'); execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
}



