import { useState, type FormEvent } from 'react'
import { ArrowDownToLine, ImagePlus, WandSparkles } from 'lucide-react'
import { downloadDreamLabImage, upscaleDreamLabImage, validateDreamLabImage, type DreamLabGenerator, type DreamLabImage } from './dream-lab.mjs'
import './DreamLabPanel.css'

type Props = { generate: DreamLabGenerator; onInsert?: (image: DreamLabImage, prompt: string) => void | Promise<void> }

export function DreamLabPanel({ generate, onInsert }: Props) {
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<DreamLabImage | null>(null)
  const [imagePrompt, setImagePrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = prompt.trim()
    if (normalized.length < 3) return
    setBusy(true); setError('')
    try {
      const generated = validateDreamLabImage(await generate(normalized))
      setImage(generated)
      setImagePrompt(normalized)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível gerar a imagem.') }
    finally { setBusy(false) }
  }

  async function upscale() {
    if (!image) return
    setBusy(true); setError('')
    try { setImage(await upscaleDreamLabImage(image)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ampliar a imagem.') }
    finally { setBusy(false) }
  }

  return <section className="dream-lab" aria-labelledby="dream-lab-title">
    <header><WandSparkles size={20} /><h2 id="dream-lab-title">Dream Lab</h2><span>Geração de imagem</span></header>
    <form onSubmit={event => void submit(event)}>
      <label htmlFor="dream-lab-prompt">Descreva a imagem</label>
      <textarea id="dream-lab-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} minLength={3} maxLength={2000} required placeholder="Ex.: uma paisagem editorial ao amanhecer" />
      <button type="submit" disabled={busy || prompt.trim().length < 3}>{busy ? 'Gerando…' : 'Gerar imagem'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {image && <div className="dream-lab-result">
      <p>{image.width} × {image.height} · {image.mode === 'sandbox' ? 'Sandbox determinístico' : 'Provedor configurado'}</p>
      <p className="dream-lab-result-prompt"><strong>Prompt desta imagem:</strong> {imagePrompt}</p>
      <img src={image.dataUrl} alt={`Imagem gerada: ${imagePrompt}`} />
      <div className="dream-lab-actions">
        <button type="button" disabled={busy || image.width * image.height >= 16_000_000} onClick={() => void upscale()}>{busy ? 'Ampliando…' : 'Ampliar 2× (local)'}</button>
        <button type="button" onClick={() => downloadDreamLabImage(image)}><ArrowDownToLine size={16} /> Baixar imagem</button>
        {onInsert && <button type="button" onClick={() => void onInsert(image, imagePrompt)}><ImagePlus size={16} /> Inserir no projeto</button>}
      </div>
      <small>A ampliação usa interpolação do navegador, sem modelo de super-resolução.</small>
    </div>}
  </section>
}
