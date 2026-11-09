import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatWindow, windowOf } from '../src/client/chat-window.js'
import {
  callTree, callDraws, drawnCalls, visibleAssistant, visibleToolCalls,
  assistantDraws, relayKey, classifyChatNode, projectChatEntries, createChatWindowSource,
} from '../src/client/chat-entries.js'
import { heldCardKey, groupRelayKey } from '../src/client/sources.js'

// The real host delivery source (ds-bot/src/host/delivery.js:65-81) carries an
// exchangeId but no `length`; the window must still classify it as a relay.
const relaySource = (over = {}) => ({
  kind: 'bot', form: 'relay', role: 'request', exchangeId: 'ex-1',
  senderName: 'Leader', senderSessionId: 'a',
  ...over,
})
const relayData = (time, seq, over = {}) => ({ time, seq, source: relaySource(over) })
const node = (key, kind, data = {}, extra = {}) => ({ key, kind, data, ...extra })
const snap = (nodes, order = nodes.map(n => n.key)) => ({ order, nodes: new Map(nodes.map(n => [n.key, n])) })

// -------------------------------------------------------------------------
// Helpers: callTree / callDraws / drawnCalls / assistantDraws / relayKey

test('callTree walks the root and its sub-calls in dispatch order, deduplicated', () => {
  const root = {
    name: 'program', callId: 'c0', subCalls: [
      { name: 'message_bot', callId: 'c1' },
      { name: 'read', callId: 'c2', subCalls: [{ name: 'stop_bot', callId: 'c3' }] },
      { name: 'message_bot', callId: 'c1' }, // duplicate id is visited once
    ],
  }
  assert.deepEqual(callTree(root).map(c => c.name), ['program', 'message_bot', 'read', 'stop_bot'])
  assert.deepEqual(callTree(null), [])
  assert.deepEqual(callTree(undefined), [])
})

test('callDraws/drawnCalls share the real cells verdict, not a tool whitelist', () => {
  const state = {
    sessionId: 'dm',
    roster: {
      byId: { dm: { id: 'dm', name: 'Self' } },
      bots: [], rooms: [], roomsById: {}, exchangeTurns: {},
      questions: {}, views: {}, secretRequests: {},
    },
    findBot: () => undefined,
    canGiveBack: true,
  }
  const closed = { kind: 'tool-result', name: 'ask_user', callId: 'q1', args: {}, content: [] }
  // Event rows always draw; an unknown tool never does.
  assert.equal(callDraws({ name: 'message_bot', callId: 'e' }, state), true)
  assert.equal(callDraws({ name: 'stop_bot', callId: 'e2' }, state), true)
  assert.equal(callDraws({ name: 'read', callId: 'r' }, state), false)
  // A closed ask_user draws nothing until its live question exists, and nothing
  // once that question is held by the dock. A whitelist could not express this.
  assert.equal(callDraws(closed, state), false)
  const withQuestion = { ...state, roster: { ...state.roster, questions: { dm: { id: 'question', callId: 'q1' } } } }
  assert.equal(callDraws(closed, withQuestion), true)
  const held = { ...withQuestion, heldCards: { [heldCardKey('question', 'question')]: 1 } }
  assert.equal(callDraws(closed, held), false)
  // show_view is decided by the real card verdict, not by name alone.
  const view = { kind: 'tool-result', name: 'show_view', callId: 'v', argsRaw: JSON.stringify({ title: 'T', view: { type: 'metric', label: 'L', value: 1 } }), content: [] }
  assert.equal(callDraws(view, state), true)
  assert.equal(callDraws({ kind: 'tool-result', name: 'show_view', callId: 'v2', args: {}, content: [] }, state), false)
  // drawnCalls walks the program tree with exactly the same predicate.
  const root = { name: 'program', callId: 'c0', subCalls: [
    { name: 'message_bot', callId: 'c1' },
    { name: 'read', callId: 'c2' },
    closed,
  ] }
  assert.deepEqual(drawnCalls(root, withQuestion).map(c => c.name), ['message_bot', 'ask_user'])
  assert.deepEqual(drawnCalls(root, state).map(c => c.name), ['message_bot'])
  assert.deepEqual(drawnCalls({ name: 'read', callId: 'x' }, state), [])
})

test('callDraws: a running group_relay counts only shared live visible rows', () => {
  const state = {
    sessionId: 'dm',
    roster: { byId: { dm: { id: 'dm', name: 'Self' } }, bots: [], rooms: [], roomsById: {}, exchangeTurns: {} },
    groupRelays: {},
  }
  const running = { name: 'group_relay', callId: 'r1', args: {} }
  const key = groupRelayKey('dm', 'r1')
  const withLive = live => ({ ...state, groupRelays: { [key]: live } })
  assert.equal(callDraws(running, state), false, 'no live state is not a window row')
  assert.equal(callDraws(running, withLive({ replies: 0, speaking: 0, broken: false })), false)
  assert.equal(callDraws(running, withLive({ replies: 1, speaking: 0, broken: false })), true)
  assert.equal(callDraws(running, withLive({ replies: 0, speaking: 1, broken: false })), true)
  assert.equal(callDraws(running, withLive({ replies: 0, speaking: 0, broken: true })), true)
  assert.equal(callDraws(running, withLive({ replies: [{ botId: 'a', text: 'hi' }], speaking: ['a'], broken: false })), true)
  const empty = { kind: 'tool-result', name: 'group_relay', callId: 'r2', args: {}, content: [{ type: 'text', text: '{"replies":[]}' }] }
  const broken = { ...empty, callId: 'r3', content: [{ type: 'text', text: '{"replies":[' }] }
  assert.equal(callDraws(empty, state), false)
  assert.equal(callDraws(broken, state), true)
})

test('assistantDraws: reply text draws; empty reasoning never draws (F5)', () => {
  assert.equal(assistantDraws([{ kind: 'text', text: 'answer' }], false), true)
  assert.equal(assistantDraws([{ kind: 'text', text: '   ' }], false), false)
  assert.equal(assistantDraws([{ kind: 'reasoning', text: 'thought' }], false), false)
  assert.equal(assistantDraws([{ kind: 'reasoning', text: 'thought' }], true), true)
  assert.equal(assistantDraws([{ kind: 'reasoning', text: '  ' }], true), false)
  assert.equal(assistantDraws([], true), false)
  assert.equal(assistantDraws(undefined, true), false)
})

test('relayKey is a stable name derived from the event seq', () => {
  assert.equal(relayKey({ seq: 42 }), 'relay:42')
  assert.equal(relayKey({}), 'relay:undefined')
})

// -------------------------------------------------------------------------
// classifyChatNode

test('classifyChatNode: user and steering are always one non-exchange row', () => {
  for (const kind of ['user', 'steering']) {
    const rows = classifyChatNode(node('u', kind, { time: 10, seq: 1 }), { exchangeTurns: [1] })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].kind, 'user')
    assert.equal(rows[0].exchange, false)
    assert.equal(rows[0].time, 10)
    assert.equal(rows[0].seq, 1)
  }
})

test('classifyChatNode: assistant-step draws text, or reasoning only when thinking is shown', () => {
  const withText = node('a', 'assistant-step', { turn: 1, blocks: [{ kind: 'text', text: 'hi' }] })
  assert.equal(classifyChatNode(withText).length, 1)
  const emptyReasoning = node('a', 'assistant-step', { turn: 1, blocks: [{ kind: 'reasoning', text: '' }] })
  assert.equal(classifyChatNode(emptyReasoning, { thinking: true }).length, 0) // F5 phantom
  const reasoning = node('a', 'assistant-step', { turn: 1, blocks: [{ kind: 'reasoning', text: 'hmm' }] })
  assert.equal(classifyChatNode(reasoning, { thinking: false }).length, 0)
  assert.equal(classifyChatNode(reasoning, { thinking: true }).length, 1)
  assert.equal(classifyChatNode(reasoning, { thinking: true })[0].kind, 'assistant')
})

test('classifyChatNode: a tool-call draws one row per drawn call, keyed by callId (F5)', () => {
  const root = { name: 'program', callId: 'c0', subCalls: [
    { name: 'message_bot', callId: 'c1' },
    { name: 'read', callId: 'c2' },
    { name: 'stop_bot', callId: 'c3' },
  ] }
  const rows = classifyChatNode(node('t', 'tool-call', { turn: 2, root }), { exchangeTurns: [2] })
  assert.deepEqual(rows.map(r => r.key), ['t:c1', 't:c3'])
  assert.equal(rows.every(r => r.kind === 'tool' && r.exchange === true), true)
  // A non-drawn tool produces no row at all.
  assert.deepEqual(classifyChatNode(node('t2', 'tool-call', { root: { name: 'read', callId: 'r' } })), [])
})

test('classifyChatNode: turn-trigger and context relays produce a bot row (F1)', () => {
  const trigger = classifyChatNode(node('b', 'turn-trigger', relayData(50, 1)))[0]
  assert.equal(trigger.kind, 'bot')
  assert.equal(trigger.key, 'b')
  assert.equal(trigger.peerId, 'a')
  assert.equal(trigger.exchange, true)
  const context = classifyChatNode(node('ctx', 'context', relayData(50, 2)))[0]
  assert.equal(context.kind, 'bot')
  assert.equal(context.key, 'relay:2')
  assert.equal(context.exchange, true)
})

test('classifyChatNode: a handoff or a deferred/resumed/retried relay is not a chat line', () => {
  assert.deepEqual(classifyChatNode(node('b', 'turn-trigger', relayData(1, 1, { handoff: true }))), [])
  assert.deepEqual(classifyChatNode(node('b', 'turn-trigger', relayData(1, 1, { deferred: true }))), [])
  assert.deepEqual(classifyChatNode(node('b', 'turn-trigger', relayData(1, 1, { resumed: true }))), [])
  assert.deepEqual(classifyChatNode(node('b', 'turn-trigger', relayData(1, 1, { retried: true }))), [])
  assert.deepEqual(classifyChatNode(node('b', 'turn-trigger', { time: 1, seq: 1, source: { kind: 'bot', role: 'secret' } })), [])
})

test('classifyChatNode: unknown kinds and null nodes produce no rows', () => {
  assert.deepEqual(classifyChatNode(node('x', 'something-else')), [])
  assert.deepEqual(classifyChatNode(null), [])
  assert.deepEqual(classifyChatNode(undefined), [])
})

test('classifyChatNode: a hidden exchange turn draws no assistant/tool rows', () => {
  const a = node('a', 'assistant-step', { turn: 3, blocks: [{ kind: 'text', text: 'hi' }] })
  const t = node('t', 'tool-call', { root: { kind: 'tool-result', name: 'message_bot', callId: 'm1', args: {}, content: [] } }, { location: { turn: { turn: 3 } } })
  // The real cells paint CellEmpty for a hidden turn body/card, so the window
  // must not count it. Only the inline relay bubble of that turn remains.
  assert.equal(visibleAssistant(a, { exchangeTurns: [3] }), false)
  assert.deepEqual(visibleToolCalls(t, { exchangeTurns: [3] }), [])
  assert.deepEqual(classifyChatNode(a, { exchangeTurns: [3] }), [])
  assert.deepEqual(classifyChatNode(t, { exchangeTurns: [3] }), [])
  const relay = classifyChatNode(node('b', 'turn-trigger', relayData(50, 3)), { exchangeTurns: [3] })
  assert.equal(relay.length, 1)
  assert.equal(relay[0].exchange, true)
  // Outside a hidden turn the assistant row is counted, exchange=false.
  const shown = classifyChatNode(a, { exchangeTurns: [] })
  assert.equal(shown.length, 1)
  assert.equal(shown[0].exchange, false)
})

// -------------------------------------------------------------------------
// projectChatEntries

test('projectChatEntries preserves order and recovers a harness-hidden relay by time (F1)', () => {
  const u = node('u', 'user', { time: 10, seq: 1 })
  const a = node('a', 'assistant-step', { time: 100, seq: 3, blocks: [{ kind: 'text', text: 'answer' }] })
  const t = node('t', 'user', { time: 200, seq: 5 })
  // A relay context spliced mid-turn is absent from the harness's visible order.
  const c = node('ctx', 'context', relayData(50, 2))
  const rows = projectChatEntries(snap([u, a, t, c], ['u', 'a', 't']))
  assert.deepEqual(rows.map(r => r.key), ['u', 'relay:2', 'a', 't'])
  assert.equal(rows[1].kind, 'bot')
})

test('projectChatEntries does not double-count a relay already listed in order', () => {
  const c = node('ctx', 'context', relayData(50, 2))
  const a = node('a', 'assistant-step', { time: 100, seq: 3, blocks: [{ kind: 'text', text: 'answer' }] })
  const rows = projectChatEntries(snap([c, a], ['ctx', 'a']))
  assert.deepEqual(rows.map(r => r.key), ['relay:2', 'a'])
  assert.equal(rows.filter(r => r.key === 'relay:2').length, 1)
})

test('projectChatEntries ignores a phantom empty reasoning or undrawn tool (F5 probe regression)', () => {
  const b = node('b', 'turn-trigger', relayData(10, 1))
  const users = Array.from({ length: 19 }, (_, i) => node(`u${i}`, 'user', { time: 100 + i, seq: 10 + i }))
  const phantomR = node('r', 'assistant-step', { turn: 9, time: 60, seq: 2, blocks: [{ kind: 'reasoning', text: '' }] })
  const phantomTool = node('t', 'tool-call', { turn: 9, time: 70, seq: 3, root: { name: 'read', callId: 'read-1' } })
  const rows = projectChatEntries(snap([b, phantomR, phantomTool, ...users]))
  assert.equal(rows.length, 20) // 1 bot + 19 users; phantoms add nothing
  const projection = chatWindow(rows)
  assert.equal(projection.byKey.size, 20)
  assert.equal(windowOf(projection, 'b').hidden, false) // newest Bot never folds
})

test('projectChatEntries classifies a real delivery source with no length field (F2 shape)', () => {
  const data = relayData(50, 2)
  assert.equal('length' in data.source, false)
  assert.equal('exchangeId' in data.source, true)
  const rows = projectChatEntries(snap([node('c', 'context', data)]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'bot')
  assert.equal(rows[0].key, 'relay:2')
  const trigger = projectChatEntries(snap([node('b', 'turn-trigger', data)]))
  assert.equal(trigger.length, 1)
  assert.equal(trigger[0].kind, 'bot')
})

test('projectChatEntries threads thinking and drops a hidden exchange-turn body', () => {
  const r = node('r', 'assistant-step', { turn: 1, time: 20, seq: 2, blocks: [{ kind: 'reasoning', text: 'hmm' }] })
  const u = node('u', 'user', { time: 10, seq: 1 })
  assert.equal(projectChatEntries(snap([u, r]), { thinking: false }).length, 1)
  // Thinking reveals the reasoning row; it is a normal (non-exchange) row.
  const shown = projectChatEntries(snap([u, r]), { thinking: true })
  assert.equal(shown.length, 2)
  assert.equal(shown[1].exchange, false)
  // But a hidden exchange turn must not resurrect that body (cells paint CellEmpty).
  const hidden = projectChatEntries(snap([u, r]), { thinking: true, exchangeTurns: [1] })
  assert.equal(hidden.length, 1)
  assert.equal(hidden[0].key, 'u')
})

test('projectChatEntries tolerates a missing node store', () => {
  assert.deepEqual(projectChatEntries({ order: ['a', 'b'] }), [])
  assert.deepEqual(projectChatEntries(undefined), [])
})

// -------------------------------------------------------------------------
// createChatWindowSource (F6)

const counterProject = () => {
  let calls = 0
  return { project: () => ({ n: ++calls }), calls: () => calls }
}

test('F6: identical snapshots reuse the cached projection', () => {
  const snapshot = snap([node('u', 'user')])
  const state = { exchangeTurns: {}, prefs: {}, roomsById: {}, bots: [], byId: {} }
  const { project, calls } = counterProject()
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project })
  const a = source.getSnapshot()
  const b = source.getSnapshot()
  assert.equal(a, b)
  assert.equal(calls(), 1)
})

test('F6: a new chat snapshot reference invalidates the cache', () => {
  let snapshot = snap([node('u', 'user')])
  const state = { exchangeTurns: {}, prefs: {}, roomsById: {}, bots: [], byId: {} }
  const { project, calls } = counterProject()
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project })
  const a = source.getSnapshot()
  snapshot = snap([node('u2', 'user')])
  const b = source.getSnapshot()
  assert.notEqual(a, b)
  assert.equal(calls(), 2)
})

test('F6: a new roster snapshot reference invalidates the cache', () => {
  const snapshot = snap([node('u', 'user')])
  let state = { exchangeTurns: {}, prefs: {}, roomsById: {}, bots: [], byId: {} }
  const { project, calls } = counterProject()
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project })
  const a = source.getSnapshot()
  state = { ...state }
  const b = source.getSnapshot()
  assert.notEqual(a, b)
  assert.equal(calls(), 2)
})

test('F6: an in-place exchangeTurns push invalidates the cache (probe regression)', () => {
  const snapshot = snap([node('u', 'user')])
  const turns = []
  const state = { exchangeTurns: { dm: turns }, prefs: {}, roomsById: {}, bots: [], byId: {} }
  const { project, calls } = counterProject()
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project })
  const before = source.getSnapshot()
  assert.equal(source.getSnapshot(), before) // stable before the push
  turns.push(1) // same state object, same array reference, changed length
  const after = source.getSnapshot()
  assert.notEqual(after, before)
  assert.equal(calls(), 2)
})

test('F6: an in-place thinking preference flip invalidates the cache', () => {
  const snapshot = snap([node('u', 'user')])
  const state = { exchangeTurns: {}, prefs: { thinking: false }, roomsById: {}, bots: [], byId: {} }
  const { project, calls } = counterProject()
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project })
  const before = source.getSnapshot()
  state.prefs.thinking = true // same state object reference
  const after = source.getSnapshot()
  assert.notEqual(after, before)
  assert.equal(calls(), 2)
})

test('F6: a real projection changes when thinking reveals a reasoning-only row', () => {
  const u = node('u', 'user', { time: 10, seq: 1 })
  const r = node('r', 'assistant-step', { turn: 1, time: 20, seq: 2, blocks: [{ kind: 'reasoning', text: 'hmm' }] })
  const snapshot = snap([u, r])
  const state = { exchangeTurns: {}, prefs: { thinking: false }, roomsById: {}, bots: [], byId: {} }
  const project = (snapValue, sid) => chatWindow(projectChatEntries(snapValue, {
    thinking: state.prefs?.thinking === true,
    exchangeTurns: state.exchangeTurns?.[sid] ?? [],
  }))
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project })
  const before = source.getSnapshot()
  state.prefs.thinking = true
  const after = source.getSnapshot()
  assert.equal(before.byKey.size, 1)
  assert.equal(after.byKey.size, 2)
})

test('createChatWindowSource.subscribe merges chat and roster listeners', () => {
  let chatOff = 0
  let rosterOff = 0
  const chat = { getSnapshot: () => snap([]), subscribe: () => () => { chatOff += 1 } }
  const roster = { getSnapshot: () => ({}), subscribe: () => () => { rosterOff += 1 } }
  const source = createChatWindowSource({ chat, roster, sessionId: 'dm', project: () => ({}) })
  const off = source.subscribe(() => {})
  off()
  assert.equal(chatOff, 1)
  assert.equal(rosterOff, 1)
})

test('createChatWindowSource.subscribe tolerates a roster without subscribe (probe shape)', () => {
  let chatOff = 0
  const chat = { getSnapshot: () => snap([]), subscribe: () => () => { chatOff += 1 } }
  const roster = { getSnapshot: () => ({ exchangeTurns: {}, prefs: {} }) } // no subscribe
  const source = createChatWindowSource({ chat, roster, sessionId: 'dm', project: () => ({}) })
  assert.doesNotThrow(() => source.subscribe(() => {})())
  assert.equal(chatOff, 1)
})

test('F6: a real draw-state source invalidates the cache and is subscribed', () => {
  const snapshot = snap([node('u', 'user')])
  const state = { exchangeTurns: {}, prefs: {}, roomsById: {}, bots: [], byId: {} }
  const { project, calls } = counterProject()
  let heldSnapshot = { a: 1 }
  let heldOff = 0
  let listener
  const held = {
    getSnapshot: () => heldSnapshot,
    subscribe: fn => { listener = fn; return () => { heldOff += 1 } },
  }
  const source = createChatWindowSource({ chat: { getSnapshot: () => snapshot }, roster: { getSnapshot: () => state }, sessionId: 'dm', project, sources: [held] })
  const before = source.getSnapshot()
  assert.equal(source.getSnapshot(), before) // identical draw-state reuses the cache
  heldSnapshot = { a: 2 } // a new heldCards/browserHolds snapshot must recompute
  assert.notEqual(source.getSnapshot(), before)
  assert.equal(calls(), 2)
  const off = source.subscribe(() => {})
  assert.equal(typeof listener, 'function') // the new source is subscribed
  off()
  assert.equal(heldOff, 1) // and torn down
})
