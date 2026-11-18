import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// Informational benchmark: record a repeatable local baseline, never gate CI on timings.
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of candidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Set CHROME_PATH to run the editor runtime baseline')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 30000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(50) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
function summarize(values) { const sorted = [...values].sort((a, b) => a - b); const at = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]; return { samples: values.length, median: sorted[Math.floor(sorted.length / 2)], p95: at(.95), min: sorted[0], max: sorted.at(-1), values } }

const vitePort = await freePort(), cdpPort = await freePort()
const origin = `http://127.0.0.1:${vitePort}`
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-editor-runtime-baseline-'))
const fixtureId = 'rea-a4-runtime-baseline'
const targetCount = Math.max(100, Math.min(2000, Number(process.env.BENCH_ELEMENTS) || 1000))
const photoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g"><stop stop-color="#1968d8"/><stop offset="1" stop-color="#ff9c52"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="300" r="180" fill="#fff" fill-opacity=".28"/></svg>'
const fixture = {
  id: fixtureId, name: `REA A4 runtime baseline · ${targetCount} elements`, type: 'design', width: 794, height: 1123, updatedAt: '2026-01-01T00:00:00.000Z',
  pages: [{ id: 'rea-a4-page-1', name: 'Page 1', background: '#ffffff', elements: [
    { id: 'rea-a4-photo-target', type: 'image', name: 'Fotografia do laboratório A4', src: `data:image/svg+xml,${encodeURIComponent(photoSvg)}`, x: 92, y: 125, width: 360, height: 270, rotation: 0, sourceWidth: 800, sourceHeight: 600 },
    ...Array.from({ length: targetCount - 1 }, (_, index) => ({ id: `scale-shape-${String(index + 1).padStart(4, '0')}`, type: 'shape', name: `Forma ${index + 1}`, shape: index % 3 === 0 ? 'ellipse' : 'rect', x: 30 + (index % 10) * 70, y: 430 + Math.floor(index / 10) * 18, width: 36, height: 12, rotation: 0, fill: index % 2 ? '#dce8ff' : '#f3e4ce', cornerRadius: 2 })),
  ] }],
}
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, env: process.env, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(origin).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', origin], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith(origin)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map(); const resources = []; const failures = []
  pageSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
    if (message.method === 'Network.responseReceived') resources.push({ requestId: message.params.requestId, url: message.params.response.url, type: message.params.type, status: message.params.response.status, fromDiskCache: Boolean(message.params.response.fromDiskCache), fromServiceWorker: Boolean(message.params.response.fromServiceWorker), encodedDataLength: 0 })
    if (message.method === 'Network.loadingFinished') { const resource = resources.findLast(item => item.requestId === message.params.requestId); if (resource) resource.encodedDataLength = message.params.encodedDataLength }
    if (message.method === 'Network.loadingFailed') failures.push({ requestId: message.params.requestId, errorText: message.params.errorText })
  })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); const result = await response; if (result.error) throw new Error(`${method}: ${result.error.message}`); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Performance.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{window.__editorBaseline={bootAt:performance.now(),longTasks:[],lcp:0};try{new PerformanceObserver(list=>window.__editorBaseline.longTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask',buffered:true})}catch{}try{new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__editorBaseline.lcp=entry.startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch{}})()` })
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row')&&!document.querySelector('.home-loading')"), 'settled library before fixture seed')
  await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('documents'))db.createObjectStore('documents',{keyPath:'id'});if(!db.objectStoreNames.contains('assets')){const s=db.createObjectStore('assets',{keyPath:'id'});s.createIndex('libraryVisible','libraryVisible')}if(!db.objectStoreNames.contains('projectFolders'))db.createObjectStore('projectFolders',{keyPath:'id'});if(!db.objectStoreNames.contains('cloudDrafts'))db.createObjectStore('cloudDrafts',{keyPath:'documentId'})};r.onsuccess=()=>{const db=r.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)

  const routeSamples = [], interactionSamples = [], resourceSummaries = []
  const environment = await evaluate("({userAgent:navigator.userAgent,locale:navigator.language,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,hardwareConcurrency:navigator.hardwareConcurrency||null})")
  for (let run = 1; run <= 5; run += 1) {
    resources.length = 0; failures.length = 0
    const startedWall = new Date().toISOString()
    await send('Page.navigate', { url: `${origin}/design/${fixtureId}/edit?baselineRun=${run}` })
    await waitFor(() => evaluate("!!document.querySelector('.studio-app')&&!!document.querySelector('.canvas-workspace')&&document.querySelector('.document-title input')?.value.includes('REA A4 runtime baseline')"), `editor ready run ${run}`)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const startup = await evaluate("(()=>{const nav=performance.getEntriesByType('navigation')[0];const paints=performance.getEntriesByType('paint');const metric=window.__editorBaseline;return {readyMs:performance.now()-metric.bootAt,domContentLoadedMs:nav?.domContentLoadedEventEnd??null,loadMs:nav?.loadEventEnd??null,fcpMs:paints.find(e=>e.name==='first-contentful-paint')?.startTime??null,lcpMs:metric.lcp||null,longTasksMs:metric.longTasks.reduce((a,b)=>a+b,0),longTaskCount:metric.longTasks.length}})()")
    routeSamples.push({ run, startedAt: startedWall, ...startup })
    const hasLayer = await evaluate("Boolean(document.querySelector('.layer-row[data-element-id=\"rea-a4-photo-target\"]'))")
    assert.ok(hasLayer, `REA A4 photo target is represented in the layer panel (run ${run})`)
    await evaluate("document.querySelector('.layer-row[data-element-id=\"rea-a4-photo-target\"]')?.click()")
    await waitFor(() => evaluate("!!document.querySelector('.image-inspector .image-open-editor')"), `photo selected run ${run}`)
    const openStart = await evaluate('performance.now()')
    await evaluate("document.querySelector('.image-inspector .image-open-editor').click()")
    await waitFor(() => evaluate("!!document.querySelector('.image-edit-panel[role=dialog]')"), `image edit panel opens run ${run}`)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const openedMs = await evaluate(`performance.now()-${openStart}`)
    const closeStart = await evaluate('performance.now()')
    await evaluate("document.querySelector('.image-edit-close').click()")
    await waitFor(() => evaluate("!document.querySelector('.image-edit-panel[role=dialog]')"), `image edit panel closes run ${run}`)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const closedMs = await evaluate(`performance.now()-${closeStart}`)
    interactionSamples.push({ run, imageEditOpenToStableFrameMs: openedMs, imageEditCloseToStableFrameMs: closedMs })
    const metrics = await send('Performance.getMetrics')
    const metricMap = Object.fromEntries(metrics.result.metrics.map(item => [item.name, item.value]))
    routeSamples.at(-1).rendererMetrics = { jsHeapUsedSize: metricMap.JSHeapUsedSize ?? null, nodes: metricMap.Nodes ?? null, layoutCount: metricMap.LayoutCount ?? null, taskDuration: metricMap.TaskDuration ?? null }
    resourceSummaries.push({ run, requestCount: resources.length, encodedBytes: resources.reduce((sum, item) => sum + item.encodedDataLength, 0), cachedResponses: resources.filter(item => item.fromDiskCache || item.fromServiceWorker).length, byType: Object.fromEntries([...new Set(resources.map(item => item.type))].map(type => [type, { requests: resources.filter(item => item.type === type).length, encodedBytes: resources.filter(item => item.type === type).reduce((sum, item) => sum + item.encodedDataLength, 0) }])) })
    assert.equal(failures.length, 0, `no failed resources in run ${run}: ${JSON.stringify(failures)}`)
    if (run < 5) await send('Page.navigate', { url: `${origin}/` }).then(() => waitFor(() => evaluate("!!document.querySelector('.home-category-row')&&!document.querySelector('.home-loading')"), `library restored between warm runs`))
  }
  const unchanged = await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('documents','readonly').objectStore('documents').get('${fixtureId}');q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=()=>reject(q.error)}})`)
  assert.deepEqual(unchanged.pages, fixture.pages, 'benchmark UI interactions leave the audited A4-derived page model unchanged')
  const report = {
    authority: 'local-reconstruction-informational-runtime-baseline',
    caseId: 'editor-runtime-performance-baseline',
    measuredAt: new Date().toISOString(),
    environment: { browser: version.Browser, protocolVersion: version['Protocol-Version'], ...environment, cacheClassification: 'repeated route loads in one reused disposable Chrome profile; response events observed, disk/service-worker cache hits reported per run', networkProfile: 'localhost Vite; no throttling' },
    fixture: { id: fixtureId, sourceReference: 'REA A4 crop editor design DAHYCAHQNFM, analysis/a4-image-crop-panel-component-contracts.json; related interaction case image-crop-entry.scenario.json', relationship: 'synthetic local derivative; A4 dimensions and one selectable photo target follow the audited editor scenario; no Canva media bytes or content are reused', width: fixture.width, height: fixture.height, pages: fixture.pages.length, elementsPerPage: targetCount, totalElements: targetCount },
    protocol: { routeSamples: routeSamples.length, samples: 'five repeated direct editor-route loads in one disposable browser profile; cache hits are observed, not assumed', interaction: 'select the A4 photo target, open and close Edit image panel; no crop or document mutation; wait for two requestAnimationFrame callbacks after each state', timingThresholds: 'none; informational baseline only; report medians, p95, min/max and raw samples' },
    summary: { routeReadyMs: summarize(routeSamples.map(sample => sample.readyMs)), domContentLoadedMs: summarize(routeSamples.map(sample => sample.domContentLoadedMs).filter(Number.isFinite)), firstContentfulPaintMs: summarize(routeSamples.map(sample => sample.fcpMs).filter(Number.isFinite)), lcpMs: summarize(routeSamples.map(sample => sample.lcpMs).filter(Number.isFinite)), imageEditOpenMs: summarize(interactionSamples.map(sample => sample.imageEditOpenToStableFrameMs)), imageEditCloseMs: summarize(interactionSamples.map(sample => sample.imageEditCloseToStableFrameMs)) },
    runs: routeSamples.map((sample, index) => ({ ...sample, interaction: interactionSamples[index], resources: resourceSummaries[index] })),
    invariants: { pageModelUnchanged: true, pageCount: unchanged.pages.length, elementCount: unchanged.pages[0].elements.length, failedResources: failures.length },
    limitations: ['No Canva or reconstruction comparison is made; only this local build was timed.', 'The Canva REA fixture provides no retained runtime trace or numeric acceptance band.', 'Synthetic SVG is used as the photo target; it is not the original Canva stock image.', 'Runs reuse one Chrome profile; all runs were observed to re-request Vite modules, with zero disk/service-worker cache hits, so cache warmth is not claimed.', 'Encoded byte counts describe local Vite responses only; they are not production transfer estimates.', 'UI readiness markers are app-defined; paint metrics are browser Performance API observations, not a complete trace.', 'Long tasks are observed from document start through the first stable editor render only; they do not cover a fixed full 10-second window.', 'Memory values are Chrome renderer metrics from a single process context and can include Vite/devtools overhead.'],
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  try { pageSocket?.close() } catch {}
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
  await stop(chrome); await stop(vite); await rm(profile, { recursive: true, force: true }).catch(() => {})
}
