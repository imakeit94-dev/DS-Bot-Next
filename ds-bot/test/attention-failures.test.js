import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearAttentionFailure, recordAttentionFailure } from '../src/host/attention-failures.js'
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

test('failure storage is bounded and contains no error details', () => {
  const state = { bots: {}, rooms: {} }
  for (let i = 0; i < 105; i++) { const id = `b${i}`; state.bots[id] = {}; recordAttentionFailure(state, id, undefined, i) }
  assert.equal(state.attentionFailures.length, 100)
  assert.deepEqual(Object.keys(state.attentionFailures[0]).sort(), ['at', 'id', 'targetId'])
})
