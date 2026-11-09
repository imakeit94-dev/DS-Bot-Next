// -------------------------------------------------------------------------
// Chat entry classification (pure, node-safe).
//
// The chat window counts the rows a reader actually sees: a plain user message,
// an assistant reply that draws text or reasoning, one card per drawn tool call,
// and one bubble per Bot-to-Bot relay. Relay contexts spliced into a running
// turn are hidden from the harness's visible order, so they are recovered from
// the node store under a stable `relay:<seq>` key and inserted by event time.
//
// `callDraws` is the ONE rule that says whether a tool call becomes a visible
// card. Both this projection and cells.js renderCall consult it, so a closed
// question or a hidden exchange body can never inflate the last-20 window.
// It reads only plain data: no React, no DOM, no hooks.

import { toolName, toolArgs, contentText, isRelayContext } from './text.js'
import { parseReplies, groupReplyDraws } from '../shared/group-replies.js'
import { heldCardKey, groupRelayKey } from './sources.js'
import { checkShownView } from 'deep-view/core'

const EMPTY = {}

// The root and its sub-calls in dispatch order, each call once.
export function callTree(root) {
  const calls = []
  if (root === undefined || root === null) return calls
  const seen = new Set()
  const visit = (call) => {
    if (call === undefined || call === null) return
    const id = call.callId ?? call
    if (seen.has(id)) return
    seen.add(id)
    calls.push(call)
    for (const child of call.subCalls ?? []) visit(child)
  }
  visit(root)
  return calls
}

const MEMORY_SAVED = /^(Saved to|Updated in|Removed from) /
const MEMORY_TEAM = /^(team|团队|共享)$/i

// Whether one tool call produces a visible card. Mirrors renderCall and the
// card components case by case; the projection and ToolCell share this verdict.
// `state`: { sessionId, roster, heldCards, browserHold, canGiveBack, findBot,
// groupRelays }. groupRelays is the shared live-state snapshot of running
// group_relay rounds, keyed by groupRelayKey(sessionId, callId).
export function callDraws(call, state = EMPTY) {
  if (call === undefined || call === null) return false
  const tool = toolName(call)
  const done = call.kind === 'tool-result'
  const roster = state.roster ?? EMPTY
  const sessionId = state.sessionId
  const heldCards = state.heldCards ?? EMPTY
  const findBot = state.findBot ?? (() => undefined)
  const { text: arg, value: argValue } = toolArgs(call)
  const self = roster.byId?.[sessionId]
  const held = (kind, id) => (heldCards[heldCardKey(kind, id)] ?? 0) > 0
  switch (tool) {
    case 'message_bot':
    case 'stop_bot':
      return true
    case 'create_bot':
      return done && findBot(arg('name')) !== undefined
    case 'update_bot': {
      const target = findBot(arg('name')) ?? findBot(arg('bot')) ?? (arg('bot') ? undefined : self)
      return done && target !== undefined
    }
    case 'group_relay': {
      if (done) {
        const parsed = parseReplies(contentText(call.content))
        return groupReplyDraws({ replies: parsed.replies.length, speaking: 0, broken: parsed.broken })
      }
      return call.callId ? groupReplyDraws(state.groupRelays?.[groupRelayKey(sessionId, call.callId)]) : false
    }
    case 'create_group':
    case 'update_group':
    case 'delete_group':
    case 'post_to_group':
      return done
    case 'ask_user': {
      const question = roster.questions?.[sessionId]
      if (question === undefined || question.callId !== call.callId) return false
      return !held('question', question.id)
    }
    case 'show_view': {
      const record = roster.views?.[sessionId]
      if (record !== undefined && record.callId === call.callId) return !held('view', record.id)
      if (done && call.isError) return false
      const shown = checkShownView(arg('title'), argValue('view'))
      return shown.error === undefined && !shown.interactive && argValue('await_reply') !== true
    }
    case 'request_secret': {
      if (self === undefined) return false
      const request = (roster.secretRequests?.[self.id] ?? []).find(entry => entry.callId === call.callId && (entry.sessionId ?? sessionId) === sessionId)
      if (request !== undefined) return !(request.status === 'pending' && held('secret', request.id))
      const text = contentText(call.content)
      return done && (/already saved/.test(text) || text.startsWith('No card can be shown now'))
    }
    case 'browser_handoff':
      return self !== undefined && state.browserHold?.callId === call.callId && state.canGiveBack === true && !held('handoff', call.callId)
    case 'ask_user_question': {
      if (!done) return false
      let parsed = null
      try { parsed = JSON.parse(contentText(call.content)) } catch { parsed = null }
      return Boolean(parsed?.answers?.[0])
    }
    case 'read_group_chat':
      return done && (roster.rooms ?? []).some(entry => entry.name === arg('group'))
    case 'remember':
    case 'forget': {
      if (!done) return false
      const result = contentText(call.content)
      const failed = call.isError === true
      const named = String(arg('scope') ?? '').trim()
      const other = MEMORY_TEAM.test(named) || named === '' ? undefined : findBot(named)
      const target = other && other.id !== self?.id ? other : self
      // MemoryEvent leaves an empty cell only for an unsaved write with no target.
      return !(!failed && MEMORY_SAVED.test(result) && !target)
    }
    default:
      return false
  }
}

// Only the calls that actually become cards. One root can draw several of them.
export const drawnCalls = (root, state = EMPTY) => callTree(root).filter(call => callDraws(call, state))

// An assistant step draws when it has reply text, or when thinking is shown and
// it carries reasoning. An empty reasoning block is not a row (F5).
export function assistantDraws(blocks, thinking) {
  const list = Array.isArray(blocks) ? blocks : []
  const hasText = list.some(block => block?.kind === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
  if (hasText) return true
  return thinking === true && list.some(block => block?.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '')
}

// A relay context has no visible node key; its event seq is the durable name.
export const relayKey = data => `relay:${data?.seq}`

const turnsOf = state => (Array.isArray(state.exchangeTurns) ? state.exchangeTurns : [])

// The real AssistantCell hides a room turn or an exchange turn's own body; the
// relay bubbles it still draws are counted separately from their context nodes.
export function visibleAssistant(node, state = EMPTY) {
  const data = node?.data ?? {}
  const turn = data.turn
  const hidden = Boolean(state.roster?.roomsById?.[state.sessionId]) || (turn !== undefined && turnsOf(state).includes(turn))
  if (hidden) return false
  return assistantDraws(data.blocks, state.thinking === true)
}

// The real ToolCell hides every card of an exchange turn. Otherwise the rows
// are exactly the calls callDraws accepts — the same verdict renderCall uses.
export function visibleToolCalls(node, state = EMPTY) {
  const data = node?.data ?? {}
  const turn = node?.location?.turn?.turn ?? data.root?.turn
  const hidden = turn !== undefined && turnsOf(state).includes(turn)
  if (hidden) return []
  return drawnCalls(data.root, state)
}

// One chat node can produce zero, one or several UI entries. `state` carries
// the roster/card state callDraws needs, plus thinking and exchangeTurns.
export function classifyChatNode(node, state = EMPTY) {
  if (node === undefined || node === null) return []
  const key = node.key
  const data = node.data ?? {}
  const turns = turnsOf(state)
  const turn = node.location?.turn?.turn ?? data.turn
  const exchange = turn !== undefined && turns.includes(turn)
  const time = Number.isFinite(data.time) ? data.time : undefined
  const seq = Number.isFinite(data.seq) ? data.seq : undefined
  const stamp = row => ({ ...row, ...(time !== undefined ? { time } : {}), ...(seq !== undefined ? { seq } : {}) })
  switch (node.kind) {
    case 'user':
    case 'steering':
      return [stamp({ key, kind: 'user', exchange: false })]
    case 'assistant-step':
      return visibleAssistant(node, state) ? [stamp({ key, kind: 'assistant', exchange })] : []
    case 'tool-call':
      return visibleToolCalls(node, state).map((call, index) => stamp({ key: `${key}:${call?.callId ?? index}`, kind: 'tool', exchange }))
    case 'turn-trigger':
      return isRelayContext(data) ? [stamp({ key, kind: 'bot', exchange: true, peerId: data.source?.senderSessionId })] : []
    case 'context':
      return isRelayContext(data) ? [stamp({ key: relayKey(data), kind: 'bot', exchange: true, peerId: data.source?.senderSessionId })] : []
    default:
      return []
  }
}

// The ordered rows of a chat snapshot. The harness keeps plain relay context
// nodes out of `order`, so they are added back from the node store by event time.
// A synthetic snapshot that already lists them in `order` is not counted twice.
export function projectChatEntries(snapshot, state = EMPTY) {
  const rows = []
  const times = []
  const nodeKeys = new Set()
  const getNode = key => snapshot?.nodes?.get?.(key)
  const order = Array.isArray(snapshot?.order) ? snapshot.order : []
  for (const key of order) {
    const node = getNode(key)
    if (node === undefined || node === null) continue
    nodeKeys.add(node.key)
    for (const row of classifyChatNode(node, state)) {
      rows.push(row)
      times.push([row.time ?? 0, row.seq ?? 0])
    }
  }
  const values = snapshot?.nodes?.values?.()
  if (values === undefined) return rows
  const seenKeys = new Set(rows.map(row => row.key))
  const extras = []
  for (const node of values) {
    if (node === undefined || node === null) continue
    if (node.kind !== 'context' || !isRelayContext(node.data)) continue
    if (nodeKeys.has(node.key) || seenKeys.has(relayKey(node.data))) continue
    const row = classifyChatNode(node, state)[0]
    if (row === undefined) continue
    seenKeys.add(row.key)
    extras.push(row)
  }
  for (const row of extras) {
    const time = row.time ?? 0
    const seq = row.seq ?? 0
    let at = rows.length
    for (let index = 0; index < rows.length; index += 1) {
      const [rowTime, rowSeq] = times[index]
      if (rowTime > time || (rowTime === time && rowSeq > seq)) { at = index; break }
    }
    rows.splice(at, 0, row)
    times.splice(at, 0, [time, seq])
  }
  return rows
}

// A per-session observable projection. The cache key tracks the chat snapshot,
// the roster snapshot, the exchangeTurns array for this session (in-place pushes
// included via its length), the thinking preference's boolean value (F6), and
// every extra source the draw verdict reads (held cards, browser holds, live
// group relay rows).
export function createChatWindowSource({ chat, roster, sessionId, project, sources = [] }) {
  let last
  const stateOf = () => (typeof roster?.getSnapshot === 'function' ? roster.getSnapshot() : roster)
  const source = {
    getSnapshot: () => {
      const snapshot = chat.getSnapshot()
      const state = stateOf()
      const exchangeTurns = state?.exchangeTurns?.[sessionId]
      const thinking = state?.prefs?.thinking === true
      const key = [snapshot, state, exchangeTurns, Array.isArray(exchangeTurns) ? exchangeTurns.length : -1, thinking,
        ...sources.map(src => (typeof src?.getSnapshot === 'function' ? src.getSnapshot() : undefined))]
      if (last !== undefined && last.key.length === key.length && last.key.every((value, index) => value === key[index])) return last.projection
      last = { key, projection: project(snapshot, sessionId) }
      return last.projection
    },
    subscribe: (listener) => {
      const offChat = typeof chat?.subscribe === 'function' ? chat.subscribe(listener) : undefined
      const offRoster = typeof roster?.subscribe === 'function' ? roster.subscribe(listener) : undefined
      const offSources = sources.map(src => (typeof src?.subscribe === 'function' ? src.subscribe(listener) : undefined))
      return () => {
        if (typeof offChat === 'function') offChat()
        if (typeof offRoster === 'function') offRoster()
        for (const off of offSources) if (typeof off === 'function') off()
      }
    },
  }
  return source
}
