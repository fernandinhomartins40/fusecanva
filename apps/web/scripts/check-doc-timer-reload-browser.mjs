import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge não encontrado para o teste de timer Docs.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(120) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 5000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }
const webPort = await freePort(); let cdpPort = await freePort(); while (cdpPort === webPort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-doc-timer-'))
let vite; let chrome; let pageSocket; let browserSocket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${webPort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${webPort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); const target = targets.find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${webPort}`)); assert.ok(target)
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let nextId = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => { const id = ++nextId; const response = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return response }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await waitFor(() => evaluate("[...document.querySelectorAll('button')].some(button=>button.innerText.includes('Documento'))"), 'local library')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.innerText.includes('Documento')).click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.doc-editable-text')&&document.querySelector('.doc-footer-utilities'))"), 'A4 Docs editor')
  const readDocPages = () => evaluate("(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').getAll();req.onsuccess=()=>{const doc=req.result.find(item=>item.type==='doc');db.close();resolve(doc?.pages??null)};req.onerror=()=>reject(req.error)})})()")
  const initialPages = await waitFor(async () => { const pages = await readDocPages(); return pages?.length ? pages : null }, 'initial document saved')
  const timerToggle = "[...document.querySelectorAll('.doc-footer-utilities button')].find(button=>button.textContent.includes('Temporizador'))"
  assert.equal(await evaluate("Boolean(document.querySelector('.doc-bottom-panel-timer'))"), false, 'timer starts hidden')
  const restoredToggleState = await evaluate(`(()=>{const button=${timerToggle};return button?{text:button.textContent,pressed:button.getAttribute('aria-pressed'),buttons:[...document.querySelectorAll('.doc-footer-utilities button')].map(item=>item.textContent)}:null})()`)
  assert.equal(restoredToggleState?.pressed, 'false', `timer toggle is idle after reload: ${JSON.stringify(restoredToggleState)}`)
  await evaluate(`${timerToggle}?.click()`)
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Tempo restante\"]')?.textContent==='05:00'"), 'initial five-minute idle timer')
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Iniciar temporizador\"]')&&!document.querySelector('[aria-label=\"Pausar temporizador\"]')"), true, 'the timer is idle with Start and without Pause')
  await evaluate("document.querySelector('[aria-label=\"Aumentar um minuto\"]').click()")
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Tempo restante\"]')?.textContent"), '06:00', 'the plus-minute action changes the timer to six minutes')
  assert.deepEqual(await readDocPages(), initialPages, 'adjusting the timer does not edit the A4 document content')
  await evaluate('location.reload()')
  await waitFor(() => evaluate("Boolean(document.querySelector('.doc-editable-text')&&document.querySelector('.doc-footer-utilities'))"), 'A4 editor restored at its direct route after one reload')
  assert.equal(await evaluate("Boolean(document.querySelector('.doc-bottom-panel-timer'))"), false, 'timer panel is hidden after reload')
  assert.equal(await evaluate(`${timerToggle}?.getAttribute('aria-pressed')`), 'false')
  await evaluate(`${timerToggle}?.click()`)
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Tempo restante\"]')?.textContent==='05:00'"), 'idle timer returns to five minutes when reopened')
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Iniciar temporizador\"]')&&!document.querySelector('[aria-label=\"Pausar temporizador\"]')"), true, 'reopened timer is stopped')
  await evaluate("document.querySelector('.doc-bottom-panel [aria-label=\"Fechar painel inferior\"]').click()")
  assert.equal(await evaluate("Boolean(document.querySelector('.doc-bottom-panel-timer'))"), false, 'timer is hidden at the end of the case')
  assert.deepEqual(await readDocPages(), initialPages, 'document page content remains identical across the full timer case')
  console.log('PASS idle Docs timer 05:00→06:00→single reload→hidden 05:00 idle reopen; document pages unchanged')
} finally {
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999998, method: 'Browser.close' })) } catch {} }
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (error) { console.warn(`Could not remove temporary Chrome profile: ${error.message}`) }
}
