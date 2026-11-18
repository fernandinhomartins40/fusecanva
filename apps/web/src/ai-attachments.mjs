export const AI_UPLOAD_MAX_BYTES = 512 * 1024
const AI_UPLOAD_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const AI_UPLOAD_EXTENSIONS = /\.(txt|md|csv|json)$/i

export function validateAiAttachmentFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size)) return 'Escolha um arquivo válido.'
  if (file.size > AI_UPLOAD_MAX_BYTES) return 'Escolha um arquivo de texto com até 512 KB.'
  if (!AI_UPLOAD_TYPES.has(file.type) && !AI_UPLOAD_EXTENSIONS.test(file.name)) return 'Use um arquivo TXT, Markdown, CSV ou JSON.'
  return ''
}

export function createAiFileAttachment({ id, name, mimeType, size, content }) {
  return {
    id: String(id), kind: 'file', name: String(name).slice(0, 160),
    mimeType: String(mimeType || 'text/plain'), size: Number(size) || 0,
    context: String(content ?? '').slice(0, 8000),
  }
}
