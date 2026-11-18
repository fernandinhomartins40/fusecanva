import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromePaths = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromePaths) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH.')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 3000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const webPort = await freePort()
const webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin] })
await new Promise((resolve, reject) => apiServer.listen(0, '127.0.0.1', resolve).once('error', reject))
const apiBase = `http://127.0.0.1:${apiServer.address().port}`
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiBase}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, payload: await response.json(), setCookie: response.headers.get('set-cookie') }
}
async function register(name, email) {
  const password = 'Fuse-Collab-Password-42'
  const result = await api('/api/auth/register', { method: 'POST', body: { name, email, password } })
  assert.equal(result.status, 201)
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  return login.setCookie.split(';')[0]
}

let vite
const browsers = []
const profiles = []
try {
  const ownerEmail = `typography-owner-${Date.now()}@example.test`
  const editorEmail = `typography-editor-${Date.now()}@example.test`
  const ownerCookie = await register('Typography owner', ownerEmail)
  const editorCookie = await register('Typography editor', editorEmail)
  const design = { type: 'design', width: 794, height: 1123, pages: [
    { id: 'type-page-1', name: 'Page 1', background: '#ffffff', elements: [{ id: 'type-owner-a', type: 'text', name: 'Cover caption', x: 30, y: 40, width: 300, height: 40, rotation: 0, text: 'Cross-page review first', fontSize: 8, fontFamily: 'Arial', color: '#333333', bold: false }] },
    { id: 'type-page-2', name: 'Page 2', background: '#ffffff', elements: [{ id: 'type-owner-b', type: 'text', name: 'Inside caption', x: 30, y: 40, width: 300, height: 40, rotation: 0, text: 'Cross-page review second', fontSize: 10, fontFamily: 'Arial', color: '#333333', bold: false }] },
  ] }
  const created = await api('/api/documents', { method: 'POST', cookie: ownerCookie, body: { name: 'Cloud cross-page typography', data: design } })
  assert.equal(created.status, 201)
  const documentId = created.payload.id
  const permission = await api(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: ownerCookie, body: { email: editorEmail, role: 'editor' } })
  assert.equal(permission.status, 201)

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiBase, changeOrigin: false } } } })
  await vite.listen()

  async function launchSession(cookie, suffix) {
    const cdpPort = await freePort()
    const profile = await mkdtemp(path.join(os.tmpdir(), `fuse-type-cloud-${suffix}-`))
    profiles.push(profile)
    const browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    browsers.push(browser)
    const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), `${suffix} Chrome DevTools`)
    const browserSocket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
    const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), `${suffix} blank page`)
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let id = 0; const pending = new Map()
    socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
    async function send(method, params = {}) { const requestId = ++id; const result = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return result }
    async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
    await send('Network.enable')
    const cookieResult = await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })
    assert.equal(cookieResult.result.success, true)
    await send('Page.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}};const nativeFetch=window.fetch.bind(window);window.__operationRecords=[];window.fetch=(input,init)=>{const tracked=init?.method==='POST'&&String(input).endsWith('/operations');return nativeFetch(input,init).then(async response=>{if(tracked)window.__operationRecords.push({request:JSON.parse(init.body),response:await response.clone().json()});return response})}" })
    await send('Page.navigate', { url: webOrigin })
    await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), `${suffix} project library`)
    const identity = await evaluate("fetch('/api/auth/me').then(async response=>(await response.json()).user.name)")
    return { send, evaluate, socket, browserSocket, identity }
  }

  const owner = await launchSession(ownerCookie, 'owner')
  const editor = await launchSession(editorCookie, 'editor')
  assert.equal(owner.identity, 'Typography owner')
  assert.equal(editor.identity, 'Typography editor')
  for (const session of [owner, editor]) {
    await session.evaluate("Array.from(document.querySelectorAll('.library-mode-tabs button')).find(button=>button.textContent.trim()==='Nuvem').click()")
    await waitFor(() => session.evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Cloud cross-page typography\"]'))"), `${session.identity} shared project in cloud library`)
    await session.evaluate("document.querySelector('[aria-label=\"Abrir Cloud cross-page typography\"]').click()")
    await waitFor(() => session.evaluate("Boolean(document.querySelector('.canvas-workspace'))"), `${session.identity} editor open`)
    await waitFor(() => session.evaluate("document.querySelector('.realtime-presence')?.classList.contains('connected')"), `${session.identity} SSE connection`)
  }

  await editor.evaluate("[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Acessibilidade')).click()")
  await waitFor(() => editor.evaluate("Boolean(document.querySelector('.accessibility-dialog'))"), 'editor accessibility review')
  await editor.evaluate("document.querySelectorAll('.accessibility-summary button')[1].click()")
  assert.equal(await editor.evaluate("document.querySelectorAll('.accessibility-issue').length===2"), true, 'editor initially sees both cross-page typography issues')

  await owner.evaluate("[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Acessibilidade')).click()")
  await waitFor(() => owner.evaluate("Boolean(document.querySelector('.accessibility-dialog'))"), 'owner accessibility review')
  await owner.evaluate("document.querySelectorAll('.accessibility-summary button')[1].click()")
  assert.equal(await owner.evaluate("document.querySelectorAll('.accessibility-issue').length===2 && [...document.querySelectorAll('.accessibility-issue')].some(issue=>issue.textContent.includes('Page 1')) && [...document.querySelectorAll('.accessibility-issue')].some(issue=>issue.textContent.includes('Page 2'))"), true)
  await owner.evaluate("document.querySelector('.accessibility-issue input[type=checkbox]').click()")
  await owner.evaluate("document.querySelector('.accessibility-issue>button').click()")
  await waitFor(() => owner.evaluate("document.querySelector('.page-footer').textContent.includes('1 de 2') && document.querySelector('.layer-row.selected')?.textContent.includes('Cover caption') && Boolean(document.querySelector('.accessibility-dialog'))"), 'owner navigates while keeping first issue selected')
  await owner.evaluate("document.querySelectorAll('.accessibility-issue input[type=checkbox]')[1].click()")
  assert.equal(await owner.evaluate("document.querySelector('.accessibility-dialog>footer span').textContent==='2 selecionado(s)' && document.querySelector('.accessibility-batch-fix').textContent.includes('(2)')"), true)

  const editorEventsBefore = await editor.evaluate("window.__sseMessages.filter(message=>message.type==='document.operation.updated'&&message.operation==='design.element.patch').length")
  await owner.evaluate("document.querySelector('.accessibility-batch-fix').click()")
  await waitFor(() => owner.evaluate("document.querySelector('.save-state').textContent.includes('Salvo') && document.querySelector('.accessibility-summary button:nth-child(2) strong').textContent==='0'"), 'owner batch fix saved')
  await waitFor(() => editor.evaluate(`window.__sseMessages.filter(message=>message.type==='document.operation.updated'&&message.operation==='design.element.patch').length >= ${editorEventsBefore + 2}`), 'editor receives both element patch operations over SSE')
  await waitFor(() => editor.evaluate("document.querySelector('.accessibility-summary button:nth-child(2) strong')?.textContent==='0'"), 'editor live issue count reflects both remote fixes')
  const operationEvents = await editor.evaluate(`window.__sseMessages.filter(message=>message.type==='document.operation.updated'&&message.operation==='design.element.patch').slice(-2)`)
  assert.deepEqual(operationEvents.map(event => event.pageId).sort(), ['type-page-1', 'type-page-2'])
  const serverDoc = await api(`/api/documents/${documentId}`, { cookie: editorCookie })
  assert.equal(serverDoc.status, 200)
  assert.deepEqual(serverDoc.payload.data.pages.map(page => page.elements[0].fontSize), [12, 12], 'the cloud document stores both cross-page fixes')
  assert.equal(await editor.evaluate("document.querySelectorAll('.accessibility-issue').length===0 && document.querySelector('.accessibility-no-issues')?.textContent.includes('Nenhum item')"), true, 'the editor review no longer lists the fixed typography issues')
  console.log('PASS cloud two-account collaboration: owner fixes typography on two pages, editor receives two SSE patches and zero-issue review, server stores 12/12')
} finally {
  for (const browser of browsers) await stop(browser)
  for (const profile of profiles) await rm(profile, { recursive: true, force: true }).catch(() => {})
  if (vite) await vite.close()
  await new Promise(resolve => apiServer.close(resolve))
}
