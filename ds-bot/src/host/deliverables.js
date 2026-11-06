const LIMIT = 200

// Enumerate only the conversations the team owns; group member Sessions are hidden.
export function deliverableSources(rt, groupId) {
  const { state } = rt
  const groups = Array.isArray(state.prefs.sidebarGroups) ? state.prefs.sidebarGroups : []
  const group = groupId === null ? null : groups.find(item => item.id === groupId)
  if (groupId !== null && !group) throw Object.assign(new Error('Sidebar group not found'), { code: 'bot/not-found' })
  const selected = group ? new Set(group.members) : null
  const sources = new Map()
  for (const bot of Object.values(state.bots)) {
    if (selected && !selected.has(bot.id)) continue
    for (const part of rt.partsOf(bot.id)) sources.set(part.sessionId, { sessionId: part.sessionId, targetId: bot.id, sourceName: bot.name })
  }
  for (const room of Object.values(state.rooms)) {
    if (selected && !selected.has(room.id)) continue
    const ids = new Set([...Object.keys(room.sessions ?? {}), ...Object.keys(room.segments ?? {})])
    for (const botId of ids) {
      const previous = (room.segments?.[botId] ?? []).map(segment => segment.sessionId)
      const current = room.sessions?.[botId]
      for (const sessionId of [...previous, current].filter(Boolean)) sources.set(sessionId, { sessionId, targetId: room.id, sourceName: room.name })
    }
  }
  return [...sources.values()]
}

export async function listDeliverables(rt, groupId = null) {
  const query = rt.ctx.get?.('sessionQuery')
  if (!query?.readSession) throw Object.assign(new Error('Session history is unavailable'), { code: 'bot/refused' })
  const sources = deliverableSources(rt, groupId)
  const items = []
  let next = 0, unavailable = 0
  const worker = async () => {
    while (next < sources.length) {
      const source = sources[next++]
      try {
        const snapshot = await query.readSession(source.sessionId)
        for (const event of snapshot.events ?? []) {
          if (event.type !== 'deliverables/presented' || event.seq < (snapshot.inheritedEventCount ?? 0)) continue
          if (!Number.isSafeInteger(event.data?.turn) || event.data.turn < 1 || typeof event.data.callId !== 'string' || !event.data.callId || !Array.isArray(event.data.files)) continue
          for (const [index, file] of event.data.files.entries()) {
            if (typeof file?.path !== 'string' || !file.path.trim() || (file.description !== undefined && typeof file.description !== 'string')) continue
            const name = file.path.split(/[\\/]/).filter(Boolean).at(-1)
            if (!name) continue
            items.push({ id: `${source.sessionId}:${event.seq}:${index}`, targetId: source.targetId, sourceName: source.sourceName, name, time: event.time })
          }
        }
      } catch { unavailable += 1 }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, () => worker()))
  // Sessions are read concurrently, so the insertion order of equal timestamps is
  // whichever read finished first. Break ties on the id, which carries the Session,
  // event seq and file index, so the list and the 200-item cut are stable.
  items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { items: items.slice(0, LIMIT), truncated: items.length > LIMIT, unavailable }
}
