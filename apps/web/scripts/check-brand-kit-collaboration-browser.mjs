import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer as createViteServer } from 'vite'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
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
async function waitFor(check, label, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {}; await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function stop(child) {
  if (!child) return
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32' && child.pid) { const { execFileSync } = await import('node:child_process'); try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
    else child.kill('SIGTERM')
  }
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
}

const webPort = await freePort()
let cdpPort = await freePort()
while (cdpPort === webPort) cdpPort = await freePort()
const webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin], textGenerator: { mode: 'sandbox', generate: async prompt => `Sandbox draft for: ${prompt}` } })
await new Promise((resolve, reject) => apiServer.listen(0, '127.0.0.1', resolve).once('error', reject))
const apiBase = `http://127.0.0.1:${apiServer.address().port}`
const documentRequests = []
const operationRequests = []
apiServer.on('request', (request, response) => {
  const match = request.url?.match(/^\/api\/documents\/([^/?]+)(?:\/operations)?(?:\?.*)?$/)
  if (!match) return
  const documentId = decodeURIComponent(match[1])
  response.on('finish', () => {
    const entry = { documentId, method: request.method, status: response.statusCode, at: Date.now() }
    if (request.url?.endsWith('/operations')) operationRequests.push(entry)
    if (!request.url?.endsWith('/operations')) documentRequests.push(entry)
  })
})
async function apiRequest(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiBase}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json()
  return { status: response.status, payload, setCookie: response.headers.get('set-cookie') }
}

let vite
let chrome
let profile
let socket
let editorContextId
const browserCommands = new Map()
let nextCommandId = 0
let ownerSessionId
let editorSessionId
try {
  const ownerEmail = `brand-owner-${Date.now()}@example.test`
  const editorEmail = `brand-editor-${Date.now()}@example.test`
  const password = 'Fuse-Brand-Password-42'
  const ownerCreated = await apiRequest('/api/auth/register', { method: 'POST', body: { name: 'Brand owner', email: ownerEmail, password } })
  assert.equal(ownerCreated.status, 201)
  const ownerLogin = await apiRequest('/api/auth/login', { method: 'POST', body: { email: ownerEmail, password } })
  const ownerCookie = ownerLogin.setCookie?.split(';')[0]
  assert.ok(ownerCookie?.startsWith('fuse_session='))
  const editorCreated = await apiRequest('/api/auth/register', { method: 'POST', body: { name: 'Brand editor', email: editorEmail, password } })
  assert.equal(editorCreated.status, 201)
  const editorLogin = await apiRequest('/api/auth/login', { method: 'POST', body: { email: editorEmail, password } })
  const editorCookie = editorLogin.setCookie?.split(';')[0]
  assert.ok(editorCookie?.startsWith('fuse_session='))

  const seed = { type: 'design', width: 794, height: 1123, pages: [{ id: 'brand-page', name: 'Page 1', background: '#ffffff', elements: [
    { id: 'brand-text', type: 'text', name: 'Existing heading', x: 80, y: 100, width: 420, height: 72, rotation: 0, text: 'Preserve this exact copy', fontSize: 18, fontFamily: 'Georgia', color: '#334455', bold: false },
    { id: 'brand-shape', type: 'shape', shape: 'rect', name: 'Mapped shape', x: 40, y: 220, width: 100, height: 80, rotation: 0, fill: '#75511c', cornerRadius: 0 },
    { id: 'brand-sticky', type: 'sticky-note', name: 'Mapped note', text: 'Preserve note copy', x: 180, y: 220, width: 220, height: 140, rotation: 0, fill: '#b29365', color: '#75511c', fontSize: 18 },
  ] }] }
  const created = await apiRequest('/api/documents', { method: 'POST', cookie: ownerCookie, body: { name: 'Brand Kit collaboration fixture', data: seed } })
  assert.equal(created.status, 201, JSON.stringify(created.payload))
  const documentId = created.payload.id
  assert.equal((await apiRequest(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: ownerCookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  const docSeed = { type: 'doc', width: 794, height: 1123, pages: [{ id: 'ai-doc-page', name: 'Page 1', elements: [], blocks: [{ id: 'ai-doc-base', type: 'paragraph', text: 'Existing document text' }] }] }
  const docCreated = await apiRequest('/api/documents', { method: 'POST', cookie: ownerCookie, body: { name: 'AI insertion collaboration fixture', data: docSeed } })
  assert.equal(docCreated.status, 201, JSON.stringify(docCreated.payload))
  const docId = docCreated.payload.id
  assert.equal((await apiRequest(`/api/documents/${docId}/permissions`, { method: 'POST', cookie: ownerCookie, body: { email: editorEmail, role: 'editor' } })).status, 201)

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiBase, changeOrigin: false } } } })
  await vite.listen()
  profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-brand-collab-'))
  const bulkWorkbook = new ExcelJS.Workbook()
  bulkWorkbook.addWorksheet('Batch250').addRows([['Name'], ...Array.from({ length: 250 }, (_, index) => ['Row_' + String(index + 1).padStart(3, '0')])])
  const bulkWorkbookPath = path.join(profile, 'bulk-collaboration-250.xlsx')
  await writeFile(bulkWorkbookPath, await bulkWorkbook.xlsx.writeBuffer())
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && browserCommands.has(message.id)) { browserCommands.get(message.id)(message); browserCommands.delete(message.id) } })
  const sendBrowser = (method, params = {}, sessionId) => {
    const id = ++nextCommandId
    const promise = new Promise(resolve => browserCommands.set(id, resolve))
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return promise
  }
  const ownerTarget = await sendBrowser('Target.createTarget', { url: 'about:blank' })
  const ownerAttached = await sendBrowser('Target.attachToTarget', { targetId: ownerTarget.result.targetId, flatten: true })
  ownerSessionId = ownerAttached.result.sessionId
  const editorContext = await sendBrowser('Target.createBrowserContext', { disposeOnDetach: true })
  editorContextId = editorContext.result.browserContextId
  const editorTarget = await sendBrowser('Target.createTarget', { url: 'about:blank', browserContextId: editorContextId })
  const editorAttached = await sendBrowser('Target.attachToTarget', { targetId: editorTarget.result.targetId, flatten: true })
  editorSessionId = editorAttached.result.sessionId

  async function setupPage(sessionId, cookie) {
    await sendBrowser('Network.enable', {}, sessionId)
    const cookieResult = await sendBrowser('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' }, sessionId)
    assert.equal(cookieResult.result.success, true)
    await sendBrowser('Page.enable', {}, sessionId)
    await sendBrowser('Page.addScriptToEvaluateOnNewDocument', { source: `const NativeES=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeES{constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}};const nativeFetch=window.fetch.bind(window);window.__putBodies=[];window.__opRecords=[];window.fetch=(input,init)=>{const url=String(input);if(init?.method==='PUT'&&url.includes('/api/documents/'))window.__putBodies.push({url,body:JSON.parse(init.body)});const operation=init?.method==='POST'&&url.endsWith('/operations');return nativeFetch(input,init).then(async response=>{if(operation)window.__opRecords.push({request:JSON.parse(init.body),response:await response.clone().json()});return response})}` }, sessionId)
    await sendBrowser('Page.navigate', { url: webOrigin }, sessionId)
  }
  async function evaluate(sessionId, expression) {
    const result = await sendBrowser('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text)
    return result.result.result.value
  }
  await setupPage(ownerSessionId, ownerCookie)
  await setupPage(editorSessionId, editorCookie)

  async function openSharedDocument(sessionId, expectedName, documentName = 'Brand Kit collaboration fixture') {
    await waitFor(() => evaluate(sessionId, "document.readyState==='complete'"), `${expectedName} app document`)
    await waitFor(() => evaluate(sessionId, "Boolean(document.querySelector('.library-mode-tabs'))"), `${expectedName} library`).catch(async error => {
      const state = await evaluate(sessionId, "({url:location.href,body:document.body?.innerText?.slice(0,800),root:document.querySelector('#root')?.innerHTML?.slice(0,400)})")
      throw new Error(`${error.message}; ${JSON.stringify(state)}`)
    })
    const session = await evaluate(sessionId, "fetch('/api/auth/me').then(async r=>({status:r.status,user:(await r.json()).user}))")
    assert.equal(session.status, 200)
    assert.equal(session.user.email, expectedName === 'owner' ? ownerEmail : editorEmail)
    await evaluate(sessionId, "[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
    const openerSelector = JSON.stringify(`[aria-label="Abrir ${documentName}"]`)
    await waitFor(() => evaluate(sessionId, `Boolean(document.querySelector(${openerSelector}))`), `${expectedName} cloud library contains ${documentName}`)
    await evaluate(sessionId, `document.querySelector(${openerSelector}).click()`)
    const editorSelector = documentName.startsWith('AI insertion') ? '.doc-editor-layout' : '.canvas-workspace'
    await waitFor(() => evaluate(sessionId, `Boolean(document.querySelector(${JSON.stringify(editorSelector)}))`), `${expectedName} opens cloud editor`)
  }
  await openSharedDocument(ownerSessionId, 'owner')
  await openSharedDocument(editorSessionId, 'editor')
  await waitFor(() => evaluate(ownerSessionId, "window.__sseMessages.some(message=>message.type==='presence.updated'&&message.users?.some(user=>user.name==='Brand editor'))"), 'editor presence on owner session')

  await evaluate(ownerSessionId, "document.querySelector('.layers-list button[title=\"Existing heading\"]')?.click()")
  const target = await waitFor(() => evaluate(ownerSessionId, "document.querySelector('#font-size')?.value==='18'?{selected:document.querySelector('.inspector-heading h2')?.textContent,initialSize:document.querySelector('#font-size').value}:null"), 'owner selects existing text layer')
  assert.match(target.selected, /Existing heading/)
  await evaluate(ownerSessionId, "[...document.querySelectorAll('.tools-panel > .tool-button')].find(button=>button.textContent.trim()==='Marca').click()")
  await evaluate(ownerSessionId, "document.querySelector('.brand-kit-selector').click()")
  await waitFor(() => evaluate(ownerSessionId, "Boolean(document.querySelector('.brand-kit-menu'))"), 'brand kit selector')
  await evaluate(ownerSessionId, "[...document.querySelectorAll('.brand-kit-menu button')].find(button=>button.textContent.includes('REA')).click()")
  await waitFor(async () => {
    const saved = await apiRequest(`/api/documents/${documentId}`, { cookie: ownerCookie })
    return saved.payload.data.brandKitId === 'rea-laboratory' && await evaluate(ownerSessionId, "document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')")
  }, 'owner persists the selected laboratory brand kit before the typography operation')

  await evaluate(ownerSessionId, "[...document.querySelectorAll('.brand-kit-categories button')].find(button=>button.textContent==='Cores').click()")
  const putCountBeforePalette = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length
  const operationCountBeforePalette = operationRequests.filter(request => request.documentId === documentId && request.method === 'POST').length
  await evaluate(ownerSessionId, "document.querySelector('.brand-palette-card').click()")
  const paletteSaved = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie: editorCookie })
    const elements = response.payload.data.pages[0].elements
    const shape = elements.find(item => item.id === 'brand-shape')
    const sticky = elements.find(item => item.id === 'brand-sticky')
    return shape?.fill === '#123456' && sticky?.fill === '#2d4a6f' && sticky?.color === '#123456' ? response.payload : null
  }, 'canonical cloud document receives mapped palette fields')
  await waitFor(() => evaluate(editorSessionId, "window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=3)"), 'palette patches delivered to editor over SSE')
  const putCountAfterPalette = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length
  assert.equal(putCountAfterPalette, putCountBeforePalette, 'brand palette patches must not issue a redundant document PUT')
  const operationsAfterPalette = await evaluate(ownerSessionId, "window.__opRecords.map(record=>record.request)")
  assert.ok(operationsAfterPalette.some(operation => operation.type === 'design.element.patch' && operation.elementId === 'brand-shape' && operation.patch?.fill === '#123456'), 'palette sends a shape color patch')
  assert.ok(operationsAfterPalette.some(operation => operation.type === 'design.element.patch' && operation.elementId === 'brand-sticky' && operation.patch?.fill === '#2d4a6f' && operation.patch?.color === '#123456'), 'palette sends both sticky-note fill and text-color patches')
  assert.ok(operationRequests.filter(request => request.documentId === documentId && request.method === 'POST').length > operationCountBeforePalette, 'operation endpoint accepted palette patches')

  await evaluate(ownerSessionId, "document.querySelector('.brand-assistant-open').click()")
  await waitFor(() => evaluate(ownerSessionId, "Boolean(document.querySelector('.brand-assistant-review'))"), 'owner opens Brand Review')
  await evaluate(ownerSessionId, "document.querySelector('.brand-assistant-batch-fix').click()")
  const reviewSaved = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie: editorCookie })
    const element = response.payload.data.pages[0].elements.find(item => item.id === 'brand-text')
    return element?.fontFamily === 'Arial' ? response.payload : null
  }, 'canonical cloud document receives Brand Review batch correction')
  await waitFor(() => evaluate(editorSessionId, "window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=4)"), 'Brand Review patch delivered to editor over SSE')
  const reviewOperations = await evaluate(ownerSessionId, "window.__opRecords.map(record=>record.request)")
  assert.ok(reviewOperations.some(operation => operation.type === 'design.element.patch' && operation.elementId === 'brand-text' && operation.patch?.fontFamily === 'Arial'), 'Brand Review sends a font patch operation')
  assert.equal(documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length, putCountBeforePalette, 'Brand Review batch correction must not issue a redundant document PUT')

  await evaluate(ownerSessionId, "[...document.querySelectorAll('.brand-kit-categories button')].find(button=>button.textContent==='Fontes').click()")
  assert.match(await evaluate(ownerSessionId, "document.querySelector('.brand-type-style small').textContent"), /Aplicar ao texto selecionado/)
  const putCountBefore = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length
  const operationCountBefore = operationRequests.filter(request => request.documentId === documentId && request.method === 'POST').length
  await evaluate(ownerSessionId, "document.querySelector('.brand-type-style').click()")

  const update = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie: editorCookie })
    const element = response.payload.data.pages[0].elements.find(item => item.id === 'brand-text')
    return element?.fontSize === 42.6667 && element.fontFamily === 'Arial' && element.color === '#000000' && element.bold === true ? response.payload : null
  }, 'canonical cloud document receives brand typography operation')
  await waitFor(() => evaluate(editorSessionId, "window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=2)"), 'style operation delivered to editor over SSE')
  await waitFor(() => evaluate(editorSessionId, "document.querySelector('.layers-list button[title=\"Existing heading\"]')?.click();document.querySelector('#font-size')?.value==='42.6667'&&document.querySelector('#text-content')?.value==='Preserve this exact copy'"), 'editor UI refreshes to the styled canonical element')
  const ownerOps = await evaluate(ownerSessionId, "window.__opRecords.map(record=>record.request)")
  const styleOperation = ownerOps.find(operation => operation.type === 'design.element.patch' && operation.elementId === 'brand-text' && operation.patch?.fontSize === 42.6667)
  assert.ok(styleOperation, `owner must send an element patch operation: ${JSON.stringify(ownerOps)}`)
  const serverElement = update.data.pages[0].elements.find(item => item.id === 'brand-text')
  assert.deepEqual({ text: serverElement.text, x: serverElement.x, y: serverElement.y, width: serverElement.width, height: serverElement.height, rotation: serverElement.rotation }, { text: seed.pages[0].elements[0].text, x: 80, y: 100, width: 420, height: 72, rotation: 0 })
  await delay(500)
  assert.equal(documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length, putCountBefore, 'collaborative style application must not issue a redundant document PUT')
  assert.ok(operationRequests.filter(request => request.documentId === documentId && request.method === 'POST').length > operationCountBefore, 'operation endpoint accepted the style update')
  assert.equal(documentRequests.filter(request => request.documentId === documentId && request.method === 'GET').length > 0, true, 'editor receives canonical project refresh after SSE')


  const putCountBeforeBulk = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length
  const operationCountBeforeBulk = operationRequests.filter(request => request.documentId === documentId && request.method === 'POST').length
  await evaluate(ownerSessionId, "[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Criar em lote')).click()")
  await waitFor(() => evaluate(ownerSessionId, "Boolean(document.querySelector('.bulk-create-panel'))"), 'owner opens bulk creation panel')
  await evaluate(ownerSessionId, "(()=>{const select=document.querySelector('[aria-label=\"Fonte de dados\"]');select.value='xlsx';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  const workbookDocument = await sendBrowser('DOM.getDocument', {}, ownerSessionId)
  const workbookInput = await sendBrowser('DOM.querySelector', { nodeId: workbookDocument.result.root.nodeId, selector: '[aria-label="Arquivo Excel"]' }, ownerSessionId)
  await sendBrowser('DOM.setFileInputFiles', { files: [bulkWorkbookPath], nodeId: workbookInput.result.nodeId }, ownerSessionId)
  await waitFor(() => evaluate(ownerSessionId, "document.querySelector('[aria-label=\"Planilha Excel\"]')?.options.length===2"), 'owner loads 250-row workbook')
  await evaluate(ownerSessionId, "(()=>{const select=document.querySelector('[aria-label=\"Planilha Excel\"]');select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate(ownerSessionId, "document.querySelector('[data-bulk-preview-position]')?.textContent==='1 / 250'"), 'owner selects all 250 records')
  await evaluate(ownerSessionId, "(()=>{const select=document.querySelector('.bulk-binding select');select.value='0';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await evaluate(ownerSessionId, "document.querySelector('.bulk-generate').click()")
  const bulkSaved = await waitFor(async () => {
    const response = await apiRequest('/api/documents/' + documentId, { cookie: editorCookie })
    const pages = response.payload.data.pages
    const generated = pages.slice(1)
    return pages.length === 251 && generated[0]?.elements.find(element => element.type === 'text')?.text === 'Row_001' && generated.at(-1)?.elements.find(element => element.type === 'text')?.text === 'Row_250' ? response.payload : null
  }, 'canonical cloud document receives all 250 generated pages in order', 120000)
  const generatedPages = bulkSaved.data.pages.slice(1)
  const newPageIds = generatedPages.map(item => item.id)
  assert.equal(new Set(newPageIds).size, 250, 'all bulk page identities are unique')
  assert.deepEqual(generatedPages.map(item => item.elements.find(element => element.type === 'text')?.text), Array.from({ length: 250 }, (_, index) => 'Row_' + String(index + 1).padStart(3, '0')), 'canonical page order matches the selected worksheet')
  await waitFor(() => evaluate(editorSessionId, "window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=" + bulkSaved.revision + ")"), 'all bulk page insertions reach the editor over SSE', 120000)
  await waitFor(() => evaluate(editorSessionId, "document.querySelector('.page-footer')?.textContent.includes('de 251')"), 'collaborator editor refreshes to 251 pages', 120000)
  await waitFor(() => evaluate(ownerSessionId, "window.__opRecords.filter(record=>record.request.type==='design.page.insert').length>=250"), 'owner records all 250 operation responses', 120000)
  const bulkOperations = (await evaluate(ownerSessionId, "window.__opRecords.map(record=>record.request)")).filter(operation => operation.type === 'design.page.insert').slice(-250)
  const bulkOperationResults = (await evaluate(ownerSessionId, "window.__opRecords.map(record=>({request:record.request,response:record.response}))")).filter(record => record.request.type === 'design.page.insert').slice(-250)
  assert.equal(bulkOperations.length, 250, 'owner submits one collaborative insert per generated page')
  assert.deepEqual(bulkOperations.map((operation, index) => ({ pageId: operation.page.id, afterPageId: operation.afterPageId })), newPageIds.map((pageId, index) => ({ pageId, afterPageId: index ? newPageIds[index - 1] : 'brand-page' })), 'collaborative page insertions preserve source and record order')
  assert.equal(bulkOperationResults.filter(record => record.response?.revision).length, 250, 'server acknowledges every page insertion')
  const bulkPutRequests = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').slice(putCountBeforeBulk)
  assert.equal(bulkPutRequests.length, 0, 'collaborative page inserts do not send a redundant document snapshot')
  assert.ok(operationRequests.filter(request => request.documentId === documentId && request.method === 'POST').length >= operationCountBeforeBulk + 250, 'operation endpoint accepts all 250 inserts')

  const operationCountBeforeOfflineBatch = await evaluate(ownerSessionId, "window.__opRecords.filter(record=>record.request.type==='design.page.insert').length")
  const putCountBeforeOfflineBatch = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').length
  await evaluate(ownerSessionId, "document.querySelector('.bulk-generate').click()")
  await waitFor(() => evaluate(ownerSessionId, "window.__opRecords.filter(record=>record.request.type==='design.page.insert').length>=" + (operationCountBeforeOfflineBatch + 20)), 'offline batch has accepted initial insertions', 120000)
  await sendBrowser('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' }, ownerSessionId)
  await waitFor(() => evaluate(ownerSessionId, "document.querySelector('.save-state')?.textContent.includes('Falha ao salvar')"), 'offline bulk operations report unsaved state', 120000)
  const interruptedCloud = await apiRequest('/api/documents/' + documentId, { cookie: editorCookie })
  assert.ok(interruptedCloud.payload.data.pages.length > 251 && interruptedCloud.payload.data.pages.length < 501, 'connection loss interrupts the operation stream after a partial canonical prefix')
  const acceptedBeforeRecovery = await evaluate(ownerSessionId, "window.__opRecords.filter(record=>record.request.type==='design.page.insert').length")
  assert.ok(acceptedBeforeRecovery < operationCountBeforeOfflineBatch + 250, 'offline queue has failed operations that require snapshot recovery')
  await sendBrowser('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' }, ownerSessionId)
  await waitFor(() => evaluate(ownerSessionId, "document.querySelector('.realtime-presence')?.classList.contains('connected')"), 'owner collaboration reconnects', 120000)
  let recoveredCloud
  try {
    recoveredCloud = await waitFor(async () => {
      const response = await apiRequest('/api/documents/' + documentId, { cookie: editorCookie })
      const pages = response.payload.data.pages
      return pages.length === 501 && pages.at(-1)?.elements.find(element => element.type === 'text')?.text === 'Row_250' ? response.payload : null
    }, 'cloud draft restores every interrupted bulk record', 120000)
  } catch (error) {
    const diagnostics = {
      server: await apiRequest('/api/documents/' + documentId, { cookie: editorCookie }).then(response => ({ status: response.status, revision: response.payload.revision, pages: response.payload.data?.pages?.length, lastText: response.payload.data?.pages?.at(-1)?.elements.find(element => element.type === 'text')?.text })),
      owner: await evaluate(ownerSessionId, "JSON.stringify({online:navigator.onLine,save:document.querySelector('.save-state')?.textContent,presence:document.querySelector('.realtime-presence')?.className,footer:document.querySelector('.page-footer')?.textContent,operations:window.__opRecords?.filter(record=>record.request.type==='design.page.insert').length,failed:window.__opRecords?.filter(record=>record.request.type==='design.page.insert'&&!record.response?.revision).length,putBodies:window.__putBodies?.map(record=>record.body?.data?.pages?.length)})"),
      localDraft: await evaluate(ownerSessionId, "new Promise(resolve=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>resolve('db-open-error:'+request.error);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('cloudDrafts')){resolve('cloudDrafts-store-missing');return}const read=db.transaction('cloudDrafts','readonly').objectStore('cloudDrafts').get(" + JSON.stringify(documentId) + ");read.onerror=()=>resolve('draft-read-error:'+read.error);read.onsuccess=()=>resolve(read.result?{baseRevision:read.result.baseRevision,role:read.result.role,pages:read.result.document?.pages?.length,lastText:read.result.document?.pages?.at(-1)?.elements?.find(element=>element.type==='text')?.text}:null)}})"),
      editor: await evaluate(editorSessionId, "JSON.stringify({save:document.querySelector('.save-state')?.textContent,presence:document.querySelector('.realtime-presence')?.className,footer:document.querySelector('.page-footer')?.textContent})"),
    }
    console.error('Offline batch recovery diagnostics:', JSON.stringify(diagnostics))
    throw error
  }
  const recoveredBatch = recoveredCloud.data.pages.slice(251)
  const recoveredBatchTexts = recoveredBatch.map(item => item.elements.find(element => element.type === 'text')?.text)
  assert.equal(recoveredBatch.length, 250, 'snapshot recovery preserves the interrupted batch size')
  assert.equal(new Set(recoveredBatch.map(item => item.id)).size, 250, 'snapshot recovery keeps every interrupted page identity unique')
  assert.deepEqual(recoveredBatchTexts, Array.from({ length: 250 }, (_, index) => 'Row_' + String(index + 1).padStart(3, '0')), `snapshot recovery preserves complete order of the interrupted batch; samples=${JSON.stringify({ first: recoveredBatchTexts.slice(0, 5), middle: recoveredBatchTexts.slice(122, 127), last: recoveredBatchTexts.slice(-5) })}`)
  await waitFor(() => evaluate(editorSessionId, "document.querySelector('.page-footer')?.textContent.includes('de 501')"), 'collaborator editor refreshes to recovered 501-page document', 120000)
  const offlineRecoveryPuts = documentRequests.filter(request => request.documentId === documentId && request.method === 'PUT').slice(putCountBeforeOfflineBatch)
  assert.ok(offlineRecoveryPuts.length >= 1, 'snapshot fallback persists operations that could not reach the server')
  const ownerRecoveryBodies = await evaluate(ownerSessionId, 'window.__putBodies')
  assert.equal(ownerRecoveryBodies.at(-1)?.body?.data?.pages?.length, 501, 'recovery snapshot contains the entire document')



  await evaluate(ownerSessionId, "document.querySelector('.brand').click()")
  await evaluate(editorSessionId, "document.querySelector('.brand').click()")
  await waitFor(() => evaluate(ownerSessionId, "Boolean(document.querySelector('.library-mode-tabs'))"), 'owner returns to project library')
  await waitFor(() => evaluate(editorSessionId, "Boolean(document.querySelector('.library-mode-tabs'))"), 'editor returns to project library')
  await openSharedDocument(ownerSessionId, 'owner', 'AI insertion collaboration fixture')
  await openSharedDocument(editorSessionId, 'editor', 'AI insertion collaboration fixture')
  await waitFor(() => evaluate(ownerSessionId, "window.__sseMessages.some(message=>message.type==='presence.updated'&&message.users?.some(user=>user.name==='Brand editor'))"), 'editor presence on owner Docs session')
  const aiDocPutCountBefore = documentRequests.filter(request => request.documentId === docId && request.method === 'PUT').length
  const aiDocOperationCountBefore = operationRequests.filter(request => request.documentId === docId && request.method === 'POST').length
  await evaluate(ownerSessionId, "document.querySelector('.ai-button').click()")
  await waitFor(() => evaluate(ownerSessionId, "Boolean(document.querySelector('#ai-prompt'))"), 'owner opens AI text panel')
  await evaluate(ownerSessionId, "document.querySelector('#ai-prompt').focus()")
  await sendBrowser('Input.insertText', { text: 'Write a short welcome for a shared project.' }, ownerSessionId)
  await evaluate(ownerSessionId, "document.querySelector('.ai-form button[type=submit]').click()")
  const generatedText = await waitFor(() => evaluate(ownerSessionId, "document.querySelector('.ai-chat-message.ai-chat-assistant p')?.textContent || null"), 'sandbox AI returns text')
  assert.ok(generatedText.length > 0)
  await evaluate(ownerSessionId, "document.querySelector('.ai-chat-message-actions .conflict-copy').click()")
  const aiDocSaved = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${docId}`, { cookie: editorCookie })
    const block = response.payload.data.pages[0].blocks.find(item => item.text === generatedText)
    return block ? { ...response.payload, insertedBlock: block } : null
  }, 'canonical Docs document receives generated paragraph')
  await waitFor(() => evaluate(editorSessionId, "window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=2)"), 'generated paragraph operation delivered to editor over SSE')
  await waitFor(() => evaluate(editorSessionId, `document.querySelector('.doc-workspace')?.innerText.includes(${JSON.stringify(generatedText)})`), 'editor Docs canvas renders inserted paragraph')
  const aiDocOperations = await evaluate(ownerSessionId, "window.__opRecords.map(record=>record.request)")
  assert.ok(aiDocOperations.some(operation => operation.type === 'doc.block.insert' && operation.block?.text === generatedText && operation.afterBlockId === 'ai-doc-base'), 'AI insertion sends a document block operation anchored after existing text')
  assert.equal(documentRequests.filter(request => request.documentId === docId && request.method === 'PUT').length, aiDocPutCountBefore, 'AI block insertion must not issue a redundant document PUT')
  assert.ok(operationRequests.filter(request => request.documentId === docId && request.method === 'POST').length > aiDocOperationCountBefore, 'operation endpoint accepted AI block insertion')
  console.log(JSON.stringify({ result: 'passed', documentId, revision: update.revision, paletteRevision: paletteSaved.revision, reviewRevision: reviewSaved.revision, palette: { shape: paletteSaved.data.pages[0].elements.find(item => item.id === 'brand-shape').fill, stickyFill: paletteSaved.data.pages[0].elements.find(item => item.id === 'brand-sticky').fill, stickyColor: paletteSaved.data.pages[0].elements.find(item => item.id === 'brand-sticky').color }, style: { fontSize: serverElement.fontSize, fontFamily: serverElement.fontFamily, color: serverElement.color, bold: serverElement.bold }, bulkRevision: bulkSaved.revision, bulkPageCount: bulkSaved.data.pages.length - 1, bulkSamples: [bulkSaved.data.pages[1], bulkSaved.data.pages[Math.floor(bulkSaved.data.pages.length / 2)], bulkSaved.data.pages.at(-1)].map(item => ({ id: item.id, name: item.name, text: item.elements.find(element => element.type === 'text')?.text })), aiDocId: docId, aiBlockId: aiDocSaved.insertedBlock.id, aiBlockText: generatedText, editorSse: true, interruptedBatchRecovered: true, redundantPuts: 0 }))
} finally {
  socket?.close()
  if (editorContextId) { try { await fetch(`http://127.0.0.1:${cdpPort}/json/version`); } catch {} }
  await stop(chrome)
  await vite?.close()
  await new Promise(resolve => apiServer.close(resolve))
  if (profile) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); break }
      catch (error) { if (error.code !== 'EBUSY' || attempt === 7) throw error; await delay(500) }
    }
  }
}
