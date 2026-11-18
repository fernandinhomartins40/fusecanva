// Conversão entre coordenadas base 0 (linha, coluna) e referências A1.

const MAX_COLUMN_LETTERS = 4

/** Coluna base 0 -> letras ("A", "Z", "AA"...). */
export function columnToLetters(column: number): string {
  if (!Number.isInteger(column) || column < 0) throw new RangeError(`Coluna inválida: ${column}`)
  let value = column + 1
  let letters = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }
  if (letters.length > MAX_COLUMN_LETTERS) throw new RangeError(`Coluna fora do limite: ${column}`)
  return letters
}

/** Letras -> coluna base 0. */
export function lettersToColumn(letters: string): number {
  if (!/^[A-Z]{1,4}$/.test(letters)) throw new RangeError(`Letras de coluna inválidas: ${letters}`)
  let value = 0
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64)
  return value - 1
}

/** (linha, coluna) base 0 -> "A1". */
export function toCellRef(row: number, column: number): string {
  if (!Number.isInteger(row) || row < 0 || row > 9_999_998) throw new RangeError(`Linha inválida: ${row}`)
  return `${columnToLetters(column)}${row + 1}`
}

/** "A1" -> (linha, coluna) base 0. */
export function parseCellRef(ref: string): { row: number; column: number } {
  const match = /^([A-Z]{1,4})([1-9][0-9]{0,6})$/.exec(ref)
  if (!match) throw new RangeError(`Referência A1 inválida: ${ref}`)
  return { row: Number(match[2]) - 1, column: lettersToColumn(match[1] as string) }
}

export type CellRange = { startRow: number; startColumn: number; endRow: number; endColumn: number }

export function toRangeRef(range: CellRange): string {
  return `${toCellRef(range.startRow, range.startColumn)}:${toCellRef(range.endRow, range.endColumn)}`
}

export function parseRangeRef(ref: string): CellRange {
  const [start, end, ...rest] = ref.split(':')
  if (start === undefined || end === undefined || rest.length) throw new RangeError(`Faixa A1 inválida: ${ref}`)
  const a = parseCellRef(start)
  const b = parseCellRef(end)
  return { startRow: a.row, startColumn: a.column, endRow: b.row, endColumn: b.column }
}

/** Chave legada "linha:coluna" -> coordenadas, ou null se inválida. */
export function parseRowColumnKey(key: string): { row: number; column: number } | null {
  const match = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(key)
  if (!match) return null
  const row = Number(match[1])
  const column = Number(match[2])
  if (row > 9_999_998) return null
  try { columnToLetters(column) } catch { return null }
  return { row, column }
}
