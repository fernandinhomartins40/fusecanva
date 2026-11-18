import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const chromePath = await (async () => { for (const candidate of chromeCandidates) { if (!candidate) continue; try { await import('node:fs/promises').then(fs => fs.access(candidate)); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the PPTX browser test.') })()
const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-pptx-browser-'))
let vite; let chrome; let browserSocket; let pageSocket
try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function pressTab(shift = false) {
    const modifiers = shift ? 8 : 0
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers })
  }

  await waitFor(() => evaluate("document.querySelector('.home-category-row button') && !document.querySelector('.home-loading')"), 'settled home')
  await evaluate("document.querySelector('.home-category-row button:nth-child(2)').click()")
  await delay(1500)
  const presentationState = await evaluate("({studio:!!document.querySelector('.studio-app'),home:!!document.querySelector('.home-shell'),slideHeading:!!document.querySelector('.presentation-slide-heading'),exportFormats:[...document.querySelectorAll('.export-format option')].map(option=>option.value)})")
  assert.equal(presentationState.slideHeading && presentationState.exportFormats.includes('pptx'), true, JSON.stringify(presentationState))
  await evaluate("document.querySelector('[aria-label=\"Adicionar slide\"]').click()")
  const slideCount = await waitFor(() => evaluate("document.querySelectorAll('.presentation-slide-list > *').length"), 'second presentation slide')
  assert.equal(slideCount, 2)
  const presentationFocus = await evaluate("(()=>{const launch=document.querySelector('.present-button');launch.focus();launch.click();return true})()")
  assert.equal(presentationFocus, true)
  const dialogHasFocus = await waitFor(() => evaluate("document.querySelector('.presentation-overlay') && document.activeElement === document.querySelector('.presentation-overlay')"), 'presentation dialog focus')
  assert.equal(dialogHasFocus, true, 'opening presentation moves keyboard focus into its modal dialog')
  const tabStops = await evaluate("(()=>{const dialog=document.querySelector('.presentation-overlay');return [...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])')].filter(el=>el.tabIndex>=0&&el.getClientRects().length>0).length})()")
  assert.ok(tabStops > 1, 'presentation dialog exposes keyboard controls for the focus trap')
  await evaluate("(()=>{const dialog=document.querySelector('.presentation-overlay');const stops=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])')].filter(el=>el.tabIndex>=0&&el.getClientRects().length>0);stops.at(-1).focus()})()")
  await pressTab()
  await waitFor(() => evaluate("document.activeElement===document.querySelector('.presentation-overlay').querySelector('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])')"), 'forward Tab wraps to first presentation control')
  await pressTab(true)
  await waitFor(() => evaluate("(()=>{const dialog=document.querySelector('.presentation-overlay');const stops=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])')].filter(el=>el.tabIndex>=0&&el.getClientRects().length>0);return document.activeElement===stops.at(-1)})()"), 'Shift+Tab wraps to last presentation control')
  const focusReturned = await evaluate("(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()")
  assert.equal(focusReturned, true)
  await waitFor(() => evaluate("!document.querySelector('.presentation-overlay') && document.activeElement === document.querySelector('.present-button')"), 'presentation trigger focus restoration')
  if (!process.env.A11Y_FOCUS_ONLY) {
  await evaluate("(()=>{window.__pptxDownloadPromise=new Promise(resolve=>{const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.pptx')){fetch(this.href).then(response=>response.arrayBuffer()).then(buffer=>{let binary='';const bytes=new Uint8Array(buffer);for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));resolve(btoa(binary))}).catch(error=>resolve('ERROR:'+error.message));return}return original.call(this)}})})()")
  await evaluate("(()=>{const select=document.querySelector('.export-format');select.value='pptx';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.export-button').click()})()")
  const base64 = await waitFor(() => evaluate('window.__pptxDownloadPromise'), 'PPTX download artifact')
  assert.ok(!base64.startsWith('ERROR:'), base64)
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'))
  const presentation = await zip.file('ppt/presentation.xml').async('string')
  assert.equal((presentation.match(/<p:sldId /g) ?? []).length, slideCount)
  for (let slide = 1; slide <= slideCount; slide += 1) {
    const slideXml = await zip.file(`ppt/slides/slide${slide}.xml`).async('string')
    const rels = await zip.file(`ppt/slides/_rels/slide${slide}.xml.rels`).async('string')
    if (rels.includes(`../media/slide${slide}.png`)) {
      const image = await zip.file(`ppt/media/slide${slide}.png`).async('uint8array')
      assert.deepEqual([...image.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `slide ${slide} retains its raster fallback`)
      assert.match(slideXml, /<p:pic>/)
    } else {
      assert.match(slideXml, /<p:bg>/, `slide ${slide} has an editable background`)
      assert.doesNotMatch(rels, /relationships\/image/, `native slide ${slide} needs no raster relationship`)
    }
  }
  await evaluate(`(()=>{window.__transparentPngPromise=new Promise((resolve,reject)=>{const previous=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download.endsWith('.png'))return previous.call(this);const link=this;const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);resolve({name:link.download,mime:link.href.slice(0,link.href.indexOf(';')),width:canvas.width,height:canvas.height,alpha:context.getImageData(0,0,1,1).data[3]})};image.onerror=()=>reject(new Error('PNG artifact failed to decode'));image.src=this.href}});const format=document.querySelector('.export-format');format.value='png';format.dispatchEvent(new Event('change',{bubbles:true}));const background=document.querySelector('[aria-label="Fundo PNG"]');if(!background)throw new Error('PNG background control is missing');background.value='transparent';background.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.export-button').click()})()`)
  const transparentPng = await waitFor(() => evaluate('window.__transparentPngPromise'), 'transparent PNG artifact')
  assert.equal(transparentPng.mime, 'data:image/png', 'transparent image export remains PNG')
  assert.ok(transparentPng.name.endsWith('.png') && transparentPng.width > 0 && transparentPng.height > 0, JSON.stringify(transparentPng))
  assert.equal(transparentPng.alpha, 0, 'transparent background survives scale conversion and PNG encoding')
  await evaluate(`(()=>{window.__opaquePngPromise=new Promise((resolve,reject)=>{const previous=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download.endsWith('.png'))return previous.call(this);const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);resolve(context.getImageData(0,0,1,1).data[3])};image.onerror=()=>reject(new Error('Opaque PNG artifact failed to decode'));image.src=this.href}});const background=document.querySelector('[aria-label="Fundo PNG"]');background.value='opaque';background.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.export-button').click()})()`)
  const opaqueAlpha = await waitFor(() => evaluate('window.__opaquePngPromise'), 'opaque PNG artifact')
  assert.equal(opaqueAlpha, 255, 'the default background option restores the page fill in PNG output')

  async function captureRaster(format, scale, quality = 'high') {
    const variable = `__rasterArtifact_${format}_${scale}_${quality}`
    await evaluate(`(()=>{const variable=${JSON.stringify(variable)};window[variable]=new Promise((resolve,reject)=>{const previous=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download.endsWith(${JSON.stringify(format === 'jpeg' ? '.jpg' : '.png')}))return previous.call(this);const link=this;const image=new Image();image.onload=()=>resolve({name:link.download,mime:link.href.slice(0,link.href.indexOf(';')),width:image.naturalWidth,height:image.naturalHeight,bytes:Math.floor((link.href.length-link.href.indexOf(',')-1)*3/4)});image.onerror=()=>reject(new Error('Raster artifact failed to decode'));image.src=this.href}});const formatSelect=document.querySelector('.export-format');formatSelect.value=${JSON.stringify(format)};formatSelect.dispatchEvent(new Event('change',{bubbles:true}));const scaleSelect=document.querySelector('[aria-label="Tamanho da imagem"]');scaleSelect.value=${JSON.stringify(String(scale))};scaleSelect.dispatchEvent(new Event('change',{bubbles:true}));const qualitySelect=document.querySelector('[aria-label="Qualidade JPEG"]');if(qualitySelect){qualitySelect.value=${JSON.stringify(quality)};qualitySelect.dispatchEvent(new Event('change',{bubbles:true}))}document.querySelector('.export-button').click()})()`)
    return waitFor(() => evaluate(`window[${JSON.stringify(variable)}]`), `${format} ${scale}× artifact`)
  }
  const pngOneX = await captureRaster('png', 1)
  assert.equal(pngOneX.mime, 'data:image/png')
  assert.ok(pngOneX.name.endsWith('.png') && pngOneX.bytes > 100, JSON.stringify(pngOneX))
  assert.deepEqual([pngOneX.width, pngOneX.height], [1280, 720], '1× export uses document dimensions')
  const pngThreeX = await captureRaster('png', 3)
  assert.deepEqual([pngThreeX.width, pngThreeX.height], [3840, 2160], '3× export scales both dimensions')
  const jpegLow = await captureRaster('jpeg', 2, 'low')
  assert.equal(jpegLow.mime, 'data:image/jpeg')
  assert.ok(jpegLow.name.endsWith('.jpg') && jpegLow.bytes > 100, JSON.stringify(jpegLow))
  assert.deepEqual([jpegLow.width, jpegLow.height], [2560, 1440], 'JPEG uses the selected image scale')
  const jpegHigh = await captureRaster('jpeg', 2, 'high')
  assert.equal(jpegHigh.mime, 'data:image/jpeg')
  assert.ok(jpegHigh.bytes > 100, JSON.stringify(jpegHigh))

  await evaluate("(()=>{window.__pdfArtifact=new Promise((resolve,reject)=>{const previous=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download.endsWith('.pdf'))return previous.call(this);fetch(this.href).then(response=>response.arrayBuffer()).then(buffer=>{const bytes=new Uint8Array(buffer);let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));resolve({name:this.download,base64:btoa(binary)})}).catch(reject)}});const format=document.querySelector('.export-format');format.value='pdf';format.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.export-button').click()})()")
  const pdfArtifact = await waitFor(() => evaluate('window.__pdfArtifact'), 'PDF artifact')
  const pdfBytes = Buffer.from(pdfArtifact.base64, 'base64')
  const pdfText = pdfBytes.toString('latin1')
  assert.ok(pdfArtifact.name.endsWith('.pdf') && pdfText.startsWith('%PDF-'), 'PDF download is a readable PDF artifact')
  assert.equal((pdfText.match(/\/Type \/Page\b/g) ?? []).length, slideCount, 'PDF contains one physical page per presentation slide')
  }
  console.log(process.env.A11Y_FOCUS_ONLY
    ? 'PASS presentation dialog focus trap, Escape close, and trigger focus restoration'
    : 'PASS presentation editor to PPTX package and PDF/PNG/JPEG artifacts with format-specific controls')
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) { for (let attempt = 0; attempt < 10; attempt += 1) { try { await rm(profileDir, { recursive: true, force: true }); break } catch { await delay(100) } } }
}
