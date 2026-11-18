import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corpus = path.join(root, 'analysis')
const cases = JSON.parse(fs.readFileSync(path.join(corpus, 'functional-equivalence-cases.json'), 'utf8')).cases
const map = JSON.parse(fs.readFileSync(path.join(corpus, 'area-case-gap-map.json'), 'utf8'))
const plan = fs.readFileSync(path.join(root, 'IMPLEMENTATION-PLAN.md'), 'utf8')
const statusPath = path.join(root, 'IMPLEMENTATION-STATUS.json')
const statusOverrides = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {}
const matrixIndex = plan.indexOf('## Matriz das 27')
const section = matrixIndex >= 0 ? plan.slice(matrixIndex).split(/\r?\n## /)[0] : null
if (!section) throw new Error('Could not locate the 27-area phase matrix in IMPLEMENTATION-PLAN.md')

const phaseByAreaNumber = new Map()
for (const line of section.split(/\r?\n/)) {
  const match = line.match(/^\|\s*(\d{2})\s+[^|]+\|\s*([^|]+)\|$/)
  if (match) phaseByAreaNumber.set(`area-${match[1]}`, match[2].trim())
}

const areaRows = map.rows.map(area => {
  const areaNumber = area.id.match(/^area-(\d{2})$/)?.[1]
  return { ...area, phase: areaNumber ? phaseByAreaNumber.get(`area-${areaNumber}`) ?? null : null }
})
const byCase = new Map(cases.map(item => [item.id, { ...item, areas: [] }]))
const danglingCaseReferences = []
const duplicateAreaCandidates = []
for (const area of areaRows) {
  const seenInArea = new Set()
  for (const id of area.case_candidates ?? []) {
    if (!byCase.has(id)) {
      danglingCaseReferences.push({ area: area.id, caseId: id })
      continue
    }
    if (seenInArea.has(id)) duplicateAreaCandidates.push({ area: area.id, caseId: id })
    seenInArea.add(id)
    byCase.get(id).areas.push(area)
  }
}

const errors = []
if (cases.length !== 131) errors.push(`Expected 131 functional cases; found ${cases.length}`)
if (areaRows.length !== 27) errors.push(`Expected 27 areas; found ${areaRows.length}`)
if (map.unmapped_case_ids?.length !== 0) errors.push(`Source crosswalk has ${map.unmapped_case_ids?.length ?? 'unknown'} unmapped cases`)
if (new Set(cases.map(item => item.id)).size !== cases.length) errors.push('Functional case IDs are not unique')
if (new Set(areaRows.map(area => area.id)).size !== areaRows.length) errors.push('Area IDs are not unique')
if (areaRows.some(area => !area.phase)) errors.push('One or more areas have no matching phase in the implementation plan')
if (danglingCaseReferences.length) errors.push(`${danglingCaseReferences.length} area candidate references point to unknown cases`)
if (duplicateAreaCandidates.length) errors.push(`${duplicateAreaCandidates.length} duplicate case-to-area candidate edges`)
for (const item of byCase.values()) if (item.areas.length === 0) errors.push(`No candidate area mapping for ${item.id}`)
if (phaseByAreaNumber.size !== 27) errors.push(`Expected phase mapping for 27 areas; found ${phaseByAreaNumber.size}`)
for (const id of Object.keys(statusOverrides)) if (!byCase.has(id)) errors.push(`Implementation status references unknown case ${id}`)
if (errors.length) throw new Error(`${errors.join('\n')}\nDangling examples: ${JSON.stringify(danglingCaseReferences.slice(0, 5))}`)

const escapeCell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
const phaseRows = [...new Set(areaRows.map(area => area.phase))]
const candidateEdges = areaRows.reduce((total, area) => total + (area.case_candidates?.length ?? 0), 0)
const lines = [
  '# Matriz de rastreabilidade da implementação',
  '',
  'Gerada por `node scripts/build-implementation-traceability.mjs` a partir do corpus em `analysis/`, da matriz em `IMPLEMENTATION-PLAN.md` e dos estados com evidencia em `IMPLEMENTATION-STATUS.json`. O gerador le o corpus sem modifica-lo.',
  '',
  `Escopo: **${cases.length} casos**, **${areaRows.length} áreas**, **${candidateEdges} vínculos candidatos área-caso**. Cada caso está associado às áreas candidatas da auditoria e à fase do plano correspondente.`,
  '',
  '> Todas as linhas começam como **Pendente de validação de equivalência**. O vínculo área-caso da auditoria é topical/candidato; presença nesta matriz não prova implementação, cobertura, autoridade da evidência nem equivalência. Atualize o estado apenas com referência a teste executável e evidência revisada. Dependências externas continuam condicionadas a adapters/configuração e sandbox.',
  '',
  '## Distribuição por fase',
  '',
  '| Fase | Áreas | Casos candidatos |',
  '| --- | ---: | ---: |',
]
for (const phase of phaseRows) {
  const inPhase = areaRows.filter(area => area.phase === phase)
  const ids = new Set(inPhase.flatMap(area => area.case_candidates ?? []))
  lines.push(`| ${escapeCell(phase)} | ${inPhase.length} | ${ids.size} |`)
}
lines.push('', '## Casos formais', '', '| Caso | Área(s) candidata(s) | Fase(s) | Estado de implementação / validação | Status observado na auditoria | Contrato de referência |', '| --- | --- | --- | --- | --- | --- |')
for (const item of byCase.values()) {
  const areaIds = item.areas.map(area => area.id).join(', ')
  const phases = [...new Set(item.areas.map(area => area.phase))].join('; ')
  const implementationStatus = statusOverrides[item.id]?.status ?? 'Pendente de validacao de equivalencia'
  lines.push(`| \`${escapeCell(item.id)}\` | ${areaIds} | ${escapeCell(phases)} | ${escapeCell(implementationStatus)} | ${escapeCell(item.observation_status ?? '\u006e\u00e3o especificado')} | \`${escapeCell(item.contract)}\` |`)
}
lines.push('', '## Regra para avançar o estado', '', 'Um caso só sai de pendente quando houver: fixture e estado inicial identificados; ações reproduzíveis; resultado esperado e obtido comparados; persistência/erro incluídos quando aplicáveis; validação funcional e visual/mobile/acessível conforme o caso; links para teste e evidência. Um recurso parcialmente existente no produto não basta para marcar o caso como equivalente.', '')

const output = path.join(root, 'IMPLEMENTATION-TRACEABILITY.md')
fs.writeFileSync(output, lines.join('\n'), 'utf8')
console.log(JSON.stringify({ output, cases: cases.length, areas: areaRows.length, phaseMappings: phaseByAreaNumber.size, mappedCases: [...byCase.values()].filter(item => item.areas.length > 0).length, candidateEdges, danglingCaseReferences: danglingCaseReferences.length, duplicateAreaCandidates: duplicateAreaCandidates.length, result: 'ok' }, null, 2))
