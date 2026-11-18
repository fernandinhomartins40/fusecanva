import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
async function firstExisting(paths) { for (const candidate of paths) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found; set CHROME_PATH.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label) { const deadline = Date.now() + 30000; let lastError; while (Date.now() < deadline) { try { const result = await check(); if (result) return result } catch (error) { lastError = error } await delay(150) } throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ''}`) }
const chromePath = await firstExisting(chromeCandidates)
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-doc-page-setup-'))
let vite, chrome, socket, browserSocket
try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const page = targets.find(target => target.type === 'page' && target.url.includes(`127.0.0.1:${vitePort}`))
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++nextId; const response = new Promise(resolve => pending.set(id, resolve)); socket.send(JSON.stringify({ id, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response?.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); if (!response?.result?.result) throw new Error(`Chrome returned no evaluation result: ${JSON.stringify(response)}`); return response.result.result.value }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await waitFor(async () => evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.innerText.includes('Documento'))"), 'document library')
  await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.innerText.includes('Documento')).click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'Docs editor')
  await evaluate("document.querySelector('.doc-inspector-toggle').click();document.querySelector('.doc-format-help button').click()")
  const marginLabel = 'Margem esquerda em centímetros'
  await waitFor(async () => evaluate(`Boolean(document.querySelector('[aria-label="${marginLabel}"]'))`), 'A4 page setup')
  assert.equal(await evaluate(`document.querySelector('[aria-label="${marginLabel}"]').value`), '2.54')
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="${marginLabel}"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'3.00');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')&&parseFloat(document.querySelector('.doc-page').style.getPropertyValue('--doc-margin-left'))>113"), 'margin save and layout update')
  await send('Page.reload')
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'direct Docs route restores after reload')
  await evaluate("document.querySelector('.doc-inspector-toggle').click();document.querySelector('.doc-format-help button').click()")
  assert.equal(await evaluate(`document.querySelector('[aria-label="${marginLabel}"]')?.value`), '3.00', 'edited A4 margin persists after reload and reopen')
  const pdfCheck = await evaluate(`(async()=>{const {renderDocumentCanvases,createPdfBytes}=await import('/src/export.ts');const document={id:'a4-check',name:'A4',type:'doc',width:794,height:1123,updatedAt:'',docPageSetup:{preset:'a4',margins:{top:96,right:96,bottom:96,left:120}},pages:[{id:'p1',name:'Page 1',background:'#fff',elements:[],blocks:[{id:'b1',type:'paragraph',text:'Margin PDF test'}]}]};const pages=await renderDocumentCanvases(document);const images=pages.map(({canvas})=>canvas.toDataURL('image/png'));const bytes=await createPdfBytes(794,1123,images);const pdf=new TextDecoder().decode(bytes);return {pages:pages.length,a4:(pdf.match(/\\/MediaBox \\[0 0 595\\.5 842\\.25\\]/g)||[]).length,byteLength:bytes.byteLength}})()`)
  assert.equal(pdfCheck.pages, 1)
  assert.equal(pdfCheck.a4, 1)
  assert.ok(pdfCheck.byteLength > 1000, 'A4 PDF is generated with the persisted-margin renderer')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobileLayout = await evaluate("(()=>{const toolbar=document.querySelector('.doc-toolbar'),page=document.querySelector('.doc-page');return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,toolbarWidth:toolbar.clientWidth,toolbarContent:toolbar.scrollWidth,toolbarHeight:toolbar.getBoundingClientRect().height,pageWidth:page.getBoundingClientRect().width,workspaceWidth:document.querySelector('.doc-workspace').clientWidth}})()")
  assert.equal(mobileLayout.width, 390)
  assert.ok(mobileLayout.documentWidth <= mobileLayout.width && mobileLayout.bodyWidth <= mobileLayout.width, `mobile Docs has no document-level horizontal overflow: ${JSON.stringify(mobileLayout)}`)
  assert.ok(mobileLayout.toolbarWidth <= mobileLayout.width && mobileLayout.toolbarHeight >= 40, 'Docs toolbar stays within the mobile viewport and remains touch-sized')
  assert.ok(mobileLayout.pageWidth <= mobileLayout.workspaceWidth, 'document page scales to the available mobile workspace width')
  assert.ok(mobileLayout.toolbarContent >= mobileLayout.toolbarWidth, 'toolbar controls fit or scroll within their own rail')
  const mobileInspectorAction = await evaluate("(()=>{const toolbar=document.querySelector('.doc-toolbar'),button=toolbar.querySelector('.doc-inspector-toggle[aria-label*=\"Propriedades\"]');toolbar.scrollLeft=toolbar.scrollWidth;const r=button.getBoundingClientRect(),t=toolbar.getBoundingClientRect();return{scrollLeft:toolbar.scrollLeft,reachable:r.right>t.left&&r.left<t.right,open:document.querySelector('.doc-editor-layout').classList.contains('doc-inspector-open')}})()")
  assert.ok(mobileInspectorAction.reachable, `document properties action can be reached in the mobile toolbar: ${JSON.stringify(mobileInspectorAction)}`)
  if (mobileInspectorAction.open) await evaluate("document.querySelector('.doc-toolbar .doc-inspector-toggle[aria-label*=\"Propriedades\"]').click()")
  await evaluate("document.querySelector('.doc-toolbar .doc-inspector-toggle[aria-label*=\"Propriedades\"]').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-editor-layout')?.classList.contains('doc-inspector-open')"), 'mobile document properties panel')
  console.log('Docs page setup browser check passed: A4/margins/PDF plus 390x844 layout, bounded page/toolbar, reachable document properties action, and mobile inspector panel.')
} finally {
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999998, method: 'Browser.close' })) } catch {} }
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  if (vite && vite.exitCode === null) vite.kill()
  if (chrome && chrome.exitCode === null) chrome.kill()
  await delay(250)
  await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
