import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { listRemoteDocuments, type RemoteDocument } from './api'
import { summarizeAiDesign } from './ai-brand-context.mjs'
import type { AiComposerAttachment } from './ai-brand-context.mjs'
import { createAiFileAttachment, validateAiAttachmentFile } from './ai-attachments.mjs'
import './AiComposerAttachments.css'

type Props = {
  mode: 'upload' | 'designs' | null
  attachments: AiComposerAttachment[]
  onChange: (attachments: AiComposerAttachment[]) => void
  onClose: () => void
}

export function AiComposerAttachments({ mode, attachments, onChange, onClose }: Props) {
  const [documents, setDocuments] = useState<RemoteDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode !== 'designs') return
    let cancelled = false
    setBusy(true); setError('')
    void listRemoteDocuments().then(items => {
      if (!cancelled) setDocuments(items.filter(item => !item.data.trashedAt && !item.data.archivedAt))
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os designs salvos.')
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [mode])

  async function addFile(file?: File) {
    if (!file) return
    const validation = validateAiAttachmentFile(file)
    if (validation) { setError(validation); return }
    try {
      const content = (await file.text()).slice(0, 8000)
      const attachment: AiComposerAttachment = createAiFileAttachment({ id: `file:${crypto.randomUUID()}`, name: file.name, mimeType: file.type, size: file.size, content })
      onChange([...attachments.filter(item => item.name !== attachment.name), attachment].slice(0, 4))
      setError(''); onClose()
    } catch {
      setError('Não foi possível ler este arquivo neste navegador.')
    }
  }

  function addDesign(document: RemoteDocument) {
    const attachment: AiComposerAttachment = {
      id: `design:${document.id}`, kind: 'design', designId: document.id,
      name: document.name.slice(0, 160),
      context: [document.data.type ?? 'design', summarizeAiDesign(document)].filter(Boolean).join(' — '),
    }
    onChange([...attachments.filter(item => item.designId !== document.id), attachment].slice(0, 4))
    onClose()
  }

  if (!mode) return null
  const selectedIds = new Set(attachments.map(item => item.designId).filter(Boolean))
  const visibleDocuments = documents.filter(document => document.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))
  return <section className="ai-attachment-picker" aria-label={mode === 'upload' ? 'Enviar arquivo para o pedido' : 'Designs salvos neste app'} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
    <header><strong>{mode === 'upload' ? 'Anexar arquivo de texto' : 'Designs salvos neste app'}</strong><button type="button" aria-label="Fechar seletor de anexos" onClick={onClose}><X size={14} aria-hidden="true" /></button></header>
    {mode === 'upload' ? <>
      <p>O conteúdo é lido neste navegador e incluído no pedido. Limite: 512 KB por arquivo.</p>
      <input ref={fileInput} type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" aria-label="Escolher arquivo de texto" onChange={event => void addFile(event.currentTarget.files?.[0])} />
    </> : <>
      <label>Buscar neste app<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome do design" /></label>
      {busy && <p role="status">Carregando designs…</p>}{error && <p role="alert">{error}</p>}
      {!busy && !error && <div className="ai-attachment-design-list">{visibleDocuments.map(document => <button type="button" key={document.id} disabled={selectedIds.has(document.id) || attachments.length >= 4} onClick={() => addDesign(document)}><span><strong>{document.name}</strong><small>{document.data.type ?? 'Design'} · {summarizeAiDesign(document) || 'Sem texto de contexto'}</small></span>{selectedIds.has(document.id) ? 'Adicionado' : 'Adicionar'}</button>)}{visibleDocuments.length === 0 && <p>Nenhum design salvo corresponde à busca.</p>}</div>}
    </>}
    {error && mode === 'upload' && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Cancelar</button></footer>
  </section>
}
