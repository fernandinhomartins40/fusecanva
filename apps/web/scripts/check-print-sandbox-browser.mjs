import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
assert.ok(chromePath, 'Chrome/Edge is required; set CHROME_PATH')

async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 25000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {}; await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-print-sandbox-'))
let vite; let browser; let socket
try {
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'page target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home')
  const fixture = { id: 'print-sandbox-browser', name: 'Cartão sandbox', type: 'design', width: 794, height: 443, updatedAt: new Date().toISOString(), pages: [{ id: 'print-page', name: 'Página 1', background: '#fff', elements: [] }] }
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio',5);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('documents')){db.close();return reject(new Error('documents store missing'))}const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!![...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Cartão sandbox'))"), 'seeded local design')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Cartão sandbox')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.print-sandbox-trigger')"), 'print action in editor')
  await evaluate(`(()=>{window.__printCheckoutRequests=[];window.__printCheckoutConfigured=false;const realFetch=window.fetch.bind(window);window.fetch=async(input,init={})=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(path==='/api/providers/status')return new Response(JSON.stringify({sitePublication:{configured:false,missing:[]},printCheckout:{configured:window.__printCheckoutConfigured,missing:window.__printCheckoutConfigured?[]:['PRINT_CHECKOUT_URL','PRINT_CHECKOUT_TOKEN']}}),{status:200,headers:{'content-type':'application/json'}});if(path==='/api/print/checkout'){window.__printCheckoutRequests.push(JSON.parse(init.body));return new Response(JSON.stringify({checkout:{checkoutUrl:'https://checkout.example.test/session',sessionId:'browser-fake-session'}}),{status:200,headers:{'content-type':'application/json'}})}return realFetch(input,init)}})()`)
  await evaluate("document.querySelector('.print-sandbox-trigger').click()")
  await waitFor(() => evaluate("!!document.querySelector('.print-sandbox-dialog')"), 'print sandbox dialog')
  await waitFor(() => evaluate("document.querySelector('.print-sandbox-checkout')?.disabled===true && document.querySelector('.print-provider-status')?.textContent.includes('não foi configurado')"), 'unconfigured provider keeps checkout disabled')
  assert.equal(await evaluate('window.__printCheckoutRequests.length'), 0, 'disabled checkout cannot invoke a provider')
  await evaluate("document.querySelector('.print-sandbox-close').click()")
  await waitFor(() => evaluate("!document.querySelector('.print-sandbox-dialog')"), 'disabled checkout panel closes')
  await evaluate("window.__printCheckoutConfigured=true;document.querySelector('.print-sandbox-trigger').click()")
  await waitFor(() => evaluate("document.querySelector('.print-sandbox-checkout')?.disabled===false"), 'fake configured checkout provider status')
  assert.equal(await evaluate("document.querySelectorAll('input[name=print-format]').length"), 4)
  assert.equal(await evaluate("document.querySelectorAll('input[name=print-paper]').length"), 2)
  assert.equal(await evaluate("document.querySelectorAll('input[name=print-finish]').length"), 2)
  assert.equal(await evaluate("document.querySelector('#print-quantity').value"), '150')
  assert.match(await evaluate("document.querySelector('.print-estimate').innerText"), /69,00/)
  await evaluate("document.querySelector('input[name=print-format][value=horizontal-slim]').click();document.querySelector('input[name=print-paper][value=standard]').click();document.querySelector('input[name=print-finish][value=gloss]').click();document.querySelector('#print-quantity').value='50';document.querySelector('#print-quantity').dispatchEvent(new Event('change',{bubbles:true}))")
  await evaluate("document.querySelector('.print-sandbox-checkout').click()")
  await waitFor(() => evaluate("!!document.querySelector('[role=alertdialog][aria-labelledby=print-checkout-confirm-title]')"), 'explicit checkout confirmation dialog')
  assert.equal(await evaluate('window.__printCheckoutRequests.length'), 0, 'opening confirmation alone does not invoke checkout')
  await evaluate("[...document.querySelectorAll('.print-checkout-confirm button')].find(button=>button.textContent==='Voltar').click()")
  assert.equal(await evaluate('window.__printCheckoutRequests.length'), 0, 'canceling checkout confirmation sends no request')
  await evaluate("document.querySelector('.print-sandbox-checkout').click()")
  await waitFor(() => evaluate("!!document.querySelector('.print-checkout-confirm-submit')"), 'checkout confirmation reopened')
  await evaluate("document.querySelector('.print-checkout-confirm-submit').click()")
  await waitFor(() => evaluate("!!document.querySelector('.print-checkout-result a[href^=\"https://checkout.example.test/\"]')"), 'fake provider checkout link')
  assert.equal(await evaluate('window.__printCheckoutRequests.length'), 1, 'checkout is invoked only after explicit confirmation')
  assert.deepEqual(await evaluate('window.__printCheckoutRequests[0].options'), { format: 'horizontal-slim', paper: 'standard', finish: 'gloss', quantity: 50 }, 'the confirmed checkout uses the currently selected product options')
  await evaluate("document.querySelector('.print-sandbox-save').click()")
  await waitFor(() => evaluate("document.querySelector('.print-sandbox-confirmation')?.innerText.includes('Nenhum pedido foi enviado')"), 'local draft confirmation')
  assert.equal(await evaluate("Object.keys(localStorage).some(key=>key.startsWith('fuse.print-draft.v1.'))"), true)
  await evaluate("document.querySelector('.print-sandbox-close').click()")
  await evaluate("document.querySelector('.print-sandbox-trigger').click()")
  await waitFor(() => evaluate("document.querySelector('input[name=print-format][value=horizontal-slim]')?.checked"), 'saved configuration reopened')
  assert.equal(await evaluate("document.querySelector('#print-quantity').value"), '50')
  assert.match(await evaluate("document.querySelector('.print-sandbox-content').innerText"), /Estimativa ilustrativa local/)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate("document.querySelector('.print-sandbox-dialog').getBoundingClientRect().width <= innerWidth"), true, 'dialog fits a narrow mobile viewport')
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate("document.querySelector('.print-sandbox-dialog').scrollWidth <= innerWidth"), true, 'dialog has no horizontal overflow on a 320px viewport')
  assert.equal(await evaluate("document.querySelector('.print-sandbox-actions').getBoundingClientRect().right <= innerWidth"), true, 'footer actions fit a 320px viewport')
  assert.equal(await evaluate("(()=>{const content=document.querySelector('.print-sandbox-content');return content.scrollHeight>content.clientHeight})()"), true, 'long print options remain scrollable on a short mobile viewport')
  assert.equal(await evaluate("(()=>{const content=document.querySelector('.print-sandbox-content');content.scrollTop=content.scrollHeight;const footer=document.querySelector('.print-sandbox-actions').getBoundingClientRect();return footer.top>=0&&footer.bottom<=innerHeight})()"), true, 'footer actions stay visible after scrolling the mobile options')
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button=>/comprar|pedido enviado/i.test(button.textContent))"), false, 'no purchase or order-sent action is exposed')
  await evaluate("document.querySelector('.print-sandbox-reset').click()")
  assert.equal(await evaluate("document.querySelector('input[name=print-format][value=vertical-standard]').checked && document.querySelector('input[name=print-paper][value=premium]').checked && document.querySelector('#print-quantity').value==='150'"), true, 'reset returns to captured defaults')
  assert.equal(await evaluate("Object.keys(localStorage).some(key=>key.startsWith('fuse.print-draft.v1.'))"), false, 'reset removes the saved local draft')
  await evaluate("document.querySelector('.print-sandbox-save').click()")
  await waitFor(() => evaluate("document.querySelector('.print-sandbox-spec')?.disabled===false"), 'saved quote ready for local export')
  const exportedSpec = await evaluate("new Promise(resolve=>{const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download.startsWith('ficha-impressao-sandbox-'))return click.call(this);const a=this;fetch(a.href).then(response=>response.json()).then(data=>resolve({filename:a.download,data})).catch(error=>resolve({error:String(error)}))};document.querySelector('.print-sandbox-spec').click()})")
  assert.equal(exportedSpec.filename, 'ficha-impressao-sandbox-print-sandbox-browser.json')
  assert.equal(exportedSpec.data.documentId, 'print-sandbox-browser')
  assert.deepEqual(exportedSpec.data.transaction, { orderPlaced: false, paymentCollected: false, externalProviderContacted: false })
  console.log('Print sandbox browser checks passed: options, price anchors, confirmed fake checkout, saved-draft roundtrip, reset, sandbox specification export, and mobile width.')
} finally {
  socket?.close()
  for (const child of [browser, vite]) { if (!child || child.exitCode !== null || child.signalCode !== null) continue; if (process.platform === 'win32') { try { const { execFileSync } = await import('node:child_process'); execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
}
