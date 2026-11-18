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
const profiles = [], browsers = []
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
  const profile = await mkdtemp(path.join(os.tmpdir(), `fuse-drawing-collab-${name}-`))
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
  assert.equal((await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })).result.success, true, `${name} receives isolated session`)
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "const NativeEventSource=window.EventSource;window.__sseMessages=[];window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.__sseMessages.push(JSON.parse(event.data))}catch{}})}};window.__opRecords=[];const nativeFetch=window.fetch.bind(window);window.fetch=(input,init={})=>{const operation=init.method==='POST'&&String(input).endsWith('/operations');return nativeFetch(input,init).then(async response=>{if(operation)window.__opRecords.push({request:JSON.parse(init.body),response:await response.clone().json()});return response})}" })
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs')) && Boolean(document.querySelector('.home-account'))"), `${name} authenticated library`)
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  return { socket, send, evaluate }
}

async function openDesign(session, name, label) {
  await waitFor(() => session.evaluate(`Boolean(document.querySelector('[aria-label="Abrir ${name}"]'))`), `${label} sees shared project`)
  await session.evaluate(`document.querySelector('[aria-label="Abrir ${name}"]').click()`)
  await waitFor(() => session.evaluate("Boolean(document.querySelector('.canvas-workspace')) && Boolean(document.querySelector('.editor-tools-tab'))"), `${label} opens shared design`)
  await waitFor(() => session.evaluate("document.querySelector('.realtime-presence')?.classList.contains('connected')"), `${label} connects to document SSE`)
}

async function canvasPoint(session, x, y) {
  return session.evaluate(`(()=>{const view=document.querySelector('.canvas-viewport');const stage=view.querySelector('.konvajs-content');const rect=stage.getBoundingClientRect();const zoom=Number(view.dataset.canvasZoom);return{x:rect.left+Number(view.dataset.canvasOffsetX)+${x}*zoom,y:rect.top+Number(view.dataset.canvasOffsetY)+${y}*zoom,zoom}})()`)
}

async function stroke(session, start, end) {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1 })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left', buttons: 1 })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0 })
}

try {
  assert.ok(chromePath, 'Set CHROME_PATH to run the two-account design drawing collaboration test')
  const password = 'Fuse-Drawing-Collab-Password-42'
  const register = async (name, suffix) => {
    const email = `drawing-collab-${suffix}-${Date.now()}@example.test`
    assert.equal((await api('/api/auth/register', { method: 'POST', body: { name, email, password } })).status, 201)
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password } })
    assert.equal(login.status, 200)
    return { email, cookie: login.setCookie?.split(';')[0] }
  }
  const owner = await register('Drawing test owner', 'owner')
  const member = await register('Drawing test member', 'member')
  const created = await api('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Shared partial drawing', data: {
    type: 'design', width: 1200, height: 800, pages: [{ id: 'drawing-collab-page', name: 'Page 1', background: '#ffffff', elements: [] }],
  } } })
  assert.equal(created.status, 201)
  const documentId = created.payload.id
  assert.equal((await api(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: member.email, role: 'editor' } })).status, 201)

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiOrigin, changeOrigin: false } } } })
  await vite.listen()
  const memberSession = await startSession('member', member.cookie)
  const ownerSession = await startSession('owner', owner.cookie)
  await openDesign(memberSession, created.payload.name, 'member')
  await openDesign(ownerSession, created.payload.name, 'owner')

  await memberSession.evaluate("document.querySelector('.editor-tools-tab').click()")
  await waitFor(() => memberSession.evaluate("!!document.querySelector('.editor-tools-inventory')"), 'member opens design tools')
  await memberSession.evaluate("[...document.querySelectorAll('.editor-tools-inventory button')].find(button=>button.textContent.trim()==='Desenho').click()")
  await waitFor(() => memberSession.evaluate("!!document.querySelector('.drawing-subtools')"), 'member activates drawing mode')
  const memberViewportPoint = await canvasPoint(memberSession, 200, 400)
  const memberStart = { x: memberViewportPoint.x, y: memberViewportPoint.y }
  const memberEnd = { x: memberViewportPoint.x + 600 * memberViewportPoint.zoom, y: memberViewportPoint.y }
  await stroke(memberSession, memberStart, memberEnd)
  const createdStroke = await waitFor(async () => {
    const result = await api(`/api/documents/${documentId}`, { cookie: owner.cookie })
    const element = result.payload.data.pages[0].elements?.find(item => item.type === 'free-draw')
    return element ? { document: result.payload, element } : null
  }, 'member free-draw operation persists to the cloud document')
  assert.equal(createdStroke.document.data.pages[0].elements.length, 1)
  assert.deepEqual(createdStroke.element.points.slice(0, 2), [0, 0])
  assert.ok(Math.abs(createdStroke.element.y - 400) < 2, `the stroke lands on the requested canvas row after mapping from the Konva container: ${createdStroke.element.y}`)
  assert.ok(Math.abs(createdStroke.element.points[2] - 600) < 2, `browser pointer normalization keeps the requested stroke length near 600px: ${createdStroke.element.points[2]}`)
  await waitFor(() => ownerSession.evaluate(`Boolean(document.querySelector('[data-element-id="${createdStroke.element.id}"]'))`), 'owner receives member stroke over SSE')
  await waitFor(() => ownerSession.evaluate(`window.__sseMessages.some(message=>message.type==='document.updated'&&message.revision>=${createdStroke.document.revision})`), 'owner receives member stroke revision')

  await ownerSession.evaluate("document.querySelector('.editor-tools-tab').click()")
  await waitFor(() => ownerSession.evaluate("!!document.querySelector('.editor-tools-inventory')"), 'owner opens design tools')
  await ownerSession.evaluate("[...document.querySelectorAll('.editor-tools-inventory button')].find(button=>button.textContent.trim()==='Desenho').click()")
  await waitFor(() => ownerSession.evaluate("!!document.querySelector('.drawing-subtools')"), 'owner activates drawing mode')
  await ownerSession.evaluate("document.querySelector('.drawing-subtools button[aria-pressed=false]:has(svg.lucide-eraser)').click()")
  await waitFor(() => ownerSession.evaluate("[...document.querySelectorAll('.drawing-subtools button[aria-pressed=true]')].some(button=>button.textContent.includes('Borracha'))"), 'owner selects eraser')
  const eraserViewportPoint = await canvasPoint(ownerSession, 500, 350)
  const eraserProbe = await ownerSession.evaluate(`(()=>{const view=document.querySelector('.canvas-viewport');const stage=view.querySelector('.konvajs-content');const canvas=view.querySelector('canvas');const point={x:${eraserViewportPoint.x},y:${eraserViewportPoint.y}};const target=document.elementFromPoint(point.x,point.y);const rectOf=node=>{const r=node?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};const stageRect=rectOf(stage);const zoom=Number(view.dataset.canvasZoom);const worldPoint={x:(point.x-stageRect.x-Number(view.dataset.canvasOffsetX))/zoom,y:(point.y-stageRect.y-Number(view.dataset.canvasOffsetY))/zoom};return{tool:[...document.querySelectorAll('.drawing-subtools button[aria-pressed=true]')].map(button=>button.textContent.trim()),viewport:{rect:rectOf(view),offsetX:view.dataset.canvasOffsetX,offsetY:view.dataset.canvasOffsetY,zoom:view.dataset.canvasZoom},stageRect,canvasRect:rectOf(canvas),point,worldPoint,target:{tag:target?.tagName,className:typeof target?.className==='string'?target.className:null}}})()`)
  assert.ok(Math.abs(eraserProbe.worldPoint.x - 500) < 1 && Math.abs(eraserProbe.worldPoint.y - 350) < 1, `eraser screen point maps to the intended model coordinate: ${JSON.stringify(eraserProbe)}`)
  assert.ok(eraserProbe.worldPoint.y < createdStroke.element.y && eraserProbe.worldPoint.y + 100 > createdStroke.element.y, 'the eraser pointer path brackets the collaborator stroke centerline')
  await stroke(ownerSession, eraserViewportPoint, { x: eraserViewportPoint.x, y: eraserViewportPoint.y + 100 * eraserViewportPoint.zoom })

  const erasedDocument = await waitFor(async () => {
    const result = await api(`/api/documents/${documentId}`, { cookie: owner.cookie })
    const elements = result.payload.data.pages[0].elements ?? []
    return elements.length === 2 && elements.every(item => item.type === 'free-draw') ? result.payload : null
  }, 'owner partial erasure persists two replacement fragments', 45000).catch(async error => {
    const [serverSnapshot, ownerSnapshot] = await Promise.all([
      api(`/api/documents/${documentId}`, { cookie: owner.cookie }).then(result => ({ status: result.status, revision: result.payload.revision, elements: result.payload.data?.pages?.[0]?.elements?.map(item => ({ id: item.id, type: item.type, x: item.x, y: item.y, width: item.width, height: item.height, points: item.points })) })),
      ownerSession.evaluate("({saveState:document.querySelector('.save-state')?.textContent,realtime:document.querySelector('.realtime-presence')?.className,visibleStrokes:[...document.querySelectorAll('.layers-list [data-element-id]')].filter(item=>item.textContent.includes('Desenho livre')).map(item=>item.dataset.elementId),operations:window.__opRecords})"),
    ])
    throw new Error(`${error.message}; erasure diagnostics=${JSON.stringify({ eraserProbe, serverSnapshot, ownerSnapshot })}`)
  })
  const fragments = erasedDocument.data.pages[0].elements
  assert.equal(fragments.some(element => element.id === createdStroke.element.id), false, 'the original full stroke is replaced')
  assert.equal(fragments.length, 2)
  assert.ok(fragments[0].x + fragments[0].width < 500, 'first untouched segment remains before the erase position')
  assert.ok(fragments[1].x > 500, 'second untouched segment remains after the erase position')
  assert.deepEqual(fragments.map(item => [item.color, item.strokeWidth, item.opacity ?? 1]), fragments.map(() => [createdStroke.element.color, createdStroke.element.strokeWidth, createdStroke.element.opacity ?? 1]), 'replacement fragments preserve source styling')

  const verifyVisibleOrder = session => session.evaluate(`JSON.stringify([...document.querySelectorAll('.layers-list [data-element-id]')].filter(item=>item.textContent.includes('Desenho livre')).map(item=>item.dataset.elementId))`)
  const visualFragmentOrder = fragments.map(item => item.id).reverse()
  await waitFor(async () => JSON.stringify(JSON.parse(await verifyVisibleOrder(memberSession))) === JSON.stringify(visualFragmentOrder), 'member sees the same ordered fragments over SSE', 45000)
  await waitFor(async () => JSON.stringify(JSON.parse(await verifyVisibleOrder(ownerSession))) === JSON.stringify(visualFragmentOrder), 'owner sees the same ordered fragments')
  const memberOps = await memberSession.evaluate('window.__opRecords.map(record=>record.request)')
  const ownerOps = await ownerSession.evaluate('window.__opRecords.map(record=>record.request)')
  assert.ok(memberOps.some(operation => operation.type === 'design.elements.create' && operation.elements?.some(item => item.id === createdStroke.element.id)), 'member created the stroke with a collaboration operation')
  assert.ok(ownerOps.some(operation => operation.type === 'design.elements.delete' && operation.elementIds?.includes(createdStroke.element.id)), 'owner erased the original with a collaboration delete operation')
  assert.ok(ownerOps.some(operation => operation.type === 'design.elements.create' && operation.elements?.length === 2), 'owner published both untouched fragments')
  assert.ok(ownerOps.some(operation => operation.type === 'design.elements.reorder' && JSON.stringify(operation.elementIds) === JSON.stringify(fragments.map(item => item.id))), 'owner restores canonical z-order after replacement')

  await memberSession.send('Page.reload')
  await waitFor(() => memberSession.evaluate("Boolean(document.querySelector('.canvas-workspace')) && Boolean(document.querySelector('.realtime-presence'))"), 'member restores shared design after reload')
  await waitFor(() => memberSession.evaluate("document.querySelector('.realtime-presence')?.classList.contains('connected')"), 'member reconnects after reload')
  await waitFor(async () => JSON.stringify(JSON.parse(await verifyVisibleOrder(memberSession))) === JSON.stringify(visualFragmentOrder), 'server fragments and z-order restore after reload')
  const persisted = await api(`/api/documents/${documentId}`, { cookie: member.cookie })
  assert.deepEqual(persisted.payload.data.pages[0].elements.map(item => item.id), fragments.map(item => item.id), 'canonical server order survives reload')
  console.log(`PASS two-account design free-draw collaboration: member created ${createdStroke.element.id}; owner cut a middle segment; both saw ordered fragments ${fragments.map(item => item.id).join(', ')} over SSE and after reload`)
} finally {
  for (const browser of browsers) { try { if (browser.pid) { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); else browser.kill('SIGTERM') } } catch {} }
  await vite?.close().catch(() => {})
  await new Promise(resolve => apiServer.close(resolve))
  for (const profile of profiles) if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('fuse-drawing-collab-')) await rm(profile, { recursive: true, force: true }).catch(() => {})
}
