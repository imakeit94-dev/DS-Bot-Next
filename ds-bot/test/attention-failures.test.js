import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearAttentionFailure, recordAttentionFailure, saveAttentionFailureClear } from '../src/host/attention-failures.js'
import { sidebarGroupStatus } from '../src/client/sidebar-group-status.js'
import { attentionItems } from '../src/client/attention-list.js'

test('failures persist per chat until explicitly cleared; an old click cannot clear a newer failure', () => {
  const state = { bots: { b: { id: 'b', name: 'Writer' } }, rooms: { r: { id: 'r', name: 'Team' } } }
  assert.equal(recordAttentionFailure(state, 'missing'), false)
  recordAttentionFailure(state, 'r', 'b', 1)
  const old = state.attentionFailures[0]
  recordAttentionFailure(state, 'r', 'b', 2)
  assert.equal(state.attentionFailures.length, 1)
  assert.equal(clearAttentionFailure(state, old.id), false)
  const current = state.attentionFailures[0]
  const roster = { bots: Object.values(state.bots), byId: state.bots, roomsById: state.rooms, attentionFailures: state.attentionFailures }
  assert.deepEqual(attentionItems(roster, [], {}).map(item => [item.target, item.bot, item.kind]), [['r', 'Writer', 'failure']])
  assert.equal(clearAttentionFailure(state, current.id), true)
  assert.deepEqual(state.attentionFailures, [])
  assert.throws(() => clearAttentionFailure(state, null))
})

test('acknowledging a failure preserves other action items across a persisted reload', async () => {
  const state = { bots: { b: { id: 'b', name: 'Writer', sessionId: 'part' }, c: { id: 'c', name: 'Editor' } }, rooms: {} }
  recordAttentionFailure(state, 'b')
  recordAttentionFailure(state, 'c')
  const first = state.attentionFailures[0].id
  let saved
  await saveAttentionFailureClear(state, first, async options => { assert.equal(options.required, true); saved = JSON.stringify(state) })
  const reloaded = JSON.parse(saved)
  const roster = { bots: Object.values(reloaded.bots), byId: reloaded.bots, roomsById: {}, attentionFailures: reloaded.attentionFailures, questions: { part: { id: 'q' } } }
  assert.deepEqual(attentionItems(roster, [{ id: 'a', botId: 'b' }], {}).map(item => item.kind), ['approval', 'question', 'failure'])
  const entries = Object.values(reloaded.bots).map(item => ({ kind: 'bot', item }))
  const group = (work, questions, failures) => sidebarGroupStatus(entries, {}, work, {}, questions, failures).attention
  assert.equal(group({}, {}, reloaded.attentionFailures), true)
  assert.equal(group({ approvals: [{ botId: 'b' }] }, {}, []), true)
  assert.equal(group({}, roster.questions, []), true)
  assert.equal(group({}, {}, []), false)
})

test('failed persistence restores the item for retry without reviving a newer failure', async () => {
  const state = { bots: { b: {} }, rooms: {} }
  recordAttentionFailure(state, 'b')
  const old = state.attentionFailures[0]
  await assert.rejects(saveAttentionFailureClear(state, old.id, async () => { throw new Error('read only') }), /read only/)
  assert.deepEqual(state.attentionFailures, [old])
  await assert.rejects(saveAttentionFailureClear(state, old.id, async () => { recordAttentionFailure(state, 'b'); throw new Error('write failed') }), /write failed/)
  const current = state.attentionFailures[0]
  assert.notEqual(current.id, old.id)
  assert.equal(await saveAttentionFailureClear(state, old.id, async () => { throw new Error('unexpected save') }), false)
  assert.equal(await saveAttentionFailureClear(state, current.id, async () => {}), true)
  assert.deepEqual(state.attentionFailures, [])
})

test('concurrent acknowledgements wait for a failed save before retrying', async () => {
  const state = { bots: { b: {} }, rooms: {} }
  recordAttentionFailure(state, 'b')
  const id = state.attentionFailures[0].id
  let rejectSave, notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const first = saveAttentionFailureClear(state, id, () => new Promise((resolve, reject) => { rejectSave = reject; notifyStarted() }))
  await started
  const second = saveAttentionFailureClear(state, id, async () => {})
  rejectSave(new Error('write failed'))
  await assert.rejects(first, /write failed/)
  assert.equal(await second, true)
  assert.deepEqual(state.attentionFailures, [])
})

test('failure storage is bounded and contains no error details', () => {
  const state = { bots: {}, rooms: {} }
  for (let i = 0; i < 105; i++) { const id = `b${i}`; state.bots[id] = {}; recordAttentionFailure(state, id, undefined, i) }
  assert.equal(state.attentionFailures.length, 100)
  assert.deepEqual(Object.keys(state.attentionFailures[0]).sort(), ['at', 'id', 'targetId'])
})
