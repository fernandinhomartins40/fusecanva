import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

async function firstExisting(paths) {
  for (const candidate of paths) {
    try { await access(candidate, constants.X_OK); return candidate } catch {}
  }
  throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH para executar o teste de navegador.')
}

async function freePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitFor(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) { lastError = error }
    await delay(150)
  }
  throw new Error(`Tempo esgotado aguardando ${label}${lastError ? `: ${lastError}` : ''}`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve() }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

const chromePath = await firstExisting(chromeCandidates)
const vitePort = await freePort()
let cdpPort = await freePort()
while (cdpPort === vitePort) cdpPort = await freePort()
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'fuse-doc-inline-'))
let vite
let chrome
let socket
let browserSocket

try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'servidor local do Vite')
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, `http://127.0.0.1:${vitePort}/`,
  ], { windowsHide: true, stdio: 'ignore' })

  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const page = targets.find(target => target.type === 'page' && target.url.includes(`127.0.0.1:${vitePort}`))
  assert.ok(page, 'aba local do editor disponível')
  socket = new WebSocket(page.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  })
  async function send(method, params = {}) {
    const id = ++nextId
    const response = new Promise(resolve => pending.set(id, resolve))
    socket.send(JSON.stringify({ id, method, params }))
    return response
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (!response?.result) throw new Error(`Runtime.evaluate failed: ${JSON.stringify(response)}`)
    if (response.result.exceptionDetails) throw new Error(`${response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text}; expression length=${expression.length}`)
    return response.result.result.value
  }
  async function pressKey(key, modifiers = 0) {
    const code = key === ' ' ? 'Space' : key
    const windowsVirtualKeyCode = ({ Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 })[key]
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers })
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await waitFor(async () => evaluate("Array.from(document.querySelectorAll('button')).some(button => button.innerText.includes('Documento'))"), 'biblioteca local')
  await evaluate("Array.from(document.querySelectorAll('button')).find(button => button.innerText.includes('Documento')).click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-editable-text'))"), 'editor Docs')
  assert.equal(await evaluate("!!document.querySelector('.doc-case-toggle svg.lucide-case-sensitive') && document.querySelector('.doc-case-toggle .visually-hidden')?.textContent.trim().length>10"), true, 'match-case uses the shared Lucide icon family and keeps an accessible label')
  await evaluate("document.querySelector('.doc-quick-table-actions > button').focus()")
  await pressKey('Enter')
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-quick-table-actions [role=dialog] button[data-table-dimensions]').length===64"), '8-by-8 table dimension picker')
  assert.equal(await evaluate("document.activeElement?.dataset.tableDimensions"), '4x3', 'opening focuses the current 4-by-3 grid choice')
  assert.equal(await evaluate("document.querySelectorAll('[role=gridcell][tabindex=\"0\"]').length"), 1, 'the dimension grid has one tab stop')
  for (const [key, expected, modifiers] of [['ArrowLeft', '3x3', 0], ['ArrowUp', '3x2', 0], ['Home', '1x2', 0], ['End', '8x2', 0], ['Home', '1x1', 2], ['End', '8x8', 2], ['ArrowDown', '8x8', 0], ['ArrowRight', '8x8', 0]]) {
    await pressKey(key, modifiers)
    assert.equal(await evaluate("document.activeElement?.dataset.tableDimensions"), expected, `${key} moves or clamps the grid focus`)
    assert.equal(await evaluate("document.activeElement?.getAttribute('aria-selected')"), 'true', 'the focused dimensions are announced as selected')
  }
  await pressKey('Escape')
  await waitFor(() => evaluate("!document.querySelector('#doc-quick-table-dialog') && document.activeElement===document.querySelector('.doc-quick-table-actions > button')"), 'Escape closes the picker and returns focus')
  assert.equal(await evaluate("document.querySelectorAll('.doc-table textarea[data-table-id]').length"), 0, 'canceling does not insert a table')
  await pressKey(' ')
  await waitFor(() => evaluate("!!document.querySelector('[role=gridcell][tabindex=\"0\"]')"), 'Space opens the picker')
  await pressKey('Home', 2)
  await pressKey(' ')
  await waitFor(() => evaluate("document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table textarea[data-table-id]').length===1"), 'Space inserts a 1-by-1 table')
  await evaluate("document.querySelector('[aria-label=Desfazer]').click()")
  await waitFor(() => evaluate("!document.querySelector('.doc-table textarea[data-table-id]')"), 'Undo removes the space-inserted table')

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("document.querySelector('.doc-quick-table-actions > button').click()")
  await waitFor(() => evaluate("document.querySelector('#doc-quick-table-dialog')?.getBoundingClientRect().width>300 && document.querySelector('[data-table-dimensions=\"2x2\"]')?.getBoundingClientRect().height>=44"), 'mobile dimension picker')
  const mobilePicker = await evaluate("(()=>{const dialog=document.querySelector('#doc-quick-table-dialog').getBoundingClientRect();const button=document.querySelector('[data-table-dimensions=\"2x2\"]').getBoundingClientRect();return {left:dialog.left,right:dialog.right,bottom:dialog.bottom,button:{x:button.left+button.width/2,y:button.top+button.height/2,width:button.width,height:button.height},scroll:document.documentElement.scrollWidth}})()")
  assert.ok(mobilePicker.left>=0 && mobilePicker.right<=390 && mobilePicker.bottom<=844 && mobilePicker.scroll<=390, `mobile picker fits the viewport: ${JSON.stringify(mobilePicker)}`)
  assert.ok(mobilePicker.button.width>=44 && mobilePicker.button.height>=44, 'mobile grid choices meet the 44px touch target')
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const touchPoint = { x: Math.round(mobilePicker.button.x), y: Math.round(mobilePicker.button.y), id: 1 }
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await waitFor(() => evaluate("document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table tbody tr').length===2 && document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table tbody tr:first-child textarea').length===2"), 'touch inserts a 2-by-2 table')
  await waitFor(() => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'mobile table saves')
  await send('Page.reload')
  await waitFor(() => evaluate("document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table tbody tr').length===2 && document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table tbody tr:first-child textarea').length===2"), 'mobile table persists after reload')
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await evaluate("document.querySelector('.doc-page:not(.doc-measure-page) .doc-table textarea[data-table-row=\"0\"][data-table-column=\"0\"]').focus()")
  await waitFor(() => evaluate("!!document.querySelector('.doc-delete-block')"), 'selected mobile table after reload')
  await evaluate("document.querySelector('.doc-delete-block').click()")
  await waitFor(() => evaluate("!document.querySelector('.doc-table textarea[data-table-id]')"), 'remove mobile table fixture')

  await evaluate("document.querySelector('.doc-quick-table-actions > button').focus()")
  await pressKey('Enter')
  await waitFor(() => evaluate("!!document.querySelector('[role=gridcell][tabindex=\"0\"]')"), 'keyboard picker reopens')
  await pressKey('Home', 2)
  for (let step = 0; step < 3; step += 1) await pressKey('ArrowRight')
  for (let step = 0; step < 2; step += 1) await pressKey('ArrowDown')
  assert.equal(await evaluate("document.activeElement?.dataset.tableDimensions"), '4x3', 'keyboard selects the audited 4-by-3 size')
  await pressKey('Enter')
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-table textarea[data-table-row=\"2\"][data-table-column=\"3\"]'))"), 'quick action inserts a 3-by-4 table')
  await waitFor(() => evaluate("document.activeElement?.matches('textarea[data-table-row=\"0\"][data-table-column=\"0\"]')"), 'keyboard insertion focuses the first table cell')
  const quickTableValues = ['Nome, café', 'Descrição, longa', 'Preço 12,50', 'Estado: revisão', 'Ação', 'Olá, mundo', 'São Paulo', 'Concluído', 'Linha 3', 'Com vírgula, sim', 'Acentuação áéí', 'Última célula']
  for (let index = 0; index < quickTableValues.length; index += 1) {
    const row = Math.floor(index / 4), column = index % 4, value = quickTableValues[index]
    await evaluate(`(()=>{const field=document.querySelector('.doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitFor(async () => evaluate(`document.querySelector('.doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]')?.value===${JSON.stringify(value)}`), `quick-table value ${row}:${column}`)
  }
  await evaluate("(()=>{const field=document.querySelector('.doc-table textarea[data-table-row=\"2\"][data-table-column=\"3\"]');field.focus();field.setSelectionRange(field.value.length,field.value.length)})()")
  assert.equal(await evaluate("(()=>document.activeElement===document.querySelector('.doc-table textarea[data-table-row=\"2\"][data-table-column=\"3\"]'))()"), true, 'the table final cell receives focus')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(250)
  const keyboardAppendState = await evaluate("(()=>({rows:document.querySelector('.doc-table')?.querySelectorAll('tbody tr').length,activeRow:document.activeElement?.getAttribute('data-table-row'),activeColumn:document.activeElement?.getAttribute('data-table-column'),activeValue:document.activeElement?.value,activeTag:document.activeElement?.tagName}))()")
  assert.equal(keyboardAppendState.rows, 4, `ArrowRight then Enter appends fourth row: ${JSON.stringify(keyboardAppendState)}`)
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'quick table and appended row saved')
  await send('Page.reload')
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-table textarea[data-table-id]'))"), 'quick table editor route restored after reload')
  assert.deepEqual(await evaluate("(()=>{const table=document.querySelector('.doc-table');const fields=[...table.querySelectorAll('textarea[data-table-id]')];return {rows:table.querySelectorAll('tbody tr').length,values:fields.slice(0,12).map(field=>field.value)}})()"), { rows: 4, values: quickTableValues }, 'the twelve accented/comma-separated values and appended row survive reload')
  const fourParagraphs = ['Parágrafo um', 'Parágrafo dois', 'Parágrafo três', 'Parágrafo quatro']
  for (let column = 0; column < 4; column += 1) {
    const value = fourParagraphs[column]
    await evaluate(`(()=>{const field=document.querySelector('.doc-table textarea[data-table-row=\"0\"][data-table-column=\"${column}\"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  }
  await evaluate("(()=>{const fields=[...document.querySelectorAll('.doc-table textarea[data-table-row=\"0\"]')];fields[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));fields[3].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,shiftKey:true}))})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-table-cell-selected').length===4&&document.querySelector('.doc-inline-table-actions button:nth-of-type(7)')?.disabled===false"), 'four first-row cells selected')
  await evaluate("document.querySelector('.doc-inline-table-actions button:nth-of-type(7)').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-table tr:first-child td[colspan=\"4\"]')?.textContent.includes('Parágrafo quatro')"), 'merge retains the four first-row paragraphs')
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Desfazer\"]')?.disabled"), false, 'Undo is available after merging the first row')
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Refazer\"]')?.disabled"), true, 'Redo is unavailable immediately after merging the first row')
  await evaluate("document.querySelector('button[aria-label=\"Desfazer\"]').click()")
  await delay(300)
  const afterMergeUndo = await evaluate("(()=>({cells:[...document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table tr:first-child td')].map(cell=>({span:cell.colSpan,text:cell.textContent,fields:[...cell.querySelectorAll('textarea')].map(field=>({row:field.dataset.tableRow,column:field.dataset.tableColumn,value:field.value}))})),undo:document.querySelector('button[aria-label=\"Desfazer\"]')?.disabled,redo:document.querySelector('button[aria-label=\"Refazer\"]')?.disabled,save:document.querySelector('.save-state')?.textContent}))()")
  assert.equal(afterMergeUndo.cells.length, 4, `Undo restores four separate first-row cells: ${JSON.stringify(afterMergeUndo)}`)
  assert.deepEqual(afterMergeUndo.cells.map(cell => cell.fields[0].value), fourParagraphs, 'Undo restores the original text in each first-row cell')
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Refazer\"]')?.disabled"), false, 'Redo becomes available after Undo restores the first row')
  await evaluate("document.querySelector('button[aria-label=\"Refazer\"]').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-page:not(.doc-measure-page) .doc-table tr:first-child td[colspan=\"4\"]')?.textContent.includes('Parágrafo quatro')"), 'Redo restores the first-row merge')
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Desfazer\"]')?.disabled"), false, 'Undo becomes available again after Redo')
  await evaluate("document.querySelector('.doc-inline-table-actions button:nth-of-type(8)').click()")
  await waitFor(async () => evaluate("!document.querySelector('.doc-table tr:first-child td[colspan=\"4\"]')"), 'unmerge restores four separate first-row cells')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'unmerged paragraphs saved')
  await send('Page.reload')
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-table textarea[data-table-id]'))"), 'unmerged paragraph editor route restored after reload')
  assert.deepEqual(await evaluate("(()=>[...document.querySelectorAll('.doc-page:not(.doc-measure-page) .doc-table tbody tr:first-child textarea')].map(field=>field.value))()"), ['Parágrafo um\nParágrafo dois\nParágrafo três\nParágrafo quatro', '', '', ''], 'A1 retains all four paragraphs and the other unmerged first-row cells remain empty')
  await evaluate("document.querySelector('.doc-page:not(.doc-measure-page) .doc-table textarea[data-table-row=\"0\"][data-table-column=\"0\"]').focus()")
  await waitFor(() => evaluate("!!document.querySelector('.doc-delete-block')"), 'restored table selected before deletion')
  await evaluate("document.querySelector('.doc-delete-block')?.click()")
  await waitFor(async () => evaluate("!document.querySelector('.doc-table textarea[data-table-id]')"), 'remove focused quick-action table fixture')
  console.log('PASS Docs table journey: quick insert and reload, ArrowRight+Enter row append, first-row merge Undo/Redo, and four-paragraph unmerge round-trip.')
} finally {
  if (browserSocket?.readyState === WebSocket.OPEN) {
    try { await new Promise(resolve => { const timer = setTimeout(resolve, 1200); browserSocket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true }); browserSocket.send(JSON.stringify({ id: 999998, method: 'Browser.close' })) }) } catch {}
  }
  if (socket?.readyState === WebSocket.OPEN) {
    try { await new Promise(resolve => { const timer = setTimeout(resolve, 1200); socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true }); socket.close() }) } catch {}
    socket.close()
  }
  if (vite && vite.exitCode === null && vite.signalCode === null) vite.kill()
  let chromeStopped = !chrome || chrome.exitCode !== null || chrome.signalCode !== null
  if (!chromeStopped) {
    try { await waitFor(() => chrome.exitCode !== null || chrome.signalCode !== null, 'fechamento do Chrome', 8000); chromeStopped = true } catch {}
  }
  if (!chromeStopped) chrome?.kill()
  await stopChild(vite)
  if (chromeStopped || !chrome || chrome.exitCode !== null || chrome.signalCode !== null) {
    let cleanupError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(profileDir, { recursive: true, force: true }); cleanupError = undefined; break }
      catch (error) { cleanupError = error; await delay(250) }
    }
    if (cleanupError) console.warn(`Could not remove temporary Chrome profile ${profileDir}: ${cleanupError.message}`)
  }
}

