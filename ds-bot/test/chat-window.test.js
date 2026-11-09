import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatWindow, windowOf, summaryAt, DEFAULT_WINDOW } from '../src/client/chat-window.js'

// Build an ordered entry list: each item is [kind] or [kind, options].
function entries(items, prefix = 'k') {
  return items.map((item, index) => {
    const kind = Array.isArray(item) ? item[0] : item
    const options = (Array.isArray(item) ? item[1] : undefined) ?? {}
    return { key: `${prefix}${index}`, kind, exchange: options.exchange === true, ...(options.peerId !== undefined ? { peerId: options.peerId } : {}) }
  })
}

const visible = (projection, list) => list.filter(entry => !windowOf(projection, entry.key).hidden).map(entry => entry.key)
const bubbles = (projection, list) => list.filter(entry => windowOf(projection, entry.key).bubble).map(entry => entry.key)
const alternating = length => Array.from({ length }, (_, i) => (i % 2 ? 'assistant' : 'user'))

test('19 entries: below the window, nothing folds', () => {
  const list = entries(alternating(19))
  const projection = chatWindow(list)
  assert.equal(visible(projection, list).length, 19)
  assert.equal(projection.summaries.length, 0)
  assert.equal(bubbles(projection, list).length, 0)
})

test('20 entries: exactly the window, nothing folds', () => {
  const list = entries(alternating(20))
  const projection = chatWindow(list)
  assert.equal(visible(projection, list).length, 20)
  assert.equal(projection.summaries.length, 0)
})

// F3: a plain user/assistant/tool row is never dropped, even far outside the
// window. Only Bot-to-Bot messages take part in folding.
test('21 plain entries: no row is hidden, the oldest question and its reply both stay', () => {
  const list = entries(alternating(21))
  const projection = chatWindow(list)
  assert.equal(windowOf(projection, 'k0').hidden, false)
  assert.equal(windowOf(projection, 'k20').hidden, false)
  assert.equal(visible(projection, list).length, 21)
  assert.equal(projection.summaries.length, 0)
})

test('tool cards stay visible and count as their own entries (F3)', () => {
  const list = entries([...alternating(18), 'tool', 'tool', 'user'])
  const projection = chatWindow(list)
  assert.equal(windowOf(projection, 'k18').hidden, false)
  assert.equal(windowOf(projection, 'k19').hidden, false)
  assert.equal(visible(projection, list).length, 21)
  assert.equal(projection.summaries.length, 0)
})

test('a Bot run wholly before the window folds only its Bot messages (F3/F4)', () => {
  const items = [
    ['bot', { exchange: true, peerId: 'a' }],
    ['assistant', { exchange: true }],
    ['bot', { exchange: true, peerId: 'a' }],
    ['assistant', { exchange: true }],
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(20),
  ]
  const list = entries(items) // total 25, windowStart 5, latestBot 4
  const projection = chatWindow(list)
  // count is the number of folded Bot messages, not every row in the run.
  assert.deepEqual(summaryAt(projection, 'k0'), { key: 'k0', count: 2, peerIds: ['a'] })
  assert.equal(windowOf(projection, 'k0').hidden, true)
  assert.equal(windowOf(projection, 'k2').hidden, true)
  // Assistant rows of the exchange are never hidden (F3).
  assert.equal(windowOf(projection, 'k1').hidden, false)
  assert.equal(windowOf(projection, 'k3').hidden, false)
  // The newest Bot message is a bubble even though its run sits before the window (F4).
  assert.deepEqual(windowOf(projection, 'k4'), { hidden: false, bubble: true })
  for (let i = 5; i < 25; i += 1) assert.equal(windowOf(projection, `k${i}`).hidden, false)
  assert.equal(visible(projection, list).length, 23)
})

test('a run straddling the window folds its prefix and keeps in-window bubbles', () => {
  const items = [
    'user', 'user',
    ['bot', { exchange: true, peerId: 'a' }],
    ['assistant', { exchange: true }],
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(18),
  ]
  const list = entries(items) // total 23, windowStart 3, latestBot 4
  const projection = chatWindow(list)
  assert.deepEqual(summaryAt(projection, 'k2'), { key: 'k2', count: 1, peerIds: ['a'] })
  assert.equal(windowOf(projection, 'k2').hidden, true)
  assert.equal(windowOf(projection, 'k3').hidden, false)
  assert.equal(windowOf(projection, 'k4').hidden, false)
  assert.equal(windowOf(projection, 'k4').bubble, true)
  assert.equal(windowOf(projection, 'k3').bubble, false)
})

test('consecutive messages from different senders fold into one counted line', () => {
  const items = [
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'b' }],
    ...alternating(19),
    ['bot', { exchange: true, peerId: 'c' }],
  ]
  const list = entries(items) // total 22, windowStart 2, latestBot 21
  const projection = chatWindow(list)
  const summary = summaryAt(projection, 'k0')
  assert.equal(summary.count, 2)
  assert.deepEqual(summary.peerIds, ['a', 'b'])
  assert.equal(windowOf(projection, 'k0').hidden, true)
  assert.equal(windowOf(projection, 'k1').hidden, true)
  // The later, in-window Bot message stays a bubble (F4).
  assert.deepEqual(windowOf(projection, 'k21'), { hidden: false, bubble: true })
})

test('a user message breaks a Bot run but is never hidden itself (F3)', () => {
  const items = [
    ['bot', { exchange: true, peerId: 'a' }],
    'user',
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(19),
  ]
  const list = entries(items) // total 22, windowStart 2, latestBot 2
  const projection = chatWindow(list)
  assert.deepEqual(summaryAt(projection, 'k0'), { key: 'k0', count: 1, peerIds: ['a'] })
  assert.equal(summaryAt(projection, 'k1'), undefined)
  assert.equal(windowOf(projection, 'k1').hidden, false)
  assert.equal(windowOf(projection, 'k0').hidden, true)
})

test('summary count ignores tool/assistant rows; they stay visible (F3/F5)', () => {
  const items = [
    ['bot', { exchange: true, peerId: 'a' }],
    ['tool', { exchange: true }],
    ['tool', { exchange: true }],
    ['assistant', { exchange: true }],
    ...alternating(19),
    ['bot', { exchange: true, peerId: 'b' }],
  ]
  const list = entries(items) // total 24, windowStart 4, latestBot 23
  const projection = chatWindow(list)
  assert.deepEqual(summaryAt(projection, 'k0'), { key: 'k0', count: 1, peerIds: ['a'] })
  assert.equal(windowOf(projection, 'k1').hidden, false)
  assert.equal(windowOf(projection, 'k2').hidden, false)
  assert.equal(windowOf(projection, 'k3').hidden, false)
  assert.equal(windowOf(projection, 'k23').bubble, true)
})

// F4 is absolute: the newest Bot message never folds, wherever it sits.
test('F4: the single newest Bot message never folds even with 25 later users', () => {
  const list = entries([['bot', { exchange: true, peerId: 'a' }], ...alternating(25)])
  const projection = chatWindow(list) // total 26, windowStart 6, latestBot 0
  assert.deepEqual(windowOf(projection, 'k0'), { hidden: false, bubble: true })
  assert.equal(projection.summaries.length, 0)
})

test('F4 (run wholly before the window): latest Bot stays a bubble, older prefix folds', () => {
  const list = entries([
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(21),
  ]) // total 23, windowStart 3, latestBot 1
  const projection = chatWindow(list)
  assert.deepEqual(windowOf(projection, 'k1'), { hidden: false, bubble: true })
  assert.deepEqual(summaryAt(projection, 'k0'), { key: 'k0', count: 1, peerIds: ['a'] })
  assert.equal(windowOf(projection, 'k0').hidden, true)
})

test('F4 (run inside the window): every Bot message is a bubble, nothing folds', () => {
  const list = entries([
    ...alternating(19),
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
  ]) // total 21, windowStart 1, latestBot 20
  const projection = chatWindow(list)
  assert.equal(projection.summaries.length, 0)
  assert.deepEqual(windowOf(projection, 'k19'), { hidden: false, bubble: true })
  assert.deepEqual(windowOf(projection, 'k20'), { hidden: false, bubble: true })
})

test('F4 (run straddling the window): prefix folds, in-window Bot stays a bubble', () => {
  const list = entries([
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(19),
  ]) // total 22, windowStart 2, latestBot 2; run 0..2 crosses the boundary
  const projection = chatWindow(list)
  assert.deepEqual(summaryAt(projection, 'k0'), { key: 'k0', count: 2, peerIds: ['a'] })
  assert.equal(windowOf(projection, 'k0').hidden, true)
  assert.equal(windowOf(projection, 'k1').hidden, true)
  assert.deepEqual(windowOf(projection, 'k2'), { hidden: false, bubble: true })
})

test('realtime append slides the window without hiding a plain row', () => {
  const list = entries(alternating(20))
  assert.equal(chatWindow(list).summaries.length, 0)
  list.push({ key: 'extra', kind: 'user', exchange: false })
  const projection = chatWindow(list)
  assert.equal(windowOf(projection, 'k0').hidden, false)
  assert.equal(windowOf(projection, 'extra').hidden, false)
  assert.equal(visible(projection, list).length, 21)
})

test('a later page of history is projected from the whole loaded list, not a delta', () => {
  const page1 = entries(alternating(12))
  assert.equal(visible(chatWindow(page1), page1).length, 12)
  const older = entries(alternating(15), 'o')
  const all = [...older, ...page1] // 27 loaded
  const projection = chatWindow(all)
  // F3: all plain rows of both pages stay visible.
  assert.equal(visible(projection, all).length, 27)
  assert.equal(windowOf(projection, older[6].key).hidden, false)
  assert.equal(windowOf(projection, older[7].key).hidden, false)
  assert.equal(projection.summaries.length, 0)
})

test('recomputing the same list is deterministic (refresh)', () => {
  const list = entries([
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(22),
  ])
  const first = chatWindow(list)
  const second = chatWindow(list)
  assert.deepEqual([...first.byKey.entries()], [...second.byKey.entries()])
  assert.deepEqual(first.summaries, second.summaries)
})

test('aggregate row count: the folded summary equals the number of hidden Bot keys', () => {
  const items = [
    ['bot', { exchange: true, peerId: 'a' }],
    ['assistant', { exchange: true }],
    ['bot', { exchange: true, peerId: 'a' }],
    ...alternating(20),
  ]
  const list = entries(items)
  const projection = chatWindow(list)
  const hidden = list.filter(entry => windowOf(projection, entry.key).hidden)
  const total = projection.summaries.reduce((sum, summary) => sum + summary.count, 0)
  assert.equal(total, hidden.length)
  assert.equal(hidden.every(entry => entry.kind === 'bot'), true)
})

test('windowOf and summaryAt are safe for unknown keys', () => {
  const projection = chatWindow(entries(['user', 'assistant']))
  assert.deepEqual(windowOf(projection, 'missing'), { hidden: false, bubble: false })
  assert.equal(summaryAt(projection, 'missing'), undefined)
  assert.deepEqual(windowOf(undefined, 'anything'), { hidden: false, bubble: false })
  assert.equal(DEFAULT_WINDOW, 20)
})

test('a custom limit is honoured; the newest Bot still stays a bubble', () => {
  const list = entries([
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
    ['bot', { exchange: true, peerId: 'a' }],
    'user', 'user', 'user',
  ]) // limit 3, windowStart 3, latestBot 2
  const projection = chatWindow(list, { limit: 3 })
  assert.deepEqual(summaryAt(projection, 'k0'), { key: 'k0', count: 2, peerIds: ['a'] })
  assert.equal(windowOf(projection, 'k0').hidden, true)
  assert.equal(windowOf(projection, 'k1').hidden, true)
  assert.deepEqual(windowOf(projection, 'k2'), { hidden: false, bubble: true })
  assert.equal(windowOf(projection, 'k3').hidden, false)
  assert.equal(visible(projection, list).length, 4)
})
