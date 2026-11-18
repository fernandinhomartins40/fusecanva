import { useEffect, useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { TEAM_INTEGRATION_EXAMPLES, searchTeamIntegrationExamples } from './team-integrations.mjs'
import { getRemoteTeamIntegrationIds, saveRemoteTeamIntegrationIds } from './api'
import './TeamIntegrationsPanel.css'

type Props = {
  initialSelectedIds?: readonly string[]
  teamId?: string
  onSave: (selectedIds: string[]) => void
  onClose: () => void
  title?: string
}

/** Local selection editor; selection is only committed by Save and never connects a provider. */
export function TeamIntegrationsPanel({ initialSelectedIds = [], teamId, onSave, onClose, title = 'Integrações da equipe' }: Props) {
  const initialSignature = JSON.stringify([...new Set(initialSelectedIds)].sort())
  const initialSet = new Set(JSON.parse(initialSignature) as string[])
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialSet))
  const [persistedIds, setPersistedIds] = useState(() => new Set(initialSet))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const ids = new Set(JSON.parse(initialSignature) as string[])
    setSelectedIds(ids)
    setPersistedIds(ids)
    setQuery('')
  }, [initialSignature])
  useEffect(() => {
    if (!teamId) return
    let active = true
    setBusy(true)
    setError('')
    void getRemoteTeamIntegrationIds(teamId).then(ids => {
      if (active && ids) {
        setSelectedIds(new Set(ids))
        setPersistedIds(new Set(ids))
      }
    }).catch(() => {
      if (active) setError('Não foi possível carregar as preferências compartilhadas da equipe.')
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [teamId])
  const items = useMemo(() => searchTeamIntegrationExamples(query), [query])
  const changed = selectedIds.size !== persistedIds.size || [...selectedIds].some(id => !persistedIds.has(id))

  function toggle(id: string) {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    const order = new Map(TEAM_INTEGRATION_EXAMPLES.map((item, index) => [item.id, index]))
    const ids = [...selectedIds].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    setBusy(true)
    setError('')
    try {
      const savedIds = teamId ? await saveRemoteTeamIntegrationIds(teamId, ids) : ids
      setPersistedIds(new Set(savedIds))
      onSave(savedIds)
    } catch {
      setError('Não foi possível salvar as preferências. Verifique seu acesso à equipe e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setSelectedIds(new Set(persistedIds))
    setQuery('')
    onClose()
  }

  return <section className="team-integrations-panel" aria-label={title}>
    <header className="team-integrations-header">
      <div><span className="team-integrations-kicker">PREFERÊNCIAS DA EQUIPE</span><h2>{title}</h2><p>Escolha exemplos para exibir nas ferramentas da equipe.</p></div>
      <button type="button" className="team-integrations-close" aria-label="Fechar integrações" onClick={cancel}><X size={18} aria-hidden="true" /></button>
    </header>
    <p className="team-integrations-demo-note">Catálogo local de demonstração. Nenhum serviço está conectado ou será acessado.</p>
    <label className="team-integrations-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Buscar integrações</span><input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Buscar integrações" aria-label="Buscar integrações" />{query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={15} aria-hidden="true" /></button>}</label>
    {items.length > 0 ? <div className="team-integrations-grid" aria-label="Exemplos de integrações">{items.map(item => {
      const selected = selectedIds.has(item.id)
      return <button key={item.id} type="button" className={`team-integration-card${selected ? ' is-selected' : ''}`} aria-label={item.name} aria-pressed={selected} disabled={busy} onClick={() => toggle(item.id)}>
        <span className="team-integration-mark" style={{ '--integration-color': item.color } as React.CSSProperties} aria-hidden="true">{item.name.slice(0, 1)}</span>
        <span className="team-integration-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
        <span className="team-integration-check" aria-hidden="true">{selected && <Check size={15} />}</span>
      </button>
    })}</div> : <div className="team-integrations-empty" role="status"><strong>Nenhuma integração encontrada</strong><p>Tente outro nome ou limpe a busca para ver os exemplos.</p><button type="button" onClick={() => setQuery('')}>Limpar busca</button></div>}
    {error && <p className="team-integrations-error" role="alert">{error}</p>}
    <footer className="team-integrations-footer"><span role="status">{selectedIds.size} {selectedIds.size === 1 ? 'selecionada' : 'selecionadas'}</span><div><button type="button" className="team-integrations-cancel" disabled={busy} onClick={cancel}>Cancelar</button><button type="button" className="team-integrations-save" disabled={!changed || busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar preferências'}</button></div></footer>
  </section>
}
