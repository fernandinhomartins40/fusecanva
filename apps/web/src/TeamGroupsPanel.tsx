import { useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronDown, MoreHorizontal, Plus, Search, UsersRound, X } from 'lucide-react'
import './TeamGroupsPanel.css'

/** A team group and its current members, supplied by the owning page. */
export type TeamGroupItem = {
  id: string
  name: string
  members: TeamGroupMember[]
  createdAt?: string
  updatedAt?: string
}

/** Minimal member shape needed by the group manager. */
export type TeamGroupMember = {
  id: string
  name: string
  email: string
  role?: 'admin' | 'member'
}

export type TeamGroupsPanelProps = {
  groups: TeamGroupItem[]
  members: TeamGroupMember[]
  teamName?: string
  teamRole: 'admin' | 'member'
  loading?: boolean
  busyKey?: string | null
  error?: string
  notice?: string
  onCreate: (name: string) => void | Promise<void>
  onRename: (groupId: string, name: string) => void | Promise<void>
  onDelete: (groupId: string) => void | Promise<void>
  onMembersChange: (groupId: string, userIds: string[]) => void | Promise<void>
}

/** Team scoped group management UI. Persistence and authorization stay in the parent/API. */
export function TeamGroupsPanel({ groups, members, teamName, teamRole, loading = false, busyKey, error: externalError, notice: externalNotice, onCreate, onRename, onDelete, onMembersChange }: TeamGroupsPanelProps) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [openGroupId, setOpenGroupId] = useState<string | null>(groups[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canManage = teamRole === 'admin'

  useEffect(() => {
    if (openGroupId && groups.some(group => group.id === openGroupId)) return
    if (groups.length) setOpenGroupId(groups[0].id)
  }, [groups, openGroupId])

  const normalize = (value: string) => value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const visibleMembers = members.filter(member => !query || normalize(`${member.name} ${member.email}`).includes(normalize(query)))

  async function perform(key: string, action: () => void | Promise<void>, success: string) {
    if (busy || busyKey) return
    setBusy(key)
    setError('')
    setNotice('')
    try { await action(); setNotice(success) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as alterações.') }
    finally { setBusy(null) }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newName.trim()
    if (!name || !canManage) return
    await perform('create', async () => { await onCreate(name); setNewName('') }, `Grupo “${name}” criado.`)
  }

  async function saveRename(groupId: string) {
    const name = editingName.trim()
    if (!name || !canManage) return
    await perform(`rename:${groupId}`, async () => { await onRename(groupId, name); setEditingId(null); setEditingName('') }, `Grupo renomeado para “${name}”.`)
  }

  async function deleteGroup(group: TeamGroupItem) {
    if (!canManage || busy || busyKey || !window.confirm(`Excluir o grupo “${group.name}”?`)) return
    await perform(`delete:${group.id}`, () => onDelete(group.id), `Grupo “${group.name}” excluído.`)
    if (openGroupId === group.id) setOpenGroupId(null)
  }

  const isBusy = Boolean(busy || busyKey)
  const groupError = externalError || error
  const groupNotice = externalNotice || notice

  return <section className="team-groups-panel" aria-labelledby="team-groups-title">
    <header className="team-groups-heading">
      <div><p className="team-groups-eyebrow">Pessoas e permissões</p><h2 id="team-groups-title">Grupos</h2>
        <p className="team-groups-description">Organize as pessoas{teamName ? ` de ${teamName}` : ''} em grupos para facilitar o trabalho em equipe.</p>
      </div>
      <span className="team-groups-total"><UsersRound size={17} aria-hidden="true" />{groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}</span>
    </header>

    {canManage && <form className="team-groups-create" onSubmit={event => void createGroup(event)}>
      <label htmlFor="team-groups-new-name">Criar grupo</label>
      <div><input id="team-groups-new-name" type="text" maxLength={80} required value={newName} onChange={event => setNewName(event.currentTarget.value)} placeholder="Ex.: Marketing" disabled={isBusy} />
        <button type="submit" disabled={isBusy || !newName.trim()}><Plus size={17} aria-hidden="true" />Criar grupo</button></div>
    </form>}

    {(groupError || groupNotice) && <p className={`team-groups-feedback${groupError ? ' is-error' : ''}`} role={groupError ? 'alert' : 'status'}>{groupError || groupNotice}</p>}

    {loading ? <p className="team-groups-state" role="status">Carregando grupos…</p>
      : groups.length === 0 ? <div className="team-groups-empty"><span><UsersRound size={22} aria-hidden="true" /></span><h3>Nenhum grupo ainda</h3><p>Crie grupos para organizar a colaboração da equipe.</p></div>
        : <div className="team-groups-list" aria-label="Grupos da equipe">
          {groups.map(group => {
            const expanded = openGroupId === group.id
            const editing = editingId === group.id
            const assignedIds = new Set(group.members.map(member => member.id))
            return <article className={`team-group-card${expanded ? ' is-expanded' : ''}`} key={group.id}>
              <div className="team-group-summary">
                <button type="button" className="team-group-expand" aria-expanded={expanded} aria-controls={`team-group-members-${group.id}`} onClick={() => setOpenGroupId(expanded ? null : group.id)}>
                  <ChevronDown size={18} aria-hidden="true" />
                  <span className="team-group-icon"><UsersRound size={18} aria-hidden="true" /></span>
                  <span className="team-group-title-wrap"><strong>{group.name}</strong><small>{group.members.length} {group.members.length === 1 ? 'integrante' : 'integrantes'}</small></span>
                </button>
                {canManage && <div className="team-group-actions">
                  <button type="button" className="team-group-action" aria-label={`Renomear ${group.name}`} title="Renomear grupo" disabled={isBusy} onClick={() => { setEditingId(group.id); setEditingName(group.name) }}><MoreHorizontal size={19} aria-hidden="true" /></button>
                  <button type="button" className="team-group-delete" disabled={isBusy} onClick={() => void deleteGroup(group)}>Excluir</button>
                </div>}
              </div>
              {editing && <form className="team-group-rename" onSubmit={event => { event.preventDefault(); void saveRename(group.id) }}>
                <label className="sr-only" htmlFor={`team-group-rename-${group.id}`}>Novo nome de {group.name}</label>
                <input id={`team-group-rename-${group.id}`} type="text" maxLength={80} required autoFocus value={editingName} onChange={event => setEditingName(event.currentTarget.value)} disabled={busy === `rename:${group.id}`} />
                <button type="submit" className="team-group-save" disabled={isBusy || !editingName.trim()}><Check size={16} aria-hidden="true" /><span className="sr-only">Salvar nome</span></button>
                <button type="button" className="team-group-cancel" aria-label="Cancelar renomeação" disabled={isBusy} onClick={() => setEditingId(null)}><X size={16} aria-hidden="true" /></button>
              </form>}
              {expanded && <div className="team-group-members" id={`team-group-members-${group.id}`}>
                <div className="team-group-members-heading"><div><h3>Integrantes do grupo</h3><p>Selecione quem faz parte deste grupo.</p></div>
                  <label className="team-groups-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Buscar integrantes</span><input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Buscar pessoas" /></label>
                </div>
                {members.length === 0 ? <p className="team-groups-state">Ainda não há integrantes na equipe.</p>
                  : visibleMembers.length === 0 ? <p className="team-groups-state">Nenhuma pessoa corresponde à busca.</p>
                    : <ul>{visibleMembers.map(member => {
                      const checked = assignedIds.has(member.id)
                      const toggleKey = `member:${group.id}:${member.id}`
                      return <li key={member.id}><label className="team-group-member">
                        <input type="checkbox" checked={checked} disabled={!canManage || isBusy} onChange={event => {
                          const nextChecked = event.currentTarget.checked
                          const nextIds = nextChecked ? [...assignedIds, member.id] : [...assignedIds].filter(id => id !== member.id)
                          void perform(toggleKey, () => onMembersChange(group.id, nextIds), nextChecked ? `${member.name} adicionado(a) ao grupo.` : `${member.name} removido(a) do grupo.`)
                        }} />
                        <span className="team-group-member-avatar" aria-hidden="true">{member.name.trim().slice(0, 1).toLocaleUpperCase('pt-BR') || '?'}</span>
                        <span className="team-group-member-copy"><strong>{member.name}</strong><small>{member.email}</small></span>
                      </label></li>
                    })}</ul>}
              </div>}
            </article>
          })}
        </div>}
    {!canManage && <p className="team-groups-readonly">Somente administradores podem gerenciar grupos e integrantes.</p>}
  </section>
}
