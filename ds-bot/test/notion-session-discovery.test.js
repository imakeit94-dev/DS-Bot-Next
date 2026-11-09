import test from 'node:test'
import assert from 'node:assert/strict'
import { discover } from '../scripts/notion-session-discovery.mjs'

const response = (status, body, headers = {}) => ({ status, body: JSON.stringify(body), headers })
function fixture({ negative = response(400, { error: 'synthetic-secret' }), toolkit = { items: [{ slug: 'notion', connected_account: null }] }, fail } = {}) {
  const requests = []
  const exchange = async req => {
    requests.push(req)
    if (fail?.(req, requests.length)) throw Error('synthetic-secret')
    const path = new URL(req.url).pathname
    if (req.method === 'POST' && path.endsWith('/session')) return requests.filter(r => new URL(r.url).pathname.endsWith('/session') && r.method === 'POST').length === 1 ? negative : response(201, { session_id: 'fixture-session', mcp: { type: 'http', url: 'https://backend.composio.dev/mcp/fixture' } })
    if (path.endsWith('/toolkits')) return response(200, toolkit)
    if (path.endsWith('/fixture-session') && req.method === 'DELETE') return response(200, { session_id: 'fixture-session', deleted: true })
    if (path === '/mcp/fixture' && req.method === 'DELETE') return response(204, '')
    if (req.body?.method === 'initialize') return response(200, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {} } }, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-mcp' })
    if (req.body?.method === 'notifications/initialized') return { status: 202, body: '', headers: {} }
    if (req.body?.method === 'tools/list') return response(200, { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'NOTION_GET_PAGE_MARKDOWN' }] } }, { 'content-type': 'application/json' })
    throw Error('unexpected')
  }
  return { exchange, requests }
}
const run = exchange => discover({ exchange, makeId: () => 'fixture-uuid', timeoutMs: 20 })

test('only isolated discovery requests, bounded and cleaned', async () => {
  const f = fixture(); const result = await run(f.exchange)
  assert.equal(result.discovery, 'listed'); assert.equal(result.cleanup, 'deleted')
  assert.equal(result.sessionVersionVerified, false); assert.equal(result.negativePin, 'unverified')
  assert.deepEqual(result.counts, { total: 8, create: 2, toolkit: 1, mcp: 4, sessionDelete: 1, business: 0 })
  const creates = f.requests.filter(r => r.body?.user_id)
  assert.equal(creates[0].body.user_id, creates[1].body.user_id)
  assert.deepEqual(creates[0].body.connected_accounts, { notion: ['dsbn-nonexistent-fixture-uuid'] })
  assert.equal(Object.hasOwn(creates[1].body, 'connected_accounts'), false)
  assert.equal(f.requests.some(r => r.body?.method === 'tools/call'), false)
  assert.doesNotMatch(JSON.stringify(result), /fixture-session|fixture-mcp|synthetic-secret|nonexistent/)
})

test('unexpected negative success only cleans and never opens discovery', async () => {
  const f = fixture({ negative: response(201, { session_id: 'fixture-session', mcp: { type: 'http', url: 'https://backend.composio.dev/mcp/fixture' } }) })
  const result = await run(f.exchange)
  assert.equal(result.negativePin, 'unexpected-success'); assert.equal(result.cleanup, 'deleted')
  assert.equal(result.counts.create, 1); assert.equal(result.counts.toolkit, 0); assert.equal(result.counts.business, 0)
})

test('failure or timeout cannot create a second session or leak errors', async () => {
  for (const exchange of [async () => { throw Error('synthetic-secret') }, () => new Promise(() => {})]) {
    const result = await run(exchange)
    assert.equal(result.counts.create, 1); assert.equal(result.cleanup, 'uncertain')
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/)
  }
})

test('unknown account shape and MCP failures stop and clean', async () => {
  for (const f of [fixture({ toolkit: { items: [{ slug: 'notion', connected_account: { id: 'synthetic-secret' } }] } }), fixture({ fail: req => req.body?.method === 'tools/list' })]) {
    const result = await run(f.exchange)
    assert.equal(result.discovery, 'stopped'); assert.equal(result.counts.business, 0)
    assert.ok(result.counts.total <= 12)
    assert.equal(result.cleanup, result.counts.mcp === 0 ? 'deleted' : 'uncertain')
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/)
  }
})
