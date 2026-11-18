import fs from 'node:fs'

const statusPath = new URL('../IMPLEMENTATION-STATUS.json', import.meta.url)
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'))
const append = (id, evidence) => {
  if (!status[id]?.status) throw new Error(`Missing recoverable status for ${id}`)
  if (!status[id].status.includes(evidence)) status[id].status += ` ${evidence}`
}

for (const id of Object.keys(status).filter(id => id.startsWith('projects-folder-') || id === 'projects-empty-folder-copy-delete')) {
  append(id, 'Chromium 1920x897 valida rail de 72px + subnav de 264px, canvas em 336px, hero/faixa de equipes ocultos, detalhes cloud recolhidos, busca e filtro funcional de tipo, ordenacao por nome/data e viewport mobile. Evidencia visual: web/artifacts/visual/project-folder-workspace-1920x897.png; teste: web/scripts/check-project-folders-browser.mjs. Comparacao pixel a pixel e outros papeis/breakpoints seguem pendentes.')
}

append('apps-marketplace-query-submit-suggestions-clear', 'A busca tambem filtra por provedor, oferece acao Limpar busca com foco preservado e mostra que permissoes nao foram solicitadas/concedidas. Chromium: web/scripts/check-apps-marketplace-browser.mjs.')
append('apps-third-party-details-permission-back', 'A tela explica que nenhuma permissao real foi solicitada ou concedida; provedor externo continua nao configurado. Chromium: web/scripts/check-apps-marketplace-browser.mjs.')
append('export-format-specific-controls-and-artifact-verification', 'Chromium confere PNG transparente/opaco, escala 1x/3x, JPEG MIME/extensao/dimensoes, PDF multipagina e PPTX editavel/fallback. 5/5 testes focalizados e build passaram; sem equivalencia pixel a pixel geral. Evidencia: web/scripts/check-pptx-export-browser.mjs; web/tests/export.test.mjs; web/src/export.ts.')
append('video-pro-sync-persist-and-restore', 'Helper PCM de waveform normaliza envelopes mono/estereo e retencao de transientes (2/2 testes); ainda nao ligado ao decoder nem UI. Evidencia: web/src/audio-waveform.ts; web/tests/audio-waveform.test.mjs.')

status['site-hidden-populated-section-computer-preview'] = { status: 'Implementacao parcial: Chromium cria Site com secao preenchida, oculta pelo controle acessivel, confirma que o conteudo continua editavel e que a secao some da previa e da navegacao. A flag persiste e e restaurada apos recarga e reabertura pela biblioteca; mostrar restaura a previa. Browser: web/scripts/check-template-discovery-browser.mjs. Mobile/previa expandida, Site publicado e comparacao independente permanecem sem validacao.' }
status['site-populated-clone-independent-edit'] = { status: 'Implementacao parcial: Chromium duplica uma secao Site preenchida, confirma IDs distintos e texto inicial preservado, edita somente a copia e valida que original e copia permanecem independentes apos salvar, recarregar e reabrir pela biblioteca; ocultar e excluir a copia deixa a secao original intacta. Browser: web/scripts/check-template-discovery-browser.mjs. Outros elementos/referencias e comparacao pixel a pixel permanecem pendentes.' }

fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
const planPath = new URL('../IMPLEMENTATION-PLAN.md', import.meta.url)
const note = '**Ocultar/duplicar seções de Site após recarga (2026-10-22):** o ensaio Chromium cria Site com conteúdo, oculta uma seção e confirma persistência local após reload e reabertura pela biblioteca; a prévia e a navegação omitem a seção e preservam seu conteúdo editável. Outro fluxo duplica seção preenchida, confirma IDs distintos, edita apenas o texto da cópia, recarrega/reabre, compara original e cópia, depois exclui a cópia e confirma que a original permanece intacta. O teste também corrige duas suposições obsoletas do harness: o IndexedDB evoluiu para v4, e um reload local retorna à biblioteca antes de reabrir o documento. `node scripts/check-template-discovery-browser.mjs` passou. Permanecem pendentes outros tipos de elementos, aplicação mobile nativa, Site publicado e comparação visual independente; `analysis/` não foi alterado.'
let plan = fs.readFileSync(planPath, 'utf8')
if (!plan.includes(note)) plan += `\n\n${note}\n`
fs.writeFileSync(planPath, plan, 'utf8')
console.log(`Updated ${Object.keys(status).length} recovered status records with parallel work evidence.`)
