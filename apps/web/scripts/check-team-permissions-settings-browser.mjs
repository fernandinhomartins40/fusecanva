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
assert.ok(chromePath, 'Set CHROME_PATH to run the team permissions browser test')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-team-permissions-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  const origin = `http://127.0.0.1:${vitePort}`; const settingsUrl = `${origin}/settings/permissions`
  await waitFor(async () => (await fetch(settingsUrl).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', settingsUrl], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'CDP startup')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith(settingsUrl)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0; const pending = new Map(); pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const result = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  async function navigate(url) { await send('Page.navigate', { url }); await waitFor(() => evaluate("document.readyState==='complete' && !!document.querySelector('h1')"), `navigation ${url}`) }

  await waitFor(() => evaluate("document.querySelector('h1')?.textContent==='Permissões'"), 'permissions page')
  assert.equal(await evaluate("document.querySelectorAll('.team-policy-row [role=combobox]').length"), 38, 'all 38 observed permission selectors render')
  assert.equal(await evaluate("document.querySelector('a[href=\\\"/settings/permissions\\\"]')?.getAttribute('aria-current')"), 'page', 'Permissions is current in settings navigation')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"]')?.getAttribute('role')"), 'combobox')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"] span')?.textContent"), 'Todo mundo')
  await evaluate("(()=>{const i=document.querySelector('[aria-label=\\\"Buscar permissões\\\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Canva IA');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await delay(100)
  assert.ok(await evaluate("document.querySelectorAll('.team-policy-row').length>0 && document.querySelectorAll('.team-policy-row').length<38"), 'search filters the permission inventory')
  await evaluate("(()=>{const i=document.querySelector('[aria-label=\\\"Buscar permissões\\\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await delay(100)
  await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('#policy-31-listbox [role=option]').length===4"), 'download role options')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"]').getAttribute('aria-expanded')"), 'false', 'Escape closes the listbox')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"] span')?.textContent"), 'Todo mundo', 'Escape leaves the policy unchanged')
  assert.equal(await evaluate("localStorage.getItem('fuse-team-permissions-v1')"), null, 'inspection does not persist or apply a policy')
  await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('#policy-31-listbox [role=option]')"), 'policy options before cancel')
  await evaluate("[...document.querySelectorAll('#policy-31-listbox [role=option]')].find(x=>x.textContent==='Ninguém').click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"] span')?.textContent==='Ninguém'"), 'draft change')
  await evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Cancelar').click()")
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"] span')?.textContent"), 'Todo mundo', 'Cancel restores saved value')
  assert.equal(await evaluate("localStorage.getItem('fuse-team-permissions-v1')"), null, 'cancel does not write draft')
  await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"]').click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"]').getAttribute('aria-expanded')==='true' && document.activeElement?.getAttribute('role')==='option'"), 'policy option focus before keyboard selection')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await waitFor(() => evaluate("document.activeElement?.textContent==='Ninguém'"), 'End moves to final option')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  await waitFor(() => evaluate("document.activeElement?.textContent==='Todo mundo'"), 'Home moves to first option')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await waitFor(() => evaluate("document.activeElement?.textContent==='Admins e designers de marca da equipe'"), 'ArrowDown moves option focus')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await waitFor(() => evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"] span')?.textContent==='Admins e designers de marca da equipe'"), 'Enter selects focused option')
  await waitFor(() => evaluate("!document.querySelector('.team-settings-save').disabled"), 'save enabled for changed draft')
  await evaluate("document.querySelector('.team-settings-save').click()")
  await waitFor(() => evaluate("JSON.parse(localStorage.getItem('fuse-team-permissions-v1')||'{}')['Quem pode baixar designs ou seleções?']==='Admins e designers de marca da equipe'"), 'local permission save')
  await navigate(settingsUrl)
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode baixar designs ou seleções?\\\"] span')?.textContent"), 'Admins e designers de marca da equipe', 'explicitly saved local policy survives reload')
  await navigate(origin + '/settings/controls')
  assert.equal(await evaluate("document.querySelector('h1')?.textContent==='Controles'"), true)
  await evaluate("document.querySelector('[aria-label=\\\"Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?\\\"]').click()")
  await waitFor(() => evaluate("document.querySelector('#team-upload-scope').getAttribute('aria-expanded')==='true' && document.querySelectorAll('#team-upload-scope-listbox [role=option]').length===2 && document.activeElement?.getAttribute('role')==='option'"), 'upload options and focus')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?\\\"]')?.getAttribute('aria-expanded')"), 'false', 'Escape closes the upload listbox')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?\\\"] span')?.textContent"), 'Todo mundo', 'Escape leaves the upload scope unchanged')
  await evaluate("document.querySelector('[aria-label=\\\"Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?\\\"]').click()")
  await waitFor(() => evaluate("document.querySelector('#team-upload-scope').getAttribute('aria-expanded')==='true' && document.activeElement?.getAttribute('role')==='option'"), 'upload options before keyboard save')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await waitFor(() => evaluate("document.activeElement?.textContent==='Admins e designers de marca da equipe'"), 'ArrowDown selects the next upload option')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await waitFor(() => evaluate("document.querySelector('#team-upload-scope span')?.textContent==='Admins e designers de marca da equipe'"), 'Space selects focused upload option')
  await waitFor(() => evaluate("!document.querySelector('.team-settings-save').disabled"), 'upload save enabled')
  await evaluate("document.querySelector('.team-settings-save').click()")
  await waitFor(() => evaluate("JSON.parse(localStorage.getItem('fuse-team-permissions-v1')||'{}').upload==='Admins e designers de marca da equipe'"), 'local upload save')
  await navigate(origin + '/settings/controls')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?\\\"] span')?.textContent"), 'Admins e designers de marca da equipe', 'saved local upload scope survives reload')
  await evaluate("document.querySelector('#team-upload-scope').click()")
  await waitFor(() => evaluate("document.querySelector('#team-upload-scope').getAttribute('aria-expanded')==='true' && document.activeElement?.getAttribute('role')==='option'"), 'upload listbox focus before Tab')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await waitFor(() => evaluate("document.querySelector('#team-upload-scope').getAttribute('aria-expanded')==='false'"), 'Tab closes listbox after focus leaves')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate("document.documentElement.scrollWidth<=390"), true, 'controls page has no horizontal overflow at 390px')
  console.log(JSON.stringify({ pass: true, case: 'team-download-policy-inspect-cancel + team-upload-scope-cancel', verified: ['38 permission comboboxes', 'current navigation state', 'four download options and two upload options', 'search', 'arrows and Enter select by keyboard', 'Escape closes and returns focus without changing value', 'Tab away closes the listbox', 'cancel discards draft without storage write', 'unauthenticated local fallback persists across reloads', '390px no horizontal overflow'], limits: ['This standalone browser flow has no signed-in team; authenticated upload policy persistence and enforcement are covered by api.test.mjs', 'Brand designer remains represented by the admin role only', 'Visual comparison and full route shell are pending'] }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  for (let attempt = 0; attempt < 5; attempt++) { try { await rm(profile, { recursive: true, force: true }); break } catch { if (attempt < 4) await delay(250) } }
}
