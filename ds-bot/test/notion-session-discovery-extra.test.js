import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { discover } from '../scripts/notion-session-discovery.mjs'

test('disabled CLI never prints or requires a credential', () => {
  const run = spawnSync(process.execPath, ['scripts/notion-session-discovery.mjs'], { encoding: 'utf8', env: { COMPOSIO_API_KEY: 'synthetic-secret' } })
  assert.equal(run.status, 2)
  assert.equal(run.stdout, '')
  assert.doesNotMatch(run.stderr, /synthetic-secret/)
})

test('late create result gets deleted without resuming discovery', async () => {
  for (const lateAt of [1, 2]) {
    const calls = []
    const exchange = ({ method, url }) => {
      calls.push({ method, url })
      if (method === 'DELETE') return Promise.resolve({ status: 200, body: JSON.stringify({ session_id: 'late-secret', deleted: true }), headers: {} })
      if (calls.length === 1 && lateAt === 2) return Promise.resolve({ status: 400, body: '{}', headers: {} })
      return new Promise(resolve => setTimeout(() => resolve({ status: 201, body: JSON.stringify({ session_id: 'late-secret' }), headers: {} }), 15))
    }
    const result = await discover({ exchange, timeoutMs: 10 })
    assert.equal(result.cleanup, 'deleted'); assert.equal(result.counts.create, lateAt)
    assert.equal(result.counts.sessionDelete, 1); assert.equal(result.counts.business, 0)
    assert.equal(calls.length, lateAt + 1)
  }
})

test('authentication failures and redirects stop without retry', async () => {
  for (const status of [301, 401, 403, 429, 503]) {
    const result = await discover({ exchange: async () => ({ status, headers: {}, body: 'synthetic-secret' }) })
    assert.equal(result.counts.total, 1); assert.equal(result.cleanup, 'uncertain')
    assert.equal(result.negativePin, 'unverified')
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/)
  }
})
