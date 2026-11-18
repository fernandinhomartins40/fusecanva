export type AiBrandContext = {
  kitId: string
  kitName: string
  hasResources: boolean
  summary: string
  promptContext: string
}

export type AiComposerAttachment = { id: string; kind: 'file' | 'design'; name: string; context: string; mimeType?: string; size?: number; designId?: string }

export function getAiBrandContext(brandKitId: string): AiBrandContext | null
export function buildAiRequestPrompt(prompt: string, brandContext?: AiBrandContext | null, attachments?: AiComposerAttachment[]): string
export function buildAiAttachmentContext(attachments?: AiComposerAttachment[]): string
export function summarizeAiDesign(document: unknown): string
export function getAiPromptLimit(brandContext?: AiBrandContext | null, attachments?: AiComposerAttachment[]): number
