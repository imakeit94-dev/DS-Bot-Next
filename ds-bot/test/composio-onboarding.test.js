import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizationUrl, createOnboarding, verifiedAccount } from '../src/host/composio-onboarding.js'

const account = { id: 'ca_test', toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'ac_test', is_disabled: false }, user_id: 'workspace-test' }
const reply = body => ({ status: 200, body: JSON.stringify(body) })

test('authorization links accept only the documented HTTPS route', () => {
  assert.equal(authorizationUrl('https://connect.composio.dev/link/ln_test'), 'https://connect.composio.dev/link/ln_test')
  for (const url of ['http://connect.composio.dev/link/x', 'https://connect.composio.dev.evil.test/link/x', 'https://a@connect.composio.dev/link/x', 'https://connect.composio.dev/link/x?q=secret', 'https://connect.composio.dev/link/x#secret', 'https://connect.composio.dev/other/x']) assert.throws(() => authorizationUrl(url))
})
test('account verification fails closed for absent and mismatched fields', () => {
  assert.equal(verifiedAccount(account, 'ca_test', { configId: 'ac_test', userId: 'workspace-test' }), true)
  assert.equal(verifiedAccount({ ...account, user_id: undefined }, 'ca_test'), false)
  assert.equal(verifiedAccount(account, 'ca_other'), false)
  assert.equal(verifiedAccount(account, 'ca_test', { userId: 'wrong' }), false)
  assert.equal(verifiedAccount({ ...account, auth_config: { ...account.auth_config, is_disabled: true } }, 'ca_test'), false)
})
test('lists all pages and verifies a selected account', async () => {
  const paths = []
  const api = createOnboarding({ secret: () => 'synthetic-key', exchange: async ({ path }) => {
    paths.push(path)
    if (path.includes('cursor=next')) return reply({ items: [account], next_cursor: null })
    if (path.includes('?')) return reply({ items: [], next_cursor: 'next' })
    return reply(account)
  } })
  assert.equal((await api.accounts()).length, 1)
  assert.equal(await api.account('ca_test'), 'workspace-test')
  assert.equal(paths.length, 3)
})
test('shared onboarding isolates each allowed toolkit and rejects a mismatched account', async () => {
  for (const toolkit of ['gmail', 'googlesheets']) {
    const paths = []
    const selected = { ...account, toolkit: { slug: toolkit } }
    const api = createOnboarding({ toolkit, secret: () => 'synthetic-key', exchange: async ({ path }) => {
      paths.push(path)
      return path.includes('?') ? reply({ items: [selected], next_cursor: null }) : reply(selected)
    } })
    assert.equal((await api.accounts()).length, 1)
    assert.equal(await api.account('ca_test'), 'workspace-test')
    assert.match(paths[0], new RegExp(`toolkit_slugs=${toolkit}`))
    assert.equal(verifiedAccount(selected, 'ca_test', { toolkit: 'notion' }), false)
  }
  assert.throws(() => createOnboarding({ toolkit: 'arbitrary', secret: () => 'synthetic-key' }))
})
test('cancel rejects a late account reply without binding', async () => {
  let complete
  const api = createOnboarding({ secret: () => 'synthetic-key', exchange: () => new Promise(resolve => { complete = resolve }) })
  const pending = api.account('ca_test')
  api.cancel()
  complete(reply(account))
  await assert.rejects(pending)
})
test('poll fixes the attempt account, config and workspace', async () => {
  const calls = []
  const api = createOnboarding({ secret: () => 'synthetic-key', exchange: async options => {
    calls.push(options)
    if (options.method === 'POST') return reply({ connected_account_id: 'ca_test', redirect_url: 'https://connect.composio.dev/link/ln_test', expires_at: new Date(Date.now() + 60000).toISOString() })
    return reply(account)
  } })
  const attempt = await api.link('ac_test', 'workspace-test')
  assert.equal(await api.poll(attempt), 'ca_test')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].path, '/api/v3.1/connected_accounts/ca_test')
})
