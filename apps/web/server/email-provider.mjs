const RESEND_ENDPOINT = 'https://api.resend.com/emails'

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function invitationUrl(appUrl, token, kind) {
  const url = new URL(appUrl)
  url.searchParams.set(kind === 'team' ? 'teamInvite' : 'invite', token)
  return url.toString()
}

function passwordResetUrl(appUrl, token) {
  const url = new URL(appUrl)
  url.searchParams.set('resetPassword', token)
  return url.toString()
}

export async function deliverInvitationEmail(invitation, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.STUDIO_EMAIL_PROVIDER !== 'resend') return { status: 'link-only', reason: 'provider-disabled' }
  const apiKey = env.STUDIO_EMAIL_API_KEY?.trim()
  const from = env.STUDIO_EMAIL_FROM?.trim()
  const appUrl = env.STUDIO_PUBLIC_APP_URL?.trim()
  if (!apiKey || !from || !appUrl) return { status: 'failed', reason: 'provider-misconfigured' }

  let link
  try {
    const parsed = new URL(appUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol')
    link = invitationUrl(parsed.toString(), invitation.token, invitation.kind)
  } catch {
    return { status: 'failed', reason: 'invalid-public-url' }
  }

  const team = invitation.kind === 'team'
  const subject = team ? `Convite para a equipe ${invitation.targetName}` : `Convite para ${invitation.targetName}`
  const role = invitation.roleLabel
  const text = `${invitation.inviterName} convidou você para ${team ? 'a equipe' : 'o projeto'} ${invitation.targetName} com acesso de ${role}.\n\nAceite o convite: ${link}\n\nEste link expira em sete dias.`
  const safe = {
    inviterName: escapeHtml(invitation.inviterName),
    targetName: escapeHtml(invitation.targetName),
    role: escapeHtml(role),
    link: escapeHtml(link),
  }
  const html = `<p>${safe.inviterName} convidou você para ${team ? 'a equipe' : 'o projeto'} <strong>${safe.targetName}</strong> com acesso de ${safe.role}.</p><p><a href="${safe.link}">Aceitar convite</a></p><p>Este link expira em sete dias.</p>`

  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [invitation.email], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { status: 'failed', reason: 'provider-rejected' }
    return { status: 'sent' }
  } catch {
    return { status: 'failed', reason: 'provider-unavailable' }
  }
}

export async function deliverPasswordResetEmail(reset, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.STUDIO_EMAIL_PROVIDER !== 'resend') return { status: 'link-only', reason: 'provider-disabled' }
  const apiKey = env.STUDIO_EMAIL_API_KEY?.trim()
  const from = env.STUDIO_EMAIL_FROM?.trim()
  const appUrl = env.STUDIO_PUBLIC_APP_URL?.trim()
  if (!apiKey || !from || !appUrl) return { status: 'failed', reason: 'provider-misconfigured' }

  let link
  try {
    const parsed = new URL(appUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol')
    link = passwordResetUrl(parsed.toString(), reset.token)
  } catch {
    return { status: 'failed', reason: 'invalid-public-url' }
  }

  const safeName = escapeHtml(reset.name)
  const safeLink = escapeHtml(link)
  const subject = 'Redefina sua senha do Fuse Studio'
  const text = `Olá, ${reset.name}. Use este link para redefinir sua senha: ${link}\n\nO link expira em 30 minutos e pode ser usado uma vez.`
  const html = `<p>Olá, ${safeName}.</p><p><a href="${safeLink}">Redefinir minha senha</a></p><p>O link expira em 30 minutos e pode ser usado uma vez. Se você não pediu a redefinição, ignore esta mensagem.</p>`

  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [reset.email], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { status: 'failed', reason: 'provider-rejected' }
    return { status: 'sent' }
  } catch {
    return { status: 'failed', reason: 'provider-unavailable' }
  }
}
