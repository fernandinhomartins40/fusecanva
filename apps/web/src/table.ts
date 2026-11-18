export type TableCells = string[][]
export type TableCellMerge = { row: number; column: number; colSpan: number; rowSpan?: number }
export type TableSelection = { anchorRow: number; anchorColumn: number; focusRow: number; focusColumn: number }

export function shouldAppendTableRow(key: string, shiftKey: boolean, modifierKey: boolean, rowIndex: number, columnIndex: number, cells: TableCells): boolean {
  if (key === 'Enter' && modifierKey) return true
  const lastRow = cells.length - 1
  const lastColumn = (cells[lastRow]?.length ?? 0) - 1
  return key === 'Tab' && !shiftKey && rowIndex === lastRow && columnIndex === lastColumn
}

function columnCount(cells: TableCells): number {
  return Math.max(1, ...cells.map(row => row.length))
}

function rectangular(cells: TableCells): TableCells {
  const columns = columnCount(cells)
  return (cells.length ? cells : [[]]).map(row => Array.from({ length: columns }, (_, index) => row[index] ?? ''))
}

export function setTableCell(cells: TableCells, rowIndex: number, columnIndex: number, value: string): TableCells {
  const next = rectangular(cells)
  if (rowIndex < 0 || rowIndex >= next.length || columnIndex < 0 || columnIndex >= next[rowIndex].length) return cells
  next[rowIndex][columnIndex] = value
  return next
}

export function appendTableRow(cells: TableCells): TableCells {
  const rows = rectangular(cells)
  return [...rows, Array.from({ length: rows[0].length }, () => '')]
}

export function appendTableColumn(cells: TableCells): TableCells {
  return rectangular(cells).map(row => [...row, ''])
}

export function removeTableRow(cells: TableCells, rowIndex: number): TableCells {
  const rows = rectangular(cells)
  if (rows.length <= 1 || rowIndex < 0 || rowIndex >= rows.length) return rows
  return rows.filter((_, index) => index !== rowIndex)
}

/** Move a row to an absolute index while keeping all cell values together. */
export function moveTableRow(cells: TableCells, fromIndex: number, toIndex: number): TableCells {
  const rows = rectangular(cells)
  if (fromIndex < 0 || fromIndex >= rows.length || toIndex < 0 || toIndex >= rows.length || fromIndex === toIndex) return rows
  const [row] = rows.splice(fromIndex, 1)
  rows.splice(toIndex, 0, row)
  return rows
}

export function moveTableRowIndex(row: number, fromIndex: number, toIndex: number): number {
  if (row === fromIndex) return toIndex
  if (fromIndex < toIndex && row > fromIndex && row <= toIndex) return row - 1
  if (fromIndex > toIndex && row >= toIndex && row < fromIndex) return row + 1
  return row
}

export function moveTableMerges(merges: TableCellMerge[], fromIndex: number, toIndex: number): TableCellMerge[] {
  return merges.map(merge => ({ ...merge, row: moveTableRowIndex(merge.row, fromIndex, toIndex) }))
    .sort((left, right) => left.row - right.row || left.column - right.column)
}

export function moveTableCellBorders<T>(borders: Record<string, T> | undefined, fromIndex: number, toIndex: number): Record<string, T> | undefined {
  if (!borders) return borders
  return Object.fromEntries(Object.entries(borders).map(([coordinate, value]) => {
    const [row, column] = coordinate.split(':').map(Number)
    return [`${moveTableRowIndex(row, fromIndex, toIndex)}:${column}`, value]
  }))
}

export function moveTableCellImages<T>(images: Record<string, T[]> | undefined, fromIndex: number, toIndex: number): Record<string, T[]> | undefined {
  if (!images) return images
  return Object.fromEntries(Object.entries(images).map(([coordinate, value]) => {
    const [row, column] = coordinate.split(':').map(Number)
    return [`${moveTableRowIndex(row, fromIndex, toIndex)}:${column}`, value]
  }))
}

export function removeTableColumn(cells: TableCells, columnIndex: number): TableCells {
  const rows = rectangular(cells)
  if (rows[0].length <= 1 || columnIndex < 0 || columnIndex >= rows[0].length) return rows
  return rows.map(row => row.filter((_, index) => index !== columnIndex))
}

export function shiftTableMergesAfterRowRemoval(merges: TableCellMerge[], rowIndex: number): TableCellMerge[] {
  return merges.flatMap(merge => merge.row === rowIndex ? [] : [merge.row > rowIndex ? { ...merge, row: merge.row - 1 } : merge])
}

export function shiftTableMergesAfterColumnRemoval(merges: TableCellMerge[], columnIndex: number): TableCellMerge[] {
  return merges.flatMap(merge => {
    const lastColumn = merge.column + merge.colSpan - 1
    if (columnIndex < merge.column) return [{ ...merge, column: merge.column - 1 }]
    if (columnIndex > lastColumn) return [merge]
    return merge.colSpan > 2 ? [{ ...merge, colSpan: merge.colSpan - 1 }] : []
  })
}

export function shiftTableCellBordersAfterRowRemoval<T>(borders: Record<string, T> | undefined, rowIndex: number): Record<string, T> | undefined {
  if (!borders) return borders
  return Object.fromEntries(Object.entries(borders).flatMap(([coordinate, value]) => {
    const [row, column] = coordinate.split(':').map(Number)
    if (row === rowIndex) return []
    return [[`${row > rowIndex ? row - 1 : row}:${column}`, value]]
  }))
}

export function shiftTableCellImagesAfterRowRemoval<T>(images: Record<string, T[]> | undefined, rowIndex: number): Record<string, T[]> | undefined {
  if (!images) return images
  return Object.fromEntries(Object.entries(images).flatMap(([coordinate, value]) => {
    const [row, column] = coordinate.split(':').map(Number)
    if (row === rowIndex) return []
    return [[`${row > rowIndex ? row - 1 : row}:${column}`, value]]
  }))
}

export function shiftTableCellBordersAfterColumnRemoval<T>(borders: Record<string, T> | undefined, columnIndex: number): Record<string, T> | undefined {
  if (!borders) return borders
  return Object.fromEntries(Object.entries(borders).flatMap(([coordinate, value]) => {
    const [row, column] = coordinate.split(':').map(Number)
    if (column === columnIndex) return []
    return [[`${row}:${column > columnIndex ? column - 1 : column}`, value]]
  }))
}

export function shiftTableCellImagesAfterColumnRemoval<T>(images: Record<string, T[]> | undefined, columnIndex: number): Record<string, T[]> | undefined {
  if (!images) return images
  return Object.fromEntries(Object.entries(images).flatMap(([coordinate, value]) => {
    const [row, column] = coordinate.split(':').map(Number)
    if (column === columnIndex) return []
    return [[`${row}:${column > columnIndex ? column - 1 : column}`, value]]
  }))
}

export function mergeTableSelection(cells: TableCells, merges: TableCellMerge[], selection: TableSelection): { cells: TableCells; merges: TableCellMerge[] } | null {
  const rows = rectangular(cells)
  const row = selection.anchorRow
  if (row !== selection.focusRow || row < 0 || row >= rows.length) return null
  const start = Math.min(selection.anchorColumn, selection.focusColumn)
  const end = Math.max(selection.anchorColumn, selection.focusColumn)
  if (start < 0 || end >= rows[row].length || end === start) return null
  if (merges.some(merge => merge.row === row && merge.column <= end && merge.column + merge.colSpan - 1 >= start)) return null
  const nextCells = rows.map(cellsRow => [...cellsRow])
  nextCells[row][start] = rows[row].slice(start, end + 1).join('\n')
  for (let column = start + 1; column <= end; column += 1) nextCells[row][column] = ''
  return { cells: nextCells, merges: [...merges, { row, column: start, colSpan: end - start + 1 }] }
}

export function unmergeTableCell(merges: TableCellMerge[], row: number, column: number): TableCellMerge[] {
  return merges.filter(merge => !(merge.row === row && column >= merge.column && column < merge.column + merge.colSpan))
}

export function isCellMerged(merges: TableCellMerge[], row: number, column: number): boolean {
  return merges.some(merge => row >= merge.row && row < merge.row + (merge.rowSpan ?? 1) && column >= merge.column && column < merge.column + merge.colSpan)
}

export function extendTableSelection(selection: TableSelection | null, row: number, column: number, key: string, rowCount: number, columnCount: number): TableSelection | null {
  const anchorRow = selection?.anchorRow ?? row
  const anchorColumn = selection?.anchorColumn ?? column
  if (rowCount < 1 || columnCount < 1 || anchorRow < 0 || anchorRow >= rowCount) return null
  const focusColumn = Math.max(0, Math.min(columnCount - 1, (selection?.focusColumn ?? column) + (key === 'ArrowRight' ? 1 : -1)))
  return { anchorRow, anchorColumn, focusRow: anchorRow, focusColumn }
}
