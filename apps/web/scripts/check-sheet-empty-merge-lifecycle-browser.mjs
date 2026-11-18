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
const viteEntry = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
async function getChrome() { for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); return candidate } catch {} } throw new Error('Chrome/Edge not found. Set CHROME_PATH.') }
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const value = await check(); if (value) return value } catch {} await delay(100) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 3000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const chromePath = await getChrome()
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-sheet-empty-merge-'))
let vite, chrome, browserSocket, pageSocket
try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite startup')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-cache', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const pageTarget = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'local page')
  pageSocket = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); const result = await response; if (result.error) throw new Error(`${method}: ${result.error.message}`); return result }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text); return response.result.result.value }
  async function readSheet() { return evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('documents','readonly').objectStore('documents').get('empty-merge-browser');q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=()=>reject(q.error)}})") }
  async function rightClickCell(address) {
    const point = await evaluate(`(()=>{const r=document.querySelector('[aria-label=${JSON.stringify(address)}]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', clickCount: 1 })
    await delay(150)
    return evaluate("(()=>{const visible=element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(element).visibility!=='hidden'};const menu=document.querySelector('.sheet-cell-context-menu[role=menu]');const items=menu?[...menu.querySelectorAll('[role=menuitem]')].filter(visible).map(item=>({text:item.textContent.trim(),disabled:item.disabled})):[];return{menus:menu&&visible(menu)?1:0,menuItems:items}})()")
  }
  async function openFixtureAfterReload(label) {
    await send('Page.reload')
    await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), `${label}: home`)
    await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Empty horizontal merge fixture')).click()")
    await waitFor(() => evaluate("!!document.querySelector('.sheet-grid [aria-label=\\\"A5\\\"]')"), `${label}: spreadsheet editor`)
  }
  async function readFormulaValues() { return evaluate("['C1','D1','E1','F1','G1','A10','B10'].map(address=>document.querySelector('[aria-label=\\\"'+address+'\\\"]')?.value)") }
  const cells = Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => ''))
  cells[0] = ['12', '8', '=SUM(A1:B1)', '=SUM(A1:B1)', '=$A$1+B1', '=SUM(A1:B1)', '=SUM(A1:B1)']
  cells[9][0] = '=SUM(A1:B1)'
  cells[9][1] = '=A1+B1'
  const fixture = { id: 'empty-merge-browser', name: 'Empty horizontal merge fixture', type: 'sheet', width: 1600, height: 900, updatedAt: new Date().toISOString(), pages: [{ id: 'sheet-empty-merge', name: 'Planilha 1', background: '#ffffff', elements: [], cells, cellMerges: [] }] }
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'home ready')
  await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('fuse-studio',5);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(${JSON.stringify(fixture)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
  await send('Page.reload')
  await waitFor(() => evaluate("!!document.querySelector('.project-open') && !document.querySelector('.home-loading')"), 'seeded fixture')
  await evaluate("[...document.querySelectorAll('.project-open')].find(button=>button.textContent.includes('Empty horizontal merge fixture')).click()")
  await waitFor(() => evaluate("!!document.querySelector('.sheet-grid [aria-label=\\\"A5\\\"]')"), 'spreadsheet editor')
  const baselineValues = await readFormulaValues()
  assert.deepEqual(baselineValues, ['20', '20', '20', '20', '20', '20', '20'], 'seven existing formula results render before merge')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"A5\\\"]')?.value==='' && document.querySelector('[aria-label=\\\"B5\\\"]')?.value===''"), true, 'A5:B5 starts as an empty horizontal range')

  await evaluate("document.querySelector('[aria-label=\\\"A5\\\"]').focus()")
  const target = await evaluate("(()=>{const r=document.querySelector('[aria-label=\\\"B5\\\"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, modifiers: 8 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1, modifiers: 8 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1, modifiers: 8 })
  await waitFor(() => evaluate("document.querySelectorAll('.sheet-grid .sheet-cell-range').length===2"), 'A5:B5 horizontal range selection')
  const mergeContextMenu = await rightClickCell('B5')
  assert.equal(mergeContextMenu.menus, 1, 'right-click on selected A5:B5 opens the spreadsheet context menu')
  const mergeMenuItem = mergeContextMenu.menuItems.find(item => item.text.startsWith('Mesclar'))
  const emptyUnmergeMenuItem = mergeContextMenu.menuItems.find(item => item.text.startsWith('Desfazer mesclagem'))
  assert.ok(mergeMenuItem, `merge menu item is present: ${JSON.stringify(mergeContextMenu)}`)
  assert.ok(emptyUnmergeMenuItem, `unmerge menu item is present: ${JSON.stringify(mergeContextMenu)}`)
  assert.equal(mergeMenuItem.text, 'Mesclar c\u00e9lulas', 'context menu exposes the exact audited merge label')
  assert.equal(emptyUnmergeMenuItem.text, 'Desfazer mesclagem de c\u00e9lula', 'context menu exposes the exact audited unmerge label')
  assert.equal(mergeMenuItem.disabled, false, 'Mesclar c?lulas is enabled for the selected empty horizontal range')
  assert.equal(emptyUnmergeMenuItem.disabled, true, 'Desfazer mesclagem de c?lula is disabled while A5:B5 is not merged')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(() => evaluate("!document.querySelector('.sheet-cell-context-menu') && document.activeElement?.getAttribute('aria-label')==='B5'"), 'Escape closes the context menu and restores the cell focus')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 })
  await waitFor(() => evaluate("!!document.querySelector('.sheet-cell-context-menu')"), 'Shift+F10 opens the context menu')
  await delay(100)
  const keyboardMenuFocus = await evaluate("({active:document.activeElement?.outerHTML,items:[...document.querySelectorAll('.sheet-cell-context-menu [role=menuitem]')].map(item=>({html:item.outerHTML,focused:item===document.activeElement})),menu:!!document.querySelector('.sheet-cell-context-menu')})")
  assert.equal(await evaluate("document.activeElement===document.querySelector('.sheet-cell-context-menu [role=menuitem]:not(:disabled)')"), true, `keyboard-opened menu focuses its first available action: ${JSON.stringify(keyboardMenuFocus)}`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  assert.equal(await evaluate("document.activeElement===document.querySelector('.sheet-cell-context-menu [role=menuitem]:not(:disabled)')"), true, 'ArrowDown skips the disabled unmerge item and retains the only enabled action')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  assert.equal(await evaluate("document.activeElement===document.querySelector('.sheet-cell-context-menu [role=menuitem]:not(:disabled)')"), true, 'Home focuses the first enabled menu action')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await delay(100)
  const enterMergeState = await evaluate("({menu:!!document.querySelector('.sheet-cell-context-menu'),active:document.activeElement?.outerHTML,colSpan:document.querySelector('[aria-label=\\\"A5\\\"]')?.closest('td')?.colSpan,buttons:[...document.querySelectorAll('.sheet-cell-context-menu [role=menuitem]')].map(item=>({text:item.textContent,disabled:item.disabled}))})")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\\\"A5\\\"]')?.closest('td')?.colSpan===2"), `empty A5:B5 merge via Space: ${JSON.stringify(enterMergeState)}`)
  await waitFor(() => evaluate("!document.querySelector('.sheet-cell-context-menu') && document.activeElement?.getAttribute('aria-label')==='A5'"), 'Space merges the range and restores focus to its anchor')
  await waitFor(async () => { const doc = await readSheet(); return doc.pages[0].cellMerges?.length === 1 }, 'merge model autosave')
  const merged = await readSheet()
  assert.deepEqual(merged.pages[0].cellMerges, [{ row: 4, column: 0, colSpan: 2 }])
  assert.deepEqual(await readFormulaValues(), baselineValues, 'seven existing formula results remain unchanged after merge')

  await evaluate("document.querySelector('[aria-label=\\\"Desfazer\\\"]').click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\\\"B5\\\"]'))"), 'global Undo restores two cells')
  const undoModel = await waitFor(async () => { const doc = await readSheet(); return doc.pages[0].cellMerges?.length === 0 ? doc : null }, 'Undo merge persistence').catch(async error => { console.error('Undo persistence diagnostic', JSON.stringify({ saveState: await evaluate("document.querySelector('.save-state')?.textContent"), b5Visible: await evaluate("Boolean(document.querySelector('[aria-label=\\\"B5\\\"]'))"), storedMerges: (await readSheet()).pages[0].cellMerges })); throw error })
  assert.deepEqual(undoModel.pages[0].cellMerges, [], 'Undo removes the merge from the sheet model')
  await evaluate("document.querySelector('[aria-label=\\\"Refazer\\\"]').click()")
  await waitFor(() => evaluate("document.querySelector('[aria-label=\\\"A5\\\"]')?.closest('td')?.colSpan===2"), 'global Redo restores merged range')
  await waitFor(async () => { const doc = await readSheet(); return doc.pages[0].cellMerges?.length === 1 }, 'Redo merge persistence')

  await openFixtureAfterReload('merged-state persistence')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"A5\\\"]')?.closest('td')?.colSpan===2"), true, 'the merged range remains merged after reload')
  const afterMergeReload = await readSheet()
  assert.deepEqual(afterMergeReload.pages[0].cellMerges, [{ row: 4, column: 0, colSpan: 2 }], 'merge geometry persists in IndexedDB')
  assert.deepEqual(await readFormulaValues(), baselineValues, 'seven formula results remain unchanged after reload')

  await evaluate("document.querySelector('[aria-label=\\\"A5\\\"]').focus()")
  const unmergeContextMenu = await rightClickCell('A5')
  assert.equal(unmergeContextMenu.menus, 1, 'right-click on the reloaded merged A5:B5 range opens the context menu')
  const mergedAction = unmergeContextMenu.menuItems.find(item => item.text.startsWith('Mesclar'))
  const unmergeMenuItem = unmergeContextMenu.menuItems.find(item => item.text.startsWith('Desfazer mesclagem'))
  assert.ok(mergedAction, `merge menu item is present on merged range: ${JSON.stringify(unmergeContextMenu)}`)
  assert.ok(unmergeMenuItem, `unmerge menu item is present on merged range: ${JSON.stringify(unmergeContextMenu)}`)
  assert.equal(mergedAction.text, 'Mesclar c\u00e9lulas', 'reloaded merged context menu preserves the exact merge label')
  assert.equal(unmergeMenuItem.text, 'Desfazer mesclagem de c\u00e9lula', 'reloaded merged context menu exposes the exact audited unmerge label')
  assert.equal(mergedAction.disabled, true, 'Mesclar c?lulas is disabled for an already merged range')
  assert.equal(unmergeMenuItem.disabled, false, 'Desfazer mesclagem de c?lula is enabled for the merged range')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  assert.equal(await evaluate("document.activeElement===document.querySelector('.sheet-cell-context-menu [role=menuitem]:not(:disabled)')"), true, 'End focuses the final enabled action for a merged range')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await waitFor(() => evaluate("Boolean(document.querySelector('[aria-label=\\\"A5\\\"]') && document.querySelector('[aria-label=\\\"B5\\\"]'))"), 'unmerge restores both cells')
  await waitFor(async () => { const doc = await readSheet(); return doc.pages[0].cellMerges?.length === 0 }, 'unmerge autosave')
  assert.deepEqual(await readFormulaValues(), baselineValues, 'seven formula results remain unchanged after unmerge')
  const unmerged = await readSheet()
  assert.deepEqual(unmerged.pages[0].cellMerges, [])
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"A5\\\"]')?.value==='' && document.querySelector('[aria-label=\\\"B5\\\"]')?.value===''"), true, 'both cells are explicitly visible and empty after unmerge')

  await openFixtureAfterReload('unmerged-state persistence')
  const afterUnmergeReload = await readSheet()
  assert.deepEqual(afterUnmergeReload.pages[0].cellMerges, [], 'unmerged state persists after reload')
  assert.equal(await evaluate("document.querySelector('[aria-label=\\\"A5\\\"]')?.value==='' && document.querySelector('[aria-label=\\\"B5\\\"]')?.value===''"), true, 'reload restores two empty visible cells')
  assert.deepEqual(await readFormulaValues(), baselineValues, 'seven formula results survive merge, Undo/Redo, unmerge and reload')
  console.log(JSON.stringify({ ok: true, implementationAssessment: 'context-menu merge/unmerge lifecycle passed for the audited empty horizontal range', contextMenuActions: { merge: { label: mergeMenuItem.text, enabledOnEmptySelection: !mergeMenuItem.disabled, disabledOnEmptySelection: emptyUnmergeMenuItem.disabled, selectedByRightClick: true }, unmerge: { label: unmergeMenuItem.text, enabledOnMergedSelection: !unmergeMenuItem.disabled, disabledOnMergedSelection: mergedAction.disabled, selectedByRightClick: true } }, range: 'A5:B5', initiallyEmpty: true, globalUndoRedo: true, mergedPersistedAfterReload: true, unmergePersistedAfterReload: true, formulaResultsPreserved: baselineValues }, null, 2))
} finally {
  try { pageSocket?.close() } catch {}
  if (browserSocket?.readyState === WebSocket.OPEN) {
    try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {}
    try { await waitFor(() => chrome?.exitCode !== null || chrome?.signalCode !== null, 'Chrome shutdown', 5000) } catch {}
  }
  await stop(chrome)
  await stop(vite)
  try { await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }) } catch {}
}
