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
async function findChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the editor zoom browser check.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { const { execFileSync } = await import('node:child_process'); try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 2000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const chromePath = await findChrome()
const vitePort = await freePort(), cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-editor-zoom-browser-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,720', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
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

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  const fixture = { id: 'editor-zoom-browser', name: 'A4 zoom roundtrip fixture', type: 'design', width: 794, height: 1123, updatedAt: '2026-01-02T03:04:05.000Z', pages: [{ id: 'zoom-page-1', name: 'Página 1', background: '#ffffff', elements: [{ id: 'zoom-shape-1', type: 'shape', name: 'Preserved shape', shape: 'rect', x: 74, y: 96, width: 220, height: 135, rotation: 0, fill: '#7657e8', cornerRadius: 8 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded A4 fixture')
  await evaluate("document.querySelector('.project-open')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.save-state') && !!document.querySelector('.page-footer') && !!document.querySelector('[role=combobox]')"), 'A4 editor with labelled zoom combobox')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'initial save status')

  const readDocument = () => evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('editor-zoom-browser');get.onsuccess=()=>{db.close();resolve(get.result)};get.onerror=()=>reject(get.error)}})")
  const originalDocument = await readDocument()
  assert.deepEqual(originalDocument, fixture, 'fixture is loaded without changing its document model')
  const originalSignals = await evaluate("({save:document.querySelector('.save-state')?.textContent.trim(),page:document.querySelector('.page-footer span')?.textContent.trim(),pages:document.querySelectorAll('.page-footer').length,viewport:[innerWidth,innerHeight]})")
  assert.deepEqual(originalSignals, { save: 'Salvo neste dispositivo', page: 'Página 1 de 1', pages: 1, viewport: [1280, 720] }, 'the browser uses the audited viewport and one-page saved A4 fixture')

  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Configurações avançadas'))?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.pdf-advanced-settings')"), 'PDF advanced settings')
  assert.equal(await evaluate("document.querySelectorAll('.pdf-advanced-settings input[type=checkbox]').length"), 7, 'the audited advanced panel exposes seven switches')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Predefinição PDF\"]')?.value"), 'digital', 'Digital preset is selected')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Páginas PDF\"]')?.value"), 'all', 'all pages are selected')
  assert.equal(await evaluate("document.querySelectorAll('.pdf-advanced-settings input[type=checkbox]:disabled').length"), 5, 'unsupported semantics are disabled')
  await evaluate("[...document.querySelectorAll('.pdf-advanced-settings label')].find(label=>label.textContent.includes('Proteção por senha'))?.querySelector('input')?.click()")
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Senha sugerida\"]')"), true, 'password toggle exposes a suggested password')
  assert.equal(await evaluate("document.querySelector('.pdf-password-controls [role=status]')?.textContent"), 'Senha forte', 'password strength is assessed')
  assert.match(await evaluate("document.querySelector('[aria-label=\"Senha sugerida\"]')?.value ?? ''"), /^[A-Za-z0-9]{16}$/, 'suggested value is generated locally')
  assert.match(await evaluate("document.querySelector('.pdf-password-controls p')?.textContent ?? ''"), /criptografia de PDF não está implementada/i, 'unsupported encryption is explained')
  await evaluate("[...document.querySelectorAll('.pdf-advanced-settings label')].find(label=>label.textContent.includes('Proteção por senha'))?.querySelector('input')?.click()")
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Senha sugerida\"]')"), false, 'turning password off removes the password field')
  assert.deepEqual(await readDocument(), originalDocument, 'PDF preference toggles leave the persisted document unchanged')

  const combo = '[role="combobox"]'
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(combo)}).getAttribute('aria-label') ?? ''`), /zoom/i, 'zoom control has a descriptive accessible label')
  const openMenu = async () => {
    await evaluate(`document.querySelector(${JSON.stringify(combo)}).focus()`)
    await evaluate(`document.querySelector(${JSON.stringify(combo)}).click()`)
    await waitFor(() => evaluate("!!document.querySelector('[role=listbox]')"), 'zoom options listbox')
  }
  const optionText = () => evaluate("[...document.querySelectorAll('[role=listbox] [role=option]')].map(option=>option.textContent.trim())")
  const selectedOption = () => evaluate("document.querySelector('[role=listbox] [role=option][aria-selected=true]')?.textContent.trim() ?? null")
  await openMenu()
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(combo)}).getAttribute('aria-expanded')`), 'true', 'zoom combobox reports expanded state')
  assert.deepEqual(await optionText(), ['Ver inteiro', 'Ajustar ao editor', '300%', '200%', '125%', '100%', '75%', '50%', '25%', '10%'], 'menu exposes all observed fit and percentage options')
  await evaluate("document.querySelector('[role=listbox] [role=option]')?.focus()")
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(() => evaluate("!document.querySelector('[role=listbox]')"), 'Escape closes zoom listbox')
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(combo)})`), true, 'Escape restores focus to the zoom combobox')

  await openMenu()
  assert.equal(await selectedOption(), 'Ver inteiro', 'fit-to-page option is selected at the baseline checkpoint')
  await evaluate("[...document.querySelectorAll('[role=listbox] [role=option]')].find(option=>option.textContent.trim()==='100%').click()")
  await waitFor(() => evaluate("!document.querySelector('[role=listbox]') && document.querySelector('[role=combobox]')?.textContent.includes('100%')"), '100% selection closes menu and updates zoom')
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(combo)})`), true, 'choosing a zoom value restores focus to its combobox')
  await openMenu()
  assert.equal(await selectedOption(), '100%', 'reopening the listbox marks 100% as selected')
  await evaluate("[...document.querySelectorAll('[role=listbox] [role=option]')].find(option=>option.textContent.trim()==='Ver inteiro').click()")
  await waitFor(() => evaluate("!document.querySelector('[role=listbox]') && document.querySelector('[role=combobox]')?.getAttribute('aria-valuetext')"), 'fit-to-page closes menu and updates displayed zoom')
  assert.equal(await evaluate("document.querySelector('[role=combobox]')?.getAttribute('aria-valuetext')"), '54%', 'fit-to-page restores the A4 fixture to 54% at the audited viewport')
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(combo)})`), true, 'fit selection restores focus to its combobox')

  await openMenu()
  await evaluate("document.querySelector('[role=listbox] [role=option][aria-selected=true]')?.focus()")
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  assert.equal(await evaluate("document.activeElement?.textContent.trim()"), 'Ajustar ao editor', 'ArrowDown moves focus to the next zoom option')
  await evaluate("[...document.querySelectorAll('[role=listbox] [role=option]')].find(option=>option.textContent.trim()==='Ajustar ao editor').click()")
  await waitFor(() => evaluate("!document.querySelector('[role=listbox]') && document.querySelector('[role=combobox]')?.getAttribute('aria-valuetext')"), 'fit-editor closes menu and updates displayed zoom')
  const fitEditorValue = await evaluate("parseFloat(document.querySelector('[role=combobox]')?.getAttribute('aria-valuetext') ?? '0')")
  assert.ok(fitEditorValue > 54 && fitEditorValue <= 100, `fit-editor fills more of the available area than fit-page (${fitEditorValue}%)`)
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(combo)})`), true, 'fit-editor selection restores focus to its combobox')
  await openMenu()
  assert.equal(await selectedOption(), 'Ajustar ao editor', 'reopening preserves the selected fit-editor mode')
  await evaluate("[...document.querySelectorAll('[role=listbox] [role=option]')].find(option=>option.textContent.trim()==='Ver inteiro').click()")
  await waitFor(() => evaluate("!document.querySelector('[role=listbox]') && document.querySelector('[role=combobox]')?.getAttribute('aria-valuetext')==='54%'"), 'restore fit-page after fit-editor check')

  const afterDocument = await readDocument()
  assert.deepEqual(afterDocument, originalDocument, 'zoom changes viewport scale only; all persisted document model bytes/fields remain unchanged')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo')"), 'saved state after zoom roundtrip')
  const finalSignals = await evaluate("({save:document.querySelector('.save-state')?.textContent.trim(),page:document.querySelector('.page-footer span')?.textContent.trim(),pages:document.querySelectorAll('.page-footer').length,zoom:document.querySelector('[role=combobox]')?.textContent.trim()})")
  assert.deepEqual(finalSignals, { save: originalSignals.save, page: originalSignals.page, pages: originalSignals.pages, zoom: '54%' }, 'save status and 1/1 page count remain unchanged through the zoom roundtrip')
  console.log('PASS editor zoom control: 1280x720 A4 fixture, complete options, Escape and focus return, 100% selection/reopen state, 54% fit, unchanged IndexedDB model/save/page count')
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-editor-zoom-browser-')) for (let attempt = 0; attempt < 10; attempt += 1) { try { await rm(resolvedProfile, { recursive: true, force: true }); break } catch { await delay(100) } }
}
