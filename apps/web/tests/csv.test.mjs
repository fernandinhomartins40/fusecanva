import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('CSV import handles delimiters, quoted cells, escaped quotes, multiline fields and line endings', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { parseCsv, serializeCsv } = await vite.ssrLoadModule('/src/csv.ts')
    assert.deepEqual(parseCsv('\uFEFFname,description,price\r\n"Coffee, dark","She said ""hello""",12.50\r\n"Tea","hot\nand fresh",4.25\r\n'), [
      ['name', 'description', 'price'],
      ['Coffee, dark', 'She said "hello"', '12.50'],
      ['Tea', 'hot\nand fresh', '4.25'],
    ])
    assert.deepEqual(parseCsv('produto;quantidade\nCafé;4\nChá;7'), [['produto', 'quantidade'], ['Café', '4'], ['Chá', '7']])
    assert.deepEqual(parseCsv('A\tB\n1\t2'), [['A', 'B'], ['1', '2']])
    assert.deepEqual(parseCsv('a,,c\n'), [['a', '', 'c']])
    assert.throws(() => parseCsv('a,"unterminated'), /fecha/)
    assert.throws(() => parseCsv('ab"cd,ef'), /posição inválida/)
    assert.throws(() => parseCsv('"a"x,b'), /depois de uma aspa/)
    assert.throws(() => parseCsv(Array.from({ length: 258 }, () => 'x').join(',')), /256 colunas/)
    assert.throws(() => parseCsv(''), /vazio/)

    const exported = serializeCsv([
      ['nome', 'observação', 'fórmula'],
      ['Café', 'vírgula, aspas "duplas"\ne nova linha', '=SUM(A2:A3)'],
      ['', '', ''],
    ])
    assert.equal(exported, 'nome,observação,fórmula\r\nCafé,"vírgula, aspas ""duplas""\ne nova linha",=SUM(A2:A3)')
    assert.deepEqual(parseCsv(exported), [['nome', 'observação', 'fórmula'], ['Café', 'vírgula, aspas "duplas"\ne nova linha', '=SUM(A2:A3)']])
    assert.equal(serializeCsv([['x', 'y'], ['1', '2']], ';'), 'x;y\r\n1;2')
    assert.equal(serializeCsv([[''], ['', '']]), '')
    assert.throws(() => serializeCsv([['x']], '|'), /Delimitador/)
  } finally {
    await vite.close()
  }
})
