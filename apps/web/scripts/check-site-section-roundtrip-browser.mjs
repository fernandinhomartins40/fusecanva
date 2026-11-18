import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
async function findChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found; set CHROME_PATH.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (process.platform === 'win32' && child.pid) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} } else child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

const chromePath = await findChrome()
const vitePort = await freePort()
let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-site-sections-'))
let vite, chrome, socket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); socket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }

  await waitFor(() => evaluate("document.querySelector('.home-category-row button') && !document.querySelector('.home-loading')"), 'home library')
  await evaluate("[...document.querySelectorAll('.home-category-row button')].find(button=>button.textContent.trim()==='Site').click()")
  await waitFor(async () => {
    const ready = await evaluate("Boolean(document.querySelector('.site-preview-open')&&document.querySelector('[aria-label=\"Nome do site\"]'))")
    if (!ready && Date.now() % 5000 < 120) console.error('Waiting for Site editor; page:', (await evaluate('document.body.innerText')).slice(0, 500))
    return ready
  }, 'new Site editor')
  const siteId = await waitFor(() => evaluate("document.querySelector('.site-preview-open')?.getAttribute('data-document-id') || null"), 'Site ID', 3000).catch(() => null)
  const getSite = async () => evaluate("(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').getAll();req.onsuccess=()=>resolve(req.result.find(doc=>doc.type==='site'&&doc.name==='Site sem título')??null);req.onerror=()=>reject(req.error)})})()")
  const initial = await waitFor(getSite, 'initial Site persistence')
  const documentId = siteId ?? initial.id
  assert.equal(initial.pages.length, 2, 'new Site starts with two root sections')

  await evaluate("document.querySelector('.site-preview-open')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.site-preview-dialog'))"), 'initial Site preview')
  const assertRootNavigationTargets = async mode => {
    const navigation = await evaluate(`(()=>{const dialog=document.querySelector('.site-preview-dialog');const frame=dialog?.querySelector('.site-preview-frame');const links=[...dialog.querySelectorAll('.site-preview-nav > div a')].map(link=>({label:link.textContent.trim(),href:link.getAttribute('href'),target:dialog.querySelector(link.getAttribute('href'))?.getAttribute('aria-label')}));return {mode:frame?.classList.contains(${JSON.stringify(mode)}),links,sections:frame?[...frame.querySelectorAll('.site-preview-section')].map(section=>({id:section.id,label:section.getAttribute('aria-label')})):[]}})()`)
    assert.equal(navigation.mode, true, `${mode} responsive preview is selected`)
    assert.equal(navigation.links.length, initial.pages.length, `${mode} preview exposes both root sections`)
    for (const [index, page] of initial.pages.entries()) {
      const link = navigation.links[index]
      assert.equal(link.label, page.name, `${mode} navigation label follows root section ${index + 1}`)
      assert.equal(link.href, `#site-section-${page.id}`, `${mode} link targets root section ${index + 1}`)
      const target = navigation.sections.find(section => section.id === link.href.slice(1))
      assert.ok(target, `${mode} link target exists in the rendered preview`)
      assert.ok(target.label.startsWith(page.name), `${mode} link target is the matching named section`)
    }
  }
  await assertRootNavigationTargets('desktop')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("[...document.querySelectorAll('.site-preview-controls button')].find(button=>button.textContent.trim()==='Celular')?.click()")
  await waitFor(() => evaluate("[...document.querySelectorAll('.site-preview-controls button[aria-pressed=true]')].some(button=>button.textContent.trim()==='Celular')"), 'initial mobile Site preview')
  await assertRootNavigationTargets('mobile')
  const mobilePreviewLayout = await evaluate("(()=>{const dialog=document.querySelector('.site-preview-dialog'),controls=dialog.querySelector('.site-preview-controls'),scroll=dialog.querySelector('.site-preview-scroll'),frame=dialog.querySelector('.site-preview-frame'),toggle=dialog.querySelector('.site-preview-menu-toggle');return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,dialogWidth:dialog.clientWidth,controlsWidth:controls.clientWidth,controlsScroll:controls.scrollWidth,scrollWidth:scroll.clientWidth,scrollOverflow:getComputedStyle(scroll).overflowY,frameWidth:frame.getBoundingClientRect().width,toggleWidth:toggle.getBoundingClientRect().width,toggleHeight:toggle.getBoundingClientRect().height}})()")
  assert.equal(mobilePreviewLayout.width, 390)
  assert.ok(mobilePreviewLayout.documentWidth <= 390 && mobilePreviewLayout.dialogWidth <= 390, `mobile preview stays inside the device viewport: ${JSON.stringify(mobilePreviewLayout)}`)
  assert.ok(mobilePreviewLayout.controlsWidth <= mobilePreviewLayout.dialogWidth && mobilePreviewLayout.controlsScroll <= mobilePreviewLayout.controlsWidth, 'preview mode controls fit without horizontal clipping')
  assert.equal(mobilePreviewLayout.scrollOverflow, 'auto', 'preview content has an independent nested scroll container')
  assert.ok(mobilePreviewLayout.scrollWidth <= mobilePreviewLayout.dialogWidth && mobilePreviewLayout.frameWidth <= mobilePreviewLayout.scrollWidth, 'responsive page frame fits inside the preview scroll region')
  assert.ok(mobilePreviewLayout.toggleWidth >= 40 && mobilePreviewLayout.toggleHeight >= 40, 'mobile site navigation has a touch-sized menu button')
  await evaluate("document.querySelector('.site-preview-menu-toggle')?.click()")
  await waitFor(() => evaluate("document.querySelector('.site-preview-menu-toggle')?.getAttribute('aria-expanded')==='true'"), 'mobile preview navigation menu')
  const mobileMenuLinks = await evaluate("[...document.querySelectorAll('.site-preview-frame.mobile .site-preview-nav > div.expanded a')].map(link=>({label:link.textContent.trim(),height:link.getBoundingClientRect().height}))")
  assert.equal(mobileMenuLinks.length, initial.pages.length, 'mobile navigation menu exposes every visible root section')
  assert.ok(mobileMenuLinks.every(link => link.height >= 40), 'mobile section links have touch-sized hit areas')
  await evaluate("document.querySelector('.site-preview-menu-toggle')?.click()")
  await waitFor(() => evaluate("document.querySelector('.site-preview-menu-toggle')?.getAttribute('aria-expanded')==='false'"), 'mobile navigation menu closes')
  const mobileScrollCheck = await evaluate("(()=>{const scroll=document.querySelector('.site-preview-scroll'),section=document.querySelector('.site-preview-section');const old=section.style.minHeight;section.style.minHeight=(scroll.clientHeight+80)+'px';scroll.scrollTop=scroll.scrollHeight;const state={client:scroll.clientHeight,height:scroll.scrollHeight,top:scroll.scrollTop};section.style.minHeight=old;scroll.scrollTop=0;return state})()")
  assert.ok(mobileScrollCheck.height > mobileScrollCheck.client && mobileScrollCheck.top > 0, `tall site content scrolls within the preview pane: ${JSON.stringify(mobileScrollCheck)}`)
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await evaluate("[...document.querySelectorAll('.site-preview-controls button')].find(button=>button.textContent.trim()==='Desktop')?.click()")
  await waitFor(() => evaluate("[...document.querySelectorAll('.site-preview-controls button[aria-pressed=true]')].some(button=>button.textContent.trim()==='Desktop')"), 'restore desktop Site preview')
  await evaluate("document.querySelector('.site-preview-close')?.click()")

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobile = await waitFor(() => evaluate("(()=>{const b=document.querySelector('.page-footer [aria-label=\"Adicionar seção\"]')?.getBoundingClientRect(),preview=document.querySelector('.site-preview-open')?.getBoundingClientRect();return b&&preview?{width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,buttonWidth:b.width,previewWidth:preview.width,previewDisplay:getComputedStyle(document.querySelector('.site-preview-open')).display}:null})()"), 'mobile section controls')
  assert.ok(mobile.scrollWidth <= mobile.width, `mobile editor should not overflow horizontally: ${JSON.stringify(mobile)}`)
  assert.ok(mobile.buttonWidth > 0, 'mobile editor keeps the add-section control available')
  assert.ok(mobile.previewWidth > 0 && mobile.previewDisplay !== 'none', 'the Site preview remains reachable from the mobile editor header')
  await evaluate("document.querySelector('.site-preview-open')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.site-preview-dialog'))"), 'mobile editor opens Site preview')
  assert.ok(await evaluate("document.querySelector('.site-preview-dialog')?.clientWidth <= innerWidth"), 'mobile editor preview dialog remains within the device width')
  await evaluate("document.querySelector('.site-preview-close')?.click()")
  await evaluate("document.querySelector('.page-footer [aria-label=\"Adicionar seção\"]')?.click()")
  const added = await waitFor(async () => { const doc = await getSite(); return doc?.pages?.length === 3 ? doc : null }, 'section creation persisted')
  assert.equal(added.pages[2].name, 'Seção 3', 'the new section has a stable visible name')
  assert.equal(await evaluate("document.querySelector('.page-footer')?.textContent.includes('Página 3 de 3')"), true, 'the new section becomes the selected section')
  const mobileReorderControls = await evaluate("(()=>{const footer=document.querySelector('.site-page-footer');const actions=[...footer.querySelectorAll('.page-action')];const left=actions.find(button=>button.getAttribute('aria-label')?.startsWith('Mover')&&button.getAttribute('aria-label')?.endsWith('esquerda'))?.getBoundingClientRect();const right=actions.find(button=>button.getAttribute('aria-label')?.startsWith('Mover')&&button.getAttribute('aria-label')?.endsWith('direita'))?.getBoundingClientRect();return {viewport:innerWidth,footerWidth:footer.clientWidth,footerScroll:footer.scrollWidth,left:left?{width:left.width,height:left.height}:null,right:right?{width:right.width,height:right.height}:null}})()")
  assert.equal(mobileReorderControls.viewport, 390, 'Site section reordering is exercised at mobile width')
  assert.ok(mobileReorderControls.footerWidth <= 390 && mobileReorderControls.footerScroll <= mobileReorderControls.footerWidth, 'mobile Site page controls fit without horizontal overflow: ' + JSON.stringify(mobileReorderControls))
  assert.ok(mobileReorderControls.left?.width >= 44 && mobileReorderControls.left?.height >= 44 && mobileReorderControls.right?.width >= 44 && mobileReorderControls.right?.height >= 44, 'mobile Site section reorder targets are at least 44px: ' + JSON.stringify(mobileReorderControls))
  await evaluate("(()=>{const button=[...document.querySelectorAll('.site-page-footer .page-action')].find(item=>item.getAttribute('aria-label')?.startsWith('Mover')&&item.getAttribute('aria-label')?.endsWith('esquerda'));if(!button)throw new Error('Site section move-left action missing');button.focus()})()")
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'Mover página para a esquerda', 'section reorder action receives keyboard focus')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  const mobileReordered = await waitFor(async () => { const doc = await getSite(); return doc?.pages?.[1]?.id === added.pages[2].id ? doc : null }, 'mobile section reorder persisted')
  assert.deepEqual(mobileReordered.pages.map(page => page.id), [initial.pages[0].id, added.pages[2].id, initial.pages[1].id], 'mobile reorder action updates Site section order and persists it')
  assert.deepEqual(mobileReordered.pages, [added.pages[0], added.pages[2], added.pages[1]], 'moving a section preserves every page field and element')
  await evaluate("(()=>{const button=[...document.querySelectorAll('.site-page-footer .page-action')].find(item=>item.getAttribute('aria-label')?.startsWith('Mover')&&item.getAttribute('aria-label')?.endsWith('direita'));button?.click()})()")
  const mobileRestoredOrder = await waitFor(async () => { const doc = await getSite(); return doc?.pages?.[2]?.id === added.pages[2].id ? doc : null }, 'mobile section reorder restored')
  assert.deepEqual(mobileRestoredOrder.pages.map(page => page.id), added.pages.map(page => page.id), 'mobile section can be moved back with the opposite control')
  assert.deepEqual(mobileRestoredOrder.pages, added.pages, 'moving a section down restores the exact section objects')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

  await evaluate("document.querySelector('[aria-label=\"Mover página para a esquerda\"]')?.click()")
  const reordered = await waitFor(async () => { const doc = await getSite(); return doc?.pages?.[1]?.name === 'Seção 3' ? doc : null }, 'section reorder persisted')
  assert.deepEqual(reordered.pages.map(page => page.name), ['Início', 'Seção 3', 'Contato'], 'moving a Site section changes and persists its order')
  await evaluate("document.querySelector('.page-footer .page-action:last-child')?.click()")
  const removed = await waitFor(async () => { const doc = await getSite(); return doc?.pages?.length === 2 ? doc : null }, 'section deletion persisted')
  assert.deepEqual(removed.pages.map(page => page.name), ['Início', 'Contato'], 'deleting the selected Site section preserves the root sections')
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` })
  await waitFor(() => evaluate("document.querySelector('.home-shell')&&!document.querySelector('.home-loading')"), 'library after reload')
  await evaluate("[...document.querySelectorAll('.project-card .project-open')].find(button=>button.textContent.includes('Site sem'))?.click()")
  const restored = await waitFor(() => evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});req.onsuccess=()=>resolve(req.result?.pages?.length===2?req.result:null);req.onerror=()=>reject(req.error)})})()`), 'saved Site reopened')
  assert.deepEqual(restored.pages.map(page => page.name), ['Início', 'Contato'], 'reloaded Site retains the section deletion and order')
  const marker = 'REA hidden populated section preview regression marker'
  const seeded = await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});const doc=await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});const page=doc.pages.find(item=>item.name==='Contato');page.hidden=true;page.elements.push({id:'rea-hidden-preview-marker',type:'text',name:'REA hidden preview marker',text:${JSON.stringify(marker)},x:120,y:120,width:600,height:80,rotation:0,fontSize:36,fontFamily:'Arial',color:'#111111',bold:false});await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(doc);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});return doc})()`)
  assert.equal(seeded.pages[1].hidden, true, 'hidden section state is persisted before preview')
  assert.equal(seeded.pages[1].elements.some(element => element.text === marker), true, 'populated section marker is persisted')
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` })
  await waitFor(() => evaluate("document.querySelector('.home-shell')&&!document.querySelector('.home-loading')"), 'library after hidden section seed')
  await evaluate("[...document.querySelectorAll('.project-card .project-open')].find(button=>button.textContent.includes('Site sem'))?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.site-preview-open'))"), 'seeded Site editor')
  const persistedBeforePreview = await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});req.onsuccess=()=>resolve(JSON.stringify(req.result));req.onerror=()=>reject(req.error)})})()`)
  await evaluate("document.querySelector('.site-preview-open')?.click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('.site-preview-dialog'))"), 'Site preview')
  const assertHiddenMarkerOmitted = async mode => {
    const view = await evaluate(`(()=>{const dialog=document.querySelector('.site-preview-dialog');const frame=dialog?.querySelector('.site-preview-frame');return {mode:frame?.classList.contains(${JSON.stringify(mode)}),marker:dialog?.innerText.includes(${JSON.stringify(marker)}),sections:frame?.querySelectorAll('.site-preview-section').length}})()`)
    assert.equal(view.mode, true, `${mode} preview mode is selected`)
    assert.equal(view.marker, false, `${mode} preview omits populated hidden-section content`)
    assert.equal(view.sections, 1, `${mode} preview renders only the visible section`)
  }
  await assertHiddenMarkerOmitted('desktop')
  await evaluate("[...document.querySelectorAll('.site-preview-controls button')].find(button=>button.textContent.trim()==='Celular')?.click()")
  await waitFor(() => evaluate("[...document.querySelectorAll('.site-preview-controls button[aria-pressed=true]')].some(button=>button.textContent.trim()==='Celular')"), 'mobile Site preview')
  await assertHiddenMarkerOmitted('mobile')
  await evaluate("document.querySelector('.site-preview-close')?.click()")
  const persistedAfterPreview = await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('fuse-studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return await new Promise((resolve,reject)=>{const req=db.transaction('documents','readonly').objectStore('documents').get(${JSON.stringify(documentId)});req.onsuccess=()=>resolve(JSON.stringify(req.result));req.onerror=()=>reject(req.error)})})()`)
  assert.equal(persistedAfterPreview, persistedBeforePreview, 'opening and switching preview modes does not change stored document content')
  console.log(`PASS Sites 390x844: preview=${mobilePreviewLayout.dialogWidth}px, frame=${mobilePreviewLayout.frameWidth}px, nav links=${mobileMenuLinks.length}, nested scroll=${mobileScrollCheck.top}px; mobile editor preview action reachable, section add/delete/reorder, desktop/mobile navigation targets, hidden-section exclusion and persistence also pass`)
} finally {
  try { socket?.close() } catch {}
  await stop(chrome); await stop(vite); await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
