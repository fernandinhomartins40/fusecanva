import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of candidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge não encontrado para o ensaio de split do vídeo.')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 25_000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(120) }; throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { try { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(4000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const webPort = await freePort(); let cdpPort = await freePort(); while (cdpPort === webPort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-video-split-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${webPort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${webPort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${webPort}`)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const response = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return response }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  async function storedClips(documentId) { return evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{return await new Promise((resolve,reject)=>{const r=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});r.onsuccess=()=>resolve(r.result?.pages?.[0]?.timelineClips??null);r.onerror=()=>reject(r.error)})}finally{db.close()}})()`) }
  async function waitForClips(documentId, predicate, label) { return waitFor(async () => { const clips = await storedClips(documentId); return clips && predicate(clips) ? clips : null }, label) }

  await waitFor(() => evaluate("!!document.querySelector('.home-shell')&&!![...document.querySelectorAll('.home-category-row button')].find(button=>button.innerText.includes('Vídeo'))"), 'video project shortcut')
  await evaluate("[...document.querySelectorAll('.home-category-row button')].find(button=>button.innerText.includes('Vídeo')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.video-timeline')"), 'new video editor')
  const documentId = await evaluate("decodeURIComponent(location.pathname.split('/')[2])")
  const original = { id: 'split-source', assetId: 'unavailable-audio-fixture', name: 'REA split audio', kind: 'audio', startMs: 2500, durationMs: 10000, sourceDurationMs: 15000, sourceStartMs: 1000, volume: 0.5 }
  await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const doc=await new Promise((resolve,reject)=>{const r=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});doc.pages[0].timelineClips=[${JSON.stringify(original)}];await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(doc);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}finally{db.close()}})()`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.video-timeline .video-media-row.audio')"), 'editor restores the seeded audio clip')
  assert.deepEqual(await storedClips(documentId), [original], 'the fixture starts with one unmodified source interval')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobileTimeline = await evaluate("(()=>{const timeline=document.querySelector('.video-timeline'),row=timeline?.querySelector('.video-media-row.audio'),split=timeline?.querySelector('[aria-label=\"Dividir clipe selecionado\"]');return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,timelineWidth:timeline?.clientWidth,timelineScrollWidth:timeline?.scrollWidth,timelineHeight:timeline?.clientHeight,timelineScrollHeight:timeline?.scrollHeight,splitVisible:!!split&&split.getBoundingClientRect().height>0,rowWidth:row?.getBoundingClientRect().width}})()")
  assert.equal(mobileTimeline.width, 390)
  assert.ok(mobileTimeline.documentWidth <= 390 && mobileTimeline.bodyWidth <= 390, `mobile video editor has no document-level horizontal overflow: ${JSON.stringify(mobileTimeline)}`)
  assert.ok(mobileTimeline.timelineWidth <= 390 && mobileTimeline.timelineScrollWidth <= mobileTimeline.timelineWidth, `timeline controls stay inside its own horizontal bounds: ${JSON.stringify(mobileTimeline)}`)
  assert.ok(mobileTimeline.timelineScrollHeight > mobileTimeline.timelineHeight, 'the mobile timeline uses its own vertical scroll region for track controls')
  assert.ok(mobileTimeline.splitVisible && mobileTimeline.rowWidth <= mobileTimeline.timelineWidth, 'split action and audio track remain reachable within the narrow timeline')
  const nestedTimelineControl = await evaluate("(()=>{const timeline=document.querySelector('.video-timeline');timeline.scrollTop=timeline.scrollHeight;const input=timeline.querySelector('[aria-label^=\"Início da mídia\"]');const r=input.getBoundingClientRect(),t=timeline.getBoundingClientRect();return{scrollTop:timeline.scrollTop,reachable:r.bottom>t.top&&r.top<t.bottom}})()")
  assert.ok(nestedTimelineControl.scrollTop > 0 && nestedTimelineControl.reachable, `deep clip controls can be reached by scrolling the timeline: ${JSON.stringify(nestedTimelineControl)}`)
  await evaluate("document.querySelector('.video-timeline').scrollTop=0")
  await evaluate("document.querySelector('[aria-label=\"Selecionar clipe REA split audio\"]').click()")
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Posição da reprodução\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'7000');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Posição da reprodução\"]')?.value==='7000'&&document.querySelector('[aria-label=\"Dividir clipe selecionado\"]')?.disabled===false"), 'playhead enables an interior clip split')
  await evaluate("document.querySelector('[aria-label=\"Dividir clipe selecionado\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.video-timeline .video-media-row.audio').length===2"), 'split renders two contiguous audio segments')
  const splitClips = await waitForClips(documentId, clips => clips.length === 2 && clips[1].sourceStartMs === 5500, 'split autosaves source intervals')
  assert.equal(splitClips[0].id, original.id)
  assert.equal(splitClips[0].startMs, 2500)
  assert.equal(splitClips[0].durationMs, 4500)
  assert.equal(splitClips[0].sourceStartMs, 1000)
  assert.equal(splitClips[1].startMs, 7000)
  assert.equal(splitClips[1].durationMs, 5500)
  assert.equal(splitClips[1].sourceStartMs, 5500)
  assert.equal(splitClips[0].sourceStartMs + splitClips[0].durationMs, splitClips[1].sourceStartMs, 'segments exactly cover the original source interval')
  assert.equal(splitClips[0].volume, original.volume)
  assert.equal(splitClips[1].volume, original.volume)
  assert.notEqual(splitClips[1].id, original.id)

  await evaluate("document.querySelector('[aria-label=\"Desfazer\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.video-timeline .video-media-row.audio').length===1"), 'Undo restores one visible audio segment')
  assert.deepEqual(await waitForClips(documentId, clips => clips.length === 1 && clips[0].durationMs === original.durationMs, 'Undo autosaves original source segment'), [original])
  await evaluate("document.querySelector('[aria-label=\"Refazer\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.video-timeline .video-media-row.audio').length===2"), 'Redo restores both segments')
  const redoneClips = await waitForClips(documentId, clips => clips.length === 2 && clips[1].sourceStartMs === 5500, 'Redo autosaves source intervals')
  assert.deepEqual(redoneClips, splitClips, 'Redo restores the exact segment IDs, timings and source offsets')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.video-timeline')&&document.querySelectorAll('.video-timeline .video-media-row.audio').length===2"), 'reload restores both split segments on the direct editor route')
  assert.deepEqual(await storedClips(documentId), splitClips, 'the split survives a direct route reload with the same source intervals')
  const mobileFadeControls = await evaluate("(()=>{const timeline=document.querySelector('.video-timeline'),row=timeline.querySelector('.video-media-row.audio'),range=row.querySelector('.video-audio-fade-control input[type=range][aria-label=\\\"Entrada gradual\\\"]'),number=row.querySelector('.video-audio-fade-control input[type=number][aria-label=\\\"Entrada gradual\\\"]');range.scrollIntoView({block:'center'});const tr=timeline.getBoundingClientRect(),rr=range.getBoundingClientRect(),nr=number.getBoundingClientRect();return{rangeHeight:rr.height,numberHeight:nr.height,rangeInside:rr.top>=tr.top&&rr.bottom<=tr.bottom,numberInside:nr.top>=tr.top&&nr.bottom<=tr.bottom,numberWidth:nr.width}})()")
  assert.ok(mobileFadeControls.rangeHeight >= 44 && mobileFadeControls.numberHeight >= 44, `mobile audio fade controls meet the 44px touch target: ${JSON.stringify(mobileFadeControls)}`)
  assert.ok(mobileFadeControls.rangeInside && mobileFadeControls.numberInside && mobileFadeControls.numberWidth >= 48, `both fade controls remain reachable within the mobile timeline: ${JSON.stringify(mobileFadeControls)}`)
  await evaluate("(()=>{const row=document.querySelector('.video-timeline .video-media-row.audio'),field=row.querySelector('.video-audio-fade-control input[type=number][aria-label=\\\"Entrada gradual\\\"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;field.focus();setter.call(field,'1.2');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})()")
  const fadedClips = await waitForClips(documentId, clips => clips[0]?.fadeInMs === 1200, 'mobile keyboard commit saves the audio fade')
  assert.equal(fadedClips[0].fadeInMs, 1200, 'Enter commits the numeric fade value')
  await evaluate("(()=>{const row=document.querySelector('.video-timeline .video-media-row.audio');row.querySelectorAll('.video-audio-fade-control input[type=number]')[1].focus()})()")
  await evaluate("(()=>{const row=document.querySelector('.video-timeline .video-media-row.audio'),field=row.querySelectorAll('.video-audio-fade-control input[type=number]')[1],setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,'9');field.dispatchEvent(new Event('input',{bubbles:true}));field.blur()})()")
  const clampedFadeClips = await waitForClips(documentId, clips => clips[0]?.fadeOutMs === clips[0]?.durationMs, 'mobile blur commit clamps the exit fade to the clip duration')
  assert.equal(clampedFadeClips[0].fadeOutMs, clampedFadeClips[0].durationMs, 'fade-out cannot exceed the source segment duration')
  await send('Page.reload')
  await waitFor(() => evaluate("document.querySelector('.video-timeline .video-media-row.audio .video-audio-fade-control input[type=number][aria-label=\\\"Entrada gradual\\\"]')?.value==='1.2'"), 'mobile fade values restore after reload')
  assert.equal((await storedClips(documentId))[0].fadeInMs, 1200, 'the fade edit persists through reload')
  const curveClip = {
    id: 'keyframe-easing-video', assetId: 'missing-video-curve-fixture', name: 'Curvas por segmento', kind: 'video',
    startMs: 0, durationMs: 2000, sourceDurationMs: 2000, sourceStartMs: 0, volume: 0, trackIndex: 2,
    opacityKeyframes: [{ timeMs: 0, opacity: 0 }, { timeMs: 1000, opacity: 100 }],
    transformKeyframes: [{ timeMs: 0, scale: 100, offsetX: 0, offsetY: 0 }, { timeMs: 1000, scale: 200, offsetX: 40, offsetY: -20 }],
  }
  await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const doc=await new Promise((resolve,reject)=>{const r=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});doc.pages[0].timelineClips.push(${JSON.stringify(curveClip)});await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(doc);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}finally{db.close()}})()`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Selecionar clipe Curvas por segmento\"]')"), 'keyframed video clip restored')
  await evaluate("document.querySelector('[aria-label=\"Selecionar clipe Curvas por segmento\"]').click()")
  const opacityEasing = '[aria-label="Curva de opacidade entre quadros de Curvas por segmento"]'
  const transformEasing = '[aria-label="Curva de enquadramento entre quadros de Curvas por segmento"]'
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(opacityEasing)}) && !!document.querySelector(${JSON.stringify(transformEasing)}) && !document.querySelector(${JSON.stringify(opacityEasing)}).disabled && !document.querySelector(${JSON.stringify(transformEasing)}).disabled`), 'per-segment easing selectors enabled at a keyframe with a successor')
  await evaluate(`(()=>{for(const [selector,value] of [[${JSON.stringify(opacityEasing)},'ease-in'],[${JSON.stringify(transformEasing)},'ease-out']]){const select=document.querySelector(selector),setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}))}})()`)
  const easedClips = await waitForClips(documentId, clips => clips.some(clip => clip.id === curveClip.id && clip.opacityKeyframes?.[0]?.easing === 'ease-in' && clip.transformKeyframes?.[0]?.easing === 'ease-out'), 'segment easing autosaves to the document')
  const savedCurveClip = easedClips.find(clip => clip.id === curveClip.id)
  assert.equal(savedCurveClip.opacityKeyframes[0].easing, 'ease-in')
  assert.equal(savedCurveClip.transformKeyframes[0].easing, 'ease-out')
  await send('Page.reload')
  await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(opacityEasing)})?.value==='ease-in' && document.querySelector(${JSON.stringify(transformEasing)})?.value==='ease-out'`), 'segment easing selectors restore after reload')
  assert.equal((await storedClips(documentId)).find(clip => clip.id === curveClip.id).opacityKeyframes[0].easing, 'ease-in')
  console.log(`PASS video timeline: 390x844 layout, split/Undo/Redo, 44px fade controls, keyboard commit, duration clamp, reload persistence and per-segment easing`)
} finally {
  pageSocket?.close(); browserSocket?.close()
  await stop(chrome); await stop(vite)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 9) console.warn(`Temporary Chrome profile cleanup deferred: ${error.message}`); else await delay(200) }
  }
}
