import type { DesignElement } from './model'

export type BrandKit = { id: string; name: string; resources: string[] }
export const BRAND_KITS: BrandKit[]
export const AUDITED_BRAND_PALETTE: { readonly primary: string; readonly mappings: Readonly<Record<string, string>>; readonly scope: string }
export const AUDITED_TITLE_STYLE: { readonly role: string; readonly text: string; readonly fontSize: number; readonly fontFamily: string; readonly color: string; readonly bold: boolean }
export function applyAuditedBrandPalette(elements: DesignElement[]): DesignElement[]
export function applyAuditedBrandTypography(elements: DesignElement[], selectedIds: string[]): DesignElement[]
export function createBrandTitleElement(position: { id: string; x: number; y: number }): Extract<DesignElement, { type: 'text' }>
