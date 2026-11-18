import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Chrome/Edge is required; set CHROME_PATH')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }

const chosenPorts = new Set()
async function uniquePort() { let value; do { value = await freePort() } while (chosenPorts.has(value)); chosenPorts.add(value); return value }
const vitePort = await uniquePort(), apiPort = await uniquePort(), chromePort = await uniquePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-account-recovery-'))
const appUrl = `http://127.0.0.1:${vitePort}/`
let resetEmail
const api = createAppServer({ databasePath: path.join(profile, 'recovery.sqlite'), allowedOrigins: [appUrl.slice(0, -1)], passwordResetEmailSender: async message => { resetEmail = message; return { status: 'sent' } } })
await new Promise(resolve => api.listen(apiPort, '127.0.0.1', resolve))
const registered = await fetch(`http://127.0.0.1:${apiPort}/api/auth/register`, { method: 'POST', headers: { origin: appUrl.slice(0, -1), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Recovery Browser', email: 'recovery-browser@example.test', password: 'initial-password-123' }) })
if (!registered.ok) throw new Error(`Fixture account setup failed: ${registered.status}`)
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, env: { ...process.env, STUDIO_API_PORT: String(apiPort) }, windowsHide: true, stdio: 'ignore' })
const browserProfile = await mkdtemp(path.join(os.tmpdir(), 'fuse-account-recovery-chrome-'))
const browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${browserProfile}`, '--window-size=390,844', appUrl], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  await waitFor(async () => (await fetch(appUrl).catch(() => null))?.ok, 'Vite')
  await waitFor(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/health`).catch(() => null))?.ok, 'API')
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/list`).catch(() => ({ json: async () => [] }))).json().then(items => items.find(item => item.type === 'page' && item.url.startsWith(appUrl))), 'Chrome page')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await waitFor(() => evaluate("!!document.querySelector('.home-signin') && !document.querySelector('.home-loading')"), 'home screen')
  await evaluate("document.querySelector('.home-signin').click()")
  await waitFor(() => evaluate("!!document.querySelector('.auth-dialog')"), 'login dialog')
  await evaluate("[...document.querySelectorAll('.auth-dialog button')].find(button=>button.textContent.includes('Esqueci minha senha')).click()")
  await waitFor(() => evaluate("document.querySelector('#auth-title')?.textContent==='Redefinir senha'"), 'request-reset mode')
  await evaluate("(()=>{const form=document.querySelector('.auth-dialog form');form.elements.email.value='recovery-browser@example.test';form.elements.email.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit()})()")
  await waitFor(() => evaluate("document.querySelector('#auth-title')?.textContent==='Verifique seu e-mail'"), 'generic reset confirmation')
  assert.ok(resetEmail?.token, 'the fake provider should receive the one-time token')
  const mobileLayout = await evaluate("({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,dialog:(()=>{const r=document.querySelector('.auth-dialog').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})()})")
  assert.ok(mobileLayout.dialog.left >= 0 && mobileLayout.dialog.right <= mobileLayout.viewport, `mobile auth modal fits the viewport: ${JSON.stringify(mobileLayout)}`)
  await evaluate(`location.href=${JSON.stringify(`${appUrl}?resetPassword=${encodeURIComponent(resetEmail.token)}`)}`)
  await waitFor(() => evaluate("document.querySelector('#auth-title')?.textContent==='Escolha uma nova senha'"), 'reset link opens password form')
  await evaluate("(()=>{const form=document.querySelector('.auth-dialog form');form.elements.password.value='mobile-recovery-password-456';form.elements.password.dispatchEvent(new Event('input',{bubbles:true}));form.elements['password-confirmation'].value='mobile-recovery-password-456';form.elements['password-confirmation'].dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit()})()")
  await waitFor(() => evaluate("document.querySelector('#auth-title')?.textContent==='Entre na sua conta' && document.querySelector('.auth-reset-notice')?.textContent.includes('Senha redefinida')"), 'password reset confirmation')
  await evaluate("(()=>{const form=document.querySelector('.auth-dialog form');form.elements.email.value='recovery-browser@example.test';form.elements.email.dispatchEvent(new Event('input',{bubbles:true}));form.elements.password.value='mobile-recovery-password-456';form.elements.password.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit()})()")
  await waitFor(() => evaluate("!!document.querySelector('.home-account')"), 'login with new password')
  assert.equal(await evaluate('location.search'), '', 'successful password reset consumes the reset URL token')
  console.log('PASS mobile account recovery: generic request, injected email, token route, new password, login and 390px layout')
} finally {
  socket?.close()
  for (const child of [browser, vite]) if (child?.pid && child.exitCode === null && child.signalCode === null) { if (process.platform === 'win32') { try { const { execFileSync } = await import('node:child_process'); execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM') }
  await new Promise(resolve => api.close(() => resolve()))
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
  await rm(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
}
