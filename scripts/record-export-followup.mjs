import fs from 'node:fs'

const statusPath = new URL('../IMPLEMENTATION-STATUS.json', import.meta.url)
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'))
const replaceStatus = (id, find, replace) => { status[id].status = status[id].status.replace(find, replace) }

replaceStatus('editor-file-export-format-picker-and-readiness', 'texto, retangulos/elipses simples e imagens PNG/JPEG planas incorporadas', 'texto, retangulos/elipses simples, linhas retas sem setas, tracos livres de ate 5000 pontos e imagens PNG/JPEG planas incorporadas')
replaceStatus('export-format-specific-controls-and-artifact-verification', 'export nativo de texto/formas simples/imagens PNG/JPEG em paginas suportadas', 'export nativo de texto, formas simples, linhas retas, tracos livres e imagens PNG/JPEG em paginas suportadas')
replaceStatus('video-pro-sync-persist-and-restore', 'embedded-audio clip-volume/mixing fidelity', 'relative volume response and mixing among multiple embedded tracks')
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')

const planPath = new URL('../IMPLEMENTATION-PLAN.md', import.meta.url)
const additions = [
  '**Editable PPTX vector follow-up (2026-10-22):** native DrawingML now includes straight unarrowed lines and free-draw strokes through 5,000 points, retaining straight endpoints, Konva tension-0.35 spline curves, stroke color/width, round caps/joins, position and rotation. Arrowed/curved line shapes, invalid paths and unsupported content continue to use page raster fallback. Focused PPTX tests (3/3) and production build pass; `analysis/` remains unchanged.',
  '**Embedded video volume check (2026-10-22):** the template Chromium scenario exports the embedded Opus source at 100% and 0% while muting the separate WAV track, decodes both files and verifies muted RMS is below 10% of baseline. The audio path and clip mute now have runtime evidence. Relative attenuation curves and mixing among multiple embedded tracks remain unverified; `npm.cmd run test:browser:templates` passes and no code change was required.'
]
let plan = fs.readFileSync(planPath, 'utf8')
for (const addition of additions) if (!plan.includes(addition)) plan += `\n\n${addition}\n`
fs.writeFileSync(planPath, plan, 'utf8')
