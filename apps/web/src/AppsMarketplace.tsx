import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, CircleAlert, Search, X } from 'lucide-react'
import { APP_CATEGORIES, APPS_AUDIT_COVERAGE, MARKETPLACE_APP_CATALOG, buildAppsRoute, filterApps, parseAppsRoute, type AppCategoryId, type MarketplaceApp } from './apps-catalog.mjs'
import { AppAdapterRegistry } from './app-adapters.mjs'
import './AppsMarketplace.css'

type Props = { onClose: () => void }

function readable(value: string) {
  return value
}

export function AppsMarketplace({ onClose }: Props) {
  const registry = useMemo(() => new AppAdapterRegistry({
    giphy: { enabled: true, adapter: 'sandbox-local', allowedCapabilities: ['media.read'] },
  }), [])
  const [route, setRoute] = useState(() => parseAppsRoute(window.location.href))
  const [selectedAppId, setSelectedAppId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('app'))
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [sandboxState, setSandboxState] = useState<'disconnected' | 'consent' | 'connected' | 'cancelled'>('disconnected')
  const [sandboxConsent, setSandboxConsent] = useState(false)
  const [sandboxQuery, setSandboxQuery] = useState('')
  const [sandboxResults, setSandboxResults] = useState<string[] | null>(null)
  const [sandboxMessage, setSandboxMessage] = useState('')
  const [savedAppIds, setSavedAppIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('fusecanva.apps.saved.v1') || '[]')
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
    } catch { return [] }
  })
  const [savedOnly, setSavedOnly] = useState(false)
  const selectedAppIdRef = useRef(selectedAppId)
  const focusCatalogAppIdRef = useRef<string | null>(null)
  useEffect(() => { selectedAppIdRef.current = selectedAppId }, [selectedAppId])
  const searchRef = useRef<HTMLInputElement>(null)
  const recommendationsRef = useRef<HTMLDivElement>(null)
  const [canScrollRecommendationsBack, setCanScrollRecommendationsBack] = useState(false)
  const [canScrollRecommendationsForward, setCanScrollRecommendationsForward] = useState(false)
  const selectedApp = MARKETPLACE_APP_CATALOG.find(app => app.id === selectedAppId) ?? null
  const apps = useMemo(() => {
    const matching = filterApps(MARKETPLACE_APP_CATALOG, route)
    return savedOnly ? matching.filter(app => savedAppIds.includes(app.id)) : matching
  }, [route, savedOnly, savedAppIds])
  const suggestions = useMemo(() => route.query.trim()
    ? filterApps(MARKETPLACE_APP_CATALOG, { category: 'all-apps', query: route.query, sort: 'name' }).slice(0, 5)
    : [], [route.query])

  useEffect(() => {
    if (selectedAppId) {
      document.querySelector<HTMLElement>('#apps-detail-title')?.focus()
      return
    }
    const returnToAppId = focusCatalogAppIdRef.current
    if (!returnToAppId) return
    const card = [...document.querySelectorAll<HTMLElement>('.apps-card-main')]
      .find(button => button.dataset.appId === returnToAppId)
    focusCatalogAppIdRef.current = null
    card?.focus()
  }, [selectedAppId])

  function updateRecommendationsScrollState() {
    const viewport = recommendationsRef.current
    if (!viewport) return
    setCanScrollRecommendationsBack(viewport.scrollLeft > 1)
    setCanScrollRecommendationsForward(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1)
  }

  useEffect(() => {
    if (route.category !== 'for-you') return
    const viewport = recommendationsRef.current
    if (!viewport) return
    viewport.scrollLeft = 0
    updateRecommendationsScrollState()
    const observer = new ResizeObserver(updateRecommendationsScrollState)
    observer.observe(viewport)
    observer.observe(viewport.firstElementChild ?? viewport)
    return () => observer.disconnect()
  }, [route.category, route.query, apps.length])

  function scrollRecommendations(direction: -1 | 1) {
    const viewport = recommendationsRef.current
    if (!viewport) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewport.scrollBy({ left: direction * Math.max(240, viewport.clientWidth * 0.86), behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  function handleRecommendationsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
    if (event.key === 'ArrowRight' && canScrollRecommendationsForward) { event.preventDefault(); scrollRecommendations(1) }
    if (event.key === 'ArrowLeft' && canScrollRecommendationsBack) { event.preventDefault(); scrollRecommendations(-1) }
  }

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const syncFromHistory = () => {
      const url = new URL(window.location.href)
      if (!url.pathname.startsWith('/your-apps')) {
        if (selectedAppIdRef.current === 'giphy') void registry.revoke('giphy')
        selectedAppIdRef.current = null
        setSandboxState('disconnected')
        setSandboxConsent(false)
        setSandboxResults(null)
        setSandboxMessage('')
        onClose()
        return
      }
      const nextSelectedAppId = url.searchParams.get('app')
      if (selectedAppIdRef.current !== nextSelectedAppId) {
        if (selectedAppIdRef.current && !nextSelectedAppId) focusCatalogAppIdRef.current = selectedAppIdRef.current
        if (selectedAppIdRef.current === 'giphy' && nextSelectedAppId !== 'giphy') void registry.revoke('giphy')
        selectedAppIdRef.current = nextSelectedAppId
        setSandboxState('disconnected')
        setSandboxConsent(false)
        setSandboxQuery('')
        setSandboxResults(null)
        setSandboxMessage('')
      }
      setRoute(parseAppsRoute(url))
      setSelectedAppId(nextSelectedAppId)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (selectedAppIdRef.current) {
        focusCatalogAppIdRef.current = selectedAppIdRef.current
        if (selectedAppIdRef.current === 'giphy') void registry.revoke('giphy')
        selectedAppIdRef.current = null
        setSelectedAppId(null)
        setSandboxState('disconnected')
        setSandboxConsent(false)
        setSandboxQuery('')
        setSandboxResults(null)
        setSandboxMessage('')
        window.history.pushState(window.history.state, '', buildAppsRoute(parseAppsRoute(window.location.href)))
      } else {
        const url = new URL(window.location.href)
        url.pathname = '/'
        url.searchParams.delete('app')
        window.history.pushState(window.history.state, '', `${url.pathname}${url.search}`)
        onClose()
      }
    }
    document.querySelector<HTMLElement>('.apps-back')?.focus()
    window.addEventListener('popstate', syncFromHistory)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('popstate', syncFromHistory)
      window.removeEventListener('keydown', onKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [onClose, registry])

  useEffect(() => () => { void registry.revoke('giphy') }, [registry])

  function updateRoute(next: { category?: AppCategoryId; query?: string; sort?: 'recommended' | 'name' }, replace = false) {
    const state = { ...route, ...next }
    setRoute(state)
    window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', buildAppsRoute(state))
  }

  function close() {
    const url = new URL(window.location.href)
    url.pathname = '/'
    url.searchParams.delete('app')
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}`)
    onClose()
  }

  function openApp(app: MarketplaceApp) {
    selectedAppIdRef.current = app.id
    setSelectedAppId(app.id)
    const url = new URL(window.location.href)
    url.searchParams.set('app', app.id)
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}`)
  }

  function backToCatalog() {
    focusCatalogAppIdRef.current = selectedAppIdRef.current
    if (selectedAppIdRef.current === 'giphy') void registry.revoke('giphy')
    selectedAppIdRef.current = null
    setSandboxState('disconnected'); setSandboxConsent(false); setSandboxResults(null); setSandboxMessage('')
    setSelectedAppId(null)
    window.history.pushState(window.history.state, '', buildAppsRoute(route))
  }

  async function connectSandbox(accepted: boolean) {
    const state = await registry.connect({ id: 'giphy', requestedCapabilities: ['media.read'] }, {
      accepted, capabilities: accepted && sandboxConsent ? ['media.read'] : [],
    })
    setSandboxState(state === 'connected' ? 'connected' : 'cancelled')
    setSandboxMessage(state === 'connected' ? 'Conectado somente ao sandbox local. Nenhum serviço externo foi acessado.' : 'Consentimento recusado. Nenhuma capacidade foi concedida.')
  }

  async function runSandboxSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const result = await registry.perform('giphy', 'catalog.search', sandboxQuery, {
        consent: { accepted: true, capabilities: ['media.read'] }, capability: 'media.read',
      }) as string[]
      setSandboxResults(result); setSandboxMessage(`${result.length} resultados locais encontrados.`)
    } catch { setSandboxResults([]); setSandboxMessage('A busca local não está disponível. Conecte o sandbox primeiro.') }
  }

  async function disconnectSandbox() {
    await registry.revoke('giphy')
    setSandboxState('disconnected'); setSandboxConsent(false); setSandboxResults(null)
    setSandboxMessage('Sandbox desconectado e permissões locais revogadas.')
  }

  function chooseSuggestion(app: MarketplaceApp) {
    updateRoute({ query: app.name }, true)
    setSuggestionsOpen(false)
    setActiveSuggestion(0)
    searchRef.current?.focus()
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateRoute({ query: route.query.trim() }, true)
    setSuggestionsOpen(false)
    setActiveSuggestion(0)
    searchRef.current?.blur()
  }

  function clearSearch() {
    updateRoute({ query: '' }, true)
    setSuggestionsOpen(false)
    setActiveSuggestion(0)
    searchRef.current?.focus()
  }

  function toggleSavedApp(appId: string) {
    setSavedAppIds(current => {
      const next = current.includes(appId) ? current.filter(id => id !== appId) : [...current, appId]
      try { window.localStorage.setItem('fusecanva.apps.saved.v1', JSON.stringify(next)) } catch { /* Browser storage may be unavailable. */ }
      return next
    })
  }

  function renderAppCard(app: MarketplaceApp, index: number) {
    const saved = savedAppIds.includes(app.id)
    return <article className="apps-card" key={app.id}>
      <button type="button" className="apps-card-main" data-app-id={app.id} onClick={() => openApp(app)}>
        <span className={`apps-card-icon apps-card-icon-${index % 5}`} aria-hidden="true">{app.name.slice(0, 1)}</span>
        <span className="apps-card-copy"><strong>{app.name}</strong><small>{app.provider}</small><span>{app.description}</span><em>Exemplo · não conectado</em></span>
        <ChevronRight className="apps-card-chevron" size={16} aria-hidden="true" />
      </button>
      <button type="button" className="apps-card-save" aria-label={`${saved ? 'Remover dos salvos' : 'Salvar'}: ${app.name}`} aria-pressed={saved} onClick={() => toggleSavedApp(app.id)}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /></button>
    </article>
  }

  return <main className="apps-marketplace" aria-label="Apps">
    <header className="apps-marketplace-topbar">
      <button type="button" className="apps-back" onClick={selectedApp ? backToCatalog : close} aria-label={selectedApp ? 'Voltar para todos os apps' : 'Fechar Apps'}>
        {selectedApp ? <ArrowLeft size={18} /> : <X size={18} />}
      </button>
      <span className="apps-brand-mark">f</span><strong>Apps</strong>
      <span className="apps-topbar-spacer" />
      <span className="apps-demo-status"><CircleAlert size={14} /> Catálogo de demonstração</span>
    </header>
    {selectedApp ? <section className="apps-detail" aria-labelledby="apps-detail-title">
      <button type="button" className="apps-detail-back" onClick={backToCatalog}><ArrowLeft size={16} /> Voltar para Apps</button>
      <div className="apps-detail-card">
        <div className="apps-detail-icon" aria-hidden="true">{selectedApp.name.slice(0, 1)}</div>
        <div className="apps-detail-copy"><span className="apps-kicker">EXEMPLO DO CATÁLOGO AUDITADO</span><h1 id="apps-detail-title" className="apps-detail-title" tabIndex={-1}>{selectedApp.name}</h1><p>{selectedApp.description}</p></div>
        {selectedApp.id === 'giphy' && sandboxState !== 'connected' ? <button className="apps-connect-disabled apps-connect-enabled" type="button" onClick={() => { setSandboxState('consent'); setSandboxMessage('') }}>Conectar sandbox local <ArrowUpRight size={15} /></button> : selectedApp.id === 'giphy' ? <button className="apps-connect-disabled apps-connect-enabled" type="button" onClick={() => void disconnectSandbox()}>Desconectar</button> : <button className="apps-connect-disabled" type="button" disabled aria-describedby="apps-connect-note">Conectar <ArrowUpRight size={15} /></button>}
      </div>
      <div className="apps-permissions"><h2>Sobre esta integração</h2><p>Este exemplo foi identificado durante a auditoria visual. Uma conexão real precisa de um adaptador e autorização do provedor, ainda não configurados.</p><h3>Capacidades observadas</h3><ul>{selectedApp.capabilities.map(capability => <li key={capability}><Check size={15} /> {readable(capability)}</li>)}</ul><h3>Permissões</h3><p>{selectedApp.id === 'giphy' ? 'A demonstração solicita somente leitura da biblioteca de mídia local. Não acessa GIPHY nem envia dados.' : 'Nenhuma permissão foi solicitada ou concedida. As permissões reais serão apresentadas pelo provedor antes de uma conexão, quando um adaptador estiver configurado.'}</p>
      {selectedApp.id === 'giphy' && sandboxState === 'consent' && <section className="apps-sandbox-consent" aria-label="Consentimento do sandbox"><h3>Consentimento explícito</h3><p>Configuração: <code>sandbox-local</code>. A capacidade fica limitada à busca em uma pequena coleção de demonstração neste dispositivo.</p><label><input type="checkbox" checked={sandboxConsent} onChange={event => setSandboxConsent(event.target.checked)} /> Permitir <strong>media.read</strong> somente no sandbox local</label><div><button type="button" onClick={() => void connectSandbox(false)}>Recusar</button><button type="button" disabled={!sandboxConsent} onClick={() => void connectSandbox(true)}>Aceitar e conectar</button></div></section>}
      {selectedApp.id === 'giphy' && sandboxState === 'connected' && <section className="apps-sandbox-tool"><h3>Busca de mídia de demonstração</h3><p>Configuração <code>sandbox-local</code> · capacidade concedida <code>media.read</code></p><form onSubmit={event => void runSandboxSearch(event)}><input aria-label="Buscar na coleção local" value={sandboxQuery} onChange={event => setSandboxQuery(event.target.value)} placeholder="Ex.: photo ou shape" /><button type="submit">Buscar</button></form>{sandboxResults && <ul aria-label="Resultados locais">{sandboxResults.map(result => <li key={result}>{result}</li>)}{!sandboxResults.length && <li>Nenhum resultado local</li>}</ul>}</section>}
      {sandboxMessage && <p role="status" className="apps-connect-note">{sandboxMessage}</p>}
      <p className="apps-connect-note" id="apps-connect-note">{selectedApp.id === 'giphy' ? 'Sandbox local: nenhuma conta externa foi conectada e nenhuma solicitação de rede foi feita.' : 'Nenhuma conta foi conectada e nenhuma ação externa está disponível.'}</p></div>
    </section> : <>
      <section className="apps-feature" aria-label="Descobrir apps">
        <div><span className="apps-kicker">EXPLORE NOVOS FLUXOS</span><h1>Encontre o app certo para suas criações</h1><p>Descubra exemplos de integrações observadas na auditoria do Canva.</p></div>
        <div className="apps-feature-art" aria-hidden="true"><span>✦</span><span>✳</span><span>◈</span></div>
      </section>
      <div className="apps-discovery">
        <form className="apps-search-wrap" role="search" onSubmit={submitSearch}>
          <label className="apps-search"><Search size={18} aria-hidden="true" /><input ref={searchRef} type="search" value={route.query} onFocus={() => setSuggestionsOpen(true)} onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)} onChange={event => { updateRoute({ query: event.target.value }, true); setSuggestionsOpen(true); setActiveSuggestion(0) }} onKeyDown={event => {
            if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setSuggestionsOpen(true); setActiveSuggestion(index => (index + 1) % suggestions.length) }
            if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setSuggestionsOpen(true); setActiveSuggestion(index => (index - 1 + suggestions.length) % suggestions.length) }
            if (event.key === 'Enter' && suggestionsOpen && suggestions[activeSuggestion]) { event.preventDefault(); chooseSuggestion(suggestions[activeSuggestion]) }
            if (event.key === 'Escape' && suggestionsOpen) { event.stopPropagation(); setSuggestionsOpen(false) }
          }} placeholder="Buscar apps" aria-label="Buscar apps" aria-autocomplete="list" aria-controls="apps-search-suggestions" aria-expanded={suggestionsOpen && suggestions.length > 0} aria-activedescendant={suggestionsOpen && suggestions.length ? `apps-search-option-${suggestions[activeSuggestion]?.id}` : undefined} />{route.query && <button type="button" className="apps-search-clear" aria-label="Limpar busca" onMouseDown={event => event.preventDefault()} onClick={clearSearch}><X size={15} aria-hidden="true" /></button>}<kbd>⌘ K</kbd></label>
          {suggestionsOpen && suggestions.length > 0 && <ul id="apps-search-suggestions" className="apps-search-suggestions" role="listbox" aria-label="Sugestões de apps">{suggestions.map((app, index) => <li key={app.id} role="option" id={`apps-search-option-${app.id}`} aria-selected={activeSuggestion === index}><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => chooseSuggestion(app)}><span className="apps-suggestion-initial" aria-hidden="true">{app.name.slice(0, 1)}</span><span><strong>{app.name}</strong><small>{app.provider}</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ul>}
        </form>
        <nav className="apps-categories" aria-label="Categorias de apps">{APP_CATEGORIES.map(category => <button type="button" key={category.id} data-category={category.id} aria-current={!savedOnly && route.category === category.id ? 'page' : undefined} onClick={() => { setSavedOnly(false); updateRoute({ category: category.id }) }}>{category.label}</button>)}<button type="button" className="apps-saved-filter" aria-pressed={savedOnly} onClick={() => setSavedOnly(value => !value)}><Bookmark size={13} aria-hidden="true" /> Salvos ({savedAppIds.length})</button></nav>
        <section className="apps-results" aria-live="polite">
          <details className="apps-audit-coverage">
            <summary>Escopo da auditoria do catálogo</summary>
            <p><strong>{APPS_AUDIT_COVERAGE.listedCardOccurrences}</strong> ocorrências de cartões em <strong>{APPS_AUDIT_COVERAGE.observedCategoryRoutes}</strong> rotas observadas foram reunidas. Elas correspondem a <strong>{APPS_AUDIT_COVERAGE.normalizedLabels}</strong> rótulos normalizados; identidade única de cada integração não foi resolvida.</p>
            <p>Apenas {APPS_AUDIT_COVERAGE.fullScrollInventories} categoria tem inventário com rolagem completa. “Todos os apps” mostrou {APPS_AUDIT_COVERAGE.allAppsViewportNames} nomes em uma captura de viewport, sem provar cobertura total. Os cartões abaixo são exemplos locais, não uma lista completa nem integrações conectadas.</p>
          </details>
          <div className="apps-results-heading"><div><h2>{route.category === 'for-you' ? 'Recomendados para você' : APP_CATEGORIES.find(category => category.id === route.category)?.label}</h2><p>{apps.length} exemplos disponíveis · integrações não conectadas</p></div><label>Ordenar <select aria-label="Ordenar apps" value={route.sort} onChange={event => updateRoute({ sort: event.target.value as 'recommended' | 'name' })}><option value="recommended">Recomendados</option><option value="name">Nome</option></select></label></div>
          {apps.length ? route.category === 'for-you' && !savedOnly ? <div className="apps-recommendations" aria-label="Apps recomendados">
            <button className="apps-recommendations-arrow apps-recommendations-previous" type="button" aria-label="Apps recomendados anteriores" aria-controls="apps-recommendations-track" disabled={!canScrollRecommendationsBack} onClick={() => scrollRecommendations(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <div className="apps-recommendations-viewport" ref={recommendationsRef} role="region" aria-roledescription="carrossel" tabIndex={0} aria-label="Apps recomendados. Use as setas esquerda e direita para navegar." onScroll={updateRecommendationsScrollState} onKeyDown={handleRecommendationsKeyDown}>
              <div className="apps-recommendations-track" id="apps-recommendations-track">{apps.map(renderAppCard)}</div>
            </div>
            <button className="apps-recommendations-arrow apps-recommendations-next" type="button" aria-label="Próximos apps recomendados" aria-controls="apps-recommendations-track" disabled={!canScrollRecommendationsForward} onClick={() => scrollRecommendations(1)}><ChevronRight size={20} aria-hidden="true" /></button>
          </div> : <div className="apps-grid">{apps.map(renderAppCard)}</div> : <div className="apps-empty"><Search size={25} /><h3>{savedOnly ? 'Nenhum app salvo nesta categoria' : 'Nenhum exemplo encontrado'}</h3><p>{savedOnly ? 'Salve exemplos com o marcador para encontrá-los aqui.' : 'Tente outro termo ou escolha outra categoria.'}</p>{savedOnly ? <button type="button" onClick={() => setSavedOnly(false)}>Voltar ao catálogo</button> : <button type="button" onClick={() => updateRoute({ query: '' })}>Limpar busca</button>}</div>}
        </section>
      </div>
      <footer className="apps-marketplace-footer">Os nomes e capacidades aparecem como exemplos auditados. Este catálogo local não representa uma conexão com os serviços listados.</footer>
    </>}
  </main>
}
