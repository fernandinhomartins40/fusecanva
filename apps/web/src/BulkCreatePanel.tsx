import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2, Upload, X } from 'lucide-react'
import type { DesignPage, TextElement } from './model'
import { generateBulkPages, parseBulkDelimited } from './bulk-create.mjs'
import type { ImportedExcelSheet } from './excel'

type Props = { page: DesignPage; onClose: () => void; onGenerate: (pages: DesignPage[]) => void; onGenerateIndividual: (pages: DesignPage[]) => Promise<{ created: number; failed: number; mediaFailed?: number }> }
const initialRows = [['Nome', 'E-mail'], ['Ana', 'ana@example.com'], ['Bruno', 'bruno@example.com']]

export function BulkCreatePanel({ page, onClose, onGenerate, onGenerateIndividual }: Props) {
  const [sourcePage] = useState(() => structuredClone(page))
  const [rows, setRows] = useState(initialRows.map(row => [...row]))
  const [source, setSource] = useState<'manual' | 'upload' | 'xlsx'>('manual')
  const [workbookSheets, setWorkbookSheets] = useState<ImportedExcelSheet[]>([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [output, setOutput] = useState<'document' | 'individual'>('document')
  const [bindings, setBindings] = useState<Record<string, number>>({})
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const fields = rows[0] ?? []
  const textLayers = sourcePage.elements.filter((element): element is TextElement => element.type === 'text')
  const records = rows.slice(1)
  const activePreviewIndex = Math.min(previewIndex, Math.max(0, records.length - 1))
  const activeRecord = records[activePreviewIndex] ?? []
  const setCell = (rowIndex: number, columnIndex: number, value: string) => setRows(current => current.map((row, index) => index === rowIndex ? row.map((cell, column) => column === columnIndex ? value : cell) : row))
  const addColumn = () => setRows(current => current.map((row, index) => [...row, index === 0 ? `Campo ${row.length + 1}` : '']))
  const clear = () => { setRows([['Campo 1'], ['']]); setBindings({}); setMessage('Tabela limpa.') }
  const loadFile = async (file?: File) => { if (!file) return; const parsed = parseBulkDelimited(await file.text()); setRows(parsed.map(row => [...row])); setSource('upload'); setMessage(`${Math.max(0, parsed.length - 1)} registros carregados de ${file.name}.`) }
  const loadWorkbook = async (file?: File) => {
    if (!file) return
    setWorkbookSheets([]); setSelectedSheet(''); setRows([['Campo 1']]); setBindings({})
    setSource('xlsx')
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) { setMessage('Formato inválido. Selecione uma pasta de trabalho .xlsx.'); return }
    try {
      const { parseExcelWorkbook } = await import('./excel')
      const sheets = await parseExcelWorkbook(await file.arrayBuffer(), { formulaMode: 'cached-result' })
      setWorkbookSheets(sheets)
      setMessage(sheets.length ? `Arquivo ${file.name} carregado. Escolha explicitamente uma aba para importar a primeira linha como campos.` : `O arquivo ${file.name} não contém abas.`)
    } catch (error) {
      setSource('xlsx')
      setMessage(error instanceof Error ? `Não foi possível importar o arquivo Excel: ${error.message}` : 'Não foi possível importar o arquivo Excel.')
    }
  }
  const selectWorkbookSheet = (indexValue: string) => {
    setSelectedSheet(indexValue); setBindings({})
    if (indexValue === '') { setRows([['Campo 1']]); setMessage('Escolha uma aba para importar os dados.'); return }
    const sheet = workbookSheets[Number(indexValue)]
    if (!sheet) { setRows([['Campo 1']]); setMessage('A aba selecionada não está disponível.'); return }
    const imported = sheet.cells.map(row => [...row])
    const header = imported[0] ?? []
    const width = Math.max(header.length, ...imported.map(row => row.length), 0)
    if (!header.length || header.every(value => !value.trim())) {
      setRows([['Campo 1']]); setMessage(`A aba “${sheet.name}” está vazia ou malformada: a primeira linha precisa conter os nomes dos campos.`); return
    }
    const fields = Array.from({ length: width }, (_, column) => header[column] ?? '')
    const extraValues = imported.slice(1).some(row => row.slice(fields.length).some(value => value.trim()))
    if (extraValues) {
      setRows([fields]); setMessage(`A aba “${sheet.name}” está malformada: há valores em colunas sem campo na primeira linha.`); return
    }
    const data = imported.slice(1).filter(row => row.some(value => value.trim())).map(row => fields.map((_, column) => row[column] ?? ''))
    setRows([fields, ...data])
    setMessage(data.length ? `${data.length} registros carregados da aba “${sheet.name}”. A primeira linha foi usada como campos.` : `A aba “${sheet.name}” está vazia: não há registros após a primeira linha de campos.`)
  }
  const generate = async () => {
    if (!records.length) { setMessage('Adicione ao menos um registro.'); return }
    if (!Object.keys(bindings).length) { setMessage('Vincule um campo a uma camada de texto.'); return }
    const created = generateBulkPages(sourcePage, records, bindings, () => `bulk-${crypto.randomUUID()}`) as DesignPage[]
    if (output === 'individual') {
      setGenerating(true)
      setMessage('Criando projetos individuais…')
      try {
        const result = await onGenerateIndividual(created)
        const projectMessage = result.failed ? `${result.created} de ${created.length} projetos criados; ${result.failed} falharam.` : `${result.created} projetos individuais criados na biblioteca.`
        setMessage(result.mediaFailed ? `${projectMessage} Mídias não copiadas em ${result.mediaFailed} projeto(s).` : projectMessage)
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível criar os projetos individuais.') }
      finally { setGenerating(false) }
      return
    }
    onGenerate(created); setMessage(`${created.length} página(s) gerada(s) no documento.`)
  }
  return <section className="bulk-create-panel" role="dialog" aria-modal="true" aria-label="Criar em lote">
    <header><div><small>GERAÇÃO DE VARIAÇÕES</small><h2>Criar em lote</h2></div><button type="button" aria-label="Fechar criação em lote" onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <div className="bulk-create-body">
      <label>Fonte de dados<select aria-label="Fonte de dados" value={source} onChange={event => { const next = event.target.value as typeof source; setSource(next); if (next === 'xlsx') { setWorkbookSheets([]); setSelectedSheet(''); setRows([['Campo 1']]); setBindings({}); setMessage('Envie um arquivo Excel e escolha explicitamente uma aba.') } }}><option value="manual">Entrada manual</option><option value="upload">Enviar arquivo CSV, TSV ou texto delimitado</option><option value="xlsx">Importar pasta de trabalho Excel (.xlsx)</option></select></label>
      {source === 'upload' && <label className="bulk-file-input"><Upload size={16} aria-hidden="true" /> Escolher CSV / TSV<input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={event => void loadFile(event.target.files?.[0])}/></label>}
      {source === 'xlsx' && <><label className="bulk-file-input"><Upload size={16} aria-hidden="true" /> Escolher pasta de trabalho (.xlsx)<input aria-label="Arquivo Excel" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => void loadWorkbook(event.target.files?.[0])}/></label>{workbookSheets.length > 0 && <label>Planilha<select aria-label="Planilha Excel" value={selectedSheet} onChange={event => selectWorkbookSheet(event.target.value)}><option value="">Escolha uma aba…</option>{workbookSheets.map((sheet, index) => <option value={index} key={`${index}-${sheet.name}`}>{sheet.name}</option>)}</select></label>}</>}
      <div className="bulk-grid-wrap"><table aria-label="Dados para criação em lote"><thead><tr>{fields.map((field, column) => <th key={column}><input aria-label={`Nome do campo ${column + 1}`} value={field} onChange={event => setCell(0, column, event.target.value)}/><button type="button" aria-label={`Remover coluna ${field || column + 1}`} onClick={() => setRows(current => current.map(row => row.filter((_, index) => index !== column)))}><X size={12} aria-hidden="true" /></button></th>)}<th><button type="button" onClick={addColumn} aria-label="Adicionar coluna"><Plus size={15} aria-hidden="true" /></button></th></tr></thead><tbody>{records.map((row, rowIndex) => <tr key={rowIndex}>{fields.map((_, column) => <td key={column}><input aria-label={`Registro ${rowIndex + 1}, ${fields[column] || `campo ${column + 1}`}`} value={row[column] ?? ''} onChange={event => setCell(rowIndex + 1, column, event.target.value)}/></td>)}<td><button type="button" aria-label={`Remover registro ${rowIndex + 1}`} onClick={() => setRows(current => current.filter((_, index) => index !== rowIndex + 1))}><Trash2 size={13} aria-hidden="true" /></button></td></tr>)}</tbody></table></div>
      <button type="button" className="bulk-add-record" onClick={() => setRows(current => [...current, fields.map(() => '')])}><Plus size={14} aria-hidden="true" /> Adicionar registro</button>
      <div className="bulk-binding"><strong>Vincular dados às camadas</strong><p>Escolha qual campo substitui cada camada de texto.</p>{textLayers.map(layer => <label key={layer.id}>{layer.name || layer.text.slice(0, 24)}<select aria-label={`Campo para ${layer.name || layer.text.slice(0, 24)}`} value={bindings[layer.id] ?? ''} onChange={event => setBindings(current => { const next = { ...current }; if (event.target.value === '') delete next[layer.id]; else next[layer.id] = Number(event.target.value); return next })}><option value="">Sem vínculo</option>{fields.map((field, index) => <option value={index} key={index}>{field || `Campo ${index + 1}`}</option>)}</select></label>)}</div>
      <fieldset className="bulk-output"><legend>Formato de saída</legend><label><input type="radio" name="bulk-output" checked={output === 'document'} onChange={() => setOutput('document')}/> Um documento com uma página por registro</label><label><input type="radio" name="bulk-output" checked={output === 'individual'} onChange={() => setOutput('individual')}/> Projetos individuais</label></fieldset>
      <div className="bulk-preview" aria-label="Prévia dos registros" aria-live="polite">
        <div className="bulk-preview-heading"><strong>Prévia de registro <span data-bulk-preview-position>{records.length ? `${activePreviewIndex + 1} / ${records.length}` : '0 / 0'}</span></strong><div><button type="button" aria-label="Prévia anterior" disabled={activePreviewIndex === 0 || records.length === 0} onClick={() => setPreviewIndex(index => Math.max(0, index - 1))}><ChevronLeft size={15}/></button><button type="button" aria-label="Próxima prévia" disabled={activePreviewIndex >= records.length - 1 || records.length === 0} onClick={() => setPreviewIndex(index => Math.min(records.length - 1, index + 1))}><ChevronRight size={15}/></button></div></div>
        <div className="bulk-preview-values">{records.length ? fields.map((field, column) => <span key={column}>{field || `Campo ${column + 1}`}: {activeRecord[column] || '—'}</span>) : <span>Nenhum registro para visualizar.</span>}</div>
        {Object.entries(bindings).map(([elementId, column]) => { const layer = textLayers.find(item => item.id === elementId); if (!layer) return null; const value = activeRecord[column]; return <div className="bulk-preview-layer" key={elementId}><small>{layer.name || 'Camada de texto'}</small><strong data-bulk-preview-value={elementId} style={{ color: layer.color, fontFamily: layer.fontFamily, fontSize: `${Math.min(24, Math.max(12, layer.fontSize))}px`, fontWeight: layer.bold ? 700 : 400 }}>{value || layer.text}</strong></div> })}
      </div>{message && <p role="status" className="bulk-message">{message}</p>}
    </div>
    <footer><button type="button" aria-label="Limpar dados" onClick={clear} disabled={generating}>Limpar dados</button><button type="button" aria-label="Cancelar" onClick={onClose} disabled={generating}>Cancelar</button><button type="button" className="bulk-generate" onClick={() => void generate()} disabled={generating}><Copy size={14}/> {generating ? 'Criando…' : 'Gerar designs'}</button></footer>
  </section>
}
