import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offlineNotionTransport, offlineSessionBody, offlinePageArguments, OFFLINE_FIXTURE_SCHEMA, OFFLINE_FIXTURE_TOOL } from '../src/host/composio-offline-transport.js'

const selection = { account: 'fake-account', pageId: '12345678-1234-1234-1234-123456789abc', fakeAccountProof: 'fixture-only-no-fallback' }
function setup(override = {}) {
  const calls = []
  const exchange = async request => {
    calls.push(request)
    const path = new URL(request.url).pathname
    const values = {
      '/session/create': { session: 'fake-session' },
      '/mcp/initialize': { protocol: 'fixture-v1' },
      '/mcp/initialized': { ok: true },
      '/mcp/tools/list': { tools: [{ name: OFFLINE_FIXTURE_TOOL, inputSchema: OFFLINE_FIXTURE_SCHEMA, outputSchema: { type: 'fixture-unknown' } }] },
      '/mcp/close': { ok: true },
      '/session/delete': { ok: true },
    }
    if (override[path]) return override[path](request)
    return { url: request.url, status: 200, body: JSON.stringify(values[path]) }
  }
  return { calls, transport: offlineNotionTransport({ exchange, timeoutMs: 30 }) }
}

test('fake handshake is bounded, account pinned, page fixed, and execution disabled', async () => {
  const { calls, transport } = setup()
  const body = offlineSessionBody('fixture-user', selection.account)
  assert.deepEqual(body.connected_accounts, { notion: ['fake-account'] })
  assert.deepEqual(body.tools, { notion: { enable: [OFFLINE_FIXTURE_TOOL] } })
  assert.equal(body.instant, false)
  assert.deepEqual(offlinePageArguments(selection.pageId), { page_id: selection.pageId })
  assert.throws(() => offlinePageArguments('bad'))
  assert.deepEqual(await transport.connect(selection), { pageId: selection.pageId })
  assert.deepEqual(calls[0].body, { account: 'fake-account', tools: [OFFLINE_FIXTURE_TOOL], instant: false })
  assert.equal(transport.status().opened, true)
  await assert.rejects(transport.read(), /disabled/)
  await transport.close()
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/session/create', '/mcp/initialize', '/mcp/initialized', '/mcp/tools/list', '/mcp/close', '/session/delete'])
  assert.equal(transport.status().cleanupFailed, false)
})

test('invalid selection or absent fake account proof sends nothing', async () => {
  const { calls, transport } = setup()
  await assert.rejects(transport.connect({ ...selection, pageId: 'not-a-uuid' }))
  await assert.rejects(transport.connect({ ...selection, fakeAccountProof: undefined }))
  assert.equal(calls.length, 0)
})

test('extra tools, pagination, redirected URL and oversized data fail closed and clean up', async () => {
  const bad = [
    r => ({ url: r.url, status: 200, body: JSON.stringify({ tools: [], nextCursor: 'x' }) }),
    () => ({ url: 'https://attacker.invalid/', status: 200, body: '{}' }),
    r => ({ url: r.url, status: 302, body: '{}' }),
    r => ({ url: r.url, status: 200, body: 'x'.repeat(70000) }),
  ]
  for (const response of bad) {
    const { calls, transport } = setup({ '/mcp/tools/list': response })
    await assert.rejects(transport.connect(selection), /connection failed/)
    assert.equal(transport.status().opened, false)
    assert.deepEqual(calls.slice(-2).map(c => new URL(c.url).pathname), ['/mcp/close', '/session/delete'])
  }
})

test('timeout reports unknown creation outcome and cleanup failure is visible', async () => {
  const a = setup({ '/session/create': () => new Promise(() => {}) })
  await assert.rejects(a.transport.connect(selection), /cleanup unconfirmed/)
  assert.equal(a.transport.status().cleanupFailed, true)
  const b = setup({ '/mcp/close': () => { throw new Error('secret sentinel') } })
  await b.transport.connect(selection)
  await b.transport.close()
  assert.equal(b.transport.status().cleanupFailed, true)
  assert.equal(new URL(b.calls.at(-1).url).pathname, '/session/delete')
})

test('cleanup requires explicit successful acknowledgements and still attempts deletion', async () => {
  for (const body of ['{"ok":false}', 'null', '{}']) {
    for (const path of ['/mcp/close', '/session/delete']) {
      const f = setup({ [path]: r => ({ url: r.url, status: 200, body }) })
      await f.transport.connect(selection)
      await f.transport.close()
      assert.equal(f.transport.status().cleanupFailed, true)
      assert.equal(new URL(f.calls.at(-1).url).pathname, '/session/delete')
      await assert.rejects(f.transport.connect(selection), /already in use/)
    }
  }
})

test('close during handshake rejects late result without reviving connection', async () => {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const f = setup({ '/mcp/initialize': async r => { await wait; return { url: r.url, status: 200, body: '{"protocol":"fixture-v1"}' } } })
  const pending = f.transport.connect(selection)
  while (f.calls.length < 2) await new Promise(resolve => setImmediate(resolve))
  await f.transport.close()
  release()
  await assert.rejects(pending, /connection failed/)
  assert.equal(f.transport.status().opened, false)
})
