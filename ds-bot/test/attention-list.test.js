import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attentionItems } from '../src/client/attention-list.js'

const bot = { id: 'b', sessionId: 'part', name: 'Writer' }
const room = { id: 'r', name: 'Project' }
const roster = { bots: [bot], byId: { b: bot }, roomsById: { r: room }, questions: { part: { id: 'q' } } }

test('collects live approvals and questions, opens group approvals in their group, and deduplicates question sources', () => {
  const items = attentionItems(roster, [{ id: 'a', botId: 'b', roomId: 'r' }, { id: 'b', botId: 'b' }], { part: 'question' })
  assert.deepEqual(items.map(({ target, kind }) => [target, kind]), [['r', 'approval'], ['b', 'approval'], ['b', 'question']])
})

test('removes settled or unknown waits and does not turn other activity into a question', () => {
  assert.deepEqual(attentionItems({ ...roster, questions: {} }, [{ id: 'x', botId: 'missing' }], { part: 'approval' }), [])
  assert.equal(attentionItems({ ...roster, questions: {} }, [], { part: 'question' })[0].target, 'b')
})
