// Derive only live waits; ordinary unread activity is not a request for action.
export function attentionItems(roster, approvals, interactions) {
  const items = []
  for (const approval of approvals ?? []) {
    const bot = roster.byId[approval.botId]
    const room = approval.roomId && roster.roomsById[approval.roomId]
    if (approval.roomId ? !room : !bot) continue
    items.push({ key: `approval:${approval.id}`, target: room?.id ?? bot.id, name: room?.name ?? bot.name, kind: 'approval', bot: room ? bot?.name : undefined })
  }
  for (const bot of roster.bots ?? []) {
    const part = bot.sessionId ?? bot.id
    if (roster.questions?.[part] || interactions[part] === 'question') {
      items.push({ key: `question:${part}`, target: bot.id, name: bot.name, kind: 'question' })
    }
  }
  for (const failure of roster.attentionFailures ?? []) {
    const room = roster.roomsById[failure.targetId]
    const bot = roster.byId[failure.targetId]
    if (!room && !bot) continue
    items.push({ key: `failure:${failure.id}`, id: failure.id, target: failure.targetId, name: room?.name ?? bot.name, kind: 'failure', bot: room ? roster.byId[failure.botId]?.name : undefined })
  }
  return items
}
