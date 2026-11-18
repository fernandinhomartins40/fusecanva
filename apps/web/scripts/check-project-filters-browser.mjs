import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run this browser test.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label) { const end = Date.now() + 25000; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const vitePort = await freePort(); const cdpPort = await freePort(); const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-project-filter-'))
let vite; let browser; let socket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome')
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json().then(items => items.find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`))), 'page')
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function clickByText(selector, text) { await evaluate(`([...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}))?.click()`); await delay(150) }
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'library')
  await clickByText('.home-category-row button', 'Planilha')
  await waitFor(() => evaluate("!!document.querySelector('.topbar button[aria-label=\\\"Salvar e voltar aos projetos\\\"]')"), 'sheet editor')
  await evaluate("document.querySelector('.topbar button[aria-label=\\\"Salvar e voltar aos projetos\\\"]')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.home-projects-heading') && document.querySelectorAll('.project-card').length===1"), 'created fixture')
  await evaluate(`new Promise(resolve=>{const r=indexedDB.open('fuse-studio');r.onsuccess=()=>{const db=r.result;const tx=db.transaction('documents','readwrite');const store=tx.objectStore('documents');const g=store.getAll();g.onsuccess=()=>{for(const d of g.result)if(d.type==='sheet'){d.updatedAt=new Date(Date.now()-86400000).toISOString();store.put(d)}resolve(true)}}})`)
  await evaluate('location.reload()')
  await waitFor(() => evaluate("!!document.querySelector('.home-projects-heading') && !document.querySelector('.home-loading')"), 'fixture reload')
  await clickByText('.project-filters[aria-label="Filtros de busca"] button', 'Categoria')
  await waitFor(() => evaluate("location.search.includes('ui=') && document.querySelector('.project-filters[aria-label=\\\"Filtros de busca\\\"] button')?.textContent==='Categoria: Planilha'"), 'category state')
  const categoryUrl = await evaluate('location.href')
  assert.match(categoryUrl, /ui=eyJBIjp7IkIiOiJ0QUdJRnU2MWVOTSJ9fQ/)
  await evaluate('location.reload()'); await waitFor(() => evaluate("document.querySelector('.project-filters[aria-label=\\\"Filtros de busca\\\"] button')?.textContent==='Categoria: Planilha'"), 'category reload')
  await clickByText('.project-filters[aria-label="Filtros de busca"] button', 'Data de edição')
  await waitFor(() => evaluate("location.search.includes('ui=') && document.querySelector('.project-filters[aria-label=\\\"Filtros de busca\\\"] button:nth-child(2)')?.textContent==='Data de edição: Hoje'"), 'combined category/date')
  assert.equal(await evaluate("new URLSearchParams(location.search).get('ui')"), 'eyJBIjp7IkIiOiJ0QUdJRnU2MWVOTSIsIkEiOiJDIn19')
  assert.equal(await evaluate("document.querySelector('.home-empty h2')?.textContent"), 'Nenhum resultado encontrado')
  await evaluate('location.reload()'); await waitFor(() => evaluate("document.querySelector('.home-empty h2')?.textContent==='Nenhum resultado encontrado'"), 'combined reload')
  await clickByText('.project-filters[aria-label="Filtros de busca"] button', 'Limpar filtros')
  await waitFor(() => evaluate("location.pathname==='/projects' && !location.search.includes('ui') && document.querySelector('.project-filters[aria-label=\\\"Filtro de projetos\\\"] button')?.textContent==='Recentes'"), 'clear to recent')
  await clickByText('.project-filters[aria-label="Filtros de busca"] button', 'Data de edição')
  await waitFor(() => evaluate("document.querySelector('.project-filters[aria-label=\\\"Filtros de busca\\\"] button:nth-child(2)')?.textContent==='Data de edição: Hoje'"), 'date only')
  await evaluate('location.reload()'); await waitFor(() => evaluate("document.querySelector('.project-filters[aria-label=\\\"Filtros de busca\\\"] button:nth-child(2)')?.textContent==='Data de edição: Hoje'"), 'date reload')
  await clickByText('.project-filters[aria-label="Filtros de busca"] button', 'Data de edição: Hoje')
  assert.equal(await evaluate("new URLSearchParams(location.search).has('ui')"), false, 'clearing date removes UI filter')
  assert.equal(await evaluate("document.querySelector('.project-filters[aria-label=\\\"Filtros de busca\\\"] button:nth-child(2)')?.textContent"), 'Data de edição')
  await clickByText('.home-category-row button', 'Redes sociais')
  await waitFor(() => evaluate("!!document.querySelector('.topbar button[aria-label=\\\"Salvar e voltar aos projetos\\\"]')"), 'design editor')
  await evaluate("document.querySelector('.topbar button[aria-label=\\\"Salvar e voltar aos projetos\\\"]')?.click()")
  await waitFor(() => evaluate("document.querySelectorAll('.project-card').length===2"), 'design fixture')
  const designName = await evaluate("document.querySelector('.project-card .project-card-copy strong')?.textContent")
  await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Busque designs, pastas e uploads"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(designName)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor(() => evaluate("new URLSearchParams(location.search).has('query')"), 'query route')
  await clickByText('.project-search-scope', 'Designs · Ver tudo')
  await waitFor(() => evaluate("location.search.includes('adj=eyJGIjoiQSJ9') && new URLSearchParams(location.search).has('forceQuery')"), 'design scope')
  await evaluate('location.reload()')
  await waitFor(() => evaluate("new URLSearchParams(location.search).has('query') && new URLSearchParams(location.search).has('adj') && !!document.querySelector('.project-search-scope')"), 'scoped search reload')
  await evaluate("document.querySelector('.project-search button[aria-label=\\\"Limpar busca\\\"]')?.click()")
  assert.equal(await evaluate("new URLSearchParams(location.search).has('query')"), false)
  assert.equal(await evaluate("new URLSearchParams(location.search).get('adj')"), 'eyJGIjoiQSJ9')
  await clickByText('.project-filters[aria-label="Filtros de busca"] button', 'Limpar filtros')
  await waitFor(() => evaluate("location.pathname==='/projects' && !location.search.includes('adj') && !location.search.includes('forceQuery')"), 'scope clear')
  console.log('PASS project category/date/query URL round trips, reload, combined empty fixture, clear behavior')
} finally {
  try { socket?.close() } catch {}
  for (const child of [browser, vite]) if (child && child.exitCode === null) { if (process.platform === 'win32') { try { (await import('node:child_process')).execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM') }
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
