import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { inspectAccountOnce } from '../scripts/notion-account-status-preflight.mjs'

const accountId = 'ca_synthetic'
const response = value => ({ status: 200, body: JSON.stringify(value) })

test('projects only fixed fields from one account response', async () => {
  const calls = []
  const result = await inspectAccountOnce({ accountId, exchange: async req => { calls.push(req); return response({ id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false, id: 'oauth-secret' }, state: { val: { access_token: 'oauth-secret' } }, user_id: 'oauth-secret' }) } })
  assert.equal(calls.length, 1); assert.equal(calls[0].accountId, accountId)
  assert.deepEqual(result, { requests: 1, httpStatus: 200, idMatches: true, isNotion: true, connectionStatus: 'ACTIVE', isDisabled: false, authConfigDisabled: false })
  assert.doesNotMatch(JSON.stringify(result), /oauth-secret|ca_synthetic/)
})

test('unknown, null, false and malformed fields cannot become active', async () => {
  for (const value of [null, {}, { id: null, toolkit: { slug: null }, status: false, is_disabled: null, auth_config: { is_disabled: 'false' } }, JSON.parse('{"__proto__":{"id":"ca_synthetic","status":"ACTIVE","is_disabled":false}}')]) {
    const result = await inspectAccountOnce({ accountId, exchange: async () => response(value) })
    assert.equal(result.idMatches, null); assert.equal(result.isNotion, null); assert.equal(result.connectionStatus, 'unknown')
    assert.equal(result.isDisabled, null); assert.equal(result.authConfigDisabled, null)
  }
  const mismatch = await inspectAccountOnce({ accountId, exchange: async () => response({ id: 'other', toolkit: { slug: 'other' }, status: 'INITIATED', is_disabled: true, auth_config: { is_disabled: false } }) })
  assert.equal(mismatch.idMatches, false); assert.equal(mismatch.isNotion, false); assert.equal(mismatch.isDisabled, true); assert.equal(mismatch.authConfigDisabled, false)
})

test('failure, redirect, timeout and size limit never retry or leak', async () => {
  const exchanges = [async () => { throw Error('oauth-secret') }, async () => ({ status: 302, body: 'oauth-secret' }), async () => ({ status: 403, body: 'oauth-secret' }), async () => ({ status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1) }), () => new Promise(() => {})]
  for (const exchange of exchanges) {
    const result = await inspectAccountOnce({ accountId, exchange, timeoutMs: 5 })
    assert.equal(result.requests, 1); assert.equal(result.connectionStatus, 'unknown'); assert.doesNotMatch(JSON.stringify(result), /oauth-secret|ca_synthetic/)
  }
  const invalid = await inspectAccountOnce({ accountId: '../bad', exchange: () => { throw Error('must not run') } })
  assert.equal(invalid.requests, 0)
})

test('default CLI does not read or print environment', () => {
  const result = spawnSync(process.execPath, ['scripts/notion-account-status-preflight.mjs'], { encoding: 'utf8', env: { COMPOSIO_API_KEY: 'oauth-secret' } })
  assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.doesNotMatch(result.stderr, /oauth-secret/)
})
