import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { createRemotePrintCheckout, getExternalProviderStatus, type PrintCheckoutOptions } from './api'
import { DEFAULT_PRINT_DRAFT, estimatePrintPrice, formatSandboxPrice, PRINT_FINISHES, PRINT_FORMATS, PRINT_PAPERS, PRINT_QUANTITIES, readPrintDraft, resetPrintDraft, serializePrintSpecification, writePrintDraft, type PrintDraft } from './print-sandbox.mjs'
import './PrintSandbox.css'

const storageKey = (documentId: string) => `fuse.print-draft.v1.${documentId}`

export function PrintSandbox({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const key = storageKey(documentId)
  const [draft, setDraft] = useState<PrintDraft>(() => readPrintDraft(window.localStorage, key) ?? { ...DEFAULT_PRINT_DRAFT })
  const [saved, setSaved] = useState(() => Boolean(readPrintDraft(window.localStorage, key)))
  const [confirmation, setConfirmation] = useState(false)
  const [notice, setNotice] = useState('')
  const [providerStatus, setProviderStatus] = useState<'checking' | 'disabled' | 'enabled' | 'error'>('checking')
  const [checkoutConfirmOpen, setCheckoutConfirmOpen] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [checkoutNotice, setCheckoutNotice] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const price = estimatePrintPrice(draft)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLElement>('.print-sandbox-close')?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    getExternalProviderStatus()
      .then(status => { if (!cancelled) setProviderStatus(status.printCheckout.configured ? 'enabled' : 'disabled') })
      .catch(() => { if (!cancelled) setProviderStatus('error') })
    return () => { cancelled = true }
  }, [])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (checkoutConfirmOpen) setCheckoutConfirmOpen(false)
      else onClose()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0)
    if (!focusable.length) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  const update = (patch: Partial<PrintDraft>) => {
    setDraft(current => ({ ...current, ...patch }))
    setSaved(false)
    setConfirmation(false)
    setNotice('')
    setCheckoutUrl('')
    setCheckoutNotice('')
    setCheckoutError('')
  }

  function saveDraft() {
    try {
      writePrintDraft(window.localStorage, key, draft)
      setSaved(true)
      setConfirmation(true)
      setNotice('Rascunho sandbox salvo neste dispositivo. Nenhum pedido foi enviado e nenhum pagamento foi realizado.')
    } catch {
      setSaved(false)
      setConfirmation(false)
      setNotice('Não foi possível salvar no armazenamento local deste navegador. Libere espaço e tente novamente.')
    }
  }

  function downloadSpecification() {
    try {
      const content = serializePrintSpecification(documentId, draft)
      const objectUrl = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `ficha-impressao-sandbox-${documentId.replace(/[^a-z0-9_-]/gi, '-')}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      setNotice('Ficha de impressão sandbox baixada neste dispositivo. Nenhum fornecedor foi contatado; nenhum pedido ou pagamento ocorreu.')
    } catch {
      setNotice('Não foi possível gerar a ficha sandbox. Tente novamente neste navegador.')
    }
  }

  function reset() {
    setDraft(resetPrintDraft(window.localStorage, key))
    setSaved(false)
    setConfirmation(false)
    setNotice('Rascunho removido. As opções observadas foram restauradas.')
    setCheckoutUrl('')
    setCheckoutNotice('')
    setCheckoutError('')
  }

  async function beginCheckout() {
    if (providerStatus !== 'enabled' || checkoutBusy) return
    setCheckoutBusy(true)
    setCheckoutError('')
    setCheckoutNotice('')
    try {
      const options: PrintCheckoutOptions = { format: draft.format, paper: draft.paper, finish: draft.finish, quantity: draft.quantity }
      const result = await createRemotePrintCheckout(documentId, options)
      setCheckoutUrl(result.checkoutUrl)
      setCheckoutNotice('A sessão de checkout foi criada. Confira os valores finais, frete e endereço no provedor antes de pagar.')
      setCheckoutConfirmOpen(false)
    } catch (reason) {
      setCheckoutError(reason instanceof Error ? reason.message : 'Não foi possível criar a sessão de checkout. Salve o design na nuvem e tente novamente.')
    } finally { setCheckoutBusy(false) }
  }

  return <div className="print-sandbox-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="print-sandbox-dialog" role="dialog" aria-modal="true" aria-labelledby="print-sandbox-title" tabIndex={-1} onKeyDown={handleDialogKeyDown}>
      <header className="print-sandbox-header"><div><span className="print-sandbox-kicker">GRÁFICA · AMBIENTE LOCAL</span><h2 id="print-sandbox-title">Cartões de visita</h2><p>Configure opções e salve um rascunho de cotação sandbox.</p></div><button type="button" className="print-sandbox-close" aria-label="Fechar configuração de impressão" onClick={onClose}><X size={19} /></button></header>
      <div className="print-sandbox-content">
        <fieldset className="print-choice-group"><legend>Formato</legend><div className="print-choice-grid">{PRINT_FORMATS.map(option => <label className="print-choice-card" key={option.id}><input type="radio" name="print-format" value={option.id} checked={draft.format === option.id} onChange={() => update({ format: option.id })} /><span><strong>{option.label}</strong><small>{option.size}</small></span></label>)}</div></fieldset>
        <fieldset className="print-choice-group"><legend>Tipo de papel</legend><div className="print-choice-grid">{PRINT_PAPERS.map(option => <label className="print-choice-card" key={option.id}><input type="radio" name="print-paper" value={option.id} checked={draft.paper === option.id} onChange={() => update({ paper: option.id })} /><span><strong>{option.label}</strong><small>{option.weight} · {option.description}</small></span></label>)}</div></fieldset>
        <fieldset className="print-choice-group"><legend>Acabamento do papel</legend><div className="print-choice-grid">{PRINT_FINISHES.map(option => <label className="print-choice-card" key={option.id}><input type="radio" name="print-finish" value={option.id} checked={draft.finish === option.id} onChange={() => update({ finish: option.id })} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset>
        <label className="print-quantity-label" htmlFor="print-quantity">Qual a quantidade?</label>
        <select id="print-quantity" value={draft.quantity} onChange={event => update({ quantity: Number(event.target.value) })}>{PRINT_QUANTITIES.map(quantity => <option key={quantity} value={quantity}>{quantity} cartões de visita</option>)}</select>
        <section className="print-estimate" aria-label="Preço estimado sandbox"><div><span>Estimativa local</span><small>{draft.quantity} cartões · sem frete</small></div><strong>{formatSandboxPrice(price)}</strong></section>
        <p className="print-estimate-note">Estimativa ilustrativa local com totais observados numa única sessão. Outras combinações são aproximadas; formato e acabamento não tiveram preço comparativo auditado. Não é cotação atual e não inclui frete, impostos ou disponibilidade.</p>
        {notice && <p className="print-sandbox-notice" role="status">{notice}</p>}
        {confirmation && saved && <div className="print-sandbox-confirmation"><strong>Rascunho de cotação salvo</strong><span>Você pode fechar, reabrir e editar esta configuração. Nenhum pedido foi enviado.</span></div>}
        {providerStatus === 'disabled' && <p className="print-provider-status" role="status">Checkout indisponível. O provedor externo ainda não foi configurado.</p>}
        {providerStatus === 'error' && <p className="print-provider-status" role="status">Não foi possível verificar a disponibilidade do checkout. Nenhuma solicitação foi enviada.</p>}
        {checkoutError && <p className="print-provider-error" role="alert">{checkoutError}</p>}
        {checkoutNotice && <div className="print-checkout-result" role="status"><p>{checkoutNotice}</p><a href={checkoutUrl} target="_blank" rel="noopener noreferrer">Revisar checkout no provedor <ExternalLink size={15} aria-hidden="true" /></a></div>}
      </div>
      <footer className="print-sandbox-actions"><div className="print-sandbox-secondary-actions"><button type="button" className="print-sandbox-reset" onClick={reset}>Redefinir opções</button><button type="button" className="print-sandbox-spec" disabled={!saved} onClick={downloadSpecification}>Baixar ficha sandbox</button></div><div><button type="button" className="print-sandbox-cancel" onClick={onClose}>Fechar</button><button type="button" className="print-sandbox-checkout" disabled={providerStatus !== 'enabled' || checkoutBusy} onClick={() => { setCheckoutError(''); setCheckoutConfirmOpen(true) }}>{providerStatus === 'checking' ? 'Verificando checkout…' : checkoutBusy ? 'Criando sessão…' : 'Continuar para checkout'}</button><button type="button" className="print-sandbox-save" onClick={saveDraft}>{saved ? 'Atualizar rascunho sandbox' : 'Salvar rascunho sandbox'}</button></div></footer>
      {checkoutConfirmOpen && <div className="print-checkout-confirm-backdrop" role="presentation"><section className="print-checkout-confirm" role="alertdialog" aria-modal="true" aria-labelledby="print-checkout-confirm-title" aria-describedby="print-checkout-confirm-description"><h3 id="print-checkout-confirm-title">Criar sessão de checkout?</h3><p id="print-checkout-confirm-description">O design e as opções selecionadas serão enviados ao provedor de impressão. A estimativa local não é uma cotação: o provedor informa preço final, impostos, frete e disponibilidade e coleta endereço e pagamento. Esta etapa não cobra nem confirma um pedido; produção, entrega e acompanhamento ficam fora deste app.</p><div><button type="button" onClick={() => setCheckoutConfirmOpen(false)}>Voltar</button><button type="button" className="print-checkout-confirm-submit" disabled={checkoutBusy} onClick={() => void beginCheckout()}>{checkoutBusy ? 'Criando sessão…' : 'Confirmar e criar sessão'}</button></div></section></div>}
    </section>
  </div>
}

export function PrintSandboxHost({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const listener = () => setOpen(true)
    window.addEventListener('fuse:open-print-sandbox', listener)
    return () => window.removeEventListener('fuse:open-print-sandbox', listener)
  }, [])
  return open ? <PrintSandbox documentId={documentId} onClose={() => setOpen(false)} /> : null
}
