import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
let chromePath
for (const candidate of [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {}
}
assert.ok(chromePath, 'Set CHROME_PATH to run the PNG output browser check')

async function freePort() {
  const server = createTcpServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await new Promise(resolve => child.once('exit', resolve))
}

const webPort = await freePort()
const cdpPort = await freePort()
const origin = `http://127.0.0.1:${webPort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-png-alpha-browser-'))
let vite
let chrome
let browserSocket
let pageSocket

try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--force'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', origin], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${webPort}`)), 'app page')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let commandId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const id = ++commandId; pending.set(id, resolve); pageSocket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home')
  const imageSource = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="#e44"/></svg>')}`
  const documentFixture = { id: 'png-alpha-browser', name: 'PNG alpha fixture', type: 'design', width: 80, height: 60, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [{ id: 'image-1', type: 'image', name: 'Opaque source', src: imageSource, x: 10, y: 10, width: 40, height: 30, rotation: 0, opacity: 37 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(documentFixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded project')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('PNG alpha fixture')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.studio-app') && !!document.querySelector('.export-format')"), 'editor export controls')
  await evaluate("(()=>{window.__capturedPng='';const nativeClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download?.endsWith('.png')){window.__capturedPng=this.href;return}nativeClick.call(this)};const format=document.querySelector('.export-format');format.value='png';format.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelector('.export-format').value==='png' && !!document.querySelector('[aria-label=\\\"Fundo PNG\\\"]')"), 'PNG options')
  await evaluate("(()=>{const control=document.querySelector('[aria-label=\\\"Tamanho da imagem\\\"]');control.value='1';control.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await evaluate("(()=>{const control=document.querySelector('[aria-label=\\\"Fundo PNG\\\"]');control.value='transparent';control.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(() => evaluate("window.__capturedPng.startsWith('data:image/png;base64,')"), 'transparent PNG export')
  const transparentPixels = await evaluate("(async()=>{const image=new Image();image.src=window.__capturedPng;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const corner=context.getImageData(2,2,1,1).data;const center=context.getImageData(40,30,1,1).data;return {width:canvas.width,height:canvas.height,corner:[...corner],center:[...center]}})()")
  assert.deepEqual([transparentPixels.width, transparentPixels.height], [80, 60], 'PNG export keeps the requested native dimensions')
  assert.equal(transparentPixels.corner[3], 0, 'decoded transparent PNG leaves the page background alpha at zero')
  assert.ok(Math.abs(transparentPixels.center[3] - 94) <= 1, `decoded PNG stores the image's 37% opacity in alpha; got ${transparentPixels.center[3]}`)

  await evaluate("(()=>{const scale=document.querySelector('[aria-label=\\\"Tamanho da imagem\\\"]');scale.value='2';scale.dispatchEvent(new Event('change',{bubbles:true}));window.__capturedPng=''})()")
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(() => evaluate("window.__capturedPng.startsWith('data:image/png;base64,')"), '2x transparent PNG export')
  const transparent2xPixels = await evaluate("(async()=>{const image=new Image();image.src=window.__capturedPng;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,corner:context.getImageData(4,4,1,1).data[3],center:context.getImageData(80,60,1,1).data[3]}})()")
  assert.deepEqual([transparent2xPixels.width, transparent2xPixels.height], [160, 120], '2x scale doubles the decoded PNG dimensions')
  assert.equal(transparent2xPixels.corner, 0, 'transparent background remains clear at 2x')
  assert.ok(Math.abs(transparent2xPixels.center - 94) <= 1, '2x resampling preserves the 37% image alpha at its center')

  await evaluate("(()=>{const scale=document.querySelector('[aria-label=\\\"Tamanho da imagem\\\"]');scale.value='3';scale.dispatchEvent(new Event('change',{bubbles:true}));const background=document.querySelector('[aria-label=\\\"Fundo PNG\\\"]');background.value='opaque';background.dispatchEvent(new Event('change',{bubbles:true}));window.__capturedPng=''})()")
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(() => evaluate("window.__capturedPng.startsWith('data:image/png;base64,')"), 'opaque PNG export')
  const opaque3xPixels = await evaluate("(async()=>{const image=new Image();image.src=window.__capturedPng;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,alpha:context.getImageData(6,6,1,1).data[3]}})()")
  assert.deepEqual([opaque3xPixels.width, opaque3xPixels.height], [240, 180], '3x scale triples the decoded PNG dimensions')
  assert.equal(opaque3xPixels.alpha, 255, 'decoded opaque PNG stores a fully opaque page background')
  console.log('PASS exported PNG bytes decode at 1x/2x/3x; transparent background alpha=0, 37% image alpha≈94, opaque background alpha=255')
} finally {
  try { pageSocket?.close() } catch {}
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
  await stop(chrome)
  await stop(vite)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
