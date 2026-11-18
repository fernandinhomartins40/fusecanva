export const BRAND_KITS = [
  { id: 'default', name: 'Meu kit de marca', resources: ['Logotipos', 'Cores', 'Fontes', 'Modelos', 'Fotos', 'Elementos gráficos'] },
  { id: 'rea-laboratory', name: 'REA — Laboratório Marca', resources: ['Logotipos', 'Cores', 'Fontes', 'Modelos', 'Fotos', 'Elementos gráficos'] },
]

export const AUDITED_BRAND_PALETTE = Object.freeze({
  primary: '#123456',
  mappings: Object.freeze({ '#75511c': '#123456', '#b29365': '#2d4a6f' }),
  scope: 'one-laboratory-application',
})

export const AUDITED_TITLE_STYLE = Object.freeze({
  role: 'Título da marca',
  text: 'Inserir um título',
  fontSize: 42.6667,
  fontFamily: 'Arial',
  color: '#000000',
  bold: true,
})

export function applyAuditedBrandPalette(elements, palette = AUDITED_BRAND_PALETTE) {
  const mappings = new Map(Object.entries(palette.mappings).map(([from, to]) => [from.toLowerCase(), to]))
  const recolor = color => typeof color === 'string' ? (mappings.get(color.toLowerCase()) ?? color) : color
  return elements.map(element => {
    if (element.type === 'text') return { ...element, color: recolor(element.color) }
    if (element.type === 'shape') return { ...element, fill: recolor(element.fill) }
    if (element.type === 'sticky-note') return { ...element, fill: recolor(element.fill), color: recolor(element.color) }
    if (element.type === 'free-draw') return { ...element, color: recolor(element.color) }
    return element
  })
}

export function createBrandTitleElement({ id, x, y }) {
  return { id, type: 'text', name: AUDITED_TITLE_STYLE.role, x, y, width: 420, height: 72, rotation: 0, text: AUDITED_TITLE_STYLE.text, fontSize: AUDITED_TITLE_STYLE.fontSize, fontFamily: AUDITED_TITLE_STYLE.fontFamily, color: AUDITED_TITLE_STYLE.color, bold: AUDITED_TITLE_STYLE.bold }
}

export function applyAuditedBrandTypography(elements, selectedIds, style = AUDITED_TITLE_STYLE) {
  const selected = new Set(selectedIds)
  return elements.map(element => element.type === 'text' && selected.has(element.id)
    ? { ...element, fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.color, bold: style.bold }
    : element)
}
