import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the audio waveform browser test.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 20_000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) }; throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(4000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-audio-waveform-'))
const wavPath = path.join(profileDir, 'waveform-tone.wav')
const sampleRate = 8000
const sampleCount = sampleRate * 2
const wav = Buffer.alloc(44 + sampleCount * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(sampleCount * 2, 40)
for (let index = 0; index < sampleCount; index += 1) {
  const beatPhase = index % (sampleRate / 4)
  const pulse = beatPhase < sampleRate / 40 ? Math.sin(2 * Math.PI * 440 * index / sampleRate) * 18_000 : 0
  wav.writeInt16LE(Math.round(pulse), 44 + index * 2)
}
await writeFile(wavPath, wav)
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let requestId = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const id = ++requestId; const result = new Promise(resolve => pending.set(id, resolve)); pageSocket.send(JSON.stringify({ id, method, params })); return result }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await waitFor(() => evaluate("!!document.querySelector('.home-shell')&&!![...document.querySelectorAll('.home-category-row button')].find(button=>button.innerText.includes('Vídeo'))"), 'video creation shortcut')
  await evaluate("[...document.querySelectorAll('.home-category-row button')].find(button=>button.innerText.includes('Vídeo')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.video-timeline')"), 'video editor')
  await send('DOM.enable')
  const root = await send('DOM.getDocument', { depth: 1 })
  const input = await send('DOM.querySelector', { nodeId: root.result.root.nodeId, selector: 'input[aria-label="Adicionar vídeo ou áudio à timeline"]' })
  assert.ok(input.result.nodeId, 'timeline exposes the audio upload input')
  await send('DOM.setFileInputFiles', { files: [wavPath], nodeId: input.result.nodeId })
  await waitFor(() => evaluate("!!document.querySelector('.video-media-row.audio')&&document.querySelector('audio')?.readyState>=1"), 'audio source decodes')
  await waitFor(() => evaluate("document.querySelectorAll('.audio-waveform rect').length===72"), 'valid audio draws 72 waveform peaks')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]')?.getAttribute('aria-pressed')"), 'false', 'rhythm markers start hidden for the session')
  await evaluate("document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]').click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]')?.getAttribute('aria-pressed')==='true'&&document.querySelectorAll('.audio-beat-marker').length>0"), 'estimated rhythm markers appear when enabled')
  await evaluate("document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]').click()")
  assert.equal(await evaluate("document.querySelectorAll('.audio-beat-marker').length"), 0, 'turning rhythm markers off removes the overlay')
  async function setNumber(label, value) { await evaluate(`(()=>{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`) }
  await setNumber('Início da mídia de waveform-tone.wav em segundos', 0.3)
  await setNumber('Fade de entrada de waveform-tone.wav em segundos', 0.2)
  await setNumber('Fade de saída de waveform-tone.wav em segundos', 0.3)
  await waitFor(() => evaluate("document.querySelector('[aria-label=\"Início da mídia de waveform-tone.wav em segundos\"]')?.value==='0.3'&&document.querySelectorAll('.audio-waveform rect').length===72"), 'changing source trim redraws its waveform')
  await waitFor(() => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'trim and audio source autosave')
  await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});await new Promise((resolve,reject)=>{const transaction=db.transaction('documents','readwrite');const store=transaction.objectStore('documents');const request=store.getAll();request.onsuccess=()=>{const doc=request.result.find(item=>item.name==='Vídeo sem título');if(!doc){transaction.abort();reject(new Error('video project missing'));return}doc.pages[0].timelineClips=(doc.pages[0].timelineClips??[]).map(clip=>clip.name==='waveform-tone.wav'?{...clip,startMs:clip.startMs+500}:clip);doc.pages[0].timelineClips=[...(doc.pages[0].timelineClips??[]),{id:'missing-waveform-clip',assetId:'missing-audio-asset',name:'missing.wav',kind:'audio',startMs:3000,durationMs:1000,sourceDurationMs:1000,sourceStartMs:0,volume:1}];store.put(doc)};transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)});db.close()})()`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.video-timeline')"), 'video editor restored after reload')
  await waitFor(() => evaluate("document.querySelectorAll('.audio-waveform rect').length===72"), 'valid audio waveform redraws after reload')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]')?.getAttribute('aria-pressed')"), 'false', 'display preference resets after reload')
  await evaluate("document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]').click()")
  await waitFor(() => evaluate("document.querySelectorAll('.audio-beat-marker').length>0"), 'markers can be shown again after reload')
  const markerMapping = await evaluate("(()=>{const svg=document.querySelector('.audio-waveform');const marker=document.querySelector('.audio-beat-marker');return {sourceStartMs:Number(svg.dataset.sourceStartMs),clipStartMs:Number(svg.dataset.clipStartMs),durationMs:Number(svg.dataset.clipDurationMs),sourceTimeMs:Number(marker.dataset.sourceTimeMs),timelineTimeMs:Number(marker.dataset.timelineTimeMs)}})()")
  assert.ok(markerMapping.sourceTimeMs >= markerMapping.sourceStartMs && markerMapping.sourceTimeMs <= markerMapping.sourceStartMs + markerMapping.durationMs, 'beat markers stay inside the selected source trim')
  const markerOffset = markerMapping.sourceTimeMs - markerMapping.sourceStartMs
  assert.ok(Math.abs(markerMapping.timelineTimeMs - (markerMapping.clipStartMs + markerOffset)) < 0.001, 'beat markers follow the current timeline start and duration')
  assert.ok(markerMapping.clipStartMs >= 500, 'test fixture moves the audio clip on the timeline before reload')
  assert.equal(await evaluate("!!document.querySelector('.video-media-row.audio .audio-waveform-fallback')&&document.querySelector('[aria-label=\"Início da mídia de waveform-tone.wav em segundos\"]')?.value==='0.3'&&document.querySelector('[aria-label=\"Fade de entrada de waveform-tone.wav em segundos\"]')?.value==='0.2'&&document.querySelector('[aria-label=\"Fade de saída de waveform-tone.wav em segundos\"]')?.value==='0.3'"), true, 'reload restores trim and fade values and renders a fallback for missing audio')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobileWave = await waitFor(() => evaluate("(()=>{const bounds=document.querySelector('.audio-waveform')?.getBoundingClientRect();return bounds&&bounds.width>0?{left:bounds.left,right:bounds.right,width:bounds.width,viewport:innerWidth}:null})()"), 'mobile waveform layout')
  assert.ok(mobileWave.left >= -1 && mobileWave.right <= mobileWave.viewport + 1, `waveform fits mobile viewport (${JSON.stringify(mobileWave)})`)
  const mobileToggle = await evaluate("(()=>{const button=document.querySelector('[aria-label=\"Exibir marcadores de ritmo\"]');const rect=button.getBoundingClientRect();return {left:rect.left,right:rect.right,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,pressed:button.getAttribute('aria-pressed')}})()")
  assert.ok(mobileToggle.left >= -1 && mobileToggle.right <= mobileToggle.viewport + 1 && mobileToggle.scrollWidth <= mobileToggle.viewport + 1, `rhythm control fits mobile without page overflow (${JSON.stringify(mobileToggle)})`)
  await send('Emulation.clearDeviceMetricsOverride')
  console.log('PASS rhythm markers toggle over decoded audio, reset on reload, re-enable, and fit a 390px viewport without page overflow')
} finally {
  pageSocket?.close(); browserSocket?.close()
  await stop(chrome); await stop(vite); await rm(profileDir, { recursive: true, force: true })
}
