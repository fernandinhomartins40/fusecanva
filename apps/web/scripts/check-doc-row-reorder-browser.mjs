import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const deadline = Date.now() + timeout; let lastError; while (Date.now() < deadline) { try { const result = await check(); if (result) return result } catch (error) { lastError = error } await delay(120) } throw new Error(`Tempo esgotado aguardando ${label}${lastError ? `: ${lastError}` : ''}`) }
const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-doc-row-move-'))
let vite; let chrome; let browserSocket; let socket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`))
  assert.ok(target)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const next = ++id; const response = new Promise(resolve => pending.set(next, resolve)); socket.send(JSON.stringify({ id: next, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (!response.result?.result) throw new Error(`${response.result?.exceptionDetails?.exception?.description ?? 'CDP evaluation returned no result'}; ${expression.slice(0, 120)}`); return response.result.result.value }
  async function openDoc() { await waitFor(async () => evaluate("Boolean(document.querySelector('.project-open')) || [...document.querySelectorAll('button')].some(button=>button.textContent.includes('Documento'))"), 'home'); if (await evaluate("Boolean(document.querySelector('.project-open'))")) await evaluate("document.querySelector('.project-open').click()"); else await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Documento')).click()"); await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-editable-text'))"), 'Docs editor') }
  async function findTablePage() { for (let page = 0; page < 12 && !(await evaluate("Boolean(document.querySelector('.doc-table'))")); page += 1) { await evaluate("document.querySelector('.doc-footer-pagination button[aria-label=\"Proxima pagina\"]')?.click()"); await delay(120) } return await evaluate("Boolean(document.querySelector('.doc-table'))") }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await openDoc()
  await evaluate("[...document.querySelectorAll('.doc-add-blocks button')].find(button=>button.textContent.includes('Tabela'))?.click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-table textarea[data-table-id]'))"), 'new table')
  async function setCell(row, column, value) { await evaluate(`(()=>{const field=document.querySelector('.doc-block.active .doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]');if(!field)throw new Error('cell ${row}:${column} missing');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`); await waitFor(async () => evaluate(`document.querySelector('.doc-block.active .doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]')?.value===${JSON.stringify(value)}`), `cell ${row}:${column}`) }
  await setCell(0, 0, 'Header A'); await setCell(0, 1, 'Header B'); await setCell(1, 0, 'Body A'); await setCell(1, 1, 'Body B')
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'table saved')
  const initial = await evaluate("(()=>{const t=document.querySelector('.doc-table');return [...t.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('textarea')].map(cell=>cell.value))})()")
  await evaluate("document.querySelector('.doc-table textarea[data-table-row=\"0\"][data-table-column=\"0\"]').focus()")
  await waitFor(async () => evaluate("document.querySelector('.doc-inline-table-actions [aria-label=\"Mover linha 1 para cima\"]')?.getClientRects().length===0&&document.querySelector('.doc-inline-table-actions [aria-label=\"Mover linha 1 para baixo\"]')?.disabled===false"), 'top row exposes Down without showing Up')
  await evaluate("document.querySelector('.doc-inline-table-actions [aria-label=\"Mover linha 1 para baixo\"]').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-table textarea[data-table-row=\"0\"][data-table-column=\"0\"]')?.value==='Body A'"), 'move row down')
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'down move persisted locally')
  await send('Page.reload'); await openDoc(); assert.equal(await findTablePage(), true, 'the table is reachable after reopening the document')
  const down = await evaluate("(()=>{const t=document.querySelector('.doc-table');return [...t.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('textarea')].map(cell=>cell.value))})()")
  assert.deepEqual(down, [initial[1], initial[0], ...initial.slice(2)], 'row move down persists after reload')
  await evaluate("document.querySelector('.doc-table textarea[data-table-row=\"1\"][data-table-column=\"0\"]').focus()")
  await waitFor(async () => evaluate("document.querySelector('.doc-inline-table-actions [aria-label=\"Mover linha 2 para cima\"]')?.disabled===false&&document.querySelector('.doc-inline-table-actions [aria-label=\"Mover linha 2 para baixo\"]')?.disabled===false"), 'middle row exposes both directions')
  await evaluate("document.querySelector('.doc-inline-table-actions [aria-label=\"Mover linha 2 para cima\"]').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-table textarea[data-table-row=\"0\"][data-table-column=\"0\"]')?.value==='Header A'"), 'move row up')
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'up move persisted locally')
  await send('Page.reload'); await openDoc(); assert.equal(await findTablePage(), true, 'the table is reachable after reopening the restored document')
  const restored = await evaluate("(()=>{const t=document.querySelector('.doc-table');return [...t.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('textarea')].map(cell=>cell.value))})()")
  assert.deepEqual(restored, initial, 'moving the row back up restores and persists the original order')
  await send('Browser.close')
  console.log('Docs row reorder browser check passed: boundary-aware move up/down and persisted row values across reloads.')
} finally {
  try { socket?.close(); browserSocket?.close() } catch {}
  for (const child of [chrome, vite]) if (child && child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 4000); child.once('exit', () => { clearTimeout(timer); resolve() }); child.kill() })
  await rm(profileDir, { recursive: true, force: true })
}
