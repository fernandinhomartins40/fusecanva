import { useMemo, useState } from 'react'
import { ArrowLeft, Check, WandSparkles } from 'lucide-react'
import type { DesignElement } from './model'
import { reviewBrandElements } from './brand-review.mjs'
import type { BrandReviewIssue } from './brand-review.mjs'

type BrandAssistantReviewProps = {
  elements: DesignElement[]
  canEdit: boolean
  onApply: (issueKeys: string[]) => void
  pageLabel?: string
}

export function BrandAssistantReview({ elements, canEdit, onApply, pageLabel = 'Pagina atual' }: BrandAssistantReviewProps) {
  const issues = useMemo(() => reviewBrandElements(elements), [elements])
  const fontIssues = useMemo(() => issues.filter(issue => issue.kind === 'font'), [issues])
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => fontIssues[0] ? [fontIssues[0].key] : [])
  const [category, setCategory] = useState<'all' | 'font' | 'color'>('all')
  const [view, setView] = useState<'fonts' | 'review'>('fonts')
  const selected = new Set(selectedKeys)
  const visibleIssues = category === 'all' ? issues : issues.filter(issue => issue.kind === category)
  const selectedIssues = issues.filter(issue => selected.has(issue.key))
  const allVisibleSelected = visibleIssues.length > 0 && visibleIssues.every(issue => selected.has(issue.key))
  const allFontsSelected = fontIssues.length > 0 && fontIssues.every(issue => selected.has(issue.key))


  function toggleIssue(issue: BrandReviewIssue) {
    setSelectedKeys(current => current.includes(issue.key) ? current.filter(key => key !== issue.key) : [...current, issue.key])
  }

  function apply(issueKeys: string[]) {
    if (!canEdit || issueKeys.length === 0) return
    onApply(issueKeys)
    setSelectedKeys(current => current.filter(key => !issueKeys.includes(key)))
  }

  return view === 'fonts' ? <section className="brand-assistant-review brand-assistant-font-view" aria-label="Mude para uma fonte da marca">
    <header className="brand-assistant-font-header"><button type="button" className="brand-assistant-back" aria-label="Voltar a revisao de marca" onClick={() => setView('review')}><ArrowLeft size={20} aria-hidden="true" /></button><strong>Mude para uma fonte da marca</strong></header>
    <p className="brand-assistant-font-intro">Algumas fontes n&atilde;o pertencem ao kit de marca selecionado. Escolha fontes que estejam no kit.</p>
    {fontIssues.length > 0 ? <>
      <label className="brand-assistant-select-all"><input type="checkbox" aria-label="Selecionar todas as fontes" checked={allFontsSelected} disabled={!canEdit} onChange={() => setSelectedKeys(current => allFontsSelected ? current.filter(key => !fontIssues.some(issue => issue.key === key)) : [...new Set([...current, ...fontIssues.map(issue => issue.key)])])} />Selecionar tudo (apenas itens para corrigir automaticamente)</label>
      <span className="brand-assistant-page-label">{pageLabel}</span>
      <div className="brand-assistant-issue-list brand-assistant-font-list">{fontIssues.map(issue => {
        const element = elements.find(item => item.id === issue.elementId)
        return <label className={`brand-assistant-issue brand-assistant-font-card ${selected.has(issue.key) ? 'selected' : ''}`} key={issue.key}>
          <input type="checkbox" aria-label={`Selecionar fonte: ${elementName(elements, issue.elementId)}`} checked={selected.has(issue.key)} disabled={!canEdit} onChange={() => toggleIssue(issue)} />
          <span className="brand-assistant-font-sample" style={{ fontFamily: element?.type === 'text' ? element.fontFamily : undefined, color: element?.type === 'text' ? element.color : undefined }}>{fontSample(element, issue)}</span>
          <small>{issue.before}</small>
        </label>
      })}</div>
      <div className="brand-assistant-font-footer"><button type="button" className="brand-assistant-batch-fix" disabled={!canEdit || selectedIssues.filter(issue => issue.kind === 'font').length === 0} onClick={() => apply(selectedIssues.filter(issue => issue.kind === 'font').map(issue => issue.key))}>Mudar para uma fonte da marca</button></div>
    </> : <p className="brand-assistant-empty" role="status">Nenhuma fonte precisa ser alterada.</p>}
  </section> : <section className="brand-assistant-review brand-assistant-summary-view" aria-label="Assistente de marca">
    <header className="brand-assistant-review-header"><div><strong>Assistente de marca</strong><small>An&aacute;lise local com regras do kit selecionado</small></div><WandSparkles size={17} aria-hidden="true" /></header>
    <p className="brand-assistant-review-note">A revis&atilde;o usa o estilo de fonte e os mapeamentos de cor deste kit. Ela n&atilde;o envia o design a um servi&ccedil;o externo.</p>
    <div className="brand-assistant-review-summary" role="status"><span>{fontIssues.length} fontes</span><span>{issues.filter(issue => issue.kind === 'color').length} cores</span></div>
    <div className="brand-assistant-review-categories" role="tablist" aria-label="Categorias da revisao de marca">
      <button type="button" role="tab" aria-selected={category === 'all'} onClick={() => setCategory('all')}>Todos ({issues.length})</button>
      <button type="button" role="tab" aria-selected={category === 'font'} onClick={() => { setCategory('font'); setView('fonts') }}>Fontes ({fontIssues.length})</button>
      <button type="button" role="tab" aria-selected={category === 'color'} onClick={() => setCategory('color')}>Cores ({issues.filter(issue => issue.kind === 'color').length})</button>
    </div>
    {visibleIssues.length > 0 ? <>
      <label className="brand-assistant-select-all"><input type="checkbox" aria-label="Selecionar todos os problemas visiveis" checked={allVisibleSelected} disabled={!canEdit} onChange={() => setSelectedKeys(current => allVisibleSelected ? current.filter(key => !visibleIssues.some(issue => issue.key === key)) : [...new Set([...current, ...visibleIssues.map(issue => issue.key)])])} />Selecionar problemas vis&iacute;veis</label>
      <div className="brand-assistant-issue-list">{visibleIssues.map(issue => <article className="brand-assistant-issue" key={issue.key}>
        <input type="checkbox" aria-label={`Selecionar ${issue.kind === 'font' ? 'fonte' : 'cor'}: ${elementName(elements, issue.elementId)}`} checked={selected.has(issue.key)} disabled={!canEdit} onChange={() => toggleIssue(issue)} />
        <span className="brand-assistant-issue-copy"><strong>{elementName(elements, issue.elementId)}</strong><small>{issue.label}: {issue.before} -&gt; {issue.after}</small></span>
        <button type="button" aria-label={`Corrigir ${issue.kind === 'font' ? 'fonte' : 'cor'}: ${elementName(elements, issue.elementId)}`} disabled={!canEdit} onClick={() => apply([issue.key])}><Check size={14} aria-hidden="true" />Corrigir</button>
      </article>)}</div>
      <button type="button" className="brand-assistant-batch-fix" disabled={!canEdit || selectedIssues.length === 0} onClick={() => apply(selectedIssues.map(issue => issue.key))}>Corrigir selecionados ({selectedIssues.length})</button>
    </> : <p className="brand-assistant-empty" role="status">Nenhum problema nesta categoria. A revis&atilde;o cobre somente as regras conhecidas deste kit.</p>}
  </section>
}

function fontSample(element: DesignElement | undefined, issue: BrandReviewIssue): string {
  if (!element || element.type !== 'text') return issue.before
  return element.text || element.name || issue.before
}

function elementName(elements: DesignElement[], id: string): string {
  const element = elements.find(item => item.id === id)
  return element?.name || (element?.type === 'text' ? element.text : '') || 'Elemento sem nome'
}
