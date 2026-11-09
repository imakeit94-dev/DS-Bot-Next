import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOfflineSessionTransport, liveExchange } from '../src/host/composio-session-transport.js'

function fixture({ badEndpoint = false, badList = false, badDelete = false, sse = false } = {}) {
  const calls = []
  const reply = (body, headers = {}) => ({ status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const exchange = async request => {
    calls.push(request)
    if (request.url.endsWith('/tool_router/session') && request.method === 'POST') return reply({ session_id: 'fixture', mcp: { type: 'http', url: badEndpoint ? 'https://elsewhere.invalid/mcp' : 'https://backend.composio.dev/mcp' } })
    if (request.method === 'DELETE' && request.url.endsWith('/session/fixture')) return reply(badDelete ? {} : { session_id: 'fixture', deleted: true })
    if (request.method === 'DELETE') return { status: 204, headers: {}, body: '' }
    const message = request.body
    if (message.method === 'notifications/initialized') return { status: 202, headers: {}, body: '' }
    const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {} } : { tools: badList ? [] : [{ name: 'NOTION_GET_PAGE_MARKDOWN' }] }
    const rpc = { jsonrpc: '2.0', id: message.id, result }
    if (sse) return { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'fake-mcp' }, body: `data: ${JSON.stringify(rpc)}\n\n` }
    return reply(rpc, { 'mcp-session-id': 'fake-mcp' })
  }
  return { calls, transport: createOfflineSessionTransport({ exchange, userId: 'fake-user', accountId: 'fake-account' }) }
}

test('live network source gate always rejects before using a credential', () => {
  assert.throws(() => liveExchange('synthetic-only'), /disabled/)
})

test('documented session body and MCP JSON-RPC stop before business execution and delete', async () => {
  for (const sse of [false, true]) {
    const f = fixture({ sse })
    await assert.rejects(f.transport.inspectFixture(), /verification unavailable/)
    assert.equal(f.transport.status().cleanup, 'deleted')
    assert.equal(f.transport.status().count, 6)
    assert.deepEqual(f.calls[0].body.connected_accounts, { notion: ['fake-account'] })
    assert.deepEqual(f.calls[0].body.tools.notion.enable, ['NOTION_GET_PAGE_MARKDOWN'])
    assert.deepEqual(f.calls[0].body.preload, { tools: 'all' })
    assert.equal(f.calls[0].body.instant, false)
    assert.equal(f.calls.some(c => c.body?.method === 'tools/call'), false)
    assert.equal(f.calls.at(-1).method, 'DELETE')
  }
})

test('cross origin URL and unexpected tool list fail closed with session deletion', async () => {
  for (const config of [{ badEndpoint: true }, { badList: true }]) {
    const f = fixture(config)
    await assert.rejects(f.transport.inspectFixture(), /verification unavailable/)
    assert.equal(f.transport.status().cleanup, 'deleted')
    assert.equal(f.calls.some(c => new URL(c.url).origin !== 'https://backend.composio.dev'), false)
  }
})

test('MCP timeout is uncertain and still attempts session deletion', async () => {
  const paths = []
  const transport = createOfflineSessionTransport({ userId: 'fake', accountId: 'fake', timeoutMs: 10, exchange: async r => {
    paths.push(r.url)
    if (r.method === 'POST' && r.url.endsWith('/tool_router/session')) return { status: 200, headers: {}, body: JSON.stringify({ session_id: 'fake', mcp: { type: 'http', url: 'https://backend.composio.dev/mcp' } }) }
    if (r.method === 'DELETE') return { status: 200, headers: {}, body: JSON.stringify({ session_id: 'fake', deleted: true }) }
    return new Promise(() => {})
  } })
  await assert.rejects(transport.inspectFixture(), /cleanup uncertain/)
  assert.equal(transport.status().cleanup, 'uncertain')
  assert.equal(paths.at(-1).endsWith('/session/fake'), true)
})

test('close while create is pending reports uncertain until late ID is deleted', async () => {
  for (const previousDelete of [false, true]) {
    let creations = 0
    let release
    let started
    const began = new Promise(resolve => { started = resolve })
    const transport = createOfflineSessionTransport({ userId: 'fake', accountId: 'fake', budget: 16, exchange: async r => {
      if (r.method === 'POST' && r.url.endsWith('/tool_router/session')) {
        creations++
        if (!previousDelete || creations === 2) {
          await new Promise(resolve => { release = resolve; started() })
        }
        return { status: 200, headers: {}, body: JSON.stringify({ session_id: 'fake', mcp: { type: 'http', url: 'https://backend.composio.dev/mcp' } }) }
      }
      if (r.method === 'DELETE') return { status: 200, headers: {}, body: JSON.stringify({ session_id: 'fake', deleted: true }) }
      if (r.body.method === 'notifications/initialized') return { status: 202, headers: {}, body: '' }
      const result = r.body.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {} } : { tools: [] }
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: r.body.id, result }) }
    } })
    if (previousDelete) {
      await assert.rejects(transport.inspectFixture())
      assert.equal(transport.status().cleanup, 'deleted')
    }
    const pending = transport.inspectFixture()
    await began
    await transport.close()
    assert.equal(transport.status().cleanup, 'uncertain')
    release()
    await assert.rejects(pending)
    assert.equal(transport.status().cleanup, 'deleted')
  }
})

test('unknown deletion response is reported as uncertain', async () => {
  const f = fixture({ badDelete: true })
  await assert.rejects(f.transport.inspectFixture(), /cleanup uncertain/)
  assert.equal(f.transport.status().cleanup, 'uncertain')
  await assert.rejects(f.transport.inspectFixture(), /unavailable/)
})
