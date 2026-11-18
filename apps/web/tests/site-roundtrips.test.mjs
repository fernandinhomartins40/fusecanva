import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('site sections duplicate, retain visibility, reorder, add and delete through a serialized roundtrip', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const model = await vite.ssrLoadModule('/src/model.ts')
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const source = model.createTypedBlankDocument('site')
    assert.equal(source.pages.length, 2, 'a new site has home and contact root pages')

    const originalContent = JSON.stringify(source.pages[1])
    const hiddenSection = pages.setSiteSectionVisibility(source, 1, true)
    assert.equal(hiddenSection.pages[1].hidden, true)
    assert.equal(JSON.stringify(hiddenSection.pages[1]).includes('hidden'), true)
    assert.equal(JSON.stringify(source.pages[1]), originalContent, 'visibility changes do not mutate the source')
    assert.equal(pages.setSiteSectionVisibility(hiddenSection, 1, true), hiddenSection, 'repeating the same visibility state is idempotent')
    const shownSection = pages.setSiteSectionVisibility(JSON.parse(JSON.stringify(hiddenSection)), 1, false)
    assert.equal(Object.hasOwn(shownSection.pages[1], 'hidden'), false, 'showing a section restores the original metadata shape')
    assert.equal(JSON.stringify(shownSection.pages[1]), originalContent)
    assert.equal(pages.setSiteSectionVisibility(source, -1, true), null)
    assert.equal(pages.setSiteSectionVisibility({ ...source, type: 'doc' }, 1, true), null)

    const hidden = hiddenSection.pages[1]
    let current = hiddenSection
    const duplicate = pages.duplicateDesignPage(current, 1)
    assert.ok(duplicate)
    assert.equal(duplicate.document.pages[2].hidden, true)
    assert.notEqual(duplicate.document.pages[2].id, hidden.id)

    const added = pages.createBlankDesignPage(duplicate.document)
    current = { ...duplicate.document, pages: [...duplicate.document.pages, { ...added, name: 'Serviços' }] }
    const reordered = pages.moveDesignPage(current, 3, 0)
    assert.deepEqual(reordered.document.pages.map(page => page.name), ['Serviços', 'Início', 'Contato', 'Contato (cópia)'])

    const restored = JSON.parse(JSON.stringify(reordered.document))
    assert.deepEqual(restored.pages.map(page => page.name), ['Serviços', 'Início', 'Contato', 'Contato (cópia)'])
    assert.equal(restored.pages[2].hidden, true)
    assert.deepEqual(restored.pages.filter(page => !page.hidden).map(page => page.name), ['Serviços', 'Início'])

    const removed = pages.deleteDesignPage(restored, 0)
    assert.deepEqual(removed.document.pages.map(page => page.name), ['Início', 'Contato', 'Contato (cópia)'])
    assert.equal(removed.pageIndex, 0)
  } finally {
    await vite.close()
  }
})

test('duplicating a populated site section remaps self-section links and keeps links to other sections', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const model = await vite.ssrLoadModule('/src/model.ts')
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const source = model.createTypedBlankDocument('site')
    const original = source.pages[0]
    original.elements = [
      { id: 'self-link', type: 'text', text: 'Jump within this section', href: `#site-section-${original.id}` },
      { id: 'contact-link', type: 'text', text: 'Contact', href: `#site-section-${source.pages[1].id}` },
    ]

    const result = pages.duplicateDesignPage(source, 0)
    assert.ok(result)
    const copy = result.document.pages[result.pageIndex]
    assert.notEqual(copy.id, original.id)
    assert.notEqual(copy.elements[0].id, original.elements[0].id)
    assert.equal(copy.elements[0].href, `#site-section-${copy.id}`, 'a copied self-link targets the copied section')
    assert.equal(copy.elements[1].href, `#site-section-${source.pages[1].id}`, 'links to a different section keep their target')
    assert.equal(original.elements[0].href, `#site-section-${original.id}`, 'the source remains unchanged')
  } finally {
    await vite.close()
  }
})

test('site preview device controls expose desktop and mobile modes; navigation labels follow visible page names', async () => {
  const { readFile } = await import('node:fs/promises')
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /viewportMode === 'desktop'.*Desktop/s)
  assert.match(app, /viewportMode === 'mobile'.*Celular/s)
  assert.ok(app.includes("document.pages.filter(sitePage => !sitePage.hidden).map(sitePage => <a key={sitePage.id} href={`#${sectionAnchors[sitePage.id]}`} onClick={() => setExpandedNavigation(false)}>{sitePage.name}</a>)"))
  assert.match(app, /setViewportMode\('desktop'\)/)
  assert.match(app, /setViewportMode\('mobile'\)/)
})
