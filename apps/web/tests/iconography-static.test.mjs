import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const iconOnlyGlyphs = /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|[★☆●○◆◇■□▲△▼▽→←↑↓×✕⋯…⌕⌖⌘⌥⌫⌦↩↪↗↘↙↖]))+$/u

function findLegacyControlIcons(source) {
  const issues = []
  const legacyInlineSymbols = /[\p{Extended_Pictographic}\u2713\u2714]/u
  const controls = /<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi
  for (const match of source.matchAll(controls)) {
    const body = match[1]
    const line = source.slice(0, match.index).split(/\r?\n/).length
    // Only flag controls whose visible JSX consists solely of icon-like glyphs.
    // Text labels, dimensional symbols in prose, and SVG nodes are left alone.
    const visible = body
      .replace(/<[^>]*>/g, '')
      .replace(/\{[^{}]*\}/g, '')
      .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, '')
      .trim()
    if (visible && iconOnlyGlyphs.test(visible)) issues.push(`${line}: glyph-only control (${visible})`)
    if (legacyInlineSymbols.test(body)) issues.push(`${line}: legacy symbol embedded in a control`)

    if (/<img\b[^>]*\bsrc\s*=\s*\{?\s*["'][^"']*(?:\.svg|image\/svg\+xml)[^"']*["']/i.test(body)) {
      issues.push(`${line}: inline SVG image used as a control icon`)
    }
    if (/fontFamily\s*:\s*["'](?:Font\s*Awesome|Material\s*Icons|icon(?:s|font)?|IcoMoon)[^"']*["']/i.test(body)) {
      issues.push(`${line}: icon font used in a control`)
    }
  }
  return issues
}

test('UI controls use lucide-react instead of legacy glyph, icon-font, or inline-image icons', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const issues = findLegacyControlIcons(source)
  assert.deepEqual(issues, [], `Legacy iconography found:\n${issues.join('\n')}`)
})

test('standalone product components follow the same legacy-icon guard as the main editor', async () => {
  const sourceDir = new URL('../src/', import.meta.url)
  const filenames = (await readdir(sourceDir)).filter(filename => filename.endsWith('.tsx'))
  const audited = await Promise.all(filenames.map(async filename => ({ filename, source: await readFile(new URL(filename, sourceDir), 'utf8') })))
  const issues = audited.flatMap(({ filename, source }) => findLegacyControlIcons(source).map(issue => `${filename}: ${issue}`))
  assert.deepEqual(issues, [], `Legacy iconography found in standalone components:\n${issues.join('\n')}`)
  assert.ok(audited.some(({ filename }) => filename === 'AppsMarketplace.tsx'), 'Apps marketplace is included in the cross-component audit')
  assert.ok(audited.some(({ filename }) => filename === 'BulkCreatePanel.tsx'), 'bulk creation panel is included in the cross-component audit')
  assert.ok(audited.some(({ filename }) => filename === 'PrintSandbox.tsx'), 'print sandbox is included in the cross-component audit')
})

test('bulk creation controls use accessible Lucide icons with text or aria labels', async () => {
  const source = await readFile(new URL('../src/BulkCreatePanel.tsx', import.meta.url), 'utf8')
  const imported = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1] ?? ''
  const icons = [...source.matchAll(/<(X|Plus|Trash2|Upload)\b([^>]*)\s*\/>/g)]
  assert.deepEqual([...new Set(icons.map(match => match[1]))].sort(), ['Plus', 'Trash2', 'Upload', 'X'])
  for (const [, icon, attributes] of icons) {
    assert.match(imported, new RegExp(`\\b${icon}\\b`), `${icon} should come from lucide-react`)
    assert.match(attributes, /aria-hidden="true"/, `${icon} is decorative because its control already has a label`)
  }
  assert.deepEqual(findLegacyControlIcons(source), [])
})

test('whiteboard pan tool keeps the same icon in desktop and mobile toolbars', async () => {
  const [source, dock] = await Promise.all([readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), readFile(new URL('../src/WhiteboardToolDock.tsx', import.meta.url), 'utf8')])
  assert.match(dock, /title="Arrastar para mover o quadro"/)
  assert.match(dock, /<Move size=\{19\} aria-hidden="true" \/>/)
  assert.match(source, /isWhiteboard && <button className=\{whiteboardTool === 'pan' \? 'mobile-tool-active' : ''\}[^>]*><Move size=\{17\} aria-hidden="true" \/>Mover<\/button>/)
})

test('whiteboard select tool exposes its active state to assistive technology', async () => {
  const source = await readFile(new URL('../src/WhiteboardToolDock.tsx', import.meta.url), 'utf8')
  assert.match(source, /function isActive\(tool: CanvasTool\)\s*\{\s*return activeTool === tool\s*\}/, 'visual and accessible state share the parent canvas-tool source')
  assert.match(source, /aria-label="Selecionar" aria-pressed=\{isActive\('select'\)\}/)
  assert.match(source, /className=\{`tool-button \$\{isActive\('select'\) \? 'active' : ''\}`\}/, 'the visible active class uses the same state as aria-pressed')
})

test('inline checkmark symbols inside controls are flagged as legacy iconography', () => {
  assert.deepEqual(findLegacyControlIcons('<button>Claro<span aria-hidden="true">✓</span></button>'), ['1: legacy symbol embedded in a control'])
})

test('emoji mixed into a labeled control are flagged as legacy iconography', () => {
  assert.deepEqual(findLegacyControlIcons('<button>Salvar \u{1F3A8}</button>'), ['1: legacy symbol embedded in a control'])
})


test('theme selection uses Lucide Check rather than a Unicode checkmark', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(source, /theme === 'light' && <Check className="theme-check" size=\{14\} aria-hidden="true" \/>/)
  assert.match(source, /theme === 'dark' && <Check className="theme-check" size=\{14\} aria-hidden="true" \/>/)
  assert.doesNotMatch(source, /className="theme-check"[^>]*>✓</)
})

test('tool icons in the requested product surfaces resolve to lucide-react components', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const whiteboardSource = await readFile(new URL('../src/WhiteboardToolDock.tsx', import.meta.url), 'utf8')
  const importLine = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)
  assert.ok(importLine, 'App.tsx must import the shared icon set from lucide-react')
  const imported = new Set(importLine[1].split(',').map(name => name.trim().split(/\s+as\s+/).at(-1)))

  const checks = [
    ['Início / navegação', /<a className=\{homeSection === 'home' \? 'active' : undefined\} href="#home-top"[\s\S]{0,500}/, ['House', 'LayoutTemplate']],
    ['Criar projeto na Home', /<nav className="home-category-row"[\s\S]{0,2200}/, ['LayoutTemplate', 'Presentation', 'ImageIcon', 'FileText', 'Shapes', 'Sheet', 'Film', 'Globe', 'Upload']],
    ['Editor de design', /<button className=\{`tool-button \$\{whiteboardTool[\s\S]{0,20000}/, ['MousePointer2', 'Type', 'ImageIcon']],
    ['Docs', /<div className="doc-toolbar"[\s\S]{0,2400}/, ['Bold', 'Italic']],
    ['Planilhas', /<div className="sheet-toolbar"[\s\S]{0,1600}/, ['Plus']],
    ['Vídeo', /<div className="video-transport"[\s\S]{0,700}/, ['Play', 'Pause']],
    ['Quadro branco', /export function WhiteboardToolDock[\s\S]{0,12000}/, ['Move', 'ArrowUpRight', 'Pencil']],
    ['Sites', /<button ref=\{mobileMenuToggleRef\}[\s\S]{0,500}/, ['Menu', 'X']],
    ['Prévia responsiva de Sites', /<div className="site-preview-controls"[\s\S]{0,1000}/, ['Monitor', 'Smartphone', 'X']],
  ]

  for (const [surface, anchor, icons] of checks) {
    const surfaceSource = surface === 'Quadro branco' ? whiteboardSource : source
    const surfaceImported = surface === 'Quadro branco'
      ? new Set((whiteboardSource.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1] ?? '').split(',').map(name => name.trim()))
      : imported
    const match = surfaceSource.match(anchor)
    assert.ok(match, `${surface}: expected audited UI surface anchor was not found`)
    for (const icon of icons) {
      assert.ok(surfaceImported.has(icon), `${surface}: ${icon} must come from lucide-react`)
      assert.ok(match[0].includes(`<${icon} `), `${surface}: expected ${icon} in its primary controls`)
    }
  }
})

test('video, whiteboard, and Sites keep decorative Lucide icons hidden from accessible names', async () => {
  const [source, dock] = await Promise.all([readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), readFile(new URL('../src/WhiteboardToolDock.tsx', import.meta.url), 'utf8')])
  const video = source.match(/<section className="video-timeline"[\s\S]*?<\/section>/)?.[0] ?? ''
  assert.ok(video, 'video timeline controls should exist')
  for (const icon of ['Play', 'Pause', 'Plus', 'Scissors', 'Activity', 'Film', 'Music2', 'X']) {
    const occurrences = [...video.matchAll(new RegExp(`<${icon}\\b([^>]*)\\/>`, 'g'))]
    assert.ok(occurrences.length > 0, `video timeline should use ${icon}`)
    for (const [, attributes] of occurrences) assert.match(attributes, /aria-hidden="true"/, `${icon} is decorative in the labeled video control`)
  }
  assert.match(source, /<Maximize size=\{14\} aria-hidden="true" \/> Enquadrar/, 'whiteboard fit icon stays decorative beside its text label')
  assert.match(source, /className="site-preview-close"[\s\S]{0,130}aria-label="Fechar prévia"><X size=\{18\} aria-hidden="true" \/>/, 'Sites close icon is hidden because the button has an accessible label')
})

test('Video, whiteboard, and Sites tool surfaces use only imported Lucide icons and hide decorative marks', async () => {
  const [source, dock] = await Promise.all([readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), readFile(new URL('../src/WhiteboardToolDock.tsx', import.meta.url), 'utf8')])
  const appImports = new Set(source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1].split(',').map(name => name.trim().split(/\s+as\s+/).at(-1)) ?? [])
  const dockImports = new Set(dock.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1].split(',').map(name => name.trim().split(/\s+as\s+/).at(-1)) ?? [])
  const video = source.match(/<section className="video-timeline"[\s\S]*?<\/section>/)?.[0] ?? ''
  const whiteboardZoom = source.match(/<div className="whiteboard-zoom-controls"[\s\S]{0,650}/)?.[0] ?? ''
  const whiteboardMobile = source.match(/<nav className="mobile-tools"[\s\S]*?<\/nav>/)?.[0] ?? ''
  const sitePreviewControls = source.match(/<div className="site-preview-controls"[\s\S]{0,1000}/)?.[0] ?? ''
  const siteNavigation = source.match(/<nav className="site-preview-nav"[\s\S]*?<\/nav>/)?.[0] ?? ''
  const sitePages = source.match(/<footer className=\{`page-footer\$\{isSite[\s\S]*?<\/footer>/)?.[0] ?? ''
  const surfaces = [
    ['video timeline', video, appImports, ['Play', 'Pause', 'Scissors', 'Activity', 'Film', 'Music2', 'X']],
    ['whiteboard dock', dock, dockImports, ['MousePointer2', 'Move', 'ArrowUpRight', 'Pencil']],
    ['whiteboard zoom', whiteboardZoom, appImports, ['Minus', 'Plus', 'Maximize']],
    ['whiteboard mobile tools', whiteboardMobile, appImports, ['MousePointer2', 'Move', 'Pencil']],
    ['Sites preview controls', sitePreviewControls, appImports, ['Monitor', 'Smartphone', 'X']],
    ['Sites preview navigation', siteNavigation, appImports, ['Menu', 'X']],
    ['Sites page controls', sitePages, appImports, ['ChevronLeft', 'ChevronRight', 'Plus', 'Copy', 'Eye', 'EyeOff', 'ArrowLeft', 'ArrowRight', 'Trash2']],
  ]
  for (const [surface, markup, imported, expectedIcons] of surfaces) {
    assert.ok(markup, `${surface} surface should be present`)
    for (const icon of expectedIcons) {
      assert.ok(imported.has(icon), `${surface}: ${icon} must be imported from lucide-react`)
      assert.match(markup, new RegExp(`<${icon}\\b`), `${surface}: expected Lucide ${icon}`)
    }
    for (const [icon, attrs] of markup.matchAll(/<([A-Z][A-Za-z0-9]*)\b([^>]*?)\s*\/>/g)) {
      if (!imported.has(icon)) continue
      assert.match(attrs, /aria-hidden="true"/, `${surface}: decorative Lucide ${icon} must not add noise to the accessible name`)
    }
    assert.deepEqual(findLegacyControlIcons(markup), [], `${surface} must not mix glyph/icon-font/inline-image controls with Lucide`)
  }
  assert.match(video, /className="audio-waveform"[\s\S]*?role="img" aria-label=/, 'waveform SVG remains labeled audio content, not a tool icon')
})

test('Home and primary editor tools keep their Lucide icon sizing and decorative semantics consistent', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const homeCategories = source.match(/<nav className="home-category-row"[\s\S]{0,2400}/)?.[0]
  const editorInventory = source.match(/<div className="editor-tools-inventory">[\s\S]{0,2200}/)?.[0]
  const editorRail = source.match(/<aside className="tools-panel"[\s\S]{0,18000}/)?.[0]
  assert.ok(homeCategories, 'Home creation category controls should exist')
  assert.ok(editorInventory, 'The primary editor tool inventory should exist')
  assert.ok(editorRail, 'The primary editor tool rail should exist')
  assert.match(homeCategories, /<span className="home-category-icon [^"]+" aria-hidden="true"><[A-Z][A-Za-z0-9]* size=\{22\} \/><\/span>/)
  for (const icon of ['MousePointer2', 'Pencil', 'Shapes', 'Minus', 'Sticker', 'Type', 'PenTool', 'Table2']) {
    assert.match(editorInventory, new RegExp(`<${icon} size=\\{17\\} aria-hidden="true" \\/>`), `${icon} should remain a 17px decorative Lucide tool icon`)
  }
  assert.match(editorRail, /<span className="tool-icon"><Shapes size=\{19\} aria-hidden="true" \/><\/span>/)
  assert.match(editorRail, /<span className="tool-icon"><ImageIcon size=\{19\} aria-hidden="true" \/><\/span>/)
  const railToolIcons = [...editorRail.matchAll(/<span className="tool-icon[^\"]*"[^>]*>([\s\S]*?)<\/span>/g)]
  assert.ok(railToolIcons.length > 0, 'Editor rail should contain its primary tool icons')
  for (const [, iconMarkup] of railToolIcons) {
    assert.match(iconMarkup, /<\w+\b[^>]*aria-hidden="true"/, 'Labeled editor tools should hide decorative Lucide icons from screen readers')
  }
  const shapeTools = editorRail.match(/<div className="shape-tools"[\s\S]{0,700}/)?.[0]
  assert.ok(shapeTools, 'Editor vector-shape tools should exist')
  assert.match(shapeTools, /<ShapeIcon size=\{18\} strokeWidth=\{1\.8\} aria-hidden="true" \/>/, 'Vector shape buttons use a consistent Lucide size/stroke and hide their decorative icon')
  const iconImport = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1] ?? ''
  const shapeIconNames = source.match(/const VECTOR_SHAPE_ICONS:[\s\S]*?=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  for (const [, icon] of shapeIconNames.matchAll(/:\s*([A-Z][A-Za-z0-9]*)\s*,?/g)) {
    assert.match(iconImport, new RegExp(`\\b${icon}\\b`), `${icon} shape tool comes from lucide-react`)
  }
})

test('Home and editor navigation/tool surfaces do not depend on legacy CSS glyphs or SVG sprites', async () => {
  const [source, appCss, hubCss] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/Hub.css', import.meta.url), 'utf8'),
  ])
  const homeSidebar = source.match(/<aside className="home-sidebar"[\s\S]*?<\/aside>/)?.[0] ?? ''
  const homeCategories = source.match(/<nav className="home-category-row"[\s\S]*?<\/nav>/)?.[0] ?? ''
  const editorTools = source.match(/<aside className="tools-panel"[\s\S]*?<\/aside>/)?.[0] ?? ''
  const mobileTools = source.match(/<nav className="mobile-tools"[\s\S]*?<\/nav>/)?.[0] ?? ''
  assert.ok(homeSidebar && homeCategories && editorTools && mobileTools, 'all audited Home/editor tool surfaces should exist')

  const surfaces = [homeSidebar, homeCategories, editorTools, mobileTools].join('\n')
  assert.deepEqual(findLegacyControlIcons(surfaces), [], 'the target surfaces have no legacy Unicode, icon-font, or inline SVG image controls')
  assert.doesNotMatch(surfaces, /<use\b[^>]*\b(?:href|xlink:href)=['"]#/i, 'controls should not pull symbols from a legacy SVG sprite')
  const css = `${appCss}\n${hubCss}`
  assert.doesNotMatch(css, /(?:home-sidebar|home-category|project-card-actions|tools-panel|editor-tools|shape-tools|mobile-tools)[^{}]*::(?:before|after)\s*\{[^}]*content\s*:/i, 'Home/editor tools should not synthesize pictogram icons with CSS pseudo-elements')
  const iconFontFaces = [...css.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*['"]?([^;'"}]+)[^}]*\}/gi)].map(match => match[1])
  assert.deepEqual(iconFontFaces.filter(family => /icon|awesome|material|glyph|icomoon/i.test(family)), [], 'Home/editor should not load icon-font families')

  const imported = new Set(source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1].split(',').map(name => name.trim().split(/\s+as\s+/).at(-1)) ?? [])
  for (const icon of ['House', 'FolderOpen', 'LayoutTemplate', 'Shapes', 'LogIn', 'Presentation', 'ImageIcon', 'FileText', 'Sheet', 'Film', 'Globe', 'Upload', 'MousePointer2', 'Type', 'Plus']) {
    assert.ok(imported.has(icon), `${icon} should resolve from the shared Lucide icon package`)
    assert.ok(surfaces.includes(`<${icon} `), `${icon} should appear on a Home or editor control`)
  }
  assert.match(source, /<div className="home-sidebar-brand"><span className="brand-mark">f<\/span><\/div>/, 'the product wordmark remains brand text rather than a tool icon')
})

test('toolbars do not mix text-glyph tools with Lucide tools on Home, Docs, Sheets, video, or Sites', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const checks = [
    ['Home creation categories', /<nav className="home-category-row"[\s\S]{0,2400}/, /<span className="home-category-icon [^"]+" aria-hidden="true"><[A-Z][A-Za-z0-9]* size=\{22\} \/><\/span>/],
    ['Docs inline formatting', /<div className="doc-inline-format"[\s\S]{0,1500}/, /<Bold size=\{15\} aria-hidden="true" \/>[\s\S]*<Italic size=\{15\} aria-hidden="true" \/>/],
    ['video transport', /<div className="video-transport"[\s\S]{0,1200}/, /<Pause size=\{16\} aria-hidden="true" \/>[\s\S]*<Play size=\{16\} aria-hidden="true" \/>/],
    ['Sites mobile navigation', /<button ref=\{mobileMenuToggleRef\}[\s\S]{0,700}/, /<X size=\{18\} aria-hidden="true" \/>[\s\S]*<Menu size=\{18\} aria-hidden="true" \/>/],
  ]

  for (const [surface, anchor, expected] of checks) {
    const match = source.match(anchor)
    assert.ok(match, `${surface}: toolbar source anchor must exist`)
    assert.match(match[0], expected, `${surface}: tool controls should use Lucide SVG icons`)
  }

  const sheetToolbar = source.match(/<div className="sheet-toolbar"[\s\S]{0,1800}/)?.[0]
  assert.ok(sheetToolbar, 'spreadsheet toolbar should exist')
  assert.match(sheetToolbar, /<Plus size=\{13\} aria-hidden="true" \/> Linha<\/button>/)
  assert.match(sheetToolbar, /<Plus size=\{13\} aria-hidden="true" \/> Coluna<\/button>/)
  assert.doesNotMatch(sheetToolbar, /<button[^>]*>\s*(?:\+|âœ“|[\p{Extended_Pictographic}])\s*<\/button>/u)
})

test('Docs and Sheets tool controls use accessible Lucide icons and preserve intentional formula notation', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const imported = new Set(source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1].split(',').map(name => name.trim().split(/\s+as\s+/).at(-1)) ?? [])
  const docsToolRail = source.match(/<nav className="doc-tool-rail"[\s\S]*?<\/nav>/)?.[0]
  const docsToolbar = source.match(/<div className="doc-toolbar"[\s\S]{0,5200}/)?.[0]
  const docsOutlineList = source.match(/<div className="doc-outline-list">[\s\S]{0,1200}/)?.[0]
  const docsSearchTools = source.match(/<div className="doc-search-tools"[\s\S]*?<\/div>/)?.[0]
  const sheetStart = source.indexOf('<div className="sheet-toolbar">')
  const sheetEnd = source.indexOf('<div className="sheet-grid-scroll">', sheetStart)
  const sheetToolbar = sheetStart >= 0 && sheetEnd > sheetStart ? source.slice(sheetStart, sheetEnd) : ''
  const sheetTabs = source.match(/<nav className="sheet-tabs"[\s\S]{0,1200}/)?.[0]
  assert.ok(docsToolRail, 'Docs tool rail should be present')
  assert.ok(docsToolbar, 'Docs formatting toolbar should be present')
  assert.ok(docsOutlineList, 'Docs outline list should be present')
  assert.ok(docsSearchTools, 'Docs search controls should be present')
  assert.ok(sheetToolbar, 'spreadsheet toolbar should be present')
  assert.ok(sheetTabs, 'spreadsheet tab controls should be present')

  for (const icon of ['AlignLeft', 'Upload', 'Heading', 'Type', 'List', 'Table2']) {
    assert.ok(imported.has(icon), `${icon} should come from lucide-react`)
    assert.ok(docsToolRail.includes(`<${icon} `), `Docs tool rail should render ${icon}`)
  }
  for (const icon of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'TableProperties']) {
    assert.ok(imported.has(icon), `${icon} should come from lucide-react`)
    assert.ok(docsToolbar.includes(`<${icon} `), `Docs toolbar should render ${icon}`)
  }
  for (const icon of ['Table2', 'ImageIcon', 'Heading1', 'Heading2', 'List', 'Pilcrow']) {
    assert.ok(imported.has(icon), `${icon} should come from lucide-react`)
    assert.ok(docsOutlineList.includes(`<${icon} `), `Docs outline should render ${icon}`)
  }
  assert.match(docsSearchTools, /<CaseSensitive size=\{12\} aria-hidden="true" \/>/, 'Docs case-sensitive search uses its Lucide tool icon')
  assert.ok(imported.has('CaseSensitive'), 'CaseSensitive should come from lucide-react')
  assert.match(docsSearchTools, /<span className="visually-hidden">Diferenciar[\s\S]{0,70}<\/span>/, 'the search icon retains an explicit accessible label')
  assert.equal((sheetToolbar.match(/<Plus size=\{13\} aria-hidden="true" \/>/g) ?? []).length, 2, 'row/column actions use decorative Lucide Plus icons with visible labels')
  assert.match(sheetToolbar, /<span className="sheet-fx">fx<\/span>/, 'fx remains a text formula indicator, not an icon glyph')
  assert.match(sheetTabs, /className="sheet-add-tab"[\s\S]{0,180}<Plus size=\{15\} aria-hidden="true" \/>/, 'adding a spreadsheet tab uses the shared Lucide Plus icon')
  assert.ok(imported.has('Plus'), 'Plus should come from lucide-react')
  assert.match(source, /<span className="sheet-error-indicator" aria-hidden="true"><CircleAlert size=\{12\} strokeWidth=\{2\.5\} aria-hidden="true" \/><\/span>/, 'formula errors use the same Lucide icon family as the other spreadsheet controls')
  assert.ok(imported.has('CircleAlert'), 'CircleAlert must come from lucide-react')
  assert.doesNotMatch(source, /<span className="sheet-error-indicator"[^>]*>!<\/span>/, 'spreadsheet formula errors must not use the legacy exclamation glyph')
  assert.deepEqual(findLegacyControlIcons(docsToolRail + docsToolbar + sheetToolbar), [], 'Docs and Sheets controls must not embed legacy glyph icons')
})

test('iconography scan ignores ordinary control labels and symbols used in content', () => {
  assert.deepEqual(findLegacyControlIcons('<button>Table 4 × 3</button><svg data-content="canvas" />'), [])
  // JSX source scanning cannot reliably distinguish a hand-drawn control SVG from
  // a canvas thumbnail nested in a button, so SVG nodes are intentionally not flagged.
  assert.deepEqual(findLegacyControlIcons('<button><svg><path d="M0 0" /></svg></button>'), [])
  assert.deepEqual(findLegacyControlIcons('<button><span>Published</span></button><a>Next → page</a>'), [])
})
