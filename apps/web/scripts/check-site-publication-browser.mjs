import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/index.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
async function findChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH to run Site publication UI checks.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { const { execFileSync } = await import('node:child_process'); try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 2500); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const chromePath = await findChrome()
const vitePort = await freePort(), apiPort = await freePort(), cdpPort = await freePort()
const origin = `http://127.0.0.1:${vitePort}`
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-site-publication-browser-'))
const fakeProviderCalls = []
let rejectFirstPublish = true
const api = createAppServer({
  databasePath: ':memory:', allowedOrigins: [origin], externalProviderEnv: {},
  externalProviderFetch: async () => { throw new Error('browser tests must never make external provider requests') },
  sitePublisher: { publish: async request => { fakeProviderCalls.push(request); if (rejectFirstPublish) { rejectFirstPublish = false; throw new Error('fake provider outage') } return { url: `https://published.example.test/${request.slug}`, deploymentId: 'fake-deployment-001' } } },
})
let vite, chrome, browserSocket, pageSocket
try {
  await new Promise((resolve, reject) => api.listen(apiPort, '127.0.0.1', resolve).once('error', reject))
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, env: { ...process.env, STUDIO_API_PORT: String(apiPort) }, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')

  const registerResponse = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Site Publisher Test', email: 'site-publisher@example.test', password: 'fake-provider-password' }) })
  assert.equal(registerResponse.status, 201, 'test account is created locally')
  const loginResponse = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'site-publisher@example.test', password: 'fake-provider-password' }) })
  assert.equal(loginResponse.status, 200, 'test account signs in locally')
  const sessionCookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
  assert.ok(sessionCookie?.startsWith('fuse_session='), 'local API returns an app session cookie')
  const siteDocument = { id: 'site-publication-browser', name: 'Lançamento da Marca', type: 'site', width: 1366, height: 768, updatedAt: new Date().toISOString(), pages: [
    { id: 'public-home', name: 'Início', background: '#ffffff', elements: [], presenterNotes: 'notes must not be published' },
    { id: 'hidden-draft', name: 'Rascunho oculto', background: '#ffffff', hidden: true, elements: [{ id: 'private-copy', type: 'text', name: 'Private copy', text: 'not public', x: 1, y: 1, width: 20, height: 20, rotation: 0, fontSize: 12, fontFamily: 'Arial', color: '#111111', bold: false }] },
  ] }
  const createSite = await fetch(`${origin}/api/documents`, { method: 'POST', headers: { origin, cookie: sessionCookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: siteDocument.name, data: siteDocument }) })
  assert.equal(createSite.status, 201, 'cloud Site fixture is created locally')
  const savedSite = await createSite.json()
  const documentId = savedSite.id ?? savedSite.document?.id
  assert.ok(documentId, 'cloud Site has a document ID')

  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === 'about:blank'), 'browser page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }

  await send('Network.enable')
  await send('Network.setCookie', { name: 'fuse_session', value: sessionCookie.slice('fuse_session='.length), url: origin, sameSite: 'Lax' })
  await send('Page.navigate', { url: `${origin}/design/${encodeURIComponent(documentId)}/edit?storage=cloud` })
  await waitFor(() => evaluate("!!document.querySelector('.site-publish-open') && !document.querySelector('.site-publish-open').disabled"), 'owner Site editor publication action')
  await evaluate("document.querySelector('.site-publish-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.site-publish-dialog')"), 'publication dialog')
  await waitFor(() => evaluate("!!document.querySelector('.site-publish-provider.ready')"), 'configured provider status', 8000).catch(async error => { console.error('Publication dialog state:', await evaluate("document.querySelector('.site-publish-dialog')?.innerText")); throw error })
  assert.equal(await evaluate("document.querySelector('.site-publish-dialog input[aria-label=\"Identificador do site\"]')?.value"), 'lancamento-da-marca', 'slug defaults from the Site title')
  const setSlug = async value => evaluate(`(()=>{const input=document.querySelector('.site-publish-dialog input[aria-label="Identificador do site"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return input.value})()`)
  await setSlug('Launch-2026')
  assert.equal(await evaluate("document.querySelector('.site-publish-dialog footer .primary-button')?.disabled"), false, 'configured provider and valid slug enable the next step')
  assert.equal(fakeProviderCalls.length, 0, 'opening/editing the dialog does not publish')
  await evaluate("document.querySelector('.site-publish-dialog footer .primary-button').click()")
  await waitFor(() => evaluate("document.querySelector('.site-publish-dialog h2')?.textContent==='Confirmar publicação'"), 'explicit publication confirmation')
  assert.equal(fakeProviderCalls.length, 0, 'the explicit confirmation screen does not publish by itself')
  assert.equal(await evaluate("document.querySelector('.site-publish-dialog footer button.primary-button')?.textContent"), 'Confirmar e publicar', 'final POST requires a second explicit action')
  await evaluate("document.querySelector('.site-publish-dialog footer button.primary-button').click()")
  await waitFor(() => evaluate("!!document.querySelector('.site-publish-error[role=alert]')"), 'provider failure feedback')
  assert.equal(await evaluate("document.querySelector('.site-publish-dialog h2')?.textContent==='Confirmar publicação'"), true, 'failed publication remains on the explicit confirmation step')
  assert.equal(await evaluate("document.querySelector('.site-publish-deployment')===null"), true, 'failed first deployment does not create a published state')
  assert.equal(await evaluate("document.querySelector('.site-publish-dialog footer button.primary-button')?.disabled"), false, 'the user can retry after a provider error')
  await evaluate("document.querySelector('.site-publish-dialog footer button.primary-button').click()")
  await waitFor(() => evaluate("document.querySelector('.site-publish-deployment a')?.href==='https://published.example.test/launch-2026'"), 'fake provider publication result')
  assert.equal(fakeProviderCalls.length, 2, 'one failed request and one explicit retry reach the injected provider')
  assert.equal(fakeProviderCalls[0].documentId, documentId)
  assert.equal(fakeProviderCalls[0].slug, 'launch-2026', 'slug is normalized before provider handoff')
  assert.equal(fakeProviderCalls[0].site.pages.length, 1, 'hidden sections are excluded by the server boundary')
  assert.equal(Object.hasOwn(fakeProviderCalls[0].site.pages[0], 'presenterNotes'), false, 'presenter notes are excluded by the server boundary')
  assert.equal(await evaluate("[...document.querySelectorAll('.site-publish-deployment small')].some(node=>node.textContent.includes('fake-deployment-001'))"), true, 'deployment ID is visible in saved publication state')
  assert.equal(await evaluate("!!document.querySelector('.site-publish-deployment:not(.stale)')"), true, 'fresh publication is marked current')

  const editedSiteData = structuredClone(savedSite.data)
  editedSiteData.pages[0].name = 'Home updated after publication'
  const editSite = await fetch(`${origin}/api/documents/${encodeURIComponent(documentId)}`, { method: 'PUT', headers: { origin, cookie: sessionCookie, 'content-type': 'application/json' }, body: JSON.stringify({ revision: 1, name: savedSite.name, data: editedSiteData }) })
  assert.equal(editSite.status, 200, 'local API fixture advances the Site revision without a provider call')
  await send('Page.reload', { ignoreCache: true })
  await waitFor(() => evaluate("!!document.querySelector('.site-publish-open') && !document.querySelector('.site-publish-open').disabled"), 'owner Site editor restored after reload')
  await evaluate("document.querySelector('.site-publish-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.site-publish-deployment.stale')"), 'saved publication and stale-draft status restored after reload')
  assert.equal(await evaluate("document.querySelector('.site-publish-deployment a')?.href==='https://published.example.test/launch-2026'"), true, 'published URL survives a full editor reload')
  assert.equal(await evaluate("[...document.querySelectorAll('.site-publish-deployment small')].some(node=>node.textContent.includes('fake-deployment-001'))"), true, 'deployment ID survives a full editor reload')
  assert.equal(await evaluate("document.querySelector('.site-publish-stale')?.textContent.includes('Publique novamente')"), true, 'newer Site revision is clearly marked as a stale draft')
  assert.equal(await evaluate("document.querySelector('.site-publish-dialog footer .primary-button')?.textContent"), 'Publicar alterações', 'the stale state offers explicit republishing')
  assert.equal(fakeProviderCalls.length, 2, 'opening/reloading/reading stale state never triggers another provider call')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate("[...document.querySelectorAll('.site-publish-dialog > footer button')].every(button=>Math.round(button.getBoundingClientRect().height)>=44)"), true, 'mobile publication actions meet the 44px touch target')
  console.log('PASS Site publication UI: provider failure is announced and retryable; fake-provider publish requires explicit confirmation; URL/ID survive reload, stale revision is shown, no implicit republish or external network')
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  await new Promise(resolve => api.close(() => resolve()))
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-site-publication-browser-')) for (let attempt = 0; attempt < 10; attempt += 1) { try { await rm(resolvedProfile, { recursive: true, force: true }); break } catch { await delay(100) } }
}
