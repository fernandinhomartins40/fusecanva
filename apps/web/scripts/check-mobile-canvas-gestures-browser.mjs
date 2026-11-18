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
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
async function findChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH to run mobile canvas gesture checks.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { const { execFileSync } = await import('node:child_process'); try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 2000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const chromePath = await findChrome()
const vitePort = await freePort(), cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-mobile-canvas-gestures-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=390,844', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function readGestureState() { return evaluate("(()=>{const v=document.querySelector('.canvas-viewport');return v&&{zoom:Number(v.dataset.canvasZoom),x:Number(v.dataset.canvasOffsetX),y:Number(v.dataset.canvasOffsetY),wbZoom:Number(v.dataset.whiteboardZoom),wbX:Number(v.dataset.whiteboardPositionX),wbY:Number(v.dataset.whiteboardPositionY),selected:document.querySelectorAll('.layer-row.selected').length,box:v.getBoundingClientRect().toJSON()}})()") }
  async function dispatch(type, points) { await send('Input.dispatchTouchEvent', { type, touchPoints: points }) }
  const point = (x, y, id) => ({ x: Math.round(x), y: Math.round(y), id })
  async function stableGestureState(label) {
    let previous = ''
    let stableSince = 0
    return waitFor(async () => {
      const current = await readGestureState()
      if (!current || !Number.isFinite(current.zoom) || current.zoom <= 0) return null
      const signature = JSON.stringify([current.zoom, current.x, current.y, current.box.x, current.box.y, current.box.width, current.box.height])
      if (signature !== previous) { previous = signature; stableSince = Date.now(); return null }
      return Date.now() - stableSince >= 500 ? current : null
    }, `${label}: settled canvas transform`)
  }
  async function pinchAndCheck(label) {
    const before = await stableGestureState(label)
    const box = before.box
    const start = [{ x: box.left + box.width * 0.44, y: box.top + box.height * 0.48 }, { x: box.left + box.width * 0.56, y: box.top + box.height * 0.48 }]
    const midpoint = { x: (start[0].x + start[1].x) / 2, y: (start[0].y + start[1].y) / 2 }
    const startDistance = start[1].x - start[0].x
    const anchor = { x: (midpoint.x - box.left - before.x) / before.zoom, y: (midpoint.y - box.top - before.y) / before.zoom }
    await dispatch('touchStart', [point(start[0].x, start[0].y, 11)])
    await dispatch('touchStart', [point(start[0].x, start[0].y, 11), point(start[1].x, start[1].y, 12)])
    const movedMidpoint = { x: midpoint.x + 24, y: midpoint.y + 16 }
    const nextDistance = startDistance * 1.5
    const moved = [{ x: movedMidpoint.x - nextDistance / 2, y: movedMidpoint.y }, { x: movedMidpoint.x + nextDistance / 2, y: movedMidpoint.y }]
    await dispatch('touchMove', [point(moved[0].x, moved[0].y, 11), point(moved[1].x, moved[1].y, 12)])
    await waitFor(async () => { const current = await readGestureState(); return current && Math.abs(current.zoom - before.zoom) > 0.03 ? current : null }, `${label}: pinch changes zoom`)
    await delay(120)
    const current = await readGestureState()
    const currentMidpoint = { x: (moved[0].x + moved[1].x) / 2, y: (moved[0].y + moved[1].y) / 2 }
    const afterAnchor = { x: (currentMidpoint.x - box.left - current.x) / current.zoom, y: (currentMidpoint.y - box.top - current.y) / current.zoom }
    assert.ok(Math.abs(current.zoom - before.zoom * 1.5) < 0.03, `${label}: pinch scales by the finger-distance ratio (before=${before.zoom}, after=${current.zoom}, startDistance=${startDistance}, currentDistance=${nextDistance}, box=${JSON.stringify(box)})`)
    assert.ok(Math.abs(anchor.x - afterAnchor.x) < 1.5 && Math.abs(anchor.y - afterAnchor.y) < 1.5, `${label}: initial world point remains under the moved midpoint (${JSON.stringify({ anchor, afterAnchor })})`)
    assert.ok(current.selected === before.selected, `${label}: pinch does not select or deselect canvas objects`)
    await dispatch('touchEnd', [point(moved[1].x, moved[1].y, 12)])
    await dispatch('touchEnd', [])
    await waitFor(async () => { await delay(20); return (await readGestureState())?.zoom > before.zoom }, `${label}: final transform settles`)
    return { before, after: current }
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled home')
  const base = { width: 1600, height: 1200, updatedAt: '2026-10-26T00:00:00.000Z', pages: [{ id: 'gesture-page', name: 'Gesture test', background: '#fff', elements: [{ id: 'gesture-shape', type: 'shape', name: 'Gesture shape', shape: 'rect', x: 180, y: 160, width: 300, height: 200, rotation: 0, fill: '#7657e8' }] }] }
  const design = { ...base, id: 'mobile-gesture-design', name: 'Mobile gesture design', type: 'design' }
  const whiteboard = { ...base, id: 'mobile-gesture-whiteboard', name: 'Mobile gesture whiteboard', type: 'whiteboard' }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(design)});tx.objectStore('documents').put(${JSON.stringify(whiteboard)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Open Mobile gesture design\"]') || [...document.querySelectorAll('.project-open')].some(button=>button.textContent.includes('Mobile gesture design'))"), 'seeded design fixture')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Mobile gesture design'))?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.canvas-viewport .konvajs-content canvas') && !!document.querySelector('.page-footer')"), 'design editor canvas runtime', 12000).catch(async error => {
    const diagnostic = await evaluate("({workspace:!!document.querySelector('.canvas-workspace'),viewport:!!document.querySelector('.canvas-viewport'),footer:!!document.querySelector('.page-footer'),fallback:document.querySelector('.canvas-engine-loading')?.textContent,konvaResources:performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>/react-konva|konva/i.test(name)),canvasChildren:[...(document.querySelector('.canvas-viewport')?.children??[])].map(node=>node.outerHTML.slice(0,800)),canvasCount:document.querySelectorAll('.canvas-viewport canvas').length,errorText:document.body.innerText.slice(-400)})")
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`)
  })
  await waitFor(() => evaluate("document.querySelector('.workspace-label')?.textContent.includes('1600 × 1200')"), 'design fixture dimensions')
  const designResult = await pinchAndCheck('design editor')

  await evaluate("document.querySelector('.brand')?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'library after design')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Mobile gesture whiteboard'))?.click()")
  await waitFor(() => evaluate("!!document.querySelector('.canvas-viewport .konvajs-content canvas') && !!document.querySelector('[data-whiteboard-zoom]') && !!document.querySelector('.page-footer')"), 'whiteboard canvas runtime')
  await waitFor(async () => { const state = await readGestureState(); return state && Number.isFinite(state.wbX) && Math.abs(state.wbX) > 0.1 && Math.abs(state.zoom - 0.55) < 0.01 ? state : null }, 'whiteboard initial center transform')
  const whiteboardResult = await pinchAndCheck('whiteboard editor')
  const result = await readGestureState()
  assert.ok(Number.isFinite(result.wbZoom) && result.wbZoom > 0, 'whiteboard transform attributes expose the live zoom')
  assert.ok(Number.isFinite(result.wbX) && Number.isFinite(result.wbY), 'whiteboard transform attributes expose the live position')
  console.log(`PASS mobile canvas gestures at 390x844: design pinch ${designResult.before.zoom.toFixed(3)}→${designResult.after.zoom.toFixed(3)}, whiteboard pinch ${whiteboardResult.before.zoom.toFixed(3)}→${whiteboardResult.after.zoom.toFixed(3)}; anchor, pan, selection isolation, and whiteboard data attributes verified`)
} finally {
  pageSocket?.close(); browserSocket?.close(); await stop(chrome); await stop(vite)
  const resolvedProfile = path.resolve(profileDir)
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('fuse-mobile-canvas-gestures-')) for (let attempt = 0; attempt < 10; attempt += 1) { try { await rm(resolvedProfile, { recursive: true, force: true }); break } catch { await delay(100) } }
}
