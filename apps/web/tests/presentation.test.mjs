import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('presentation projects start in widescreen format and navigation stays within slide bounds', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const model = await vite.ssrLoadModule('/src/model.ts')
    const navigation = await vite.ssrLoadModule('/src/presentation.ts')
    const pages = await vite.ssrLoadModule('/src/pages.ts')
    const presentation = model.createTypedBlankDocument('presentation')
    assert.equal(presentation.type, 'presentation')
    assert.deepEqual([presentation.width, presentation.height], [1280, 720])
    assert.equal(presentation.pages[0].name, 'Slide 1')
    const secondSlide = pages.createBlankDesignPage(presentation)
    assert.equal(secondSlide.name, 'Slide 2')
    assert.deepEqual(secondSlide.elements, [])
    assert.equal(secondSlide.presenterNotes, undefined)
    presentation.pages[0].presenterNotes = 'Apresentar o objetivo antes do gráfico.'
    const duplicatedSlide = pages.duplicateDesignPage(presentation, 0)
    assert.equal(duplicatedSlide.document.pages[1].presenterNotes, presentation.pages[0].presenterNotes)
    presentation.pages.push(secondSlide, pages.createBlankDesignPage({ ...presentation, pages: [...presentation.pages, secondSlide] }))
    const presenterAtStart = navigation.getPresenterView(presentation, 0)
    assert.equal(presenterAtStart.page.presenterNotes, presentation.pages[0].presenterNotes)
    assert.equal(presenterAtStart.nextPage.id, presentation.pages[1].id)
    assert.equal(navigation.getPresenterView(presentation, 2).nextPage, null)
    assert.equal(navigation.clampPresentationPage(1, 3), 1)
    assert.equal(navigation.clampPresentationPage(-1, 3), 0)
    assert.equal(navigation.clampPresentationPage(3, 3), 2)
    assert.equal(navigation.clampPresentationPage(2, 0), 0)
  } finally {
    await vite.close()
  }
})
