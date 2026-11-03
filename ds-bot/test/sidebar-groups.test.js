import test from 'node:test'
import assert from 'node:assert/strict'
import { changeSidebarGroups } from '../src/host/sidebar-groups.js'

const create = (state, name) => {
  changeSidebarGroups(state, { action: 'create', name })
  return state.prefs.sidebarGroups.at(-1)
}
const change = (state, action, group, extra = {}) => changeSidebarGroups(state, { action, groupId: group.id, ...extra })

test('sidebar groups organize bots and chats without changing them', () => {
  const state = { prefs: {}, bots: { b: { id: 'b' } }, rooms: { r: { id: 'r', members: ['b'] } } }
  const video = create(state, ' Video ')
  const dev = create(state, 'Development')
  assert.equal(video.name, 'Video')
  changeSidebarGroups(state, { action: 'move-entry', entryId: 'b', groupId: video.id })
  changeSidebarGroups(state, { action: 'move-entry', entryId: 'r', groupId: video.id })
  changeSidebarGroups(state, { action: 'move-entry', entryId: 'b', groupId: dev.id })
  assert.deepEqual(video.members, ['r'])
  assert.deepEqual(dev.members, ['b'])
  change(state, 'pin', video, { value: true })
  change(state, 'collapse', video, { value: true })
  change(state, 'rename', video, { name: ' Film ' })
  assert.deepEqual([video.name, video.pinned, video.collapsed], ['Film', true, true])
  change(state, 'delete', video)
  assert.deepEqual(state.rooms.r, { id: 'r', members: ['b'] })
  assert.deepEqual(state.bots.b, { id: 'b' })
  assert.deepEqual(state.prefs.sidebarGroups, [dev])
  changeSidebarGroups(state, { action: 'move-entry', entryId: 'b', groupId: null })
  assert.deepEqual(dev.members, [])
})

test('reorder stays within pinned or unpinned groups', () => {
  const state = { prefs: {}, bots: {}, rooms: {} }
  const a = create(state, 'A'), b = create(state, 'B'), c = create(state, 'C')
  change(state, 'pin', b, { value: true })
  change(state, 'reorder', c, { direction: -1 })
  assert.deepEqual(state.prefs.sidebarGroups.map(x => x.id), [c.id, b.id, a.id])
  change(state, 'reorder', b, { direction: -1 })
  assert.deepEqual(state.prefs.sidebarGroups.map(x => x.id), [c.id, b.id, a.id])
})

test('invalid operations leave existing membership untouched', () => {
  const state = { prefs: {}, bots: { b: { id: 'b' } }, rooms: {} }
  const group = create(state, 'Video')
  changeSidebarGroups(state, { action: 'move-entry', entryId: 'b', groupId: group.id })
  assert.throws(() => changeSidebarGroups(state, { action: 'move-entry', entryId: 'b', groupId: 'missing' }))
  assert.throws(() => changeSidebarGroups(state, { action: 'move-entry', entryId: '__proto__', groupId: group.id }))
  assert.throws(() => change(state, 'rename', group, { name: '  ' }))
  assert.deepEqual(group.members, ['b'])
})

test('drag moves a group before or after a peer without crossing pin tiers', () => {
  const state = { prefs: {}, bots: {}, rooms: {} }
  const a = create(state, 'A'), b = create(state, 'B'), c = create(state, 'C'), d = create(state, 'D')
  change(state, 'pin', b, { value: true })
  change(state, 'move-relative', c, { targetId: a.id, position: 'before' })
  assert.deepEqual(state.prefs.sidebarGroups.filter(x => !x.pinned).map(x => x.name), ['C', 'A', 'D'])
  change(state, 'move-relative', c, { targetId: d.id, position: 'after' })
  assert.deepEqual(state.prefs.sidebarGroups.filter(x => !x.pinned).map(x => x.name), ['A', 'D', 'C'])
  const before = state.prefs.sidebarGroups.map(x => x.id)
  assert.throws(() => change(state, 'move-relative', a, { targetId: b.id, position: 'before' }))
  assert.throws(() => change(state, 'move-relative', a, { targetId: 'gone', position: 'after' }))
  assert.throws(() => change(state, 'move-relative', a, { targetId: d.id, position: 'bad' }))
  assert.deepEqual(state.prefs.sidebarGroups.map(x => x.id), before)
  change(state, 'move-relative', a, { targetId: a.id, position: 'after' })
  assert.deepEqual(state.prefs.sidebarGroups.map(x => x.id), before)
})
