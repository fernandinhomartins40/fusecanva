import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
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
const offlineReloadOnly = process.argv.includes('--offline-reload')
const offlineOnly = process.argv.includes('--offline-only') || offlineReloadOnly
const chromePaths = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromePaths) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge não encontrado para o ensaio de reconexão colaborativa.')

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitFor(check, label, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value } catch {}
    await delay(120)
  }
  throw new Error(`Tempo esgotado aguardando ${label}`)
}

function silentWavDataUrl(durationMs) {
  const sampleRate = 8000
  const sampleCount = Math.max(1, Math.ceil(sampleRate * durationMs / 1000))
  const dataBytes = sampleCount * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  return `data:audio/wav;base64,${wav.toString('base64')}`
}

const webPort = await freePort()
let cdpPort = await freePort()
while (cdpPort === webPort) cdpPort = await freePort()
const webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin] })
await new Promise((resolve, reject) => apiServer.listen(0, '127.0.0.1', resolve).once('error', reject))
const apiAddress = apiServer.address()
const apiBase = `http://127.0.0.1:${apiAddress.port}`
let documentReadCount = 0
const documentRequests = []
const operationRequests = []
const cursorRequests = []
apiServer.on('request', (request, response) => {
  if (/^\/api\/documents\/[^/]+$/.test(request.url ?? '')) {
    if (request.method === 'GET') documentReadCount += 1
    const documentId = decodeURIComponent(request.url.split('/')[3] ?? '')
    response.on('finish', () => documentRequests.push({ documentId, method: request.method, status: response.statusCode, at: Date.now() }))
  }
  if (/^\/api\/documents\/[^/]+\/operations$/.test(request.url ?? '')) {
    response.on('finish', () => operationRequests.push({ method: request.method, status: response.statusCode }))
  }
  if (/^\/api\/documents\/[^/]+\/cursor$/.test(request.url ?? '')) {
    response.on('finish', () => cursorRequests.push({ method: request.method, status: response.statusCode }))
  }
})
let vite
let chrome
let pageSocket
let browserSocket
let profile
let collaboratorBrowserContextId

async function apiRequest(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiBase}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json()
  return { status: response.status, payload, setCookie: response.headers.get('set-cookie') }
}

try {
  const email = `reconnect-${Date.now()}@example.test`
  const password = 'Fuse-Studio-Password-42'
  const registered = await apiRequest('/api/auth/register', { method: 'POST', body: { name: 'Reconnect owner', email, password } })
  assert.equal(registered.status, 201)
  const login = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  const cookie = login.setCookie?.split(';')[0]
  assert.ok(cookie?.startsWith('fuse_session='))
  const editorEmail = `doc-collaborator-${Date.now()}@example.test`
  const editorRegistration = await apiRequest('/api/auth/register', { method: 'POST', body: { name: 'Docs collaborator', email: editorEmail, password } })
  assert.equal(editorRegistration.status, 201)
  const editorLogin = await apiRequest('/api/auth/login', { method: 'POST', body: { email: editorEmail, password } })
  const editorCookie = editorLogin.setCookie?.split(';')[0]
  assert.ok(editorCookie)

  const data = { type: 'sheet', width: 794, height: 1123, pages: [{ id: 'sheet-page', name: 'Planilha', elements: [], cells: Array.from({ length: 30 }, (_, row) => Array.from({ length: 12 }, (_, column) => row === 0 && column === 0 ? 'Original' : '')), cellFormats: {}, cellMerges: [] }] }
  const created = await apiRequest('/api/documents', { method: 'POST', cookie, body: { name: 'Rascunho de reconexão', data } })
  assert.equal(created.status, 201)
  const documentId = created.payload.id
  assert.equal((await apiRequest(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  const sharingDoc = await apiRequest('/api/documents', { method: 'POST', cookie, body: { name: 'Teste de papeis', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'sharing-page', name: 'Pagina 1', background: '#ffffff', elements: [] }] } } })
  assert.equal(sharingDoc.status, 201)
  assert.equal((await apiRequest(`/api/documents/${sharingDoc.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  const sharedMediaSrc = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjMGE4Ii8+PC9zdmc+'
  const sharedMediaDoc = await apiRequest('/api/documents', { method: 'POST', cookie, body: { name: 'Biblioteca de mídia compartilhada', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'media-page', name: 'Pagina 1', background: '#ffffff', elements: [{ id: 'shared-media-image', type: 'image', name: 'Shared portrait', src: sharedMediaSrc, assetId: 'shared-media-asset', x: 100, y: 120, width: 320, height: 240, rotation: 0 }] }] } } })
  assert.equal(sharedMediaDoc.status, 201)
  assert.equal((await apiRequest(`/api/documents/${sharedMediaDoc.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  assert.equal((await apiRequest(`/api/documents/${sharedMediaDoc.payload.id}`, { method: 'PUT', cookie, body: { revision: 1, name: sharedMediaDoc.payload.name, data: sharedMediaDoc.payload.data } })).status, 200)
  const sharedAsset = await apiRequest(`/api/documents/${sharedMediaDoc.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id: 'shared-media-asset', name: 'Shared portrait', mimeType: 'image/svg+xml', width: 80, height: 60, src: sharedMediaSrc, fingerprint: 'd'.repeat(64) } } })
  assert.equal(sharedAsset.status, 201)

  vite = await createViteServer({
    configFile: false,
    root,
    plugins: [react()],
    server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiBase, changeOrigin: false } } },
  })
  await vite.listen()
  profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-collab-reconnect-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  let nextBrowserCommandId = 0
  const browserPendingCommands = new Map()
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && browserPendingCommands.has(message.id)) { browserPendingCommands.get(message.id)(message); browserPendingCommands.delete(message.id) }
  })
  const sendBrowser = (method, params = {}) => {
    const id = ++nextBrowserCommandId
    const response = new Promise(resolve => browserPendingCommands.set(id, resolve))
    browserSocket.send(JSON.stringify({ id, method, params }))
    return response
  }
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const target = targets.find(item => item.type === 'page' && item.url === 'about:blank')
  assert.ok(target)
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  })
  const send = (method, params = {}) => {
    const id = ++nextId
    const response = new Promise(resolve => pending.set(id, resolve))
    pageSocket.send(JSON.stringify({ id, method, params }))
    return response
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  async function pressKey(key, code, virtualKey, modifiers = 0) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers })
  }

  const videoFixture = await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d');const stream=canvas.captureStream(15);const mimeType=['video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));const recorder=new MediaRecorder(stream,{mimeType});const chunks=[];const complete=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};recorder.onstop=()=>resolve(new Blob(chunks,{type:mimeType}))});recorder.start(100);const started=performance.now();await new Promise(resolve=>{const draw=()=>{context.fillStyle='#e32636';context.fillRect(0,0,160,90);context.fillStyle='#fff';context.fillRect(Math.floor((performance.now()-started)%1200/1200*120),20,40,50);if(performance.now()-started<1200)requestAnimationFrame(draw);else resolve()};draw()});recorder.stop();const blob=await complete;stream.getTracks().forEach(track=>track.stop());const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});return {src:dataUrl,bytes:blob.size,mimeType:blob.type.replace(/;.*/, '')}})()`)
  assert.ok(videoFixture.bytes > 100, 'Chromium records a real video fixture')
  const secondVideoFixture = await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d');const stream=canvas.captureStream(15);const mimeType=['video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));const recorder=new MediaRecorder(stream,{mimeType});const chunks=[];const complete=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};recorder.onstop=()=>resolve(new Blob(chunks,{type:mimeType}))});recorder.start(100);await new Promise(resolve=>{const draw=()=>{context.fillStyle='#145ce8';context.fillRect(0,0,160,90);context.fillStyle='#ffdc37';context.fillRect(12,12,28,24);if(performance.now()-started<1200)requestAnimationFrame(draw);else resolve()};const started=performance.now();draw()});recorder.stop();const blob=await complete;stream.getTracks().forEach(track=>track.stop());const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});return {src:dataUrl,bytes:blob.size,mimeType:blob.type.replace(/;.*/, '')}})()`)
  assert.ok(secondVideoFixture.bytes > 100, 'Chromium records a second distinct video fixture')
  const publicVideo = await apiRequest('/api/documents', { method: 'POST', cookie, body: { name: 'Prévia de vídeo público', data: { type: 'video', width: 160, height: 90, videoDurationMs: 1800, pages: [
    { id: 'public-video-page', name: 'Cena 1', background: '#000000', elements: [
      { id: 'video-caption', type: 'text', name: 'Legenda', x: 12, y: 8, width: 90, height: 18, rotation: 0, text: 'Linha do tempo', fontSize: 12, fontFamily: 'Arial', color: '#ffffff', bold: false },
      { id: 'timed-green-marker', type: 'shape', shape: 'rect', name: 'Marcador temporizado', x: 100, y: 60, width: 30, height: 20, rotation: 0, startMs: 500, durationMs: 500, fill: '#00ff00', cornerRadius: 0 },
    ], timelineClips: [
      { id: 'public-video-clip', assetId: 'public-video-asset', name: 'Demo WebM', kind: 'video', startMs: 0, durationMs: 1200, sourceDurationMs: 1200, sourceStartMs: 0, volume: 0, trackIndex: 0 },
      { id: 'public-video-overlay-clip', assetId: 'public-video-overlay-asset', name: 'Camada WebM azul', kind: 'video', startMs: 0, durationMs: 1200, sourceDurationMs: 1200, sourceStartMs: 0, volume: 0, trackIndex: 1, opacity: 45, fitMode: 'cover', scale: 125, offsetX: 10, offsetY: -5 },
    ] },
    { id: 'public-video-page-2', name: 'Cena 2', background: '#152548', elements: [{ id: 'video-caption-2', type: 'text', name: 'Legenda', x: 12, y: 8, width: 90, height: 18, rotation: 0, text: 'Segunda cena', fontSize: 12, fontFamily: 'Arial', color: '#ffffff', bold: false }], timelineClips: [{ id: 'public-video-clip-2', assetId: 'public-video-asset-2', name: 'Demo WebM cena 2', kind: 'video', startMs: 0, durationMs: 1200, sourceDurationMs: 1200, sourceStartMs: 0, volume: 0 }] },
  ] } } })
  assert.equal(publicVideo.status, 201, JSON.stringify(publicVideo.payload))
  const normalizedVideoDataUrl = `data:${videoFixture.mimeType};base64,${String(videoFixture.src).split(',').at(-1)}`
  const normalizedSecondVideoDataUrl = `data:${secondVideoFixture.mimeType};base64,${String(secondVideoFixture.src).split(',').at(-1)}`
  const uploadedVideo = await apiRequest(`/api/documents/${publicVideo.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id: 'public-video-asset', name: 'Demo WebM', mimeType: videoFixture.mimeType, width: 160, height: 90, src: normalizedVideoDataUrl } } })
  assert.equal(uploadedVideo.status, 201, `${JSON.stringify(uploadedVideo.payload)} bytes=${videoFixture.bytes} mime=${videoFixture.mimeType} url=${String(videoFixture.src).slice(0, 48)}`)
  const uploadedVideoSceneTwo = await apiRequest(`/api/documents/${publicVideo.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id: 'public-video-asset-2', name: 'Demo WebM cena 2', mimeType: videoFixture.mimeType, width: 160, height: 90, src: normalizedVideoDataUrl } } })
  assert.equal(uploadedVideoSceneTwo.status, 201)
  const uploadedVideoOverlay = await apiRequest(`/api/documents/${publicVideo.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id: 'public-video-overlay-asset', name: 'Camada WebM azul', mimeType: secondVideoFixture.mimeType, width: 160, height: 90, src: normalizedSecondVideoDataUrl } } })
  assert.equal(uploadedVideoOverlay.status, 201)

  await send('Network.enable')
  const sessionValue = cookie.slice('fuse_session='.length)
  const cookieResult = await send('Network.setCookie', { name: 'fuse_session', value: sessionValue, url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })
  assert.equal(cookieResult.result.success, true)
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);window.__activeEventSource=this;this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}};const NativeFetch=window.fetch.bind(window);window.__putBodies=[];window.__operationRecords=[];window.__cursorBodies=[];window.fetch=(input,init)=>{const url=String(input);if(init?.method==='PUT'&&url.startsWith('/api/documents/'))window.__putBodies.push({at:Date.now(),body:JSON.parse(init.body)});const tracked=init?.method==='POST'&&url.endsWith('/operations');if(init?.method==='POST'&&url.endsWith('/cursor'))window.__cursorBodies.push(JSON.parse(init.body));return NativeFetch(input,init).then(async response=>{if(tracked)window.__operationRecords.push({request:JSON.parse(init.body),response:await response.clone().json()});return response})}" })
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'biblioteca Fuse Studio')
  const browserSession = await evaluate("fetch('/api/auth/me').then(async response=>({status:response.status,body:await response.json()}))")
  assert.equal(browserSession.status, 200, `sessão no Chrome: ${JSON.stringify(browserSession)}`)
  await evaluate("Array.from(document.querySelectorAll('.library-mode-tabs button')).find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Compartilhar Teste de papeis\"]'))"), 'cartao do projeto de permissoes')
  await evaluate("(()=>{const trigger=document.querySelector('[aria-label=\"Compartilhar Teste de papeis\"]');trigger.focus();trigger.click()})()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.share-dialog'))"), 'resumo de compartilhamento')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const mobileShareLayout = await waitFor(() => evaluate("(() => { const dialog=document.querySelector('.share-dialog'); return innerWidth===390 && dialog && dialog.getBoundingClientRect().width<=innerWidth ? {rootWidth:document.documentElement.scrollWidth,dialogWidth:dialog.clientWidth,dialogScrollWidth:dialog.scrollWidth} : null })()"), 'diálogo de compartilhamento responsivo')
  assert.ok(mobileShareLayout.rootWidth <= 390 && mobileShareLayout.dialogScrollWidth <= mobileShareLayout.dialogWidth, `diálogo de papéis sem overflow em 390 px: ${JSON.stringify(mobileShareLayout)}`)
  await evaluate("document.querySelector('.share-section-nav button:first-child').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.share-access-settings'))"), 'configurações gerais de acesso')
  const mobileShareSettings = await evaluate("({rootWidth:document.documentElement.scrollWidth,viewport:innerWidth,dialogWidth:document.querySelector('.share-dialog').clientWidth,dialogScrollWidth:document.querySelector('.share-dialog').scrollWidth})")
  assert.ok(mobileShareSettings.viewport===390&&mobileShareSettings.rootWidth<=390&&mobileShareSettings.dialogScrollWidth<=mobileShareSettings.dialogWidth, `configurações de acesso sem overflow em 390 px: ${JSON.stringify(mobileShareSettings)}`)
  assert.equal(await evaluate("document.querySelector('.share-access-options input[value=private]').checked&&!document.querySelector('.share-access-options input[value=link]').disabled&&!document.querySelector('.share-suspend-access').disabled"), true, 'private access is selected by default, public-link access can be enabled, and suspension is enabled')
  await evaluate("document.querySelector('.share-access-options input[value=link]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('#created-public-share-link'))"), 'criacao do link publico')
  const publicUrl = await evaluate("document.querySelector('#created-public-share-link').value")
  const publicToken = new URL(publicUrl).searchParams.get('view')
  assert.ok(publicToken, 'share URL contains an opaque token')
  assert.equal((await apiRequest(`/api/public-shares/${publicToken}`)).status, 200, 'public link opens without passing an account cookie')
  const mobilePublicLink = await evaluate("({viewport:innerWidth,rootWidth:document.documentElement.scrollWidth,dialogWidth:document.querySelector('.share-dialog').clientWidth,dialogScrollWidth:document.querySelector('.share-dialog').scrollWidth})")
  assert.ok(mobilePublicLink.viewport===390&&mobilePublicLink.rootWidth<=390&&mobilePublicLink.dialogScrollWidth<=mobilePublicLink.dialogWidth, `public-link controls fit at 390 px: ${JSON.stringify(mobilePublicLink)}`)
  await evaluate("document.querySelector('.share-access-options input[value=private]').click()")
  await waitFor(() => evaluate("!document.querySelector('#created-public-share-link')"), 'revogacao do link publico')
  assert.equal((await apiRequest(`/api/public-shares/${publicToken}`)).status, 404, 'switching back to private revokes the link')
  await evaluate("document.querySelector('.share-suspend-access').click()")
  await waitFor(() => evaluate("document.querySelector('.share-suspend-access')?.textContent.trim()==='Reabrir acesso'"), 'suspensão de acesso')
  assert.equal((await apiRequest(`/api/documents/${sharingDoc.payload.id}`, { cookie })).payload.accessSuspended, true)
  await evaluate("document.querySelector('.share-suspend-access').click()")
  await waitFor(() => evaluate("document.querySelector('.share-suspend-access')?.textContent.trim()==='Suspender acesso'"), 'reabertura do acesso')
  assert.equal((await apiRequest(`/api/documents/${sharingDoc.payload.id}`, { cookie })).payload.accessSuspended, false)
  await evaluate("document.querySelector('.share-back').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.share-section-nav'))"), 'retorno ao resumo de compartilhamento')
  await evaluate("document.querySelector('[aria-label=\"Pessoas com acesso\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.share-dialog [aria-label=\"Papel de Docs collaborator\"]'))"), 'lista de papeis compartilhados')
  const mobileSharePeople = await evaluate("({rootWidth:document.documentElement.scrollWidth,viewport:innerWidth,dialogWidth:document.querySelector('.share-dialog').clientWidth,dialogScrollWidth:document.querySelector('.share-dialog').scrollWidth,rows:[...document.querySelectorAll('.share-dialog .share-person')].map(row=>({width:row.clientWidth,scrollWidth:row.scrollWidth}))})")
  assert.ok(mobileSharePeople.viewport===390&&mobileSharePeople.rootWidth<=390&&mobileSharePeople.dialogScrollWidth<=mobileSharePeople.dialogWidth&&mobileSharePeople.rows.every(row=>row.scrollWidth<=row.width), `pessoas e papéis sem overflow em 390 px: ${JSON.stringify(mobileSharePeople)}`)
  await evaluate("(() => { const select=document.querySelector('.share-dialog [aria-label=\"Papel de Docs collaborator\"]'); select.value='commenter'; select.dispatchEvent(new Event('change',{bubbles:true})) })()")
  await waitFor(() => evaluate("document.querySelector('.share-status')?.textContent.includes('comentarista')"), 'confirmacao da mudanca de papel')
  const updatedSharingPermissions = await apiRequest(`/api/documents/${sharingDoc.payload.id}/permissions`, { cookie })
  assert.equal(updatedSharingPermissions.payload.permissions.find(permission => permission.email === editorEmail)?.role, 'commenter')
  await pressKey('Escape', 'Escape', 27)
  await waitFor(() => evaluate("!document.querySelector('.share-dialog')"), 'Escape closes the access list')
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')==='Compartilhar Teste de papeis'"), true, 'closing the access list with Escape restores focus to its project trigger')
  const teamName = `Browser team ${Date.now()}`
  await evaluate(`(() => { const input=document.querySelector('[aria-label="Nome da nova equipe"]');input.value=${JSON.stringify(teamName)};input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit() })()`)
  await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.teams-list button')].find(button=>button.textContent.includes(${JSON.stringify(teamName)})))`), 'equipe criada pelo formulário')
  const teamButton = await evaluate(`[...document.querySelectorAll('.teams-list button')].find(button=>button.textContent.includes(${JSON.stringify(teamName)}))?.textContent`)
  assert.ok(teamButton?.includes('1 integrante'), `contagem de integrantes da equipe: ${teamButton}`)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const mobileTeamsLayout = await evaluate("({rootWidth:document.documentElement.scrollWidth,viewport:innerWidth,stripWidth:document.querySelector('.teams-strip')?.getBoundingClientRect().width})")
  assert.ok(mobileTeamsLayout.rootWidth <= 390 && mobileTeamsLayout.stripWidth <= 390, `equipe sem overflow em 390 px: ${JSON.stringify(mobileTeamsLayout)}`)
  await evaluate(`[...document.querySelectorAll('.teams-list button')].find(button=>button.textContent.includes(${JSON.stringify(teamName)})).click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.team-dialog'))"), 'painel de equipe')
  assert.equal(await evaluate("document.querySelectorAll('.team-roster-tabs [role=tab]').length===2&&document.querySelector('.team-roster-table tbody tr [aria-label^=\"Papel de\"]')?.disabled"), true, 'team roster has both tabs and keeps the current owner role disabled')
  await evaluate("document.querySelector('#team-roster-ai-tab').click()")
  assert.equal(await evaluate("document.querySelector('#team-roster-ai[role=tabpanel]')?.textContent.includes('ainda não estão disponíveis')"), true, 'AI usage tab reports unavailable metrics without inventing values')
  await evaluate("document.querySelector('#team-roster-members-tab').click()")
  await evaluate("document.querySelector('.team-integrations-open').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.team-integrations-panel'))"), 'team integration manager opened from team settings')
  await evaluate("(()=>{const input=document.querySelector('.team-integrations-search input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'no matching provider xyz');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelector('.team-integrations-empty')?.textContent.includes('Nenhuma')"), 'team integration no-results state')
  await evaluate("document.querySelector('.team-integrations-empty button').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.team-integration-card').length===8"), 'team integration search cleared')
  await evaluate("document.querySelector('[aria-label=\"Google Drive\"]').click()")
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancelar')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.team-roster-panel'))"), 'team integration draft canceled')
  assert.equal(await evaluate("Object.keys(localStorage).some(key=>key.startsWith('fuse-team-integrations:'))"), false, 'cancel does not save local team preferences')
  await evaluate("document.querySelector('.team-integrations-open').click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Google Drive\"]')?.getAttribute('aria-pressed')==='false'"), 'cancel restores the initial integration selection')
  await evaluate("document.querySelector('[aria-label=\"Google Drive\"]').click()")
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('Salvar prefer'))?.click()")
  await waitFor(() => evaluate("Object.values(localStorage).some(value=>value==='[\\\"drive\\\"]')"), 'saved team integration preference')
  await evaluate("document.querySelector('.team-integrations-open').click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Google Drive\"]')?.getAttribute('aria-pressed')==='true'"), 'saved team integration preference restored')
  await evaluate("document.querySelector('[aria-label=\"Google Drive\"]').click()")
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancelar')?.click()")
  await waitFor(() => evaluate("document.querySelector('.team-roster-panel')&&Object.values(localStorage).some(value=>value==='[\\\"drive\\\"]')"), 'cancel preserves prior saved team preference')
  const inviteeEmail = editorEmail
  await evaluate(`(() => {const input=document.querySelector('.team-dialog [name="team-email"]');input.value=${JSON.stringify(inviteeEmail)};input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit()})()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('#team-invite-link')?.value)"), 'link de convite da equipe')
  await waitFor(() => evaluate("document.querySelector('.team-dialog .share-notice')?.textContent.includes('envio por e-mail está desativado')"), 'estado de entrega por link quando o provedor está desativado')
  const teamInviteHref = await evaluate("document.querySelector('#team-invite-link')?.value")
  const teamInviteToken = new URL(teamInviteHref).searchParams.get('teamInvite')
  assert.ok(teamInviteToken)
  const storedTeamInvite = await apiRequest(`/api/teams/${(await apiRequest('/api/teams', { cookie })).payload.teams.find(team=>team.name===teamName).id}/invitations`, { cookie })
  assert.equal(storedTeamInvite.payload.invitations[0].email, inviteeEmail)
  assert.equal('token' in storedTeamInvite.payload.invitations[0], false)
  const teamId = (await apiRequest('/api/teams', { cookie })).payload.teams.find(team=>team.name===teamName).id
  const cancelledInviteEmail = `team-cancelled-${Date.now()}@example.test`
  await evaluate(`(() => {const input=document.querySelector('.team-dialog [name="team-email"]');input.value=${JSON.stringify(cancelledInviteEmail)};input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit()})()`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Revogar convite para ${cancelledInviteEmail}"]'))`), 'convite pendente no painel da equipe')
  await evaluate(`document.querySelector('[aria-label="Revogar convite para ${cancelledInviteEmail}"]').click()`)
  await waitFor(async () => (await apiRequest(`/api/teams/${teamId}/invitations`, { cookie })).payload.invitations.some(invitation=>invitation.email===cancelledInviteEmail&&invitation.revokedAt), 'revogação de convite pela UI')
  await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.team-invitations .share-person')].find(row=>row.textContent.includes(${JSON.stringify(cancelledInviteEmail)}))?.textContent.includes('Revogado'))`), 'estado revogado no painel')
  assert.equal((await apiRequest(`/api/team-invitations/${teamInviteToken}`, { method: 'POST', cookie: editorCookie })).status, 200, 'local test account accepts the pending team invitation')
  assert.ok((await apiRequest('/api/teams', { cookie })).payload.teams.some(team=>team.id===teamId), 'owner still has team access after a new member accepts')
  await evaluate("document.querySelector('.team-dialog .auth-close').click()")
  await evaluate("Array.from(document.querySelectorAll('.library-mode-tabs button')).find(button=>button.textContent.trim()==='Neste dispositivo').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Neste dispositivo'"), 'biblioteca local antes de atualizar equipes')
  await evaluate("Array.from(document.querySelectorAll('.library-mode-tabs button')).find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'biblioteca na nuvem atualizada')
  await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.teams-list button')].find(button=>button.textContent.includes(${JSON.stringify(teamName)})))`), 'equipe com integrante')
  await evaluate(`[...document.querySelectorAll('.teams-list button')].find(button=>button.textContent.includes(${JSON.stringify(teamName)})).click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.team-dialog [aria-label=\"Papel de Docs collaborator\"]'))"), 'controles de papel da equipe')
  assert.equal(await evaluate("document.querySelectorAll('.team-roster-tabs [role=tab]').length===2"), true, 'team roster exposes member and AI usage tabs');
  assert.equal(await evaluate("document.querySelector('#team-roster-members-tab').getAttribute('aria-selected')==='true'"), true, 'reopened team dialog returns to its default Members tab');
  const memberRowsLayout = await evaluate("({rootWidth:document.documentElement.scrollWidth,viewport:innerWidth,tableWidth:document.querySelector('.team-roster-scroll')?.scrollWidth,viewportWidth:document.querySelector('.team-roster-scroll')?.clientWidth,rows:[...document.querySelectorAll('.team-dialog .team-roster-table tbody tr')].length})")
  assert.ok(memberRowsLayout.rootWidth <= 390 && memberRowsLayout.rows > 0 && memberRowsLayout.tableWidth >= memberRowsLayout.viewportWidth, `tabela de integrantes pode rolar sem estourar a p?gina: ${JSON.stringify(memberRowsLayout)}`)
  await evaluate("(()=>{const select=document.querySelector('.team-dialog [aria-label=\"Papel de Docs collaborator\"]');select.value='admin';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(async () => (await apiRequest(`/api/teams/${teamId}`, { cookie })).payload.members.some(member=>member.email===editorEmail&&member.role==='admin'), 'promoção de integrante pela UI')
  await waitFor(() => evaluate("Boolean([...document.querySelectorAll('.team-dialog .team-roster-table tbody tr')].find(item=>item.textContent.includes('Docs collaborator'))?.querySelector('button:not(:disabled)'))"), 'controles de integrante atualizados')
  await evaluate("(()=>{window.confirm=()=>true;const row=[...document.querySelectorAll('.team-dialog .team-roster-table tbody tr')].find(item=>item.textContent.includes('Docs collaborator'));row.querySelector('button').click()})()")
  await waitFor(async () => !(await apiRequest(`/api/teams/${teamId}`, { cookie })).payload.members.some(member=>member.email===editorEmail), 'remoção de integrante pela UI')
  const memberAudit = await apiRequest(`/api/teams/${teamId}/audit?limit=100`, { cookie })
  assert.ok(memberAudit.payload.events.some(event=>event.action==='team.member.role_changed'&&event.details.role==='admin'))
  assert.ok(memberAudit.payload.events.some(event=>event.action==='team.member.removed'))
  const teamLibraryAsset = await apiRequest(`/api/teams/${teamId}/media`, { method: 'POST', cookie, body: { asset: { id: 'team-library-logo', name: 'Logo da equipe', mimeType: 'image/svg+xml', width: 80, height: 60, src: sharedMediaSrc, fingerprint: 'e'.repeat(64) } } })
  assert.equal(teamLibraryAsset.status, 201)
  await evaluate("document.querySelector('.team-create-project').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.studio-app'))"), 'projeto criado pela equipe')
  await evaluate("[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Uploads'))?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.asset-dialog'))"), 'biblioteca de equipe aberta no projeto')
  await waitFor(() => evaluate("[...document.querySelectorAll('.asset-use')].some(button=>button.getAttribute('aria-label')==='Adicionar Logo da equipe da equipe ao design')"), 'asset da equipe visivel no projeto novo')
  await evaluate("[...document.querySelectorAll('.asset-use')].find(button=>button.getAttribute('aria-label')==='Adicionar Logo da equipe da equipe ao design')?.click()")
  const teamProject = await waitFor(async () => (await apiRequest('/api/documents', { cookie })).payload.documents.find(document => document.teamId === teamId && document.data.pages.some(page => page.elements.some(element => element.assetId === 'team-library-logo'))), 'asset da equipe vinculado ao projeto')
  const teamProjectMedia = await apiRequest(`/api/documents/${teamProject.id}/media`, { cookie })
  assert.ok(teamProjectMedia.payload.assets.some(asset => asset.id === 'team-library-logo'), 'team asset gets a document-scoped media reference for durable rendering')
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.teams-strip'))"), 'biblioteca apos testar asset da equipe')
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Abrir Rascunho de reconexão"]'))`), 'projeto remoto')
  await evaluate(`document.querySelector('[aria-label="Abrir Rascunho de reconexão"]').click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.sheet-grid [aria-label=\"A1\"]'))"), 'editor remoto da planilha')

  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' })
  await evaluate("document.querySelector('.sheet-grid [aria-label=\"A1\"]').focus()")
  await pressKey('a', 'KeyA', 65, 2)
  await send('Input.insertText', { text: 'Rascunho offline' })
  const draftInput = await evaluate("document.querySelector('.sheet-grid [aria-label=\"A1\"]')?.value")
  assert.equal(draftInput, 'Rascunho offline', `valor editado antes de salvar: ${draftInput}`)
  await pressKey('Tab', 'Tab', 9)
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Falha ao salvar')"), 'falha do autosave durante a desconexão')
  const unchanged = await apiRequest(`/api/documents/${documentId}`, { cookie })
  assert.equal(unchanged.status, 200)
  assert.equal(unchanged.payload.revision, 1)
  assert.equal(unchanged.payload.data.pages[0].cells[0][0], 'Original')

  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' })
  const readsBeforeReconnect = documentReadCount
  await evaluate("window.__activeEventSource.dispatchEvent(new Event('error'))")
  await waitFor(() => evaluate("document.querySelector('.realtime-presence')?.classList.contains('reconnecting')"), 'estado de reconexão do cliente', 5000)
  await evaluate("window.__activeEventSource.dispatchEvent(new Event('open'))")
  await waitFor(() => documentReadCount > readsBeforeReconnect, 'refresh remoto ao reabrir SSE', 10000)
  await waitFor(() => evaluate("document.querySelector('.realtime-presence')?.classList.contains('connected')"), 'reconexão SSE', 45000)
  let saved
  try {
    saved = await waitFor(async () => {
      const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
      return response.status === 200 && response.payload.data.pages[0].cells[0][0] === 'Rascunho offline' ? response.payload : null
    }, 'retomada do autosave sem nova edição', 45000)
  } catch (error) {
    const diagnostics = await evaluate("({status:document.querySelector('.save-state')?.textContent, statusClass:document.querySelector('.save-state')?.className, realtime:document.querySelector('.realtime-presence')?.className, cell:document.querySelector('.sheet-grid [aria-label=\"A1\"]')?.value, conflict:Boolean(document.querySelector('.conflict-dialog'))})")
    const latest = await apiRequest(`/api/documents/${documentId}`, { cookie })
    console.error(JSON.stringify({ diagnostics, writes: documentRequests.filter(request => request.method === 'PUT'), serverRevision: latest.payload.revision, serverCell: latest.payload.data.pages[0].cells[0][0] }))
    throw error
  }
  assert.equal(saved.revision, 2)
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'cliente concluir a reconciliação do autosave recuperado')
  if (offlineOnly && !offlineReloadOnly) throw new Error('__OFFLINE_AUTOSAVE_CHECK_PASSED__')
  if (offlineReloadOnly) {
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' })
    await evaluate("document.querySelector('.sheet-grid [aria-label=\"A2\"]').focus()")
    await pressKey('a', 'KeyA', 65, 2)
    await send('Input.insertText', { text: 'Rascunho recuperado apos reload' })
    assert.equal(await evaluate("document.querySelector('.sheet-grid [aria-label=\"A2\"]')?.value"), 'Rascunho recuperado apos reload')
    await pressKey('Tab', 'Tab', 9)
    await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Falha ao salvar')"), 'segunda edicao offline permanece pendente')
    const preReloadRemote = await apiRequest(`/api/documents/${documentId}`, { cookie })
    assert.equal(preReloadRemote.payload.revision, 2, 'server remains at revision two before the offline reload')
    assert.equal(preReloadRemote.payload.data.pages[0].cells[1][0], '', 'the second offline edit has not reached the server')
    const readDraft = () => evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{return await new Promise((resolve,reject)=>{const r=db.transaction('cloudDrafts','readonly').objectStore('cloudDrafts').get(${JSON.stringify(documentId)});r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error)})}finally{db.close()}})()`)
    const beforeReloadDraft = await waitFor(async () => { const draft = await readDraft(); return draft?.document?.pages?.[0]?.cells?.[1]?.[0] === 'Rascunho recuperado apos reload' ? draft : null }, 'offline edit is durable in the cloud draft store').catch(async error => { console.error(JSON.stringify({ draft: await readDraft(), editor: await evaluate("({cell:document.querySelector('.sheet-grid [aria-label=\"A2\"]')?.value,status:document.querySelector('.save-state')?.textContent,notice:document.querySelector('.permission-notice')?.textContent})"), server: (await apiRequest(`/api/documents/${documentId}`, { cookie })).payload })); throw error })
    assert.equal(beforeReloadDraft.baseRevision, 2)

    const blockedDocumentUrl = `${webOrigin}/api/documents/${documentId}`
    await send('Network.setBlockedURLs', { urls: [blockedDocumentUrl] })
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' })
    await send('Page.reload')
    await waitFor(() => evaluate("document.querySelector('.sheet-grid [aria-label=\"A2\"]')?.value==='Rascunho recuperado apos reload'&&document.querySelector('.permission-notice')?.textContent.includes('Modo sem conexao')"), 'editor restores the durable draft while the document API is blocked')
    const afterReloadDraft = await readDraft()
    assert.equal(afterReloadDraft?.document?.pages?.[0]?.cells?.[1]?.[0], 'Rascunho recuperado apos reload')
    const remoteWhileBlocked = await apiRequest(`/api/documents/${documentId}`, { cookie })
    assert.equal(remoteWhileBlocked.payload.revision, 2)
    assert.equal(remoteWhileBlocked.payload.data.pages[0].cells[1][0], '')

    await send('Network.setBlockedURLs', { urls: [] })
    await evaluate("window.__activeEventSource.onerror?.(new Event('error'))")
    await waitFor(() => evaluate("document.querySelector('.realtime-presence')?.classList.contains('reconnecting')"), 'offline-reload client announces reconnection', 5000)
    await evaluate("window.__activeEventSource.onopen?.(new Event('open'))")
    const recovered = await waitFor(async () => {
      const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
      return response.status === 200 && response.payload.data.pages[0].cells[1][0] === 'Rascunho recuperado apos reload' ? response.payload : null
    }, 'reloaded draft merges and autosaves after reconnection', 45000)
    assert.equal(recovered.revision, 3)
    await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'reloaded draft reports saved in cloud')
    await waitFor(async () => (await readDraft()) === null, 'successfully saved cloud draft is removed from local storage')
    throw new Error('__OFFLINE_RELOAD_RECOVERY_PASSED__')
  }
  await new Promise(resolve => setTimeout(resolve, 450))
  const putsBeforeOperation = documentRequests.filter(request => request.method === 'PUT').length
  const checkpoints = [{ label: 'operations-start', at: Date.now(), puts: putsBeforeOperation }]
  const checkpoint = label => checkpoints.push({ label, at: Date.now(), puts: documentRequests.filter(request => request.method === 'PUT').length })
  const operationsBefore = operationRequests.length
  await evaluate("document.querySelector('.sheet-grid [aria-label=\"A2\"]').focus()")
  await pressKey('a', 'KeyA', 65, 2)
  await send('Input.insertText', { text: 'Client cell operation' })
  await pressKey('Tab', 'Tab', 9)
  await waitFor(() => operationRequests.length > operationsBefore && operationRequests.at(-1)?.status === 200, 'operação de célula enviada pelo editor')
  const afterClientOperation = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
    return response.payload.data.pages[0].cells[1][0] === 'Client cell operation' ? response.payload : null
  }, 'persistência da operação do editor')
  assert.equal(afterClientOperation.data.pages[0].cells[1][0], 'Client cell operation')
  checkpoint('client-cell')
  async function enterSheetFormula(address, formula) {
    const before = operationRequests.length
    await evaluate(`document.querySelector('.sheet-grid [aria-label="${address}"]').focus()`)
    await pressKey('a', 'KeyA', 65, 2)
    await send('Input.insertText', { text: formula })
    await pressKey('Tab', 'Tab', 9)
    await waitFor(() => operationRequests.length > before && operationRequests.at(-1)?.status === 200, `fórmula colaborativa em ${address}`)
  }
  await enterSheetFormula('C2', '=LEN(A2)')
  await enterSheetFormula('D2', '=$A$2&":"&C2')
  await evaluate("document.querySelector('.sheet-grid [aria-label=\"C2\"]').focus()")
  await pressKey('ArrowRight', 'ArrowRight', 39, 8)
  await waitFor(() => evaluate("document.querySelectorAll('.sheet-grid .sheet-cell-range').length===2"), 'seleção da faixa de fórmulas colaborativa')
  const internalRangeClipboard = await evaluate(`(()=>{const clipboard=new DataTransfer();document.activeElement.dispatchEvent(new ClipboardEvent('copy',{clipboardData:clipboard,bubbles:true,cancelable:true}));window.__formulaRangeClipboard=clipboard;return JSON.parse(clipboard.getData('application/x-fuse-studio-sheet-range+json')).cells})()`)
  assert.deepEqual(internalRangeClipboard, [['=LEN(A2)', '=$A$2&":"&C2']])
  const rangeOperationsAt = operationRequests.length
  const rangeOperationRecordsAt = await evaluate("window.__operationRecords.filter(item=>item.request?.type==='sheet.cells.set').length")
  await evaluate("document.querySelector('.sheet-grid [aria-label=\"C3\"]').focus()")
  await evaluate("document.querySelector('.sheet-grid [aria-label=\"C3\"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:window.__formulaRangeClipboard,bubbles:true,cancelable:true}))")
  await waitFor(() => operationRequests.length > rangeOperationsAt && operationRequests.at(-1)?.status === 200, 'faixa de fórmulas enviada como operação colaborativa')
  const pastedRangeOperation = await waitFor(() => evaluate(`window.__operationRecords.filter(item=>item.request?.type==='sheet.cells.set').length>${rangeOperationRecordsAt} ? window.__operationRecords.filter(item=>item.request?.type==='sheet.cells.set').at(-1)?.request : null`), 'captura da operação de colagem da faixa')
  assert.deepEqual(pastedRangeOperation.cells, [
    { row: 2, column: 2, value: '=LEN(A3)' },
    { row: 2, column: 3, value: '=$A$2&":"&C3' },
  ])
  const persistedFormulaRange = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
    const cells = response.payload.data.pages[0].cells
    return cells[2][2] === '=LEN(A3)' && cells[2][3] === '=$A$2&":"&C3' ? response.payload : null
  }, 'faixa de fórmulas persistida no documento compartilhado')
  assert.equal(persistedFormulaRange.data.pages[0].cells[2][3], '=$A$2&":"&C3')
  const remoteCell = await apiRequest(`/api/documents/${documentId}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'sheet.cells.set', operationId: `remote-${Date.now()}`, baseRevision: afterClientOperation.revision,
    pageId: 'sheet-page', cells: [{ row: 1, column: 1, value: 'Remote cell operation' }],
  } })
  assert.equal(remoteCell.status, 200)
  await waitFor(() => evaluate("document.querySelector('.sheet-grid [aria-label=\"B2\"]')?.value === 'Remote cell operation'"), 'atualização da célula remota pelo SSE')
  await evaluate("document.querySelector('[aria-label=\"B2\"]').focus()")
  await waitFor(() => evaluate("document.querySelector('.sheet-address')?.textContent==='B2'"), 'célula B2 selecionada antes de aplicar o formato')
  let operationsAt = operationRequests.length
  await evaluate("(()=>{const select=document.querySelector('.sheet-format-control select');if(!select)throw new Error('sheet number-format control not found');select.value='currency';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => operationRequests.length > operationsAt && operationRequests.at(-1)?.status === 200, 'operação remota de formato')
  let afterFormat
  try {
    afterFormat = await waitFor(async () => {
      const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
      return response.payload.data.pages[0].cellFormats?.['1:1'] === 'currency' ? response.payload : null
    }, 'persistência do formato por operação')
  } catch (error) {
    const latest = await apiRequest(`/api/documents/${documentId}`, { cookie })
    const diagnostics = await evaluate("({address:document.querySelector('.sheet-address')?.textContent,format:document.querySelector('[aria-label=\"Formato de números\"]')?.value,selected:document.querySelector('.sheet-grid .sheet-cell-active input')?.getAttribute('aria-label'),saveState:document.querySelector('.save-state')?.textContent})")
    console.error(JSON.stringify({ diagnostics, formats: latest.payload.data.pages[0].cellFormats, revision: latest.payload.revision, operations: operationRequests.slice(-3) }))
    throw error
  }
  checkpoint('format')
  await evaluate("document.querySelector('.sheet-grid [aria-label=\"A4\"]').focus()")
  const mergePosition = await evaluate(`(()=>{const r=document.querySelector('[aria-label="B4"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mergePosition.x, y: mergePosition.y, modifiers: 8 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mergePosition.x, y: mergePosition.y, button: 'left', clickCount: 1, modifiers: 8 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mergePosition.x, y: mergePosition.y, button: 'left', clickCount: 1, modifiers: 8 })
  operationsAt = operationRequests.length
  await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText==='Mesclar faixa').click()")
  await waitFor(() => operationRequests.length > operationsAt && operationRequests.at(-1)?.status === 200, 'operação remota de mesclagem')
  const afterMerge = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
    return response.payload.data.pages[0].cellMerges?.some(merge => merge.row === 3 && merge.column === 0 && merge.colSpan === 2) ? response.payload : null
  }, 'persistência da mesclagem por operação')
  checkpoint('merge')
  operationsAt = operationRequests.length
  await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText==='Desfazer mesclagem').click()")
  await waitFor(() => operationRequests.length > operationsAt && operationRequests.at(-1)?.status === 200, 'operação remota de desmesclagem')
  await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
    return !response.payload.data.pages[0].cellMerges?.some(merge => merge.row === 3 && merge.column === 0) ? response.payload : null
  }, 'persistência da desmesclagem por operação')
  checkpoint('unmerge')
  const afterUnmerge = await apiRequest(`/api/documents/${documentId}`, { cookie })
  const remoteRow = await apiRequest(`/api/documents/${documentId}/operations`, { method: 'POST', cookie, body: {
    type: 'sheet.rows.append', operationId: `remote-row-${Date.now()}`, baseRevision: afterUnmerge.payload.revision, pageId: 'sheet-page',
  } })
  assert.equal(remoteRow.status, 200)
  await waitFor(() => evaluate("Boolean(document.querySelector('.sheet-grid [aria-label=\"A31\"]'))"), 'linha adicionada pelo colaborador chega por SSE')
  checkpoint('remote-row')
  operationsAt = operationRequests.length
  await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText.includes('Linha')).click()")
  await waitFor(() => operationRequests.length > operationsAt && operationRequests.at(-1)?.status === 200, 'operação de inclusão de linha enviada pelo editor')
  await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
    return response.payload.data.pages[0].cells.length === 32 ? response.payload : null
  }, 'persistência colaborativa das linhas')
  checkpoint('local-row')
  const afterRows = await apiRequest(`/api/documents/${documentId}`, { cookie })
  const remoteColumn = await apiRequest(`/api/documents/${documentId}/operations`, { method: 'POST', cookie, body: {
    type: 'sheet.columns.append', operationId: `remote-column-${Date.now()}`, baseRevision: afterRows.payload.revision, pageId: 'sheet-page',
  } })
  assert.equal(remoteColumn.status, 200)
  await waitFor(() => evaluate("Boolean(document.querySelector('.sheet-grid [aria-label=\"M1\"]'))"), 'coluna adicionada pelo colaborador chega por SSE')
  checkpoint('remote-column')
  operationsAt = operationRequests.length
  await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText.includes('Coluna')).click()")
  await waitFor(() => operationRequests.length > operationsAt && operationRequests.at(-1)?.status === 200, 'operação de inclusão de coluna enviada pelo editor')
  const afterColumns = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${documentId}`, { cookie })
    return response.payload.data.pages[0].cells.every(row => row.length === 14) ? response.payload : null
  }, 'persistência colaborativa das colunas')
  checkpoint('local-column')
  await new Promise(resolve => setTimeout(resolve, 700))
  if (documentRequests.filter(request => request.method === 'PUT').length !== putsBeforeOperation) {
    const latest = await apiRequest(`/api/documents/${documentId}`, { cookie })
    const diagnostics = await evaluate("({saveState:document.querySelector('.save-state')?.textContent,cellCount:document.querySelectorAll('.sheet-grid input').length,active:document.activeElement?.getAttribute('aria-label')})")
    const snapshots = await evaluate("window.__putBodies.map(item=>({at:item.at,revision:item.body.revision,dimensions:item.body.data.pages?.[0]?.cells?.map(row=>row.length),rows:item.body.data.pages?.[0]?.cells?.length,formats:item.body.data.pages?.[0]?.cellFormats,merges:item.body.data.pages?.[0]?.cellMerges}))")
    const lastOperation = await evaluate("window.__operationRecords.filter(item=>item.response?.document?.type==='sheet').at(-1)")
    const snapshotDiff = await evaluate(`(()=>{const a=window.__operationRecords.filter(item=>item.response?.document?.type==='sheet').at(-1)?.response?.document;const b=window.__putBodies.at(-1)?.body?.data;const differences=[];function walk(left,right,path){if(JSON.stringify(left)===JSON.stringify(right))return;if(Array.isArray(left)&&Array.isArray(right)){for(let i=0;i<Math.max(left.length,right.length);i++)walk(left[i],right[i],path+'['+i+']');return}if(left&&right&&typeof left==='object'&&typeof right==='object'){for(const key of new Set([...Object.keys(left),...Object.keys(right)]))walk(left[key],right[key],path?path+'.'+key:key);return}differences.push({path,left,right})}walk(a,b,'');return differences.slice(0,20)})()`)
    checkpoint('final')
    console.error(JSON.stringify({ extraPuts: documentRequests.filter(request => request.method === 'PUT' && request.at), checkpoints, diagnostics, snapshots, lastOperation: lastOperation?.request?.type, snapshotDiff, revision: latest.payload.revision, dimensions: { rows: latest.payload.data.pages[0].cells.length, columns: latest.payload.data.pages[0].cells[0].length } }))
  }
  assert.equal(documentRequests.filter(request => request.method === 'PUT').length, putsBeforeOperation, 'células sincronizadas por operação não devem gerar snapshot redundante')
  assert.equal(afterFormat.data.pages[0].cellFormats['1:1'], 'currency')
  assert.ok(afterMerge.data.pages[0].cellMerges.some(merge => merge.row === 3 && merge.column === 0 && merge.colSpan === 2))
  assert.equal(afterColumns.data.pages[0].cells.length, 32)
  assert.equal(afterColumns.data.pages[0].cells[0][0], 'Rascunho offline')
  const collaborativeDoc = await apiRequest('/api/documents', { method: 'POST', cookie, body: {
    name: 'Tabela colaborativa', data: { type: 'doc', width: 794, height: 1123, pages: [{ id: 'doc-page', name: 'Página 1', elements: [], blocks: [{ id: 'paragraph-1', type: 'paragraph', text: 'Open tasks', marks: [] }, { id: 'table-block', type: 'table', text: '', cells: [['A', 'B'], ['C', 'D']] }] }] },
  } })
  assert.equal(collaborativeDoc.status, 201)
  assert.equal((await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Abrir Tabela colaborativa"]'))`), 'documento colaborativo na biblioteca')
  await evaluate(`document.querySelector('[aria-label="Abrir Tabela colaborativa"]').click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.doc-layout textarea[data-table-id=\"table-block\"]'))"), 'editor do documento colaborativo')
  const docPutsBefore = documentRequests.filter(request => request.method === 'PUT').length
  let docOperationsAt = operationRequests.length
  await evaluate("(()=>{const field=document.querySelector('.doc-layout .doc-editable-text');if(!field)throw new Error('Docs editable text block not found');field.focus();const range=document.createRange();range.selectNodeContents(field);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)})()")
  await send('Input.insertText', { text: 'Open tasks urgent' })
  await waitFor(() => evaluate("document.querySelector('.doc-layout .doc-editable-text')?.innerText === 'Open tasks urgent'"), 'edição local do texto Docs')
  await waitFor(() => operationRequests.length > docOperationsAt && operationRequests.at(-1)?.status === 200, 'operação colaborativa de texto Docs')
  const afterDocText = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks[0].text === 'Open tasks urgent' ? response.payload : null
  }, 'persistência atômica do texto Docs')
  assert.equal(afterDocText.revision, 2)
  const remoteText = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.block.text.set', operationId: `remote-doc-text-${Date.now()}`, baseRevision: 1, pageId: 'doc-page', blockId: 'paragraph-1', text: 'Team: Open tasks', marks: [],
  } })
  assert.equal(remoteText.status, 200)
  assert.equal(remoteText.payload.document.pages[0].blocks[0].text, 'Team: Open tasks urgent')
  await waitFor(() => evaluate("document.querySelector('.doc-layout .doc-editable-text')?.innerText === 'Team: Open tasks urgent'"), 'texto Docs remoto rebaseado e recebido por SSE')
  docOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.doc-layout textarea[aria-label=\"Linha 1, coluna 1\"]').focus()")
  await pressKey('a', 'KeyA', 65, 2)
  await send('Input.insertText', { text: 'Owner table edit' })
  await waitFor(() => operationRequests.length > docOperationsAt && operationRequests.at(-1)?.status === 200, 'operação colaborativa de célula da tabela Docs')
  const afterDocCell = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks[1].cells[0][0] === 'Owner table edit' ? response.payload : null
  }, 'persistência atômica da célula Docs')
  await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.table.cell.set', operationId: `remote-doc-cell-${Date.now()}`, baseRevision: afterDocCell.revision, pageId: 'doc-page', blockId: 'table-block', row: 1, column: 1, value: 'Editor table edit',
  } })
  await waitFor(() => evaluate("document.querySelector('.doc-layout textarea[aria-label=\"Linha 2, coluna 2\"]')?.value === 'Editor table edit'"), 'célula Docs remota recebida por SSE')
  await new Promise(resolve => setTimeout(resolve, 700))
  let docStructureClientOperationsAt = await evaluate('window.__operationRecords.length')
  docOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.doc-inline-table-actions button:first-child')?.click()")
  await waitFor(() => operationRequests.length > docOperationsAt && operationRequests.at(-1)?.status === 200, 'Docs sends collaborative row append')
  await waitFor(() => evaluate(`window.__operationRecords.slice(${docStructureClientOperationsAt}).some(item=>item.request?.type==='doc.table.structure'&&item.request.action==='row.append'&&item.response?.revision)`), 'row.append operation recorded from the editor')
  const afterDocRowAppend = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks[1].cells.length === 3 ? response.payload : null
  }, 'Docs row append persisted')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent === 'Salvo na nuvem' && !document.querySelector('.conflict-dialog')"), 'local row append reconciled before the remote operation')
  const remoteColumnAppend = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.table.structure', action: 'column.append', operationId: `remote-doc-column-${Date.now()}`, baseRevision: afterDocRowAppend.revision, pageId: 'doc-page', blockId: 'table-block',
  } })
  assert.equal(remoteColumnAppend.status, 200)
  await waitFor(() => evaluate(`window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision===${remoteColumnAppend.payload.revision})`), 'remote Docs column append SSE event')
  await waitFor(() => evaluate("document.querySelectorAll('.doc-layout .doc-page:not(.doc-measure-page) .doc-table tr').length===3&&[...document.querySelectorAll('.doc-layout .doc-page:not(.doc-measure-page) .doc-table tr')].every(row=>row.querySelectorAll('td').length===3)"), 'remote Docs column append arrives over SSE').catch(async error=>{console.error(JSON.stringify({remote:remoteColumnAppend.payload.revision,events:await evaluate("window.__sseMessages.slice(-8)"),table:await evaluate("({rows:[...document.querySelectorAll('.doc-layout .doc-table tr')].map(row=>row.querySelectorAll('td').length),state:document.querySelector('.save-state')?.textContent,conflict:document.querySelector('.conflict-dialog')?.textContent,operations:window.__operationRecords.slice(-5)})")}));throw error})
  await evaluate("(()=>{const cells=[...document.querySelectorAll('.doc-layout textarea[data-table-row=\"0\"]')];cells[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));cells[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,shiftKey:true}))})()")
  docStructureClientOperationsAt = await evaluate('window.__operationRecords.length')
  docOperationsAt = operationRequests.length
  await evaluate("[...document.querySelectorAll('.doc-inline-table-actions button')].find(button=>button.textContent.includes('Mesclar seleção'))?.click()")
  await waitFor(() => operationRequests.length > docOperationsAt && operationRequests.at(-1)?.status === 200, 'Docs sends collaborative cell merge')
  await waitFor(() => evaluate(`window.__operationRecords.slice(${docStructureClientOperationsAt}).some(item=>item.request?.type==='doc.table.structure'&&item.request.action==='merge'&&item.response?.revision)`), 'merge operation recorded from the editor')
  const mergedDocTable = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks[1].merges?.some(merge => merge.row === 0 && merge.column === 0 && merge.colSpan === 2) ? response.payload : null
  }, 'merged Docs table persisted')
  const remoteUnmerge = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.table.structure', action: 'unmerge', operationId: `remote-doc-unmerge-${Date.now()}`, baseRevision: mergedDocTable.revision, pageId: 'doc-page', blockId: 'table-block', row: 0, column: 1,
  } })
  assert.equal(remoteUnmerge.status, 200)
  await waitFor(() => evaluate("!document.querySelector('.doc-layout .doc-table tr:first-child td[colspan=\"2\"]')"), 'remote Docs unmerge arrives over SSE')
  docOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.doc-inline-table-actions button:nth-child(3)')?.click()")
  await waitFor(() => operationRequests.length > docOperationsAt && operationRequests.at(-1)?.status === 200, 'Docs sends collaborative row deletion')
  const afterDocRowDelete = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks[1].cells.length === 2 ? response.payload : null
  }, 'Docs row deletion persisted')
  const remoteColumnDelete = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.table.structure', action: 'column.delete', operationId: `remote-doc-column-delete-${Date.now()}`, baseRevision: afterDocRowDelete.revision, pageId: 'doc-page', blockId: 'table-block', column: 1,
  } })
  assert.equal(remoteColumnDelete.status, 200)
  await waitFor(() => evaluate("document.querySelectorAll('.doc-layout .doc-page:not(.doc-measure-page) .doc-table tr').length===2&&[...document.querySelectorAll('.doc-layout .doc-page:not(.doc-measure-page) .doc-table tr')].every(row=>row.querySelectorAll('td').length===2)"), 'remote Docs column deletion arrives over SSE')
  let clientDocOperationsAt = await evaluate('window.__operationRecords.length')
  docOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.doc-add-blocks button:first-child').click()")
  try {
    await waitFor(() => evaluate(`window.__operationRecords.slice(${clientDocOperationsAt}).some(item=>item.request?.type==='doc.block.insert'&&item.response?.revision)`), 'collaborative Docs block insertion')
  } catch (error) {
    console.error(JSON.stringify({ buttons: await evaluate("[...document.querySelectorAll('.doc-add-blocks button')].map(button=>({text:button.textContent,disabled:button.disabled}))"), recentOperations: await evaluate('window.__operationRecords.slice(-4)'), recentPuts: documentRequests.filter(request => request.method === 'PUT').slice(-2) }))
    throw error
  }
  let afterDocInsert = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks.some(block => block.type === 'heading' && block.text === '') ? response.payload : null
  }, 'Docs block structure persistence')
  clientDocOperationsAt = await evaluate('window.__operationRecords.length')
  docOperationsAt = operationRequests.length
  await evaluate("(()=>{const select=document.querySelector('.doc-toolbar select[aria-label=\"Estilo do bloco\"]');select.value='quote';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${clientDocOperationsAt}).some(item=>item.request?.type==='doc.block.type.set'&&item.response?.revision)`), 'collaborative Docs block style change')
  afterDocInsert = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    return response.payload.data.pages[0].blocks.some(block => block.type === 'quote') ? response.payload : null
  }, 'Docs block style persistence')
  const remoteDocInsert = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.block.insert', operationId: `remote-doc-insert-${Date.now()}`, baseRevision: afterDocInsert.revision, pageId: 'doc-page', afterBlockId: 'paragraph-1', block: { id: 'remote-note', type: 'bullet', text: 'Remote note', marks: [] },
  } })
  assert.equal(remoteDocInsert.status, 200)
  await waitFor(() => evaluate("document.querySelector('.doc-outline-list')?.innerText.includes('Remote note')"), 'remote Docs block received over SSE')
  const quoteBlockId = afterDocInsert.data.pages[0].blocks.find(block => block.type === 'quote').id
  await evaluate(`document.querySelector('[data-doc-block-id="${quoteBlockId}"]')?.click()`)
  assert.equal(await evaluate("document.querySelector('.doc-outline-list button.selected')?.dataset.docBlockId"), quoteBlockId)
  const expectedDocOrder = remoteDocInsert.payload.document.pages[0].blocks.map(block => block.id)
  const quoteIndex = expectedDocOrder.indexOf(quoteBlockId)
  assert.ok(quoteIndex > 0)
  ;[expectedDocOrder[quoteIndex - 1], expectedDocOrder[quoteIndex]] = [expectedDocOrder[quoteIndex], expectedDocOrder[quoteIndex - 1]]
  clientDocOperationsAt = await evaluate('window.__operationRecords.length')
  await evaluate("document.querySelector('[aria-label=\"Mover bloco para cima\"]')?.click()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${clientDocOperationsAt}).some(item=>item.request?.type==='doc.blocks.reorder'&&item.response?.revision)`), 'collaborative Docs block reorder')
  assert.deepEqual(await evaluate('window.__operationRecords.at(-1).request.blockIds'), expectedDocOrder)
  let afterDocReorder
  try {
    afterDocReorder = await waitFor(async () => {
      const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
      return response.payload.data.pages[0].blocks.map(block => block.type).join(',') === 'paragraph,bullet,quote,table' ? response.payload : null
    }, 'Docs block order persistence')
  } catch (error) {
    console.error(JSON.stringify({ actualOrder: (await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })).payload.data.pages[0].blocks.map(block => ({ id: block.id, type: block.type, text: block.text })), reorderOperation: await evaluate('window.__operationRecords.slice(-3)'), selectedBlock: await evaluate("document.querySelector('.doc-outline-list button.selected')?.textContent") }))
    throw error
  }
  assert.ok(afterDocReorder.revision > afterDocInsert.revision)
  clientDocOperationsAt = await evaluate('window.__operationRecords.length')
  docOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.doc-delete-block')?.click()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${clientDocOperationsAt}).some(item=>item.request?.type==='doc.block.delete'&&item.response?.revision)`), 'collaborative Docs block deletion')
  const beforeReplaceAll = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
  await apiRequest(`/api/documents/${collaborativeDoc.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'doc.table.cell.set', operationId: `remote-doc-replace-cell-${Date.now()}`, baseRevision: beforeReplaceAll.payload.revision, pageId: 'doc-page', blockId: 'table-block', row: 0, column: 0, value: 'Open table',
  } })
  await waitFor(() => evaluate("document.querySelector('.doc-layout textarea[aria-label=\"Linha 1, coluna 1\"]')?.value === 'Open table'"), 'replacement input cell received remotely')
  clientDocOperationsAt = await evaluate('window.__operationRecords.length')
  await evaluate("document.querySelector('[aria-label=\"Localizar texto\"]').focus()")
  await send('Input.insertText', { text: 'Open' })
  await evaluate("document.querySelector('[aria-label=\"Substituir por\"]').focus()")
  await send('Input.insertText', { text: 'Start' })
  await evaluate("document.querySelector('.doc-search-tools button').click()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${clientDocOperationsAt}).some(item=>item.request?.type==='doc.replace.apply'&&item.response?.revision)`), 'atomic collaborative Docs replace-all operation')
  const replaceOperation = await evaluate('window.__operationRecords.at(-1).request')
  assert.equal(replaceOperation.blocks.length, 1)
  assert.equal(replaceOperation.cells.length, 1)
  await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    const blocks = response.payload.data.pages[0].blocks
    return blocks[0].text === 'Team: Start tasks urgent' && blocks.find(block => block.id === 'table-block').cells[0][0] === 'Start table' ? response.payload : null
  }, 'Docs replace-all text and table persistence')
  await new Promise(resolve => setTimeout(resolve, 700))
  if (documentRequests.filter(request => request.method === 'PUT').length !== docPutsBefore) {
    console.error(JSON.stringify({ docPutsBefore, docPutsAfter: documentRequests.filter(request => request.method === 'PUT'), putBodies: await evaluate("window.__putBodies.map(item=>({revision:item.body.revision,blocks:(item.body.data.pages?.[0]?.blocks??[]).map(block=>({id:block.id,type:block.type,text:block.text,cells:block.cells}))}))"), recentOperations: await evaluate('window.__operationRecords.slice(-5)'), saveState: await evaluate("document.querySelector('.save-state')?.textContent") }))
  }
  assert.equal(documentRequests.filter(request => request.method === 'PUT').length, docPutsBefore, 'operações colaborativas da tabela Docs não devem gerar snapshots redundantes')
  const putsBeforeReplaceUndo = documentRequests.filter(request => request.method === 'PUT').length
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Desfazer\"]')?.disabled"), false, 'collaborative replace-all is one undoable action')
  await evaluate("document.querySelector('[aria-label=\"Desfazer\"]').click()")
  await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    const blocks = response.payload.data.pages[0].blocks
    return blocks[0].text === 'Team: Open tasks urgent' && blocks.find(block => block.id === 'table-block').cells[0][0] === 'Open table' ? response.payload : null
  }, 'one Undo reverts collaborative Docs replace-all text and cell together')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo na nuvem')"), 'collaborative replace-all undo snapshot persists')
  assert.equal(documentRequests.filter(request => request.method === 'PUT').length, putsBeforeReplaceUndo + 1, 'Undo persists one intentional snapshot after operation sync')
  await evaluate("document.querySelector('[aria-label=\"Refazer\"]').click()")
  await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDoc.payload.id}`, { cookie })
    const blocks = response.payload.data.pages[0].blocks
    return blocks[0].text === 'Team: Start tasks urgent' && blocks.find(block => block.id === 'table-block').cells[0][0] === 'Start table' ? response.payload : null
  }, 'one Redo reapplies collaborative Docs replace-all text and cell together')
  const collaborativeDesign = await apiRequest('/api/documents', { method: 'POST', cookie, body: {
    name: 'Design colaborativo', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'design-page', name: 'Página 1', background: '#ffffff', elements: [
      { id: 'shape-1', type: 'shape', shape: 'rect', name: 'Retângulo A', x: 100, y: 100, width: 120, height: 80, rotation: 0, fill: '#8e7cf5', cornerRadius: 4 },
      { id: 'shape-2', type: 'shape', shape: 'ellipse', name: 'Elipse B', x: 280, y: 100, width: 120, height: 80, rotation: 0, fill: '#ff896f', cornerRadius: 0 },
    ] }] },
  } })
  assert.equal(collaborativeDesign.status, 201)
  assert.equal((await apiRequest(`/api/documents/${collaborativeDesign.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  const videoClipOne = { id: 'shared-audio-clip-one', assetId: 'shared-audio-one', name: 'Trilha principal.wav', kind: 'audio', startMs: 0, durationMs: 5000, sourceDurationMs: 8000, sourceStartMs: 0, volume: 1 }
  const videoClipTwo = { id: 'shared-audio-clip-two', assetId: 'shared-audio-two', name: 'Efeitos.wav', kind: 'audio', startMs: 1500, durationMs: 4000, sourceDurationMs: 7000, sourceStartMs: 0, volume: 1 }
  const videoTrackOne = { id: 'shared-video-clip-one', assetId: 'shared-video-one', name: 'Base vermelha.webm', kind: 'video', startMs: 0, durationMs: 1200, sourceDurationMs: 1200, sourceStartMs: 0, volume: 0, trackIndex: 0 }
  const videoTrackTwo = { id: 'shared-video-clip-two', assetId: 'shared-video-two', name: 'Sobreposição azul.webm', kind: 'video', startMs: 0, durationMs: 1200, sourceDurationMs: 1200, sourceStartMs: 0, volume: 0, trackIndex: 1 }
  const collaborativeVideo = await apiRequest('/api/documents', { method: 'POST', cookie, body: { name: 'Vídeo colaborativo', data: { type: 'video', width: 1920, height: 1080, videoDurationMs: 10_000, pages: [{ id: 'video-scene', name: 'Cena 1', background: '#000000', elements: [], timelineClips: [videoClipOne, videoClipTwo, videoTrackOne, videoTrackTwo] }] } } })
  assert.equal(collaborativeVideo.status, 201)
  assert.equal((await apiRequest(`/api/documents/${collaborativeVideo.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  for (const [id, name, sourceDurationMs] of [['shared-audio-one', videoClipOne.name, videoClipOne.sourceDurationMs], ['shared-audio-two', videoClipTwo.name, videoClipTwo.sourceDurationMs]]) {
    const uploaded = await apiRequest(`/api/documents/${collaborativeVideo.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id, name, mimeType: 'audio/wav', width: 1, height: 1, src: silentWavDataUrl(sourceDurationMs), fingerprint: (id === 'shared-audio-one' ? 'b' : 'c').repeat(64), createdAt: new Date().toISOString() } } })
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.payload))
  }
  for (const [id, name, fixture] of [['shared-video-one', videoTrackOne.name, videoFixture], ['shared-video-two', videoTrackTwo.name, secondVideoFixture]]) {
    const src = `data:${fixture.mimeType};base64,${String(fixture.src).split(',').at(-1)}`
    const uploaded = await apiRequest(`/api/documents/${collaborativeVideo.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id, name, mimeType: fixture.mimeType, width: 160, height: 90, src } } })
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.payload))
  }
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Abrir Design colaborativo"]'))`), 'design colaborativo na biblioteca')
  await evaluate(`document.querySelector('[aria-label="Abrir Design colaborativo"]').click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace'))"), 'editor do design colaborativo')
  await evaluate("document.querySelector('.layers-list button[title=\"Retângulo A\"]')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.position-grid input'))"), 'elemento selecionado no design')
  const designPutsBefore = documentRequests.filter(request => request.documentId === collaborativeDesign.payload.id && request.method === 'PUT').length
  let designOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.position-grid input').focus()")
  await pressKey('a', 'KeyA', 65, 2)
  await send('Input.insertText', { text: '120' })
  await waitFor(() => operationRequests.length > designOperationsAt && operationRequests.at(-1)?.status === 200, 'operação do elemento enviada pelo editor visual')
  const afterDesignX = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}`, { cookie })
    return response.payload.data.pages[0].elements[0].x === 120 ? response.payload : null
  }, 'persistência do movimento do elemento')
  designOperationsAt = operationRequests.length
  await evaluate("document.querySelector('[aria-label=\"Trazer camada para frente\"]')?.click()")
  await waitFor(() => operationRequests.length > designOperationsAt && operationRequests.at(-1)?.status === 200, 'ordenação de camada enviada pelo editor visual')
  const afterDesignOrder = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}`, { cookie })
    return response.payload.data.pages[0].elements.map(element => element.id).join(',') === 'shape-2,shape-1' ? response.payload : null
  }, 'persistência da ordem das camadas')
  const remoteDesignY = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'design.element.patch', operationId: `remote-design-y-${Date.now()}`, baseRevision: afterDesignOrder.revision, pageId: 'design-page', elementId: 'shape-1', patch: { y: 140 },
  } })
  assert.equal(remoteDesignY.status, 200)
  const remotelyEditedShape = remoteDesignY.payload.document.pages[0].elements.find(element => element.id === 'shape-1')
  assert.deepEqual({ x: remotelyEditedShape.x, y: remotelyEditedShape.y }, { x: 120, y: 140 })
  const designConflict = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'design.element.patch', operationId: `conflict-design-x-${Date.now()}`, baseRevision: 1, pageId: 'design-page', elementId: 'shape-1', patch: { x: 300 },
  } })
  assert.equal(designConflict.status, 409)
  await waitFor(() => evaluate("(()=>{document.querySelector('.layers-list button[title=\"Retângulo A\"]')?.click();return document.querySelectorAll('.position-grid input')[1]?.value==='140'})()"), 'propriedade do elemento remoto recebida por SSE')
  const remoteDesignOrder = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'design.elements.reorder', operationId: `remote-design-order-${Date.now()}`, baseRevision: remoteDesignY.payload.revision, pageId: 'design-page', elementIds: ['shape-1', 'shape-2'],
  } })
  assert.equal(remoteDesignOrder.status, 200)
  await waitFor(() => evaluate("document.querySelector('.layers-list button')?.title === 'Retângulo A'"), 'ordem remota de camadas recebida por SSE')
  const editorContextResult = await sendBrowser('Target.createBrowserContext', { disposeOnDetach: true })
  collaboratorBrowserContextId = editorContextResult.result.browserContextId
  assert.ok(collaboratorBrowserContextId, 'a separate authenticated editor browser context was created')
  const editorTargetResult = await sendBrowser('Target.createTarget', { url: 'about:blank', browserContextId: collaboratorBrowserContextId })
  assert.ok(editorTargetResult.result?.targetId, `second editor tab created: ${JSON.stringify(editorTargetResult)}`)
  const editorAttachResult = await sendBrowser('Target.attachToTarget', { targetId: editorTargetResult.result.targetId, flatten: true })
  const editorSessionId = editorAttachResult.result?.sessionId
  assert.ok(editorSessionId, `DevTools attached to the second editor tab: ${JSON.stringify(editorAttachResult)}`)
  const sendEditor = (method, params = {}) => {
    const id = ++nextBrowserCommandId
    const response = new Promise(resolve => browserPendingCommands.set(id, resolve))
    browserSocket.send(JSON.stringify({ id, method, params, sessionId: editorSessionId }))
    return response
  }
  async function evaluateEditor(expression) {
    const response = await sendEditor('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  await sendEditor('Network.enable')
  const editorTabCookieResult = await sendEditor('Network.setCookie', { name: 'fuse_session', value: editorCookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })
  assert.equal(editorTabCookieResult.result.success, true, 'the second browser context receives only the editor account session')
  await sendEditor('Page.enable')
  await sendEditor('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}};const NativeFetch=window.fetch.bind(window);window.__operationRecords=[];window.fetch=(input,init)=>{const tracked=init?.method==='POST'&&String(input).endsWith('/operations');return NativeFetch(input,init).then(async response=>{if(tracked)window.__operationRecords.push({request:JSON.parse(init.body),response:await response.clone().json()});return response})}" })
  await sendEditor('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.library-mode-tabs'))"), 'editor account project library')
  const editorBrowserSession = await evaluateEditor("fetch('/api/auth/me').then(async response=>({status:response.status,body:await response.json()}))")
  assert.equal(editorBrowserSession.status, 200)
  assert.equal(editorBrowserSession.body.user.name, 'Docs collaborator', 'the second page runs under the invited editor identity')
  await evaluateEditor("Array.from(document.querySelectorAll('.library-mode-tabs button')).find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('[aria-label=\"Abrir Design colaborativo\"]'))"), 'shared design visible to editor account')
  await evaluateEditor("document.querySelector('[aria-label=\"Abrir Design colaborativo\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.canvas-workspace'))"), 'same shared design open in second browser editor')
  await waitFor(() => evaluate("window.__sseMessages.some(message=>message.type==='presence.updated'&&message.users?.some(user=>user.name==='Docs collaborator'))"), 'second collaborator presence received in editor')
  const editorPointer = await evaluateEditor("(()=>{const view=document.querySelector('.canvas-viewport');const width=794,height=1123;const scale=Math.max(.12,Math.min((view.clientWidth-48)/width,(view.clientHeight-48)/height,1));const offsetX=Math.round((view.clientWidth-width*scale)/2),offsetY=Math.round((view.clientHeight-height*scale)/2);const rect=view.getBoundingClientRect();const left=Math.max(rect.left+offsetX,0),right=Math.min(rect.left+offsetX+width*scale,innerWidth),top=Math.max(rect.top+offsetY,0),bottom=Math.min(rect.top+offsetY+height*scale,innerHeight);const x=left+(right-left)*.42,y=top+(bottom-top)*.37;return {x,y,normalizedX:(x-rect.left-offsetX)/(width*scale),normalizedY:(y-rect.top-offsetY)/(height*scale)}})()")
  assert.ok(editorPointer.x > 0 && editorPointer.x < 1280 && editorPointer.y > 0 && editorPointer.y < 900, `editor cursor point is visible in the second tab: ${JSON.stringify(editorPointer)}`)
  await sendEditor('Input.dispatchMouseEvent', { type: 'mouseMoved', x: editorPointer.x, y: editorPointer.y })
  const remoteCursor = await waitFor(async () => {
    const message = await evaluate("window.__sseMessages.findLast(message=>message.type==='cursor.updated'&&message.cursor?.pageId==='design-page')")
    return message?.cursor && message.cursor.x > 0 && message.cursor.y > 0 ? message : null
  }, 'second editor mouse cursor delivered to the first editor over SSE')
  assert.ok(Math.abs(remoteCursor.cursor.x - editorPointer.normalizedX) < 0.025 && Math.abs(remoteCursor.cursor.y - editorPointer.normalizedY) < 0.025, `the SSE cursor matches the second tab pointer: ${JSON.stringify({ pointer: editorPointer, cursor: remoteCursor.cursor })}`)
  let remoteCursorPixel
  try {
    remoteCursorPixel = await waitFor(async () => evaluate(`(()=>{const view=document.querySelector('.canvas-viewport');const stage=document.querySelector('.canvas-workspace .konvajs-content');const canvas=stage?.querySelector('canvas');const width=794,height=1123;const scale=Math.max(.12,Math.min((view.clientWidth-48)/width,(view.clientHeight-48)/height,1));const offsetX=Math.round((view.clientWidth-width*scale)/2),offsetY=Math.round((view.clientHeight-height*scale)/2);const ratio=canvas.width/view.clientWidth;const x=Math.round((offsetX+width*scale*${remoteCursor.cursor.x})*ratio),y=Math.round((offsetY+height*scale*${remoteCursor.cursor.y})*ratio);const palette=[[108,92,231],[223,115,95],[41,155,131],[68,120,189]];const ctx=canvas.getContext('2d'),left=Math.max(0,x-8),top=Math.max(0,y-8),right=Math.min(canvas.width,x+9),bottom=Math.min(canvas.height,y+9),image=ctx.getImageData(left,top,right-left,bottom-top),data=image.data;let matches=0;for(let offset=0;offset<data.length;offset+=4)if(data[offset+3]>220&&palette.some(([r,g,b])=>Math.abs(data[offset]-r)<32&&Math.abs(data[offset+1]-g)<32&&Math.abs(data[offset+2]-b)<32))matches++;const result={point:{x,y},ratio,canvas:{width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight},matches};window.__remoteCursorPixelProbe=result;return matches?result:null})()`))
  } catch (error) {
    console.error('Remote cursor pixel probe:', JSON.stringify(await evaluate('window.__remoteCursorPixelProbe ?? null')))
    throw error
  }
  assert.ok(remoteCursorPixel, 'the second editor paints the remote cursor marker into its canvas layer')
  await sendEditor('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await waitFor(() => evaluate("window.__sseMessages.some(message=>message.type==='cursor.updated'&&message.cursor===null)"), 'cursor leave from the second browser editor clears the first editor presence')

  const collaborativeWhiteboard = await apiRequest('/api/documents', { method: 'POST', cookie, body: {
    name: 'Quadro colaborativo', data: { type: 'whiteboard', width: 1600, height: 1000, pages: [{ id: 'board-page', name: 'Quadro 1', background: '#ffffff', groups: [{ id: 'board-group', name: 'Seleção remota', elementIds: ['board-shape-1', 'board-shape-2'] }], elements: [
      { id: 'board-shape-1', type: 'shape', shape: 'rect', name: 'Origem', x: 200, y: 250, width: 140, height: 100, rotation: 0, fill: '#8e7cf5', cornerRadius: 8 },
      { id: 'board-shape-2', type: 'shape', shape: 'ellipse', name: 'Destino', x: 600, y: 250, width: 140, height: 100, rotation: 0, fill: '#ff896f', cornerRadius: 0 },
      { id: 'audit-arrow-line', type: 'shape', shape: 'line', name: 'Linha de auditoria', x: 200, y: 500, width: 500, height: 8, rotation: 0, fill: '#303546', cornerRadius: 0, strokeWidth: 4, endArrow: true },
    ], connectors: [] }] },
  } })
  assert.equal(collaborativeWhiteboard.status, 201)
  assert.equal((await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'owner returns to project library for the whiteboard presence test')
  await evaluate("document.querySelector('.library-mode-tabs button:nth-child(2)')?.click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'owner selects cloud projects for the whiteboard presence test')
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]'))"), 'whiteboard appears in the owner cloud library')
  await evaluate("document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'owner opens the whiteboard presence test fixture')
  await evaluateEditor("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.library-mode-tabs'))"), 'editor returns to project library for the whiteboard presence test')
  await evaluateEditor("document.querySelector('.library-mode-tabs button:nth-child(2)')?.click()")
  await waitFor(() => evaluateEditor("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'editor selects cloud projects for the whiteboard presence test')
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]'))"), 'shared whiteboard appears in editor cloud library')
  await evaluateEditor("document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'authorized editor opens the whiteboard presence test fixture')
  await waitFor(() => evaluate("window.__sseMessages.some(message=>message.type==='presence.updated'&&message.users?.some(user=>user.name==='Docs collaborator'))"), 'cross-account editor presence reaches the whiteboard owner')
  const remoteGroupSelection = await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}/selection`, { method: 'POST', cookie: editorCookie, body: { selection: { pageId: 'board-page', elementId: 'board-shape-2', kind: 'element' } } })
  assert.equal(remoteGroupSelection.status, 200, 'the authorized editor publishes a remote selection on one group member')
  const initialRemoteSelectionEvent = await waitFor(() => evaluate("window.__sseMessages.findLast(message=>message.type==='selection.updated'&&message.userId&&message.name==='Docs collaborator'&&message.selection?.elementId==='board-shape-2')"), 'cross-account whiteboard selection reaches the owner over SSE')
  await waitFor(() => evaluate(`window.__sseMessages.findLastIndex(message=>message.type==='selection.updated'&&message.userId==='${initialRemoteSelectionEvent.userId}'&&message.selection?.elementId==='board-shape-2') < window.__sseMessages.findLastIndex(message=>message.type==='selection.updated'&&message.userId==='${initialRemoteSelectionEvent.userId}'&&message.selection===null)`), 'editor clears its previous local selection before the remote rendering check', 2500).catch(() => null)
  const stableRemoteSelection = await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}/selection`, { method: 'POST', cookie: editorCookie, body: { selection: { pageId: 'board-page', elementId: 'board-shape-2', kind: 'element' } } })
  assert.equal(stableRemoteSelection.status, 200, 'the authorized editor republishes a stable remote selection')
  await waitFor(() => evaluate("window.__sseMessages.findLast(message=>message.type==='selection.updated'&&message.userId&&message.name==='Docs collaborator')?.selection?.elementId==='board-shape-2'"), 'stable cross-account selection reaches the owner over SSE')
  const readRemoteGroupSelectionPixels = () => evaluate("(()=>{const canvases=[...document.querySelectorAll('.canvas-viewport canvas')];if(!canvases.length)return null;const width=canvases[0].width,height=canvases[0].height,composite=document.createElement('canvas');composite.width=width;composite.height=height;const context=composite.getContext('2d');for(const canvas of canvases)if(canvas.width===width&&canvas.height===height)context.drawImage(canvas,0,0);const data=context.getImageData(0,0,width,height).data;const boundsFor=predicate=>{let minX=width,minY=height,maxX=-1,maxY=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(predicate(data[i],data[i+1],data[i+2])){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}}return maxX<0?null:{minX,minY,maxX,maxY}};const boxes=[boundsFor((r,g,b)=>r>130&&r<165&&g>110&&g<140&&b>220),boundsFor((r,g,b)=>r>240&&g>110&&g<150&&b>80&&b<140)];const selectionCounts=boxes.map(box=>{if(!box)return 0;let count=0;for(let y=Math.max(0,box.minY-10);y<Math.min(height,box.maxY+11);y++)for(let x=Math.max(0,box.minX-10);x<Math.min(width,box.maxX+11);x++){const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];const nearFrame=Math.min(Math.abs(x-box.minX),Math.abs(x-box.maxX),Math.abs(y-box.minY),Math.abs(y-box.maxY))<=8;if(nearFrame&&r<130&&g<120&&b>205&&b-r>90)count++}return count});let purplePixels=0;for(let i=0;i<data.length;i+=4)if(data[i]<130&&data[i+1]<120&&data[i+2]>205&&data[i+2]-data[i]>90)purplePixels++;return {boxes,selectionCounts,canvasLayers:canvases.length,purplePixels,presence:[...document.querySelectorAll('.realtime-presence')].map(element=>element.getAttribute('title'))}})()")
  let lastGroupSelectionSample
  const groupSelectionPixels = await waitFor(async () => { const sample=await readRemoteGroupSelectionPixels(); lastGroupSelectionSample=sample; return sample?.selectionCounts?.every(count=>count>0)?sample:null }, 'remote group selection outlines both existing group members', 12000).catch(async error=>{const events=await evaluate("window.__sseMessages.filter(message=>message.type==='selection.updated'||message.type==='presence.updated').slice(-8)");throw new Error(`${error.message}; diagnostics: ${JSON.stringify({ sample:lastGroupSelectionSample, events })}`)})
  assert.equal(groupSelectionPixels.selectionCounts.length, 2, 'the remote group selection outlines each group member')
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Design colaborativo\"]'))"), 'owner returns to design after remote group selection')
  await evaluate("document.querySelector('[aria-label=\"Abrir Design colaborativo\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace'))"), 'owner resumes shared design tests')
  await evaluateEditor("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('[aria-label=\"Abrir Design colaborativo\"]'))"), 'editor returns to design after remote group selection')
  await evaluateEditor("document.querySelector('[aria-label=\"Abrir Design colaborativo\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.canvas-workspace'))"), 'editor resumes shared design tests')

  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Vídeo colaborativo\"]'))"), 'video project visible to owner')
  await evaluate("document.querySelector('[aria-label=\"Abrir Vídeo colaborativo\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.video-timeline'))"), 'owner opens the shared video timeline')
  await evaluateEditor("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('[aria-label=\"Abrir Vídeo colaborativo\"]'))"), 'video project visible to the authorized editor')
  await evaluateEditor("document.querySelector('[aria-label=\"Abrir Vídeo colaborativo\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.video-timeline'))"), 'authorized editor opens the shared video timeline')
  await waitFor(async () => await evaluate("document.querySelectorAll('.video-media-row').length===4") && await evaluateEditor("document.querySelectorAll('.video-media-row').length===4"), 'both users see the same audio and video timeline clips')
  const initialTrackPreview = await waitFor(() => evaluate("(()=>{const stack=[...document.querySelectorAll('.video-media-stack video')];return stack.length===2&&stack.every(video=>video.readyState>=1)?stack.map(video=>({name:video.getAttribute('aria-label'),z:Number(getComputedStyle(video).zIndex)})):null})()"), 'owner preview loads both overlapping video sources')
  assert.deepEqual(initialTrackPreview.map(track=>track.z), [1, 2], 'track order defines the visual stacking order in the editor preview')
  const ownerVideoTrackOperationStart = await evaluate('window.__operationRecords.length')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Faixa de Base vermelha.webm\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'4');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${ownerVideoTrackOperationStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-video-clip-one'&&item.request.patch?.trackIndex===3&&item.response?.revision)`), 'owner synchronizes a video clip stacking lane')
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Faixa de Base vermelha.webm\"]')?.value==='4'"), 'editor receives the video stacking lane over SSE')
  const reorderedPreview = await evaluate("(()=>[...document.querySelectorAll('.video-media-stack video')].map(video=>({name:video.getAttribute('aria-label'),z:Number(getComputedStyle(video).zIndex)})))()")
  assert.deepEqual(reorderedPreview.map(track=>track.z), [2, 4], 'preview updates the stacking order after the collaborative lane change')
  const ownerOpacityOperationStart = await evaluate('window.__operationRecords.length')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Opacidade base de Base vermelha.webm\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'67');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${ownerOpacityOperationStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-video-clip-one'&&item.request.patch?.opacity===67&&item.response?.revision)`), 'owner synchronizes visual opacity as a clip-level operation')
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Opacidade base de Base vermelha.webm\"]')?.value==='67'"), 'editor receives opacity over SSE')
  assert.equal(await evaluateEditor("Math.abs(Number([...document.querySelectorAll('.video-media-stack video')].find(video=>getComputedStyle(video).zIndex==='4')?.parentElement?.style.opacity)-0.67)<0.001"), true, 'remote opacity is applied to the editor preview')
  await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Enquadramento de Base vermelha.webm\"]');select.value='cover';select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Enquadramento de Base vermelha.webm\"]')?.value==='cover'"), 'editor receives independent video framing over SSE')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Escala de Base vermelha.webm\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'125');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Escala de Base vermelha.webm\"]')?.value==='125'"), 'editor receives per-track scale over SSE')
  const ownerTransformKeyframeStart = await evaluate('window.__operationRecords.length')
  await evaluate("(()=>{const playhead=document.querySelector('[aria-label=\"Posição da reprodução\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(playhead,'500');playhead.dispatchEvent(new Event('input',{bubbles:true}));playhead.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Posição da reprodução\"]')?.value==='500'&&[...document.querySelectorAll('.video-media-row.video')].find(row=>row.querySelector('.video-track-name')?.textContent.includes('Base vermelha.webm'))?.querySelector('.video-transform-keyframes button:not(:disabled)'))"), 'owner playhead reaches the transform keyframe position')
  await evaluate("[...document.querySelectorAll('.video-media-row.video')].find(row=>row.querySelector('.video-track-name')?.textContent.includes('Base vermelha.webm'))?.querySelector('.video-transform-keyframes button')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Escala animada de Base vermelha.webm\"]')&&!document.querySelector('[aria-label=\"Escala animada de Base vermelha.webm\"]')?.disabled)"), 'transform keyframe controls are enabled')
  const setCollaborativeRange = async (label, value) => evaluate(`(()=>{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await setCollaborativeRange('Escala animada de Base vermelha.webm', 200)
  await waitFor(() => evaluate(`window.__operationRecords.slice(${ownerTransformKeyframeStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-video-clip-one'&&item.request.patch?.transformKeyframes?.some(point=>point.timeMs===500&&point.scale===200)&&item.response?.revision)`), 'owner commits the transform scale keyframe')
  await setCollaborativeRange('Deslocamento X animado de Base vermelha.webm', 20)
  await waitFor(() => evaluate(`window.__operationRecords.slice(${ownerTransformKeyframeStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-video-clip-one'&&item.request.patch?.transformKeyframes?.some(point=>point.timeMs===500&&point.offsetX===20)&&item.response?.revision)`), 'owner commits the horizontal transform keyframe')
  await setCollaborativeRange('Deslocamento Y animado de Base vermelha.webm', -10)
  await waitFor(() => evaluate(`window.__operationRecords.slice(${ownerTransformKeyframeStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-video-clip-one'&&item.request.patch?.transformKeyframes?.some(point=>point.timeMs===500&&point.scale===200&&point.offsetX===20&&point.offsetY===-10)&&item.response?.revision)`), 'owner synchronizes scale and both framing offsets as a transform keyframe').catch(async error=>{const diagnostic=await evaluate(`({values:['Escala animada de Base vermelha.webm','Deslocamento X animado de Base vermelha.webm','Deslocamento Y animado de Base vermelha.webm'].map(label=>({label,value:document.querySelector('[aria-label='+JSON.stringify(label)+']')?.value,disabled:document.querySelector('[aria-label='+JSON.stringify(label)+']')?.disabled})),operations:window.__operationRecords.slice(${ownerTransformKeyframeStart}).filter(item=>item.request?.type==='design.video.clip.patch'),keyframes:[...document.querySelectorAll('.video-media-row.video')].find(row=>row.querySelector('.video-track-name')?.textContent.includes('Base vermelha.webm'))?.querySelector('.video-transform-keyframes small')?.textContent})`);throw new Error(`${error.message}; diagnostic: ${JSON.stringify(diagnostic)}`)})
  await evaluateEditor("(()=>{const playhead=document.querySelector('[aria-label=\"Posição da reprodução\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(playhead,'500');playhead.dispatchEvent(new Event('input',{bubbles:true}));playhead.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Escala animada de Base vermelha.webm\"]')?.value==='200'&&document.querySelector('[aria-label=\"Deslocamento X animado de Base vermelha.webm\"]')?.value==='20'&&document.querySelector('[aria-label=\"Deslocamento Y animado de Base vermelha.webm\"]')?.value==='-10'"), 'editor receives the complete framing keyframe over SSE')
  await evaluate("(()=>{const playhead=document.querySelector('[aria-label=\"Posição da reprodução\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(playhead,'250');playhead.dispatchEvent(new Event('input',{bubbles:true}));playhead.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await evaluateEditor("(()=>{const playhead=document.querySelector('[aria-label=\"Posição da reprodução\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(playhead,'250');playhead.dispatchEvent(new Event('input',{bubbles:true}));playhead.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Escala animada de Base vermelha.webm\"]')?.value==='163'&&document.querySelector('[aria-label=\"Deslocamento X animado de Base vermelha.webm\"]')?.value==='10'&&document.querySelector('[aria-label=\"Deslocamento Y animado de Base vermelha.webm\"]')?.value==='-5'"), 'collaborative preview interpolates framing between synced keyframes')
  const ownerVideoOperationStart = await evaluate('window.__operationRecords.length')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Volume de Trilha principal.wav\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'45');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate(`window.__operationRecords.slice(${ownerVideoOperationStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-audio-clip-one'&&item.response?.revision)`), 'owner sends a versioned clip-level volume edit')
  const ownerVolumeOperation = await evaluate(`window.__operationRecords.slice(${ownerVideoOperationStart}).find(item=>item.request?.type==='design.video.clip.patch')?.request`)
  assert.deepEqual(ownerVolumeOperation.patch, { volume: 0.45 })
  await waitFor(() => evaluateEditor("document.querySelector('[aria-label=\"Volume de Trilha principal.wav\"]')?.value==='45'"), 'authorized editor receives the remote volume change over SSE')
  const editorVideoOperationStart = await evaluateEditor('window.__operationRecords.length')
  await evaluateEditor("(()=>{const input=document.querySelector('[aria-label=\"Início da mídia de Efeitos.wav em segundos\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2.5');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor(`window.__operationRecords.slice(${editorVideoOperationStart}).some(item=>item.request?.type==='design.video.clip.patch'&&item.request.clipId==='shared-audio-clip-two'&&item.response?.revision)`), 'editor sends an independent source trim for the second clip')
  const editorClipOperation = await evaluateEditor(`window.__operationRecords.slice(${editorVideoOperationStart}).find(item=>item.request?.type==='design.video.clip.patch')?.request`)
  assert.deepEqual(editorClipOperation.patch, { sourceStartMs: 2500 })
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Início da mídia de Efeitos.wav em segundos\"]')?.value==='2.5'"), 'owner receives the editor timeline change over SSE')
  await evaluateEditor("(()=>{const playhead=document.querySelector('[aria-label=\"Posição da reprodução\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(playhead,'2500');playhead.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));playhead.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor("document.querySelectorAll('audio').length===2&&[...document.querySelectorAll('audio')].every(audio=>audio.readyState>=1)"), 'audio sources load for timeline playback')
  await evaluateEditor("document.querySelector('[aria-label=\"Reproduzir prévia\"]')?.click()")
  const trimmedAudioPlayback = await waitFor(() => evaluateEditor("(()=>{const audio=document.querySelectorAll('audio')[1];return audio&&audio.currentTime>=3.25&&audio.currentTime<=3.85?{time:audio.currentTime,volume:audio.volume}:null})()"), 'trimmed audio clip seeks to its source offset during preview')
  assert.ok(Math.abs(trimmedAudioPlayback.time - 3.5) < 0.35, `trimmed source position follows the timeline playhead: ${JSON.stringify(trimmedAudioPlayback)}`)
  assert.equal(trimmedAudioPlayback.volume, 1, 'timeline preview applies the clip gain')
  await evaluateEditor("(()=>{const playhead=document.querySelector('[aria-label=\"Posição da reprodução\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(playhead,'5500');playhead.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));playhead.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluateEditor("document.querySelectorAll('audio')[1]?.paused===true"), 'audio preview stops at the clip end')
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('[aria-label=\"Pausar prévia\"]'))"), 'timeline audio preview starts')
  await evaluateEditor("document.querySelector('[aria-label=\"Pausar prévia\"]')?.click()")
  const synchronizedVideo = await apiRequest(`/api/documents/${collaborativeVideo.payload.id}`, { cookie })
  assert.deepEqual(synchronizedVideo.payload.data.pages[0].timelineClips.map(clip=>({id:clip.id,startMs:clip.startMs,sourceStartMs:clip.sourceStartMs,durationMs:clip.durationMs,volume:clip.volume,trackIndex:clip.trackIndex ?? 0,opacity:clip.opacity ?? 100,fitMode:clip.fitMode ?? 'contain',scale:clip.scale ?? 100,offsetX:clip.offsetX ?? 0,offsetY:clip.offsetY ?? 0})), [
    { id: videoClipOne.id, startMs: 0, sourceStartMs: 0, durationMs: 5000, volume: 0.45, trackIndex: 0, opacity: 100, fitMode: 'contain', scale: 100, offsetX: 0, offsetY: 0 },
    { id: videoClipTwo.id, startMs: 1500, sourceStartMs: 2500, durationMs: 4000, volume: 1, trackIndex: 0, opacity: 100, fitMode: 'contain', scale: 100, offsetX: 0, offsetY: 0 },
    { id: videoTrackOne.id, startMs: 0, sourceStartMs: 0, durationMs: 1200, volume: 0, trackIndex: 3, opacity: 67, fitMode: 'cover', scale: 125, offsetX: 0, offsetY: 0 },
    { id: videoTrackTwo.id, startMs: 0, sourceStartMs: 0, durationMs: 1200, volume: 0, trackIndex: 1, opacity: 100, fitMode: 'contain', scale: 100, offsetX: 0, offsetY: 0 },
  ], 'separate clip edits persist without replacing the other collaborator’s timeline fields or lanes')
  await evaluateEditor("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('[aria-label=\"Abrir Design colaborativo\"]'))"), 'editor returns to the shared design after the video check')
  await evaluateEditor("document.querySelector('[aria-label=\"Abrir Design colaborativo\"]').click()")
  await waitFor(() => evaluateEditor("Boolean(document.querySelector('.canvas-workspace'))"), 'editor reopens shared design after timeline synchronization')
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Design colaborativo\"]'))"), 'owner returns to the shared design after the video check')
  await evaluate("document.querySelector('[aria-label=\"Abrir Design colaborativo\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace'))"), 'owner reopens shared design after timeline synchronization')

  const sameProfileTargetResult = await sendBrowser('Target.createTarget', { url: 'about:blank' })
  assert.ok(sameProfileTargetResult.result?.targetId, `second tab opened in the default browser profile: ${JSON.stringify(sameProfileTargetResult)}`)
  const sameProfileAttachResult = await sendBrowser('Target.attachToTarget', { targetId: sameProfileTargetResult.result.targetId, flatten: true })
  const sameProfileSessionId = sameProfileAttachResult.result?.sessionId
  assert.ok(sameProfileSessionId, `DevTools attached to the same-profile tab: ${JSON.stringify(sameProfileAttachResult)}`)
  const sendSameProfile = (method, params = {}) => {
    const id = ++nextBrowserCommandId
    const response = new Promise(resolve => browserPendingCommands.set(id, resolve))
    browserSocket.send(JSON.stringify({ id, method, params, sessionId: sameProfileSessionId }))
    return response
  }
  async function evaluateSameProfile(expression) {
    const response = await sendSameProfile('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  await sendSameProfile('Page.enable')
  await sendSameProfile('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}}" })
  await sendSameProfile('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.library-mode-tabs'))"), 'same-profile second tab project library')
  const sameProfileAuth = await evaluateSameProfile("fetch('/api/auth/me').then(async response=>({status:response.status,body:await response.json()}))")
  assert.equal(sameProfileAuth.status, 200)
  assert.equal(sameProfileAuth.body.user.id, browserSession.body.user.id, 'both tabs share the exact same signed-in owner identity')
  await evaluateSameProfile("Array.from(document.querySelectorAll('.library-mode-tabs button')).find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('[aria-label=\"Abrir Design colaborativo\"]'))"), 'same-profile tab sees the cloud design')
  await evaluateSameProfile("document.querySelector('[aria-label=\"Abrir Design colaborativo\"]').click()")
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.canvas-workspace'))"), 'same design open in second tab of the same profile')
  await waitFor(() => evaluate(`document.querySelector('.realtime-presence')?.title.includes(${JSON.stringify(`${browserSession.body.user.name} (2 abas)`)})`), 'presence confirms two live tabs for the same profile')
  await evaluate("[...document.querySelectorAll('.layers-list button')].find(button=>button.title==='Elipse B')?.click()")
  await waitFor(() => evaluate("document.querySelector('.position-grid input')?.value==='280'"), 'source tab selects the shape to edit')
  await evaluateSameProfile("[...document.querySelectorAll('.layers-list button')].find(button=>button.title==='Elipse B')?.click()")
  await waitFor(() => evaluateSameProfile("document.querySelector('.position-grid input')?.value==='280'"), 'same-profile tab selects the same shape')
  const sameProfileOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.position-grid input').focus()")
  await pressKey('a', 'KeyA', 65, 2)
  await send('Input.insertText', { text: '333' })
  await waitFor(() => operationRequests.length > sameProfileOperationsAt && operationRequests.at(-1)?.status === 200, 'first tab commits a collaborative canvas operation')
  await evaluateSameProfile("[...document.querySelectorAll('.layers-list button')].find(button=>button.title==='Elipse B')?.click()")
  const sameProfilePosition = await waitFor(() => evaluateSameProfile("document.querySelector('.position-grid input')?.value==='333'"), 'same-profile second tab exposes the updated shape position in the editor controls', 30000)
  assert.equal(sameProfilePosition, true, 'the second tab reflects x=333 after receiving the document update')
  assert.equal((await apiRequest(`/api/documents/${collaborativeDesign.payload.id}`, { cookie })).payload.data.pages[0].elements.find(element => element.id === 'shape-2').x, 333, 'the shared document and both tabs converge on the same position')
  await send('Page.bringToFront')

  const cursorRequestsBeforeTouch = cursorRequests.length
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const touchPoint = await evaluate("(()=>{const rect=document.querySelector('.canvas-viewport')?.getBoundingClientRect();if(!rect)return null;const left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);return right>left&&bottom>top?{x:left+(right-left)/2,y:top+(bottom-top)/2}:null})()")
  assert.ok(touchPoint, 'mobile design canvas exposes a touch surface')
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y, id: 1 }] })
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x + 12, y: touchPoint.y + 8, id: 1 }] })
  try {
    await waitFor(() => cursorRequests.length > cursorRequestsBeforeTouch && cursorRequests.at(-1)?.status === 200, 'touch cursor operation accepted by collaboration API')
  } catch (error) {
    console.error(JSON.stringify({ touchPoint, cursorRequests: cursorRequests.slice(cursorRequestsBeforeTouch), cursorBodies: await evaluate('window.__cursorBodies.slice(-5)') }))
    throw error
  }
  const touchCursor = await evaluate("window.__cursorBodies.at(-1)?.cursor")
  assert.ok(touchCursor?.pageId === 'design-page' && touchCursor.x > 0 && touchCursor.x < 1 && touchCursor.y > 0 && touchCursor.y < 1, `touch pointer is normalized to the design page: ${JSON.stringify(touchCursor)}`)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await waitFor(() => cursorRequests.length > cursorRequestsBeforeTouch + 1 && cursorRequests.at(-1)?.status === 200, 'touch cursor cleared on end')
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => evaluateEditor('innerWidth===1280'), 'editor desktop viewport dimensions applied')
  await waitFor(() => evaluate("innerWidth===1280"), 'desktop viewport dimensions applied')
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.equal(documentRequests.filter(request => request.documentId === collaborativeDesign.payload.id && request.method === 'PUT').length, designPutsBefore, 'operações de propriedades de elementos não devem gerar snapshots redundantes')
  assert.equal(afterDesignX.data.pages[0].elements[0].x, 120)
  designOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.add-page')?.click()")
  await waitFor(() => operationRequests.length > designOperationsAt && operationRequests.at(-1)?.status === 200, 'nova página enviada pela interface colaborativa')
  const afterPageAdd = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}`, { cookie })
    return response.payload.data.pages.length === 2 ? response.payload : null
  }, 'persistência atômica da nova página')
  const remotePageInsert = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'design.page.insert', operationId: `remote-page-insert-${Date.now()}`, baseRevision: afterPageAdd.revision, pageId: 'design-page', afterPageId: 'design-page',
    page: { id: 'remote-page', name: 'Página remota', background: '#ffffff', elements: [] },
  } })
  assert.equal(remotePageInsert.status, 200)
  await waitFor(() => evaluate("document.querySelector('.page-footer')?.textContent.includes('de 3')"), 'página remota recebida por SSE')
  const remotePageDelete = await apiRequest(`/api/documents/${collaborativeDesign.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'design.page.delete', operationId: `remote-page-delete-${Date.now()}`, baseRevision: remotePageInsert.payload.revision, pageId: 'design-page', targetPageId: 'remote-page',
  } })
  assert.equal(remotePageDelete.status, 200)
  await waitFor(() => evaluate("document.querySelector('.page-footer')?.textContent.includes('de 2')"), 'exclusão de página remota recebida por SSE')
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(documentRequests.filter(request => request.documentId === collaborativeDesign.payload.id && request.method === 'PUT').length, designPutsBefore, 'operações estruturais de páginas não devem gerar snapshots redundantes')

  const collaborativePresentation = await apiRequest('/api/documents', { method: 'POST', cookie, body: {
    name: 'Apresentação colaborativa', data: { type: 'presentation', width: 1920, height: 1080, pages: [{ id: 'slide-1', name: 'Slide 1', background: '#ffffff', elements: [], presenterNotes: 'Kickoff for collaborators.' }] },
  } })
  assert.equal(collaborativePresentation.status, 201)
  assert.equal((await apiRequest(`/api/documents/${collaborativePresentation.payload.id}/permissions`, { method: 'POST', cookie, body: { email: editorEmail, role: 'editor' } })).status, 201)
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate('Boolean(document.querySelector(\'[aria-label="Abrir Apresentação colaborativa"]\'))'), 'apresentação colaborativa na biblioteca')
  await evaluate("document.querySelector('[aria-label=\"Abrir Apresentação colaborativa\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace'))"), 'editor da apresentação colaborativa')
  let pageOperationsAt = operationRequests.length
  await evaluate("(()=>{const field=document.querySelector('.slide-name-field');field.focus();field.select()})()")
  await send('Input.insertText', { text: 'Opening' })
  await waitFor(() => operationRequests.length > pageOperationsAt && operationRequests.at(-1)?.status === 200, 'renomeação de slide enviada pelo editor')
  const renamedSlide = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativePresentation.payload.id}`, { cookie })
    return response.payload.data.pages[0].name === 'Opening' ? response.payload : null
  }, 'persistência do nome do slide')
  pageOperationsAt = operationRequests.length
  await evaluate("(()=>{const field=document.querySelector('.page-background-control input');if(!field)throw new Error('page background control not found');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,'#223344');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => operationRequests.length > pageOperationsAt && operationRequests.at(-1)?.status === 200, 'cor de fundo enviada pelo editor')
  const recoloredSlide = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativePresentation.payload.id}`, { cookie })
    return response.payload.data.pages[0].background === '#223344' ? response.payload : null
  }, 'persistência da cor de fundo do slide')
  await evaluate("document.querySelector('.present-notes-button')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.presenter-notes-dialog textarea'))"), 'editor das notas do apresentador')
  const notesPutsBefore = documentRequests.filter(request => request.method === 'PUT').length
  let notesOperationsAt = operationRequests.length
  await evaluate("(()=>{const field=document.querySelector('.presenter-notes-dialog textarea');field.focus();field.setSelectionRange(field.value.length,field.value.length)})()")
  await send('Input.insertText', { text: ' End with next steps.' })
  await waitFor(() => operationRequests.length > notesOperationsAt && operationRequests.at(-1)?.status === 200, 'operação de notas enviada pelo editor')
  const afterNotesEdit = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativePresentation.payload.id}`, { cookie })
    return response.payload.data.pages[0].presenterNotes === 'Kickoff for collaborators. End with next steps.' ? response.payload : null
  }, 'persistência atômica das notas do apresentador')
  const remoteNotesEdit = await apiRequest(`/api/documents/${collaborativePresentation.payload.id}/operations`, { method: 'POST', cookie: editorCookie, body: {
    type: 'design.page.notes.set', operationId: `remote-presenter-notes-${Date.now()}`, baseRevision: 1, pageId: 'slide-1', notes: 'Welcome team: Kickoff for collaborators.',
  } })
  assert.equal(remoteNotesEdit.status, 200)
  await waitFor(() => evaluate("document.querySelector('.presenter-notes-dialog textarea')?.value === 'Welcome team: Kickoff for collaborators. End with next steps.'"), 'notas remotas combinadas e recebidas por SSE')
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(documentRequests.filter(request => request.method === 'PUT').length, notesPutsBefore, 'edição colaborativa de notas não deve gerar snapshot redundante')
  assert.equal(afterNotesEdit.data.pages[0].presenterNotes, 'Kickoff for collaborators. End with next steps.')
  assert.equal(renamedSlide.data.pages[0].name, 'Opening')
  assert.equal(recoloredSlide.data.pages[0].background, '#223344')
  await evaluate("document.querySelector('.presenter-notes-dialog [aria-label=\"Fechar notas\"]')?.click()")
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate('Boolean(document.querySelector(\'[aria-label="Abrir Quadro colaborativo"]\'))'), 'quadro colaborativo na biblioteca')
  await evaluate("document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'editor do quadro colaborativo')
  assert.equal(await evaluate("[...document.querySelectorAll('.mobile-tools button > svg')].every(icon=>icon.classList.contains('lucide')) && [...document.querySelectorAll('.tools-panel .tool-button')].every(button=>button.querySelector('.tool-icon > svg.lucide')) && [...document.querySelectorAll('.shape-tools button > svg')].every(icon=>icon.classList.contains('lucide'))"), true, 'desktop and mobile whiteboard tools use the shared Lucide icon family')
  await sendSameProfile('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.library-mode-tabs'))"), 'same-profile second tab returns to the project library')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.home-account'))"), 'same-profile account session is ready in the project library')
  await evaluateSameProfile("document.querySelector('.library-mode-tabs button:nth-child(2)')?.click()")
  await waitFor(() => evaluateSameProfile("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'same-profile tab selects cloud projects')
  try {
    await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]'))"), 'same-profile tab sees the whiteboard', 8000)
  } catch (error) {
    console.error(JSON.stringify(await evaluateSameProfile("(async()=>{const response=await fetch('/api/documents');const body=await response.json();return {user:(await fetch('/api/auth/me').then(r=>r.json())).user,chosen:document.querySelector('.library-mode-tabs button.chosen')?.textContent,buttons:[...document.querySelectorAll('.library-mode-tabs button')].map(button=>button.textContent.trim()),cards:[...document.querySelectorAll('[aria-label^=\"Abrir \"]')].map(button=>button.getAttribute('aria-label')),heading:document.querySelector('h1')?.textContent,body:document.querySelector('main')?.innerText?.slice(0,500),api:body.documents?.map(document=>({id:document.id,name:document.name,type:document.data?.type}))}})()")))
    throw error
  }
  await evaluateSameProfile("document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]').click()")
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'same whiteboard open in the second tab')
  await waitFor(() => evaluate("document.querySelector('.realtime-presence')?.title.includes('Reconnect owner (2 abas)')"), 'same-profile whiteboard presence has two connected tabs')
  await evaluate("document.querySelector('button[title=\"Conectar dois elementos\"]')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.tool-button[title=\"Conectar dois elementos\"].active'))"), 'ferramenta de conectores')
  const connectorPutsBefore = documentRequests.filter(request => request.documentId === collaborativeWhiteboard.payload.id && request.method === 'PUT').length
  const connectorOperationsAt = operationRequests.length
  await evaluate("document.querySelector('.layers-list button[title=\"Origem\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('.connector-hint')?.textContent.includes('terminar')"), 'primeira âncora do conector')
  await evaluate("document.querySelector('.layers-list button[title=\"Destino\"]')?.click()")
  await waitFor(() => operationRequests.length > connectorOperationsAt && operationRequests.at(-1)?.status === 200, 'operação de conector enviada pelo quadro branco')
  const connectedWhiteboard = await waitFor(async () => {
    const response = await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}`, { cookie })
    return response.payload.data.pages[0].connectors?.length === 1 ? response.payload : null
  }, 'persistência atômica do conector e suas âncoras')
  assert.equal(connectedWhiteboard.data.pages[0].connectors[0].fromId, 'board-shape-1')
  assert.equal(connectedWhiteboard.data.pages[0].connectors[0].toId, 'board-shape-2')
  const remoteConnectorEvent = await waitFor(() => evaluateSameProfile("window.__sseMessages?.findLast(message=>message.type==='document.operation.updated'&&message.operation==='design.connector.create')"), 'same-profile tab receives the whiteboard connector operation over SSE')
  assert.equal(remoteConnectorEvent.operation, 'design.connector.create')
  await waitFor(() => evaluateSameProfile("document.querySelector('.canvas-workspace')?.dataset.connectorCount==='1'"), 'same-profile whiteboard editor applies the connector operation to its document state')
  await sendSameProfile('Page.bringToFront')
  await evaluateSameProfile('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const readWhiteboardConnectorPixels = () => evaluateSameProfile("(()=>{const canvas=document.querySelector('.canvas-viewport canvas'),context=canvas.getContext('2d'),pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let matches=0,purple=0,orange=0,nonwhite=0,minX=canvas.width,minY=canvas.height,maxX=0,maxY=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const index=(y*canvas.width+x)*4,r=pixels[index],g=pixels[index+1],b=pixels[index+2];if(r<250||g<250||b<250)nonwhite++;if(r<140&&g<125&&b>210&&b-r>35){matches++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}if(r>125&&r<160&&g>105&&g<145&&b>225)purple++;if(r>235&&g>105&&g<165&&b>75&&b<145)orange++}return {matches,purple,orange,nonwhite,bounds:matches?{minX,minY,maxX,maxY}:null,canvas:{width:canvas.width,height:canvas.height}}})()")
  const renderedWhiteboardConnector = await waitFor(async () => {
    const sample = await readWhiteboardConnectorPixels()
    return sample.matches > 0 ? sample : null
  }, 'same-profile whiteboard canvas renders the remote connector', 12000).catch(async error => { console.error(JSON.stringify({ sample: await readWhiteboardConnectorPixels(), ownerCanvas: await evaluate("(()=>{const canvas=document.querySelector('.canvas-viewport canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let matches=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<140&&pixels[i+1]<125&&pixels[i+2]>210&&pixels[i+2]-pixels[i]>35)matches++;return {connectors:document.querySelector('.canvas-workspace')?.dataset.connectorCount,matches}})()"), connector: connectedWhiteboard.data.pages[0].connectors[0], sameProfileMessages: await evaluateSameProfile('window.__sseMessages?.slice(-8)') })); throw error })
  assert.ok(renderedWhiteboardConnector.matches > 0, `remote connector pixels visible in second tab: ${JSON.stringify(renderedWhiteboardConnector)}`)
  await sendSameProfile('Page.reload')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.library-mode-tabs'))"), 'same-profile tab reload returns to the library')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.home-account'))"), 'same-profile session restores after reload')
  await evaluateSameProfile("document.querySelector('.library-mode-tabs button:nth-child(2)')?.click()")
  await waitFor(() => evaluateSameProfile("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'reloaded same-profile tab selects cloud projects')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]'))"), 'persisted whiteboard is listed after reload')
  await evaluateSameProfile("document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]').click()")
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'persisted whiteboard reopens in the same-profile tab')
  await sendSameProfile('Page.bringToFront')
  await evaluateSameProfile('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await waitFor(() => evaluateSameProfile("document.querySelector('.realtime-presence')?.getAttribute('aria-label')?.includes('conectados')"), 'same-profile tab reconnects to whiteboard presence after reload')
  const reloadedWhiteboardConnector = await waitFor(async () => {
    const sample = await readWhiteboardConnectorPixels()
    return sample.matches > 0 ? sample : null
  }, 'persisted whiteboard connector is rendered after same-profile tab reload', 12000)
  assert.ok(reloadedWhiteboardConnector.matches > 0, 'the reconnected same-profile tab renders the persisted whiteboard connector')

  await evaluate("document.querySelector('.layers-list button[title=\"Linha de auditoria\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-start-marker')?.value==='none'&&document.querySelector('#line-end-marker')?.value==='arrow'"), 'audit arrow line starts with its final marker')
  await evaluateSameProfile("document.querySelector('.layers-list button[title=\"Linha de auditoria\"]')?.click()")
  await waitFor(() => evaluateSameProfile("document.querySelector('#line-start-marker')?.value==='none'&&document.querySelector('#line-end-marker')?.value==='arrow'"), 'second same-profile tab opens the same final-marker line state')
  const pressSameProfileKey = async (key, code, virtualKey) => {
    await sendSameProfile('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey })
    await sendSameProfile('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey })
  }
  const setLineMarkers = async (start, end) => {
    for (const [selector, desired] of [['#line-start-marker', start], ['#line-end-marker', end]]) {
      const current = await evaluateSameProfile(`document.querySelector('${selector}')?.value`)
      if (current === desired) continue
      await evaluateSameProfile(`document.querySelector('${selector}')?.focus()`)
      const key = desired === 'arrow' ? 'ArrowDown' : 'Home'
      await pressSameProfileKey(key, key, key === 'Home' ? 36 : 40)
      await pressSameProfileKey('Enter', 'Enter', 13)
    }
  }
  const setLineCurve = async mode => {
    const field = await evaluateSameProfile("document.querySelector('#line-curve-mode')?.value")
    const desired = mode === 'curve' ? 'curve' : 'straight'
    if (field === desired) return
    await evaluateSameProfile("document.querySelector('#line-curve-mode')?.focus()")
    const key = desired === 'curve' ? 'ArrowDown' : 'Home'
    await pressSameProfileKey(key, key, key === 'Home' ? 36 : 40)
    await pressSameProfileKey('Enter', 'Enter', 13)
  }
  const markerSwapOperationsAt = operationRequests.length
  await setLineMarkers('arrow', 'none')
  await waitFor(() => operationRequests.length > markerSwapOperationsAt && operationRequests.at(-1)?.status === 200, 'second tab swaps the line arrow from final endpoint to initial endpoint').catch(async error => {
    console.error(JSON.stringify({ markerFields: await evaluateSameProfile("({start:document.querySelector('#line-start-marker')?.value,end:document.querySelector('#line-end-marker')?.value,disabled:document.querySelector('#line-start-marker')?.disabled,active:document.activeElement?.id,selected:document.querySelector('.layers-list button[title=\\\"Linha de auditoria\\\"]')?.getAttribute('aria-pressed')})"), recentOperations: operationRequests.slice(markerSwapOperationsAt), remoteLine: (await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}`, { cookie })).payload.data.pages[0].elements.find(element => element.id === 'audit-arrow-line') }))
    throw error
  })
  await evaluate("document.querySelector('.layers-list button[title=\"Linha de auditoria\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-start-marker')?.value==='arrow'&&document.querySelector('#line-end-marker')?.value==='none'"), 'first tab passively displays the initial-endpoint marker')
  const swappedArrowLine = (await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}`, { cookie })).payload.data.pages[0].elements.find(element => element.id === 'audit-arrow-line')
  assert.equal(swappedArrowLine.startArrow, true)
  assert.equal(swappedArrowLine.endArrow, false)
  const markerRestoreOperationsAt = operationRequests.length
  await setLineMarkers('none', 'arrow')
  await waitFor(() => operationRequests.length > markerRestoreOperationsAt && operationRequests.at(-1)?.status === 200, 'second tab restores the line arrow to the final endpoint')
  await evaluate("document.querySelector('.layers-list button[title=\"Linha de auditoria\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-start-marker')?.value==='none'&&document.querySelector('#line-end-marker')?.value==='arrow'"), 'first tab passively displays the restored final-endpoint marker')
  const restoredArrowLine = (await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}`, { cookie })).payload.data.pages[0].elements.find(element => element.id === 'audit-arrow-line')
  assert.equal(restoredArrowLine.startArrow, false)
  assert.equal(restoredArrowLine.endArrow, true)
  const curveOperationsAt = operationRequests.length
  await setLineCurve('curve')
  await waitFor(() => operationRequests.length > curveOperationsAt && operationRequests.at(-1)?.status === 200, 'second tab applies the audited curved-line setting')
  await evaluate("document.querySelector('.layers-list button[title=\"Linha de auditoria\"]')?.click()")
  await waitFor(() => evaluate("document.querySelector('#line-curve-mode')?.value==='curve'"), 'first tab passively displays the curved-line setting')
  const curvedArrowLine = (await apiRequest(`/api/documents/${collaborativeWhiteboard.payload.id}`, { cookie })).payload.data.pages[0].elements.find(element => element.id === 'audit-arrow-line')
  assert.equal(curvedArrowLine.curveOffset, -96)
  assert.equal(curvedArrowLine.endArrow, true)
  await sendSameProfile('Page.reload')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.library-mode-tabs'))"), 'restored-marker tab reload returns to the library')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.home-account'))"), 'same-profile session remains authenticated after marker reload')
  await evaluateSameProfile("document.querySelector('.library-mode-tabs button:nth-child(2)')?.click()")
  await waitFor(() => evaluateSameProfile("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'restored-marker tab selects cloud projects')
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]'))"), 'restored-marker whiteboard is listed after reload')
  await evaluateSameProfile("document.querySelector('[aria-label=\"Abrir Quadro colaborativo\"]').click()")
  await waitFor(() => evaluateSameProfile("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'restored-marker whiteboard reopens after reload')
  await sendSameProfile('Page.bringToFront')
  await evaluateSameProfile("document.querySelector('.layers-list button[title=\"Linha de auditoria\"]')?.click()")
  await waitFor(() => evaluateSameProfile("document.querySelector('#line-start-marker')?.value==='none'&&document.querySelector('#line-end-marker')?.value==='arrow'&&document.querySelector('#line-curve-mode')?.value==='curve'"), 'reloaded second tab retains the final-endpoint marker and curved-line setting')
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(documentRequests.filter(request => request.documentId === collaborativeWhiteboard.payload.id && request.method === 'PUT').length, connectorPutsBefore, 'criação de conector não deve gerar snapshot redundante')
  await send('Page.bringToFront')
  await evaluate("document.querySelector('[aria-label=\"Salvar e voltar aos projetos\"]')?.click()")
  await send('Network.deleteCookies', { name: 'fuse_session', url: `${webOrigin}/` })
  const editorSessionCookie = editorCookie.slice('fuse_session='.length)
  const editorCookieResult = await send('Network.setCookie', { name: 'fuse_session', value: editorSessionCookie, url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })
  assert.equal(editorCookieResult.result.success, true)
  await send('Page.reload')
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'biblioteca na sessão do editor')
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-account'))"), 'sessão do editor carregada na biblioteca')
  await evaluate("(()=>{const cloud=document.querySelector('.library-mode-tabs button:nth-child(2)');if(!cloud)throw new Error('cloud project-library tab not found');cloud.click()})()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'biblioteca na nuvem selecionada para o editor')
  try {
    await waitFor(() => evaluate("[...document.querySelectorAll('.project-open')].some(button=>button.querySelector('.project-card-copy strong')?.textContent==='Biblioteca de mídia compartilhada')"), 'biblioteca de mídia na nuvem para o outro colaborador')
  } catch (error) {
    const diagnostics = await evaluate("(async()=>{const response=await fetch('/api/documents');return {user:document.querySelector('.home-account')?.textContent,mode:document.querySelector('.library-mode-tabs button.chosen')?.textContent,projects:[...document.querySelectorAll('.project-open .project-card-copy strong')].map(node=>node.textContent),empty:document.querySelector('.home-empty')?.innerText,error:document.querySelector('.home-error')?.innerText,api:{status:response.status,body:await response.json()}}})()")
    console.error(JSON.stringify(diagnostics))
    throw error
  }
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.querySelector('.project-card-copy strong')?.textContent==='Biblioteca de mídia compartilhada')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace'))"), 'design de mídia compartilhada')
  await evaluate("document.querySelector('[aria-label=\"Histórico de versões\"]')?.click()")
  await waitFor(() => evaluate("document.querySelectorAll('.history-version').length===2"), 'histórico de versões do projeto compartilhado')
  await evaluate("document.querySelector('.history-version:nth-child(2) .history-version-actions button:last-child')?.click()")
  await waitFor(() => evaluate("!document.querySelector('.history-dialog')"), 'restauração de versão pelo editor')
  const restoredSharedMediaDoc = await apiRequest(`/api/documents/${sharedMediaDoc.payload.id}`, { cookie: editorCookie })
  assert.equal(restoredSharedMediaDoc.payload.revision, 3)
  assert.equal(restoredSharedMediaDoc.payload.data.pages[0].elements[0].assetId, 'shared-media-asset')
  await evaluate("document.querySelector('[aria-label=\"Histórico de versões\"]')?.click()")
  await waitFor(() => evaluate("document.querySelectorAll('.history-version').length===3"), 'histórico atualizado após restauração')
  await evaluate("document.querySelector('.history-version:nth-child(3) .history-version-actions button:first-child')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.history-open-copy'))"), 'cópia histórica criada')
  await evaluate("document.querySelector('.history-open-copy')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.canvas-workspace'))"), 'editor da cópia histórica')
  const copiedProject = (await apiRequest('/api/documents', { cookie: editorCookie })).payload.documents.find(document => document.id !== sharedMediaDoc.payload.id && document.name === 'Cópia de Biblioteca de mídia compartilhada')
  assert.ok(copiedProject, 'historical copy gets an independent project identity')
  assert.equal(copiedProject.data.pages[0].elements[0].assetId, 'shared-media-asset')
  const copiedMedia = await apiRequest(`/api/documents/${copiedProject.id}/media`, { cookie: editorCookie })
  assert.ok(copiedMedia.payload.assets.some(asset => asset.id === 'shared-media-asset'), 'historical copy keeps referenced shared media available')
  await evaluate("[...document.querySelectorAll('.tool-button')].find(button=>button.textContent.includes('Uploads'))?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.asset-dialog'))"), 'biblioteca de uploads na nuvem')
  await waitFor(() => evaluate("[...document.querySelectorAll('.asset-use')].some(button=>button.getAttribute('aria-label')==='Adicionar Shared portrait ao design')"), 'asset remoto visível no editor')
  assert.equal(await evaluate("document.querySelector('.asset-dialog-footer').textContent.includes('Biblioteca compartilhada com colaboradores autorizados')"), true, 'the cloud media panel identifies its shared scope')
  const finalPublicLink = await apiRequest(`/api/documents/${publicVideo.payload.id}/access`, { method: 'PATCH', cookie, body: { publicLink: 'enable' } })
  assert.equal(finalPublicLink.status, 200)
  const publicVideoPayload = await apiRequest(`/api/public-shares/${finalPublicLink.payload.token}`)
  assert.deepEqual(Object.keys(publicVideoPayload.payload.timelineMedia).sort(), ['public-video-asset', 'public-video-asset-2', 'public-video-overlay-asset'])
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${webOrigin}/?view=${finalPublicLink.payload.token}` })
  await waitFor(() => evaluate("Boolean(document.querySelector('.public-share-video-overlay'))"), 'visualizador anonimo do link publico')
  await waitFor(() => evaluate("document.querySelector('.public-share-video-overlay')?.complete&&document.querySelector('.public-share-video-overlay')?.naturalWidth>0"), 'renderizacao da cena compartilhada')
  await waitFor(() => evaluate("document.querySelectorAll('.public-share-video-media').length===2&&[...document.querySelectorAll('.public-share-video-media')].every(video=>video.readyState>=1)"), 'both overlapping video sources become ready in the public preview')
  const publicTrackStack = await evaluate("(()=>{const stage=document.querySelector('.public-share-video-stage');const rect=stage.getBoundingClientRect();const top=document.elementFromPoint(rect.left+rect.width*.92,rect.top+rect.height*.88);return {tracks:[...document.querySelectorAll('.public-share-video-media')].map(video=>({name:video.getAttribute('aria-label'),z:Number(getComputedStyle(video).zIndex)})),top:top?.getAttribute('aria-label')}})()")
  assert.deepEqual(publicTrackStack.tracks.map(track=>track.z), [1, 2], 'public playback preserves the two video track layers')
  assert.equal(await evaluate("Math.abs(Number(document.querySelectorAll('.public-share-video-track-viewport')[1]?.style.opacity)-0.45)<0.001"), true, 'public playback applies the visual clip opacity')
  const publicTrackFraming = await evaluate("(()=>{const viewport=document.querySelectorAll('.public-share-video-track-viewport')[1];const media=document.querySelectorAll('.public-share-video-media')[1];return {overflow:getComputedStyle(viewport).overflow,width:media.style.width,left:media.style.left,opacity:viewport.style.opacity}})()")
  assert.deepEqual(publicTrackFraming, { overflow: 'hidden', width: '125%', left: '-2.5%', opacity: '0.45' }, `public preview applies track cover, zoom, framing, and alpha: ${JSON.stringify(publicTrackFraming)}`)
  assert.match(publicTrackStack.top ?? '', /faixa 2: Camada WebM azul/i, 'the higher video lane is the visible top layer in the public preview')
  await evaluate("document.querySelector('.public-share-video-controls button')?.click()")
  await waitFor(() => evaluate("[...document.querySelectorAll('.public-share-video-media')].length===2&&[...document.querySelectorAll('.public-share-video-media')].every(video=>video.currentTime>0.15)"), 'both overlapping video clips play on the public timeline')
  const seekPublicVideo = value => evaluate(`(()=>{const input=document.querySelector('.public-share-video-controls input[type=range]');input.value='${value}';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const timedPixel = () => evaluate("(()=>{const image=document.querySelector('.public-share-video-overlay');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const x=Math.round(110*image.naturalWidth/160),y=Math.round(70*image.naturalHeight/90);return [...context.getImageData(x,y,1,1).data]})()")
  await seekPublicVideo(100)
  await waitFor(async () => (await timedPixel())[3] === 0, 'estado inicial sem a camada temporizada')
  await seekPublicVideo(600)
  await waitFor(async () => { const pixel = await timedPixel(); return pixel[1] > 220 && pixel[0] < 20 && pixel[3] > 240 }, 'aparecimento da camada no intervalo de tempo configurado')
  await seekPublicVideo(1100)
  await waitFor(async () => (await timedPixel())[3] === 0, 'ocultacao da camada ao fim da duracao')
  await seekPublicVideo(1900)
  await waitFor(() => evaluate("document.querySelector('.public-share-scene-label')?.textContent==='Cena 2 / 2'"), 'transição para a segunda cena compartilhada')
  const secondSceneMediaSrc = publicVideoPayload.payload.timelineMedia['public-video-asset-2'].src
  await waitFor(() => evaluate(`document.querySelector('.public-share-video-media')?.getAttribute('src')===${JSON.stringify(secondSceneMediaSrc)}`), 'mídia sincronizada da segunda cena')
  const transparentVideoOverlay = await evaluate("(()=>{const image=document.querySelector('.public-share-video-overlay');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,1,1).data[3]})()")
  assert.equal(transparentVideoOverlay, 0, 'video scene overlay preserves the clip beneath transparent background pixels')
  const mobilePublicViewer = await evaluate("({viewport:innerWidth,rootWidth:document.documentElement.scrollWidth,title:document.querySelector('.public-share-content h1')?.textContent,editor:Boolean(document.querySelector('.canvas-workspace')),stageWidth:document.querySelector('.public-share-video-stage')?.clientWidth,stageScrollWidth:document.querySelector('.public-share-video-stage')?.scrollWidth})")
  assert.ok(mobilePublicViewer.viewport===390&&mobilePublicViewer.rootWidth<=390&&mobilePublicViewer.title==='Prévia de vídeo público'&&!mobilePublicViewer.editor&&mobilePublicViewer.stageWidth===370&&mobilePublicViewer.stageScrollWidth<=mobilePublicViewer.stageWidth, `public viewer is read-only and responsive: ${JSON.stringify(mobilePublicViewer)}`)
  console.log('Collaboration browser check passed: document sharing and team role promotion/member removal persisted from responsive dialogs; public links were created, opened anonymously as a read-only responsive preview and revoked; team media loaded into a team project and became a document-scoped reference on insertion; offline autosave recovered; remote spreadsheet, Docs text/table/block structure, design property, layer-order, video clip edits for separate users over SSE, same-profile two-tab design update, same-profile whiteboard connector SSE/canvas rendering/reload persistence, cross-account remote group selection outlines for both members, line start/end marker swap and curved-line edit in a second tab with passive first-tab update and both settings preserved after reload, page-structure, slide name/background, presenter-note and second-user cursor/clear events arrived over SSE; mobile touch also published and cleared the normalized canvas cursor; an authorized editor restored and copied a historical revision into a separate project with referenced media preserved; shared cloud media appeared in the editor library after switching to a second authorized account.')
} catch (error) {
  if (error instanceof Error && error.message === '__OFFLINE_AUTOSAVE_CHECK_PASSED__') console.log('PASS cloud spreadsheet edit stays pending during network loss and autosaves after SSE reconnect without another edit')
  else if (error instanceof Error && error.message === '__OFFLINE_RELOAD_RECOVERY_PASSED__') console.log('PASS cloud draft survives reload with document API unavailable, restores offline, merges on reconnect, autosaves revision 3, and clears the local draft')
  else throw error
} finally {
  if (collaboratorBrowserContextId && browserSocket?.readyState === WebSocket.OPEN) {
    try { await sendBrowser('Target.disposeBrowserContext', { browserContextId: collaboratorBrowserContextId }) } catch {}
  }
  if (browserSocket?.readyState === WebSocket.OPEN) {
    try { browserSocket.send(JSON.stringify({ id: 999998, method: 'Browser.close' })); await new Promise(resolve => { const timer = setTimeout(resolve, 1200); browserSocket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true }) }) } catch {}
  }
  pageSocket?.close()
  await vite?.close()
  await new Promise(resolve => apiServer.close(resolve))
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) { try { await waitFor(() => chrome.exitCode !== null || chrome.signalCode !== null, 'Chrome fechar', 8000) } catch { chrome.kill() } }
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) { try { if (profile) await rm(profile, { recursive: true, force: true }) } catch {} }
}

