import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createAppServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of candidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Chrome/Edge is required; set CHROME_PATH')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; let lastError; while (Date.now() < end) { try { const value = await check(); if (value) return value; lastError = undefined } catch (error) { lastError = error } await delay(100) } throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]) }

const webPort = await freePort(); let apiPort = await freePort(); while (apiPort === webPort) apiPort = await freePort(); let cdpPort = await freePort(); while ([webPort, apiPort].includes(cdpPort)) cdpPort = await freePort()
const origin = `http://127.0.0.1:${webPort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-sse-bfcache-'))
let api; let vite; let chrome; let socket
try {
  api = createAppServer({ databasePath: ':memory:', allowedOrigins: [origin], secureCookies: false, invitationEmailSender: async () => ({ status: 'link-only', reason: 'browser-test' }) })
  const serverStreams = new Map(); let nextStream = 0
  api.on('request', (request, response) => {
    if (request.method !== 'GET' || !/^\/api\/(?:team-events|teams\/[^/]+\/events)$/.test(request.url ?? '')) return
    const id = ++nextStream
    serverStreams.set(id, `${origin}${request.url}`)
    response.once('close', () => serverStreams.delete(id))
  })
  await new Promise(resolve => api.listen(apiPort, '127.0.0.1', resolve))
  const headers = { origin, 'content-type': 'application/json' }
  async function request(url, { method = 'GET', cookie, body } = {}) { const response = await fetch(`http://127.0.0.1:${apiPort}${url}`, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, payload: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] } }
  async function account(name, email) { assert.equal((await request('/api/auth/register', { method: 'POST', body: { name, email, password: 'bfcache-test-password' } })).response.status, 201); const login = await request('/api/auth/login', { method: 'POST', body: { email, password: 'bfcache-test-password' } }); assert.equal(login.response.status, 200); return login.cookie }
  const admin = await account('Cache admin', 'cache-admin@example.test')
  const memberEmail = 'cache-member@example.test'
  const member = await account('Cache member', memberEmail)
  const memberId = (await request('/api/auth/me', { cookie: member })).payload.user.id
  const team = (await request('/api/teams', { method: 'POST', cookie: admin, body: { name: 'Cache team' } })).payload.team
  const invite = (await request(`/api/teams/${team.id}/invitations`, { method: 'POST', cookie: admin, body: { email: memberEmail } })).payload.invitation
  assert.equal((await request(`/api/team-invitations/${invite.token}`, { method: 'POST', cookie: member })).response.status, 200)
  vite = await createViteServer({ root, configFile: false, plugins: [react()], logLevel: 'error', server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } } } })
  await vite.listen()
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--enable-features=BackForwardCache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.ok, 'Chrome DevTools')
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page'), 'page target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0; const pending = new Map(); const activeStreams = new Map(); const failures = []
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Network.responseReceived' && message.params.type === 'EventSource' && message.params.response.status === 200) activeStreams.set(message.params.requestId, message.params.response.url); if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') activeStreams.delete(message.params.requestId); if (message.method === 'Page.backForwardCacheNotUsed') failures.push(message.params); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++nextId; let timer; const response = new Promise((resolve, reject) => { pending.set(id, resolve); timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)) }, 15000) }); socket.send(JSON.stringify({ id, method, params })); const result = await response.finally(() => clearTimeout(timer)); if (result.error) throw new Error(`${method}: ${result.error.message}`); return result.result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
  await send('Page.enable'); await send('Network.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__cacheToken=String(Math.random());window.__cacheShows=[];window.addEventListener('pageshow',event=>window.__cacheShows.push({persisted:event.persisted}));" })
  const [cookieName, ...cookieValue] = member.split('=')
  assert.equal((await send('Network.setCookie', { name: cookieName, value: cookieValue.join('='), url: origin, httpOnly: true, sameSite: 'Lax' })).success, true)
  await send('Page.navigate', { url: `${origin}/settings/people?team=${team.id}` })
  await waitFor(() => evaluate("!!document.querySelector('.team-roster-table') && !!document.querySelector('[aria-label=\"Designer de marca de Cache member\"]')"), 'People route')
  const userUrl = `${origin}/api/team-events`; const teamUrl = `${origin}/api/teams/${team.id}/events`
  const active = url => [...serverStreams].filter(([, value]) => value === url).map(([id]) => id)
  await waitFor(() => active(userUrl).length === 1 && active(teamUrl).length === 1, 'People streams')
  const peopleToken = await evaluate('window.__cacheToken')
  const oldPeopleStreams = [...active(userUrl), ...active(teamUrl)]
  await evaluate("document.querySelector('.people-settings-nav a[href^=\"/settings/groups\"]').click()")
  await waitFor(() => evaluate("location.pathname==='/settings/groups' && !!document.querySelector('.team-groups-panel')"), 'Groups route')
  await waitFor(() => oldPeopleStreams.every(id => !serverStreams.has(id)) && active(userUrl).length === 0 && active(teamUrl).length === 1, 'People streams close on navigation').catch(error => { console.error('Stream diagnostics', { oldPeopleStreams, server: [...serverStreams], cdp: [...activeStreams], failures }); throw error })
  const groupsToken = await evaluate('window.__cacheToken')
  assert.notEqual(groupsToken, peopleToken)
  assert.equal((await request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin, body: { userId: memberId, brandDesigner: true } })).response.status, 200)
  const oldGroupStreams = active(teamUrl)
  await evaluate('history.back()')
  await waitFor(() => evaluate("location.pathname==='/settings/people' && !!document.querySelector('.team-roster-table')"), 'return to People')
  const peopleCacheState = await evaluate('({token:window.__cacheToken,shows:window.__cacheShows})')
  assert.equal(peopleCacheState.token, peopleToken, `People should restore the original document from BFCache: ${JSON.stringify({ peopleCacheState, failures })}`)
  assert.ok(peopleCacheState.shows.some(event => event.persisted), 'People receives persisted pageshow')
  await waitFor(() => oldGroupStreams.every(id => !serverStreams.has(id)) && active(userUrl).length === 1 && active(teamUrl).length === 1, 'People streams reopen once')
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Designer de marca de Cache member\"]')?.checked===true"), 'restored People refreshes changes made while away')
  const restoredPeopleStreams = [...active(userUrl), ...active(teamUrl)]
  await evaluate('history.forward()')
  await waitFor(() => evaluate("location.pathname==='/settings/groups' && !!document.querySelector('.team-groups-panel')"), 'forward to Groups')
  const groupCacheState = await evaluate('({token:window.__cacheToken,shows:window.__cacheShows})')
  assert.equal(groupCacheState.token, groupsToken, `Groups should restore from BFCache: ${JSON.stringify({ groupCacheState, failures })}`)
  assert.ok(groupCacheState.shows.some(event => event.persisted), 'Groups receives persisted pageshow')
  await waitFor(() => restoredPeopleStreams.every(id => !serverStreams.has(id)) && active(userUrl).length === 0 && active(teamUrl).length === 1, 'Groups stream returns without leaks')
  assert.equal((await request(`/api/teams/${team.id}/members`, { method: 'PATCH', cookie: admin, body: { userId: memberId, brandDesigner: false } })).response.status, 200)
  await evaluate('history.back()')
  await waitFor(() => evaluate("location.pathname==='/settings/people' && document.querySelector('[aria-label=\"Designer de marca de Cache member\"]')?.checked===false"), 'second restoration refreshes People')
  await waitFor(() => active(userUrl).length === 1 && active(teamUrl).length === 1, 'second restoration keeps two streams')
  assert.equal((await request(`/api/teams/${team.id}/members?userId=${memberId}`, { method: 'DELETE', cookie: admin })).response.status, 200)
  await waitFor(() => evaluate("document.body.textContent.includes('Nenhuma equipe disponível')"), 'revoked People clears team')
  await waitFor(() => active(userUrl).length === 1 && active(teamUrl).length === 0, 'terminal selected-team stream stays closed')
  await evaluate('history.forward()')
  await waitFor(() => evaluate("location.pathname==='/settings/groups' && document.body.textContent.includes('Nenhuma equipe disponível')"), 'restored Groups rechecks revoked access')
  await waitFor(() => active(teamUrl).length === 0, 'revoked Groups stream closes')
  await evaluate('history.back()')
  await waitFor(() => evaluate("location.pathname==='/settings/people' && document.body.textContent.includes('Nenhuma equipe disponível')"), 'return after revocation')
  await waitFor(() => active(userUrl).length === 1 && active(teamUrl).length === 0, 'terminal stream does not reopen after another restoration')
  assert.equal(await evaluate("fetch('/api/auth/me').then(response=>response.ok)"), true, 'team revocation does not expire the session')
  console.log('PASS actual BFCache Back/Forward: streams close and reopen once, missed updates refresh, revocation stays terminal and the account remains signed in')
} finally {
  socket?.close()
  await stop(chrome)
  if (vite) await vite.close()
  if (api) await new Promise(resolve => api.close(resolve))
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined)
}
