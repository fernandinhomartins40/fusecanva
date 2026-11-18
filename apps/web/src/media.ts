export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 32_000_000
export const MAX_TIMELINE_MEDIA_BYTES = 10 * 1024 * 1024

const TIMELINE_MEDIA_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/flac', 'audio/aac'])

export function validateTimelineMediaUpload(file: Pick<Blob, 'size' | 'type'>): void {
  if (!TIMELINE_MEDIA_TYPES.has(file.type.toLowerCase())) throw new Error('Use vídeo MP4/WebM/QuickTime ou áudio MP3/MP4/OGG/WAV/WebM/FLAC/AAC.')
  if (file.size === 0) throw new Error('Este arquivo de mídia está vazio.')
  if (file.size > MAX_TIMELINE_MEDIA_BYTES) throw new Error('Vídeos e áudios devem ter até 10 MB nesta versão.')
}

export function validateImageUpload(file: Pick<Blob, 'size' | 'type'>): void {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem válido.')
  if (file.size === 0) throw new Error('Este arquivo de imagem está vazio.')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('A imagem deve ter até 10 MB para caber no armazenamento local.')
}

export function validateImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Não foi possível ler as dimensões desta imagem.')
  }
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('A imagem excede o limite de 32 megapixels suportado pelo editor.')
}

export async function fingerprintImageUpload(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador não permite verificar arquivos duplicados em uma conexão segura.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
