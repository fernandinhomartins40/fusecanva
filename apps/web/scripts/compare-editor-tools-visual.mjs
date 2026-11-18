import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const referencePath = path.join(root, 'analysis', 'visual', 'screenshots', 'a4-tools-panel-open-v1.png')
const currentPath = path.join(root, 'apps', 'web', 'artifacts', 'visual', 'editor-tools-open-1920x953-current.png')
const outputDirectory = path.join(root, 'apps', 'web', 'artifacts', 'visual')
const reference = PNG.sync.read(await readFile(referencePath))
const current = PNG.sync.read(await readFile(currentPath))
assert.deepEqual([reference.width, reference.height], [1920, 953], 'the retained REA reference is the audited 1920x953 screenshot')
assert.deepEqual([current.width, current.height], [1920, 953], 'the local browser capture uses the same viewport')

function crop(source, region) {
  const result = new PNG({ width: region.width, height: region.height })
  PNG.bitblt(source, result, region.x, region.y, region.width, region.height, 0, 0)
  return result
}
function metrics(a, b) {
  assert.deepEqual([a.width, a.height], [b.width, b.height])
  let total = 0
  let changed = 0
  const diff = new PNG({ width: a.width, height: a.height })
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const delta = [0, 1, 2].map(channel => Math.abs(a.data[offset + channel] - b.data[offset + channel]))
    total += delta[0] + delta[1] + delta[2]
    if (delta[0] + delta[1] + delta[2] > 30) changed++
    diff.data[offset] = Math.min(255, delta[0] * 3)
    diff.data[offset + 1] = Math.min(255, delta[1] * 3)
    diff.data[offset + 2] = Math.min(255, delta[2] * 3)
    diff.data[offset + 3] = 255
  }
  return { meanAbsoluteChannelError: Number((total / (a.width * a.height * 3)).toFixed(3)), changedPixelsOverRgbL1_30: changed, diff }
}

const referenceRailRegion = { x: 0, y: 56, width: 128, height: 641 }
const localRailRegion = { x: 0, y: 56, width: 128, height: 641 }
const referenceRail = crop(reference, referenceRailRegion)
const localRail = crop(current, localRailRegion)
const railResult = metrics(referenceRail, localRail)
const fullViewportResult = metrics(reference, current)

const composite = new PNG({ width: 1920 * 2, height: 953 })
PNG.bitblt(reference, composite, 0, 0, 1920, 953, 0, 0)
PNG.bitblt(current, composite, 0, 0, 1920, 953, 1920, 0)
await mkdir(outputDirectory, { recursive: true })
await writeFile(path.join(outputDirectory, 'editor-tools-reference-vs-current.png'), PNG.sync.write(composite))
await writeFile(path.join(outputDirectory, 'editor-tools-rail-diff.png'), PNG.sync.write(railResult.diff))
const report = {
  reference: 'analysis/visual/screenshots/a4-tools-panel-open-v1.png',
  localCapture: 'web/artifacts/visual/editor-tools-open-1920x953-current.png',
  viewport: { width: 1920, height: 953 },
  regions: { referenceRail: referenceRailRegion, localRail: localRailRegion },
  metrics: { rail: { meanAbsoluteChannelError: railResult.meanAbsoluteChannelError, changedPixelsOverRgbL1_30: railResult.changedPixelsOverRgbL1_30 }, fullViewport: { meanAbsoluteChannelError: fullViewportResult.meanAbsoluteChannelError, changedPixelsOverRgbL1_30: fullViewportResult.changedPixelsOverRgbL1_30 } },
  artifacts: ['web/artifacts/visual/editor-tools-reference-vs-current.png', 'web/artifacts/visual/editor-tools-rail-diff.png'],
  finding: 'The local editor now separates a 72px navigation rail from a 56px tool dock, matching the audited shell structure. The remaining differences include icon sizing/placement, document fixture, inspector content, and other page-level details; the metrics do not establish visual parity.',
  limitation: 'The whole-viewport metric also includes the different topbar, inspector and document fixture; only the rail crop is a scoped component comparison. The local document is intentionally blank.',
}
await writeFile(path.join(outputDirectory, 'editor-tools-visual-diff.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
