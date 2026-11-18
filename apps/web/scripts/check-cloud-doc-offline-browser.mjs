import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the cloud Docs offline recovery browser check')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const apiPort = await freePort()
const webPort = await freePort()
const cdpPort = await freePort()
const origin = `http://127.0.0.1:${webPort}`
const apiOrigin = `http://127.0.0.1:${apiPort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-cloud-doc-offline-'))
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [origin], invitationEmailSender: async () => ({ status: 'link-only', reason: 'test-sandbox' }) })
await new Promise((resolve, reject) => apiServer.listen(apiPort, '127.0.0.1', resolve).once('error', reject))
let vite, chrome, browserSocket, pageSocket

async function apiRequest(pathname, { method = 'GET', cookie, body } = {}) {
  const headers = { origin }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${apiOrigin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, payload: await response.json(), setCookie: response.headers.get('set-cookie') }
}

try {
  const password = 'Fuse-Docs-Offline-Test-42'
  const email = 'docs-offline@example.test'
  const registered = await apiRequest('/api/auth/register', { method: 'POST', body: { name: 'Docs Offline Owner', email, password } })
  assert.equal(registered.status, 201, 'synthetic .example.test account registers against the local in-memory server')
  const login = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  const cookie = login.setCookie?.split(';')[0]
  assert.ok(cookie?.startsWith('fuse_session='))

  const name = 'Offline Docs fixture'
  const originalText = 'Original document text'
  const offlineText = 'Original document text edited while offline'
  const data = { type: 'doc', width: 794, height: 1123, pages: [{ id: 'offline-doc-page', name: 'Page 1', background: '#ffffff', elements: [], blocks: [{ id: 'offline-doc-paragraph', type: 'paragraph', text: originalText, marks: [] }] }] }
  const created = await apiRequest('/api/documents', { method: 'POST', cookie, body: { name, data } })
  assert.equal(created.status, 201, 'synthetic Docs document is created locally')
  const documentId = created.payload.id
  const initialRemote = await apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { cookie })
  assert.equal(initialRemote.payload.revision, 1)

  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: root, env: { ...process.env, STUDIO_API_PORT: String(apiPort) }, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), 'blank Chrome page')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let commandId = 0
  const pending = new Map()
  let apiOffline = false
  pageSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
    if (message.method === 'Fetch.requestPaused') {
      const requestId = message.params.requestId
      const pathname = new URL(message.params.request.url).pathname
      if (apiOffline && pathname.startsWith('/api/')) void send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {})
      else void send('Fetch.continueRequest', { requestId }).catch(() => {})
    }
  })
  async function send(method, params = {}) { const id = ++commandId; const response = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); const result = await response; if (result.error) throw new Error(`${method}: ${result.error.message}`); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function pressKey(key, code, virtualKey, modifiers = 0) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers }) }

  await send('Network.enable')
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__activeEventSource=null;window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);window.__activeEventSource=this}}" })
  await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: `${origin}/design/${encodeURIComponent(documentId)}/edit?storage=cloud` })
  await waitFor(() => evaluate("Boolean(document.querySelector('.studio-app') && document.querySelector('.doc-editable-text'))"), 'cloud Docs editor load')
  await waitFor(() => evaluate(`document.querySelector('.doc-editable-text')?.innerText.trim()===${JSON.stringify(originalText)}`), 'original block text appears')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'initial cloud document is settled')

  apiOffline = true
  await evaluate(`(()=>{const field=document.querySelector('.doc-editable-text');field.focus();const range=document.createRange();range.selectNodeContents(field);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)})()`)
  await send('Input.insertText', { text: ' edited while offline' })
  await waitFor(() => evaluate(`document.querySelector('.doc-editable-text')?.innerText.trim()===${JSON.stringify(offlineText)}`), 'offline Docs block edit is rendered')
  const readDraft = () => evaluate(`(async()=>{const request=indexedDB.open('fuse-studio');const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});try{return await new Promise((resolve,reject)=>{const read=db.transaction('cloudDrafts','readonly').objectStore('cloudDrafts').get(${JSON.stringify(documentId)});read.onsuccess=()=>resolve(read.result??null);read.onerror=()=>reject(read.error)})}finally{db.close()}})()`)
  const durableDraft = await waitFor(async () => { const draft = await readDraft(); return draft?.document?.pages?.[0]?.blocks?.[0]?.text === offlineText ? draft : null }, 'offline block text is durably stored in IndexedDB')
  assert.equal(durableDraft.baseRevision, 1, 'cloud draft is based on the initial server revision')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Falha ao salvar')"), 'offline save failure is visible')
  const remoteWhileOffline = await apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { cookie })
  assert.equal(remoteWhileOffline.payload.revision, 1, 'server revision remains unchanged while offline')
  assert.equal(remoteWhileOffline.payload.data.pages[0].blocks[0].text, originalText, 'server block remains unchanged while offline')

  const blockedDocumentUrl = `${origin}/api/documents/${encodeURIComponent(documentId)}`
  await send('Network.setBlockedURLs', { urls: [blockedDocumentUrl] })
  apiOffline = false
  await send('Page.reload')
  await waitFor(() => evaluate(`document.querySelector('.studio-app') && document.querySelector('.doc-editable-text')?.innerText.trim()===${JSON.stringify(offlineText)} && document.body.innerText.includes('Modo sem conexao')`), 'reload restores the durable Docs block draft while its document endpoint is blocked')
  assert.equal((await readDraft())?.document?.pages?.[0]?.blocks?.[0]?.text, offlineText, 'draft remains present during blocked reload')
  assert.equal((await apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { cookie })).payload.revision, 1, 'blocked reload has not changed remote revision')
  assert.equal((await apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { cookie })).payload.data.pages[0].blocks[0].text, originalText, 'blocked reload has not changed remote Docs text')

  await send('Network.setBlockedURLs', { urls: [] })
  await evaluate("window.__activeEventSource.onerror?.(new Event('error'))")
  await waitFor(() => evaluate("document.querySelector('.realtime-presence')?.classList.contains('reconnecting')"), 'reloaded Docs client enters reconnecting state', 7000)
  await evaluate("window.__activeEventSource.onopen?.(new Event('open'))")
  const recovered = await waitFor(async () => {
    const result = await apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, { cookie })
    return result.status === 200 && result.payload.data.pages[0].blocks[0].text === offlineText ? result.payload : null
  }, 'reconnection merges and autosaves Docs content without another edit', 45000)
  assert.equal(recovered.revision, 2, 'server advances exactly one revision for the recovered draft')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'recovered Docs draft reports saved in cloud')
  await waitFor(async () => (await readDraft()) === null, 'successfully saved cloud draft is removed from IndexedDB')
  console.log('PASS cloud Docs offline block edit, durable IndexedDB draft, blocked-endpoint reload, reconnect merge/autosave, server revision and draft cleanup')
} finally {
  try { pageSocket?.close() } catch {}
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
  await stop(chrome)
  await stop(vite)
  await new Promise(resolve => apiServer.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
