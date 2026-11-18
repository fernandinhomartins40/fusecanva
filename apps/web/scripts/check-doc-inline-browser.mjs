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
    if (!response.result) throw new Error(`CDP Runtime.evaluate failed: ${JSON.stringify(response.error)}; expression length=${expression.length}`)
    if (response.result.exceptionDetails) throw new Error(`${response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text}; expression length=${expression.length}`)
    return response.result.result.value
  }
  async function reloadRouteToLibrary() {
    const route = await evaluate("location.pathname + location.search")
    await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/#home-projects` })
    await waitFor(async () => evaluate("Boolean(document.querySelector('.project-open'))"), 'Docs returns to the local library')
    return route
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await evaluate("document.documentElement.dataset.theme='light'")
  await waitFor(async () => evaluate("Array.from(document.querySelectorAll('button')).some(button => button.innerText.includes('Documento'))"), 'biblioteca local')
  await evaluate("Array.from(document.querySelectorAll('button')).find(button => button.innerText.includes('Documento')).click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-editable-text'))"), 'editor Docs')
  await evaluate("document.querySelector('[aria-label=\"Propriedades do documento\"]').click();document.querySelector('.doc-format-help button').click()")
  for (const [index, centimeters] of [[0, '1.96'], [1, '1.91'], [3, '1.91']]) {
    await evaluate(`(()=>{const input=document.querySelectorAll('.doc-page-setup input[type=number]')[${index}];const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(centimeters)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(async () => evaluate(`document.querySelectorAll('.doc-page-setup input[type=number]')[${index}]?.value===${JSON.stringify(centimeters)}`), `REA document fixture margin ${index}`)
  }
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'audited Docs fixture margins saved')
  await evaluate("document.querySelector('[aria-label=\"Propriedades do documento\"]').click()")
  assert.equal(await evaluate("!!document.querySelector('.doc-case-toggle svg.lucide-case-sensitive') && document.querySelector('.doc-case-toggle .visually-hidden')?.textContent.trim().length>10"), true, 'match-case uses the shared Lucide icon family and keeps an accessible label')
  await evaluate("document.querySelector('.doc-tool-rail button:nth-of-type(2)').click()")
  await evaluate("document.querySelector('[aria-label^=Adicionar]').click()")
  const headingEntry = await waitFor(async () => evaluate("[...document.querySelectorAll('.doc-outline-list button')].find(entry=>entry.querySelector('svg.lucide'))?.dataset.docBlockId ?? null"), 'ícone Lucide para título na estrutura Docs')
  assert.ok(headingEntry, 'heading structure uses the shared Lucide icon set rather than the legacy H1 text glyph')
  await evaluate("document.querySelector('.doc-tool-rail button:nth-of-type(2)').click()")
  await evaluate("(()=>{const field=document.querySelector('[aria-label=\"Estilo do bloco\"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(field,'subheading');field.dispatchEvent(new Event('change',{bubbles:true}))})()")
  const subheadingEntry = await waitFor(async () => evaluate("[...document.querySelectorAll('.doc-outline-list button')].find(entry=>entry.querySelector('svg.lucide'))?.dataset.docBlockId ?? null"), 'ícone Lucide para subtítulo na estrutura Docs')
  assert.ok(subheadingEntry, 'subheading structure uses the shared Lucide icon set rather than the legacy H2 text glyph')
  await evaluate("document.querySelector('.doc-delete-block')?.click()")
  await evaluate("(()=>{const entry=[...document.querySelectorAll('.doc-outline-list button')].find(item=>item.dataset.docBlockId===" + JSON.stringify(headingEntry) + ");entry?.click();document.querySelector('.doc-delete-block')?.click()})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-outline-list button').length===1"), 'remove temporary heading icon fixtures')
  await evaluate("(()=>{const root=document.querySelector('.doc-editor-layout');if(root.classList.contains('doc-outline-open'))document.querySelector('.doc-tool-rail button:first-child').click()})()")
  const longCellText = JSON.stringify(Array.from({ length: 60 }, (_, index) => `REA-LINHA-${String(index + 1).padStart(2, '0')} conte\u00fado de laborat\u00f3rio para verificar a quebra de uma c\u00e9lula de tabela em p\u00e1ginas A4.`).join('\n'))
  const longRowPagination = await evaluate(`(async()=>{const {paginateDocBlocks}=await import('/src/export.ts');const canvas=document.createElement('canvas');const context=canvas.getContext('2d');const measure=(text,size,weight)=>{context.font=weight+' '+size+'px Arial, sans-serif';return context.measureText(text).width};const table={id:'lab-long-row',type:'table',text:'',cells:[['Produto','Quantidade','Pre\u00e7o','Estado'],['Caneca','2','15,50','Em an\u00e1lise'],['Bloco','3','8,00','Conclu\u00eddo'],['Novo Produto',${longCellText},'','A revisar']],cellPadding:20};const heading={id:'lab-following-heading',type:'heading',text:'REA DOCUMENTO DE LABORATORIO'};const pages=paginateDocBlocks([table,heading],794,1123,measure);const tableBlocks=pages.map(page=>page.filter(block=>block.type==='table'));let inLongRow=false;const fragments=[];for(const block of tableBlocks.flat())for(const row of block.cells){if(row[0]==='Novo Produto')inLongRow=true;if(inLongRow)fragments.push(row[1]||'')}const markers=[...fragments.join(' ').matchAll(/REA-LINHA-(\\d{2})/g)].map(match=>Number(match[1]));const headerCount=tableBlocks.flat().flatMap(block=>block.cells).flat().filter(cell=>cell==='Produto').length;return{pageCount:pages.length,markers,headerCount,headingPage:pages.findIndex(page=>page.some(block=>block.id===heading.id))+1,fragments:fragments.length,fragmentLineCounts:fragments.map(fragment=>fragment.split("\\n").length)}})()`)
  assert.equal(longRowPagination.pageCount, 14, `native Canvas metrics produce fourteen pages for the declared A4 fixture: ${JSON.stringify(longRowPagination)}`)
  const longRowRenderedPages = await evaluate(`(async()=>{const {renderDocumentCanvases}=await import('/src/export.ts');const table={id:'lab-long-row',type:'table',text:'',cells:[['Produto','Quantidade','Preço','Estado'],['Caneca','2','15,50','Em análise'],['Bloco','3','8,00','Concluído'],['Novo Produto',${longCellText},'','A revisar']],cellPadding:20};const heading={id:'lab-following-heading',type:'heading',text:'REA DOCUMENTO DE LABORATORIO'};const pages=await renderDocumentCanvases({type:'doc',width:794,height:1123,pages:[{id:'lab-page',background:'#ffffff',blocks:[table,heading]}]});const dimensions=pages.map(({canvas})=>[canvas.width,canvas.height]);window.__longRowPdfPageImages=pages.map(({canvas})=>{const image=canvas.toDataURL('image/png');canvas.width=0;canvas.height=0;return image});return{pageCount:pages.length,dimensions}})()`)
  assert.equal(longRowRenderedPages.pageCount, 14, 'actual document canvases follow the audited fourteen-page pagination')
  assert.deepEqual(longRowRenderedPages.dimensions, Array.from({ length: 14 }, () => [1588, 2246]), 'every rendered page remains exactly A4-sized')
  const longRowPdf = await evaluate(`(async()=>{const {createPdfBytes}=await import('/src/export.ts');const bytes=await createPdfBytes(794,1123,window.__longRowPdfPageImages);window.__longRowPdfPageImages=null;const source=new TextDecoder().decode(bytes);window.__longRowPdfBytes=new Uint8Array(bytes);return{byteLength:bytes.byteLength,pageCount:source.split('/Type /Page').length-2,a4Count:source.split('/MediaBox [0 0 595.5 842.25]').length-1,sourceLength:source.length}})()`)
  assert.ok(longRowPdf.sourceLength > 100000, `the actual long-row PDF bytes are generated: ${JSON.stringify(longRowPdf)}`)
  assert.equal(longRowPdf.pageCount, 14, 'the actual long-row PDF contains fourteen physical pages')
  assert.equal(longRowPdf.a4Count, 14, 'all physical PDF pages retain the A4 MediaBox')
  assert.deepEqual(longRowPagination.markers, Array.from({ length: 60 }, (_, index) => index + 1), 'all sixty lines remain in order under native Canvas metrics')
  assert.equal(longRowPagination.headerCount, 1, 'one header cell appears once across all pages')
  assert.equal(longRowPagination.headingPage, 14, 'the following heading lands on page fourteen')
  await evaluate(`(() => { const root=document.querySelector('.doc-editable-text'); root.focus(); const range=document.createRange(); range.selectNodeContents(root); range.collapse(true); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range) })()`)
  await send('Input.insertText', { text: 'hello world' })
  await waitFor(async () => evaluate("document.querySelector('.doc-editable-text')?.innerText === 'hello world'"), 'digitação sem texto duplicado')

  await evaluate(`(() => { const root=document.querySelector('.doc-editable-text'); const node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode(); const range=document.createRange(); range.setStart(node,0); range.setEnd(node,5); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); root.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})) })()`)
  assert.equal(await evaluate("!document.querySelector('button[aria-label=Negrito]').disabled"), true, 'negrito habilitado para o trecho selecionado')
  await evaluate("document.querySelector('button[aria-label=Negrito]').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-editable-text')?.querySelector('span[style*=font-weight]')?.style.fontWeight === '700'"), 'marca de negrito aplicada')
  assert.equal(await evaluate('getSelection().toString()'), 'hello', 'a seleção permanece após formatar')
  assert.equal(await evaluate("document.querySelector('button[aria-label=Sublinhado]')?.getAttribute('aria-pressed')"), 'false', 'sublinhado starts inactive on the selected text')
  await evaluate("document.querySelector('button[aria-label=Sublinhado]').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-editable-text')?.querySelector('span[style*=underline]')?.style.textDecorationLine.includes('underline')"), 'marca de sublinhado aplicada')
  assert.equal(await evaluate("document.querySelector('button[aria-label=Sublinhado]')?.getAttribute('aria-pressed')"), 'true', 'underline button announces its selected state')
  await evaluate("document.querySelector('.doc-editable-text').dispatchEvent(new KeyboardEvent('keydown',{key:'x',code:'KeyX',ctrlKey:true,shiftKey:true,bubbles:true}))")
  await waitFor(async () => evaluate("document.querySelector('.doc-editable-text')?.querySelector('span[style*=line-through]')?.style.textDecorationLine.includes('line-through')"), 'marca de tachado aplicada pelo atalho')
  assert.equal(await evaluate("document.querySelector('button[aria-label=Tachado]')?.getAttribute('aria-pressed')"), 'true', 'strikethrough button reflects the selected text')

  await evaluate(`(() => { const root=document.querySelector('.doc-editable-text'); const node=document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode(); const range=document.createRange(); range.setStart(node,5); range.collapse(true); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range) })()`)
  await send('Input.insertText', { text: 'X' })
  await waitFor(async () => evaluate("document.querySelector('.doc-editable-text')?.innerText === 'helloX world'"), 'edição após formatação')
  const cursor = await waitFor(async () => evaluate(`(() => { const root=document.querySelector('.doc-editable-text'); const selection=getSelection(); if(!root || !selection.anchorNode || !root.contains(selection.anchorNode)) return null; const range=document.createRange(); range.selectNodeContents(root); range.setEnd(selection.anchorNode,selection.anchorOffset); const offset=range.toString().length; return root.innerText==='helloX world' && offset===6 ? offset : null })()`), 'posição do cursor restaurada')
  assert.equal(cursor, 6, 'o cursor permanece após o texto inserido')

  const storedMarks = await waitFor(async () => evaluate(`(async () => { const db=await new Promise((resolve,reject)=>{ const request=indexedDB.open('fuse-studio'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error) }); return await new Promise((resolve,reject)=>{ const request=db.transaction('documents','readonly').objectStore('documents').getAll(); request.onsuccess=()=>resolve(request.result[0]?.pages[0]?.blocks[0]?.marks?.length ? request.result[0].pages[0].blocks[0].marks : null); request.onerror=()=>reject(request.error) }) })()`), 'marcas inline salvas no IndexedDB')
  assert.deepEqual(storedMarks, [{ start: 0, end: 6, bold: true, underline: true, strike: true }], 'overlapping inline marks remain after text edit and persist in IndexedDB')
  assert.equal(await evaluate("[...document.querySelectorAll('.doc-add-blocks button')].every(button=>button.querySelector('svg.lucide'))"), true, 'document add controls render Lucide icons consistently')
  assert.equal(await evaluate("[...document.querySelectorAll('.doc-inline-format button')].every(button=>button.querySelector('svg.lucide')&&!button.querySelector('strong,em'))"), true, 'inline formatting controls use the same Lucide icon family as the document tools')
  assert.equal(await evaluate("!!document.querySelector('.doc-case-toggle svg.lucide-case-sensitive') && document.querySelector('.doc-case-toggle .visually-hidden')?.textContent.trim().length>10"), true, 'match-case uses the shared Lucide icon family and keeps an accessible label')
  await evaluate("[...document.querySelectorAll('.doc-add-blocks button')].find(button=>button.textContent.includes('Tabela'))?.click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-table'))"), 'tabela selecionada no Docs')
  await evaluate("document.querySelector('.doc-inline-table-actions button')?.click()")
  const readMergeHistoryState = async () => evaluate(`(async()=>{const request=indexedDB.open('fuse-studio');const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});const docs=await new Promise((resolve,reject)=>{const read=db.transaction('documents','readonly').objectStore('documents').getAll();read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error)});db.close();const doc=docs.find(item=>item.type==='doc');if(!doc)return null;const table=doc.pages.flatMap(page=>page.blocks??[]).find(block=>block.type==='table');const stable={...doc};delete stable.updatedAt;return{tableId:table?.id,cells:table?.cells,merges:table?.merges??[],stable}})()`)
  const setTableCell = async (row, column, value) => {
    await evaluate(`(()=>{const field=document.querySelector('.doc-block.active .doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]');if(!field)throw new Error('Missing Docs cell ${row}:${column}');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitFor(async () => evaluate(`document.querySelector('.doc-block.active .doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]')?.value===${JSON.stringify(value)}`), `merge-history cell ${row}:${column}`)
  }
  await setTableCell(0, 0, 'Merge left')
  await setTableCell(0, 1, 'Merge right')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'baseline merge-history table saved')
  const mergeHistoryBaseline = await readMergeHistoryState()
  assert.ok(mergeHistoryBaseline?.tableId && mergeHistoryBaseline.cells?.[0]?.slice(0, 2).join('|') === 'Merge left|Merge right', 'the isolated table has two separate source cell values')
  await evaluate("(()=>{const cells=[...document.querySelectorAll('.doc-block.active .doc-table textarea[data-table-row=\"0\"]')];cells[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));cells[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,shiftKey:true}))})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-block.active .doc-table-cell-selected').length===2&&(()=>{const button=[...document.querySelectorAll('.doc-inline-table-actions button')].find(item=>item.textContent.includes('Mesclar seleção'));return Boolean(button&&!button.disabled)})()"), 'two adjacent first-row cells selected for merge')
  await evaluate("[...document.querySelectorAll('.doc-inline-table-actions button')].find(item=>item.textContent.includes('Mesclar seleção')).click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-block.active .doc-table tr:first-child td[colspan=\"2\"]')?.textContent.includes('Merge left')"), 'first-row merge applied')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'merged state saved')
  const mergedHistoryState = await readMergeHistoryState()
  assert.equal(mergedHistoryState.merges[0]?.colSpan, 2, 'the saved merged checkpoint records a two-cell span')
  assert.equal(mergedHistoryState.cells[0][0], 'Merge left\nMerge right', 'merge preserves both cell values in order')
  await evaluate("document.querySelector('.doc-inline-table-actions button:last-of-type').click()")
  await waitFor(async () => evaluate("!document.querySelector('.doc-block.active .doc-table tr:first-child td[colspan=\"2\"]')"), 'direct unmerge restores two visible cells')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'directly unmerged state saved')
  const unmergedHistoryState = await readMergeHistoryState()
  assert.deepEqual(unmergedHistoryState.merges, [], 'direct unmerge removes the merge topology')
  assert.equal(await evaluate("document.querySelector('.icon-button[aria-label=\"Desfazer\"]')?.disabled"), false, 'Undo remains available after the merge/unmerge edits')
  await evaluate("document.querySelector('.icon-button[aria-label=\"Desfazer\"]').click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-table tr:first-child td[colspan=\"2\"]'))"), 'Undo restores the merged topology')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'Undo merged state persisted')
  assert.deepEqual(await readMergeHistoryState(), mergedHistoryState, 'Undo restores the full saved merged checkpoint, including unrelated document state')
  await evaluate("document.querySelector('.icon-button[aria-label=\"Refazer\"]')?.click()")
  await waitFor(async () => evaluate("!document.querySelector('.doc-block.active .doc-table tr:first-child td[colspan=\"2\"]')"), 'Redo restores the unmerged topology')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'Redo unmerged state persisted')
  assert.deepEqual(await readMergeHistoryState(), unmergedHistoryState, 'Redo restores the full unmerged checkpoint, including unrelated document state')
  await evaluate("document.querySelector('.doc-table textarea[data-table-id]')?.focus()")
  await waitFor(async () => evaluate("document.querySelector('.doc-table-controls input[type=number]')?.value==='0'"), 'table spacing and padding controls')
  await evaluate("(()=>{const input=document.querySelector('.doc-table-controls label:nth-child(2) input');const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;setter.call(input,'20');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(async () => evaluate("document.querySelector('.doc-table-controls label:nth-child(2) input')?.value==='20'"), 'cell padding control accepts the requested value')
  await evaluate("document.querySelector('.doc-toolbar [aria-label=Borda]').click()")
  assert.equal(await evaluate("document.querySelectorAll('.doc-table-border-style-options [role=radio]').length"), 5, 'the border picker exposes all five audited styles')
  await evaluate("[...document.querySelectorAll('[role=radio]')].find(item=>item.textContent.trim()==='Pontos')?.click()")
  await evaluate("document.querySelector('.doc-table-border-all').click()")
  const tableStyle = await waitFor(async () => evaluate("(()=>{const cells=[...document.querySelectorAll('.doc-block.active .doc-table td')];const paint=getComputedStyle(cells[0]);const edgePaints=paint.backgroundImage.split('linear-gradient(').length-1;return cells.length===16&&cells.every(cell=>getComputedStyle(cell).paddingTop==='20px')&&edgePaints===4?{cells:cells.length,padding:paint.paddingTop,border:paint.backgroundImage.includes('repeating-linear-gradient'),edgePaints}:null})()"), 'dotted edges and 16 table cells')
  assert.deepEqual(tableStyle, { cells: 16, padding: '20px', border: true, edgePaints: 4 })
  assert.equal(await evaluate("(()=>{const field=document.querySelector('.doc-block.active .doc-table td textarea');const style=field&&getComputedStyle(field);return style?.borderTopWidth==='0px'&&style?.resize==='none'})()"), true, 'table fields should not show native browser borders or resize handles')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-table-border-style-options [role=radio]').length===5"), 'reopened five-style border picker')
  await evaluate("document.querySelector('.doc-table-border-style-options [data-border-style=long-dashes]').click()")
  await evaluate("document.querySelector('.doc-table-border-all').click()")
  await waitFor(async () => evaluate("getComputedStyle(document.querySelector('.doc-block.active .doc-table td')).backgroundImage.includes('8px')&&getComputedStyle(document.querySelector('.doc-block.active .doc-table td')).backgroundImage.includes('12px')"), 'long dash pattern renders in the table')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-table-border-style-options [role=radio]').length===5"), 'reopened border picker for short dashes')
  await evaluate("document.querySelector('.doc-table-border-style-options [data-border-style=dashes]').click()")
  await evaluate("document.querySelector('.doc-table-border-all').click()")
  await waitFor(async () => evaluate("getComputedStyle(document.querySelector('.doc-block.active .doc-table td')).backgroundImage.includes('2px')&&getComputedStyle(document.querySelector('.doc-block.active .doc-table td')).backgroundImage.includes('4px')"), 'short dash pattern renders in the table')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-table-border-style-options [role=radio]').length===5"), 'reopened border picker for no border')
  await evaluate("[...document.querySelectorAll('.doc-table-border-style-options [role=radio]')].find(item=>item.getAttribute('aria-label')==='Sem borda').click()")
  await evaluate("document.querySelector('.doc-table-border-all').click()")
  await waitFor(async () => evaluate("(getComputedStyle(document.querySelector('.doc-block.active .doc-table td')).backgroundImage.split('linear-gradient(').length-1)===0"), 'borderless table edge')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-table-border-style-options [role=radio]').length===5"), 'reopened border picker to restore dots')
  await evaluate("[...document.querySelectorAll('.doc-table-border-style-options [role=radio]')].find(item=>item.getAttribute('aria-label')==='Pontos').click()")
  await evaluate("document.querySelector('.doc-table-border-all').click()")
  await waitFor(async () => evaluate("(getComputedStyle(document.querySelector('.doc-block.active .doc-table td')).backgroundImage.split('linear-gradient(').length-1)===4"), 'restore dotted border for the reference state')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Controle da espessura da borda\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'3');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(async () => evaluate("document.querySelector('[aria-label=\"Espessura da borda\"]')?.value==='3'"), 'slider sincronizado com o campo numérico')
  await evaluate("(()=>{const input=document.querySelector('[aria-label=\"Controle da espessura da borda\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(async () => evaluate("document.querySelector('[aria-label=\"Espessura da borda\"]')?.value==='2'"), 'espessura restaurada para 2')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  const visualTableValues = ['Produto', 'Quantidade', 'Pre\u00e7o', 'Estado', 'Bloco', '2', '15,50', 'Pendente', 'Bloco', '3', '8,00', 'Conclu\u00eddo', 'Novo item', '', '', 'A revisar']
  for (let index = 0; index < visualTableValues.length; index += 1) {
    const row = Math.floor(index / 4)
    const column = index % 4
    const value = visualTableValues[index]
    await evaluate(`(()=>{const field=document.querySelector('.doc-block.active .doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]');if(!field)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    await waitFor(async () => evaluate(`document.querySelector('.doc-block.active .doc-table textarea[data-table-row="${row}"][data-table-column="${column}"]')?.value===${JSON.stringify(value)}`), `reference table cell ${row + 1}:${column + 1}`)
  }
  await evaluate("(()=>{const field=document.querySelector('[aria-label=\"Nome do documento\"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,'REA - Laboratório Docs');field.dispatchEvent(new Event('input',{bubbles:true}))})()")
  const tableId = await evaluate("document.querySelector('.doc-block.active .doc-table')?.closest('.doc-block')?.dataset.docBlockId")
  for (let move = 0; move < 24; move += 1) {
    const moved = await evaluate("(()=>{const button=document.querySelector('[aria-label=\"Mover bloco para cima\"]');if(!button||button.disabled)return false;button.click();return true})()")
    if (!moved) break
    await delay(60)
  }
  await waitFor(async () => evaluate(`document.querySelector('.doc-outline-list button:first-child')?.dataset.docBlockId===${JSON.stringify(tableId)}`), 'tabela no topo da primeira página de referência')
  await evaluate("document.querySelectorAll('.doc-outline-list button')[1]?.click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-editable-text'))"), 'heading after reference table')
  await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Estilo do bloco\"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'heading');select.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active.doc-block-heading .doc-editable-text'))"), 'heading style for reference content')
  await evaluate("(()=>{const field=document.querySelector('.doc-block.active .doc-editable-text');field.textContent='REA DOCUMENTO DE LABORATÓRIO';field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'REA DOCUMENTO DE LABORATÓRIO'}))})()")
  await waitFor(async () => evaluate("document.querySelector('.doc-block.active .doc-editable-text')?.innerText==='REA DOCUMENTO DE LABORATÓRIO'"), 'reference heading content')
  const headingId = await evaluate("document.querySelector('.doc-block.active.doc-block-heading')?.dataset.docBlockId")
  await evaluate("document.querySelector('.doc-outline-toggle').click()")
  assert.equal(await evaluate(`(()=>{const entries=[...document.querySelectorAll('.doc-outline-list button')];const heading=entries.find(entry=>entry.dataset.docBlockId===${JSON.stringify(headingId)});const table=entries.find(entry=>entry.dataset.docBlockId===${JSON.stringify(tableId)});return Boolean(heading?.textContent.includes('REA DOCUMENTO DE LABORAT')&&table?.textContent.includes('Tabela')&&!table.textContent.includes('Produto'))})()`), true, 'the outline lists the heading without copying table cell text')
  await evaluate(`(()=>{const entry=[...document.querySelectorAll('.doc-outline-list button')].find(button=>button.dataset.docBlockId===${JSON.stringify(headingId)});entry?.focus()})()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  assert.equal(await waitFor(async () => evaluate(`document.querySelector('[data-doc-block-id="${headingId}"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('.doc-block.active')?.dataset.docBlockId===${JSON.stringify(headingId)}`), 'keyboard activates the outline heading and marks it pressed'), true)
  const revisedHeading = 'OUTLINE TITLE UPDATED'
  await evaluate(`(()=>{const field=document.querySelector('.doc-block.active .doc-editable-text');field.textContent=${JSON.stringify(revisedHeading)};field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(revisedHeading)}}))})()`)
  assert.equal(await waitFor(async () => evaluate(`document.querySelector('[data-doc-block-id="${headingId}"]')?.textContent.includes(${JSON.stringify(revisedHeading)})&&document.querySelector('[data-doc-block-id="${headingId}"]')?.getAttribute('aria-pressed')==='true'`), 'outline label updates when the heading text changes'), true)
  const referenceHeading = 'REA DOCUMENTO DE LABORATORIO'
  await evaluate("(()=>{const field=document.querySelector('.doc-block.active .doc-editable-text');field.textContent="+JSON.stringify(referenceHeading)+";field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"+JSON.stringify(referenceHeading)+"}))})()")
  await waitFor(async () => evaluate("document.querySelector('.doc-block.active .doc-editable-text')?.innerText==="+JSON.stringify(referenceHeading)), 'reference heading restored after outline edit')
  await evaluate("document.querySelector('.doc-outline-toggle').click()")
  await evaluate("document.querySelector('.doc-outline-list button:first-child')?.click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-table textarea[data-table-id]'))"), 'reference table selected again')
  await evaluate("(()=>{const input=document.querySelectorAll('.doc-table-controls input[type=number]')[1];const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'16.5');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(async () => evaluate("document.querySelectorAll('.doc-table-controls input[type=number]')[1]?.value==='16.5'"), 'visual reference cell padding')
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 897, deviceScaleFactor: 1, mobile: false })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-table textarea[data-table-id]')&&document.querySelector('.doc-toolbar [aria-label=Borda]'))"), 'tabela interativa na viewport de referência')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('[role=radio][aria-checked=true]'))"), 'border options visible for reference capture')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'table state saved before capture')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Nome do documento\"]')?.value"), 'REA - Laboratório Docs', 'the visual fixture name retains readable Portuguese text')
  await evaluate("(()=>{const page=document.querySelector('.doc-page:not(.doc-measure-page)');const scroller=page?.closest('.doc-scroll');if(page&&scroller)scroller.scrollTop+=page.getBoundingClientRect().top-112})()")
  await new Promise(resolve => setTimeout(resolve, 100))
  const referenceGeometry = await evaluate("(()=>{const page=document.querySelector('.doc-page:not(.doc-measure-page)');const table=page?.querySelector('.doc-table');const popover=document.querySelector('.doc-table-border-popover');const footer=document.querySelector('.doc-page-footer');const pageRect=page?.getBoundingClientRect();const tableRect=table?.getBoundingClientRect();const popoverRect=popover?.getBoundingClientRect();const footerRect=footer?.getBoundingClientRect();return {pageLeft:pageRect?.left,pageWidth:pageRect?.width,pageHeight:pageRect?.height,pageTop:pageRect?.top,tableTop:tableRect?.top,tableLeft:tableRect?.left,tableWidth:tableRect?.width,tableHeight:tableRect?.height,popoverLeft:popoverRect?.left,popoverTop:popoverRect?.top,popoverWidth:popoverRect?.width,popoverHeight:popoverRect?.height,footerTop:footerRect?.top,footerHeight:footerRect?.height}})()")
  assert.ok(Math.abs(referenceGeometry.pageLeft - 556) < 3, `A4 page should match the retained left edge: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.pageWidth - 880) < 2, `A4 page visual width should match the retained 880px reference: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.pageHeight - 1244) < 3, `A4 page visual height should match the retained 1244px reference: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.pageTop - 112) < 3, `A4 page should align to the retained top edge: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.tableTop - referenceGeometry.pageTop - 82) < 3, `table should start 82px below the page edge at reference zoom: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.tableLeft - 636) < 3, `table should align with the retained 80px side inset: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.tableWidth - 720) < 3, `table content width should match the retained reference: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.tableHeight - 261) < 4, `table row layout should match the retained reference: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.popoverLeft - 508) < 3 && Math.abs(referenceGeometry.popoverTop - 166) < 3, `border popover should align with the retained reference: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.popoverWidth - 321) < 2 && Math.abs(referenceGeometry.popoverHeight - 149) < 8, `border popover dimensions should match the retained reference: ${JSON.stringify(referenceGeometry)}`)
  assert.ok(Math.abs(referenceGeometry.footerTop - 856) < 2 && Math.abs(referenceGeometry.footerHeight - 41) < 2, `Docs status bar should align to the retained bottom chrome: ${JSON.stringify(referenceGeometry)}`)
  const toolbarGeometry = await evaluate("(()=>{const toolbar=document.querySelector('.doc-toolbar');const rect=toolbar?.getBoundingClientRect();return {left:rect?.left,top:rect?.top,width:rect?.width,height:rect?.height,hintDisplay:getComputedStyle(document.querySelector('.doc-toolbar-hint')).display,children:[...toolbar.children].map(element=>({className:element.className?.baseVal??element.className,height:element.getBoundingClientRect().height,display:getComputedStyle(element).display,minHeight:getComputedStyle(element).minHeight,padding:getComputedStyle(element).padding}))}})()")
  console.log(`Docs toolbar visual bounds: ${JSON.stringify(toolbarGeometry)}`)
  assert.ok(Math.abs(toolbarGeometry.width - 903) <= 12, `Docs toolbar width should stay within 12px of the retained 903px reference: ${JSON.stringify(toolbarGeometry)}`)
  assert.ok(Math.abs(toolbarGeometry.height - 40) <= 2, `Docs toolbar height should match the retained 40px reference: ${JSON.stringify(toolbarGeometry)}`)
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const artifactDir = path.join(webRoot, 'artifacts', 'visual')
  await mkdir(artifactDir, { recursive: true })
  const screenshotBytes = Buffer.from(screenshot.result.data, 'base64')
  assert.equal(screenshotBytes.readUInt32BE(16), 1920, 'reference screenshot width')
  assert.equal(screenshotBytes.readUInt32BE(20), 897, 'reference screenshot height')
  await writeFile(path.join(artifactDir, 'docs-table-dots-1920x897.png'), screenshotBytes)
  const shellState = await evaluate("(()=>({railWidth:document.querySelector('.doc-outline')?.getBoundingClientRect().width,inspectorDisplay:getComputedStyle(document.querySelector('.doc-inspector')).display}))()")
  assert.equal(shellState.railWidth, 72, `Docs tool navigation should match the compact rail: ${JSON.stringify(shellState)}`)
  assert.equal(shellState.inspectorDisplay, 'none', 'document properties should start collapsed')
  assert.equal(await evaluate("[...document.querySelectorAll('.doc-footer-utilities button')].every(button=>button.querySelector('svg.lucide'))"), true, 'the status bar uses the shared Lucide icon family')
  await evaluate("[...document.querySelectorAll('.doc-footer-utilities button')].find(button=>button.textContent.includes('Notas')).click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('[aria-label=\"Notas privadas neste dispositivo\"]'))"), 'private Docs notes panel')
  const privateNotes = 'Lembrete privado de revisao'
  await evaluate(`(()=>{const field=document.querySelector('[aria-label="Notas privadas neste dispositivo"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,${JSON.stringify(privateNotes)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await waitFor(async () => evaluate(`Object.keys(localStorage).some(key=>key.startsWith('fuse-doc-notes:')&&localStorage.getItem(key)===${JSON.stringify(privateNotes)})`), 'private note persistence')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Notas privadas neste dispositivo\"]')?.value"), privateNotes)
  await evaluate("document.querySelector('.doc-bottom-panel [aria-label=\"Fechar painel inferior\"]').click()")
  await evaluate("[...document.querySelectorAll('.doc-footer-utilities button')].find(button=>button.textContent.includes('Notas')).click()")
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Notas privadas neste dispositivo\"]')?.value"), privateNotes, 'private notes remain available after closing and reopening the panel')
  await evaluate("document.querySelector('.doc-bottom-panel [aria-label=\"Fechar painel inferior\"]').click()")
  await evaluate("document.querySelector('.doc-footer-utilities button:nth-child(2)').click()")
  assert.equal(await evaluate("document.querySelector('.doc-editor-layout').classList.contains('doc-outline-open')&&getComputedStyle(document.querySelector('.doc-outline-drawer')).display==='block'"), true, 'Index opens the Docs outline drawer')
  await evaluate("document.querySelector('.doc-footer-utilities button:nth-child(2)').click()")
  await evaluate("document.querySelector('.doc-footer-utilities button:nth-child(3)').click()")
  await evaluate("document.querySelector('[aria-label=\"Iniciar temporizador\"]').click()")
  await new Promise(resolve => setTimeout(resolve, 1150))
  await evaluate("document.querySelector('[aria-label=\"Pausar temporizador\"]').click()")
  assert.notEqual(await evaluate("document.querySelector('[aria-label=\"Tempo restante\"]')?.textContent"), '05:00', 'the Docs timer counts down while active')
  await evaluate("document.querySelector('[aria-label=\"Redefinir temporizador\"]').click()")
  await evaluate("document.querySelector('.doc-bottom-panel [aria-label=\"Fechar painel inferior\"]').click()")
  await evaluate("document.querySelector('.doc-tool-rail button:first-child').click()")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.doc-outline-drawer')).display"), 'block', 'structure drawer opens from the tool rail')
  await evaluate("document.querySelector('.doc-tool-rail button:first-child').click()")
  await evaluate("document.querySelector('[aria-label=\"Propriedades do documento\"]').click()")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.doc-inspector')).display"), 'block', 'document properties open from the toolbar')
  await evaluate("document.querySelector('[aria-label=\"Propriedades do documento\"]').click()")
  assert.equal(await evaluate("document.querySelectorAll('.doc-outline-page').length"), 1, 'the outline starts with the single source page')
  await evaluate("document.querySelector('.doc-new-page')?.click()")
  assert.equal(await waitFor(async () => evaluate("document.querySelectorAll('.doc-outline-page').length===2"), 'second logical page appears in document outline'), true)
  await evaluate("document.querySelectorAll('.doc-outline-page')[1].click()")
  assert.equal(await waitFor(async () => evaluate("document.querySelectorAll('.doc-outline-page')[1]?.getAttribute('aria-current')==='page'"), 'navigate to the second logical page'), true)
  await evaluate("document.querySelector('.doc-tool-rail button:nth-of-type(3)').click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('[data-doc-page-index=\"1\"][data-doc-block-id]'))"), 'second-page block appears in global outline')
  await evaluate("document.querySelector('.doc-tool-rail button:first-child').click()")
  await evaluate("document.querySelector('[data-doc-page-index=\"1\"][data-doc-block-id]').click()")
  assert.equal(await waitFor(async () => evaluate("document.querySelectorAll('.doc-outline-page')[1]?.getAttribute('aria-current')==='page'&&Boolean(document.querySelector('.doc-block.active .doc-editable-text'))"), 'global outline selects content on another page'), true)
  await evaluate("document.querySelector('.doc-tool-rail button:first-child').click()")
  await evaluate("document.querySelectorAll('.doc-page-action')[3]?.click()")
  assert.equal(await waitFor(async () => evaluate("document.querySelectorAll('.doc-outline-page').length===1"), 'remove navigation fixture page'), true)
  await evaluate("(()=>{const input=document.querySelectorAll('.doc-table-controls input[type=number]')[1];const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'20');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'estilos da tabela salvos')

  const longParagraph = 'Conteúdo de validação da quebra de página do Docs. '.repeat(6)
  for (let index = 0; index < 15; index += 1) {
    await evaluate("document.querySelector('.doc-page-add')?.click()")
    await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-editable-text'))"), `bloco Docs ${index + 1}`)
    await evaluate("(() => { const field=document.querySelector('.doc-block.active .doc-editable-text'); field.focus(); const range=document.createRange(); range.selectNodeContents(field); range.collapse(false); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range) })()")
    await send('Input.insertText', { text: longParagraph })
    await waitFor(async () => evaluate(`document.querySelector('.doc-block.active .doc-editable-text')?.innerText.length >= ${longParagraph.length}`), `texto do bloco Docs ${index + 1}`)
  }
  const desktopLayout = await waitFor(async () => evaluate(`(() => { const pages=Number(document.querySelector('.doc-footer-pagination strong')?.textContent.split('/')[1]); return pages > 1 ? { pages, documentWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth } : null })()`), 'automatic desktop pagination')
  assert.ok(desktopLayout.pages > 1, 'blocos longos devem avançar para folhas seguintes')
  assert.ok(desktopLayout.documentWidth <= desktopLayout.viewportWidth, `Docs não deve criar overflow horizontal em desktop: ${JSON.stringify(desktopLayout)}`)
  while (Number(await evaluate("document.querySelector('.doc-footer-pagination strong')?.textContent.split('/')[0]")) > 1) await evaluate("document.querySelector('.doc-footer-pagination button:first-of-type').click()")
  const boundaryTarget = await waitFor(async () => evaluate(`(() => { const blocks=[...document.querySelector('.doc-page:not(.doc-measure-page)')?.querySelectorAll('.doc-block[data-doc-block-id]') ?? []]; const block=blocks.at(-1); const field=block?.querySelector('.doc-editable-text'); return blocks.length>1&&field?{blockId:block.dataset.docBlockId,text:field.innerText}:null })()`), 'last editable block on the first visual page')
  const boundaryFragment = ' EDGE-CURSOR '.repeat(8)
  await evaluate(`(() => { const field=[...document.querySelectorAll('.doc-block[data-doc-block-id]')].find(block=>block.dataset.docBlockId===${JSON.stringify(boundaryTarget.blockId)})?.querySelector('.doc-editable-text');if(!field)throw new Error('boundary block is not visible');field.focus();const range=document.createRange();range.selectNodeContents(field);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range) })()`)
  let boundaryState = null
  let boundaryAppended = ''
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    boundaryAppended += boundaryFragment
    await send('Input.insertText', { text: boundaryFragment })
    boundaryState = await waitFor(async () => evaluate(`(() => { const block=document.querySelector('.doc-block.active');const field=block?.querySelector('.doc-editable-text');const current=Number(document.querySelector('.doc-footer-pagination strong')?.textContent.split('/')[0]);if(!block||block.dataset.docBlockId!==${JSON.stringify(boundaryTarget.blockId)}||field?.innerText!==${JSON.stringify(boundaryTarget.text+boundaryAppended)})return null;const selection=getSelection();if(!selection?.anchorNode||!field.contains(selection.anchorNode))return null;const range=document.createRange();range.selectNodeContents(field);range.setEnd(selection.anchorNode,selection.anchorOffset);return {blockId:block.dataset.docBlockId,text:field.innerText,offset:range.toString().length,currentPage:current,pageCount:Number(document.querySelector('.doc-footer-pagination strong')?.textContent.split('/')[1]),pageHeight:Number.parseFloat(document.querySelector('.doc-page:not(.doc-measure-page)')?.style.height||'0')} })()`), 'edited block crosses to the next visual page and keeps focus', 10000)
    if (boundaryState?.currentPage >= 2) break
  }
  assert.ok(boundaryState, 'editing the last block at the page boundary moves it to the next page')
  assert.equal(boundaryState.currentPage, 2, 'the migrated block is displayed on visual page two')
  assert.equal(boundaryState.offset, boundaryTarget.text.length + boundaryAppended.length, 'the caret remains at the end of the complete text after crossing the page boundary')
  assert.ok(boundaryState.pageHeight <= 1123, 'the boundary fixture moves a normal-sized block instead of expanding the page')
  const resizeCursorBaseline = await evaluate(`(() => { const block=document.querySelector('.doc-block.active'); const field=block?.querySelector('.doc-editable-text'); if(!block||!field)return null;field.focus();const range=document.createRange();range.selectNodeContents(field);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return {blockId:block.dataset.docBlockId,text:field.innerText,offset:field.innerText.length} })()`)
  assert.ok(resizeCursorBaseline?.blockId && resizeCursorBaseline.text.length > 0, 'a populated Docs block is active before viewport resizing')
  const exportLayout = await waitFor(async () => evaluate(`(async () => { const database=await new Promise((resolve,reject)=>{ const request=indexedDB.open('fuse-studio'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error) }); const stored=await new Promise((resolve,reject)=>{ const request=database.transaction('documents','readonly').objectStore('documents').getAll(); request.onsuccess=()=>resolve(request.result[0]); request.onerror=()=>reject(request.error) }); if((stored?.pages?.[0]?.blocks?.length ?? 0) < 11) return null; const renderer=await import('/src/export.ts'); return { count:(await renderer.renderDocumentCanvases(stored)).length } })()`), 'modelo Docs salvo para exportação')
  const pdfPageCount = exportLayout.count
  assert.equal(pdfPageCount, desktopLayout.pages, `PDF deve manter o mesmo número de folhas do editor: editor=${desktopLayout.pages}, PDF=${pdfPageCount}`)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const mobileLayout = await waitFor(async () => evaluate(`(() => { const pages=Number(document.querySelector('.doc-footer-pagination strong')?.textContent.split('/')[1]); const page=document.querySelector('.doc-page:not(.doc-measure-page)'); const pageWidth=page?.getBoundingClientRect().width; if(!page) return null; const toolbar=document.querySelector(".doc-toolbar");const toolbarRect=toolbar.getBoundingClientRect();const toolbarStyle=getComputedStyle(toolbar);return { toolbar:{left:toolbarRect.left,right:toolbarRect.right,width:toolbarRect.width,scrollWidth:toolbar.scrollWidth,overflowX:toolbarStyle.overflowX,widthStyle:toolbarStyle.width,maxWidth:toolbarStyle.maxWidth,position:toolbarStyle.position}, pages, documentWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth, screenWidth:screen.width, clientWidth:document.documentElement.clientWidth, layoutViewportWidth:innerWidth, visualViewportWidth:visualViewport?.width, clientWidth:document.documentElement.clientWidth, pageWidth, pageScrollWidth:page.scrollWidth, overflowing:[...document.querySelectorAll("body *")].map(el=>({el,rect:el.getBoundingClientRect()})).filter(({el,rect})=>rect.width>0&&rect.right>document.documentElement.clientWidth+1).sort((a,b)=>b.rect.right-a.rect.right).slice(0,8).map(({el,rect})=>({tag:el.tagName,class:String(el.className).slice(0,80),left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)})) } })()`), 'Docs responsive at 390 px')
  assert.equal(mobileLayout.screenWidth, 390, `mobile viewport metrics: ${JSON.stringify(mobileLayout)}`)
  assert.ok(mobileLayout.pages >= 2, `mobile pagination should reflow: ${JSON.stringify(mobileLayout)}`)
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewportWidth, `Docs must fit horizontally at mobile width: ${JSON.stringify(mobileLayout)}`)
  assert.ok(mobileLayout.pageWidth <= mobileLayout.viewportWidth, 'folha deve caber na viewport móvel')
  assert.ok(mobileLayout.pageScrollWidth <= mobileLayout.pageWidth + 1, 'conteúdo da folha não deve transbordar horizontalmente no mobile')
  const mobileCursorState = await evaluate(`(() => { const block=document.querySelector('.doc-block.active');const field=block?.querySelector('.doc-editable-text');const selection=getSelection();if(!block||block.dataset.docBlockId!==${JSON.stringify(resizeCursorBaseline.blockId)}||field?.innerText!==${JSON.stringify(resizeCursorBaseline.text)}||!selection?.anchorNode||!field.contains(selection.anchorNode))return null;const range=document.createRange();range.selectNodeContents(field);range.setEnd(selection.anchorNode,selection.anchorOffset);return {blockId:block.dataset.docBlockId,text:field.innerText,offset:range.toString().length} })()`)
  assert.deepEqual(mobileCursorState, resizeCursorBaseline, 'desktop-to-mobile reflow preserves the active Docs text and caret position')
  await evaluate("document.querySelector('.doc-outline-toggle').click()")
  const mobileOutline = await evaluate("(()=>{const panel=document.querySelector('.doc-outline-drawer');const rect=panel.getBoundingClientRect();return {display:getComputedStyle(panel).display,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,pages:panel.querySelectorAll('.doc-outline-page').length}})()")
  assert.equal(mobileOutline.display, 'block', `mobile outline opens: ${JSON.stringify(mobileOutline)}`)
  assert.ok(mobileOutline.left >= 0 && mobileOutline.right <= mobileOutline.viewportWidth && mobileOutline.top >= 0 && mobileOutline.bottom <= mobileOutline.viewportHeight, `mobile outline should fit the viewport: ${JSON.stringify(mobileOutline)}`)
  assert.ok(mobileOutline.pages >= 1, 'mobile outline should expose the source document pages')
  await evaluate("document.querySelector('.doc-outline-toggle').click()")
  await evaluate("document.querySelector('[aria-label=\"Propriedades do documento\"]').click()")
  const mobileInspector = await evaluate("(()=>{const panel=document.querySelector('.doc-inspector');const rect=panel.getBoundingClientRect();return {display:getComputedStyle(panel).display,left:rect.left,right:rect.right,bottom:rect.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight}})()")
  assert.equal(mobileInspector.display, 'block', `mobile properties sheet opens: ${JSON.stringify(mobileInspector)}`)
  assert.ok(mobileInspector.left >= 0 && mobileInspector.right <= mobileInspector.viewportWidth && mobileInspector.bottom <= mobileInspector.viewportHeight, `mobile properties sheet should fit the viewport: ${JSON.stringify(mobileInspector)}`)
  await evaluate("document.querySelector('[aria-label=\"Propriedades do documento\"]').click()")
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  const restoredDesktopCursorState = await waitFor(async () => evaluate(`(() => { const block=document.querySelector('.doc-block.active');const field=block?.querySelector('.doc-editable-text');const selection=getSelection();if(!block||block.dataset.docBlockId!==${JSON.stringify(resizeCursorBaseline.blockId)}||field?.innerText!==${JSON.stringify(resizeCursorBaseline.text)}||!selection?.anchorNode||!field.contains(selection.anchorNode))return null;const range=document.createRange();range.selectNodeContents(field);range.setEnd(selection.anchorNode,selection.anchorOffset);return {blockId:block.dataset.docBlockId,text:field.innerText,offset:range.toString().length} })()`), 'desktop restore keeps the active Docs caret')
  assert.deepEqual(restoredDesktopCursorState, resizeCursorBaseline, 'mobile-to-desktop reflow restores the same Docs text and caret position')
  const oversizedParagraph = 'Texto longo para verificar que a folha mantém o conteúdo integral. '.repeat(100)
  await evaluate("document.querySelector('.doc-page-add')?.click()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-block.active .doc-editable-text'))"), 'bloco Docs maior que uma folha')
  await evaluate("(() => { const field=document.querySelector('.doc-block.active .doc-editable-text'); field.focus(); const range=document.createRange(); range.selectNodeContents(field); range.collapse(false); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range) })()")
  await send('Input.insertText', { text: oversizedParagraph })
  const oversizedUi = await waitFor(async () => evaluate(`(() => { const page=document.querySelector('.doc-page:not(.doc-measure-page)'); const pages=Number(document.querySelector('.doc-footer-pagination strong')?.textContent.split('/')[1]); const height=Number.parseFloat(page?.style.height ?? '0'); return height > 1123 && pages ? {pages,height} : null })()`), 'expanded page preserving an oversized block')
  const oversizedExport = await waitFor(async () => evaluate(`(async () => { const database=await new Promise((resolve,reject)=>{ const request=indexedDB.open('fuse-studio'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error) }); const stored=await new Promise((resolve,reject)=>{ const request=database.transaction('documents','readonly').objectStore('documents').getAll(); request.onsuccess=()=>resolve(request.result[0]); request.onerror=()=>reject(request.error) }); if(!stored?.pages?.flatMap(page=>page.blocks??[]).some(block=>(block.text?.length??0)>=${oversizedParagraph.length})) return null; const renderer=await import('/src/export.ts'); const pages=await renderer.renderDocumentCanvases(stored); const heights=pages.map(page=>page.canvas.height/2); const mediaPages=pages.map(({canvas})=>({data:canvas.toDataURL('image/png'),width:canvas.width/2,height:canvas.height/2})); pages.forEach(({canvas})=>{canvas.width=0;canvas.height=0}); const bytes=await renderer.createPdfBytes(stored.width,stored.height,mediaPages); const source=new TextDecoder().decode(bytes); const mediaBoxes=source.split('/MediaBox [0 0 ').slice(1).map(part=>{const [width,height]=part.split(']')[0].split(' ').map(Number);return{width,height}}); return {count:pages.length,heights,pdfPageCount:source.split('/Type /Page').length-2,mediaBoxes,expectedHeights:mediaPages.map(page=>page.height*0.75)} })()`), 'exportação de Docs com bloco longo')
  assert.equal(oversizedExport.count, oversizedUi.pages, 'PDF deve manter as quebras do editor ao preservar um bloco longo')
  assert.ok(Math.max(...oversizedExport.heights) > 1123, 'PDF deve ampliar a folha em vez de cortar um bloco que excede uma página')
  assert.equal(oversizedExport.pdfPageCount, oversizedExport.count, 'expanded-page PDF bytes contain every rendered page')
  assert.ok(oversizedExport.mediaBoxes.some(box=>box.height===842.25)&&oversizedExport.mediaBoxes.some(box=>box.height>842.25), 'expanded-page PDF retains normal A4 pages and a taller MediaBox for the oversized page')
  assert.deepEqual(oversizedExport.mediaBoxes.map(box=>box.height), oversizedExport.expectedHeights, 'each PDF MediaBox height matches its rendered page geometry')
  const pixelDiffs = []
  for (let pageIndex = 0; pageIndex < 14; pageIndex += 1) {
    const referencePng = await readFile(path.join(webRoot, '..', '..', 'analysis', 'export-artifacts', `docs-table-long-a4-page-${pageIndex + 1}.png`))
    const referenceBase64 = referencePng.toString('base64')
    const difference = await evaluate(`(async()=>{const {getDocument,GlobalWorkerOptions}=await import('/node_modules/pdfjs-dist/build/pdf.mjs');GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';if(!window.__docAuditPdf){window.__docAuditPdfLoadingTask=getDocument({data:window.__longRowPdfBytes});window.__docAuditPdf=await window.__docAuditPdfLoadingTask.promise}const page=await window.__docAuditPdf.getPage(${pageIndex + 1});const viewport=page.getViewport({scale:1});const canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);const context=canvas.getContext('2d',{willReadFrequently:true});await page.render({canvas,canvasContext:context,viewport}).promise;const current=context.getImageData(0,0,canvas.width,canvas.height).data;const ref=new Image();ref.src='data:image/png;base64,${referenceBase64}';await ref.decode();context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(ref,0,0);const expected=context.getImageData(0,0,canvas.width,canvas.height).data;let absolute=0;let changed=0;for(let i=0;i<current.length;i+=4){let delta=0;for(let c=0;c<3;c++){delta=Math.max(delta,Math.abs(current[i+c]-expected[i+c]));absolute+=Math.abs(current[i+c]-expected[i+c])}if(delta>32)changed++}const result={width:canvas.width,height:canvas.height,meanAbsoluteError:absolute/(canvas.width*canvas.height*3),changedPixelPercent:changed/(canvas.width*canvas.height)*100};ref.src='';canvas.width=0;canvas.height=0;page.cleanup();if(${pageIndex}===13){await window.__docAuditPdf.cleanup();await window.__docAuditPdfLoadingTask.destroy();window.__docAuditPdf=null;window.__docAuditPdfLoadingTask=null;window.__longRowPdfBytes=null}return result})()`)
    pixelDiffs.push(difference)
  }
  assert.equal(pixelDiffs.length, 14, 'PDF.js independently rasterizes every physical PDF page one at a time')
  assert.deepEqual(pixelDiffs.map(({ width, height }) => [width, height]), Array.from({ length: 14 }, () => [596, 842]), 'PDF.js renders every page at the retained reference dimensions')
  assert.ok(pixelDiffs.every(({ width, height, meanAbsoluteError, changedPixelPercent }) => width > 0 && height > 0 && meanAbsoluteError < 12 && changedPixelPercent < 8), `all PDF.js raster pages remain visually close to their retained references: ${JSON.stringify(pixelDiffs)}`)
  console.log(`Docs audit pixel comparison passed: 14 pages; mean absolute RGB error ${Math.min(...pixelDiffs.map(item=>item.meanAbsoluteError)).toFixed(2)}-${Math.max(...pixelDiffs.map(item=>item.meanAbsoluteError)).toFixed(2)}/255; max pixels over 32/255 delta ${Math.max(...pixelDiffs.map(item=>item.changedPixelPercent)).toFixed(2)}%.`)
  const mergeHistoryRoute = await reloadRouteToLibrary()
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}${mergeHistoryRoute}` })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page')&&document.querySelector('.doc-table textarea[data-table-id]'))"), 'unmerged table restored after reload')
  const reloadedMergeHistoryState = await readMergeHistoryState()
  assert.equal(reloadedMergeHistoryState.tableId, unmergedHistoryState.tableId, 'reload retains the same isolated table')
  assert.deepEqual(reloadedMergeHistoryState.merges, [], 'later edits and reload preserve the unmerged table topology')
  assert.equal(await evaluate("document.querySelector('.icon-button[aria-label=\"Refazer\"]')?.disabled"), true, 'the in-memory Redo history does not survive reload')
  const savedDocsRoute = await reloadRouteToLibrary()
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}${savedDocsRoute}` })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'Docs recarregado')
  for (let page = 0; page < 12 && !(await evaluate("Boolean(document.querySelector('.doc-table textarea[data-table-id]'))")); page += 1) {
    await evaluate("document.querySelector('.doc-footer-pagination button:nth-of-type(3)')?.click()")
    await delay(180)
  }
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-table textarea[data-table-id]'))"), 'página da tabela após recarga')
  await evaluate("document.querySelector('.doc-table td textarea')?.focus()")
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-toolbar [aria-label=Borda]'))"), 'célula selecionada após recarga')
  await evaluate("(()=>{const popover=document.querySelector('.doc-table-border-popover');if(!popover)document.querySelector('.doc-toolbar [aria-label=Borda]').click();else if(!popover.querySelector('.doc-table-border-style-options'))popover.querySelector('.doc-table-border-style-trigger').click()})()")
  assert.equal(await evaluate("[...document.querySelectorAll('[role=radio]')].some(item=>item.textContent.trim()==='Pontos'&&item.getAttribute('aria-checked')==='true')"), true, 'border style picker restores Dots after reload')
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Espessura da borda\"]').value==='2'"), true, 'border thickness control restores 2 after reload')
  const reloadedTableStyle = await waitFor(async () => evaluate("(()=>{const cells=[...document.querySelectorAll('.doc-block.active .doc-table td')];const paint=getComputedStyle(cells[0]);const edgePaints=paint.backgroundImage.split('linear-gradient(').length-1;return cells.length===16&&cells.every(cell=>getComputedStyle(cell).paddingTop==='20px')&&edgePaints===4?{cells:cells.length,padding:paint.paddingTop,border:paint.backgroundImage.includes('repeating-linear-gradient'),edgePaints}:null})()"), 'reloaded dotted borders and 16 padded table cells')
  assert.deepEqual(reloadedTableStyle, { cells: 16, padding: '20px', border: true, edgePaints: 4 }, 'rendered table padding and all dotted borders remain after reload')
  const persistedTableStyle = await evaluate("(()=>{const request=indexedDB.open('fuse-studio');return new Promise(resolve=>{request.onsuccess=()=>{const db=request.result;const read=db.transaction('documents','readonly').objectStore('documents').getAll();read.onsuccess=()=>{const doc=read.result.find(item=>item.type==='doc');const block=doc?.pages.flatMap(page=>page.blocks??[]).find(item=>item.type==='table');resolve({type:doc?.type,padding:block?.cellPadding,spacing:block?.tableSpacing,borders:block?.cellBorders,blockCount:doc?.pages.flatMap(page=>page.blocks??[]).length})}}})})()")
  assert.equal(persistedTableStyle.padding, 20)
  assert.equal(persistedTableStyle.spacing, 0)
  assert.equal(persistedTableStyle.borders?.['0:0']?.top?.style, 'dots')
  assert.equal(persistedTableStyle.borders?.['0:0']?.top?.width, 2)
  await evaluate("(()=>{window.__downloads=[];window.__originalAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download?.endsWith('.png')||this.download?.endsWith('.jpg')||this.download?.endsWith('.svg')){window.__downloads.push({href:this.href,name:this.download});return}return window.__originalAnchorClick.call(this)}})()")
  const chooseSelect = async (selector, value, label) => {
    await evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});if(!select)throw new Error('Missing select: '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,${JSON.stringify(String(value))});select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(async () => evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(String(value))}`), label)
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await chooseSelect('.export-format', 'png', 'PNG export format selected')
  const mobileExportControls = await evaluate("(()=>{const names=['.export-button','.export-format','.export-option'];const controls=names.map(selector=>{const rect=document.querySelector(selector)?.getBoundingClientRect();return rect?{selector,left:rect.left,right:rect.right,width:rect.width}:null});return{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,controls}})()")
  assert.ok(mobileExportControls.documentWidth <= mobileExportControls.viewport && mobileExportControls.controls.every(item => item && item.left >= 0 && item.right <= mobileExportControls.viewport), `PNG export controls fit the 390px viewport: ${JSON.stringify(mobileExportControls)}`)
  await evaluate("(()=>{window.__originalCanvasToDataURL=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(type,...args){HTMLCanvasElement.prototype.toDataURL=window.__originalCanvasToDataURL;throw new Error('controlled export failure')}})()")
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(async () => evaluate("document.querySelector('.export-error')?.textContent.includes('controlled export failure')&&document.querySelector('.export-button')?.textContent.includes('Tentar novamente')&&!document.querySelector('.export-button')?.disabled"), 'failed export reports the error and exposes a retry action on mobile')
  const failedExportCount = await evaluate('window.__downloads.length')
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(async () => evaluate(`window.__downloads.length===${failedExportCount + 1}&&!document.querySelector('.export-error')`), 'retry after a transient export error delivers a new artifact')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await waitFor(async () => evaluate("innerWidth===1280"), 'desktop viewport restored for artifact checks')
  assert.equal(await evaluate("document.querySelector('.export-option[aria-label=\"Tamanho da imagem\"]')?.value"), '2', 'PNG exposes a size control with the existing 2x output as its default')
  const pngExports = []
  for (const scale of [1, 2, 3]) {
    await chooseSelect('.export-option[aria-label="Tamanho da imagem"]', scale, `PNG ${scale}x size selected`)
    const prior = await evaluate('window.__downloads.length')
    await evaluate("document.querySelector('.export-button').click()")
    await waitFor(async () => evaluate(`window.__downloads.length===${prior + 1}`), `PNG ${scale}x artifact delivered to the browser download link`, 90000)
    pngExports.push(await evaluate(`(async()=>{const item=window.__downloads.at(-1);const image=new Image();image.src=item.href;await image.decode();return{name:item.name,width:image.naturalWidth,height:image.naturalHeight,mime:item.href.slice(0,item.href.indexOf(';')),byteLength:atob(item.href.split(',')[1]).length}})()`))
  }
  assert.deepEqual(pngExports.map(({ width, height, mime }) => ({ width, height, mime })), [1, 2, 3].map(scale => ({ width: pngExports[0].width * scale, height: pngExports[0].height * scale, mime: 'data:image/png' })), 'PNG size choices produce independently decoded 1x, 2x, and 3x artifacts')
  assert.ok(pngExports.every(item => item.name.endsWith('.png') && item.byteLength > 1000), 'each PNG download contains a non-empty PNG artifact')
  await chooseSelect('.export-option[aria-label="Tamanho da imagem"]', 2, 'shared image scale reset to 2x before JPEG quality checks')
  await chooseSelect('.export-format', 'jpeg', 'JPEG export format selected')
  const jpegExports = []
  for (const quality of ['low', 'medium', 'high']) {
    await chooseSelect('.export-option[aria-label="Qualidade JPEG"]', quality, `${quality} JPEG quality selected`)
    const prior = await evaluate('window.__downloads.length')
    await evaluate("document.querySelector('.export-button').click()")
    await waitFor(async () => evaluate(`window.__downloads.length===${prior + 1}`), `${quality} JPEG artifact delivered to the browser download link`)
    jpegExports.push(await evaluate(`(async()=>{const item=window.__downloads.at(-1);const image=new Image();image.src=item.href;await image.decode();return{name:item.name,width:image.naturalWidth,height:image.naturalHeight,mime:item.href.slice(0,item.href.indexOf(';')),byteLength:atob(item.href.split(',')[1]).length}})()`))
  }
  assert.ok(jpegExports.every(item => item.name.endsWith('.jpg') && item.mime === 'data:image/jpeg' && item.width === pngExports[1].width && item.height === pngExports[1].height), 'JPEG quality variants produce decodable same-size JPG artifacts')
  assert.ok(jpegExports[0].byteLength < jpegExports[1].byteLength && jpegExports[1].byteLength < jpegExports[2].byteLength, `JPEG quality choices increase encoded artifact size: ${JSON.stringify(jpegExports.map(({ byteLength }) => byteLength))}`)
  await chooseSelect('.export-format', 'svg', 'SVG export format selected')
  assert.equal(await evaluate("document.querySelector('.export-option')===null"), true, 'SVG does not show PNG/JPEG raster controls')
  const priorSvgDownloads = await evaluate('window.__downloads.length')
  await evaluate("document.querySelector('.export-button').click()")
  await waitFor(async () => evaluate(`window.__downloads.length===${priorSvgDownloads + 1}`), 'SVG file delivered to the browser download link')
  const svgArtifact = await evaluate(`(async()=>{const item=window.__downloads.at(-1);const source=await(await fetch(item.href)).text();const root=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;return{name:item.name,root:root.localName,width:root.getAttribute('width'),height:Number(root.getAttribute('height')),parseError:root.querySelector('parsererror')?.textContent??'',images:root.querySelectorAll('image').length,textElements:root.querySelectorAll('text').length,tables:root.querySelectorAll('[role=table]').length,nestedPages:root.querySelectorAll(':scope > svg').length,foreignObjects:root.querySelectorAll('foreignObject').length,sourceLength:source.length}})()`)
  assert.equal(svgArtifact.name.endsWith('.svg'), true, 'SVG download has the correct extension')
  assert.equal(svgArtifact.root, 'svg', 'SVG artifact parses as a standalone SVG document')
  assert.equal(svgArtifact.parseError, '', `SVG document has no XML parse error: ${JSON.stringify(svgArtifact)}`)
  assert.ok(svgArtifact.height >= 1123 && svgArtifact.nestedPages >= 1, `Docs SVG preserves physical page viewports in reading order: ${JSON.stringify(svgArtifact)}`)
  assert.ok(svgArtifact.textElements > 0 && svgArtifact.tables > 0, 'Docs SVG preserves text and tables as editable vector elements')
  assert.equal(svgArtifact.images, 0, 'the current Docs fixture has no source images to rasterize')
  assert.equal(svgArtifact.foreignObjects, 0, 'Docs SVG uses native SVG primitives instead of an embedded HTML fallback')
  assert.ok(svgArtifact.sourceLength > 1000, 'vector Docs SVG contains its document text and table structure')
  const vectorLayoutDiff = await evaluate(`(async()=>{const {renderDocumentCanvases}=await import('/src/export.ts');const {renderDocContinuousSvg}=await import('/src/doc-svg-export.ts');const model={id:'doc-svg-layout',name:'SVG layout',type:'doc',width:794,height:1123,docPageSetup:{preset:'a4',margins:{top:96,right:96,bottom:96,left:96}},pages:[{id:'page',name:'Page 1',background:'#ffffff',blocks:[{id:'heading',type:'heading',text:'Vector heading'},{id:'paragraph',type:'paragraph',text:'Body text aligns to its saved page margins.'},{id:'marked',type:'paragraph',text:'A marked phrase in the paragraph.',marks:[{start:2,end:14,bold:true,underline:true}]},{id:'table',type:'table',text:'',cells:[['Item','Value'],['Alpha','42']],cellPadding:8,borderColor:'#d9d9d9',borderWidth:1}]}]};const raster=(await renderDocumentCanvases(model,true))[0].canvas;const svg=renderDocContinuousSvg(model,0).svg;const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=794;canvas.height=1123;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(raster,0,0,canvas.width,canvas.height);const expected=context.getImageData(0,0,canvas.width,canvas.height).data;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);const actual=context.getImageData(0,0,canvas.width,canvas.height).data;let absolute=0,changed=0;for(let i=0;i<actual.length;i+=4){let delta=0;for(let channel=0;channel<3;channel++){const d=Math.abs(actual[i+channel]-expected[i+channel]);absolute+=d;delta=Math.max(delta,d)}if(delta>32)changed++}const result={width:image.width,height:image.height,meanAbsoluteError:absolute/(794*1123*3),changedPixelPercent:changed/(794*1123)*100};URL.revokeObjectURL(url);raster.width=0;raster.height=0;canvas.width=0;canvas.height=0;return result})()`)
  assert.equal(vectorLayoutDiff.width, 794, 'Docs SVG and existing renderer share the page width')
  assert.equal(vectorLayoutDiff.height, 1123, 'one physical page keeps the A4 height')
  assert.ok(vectorLayoutDiff.meanAbsoluteError < 10 && vectorLayoutDiff.changedPixelPercent < 5, `vector Docs layout rasterizes close to the existing renderer: ${JSON.stringify(vectorLayoutDiff)}`)
  const vectorSvg = await evaluate(`(async()=>{const {renderPageSvg}=await import('/src/svg-export.ts');const documentModel={width:240,height:160};const page={background:'#ffffff',elements:[{id:'vector-star',type:'shape',shape:'star',name:'Star',x:10,y:12,width:40,height:40,rotation:15,fill:'#f0a000',cornerRadius:0},{id:'vector-text',type:'text',name:'Text',x:60,y:14,width:160,height:30,rotation:0,text:'Vector <&> text',fontSize:18,fontFamily:'Arial',color:'#123456',bold:true},{id:'vector-stroke',type:'free-draw',name:'Stroke',x:12,y:70,width:40,height:30,rotation:0,points:[0,0,20,30,40,0],color:'#f00',strokeWidth:4},{id:'vector-note',type:'sticky-note',name:'Note',x:68,y:62,width:120,height:80,rotation:0,text:'Note',fill:'#ff0',color:'#111',fontSize:12}]};const svg=await renderPageSvg(documentModel,page);const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;return{svg,root:root.localName,paths:root.querySelectorAll('path').length,freeDrawPath:root.querySelector('path[stroke="#f00"]')?.getAttribute('d'),texts:[...root.querySelectorAll('text')].map(text=>text.textContent),polylines:root.querySelectorAll('polyline').length,images:root.querySelectorAll('image').length,externalReferences:/href=["']https?:/.test(svg)}})()`)
  assert.equal(vectorSvg.root, 'svg', 'vector page serializer emits parseable SVG')
  assert.ok(vectorSvg.paths >= 2 && vectorSvg.polylines === 0 && vectorSvg.images === 0, 'native vector shapes and free drawing remain SVG paths')
  assert.match(vectorSvg.freeDrawPath, /^M0 0 Q/)
  assert.match(vectorSvg.freeDrawPath, /Q27 30 40 0$/)
  assert.ok(vectorSvg.texts.includes('Vector <&> text') && vectorSvg.texts.includes('Note'), 'text and sticky notes remain text nodes with XML escaping')
  assert.equal(vectorSvg.externalReferences, false, 'vector SVG does not depend on external resources')
  const imageSvg = await evaluate(`(async()=>{const {renderPageSvg}=await import('/src/svg-export.ts');const source='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#369"/></svg>';const page={background:'#fff',elements:[{id:'embedded-image',type:'image',name:'Image',x:0,y:0,width:32,height:24,rotation:0,src:'data:image/svg+xml;base64,'+btoa(source),opacity:72,brightness:10,flipX:true}]};const svg=await renderPageSvg({width:64,height:48},page);const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;const image=root.querySelector('image');const preview=new Image();preview.src=image.getAttribute('href');await preview.decode();return{root:root.localName,images:root.querySelectorAll('image').length,hrefPrefix:image.getAttribute('href').slice(0,22),width:preview.naturalWidth,height:preview.naturalHeight}})()`)
  assert.deepEqual(imageSvg, { root: 'svg', images: 1, hrefPrefix: 'data:image/png;base64,', width: 64, height: 48 }, 'image layers are embedded with crop, flips, opacity and color adjustments rendered into portable PNG data')
  await evaluate('HTMLAnchorElement.prototype.click=window.__originalAnchorClick')
  const setFieldValue = async (selector, value, label) => {
    await evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});if(!field)throw new Error('Missing field: '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(field.constructor.prototype,'value').set;setter.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitFor(async () => evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`), label)
  }
  const cellD2 = 'textarea[data-table-row="1"][data-table-column="3"]'
  const cellD3 = 'textarea[data-table-row="2"][data-table-column="3"]'
  await setFieldValue(cellD2, 'Widget alpha', 'seed first case-variant table cell')
  await setFieldValue(cellD3, 'widget beta', 'seed second case-variant table cell')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'case-variant table values saved')
  const originalNonTableText = await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const tx=request.result.transaction('documents','readonly');const get=tx.objectStore('documents').getAll();get.onsuccess=()=>{const doc=get.result.find(item=>item.type==='doc');request.result.close();resolve(doc.pages.flatMap(page=>page.blocks??[]).filter(block=>block.type!=='table').map(block=>block.text))};get.onerror=()=>reject(get.error)}})")
  await setFieldValue('input[aria-label="Localizar texto"]', 'Widget', 'case-insensitive search query')
  assert.equal(await evaluate("document.querySelector('.doc-search-count').textContent.trim().startsWith('2')"), true, 'case-insensitive search matches both table cell variants')
  assert.equal(await evaluate("!!document.querySelector('.doc-case-toggle svg.lucide-case-sensitive') && document.querySelector('.doc-case-toggle .visually-hidden')?.textContent.trim().length>10"), true, 'match-case uses the shared Lucide icon family and keeps an accessible label')
  await evaluate("document.querySelector('.doc-case-toggle input').click()")
  assert.equal(await evaluate("document.querySelector('.doc-search-count').textContent.trim().startsWith('1')"), true, 'match-case reduces the results to the exact-case cell')
  await setFieldValue('input[aria-label="Localizar texto"]', 'absent marker', 'no-match query')
  assert.equal(await evaluate("document.querySelector('.doc-search-count').textContent.trim().startsWith('0') && document.querySelector('.doc-search-tools button').disabled"), true, 'no-match search disables replacement')
  await setFieldValue('input[aria-label="Localizar texto"]', 'Widget', 'single-match query')
  await setFieldValue('input[aria-label="Substituir por"]', 'Gadget', 'single replacement text')
  assert.equal(await evaluate("document.querySelector('.doc-search-count').textContent.trim().startsWith('1')"), true, 'case-sensitive single replacement retains one match')
  await evaluate("document.querySelector('.doc-search-tools button').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-search-notice')?.textContent.includes('1') && document.querySelector('textarea[data-table-row=\"1\"][data-table-column=\"3\"]')?.value==='Gadget alpha'"), 'single table-cell replacement')
  assert.equal(await evaluate("document.querySelector('textarea[data-table-row=\"2\"][data-table-column=\"3\"]')?.value"), 'widget beta', 'single replacement leaves the lower-case cell unchanged')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'single replacement persisted')
  const replacementReloadRoute = await reloadRouteToLibrary()
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}${replacementReloadRoute}` })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'Docs reopened after replacement reload')
  for (let page = 0; page < 12 && !(await evaluate(`Boolean(document.querySelector('${cellD2}'))`)); page += 1) {
    await evaluate("document.querySelector('.doc-footer-pagination button:nth-of-type(3)')?.click()")
    await delay(180)
  }
  await waitFor(async () => evaluate(`Boolean(document.querySelector('${cellD2}')&&document.querySelector('${cellD3}'))`), 'table cells after single-replacement reload')
  assert.equal(await evaluate(`document.querySelector('${cellD2}').value==='Gadget alpha'&&document.querySelector('${cellD3}').value==='widget beta'`), true, 'single replacement survives a document reload')
  await setFieldValue(cellD2, 'widget alpha', 'prepare two-match replacement fixture')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'two-match table fixture saved')
  await setFieldValue('input[aria-label="Localizar texto"]', 'widget', 'two-match query')
  await setFieldValue('input[aria-label="Substituir por"]', 'Gadget', 'batch replacement text')
  assert.equal(await evaluate("document.querySelector('.doc-search-count').textContent.trim().startsWith('2')"), true, 'case-insensitive replace-all sees both table cells')
  await evaluate("document.querySelector('.doc-search-tools button').click()")
  await waitFor(async () => evaluate("document.querySelector('.doc-search-notice')?.textContent.includes('2') && document.querySelector('textarea[data-table-row=\"1\"][data-table-column=\"3\"]')?.value==='Gadget alpha' && document.querySelector('textarea[data-table-row=\"2\"][data-table-column=\"3\"]')?.value==='Gadget beta'"), 'replace-all updates both cell variants')
  assert.equal(await evaluate("document.querySelectorAll('textarea[data-table-id]').length"), 16, 'replace-all preserves the 4-by-4 table topology')
  await waitFor(async () => evaluate("document.querySelector('.save-state').textContent.includes('Salvo neste dispositivo')"), 'replace-all persisted')
  const replacedNonTableText = await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('fuse-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const tx=request.result.transaction('documents','readonly');const get=tx.objectStore('documents').getAll();get.onsuccess=()=>{const doc=get.result.find(item=>item.type==='doc');request.result.close();resolve(doc.pages.flatMap(page=>page.blocks??[]).filter(block=>block.type!=='table').map(block=>block.text))};get.onerror=()=>reject(get.error)}})")
  assert.deepEqual(replacedNonTableText, originalNonTableText, 'table replacement preserves document text outside the table')
  const replaceAllReloadRoute = await reloadRouteToLibrary()
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}${replaceAllReloadRoute}` })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'Docs reopened after replace-all reload')
  for (let page = 0; page < 12 && !(await evaluate(`Boolean(document.querySelector('${cellD2}'))`)); page += 1) {
    await evaluate("document.querySelector('.doc-footer-pagination button:nth-of-type(3)')?.click()")
    await delay(180)
  }
  await waitFor(async () => evaluate(`Boolean(document.querySelector('${cellD2}')&&document.querySelector('${cellD3}'))`), 'table after replace-all reload')
  assert.equal(await evaluate(`document.querySelector('${cellD2}').value==='Gadget alpha'&&document.querySelector('${cellD3}').value==='Gadget beta'&&document.querySelectorAll('textarea[data-table-id]').length===16`), true, 'replace-all values and table topology survive reload')
  const rowOrderBeforeMove = await evaluate("(()=>{const table=document.querySelector('.doc-block.active .doc-table');return table?[...table.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('textarea')].map(cell=>cell.value)):null})()")
  assert.ok(rowOrderBeforeMove?.length >= 3, 'the persisted Docs table has at least three addressable rows')
  await evaluate("document.querySelector('.doc-block.active .doc-table textarea[data-table-row=\"0\"][data-table-column=\"0\"]')?.focus()")
  await waitFor(async () => evaluate("document.querySelector('.doc-inline-table-actions [aria-label^=\"Mover linha 1 para cima\"]')?.disabled===true&&document.querySelector('.doc-inline-table-actions [aria-label^=\"Mover linha 1 para baixo\"]')?.disabled===false"), 'first row exposes only the move-down action')
  await evaluate("document.querySelector('.doc-inline-table-actions [aria-label^=\"Mover linha 1 para baixo\"]').click()")
  await waitFor(async () => evaluate(`document.querySelector('.doc-block.active .doc-table textarea[data-table-row="0"][data-table-column="0"]')?.value===${JSON.stringify(rowOrderBeforeMove[1][0])}`), 'move-down swaps the first two row records')
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'moved table row is saved locally')
  const rowMoveReloadRoute = await reloadRouteToLibrary()
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}${rowMoveReloadRoute}` })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'Docs reopened after row-move reload')
  await waitFor(async () => evaluate(`Boolean(document.querySelector('${cellD2}')&&document.querySelector('${cellD3}'))`), 'moved table restored after reload')
  const rowOrderAfterDownReload = await evaluate("(()=>{const table=document.querySelector('.doc-block.active .doc-table');return table?[...table.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('textarea')].map(cell=>cell.value)):null})()")
  assert.deepEqual(rowOrderAfterDownReload, [rowOrderBeforeMove[1], rowOrderBeforeMove[0], ...rowOrderBeforeMove.slice(2)], 'moving the first row down persists the swapped cell-record order after reload')
  await evaluate("document.querySelector('.doc-block.active .doc-table textarea[data-table-row=\"1\"][data-table-column=\"0\"]')?.focus()")
  await waitFor(async () => evaluate("document.querySelector('.doc-inline-table-actions [aria-label^=\"Mover linha 2 para cima\"]')?.disabled===false&&document.querySelector('.doc-inline-table-actions [aria-label^=\"Mover linha 2 para baixo\"]')?.disabled===false"), 'second row exposes both move directions')
  await evaluate("document.querySelector('.doc-inline-table-actions [aria-label^=\"Mover linha 2 para cima\"]').click()")
  await waitFor(async () => evaluate("document.querySelector('.save-state')?.textContent.includes('Salvo neste dispositivo')"), 'restored table row is saved locally')
  const rowRestoreReloadRoute = await reloadRouteToLibrary()
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}${rowRestoreReloadRoute}` })
  await waitFor(async () => evaluate("Boolean(document.querySelector('.doc-page'))"), 'Docs reopened after restoring row order')
  await waitFor(async () => evaluate(`Boolean(document.querySelector('${cellD2}')&&document.querySelector('${cellD3}'))`), 'table after final row-order reload')
  const rowOrderAfterUpReload = await evaluate("(()=>{const table=document.querySelector('.doc-block.active .doc-table');return table?[...table.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('textarea')].map(cell=>cell.value)):null})()")
  assert.deepEqual(rowOrderAfterUpReload, rowOrderBeforeMove, 'moving the row back up persists the original order after reload')
  console.log(`Docs browser check passed: inline marks, text selection/caret, desktop pagination (${desktopLayout.pages} pages), mobile 390 px (${mobileLayout.pages} pages) without horizontal overflow, oversized-block export (${oversizedExport.count} pages), table spacing/padding/dotted border persistence, case-aware find/replace persistence, and row move-down/up with reload persistence; long-row PDF (${longRowPdf.pageCount} physical A4 pages).`)
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

