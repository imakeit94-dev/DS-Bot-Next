import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sidebarGroupStatus } from '../src/client/sidebar-group-status.js'

const entries = [{ kind: 'bot', item: { id: 'b', sessionId: 'p' } }, { kind: 'room', item: { id: 'r' } }]
const get = (statuses = {}, work = {}, marked = {}, questions = {}, failures = []) => sidebarGroupStatus(entries, statuses, work, marked, questions, failures)
test('workgroup distinguishes simultaneous attention, unread and working states', () => {
  assert.deepEqual(get({ p: { completionUnread: true }, r: { running: true } }, { approvals: [{ roomId: 'r', botId: 'b' }] }), { attention: true, unread: true, working: true })
  assert.deepEqual(get(), { attention: false, unread: false, working: false })
})
test('group approvals only affect the assigned conversation, questions and failures need attention', () => {
  assert.equal(get({}, { approvals: [{ roomId: 'elsewhere', botId: 'b' }] }).attention, false)
  assert.equal(get({}, {}, {}, { p: {} }).attention, true)
  assert.equal(get({}, {}, {}, {}, [{ targetId: 'r' }]).attention, true)
  assert.equal(get({}, { rooms: { elsewhere: [{ botId: 'b' }] } }).working, true)
})
