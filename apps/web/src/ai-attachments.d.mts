export const AI_UPLOAD_MAX_BYTES: number
export function validateAiAttachmentFile(file: { name: string; size: number; type: string }): string
export function createAiFileAttachment(input: { id: string; name: string; mimeType?: string; size: number; content: string }): {
  id: string; kind: 'file'; name: string; mimeType: string; size: number; context: string
}
