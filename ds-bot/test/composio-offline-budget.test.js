import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offlineNotionTransport } from '../src/host/composio-offline-transport.js'

const selection = { account: 'fake', pageId: '12345678123412341234123456789abc', fakeAccountProof: 'fixture-only-no-fallback' }
const response = (r, body) => ({ url: r.url, status: 200, body: JSON.stringify(body) })

test('budget reserves cleanup even when handshake cannot complete', async () => {
  const paths = []
  const transport = offlineNotionTransport({ budget: 4, exchange: async r => {
    const path = new URL(r.url).pathname
    paths.push(path)
    return response(r, path === '/session/create' ? { session: 'fake' } : path === '/mcp/initialize' ? { protocol: 'fixture-v1' } : { ok: true })
  } })
  await assert.rejects(transport.connect(selection), /connection failed/)
  assert.deepEqual(paths, ['/session/create', '/mcp/initialize', '/mcp/close', '/session/delete'])
  assert.equal(transport.status().remaining, 0)
})

test('closing before session creation finishes cleans the late session', async () => {
  let resolve
  let observed
  const started = new Promise(r => { observed = r })
  const paths = []
  const transport = offlineNotionTransport({ exchange: async r => {
    const path = new URL(r.url).pathname
    paths.push(path)
    if (path === '/session/create') { observed(); await new Promise(r => { resolve = r }); return response(r, { session: 'late' }) }
    return response(r, { ok: true })
  } })
  const pending = transport.connect(selection)
  await started
  await transport.close()
  resolve()
  await assert.rejects(pending, /connection failed/)
  assert.deepEqual(paths, ['/session/create', '/mcp/close', '/session/delete'])
  assert.equal(transport.status().opened, false)
})
