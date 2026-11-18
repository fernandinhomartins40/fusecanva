export type PrintFormatId = 'vertical-standard' | 'horizontal-standard' | 'vertical-slim' | 'horizontal-slim'
export type PrintPaperId = 'standard' | 'premium'
export type PrintFinishId = 'matte' | 'gloss'
export type PrintDraft = { format: PrintFormatId; paper: PrintPaperId; finish: PrintFinishId; quantity: number }
export const PRINT_FORMATS: ReadonlyArray<{ id: PrintFormatId; label: string; size: string }>
export const PRINT_PAPERS: ReadonlyArray<{ id: PrintPaperId; label: string; weight: string; description: string }>
export const PRINT_FINISHES: ReadonlyArray<{ id: PrintFinishId; label: string; description: string }>
export const PRINT_QUANTITIES: ReadonlyArray<number>
export const DEFAULT_PRINT_DRAFT: Readonly<PrintDraft>
export function estimatePrintPrice(draft: PrintDraft): number
export function formatSandboxPrice(value: number): string
export function normalizePrintDraft(value: unknown): PrintDraft
export function readPrintDraft(storage: Pick<Storage, 'getItem'>, key: string): PrintDraft | null
export function writePrintDraft(storage: Pick<Storage, 'setItem'>, key: string, draft: PrintDraft): void
export function resetPrintDraft(storage: Pick<Storage, 'removeItem'>, key: string): PrintDraft
export function createPrintSpecification(documentId: string, draft: PrintDraft, createdAt?: string): Record<string, unknown>
export function serializePrintSpecification(documentId: string, draft: PrintDraft, createdAt?: string): string
