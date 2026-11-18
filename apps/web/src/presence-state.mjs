/** Apply collaboration presence events without losing cursor/selection updates that arrive before the presence snapshot. */
export function reducePresenceMessage(current, message) {
  if (message?.type === 'presence.updated') {
    const currentById = new Map(current.map(user => [user.id, user]))
    return (Array.isArray(message.users) ? message.users : []).map(user => {
      const existing = currentById.get(user.id)
      return { ...user, cursor: existing?.cursor ?? null, selection: existing?.selection ?? null }
    })
  }

  if ((message?.type === 'cursor.updated' || message?.type === 'selection.updated') && message.userId) {
    const existing = current.find(user => user.id === message.userId)
    if (message.type === 'cursor.updated' && message.cursor == null) {
      return existing ? current.map(user => user.id === message.userId ? { ...user, cursor: null } : user) : current
    }
    if (existing) return current.map(user => user.id === message.userId
      ? {
          ...user,
          name: message.name ?? user.name,
          ...(message.type === 'cursor.updated' ? { cursor: message.cursor } : { selection: message.selection ?? null }),
        }
      : user)
    return [...current, {
      id: message.userId,
      name: message.name ?? 'Colaborador',
      connections: 1,
      cursor: message.type === 'cursor.updated' ? message.cursor ?? null : null,
      selection: message.type === 'selection.updated' ? message.selection ?? null : null,
    }]
  }

  return current
}
