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
