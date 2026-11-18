const CATEGORY_CODES = { tAGIFu61eNM: 'sheet' }
const DATE_CODES = { C: 'today' }

export function readProjectsFilters(search) {
  const ui = new URLSearchParams(search).get('ui')
  if (!ui) return { category: 'all', edited: 'any' }
  try {
    const value = JSON.parse(atob(ui.replace(/-/g, '+').replace(/_/g, '/')))
    return { category: CATEGORY_CODES[value.A?.B ?? ''] ?? 'all', edited: DATE_CODES[value.A?.A ?? ''] ?? 'any' }
  } catch { return { category: 'all', edited: 'any' } }
}

export function writeProjectsFilters(filters) {
  const A = {}
  if (filters.category === 'sheet') A.B = 'tAGIFu61eNM'
  if (filters.edited === 'today') A.A = 'C'
  if (!Object.keys(A).length) return null
  return btoa(JSON.stringify({ A })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function isEditedToday(updatedAt, now = new Date()) {
  const edited = new Date(updatedAt)
  return Number.isFinite(edited.getTime()) && edited.toDateString() === now.toDateString()
}
