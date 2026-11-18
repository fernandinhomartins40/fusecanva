import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the team domain draft browser test')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-team-domain-draft-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  const origin = `http://127.0.0.1:${vitePort}`; const settingsUrl = `${origin}/settings/sso/domain-verification`
  await waitFor(async () => (await fetch(settingsUrl).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,720', settingsUrl], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'CDP startup')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith(settingsUrl)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0; const pending = new Map(); pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const result = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  async function navigate(url) { await send('Page.navigate', { url }); await waitFor(() => evaluate("document.readyState==='complete' && !!document.querySelector('h1')"), `navigation ${url}`) }

  await waitFor(() => evaluate("document.querySelector('h1')?.textContent.includes('SSO')"), 'team SSO page')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Adicionar domínio').click()")
  await waitFor(() => evaluate("!!document.querySelector('[role=dialog]')"), 'empty domain dialog')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Domínio\"]').value"), '')
  assert.equal(await evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), true, 'empty field disables submit')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Domínio\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'example.invalid');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  assert.equal(await evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), false, 'nonempty draft enables submit')
  await evaluate("document.querySelector('[aria-label=Fechar]').click()")
  assert.equal(await evaluate("!document.querySelector('[role=dialog]')"), true, 'close dismisses dialog')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Adicionar domínio').click()")
  await waitFor(() => evaluate("!!document.querySelector('[role=dialog]')"), 'same-page reopen')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Domínio\"]').value"), 'example.invalid', 'same-page reopen preserves the unsent draft')
  await evaluate("document.querySelector('[aria-label=Fechar]').click()")
  await navigate(origin + '/')
  await navigate(settingsUrl)
  assert.equal(await evaluate("!document.querySelector('[role=dialog]')"), true, 'fresh navigation starts with dialog closed')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Adicionar domínio').click()")
  await waitFor(() => evaluate("!!document.querySelector('[role=dialog]')"), 'fresh-navigation dialog')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Domínio\"]').value"), '', 'fresh navigation clears draft')
  assert.equal(await evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), true)
  await send('Page.reload')
  await waitFor(() => evaluate("document.readyState==='complete' && !!document.querySelector('h1')"), 'reload')
  assert.equal(await evaluate("!document.querySelector('[role=dialog]')"), true, 'reload ends with dialog closed')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Adicionar domínio').click()")
  await waitFor(() => evaluate("!!document.querySelector('[role=dialog]')"), 'post-reload dialog')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Domínio\"]').value"), '', 'reload opens with empty draft')
  assert.equal(await evaluate("document.querySelector('[role=dialog] button[type=submit]').disabled"), true)
  await evaluate("document.querySelector('[aria-label=Fechar]').click()")
  assert.equal(await evaluate("!document.querySelector('[role=dialog]')"), true, 'final dialog is closed')
  console.log(JSON.stringify({ pass: true, case: 'domain-draft-close-reopen-reset', verified: ['empty disabled', 'nonempty enabled', 'same-page reopen retains draft', 'fresh navigation resets', 'reload resets and final dialog closed'], limits: ['No domain submitted', 'No DNS challenge or server validation', 'No SSO configuration executed', 'Draft mechanism and cross-tab behavior not asserted'] }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  for (let attempt = 0; attempt < 5; attempt++) { try { await rm(profile, { recursive: true, force: true }); break } catch { if (attempt < 4) await delay(250) } }
}
