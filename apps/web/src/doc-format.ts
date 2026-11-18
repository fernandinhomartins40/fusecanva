import type { DocImage, DocInlineMark } from './model'

export type DocTextRun = { text: string; start: number; end: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean }
export type DocMarkKind = 'bold' | 'italic' | 'underline' | 'strike'

export const MAX_DOC_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_DOC_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024
export const MAX_DOC_IMAGE_DIMENSION = 12_000
export const MAX_DOC_IMAGE_PIXELS = 24_000_000
const DOC_IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/

/** Validate the bounded raster image contract shared by Docs import/export. */
export function isSafeDocImage(value: unknown): value is DocImage {
  if (!value || typeof value !== 'object') return false
  const image = value as Partial<DocImage>
  if (typeof image.src !== 'string' || typeof image.alt !== 'string' || image.alt.length > 2_000) return false
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width! <= 0 || image.height! <= 0) return false
  if (image.width! > MAX_DOC_IMAGE_DIMENSION || image.height! > MAX_DOC_IMAGE_DIMENSION || image.width! * image.height! > MAX_DOC_IMAGE_PIXELS) return false
  const match = image.src.match(DOC_IMAGE_DATA_URL)
  if (!match) return false
  const encoded = match[2]
  if (encoded.length % 4 !== 0) return false
  const byteLength = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
  return byteLength > 0 && byteLength <= MAX_DOC_IMAGE_BYTES
}

export function assertSafeDocImage(value: unknown): asserts value is DocImage {
  if (!isSafeDocImage(value)) throw new Error('O documento contém uma imagem inválida ou acima dos limites suportados.')
}

export function decodeDocImageDataUrl(image: DocImage): { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } {
  assertSafeDocImage(image)
  const match = image.src.match(DOC_IMAGE_DATA_URL)!
  const binary = atob(match[2])
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return { mime: match[1] === 'png' ? 'image/png' : 'image/jpeg', bytes }
}

export function getDocTextRuns(text: string, marks: DocInlineMark[] = []): DocTextRun[] {
  const boundaries = [...new Set([0, text.length, ...marks.flatMap(mark => [Math.max(0, Math.min(text.length, mark.start)), Math.max(0, Math.min(text.length, mark.end))])])].sort((a, b) => a - b)
  const runs: DocTextRun[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const active = marks.filter(mark => mark.start <= start && mark.end >= end)
    const bold = active.some(mark => mark.bold)
    const italic = active.some(mark => mark.italic)
    const underline = active.some(mark => mark.underline)
    const strike = active.some(mark => mark.strike)
    const previous = runs.at(-1)
    if (previous && previous.end === start && previous.bold === bold && previous.italic === italic && previous.underline === underline && previous.strike === strike) {
      previous.text += text.slice(start, end)
      previous.end = end
    } else runs.push({ text: text.slice(start, end), start, end, bold, italic, underline, strike })
  }
  return runs
}

export function toggleDocInlineMark(marks: DocInlineMark[] = [], start: number, end: number, kind: DocMarkKind): DocInlineMark[] {
  const from = Math.max(0, Math.min(start, end))
  const to = Math.max(0, Math.max(start, end))
  if (to <= from) return marks
  const boundaries = [...new Set([from, to, ...marks.flatMap(mark => [mark.start, mark.end])])].sort((a, b) => a - b)
  const selectedSegments = boundaries.slice(0, -1).map((segmentStart, index) => ({ start: segmentStart, end: boundaries[index + 1] })).filter(segment => segment.start >= from && segment.end <= to && segment.end > segment.start)
  const shouldApply = !selectedSegments.every(segment => marks.some(mark => mark[kind] && mark.start <= segment.start && mark.end >= segment.end))
  const next: DocInlineMark[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const segmentStart = boundaries[index]
    const segmentEnd = boundaries[index + 1]
    const existing = marks.filter(mark => mark.start <= segmentStart && mark.end >= segmentEnd)
    const inSelection = segmentStart >= from && segmentEnd <= to
    const active = (markKind: DocMarkKind) => markKind === kind && inSelection ? shouldApply : existing.some(mark => mark[markKind])
    const bold = active('bold')
    const italic = active('italic')
    const underline = active('underline')
    const strike = active('strike')
    if (!bold && !italic && !underline && !strike) continue
    const previous = next.at(-1)
    if (previous && previous.end === segmentStart && Boolean(previous.bold) === bold && Boolean(previous.italic) === italic && Boolean(previous.underline) === underline && Boolean(previous.strike) === strike) previous.end = segmentEnd
    else next.push({ start: segmentStart, end: segmentEnd, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}), ...(strike ? { strike: true } : {}) })
  }
  return next
}

export function remapDocInlineMarks(oldText: string, newText: string, marks: DocInlineMark[] = []): DocInlineMark[] {
  if (oldText === newText || marks.length === 0) return marks
  let prefix = 0
  while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix += 1
  let oldEnd = oldText.length
  let newEnd = newText.length
  while (oldEnd > prefix && newEnd > prefix && oldText[oldEnd - 1] === newText[newEnd - 1]) { oldEnd -= 1; newEnd -= 1 }
  const delta = newEnd - oldEnd
  const next: DocInlineMark[] = []
  for (const mark of marks) {
    const beforeEnd = Math.min(mark.end, prefix)
    if (mark.start < beforeEnd) next.push({ ...mark, end: beforeEnd })
    const afterStart = Math.max(mark.start, oldEnd)
    if (afterStart < mark.end) next.push({ ...mark, start: afterStart + delta, end: mark.end + delta })
  }
  if (newEnd > prefix) {
    const inherited = marks.filter(mark => (mark.start < prefix && mark.end >= prefix) || (mark.start <= prefix && mark.end >= oldEnd))
    const bold = inherited.some(mark => mark.bold)
    const italic = inherited.some(mark => mark.italic)
    const underline = inherited.some(mark => mark.underline)
    const strike = inherited.some(mark => mark.strike)
    if (bold || italic || underline || strike) next.push({ start: prefix, end: newEnd, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}), ...(strike ? { strike: true } : {}) })
  }
  next.sort((a, b) => a.start - b.start || a.end - b.end)
  const normalized: DocInlineMark[] = []
  for (const mark of next) {
    const previous = normalized.at(-1)
    if (previous && previous.end === mark.start && Boolean(previous.bold) === Boolean(mark.bold) && Boolean(previous.italic) === Boolean(mark.italic) && Boolean(previous.underline) === Boolean(mark.underline) && Boolean(previous.strike) === Boolean(mark.strike)) previous.end = mark.end
    else normalized.push(mark)
  }
  return normalized
}

export function replaceDocText(text: string, marks: DocInlineMark[] = [], query: string, replacement: string, caseSensitive = false): { text: string; marks: DocInlineMark[]; count: number } {
  if (!query) return { text, marks, count: 0 }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(escaped, caseSensitive ? 'gu' : 'giu')
  const nextMarks: DocInlineMark[] = []
  let result = ''
  let sourceCursor = 0
  let count = 0
  const appendOriginal = (start: number, end: number) => {
    const resultStart = result.length
    result += text.slice(start, end)
    for (const mark of marks) {
      const clippedStart = Math.max(start, mark.start)
      const clippedEnd = Math.min(end, mark.end)
      if (clippedEnd > clippedStart) nextMarks.push({ ...mark, start: resultStart + clippedStart - start, end: resultStart + clippedEnd - start })
    }
  }
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? sourceCursor
    appendOriginal(sourceCursor, start)
    const resultStart = result.length
    result += replacement
    // Replacement text follows the formatting at the first matched character.
    // appendOriginal clips all text outside the match independently, so marks
    // on an unaffected suffix keep their style even when the match crosses it.
    const inherited = marks.filter(mark => mark.start <= start && mark.end > start)
    const bold = inherited.some(mark => mark.bold)
    const italic = inherited.some(mark => mark.italic)
    const underline = inherited.some(mark => mark.underline)
    const strike = inherited.some(mark => mark.strike)
    if (result.length > resultStart && (bold || italic || underline || strike)) nextMarks.push({ start: resultStart, end: result.length, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}), ...(strike ? { strike: true } : {}) })
    sourceCursor = start + match[0].length
    count += 1
  }
  appendOriginal(sourceCursor, text.length)
  nextMarks.sort((a, b) => a.start - b.start || a.end - b.end)
  const normalized: DocInlineMark[] = []
  for (const mark of nextMarks) {
    const previous = normalized.at(-1)
    if (previous && previous.end === mark.start && Boolean(previous.bold) === Boolean(mark.bold) && Boolean(previous.italic) === Boolean(mark.italic) && Boolean(previous.underline) === Boolean(mark.underline) && Boolean(previous.strike) === Boolean(mark.strike)) previous.end = mark.end
    else normalized.push(mark)
  }
  return { text: result, marks: normalized, count }
}
