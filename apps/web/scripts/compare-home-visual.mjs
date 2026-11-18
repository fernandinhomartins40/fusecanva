import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(webRoot, '..', '..')
const artifacts = path.join(webRoot, 'artifacts', 'visual')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Chrome/Edge is required; set CHROME_PATH')
async function freePort() { const server = createServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]) }
function crop(source, region) { const result = new PNG({ width: region.width, height: region.height }); PNG.bitblt(source, result, region.x, region.y, region.width, region.height, 0, 0); return result }
function compare(reference, current) { assert.deepEqual([reference.width, reference.height], [current.width, current.height]); let total = 0; let changed = 0; const diff = new PNG({ width: reference.width, height: reference.height }); for (let i = 0; i < reference.data.length; i += 4) { const delta = [0, 1, 2].map(c => Math.abs(reference.data[i + c] - current.data[i + c])); total += delta[0] + delta[1] + delta[2]; if (delta[0] + delta[1] + delta[2] > 30) changed++; for (let c = 0; c < 3; c++) diff.data[i + c] = Math.min(255, delta[c] * 3); diff.data[i + 3] = 255 } return { meanAbsoluteChannelError: Number((total / (reference.width * reference.height * 3)).toFixed(3)), changedPixelsOverRgbL1_30: changed, diff } }
function sideBySide(a, b) { const result = new PNG({ width: a.width + b.width, height: Math.max(a.height, b.height) }); PNG.bitblt(a, result, 0, 0, a.width, a.height, 0, 0); PNG.bitblt(b, result, 0, 0, b.width, b.height, a.width, 0); return result }

const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-home-visual-'))
let vite; let chrome; let socket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1920,897', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/list`).catch(() => null))?.json().then(items => items.find(item => item.type === 'page')), 'Chrome page')
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text); return response.result.result.value }
  await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 897, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'settled Home')
  await evaluate('document.fonts.ready'); await delay(400)
  const desktopCapture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const desktop = PNG.sync.read(Buffer.from(desktopCapture.result.data, 'base64'))
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await waitFor(() => evaluate("innerWidth===390 && !!document.querySelector('.home-category-row') && document.querySelector('.home-main').getBoundingClientRect().width<=390"), 'mobile Home'); await delay(400)
  const mobileCapture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const mobile = PNG.sync.read(Buffer.from(mobileCapture.result.data, 'base64'))
  assert.deepEqual([desktop.width, desktop.height, mobile.width, mobile.height], [1920, 897, 390, 844])
  const desktopRef = PNG.sync.read(await readFile(path.join(repoRoot, 'analysis/visual/screenshots/home-desktop-after-narrow-recheck.png')))
  const mobileComposite = PNG.sync.read(await readFile(path.join(repoRoot, 'analysis/visual/screenshots/home-mobile-compositor-view.png')))
  const mobileRef = crop(mobileComposite, { x: 0, y: 0, width: 390, height: 844 })
  const heroRegion = { x: 72, y: 0, width: 1848, height: 420 }
  const mobileHeroRegion = { x: 0, y: 0, width: 375, height: 160 }
  const hero = compare(crop(desktopRef, heroRegion), crop(desktop, heroRegion)); const fullDesktop = compare(desktopRef, desktop); const mobileHero = compare(crop(mobileRef, mobileHeroRegion), crop(mobile, mobileHeroRegion)); const fullMobile = compare(mobileRef, mobile)
  await mkdir(artifacts, { recursive: true })
  for (const [name, png] of [['home-desktop-current.png', desktop], ['home-mobile-current.png', mobile], ['home-desktop-reference-vs-current.png', sideBySide(desktopRef, desktop)], ['home-mobile-reference-vs-current.png', sideBySide(mobileRef, mobile)], ['home-desktop-hero-diff.png', hero.diff], ['home-mobile-diff.png', fullMobile.diff]]) await writeFile(path.join(artifacts, name), PNG.sync.write(png))
  const metric = result => ({ meanAbsoluteChannelError: result.meanAbsoluteChannelError, changedPixelsOverRgbL1_30: result.changedPixelsOverRgbL1_30 })
  const report = { referenceDesktop: 'analysis/visual/screenshots/home-desktop-after-narrow-recheck.png', referenceMobile: 'analysis/visual/screenshots/home-mobile-compositor-view.png (left 390x844 crop)', viewportDesktop: [1920, 897], viewportMobile: [390, 844], desktopHeroRegion: heroRegion, mobileHeroRegion, metrics: { desktopHero: metric(hero), desktopFull: metric(fullDesktop), mobileHero: metric(mobileHero), mobileFull: metric(fullMobile) }, limitation: 'A fresh local profile contains no projects; the audited screenshots contain an existing account and different thumbnails/content. The mobile reference is an auxiliary compositor crop with a visible desktop scrollbar, and its layout is not a full mobile-device capture. Metrics include these fixture differences and do not prove visual equivalence.' }
  await writeFile(path.join(artifacts, 'home-visual-diff.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
} finally { socket?.close(); await stop(chrome); await stop(vite); await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined) }
