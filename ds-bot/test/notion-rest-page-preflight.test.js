import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { previewOnce } from '../scripts/notion-rest-page-preflight.mjs'

const pageId = '01234567-89ab-cdef-0123-456789abcdef'
const accountId = 'fixture-account'
const json = value => ({ status: 200, body: JSON.stringify(value) })

test('one exact POST body and sanitized preview', async () => {
  const calls = []
  const result = await previewOnce({ accountId, pageId, marker: 'fixture-marker', exchange: async req => { calls.push(req); return json({ successful: true, error: '', data: { markdown: 'fixture-marker 😀', truncated: true, hidden: 'fixture-secret' } }) } })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body, { connected_account_id: accountId, version: '20261101_00', arguments: { page_id: pageId, include_transcript: false } })
  assert.deepEqual(result, { status: 'preview', diagnostic: 'ok', httpStatus: 200, serviceCode: null, serviceHint: 'unavailable', schemaVerified: false, requests: 1, truncated: true, markdownBytes: Buffer.byteLength('fixture-marker 😀'), markerMatched: true })
  assert.doesNotMatch(JSON.stringify(result), /fixture-marker|fixture-secret|fixture-account|01234567/)
})

test('invalid selection fails before exchange', async () => {
  for (const input of [{ accountId: '', pageId }, { accountId: 'instant_account', pageId }, { accountId, pageId: 'invalid' }, { accountId, pageId, marker: '' }]) {
    const result = await previewOnce({ ...input, exchange: () => { throw Error('must not run') } })
    assert.equal(result.requests, 0); assert.equal(result.status, 'stopped')
  }
})

test('failure, incompatible shapes, oversized body, and timeout do not retry or leak', async () => {
  const exchanges = [
    async () => { throw Error('fixture-secret') },
    async () => ({ status: 302, body: 'fixture-secret' }),
    async () => json({ successful: false, error: null, data: { markdown: 'fixture-secret', truncated: false } }),
    async () => json({ successful: true, data: 'fixture-secret' }),
    async () => ({ status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1) }),
    () => new Promise(() => {}),
  ]
  for (const exchange of exchanges) {
    const result = await previewOnce({ accountId, pageId, exchange, timeoutMs: 10 })
    assert.equal(result.status, 'stopped'); assert.equal(result.requests, 1)
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret/)
  }
})

test('fixed diagnostics identify the first incompatible boundary without response text', async () => {
  const valid = { successful: true, data: { markdown: 'fixture-secret', truncated: false } }
  const cases = [
    [{ status: 401, body: 'fixture-secret' }, 'http-4xx'],
    [{ status: 500, body: 'fixture-secret' }, 'http-5xx'],
    [{ status: 200, body: '{fixture-secret' }, 'json-invalid'],
    [json({}), 'successful-missing'],
    [json({ successful: false }), 'successful-not-true'],
    [json({ ...valid, successful: false, error: null }), 'successful-not-true'],
    [json({ ...valid, error: 'fixture-secret' }), 'error-string'],
    [json({ ...valid, error: 12 }), 'error-type'],
    [json({ successful: true }), 'data-missing'],
    [json({ successful: true, data: 'fixture-secret' }), 'data-type'],
    [json({ successful: true, data: {} }), 'markdown-missing'],
    [json({ successful: true, data: { markdown: 3 } }), 'markdown-type'],
    [json({ successful: true, data: { markdown: 'x'.repeat(1024 * 1024 + 1) } }), 'markdown-too-large'],
    [json({ successful: true, data: { markdown: 'fixture-secret' } }), 'truncated-missing'],
    [json({ successful: true, data: { markdown: 'fixture-secret', truncated: 1 } }), 'truncated-type'],
  ]
  for (const [response, diagnostic] of cases) {
    const result = await previewOnce({ accountId, pageId, exchange: async () => response })
    assert.equal(result.diagnostic, diagnostic); assert.equal(result.requests, 1); assert.equal(result.schemaVerified, false)
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-account|01234567/)
  }
  const timedOut = await previewOnce({ accountId, pageId, exchange: () => new Promise(() => {}), timeoutMs: 5 })
  assert.equal(timedOut.diagnostic, 'timeout')
})

test('bounded numeric service codes and fixed hints do not expose error text', async () => {
  for (const [error, code, hint] of [
    [{ code: 123456, message: 'user_id is required fixture-secret' }, 123456, 'missing-user-id'],
    [{ code: 0, suggested_fix: 'invalid tool version fixture-secret' }, 0, 'invalid-version'],
    [{ code: 999999999, message: 'invalid arguments fixture-secret' }, 999999999, 'invalid-argument'],
    [{ code: -1, message: 'fixture-secret' }, null, 'unknown'],
    [{ code: 1000000000, message: 'fixture-secret' }, null, 'unknown'],
    [{ code: '404-fixture-secret' }, null, 'unknown'],
    [{ message: 'missing user_id; invalid version fixture-secret' }, null, 'multiple'],
    [{ message: 'fixture-secret'.repeat(100) + ' user_id is required' }, null, 'unknown'],
    [null, null, 'unknown'],
  ]) {
    const result = await previewOnce({ accountId, pageId, exchange: async () => ({ status: 403, body: JSON.stringify({ error }) }) })
    assert.equal(result.httpStatus, 403); assert.equal(result.serviceCode, code); assert.equal(result.serviceHint, hint)
    assert.equal(result.requests, 1); assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-account/)
  }
  const invalid = await previewOnce({ accountId, pageId, exchange: async () => ({ status: 999999, body: '{}' }) })
  assert.equal(invalid.httpStatus, null); assert.equal(invalid.serviceCode, null); assert.equal(invalid.serviceHint, 'unavailable')
})

test('CLI defaults closed even with secret environment', () => {
  const result = spawnSync(process.execPath, ['scripts/notion-rest-page-preflight.mjs'], { encoding: 'utf8', env: { COMPOSIO_API_KEY: 'fixture-secret' } })
  assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.doesNotMatch(result.stderr, /fixture-secret/)
})
