import { useRef, useState, type KeyboardEvent } from 'react'
import type { ReactNode } from 'react'
import type { RemoteTeamMember } from './api'
import './TeamRosterPanel.css'

type TeamRosterPanelProps = {
  members: RemoteTeamMember[]
  groupsByMember?: Record<string, string[]>
  currentUserId: string
  teamRole: 'admin' | 'member'
  onRoleChange: (member: RemoteTeamMember, role: RemoteTeamMember['role']) => void
  onBrandDesignerChange?: (member: RemoteTeamMember, brandDesigner: boolean) => void
  onRemove: (member: RemoteTeamMember) => void
  busyMemberId?: string | null
  compact?: boolean
  banner?: ReactNode
}

export function TeamRosterPanel({ members, groupsByMember = {}, currentUserId, teamRole, onRoleChange, onBrandDesignerChange, onRemove, busyMemberId, compact = false, banner }: TeamRosterPanelProps) {
  const [tab, setTab] = useState<'members' | 'ai'>('members')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RemoteTeamMember['role']>('all')
  const membersTabRef = useRef<HTMLButtonElement>(null)
  const aiTabRef = useRef<HTMLButtonElement>(null)
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'members' : event.key === 'End' ? 'ai' : tab === 'members' ? 'ai' : 'members'
    setTab(next)
    if (next === 'members') membersTabRef.current?.focus()
    else aiTabRef.current?.focus()
  }
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const visibleMembers = members.filter(member => {
    const matchesQuery = !normalizedQuery || `${member.name} ${member.email}`.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normalizedQuery)
    return matchesQuery && (roleFilter === 'all' || member.role === roleFilter)
  })
  const hasFilters = query.length > 0 || roleFilter !== 'all'

  return <section className={`team-roster-panel${compact ? ' is-people-page' : ''}`} aria-label="Configurações da equipe">
    <div className="team-roster-tabs" role="tablist" aria-label="Configurações de pessoas">
      <button ref={membersTabRef} type="button" role="tab" id="team-roster-members-tab" tabIndex={tab === 'members' ? 0 : -1} aria-selected={tab === 'members'} aria-controls="team-roster-members" onKeyDown={handleTabKeyDown} onClick={() => setTab('members')}>{compact ? 'Membros' : 'Integrantes'}</button>
      <button ref={aiTabRef} type="button" role="tab" id="team-roster-ai-tab" tabIndex={tab === 'ai' ? 0 : -1} aria-selected={tab === 'ai'} aria-controls="team-roster-ai" onKeyDown={handleTabKeyDown} onClick={() => setTab('ai')}>Uso de IA</button>
    </div>
    {banner}
    {tab === 'members' ? <div id="team-roster-members" role="tabpanel" aria-labelledby="team-roster-members-tab" className="team-roster-content">
      {!compact && <div className="team-roster-filters">
        <label className="team-roster-search-label" htmlFor="team-roster-search">Buscar integrantes</label>
        <input id="team-roster-search" className="team-roster-search" type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Nome ou e-mail" />
        <label className="team-roster-role-label" htmlFor="team-roster-role-filter">Função</label>
        <select id="team-roster-role-filter" className="team-roster-role-filter" value={roleFilter} onChange={event => setRoleFilter(event.currentTarget.value as typeof roleFilter)}>
          <option value="all">Todas</option><option value="admin">Administrador</option><option value="member">Integrante</option>
        </select>
        {hasFilters && <button type="button" className="team-roster-clear" onClick={() => { setQuery(''); setRoleFilter('all') }}>Limpar filtros</button>}
        <span className="team-roster-result-count" aria-live="polite">{visibleMembers.length} de {members.length} integrantes</span>
      </div>}
      <div className="team-roster-scroll">
        <table className="team-roster-table">
          <thead><tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Função na equipe</th>{onBrandDesignerChange && <th scope="col">Marca</th>}<th scope="col">Grupos</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{visibleMembers.map(member => {
            const isSelf = member.id === currentUserId
            const canManage = teamRole === 'admin' && !isSelf
            const disabled = busyMemberId === member.id
            return <tr key={member.id}>
              <th scope="row"><span className="team-roster-name"><span className="team-roster-avatar" aria-hidden="true">{member.name.slice(0, 1).toLocaleUpperCase()}</span>{member.name}{isSelf && <span className="team-roster-you">Você</span>}</span></th>
              <td>{member.email}</td>
              <td><select aria-label={`Papel de ${member.name}`} value={member.role} disabled={!canManage || disabled} onChange={event => onRoleChange(member, event.currentTarget.value as RemoteTeamMember['role'])}><option value="admin">Administrador</option><option value="member">Integrante</option></select></td>
              {onBrandDesignerChange && <td><label className="team-roster-brand-designer"><input type="checkbox" aria-label={`Designer de marca de ${member.name}`} checked={Boolean(member.brandDesigner)} disabled={teamRole !== 'admin' || disabled} onChange={event => onBrandDesignerChange(member, event.currentTarget.checked)} /><span>Designer</span></label></td>}
              <td>{groupsByMember[member.id]?.length ? <span className="team-roster-groups" aria-label={`Grupos: ${groupsByMember[member.id].join(', ')}`}>{groupsByMember[member.id].join(', ')}</span> : <span className="team-roster-no-groups" aria-label="Nenhum grupo">—</span>}</td>
              <td>{(isSelf || teamRole === 'admin') && <button type="button" className="team-roster-remove" disabled={disabled} onClick={() => onRemove(member)}>{disabled ? 'Aguarde…' : isSelf ? 'Sair' : 'Remover'}</button>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {members.length === 0 && <p className="team-roster-empty">Nenhum integrante nesta equipe.</p>}
      {members.length > 0 && visibleMembers.length === 0 && <p className="team-roster-empty" role="status">Nenhum integrante corresponde aos filtros. <button type="button" onClick={() => { setQuery(''); setRoleFilter('all') }}>Limpar filtros</button></p>}
    </div> : <div id="team-roster-ai" role="tabpanel" aria-labelledby="team-roster-ai-tab" className="team-roster-ai-panel">
      <strong>Uso de IA</strong><p>Os dados de uso de IA ainda não estão disponíveis para esta equipe.</p>
    </div>}
  </section>
}
