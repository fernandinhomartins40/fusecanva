import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AIConnectorsPanel } from '../../src/AIConnectorsPanel'

function Fixture() {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'start center', padding: 24, background: '#292a31', color: 'white' }}>
    <section style={{ width: 'min(420px, 100%)', display: 'grid', gap: 12 }}>
      <button type="button" id="open-connectors" onClick={() => setOpen(true)}>Connectors</button>
      <label htmlFor="ai-prompt">Adicione algo ao seu pedido</label>
      <textarea ref={promptRef} id="ai-prompt" />
      {open && <AIConnectorsPanel onBack={() => setOpen(false)} onClose={() => setOpen(false)} returnFocusRef={promptRef} />}
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
