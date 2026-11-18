import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run Pro manual background removal browser test')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {}; await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { await new Promise(resolve => { const taskkill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); taskkill.once('exit', resolve) }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(4000)]) }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-pro-manual-mask-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map(); const browserErrors = []; pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const result = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.reload', { ignoreCache: true })

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home').catch(async error => { console.error('Initial browser state:', await evaluate("({url:location.href,title:document.title,body:document.body.innerText.slice(0,500),root:document.querySelector('#root')?.innerHTML.slice(0,500)})"), browserErrors); throw error })
  const sourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="60"%3E%3Crect width="80" height="60" fill="%230a8"/%3E%3C/svg%3E'
  const asset = { id: 'replacement-asset', name: 'Replacement image', mimeType: 'image/svg+xml', width: 80, height: 60, src: sourceImage, createdAt: new Date().toISOString(), libraryVisible: 1 }
  const document = { id: 'pro-manual-mask-browser', name: 'Pro manual mask fixture', type: 'design', width: 794, height: 1123, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [{ id: 'image-1', type: 'image', name: 'Replacement image', src: sourceImage, assetId: asset.id, sourceWidth: 80, sourceHeight: 60, x: 100, y: 140, width: 320, height: 240, rotation: 0 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['documents','assets'],'readwrite');tx.objectStore('documents').put(${JSON.stringify(document)});tx.objectStore('assets').put(${JSON.stringify(asset)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("[...document.querySelectorAll('.project-open')].some(button=>button.textContent.includes('Pro manual mask fixture'))"), 'seeded local fixture')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Pro manual mask fixture')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.inspector-panel') && !!document.querySelector('.layer-row')"), 'fixture editor')
  await evaluate("document.querySelector('.layer-row[data-element-id=\"image-1\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-open-editor')"), 'image tools launcher')
  await evaluate("document.querySelector('.image-open-editor').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-filter-gallery')"), 'image tools panel')
  await evaluate("[...document.querySelectorAll('.image-tool-card')].find(button=>button.getAttribute('aria-label')?.includes('Borracha Mágica')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-mask-editor')"), 'Pro manual mask editor')
  assert.equal(await evaluate("document.querySelector('.image-mask-canvas').getAttribute('viewBox')"), '0 0 1000 750', '4:3 image mask preview preserves expected SVG geometry')
  assert.deepEqual(await evaluate("(()=>{const slider=document.querySelector('#image-mask-brush-size');const number=document.querySelector('.image-mask-size-controls input[type=number]');return{sliderMin:slider.min,sliderMax:slider.max,sliderValue:slider.value,numberMin:number.min,numberMax:number.max,numberValue:number.value}})()"), { sliderMin: '1', sliderMax: '100', sliderValue: '20', numberMin: '1', numberMax: '100', numberValue: '20' }, 'Pro brush exposes audited bounds and initial value')
  await evaluate("(()=>{const input=document.querySelector('.image-mask-size-controls input[type=number]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'40');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  assert.equal(await evaluate("document.querySelector('#image-mask-brush-size').value"), '40', 'numeric brush size synchronizes with the slider')
  await evaluate("(()=>{const input=document.querySelector('.image-mask-size-controls input[type=number]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'20');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")

  async function drawStroke(mode, startFraction, endFraction, yFraction = .5, mobile = false) {
    const modeLabel = mode === 'restore' ? 'Restaurar' : 'Apagar'
    await evaluate(`[...document.querySelectorAll('.image-mask-mode button')].find(button=>button.textContent.includes('${modeLabel}')).click()`)
    const rect = await evaluate(`(()=>{const r=document.querySelector('.image-mask-canvas').getBoundingClientRect();return{x:r.left+r.width*${startFraction},y:r.top+r.height*${yFraction},endX:r.left+r.width*${endFraction},endY:r.top+r.height*${yFraction}}})()`)
    if (mobile) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y, id: 1 }] })
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + (rect.endX - rect.x) * .5, y: rect.y, id: 1 }, { x: rect.endX, y: rect.endY, id: 2 }] })
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.endX, y: rect.endY, button: 'left', buttons: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.endX, y: rect.endY, button: 'left', clickCount: 1 })
    }
  }
  const browserStroke = async count => waitFor(() => evaluate(`document.querySelector('.image-mask-editor>small').textContent.startsWith('${count} traço') && document.querySelector('.save-state').textContent.includes('Salvo')`), `${count} saved mask strokes`)
  await drawStroke('erase', .2, .8)
  assert.equal(await evaluate("document.querySelector('.image-mask-canvas path:last-child')?.getAttribute('stroke-width')"), '50', '20-unit brush renders 50-unit SVG diameter')
  await browserStroke(1)
  await drawStroke('restore', .3, .7)
  await browserStroke(2)
  let savedMask = await readStoredImage(evaluate)
  assert.deepEqual(savedMask.strokes.map(stroke => ({ mode: stroke.mode, size: stroke.size })), [{ mode: 'erase', size: .05 }, { mode: 'restore', size: .05 }], 'erase and restore strokes persist with normalized brush geometry')
  assert.deepEqual(savedMask.geometry, { x: 100, y: 140, width: 320, height: 240, rotation: 0 }, 'mask edits preserve image placement and geometry')
  assert.equal(savedMask.assetSrc, sourceImage, 'mask edits preserve original source asset bytes')

  await evaluate("document.querySelector('[aria-label=Desfazer]').click()")
  await waitFor(() => readStoredImage(evaluate).then(value => value.strokes.length === 1), 'undo removes restore stroke')
  await evaluate("document.querySelector('[aria-label=Refazer]').click()")
  await waitFor(() => readStoredImage(evaluate).then(value => value.strokes.length === 2), 'redo restores restore stroke')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-open-editor')"), 'reselect image after global history')
  await evaluate("document.querySelector('.image-open-editor').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-filter-gallery')"), 'reopen image tools after global history')
  await evaluate("[...document.querySelectorAll('.image-tool-card')].find(button=>button.getAttribute('aria-label')?.includes('Borracha Mágica')).click()")
  await waitFor(() => evaluate("document.querySelector('.image-mask-editor>small').textContent.startsWith('2 traço')"), 'mask view reflects redone strokes')
  await evaluate("document.querySelector('.image-mask-actions button').click()")
  await waitFor(() => readStoredImage(evaluate).then(value => value.strokes.length === 1), 'mask-local undo removes most recent stroke')
  await evaluate("document.querySelectorAll('.image-mask-actions button')[1].click()")
  await waitFor(() => readStoredImage(evaluate).then(value => value.strokes.length === 0), 'clear mask control clears all strokes')
  await drawStroke('erase', .2, .8)
  await browserStroke(1)
  await drawStroke('restore', .3, .7)
  await browserStroke(2)

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const mobileGeometry = await evaluate("(()=>({viewport:[innerWidth,innerHeight],preview:document.querySelector('.image-mask-canvas').getBoundingClientRect().toJSON(),brush:document.querySelector('#image-mask-brush-size').getBoundingClientRect().toJSON()}))()")
  assert.equal(mobileGeometry.viewport[0], 390, 'mobile validation uses 390 CSS px')
  assert.ok(mobileGeometry.preview.width > 0 && mobileGeometry.brush.width > 0, 'mask canvas and brush control remain measurable on mobile')
  await drawStroke('erase', .78, .9, .78, true)
  await browserStroke(3)
  const mobileMask = await readStoredImage(evaluate)
  assert.equal(mobileMask.strokes.length, 3, 'touch gesture creates a persisted third stroke on mobile')
  assert.equal(mobileMask.strokes[2].mode, 'erase')
  assert.deepEqual(mobileMask.geometry, { x: 100, y: 140, width: 320, height: 240, rotation: 0 }, 'mobile gesture preserves source image geometry')
  assert.equal(mobileMask.assetSrc, sourceImage, 'mobile mask gesture also preserves source asset bytes')

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  const editorRouteBeforeReload = await evaluate("location.pathname")
  assert.equal(editorRouteBeforeReload, '/design/pro-manual-mask-browser/edit', 'local editor exposes a reloadable design route')
  await send('Page.reload', { ignoreCache: true })
  await waitFor(() => evaluate("location.pathname==='/design/pro-manual-mask-browser/edit' && !!document.querySelector('.canvas-workspace') && document.querySelector('input[aria-label=\"Nome do design\"]')?.value==='Pro manual mask fixture'"), 'restored editor route and document after reload').catch(async error => { console.error('Reloaded editor state:', await evaluate("({url:location.href,body:document.body.innerText.slice(0,600),loadError:document.querySelector('[role=alert]')?.textContent})")); throw error })
  assert.equal(await readStoredImage(evaluate).then(value => value.strokes.length), 3, 'all desktop and mobile mask strokes remain in IndexedDB after a real page reload')
  await waitFor(() => evaluate("!!document.querySelector('.layer-row[data-element-id=\"image-1\"]')"), 'restored image layer')
  await evaluate("document.querySelector('.layer-row[data-element-id=\"image-1\"]').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-open-editor')"), 'restored image tools launcher')
  await evaluate("document.querySelector('.image-open-editor').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-filter-gallery')"), 'restored image tools panel')
  await evaluate("[...document.querySelectorAll('.image-tool-card')].find(button=>button.getAttribute('aria-label')?.startsWith('Borracha')).click()")
  await waitFor(() => evaluate("document.querySelector('.image-mask-editor>small').textContent.startsWith('3 ')"), 'Pro mask strokes reappear after reopening the editor following reload')
  await evaluate("(()=>{window.__maskExportData='';const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download?.endsWith('.png'))window.__maskExportData=this.href;else original.call(this)};for(const [selector,value] of [['.export-format','png'],['select[aria-label=\"Tamanho da imagem\"]','1'],['select[aria-label=\"Fundo PNG\"]','transparent']]){const select=document.querySelector(selector);const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}))}})()")
  assert.equal(await evaluate("document.querySelector('.export-format').value==='png' && document.querySelector('[aria-label=\"Fundo PNG\"]').value==='transparent'"), true, 'export is configured as transparent PNG at 1×')
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(() => evaluate("window.__maskExportData.startsWith('data:image/png') && !document.querySelector('.export-button').disabled"), 'masked PNG export')
  const encodedPng = await evaluate("window.__maskExportData.split(',')[1]")
  assert.ok(encodedPng.length > 100, 'transparent PNG is produced from the masked design')
  const exported = PNG.sync.read(Buffer.from(encodedPng, 'base64'))
  const pixel = (x, y) => [...exported.data.slice((y * exported.width + x) * 4, (y * exported.width + x) * 4 + 4)]
  assert.equal(pixel(180, 260)[3], 0, 'erased path exports as transparent pixels')
  assert.equal(pixel(260, 260)[3], 255, 'restored path exports original opaque pixels')
  const finalSource = await readStoredImage(evaluate)
  assert.equal(finalSource.assetSrc, sourceImage, 'export does not rewrite the original source asset')
  assert.deepEqual(finalSource.geometry, { x: 100, y: 140, width: 320, height: 240, rotation: 0 }, 'export does not change image geometry')
  console.log(JSON.stringify({ pass: true, flows: ['audited 4:3 Pro mask fixture', 'brush slider and numeric geometry', 'desktop erase/restore', 'global Undo/Redo and local undo/clear', 'IndexedDB persistence during editing', 'mobile touch mask gesture', 'editor route/document and 3 mask strokes restored after full page reload', 'source bytes and element geometry preserved', 'transparent PNG reflects erased/restored alpha'], desktopStrokes: 2, mobileStrokes: 3, reloadedStrokes: finalSource.strokes.length, route: editorRouteBeforeReload, export: { width: exported.width, height: exported.height, erasedAlpha: pixel(180, 260)[3], restoredAlpha: pixel(260, 260)[3] } }))
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  for (let attempt = 0; attempt < 5; attempt++) { try { await rm(profile, { recursive: true, force: true }); break } catch { if (attempt < 4) await delay(250) } }
}

async function readStoredImage(evaluate) {
  return evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['documents','assets'],'readonly');const get=tx.objectStore('documents').get('pro-manual-mask-browser');const media=tx.objectStore('assets').get('replacement-asset');let doc,asset;const finish=()=>{if(!doc||!asset)return;db.close();const image=doc.pages[0].elements[0];resolve({strokes:image.maskStrokes??[],assetSrc:asset.src,geometry:{x:image.x,y:image.y,width:image.width,height:image.height,rotation:image.rotation}})};get.onsuccess=()=>{doc=get.result;finish()};media.onsuccess=()=>{asset=media.result;finish()};get.onerror=()=>reject(get.error);media.onerror=()=>reject(media.error)}})")
}
