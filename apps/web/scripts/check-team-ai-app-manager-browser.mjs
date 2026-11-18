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
assert.ok(chromePath, 'Set CHROME_PATH to run the team AI app manager browser test')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-team-ai-app-manager-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  const origin = `http://127.0.0.1:${vitePort}`; const appUrl = `${origin}/settings/apps/manage-ai-apps`
  await waitFor(async () => (await fetch(appUrl).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', appUrl], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'CDP startup')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith(appUrl)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0; const pending = new Map(); pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const result = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await waitFor(() => evaluate("!!document.querySelector('.team-ai-manager-shell')"), 'AI app manager')
  assert.equal(await evaluate("document.querySelector('h1')?.textContent"), 'Apps do Canva IA')
  assert.equal(await evaluate("document.querySelectorAll('.team-ai-app-row').length"), 18, 'full observed admin catalog renders')
  await evaluate("document.querySelector('[aria-label=\\\"Ações para Google Drive\\\"]').click()")
  assert.equal(await evaluate("document.querySelectorAll('[role=menu] [role=menuitem]').length"), 2, 'Google Drive exposes two actions')
  assert.equal(await evaluate("document.querySelector('[role=menuitem]').getAttribute('aria-disabled')"), 'true', 'unobserved actions are inert')
  await evaluate("document.querySelector('[aria-label=\\\"Ações para Google Drive\\\"]').focus()")
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  assert.equal(await evaluate("!!document.querySelector('[role=menu]')"), true, 'Escape on trigger leaves menu exposed')
  await evaluate("(()=>{const i=document.querySelector('[aria-label=\\\"Pesquisar apps do Canva IA\\\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Google');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelectorAll('.team-ai-app-row').length===2 && !document.querySelector('[role=menu]')"), 'search results')
  await evaluate("document.querySelector('[aria-label=\\\"Limpar busca\\\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.team-ai-app-row').length===18"), 'clear restores app set')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Ações para Google Drive\\\"]').getAttribute('aria-expanded')"), 'false')
  const openDriveDetails = async () => {
    await evaluate("document.querySelector('.team-ai-app-row .team-ai-app-actions > button').click()")
    await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.trim()==='Ver detalhes do app').click()")
    await waitFor(() => evaluate("!!document.querySelector('[role=dialog][aria-labelledby=team-ai-details-title]')"), 'Google Drive details dialog')
  }
  await openDriveDetails()
  assert.equal(await evaluate("document.querySelector('#team-ai-details-title')?.textContent"), 'Google Drive', 'details disclose the selected app')
  assert.equal(await evaluate("document.querySelector('.team-ai-connection-state')?.textContent"), 'Não conectado', 'the UI does not imply an external connection')
  assert.equal(await evaluate("document.querySelectorAll('.team-ai-permissions li').length"), 2, 'both audited design permissions are disclosed')
  assert.equal(await evaluate("document.querySelector('.team-ai-details-footer button')?.textContent"), 'Usar no Canva IA', 'the audited AI-use CTA is visible')
  assert.equal(await evaluate("document.querySelector('.team-ai-details-footer button')?.disabled"), true, 'AI use is unavailable until a provider connection exists')
  assert.equal(await evaluate("document.querySelector('.team-ai-promo-controls span')?.textContent"), '1 de 2', 'promotional carousel starts at image one')
  assert.equal(await evaluate("document.activeElement===document.querySelector('.team-ai-details-header button')"), true, 'dialog moves focus to its close control')
  await evaluate("document.querySelector('.team-ai-promo-controls button:last-child').click()")
  await waitFor(() => evaluate("document.querySelector('.team-ai-promo-controls span')?.textContent==='2 de 2'"), 'carousel next image')
  assert.equal(await evaluate("document.querySelector('.team-ai-promo')?.getAttribute('aria-label')"), 'Imagem promocional 2 de 2', 'second promotional image is announced')
  assert.equal(await evaluate("document.querySelectorAll('.team-ai-permissions li').length"), 2, 'carousel navigation preserves the permission disclosure')
  await evaluate("document.querySelector('.team-ai-promo-controls button:first-child').click()")
  assert.equal(await evaluate("document.querySelector('.team-ai-promo-controls span')?.textContent"), '1 de 2', 'previous control returns to image one')
  await evaluate("document.querySelector('.team-ai-details-header button').click()")
  await waitFor(() => evaluate("!document.querySelector('[role=dialog][aria-labelledby=team-ai-details-title]')"), 'close details dialog')
  await waitFor(() => evaluate("document.activeElement===document.querySelector('.team-ai-app-row .team-ai-app-actions > button')"), 'close button restores focus to the Google Drive action trigger')
  await openDriveDetails()
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(() => evaluate("!document.querySelector('[role=dialog][aria-labelledby=team-ai-details-title]')"), 'Escape closes details dialog')
  await waitFor(() => evaluate("document.activeElement===document.querySelector('.team-ai-app-row .team-ai-app-actions > button')"), 'Escape restores focus to the Google Drive action trigger')
  await evaluate("(()=>{const i=document.querySelector('[aria-label=\\\"Pesquisar apps do Canva IA\\\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'REA-APP-IA-INEXISTENTE-20261016-9QZ');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelectorAll('.team-ai-app-row').length===0"), 'unmatched query')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate("document.documentElement.scrollWidth<=390"), true, 'no horizontal overflow at 390px')
  console.log(JSON.stringify({ pass: true, case: 'ai-admin-app-details-carousel-close', verified: ['18 catalog entries and existing search behavior', 'Google Drive provider and two audited permissions disclosed', 'two-image promotional carousel supports forward and reverse', 'AI-use CTA visible but disabled while provider is not connected', 'close button and Escape dismiss dialog and restore focus', '390px no horizontal overflow'], limits: ['No OAuth, external app use, file access, upload, or permission mutation occurred', 'Promotional panels are local illustrative UI, not source-provider media', 'Other providers remain inert because their details were not audited'] }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  for (let attempt = 0; attempt < 5; attempt++) { try { await rm(profile, { recursive: true, force: true }); break } catch { if (attempt < 4) await delay(250) } }
}
