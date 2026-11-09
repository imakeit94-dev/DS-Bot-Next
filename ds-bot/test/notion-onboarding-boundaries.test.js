import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizationUrl, createOnboarding } from '../src/host/composio-onboarding.js'

const response = body => ({ status: 200, body: JSON.stringify(body) })
const active = { id: 'ca_attempt', toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'ac_selected', is_disabled: false }, user_id: 'workspace-user' }
const linkResponse = () => response({ connected_account_id: 'ca_attempt', redirect_url: 'https://connect.composio.dev/link/ln_example', expires_at: new Date(Date.now() + 60000).toISOString(), link_token: 'never-output-this' })
test('missing cursor or duplicate candidates cannot be mistaken for a complete empty list', async () => {
  for (const value of [{ items: [] }, { items: [active, active], next_cursor: null }]) {
    const api = createOnboarding({ secret: () => 'secret', exchange: async () => response(value) })
    await assert.rejects(api.accounts())
  }
})
test('both managed and user-provided enabled Notion setups are selectable', async () => {
  const items = [true, false].map((is_composio_managed, index) => ({ id: `ac_${index}`, toolkit: { slug: 'notion' }, status: 'ENABLED', is_composio_managed }))
  const api = createOnboarding({ secret: () => 'secret', exchange: async () => response({ items, next_cursor: null }) })
  assert.deepEqual((await api.configs()).map(item => item.id), ['ac_0', 'ac_1'])
})
test('authorization link rejects encoded and normalized path or host confusion', () => {
  for (const url of ['https://connect.composio.dev/link/../link/ln_a', 'https://connect.composio.dev/link/%6cn_a', 'https://connect.composio.dev./link/ln_a', 'https://connect.composio.dev:8443/link/ln_a', 'https://connect.composio.dev\\link\\ln_a']) assert.throws(() => authorizationUrl(url))
})
test('one create attempt on transport failure reports an unknown outcome and is never retried', async () => {
  let calls = 0
  const api = createOnboarding({ secret: () => 'secret', exchange: async () => { calls++; throw new Error('sensitive remote response') } })
  await assert.rejects(api.createConfig(), /result is unknown/)
  assert.equal(calls, 1)
  await assert.rejects(api.link('ac_selected', 'workspace-user'), /result is unknown/)
  assert.equal(calls, 2)
})
test('callback verifier mismatch is distinct while unrelated failure stays generic', async () => {
  for (const [reason, expected] of [['Callback identity verification failed', /not supported/], ['other remote error', /did not complete/]]) {
    const api = createOnboarding({ secret: () => 'secret', exchange: async ({ method }) => method === 'POST' ? linkResponse() : response({ status: 'FAILED', status_reason: reason }) })
    const attempt = await api.link('ac_selected', 'workspace-user')
    await assert.rejects(api.poll(attempt), expected)
  }
})
test('a late ACTIVE poll after cancellation cannot return an account', async () => {
  let finish
  const api = createOnboarding({ secret: () => 'secret', exchange: async ({ method }) => method === 'POST' ? linkResponse() : new Promise(resolve => { finish = resolve }) })
  const attempt = await api.link('ac_selected', 'workspace-user')
  const poll = api.poll(attempt)
  api.cancel()
  finish(response(active))
  await assert.rejects(poll)
})
