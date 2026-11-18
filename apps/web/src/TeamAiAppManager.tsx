import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Cloud, FileText, FolderOpen, MoreHorizontal, Search, ShieldCheck, X } from 'lucide-react'
import './TeamAiAppManager.css'

const AI_TEAM_APPS = [
  'Google Drive', 'Outlook', 'Zoom', 'Gmail', 'Notion', 'Google Calendar', 'Asana', 'Slack',
  'Financial Datasets', 'Atlassian', 'Microsoft 365', 'Monday.com', 'Microsoft Teams', 'Linear',
  'HubSpot Data', 'Granola', 'Airtable', 'Miro',
]

export function TeamAiAppManager() {
  const [query, setQuery] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [detailsApp, setDetailsApp] = useState<string | null>(null)
  const [carouselPage, setCarouselPage] = useState(0)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const closeDetailsRef = useRef<HTMLButtonElement | null>(null)
  const rows = useMemo(() => AI_TEAM_APPS.filter(name => name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))), [query])

  useEffect(() => {
    if (detailsApp) closeDetailsRef.current?.focus()
  }, [detailsApp])

  useEffect(() => {
    if (!openMenu) return
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpenMenu(null)
        menuTriggerRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const delta = event.key === 'ArrowDown' ? 1 : -1
      items[(current + delta + items.length) % items.length].focus()
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node) || menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [openMenu])

  function closeDetails() {
    setDetailsApp(null)
    requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  function openDetails(name: string) {
    returnFocusRef.current = menuTriggerRef.current
    setOpenMenu(null)
    setCarouselPage(0)
    setDetailsApp(name)
  }

  return <main className="team-ai-manager-shell">
    <header className="team-ai-manager-topbar"><a href="/">Página de início do Canva</a><span>Configurações da equipe</span></header>
    <div className="team-ai-manager-content">
      <nav aria-label="Navegação de apps"><a href="/settings/apps">Apps</a><span aria-hidden="true">/</span><span aria-current="page">Apps do Canva IA</span></nav>
      <h1>Apps do Canva IA</h1>
      <p>Gerencie os apps que podem aparecer como opções nas ferramentas de IA da equipe.</p>
      <div className="team-ai-manager-note">Catálogo administrativo observado. A presença de um app nesta lista não significa que uma conta externa esteja conectada.</div>
      <label className="team-ai-manager-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Pesquisar apps do Canva IA</span><input type="search" value={query} onChange={event => { setQuery(event.currentTarget.value); setOpenMenu(null) }} placeholder="Pesquisar apps do Canva IA" aria-label="Pesquisar apps do Canva IA" />{query && <button type="button" aria-label="Limpar busca" onClick={() => { setQuery(''); setOpenMenu(null) }}><X size={15} aria-hidden="true" /></button>}</label>
      <section className="team-ai-app-table" aria-label="Apps do Canva IA">
        <div className="team-ai-app-table-head"><span>App</span><span>Ações</span></div>
        {rows.map(name => <article className="team-ai-app-row" key={name}><span className="team-ai-app-mark" aria-hidden="true">{name.slice(0, 1)}</span><strong>{name}</strong><div className="team-ai-app-actions"><button type="button" aria-label={`Ações para ${name}`} aria-haspopup="menu" aria-expanded={openMenu === name} onClick={event => { menuTriggerRef.current = event.currentTarget; setOpenMenu(current => current === name ? null : name) }}><MoreHorizontal size={18} aria-hidden="true"/></button>{openMenu === name && <div ref={menuRef} className="team-ai-app-menu" role="menu" aria-label={`Ações para ${name}`}><button type="button" role="menuitem" aria-disabled="true" title="Ação administrativa ainda não conectada">Definir permissões</button>{name === 'Google Drive' ? <button type="button" role="menuitem" onClick={() => openDetails(name)}>Ver detalhes do app</button> : <button type="button" role="menuitem" aria-disabled="true" title="Detalhes ainda não auditados">Ver detalhes do app</button>}</div>}</div></article>)}
        {rows.length === 0 && <p className="team-ai-app-empty" role="status">Nenhum app encontrado</p>}
      </section>
      <p className="team-ai-app-count" role="status">{rows.length} {rows.length === 1 ? 'app' : 'apps'}</p>
    </div>
    {detailsApp && <div className="team-ai-details-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDetails() }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeDetails() } }}>
      <section className="team-ai-details-dialog" role="dialog" aria-modal="true" aria-labelledby="team-ai-details-title" aria-describedby="team-ai-details-description">
        <header className="team-ai-details-header"><div><span className="team-ai-details-kicker">APP PARA CANVA IA</span><h2 id="team-ai-details-title">{detailsApp}</h2></div><button ref={closeDetailsRef} type="button" aria-label="Fechar" title="Fechar" onClick={closeDetails}><X size={18} aria-hidden="true" /></button></header>
        <div className="team-ai-details-body">
          <div className="team-ai-details-provider"><span className="team-ai-provider-mark" aria-hidden="true">{detailsApp.slice(0, 1)}</span><span><small>Provedor</small><strong>{detailsApp}</strong></span><span className="team-ai-connection-state">Não conectado</span></div>
          <div className="team-ai-promo" aria-label={`Imagem promocional ${carouselPage + 1} de 2`}>
            {carouselPage === 0 ? <div className="team-ai-promo-scene team-ai-promo-drive"><div className="team-ai-promo-orbit"><Cloud size={37} aria-hidden="true" /><FolderOpen size={34} aria-hidden="true" /></div><strong>Seus arquivos, prontos para trabalhar</strong><span>Google Drive · Canva IA</span></div> : <div className="team-ai-promo-scene team-ai-promo-design"><div className="team-ai-promo-files"><span><FileText size={20} aria-hidden="true" /></span><span><FileText size={20} aria-hidden="true" /></span><span><ShieldCheck size={21} aria-hidden="true" /></span></div><strong>Encontre e use arquivos em seus designs</strong><span>Acesso sujeito às permissões exibidas</span></div>}
          </div>
          <div className="team-ai-promo-controls"><button type="button" aria-label="Imagem promocional anterior" disabled={carouselPage === 0} onClick={() => setCarouselPage(0)}><ArrowLeft size={16} aria-hidden="true" /></button><span aria-live="polite">{carouselPage + 1} de 2</span><button type="button" aria-label="Próxima imagem promocional" disabled={carouselPage === 1} onClick={() => setCarouselPage(1)}><ArrowRight size={16} aria-hidden="true" /></button></div>
          <h3>Permissões de design</h3><p id="team-ai-details-description">Ao usar este app, ele poderá:</p><ul className="team-ai-permissions"><li>Ler e alterar o conteúdo do design</li><li>Acessar as mídias carregadas no Canva e fazer upload de novos arquivos em seu nome</li></ul>
          <p className="team-ai-details-disclosure">O provedor não está conectado nesta demonstração. Nenhum arquivo foi acessado ou enviado.</p>
        </div>
        <footer className="team-ai-details-footer"><span>Conecte o provedor para habilitar o uso.</span><button type="button" disabled title="Conexão externa indisponível nesta demonstração">Usar no Canva IA</button></footer>
      </section>
    </div>}
  </main>
}
