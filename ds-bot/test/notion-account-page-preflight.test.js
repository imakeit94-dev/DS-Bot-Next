import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { accountPageOnce } from '../scripts/notion-account-page-preflight.mjs'

const accountId = 'ca_fixture'
const pageId = '01234567-89ab-cdef-0123-456789abcdef'
const reply = (value, status = 200) => ({ status, body: JSON.stringify(value) })
const account = { id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false }, user_id: 'user-secret', state: { val: { access_token: 'oauth-secret' } } }
const success = { successful: true, error: '', data: { markdown: 'fixture-marker', truncated: false } }

test('same account validated before one page POST with in-memory user id', async () => {
  const calls = []
  const result = await accountPageOnce({ accountId, pageId, marker: 'fixture-marker', exchange: async req => { calls.push(req); return reply(req.method === 'GET' ? account : success) } })
  assert.equal(result.requests, 2); assert.equal(result.userIdAvailable, true); assert.equal(result.page.status, 'preview')
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST'])
  assert.equal(calls[0].accountId, accountId)
  assert.deepEqual(calls[1].body, { connected_account_id: accountId, version: '20261101_00', arguments: { page_id: pageId, include_transcript: false }, user_id: 'user-secret' })
  assert.doesNotMatch(JSON.stringify(result), /user-secret|oauth-secret|ca_fixture|fixture-marker|01234567/)
})

test('unknown user or unsafe account state stops after GET', async () => {
  const cases = [ { ...account, user_id: undefined }, { ...account, user_id: '' }, { ...account, user_id: ' x' }, { ...account, user_id: 'x\ny' }, { ...account, id: 'other' }, { ...account, toolkit: { slug: 'other' } }, { ...account, status: 'INITIATED' }, { ...account, is_disabled: true }, { ...account, auth_config: {} }, JSON.parse('{"__proto__":{"user_id":"user-secret"}}') ]
  for (const value of cases) {
    let calls = 0
    const result = await accountPageOnce({ accountId, pageId, exchange: async () => { calls++; return reply(value) } })
    assert.equal(calls, 1); assert.equal(result.requests, 1); assert.equal(result.page, null)
    assert.doesNotMatch(JSON.stringify(result), /user-secret|oauth-secret|ca_fixture/)
  }
})

test('failure, redirect and timeout never retry or expose secrets; null error is accepted', async () => {
  for (const exchange of [async () => { throw Error('oauth-secret') }, async () => reply({}, 302), () => new Promise(() => {})]) {
    const result = await accountPageOnce({ accountId, pageId, exchange, timeoutMs: 5 })
    assert.equal(result.requests, 1); assert.equal(result.page, null); assert.doesNotMatch(JSON.stringify(result), /oauth-secret/)
  }
  const result = await accountPageOnce({ accountId, pageId, exchange: async req => reply(req.method === 'GET' ? account : { ...success, error: null }) })
  assert.equal(result.requests, 2); assert.equal(result.page.status, 'preview'); assert.equal(result.page.diagnostic, 'ok'); assert.equal(result.page.schemaVerified, false)
})

test('invalid input and disabled CLI make no requests', async () => {
  const result = await accountPageOnce({ accountId, pageId: 'bad', exchange: () => { throw Error('must not call') } })
  assert.equal(result.requests, 0)
  const cli = spawnSync(process.execPath, ['scripts/notion-account-page-preflight.mjs'], { encoding: 'utf8', env: { COMPOSIO_API_KEY: 'oauth-secret' } })
  assert.equal(cli.status, 2); assert.equal(cli.stdout, ''); assert.doesNotMatch(cli.stderr, /oauth-secret/)
})
