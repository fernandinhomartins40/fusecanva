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
const gifOnly = process.argv.includes('--gif-only')
const throttled = process.argv.includes('--throttled')
const stressGif = process.argv.includes('--stress-gif')
const viteEntry = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

async function getChrome() {
  for (const candidate of chromeCandidates) {
    try { await access(candidate, constants.X_OK); return candidate } catch {}
  }
  throw new Error('Chrome/Edge not found. Set CHROME_PATH to run this browser test.')
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
  await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 3000); child.once('exit', () => { clearTimeout(timer); resolve() }) })
}

const chromePath = await getChrome()
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-image-animation-browser-'))
let vite
let chrome
let browserSocket
let pageSocket

try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
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
    if (!response.result) throw new Error(`CDP Runtime.evaluate failed: ${JSON.stringify(response)}`)
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
    return response.result.result.value
  }

  const mp4EncoderSupport = await evaluate("['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.42E01E','video/mp4'].map(type=>({type,supported:MediaRecorder.isTypeSupported(type)}))")
  assert.ok(mp4EncoderSupport.some(entry => entry.supported), `the test browser exposes an MP4 MediaRecorder encoder: ${JSON.stringify(mp4EncoderSupport)}`)

  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  let artifact
  let audioArtifact
  if (!gifOnly) {
  const wavSampleRate = 44100
  const wavDurationSeconds = 5
  const wavSamples = wavSampleRate * wavDurationSeconds
  const wavBuffer = Buffer.alloc(44 + wavSamples * 2)
  wavBuffer.write('RIFF', 0); wavBuffer.writeUInt32LE(wavBuffer.length - 8, 4); wavBuffer.write('WAVE', 8)
  wavBuffer.write('fmt ', 12); wavBuffer.writeUInt32LE(16, 16); wavBuffer.writeUInt16LE(1, 20); wavBuffer.writeUInt16LE(1, 22)
  wavBuffer.writeUInt32LE(wavSampleRate, 24); wavBuffer.writeUInt32LE(wavSampleRate * 2, 28); wavBuffer.writeUInt16LE(2, 32); wavBuffer.writeUInt16LE(16, 34)
  wavBuffer.write('data', 36); wavBuffer.writeUInt32LE(wavSamples * 2, 40)
  for (let index = 0; index < wavSamples; index++) wavBuffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / wavSampleRate) * 10000), 44 + index * 2)
  const wavDataUrl = `data:audio/wav;base64,${wavBuffer.toString('base64')}`
  const seedDocument = {
    id: 'image-animation-browser', name: 'Animation fixture', type: 'design', width: 794, height: 794, updatedAt: new Date().toISOString(),
    pages: [{ id: 'page-1', name: 'Page 1', background: '#ffffff', elements: [{
      id: 'image-1', type: 'image', name: 'Animated image', src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%23e33"/%3E%3C/svg%3E',
      x: 200, y: 200, width: 394, height: 394, rotation: 0, sourceWidth: 100, sourceHeight: 100,
    }] }],
  }
  const audioAsset = { id: 'audio-fixture-1', name: '440 Hz test tone.wav', mimeType: 'audio/wav', width: 1, height: 1, src: wavDataUrl, createdAt: new Date().toISOString() }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['documents','assets'],'readwrite');tx.objectStore('documents').put(${JSON.stringify(seedDocument)});tx.objectStore('assets').put(${JSON.stringify(audioAsset)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded image project')
  await evaluate("document.querySelector('.project-open').click()")
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') && !!document.querySelector('.inspector-panel')"), 'image editor')
  await evaluate("document.querySelector('.layer-row').click()")
  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Animar').click()")
  await waitFor(() => evaluate("!!document.querySelector('.image-animation-editor .image-animation-effect')"), 'image animation controls')
  await evaluate("document.querySelector('.image-animation-effect').click()")
  const setSelect = async (labelPrefix, value) => evaluate(`(()=>{const input=document.querySelector('select[aria-label^='+JSON.stringify(${JSON.stringify(labelPrefix)})+']');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await setSelect('Momento', 'enter')
  await setSelect('Velocidade', 'slow')
  await setSelect('Dire', 'down')
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo')"), 'animation settings saved')
  const configured = await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('image-animation-browser');get.onsuccess=()=>{db.close();resolve(get.result.pages[0].elements[0].animation)};get.onerror=()=>reject(get.error)}})")
  assert.deepEqual(configured, { effect: 'elevation', phase: 'enter', speed: 'slow', direction: 'down' }, 'the elevation configuration persists in the design model')
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.layer-row') && window.location.pathname==='/design/image-animation-browser/edit'"), 'animation editor restored at its direct route')
  await evaluate("document.querySelector('.layer-row').click()")
  await evaluate("[...document.querySelectorAll('.image-quick-toolbar button')].find(button=>button.textContent.trim()==='Animar').click()")
  await waitFor(() => evaluate("document.querySelector('.image-animation-effect')?.getAttribute('aria-pressed')==='true'"), 'restored animation configuration')
  assert.deepEqual(await evaluate("(()=>{const values=[...document.querySelectorAll('.image-animation-editor select')].map(select=>select.value);return{phase:values[0],speed:values[1],direction:values[2]}})()"), { phase: 'enter', speed: 'slow', direction: 'down' }, 'the configured controls restore after reload')

  await evaluate("document.querySelector('.image-animation-preview-row button').click()")
  await waitFor(() => evaluate("Number(document.querySelector('[aria-label=\"Progresso da animação\"]').value.replace('%',''))>0"), 'animation preview advances')
  await evaluate("document.querySelector('.image-animation-preview-row button').click()")
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo')"), 'preview pause settles')
  const exportSelect = "document.querySelector('.export-format')"
  await evaluate(`(()=>{const field=${exportSelect};const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(field,'mp4');field.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await evaluate("window.__exportBlobs=[];window.__exportDownloads=[];const originalCreateObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{const url=originalCreateObjectURL(blob);window.__exportBlobs.push({blob,url});return url};const originalLinkClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exportDownloads.push(this.download);return originalLinkClick.call(this)}")
  await evaluate("(()=>{window.__captureTiming={frames:[]};const originalCapture=HTMLCanvasElement.prototype.captureStream;HTMLCanvasElement.prototype.captureStream=function(...args){const stream=originalCapture.apply(this,args);const track=stream.getVideoTracks()[0];if(track?.requestFrame){const request=track.requestFrame.bind(track);track.requestFrame=()=>{window.__captureTiming.frames.push(performance.now());return request()}}return stream};const start=MediaRecorder.prototype.start,stop=MediaRecorder.prototype.stop;MediaRecorder.prototype.start=function(...args){window.__captureTiming.start=performance.now();return start.apply(this,args)};MediaRecorder.prototype.stop=function(...args){window.__captureTiming.stop=performance.now();return stop.apply(this,args)}})()")
  if (throttled) await send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await evaluate("document.querySelector('.export-button').click()")
  const exportOutcome = await waitFor(() => evaluate("window.__exportBlobs.length===1 ? 'complete' : document.querySelector('.export-error')?.textContent || false"), 'MP4 animation export completes', 30000)
  assert.equal(exportOutcome, 'complete', `animation MP4 export status: ${exportOutcome}`)
  artifact = await evaluate(`(async()=>{const {blob,url}=window.__exportBlobs[0];const bytes=new Uint8Array(await blob.slice(0,12).arrayBuffer());const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('MP4 did not decode: '+video.error?.message));setTimeout(()=>reject(new Error('MP4 metadata timeout')),10000)});const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});const sample=async time=>{video.currentTime=time;await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=()=>reject(new Error('MP4 seek failed'))});ctx.drawImage(video,0,0);return [...ctx.getImageData(1200,1200,1,1).data]};const early=await sample(.1);const late=await sample(4.8);return{type:blob.type,size:blob.size,signature:[...bytes],width:video.videoWidth,height:video.videoHeight,duration:video.duration,early,late,download:window.__exportDownloads[0]}})()`)
  assert.ok(artifact.size > 5000, 'the browser produces non-empty MP4 bytes')
  assert.ok(artifact.type.startsWith('video/mp4'), `the Blob identifies its actual MP4 MIME type, got ${artifact.type}`)
  assert.equal(String.fromCharCode(...artifact.signature.slice(4, 8)), 'ftyp', 'the exported data uses an ISO BMFF MP4 container signature')
  assert.ok(artifact.download.endsWith('.mp4'), `the downloaded file extension matches the MP4 container, got ${artifact.download}`)
  assert.equal(artifact.width, 2400, 'the animation export uses the audited 2400px maximum edge')
  assert.equal(artifact.height, 2400, 'the square animation export is 2400px high')
  const captureTiming = await evaluate("(()=>{const t=window.__captureTiming;return {start:t.start,stop:t.stop,first:t.frames[0],last:t.frames.at(-1),frames:t.frames.length}})()")
  assert.ok(artifact.duration >= 4.5 && artifact.duration <= 5.5, `five-second animation export stays within half a second in the browser encoder, got ${artifact.duration}; timing=${JSON.stringify(captureTiming)}`)
  assert.ok(artifact.early[0] > 220 && artifact.early[1] > 220 && artifact.late[0] > 180 && artifact.late[1] < 100, `decoded animation shows the image fade from the background to its source color: ${JSON.stringify({ early: artifact.early, late: artifact.late })}`)
  const audioProject = { id: 'audio-export-browser', name: 'Audio export fixture', type: 'video', width: 160, height: 90, videoDurationMs: 5000, updatedAt: new Date().toISOString(), pages: [{ id: 'audio-page', name: 'Scene', background: '#28243f', elements: [], timelineClips: [{ id: 'audio-1', assetId: 'audio-fixture-1', name: '440 Hz test tone.wav', kind: 'audio', startMs: 0, durationMs: 5000, sourceDurationMs: 5000, sourceStartMs: 0, volume: 0.8 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(audioProject)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await evaluate("window.location.href='/design/audio-export-browser/edit'")
  await waitFor(() => evaluate("window.location.pathname==='/design/audio-export-browser/edit' && !!document.querySelector('.export-button')"), 'audio-only video editor', 20000)
  await evaluate(`(()=>{const field=document.querySelector('.export-format');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(field,'mp4');field.dispatchEvent(new Event('change',{bubbles:true}));window.__exportBlobs=[];window.__exportDownloads=[];const originalCreateObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=originalCreateObjectURL(blob);window.__exportBlobs.push({blob,url});return url};const originalLinkClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exportDownloads.push(this.download);return originalLinkClick.call(this)}})()`)
  await evaluate("(()=>{window.__captureTiming={frames:[]};const originalCapture=HTMLCanvasElement.prototype.captureStream;HTMLCanvasElement.prototype.captureStream=function(...args){const stream=originalCapture.apply(this,args);const track=stream.getVideoTracks()[0];if(track?.requestFrame){const request=track.requestFrame.bind(track);track.requestFrame=()=>{window.__captureTiming.frames.push(performance.now());return request()}}return stream};const start=MediaRecorder.prototype.start,stop=MediaRecorder.prototype.stop;MediaRecorder.prototype.start=function(...args){window.__captureTiming.start=performance.now();return start.apply(this,args)};MediaRecorder.prototype.stop=function(...args){window.__captureTiming.stop=performance.now();return stop.apply(this,args)}})()")
  await evaluate("document.querySelector('.export-button').click()")
  const audioExportOutcome = await waitFor(() => evaluate("window.__exportBlobs.length===1 ? 'complete' : document.querySelector('.export-error')?.textContent || false"), 'audio-bearing MP4 export completes', 30000)
  assert.equal(audioExportOutcome, 'complete', `audio-bearing MP4 export status: ${audioExportOutcome}`)
  audioArtifact = await evaluate(`(async()=>{const {blob,url}=window.__exportBlobs[0];const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('audio MP4 did not decode: '+video.error?.message));setTimeout(()=>reject(new Error('audio MP4 metadata timeout')),10000)});const context=new AudioContext();try{const decoded=await context.decodeAudioData(await blob.arrayBuffer());const samples=decoded.getChannelData(0);let square=0;let peak=0;for(let i=0;i<samples.length;i++){square+=samples[i]*samples[i];peak=Math.max(peak,Math.abs(samples[i]))}return{type:blob.type,size:blob.size,container:[...new Uint8Array(await blob.slice(4,8).arrayBuffer())],download:window.__exportDownloads[0],videoDuration:video.duration,audioDuration:decoded.duration,sampleRate:decoded.sampleRate,channels:decoded.numberOfChannels,rms:Math.sqrt(square/samples.length),peak}}finally{await context.close()}})()`)
  assert.ok(audioArtifact.size > 5000, 'the browser produces a non-empty audio-bearing MP4')
  assert.ok(audioArtifact.type.startsWith('video/mp4'), `the audio export is identified as MP4, got ${audioArtifact.type}`)
  assert.equal(String.fromCharCode(...audioArtifact.container), 'ftyp', 'the audio export uses an ISO BMFF container')
  assert.ok(audioArtifact.download.endsWith('.mp4'), `audio export extension matches container: ${audioArtifact.download}`)
  const audioTiming = await evaluate("(()=>{const t=window.__captureTiming;return {start:t.start,stop:t.stop,first:t.frames[0],last:t.frames.at(-1),frames:t.frames.length}})()")
  assert.ok(audioArtifact.audioDuration >= 4.5 && audioArtifact.audioDuration <= 5.5, `the exported MP4 decodes to a five-second audio stream, got ${audioArtifact.audioDuration}; video=${audioArtifact.videoDuration}; timing=${JSON.stringify(audioTiming)}`)
  assert.ok(audioArtifact.channels >= 1 && audioArtifact.rms > 0.03 && audioArtifact.peak > 0.1, `the exported MP4 audio contains audible non-silent samples: ${JSON.stringify(audioArtifact)}`)

  }

  const movingVideo = await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d');const stream=canvas.captureStream(20);const mimeType=['video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));const recorder=new MediaRecorder(stream,{mimeType});const chunks=[];const done=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};recorder.onstop=()=>resolve(new Blob(chunks,{type:mimeType}))});recorder.start(100);const started=performance.now();await new Promise(resolve=>{const draw=()=>{context.fillStyle='#e32636';context.fillRect(0,0,160,90);context.fillStyle='#ffffff';context.fillRect(12+Math.floor((performance.now()-started)%1200/1200*100),22,36,42);if(performance.now()-started<3000)requestAnimationFrame(draw);else resolve()};draw()});recorder.stop();const blob=await done;stream.getTracks().forEach(track=>track.stop());const reader=new FileReader();const src=await new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});return{src,mimeType:blob.type}})()`)
  const videoAsset = { id: 'video-fixture-1', name: 'Moving source.webm', mimeType: movingVideo.mimeType, width: 160, height: 90, src: movingVideo.src, createdAt: new Date().toISOString() }
  const videoProject = { id: 'timeline-video-export-browser', name: 'Timeline video export fixture', type: 'video', width: 160, height: 90, videoDurationMs: 4000, updatedAt: new Date().toISOString(), pages: [{ id: 'video-page', name: 'Scene', background: '#263238', elements: [], timelineClips: [{ id: 'video-1', assetId: videoAsset.id, name: videoAsset.name, kind: 'video', startMs: 500, durationMs: 3000, sourceDurationMs: 3000, sourceStartMs: 0, volume: 0, trackIndex: 0 }] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['documents','assets'],'readwrite');tx.objectStore('documents').put(${JSON.stringify(videoProject)});tx.objectStore('assets').put(${JSON.stringify(videoAsset)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await evaluate("window.location.href='/design/timeline-video-export-browser/edit'")
  await waitFor(() => evaluate("window.location.pathname==='/design/timeline-video-export-browser/edit' && !!document.querySelector('.export-button')"), 'video timeline export editor', 20000)
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Selecionar clipe Moving source.webm\"]') && !!document.querySelector('video.video-media-preview')"), 'video clip media loaded in timeline', 20000)
  if (throttled && gifOnly) await send('Emulation.setCPUThrottlingRate', { rate: 8 })
  let videoArtifact
  if (!gifOnly) {
  await evaluate(`(()=>{const field=document.querySelector('.export-format');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(field,'mp4');field.dispatchEvent(new Event('change',{bubbles:true}));window.__exportBlobs=[];window.__exportDownloads=[];const originalCreateObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=originalCreateObjectURL(blob);window.__exportBlobs.push({blob,url});return url};const originalLinkClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exportDownloads.push(this.download);return originalLinkClick.call(this)}})()`)
  await evaluate("document.querySelector('.export-button').click()")
  const videoExportOutcome = await waitFor(() => evaluate("window.__exportBlobs.length===1 ? 'complete' : document.querySelector('.export-error')?.textContent || false"), 'video timeline MP4 export completes', 30000)
  assert.equal(videoExportOutcome, 'complete', `video timeline MP4 export status: ${videoExportOutcome}`)
  videoArtifact = await evaluate(`(async()=>{const {blob,url}=window.__exportBlobs[0];const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('timeline MP4 did not decode: '+video.error?.message));setTimeout(()=>reject(new Error('timeline MP4 metadata timeout')),10000)});const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});const sample=async(time,x,y)=>{video.currentTime=time;await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=()=>reject(new Error('timeline MP4 seek failed'))});ctx.drawImage(video,0,0);return [...ctx.getImageData(x,y,1,1).data]};return{type:blob.type,size:blob.size,duration:video.duration,width:video.videoWidth,height:video.videoHeight,download:window.__exportDownloads[0],before:await sample(.2,80,45),inside:await sample(1.2,2,2),moving:await sample(1.2,176,86),after:await sample(3.8,80,45)}})()`)
  assert.ok(videoArtifact.size > 3000, 'timeline video export produces non-empty MP4 bytes')
  assert.ok(videoArtifact.type.startsWith('video/mp4'), `timeline export is identified as MP4, got ${videoArtifact.type}`)
  assert.ok(videoArtifact.duration >= 3.5 && videoArtifact.duration <= 4.5, `timeline MP4 preserves the project duration: ${videoArtifact.duration}`)
  assert.ok(videoArtifact.width >= 160 && videoArtifact.height >= 90, 'timeline MP4 preserves the design canvas dimensions')
  assert.ok(videoArtifact.before[2] > videoArtifact.before[0], `before the clip, the exported frame shows the project background: ${JSON.stringify(videoArtifact.before)}`)
  assert.ok(videoArtifact.inside[0] > videoArtifact.inside[2], `during the clip, the exported frame shows source video: ${JSON.stringify(videoArtifact.inside)}`)
  assert.ok(videoArtifact.moving[0] > 180 && videoArtifact.moving[1] > 180 && videoArtifact.moving[2] > 180, `the source video's moving white marker is composited into the exported frame: ${JSON.stringify(videoArtifact.moving)}`)
  assert.ok(videoArtifact.after[2] > videoArtifact.after[0], `after the clip, the export returns to the project background: ${JSON.stringify(videoArtifact.after)}`)
  assert.ok(videoArtifact.download.endsWith('.mp4'), 'timeline video download uses the MP4 extension')
  } else {
    await evaluate("window.__exportBlobs=[];window.__exportDownloads=[];const originalCreateObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=originalCreateObjectURL(blob);window.__exportBlobs.push({blob,url});return url};const originalLinkClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exportDownloads.push(this.download);return originalLinkClick.call(this)}")
  }
  await waitFor(() => evaluate("!document.querySelector('.export-button').disabled"), 'video export controls are ready again')
  await evaluate("(()=>{const field=document.querySelector('.export-format');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(field,'gif');field.dispatchEvent(new Event('change',{bubbles:true}));window.__exportBlobs=[];window.__exportDownloads=[]})()")
  if (stressGif) await evaluate("(()=>{const original=CanvasRenderingContext2D.prototype.getImageData;window.__restoreGifRead=()=>{CanvasRenderingContext2D.prototype.getImageData=original};window.__slowGifReads=0;CanvasRenderingContext2D.prototype.getImageData=function(...args){if(this.canvas.width===160&&this.canvas.height===90){const end=performance.now()+160;while(performance.now()<end){}window.__slowGifReads++}return original.apply(this,args)}})()")
  await evaluate("document.querySelector('.export-button').click()")
  const gifOutcome = await waitFor(() => evaluate("window.__exportBlobs.length===1 ? 'complete' : document.querySelector('.export-error')?.textContent || false"), 'timeline GIF export completes', 60000)
  assert.equal(gifOutcome, 'complete', `timeline GIF export status: ${gifOutcome}`)
  if (stressGif) { assert.ok(await evaluate('window.__slowGifReads>0'), 'slow-frame fixture affected GIF capture'); await evaluate('window.__restoreGifRead()') }
  const gifArtifact = await evaluate(`(async()=>{const {blob}=window.__exportBlobs[0];const bytes=new Uint8Array(await blob.arrayBuffer());if(typeof ImageDecoder!=='function')throw new Error('ImageDecoder is required to verify animated GIF frames');const decoder=new ImageDecoder({data:bytes,type:'image/gif'});await decoder.tracks.ready;const track=decoder.tracks.selectedTrack;const width=bytes[6]+bytes[7]*256,height=bytes[8]+bytes[9]*256;const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});const targets=[200000,1200000,3800000],samples=[null,null,null];let duration=0;for(let index=0;index<track.frameCount;index++){const frame=(await decoder.decode({frameIndex:index})).image;const end=duration+(frame.duration??0);for(let i=0;i<targets.length;i++)if(samples[i]===null&&targets[i]>=duration&&targets[i]<end){ctx.drawImage(frame,0,0);samples[i]=[...ctx.getImageData(2,2,1,1).data]}duration=end;frame.close()}const result={type:blob.type,size:blob.size,signature:String.fromCharCode(...bytes.slice(0,6)),width,height,frames:track.frameCount,durationMs:duration/1000,download:window.__exportDownloads[0],samples,moduleLoaded:performance.getEntriesByType('resource').some(entry=>/gif-export/.test(entry.name))};decoder.close();return result})()`)
  assert.equal(gifArtifact.type, 'image/gif', 'timeline GIF uses its actual MIME type')
  assert.equal(gifArtifact.signature, 'GIF89a', 'timeline GIF has a valid GIF89a signature')
  assert.deepEqual([gifArtifact.width, gifArtifact.height], [videoProject.width, videoProject.height], 'timeline GIF preserves the scene dimensions at its native scale')
  assert.ok(gifArtifact.frames >= (stressGif ? 10 : 30) && (!stressGif || gifArtifact.frames < 30) && gifArtifact.size > 1000, `timeline GIF contains the expected encoded frames: ${JSON.stringify(gifArtifact)}`)
  assert.ok(gifArtifact.durationMs >= 3900 && gifArtifact.durationMs <= 4100, `decoded GIF preserves the four-second timeline: ${JSON.stringify(gifArtifact)}`)
  assert.ok(gifArtifact.download.endsWith('.gif') && gifArtifact.moduleLoaded, 'the GIF download and on-demand encoder module are used')
  assert.ok(gifArtifact.samples.every(Boolean) && gifArtifact.samples[0][2] > gifArtifact.samples[0][0] && gifArtifact.samples[1][0] > gifArtifact.samples[1][2] && gifArtifact.samples[2][2] > gifArtifact.samples[2][0], `decoded GIF frames preserve the timeline before, during and after the clip: ${JSON.stringify(gifArtifact)}`)
  console.log(gifOnly ? `PASS ${gifArtifact.frames}-frame timeline GIF decodes at ${gifArtifact.width}x${gifArtifact.height}` : `PASS elevation animation MP4 ${artifact.width}x${artifact.height}/${artifact.duration.toFixed(2)}s; audio MP4 RMS ${audioArtifact.rms.toFixed(3)}; timeline MP4 and ${gifArtifact.frames}-frame GIF decode at ${gifArtifact.width}x${gifArtifact.height}`)
} finally {
  pageSocket?.close()
  browserSocket?.close()
  await stop(chrome)
  await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-image-animation-browser-')) {
    for (let attempt = 0; ; attempt++) {
      try { await rm(resolvedProfile, { recursive: true, force: true }); break }
      catch (error) { if (attempt >= 4 || !['EBUSY', 'EPERM'].includes(error?.code)) { console.warn(`Could not remove temporary Chrome profile: ${error.message}`); break } await delay(300 * (attempt + 1)) }
    }
  }
}
