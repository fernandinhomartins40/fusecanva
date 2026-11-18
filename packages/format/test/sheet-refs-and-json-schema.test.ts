import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildJsonSchema, columnToLetters, JSON_SCHEMA_ID, lettersToColumn, parseCellRef, parseRangeRef, parseRowColumnKey, toCellRef, toRangeRef,
} from '../src/index.js'

describe('referências A1', () => {
  it.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [701, 'ZZ'], [702, 'AAA']])('coluna %i <-> %s', (column, letters) => {
    expect(columnToLetters(column)).toBe(letters)
    expect(lettersToColumn(letters)).toBe(column)
  })

  it('células e faixas', () => {
    expect(toCellRef(0, 0)).toBe('A1')
    expect(parseCellRef('AB12')).toEqual({ row: 11, column: 27 })
    const range = { startRow: 0, startColumn: 1, endRow: 9, endColumn: 2 }
    expect(parseRangeRef(toRangeRef(range))).toEqual(range)
  })

  it('erros', () => {
    expect(() => columnToLetters(-1)).toThrow(RangeError)
    expect(() => columnToLetters(26 ** 4 * 2)).toThrow(/fora do limite/)
    expect(() => lettersToColumn('a')).toThrow(RangeError)
    expect(() => toCellRef(-1, 0)).toThrow(RangeError)
    expect(() => parseCellRef('A0')).toThrow(RangeError)
    expect(() => parseRangeRef('A1')).toThrow(RangeError)
    expect(() => parseRangeRef('A1:B2:C3')).toThrow(RangeError)
  })

  it('chaves legadas "linha:coluna"', () => {
    expect(parseRowColumnKey('3:4')).toEqual({ row: 3, column: 4 })
    for (const key of ['bogus', '01:1', '-1:2', '1:', '99999999:0', `0:${26 ** 4 * 2}`]) expect(parseRowColumnKey(key)).toBeNull()
  })
})

describe('JSON Schema publicado', () => {
  const schema = buildJsonSchema()

  it('tem $id, draft 2020-12 e cobre todos os tipos de nó', () => {
    expect(schema['$id']).toBe(JSON_SCHEMA_ID)
    expect(String(schema['$schema'])).toContain('2020-12')
    const text = JSON.stringify(schema)
    for (const type of ['frame', 'group', 'shape', 'path', 'text', 'image', 'video', 'audio', 'sticky', 'connector', 'table', 'chart', 'embed', 'qr', 'plugin']) {
      expect(text).toContain(`"const":"${type}"`)
    }
  })

  it('schema/fuse-file.v1.schema.json está atualizado (rode pnpm --filter @fuse/format schema:generate)', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'fuse-file.v1.schema.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(schema)
  })
})
