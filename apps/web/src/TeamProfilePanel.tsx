import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Check, Save, X } from 'lucide-react'
import './TeamProfilePanel.css'

export type TeamProfilePanelProps = {
  teamName: string
  teamRole: 'admin' | 'member'
  loading?: boolean
  busy?: boolean
  error?: string
  notice?: string
  onSave: (name: string) => void | Promise<void>
}

/** Team scoped profile settings. Persistence and authorization stay with the parent/API. */
export function TeamProfilePanel({ teamName, teamRole, loading = false, busy = false, error: externalError = '', notice: externalNotice = '', onSave }: TeamProfilePanelProps) {
  const [name, setName] = useState(teamName)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [localNotice, setLocalNotice] = useState('')
  const canManage = teamRole === 'admin'
  const isBusy = saving || busy || loading
  const trimmedName = name.trim()
  const changed = trimmedName !== teamName

  useEffect(() => {
    setName(teamName)
    setLocalNotice('')
  }, [teamName])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManage || isBusy || !trimmedName || !changed) return
    setSaving(true)
    setLocalError('')
    setLocalNotice('')
    try {
      await onSave(trimmedName)
      setName(trimmedName)
      setLocalNotice('Nome da equipe atualizado.')
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil da equipe.')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setName(teamName)
    setLocalError('')
    setLocalNotice('')
  }

  const message = externalError || localError || externalNotice || localNotice
  const hasError = Boolean(externalError || localError)

  return <section className="team-profile-panel" aria-labelledby="team-profile-title">
    <header className="team-profile-heading">
      <span className="team-profile-mark" aria-hidden="true"><Building2 size={22} /></span>
      <div>
        <p className="team-profile-eyebrow">Configurações da equipe</p>
        <h2 id="team-profile-title">Perfil da equipe</h2>
        <p className="team-profile-description">Defina como esta equipe aparece para as pessoas que colaboram com você.</p>
      </div>
    </header>

    {message && <p className={`team-profile-feedback${hasError ? ' is-error' : ''}`} role={hasError ? 'alert' : 'status'}>{message}</p>}

    {loading ? <p className="team-profile-state" role="status">Carregando perfil da equipe…</p> : <form className="team-profile-form" onSubmit={event => void save(event)}>
      <div className="team-profile-card">
        <div className="team-profile-card-heading">
          <div><h3>Informações da equipe</h3><p>O nome aparece nos projetos compartilhados e nas configurações da equipe.</p></div>
          <span className="team-profile-badge"><Building2 size={15} aria-hidden="true" />Equipe</span>
        </div>

        <label className="team-profile-name-field" htmlFor="team-profile-name">
          <span>Nome da equipe</span>
          <input id="team-profile-name" name="teamName" type="text" autoComplete="organization" maxLength={80} minLength={1} required value={name} disabled={!canManage || isBusy} onChange={event => { setName(event.currentTarget.value); setLocalError(''); setLocalNotice('') }} aria-describedby="team-profile-name-hint" />
          <small id="team-profile-name-hint">Use um nome que ajude sua equipe a reconhecer este espaço. Até 80 caracteres.</small>
        </label>

        {!canManage && <p className="team-profile-readonly">Somente administradores podem alterar o perfil da equipe.</p>}

        {canManage && <div className="team-profile-actions">
          {changed && <button type="button" className="team-profile-cancel" onClick={reset} disabled={isBusy}><X size={16} aria-hidden="true" />Cancelar</button>}
          <button type="submit" className="team-profile-save" disabled={isBusy || !trimmedName || !changed}>
            {saving || busy ? <><span className="team-profile-spinner" aria-hidden="true" />Salvando…</> : changed ? <><Save size={16} aria-hidden="true" />Salvar alterações</> : <><Check size={16} aria-hidden="true" />Salvo</>}
          </button>
        </div>}
      </div>
    </form>}
  </section>
}
