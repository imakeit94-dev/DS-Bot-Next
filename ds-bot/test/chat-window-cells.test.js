import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

import { chatWindow, windowOf } from '../src/client/chat-window.js'
import { projectChatEntries, createChatWindowSource } from '../src/client/chat-entries.js'
import { isRelayContext } from '../src/client/text.js'
import { createSource, groupRelayKey } from '../src/client/sources.js'

// Reviewer's chat-window20-probe.mjs, turned into in-repo regressions. Every
// observation the probe recorded as a defect (F1–F6) is asserted here in its
// fixed form against the real index.js window slice and the real cells.js.
// The harness is the probe's: the index.js slice runs in a vm with the pure
// modules injected, and cells.js is bundled once and rendered with a minimal
// React where components are plain functions.

const indexText = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
const section = indexText.slice(
  indexText.indexOf('  const chatWindowSources ='),
  indexText.indexOf('  const cellFace ='),
)
assert.ok(section.includes('projectChatEntries') && section.includes('createChatWindowSource'),
  'index.js window slice must expose the new pure-module calls')

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/cells.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

const Fragment = 'fragment'
const react = {
  createContext: v => ({ value: v }),
  useContext: c => c.value,
  useCallback: f => f,
  useId: () => '',
  useSyncExternalStore: (_, get) => get(),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: v => [v, () => {}],
  useEffect: () => {},
  useRef: v => ({ current: v }),
  useLayoutEffect: () => {},
  useMemo: f => f(),
  Fragment,
}
const cellsModule = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module: cellsModule, exports: cellsModule.exports,
  AbortController, fetch,
  require: name => ({
    react,
    'react-dom': { createPortal: n => n },
    '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
  }[name]),
})
const { AssistantCell, TriggerCell, ToolCell, CellEmpty } = cellsModule.exports

// -------------------------------------------------------------------------
// Fixtures (probe's shapes). The relay source mirrors host/delivery.js:65-81:
// it carries exchangeId but deliberately no `length` (that is F2).

const makeRoster = () => ({
  bots: [], byId: { dm: { id: 'dm', name: 'Self' }, a: { id: 'a', name: 'Leader' } },
  roomsById: {}, exchangeTurns: {}, prefs: {},
})
const relaySource = () => ({ kind: 'bot', form: 'relay', role: 'request', senderSessionId: 'a', exchangeId: 'ex' })
const user = key => ({ key, kind: 'user', data: {} })
const assistant = (key, turn = 1, blocks = [{ kind: 'text', text: 'answer' }]) => ({
  key, kind: 'assistant-step', location: { turn: { turn, status: 'closed' } },
  data: { turn, step: 1, time: 100, status: 'settled', blocks },
})
const bot = (key, over = {}) => ({
  key, kind: 'turn-trigger', location: { turn: { turn: 1 } },
  data: {
    seq: 1, time: 50, source: relaySource(),
    content: [{ type: 'text', text: '[Message from Leader]\nhello' }],
    ...over,
  },
})
const snap = nodes => ({ order: nodes.map(n => n.key), nodes: new Map(nodes.map(n => [n.key, n])) })
// Real harness: plain relay 'context' nodes are kept out of `order`, but live
// in the node store. projectChatEntries must recover them from values().
const snapHiddenContext = (visible, hidden) => ({
  order: visible.map(n => n.key),
  nodes: new Map([...visible, ...hidden].map(n => [n.key, n])),
})

const makeBase = roster => ({
  sessionId: 'dm', useRoster: s => s(roster), useUi: s => s({}),
  useSessions: s => s({ byId: {} }), useTurnClock: s => s({}),
  useTurnData: () => undefined, useTurnSteps: () => [], useTurnContext: () => [],
  fileMentions: () => undefined, actions: { noteLive() {}, noteTurnPeer() {} },
})
const makeChat = initial => {
  let current = initial
  return { getSnapshot: () => current, subscribe: () => () => {}, set: v => { current = v } }
}
// The vm gets the real pure modules; `roster` is wrapped the way index.js sees
// it (getSnapshot -> state), and `uiConversation.binding(...).target('chat')`
// yields the chat observable.
const makeSources = (roster, chat, groupRelays = createSource({})) => runInNewContext(
  `(()=>{${section}; return {projectChat,chatWindowSource}})()`,
  {
    roster: { getSnapshot: () => roster },
    ctx: {
      sessions: { binding: () => ({}) },
      uiConversation: { binding: () => ({ target: () => chat }) },
    },
    chatWindow, projectChatEntries, createChatWindowSource, isRelayContext, groupRelays,
  },
)
const walk = (n, p) => Array.isArray(n) ? n.flatMap(c => walk(c, p))
  : n && typeof n === 'object' ? [...(p(n) ? [n] : []), ...walk(n.children, p)] : []

// F3 (P1 regression): "old normal AssistantCell: CellEmpty after 20 later user
// nodes". A plain reply keeps its body; only Bot-to-Bot messages can fold.
test('F3: a normal historical assistant keeps its body and is never hidden', () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const nodes = [assistant('old'), ...Array.from({ length: 20 }, (_, i) => user(`u${i}`))]
  const projection = sources.projectChat(snap(nodes), 'dm')
  assert.equal(windowOf(projection, 'old').hidden, false)
  assert.equal(windowOf(projection, 'old').bubble, false)
  const view = AssistantCell({ ...makeBase(roster), node: nodes[0], useChatWindow: s => s(projection) })
  assert.notEqual(view.type, CellEmpty)
  assert.ok(walk(view, n => n.type?.name === 'Bubbles').length >= 1, 'reply bubbles are still drawn')
})

// F4 (P2): "newest Bot outside window: hidden=true". The latest Bot message is
// a visible bubble wherever it sits, with no summary line for it.
test('F4: the newest Bot message stays a visible bubble even wholly before the window', () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const nodes = [bot('latest'), ...Array.from({ length: 20 }, (_, i) => user(`u${i}`))]
  const projection = sources.projectChat(snap(nodes), 'dm')
  assert.equal(windowOf(projection, 'latest').hidden, false)
  assert.equal(windowOf(projection, 'latest').bubble, true)
  assert.equal(projection.summaries.length, 0)
})

// F1 (P1): "inline context: no projection entry; AssistantCell still renders
// EventLine, no BotWindowMessage". The context relay is recovered under a
// stable relay:<seq> key and drawn as a left Bot bubble, not an event line.
test('F1: an inline relay context gets a projection entry and renders as a Bot bubble', () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const relayContext = { ...bot('inline'), kind: 'context' }
  const answer = assistant('answer')
  const projection = sources.projectChat(snapHiddenContext([answer], [relayContext]), 'dm')
  assert.equal(projection.byKey.has('inline'), false, 'context uses the stable relay key, not the node key')
  assert.equal(projection.byKey.has('relay:1'), true)
  assert.equal(windowOf(projection, 'relay:1').hidden, false)
  const rendered = AssistantCell({
    ...makeBase(roster), node: answer, useChatWindow: s => s(projection),
    useTurnSteps: () => [answer.data], useTurnContext: () => [relayContext.data],
  })
  assert.equal(walk(rendered, n => n.type?.name === 'BotWindowMessage').length, 1)
  assert.equal(walk(rendered, n => n.type?.name === 'EventLine').length, 0)
})

// F5 (P2): "empty reasoning / read tool counted 21 ... Bot folded". Phantom
// rows must not inflate the window, and the Bot must stay visible.
test('F5: empty reasoning and an undrawn tool do not inflate the window', () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const phantoms = [
    assistant('empty', 2, [{ kind: 'reasoning', text: '' }]),
    { key: 'tool', kind: 'tool-call', data: { root: { name: 'read', turn: 2 } } },
  ]
  for (const phantom of phantoms) {
    const nodes = [bot('b'), ...Array.from({ length: 19 }, (_, i) => user(`u${i}`)), phantom]
    const projection = sources.projectChat(snap(nodes), 'dm')
    assert.equal(projection.byKey.size, 20, `${phantom.key}: Bot + 19 users = 20 visible entries`)
    assert.equal(windowOf(projection, 'b').hidden, false)
    assert.equal(windowOf(projection, 'b').bubble, true)
  }
})

// F2 (P2): "long-message TriggerCell: whole=undefined, retained long-note, no
// exchangeText loader". Without source.length, relayWhole derives length from
// the note, offers a loader, strips the preview note, and degrades honestly.
test('F2: a long relay without source.length gets a loader and drops the note', async () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const long = bot('long', {
    content: [
      { type: 'text', text: '[Message from Leader]\n[A long message: 50000 characters. Its start is below; all of it is in the attached file. Read the file before you act on it.]\nSTART…' },
      { type: 'file', attachment: { id: 'fixture' } },
    ],
  })
  const projection = sources.projectChat(snap([long]), 'dm')
  const base = makeBase(roster)
  const longView = TriggerCell({ ...base, node: long, useChatWindow: s => s(projection) })
  assert.equal(longView.type?.name, 'BotWindowMessage')
  assert.ok(longView.props.whole, 'a whole-text loader is offered')
  assert.equal(longView.props.whole.length, 50000)
  assert.equal(longView.props.text, 'START…')
  assert.ok(!longView.props.text.includes('[A long message:'))
  // The loader prefers the exchange record, and says so when nothing is kept.
  const full = TriggerCell({
    ...base, node: long, useChatWindow: s => s(projection),
    actions: { ...base.actions, exchangeText: async () => ({ text: 'x'.repeat(50000), whole: true }) },
  })
  const loaded = await full.props.whole.load()
  assert.equal(loaded.whole, true)
  assert.equal(loaded.text.length, 50000)
  const missing = await longView.props.whole.load()
  assert.equal(missing.whole, false)
  assert.ok(typeof missing.text === 'string' && missing.text.length > 0)
})

// F6 (P2): "roster-only exchangeTurns change: cached summary remains 1".
// The cache key tracks the exchangeTurns reference, its length (in-place push)
// and the thinking preference, so roster-only changes invalidate it.
test('F6: roster-only exchangeTurns / thinking changes invalidate the cached projection', () => {
  const roster = makeRoster()
  const chat = makeChat(snap([bot('b'), assistant('a'), ...Array.from({ length: 20 }, (_, i) => user(`u${i}`))]))
  const sources = makeSources(roster, chat)
  const cached = sources.chatWindowSource('dm')
  assert.ok(cached !== undefined)
  const before = cached.getSnapshot()
  assert.equal(cached.getSnapshot(), before, 'unchanged inputs reuse the cached projection')
  // Reassigning exchangeTurns.dm (same roster object identity) must invalidate.
  roster.exchangeTurns.dm = [1]
  const after = cached.getSnapshot()
  assert.notEqual(after, before)
  assert.equal(cached.getSnapshot(), after)
  // An in-place push keeps the array reference but changes its length (F6 core).
  roster.exchangeTurns.dm.push(2)
  assert.notEqual(cached.getSnapshot(), after)
  const afterPush = cached.getSnapshot()
  // The thinking preference is part of the key too.
  roster.prefs.thinking = true
  assert.notEqual(cached.getSnapshot(), afterPush)
})

// Group chats keep their own flow: no window projection at all (roomsById).
test('group chat: chatWindowSource returns undefined so the original path is untouched', () => {
  const roster = makeRoster()
  roster.roomsById.room1 = { id: 'room1', name: 'Lab' }
  const sources = makeSources(roster, makeChat(snap([])))
  assert.equal(sources.chatWindowSource('room1'), undefined)
})

// R1: projection and ToolCell must use the same draw verdict, including a
// question that was answered or closed and now draws only an empty cell.
test('R1: a closed ask_user cannot inflate the window or evict an older Bot', () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const closedQuestion = {
    key: 'q', kind: 'tool-call', location: { turn: { turn: 2 } },
    data: { root: { kind: 'tool-result', name: 'ask_user', callId: 'q1', args: {}, content: [] } },
  }
  const realRows = [
    bot('older', { seq: 7, time: 7 }),
    bot('newestBoundary', { seq: 8, time: 8 }),
    ...Array.from({ length: 18 }, (_, i) => user(`boundary${i}`)),
  ]
  const expected = sources.projectChat(snap(realRows), 'dm')
  assert.equal(expected.byKey.size, 20, '2 Bots + 18 users = 20 visible entries')
  assert.equal(windowOf(expected, 'older').hidden, false)
  assert.equal(windowOf(expected, 'newestBoundary').bubble, true)
  const withClosed = sources.projectChat(snap([...realRows, closedQuestion]), 'dm')
  assert.equal(withClosed.byKey.size, 20, 'a closed tool draws no UI entry')
  assert.equal(windowOf(withClosed, 'older').hidden, false)
  assert.equal(windowOf(withClosed, 'newestBoundary').bubble, true)
  const view = ToolCell({ ...makeBase(roster), node: closedQuestion })
  assert.ok(walk(view, n => n.type === CellEmpty).length >= 1, 'real ToolCell draws only an empty cell')
  assert.equal(walk(view, n => n.type?.name === 'PendingQuestion').length, 0)
})

// R1: an exchange turn hides both its assistant body and its tool cards; the
// projection must not give either one a window seat.
test('R1: a hidden exchange turn draws no assistant or tool window entries', () => {
  const roster = makeRoster()
  roster.exchangeTurns.dm = [1]
  const sources = makeSources(roster, makeChat(undefined))
  const answer = assistant('hiddenAnswer', 1)
  const tool = {
    key: 'hiddenTool', kind: 'tool-call', location: { turn: { turn: 1 } },
    data: { root: { kind: 'tool-result', name: 'message_bot', callId: 'm1', args: {}, content: [] } },
  }
  const projection = sources.projectChat(snap([answer, tool]), 'dm')
  assert.equal(projection.byKey.size, 0)
  assert.equal(projection.summaries.length, 0)
  const answerView = AssistantCell({
    ...makeBase(roster), node: answer, useChatWindow: s => s(projection),
  })
  assert.equal(answerView.type, CellEmpty)
  const toolView = ToolCell({ ...makeBase(roster), node: tool })
  assert.equal(toolView.type, CellEmpty)
})

// R2: two folded relay runs can belong to one answering step. Each run has its
// own summary key, and inlineRelayViews must draw both instead of capping the
// whole step at one fold line.
test('R2: two folded relay runs in one step render both summary lines', () => {
  const roster = makeRoster()
  const sources = makeSources(roster, makeChat(undefined))
  const c1 = { ...bot('c1', { seq: 11, time: 10 }), kind: 'context' }
  const steering = { ...user('steering'), kind: 'steering', data: { time: 20 } }
  const c2 = { ...bot('c2', { seq: 12, time: 30 }), kind: 'context' }
  const answer = assistant('answer', 1)
  const tail = [
    ...Array.from({ length: 20 }, (_, i) => user(`tail${i}`)),
    bot('newest', { seq: 99, time: 500 }),
  ]
  const projection = sources.projectChat(snap([c1, steering, c2, answer, ...tail]), 'dm')
  assert.equal(projection.byKey.size, 25)
  assert.deepEqual(projection.summaries.map(summary => summary.key), ['relay:11', 'relay:12'])
  assert.equal(windowOf(projection, 'relay:11').hidden, true)
  assert.equal(windowOf(projection, 'relay:12').hidden, true)
  assert.equal(windowOf(projection, 'newest').bubble, true)
  const rendered = AssistantCell({
    ...makeBase(roster), node: answer, useChatWindow: s => s(projection),
    useTurnSteps: () => [answer.data], useTurnContext: () => [c1.data, c2.data],
  })
  assert.equal(walk(rendered, n => n.type?.name === 'BotWindowFold').length, 2)
})

// P1: a visible tool cell that becomes a hidden exchange turn must not skip
// useBrowserHolds, or React sees a different hook order on the next render.
test('P1: ToolCell keeps its browser-hold hook across a visible-to-hidden switch', () => {
  const roster = makeRoster()
  const node = {
    key: 't', kind: 'tool-call', location: { turn: { turn: 3 } },
    data: { root: { kind: 'tool-result', name: 'message_bot', callId: 'm', args: {}, content: [] } },
  }
  let calls = 0
  const base = {
    ...makeBase(roster),
    useBrowserHolds: (selector) => { calls += 1; return selector({}) },
  }
  const visible = ToolCell({ ...base, node })
  assert.notEqual(visible.type, CellEmpty)
  roster.exchangeTurns.dm = [3]
  const hidden = ToolCell({ ...base, node })
  assert.equal(hidden.type, CellEmpty)
  assert.equal(calls, 2, 'useBrowserHolds runs before the hidden early return')
})

// P2: a running group_relay is a live probe. It gets a window seat only once
// its shared live state has a reply, a speaker, or a broken payload.
test('P2: an empty running group_relay gets no window seat until live rows appear', () => {
  const roster = makeRoster()
  const runningRelay = {
    key: 'relay', kind: 'tool-call', location: { turn: { turn: 2 } },
    data: { root: { phase: 'start', name: 'group_relay', callId: 'r1', argsRaw: '{}', subCalls: [], turn: 2 } },
  }
  const realRows = [
    bot('older', { seq: 7, time: 7 }),
    bot('newestBoundary', { seq: 8, time: 8 }),
    ...Array.from({ length: 18 }, (_, i) => user(`boundary${i}`)),
  ]
  const nodes = [...realRows, runningRelay]
  const key = groupRelayKey('dm', 'r1')
  const groupRelays = createSource({ [key]: { replies: [], speaking: [], broken: false } })
  const sources = makeSources(roster, makeChat(snap(nodes)), groupRelays)

  const empty = sources.projectChat(snap(nodes), 'dm')
  assert.equal(empty.byKey.size, 20, '20 real rows plus an empty running relay stay 20')
  assert.equal(windowOf(empty, 'older').hidden, false)
  assert.equal(windowOf(empty, 'newestBoundary').bubble, true)

  const actions = { ...makeBase(roster).actions, groupRelays }
  const view = ToolCell({ ...makeBase(roster), node: runningRelay, actions })
  const probe = walk(view, n => n.type?.name === 'GroupReplies')
  assert.equal(probe.length, 1, 'a running relay still mounts its live probe')
  assert.equal(probe[0].type(probe[0].props).type, CellEmpty)

  const windowSource = sources.chatWindowSource('dm')
  const before = windowSource.getSnapshot()
  let listenerCalls = 0
  const off = windowSource.subscribe(() => { listenerCalls += 1 })
  groupRelays.set({ [key]: { replies: [], speaking: ['a'], broken: false } })
  const live = windowSource.getSnapshot()
  assert.notEqual(live, before, 'live group relay state invalidates the projection cache')
  assert.equal(listenerCalls, 1, 'the live source is subscribed once')
  assert.equal(live.byKey.size, 21, 'speaking makes the relay one real row')
  assert.equal(windowOf(live, 'older').hidden, true)
  assert.equal(live.summaries.length, 1, 'only the oldest Bot is folded')
  assert.equal(live.summaries[0].key, 'older')
  assert.equal(windowOf(live, 'newestBoundary').bubble, true)
  assert.equal(sources.projectChat(snap(nodes), 'dm').byKey.size, 21)
  assert.notEqual(probe[0].type(probe[0].props).type, CellEmpty, 'the live cell draws the same row')

  groupRelays.set({ [key]: { replies: [{ botId: 'a', text: 'hi' }], speaking: ['a'], broken: false } })
  const after = windowSource.getSnapshot()
  assert.equal(after.summaries.length, 1, 'a second live update does not fold it twice')
  assert.equal(listenerCalls, 2)
  off()
})
