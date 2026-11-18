export type DreamLabImage = { dataUrl: string; mimeType: string; width: number; height: number; mode: 'sandbox' | 'openai-compatible' }
export type DreamLabGenerator = (prompt: string) => Promise<DreamLabImage>
export function validateDreamLabImage(image: DreamLabImage): DreamLabImage
export function upscaleDimensions(width: number, height: number, factor?: number): { width: number; height: number; scale: number }
export function upscaleDreamLabImage(image: DreamLabImage): Promise<DreamLabImage>
export function downloadDreamLabImage(image: DreamLabImage, filename?: string): void
