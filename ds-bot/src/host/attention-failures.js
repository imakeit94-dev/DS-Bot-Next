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

// Serialize acknowledgements so a failed save can restore its item without
// undoing another acknowledgement. A newer failure for the same target wins.
const clearing = new WeakMap()
export async function saveAttentionFailureClear(state, id, save) {
  const previous = clearing.get(state) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(async () => {
    const failures = Array.isArray(state.attentionFailures) ? state.attentionFailures : []
    const index = failures.findIndex(item => item.id === id)
    const removed = failures[index]
    if (!clearAttentionFailure(state, id)) return false
    try {
      await save({ required: true })
      return true
    } catch (error) {
      const current = Array.isArray(state.attentionFailures) ? state.attentionFailures : []
      if (removed && !current.some(item => item.targetId === removed.targetId)) {
        state.attentionFailures = [...current.slice(0, index), removed, ...current.slice(index)]
      }
      throw error
    }
  })
  clearing.set(state, operation)
  try { return await operation } finally { if (clearing.get(state) === operation) clearing.delete(state) }
}
