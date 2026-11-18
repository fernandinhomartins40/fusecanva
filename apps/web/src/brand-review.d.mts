import type { DesignElement } from './model'

export type BrandReviewIssue = {
  key: string
  elementId: string
  kind: 'font' | 'color'
  field?: 'color' | 'fill'
  label: string
  before: string
  after: string
}

export function reviewBrandElements(elements: DesignElement[]): BrandReviewIssue[]
export function applyBrandReviewFixes(elements: DesignElement[], issueKeys: string[]): DesignElement[]
