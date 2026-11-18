import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, access } from 'node:fs/promises'
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
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const apiPort = await freePort(), webPort = await freePort()
const apiOrigin = `http://127.0.0.1:${apiPort}`, webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin], invitationEmailSender: async () => ({ status: 'link-only', reason: 'browser-test-sandbox' }) })
await new Promise(resolve => apiServer.listen(apiPort, '127.0.0.1', resolve))
const profiles = []
const browsers = []
let vite

async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiOrigin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, payload: await response.json(), setCookie: response.headers.get('set-cookie') }
}

async function startSession(name, cookie) {
  const cdpPort = await freePort()
  const profile = await mkdtemp(path.join(os.tmpdir(), `fuse-whiteboard-collab-${name}-`))
  profiles.push(profile)
  const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  browsers.push(chrome)
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.ok, `${name} Chrome CDP`)
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), `${name} page`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const pending = new Map()
  let commandId = 0
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const id = ++commandId; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await send('Network.enable')
  assert.equal((await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })).result.success, true, `${name} gets an isolated session cookie`)
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}};const nativeFetch=window.fetch.bind(window);window.__putBodies=[];window.__opRecords=[];window.fetch=(input,init={})=>{const url=String(input);const method=init.method||'GET';if(method==='PUT'&&url.includes('/api/documents/'))window.__putBodies.push({url,body:JSON.parse(init.body)});const operation=method==='POST'&&url.endsWith('/operations');return nativeFetch(input,init).then(async response=>{if(operation)window.__opRecords.push({request:JSON.parse(init.body),response:await response.clone().json()});return response})}" })
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs')) && Boolean(document.querySelector('.home-account'))"), `${name} authenticated library`)
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  return { socket, send, evaluate }
}

try {
  assert.ok(chromePath, 'Set CHROME_PATH to run the two-session whiteboard connector browser check')
  const password = 'Fuse-Whiteboard-Collab-Password-42'
  const register = async (name, suffix) => {
    const email = `whiteboard-collab-${suffix}-${Date.now()}@example.test`
    assert.equal((await api('/api/auth/register', { method: 'POST', body: { name, email, password } })).status, 201)
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password } })
    assert.equal(login.status, 200)
    const cookie = login.setCookie?.split(';')[0]
    assert.ok(cookie)
    return { email, cookie }
  }
  const owner = await register('Whiteboard test owner', 'owner')
  const editorA = await register('Whiteboard editor A', 'editor-a')
  const editorB = await register('Whiteboard editor B', 'editor-b')
  const created = await api('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Collaborative connector test', data: {
    type: 'whiteboard', width: 1600, height: 1000, pages: [{ id: 'collab-board-page', name: 'Quadro 1', background: '#ffffff', elements: [
      { id: 'collab-shape-a', type: 'shape', name: 'Início', shape: 'rect', x: 100, y: 120, width: 180, height: 100, rotation: 0, fill: '#8e7cf5', cornerRadius: 8 },
      { id: 'collab-shape-b', type: 'shape', name: 'Fim', shape: 'rect', x: 500, y: 120, width: 180, height: 100, rotation: 0, fill: '#8e7cf5', cornerRadius: 8 },
    ], connectors: [] }],
  } } })
  assert.equal(created.status, 201)
  const documentId = created.payload.id
  for (const editor of [editorA, editorB]) assert.equal((await api(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: editor.email, role: 'editor' } })).status, 201)

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiOrigin, changeOrigin: false } } } })
  await vite.listen()
  const sessionA = await startSession('editor-a', editorA.cookie)
  const sessionB = await startSession('editor-b', editorB.cookie)
  const openBoard = async (session, label) => {
    await waitFor(() => session.evaluate(`Boolean(document.querySelector('[aria-label="Abrir ${created.payload.name}"]'))`), `${label} sees shared whiteboard`)
    await session.evaluate(`document.querySelector('[aria-label="Abrir ${created.payload.name}"]').click()`)
    await waitFor(() => session.evaluate("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), `${label} opens shared whiteboard`)
  }
  await openBoard(sessionA, 'editor A')
  await openBoard(sessionB, 'editor B')

  const editorAUser = await sessionA.evaluate("fetch('/api/auth/me').then(response=>response.json()).then(result=>result.user)")
  await waitFor(() => sessionA.evaluate("document.querySelector('.realtime-presence')?.classList.contains('connected')") && sessionB.evaluate("document.querySelector('.realtime-presence')?.classList.contains('connected')"), 'both collaboration sessions connected')
  const cursorPointer = await sessionA.evaluate("(()=>{const view=document.querySelector('.canvas-viewport');const rect=view.getBoundingClientRect();return {x:rect.left+rect.width*.36,y:rect.top+rect.height*.32}})()")
  await sessionA.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cursorPointer.x, y: cursorPointer.y })
  const cursorEvent = await waitFor(() => sessionB.evaluate(`window.__sseMessages?.findLast(message=>message.type==='cursor.updated'&&message.userId==='${editorAUser.id}'&&message.cursor?.pageId==='collab-board-page') ?? null`), 'cursor event arrives in the second session')
  assert.ok(cursorEvent.cursor.x >= 0 && cursorEvent.cursor.x <= 1 && cursorEvent.cursor.y >= 0 && cursorEvent.cursor.y <= 1, 'cursor event is normalized to the board')
  const remoteCursor = await waitFor(() => sessionB.evaluate(`(()=>{const stage=window.Konva?.stages?.[0];const cursor=stage?.findOne('#remote-cursor-${editorAUser.id}');if(!cursor)return null;const point=cursor.getAbsolutePosition();const raster=stage.toCanvas({x:point.x-9,y:point.y-9,width:18,height:18,pixelRatio:1});const context=raster.getContext('2d'),pixels=context.getImageData(0,0,raster.width,raster.height).data,palette=[[108,92,231],[223,115,95],[41,155,131],[68,120,189]];let matches=0;for(let index=0;index<pixels.length;index+=4)if(pixels[index+3]>220&&palette.some(([r,g,b])=>Math.abs(pixels[index]-r)<32&&Math.abs(pixels[index+1]-g)<32&&Math.abs(pixels[index+2]-b)<32))matches++;return matches?{x:point.x,y:point.y,matches}:null})()`), 'remote collaborator cursor is painted at its transformed canvas point')
  assert.ok(remoteCursor.matches > 0, 'remote cursor marker pixels exist in the second editor canvas')

  await sessionA.evaluate("document.querySelector('[aria-label=\"Conector\"]').click()")
  await waitFor(() => sessionA.evaluate("document.querySelector('[aria-label=\"Conector\"]')?.getAttribute('aria-pressed')==='true'"), 'editor A activates connector tool')
  await sessionA.evaluate("document.querySelector('[data-element-id=\"collab-shape-a\"]').click()")
  await sessionA.evaluate("document.querySelector('[data-element-id=\"collab-shape-b\"]').click()")
  const withConnector = await waitFor(async () => {
    const result = await api(`/api/documents/${documentId}`, { cookie: editorA.cookie })
    return result.payload.data.pages[0].connectors?.length === 1 ? result.payload : null
  }, 'editor A creates cloud connector from the editor')
  const connectorId = withConnector.data.pages[0].connectors[0].id
  await waitFor(() => sessionA.evaluate("Boolean(document.querySelector('#connector-color'))"), 'editor A connector inspector')

  const setValue = async (session, selector, value) => session.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Missing control '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value})()`)
  assert.equal(await setValue(sessionA, '#connector-color', '#e63b68'), '#e63b68')
  assert.equal(await setValue(sessionA, '#connector-stroke-width', '11'), '11')
  assert.equal(await setValue(sessionA, '[aria-label="Âncora Início Y"]', '0.2'), '0.2')
  assert.equal(await setValue(sessionA, '[aria-label="Âncora Fim X"]', '0.1'), '0.1')

  const savedConnector = await waitFor(async () => {
    const result = await api(`/api/documents/${documentId}`, { cookie: editorA.cookie })
    const connector = result.payload.data.pages[0].connectors?.find(item => item.id === connectorId)
    return connector?.color === '#e63b68' && connector.strokeWidth === 11 && connector.fromAnchor?.y === 0.2 && connector.toAnchor?.x === 0.1 ? connector : null
  }, 'atomic style and endpoint anchor patches from editor A')
  assert.deepEqual(savedConnector.fromAnchor, { x: 0.5, y: 0.2 })
  assert.deepEqual(savedConnector.toAnchor, { x: 0.1, y: 0.5 })

  await waitFor(() => sessionB.evaluate(`Boolean(document.querySelector('[data-connector-id="${connectorId}"]'))`), 'editor B receives the new connector over document SSE')
  await sessionB.evaluate(`document.querySelector('[data-connector-id="${connectorId}"]').click()`)
  await waitFor(() => sessionB.evaluate("document.querySelector('#connector-color')?.value==='#e63b68' && document.querySelector('#connector-stroke-width')?.value==='11' && document.querySelector('[aria-label=\"Âncora Início Y\"]')?.value==='0.2' && document.querySelector('[aria-label=\"Âncora Fim X\"]')?.value==='0.1'"), 'editor B inspector receives connector patches')

  const putCountBeforeNudge = await sessionA.evaluate(`window.__putBodies.filter(item=>item.url.endsWith('/${documentId}')).length`)
  await sessionA.evaluate("document.querySelector('.layer-row[data-element-id=\"collab-shape-a\"]').click()")
  await waitFor(() => sessionA.evaluate("document.querySelector('.layer-row[data-element-id=\"collab-shape-a\"]')?.classList.contains('selected')"), 'editor A selects the first shape layer')
  await sessionA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' })
  await sessionA.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' })
  const nudgedDocument = await waitFor(async () => {
    const result = await api(`/api/documents/${documentId}`, { cookie: editorA.cookie })
    return result.payload.data.pages[0].elements.find(item => item.id === 'collab-shape-a')?.x === 101 ? result.payload : null
  }, 'keyboard nudge reaches canonical cloud document')
  await waitFor(() => sessionB.evaluate(`window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=${nudgedDocument.revision})`), 'keyboard nudge reaches editor B over SSE')
  const nudgeOps = await sessionA.evaluate("window.__opRecords.map(record=>record.request)")
  assert.ok(nudgeOps.some(operation => operation.type === 'design.element.patch' && operation.elementId === 'collab-shape-a' && operation.patch?.x === 101), 'keyboard movement sends an element patch')
  assert.equal(await sessionA.evaluate(`window.__putBodies.filter(item=>item.url.endsWith('/${documentId}')).length`), putCountBeforeNudge, 'keyboard movement does not issue a redundant document PUT')

  const putCountBeforeArrange = await sessionA.evaluate(`window.__putBodies.filter(item=>item.url.endsWith('/${documentId}')).length`)
  await sessionA.evaluate("document.querySelector('[aria-label=\"Selecionar\"]').click()")
  await sessionA.evaluate("document.querySelector('.tool-button[title=\"Selecionar vários objetos\"]').click()")
  await waitFor(() => sessionA.evaluate("document.querySelector('.tool-button[title=\"Selecionar vários objetos\"]')?.getAttribute('aria-pressed')==='true'"), 'editor A enables multi selection')
  for (const id of ['collab-shape-a', 'collab-shape-b']) {
    const alreadySelected = await sessionA.evaluate(`document.querySelector('.layer-row[data-element-id="${id}"]')?.classList.contains('selected')`)
    if (!alreadySelected) {
      await sessionA.evaluate(`document.querySelector('.layer-row[data-element-id="${id}"]').click()`)
      await waitFor(() => sessionA.evaluate(`document.querySelector('.layer-row[data-element-id="${id}"]')?.classList.contains('selected')`), `editor A selects ${id}`)
    }
  }
  await waitFor(() => sessionA.evaluate("document.querySelectorAll('.layer-row.selected').length===2"), 'editor A selects two shape layers')
  await sessionA.evaluate("(()=>{const select=document.querySelector('.arrangement-control select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'left');select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  const alignedDocument = await waitFor(async () => {
    const result = await api(`/api/documents/${documentId}`, { cookie: editorA.cookie })
    const elements = result.payload.data.pages[0].elements
    const first = elements.find(item => item.id === 'collab-shape-a')
    const second = elements.find(item => item.id === 'collab-shape-b')
    return first?.x === 101 && second?.x === 101 ? result.payload : null
  }, 'whiteboard alignment reaches canonical cloud document')
  await waitFor(() => sessionB.evaluate(`window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=${alignedDocument.revision})`), 'alignment patches reach editor B over SSE')
  const alignOps = await sessionA.evaluate("window.__opRecords.map(record=>record.request)")
  assert.ok(alignOps.some(operation => operation.type === 'design.element.patch' && operation.elementId === 'collab-shape-b' && operation.patch?.x === 101), 'alignment sends a position patch for the changed element')
  assert.equal(await sessionA.evaluate(`window.__putBodies.filter(item=>item.url.endsWith('/${documentId}')).length`), putCountBeforeArrange, 'whiteboard alignment does not issue a redundant document PUT')

  await sessionB.send('Page.reload')
  const reloadDestination = await waitFor(() => sessionB.evaluate("Boolean(document.querySelector('.library-mode-tabs')) && Boolean(document.querySelector('.home-account')) ? 'library' : document.querySelector('.canvas-workspace .whiteboard-zoom-controls') ? 'editor' : null"), 'editor B restores its route after reload')
  if (reloadDestination === 'library') {
    await sessionB.evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
    await openBoard(sessionB, 'editor B after reload')
  } else await waitFor(() => sessionB.evaluate("Boolean(document.querySelector('.canvas-workspace .whiteboard-zoom-controls'))"), 'editor B restores the direct whiteboard editor route')
  await waitFor(() => sessionB.evaluate(`Boolean(document.querySelector('[data-connector-id="${connectorId}"]'))`), 'persisted connector remains after reload')
  await sessionB.evaluate(`document.querySelector('[data-connector-id="${connectorId}"]').click()`)
  await waitFor(() => sessionB.evaluate("document.querySelector('#connector-color')?.value==='#e63b68' && document.querySelector('#connector-stroke-width')?.value==='11' && document.querySelector('[aria-label=\"Âncora Início Y\"]')?.value==='0.2' && document.querySelector('[aria-label=\"Âncora Fim X\"]')?.value==='0.1'"), 'persisted style and anchor values restore for editor B')
  console.log(`PASS two-editor whiteboard collaboration: connector styling, keyboard nudge x=${nudgedDocument.data.pages[0].elements.find(item => item.id === 'collab-shape-a').x}, alignment x=${alignedDocument.data.pages[0].elements.find(item => item.id === 'collab-shape-b').x}, connector state after reload; SSE and no redundant PUTs`)
} finally {
  for (const browser of browsers) { try { if (browser.pid) { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); else browser.kill('SIGTERM') } } catch {} }
  await vite?.close().catch(() => {})
  await new Promise(resolve => apiServer.close(resolve))
  for (const profile of profiles) if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('fuse-whiteboard-collab-')) await rm(profile, { recursive: true, force: true }).catch(() => {})
}
