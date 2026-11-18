export type InlineTextMark = { start: number; end: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }
export function mergeTextAndMarks(
  baseText: string,
  baseMarks: InlineTextMark[] | undefined,
  localText: string,
  localMarks: InlineTextMark[] | undefined,
  remoteText: string,
  remoteMarks: InlineTextMark[] | undefined,
): { text: string; marks: InlineTextMark[] } | null
