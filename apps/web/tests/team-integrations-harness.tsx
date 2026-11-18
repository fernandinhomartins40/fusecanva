import React from 'react'
import { createRoot } from 'react-dom/client'
import { TeamIntegrationsPanel } from '../src/TeamIntegrationsPanel'

declare global {
  interface Window {
    __teamIntegrationSave?: string[]
    __teamIntegrationCloseCount?: number
    __teamRemotePrefs?: Record<string, string>
    __teamRemoteGetCount?: number
    __teamRemotePutCount?: number
  }
}

window.__teamRemotePrefs = { enabledIntegrations: '["slack"]' }
window.__teamRemoteGetCount = 0
window.__teamRemotePutCount = 0
const nativeFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === '/api/teams/team-shared/policies') {
    if (init?.method === 'PUT') {
      window.__teamRemotePutCount = (window.__teamRemotePutCount ?? 0) + 1
      const body = JSON.parse(String(init.body ?? '{}')) as { policies?: Record<string, string> }
      window.__teamRemotePrefs = { ...(window.__teamRemotePrefs ?? {}), ...(body.policies ?? {}) }
    } else window.__teamRemoteGetCount = (window.__teamRemoteGetCount ?? 0) + 1
    return new Response(JSON.stringify({ policies: window.__teamRemotePrefs }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return nativeFetch(input, init)
}

createRoot(document.getElementById('test-root')!).render(<TeamIntegrationsPanel
  teamId="team-shared"
  initialSelectedIds={['drive']}
  onSave={selectedIds => { window.__teamIntegrationSave = selectedIds }}
  onClose={() => { window.__teamIntegrationCloseCount = (window.__teamIntegrationCloseCount ?? 0) + 1 }}
/>)
