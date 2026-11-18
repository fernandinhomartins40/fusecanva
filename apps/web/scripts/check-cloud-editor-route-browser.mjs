import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/index.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the cloud editor route browser test')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const apiPort = await freePort()
const vitePort = await freePort()
const cdpPort = await freePort()
const origin = `http://127.0.0.1:${vitePort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-cloud-route-'))
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [origin], invitationEmailSender: async () => ({ status: 'link-only', reason: 'test-sandbox' }) })
await new Promise((resolve, reject) => apiServer.listen(apiPort, '127.0.0.1', resolve).once('error', reject))
let vite, chrome, browserSocket, pageSocket
try {
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const password = 'Fuse-Cloud-Route-Test-42'
  const registered = await fetch(`${apiOrigin}/api/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Route Test Owner', email: 'route-owner@example.test', password }) })
  assert.equal(registered.status, 201, 'sandbox account registers locally')
  const login = await fetch(`${apiOrigin}/api/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'route-owner@example.test', password }) })
  assert.equal(login.status, 200, 'sandbox account signs in locally')
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie?.startsWith('fuse_session='), 'local login returns the session cookie')
  const document = { id: 'cloud-route-fixture', name: 'Cloud route fixture', type: 'design', width: 1080, height: 1080, updatedAt: new Date().toISOString(), pages: [{ id: 'cloud-route-page', name: 'Page 1', background: '#ffffff', elements: [{ id: 'cloud-route-text', name: 'Offline canvas copy', type: 'text', x: 180, y: 180, width: 560, height: 100, rotation: 0, text: 'Canvas text before disconnect', fontSize: 36, fontFamily: 'Arial', color: '#111111', bold: false }] }] }
  const created = await fetch(`${apiOrigin}/api/documents`, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: document.name, data: document }) })
  assert.equal(created.status, 201, 'cloud route fixture is created in the in-memory test database')
  const remote = await created.json()

  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, env: { ...process.env, STUDIO_API_PORT: String(apiPort) }, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), 'blank page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  let apiOffline = false
  let failedApiRequests = 0
  let documentFetchFailuresRemaining = 0
  let failedDocumentFetches = 0
  pageSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
    if (message.method === 'Fetch.requestPaused') {
      const requestId = message.params.requestId
      const pathname = new URL(message.params.request.url).pathname
      if (apiOffline && pathname.startsWith('/api/')) {
        failedApiRequests += 1
        void send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {})
      } else if (documentFetchFailuresRemaining > 0 && pathname === `/api/documents/${encodeURIComponent(remote.id)}`) {
        documentFetchFailuresRemaining -= 1
        failedDocumentFetches += 1
        void send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {})
      } else void send('Fetch.continueRequest', { requestId }).catch(() => {})
    }
  })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); const result = await response; if (result.error) throw new Error(`${method}: ${result.error.message}`); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  await send('Network.enable')
  const routeUrl = `${origin}/design/${encodeURIComponent(remote.id)}/edit?storage=cloud`
  await send('Page.navigate', { url: routeUrl })
  await waitFor(() => evaluate("!!document.querySelector('.editor-load-error') && !!document.querySelector('.editor-load-error button')"), 'missing-session cloud error state')
  assert.equal(await evaluate("document.querySelector('.editor-load-error h1')?.textContent==='Não foi possível abrir'"), true, 'missing authentication is shown as an explicit load error')
  assert.equal(await evaluate("[...document.querySelectorAll('.editor-load-error button')].some(button=>button.textContent==='Tentar novamente')"), true, 'load error offers an explicit retry control')
  await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  await evaluate("[...document.querySelectorAll('.editor-load-error button')].find(button=>button.textContent==='Tentar novamente').click()")
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') || !!document.querySelector('.editor-load-error')"), 'cloud retry settles')
  const retryState = await evaluate("({editor:!!document.querySelector('.studio-app'),error:document.querySelector('.editor-load-error p')?.textContent,buttons:[...document.querySelectorAll('.editor-load-error button')].map(button=>button.textContent)})")
  assert.equal(retryState.editor, true, `direct authenticated cloud editor route succeeds after retry: ${JSON.stringify(retryState)}`)
  const firstSnapshot = await evaluate("({url:location.pathname+location.search,id:document.querySelector('.document-title input')?.value,routeId:decodeURIComponent(location.pathname.split('/')[2]),user:document.querySelector('.avatar')?.getAttribute('aria-label')})")
  assert.equal(firstSnapshot.routeId, remote.id, 'cloud route resolves the fixture document id')
  await waitFor(() => evaluate("Boolean(document.querySelector('.accessible-canvas-object-list [data-canvas-object-id=\"cloud-route-text\"]'))"), 'canvas object layer is present')
  await evaluate("document.querySelector('.accessible-canvas-object-list [data-canvas-object-id=\"cloud-route-text\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#text-content')?.value==='Canvas text before disconnect'"), 'canvas text inspector opens')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  apiOffline = true
  await evaluate("document.querySelector('.document-title input').focus()")
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await send('Input.insertText', { text: 'Offline draft title' })
  await waitFor(() => evaluate("document.querySelector('.document-title input')?.value==='Offline draft title'"), 'offline title draft is visible')
  await evaluate("(()=>{const field=document.querySelector('#text-content');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Canvas text saved while offline');field.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelector('#text-content')?.value==='Canvas text saved while offline'"), 'offline canvas object text is visible')
  await waitFor(() => evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('cloudDrafts','readonly').objectStore('cloudDrafts').get(" + JSON.stringify(remote.id) + ");q.onsuccess=()=>{const d=q.result;db.close();resolve(Boolean(d&&d.document.name==='Offline draft title'&&d.document.pages[0].elements[0].text==='Canvas text saved while offline'&&d.role==='owner'&&d.baseRevision===1))};q.onerror=()=>reject(q.error)}})"), 'durable cloud draft stores canvas object content in IndexedDB')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Falha ao salvar')"), 'offline cloud save failure is visible')
  const remoteWhileOffline = await (await fetch(`${apiOrigin}/api/documents/${encodeURIComponent(remote.id)}`, { headers: { cookie } })).json()
  assert.equal(remoteWhileOffline.name, 'Cloud route fixture', 'server remains unchanged during offline edits')
  assert.equal(remoteWhileOffline.data.pages[0].elements[0].text, 'Canvas text before disconnect', 'canvas object content remains unchanged on the server while offline')
  assert.equal(remoteWhileOffline.revision, 1)
  await evaluate('location.reload()')
  await waitFor(() => evaluate("!!document.querySelector('.studio-app')&&document.querySelector('.document-title input')?.value==='Offline draft title'"), 'offline reload restores the cloud draft from IndexedDB')
  assert.equal(await evaluate("document.body.innerText.includes('Modo sem conexao')"), true, 'offline reload identifies the local draft state')
  await evaluate("document.querySelector('.accessible-canvas-object-list [data-canvas-object-id=\"cloud-route-text\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#text-content')?.value==='Canvas text saved while offline'"), 'offline reload restores the edited canvas object')
  assert.ok(failedApiRequests > 0, 'API requests were failed while static app resources stayed available')
  apiOffline = false
  await evaluate('location.reload()')
  await waitFor(() => evaluate("!!document.querySelector('.studio-app')&&document.querySelector('.document-title input')?.value==='Offline draft title'"), 'online reload merges the durable draft')
  await evaluate("document.querySelector('.accessible-canvas-object-list [data-canvas-object-id=\"cloud-route-text\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#text-content')?.value==='Canvas text saved while offline'"), 'online reload retains the recovered canvas object')
  const remoteAfterDraftRecovery = await waitFor(async () => {
    const response = await fetch(`${apiOrigin}/api/documents/${encodeURIComponent(remote.id)}`, { headers: { cookie } })
    const latest = await response.json()
    return latest.name === 'Offline draft title' && latest.revision === 2 ? latest : null
  }, 'offline draft synchronized after reconnect')
  assert.equal(remoteAfterDraftRecovery.data.name, 'Offline draft title')
  assert.equal(remoteAfterDraftRecovery.data.pages[0].elements[0].text, 'Canvas text saved while offline', 'offline canvas content merges and autosaves after reconnect')
  await waitFor(() => evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('cloudDrafts','readonly').objectStore('cloudDrafts').get(" + JSON.stringify(remote.id) + ");q.onsuccess=()=>{const d=q.result;db.close();resolve(d===undefined)};q.onerror=()=>reject(q.error)}})"), 'matching draft cleared after successful remote save')
  await send('Fetch.disable')
  const recoveredSnapshot = await evaluate("({url:location.pathname+location.search,id:document.querySelector('.document-title input')?.value,routeId:decodeURIComponent(location.pathname.split('/')[2]),user:document.querySelector('.avatar')?.getAttribute('aria-label')})")
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  documentFetchFailuresRemaining = 2
  await evaluate('location.reload()')
  await waitFor(() => failedDocumentFetches >= 2, 'StrictMode document requests are intercepted and failed')
  await waitFor(() => evaluate("!!document.querySelector('.editor-load-error')"), 'temporary cloud document network failure')
  const networkErrorText = await evaluate("document.querySelector('.editor-load-error p')?.textContent ?? ''")
  assert.ok(networkErrorText.length > 0, 'temporary network failure is visible to the user')
  await evaluate("[...document.querySelectorAll('.editor-load-error button')].find(button=>button.textContent==='Tentar novamente').click()")
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') && document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'cloud document recovers after network retry')
  await send('Fetch.disable')
  await evaluate('location.reload()')
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') && document.querySelector('.document-title input')?.value==='Offline draft title' && document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'cloud route reload and remote readiness')
  await evaluate("document.querySelector('.accessible-canvas-object-list [data-canvas-object-id=\"cloud-route-text\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#text-content')?.value==='Canvas text saved while offline'"), 'final cloud reload preserves offline canvas text')
  assert.deepEqual(await evaluate("({url:location.pathname+location.search,id:document.querySelector('.document-title input')?.value,routeId:decodeURIComponent(location.pathname.split('/')[2]),user:document.querySelector('.avatar')?.getAttribute('aria-label')})"), recoveredSnapshot, 'cloud route reload restores the same route identity and accessible editor state')
  await evaluate("document.querySelector('.brand[aria-label=\\\"Salvar e voltar aos projetos\\\"]')?.click()")
  await waitFor(() => evaluate("!document.querySelector('.studio-app') && !!document.querySelector('.home-sidebar') && !location.pathname.startsWith('/design/')"), 'cloud editor returns to the signed-in library')
  await evaluate('history.back()')
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') && location.pathname.startsWith('/design/') && document.querySelector('.document-title input')?.value==='Offline draft title'"), 'Back restores the authenticated cloud editor')
  await evaluate('history.forward()')
  await waitFor(() => evaluate("!document.querySelector('.studio-app') && !location.pathname.startsWith('/design/')"), 'Forward restores the signed-in library')
  console.log('PASS authenticated cloud route, missing-session and network-failure retry, same-document reload, editor/library Back/Forward, remote save readiness')
} finally {
  try { pageSocket?.close() } catch {}
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
  await stop(chrome)
  await stop(vite)
  await new Promise(resolve => apiServer.close(resolve))
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
