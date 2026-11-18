import type { DesignDocument, DesignPage } from './model'
export function parseBulkDelimited(text: string): string[][]
export function generateBulkPages(page: DesignPage, records: string[][], bindings: Record<string, number>, makeId: (kind: string) => string): DesignPage[]
export function generateBulkDocuments(sourceDocument: DesignDocument, pages: DesignPage[], makeId: (kind: string) => string, createdAt?: string): DesignDocument[]
