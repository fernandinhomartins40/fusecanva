import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, Check, ChevronDown, Search } from 'lucide-react'
import { getRemoteTeamPolicies, listRemoteTeams, saveRemoteTeamPolicies, type RemoteTeam } from './api'
import { DOWNLOAD_PERMISSION_OPTIONS, TEAM_PERMISSION_POLICIES, UPLOAD_PERMISSION_OPTIONS } from './team-permissions-data.mjs'
import './TeamPermissionsSettings.css'

const STORAGE_KEY = 'fuse-team-permissions-v1'
const sections = [
  { title: 'Gestão de pessoas', links: [['Pessoas', '/settings/people'], ['Grupos', '/settings/groups'], ['Perfil da equipe', '/settings/team-profile']] },
  { title: 'Pagamentos e planos', links: [['Cobrança', '/settings/billing-and-teams'], ['Pedidos e faturas', '/settings/purchase-history']] },
  { title: 'Controles e permissões', links: [['Permissões', '/settings/permissions'], ['Controles', '/settings/controls']] },
  { title: 'Gerenciamento de apps', links: [['Apps', '/settings/apps'], ['Apps privados', '/settings/team-apps']] },
  { title: 'Relatório', links: [['Relatório de uso', '/settings/team-reports']] },
  { title: 'Segurança', links: [['Início único de sessão (SSO) e provisionamento', '/settings/sso']] },
  { title: 'Domínios', links: [['Domínios web', '/settings/domains']] },
] as const

type PolicyComboboxProps = { id: string; label: string; value: string; options: readonly string[]; onChange: (value: string) => void; disabled?: boolean }

function PolicyCombobox({ id, label, value, options, onChange, disabled = false }: PolicyComboboxProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.indexOf(value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionId = (index: number) => `${id}-option-${index}`

  function openList() {
    const selectedIndex = Math.max(0, options.indexOf(value))
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  function closeList(returnFocus = true) {
    setOpen(false)
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => document.getElementById(`${id}-option-${activeIndex}`)?.focus())
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, activeIndex, id])

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); closeList(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (activeIndex + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
      setActiveIndex(next)
      requestAnimationFrame(() => document.getElementById(optionId(next))?.focus())
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(options[activeIndex])
      closeList()
    }
  }

  return <div className="team-policy-combobox" ref={rootRef} onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget as Node | null)) closeList(false) }}>
    <button ref={triggerRef} id={id} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} aria-activedescendant={open ? optionId(activeIndex) : undefined} disabled={disabled} onClick={() => open ? closeList(false) : openList()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openList() } }}>
      <span>{value}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    <div id={`${id}-listbox`} className="team-policy-listbox" role="listbox" aria-label={label} hidden={!open} onKeyDown={handleListKeyDown}>{options.map((option, index) => <button id={optionId(index)} key={option} type="button" role="option" aria-selected={value === option} tabIndex={index === activeIndex ? 0 : -1} onFocus={() => setActiveIndex(index)} onClick={() => { onChange(option); closeList() }}>{option}</button>)}</div>
  </div>
}

function readSaved(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string> } catch { return {} }
}

export function TeamPermissionsSettings() {
  const path = window.location.pathname
  const isControls = path === '/settings/controls'
  const [teams, setTeams] = useState<RemoteTeam[]>([])
  const [teamId, setTeamId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('team'))
  const [teamLoading, setTeamLoading] = useState(true)
  const [teamError, setTeamError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved] = useState(readSaved)
  const initialPolicies = Object.fromEntries(TEAM_PERMISSION_POLICIES.map(item => [item.label, saved[item.label] ?? item.value]))
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...initialPolicies, upload: saved.upload ?? 'Todo mundo', transferOwnership: saved.transferOwnership ?? 'false' }))
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify({ ...initialPolicies, upload: saved.upload ?? 'Todo mundo', transferOwnership: saved.transferOwnership ?? 'false' }))
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const transferOwnership = draft.transferOwnership === 'true'
  const team = teams.find(item => item.id === teamId) ?? null
  const canManageTeam = team?.role === 'admin'
  const teamSettingsHref = (href: string) => team ? `${href}?team=${encodeURIComponent(team.id)}` : href
  const changed = JSON.stringify(draft) !== savedDraft
  const savedUploadScope = (JSON.parse(savedDraft) as Record<string, string>).upload
  const uploadChanged = draft.upload !== savedUploadScope
  const savedTransferOwnership = (JSON.parse(savedDraft) as Record<string, string>).transferOwnership ?? 'false'
  const transferOwnershipChanged = draft.transferOwnership !== savedTransferOwnership
  const teamPolicyChanged = uploadChanged || transferOwnershipChanged
  const filtered = useMemo(() => TEAM_PERMISSION_POLICIES.filter(item => !query.trim() || item.label.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))), [query])
  const groups = [...new Set(filtered.map(item => item.group))]

  useEffect(() => {
    let cancelled = false
    listRemoteTeams().then(availableTeams => {
      if (cancelled) return
      setTeams(availableTeams)
      const requested = new URLSearchParams(window.location.search).get('team')
      const selected = availableTeams.find(item => item.id === requested) ?? availableTeams[0] ?? null
      setTeamId(selected?.id ?? null)
      setTeamError('')
    }).catch(error => {
      if (!cancelled) setTeamError(error instanceof Error ? error.message : 'Não foi possível carregar as equipes.')
    }).finally(() => { if (!cancelled) setTeamLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!teamId) return
    let cancelled = false
    setTeamLoading(true)
    getRemoteTeamPolicies(teamId).then(policies => {
      if (cancelled) return
      const upload = policies.uploadScope ?? 'Todo mundo'
      const transferOwnership = policies.transferOwnership === 'true' ? 'true' : 'false'
      setDraft(current => ({ ...current, upload, transferOwnership }))
      setSavedDraft(current => JSON.stringify({ ...(JSON.parse(current) as Record<string, string>), upload, transferOwnership }))
      setTeamError('')
    }).catch(error => {
      if (!cancelled) setTeamError(error instanceof Error ? error.message : 'Não foi possível carregar as políticas da equipe.')
    }).finally(() => { if (!cancelled) setTeamLoading(false) })
    return () => { cancelled = true }
  }, [teamId])

  function selectTeam(nextTeamId: string) {
    setTeamId(nextTeamId)
    const url = new URL(window.location.href)
    url.searchParams.set('team', nextTeamId)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  async function save() {
    setSaving(true)
    try {
      if (team && canManageTeam) await saveRemoteTeamPolicies(team.id, { uploadScope: draft.upload, transferOwnership: draft.transferOwnership })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
      setSavedDraft(JSON.stringify(draft))
      setNotice(team && canManageTeam ? 'Políticas da equipe salvas. Upload é aplicado pelo servidor; transferência efetiva de conteúdo ainda não está implementada.' : 'Preferências salvas neste navegador. As políticas da equipe exigem uma conta administradora.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível salvar as preferências.') }
    finally { setSaving(false) }
  }

  function cancel() {
    setDraft(JSON.parse(savedDraft) as Record<string, string>)
    setNotice('Alterações descartadas.')
  }

  return <main className="team-settings-shell">
    <header className="team-settings-topbar"><a href="/" aria-label="Voltar ao início"><ArrowLeft size={18} aria-hidden="true" /> Início</a><span>Configurações da equipe</span></header>
    <div className="team-settings-layout">
      <aside className="team-settings-sidebar" aria-label="Navegação lateral">
        <a className="team-settings-home" href="/">Página de início do Canva</a>
        {sections.map(section => <section key={section.title}><h2>{section.title}</h2><nav aria-label={section.title}>{section.links.map(([label, href]) => <a key={href} href={teamSettingsHref(href)} aria-current={path === href ? 'page' : undefined}>{label}</a>)}</nav></section>)}
      </aside>
      <section className="team-settings-content" aria-labelledby="team-settings-title">
        <h1 id="team-settings-title">{isControls ? 'Controles' : 'Permissões'}</h1>
        {teams.length > 1 && <label className="team-settings-team-picker">Equipe<select aria-label="Equipe" value={team?.id ?? ''} onChange={event => selectTeam(event.currentTarget.value)}>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <p>As permissões controlam quem pode acessar ou realizar ações nos recursos da equipe. A política de upload é salva por equipe e aplicada pelo servidor; as demais preferências desta tela continuam locais.</p>
        {teamError && teamId && <p className="team-settings-policy-error" role="alert">{teamError}</p>}
        {!isControls && <><div className="team-permissions-intro"><h2>Configure as permissões para otimizar o gerenciamento da equipe</h2><ul><li>Convide sua equipe para aproveitar ao máximo as permissões de equipe</li><li>Gerencie sua equipe com ferramentas para controlar a criação de designs no Canva</li></ul></div>
          <label className="team-permissions-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Buscar permissões</span><input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Buscar permissões" aria-label="Buscar permissões" /></label>
          {groups.map(group => <section className="team-policy-group" key={group}><h2>{group}</h2>{filtered.filter(policy => policy.group === group).map(policy => <div className="team-policy-row" key={policy.label}><label id={`policy-label-${TEAM_PERMISSION_POLICIES.indexOf(policy)}`}>{policy.label}</label><PolicyCombobox id={`policy-${TEAM_PERMISSION_POLICIES.indexOf(policy)}`} label={policy.label} value={draft[policy.label]} options={policy.label === 'Quem pode baixar designs ou seleções?' ? DOWNLOAD_PERMISSION_OPTIONS : ['Todo mundo', 'Admins e designers de marca da equipe', 'Somente admins da equipe']} onChange={value => setDraft(current => ({ ...current, [policy.label]: value }))} /></div>)}</section>)}
        </>}
        {isControls && <section className="team-policy-group"><h2>Controles administrativos</h2><div className="team-policy-row"><label id="team-upload-scope-label">Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?</label><PolicyCombobox id="team-upload-scope" label="Quem pode fazer upload de imagens e vídeos do seu próprio dispositivo?" value={draft.upload} options={UPLOAD_PERMISSION_OPTIONS} disabled={Boolean(teamId && teamLoading) || Boolean(team && (!canManageTeam || teamError))} onChange={value => setDraft(current => ({ ...current, upload: value }))} /></div><label className="team-transfer-toggle"><input type="checkbox" checked={transferOwnership} disabled={Boolean(teamId && teamLoading) || Boolean(team && (!canManageTeam || teamError))} onChange={event => setDraft(current => ({ ...current, transferOwnership: String(event.currentTarget.checked) }))} /> Habilitar a transferência de propriedade</label><p className="team-settings-demo-note">{team && canManageTeam ? `Política de upload aplicada pelo servidor. Admins podem designar integrantes como designers de marca em Pessoas; quando esta opção está selecionada, o servidor permite upload a admins e designers designados. A transferência efetiva de conteúdo não foi auditada nem implementada; este controle salva apenas a política.` : 'Sem equipe administrada, upload e transferência ficam como preferências locais neste navegador.'}</p></section>}
        <footer className="team-settings-footer"><span role="status">{notice || (changed ? 'Há alterações não salvas.' : 'Todas as alterações estão salvas.')}</span><div><button type="button" onClick={cancel} disabled={!changed || saving}>Cancelar</button><button type="button" className="team-settings-save" onClick={() => void save()} disabled={!changed || saving || teamLoading || Boolean(team && !canManageTeam && teamPolicyChanged)}><Check size={15} aria-hidden="true"/> {saving ? 'Salvando…' : 'Salvar alterações'}</button></div></footer>
      </section>
    </div>
  </main>
}
