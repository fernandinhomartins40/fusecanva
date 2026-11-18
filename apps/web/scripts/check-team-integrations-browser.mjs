import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer as createTcpServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await import('node:fs/promises').then(({ access }) => access(candidate)); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the team integrations browser test.')

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {} await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 2000); child.once('exit', () => { clearTimeout(timer); resolve() }) })
}

const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-team-integrations-'))
let vite
let chrome
let browserSocket
let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/tests/team-integrations-harness.html`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1000,900', `http://127.0.0.1:${vitePort}/tests/team-integrations-harness.html`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('team-integrations-harness.html')), 'test page')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  async function setSearch(value) { await evaluate(`(()=>{const input=document.querySelector('[aria-label="Buscar integrações"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(80) }

  await waitFor(() => evaluate("document.querySelectorAll('.team-integration-card').length===8 && window.__teamRemoteGetCount===1 && document.querySelector('[aria-label=\"Slack\"]')?.getAttribute('aria-pressed')==='true'"), 'shared team preferences loaded')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Google Drive\"]')?.getAttribute('aria-pressed')"), 'false', 'the shared preference replaces the local initial fallback')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Slack\"]')?.getAttribute('aria-pressed')"), 'true', 'the selected state reflects the remote team preference')
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('Salvar prefer'))?.disabled"), true, 'loading remote preferences does not create a false local change')
  await setSearch('CALENDARIO')
  assert.equal(await evaluate("document.querySelectorAll('.team-integration-card').length===1 && document.querySelector('.team-integration-card strong')?.textContent==='Google Calendar'"), true, 'search matches normalized accent-insensitive tags')
  await evaluate("document.querySelector('[aria-label=\"Limpar busca\"]')?.click()")
  assert.equal(await evaluate("document.querySelectorAll('.team-integration-card').length"), 8, 'clear restores the full local sample catalog')
  await setSearch('sem resultado xyz')
  assert.equal(await evaluate("document.querySelector('[role=status]')?.textContent.includes('Nenhuma integração encontrada')"), true, 'no-results state is explicit')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Limpar busca')?.click()")
  assert.equal(await evaluate("document.querySelectorAll('.team-integration-card').length"), 8, 'clear from empty state restores all examples')

  await evaluate("document.querySelector('[aria-label=\"Figma\"]')?.click()")
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Figma\"]')?.getAttribute('aria-pressed')==='true' && document.querySelector('[aria-label=\"Figma\"]')?.classList.contains('is-selected')"), true, 'selection has visible and accessible state')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancelar')?.click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Slack\"]')?.getAttribute('aria-pressed')==='true' && document.querySelector('[aria-label=\"Figma\"]')?.getAttribute('aria-pressed')==='false'"), 'cancel restores the last persisted shared preference')
  assert.equal(await evaluate('window.__teamIntegrationSave ?? null'), null, 'cancel does not persist the draft selection')
  assert.equal(await evaluate('window.__teamRemotePutCount'), 0, 'cancel makes no remote policy request')
  assert.equal(await evaluate('window.__teamIntegrationCloseCount'), 1, 'cancel closes the panel')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Buscar integrações\"]')?.value"), '', 'cancel clears the transient query')

  await evaluate("document.querySelector('[aria-label=\"Figma\"]')?.click()")
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Salvar preferências')?.click()")
  await waitFor(() => evaluate('window.__teamRemotePutCount===1 && window.__teamIntegrationSave?.length===2'), 'shared preferences saved')
  assert.deepEqual(await evaluate('window.__teamIntegrationSave'), ['slack', 'figma'], 'save commits IDs in stable catalog order')
  assert.equal(await evaluate('window.__teamRemotePrefs.enabledIntegrations'), '[\"slack\",\"figma\"]', 'save persists the selection through the team policy endpoint')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobile = await evaluate("(()=>{const panel=document.querySelector('.team-integrations-panel').getBoundingClientRect();return{panelWidth:panel.width,viewport:innerWidth,gridColumns:getComputedStyle(document.querySelector('.team-integrations-grid')).gridTemplateColumns}})()")
  assert.ok(mobile.panelWidth <= mobile.viewport, `panel fits 390px viewport: ${JSON.stringify(mobile)}`)
  console.log('PASS team-integrations-filter-cancel: shared preference load, stable change detection, normalized search, explicit empty state, cancel without PUT, persisted save, and mobile width')
} finally {
  pageSocket?.close()
  browserSocket?.close()
  await stop(chrome)
  await stop(vite)
  if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profileDir).startsWith('fuse-team-integrations-')) await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
