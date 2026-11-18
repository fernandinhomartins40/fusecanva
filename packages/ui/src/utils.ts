/** Junta nomes de classe ignorando valores falsos. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export type Size = 'sm' | 'md' | 'lg'
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
