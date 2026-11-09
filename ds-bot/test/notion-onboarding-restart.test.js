import { test } from 'node:test'
import assert from 'node:assert/strict'
import { install, bindOnboardingForTest, bindNotionRestForTest } from '../src/host/connectors.js'
import { createHmac } from 'node:crypto'

const key = 'synthetic-project-key'
const account = { id: 'ca_saved', toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'ac_saved', is_disabled: false }, user_id: 'synthetic-user' }
const binding = createHmac('sha256', key).update(JSON.stringify(['notion-selection-v1', account.id, account.user_id])).digest('hex')
const saved = () => ({ connectors: { notion: { enabled: true, accountId: account.id, pageId: '0123456789abcdef0123456789abcdef', identityBinding: binding } } })
async function restore(state, response, selectedKey = key) {
  let registered = false
  let cleanup
  const ctx = { tools: { register() { registered = true; return () => { registered = false } } }, effect(fn) { cleanup = fn() } }
  bindOnboardingForTest(ctx, async () => ({ status: 200, body: JSON.stringify(response) }))
  bindNotionRestForTest(ctx, async () => { throw new Error('not used') })
  const rt = { ctx, state, config: { github: false }, loadSecrets: async () => {}, load: async () => {}, save: async () => {}, secretValue: name => name === 'COMPOSIO_API_KEY' ? selectedKey : undefined, warn() {}, redactSecrets: value => value }
  install(rt)
  await new Promise(resolve => setImmediate(resolve))
  return { registered, cleanup }
}
test('restart re-verifies the account and its key-bound identity before restoring', async () => {
  for (const [response, selectedKey, expected] of [[account, key, true], [{ ...account, user_id: 'different-user' }, key, false], [account, 'different-project-key', false], [{ ...account, is_disabled: true }, key, false]]) {
    const result = await restore(saved(), response, selectedKey)
    assert.equal(result.registered, expected)
    result.cleanup()
  }
})
