import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
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
  throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the image brightness browser test.')
}

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitFor(check, label, timeoutMs = 25000) {
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
    const timer = setTimeout(() => child.kill(), 2000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

const chromePath = await findChrome()
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-image-brightness-browser-'))
let vite
let chrome
let browserSocket
let pageSocket

try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1440,1100', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
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

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  const sourcePng = await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1200;const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,1200,1200);gradient.addColorStop(0,'#244a78');gradient.addColorStop(.45,'#c2813b');gradient.addColorStop(1,'#42a89b');context.fillStyle=gradient;context.fillRect(0,0,1200,1200);context.fillStyle='#e5d7c4';context.fillRect(130,190,370,260);context.fillStyle='#293342';context.beginPath();context.arc(830,680,210,0,Math.PI*2);context.fill();context.fillStyle='#f3eee7';context.fillRect(120,880,880,90);return canvas.toDataURL('image/png')})()`)
  const fixture = {
    id: 'image-brightness-browser', name: 'Image brightness fixture', type: 'design', width: 1200, height: 1200, updatedAt: new Date().toISOString(),
    pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [{
      id: 'image-1', type: 'image', name: 'Raster sample', src: sourcePng, x: 0, y: 0, width: 1200, height: 1200, rotation: 0, sourceWidth: 1200, sourceHeight: 1200,
    }] }],
  }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded image design')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') && !!document.querySelector('.inspector-panel')"), 'image editor')
  await evaluate("document.querySelector('.layer-row').click()")

  const comparePng = () => evaluate(`(async()=>{const request=indexedDB.open('fuse-studio');const doc=await new Promise((resolve,reject)=>{request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-brightness-browser');get.onsuccess=()=>{db.close();resolve(get.result)};get.onerror=()=>reject(get.error)}});const {renderPageCanvas}=await import('/src/export.ts');const page=doc.pages[0];const element=page.elements.find(item=>item.id==='image-1');const baselineDoc={...doc,pages:[{...page,elements:page.elements.map(item=>item.id==='image-1'?{...item,brightness:0}:item)}]};const baselineCanvas=await renderPageCanvas(baselineDoc,baselineDoc.pages[0]);const currentCanvas=await renderPageCanvas(doc,page);const decode=async canvas=>{const data=canvas.toDataURL('image/png');const image=await new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=reject;value.src=data});const check=document.createElement('canvas');check.width=image.width;check.height=image.height;const context=check.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return{width:image.width,height:image.height,bytes:Math.floor(data.length*3/4),pixels:context.getImageData(0,0,image.width,image.height).data}};const base=await decode(baselineCanvas),current=await decode(currentCanvas);if(base.width!==current.width||base.height!==current.height)throw new Error('PNG baseline and adjusted dimensions differ');let sum=0,absolute=0,changedChannels=0,changedPixels=0,min=255,max=-255;for(let p=0;p<current.pixels.length;p+=4){let pixelChanged=false;for(let c=0;c<3;c++){const delta=current.pixels[p+c]-base.pixels[p+c];sum+=delta;absolute+=Math.abs(delta);if(delta){changedChannels++;pixelChanged=true}min=Math.min(min,delta);max=Math.max(max,delta)}if(pixelChanged)changedPixels++}return{width:current.width,height:current.height,pngBytes:current.bytes,changedPixels,changedChannels,meanChannelDelta:sum/(current.pixels.length/4*3),meanAbsoluteChannelDelta:absolute/(current.pixels.length/4*3),minChannelDelta:min,maxChannelDelta:max,brightness:element.brightness??0,contrast:element.contrast??0,saturation:element.saturation??0}})()`)

  const baseline = await comparePng()
  assert.deepEqual([baseline.width, baseline.height], [2400, 2400], 'baseline PNG has the audited square output dimensions')
  assert.ok(baseline.pngBytes > 1000, 'baseline PNG data is nonempty')
  assert.equal(baseline.brightness, 0)
  assert.equal(baseline.contrast, 0)
  assert.equal(baseline.saturation, 0)
  assert.equal(baseline.changedPixels, 0, 'zero-brightness baseline is compared with its unchanged clone')
  const changed = await evaluate(`(()=>{const slider=document.querySelector('#image-inspector-brightness-slider');if(!slider)throw new Error('brightness slider missing');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(slider,'20');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.focus();slider.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return true})()`)
  assert.equal(changed, true)
  await waitFor(() => evaluate("document.querySelector('#image-inspector-brightness-slider')?.value==='20' && document.querySelector('.save-state')?.textContent.includes('Salvo') && new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-brightness-browser');get.onsuccess=()=>{db.close();resolve(get.result.pages[0].elements[0].brightness===20)};get.onerror=()=>reject(get.error)}})"), 'brightness value saved')
  assert.equal(await evaluate("!document.querySelector('[aria-label=\"Desfazer\"]')?.disabled"), true, 'Undo is enabled after committing brightness')
  await evaluate("document.querySelector('[aria-label=\"Desfazer\"]').click()")
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo') && new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-brightness-browser');get.onsuccess=()=>{db.close();resolve((get.result.pages[0].elements[0].brightness??0)===0)};get.onerror=()=>reject(get.error)}})"), 'undone brightness saved as zero')
  assert.equal(await evaluate("!document.querySelector('[aria-label=\"Refazer\"]')?.disabled"), true, 'Redo is enabled after Undo')
  assert.equal((await comparePng()).changedPixels, 0, 'Undo restores the original exported pixel values')
  await evaluate("document.querySelector('[aria-label=\"Refazer\"]').click()")
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo') && new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-brightness-browser');get.onsuccess=()=>{db.close();resolve(get.result.pages[0].elements[0].brightness===20)};get.onerror=()=>reject(get.error)}})"), 'redone brightness saved as 20')
  assert.equal(await evaluate("!document.querySelector('[aria-label=\"Desfazer\"]')?.disabled"), true, 'Undo is available again after Redo')
  assert.ok((await comparePng()).changedPixels > 0, 'Redo restores the adjusted export pixels')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') || !!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'image design after brightness reload')
  if (await evaluate("!!document.querySelector('.project-open')")) await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') && !!document.querySelector('.inspector-panel')"), 'reopened brightness design')
  await evaluate("document.querySelector('.layer-row').click()")
  await waitFor(() => evaluate("document.querySelector('#image-inspector-brightness-slider')?.value==='20'"), 'restored brightness slider')
  const restoredControls = await evaluate("(()=>({slider:document.querySelector('#image-inspector-brightness-slider')?.value,number:document.querySelector('.image-adjustment-control input[role=spinbutton]')?.value}))()")
  assert.deepEqual([restoredControls.slider, restoredControls.number], ['20', '20'], `brightness slider and numeric field both restore at 20 after reload/reopen: ${JSON.stringify(restoredControls)}`)
  assert.equal(await evaluate("!document.querySelector('.image-adjustment-heading button')?.disabled"), true, 'reset adjustments is enabled after restoring brightness 20')
  const metrics = await comparePng()
  assert.deepEqual([metrics.width, metrics.height], [2400, 2400])
  assert.ok(metrics.pngBytes > 1000, 'adjusted PNG data is nonempty')
  assert.ok(metrics.changedPixels > 0, 'the reopened image emits changed PNG pixels')
  assert.ok(metrics.meanChannelDelta > 0, 'the reopened brightness result increases mean RGB for this fixture')
  await evaluate("document.querySelector('.image-quick-toolbar button')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-edit-panel .image-tool-gallery')"), 'image tool gallery')
  await evaluate("document.querySelector('.image-tool-card')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-auto-adjust')"), 'automatic adjustment control')
  await evaluate("document.querySelector('.image-auto-adjust').click()")
  await waitFor(() => evaluate("document.querySelector('.image-edit-notice')?.textContent.startsWith('Ajuste aplicado:')"), 'automatic adjustment result')
  const automaticNotice = await evaluate("document.querySelector('.image-edit-notice').textContent")
  const automaticValues = automaticNotice.match(/brilho (-?\d+), contraste (-?\d+), saturação (-?\d+)/)?.slice(1).map(Number)
  assert.ok(automaticValues?.length === 3, `automatic adjustment announces its calculated values: ${automaticNotice}`)
  await waitFor(() => evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-brightness-browser');get.onsuccess=()=>{db.close();const item=get.result.pages[0].elements[0];resolve([item.brightness??0,item.contrast??0,item.saturation??0].every((value,index)=>value===${JSON.stringify(automaticValues)}[index]))};get.onerror=()=>reject(get.error)}})`), 'automatic adjustment persisted')
  const automatic = await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-brightness-browser');get.onsuccess=()=>{db.close();const item=get.result.pages[0].elements[0];resolve({brightness:item.brightness??0,contrast:item.contrast??0,saturation:item.saturation??0})};get.onerror=()=>reject(get.error)}})`)
  assert.ok(automatic.brightness !== 20 || automatic.contrast !== 0 || automatic.saturation !== 0, `automatic adjustment derives and saves pixel-based changes: ${JSON.stringify(automatic)}, notice=${await evaluate("document.querySelector('.image-edit-notice')?.textContent")}`)
  assert.ok(automatic.brightness >= -100 && automatic.brightness <= 100 && automatic.contrast >= -100 && automatic.contrast <= 100 && automatic.saturation >= -100 && automatic.saturation <= 100)
  console.log(`PASS image-brightness-undo-redo-roundtrip, local automatic image adjustment and PNG output ${JSON.stringify({ metrics, automatic })}`)
} finally {
  pageSocket?.close()
  browserSocket?.close()
  await stop(chrome)
  await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-image-brightness-browser-')) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { await rm(resolvedProfile, { recursive: true, force: true }); break } catch { await delay(100) }
    }
  }
}
