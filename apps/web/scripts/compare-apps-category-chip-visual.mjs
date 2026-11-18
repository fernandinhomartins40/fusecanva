import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const artifactDirectory = path.join(root, 'apps', 'web', 'artifacts', 'visual')
const reference = PNG.sync.read(await readFile(path.join(root, 'analysis', 'visual', 'screenshots', 'canva-apps-discovery-2026-10-19.png')))
const before = PNG.sync.read(await readFile(path.join(artifactDirectory, 'apps-category-chip-1920x953-before.png')))
const after = PNG.sync.read(await readFile(path.join(artifactDirectory, 'apps-category-chip-1920x953-current.png')))
const topBefore = PNG.sync.read(await readFile(path.join(artifactDirectory, 'apps-marketplace-top-region-before.png')))
const topAfter = PNG.sync.read(await readFile(path.join(artifactDirectory, 'apps-marketplace-1920x953-current.png')))
const referenceOrigin = { x: 1582, y: 292 }
const sampleOffsets = [{ x: 18, y: 8 }, { x: 68, y: 8 }, { x: 118, y: 8 }]
function rgb(image, x, y) { const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4; return [...image.data.slice(offset, offset + 3)] }
function hex(color) { return `#${color.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}` }
function sample(image, origin, point) { return rgb(image, origin.x + point.x, origin.y + point.y) }
function compare(image) {
  const width = Math.min(reference.width - referenceOrigin.x, image.width)
  const height = Math.min(reference.height - referenceOrigin.y, image.height)
  let total = 0; let changed = 0; const diff = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ref = rgb(reference, referenceOrigin.x + x, referenceOrigin.y + y)
    const local = rgb(image, x, y)
    const delta = ref.map((channel, index) => Math.abs(channel - local[index]))
    const offset = (y * width + x) * 4
    diff.data[offset] = Math.min(255, delta[0] * 4); diff.data[offset + 1] = Math.min(255, delta[1] * 4); diff.data[offset + 2] = Math.min(255, delta[2] * 4); diff.data[offset + 3] = 255
    total += delta[0] + delta[1] + delta[2]
    if (delta[0] + delta[1] + delta[2] > 30) changed++
  }
  return { width, height, meanAbsoluteChannelError: Number((total / (width * height * 3)).toFixed(3)), changedPixelsOverRgbL1_30: changed, diff }
}
const beforeDiff = compare(before); const afterDiff = compare(after)
const referenceChip = new PNG({ width: 151, height: 40 }); PNG.bitblt(reference, referenceChip, referenceOrigin.x, referenceOrigin.y, 151, 40, 0, 0)
const composite = new PNG({ width: 151 * 3 + 12, height: 40 })
PNG.bitblt(referenceChip, composite, 0, 0, 151, 40, 0, 0)
PNG.bitblt(before, composite, 0, 0, Math.min(151, before.width), Math.min(40, before.height), 155, 0)
PNG.bitblt(after, composite, 0, 0, Math.min(151, after.width), Math.min(40, after.height), 310, 0)
await writeFile(path.join(artifactDirectory, 'apps-category-chip-reference-before-after.png'), PNG.sync.write(composite))
await writeFile(path.join(artifactDirectory, 'apps-category-chip-raster-diff.png'), PNG.sync.write(afterDiff.diff))
const topRegion = { x: 0, y: 0, width: 1920, height: 440 }
function crop(image, region) { const result = new PNG({ width: region.width, height: region.height }); PNG.bitblt(image, result, region.x, region.y, region.width, region.height, 0, 0); return result }
const topReferenceCrop = crop(reference, topRegion); const topBeforeCrop = crop(topBefore, topRegion); const topAfterCrop = crop(topAfter, topRegion)
function wholeCropMetric(local) {
  let total = 0; let changed = 0
  for (let index = 0; index < topReferenceCrop.data.length; index += 4) {
    const error = Math.abs(topReferenceCrop.data[index] - local.data[index]) + Math.abs(topReferenceCrop.data[index + 1] - local.data[index + 1]) + Math.abs(topReferenceCrop.data[index + 2] - local.data[index + 2])
    total += error; if (error > 30) changed++
  }
  return { meanAbsoluteChannelError: Number((total / (regionWidth * regionHeight * 3)).toFixed(3)), changedPixelsOverRgbL1_30: changed }
}
const regionWidth = topRegion.width; const regionHeight = topRegion.height
const topBeforeMetric = wholeCropMetric(topBeforeCrop); const topAfterMetric = wholeCropMetric(topAfterCrop)
const topComposite = new PNG({ width: 1920 * 3, height: topRegion.height })
PNG.bitblt(topReferenceCrop, topComposite, 0, 0, 1920, topRegion.height, 0, 0)
PNG.bitblt(topBeforeCrop, topComposite, 0, 0, 1920, topRegion.height, 1920, 0)
PNG.bitblt(topAfterCrop, topComposite, 0, 0, 1920, topRegion.height, 3840, 0)
const topDiff = new PNG({ width: 1920, height: topRegion.height })
for (let index = 0; index < topDiff.data.length; index += 4) {
  topDiff.data[index] = Math.min(255, Math.abs(topReferenceCrop.data[index] - topAfterCrop.data[index]) * 3)
  topDiff.data[index + 1] = Math.min(255, Math.abs(topReferenceCrop.data[index + 1] - topAfterCrop.data[index + 1]) * 3)
  topDiff.data[index + 2] = Math.min(255, Math.abs(topReferenceCrop.data[index + 2] - topAfterCrop.data[index + 2]) * 3)
  topDiff.data[index + 3] = 255
}
await writeFile(path.join(artifactDirectory, 'apps-marketplace-top-region-reference-before-after.png'), PNG.sync.write(topComposite))
await writeFile(path.join(artifactDirectory, 'apps-marketplace-top-region-after-diff.png'), PNG.sync.write(topDiff))
const visualMetrics = JSON.parse(await readFile(path.join(artifactDirectory, 'apps-category-chip-visual-metrics.json'), 'utf8'))
const topReport = {
  reference: 'analysis/visual/screenshots/canva-apps-discovery-2026-10-19.png',
  referenceViewport: { width: 1920, height: 953 },
  localViewport: visualMetrics.localAfter.viewport,
  comparedCropPx: topRegion,
  regions: {
    beforeCategoryY: 385,
    referenceHero: { x: 96, y: 24, width: 1777, height: 252 },
    referenceSearch: { x: 96, y: 292, width: 360, height: 41 },
    referenceCategoriesY: 292,
    after: visualMetrics.localAfter.regions,
    afterCategoryChip: visualMetrics.localAfter.bounds,
  },
  before: topBeforeMetric,
  after: topAfterMetric,
  categoryFillSamples: visualMetrics.localAfter.background,
  artifacts: ['apps-marketplace-top-region-reference-before-after.png', 'apps-marketplace-top-region-after-diff.png'],
  limitation: 'This full-width crop compares the archived Canva screen with the local product screen; hero art, side shell and card content remain different. The category and top-row positions are the scoped measurements.',
}
await writeFile(path.join(artifactDirectory, 'apps-marketplace-top-region-visual-diff.json'), JSON.stringify(topReport, null, 2))
const report = {
  reference: 'analysis/visual/screenshots/canva-apps-discovery-2026-10-19.png',
  capture: 'web/scripts/check-apps-marketplace-browser.mjs at 1920x953',
  target: 'Unchecked “Gestão de projetos” chip; reference bounds x=1582..1732, y=292..330; local crop is the same component selected by label.',
  sampleOffsetsPx: sampleOffsets,
  samples: sampleOffsets.map(point => ({ offset: point, reference: hex(sample(reference, referenceOrigin, point)), before: hex(sample(before, { x: 0, y: 0 }, point)), after: hex(sample(after, { x: 0, y: 0 }, point)) })),
  oldCssComputedBackground: '#222128',
  targetCssFill: '#16171D',
  beforeCrop: { width: before.width, height: before.height, ...Object.fromEntries(Object.entries(beforeDiff).filter(([key]) => key !== 'diff')) },
  afterCrop: { width: after.width, height: after.height, ...Object.fromEntries(Object.entries(afterDiff).filter(([key]) => key !== 'diff')) },
  artifacts: ['apps-category-chip-reference-before-after.png', 'apps-category-chip-raster-diff.png', 'apps-marketplace-top-region-reference-before-after.png', 'apps-marketplace-top-region-after-diff.png', 'apps-marketplace-top-region-visual-diff.json'],
  limitation: 'The target chip position and fill now match the audited crop. Hero art, side shell, app imagery and recommendation-card content remain different across the full page.',
}
await writeFile(path.join(artifactDirectory, 'apps-category-chip-visual-diff.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
