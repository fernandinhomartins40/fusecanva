import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// Gap probe for Site domain publication, separate from the audited team-domain draft lifecycle. The current Sites
// editor only supports local preview; this test records that boundary instead
// of inventing a domain dialog or pretending a draft was persisted/reset.
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the Sites domain-publication browser probe')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-domain-draft-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  const origin = `http://127.0.0.1:${vitePort}`
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', origin], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'CDP startup')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url === `${origin}/`), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0; const pending = new Map(); pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const result = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }

  await waitFor(() => evaluate("document.querySelector('.home-category-row button') && !document.querySelector('.home-loading')"), 'home ready')
  await evaluate("[...document.querySelectorAll('.home-category-row button')].find(button=>button.textContent.trim()==='Site').click()")
  await waitFor(() => evaluate("!!document.querySelector('.site-preview-open') && !!document.querySelector('[aria-label=\"Nome do site\"]')"), 'Sites editor')
  const siteControls = await evaluate("[...document.querySelectorAll('button,[role=button],a,input,label')].map(node=>({text:(node.innerText||node.getAttribute('aria-label')||node.getAttribute('placeholder')||'').trim(),title:node.getAttribute('title')||''})).filter(item=>/dom[ií]nio|domain|publicar|publish/i.test(item.text+' '+item.title))")
  assert.deepEqual(siteControls, [], 'Sites editor exposes no domain configuration control to exercise')
  assert.equal(await evaluate("document.querySelector('.site-preview-open').textContent.trim()"), 'Pré-visualizar site', 'the available Sites action is local preview, not domain configuration')
  await evaluate("document.querySelector('.site-preview-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.site-preview-dialog')"), 'local site preview')
  const implementationNotice = await evaluate("document.querySelector('.site-preview-dialog').innerText.includes('Publicação e domínio externos ainda não estão conectados')")
  assert.equal(implementationNotice, true, 'Sites preview explicitly reports domain/publication as not connected')
  await evaluate("document.querySelector('.site-preview-close').click()")
  assert.equal(await evaluate("!document.querySelector('.site-preview-dialog')"), true, 'local preview can be dismissed')
  await evaluate("document.querySelector('.site-preview-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.site-preview-dialog')"), 'preview reopen')
  assert.equal(await evaluate("document.querySelector('.site-preview-dialog').innerText.includes('Publicação e domínio externos ainda não estão conectados')"), true, 'reopening local preview does not expose domain draft UI')
  console.log(JSON.stringify({ pass: true, case: 'site-domain-publication-gap', status: 'gap-confirmed', evidence: { domainControls: siteControls.length, implementationNotice, availableAction: 'Pré-visualizar site', previewCloseReopen: true }, limitation: 'Cannot test domain open/edit/close/reopen/reset lifecycle because the Sites editor has no domain configuration or draft UI; no domain was submitted.' }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  for (let attempt = 0; attempt < 5; attempt++) { try { await rm(profile, { recursive: true, force: true }); break } catch { if (attempt < 4) await delay(250) } }
}

