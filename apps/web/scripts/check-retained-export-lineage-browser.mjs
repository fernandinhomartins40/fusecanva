import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(webRoot, '..', '..')
const chromeCandidates = [process.env.CHROME_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chromePath
for (const candidate of chromeCandidates) { try { await access(candidate, constants.X_OK); chromePath = candidate; break } catch {} }
if (!chromePath) throw new Error('Chrome/Edge is required; set CHROME_PATH to run the retained export lineage check.')
async function freePort() { const server = createTcpServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function waitFor(check, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const result = await check(); if (result) return result } catch {} await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error(`Timed out waiting for ${label}`) }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 2000); child.once('exit', () => { clearTimeout(timer); resolve() }) }) }

const sourcePath = path.join(repoRoot, 'analysis', 'dream-lab-artifacts', 'download-upscaled.jpg')
const referencePath = path.join(repoRoot, 'analysis', 'export-artifacts', 'dream-editor-roundtrip.png')
const sourceBytes = await readFile(sourcePath)
const referenceBytes = await readFile(referencePath)
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')
const referenceSha256 = createHash('sha256').update(referenceBytes).digest('hex')
assert.equal(sourceSha256, '84cf4ad602173edbf3ccbfadaaf4a295c2a509a553a2a701fe58784830241b42', 'retained upscale fixture bytes match its census manifest')
assert.equal(referenceSha256, '5c56c33c0acd013dfdd1560ee0c11c08a0247183a2b9fc3acca6cfcb65fbf5f6', 'retained Canva PNG bytes match its delivery manifest')
const source = `data:image/jpeg;base64,${sourceBytes.toString('base64')}`
const reference = `data:image/png;base64,${referenceBytes.toString('base64')}`
const vitePort = await freePort(); let cdpPort = await freePort(); while (cdpPort === vitePort) cdpPort = await freePort()
const profile = await mkdtemp(path.join(os.tmpdir(), 'fuse-retained-export-'))
let vite; let chrome; let pageSocket; let browserSocket
try {
  vite = spawn(process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--force'], { cwd: webRoot, windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`).catch(() => null))?.ok, 'Vite')
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1280,900', `http://127.0.0.1:${vitePort}/`], { windowsHide: true, stdio: 'ignore' })
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null))?.json(), 'Chrome DevTools')
  browserSocket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserSocket.addEventListener('open', resolve, { once: true }); browserSocket.addEventListener('error', reject, { once: true }) })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(`127.0.0.1:${vitePort}`)), 'page target')
  pageSocket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageSocket.addEventListener('open', resolve, { once: true }); pageSocket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  pageSocket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
  async function send(method, params = {}) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); pageSocket.send(JSON.stringify({ id: requestId, method, params })); return response }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text); return result.result.result.value }
  await waitFor(() => evaluate("!!document.querySelector('.home-category-row') && !document.querySelector('.home-loading')"), 'local app shell')
  const result = await evaluate(`(async()=>{
    const source=${JSON.stringify(source)};const reference=${JSON.stringify(reference)};
    const designDocument={id:'dream-editor-roundtrip-local-reconstruction',name:'Dream Lab upscale roundtrip',type:'design',width:1200,height:1200,updatedAt:'',pages:[{id:'page-1',name:'Page 1',background:'#ffffff',elements:[{id:'upscaled-image',type:'image',name:'Dream Lab upscaled image',src:source,x:0,y:0,width:1200,height:1200,rotation:0,sourceWidth:2400,sourceHeight:2400}]}]};
    const {renderPageCanvas}=await import('/src/export.ts');const output=await renderPageCanvas(designDocument,designDocument.pages[0]);
    const load=async url=>{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return{width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data}};
    const expected=await load(reference);const actualContext=output.getContext('2d',{willReadFrequently:true});const actual=actualContext.getImageData(0,0,output.width,output.height).data;
    if(output.width!==expected.width||output.height!==expected.height)return{width:output.width,height:output.height,referenceWidth:expected.width,referenceHeight:expected.height,mae:null,rmse:null,identical:null};
    const channels=output.width*output.height*3;let rgbAbsolute=0,rgbSquared=0,rgbIdentical=0,alphaAbsolute=0,alphaIdentical=0;for(let pixel=0;pixel<output.width*output.height;pixel++){const alphaIndex=pixel*4+3;const alphaDifference=Math.abs(actual[alphaIndex]-expected.data[alphaIndex]);alphaAbsolute+=alphaDifference;if(alphaDifference===0)alphaIdentical++;for(let channel=0;channel<3;channel++){const index=pixel*4+channel;const difference=Math.abs(actual[index]-expected.data[index]);rgbAbsolute+=difference;rgbSquared+=difference*difference;if(difference===0)rgbIdentical++}}
    return{width:output.width,height:output.height,referenceWidth:expected.width,referenceHeight:expected.height,mae:rgbAbsolute/channels,rmse:Math.sqrt(rgbSquared/channels),identical:rgbIdentical/channels,alphaMae:alphaAbsolute/(output.width*output.height),alphaIdentical:alphaIdentical/(output.width*output.height),sourceBytes:${sourceBytes.length},referenceBytes:${referenceBytes.length},canvasType:output.constructor.name}
  })()`)
  assert.deepEqual([result.width, result.height, result.referenceWidth, result.referenceHeight], [2400, 2400, 2400, 2400], `local reconstructed export and reference dimensions: ${JSON.stringify(result)}`)
  assert.ok(result.mae < 0.01 && result.rmse < 0.2 && result.identical > 0.99, `decoded RGB comparison should reproduce the retained near-identical pair: ${JSON.stringify(result)}`)
  assert.ok(result.alphaMae < 0.01 && result.alphaIdentical > 0.999, `opaque reference and export alpha channels match: ${JSON.stringify(result)}`)
  const proof = { pass: true, fixture: 'Dream Lab upscale JPEG → local editor PNG export compared to retained Canva PNG, one 2400×2400 page', source: { file: 'analysis/dream-lab-artifacts/download-upscaled.jpg', bytes: sourceBytes.length, sha256: sourceSha256 }, reference: { file: 'analysis/export-artifacts/dream-editor-roundtrip.png', bytes: referenceBytes.length, sha256: referenceSha256 }, metrics: result, limits: ['One retained image fixture and opaque PNG at export scale 1 only', 'Source and reference are retained evidence/refetch artifacts; historical HTTP response identity is not established', 'No video, PDF, GIF, PPTX, transparency, metadata, or universal renderer equivalence is inferred'] }
  const proofPath = path.join(webRoot, 'artifacts', 'retained-export-lineage-browser-proof.json')
  await mkdir(path.dirname(proofPath), { recursive: true })
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(proof))
} finally {
  if (pageSocket?.readyState === WebSocket.OPEN) { try { pageSocket.close() } catch {} }
  if (browserSocket?.readyState === WebSocket.OPEN) { try { browserSocket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
  await stop(chrome); await stop(vite)
  const resolved = path.resolve(profile)
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Refusing to remove Chrome profile outside temp directory')
  for (let attempt=0;attempt<10;attempt++) { try { await rm(profile,{recursive:true,force:true}); break } catch(error) { if(error.code!=='EBUSY'||attempt===9) throw error; await new Promise(resolve=>setTimeout(resolve,200)) } }
}
