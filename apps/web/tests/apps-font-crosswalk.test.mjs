import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = path.resolve(root, '..', '..', 'analysis')
const readJson = async file => JSON.parse(await readFile(path.join(evidence, file), 'utf8'))

test('Apps route font resources crosswalk to exact Canva faces and parsed families, without claiming a local Canva face', async () => {
  const [resource, metadata, cssFonts, a4Crosswalk] = await Promise.all([
    readJson('apps-marketplace-font-resource-observation-2026-10-19.json'),
    readJson('apps-marketplace-font-parsed-metadata-2026-10-19.json'),
    readJson('visual/css-fonts.json'),
    readJson('a4-current-font-rendering-crosswalk-2026-10-20T0000Z.json'),
  ])

  assert.equal(resource.observed_inventory.font_resources.length, 2)
  assert.equal(metadata.font_count, 2)
  for (const font of metadata.fonts) {
    const observed = resource.observed_inventory.font_resources.find(item => item.url === font.resource_url)
    assert.ok(observed, `REA resource URL joins to parsed metadata: ${font.resource_url}`)
    assert.equal(observed.content_size, font.received_bytes)
    assert.equal(font.reported_size_matches, true)
    assert.equal(font.internal_names['1'][0], 'Canva Sans Sans')
    assert.equal(font.internal_names['6'][0], 'CanvaSans-SansRegular')
    const declarations = cssFonts.filter(item => item.css.includes(font.resource_url))
    assert.ok(declarations.length > 0, `exact observed resource URL appears in retained CSS declarations: ${font.resource_url}`)
    assert.ok(declarations.every(item => item.css.includes('font-family: "Canva Sans"')))
  }

  const renderedCanvaSans = a4Crosswalk.rendered_groups.find(group => group.surface === 'A4 editor shell text labels')
  assert.equal(renderedCanvaSans.platform_family, 'Canva Sans Sans')
  assert.match(renderedCanvaSans.confidence_boundary, /does not distinguish which subset rendered each glyph/)
  assert.equal(a4Crosswalk.loaded_font_resources.open_sans_resource_match, 'none within the three REA-returned static.canva.com font resources')
})

test('local Apps marketplace typography declares Inter fallback and ships no mislabeled REA font binaries', async () => {
  const [marketplaceCss, globalCss] = await Promise.all([
    readFile(path.join(root, 'src', 'AppsMarketplace.css'), 'utf8'),
    readFile(path.join(root, 'src', 'index.css'), 'utf8'),
  ])
  assert.match(marketplaceCss, /\.apps-marketplace\s*\{[^}]*font:\s*14px\/1\.45\s+Inter,ui-sans-serif,system-ui,sans-serif/s)
  assert.match(globalCss, /font-family:\s*Inter,\s*ui-sans-serif,\s*system-ui/)
  const assetFiles = await Promise.all(['src/assets', 'public'].map(async folder =>
    (await readdir(path.join(root, folder), { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile() && /\.(woff2?|ttf|otf)$/i.test(entry.name))
      .map(entry => entry.name)))
  assert.deepEqual(assetFiles.flat(), [], 'no local font binary supports replacing the declared platform-dependent stack')
})
