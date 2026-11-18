import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('site projects start as editable widescreen sections and added pages are named as sections', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const model = await vite.ssrLoadModule('/src/model.ts')
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const site = model.createTypedBlankDocument('site')
    assert.equal(site.type, 'site')
    assert.equal(site.name, 'Site sem título')
    assert.deepEqual([site.width, site.height], [1440, 900])
    assert.equal(site.pages[0].name, 'Início')
    assert.equal(site.pages[0].background, '#f5f4fa')
    assert.equal(site.pages[0].elements.filter(element => element.type === 'text').length, 3)
    assert.ok(site.pages[0].elements.some(element => element.type === 'shape' && element.fill === '#7054df'))
    assert.equal(site.pages[1].name, 'Contato')
    const cta = site.pages[0].elements.find(element => element.name === 'Chamada para ação')
    assert.equal(cta.href, `#site-section-${site.pages[1].id}`)
    assert.equal(site.pages[1].elements.find(element => element.name === 'E-mail de contato').href, 'mailto:contato@example.com')
    const nextSection = pages.createBlankDesignPage(site)
    assert.equal(nextSection.name, 'Seção 3')
    assert.deepEqual(nextSection.elements, [])
  } finally {
    await vite.close()
  }
})

test('site links allow safe web and contact schemes while rejecting executable URLs', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const links = await vite.ssrLoadModule('/src/site-links.ts')
    assert.equal(links.normalizeSiteHref('#section-2'), '#section-2')
    assert.equal(links.normalizeSiteHref('/contact'), '/contact')
    assert.equal(links.normalizeSiteHref('https://example.com/path'), 'https://example.com/path')
    assert.equal(links.normalizeSiteHref('mailto:hello@example.com'), 'mailto:hello@example.com')
    assert.equal(links.normalizeSiteHref('tel:+15551234567'), 'tel:+15551234567')
    assert.equal(links.normalizeSiteHref('//evil.example'), null)
    assert.equal(links.normalizeSiteHref('javascript:alert(1)'), null)
    assert.equal(links.normalizeSiteHref('data:text/html,unsafe'), null)
    assert.equal(links.normalizeSiteHref('#section one'), null)
    assert.equal(links.siteSectionAnchor('section / contact'), 'site-section-section---contact')
    const collided = links.siteSectionAnchors(['section / contact', 'section ? contact'])
    assert.notEqual(collided['section / contact'], collided['section ? contact'])
    assert.deepEqual(collided, links.siteSectionAnchors(['section ? contact', 'section / contact']))
    assert.match(collided['section / contact'], /^site-section-section---contact(?:-[a-z0-9]+)?$/)
  } finally {
    await vite.close()
  }
})
