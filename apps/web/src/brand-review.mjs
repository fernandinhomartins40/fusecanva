import { AUDITED_BRAND_PALETTE, AUDITED_TITLE_STYLE } from './brand-kit.mjs'

const colorTargets = new Map(Object.entries(AUDITED_BRAND_PALETTE.mappings).map(([source, target]) => [source.toLowerCase(), target]))

export function reviewBrandElements(elements) {
  const issues = []
  for (const element of elements) {
    if (element.type === 'text' && typeof element.fontFamily === 'string' && element.fontFamily !== AUDITED_TITLE_STYLE.fontFamily) {
      issues.push({
        key: `font:${element.id}`,
        elementId: element.id,
        kind: 'font',
        label: 'Fonte diferente do estilo configurado',
        before: element.fontFamily,
        after: AUDITED_TITLE_STYLE.fontFamily,
      })
    }
    const fields = element.type === 'text'
      ? ['color']
      : element.type === 'shape' || element.type === 'sticky-note'
        ? element.type === 'sticky-note' ? ['fill', 'color'] : ['fill']
        : element.type === 'free-draw'
          ? ['color']
          : []
    for (const field of fields) {
      const before = element[field]
      const after = typeof before === 'string' ? colorTargets.get(before.toLowerCase()) : undefined
      if (after && before.toLowerCase() !== after.toLowerCase()) {
        issues.push({
          key: `color:${element.id}:${field}`,
          elementId: element.id,
          field,
          kind: 'color',
          label: 'Cor fora do mapeamento de marca',
          before,
          after,
        })
      }
    }
  }
  return issues
}

export function applyBrandReviewFixes(elements, issueKeys) {
  const selected = new Set(issueKeys)
  if (!selected.size) return elements
  const activeIssues = reviewBrandElements(elements).filter(issue => selected.has(issue.key))
  if (!activeIssues.length) return elements
  const fixes = new Map(activeIssues.map(issue => [issue.key, issue]))
  let changed = false
  const next = elements.map(element => {
    let updated = element
    for (const issue of activeIssues) {
      if (issue.elementId !== element.id) continue
      if (issue.kind === 'font' && element.type === 'text' && fixes.has(issue.key)) {
        updated = { ...updated, fontFamily: issue.after }
      } else if (issue.kind === 'color' && issue.field && fixes.has(issue.key)) {
        updated = { ...updated, [issue.field]: issue.after }
      }
    }
    if (updated !== element) changed = true
    return updated
  })
  return changed ? next : elements
}
