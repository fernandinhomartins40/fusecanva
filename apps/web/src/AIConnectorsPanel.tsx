import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import './AIConnectorsPanel.css'

type Connector = { name: string; beta?: true; color: string }

const CONNECTORS: Connector[] = [
  { name: 'Airtable', beta: true, color: '#f8a13c' },
  { name: 'Asana', beta: true, color: '#f06a78' },
  { name: 'Atlassian', beta: true, color: '#5791f5' },
  { name: 'Financial Datasets', color: '#4aa886' },
  { name: 'Gmail', color: '#e96a64' },
  { name: 'Google Calendar', color: '#5f91ed' },
  { name: 'Google Drive', color: '#e7b74e' },
  { name: 'Granola', beta: true, color: '#b67ce1' },
  { name: 'HubSpot Data', beta: true, color: '#f18b54' },
  { name: 'Linear', beta: true, color: '#8974ea' },
  { name: 'Microsoft 365', beta: true, color: '#4c8fe8' },
  { name: 'Microsoft Teams', beta: true, color: '#8079d8' },
  { name: 'Miro', beta: true, color: '#e8d24f' },
  { name: 'Monday.com', beta: true, color: '#e978b7' },
  { name: 'Notion', color: '#dedee4' },
  { name: 'Outlook', beta: true, color: '#5796e9' },
  { name: 'Slack', beta: true, color: '#ca74a8' },
  { name: 'Zoom', beta: true, color: '#4c98df' },
]

type Props = {
  onBack: () => void
  onClose: () => void
  returnFocusRef?: { current: HTMLElement | null }
  id?: string
}

/** A local, non-connecting representation of the audited AI connector directory. */
export function AIConnectorsPanel({ onBack, onClose, returnFocusRef, id }: Props) {
  const backRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null)
  const visibleConnectors = useMemo(() => {
    const normalized = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    return CONNECTORS.filter(connector => connector.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(normalized))
  }, [query])

  useEffect(() => {
    backRef.current?.focus()
  }, [])

  function restorePromptFocus() {
    requestAnimationFrame(() => returnFocusRef?.current?.focus())
  }

  function navigateConnectorMenu(event: React.KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.matches('[role="menuitem"]')) return false
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return false
    const current = items.indexOf(event.target as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    event.preventDefault()
    items[next].focus()
    items[next].scrollIntoView({ block: 'nearest' })
    return true
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onBack()
      restorePromptFocus()
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLButtonElement && event.target.matches('[role="menuitem"]')) {
      event.preventDefault()
      event.target.click()
      return
    }
    if (navigateConnectorMenu(event)) return
    if (event.key !== 'Tab') return
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-directory-focus]') ?? [])]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return <section id={id} ref={panelRef} className="ai-connectors-panel" role="tabpanel" aria-labelledby="ai-connectors-tab" aria-label="Conectar apps ao assistente" onKeyDown={handleKeyDown}>
    <header className="ai-connectors-header">
      <button ref={backRef} data-directory-focus type="button" className="ai-connectors-back" onClick={() => { onBack(); restorePromptFocus() }} aria-label="Voltar para o pedido"><ArrowLeft size={17} aria-hidden="true" /></button>
      <div className="ai-connectors-heading"><h3>Conectar</h3><p>Acesse insights das suas ferramentas favoritas no chat</p></div>
      <button data-directory-focus type="button" className="ai-connectors-close" onClick={() => { onClose(); restorePromptFocus() }} aria-label="Fechar conectores"><X size={17} aria-hidden="true" /></button>
    </header>
    <label className="ai-connectors-search"><Search size={16} aria-hidden="true" /><input data-directory-focus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar conectores" aria-label="Buscar conectores" aria-controls={`${id ?? 'ai-connectors-panel'}-results`} />{query && <button data-directory-focus type="button" onClick={() => setQuery('')} aria-label="Limpar busca"><X size={14} aria-hidden="true" /></button>}</label>
    <p className="ai-connectors-result-count" role="status" aria-live="polite" aria-atomic="true">{visibleConnectors.length} de {CONNECTORS.length} conectores</p>
    <div id={`${id ?? 'ai-connectors-panel'}-results`} className="ai-connectors-list" role="menu" aria-label="Diretório de conectores">
      {visibleConnectors.map(connector => <button
        key={connector.name}
        data-directory-focus
        type="button"
        role="menuitem"
        aria-label={`Selecionar ${connector.name}${connector.beta ? ' Beta' : ''} para visualização. Conexão externa indisponível.`}
        aria-current={selectedConnector?.name === connector.name ? 'true' : undefined}
        title="Selecionar para visualizar; a conexão externa ainda não está configurada"
        className={`ai-connector-row${selectedConnector?.name === connector.name ? ' is-selected' : ''}`}
        onClick={() => setSelectedConnector(connector)}
      >
        <span className="ai-connector-mark" style={{ '--connector-mark': connector.color } as CSSProperties} aria-hidden="true">{connector.name.slice(0, 1)}</span>
        <span className="ai-connector-name">{connector.name}{connector.beta && <small className="ai-connector-beta">Beta</small>}</span>
        <span className="ai-connector-action" aria-hidden="true">Conectar</span>
      </button>)}
    </div>
    {!visibleConnectors.length && <p className="ai-connectors-empty" role="status">Nenhum conector encontrado. Tente outro nome.</p>}
    {selectedConnector && <div className="ai-connectors-preview" role="region" aria-live="polite" aria-atomic="true" aria-label={`Prévia local de ${selectedConnector.name}`}><strong>{selectedConnector.name}{selectedConnector.beta && <small className="ai-connector-beta">Beta</small>}</strong><span>Selecionado localmente. Nenhuma conexão foi iniciada nem dados acessados.</span></div>}
    <p className="ai-connectors-safety-note">Diretório de demonstração. As conexões externas não estão configuradas.</p>
  </section>
}
