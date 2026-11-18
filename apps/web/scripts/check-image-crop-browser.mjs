import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try { await access(candidate, constants.X_OK); return candidate } catch {}
  }
  throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the image crop browser test.')
}

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitFor(check, label, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill(), 1500)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

const chromePath = await findChrome()
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-image-crop-browser-'))
let vite
let chrome
let browserSocket
let pageSocket

try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  })
  async function send(method, params = {}) {
    const requestId = ++id
    const response = new Promise(resolve => pending.set(requestId, resolve))
    pageSocket.send(JSON.stringify({ id: requestId, method, params }))
    return response
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }
  async function readImage() {
    return evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const tx=request.result.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-crop-browser');get.onsuccess=()=>{request.result.close();resolve(get.result.pages[0].elements[0])};get.onerror=()=>reject(get.error)}})")
  }

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="40" height="60" fill="#e44"/><rect x="40" width="40" height="60" fill="#36c"/></svg>'
  const documentFixture = { id: 'image-crop-browser', name: 'Image crop fixture', type: 'design', width: 794, height: 1123, updatedAt: new Date().toISOString(), pages: [{ id: 'page-1', name: 'Page 1', background: '#fff', elements: [{ id: 'image-1', type: 'image', name: 'Crop sample', src: `data:image/svg+xml,${encodeURIComponent(sourceSvg)}`, x: 100, y: 140, width: 320, height: 240, rotation: 0, sourceWidth: 80, sourceHeight: 60 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const tx=request.result.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(documentFixture)});tx.oncomplete=()=>{request.result.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded local project')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.inspector-panel') && !!document.querySelector('.layer-row')"), 'image editor')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-quick-toolbar')"), 'selected image controls')

  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Cortar').click()")
  await waitFor(() => evaluate("!!document.querySelector('.crop-dialog') && !!document.querySelector('.crop-selection')"), 'crop dialog and loaded image')
  await evaluate("document.querySelector('.crop-ratios button').click()")
  await evaluate("document.querySelector('.crop-cancel').click()")
  await waitFor(() => evaluate("!document.querySelector('.crop-dialog')"), 'crop cancellation')
  let image = await readImage()
  assert.equal(image.crop, undefined, 'cancel discards the pending crop')
  assert.deepEqual([image.width, image.height], [320, 240], 'cancel preserves image geometry')

  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Cortar').click()")
  await waitFor(() => evaluate("!!document.querySelector('.crop-dialog') && !!document.querySelector('.crop-selection')"), 'crop dialog reopened')
  await evaluate("[...document.querySelectorAll('.crop-ratios button')].find(button=>button.textContent.trim()==='1:1').click()")
  const pendingSquare = await evaluate("({width:parseFloat(document.querySelector('.crop-selection').style.width)*80,height:parseFloat(document.querySelector('.crop-selection').style.height)*60})")
  assert.ok(Math.abs(pendingSquare.width - pendingSquare.height) < 0.01, '1:1 preset produces a square selection in source pixels')
  await evaluate("document.querySelector('.crop-dialog .share-button').click()")
  await waitFor(() => evaluate("!document.querySelector('.crop-dialog') && document.querySelector('.save-state').textContent.includes('Salvo')"), 'square crop saved')
  image = await readImage()
  assert.deepEqual(image.crop, { x: 10, y: 0, width: 60, height: 60 }, '1:1 crop maps back to the expected source pixels')
  assert.deepEqual([image.width, image.height], [320, 320], 'applying crop adjusts the rendered image bounds to the selected aspect')

  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace') && !!document.querySelector('.inspector-panel') && !!document.querySelector('.layer-row')"), 'cropped document restored on its editor route')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-quick-toolbar')"), 'reselected cropped image')
  image = await readImage()
  assert.deepEqual(image.crop, { x: 10, y: 0, width: 60, height: 60 }, 'crop persists after reloading the app')
  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Cortar').click()")
  await waitFor(() => evaluate("!!document.querySelector('.crop-dialog')"), 'crop dialog for restore')
  await evaluate("document.querySelector('.crop-restore').click()")
  await evaluate("document.querySelector('.crop-dialog .share-button').click()")
  await waitFor(() => evaluate("!document.querySelector('.crop-dialog') && document.querySelector('.save-state').textContent.includes('Salvo')"), 'original crop restored')
  image = await readImage()
  assert.equal(image.crop, null, 'restoring original removes the crop from the model')
  assert.deepEqual([image.width, image.height], [320, 240], 'restoring original restores the natural aspect ratio')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace') && !!document.querySelector('.inspector-panel') && !!document.querySelector('.layer-row')"), 'original-ratio document restored on its editor route')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-quick-toolbar')"), 'reselected original-ratio image')
  image = await readImage()
  assert.equal(image.crop, null, 'original ratio restoration persists after reloading the app')
  assert.deepEqual([image.width, image.height], [320, 240], 'restored natural ratio persists after reloading the app')

  await evaluate("(async()=>{const req=indexedDB.open('fuse-studio');window.__flipSource=await new Promise((resolve,reject)=>{req.onsuccess=()=>{const db=req.result;const get=db.transaction('documents').objectStore('documents').get('image-crop-browser');get.onsuccess=()=>{db.close();resolve(get.result.pages[0].elements[0])};get.onerror=()=>reject(get.error)};req.onerror=()=>reject(req.error)})})()")
  const pngFlipCheck = await evaluate("(async()=>{const {renderImageElementPng}=await import('/src/export.ts');const load=async e=>{const img=new Image();img.src=await renderImageElementPng(e);await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return {w:c.width,h:c.height,p:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}};const before=await load(window.__flipSource);const after=await load({...window.__flipSource,flipX:true});let mismatch=0;for(let y=0;y<before.h;y++)for(let x=0;x<before.w;x++){const a=(y*before.w+x)*4,b=(y*before.w+(before.w-1-x))*4;for(let c=0;c<4;c++)if(Math.abs(before.p[a+c]-after.p[b+c])>1)mismatch++}return {width:before.w,height:before.h,mismatch}})()")
  assert.equal(pngFlipCheck.mismatch, 0, `horizontal flip PNG matches a pixel reflection (${JSON.stringify(pngFlipCheck)})`)
  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Inverter').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-quick-flip-menu')"), 'image flip menu')
  await evaluate("[...document.querySelectorAll('.image-quick-flip-menu [role=menuitem]')].find(button=>button.textContent.includes('horizontal')).click()")
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo')"), 'horizontal flip saved')
  image = await readImage()
  assert.equal(image.flipX, true, 'horizontal flip is stored on the image model')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.canvas-workspace') && !!document.querySelector('.inspector-panel') && !!document.querySelector('.layer-row')"), 'flipped document restored on its editor route')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-quick-toolbar')"), 'reselected flipped image')
  image = await readImage()
  assert.equal(image.flipX, true, 'horizontal flip persists after reloading the app')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Cortar').click()")
  await waitFor(() => evaluate("!!document.querySelector('.crop-dialog') && !!document.querySelector('.crop-selection')"), 'mobile crop dialog')
  const mobileLayout = await evaluate("(()=>{const dialog=document.querySelector('.crop-dialog');const footer=dialog.querySelector('footer');const rect=dialog.getBoundingClientRect();const footerRect=footer.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,footerBottom:footerRect.bottom,saveVisible:!!dialog.querySelector('.share-button')&&footerRect.bottom<=innerHeight}})()")
  assert.ok(mobileLayout.width === 390 && mobileLayout.scrollWidth <= mobileLayout.width, 'mobile editor has no horizontal page overflow')
  assert.ok(mobileLayout.left >= 0 && mobileLayout.right <= mobileLayout.width, 'crop dialog fits the mobile viewport horizontally')
  assert.ok(mobileLayout.top >= 0 && mobileLayout.bottom <= 844 && mobileLayout.saveVisible, 'crop dialog actions remain visible in the mobile viewport')
  await evaluate("[...document.querySelectorAll('.crop-ratios button')].find(button=>button.textContent.trim()==='16:9').click()")
  await evaluate("document.querySelector('.crop-dialog .share-button').click()")
  await waitFor(() => evaluate("!document.querySelector('.crop-dialog') && document.querySelector('.save-state').textContent.includes('Salvo')"), 'mobile crop save')
  image = await readImage()
  assert.ok(Math.abs(image.crop.width / image.crop.height - 16 / 9) < 0.02, 'mobile 16:9 preset applies the expected crop ratio')
  assert.ok(Math.abs(image.width / image.height - 16 / 9) < 0.02, 'mobile crop updates rendered image geometry')
  console.log('PASS crop cancel, aspect preset, source-pixel mapping, geometry, crop/restore reload persistence, pixel-verified horizontal flip PNG, flip reload persistence, and 390px mobile crop/save')
} finally {
  pageSocket?.close()
  browserSocket?.close()
  await stop(chrome)
  await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-image-crop-browser-')) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { await rm(resolvedProfile, { recursive: true, force: true }); break }
      catch (error) {
        if (error.code !== 'EBUSY' || attempt === 9) { console.warn(`Could not remove temporary Chrome profile: ${error.message}`); break }
        await delay(300)
      }
    }
  }
}
