import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(import.meta.dirname, '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge required; set CHROME_PATH.')
async function freePort() { const server = createTcpServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(120) } throw new Error(`Timed out waiting for ${label}`) }
const webPort = await freePort(); let cdpPort = await freePort(); while (cdpPort === webPort) cdpPort = await freePort()
const origin = `http://127.0.0.1:${webPort}`
const api = createAppServer({ databasePath: ':memory:', allowedOrigins: [origin] })
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
const apiBase = `http://127.0.0.1:${api.address().port}`
async function apiRequest(route, { method = 'GET', body, cookie } = {}) { const headers = { origin }; if (body !== undefined) headers['content-type'] = 'application/json'; if (cookie) headers.cookie = cookie; const response = await fetch(`${apiBase}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, payload: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] } }
let vite; let chrome; let browserSocket; let profile; let ownerContextId
try {
  const password = 'Fuse-Comment-Test-Password-42'
  const ownerEmail = `comment-owner-${Date.now()}@example.test`; const guestEmail = `comment-guest-${Date.now()}@example.test`
  for (const [name, email] of [['Comment owner', ownerEmail], ['Comment guest', guestEmail]]) assert.equal((await apiRequest('/api/auth/register', { method: 'POST', body: { name, email, password } })).status, 201)
  const owner = await apiRequest('/api/auth/login', { method: 'POST', body: { email: ownerEmail, password } }); const guest = await apiRequest('/api/auth/login', { method: 'POST', body: { email: guestEmail, password } })
  const data = { type: 'design', width: 794, height: 1123, pages: [{ id: 'page-one', name: 'Page one', background: '#fff', elements: [] }] }
  const documentResponse = await apiRequest('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Comment source', data } }); assert.equal(documentResponse.status, 201)
  const documentId = documentResponse.payload.id
  assert.equal((await apiRequest(`/api/documents/${documentId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: guestEmail, role: 'commenter' } })).status, 201)
  const destinationResponse = await apiRequest('/api/documents', { method: 'POST', cookie: owner.cookie, body: { name: 'Comment destination', data } }); assert.equal(destinationResponse.status, 201)
  const destinationId = destinationResponse.payload.id
  assert.equal((await apiRequest(`/api/documents/${destinationId}/permissions`, { method: 'POST', cookie: owner.cookie, body: { email: guestEmail, role: 'commenter' } })).status, 201)
  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiBase } } } }); await vite.listen()
  profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-comment-notifications-'))
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  let pageId = 0; const pending = new Map(); browserSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  let guestSessionId
  const send = (method, params = {}, sessionId = guestSessionId) => { const id = ++pageId; const promise = new Promise(resolve => pending.set(id, resolve)); browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return promise }
  async function evaluate(expression, sessionId = guestSessionId) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function createPageSession(cookie, browserContextId) {
    const target = await send('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) }, null)
    assert.ok(target.result?.targetId, 'an isolated browser tab is created')
    const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true }, null)
    const sessionId = attached.result.sessionId
    await send('Page.enable', {}, sessionId); await send('Network.enable', {}, sessionId)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__notificationEventSources=[];window.__commentEvents=[];const NativeEventSource=window.EventSource;window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);window.__notificationEventSources.push(this);this.addEventListener('message',event=>{try{window.__commentEvents.push(JSON.parse(event.data))}catch{}})}}" }, sessionId)
    const cookieResult = await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${origin}/`, path: '/', sameSite: 'Lax' }, sessionId)
    assert.equal(cookieResult.result.success, true)
    await send('Page.navigate', { url: origin }, sessionId)
    return sessionId
  }
  guestSessionId = await createPageSession(guest.cookie)
  const ownerContext = await send('Target.createBrowserContext', { disposeOnDetach: true }, null)
  ownerContextId = ownerContext.result.browserContextId
  const ownerSessionId = await createPageSession(owner.cookie, ownerContextId)
  await waitFor(async () => await evaluate("fetch('/api/auth/me').then(r=>r.json()).then(u=>u.user.email)") === guestEmail, 'recipient signed-in library')
  await waitFor(() => evaluate("window.__notificationEventSources?.some(source=>source.readyState===1)"), 'recipient notification SSE connection')
  await waitFor(async () => await evaluate("fetch('/api/auth/me').then(r=>r.json()).then(u=>u.user.email)", ownerSessionId) === ownerEmail, 'owner signed-in library')
  await waitFor(() => evaluate("window.__notificationEventSources?.some(source=>source.readyState===1)", ownerSessionId), 'owner document SSE connection')

  async function openCloudProject(sessionId, name) {
    await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs')||document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]'))", sessionId), `${name} project library or open editor`)
    const editorAlreadyOpen = await evaluate("Boolean(document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]'))", sessionId)
    if (!editorAlreadyOpen) {
      await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()", sessionId)
      await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Comment source\"]'))", sessionId), `${name} shared source project`)
      await evaluate("document.querySelector('[aria-label=\"Abrir Comment source\"]').click()", sessionId)
    }
    await waitFor(() => evaluate("Boolean(document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]'))", sessionId), `${name} editor opens shared source`)
    await waitFor(() => evaluate("Boolean(document.querySelector('.topbar .save-state')?.textContent)", sessionId), `${name} cloud document state`)
  }
  async function openCommentPanel(sessionId, label) {
    await evaluate("[...document.querySelectorAll('.comment-button')].find(button=>button.textContent.startsWith('Comentários')).click()", sessionId)
    await waitFor(() => evaluate("Boolean(document.querySelector('.comments-dialog .comment-form textarea[aria-label=\"Novo comentário\"]'))", sessionId), `${label} comment composer`)
  }
  async function setCommentComposer(sessionId, label, content) {
    const expression = `(()=>{const input=document.querySelector(${JSON.stringify(`.comments-dialog .comment-form textarea[aria-label="${label}"]`)});if(!input)throw new Error('comment composer not found');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSON.stringify(content)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`
    await evaluate(expression, sessionId)
    await waitFor(() => evaluate("!document.querySelector('.comment-form button[type=submit]').disabled", sessionId), `${label} draft is ready`)
    await evaluate("document.querySelector('.comment-form').requestSubmit()", sessionId)
  }
  await openCloudProject(ownerSessionId, 'owner')
  await openCommentPanel(ownerSessionId, 'owner')
  const rootComment = 'Owner review thread for SSE'
  await setCommentComposer(ownerSessionId, 'Novo comentário', rootComment)
  await waitFor(() => evaluate(`[...document.querySelectorAll('.comment-item')].some(item=>item.innerText.includes(${JSON.stringify(rootComment)}))`, ownerSessionId), 'owner comment appears in the editor')
  await openCloudProject(guestSessionId, 'commenter')
  await openCommentPanel(guestSessionId, 'commenter')
  await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.comment-item')].find(item=>item.innerText.includes(${JSON.stringify(rootComment)})))`, guestSessionId), 'commenter receives the owner thread from cloud')
  await evaluate("[...document.querySelectorAll('.comment-item .comment-actions button')].find(button=>button.textContent.trim()==='Responder').click()", guestSessionId)
  const replyText = 'Commenter reply over SSE'
  await setCommentComposer(guestSessionId, 'Resposta ao comentário', replyText)
  await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.comment-item .comment-reply')].find(item=>item.innerText.includes(${JSON.stringify(replyText)})))`, ownerSessionId), 'owner receives the commenter reply over document SSE without refresh')
  await evaluate("[...document.querySelectorAll('.comment-item .comment-actions button')].find(button=>button.textContent.trim()==='Resolver').click()", guestSessionId)
  await waitFor(() => evaluate("Boolean(document.querySelector('.comment-item .comment-resolved-label'))", ownerSessionId), 'owner receives the resolved state over document SSE')
  await waitFor(() => evaluate("document.querySelector('.comment-item .comment-resolved-label')?.textContent.trim()==='Resolvido'", guestSessionId), 'commenter receives the local resolved state')
  assert.ok(await evaluate("document.querySelector('.comment-item .comment-resolved-label')?.textContent.trim()==='Resolvido'", guestSessionId), 'commenter may resolve the shared thread')
  for (const [sessionId, label] of [[ownerSessionId, 'owner'], [guestSessionId, 'commenter']]) {
    await send('Page.reload', { ignoreCache: true }, sessionId)
    await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs')||document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]'))", sessionId), `${label} document reloads`)
    await openCloudProject(sessionId, label)
    await openCommentPanel(sessionId, label)
    await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.comment-item')].find(item=>item.innerText.includes(${JSON.stringify(rootComment)})&&item.innerText.includes(${JSON.stringify(replyText)})&&item.querySelector('.comment-resolved-label')))` , sessionId), `${label} reload restores thread, reply and resolved state`)
  }
  const persistedThread = await apiRequest(`/api/documents/${documentId}/comments`, { cookie: owner.cookie })
  assert.equal(persistedThread.status, 200)
  assert.equal(persistedThread.payload.comments.filter(comment=>!comment.parentId).length, 1, 'cloud retains one root comment')
  assert.ok(persistedThread.payload.comments.some(comment=>comment.parentId===persistedThread.payload.comments.find(comment=>comment.content===rootComment)?.id&&comment.content===replyText), 'cloud retains the reply attached to its root')
  assert.ok(persistedThread.payload.comments.find(comment=>comment.content===rootComment)?.resolvedAt, 'cloud retains the resolved state')
  await evaluate("document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-notifications-trigger'))"), 'commenter returns to the library notification surface')

  const mention = await apiRequest(`/api/documents/${destinationId}/comments`, { method: 'POST', cookie: owner.cookie, body: { pageId: 'page-one', content: `@${guestEmail} review this page` } })
  assert.equal(mention.status, 201, 'a different user posts a mention to the recipient')
  await waitFor(() => evaluate("document.querySelector('.home-notifications-trigger span')?.textContent==='1'"), 'SSE notification reaches recipient without reload')
  const unread = await apiRequest('/api/notifications', { cookie: guest.cookie }); assert.equal(unread.payload.unreadCount, 1)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("document.querySelector('.home-notifications-trigger').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-notifications-dialog .comment-notification'))"), 'global notification center receives SSE item')
  const mobile = await evaluate("(() => { const rect=document.querySelector('.home-notifications-dialog').getBoundingClientRect();return {width:rect.width,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}})()")
  assert.ok(mobile.width <= mobile.viewport + 1 && mobile.scrollWidth <= mobile.viewport + 1, 'global notification center fits a 390px mobile viewport')
  assert.ok((await evaluate("document.querySelector('.home-notifications-dialog .comment-notification').innerText")).includes('review this page'), 'global center displays the new mention')
  await evaluate("document.querySelector('.home-notifications-dialog .comment-notification .comment-anchor').click()")
  await waitFor(() => evaluate("document.querySelector('.home-notifications-dialog .comment-notification').innerText.includes('Lida')"), 'notification marked read')
  assert.equal((await apiRequest('/api/notifications', { cookie: guest.cookie })).payload.unreadCount, 0, 'read state persists on the server')

  await send('Page.reload', { ignoreCache: true })
  await waitFor(async () => await evaluate("fetch('/api/auth/me').then(r=>r.json()).then(u=>u.user.email)") === guestEmail, 'recipient session after tab reconnect')
  await waitFor(() => evaluate("window.__notificationEventSources?.some(source=>source.readyState===1)"), 'SSE reconnects after reload')
  await evaluate("document.querySelector('.home-notifications-trigger').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-notifications-dialog .comment-notification'))"), 'notification persists after reconnect')
  const state = await evaluate("({card:document.querySelector('.home-notifications-dialog .comment-notification').innerText,badge:document.querySelector('.home-notifications-trigger').getAttribute('aria-label')})")
  assert.ok(state.card.includes('Lida'), 'read state remains after reconnect')
  assert.ok(!state.badge.includes('1'), 'no unread badge remains after reconnect')
  await evaluate("document.querySelector('.home-notifications-dialog .asset-close').click()")
  await evaluate("document.querySelector('.library-mode-tabs button:nth-child(2)').click()")
  await waitFor(() => evaluate("[...document.querySelectorAll('.project-open')].some(button=>button.getAttribute('aria-label')==='Abrir Comment source')"), 'cloud project library before opening source')
  await evaluate("document.querySelector('[aria-label=\"Abrir Comment source\"]')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]')) || document.querySelector('.home-error')?.textContent"), 'unrelated source document opens')
  assert.ok(await evaluate("Boolean(document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]'))"), `source project should open before following cross-project notification: ${await evaluate("JSON.stringify({url:location.href,projects:[...document.querySelectorAll('.project-open')].map(button=>button.getAttribute('aria-label')),error:document.querySelector('.home-error')?.textContent})")}`)
  await evaluate("document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-projects-heading'))"), 'return to project library before notification navigation')
  await evaluate("document.querySelector('.home-notifications-trigger').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-notifications-dialog .comment-notification'))"), 'destination notification in library')
  await evaluate("document.querySelector('.home-notifications-dialog .comment-notification > button:first-child').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-comment-id]')) || Boolean(document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]'))"), 'destination document opens from notification')
  await delay(1500)
  const destinationState = await evaluate("JSON.stringify({url:location.href,comment:!!document.querySelector('[data-comment-id]'),commentText:document.body.innerText.includes('review this page'),body:document.body.innerText.slice(-1200),name:document.querySelector('.topbar')?.innerText})")
  assert.ok(await evaluate("Boolean(document.querySelector('[data-comment-id]')) && document.body.innerText.includes('review this page')"), `notification should navigate to its document and open the comment thread: ${destinationState}`)
  console.log('Owner and commenter contexts sync comment, reply and resolve over SSE; both reload with the thread intact. Mention delivery, mobile center, read persistence and cross-project navigation pass.')
} finally {
  try { if (ownerContextId && browserSocket?.readyState === WebSocket.OPEN) await send('Target.disposeBrowserContext', { browserContextId: ownerContextId }, null) } catch {}
  try { browserSocket?.close() } catch {}
  if (chrome?.pid) { if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else { try { chrome.kill('SIGTERM') } catch {} }; await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), delay(5000)]) }
  await vite?.close(); await new Promise(resolve => api.close(resolve)); if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {})
}
