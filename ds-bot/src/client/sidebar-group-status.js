// Summarize the conversations actually assigned to this workgroup.
export function sidebarGroupStatus(entries, statuses, work, markedUnread, questions, failures) {
  let attention = false, unread = false, working = false
  for (const { item, kind } of entries) {
    const id = kind === 'bot' ? (item.sessionId ?? item.id) : item.id
    const status = statuses[id] ?? {}
    const approvals = work.approvals ?? []
    attention ||= Boolean(questions[id]) || status.pendingInteraction !== undefined
      || approvals.some(entry => kind === 'room' ? entry.roomId === item.id : !entry.roomId && entry.botId === item.id)
      || failures.some(entry => entry.targetId === item.id)
    unread ||= markedUnread[item.id] === true || status.completionUnread === true
    working ||= status.running === true || (kind === 'room' && (work.rooms?.[item.id]?.length ?? 0) > 0)
      || (kind === 'bot' && (work.bots?.[item.id] !== undefined || Object.values(work.rooms ?? {}).some(members => members.some(member => member.botId === item.id))))
  }
  return { attention, unread, working }
}
