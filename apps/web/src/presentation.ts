import type { DesignDocument, DesignPage } from './model'

export function clampPresentationPage(index: number, pageCount: number): number {
  if (!Number.isFinite(index) || pageCount <= 0) return 0
  return Math.max(0, Math.min(Math.trunc(index), pageCount - 1))
}

export function getPresenterView(document: DesignDocument, pageIndex: number): { page: DesignPage | null; nextPage: DesignPage | null; pageIndex: number } {
  const index = clampPresentationPage(pageIndex, document.pages.length)
  return { page: document.pages[index] ?? null, nextPage: document.pages[index + 1] ?? null, pageIndex: index }
}
