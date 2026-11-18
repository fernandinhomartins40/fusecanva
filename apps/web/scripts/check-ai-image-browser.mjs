import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/index.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run AI image browser test')

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
  else child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

const vitePort = await freePort()
let apiPort = await freePort()
while (apiPort === vitePort) apiPort = await freePort()
let cdpPort = await freePort()
while ([vitePort, apiPort].includes(cdpPort)) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-ai-image-browser-'))
let vite; let chrome; let api; let browserSocket; let pageSocket
try {
  api = createAppServer({ databasePath: ':memory:', allowedOrigins: [`http://127.0.0.1:${vitePort}`], secureCookies: false, imageGenerator: { mode: 'sandbox', generate: async _prompt => ({ mimeType: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#7865db"/><circle cx="256" cy="256" r="120" fill="#fff"/></svg>').toString('base64')}`, width: 512, height: 512, mode: 'sandbox' }) } })
  await new Promise(resolve => api.listen(apiPort, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${vitePort}`
  const authHeaders = { origin: `http://127.0.0.1:${vitePort}`, 'content-type': 'application/json' }
  const accountResponse = await fetch(`http://127.0.0.1:${apiPort}/api/auth/register`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Image Browser', email: 'ai-image-browser@example.test', password: 'test-password-123' }) })
  assert.equal(accountResponse.status, 201)
  const loginResponse = await fetch(`http://127.0.0.1:${apiPort}/api/auth/login`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ email: 'ai-image-browser@example.test', password: 'test-password-123' }) })
  assert.equal(loginResponse.status, 200)
  const session = loginResponse.headers.get('set-cookie')?.split(';')[0]
  const sessionValue = session?.split('=').slice(1).join('=')
  assert.ok(sessionValue)
  const documentResponse = await fetch(`http://127.0.0.1:${apiPort}/api/documents`, { method: 'POST', headers: { origin, cookie: session, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'AI image browser project', data: { type: 'design', width: 794, height: 1123, pages: [{ id: 'ai-image-page', name: 'Page 1', elements: [] }] } }) })
  assert.equal(documentResponse.status, 201)
  const documentId = (await documentResponse.json()).id

  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore', env: { ...process.env, STUDIO_API_PORT: String(apiPort) } })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', origin], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'CDP startup')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === origin + '/'), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const result = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  await send('Network.enable')
  const cookieResult = await send('Network.setCookie', { name: session.split('=')[0], value: sessionValue, url: origin, httpOnly: true, sameSite: 'Lax' })
  assert.equal(cookieResult.result?.success, true, 'CDP should install the authenticated test session cookie')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home')
  assert.equal(await evaluate("fetch('/api/auth/me').then(response=>response.json()).then(payload=>payload.user?.email==='ai-image-browser@example.test')"), true, 'the browser should load the seeded account session')
  await evaluate("document.querySelector('.library-mode-tabs button:nth-child(2)').click()")
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Abrir AI image browser project\"]')"), 'cloud project')
  await evaluate("document.querySelector('[aria-label=\"Abrir AI image browser project\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('.inspector-panel')"), 'cloud editor')
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Gerar imagem')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('#ai-image-prompt')"), 'image generation dialog')
  await evaluate("(()=>{const input=document.querySelector('#ai-image-prompt');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'uma capa abstrata');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await evaluate("document.querySelector('.ai-image-dialog form').requestSubmit()")
  await waitFor(() => evaluate("!!document.querySelector('.ai-image-preview img') && document.querySelector('.ai-image-preview').textContent.includes('Sandbox determinístico')"), 'sandbox image preview')
  assert.equal(await evaluate("document.querySelector('.ai-image-preview img').naturalWidth"), 512)
  await evaluate("[...document.querySelectorAll('.ai-image-preview button')].find(button=>button.textContent.includes('Inserir no projeto')).click()")
  const stored = await waitFor(async () => {
    const result = await fetch(`http://127.0.0.1:${apiPort}/api/documents/${documentId}`, { headers: { origin, cookie: session } }).then(response => response.json())
    return result.data?.pages?.[0]?.elements?.some(element => element.type === 'image') ? result : null
  }, 'persisted generated image')
  assert.equal(stored.data.pages[0].elements.filter(element => element.type === 'image').length, 1)
  assert.match(stored.data.pages[0].elements.find(element => element.type === 'image').src, /^data:image\/svg\+xml;base64,/)
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Gerar imagem')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.ai-image-dialog')"), 'Dream Lab dialog')
  await evaluate("[...document.querySelectorAll('.ai-image-mode-tabs button')].find(button=>button.textContent.trim()==='Dream Lab').click()")
  await evaluate("(()=>{const input=document.querySelector('#dream-lab-prompt');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'uma arte para ampliar');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await evaluate("document.querySelector('.dream-lab form').requestSubmit()")
  await waitFor(() => evaluate("!!document.querySelector('.dream-lab-result img')"), 'Dream Lab generated image')
  assert.equal(await evaluate("document.querySelector('.dream-lab-result img').naturalWidth"), 512, 'Dream Lab preview should begin at the source dimensions')
  await evaluate("[...document.querySelectorAll('.dream-lab-actions button')].find(button=>button.textContent.includes('Ampliar'))?.click()")
  const upscaleState = await waitFor(() => evaluate("(()=>{const error=document.querySelector('.dream-lab [role=alert]')?.textContent;const label=document.querySelector('.dream-lab-result > p')?.textContent;return error||label?.includes('1024')?{error,label,button:document.querySelector('.dream-lab-actions button')?.textContent,disabled:document.querySelector('.dream-lab-actions button')?.disabled}:null})()"), 'Dream Lab local upscale result')
  assert.equal(upscaleState.error, undefined, `upscale should finish without error: ${JSON.stringify(upscaleState)}`)
  assert.equal(await evaluate("document.querySelector('.dream-lab-result img').naturalWidth"), 1024, 'upscale should replace SVG with a 1024px raster output')
  await evaluate("[...document.querySelectorAll('.dream-lab-actions button')].find(button=>button.textContent.includes('Inserir no projeto')).click()")
  const withDreamLab = await waitFor(async () => {
    const result = await fetch(`http://127.0.0.1:${apiPort}/api/documents/${documentId}`, { headers: { origin, cookie: session } }).then(response => response.json())
    return result.data?.pages?.[0]?.elements?.filter(element => element.type === 'image').length === 2 ? result : null
  }, 'persisted Dream Lab image')
  assert.ok(withDreamLab.data.pages[0].elements.some(element => element.type === 'image' && /^data:image\/png;base64,/.test(element.src)), 'upscaled Dream Lab result should persist as a PNG image element')
  console.log(JSON.stringify({ pass: true, flows: ['authenticated cloud prompt → sandbox preview → explicit insert → persisted image element', 'Dream Lab generation → local canvas upscale 512px→1024px → explicit insert → persisted PNG image element'], documentId, mode: 'sandbox', externalCalls: 0 }))
} finally {
  pageSocket?.close(); browserSocket?.close()
  await stop(chrome); await stop(vite)
  if (api) await new Promise(resolve => api.close(resolve))
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(profile, { recursive: true, force: true }); break }
    catch { if (attempt < 4) await delay(250) }
  }
}
