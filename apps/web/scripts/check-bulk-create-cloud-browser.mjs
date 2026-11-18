import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer as tcp } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(import.meta.dirname, '..')
let chromePath
for (const candidate of [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
async function freePort() { const server = tcp(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const apiPort = await freePort(), webPort = await freePort(), cdpPort = await freePort()
const apiOrigin = `http://127.0.0.1:${apiPort}`, webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin], invitationEmailSender: async () => ({ status: 'link-only' }) })
await new Promise(resolve => apiServer.listen(apiPort, '127.0.0.1', resolve))
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-bulk-cloud-'))
const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('Batch250').addRows([['Name'], ...Array.from({ length: 250 }, (_, index) => ['Row_' + String(index + 1).padStart(3, '0')])])
const workbookPath = path.join(profile, 'cloud-bulk.xlsx')
await writeFile(workbookPath, await workbook.xlsx.writeBuffer())
let vite, chrome, browserSocket, pageSocket
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiOrigin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, payload: await response.json(), setCookie: response.headers.get('set-cookie') }
}
try {
  assert.ok(chromePath, 'Set CHROME_PATH to run the cloud bulk browser check')
  const password = 'Fuse-Bulk-Cloud-Password-42', email = `bulk-cloud-${Date.now()}@example.test`
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { name: 'Bulk tester', email, password } })).status, 201)
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  const cookie = login.setCookie?.split(';')[0]
  assert.ok(cookie)
  const imageSrc = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjMGFmIi8+PC9zdmc+'
  const source = await api('/api/documents', { method: 'POST', cookie, body: { name: 'Lote com mídia', data: {
    type: 'design', width: 794, height: 1123, pages: [{ id: 'bulk-source-page', name: 'Página principal', background: '#ffffff', elements: [
      { id: 'bulk-source-name', type: 'text', name: 'Nome', text: 'Pessoa', x: 50, y: 60, width: 240, height: 48, fontSize: 32, fill: '#111111' },
      { id: 'bulk-source-image', type: 'image', name: 'Imagem de teste', assetId: 'bulk-cloud-image', src: imageSrc, x: 300, y: 60, width: 80, height: 60, rotation: 0 },
    ] }],
  } } })
  assert.equal(source.status, 201)
  assert.equal((await api(`/api/documents/${source.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id: 'bulk-cloud-image', name: 'Imagem de teste', mimeType: 'image/svg+xml', width: 80, height: 60, src: imageSrc, fingerprint: 'b'.repeat(64) } } })).status, 201)
  assert.equal((await api(`/api/documents/${source.payload.id}/media?includeReferenced=1`, { cookie })).payload.assets.length, 1, 'source referenced asset is available to bulk duplication')

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiOrigin, changeOrigin: false } } } })
  await vite.listen()
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), 'Chrome page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => { const id = ++nextId; const response = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return response }
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await send('Network.enable')
  assert.equal((await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })).result.success, true)
  await send('Page.enable')
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'home library')
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-account'))"), 'authenticated account')
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Lote com mídia\"]'))"), 'cloud source card')
  await evaluate("document.querySelector('[aria-label=\"Abrir Lote com mídia\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.editor-layout'))"), 'cloud source editor')
  await evaluate("[...document.querySelectorAll('.tools-panel button')].find(button=>button.textContent.includes('Criar em lote'))?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.bulk-create-panel'))"), 'bulk creation dialog')
  await evaluate("document.querySelector('[aria-label=\"Campo para Nome\"]').value='0';document.querySelector('[aria-label=\"Campo para Nome\"]').dispatchEvent(new Event('change',{bubbles:true}))")
  await evaluate("[...document.querySelectorAll('.bulk-output label')].find(label=>label.textContent.includes('Projetos individuais'))?.querySelector('input')?.click()")
  await evaluate("document.querySelector('.bulk-generate').click()")
  await waitFor(() => evaluate("document.querySelector('.bulk-message')?.textContent.includes('2 projetos individuais criados')"), 'individual cloud projects created')
  const result = await api('/api/documents', { cookie })
  const outputs = result.payload.documents.filter(document => document.id !== source.payload.id && document.name.startsWith('Lote com mídia · '))
  assert.equal(outputs.length, 2)
  assert.deepEqual(outputs.map(document => document.data.pages[0].elements.find(element => element.type === 'text').text).sort(), ['Ana', 'Bruno'])
  for (const output of outputs) {
    assert.equal(output.data.pages[0].elements.find(element => element.type === 'image').assetId, 'bulk-cloud-image')
    const media = await api(`/api/documents/${output.id}/media`, { cookie })
    assert.equal(media.payload.assets.some(asset => asset.id === 'bulk-cloud-image' && asset.src === imageSrc), true, `asset copied to ${output.name}: ${JSON.stringify(media.payload)}`)
  }

  await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Fonte de dados\"]');select.value='xlsx';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  const workbookDocument = await send('DOM.getDocument')
  const workbookInput = await send('DOM.querySelector', { nodeId: workbookDocument.result.root.nodeId, selector: '[aria-label="Arquivo Excel"]' })
  await send('DOM.setFileInputFiles', { files: [workbookPath], nodeId: workbookInput.result.nodeId })
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Planilha Excel\"]')?.options.length===2"), 'cloud workbook with 250 rows loaded')
  await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Planilha Excel\"]');select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelector('[data-bulk-preview-position]')?.textContent==='1 / 250'"), '250 cloud records selected')
  await evaluate("(()=>{const select=document.querySelector('.bulk-binding select');select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await evaluate("document.querySelector('.bulk-generate').click()")
  await waitFor(() => evaluate("document.querySelector('.bulk-message')?.textContent.includes('250 projetos individuais criados')"), '250 cloud projects created', 120000)
  const cloudBatchResult = await api('/api/documents', { cookie })
  const cloudBatchOutputs = cloudBatchResult.payload.documents.filter(document => document.id !== source.payload.id && !outputs.some(existing => existing.id === document.id) && document.name.startsWith(source.payload.name))
  assert.equal(cloudBatchOutputs.length, 250, 'all bulk cloud projects are in canonical storage')
  const cloudExpected = Array.from({ length: 250 }, (_, index) => 'Row_' + String(index + 1).padStart(3, '0')).sort()
  assert.deepEqual(cloudBatchOutputs.map(document => document.data.pages[0].elements.find(element => element.type === 'text').text).sort(), cloudExpected, 'every cloud project retains its bound record')
  assert.equal(new Set(cloudBatchOutputs.map(document => document.data.pages[0].id)).size, 250, 'cloud pages have unique identities')
  assert.equal(new Set(cloudBatchOutputs.flatMap(document => document.data.pages[0].elements.map(element => element.id))).size, 500, 'cloud elements have unique identities')
  for (const output of [cloudBatchOutputs[0], cloudBatchOutputs[Math.floor(cloudBatchOutputs.length / 2)], cloudBatchOutputs.at(-1)]) {
    const media = await api('/api/documents/' + output.id + '/media', { cookie })
    assert.equal(media.payload.assets.some(asset => asset.id === 'bulk-cloud-image' && asset.src === imageSrc), true, 'sampled image asset copied to ' + output.name)
  }

  console.log('PASS cloud bulk creation stores individual and 250-record batch documents with bound text and copied referenced media')
} finally {
  pageSocket?.close()
  browserSocket?.close()
  if (chrome?.pid) { try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill('SIGTERM') } catch {} }
  await vite?.close().catch(() => {})
  await new Promise(resolve => apiServer.close(resolve))
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
