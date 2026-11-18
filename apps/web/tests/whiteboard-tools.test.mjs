import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('whiteboard dock keeps a single active tool and closes line choices when selection is restored', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const dock = await vite.ssrLoadModule('/src/whiteboard-tools.ts')
    const component = await vite.ssrLoadModule('/src/WhiteboardToolDock.tsx')
    let state = dock.initialWhiteboardToolDockState
    assert.deepEqual(state, { activeTool: 'select', lineMenuOpen: false, lineVariant: 'straight' })
    state = dock.reduceWhiteboardToolDock(state, { type: 'open-line-menu' })
    assert.equal(state.activeTool, 'lines')
    assert.equal(state.lineMenuOpen, true)
    state = dock.reduceWhiteboardToolDock(state, { type: 'choose-line-variant', variant: 'curved' })
    assert.deepEqual(state, { activeTool: 'lines', lineMenuOpen: false, lineVariant: 'curved' })
    state = dock.reduceWhiteboardToolDock(state, { type: 'open-line-menu' })
    assert.equal(state.lineMenuOpen, true, 'repeating the line-menu action does not dismiss the submenu')
    state = dock.reduceWhiteboardToolDock(state, { type: 'activate', tool: 'drawing' })
    assert.deepEqual(state, { activeTool: 'drawing', lineMenuOpen: true, lineVariant: 'curved' }, 'switching tool preserves an intentionally open submenu until an explicit close or selection reset')
    state = dock.reduceWhiteboardToolDock(state, { type: 'activate', tool: 'select' })
    assert.deepEqual(state, { activeTool: 'select', lineMenuOpen: false, lineVariant: 'curved' })
    assert.deepEqual(dock.WHITEBOARD_LINE_VARIANTS.map(({ label }) => label), ['Linha reta', 'Linha angular', 'Linha curva'])
    const markup = renderToStaticMarkup(React.createElement(component.WhiteboardToolDock, { activeTool: 'connector', onActivate: () => {} }))
    assert.match(markup, /aria-label="Conector" aria-pressed="true"/, 'the rendered dock reflects the active canvas tool immediately')
    assert.match(markup, /aria-label="Selecionar" aria-pressed="false"/)
    assert.match(markup, /aria-label="Ferramentas do quadro branco"/)
  } finally {
    await vite.close()
  }
})
