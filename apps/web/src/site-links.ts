const SITE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export function normalizeSiteHref(value: string | undefined): string | null {
  if (!value) return null
  const href = value.trim()
  if (!href || href.length > 2048 || hasControlCharacters(href)) return null
  if (/^#[A-Za-z0-9_-]{1,200}$/.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (href.startsWith('./') || href.startsWith('../')) return href
  try {
    const url = new URL(href)
    return SITE_LINK_PROTOCOLS.has(url.protocol) ? href : null
  } catch {
    return null
  }
}

function siteSectionBase(pageId: string): string {
  return `site-section-${pageId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function stableIdSuffix(pageId: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < pageId.length; index += 1) {
    hash ^= BigInt(pageId.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(36)
}

export function siteSectionAnchor(pageId: string): string {
  return siteSectionBase(pageId)
}

export function siteSectionAnchors(pageIds: string[]): Record<string, string> {
  const idsByBase = new Map<string, string[]>()
  for (const pageId of pageIds) {
    const base = siteSectionBase(pageId)
    idsByBase.set(base, [...(idsByBase.get(base) ?? []), pageId])
  }
  const anchors: Record<string, string> = {}
  for (const [base, ids] of idsByBase) {
    const orderedIds = [...new Set(ids)].sort()
    orderedIds.forEach((pageId, index) => {
      anchors[pageId] = index === 0 ? base : `${base}-${stableIdSuffix(pageId)}`
    })
  }
  return anchors
}
