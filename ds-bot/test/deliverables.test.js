import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverableSources, listDeliverables } from '../src/host/deliverables.js'

const fixture = () => {
  const state = { prefs: { sidebarGroups: [{ id: 'g', members: ['bot', 'room'] }, { id: 'other', members: ['outside'] }] }, bots: { bot: { id: 'bot', name: 'Writer' }, outside: { id: 'outside', name: 'Other' } }, rooms: { room: { id: 'room', name: 'Team', sessions: { bot: 'hidden' }, segments: { bot: [{ sessionId: 'old-hidden' }] } } } }
  const calls = []
  const records = { own: [{ seq: 1, type: 'deliverables/presented', time: 4, data: { turn: 1, callId: 'x', files: [{ path: '/local/report.md' }] } }], hidden: [{ seq: 2, type: 'deliverables/presented', time: 5, data: { turn: 1, callId: 'y', files: [{ path: 'C:\\tmp\\image.png' }] } }], 'old-hidden': [], outside: [] }
  const rt = { state, partsOf: id => [{ sessionId: id === 'bot' ? 'own' : 'outside' }], ctx: { get: () => ({ readSession: async id => { calls.push(id); return { events: records[id], inheritedEventCount: 0 } } }) } }
  return { rt, calls, records }
}

test('results follow assigned Bot and group conversations, newest first, without returning paths', async () => {
  const { rt, calls } = fixture()
  const result = await listDeliverables(rt, 'g')
  assert.deepEqual(result.items.map(({ name, targetId }) => [name, targetId]), [['image.png', 'room'], ['report.md', 'bot']])
  assert.equal(result.items.some(item => Object.hasOwn(item, 'path')), false)
  assert.deepEqual(calls.sort(), ['hidden', 'old-hidden', 'own'])
  assert.equal(result.unavailable, 0)
  assert.throws(() => deliverableSources(rt, 'missing'))
})

test('inherited, malformed and unreadable records are not silently reported as an empty success', async () => {
  const { rt, records } = fixture()
  records.own.push({ seq: 2, type: 'deliverables/presented', data: { turn: 1, callId: 'x', files: [{ path: '' }, null] } })
  rt.ctx.get = () => ({ readSession: async id => { if (id === 'hidden') throw Error('unavailable'); return { events: records[id], inheritedEventCount: 2 } } })
  const result = await listDeliverables(rt, 'g')
  assert.deepEqual(result.items, [])
  assert.equal(result.unavailable, 1)
  await assert.rejects(listDeliverables({ ...rt, ctx: { get: () => undefined } }, null), /unavailable/)
})

// Read completion order is not data: Sessions are read concurrently, so equal timestamps
// must come out in one fixed order whatever order the reads finish in.
const controlled = records => {
  const pending = new Map()
  const state = { prefs: { sidebarGroups: [] }, bots: { A: { id: 'A', name: 'A' }, B: { id: 'B', name: 'B' } }, rooms: {} }
  const rt = { state, partsOf: id => [{ sessionId: id === 'A' ? 'sA' : 'sB' }], ctx: { get: () => ({ readSession: async id => { await new Promise(resolve => pending.set(id, resolve)); return { events: records[id], inheritedEventCount: 0 } } }) } }
  const run = async order => {
    const promise = listDeliverables(rt, null)
    await new Promise(resolve => setImmediate(resolve))
    for (const id of order) pending.get(id)()
    const result = await promise
    return { ids: result.items.map(item => item.id), truncated: result.truncated }
  }
  return { run }
}

const presented = (seq, time, callId = 'call') => ({ seq, type: 'deliverables/presented', time, data: { turn: 1, callId, files: [{ path: `/f${seq}.md` }] } })

test('equal timestamps across conversations keep one order whatever read finishes first', async () => {
  const records = { sA: [presented(1, 7)], sB: [presented(1, 7)] }
  const { run } = controlled(records)
  const ab = await run(['sA', 'sB'])
  const ba = await run(['sB', 'sA'])
  assert.deepEqual(ab.ids, ba.ids)
  assert.deepEqual(ab.ids, ['sA:1:0', 'sB:1:0'])
  assert.equal(ab.truncated, false)
})

test('the same seq in two conversations stays two distinct deliverables', async () => {
  const records = { sA: [presented(3, 9, 'same')], sB: [presented(3, 9, 'same')] }
  const { run } = controlled(records)
  const result = await run(['sB', 'sA'])
  assert.equal(result.ids.length, 2)
  assert.equal(new Set(result.ids).size, 2)
})

test('the 200-item cut drops the same deliverable whatever read finishes first', async () => {
  const many = n => Array.from({ length: n }, (_, index) => presented(index + 1, 11))
  const { run } = controlled({ sA: many(100), sB: many(101) })
  const ab = await run(['sA', 'sB'])
  const ba = await run(['sB', 'sA'])
  assert.equal(ab.truncated, true)
  assert.equal(ab.ids.length, 200)
  assert.deepEqual(ab.ids, ba.ids)
  const all = new Set([...many(100).map((_, index) => `sA:${index + 1}:0`), ...many(101).map((_, index) => `sB:${index + 1}:0`)])
  const dropped = [...all].filter(id => !ab.ids.includes(id))
  assert.equal(dropped.length, 1)
  assert.equal(ba.ids.includes(dropped[0]), false)
})
