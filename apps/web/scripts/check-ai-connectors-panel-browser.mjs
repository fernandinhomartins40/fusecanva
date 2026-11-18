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
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
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
async function waitFor(check, label, timeoutMs = 25000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {}; await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}

const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-ai-connectors-'))
let vite; let browser; let socket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/tests/fixtures/ai-connectors-panel.html`], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json().then(items => items.find(item => item.type === 'page' && item.url.includes('ai-connectors-panel.html'))), 'fixture page')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function pressKey(key, modifiers = {}) {
    const mask = (modifiers.alt ? 1 : 0) | (modifiers.ctrl ? 2 : 0) | (modifiers.meta ? 4 : 0) | (modifiers.shift ? 8 : 0)
    const keyCode = ({ Tab: 9, Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35 })[key] ?? key.toLowerCase().charCodeAt(0)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode, modifiers: mask })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode, modifiers: mask })
  }

  await waitFor(() => evaluate("!!document.querySelector('#open-connectors')"), 'fixture')
  await evaluate("document.querySelector('#open-connectors').click()")
  await waitFor(() => evaluate("!!document.querySelector('.ai-connectors-panel') && document.activeElement===document.querySelector('.ai-connectors-back')"), 'initial focus on Back')
  assert.equal(await evaluate("document.querySelectorAll('[role=menuitem]').length"), 18, 'directory renders the 18 observed provider entries')
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-connector-name')].map(name=>name.innerText.replace(/\\s+/g,' ').trim())"), [
    'Airtable Beta', 'Asana Beta', 'Atlassian Beta', 'Financial Datasets', 'Gmail', 'Google Calendar', 'Google Drive', 'Granola Beta', 'HubSpot Data Beta', 'Linear Beta', 'Microsoft 365 Beta', 'Microsoft Teams Beta', 'Miro Beta', 'Monday.com Beta', 'Notion', 'Outlook Beta', 'Slack Beta', 'Zoom Beta',
  ], 'provider names, visible Beta labels, and order match the bounded audit')
  assert.equal(await evaluate("[...document.querySelectorAll('[role=menuitem]')].every(row=>row.getAttribute('aria-label').includes('visualização') && !row.hasAttribute('aria-disabled'))"), true, 'connector rows select a local preview without advertising a live connection action')

  await pressKey('Tab')
  assert.equal(await evaluate("document.activeElement===document.querySelector('.ai-connectors-close')"), true, 'Tab from Back reaches Close')
  await pressKey('Tab')
  assert.equal(await evaluate("document.activeElement===document.querySelector('[aria-label=\"Buscar conectores\"]')"), true, 'Tab from Close reaches connector search')
  await pressKey('Tab')
  assert.equal(await evaluate("document.activeElement===document.querySelector('[role=menuitem]')"), true, 'Tab from search reaches Airtable')
  assert.equal(await evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineColor==='rgb(238, 238, 238)'"), true, 'keyboard focus on Airtable has a visible near-white outline')
  for (let index = 1; index < 18; index += 1) {
    await pressKey('Tab')
    assert.equal(await evaluate(`document.activeElement===document.querySelectorAll('[role=menuitem]')[${index}]`), true, `Tab advances to provider ${index + 1} in audited order`)
  }
  assert.equal(await evaluate("document.querySelector('.ai-connectors-list').scrollTop>0"), true, 'keyboard traversal scrolls the list to lower connectors')
  await pressKey('Tab')
  assert.equal(await evaluate("document.activeElement===document.querySelector('.ai-connectors-back')"), true, 'Tab from Zoom wraps focus to Back')
  assert.equal(await evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineColor==='rgb(238, 238, 238)'"), true, 'wrapped Back focus remains visibly outlined')
  await pressKey('Tab', { shift: true })
  assert.equal(await evaluate("document.activeElement===document.querySelectorAll('[role=menuitem]')[17]"), true, 'Shift+Tab from Back wraps to Zoom')
  for (let index = 0; index < 17; index += 1) await pressKey('Tab', { shift: true })
  assert.equal(await evaluate("document.activeElement===document.querySelector('[role=menuitem]')"), true, 'reverse traversal returns from Zoom to Airtable')

  await pressKey('ArrowDown')
  assert.equal(await evaluate("document.activeElement===document.querySelectorAll('[role=menuitem]')[1]"), true, 'ArrowDown advances through the connector menu')
  await pressKey('End')
  assert.equal(await evaluate("document.activeElement===document.querySelectorAll('[role=menuitem]')[17]"), true, 'End moves to the last connector')
  await pressKey('Home')
  assert.equal(await evaluate("document.activeElement===document.querySelector('[role=menuitem]')"), true, 'Home moves to the first connector')
  await pressKey('Enter')
  await waitFor(() => evaluate("document.querySelector('[role=menuitem]').getAttribute('aria-current')==='true'"), 'Enter selects a connector for local preview')
  assert.equal(await evaluate("document.querySelector('[role=menuitem]').getAttribute('aria-current')==='true'"), true, 'Enter selects a connector for local preview')
  assert.ok((await evaluate("document.querySelector('.ai-connectors-preview').textContent" )).includes('Nenhuma conexão foi iniciada'), 'selection preview states that no connection or data access occurred')
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(entry=>{try{return new URL(entry.name).origin!==location.origin}catch{return true}})"), false, 'local selection does not load external provider resources')
  await evaluate("document.querySelector('[aria-label=\"Buscar conectores\"]').focus()")
  await send('Input.insertText', { text: 'GOOGLE' })
  await waitFor(() => evaluate("document.querySelectorAll('[role=menuitem]').length===2"), 'filtered Google connector results')
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-connector-name')].map(node=>node.innerText.replace(/\\s+/g,' ').trim())"), ['Google Calendar', 'Google Drive'], 'search filters the local connector inventory in order')
  assert.ok((await evaluate("document.querySelector('.ai-connectors-result-count').textContent.trim()")).startsWith('2 de 18 conectores'), 'the live result count reflects the search')
  await evaluate("document.querySelector('[aria-label=\"Limpar busca\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('[role=menuitem]').length===18"), 'clear search restores all connectors')
  await evaluate("document.querySelector('[aria-label=\"Buscar conectores\"]').focus()")
  await send('Input.insertText', { text: 'sem resultados' })
  await waitFor(() => evaluate("document.querySelectorAll('[role=menuitem]').length===0 && !!document.querySelector('.ai-connectors-empty')"), 'empty search result state')
  assert.equal(await evaluate("document.querySelector('.ai-connectors-result-count').textContent.trim()"), '0 de 18 conectores', 'empty search is announced in the result count')
  await evaluate("document.querySelector('[aria-label=\"Limpar busca\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('[role=menuitem]').length===18"), 'clear empty search restores all connectors')
  await pressKey('Escape')
  await waitFor(() => evaluate("!document.querySelector('.ai-connectors-panel') && document.activeElement===document.querySelector('#ai-prompt')"), 'Escape returns focus to the AI prompt')

  await evaluate("document.querySelector('#open-connectors').click()")
  await waitFor(() => evaluate("!!document.querySelector('.ai-connectors-panel')"), 'directory opens before close-button focus check')
  await evaluate("document.querySelector('.ai-connectors-close').click()")
  await waitFor(() => evaluate("!document.querySelector('.ai-connectors-panel') && document.activeElement===document.querySelector('#ai-prompt')"), 'Close returns focus to the AI prompt')

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("document.querySelector('#open-connectors').click()")
  await waitFor(() => evaluate("!!document.querySelector('.ai-connectors-panel')"), 'mobile directory')
  const mobile = await evaluate("({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,listHeight:document.querySelector('.ai-connectors-list').clientHeight,contentHeight:document.querySelector('.ai-connectors-list').scrollHeight})")
  assert.ok(mobile.scroll <= mobile.client, `mobile fixture should not overflow horizontally: ${JSON.stringify(mobile)}`)
  assert.ok(mobile.contentHeight > mobile.listHeight, 'mobile directory keeps the provider list internally scrollable')
  const mobileTargets = await evaluate("[...document.querySelectorAll('.ai-connectors-back,.ai-connectors-close,.ai-connectors-search,.ai-connector-row')].map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height}})")
  assert.ok(mobileTargets.every(target=>target.width>=44 && target.height>=44), 'mobile connector actions meet 44px touch targets')
  await evaluate("document.querySelector('.ai-connectors-close').click()")
  await waitFor(() => evaluate("!document.querySelector('.ai-connectors-panel') && document.activeElement===document.querySelector('#ai-prompt')"), 'mobile Close restores prompt focus')
  console.log('AI connector panel browser checks passed: inventory, inert actions, keyboard focus and arrow navigation, Tab wrap, search/filter/clear/empty state, close/Escape focus return, and mobile targets/scrolling.')
} finally {
  socket?.close()
  for (const child of [browser, vite]) {
    if (!child || child.exitCode !== null || child.signalCode !== null) continue
    if (process.platform === 'win32') { try { const { execFileSync } = await import('node:child_process'); execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
}
