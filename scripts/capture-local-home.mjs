import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
async function waitFor(check, label, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const url = value('--url', 'http://127.0.0.1:4173/')
const width = Number(value('--width', '1920'))
const height = Number(value('--height', '897'))
const output = path.resolve(value('--out', path.join(root, `local-home-${width}x${height}.png`)))
const templateMode = args.includes('--templates')
const templateQuery = value('--template-query', '')
const templateLanguage = value('--template-language', '')
const templateCategory = value('--template-category', '')
const previewTemplate = value('--preview-template', '')
if (!Number.isInteger(width) || width < 320 || width > 3840 || !Number.isInteger(height) || height < 240 || height > 2160) {
  throw new Error('Viewport must be between 320x240 and 3840x2160 pixels.')
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) {
  try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {}
}
if (!chromePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to capture the local page.')

const portServer = createServer()
await new Promise((resolve, reject) => portServer.listen(0, '127.0.0.1', resolve).once('error', reject))
const cdpPort = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'fuse-home-capture-'))
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileRoot}`, `--window-size=${width},${height}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })

let socket
try {
  let browser
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); break } catch { await delay(100) }
  }
  if (!browser) throw new Error('Timed out waiting for isolated Chrome DevTools.')
  socket = new WebSocket(browser.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let target
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    target = targets.find(item => item.type === 'page')
    if (target) break
    await delay(100)
  }
  if (!target) throw new Error('No local Chrome page target was created.')
  const pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    pageSocket.addEventListener('open', resolve, { once: true })
    pageSocket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id
    pending.set(requestId, message => message.error ? reject(new Error(message.error.message)) : resolve(message))
    pageSocket.send(JSON.stringify({ id: requestId, method, params }))
  })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 700 })
  const targetUrl = new URL(url)
  if (templateMode || templateQuery || templateLanguage || templateCategory || previewTemplate) targetUrl.searchParams.set('templates', '1')
  if (templateQuery) targetUrl.searchParams.set('template_query', templateQuery)
  if (templateLanguage) targetUrl.searchParams.set('template_language', templateLanguage)
  if (templateCategory) targetUrl.searchParams.set('template_category', templateCategory)
  await send('Page.navigate', { url: targetUrl.toString() })
  await delay(2000)
  if (previewTemplate) {
    await waitFor(async () => {
      const result = await send('Runtime.evaluate', {
        expression: `(()=>{const card=[...document.querySelectorAll('.template-card')].find(item=>item.querySelector('h3')?.textContent===${JSON.stringify(previewTemplate)});if(!card)return false;card.querySelector('.template-card-preview')?.click();return true})()`,
        returnByValue: true,
      })
      return result.result.result.value
    }, 'template preview open')
    await delay(400)
  }
  let metrics
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify({scrollWidth:document.documentElement.scrollWidth,loading:!!document.querySelector('.home-loading'),ready:document.readyState,templateCatalog:!!document.querySelector('.template-dialog'),templatePreview:!!document.querySelector('.template-preview-dialog')})`,
      returnByValue: true,
    })
    metrics = JSON.parse(result.result.result.value)
    if (!metrics.loading && metrics.ready === 'complete') break
    await delay(150)
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const bytes = Buffer.from(screenshot.result.data, 'base64')
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, bytes)
  console.log(JSON.stringify({ output, width, height, documentScrollWidth: metrics.scrollWidth, horizontalOverflow: metrics.scrollWidth > width, projectLibraryStillLoading: metrics.loading, templateCatalogOpen: metrics.templateCatalog, templatePreviewOpen: metrics.templatePreview }))
  pageSocket.close()
} finally {
  socket?.close()
  chrome.kill()
  await delay(150)
  const resolvedTemp = path.resolve(profileRoot)
  if (resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedTemp).startsWith('fuse-home-capture-')) {
    await rm(resolvedTemp, { recursive: true, force: true })
  }
}
