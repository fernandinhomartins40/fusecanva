export const MAX_CSV_IMPORT_BYTES = 5 * 1024 * 1024

const MAX_CSV_ROWS = 10_000
const MAX_CSV_COLUMNS = 256
const MAX_CSV_CELLS = 500_000

export function serializeCsv(cells: string[][], delimiter = ','): string {
  if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') throw new Error('Delimitador CSV inválido.')
  let lastRow = cells.length - 1
  while (lastRow >= 0 && (cells[lastRow] ?? []).every(value => value === '')) lastRow -= 1
  if (lastRow < 0) return ''

  let lastColumn = 0
  for (let row = 0; row <= lastRow; row += 1) {
    const values = cells[row] ?? []
    for (let column = values.length - 1; column >= 0; column -= 1) {
      if (values[column] !== '') { lastColumn = Math.max(lastColumn, column); break }
    }
  }
  const quote = (value: string) => /["\r\n]/.test(value) || value.includes(delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value
  return cells.slice(0, lastRow + 1).map(row => Array.from({ length: lastColumn + 1 }, (_, column) => quote(row?.[column] ?? '')).join(delimiter)).join('\r\n')
}

function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t']
  const counts = new Map(candidates.map(delimiter => [delimiter, 0]))
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && (character === '\r' || character === '\n')) break
    else if (!quoted && counts.has(character)) counts.set(character, counts.get(character)! + 1)
  }
  return candidates.reduce((best, delimiter) => counts.get(delimiter)! > counts.get(best)! ? delimiter : best, ',')
}

export function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, '')
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_IMPORT_BYTES) throw new Error('O arquivo CSV deve ter no máximo 5 MB.')
  if (!text.length) throw new Error('O arquivo CSV está vazio.')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false
  let endedWithRowBreak = false
  let cells = 0

  const pushField = () => {
    row.push(field)
    field = ''
    afterQuote = false
    cells += 1
    if (row.length > MAX_CSV_COLUMNS) throw new Error(`O CSV aceita até ${MAX_CSV_COLUMNS} colunas por linha.`)
    if (cells > MAX_CSV_CELLS) throw new Error('O CSV excede o limite de 500 mil células.')
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
    if (rows.length > MAX_CSV_ROWS) throw new Error(`O CSV aceita até ${MAX_CSV_ROWS} linhas.`)
    endedWithRowBreak = true
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') { quoted = false; afterQuote = true }
      else if (character === '\r') { field += '\n'; if (text[index + 1] === '\n') index += 1 }
      else field += character
      endedWithRowBreak = false
      continue
    }

    if (afterQuote && character !== delimiter && character !== '\r' && character !== '\n') throw new Error('O CSV contém caracteres inesperados depois de uma aspa fechada.')
    if (character === '"') {
      if (field.length > 0 || afterQuote) throw new Error('O CSV contém uma aspa em uma posição inválida.')
      quoted = true
      endedWithRowBreak = false
    } else if (character === delimiter) {
      pushField()
      endedWithRowBreak = false
    } else if (character === '\r' || character === '\n') {
      pushRow()
      if (character === '\r' && text[index + 1] === '\n') index += 1
    } else {
      field += character
      endedWithRowBreak = false
    }
  }

  if (quoted) throw new Error('O CSV termina antes do fechamento de uma aspa.')
  if (!endedWithRowBreak || row.length > 0 || field.length > 0 || afterQuote) pushRow()
  return rows
}
