import { randomUUID } from 'node:crypto'

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// Each operation changes only one part of the saved layout, so separate windows do
// not overwrite an older copy of the whole list.
export function changeSidebarGroups(state, body) {
  const groups = Array.isArray(state.prefs.sidebarGroups) ? state.prefs.sidebarGroups : []
  const find = id => groups.find(group => group.id === id)
  const name = value => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw invalid('Group name must be between 1 and 80 characters')
    return value.trim()
  }
  if (body.action === 'create') {
    if (groups.length >= 100) throw invalid('There can be at most 100 sidebar groups')
    groups.push({ id: randomUUID(), name: name(body.name), members: [], pinned: false, collapsed: false })
  } else if (body.action === 'move-entry' || body.action === 'move-entries') {
    const ids = body.action === 'move-entry' ? [body.entryId] : body.entryIds
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || (!Object.hasOwn(state.bots, id) && !Object.hasOwn(state.rooms, id)))) throw invalid('Chat not found')
    const target = body.groupId === null ? null : find(body.groupId)
    if (body.groupId !== null && !target) throw invalid('Sidebar group not found')
    const selected = new Set(ids)
    for (const group of groups) group.members = group.members.filter(id => !selected.has(id))
    if (target) target.members.push(...selected)
  } else {
    const group = find(body.groupId)
    if (!group) throw invalid('Sidebar group not found')
    switch (body.action) {
      case 'rename': group.name = name(body.name); break
      case 'delete': groups.splice(groups.indexOf(group), 1); break
      case 'pin':
        if (typeof body.value !== 'boolean') throw invalid('Pin must be true or false')
        group.pinned = body.value
        break
      case 'collapse':
        if (typeof body.value !== 'boolean') throw invalid('Collapse must be true or false')
        group.collapsed = body.value
        break
      case 'move-relative': {
        const target = find(body.targetId)
        if (!target || !!target.pinned !== !!group.pinned) throw invalid('Groups must have the same pin status')
        if (body.position !== 'before' && body.position !== 'after') throw invalid('Invalid position')
        if (target === group) break
        groups.splice(groups.indexOf(group), 1)
        groups.splice(groups.indexOf(target) + (body.position === 'after' ? 1 : 0), 0, group)
        break
      }
      case 'reorder': {
        if (body.direction !== -1 && body.direction !== 1) throw invalid('Invalid direction')
        const peers = groups.filter(item => !!item.pinned === !!group.pinned)
        const other = peers[peers.indexOf(group) + body.direction]
        if (other) {
          const a = groups.indexOf(group), b = groups.indexOf(other)
          ;[groups[a], groups[b]] = [groups[b], groups[a]]
        }
        break
      }
      default: throw invalid('Unknown sidebar group action')
    }
  }
  state.prefs.sidebarGroups = groups
}
