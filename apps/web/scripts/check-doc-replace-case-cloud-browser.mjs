import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(import.meta.dirname, '..')
let chromePath
for (const candidate of [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {}
}
assert.ok(chromePath, 'Set CHROME_PATH to run the cloud Docs replacement browser check')

async function freePort() {
  const server = createTcpServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await new Promise(resolve => child.once('exit', resolve))
}

const apiPort = await freePort()
const webPort = await freePort()
const cdpPort = await freePort()
const apiOrigin = `http://127.0.0.1:${apiPort}`
const webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin] })
await new Promise(resolve => apiServer.listen(apiPort, '127.0.0.1', resolve))
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-doc-replace-cloud-'))
let vite
let chrome
let browserSocket
let pageSocket

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiOrigin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, payload: await response.json(), setCookie: response.headers.get('set-cookie') }
}

try {
  const password = 'Fuse-Docs-Replace-Cloud-Password-42'
  const makeUser = async (label, suffix) => {
    const email = `docs-replace-${suffix}-${Date.now()}@example.test`
    assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: label, email, password } })).status, 201)
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } })
    assert.equal(login.status, 200)
    return { email, cookie: login.setCookie?.split(';')[0] }
  }
  const owner = await makeUser('Docs replace owner', 'owner')
  const editor = await makeUser('Docs replace editor', 'editor')
  assert.ok(owner.cookie && editor.cookie)
  const created = await request('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Rich replace fixture', data: {
    type: 'doc', width: 794, pages: [{ id: 'page-1', name: 'Page 1', elements: [], blocks: [
      { id: 'paragraph-1', type: 'paragraph', text: 'Team: Open tasks urgent', marks: [{ start: 6, end: 10, bold: true }, { start: 11, end: 16, italic: true }] },
      { id: 'table-1', type: 'table', text: '', cells: [['Open cell', 'open lower'], ['', '']] },
    ] }],
  } } })
  assert.equal(created.status, 201)
  const documentId = created.payload.id
  assert.equal((await request(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.email, role: 'editor' } })).status, 201)

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiOrigin, changeOrigin: false } } } })
  await vite.listen()
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.ok, 'Chrome CDP')
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), 'Chrome page')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let commandId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const id = ++commandId; pending.set(id, resolve); pageSocket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  await send('Network.enable')
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__docReplaceOps=[];const originalFetch=window.fetch.bind(window);window.fetch=(input,init={})=>originalFetch(input,init).then(async response=>{const url=String(input);if(init.method==='POST'&&url.endsWith('/operations'))window.__docReplaceOps.push({request:JSON.parse(init.body),response:await response.clone().json(),status:response.status});return response})" })
  assert.equal((await send('Network.setCookie', { name: 'fuse_session', value: owner.cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })).result.success, true)
  await send('Page.navigate', { url: `${webOrigin}/design/${encodeURIComponent(documentId)}/edit?storage=cloud` })
  await waitFor(() => evaluate("Boolean(document.querySelector('.doc-layout .doc-editable-text')) && Boolean(document.querySelector('.doc-layout textarea[aria-label=\"Linha 1, coluna 1\"]'))"), 'authenticated cloud Docs editor')

  const setInput = async (label, value) => evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await setInput('Localizar texto', 'OPEN')
  await setInput('Substituir por', 'Start')
  await evaluate("document.querySelector('.doc-case-toggle input').click()")
  await waitFor(() => evaluate("document.querySelector('.doc-search-count')?.textContent.trim().startsWith('0') && document.querySelector('.doc-search-tools button').disabled"), 'case-sensitive zero-match state')
  assert.equal(await evaluate('window.__docReplaceOps.length'), 0, 'zero-match case-sensitive query emits no cloud operation')

  await setInput('Localizar texto', 'Open')
  await waitFor(() => evaluate("document.querySelector('.doc-search-count')?.textContent.trim().startsWith('2') && !document.querySelector('.doc-search-tools button').disabled"), 'exact-case matches in rich text and table cell')
  await evaluate("document.querySelector('.doc-search-tools button').click()")
  await waitFor(() => evaluate("window.__docReplaceOps.some(item=>item.request?.type==='doc.replace.apply'&&item.status===200)"), 'cloud replace operation')
  const operation = await evaluate("window.__docReplaceOps.find(item=>item.request?.type==='doc.replace.apply')?.request")
  assert.equal(operation.blocks.length, 1)
  assert.equal(operation.cells.length, 1)
  const saved = await waitFor(async () => {
    const response = await request(`/api/documents/${documentId}`, { cookie: owner.cookie })
    const blocks = response.payload.data.pages[0].blocks
    return blocks[0].text === 'Team: Start tasks urgent' && blocks[1].cells[0][0] === 'Start cell' ? response.payload : null
  }, 'canonical cloud replacement')
  assert.deepEqual(saved.data.pages[0].blocks[0].marks, [{ start: 6, end: 11, bold: true }, { start: 12, end: 17, italic: true }], 'matched replacement inherits bold and shifts the italic suffix without losing rich text')
  assert.equal(saved.data.pages[0].blocks[1].cells[0][1], 'open lower', 'case-sensitive replacement preserves the lower-case cell')
  assert.ok(saved.revision > created.payload.revision)
  console.log('PASS cloud Docs replace: case-sensitive filtering, zero-match no-op, atomic text/table patch, bold replacement and italic suffix persistence')
} finally {
  try { pageSocket?.close() } catch {}
  await stop(chrome)
  await vite?.close()
  await new Promise(resolve => apiServer.close(resolve))
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
