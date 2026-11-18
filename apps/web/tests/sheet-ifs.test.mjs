import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('IFS and SES return the first matching value and preserve errors only in selected branches', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { evaluateSheet } = await vite.ssrLoadModule('/src/sheet.ts')
    const result = evaluateSheet([
      ['5', '0', '=1/0'],
      [
        '=IFS(A1<0,"negative",A1<10,"small",TRUE,"large")',
        '=SES(A1<0;"negativo";A1<10;"pequeno";VERDADEIRO;"grande")',
        '=IFS(B1>0,1/0,TRUE,"fallback")',
        '=IFS(A1>10,1/0,A1=5,"matched")',
        '=IFS(FALSE,1/0,TRUE,1/0)',
        '=IFS(FALSE,"no",FALSE,"either")',
        '=IFS(TRUE)',
        '=IFS(TRUE,"yes",FALSE)',
        '=IFS(C1>0,"unreachable",TRUE,"fallback")',
      ],
    ])
    assert.deepEqual(result.values[1], ['small', 'pequeno', 'fallback', 'matched', '#DIV/0!', '#N/A', '#VALUE!', '#VALUE!', '#DIV/0!'])
  } finally { await vite.close() }
})
