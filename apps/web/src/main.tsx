import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TeamGroupsSettingsRoute, TeamPeopleSettingsRoute, TeamProfileSettingsRoute } from './TeamPeopleSettingsPage'
import { TeamPermissionsSettings } from './TeamPermissionsSettings'
import { TeamAiAppManager } from './TeamAiAppManager'

const root = createRoot(document.getElementById('root')!)
const pathname = window.location.pathname
const route = pathname === '/settings/people' ? <TeamPeopleSettingsRoute />
  : pathname === '/settings/groups' ? <TeamGroupsSettingsRoute />
    : pathname === '/settings/team-profile' ? <TeamProfileSettingsRoute />
      : pathname === '/settings/permissions' || pathname === '/settings/controls' ? <TeamPermissionsSettings />
        : pathname === '/settings/apps/manage-ai-apps' ? <TeamAiAppManager />
          : <App />
root.render(
  <StrictMode>
    {route}
  </StrictMode>,
)
