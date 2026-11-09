import test from 'node:test'
import assert from 'node:assert/strict'
import { createComposioConnection } from '../src/host/composio-connection.js'

const reply = body => ({ status: 200, body: JSON.stringify(body) })
const account = { id: 'ca_test', toolkit: { slug: 'gmail' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'cfg', is_disabled: false }, user_id: 'user' }
function fixture() {
  let key = 'synthetic-key'; let failSave = false; let failConnect = false; let active = false
  const saved = []
  const rt = { state: {}, secretValue: () => key, loadSecrets: async () => {}, save: async () => {
    if (failSave) throw new Error('synthetic save failure')
    saved.push(structuredClone(rt.state))
  } }
  const connection = { close: () => { active = false }, isActive: () => active, connect: () => { if (failConnect) throw new Error('registration'); active = true } }
  const exchange = async ({ path }) => reply(path.includes('?') ? { items: [account], next_cursor: null } : account)
  const create = () => createComposioConnection({ rt, id: 'gmail', toolkit: 'gmail', connection, resource: () => ({}), exchange, isStopped: () => false })
  return { rt, saved, create, setKey: value => { key = value }, setFailSave: value => { failSave = value }, setFailConnect: value => { failConnect = value } }
}

test('failed workspace identity save must be retried before creating a link', async () => {
  let failSave = true; let savedUser; let links = 0
  const rt = { state: {}, secretValue: () => 'synthetic-key', loadSecrets: async () => {}, save: async () => {
    if (failSave) throw new Error('save failed')
    savedUser = rt.state.connectors.gmail.workspaceUserId
  } }
  const manager = createComposioConnection({ rt, id: 'gmail', toolkit: 'gmail', resource: () => ({}), isStopped: () => false,
    connection: { close() {}, connect() {}, isActive: () => false },
    exchange: async ({ path, body }) => {
      if (path.includes('connected_accounts?')) return reply({ items: [], next_cursor: null })
      if (path.includes('auth_configs?')) return reply({ items: [{ id: 'cfg', toolkit: { slug: 'gmail' }, status: 'ENABLED' }], next_cursor: null })
      links++
      assert.equal(body.user_id, savedUser)
      return reply({ connected_account_id: 'ca_test', redirect_url: 'https://connect.composio.dev/link/test', expires_at: new Date(Date.now() + 60000).toISOString() })
    } })
  await manager.accounts(); await manager.configs({})
  await assert.rejects(manager.link({ configId: 'cfg' }), /save/)
  assert.equal(links, 0)
  assert.equal(rt.state.connectors.gmail, undefined)
  failSave = false
  await manager.link({ configId: 'cfg' })
  assert.equal(links, 1)
  assert.ok(savedUser)
})

test('synthetic shared connection restores only under the bound key', async () => {
  const f = fixture(); const manager = f.create()
  await manager.accounts(); await manager.connect({ accountId: 'ca_test' })
  assert.equal(manager.isActive(), true)
  manager.close(); await f.create().restore()
  assert.equal(manager.isActive(), true)
  manager.close(); f.setKey('different-key'); await f.create().restore()
  assert.equal(manager.isActive(), false)
})

test('restore never registers a selection while its save is pending', async () => {
  for (const toolkit of ['notion', 'gmail', 'googlesheets']) {
    for (const succeeds of [false, true]) {
      let resolveSave; let rejectSave; let saving
      const entered = new Promise(resolve => { saving = resolve })
      const pending = new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject })
      let active = false
      const rt = { state: {}, secretValue: () => 'synthetic', loadSecrets: async () => {}, save: () => { saving(); return pending } }
      const connection = { close: () => { active = false }, connect: () => { active = true }, isActive: () => active }
      const selected = { ...account, toolkit: { slug: toolkit } }
      const manager = createComposioConnection({ rt, id: toolkit, toolkit, connection, resource: () => ({}), isStopped: () => false,
        exchange: async ({ path }) => reply(path.includes('?') ? { items: [selected], next_cursor: null } : selected) })
      await manager.accounts()
      const connecting = manager.connect({ accountId: 'ca_test' })
      await entered
      await manager.restore()
      assert.equal(active, false)
      if (succeeds) { resolveSave(); await connecting; assert.equal(active, true) }
      else { rejectSave(new Error('synthetic')); await assert.rejects(connecting); assert.equal(active, false); assert.equal(rt.state.connectors[toolkit].enabled, false) }
      manager.close()
    }
  }
})

test('synthetic save and registration failures leave connections disabled', async () => {
  const f = fixture(); const manager = f.create()
  await manager.accounts(); f.setFailSave(true)
  await assert.rejects(manager.connect({ accountId: 'ca_test' }), /save/)
  assert.equal(f.rt.state.connectors.gmail.enabled, false)
  assert.equal(manager.isActive(), false)
  f.setFailSave(false); f.setFailConnect(true)
  await assert.rejects(manager.connect({ accountId: 'ca_test' }), /unavailable/)
  assert.equal(f.rt.state.connectors.gmail.enabled, false)
  assert.equal(f.saved.at(-1).connectors.gmail.enabled, false)
  assert.equal(manager.isActive(), false)
})
