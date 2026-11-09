import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install, bindOnboardingForTest, bindNotionRestForTest } from '../src/host/connectors.js'

const pageId = '0123456789abcdef0123456789abcdef'
const account = { id: 'ca_fixture', toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'ac_fixture', is_disabled: false }, user_id: 'prior-user' }
const json = body => ({ status: 200, body: JSON.stringify(body) })
function fixture(exchange, initialState = {}, initialKey = 'test-secret') {
  let cleanup
  let key = initialKey
  let tool
  const state = initialState
  const ctx = { tools: { register(value) { tool = value; return () => { tool = undefined } } }, effect(fn) { cleanup = fn() } }
  bindOnboardingForTest(ctx, exchange)
  bindNotionRestForTest(ctx, async ({ method }) => json(method === 'GET' ? account : { successful: true, error: null, data: { markdown: 'synthetic', truncated: false } }))
  const rt = { ctx, state, config: { github: false }, loadSecrets: async () => {}, load: async () => {}, save: async () => {}, secretValue: name => name === 'COMPOSIO_API_KEY' ? key : undefined, secretEndpoint: async (_, body) => { key = body.value; rt.secretsChanged() }, warn() {}, redactSecrets: value => value }
  install(rt)
  return { rt, cleanup: () => cleanup(), tool: () => tool }
}
const accountExchange = async ({ path }) => json(path.includes('?') ? { items: [account], next_cursor: null } : account)

test('explicit selection is required, verified, saved and used by the registered tool', async () => {
  const f = fixture(accountExchange)
  await assert.rejects(f.rt.connectorEndpoint('connector-connect', { id: 'notion', accountId: account.id, pageId }), /Select/)
  const list = await f.rt.connectorEndpoint('connector-notion-accounts')
  assert.equal(list.length, 1)
  await f.rt.connectorEndpoint('connector-connect', { id: 'notion', accountId: account.id, pageId: `https://app.notion.com/title-${pageId}` })
  assert.equal(f.rt.state.connectors.notion.pageId, pageId)
  assert.equal(f.rt.state.connectors.notion.enabled, true)
  assert.match(await f.tool().execute({}), /synthetic/)
  const stale = f.tool()
  await f.rt.connectorEndpoint('connector-disconnect', { id: 'notion' })
  assert.equal(f.rt.state.connectors.notion.enabled, false)
  await assert.rejects(stale.execute({}))
  f.cleanup()
})
test('a missing or changed account prevents registration', async () => {
  const f = fixture(async ({ path }) => json(path.includes('?') ? { items: [account], next_cursor: null } : { ...account, user_id: null }))
  await f.rt.connectorEndpoint('connector-notion-accounts')
  await assert.rejects(f.rt.connectorEndpoint('connector-connect', { id: 'notion', accountId: account.id, pageId }))
  assert.equal(f.tool(), undefined)
  f.cleanup()
})
test('replacing the key aborts onboarding and clears the old project selection', async () => {
  const f = fixture(accountExchange)
  await f.rt.connectorEndpoint('connector-notion-accounts')
  await f.rt.connectorEndpoint('connector-connect', { id: 'notion', accountId: account.id, pageId })
  await f.rt.connectorEndpoint('connector-composio-key', { token: 'new-test-secret' })
  assert.equal(f.tool(), undefined)
  assert.deepEqual(f.rt.state.connectors.notion, { enabled: false })
  assert.doesNotMatch(JSON.stringify(f.rt.state), /test-secret|ca_fixture/)
  f.cleanup()
})
test('cancelled account discovery does not publish a late result', async () => {
  let finish
  const f = fixture(() => new Promise(resolve => { finish = resolve }))
  const pending = f.rt.connectorEndpoint('connector-notion-accounts')
  await new Promise(resolve => setImmediate(resolve))
  await f.rt.connectorEndpoint('connector-notion-cancel')
  finish(json({ items: [account], next_cursor: null }))
  await assert.rejects(pending)
  await assert.rejects(f.rt.connectorEndpoint('connector-connect', { id: 'notion', accountId: account.id, pageId }))
  f.cleanup()
})
