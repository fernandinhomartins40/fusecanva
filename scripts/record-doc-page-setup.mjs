import fs from 'node:fs'

const statusPath = new URL('../IMPLEMENTATION-STATUS.json', import.meta.url)
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'))
status['docs-page-setup-a4-roundtrip'] = {
  status: 'Implementacao parcial: Chromium confirma formato A4 retrato, margens editaveis em centimetros, atualizacao da pagina e persistencia apos recarga e reabertura. Exportacao usa margens persistidas e mantem uma pagina com MediaBox A4; teste focalizado: web/scripts/check-doc-page-setup-browser.mjs; teste unitario: web/tests/export.test.mjs. Orientacao, formatos adicionais, equivalencia pixel a pixel e validacao visual mobile seguem pendentes.',
}
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')

const planPath = new URL('../IMPLEMENTATION-PLAN.md', import.meta.url)
const note = '**Configuração de página A4 do Docs (2026-10-22):** o formato A4 retrato agora persiste no documento com quatro margens editáveis em centímetros. Chromium verifica o padrão de 2,54 cm, alteração de margem, atualização do layout e persistência após recarga e reabertura pela biblioteca. A paginação e a exportação PDF usam as margens salvas; testes confirmam área útil menor com margens maiores, posição horizontal do conteúdo e PDF de uma página com MediaBox A4. `node scripts/check-doc-page-setup-browser.mjs`, `node --test web/tests/export.test.mjs` e `npm.cmd run build` passaram. Orientação, outros tamanhos, comparação pixel a pixel e validação visual mobile permanecem pendentes; `analysis/` não foi alterado.'
let plan = fs.readFileSync(planPath, 'utf8')
if (!plan.includes(note)) plan += `\n\n${note}\n`
fs.writeFileSync(planPath, plan, 'utf8')
console.log(`Recorded Docs page setup evidence; ${Object.keys(status).length} implementation status records.`)
