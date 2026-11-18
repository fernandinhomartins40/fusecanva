import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(import.meta.dirname, '..')
const chromePath = process.env.CHROME_PATH ?? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
const apiPort = await freePort()
const webPort = await freePort()
const apiOrigin = `http://127.0.0.1:${apiPort}`
const webOrigin = `http://127.0.0.1:${webPort}`
const apiServer = createAppServer({ databasePath: ':memory:', allowedOrigins: [webOrigin], invitationEmailSender: async () => ({ status: 'link-only' }) })
await new Promise(resolve => apiServer.listen(apiPort, '127.0.0.1', resolve))
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-cloud-archive-'))
let vite
let chrome
let browserSocket
let pageSocket

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitFor(check, label, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const { execFileSync } = await import('node:child_process')
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
}

async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: webOrigin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${apiOrigin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, payload: await response.json(), setCookie: response.headers.get('set-cookie') }
}

try {
  const password = 'Fuse-Archive-Password-42'
  const email = `archive-${Date.now()}@example.test`
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { name: 'Archive tester', email, password } })).status, 201)
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  const cookie = login.setCookie?.split(';')[0]
  const created = await api('/api/documents', { method: 'POST', cookie, body: { name: 'Projeto preservado', data: {
    type: 'design', width: 794, height: 1123, pages: [{ id: 'archive-page', name: 'Página 1', background: '#ffffff', elements: [{ id: 'archive-shape', type: 'shape', shape: 'rect', name: 'Forma preservada', x: 50, y: 60, width: 180, height: 120, rotation: 0, fill: '#6750a4', cornerRadius: 12 }, { id: 'archive-logo', type: 'image', name: 'Logo preservado', assetId: 'archive-logo-asset', src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjMGFmIi8+PC9zdmc+', x: 260, y: 60, width: 80, height: 60, rotation: 0 }] }],
  } } })
  assert.equal(created.status, 201)
  const logoSrc = created.payload.data.pages[0].elements[1].src
  const logoAsset = await api(`/api/documents/${created.payload.id}/media`, { method: 'POST', cookie, body: { asset: { id: 'archive-logo-asset', name: 'Logo preservado', mimeType: 'image/svg+xml', width: 80, height: 60, src: logoSrc, fingerprint: 'c'.repeat(64) } } })
  assert.equal(logoAsset.status, 201)

  vite = await createViteServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': { target: apiOrigin, changeOrigin: false } } } })
  await vite.listen()
  const cdpPort = await freePort()
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, `--window-size=1280,900`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
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
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text)
    return result.result.result.value
  }

  await send('Network.enable')
  assert.equal((await send('Network.setCookie', { name: 'fuse_session', value: cookie.slice('fuse_session='.length), url: `${webOrigin}/`, path: '/', sameSite: 'Lax' })).result.success, true)
  await send('Page.enable')
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'home library')
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-account'))"), 'authenticated home state')
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'cloud tab selected')
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Compartilhar Projeto preservado\"]'))"), 'cloud project card')
  await evaluate("document.querySelector('[aria-label=\"Arquivar Projeto preservado\"]').click()")
  await waitFor(async () => (await api(`/api/documents/${created.payload.id}`, { cookie })).payload.data.archivedAt, 'archive saved to cloud')
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Compartilhar Projeto preservado\"]')"), 'recent cloud list filters archived project')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Arquivados').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Restaurar Projeto preservado\"]'))"), 'archived cloud project')
  const archived = await api(`/api/documents/${created.payload.id}`, { cookie })
  assert.equal(archived.payload.revision, 2)
  assert.equal(archived.payload.data.pages[0].elements[0].name, 'Forma preservada')
  await evaluate("document.querySelector('[aria-label=\"Restaurar Projeto preservado\"]').click()")
  await waitFor(async () => !Object.hasOwn((await api(`/api/documents/${created.payload.id}`, { cookie })).payload.data, 'archivedAt'), 'restore saved to cloud')
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Restaurar Projeto preservado\"]')"), 'restored project leaves archive list')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Recentes').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Compartilhar Projeto preservado\"]'))"), 'restored project in recent cloud list')
  await evaluate("document.querySelector('[aria-label=\"Mover Projeto preservado para a lixeira\"]').click()")
  await waitFor(async () => (await api(`/api/documents/${created.payload.id}`, { cookie })).payload.data.trashedAt, 'trash state saved to cloud')
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Compartilhar Projeto preservado\"]')"), 'trashed project leaves recent list')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Lixeira').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Restaurar Projeto preservado da lixeira\"]'))"), 'project appears in trash')
  await evaluate("document.querySelector('[aria-label=\"Duplicar Projeto preservado\"]').click()")
  const projectCopy = await waitFor(async () => (await api('/api/documents', { cookie })).payload.documents.find(document => document.id !== created.payload.id && document.name.startsWith(created.payload.name)), 'nonempty duplicate created from trash')
  assert.equal(Object.hasOwn(projectCopy.data, 'trashedAt'), false)
  assert.equal(projectCopy.data.pages[0].elements[0].name, 'Forma preservada')
  assert.notEqual(projectCopy.data.pages[0].id, created.payload.data.pages[0].id)
  assert.notEqual(projectCopy.data.pages[0].elements[0].id, created.payload.data.pages[0].elements[0].id)
  assert.equal(projectCopy.data.pages[0].elements[1].assetId, 'archive-logo-asset')
  await waitFor(async () => (await api(`/api/documents/${projectCopy.id}/media`, { cookie })).payload.assets.some(asset => asset.id === 'archive-logo-asset'), 'referenced media copied to the duplicate project')
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Restaurar Projeto preservado da lixeira\"]'))"), 'trash list after duplicate refresh')
  await evaluate("document.querySelector('[aria-label=\"Restaurar Projeto preservado da lixeira\"]').click()")
  await waitFor(async () => !Object.hasOwn((await api(`/api/documents/${created.payload.id}`, { cookie })).payload.data, 'trashedAt'), 'trash restore saved to cloud')
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Restaurar Projeto preservado da lixeira\"]')"), 'restored project leaves trash')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Recentes').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Compartilhar Projeto preservado\"]'))"), 'trash-restored source returns to recent list')

  const blankCloudName = 'Design em branco para restaurar na nuvem'
  const blankCloud = await api('/api/documents', { method: 'POST', cookie, body: { name: blankCloudName, data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'blank-cloud-page', name: 'Página 1', background: '#ffffff', elements: [] }] } } })
  assert.equal(blankCloud.status, 201)
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'library after cloud blank seed')
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Neste dispositivo').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Neste dispositivo'"), 'local mode before refreshing cloud blank design')
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Compartilhar ${blankCloudName}"]'))`), 'blank cloud design in recent projects')
  await evaluate(`document.querySelector('[aria-label="Mover ${blankCloudName} para a lixeira"]').click()`)
  await waitFor(async () => (await api(`/api/documents/${blankCloud.payload.id}`, { cookie })).payload.data.trashedAt, 'blank cloud design moved to trash')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Lixeira').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Restaurar ${blankCloudName} da lixeira"]'))`), 'blank cloud design in trash')
  await evaluate(`document.querySelector('[aria-label="Restaurar ${blankCloudName} da lixeira"]').click()`)
  const restoredBlankCloud = await waitFor(async () => { const result = await api(`/api/documents/${blankCloud.payload.id}`, { cookie }); return result.status === 200 && !result.payload.data.trashedAt ? result.payload : null }, 'blank cloud design restored')
  assert.equal(restoredBlankCloud.name, blankCloudName)
  assert.deepEqual(restoredBlankCloud.data.pages, blankCloud.payload.data.pages, 'blank cloud page contents survive trash restore')
  await waitFor(() => evaluate(`!document.querySelector('[aria-label="Restaurar ${blankCloudName} da lixeira"]')`), 'blank cloud design leaves trash')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Recentes').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Abrir ${blankCloudName}"]'))`), 'restored blank cloud design is in library')
  await evaluate(`document.querySelector('[aria-label="Abrir ${blankCloudName}"]').click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.studio-app'))"), 'restored blank cloud editor opens')
  assert.equal(await evaluate(`location.pathname==='/design/${encodeURIComponent(blankCloud.payload.id)}/edit'&&new URLSearchParams(location.search).get('storage')==='cloud'`), true, 'cloud restore retains the same editor URL and identity')
  assert.equal(await evaluate(`document.querySelector('.document-title input')?.value===${JSON.stringify(blankCloudName)}`), true, 'restored cloud editor displays its preserved name')
  await evaluate("document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'return to library after cloud restore route check')

  const localBlank = { id: 'rea-local-blank-trash-restore', name: 'Design em branco local para restaurar', type: 'design', width: 794, height: 1123, updatedAt: new Date().toISOString(), pages: [{ id: 'rea-local-blank-page', name: 'Página 1', background: '#ffffff', elements: [] }] }
  await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio',5);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(localBlank)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()})()`)
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Neste dispositivo').click()")
  await send('Page.navigate', { url: webOrigin })
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'library reload after local blank seed')
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Neste dispositivo'"), 'local library with blank design')
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Abrir ${localBlank.name}"]'))`), 'blank local design appears in library')
  await evaluate(`document.querySelector('[aria-label="Mover ${localBlank.name} para a lixeira"]').click()`)
  const getLocalBlank = () => evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(localBlank.id)});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})})()`)
  await waitFor(async () => Boolean((await getLocalBlank())?.trashedAt), 'blank local design moved to trash')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Lixeira').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Restaurar ${localBlank.name} da lixeira"]'))`), 'blank local design in trash')
  await evaluate(`document.querySelector('[aria-label="Restaurar ${localBlank.name} da lixeira"]').click()`)
  const restoredBlankLocal = await waitFor(async () => { const doc = await getLocalBlank(); return doc && !doc.trashedAt ? doc : null }, 'blank local design restored')
  assert.equal(restoredBlankLocal.name, localBlank.name)
  assert.deepEqual(restoredBlankLocal.pages, localBlank.pages, 'blank local page contents survive trash restore')
  await waitFor(() => evaluate(`!document.querySelector('[aria-label="Restaurar ${localBlank.name} da lixeira"]')`), 'blank local design leaves trash')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Recentes').click()")
  await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="Abrir ${localBlank.name}"]'))`), 'restored blank local design is in library')
  await evaluate(`document.querySelector('[aria-label="Abrir ${localBlank.name}"]').click()`)
  await waitFor(() => evaluate("Boolean(document.querySelector('.studio-app'))"), 'restored blank local editor opens')
  assert.equal(await evaluate(`location.pathname==='/design/${encodeURIComponent(localBlank.id)}/edit'&&!new URLSearchParams(location.search).has('storage')`), true, 'local restore retains the same editor URL and identity')
  assert.equal(await evaluate(`document.querySelector('.document-title input')?.value===${JSON.stringify(localBlank.name)}`), true, 'restored local editor displays its preserved name')
  await evaluate("document.querySelector('.topbar button[aria-label=\"Salvar e voltar aos projetos\"]')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'return to library after local restore route check')
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'return to cloud library after local restore')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Recentes').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Mover Projeto preservado para a lixeira\"]'))"), 'cloud source restored to recent list')
  await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').delete(${JSON.stringify(localBlank.id)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()})()`)

  if (process.env.FUSE_TRASH_RESTORE_ONLY !== '1') {
  await evaluate("document.querySelector('[aria-label=\"Mover Projeto preservado para a lixeira\"]').click()")
  await waitFor(async () => (await api(`/api/documents/${created.payload.id}`, { cookie })).payload.data.trashedAt, 'source moved back to trash before permanent deletion')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Lixeira').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Excluir Projeto preservado permanentemente\"]'))"), 'permanent delete action shown in trash')
  await evaluate("document.querySelector('[aria-label=\"Excluir Projeto preservado permanentemente\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[role=\"alertdialog\"]'))"), 'permanent deletion confirmation dialog')
  await evaluate("[...document.querySelectorAll('[role=\"alertdialog\"] button')].find(button=>button.textContent.trim()==='Excluir permanentemente').click()")
  await waitFor(async () => (await api(`/api/documents/${created.payload.id}`, { cookie })).status === 404, 'permanent deletion committed')
  await waitFor(() => evaluate("!document.querySelector('[role=\"alertdialog\"]')"), 'confirmation closes after deletion')
  await waitFor(async () => (await api(`/api/documents/${projectCopy.id}/media`, { cookie })).payload.assets.some(asset => asset.id === 'archive-logo-asset'), 'copied media survives deletion of source project')
  await waitFor(() => evaluate("!document.querySelector('[aria-label=\"Excluir Projeto preservado permanentemente\"]')"), 'deleted project leaves trash list')
  const bulkTrashDocuments = []
  for (const name of ['Lixeira em lote A', 'Lixeira em lote B']) {
    const item = await api('/api/documents', { method: 'POST', cookie, body: { name, data: { type: 'design', width: 320, height: 240, pages: [{ id: `${name}-page`, elements: [] }] } } })
    assert.equal(item.status, 201)
    const moved = await api(`/api/documents/${item.payload.id}`, { method: 'PUT', cookie, body: { revision: 1, name, data: { ...item.payload.data, trashedAt: new Date().toISOString() } } })
    assert.equal(moved.status, 200)
    bulkTrashDocuments.push(item.payload.id)
  }
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'cloud library refreshed before batch empty')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Lixeira').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Excluir Lixeira em lote A permanentemente\"]')) && Boolean(document.querySelector('[aria-label=\"Excluir Lixeira em lote B permanentemente\"]'))"), 'multiple projects visible in trash')
  await evaluate("document.querySelector('.empty-trash-button').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-labelledby=\"empty-trash-title\"]'))"), 'empty-trash confirmation dialog')
  await evaluate("[...document.querySelectorAll('[aria-labelledby=\"empty-trash-title\"] button')].find(button=>button.textContent.trim()==='Esvaziar lixeira').click()")
  await waitFor(async () => (await Promise.all(bulkTrashDocuments.map(id => api(`/api/documents/${id}`, { cookie })))).every(result => result.status === 404), 'batch trash deletion committed')
  await waitFor(() => evaluate("!document.querySelector('[aria-labelledby=\"empty-trash-title\"]') && document.querySelector('.home-empty h2')?.textContent.includes('Lixeira vazia')"), 'empty state after clearing trash')
  const sessionProject = await api('/api/documents', { method: 'POST', cookie, body: { name: 'Projeto com editor aberto', data: { type: 'design', width: 320, height: 240, pages: [{ id: 'open-session-page', elements: [] }] } } })
  assert.equal(sessionProject.status, 201)
  const sessionTrashed = await api(`/api/documents/${sessionProject.payload.id}`, { method: 'PUT', cookie, body: { revision: 1, name: sessionProject.payload.name, data: { ...sessionProject.payload.data, trashedAt: new Date().toISOString() } } })
  assert.equal(sessionTrashed.status, 200)
  await evaluate("[...document.querySelectorAll('.library-mode-tabs button')].find(button=>button.textContent.trim()==='Nuvem').click()")
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Nuvem'"), 'cloud library refreshed before opening editor')
  await evaluate("[...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Lixeira').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Projeto com editor aberto\"]'))"), 'trashed project can be opened for recovery')
  await evaluate("document.querySelector('[aria-label=\"Abrir Projeto com editor aberto\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.realtime-presence.connected'))"), 'live document collaboration connected')
  const removedSession = await api(`/api/documents/${sessionProject.payload.id}`, { method: 'DELETE', cookie, body: { revision: 2 } })
  assert.equal(removedSession.status, 200)
  await waitFor(() => evaluate("Boolean(document.querySelector('.permission-notice')?.textContent.includes('excluído permanentemente') && document.querySelector('.realtime-presence.offline'))"), 'open editor stops reconnecting after the document is deleted')
  await evaluate("document.querySelector('.permission-copy').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.library-mode-tabs'))"), 'deleted session can be preserved as a local copy')
  await waitFor(() => evaluate("document.querySelector('.library-mode-tabs button.chosen')?.textContent.trim()==='Neste dispositivo' && [...document.querySelectorAll('.project-filters button')].find(button=>button.textContent.trim()==='Recentes')?.classList.contains('chosen')"), 'recovery returns to the local recent projects view')
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\"Abrir Projeto com editor aberto — cópia local\"]'))"), 'local recovery copy appears in the device library')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const mobile = await evaluate("({viewport:innerWidth,rootWidth:document.documentElement.scrollWidth,filters:document.querySelector('.project-filters')?.getBoundingClientRect().width,actions:document.querySelector('.project-card-actions')?.getBoundingClientRect().width})")
  assert.ok(mobile.viewport === 390 && mobile.rootWidth <= 390 && mobile.filters <= 390, `archive filters fit mobile viewport: ${JSON.stringify(mobile)}`)
  }
  console.log(process.env.FUSE_TRASH_RESTORE_ONLY === '1'
    ? 'PASS blank cloud/local design trash restore, library visibility, content and editor route identity'
    : 'PASS cloud archive, trash, restore, nonempty copy, permanent deletion, atomic empty trash, deleted-session recovery, shared media retention, version persistence, preserved content, and 390px layout')
} finally {
  pageSocket?.close(); browserSocket?.close()
  await stop(chrome)
  if (vite) await vite.close()
  await new Promise(resolve => apiServer.close(resolve))
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 9) console.warn(`Temporary Chrome profile cleanup deferred: ${error.message}`); else await delay(200) }
  }
}
