import { randomUUID } from 'node:crypto'

const LIMIT = 100

// Keep only an identity and destination; error details stay in the conversation.
export function recordAttentionFailure(state, targetId, botId, at = Date.now()) {
  if (!targetId || (!Object.hasOwn(state.bots, targetId) && !Object.hasOwn(state.rooms, targetId))) return false
  const failures = Array.isArray(state.attentionFailures) ? state.attentionFailures : []
  state.attentionFailures = [...failures.filter(item => item.targetId !== targetId), { id: randomUUID(), targetId, ...(botId ? { botId } : {}), at }].slice(-LIMIT)
  return true
}

// A stale click cannot clear a failure that arrived after the list was rendered.
export function clearAttentionFailure(state, id) {
  if (typeof id !== 'string' || !id) throw Object.assign(new Error('Invalid failure'), { code: 'bot/invalid' })
  const failures = Array.isArray(state.attentionFailures) ? state.attentionFailures : []
  const next = failures.filter(item => item.id !== id)
  if (next.length === failures.length) return false
  state.attentionFailures = next
  return true
}
