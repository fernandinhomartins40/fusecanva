import type { RemotePresence } from './api'

export type PresenceMessage = {
  type?: string
  users?: RemotePresence[]
  userId?: string
  name?: string
  cursor?: RemotePresence['cursor']
  selection?: RemotePresence['selection']
}

export function reducePresenceMessage(current: RemotePresence[], message: PresenceMessage): RemotePresence[]
