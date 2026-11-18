import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Aperture, Bell, Check, ChevronDown, CircleHelp, Folder, House, Image, LayoutGrid, Mail, MoreHorizontal, Plus, Settings2, Shapes, Sparkles, Upload, UsersRound, X, Users } from 'lucide-react'
import { StudioApiError, createRemoteTeamInvitation, createRemoteTeamGroup, deleteRemoteTeamGroup, getRemoteTeam, getSession, listRemoteTeamGroups, listRemoteTeams, removeRemoteTeamMember, setRemoteTeamGroupMembers, setRemoteTeamMemberBrandDesigner, setRemoteTeamMemberRole, subscribeRemoteTeam, subscribeRemoteTeams, updateRemoteTeam, updateRemoteTeamGroup, type RemoteTeam, type RemoteTeamGroup, type RemoteTeamMember, type StudioUser } from './api'
import { TeamRosterPanel } from './TeamRosterPanel'
import { TeamGroupsPanel } from './TeamGroupsPanel'
import { TeamProfilePanel } from './TeamProfilePanel'
import './TeamPeopleSettingsPage.css'

type TeamPeopleSettingsPageProps = {
  user: StudioUser | null
  teams: RemoteTeam[]
  loading: boolean
}

function subscribeToTeamRefresh(teamId: string, onEvent: (type: string) => void) {
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = () => {}
  unsubscribe = subscribeRemoteTeam(teamId, event => {
    if (!active) return
    onEvent(event.type)
    if (event.type === 'auth.expired' || event.type === 'access.revoked') { active = false; if (timer) clearTimeout(timer); unsubscribe(); return }
    if (event.type !== 'team.updated' && event.type !== 'ready' && event.type !== 'resume') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; if (active) onEvent('refresh') }, 100)
  })
  return () => { active = false; if (timer) clearTimeout(timer); unsubscribe() }
}

const primaryItems = [
  { label: 'Criar', icon: Plus, href: '/' },
  { label: 'Canva IA', icon: Sparkles, href: '/settings/apps/manage-ai-apps' },
  { label: 'Início', icon: House, href: '/' },
  { label: 'Projetos', icon: Folder, href: '/#home-projects' },
  { label: 'Modelos', icon: LayoutGrid, href: '/?templates=1' },
  { label: 'Marca', icon: Aperture, href: '/' },
  { label: 'Uploads', icon: Upload, href: '/' },
  { label: 'Apps', icon: Shapes, href: '/apps' },
]

export function TeamPeopleSettingsPage({ user, teams, loading }: TeamPeopleSettingsPageProps) {
  const [teamId, setTeamId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('team'))
  const [members, setMembers] = useState<RemoteTeamMember[]>([])
  const [groupsByMember, setGroupsByMember] = useState<Record<string, string[]>>({})
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const team = teams.find(candidate => candidate.id === teamId) ?? null
  const teamSettingsHref = (path: string) => team ? `${path}?team=${encodeURIComponent(team.id)}` : path

  useEffect(() => {
    if (!teams.length) { if (teamId) setTeamId(null); return }
    const requested = new URLSearchParams(window.location.search).get('team')
    const next = teams.some(candidate => candidate.id === requested) ? requested! : teams[0].id
    if (next !== teamId) setTeamId(next)
  }, [teams, teamId])

  useEffect(() => {
    if (!teamId || !user) { setMembers([]); setGroupsByMember({}); return }
    let cancelled = false
    setDetailsBusy(true)
    setError('')
    Promise.all([getRemoteTeam(teamId), listRemoteTeamGroups(teamId)])
      .then(([result, groups]) => {
        if (cancelled) return
        setMembers(result.members)
        setGroupsByMember(Object.fromEntries(result.members.map(member => [member.id, groups.filter(group => group.members.some(item => item.id === member.id)).map(group => group.name)])))
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as pessoas da equipe.') })
      .finally(() => { if (!cancelled) setDetailsBusy(false) })
    return () => { cancelled = true }
  }, [teamId, user])

  useEffect(() => {
    if (!teamId || !user) return
    let active = true
    const unsubscribe = subscribeToTeamRefresh(teamId, type => {
      if (!active) return
      if (type === 'auth.expired') { setError('Sua sessão expirou. Entre novamente para continuar.'); return }
      if (type === 'access.revoked') { active = false; setMembers([]); setGroupsByMember({}); setError('Você não tem mais acesso a esta equipe.'); return }
      if (type !== 'refresh') return
      void Promise.all([getRemoteTeam(teamId), listRemoteTeamGroups(teamId)]).then(([result, groups]) => {
        if (!active) return
        setMembers(result.members)
        setGroupsByMember(Object.fromEntries(result.members.map(member => [member.id, groups.filter(group => group.members.some(item => item.id === member.id)).map(group => group.name)])))
      }).catch(reason => { if (!active) return; if (reason instanceof StudioApiError && reason.status === 404) { active = false; unsubscribe(); setMembers([]); setGroupsByMember({}); setError('Você não tem mais acesso a esta equipe.'); return } setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar as pessoas da equipe.') })
    })
    return () => { active = false; unsubscribe() }
  }, [teamId, user])

  function selectTeam(nextId: string) {
    setTeamId(nextId)
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('team', nextId)
    window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
  }

  async function refreshMembers(id = teamId) {
    if (!id) return
    const result = await getRemoteTeam(id)
    setMembers(result.members)
    const groups = await listRemoteTeamGroups(id)
    setGroupsByMember(Object.fromEntries(result.members.map(member => [member.id, groups.filter(group => group.members.some(item => item.id === member.id)).map(group => group.name)])))
  }

  async function changeRole(member: RemoteTeamMember, role: RemoteTeamMember['role']) {
    if (!teamId || busyMemberId) return
    setBusyMemberId(member.id)
    setError('')
    try { await setRemoteTeamMemberRole(teamId, member.id, role); await refreshMembers() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o papel.') }
    finally { setBusyMemberId(null) }
  }

  async function changeBrandDesigner(member: RemoteTeamMember, brandDesigner: boolean) {
    if (!teamId || busyMemberId || team?.role !== 'admin') return
    setBusyMemberId(member.id)
    setError('')
    setNotice('')
    try {
      await setRemoteTeamMemberBrandDesigner(teamId, member.id, brandDesigner)
      await refreshMembers()
      setNotice(brandDesigner ? `${member.name} foi designado(a) como designer de marca.` : `A designação de designer de marca de ${member.name} foi removida.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível alterar a designação de marca.') }
    finally { setBusyMemberId(null) }
  }

  async function removeMember(member: RemoteTeamMember) {
    if (!teamId || busyMemberId || !window.confirm(`${member.id === user?.id ? 'Sair da equipe' : 'Remover integrante'}: ${member.name}?`)) return
    setBusyMemberId(member.id)
    setError('')
    try { await removeRemoteTeamMember(teamId, member.id); await refreshMembers() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar as pessoas da equipe.') }
    finally { setBusyMemberId(null) }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!teamId || !inviteEmail.trim() || inviteBusy) return
    setInviteBusy(true)
    setError('')
    setNotice('')
    try {
      const invitation = await createRemoteTeamInvitation(teamId, inviteEmail.trim())
      const url = new URL(window.location.href)
      url.searchParams.set('teamInvite', invitation.token)
      setInviteLink(url.toString())
      setNotice(invitation.delivery.status === 'sent' ? 'Convite enviado por e-mail. Você também pode compartilhar o link.' : 'Convite criado. Compartilhe o link com a pessoa.')
      setInviteEmail('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível convidar essa pessoa.') }
    finally { setInviteBusy(false) }
  }

  return <main className="people-settings-shell">
    <aside className="people-primary-rail" aria-label="Navegação principal">
      <a className="people-rail-logo" href="/" aria-label="Fuse Studio, início"><span>f</span></a>
      <nav>{primaryItems.map(item => <a key={item.label} href={item.href} className={item.label === 'Canva IA' ? 'is-featured' : ''} aria-label={item.label}><item.icon size={21} aria-hidden="true" /><span>{item.label}</span></a>)}<a href="/" aria-label="Mais"><MoreHorizontal size={21} aria-hidden="true" /><span>Mais</span></a></nav>
    </aside>
    <aside className="people-settings-nav" aria-label="Navegação de configurações da equipe">
      <a className="people-settings-invite-shortcut" href="#invite" onClick={event => { event.preventDefault(); setInviteOpen(true) }}><UsersRound size={18} aria-hidden="true" />Convidar pessoas</a>
      <span className="people-nav-kicker">Gestão de pessoas</span>
      <a className="is-current" href="/settings/people" aria-current="page"><UsersRound size={19} aria-hidden="true" />Pessoas{team ? ` (${team.memberCount})` : ''}</a>
      <a href={teamSettingsHref('/settings/groups')}><Users size={19} aria-hidden="true" />Grupos</a>
      <a href={teamSettingsHref('/settings/team-profile')}><Settings2 size={19} aria-hidden="true" />Perfil da equipe</a>
      <span className="people-nav-kicker">Pagamentos e planos</span>
      <a href={teamSettingsHref('/settings/permissions')}><Image size={19} aria-hidden="true" />Cobrança</a>
      <span className="people-nav-kicker">Controles e permissões</span>
      <a href={teamSettingsHref('/settings/permissions')}><Check size={19} aria-hidden="true" />Permissões</a>
      <a href={teamSettingsHref('/settings/controls')}><Settings2 size={19} aria-hidden="true" />Controles</a>
      <span className="people-nav-kicker">Gerenciamento de apps</span>
      <a href="/settings/apps/manage-ai-apps"><Sparkles size={19} aria-hidden="true" />Apps</a>
    </aside>
    <section className="people-settings-main">
      <div className="people-settings-content">
        <details className="people-mobile-settings"><summary>Configurações da equipe</summary><nav aria-label="Configurações da equipe"><a href={teamSettingsHref('/settings/people')} aria-current="page">Pessoas</a><a href={teamSettingsHref('/settings/groups')}>Grupos</a><a href={teamSettingsHref('/settings/permissions')}>Permissões</a><a href={teamSettingsHref('/settings/controls')}>Controles</a><a href="/settings/apps/manage-ai-apps">Apps</a></nav></details>
        <header className="people-page-heading">
          {teams.length > 1 && <label className="people-team-picker">Equipe<select aria-label="Equipe" value={team?.id ?? ''} onChange={event => selectTeam(event.currentTarget.value)}>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>}
          <h1>Pessoas{team ? ` (${team.memberCount})` : ''}</h1>
        </header>
        {!user ? <section className="people-page-state"><h2>Entre para ver as pessoas da equipe</h2><p>Faça login na página inicial para abrir as configurações das equipes às quais você tem acesso.</p><a href="/">Voltar ao início</a></section>
          : loading ? <p className="people-page-loading" role="status">Carregando equipes…</p>
            : !teams.length ? <section className="people-page-state"><h2>Nenhuma equipe disponível</h2><p>Quando você fizer parte de uma equipe, as pessoas aparecerão aqui.</p></section>
              : !team ? <p className="people-page-loading" role="status">Carregando pessoas…</p>
                : <>
                  <TeamRosterPanel
                    compact
                    members={members}
                    groupsByMember={groupsByMember}
                    currentUserId={user.id}
                    teamRole={team.role}
                    busyMemberId={busyMemberId}
                    onRoleChange={(member, role) => void changeRole(member, role)}
                    onBrandDesignerChange={(member, brandDesigner) => void changeBrandDesigner(member, brandDesigner)}
                    onRemove={member => void removeMember(member)}
                    banner={<section className="people-collaboration-banner" aria-label="Colaboração em equipe">
                      <div className="people-banner-copy"><h2>Grandes ideias devem ser compartilhadas</h2><p>Estimule a colaboração e a criatividade e alcance resultados mais rápido.</p><div><button type="button" className="people-invite-button" onClick={() => setInviteOpen(true)}>Convidar pessoas</button><button type="button" className="people-seats-button" disabled title="A gestão de licenças requer configuração de cobrança">Adicionar licenças</button></div></div>
                      <div className="people-banner-art" aria-hidden="true"><span className="people-art-orbit"><UsersRound size={50} /></span><Mail size={44} className="people-art-mail" /></div>
                    </section>}
                  />
                  {(detailsBusy || error || notice) && <div className="people-page-feedback" role={error ? 'alert' : 'status'}>{detailsBusy ? 'Atualizando pessoas…' : error || notice}</div>}
                </>}
        <footer className="people-page-footer"><a href="/" aria-label="Ajuda"><CircleHelp size={18} aria-hidden="true" />Ajuda</a><button type="button" aria-label="Notificações"><Bell size={18} aria-hidden="true" /></button></footer>
      </div>
    </section>
    {inviteOpen && team && <div className="people-invite-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setInviteOpen(false) }}><section className="people-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="people-invite-title"><button type="button" aria-label="Fechar convite" className="people-invite-close" onClick={() => setInviteOpen(false)}><X size={18} aria-hidden="true" /></button><h2 id="people-invite-title">Convidar pessoas</h2><p>Convide alguém para participar de {team.name}.</p><form onSubmit={event => void createInvitation(event)}><label htmlFor="people-invite-email">E-mail<input id="people-invite-email" type="email" autoComplete="email" required value={inviteEmail} onChange={event => setInviteEmail(event.currentTarget.value)} /></label><button type="submit" disabled={inviteBusy || team.role !== 'admin'}>{inviteBusy ? 'Enviando…' : 'Criar convite'}</button></form>{inviteLink && <label className="people-invite-link">Link do convite<input readOnly value={inviteLink} onFocus={event => event.currentTarget.select()} /></label>}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}</section></div>}
  </main>
}

export function TeamGroupsSettingsRoute() {
  const [teams, setTeams] = useState<RemoteTeam[]>([])
  const teamsRef = useRef(teams)
  useEffect(() => { teamsRef.current = teams }, [teams])
  const [user, setUser] = useState<StudioUser | null>(null)
  const [teamId, setTeamId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('team'))
  const [members, setMembers] = useState<RemoteTeamMember[]>([])
  const [groups, setGroups] = useState<RemoteTeamGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const team = teams.find(candidate => candidate.id === teamId) ?? null

  useEffect(() => {
    let cancelled = false
    getSession().then(async current => {
      if (cancelled) return
      setUser(current)
      const available = await listRemoteTeams()
      if (cancelled) return
      setTeams(available)
      const requested = new URLSearchParams(window.location.search).get('team')
      setTeamId(available.some(candidate => candidate.id === requested) ? requested : available[0]?.id ?? null)
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as equipes.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!teamId || !user) { setMembers([]); setGroups([]); return }
    let cancelled = false
    setDetailsBusy(true)
    setError('')
    Promise.all([getRemoteTeam(teamId), listRemoteTeamGroups(teamId)]).then(([teamResult, nextGroups]) => {
      if (cancelled) return
      setMembers(teamResult.members)
      setGroups(nextGroups)
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os grupos.') }).finally(() => { if (!cancelled) setDetailsBusy(false) })
    return () => { cancelled = true }
  }, [teamId, user])

  useEffect(() => {
    if (!teamId || !user) return
    let active = true
    const unsubscribe = subscribeToTeamRefresh(teamId, type => {
      if (!active) return
      if (type === 'auth.expired') { setError('Sua sessão expirou. Entre novamente para continuar.'); return }
      if (type === 'access.revoked') { active = false; const remaining = teamsRef.current.filter(candidate => candidate.id !== teamId); setTeams(remaining); setTeamId(remaining[0]?.id ?? null); setMembers([]); setGroups([]); setError('Você não tem mais acesso a esta equipe.'); return }
      if (type !== 'refresh') return
      void Promise.all([getRemoteTeam(teamId), listRemoteTeamGroups(teamId), listRemoteTeams()]).then(([result, nextGroups, nextTeams]) => {
        if (!active) return
        setMembers(result.members); setGroups(nextGroups); setTeams(nextTeams)
      }).catch(reason => { if (!active) return; if (reason instanceof StudioApiError && reason.status === 404) { active = false; unsubscribe(); const remaining = teamsRef.current.filter(candidate => candidate.id !== teamId); setTeams(remaining); setTeamId(remaining[0]?.id ?? null); setMembers([]); setGroups([]); setError('Você não tem mais acesso a esta equipe.'); return } setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar os grupos.') })
    })
    return () => { active = false; unsubscribe() }
  }, [teamId, user])

  function selectTeam(nextId: string) {
    setTeamId(nextId)
    const url = new URL(window.location.href)
    url.searchParams.set('team', nextId)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  async function mutate(key: string, action: () => Promise<unknown>, success: string) {
    if (!teamId || busyKey) return
    setBusyKey(key); setError(''); setNotice('')
    try {
      await action()
      const nextGroups = await listRemoteTeamGroups(teamId)
      setGroups(nextGroups)
      setNotice(success)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as alterações dos grupos.') }
    finally { setBusyKey(null) }
  }

  const teamHref = (path: string) => team ? `${path}?team=${encodeURIComponent(team.id)}` : path
  return <main className="people-settings-shell">
    <aside className="people-primary-rail" aria-label="Navegação principal"><a className="people-rail-logo" href="/" aria-label="Fuse Studio, início"><span>f</span></a><nav>{primaryItems.map(item => <a key={item.label} href={item.href} className={item.label === 'Canva IA' ? 'is-featured' : ''} aria-label={item.label}><item.icon size={21} aria-hidden="true" /><span>{item.label}</span></a>)}<a href="/" aria-label="Mais"><MoreHorizontal size={21} aria-hidden="true" /><span>Mais</span></a></nav></aside>
    <aside className="people-settings-nav" aria-label="Navegação de configurações da equipe"><a className="people-settings-invite-shortcut" href={teamHref('/settings/people')}> <UsersRound size={18} aria-hidden="true" />Pessoas</a><span className="people-nav-kicker">Gestão de pessoas</span><a href={teamHref('/settings/people')}><UsersRound size={19} aria-hidden="true" />Pessoas{team ? ` (${team.memberCount})` : ''}</a><a className="is-current" href={teamHref('/settings/groups')} aria-current="page"><Users size={19} aria-hidden="true" />Grupos</a><a href={teamHref('/settings/team-profile')}><Settings2 size={19} aria-hidden="true" />Perfil da equipe</a><span className="people-nav-kicker">Pagamentos e planos</span><a href={teamHref('/settings/permissions')}><Image size={19} aria-hidden="true" />Cobrança</a><span className="people-nav-kicker">Controles e permissões</span><a href={teamHref('/settings/permissions')}><Check size={19} aria-hidden="true" />Permissões</a><a href={teamHref('/settings/controls')}><Settings2 size={19} aria-hidden="true" />Controles</a><span className="people-nav-kicker">Gerenciamento de apps</span><a href="/settings/apps/manage-ai-apps"><Sparkles size={19} aria-hidden="true" />Apps</a></aside>
    <section className="people-settings-main"><div className="people-settings-content"><details className="people-mobile-settings"><summary>Configurações da equipe</summary><nav aria-label="Configurações da equipe"><a href={teamHref('/settings/people')}>Pessoas</a><a href={teamHref('/settings/groups')} aria-current="page">Grupos</a><a href={teamHref('/settings/team-profile')}>Perfil da equipe</a><a href={teamHref('/settings/permissions')}>Permissões</a><a href={teamHref('/settings/controls')}>Controles</a><a href="/settings/apps/manage-ai-apps">Apps</a></nav></details><header className="people-page-heading">{teams.length > 1 && <label className="people-team-picker">Equipe<select aria-label="Equipe" value={team?.id ?? ''} onChange={event => selectTeam(event.currentTarget.value)}>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>}<h1>Grupos{team ? ` · ${team.name}` : ''}</h1></header>
      {!user ? <section className="people-page-state"><h2>Entre para gerenciar grupos</h2><p>Faça login para abrir as configurações das suas equipes.</p><a href="/">Voltar ao início</a></section> : loading ? <p className="people-page-loading" role="status">Carregando equipes…</p> : !teams.length ? <section className="people-page-state"><h2>Nenhuma equipe disponível</h2><p>Quando você fizer parte de uma equipe, poderá organizar pessoas em grupos.</p></section> : !team ? <p className="people-page-loading" role="status">Carregando equipe…</p> : <>
        <TeamGroupsPanel groups={groups} members={members} teamName={team.name} teamRole={team.role} loading={detailsBusy} busyKey={busyKey} error={error} notice={notice}
          onCreate={name => mutate('create', () => createRemoteTeamGroup(team.id, name), 'Grupo criado.')}
          onRename={(groupId, name) => mutate(`rename:${groupId}`, () => updateRemoteTeamGroup(team.id, groupId, name), 'Nome do grupo atualizado.')}
          onDelete={groupId => mutate(`delete:${groupId}`, () => deleteRemoteTeamGroup(team.id, groupId), 'Grupo excluído.')}
          onMembersChange={(groupId, userIds) => mutate(`members:${groupId}`, () => setRemoteTeamGroupMembers(team.id, groupId, userIds), 'Integrantes do grupo atualizados.')} />
      </>}
      <footer className="people-page-footer"><a href="/" aria-label="Ajuda"><CircleHelp size={18} aria-hidden="true" />Ajuda</a><button type="button" aria-label="Notificações"><Bell size={18} aria-hidden="true" /></button></footer></div></section>
  </main>
}

export function TeamProfileSettingsRoute() {
  const [teams, setTeams] = useState<RemoteTeam[]>([])
  const teamsRef = useRef(teams)
  useEffect(() => { teamsRef.current = teams }, [teams])
  const [user, setUser] = useState<StudioUser | null>(null)
  const [teamId, setTeamId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('team'))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const team = teams.find(candidate => candidate.id === teamId) ?? null

  useEffect(() => {
    let cancelled = false
    getSession().then(async current => {
      if (cancelled) return
      setUser(current)
      const available = await listRemoteTeams()
      if (cancelled) return
      setTeams(available)
      const requested = new URLSearchParams(window.location.search).get('team')
      setTeamId(available.some(candidate => candidate.id === requested) ? requested : available[0]?.id ?? null)
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as equipes.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!teamId || !user) return
    let active = true
    const unsubscribe = subscribeToTeamRefresh(teamId, type => {
      if (!active) return
      if (type === 'auth.expired') { setError('Sua sessão expirou. Entre novamente para continuar.'); return }
      if (type === 'access.revoked') { active = false; const remaining = teamsRef.current.filter(candidate => candidate.id !== teamId); setTeams(remaining); setTeamId(remaining[0]?.id ?? null); setError('Você não tem mais acesso a esta equipe.'); return }
      if (type !== 'refresh') return
      void listRemoteTeams().then(next => { if (!active) return; setTeams(next); if (!next.some(candidate => candidate.id === teamId)) { active = false; unsubscribe(); setTeamId(next[0]?.id ?? null); setError('Você não tem mais acesso a esta equipe.') } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a equipe.') })
    })
    return () => { active = false; unsubscribe() }
  }, [teamId, user])

  function selectTeam(nextId: string) {
    setTeamId(nextId)
    const url = new URL(window.location.href)
    url.searchParams.set('team', nextId)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  async function saveProfile(name: string) {
    if (!team || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const updated = await updateRemoteTeam(team.id, name)
      setTeams(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))
      setNotice('Nome da equipe atualizado.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil da equipe.')
      throw reason
    } finally { setBusy(false) }
  }

  const teamHref = (path: string) => team ? `${path}?team=${encodeURIComponent(team.id)}` : path
  return <main className="people-settings-shell">
    <aside className="people-primary-rail" aria-label="Navegação principal"><a className="people-rail-logo" href="/" aria-label="Fuse Studio, início"><span>f</span></a><nav>{primaryItems.map(item => <a key={item.label} href={item.href} className={item.label === 'Canva IA' ? 'is-featured' : ''} aria-label={item.label}><item.icon size={21} aria-hidden="true" /><span>{item.label}</span></a>)}<a href="/" aria-label="Mais"><MoreHorizontal size={21} aria-hidden="true" /><span>Mais</span></a></nav></aside>
    <aside className="people-settings-nav" aria-label="Navegação de configurações da equipe"><a className="people-settings-invite-shortcut" href={teamHref('/settings/people')}><UsersRound size={18} aria-hidden="true" />Pessoas</a><span className="people-nav-kicker">Gestão de pessoas</span><a href={teamHref('/settings/people')}><UsersRound size={19} aria-hidden="true" />Pessoas{team ? ` (${team.memberCount})` : ''}</a><a href={teamHref('/settings/groups')}><Users size={19} aria-hidden="true" />Grupos</a><a className="is-current" href={teamHref('/settings/team-profile')} aria-current="page"><Settings2 size={19} aria-hidden="true" />Perfil da equipe</a><span className="people-nav-kicker">Pagamentos e planos</span><a href={teamHref('/settings/permissions')}><Image size={19} aria-hidden="true" />Cobrança</a><span className="people-nav-kicker">Controles e permissões</span><a href={teamHref('/settings/permissions')}><Check size={19} aria-hidden="true" />Permissões</a><a href={teamHref('/settings/controls')}><Settings2 size={19} aria-hidden="true" />Controles</a><span className="people-nav-kicker">Gerenciamento de apps</span><a href="/settings/apps/manage-ai-apps"><Sparkles size={19} aria-hidden="true" />Apps</a></aside>
    <section className="people-settings-main"><div className="people-settings-content"><details className="people-mobile-settings"><summary>Configurações da equipe</summary><nav aria-label="Configurações da equipe"><a href={teamHref('/settings/people')}>Pessoas</a><a href={teamHref('/settings/groups')}>Grupos</a><a href={teamHref('/settings/team-profile')} aria-current="page">Perfil da equipe</a><a href={teamHref('/settings/permissions')}>Permissões</a><a href={teamHref('/settings/controls')}>Controles</a><a href="/settings/apps/manage-ai-apps">Apps</a></nav></details><header className="people-page-heading">{teams.length > 1 && <label className="people-team-picker">Equipe<select aria-label="Equipe" value={team?.id ?? ''} onChange={event => selectTeam(event.currentTarget.value)}>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>}<h1>Perfil da equipe</h1></header>
      {!user ? <section className="people-page-state"><h2>Entre para gerenciar a equipe</h2><p>Faça login para abrir as configurações das suas equipes.</p><a href="/">Voltar ao início</a></section> : loading ? <p className="people-page-loading" role="status">Carregando equipes…</p> : !teams.length ? <section className="people-page-state"><h2>Nenhuma equipe disponível</h2><p>Quando você fizer parte de uma equipe, os detalhes aparecerão aqui.</p></section> : !team ? <p className="people-page-loading" role="status">Carregando equipe…</p> : <TeamProfilePanel teamName={team.name} teamRole={team.role} busy={busy} error={error} notice={notice} onSave={saveProfile} />}
      <footer className="people-page-footer"><a href="/" aria-label="Ajuda"><CircleHelp size={18} aria-hidden="true" />Ajuda</a><button type="button" aria-label="Notificações"><Bell size={18} aria-hidden="true" /></button></footer></div></section>
  </main>
}

export function TeamPeopleSettingsRoute() {
  const [teams, setTeams] = useState<RemoteTeam[]>([])
  const [user, setUser] = useState<StudioUser | null>(null)
  const [loading, setLoading] = useState(true)
  const teamsGeneration = useRef(0)
  useEffect(() => {
    let cancelled = false
    getSession().then(async current => {
      if (cancelled) return
      setUser(current)
      const generation = ++teamsGeneration.current
      const next = await listRemoteTeams()
      if (!cancelled && generation === teamsGeneration.current) setTeams(next)
    }).catch(() => { if (!cancelled) setUser(null) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!user) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeRemoteTeams(event => {
      if (!active) return
      if (event.type === 'auth.expired') { active = false; teamsGeneration.current += 1; if (timer) clearTimeout(timer); return }
      if (event.type !== 'ready' && event.type !== 'resume' && event.type !== 'team.updated' && event.type !== 'access.revoked') return
      if (event.type === 'access.revoked') setTeams(current => current.filter(candidate => candidate.id !== event.teamId))
      if (timer) clearTimeout(timer)
      const generation = ++teamsGeneration.current
      timer = setTimeout(() => { timer = undefined; void listRemoteTeams().then(next => { if (active && generation === teamsGeneration.current) setTeams(next) }).catch(() => {}) }, 100)
    })
    return () => { active = false; teamsGeneration.current += 1; if (timer) clearTimeout(timer); stop() }
  }, [user])
  return <TeamPeopleSettingsPage user={user} teams={teams} loading={loading} />
}
