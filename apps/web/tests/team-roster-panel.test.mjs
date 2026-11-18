import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('team roster exposes the observed people columns, owner row, tabs, and honest groups state', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { TeamRosterPanel } = await vite.ssrLoadModule('/src/TeamRosterPanel.tsx')
    const member = { id: 'owner-1', name: 'Ana Costa', email: 'ana@example.test', role: 'admin', joinedAt: '2026-01-01T00:00:00.000Z' }
    const html = renderToStaticMarkup(React.createElement(TeamRosterPanel, {
      members: [member], currentUserId: member.id, teamRole: 'admin', onRoleChange() {}, onRemove() {},
    }))
    for (const label of ['Integrantes', 'Uso de IA', 'Nome', 'E-mail', 'Função na equipe', 'Grupos', 'Ana Costa', 'ana@example.test']) assert.match(html, new RegExp(label))
    assert.match(html, /role="tablist"/)
    assert.match(html, /role="tabpanel"/)
    assert.match(html, /aria-label="Papel de Ana Costa"[^>]*disabled/)
    assert.match(html, /class="team-roster-no-groups" aria-label="Nenhum grupo">—<\/span>/)
  } finally { await vite.close() }
})
