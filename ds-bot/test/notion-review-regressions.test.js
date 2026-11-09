import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install, bindOnboardingForTest } from '../src/host/connectors.js'
import { createOnboarding } from '../src/host/composio-onboarding.js'

const json = body => ({ status: 200, body: JSON.stringify(body) })
const existing = { id: 'ca_existing', toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'ac_existing', is_disabled: false }, user_id: 'fixture' }
const linked = { connected_account_id: 'ca_new', redirect_url: 'https://connect.composio.dev/link/ln_fixture', expires_at: new Date(Date.now() + 60000).toISOString() }
function fixture(exchange) {
  let cleanup
  const ctx = { tools: { register: () => () => {} }, effect(fn) { cleanup = fn() } }
  bindOnboardingForTest(ctx, exchange)
  const rt = { ctx, state: {}, config: { github: false }, loadSecrets: async () => {}, load: async () => {}, save: async () => {}, secretValue: () => 'fixture-key', warn() {}, redactSecrets: x => x }
  install(rt)
  return { rt, cleanup: () => cleanup() }
}

test('cancellation before secrets load completes stops discovery before network', async () => {
  let calls = 0, release
  const f = fixture(async () => { calls++; return json({ items: [], next_cursor: null }) })
  await new Promise(resolve => setImmediate(resolve))
  f.rt.loadSecrets = () => new Promise(resolve => { release = resolve })
  const pending = f.rt.connectorEndpoint('connector-notion-accounts')
  await f.rt.connectorEndpoint('connector-notion-cancel')
  release()
  await assert.rejects(pending, /cancelled/)
  assert.equal(calls, 0)
  f.cleanup()
})

test('unloading before secrets load completes also prevents discovery', async () => {
  let calls = 0, release
  const f = fixture(async () => { calls++; return json({ items: [], next_cursor: null }) })
  await new Promise(resolve => setImmediate(resolve))
  f.rt.loadSecrets = () => new Promise(resolve => { release = resolve })
  const pending = f.rt.connectorEndpoint('connector-notion-accounts')
  f.cleanup()
  release()
  await assert.rejects(pending, /cancelled/)
  assert.equal(calls, 0)
})

test('existing connections do not block explicit authorization of another account', async () => {
  const calls = []
  const f = fixture(async ({ path }) => {
    calls.push(path)
    return json(path.includes('auth_configs') ? { items: [{ id: 'ac_new', toolkit: { slug: 'notion' }, status: 'ENABLED' }], next_cursor: null } : { items: [existing], next_cursor: null })
  })
  await f.rt.connectorEndpoint('connector-notion-accounts')
  await assert.rejects(f.rt.connectorEndpoint('connector-notion-configs'), /Find existing/)
  assert.equal((await f.rt.connectorEndpoint('connector-notion-configs', { newAuthorization: true }))[0].id, 'ac_new')
  assert.equal(calls.length, 2)
  f.cleanup()
})

test('poll exhaustion terminates the same attempt, including concurrent and later polls', async () => {
  let gets = 0, release
  const api = createOnboarding({ secret: () => 'fixture-key', exchange: async ({ method }) => {
    if (method === 'POST') return json(linked)
    gets++
    return new Promise(resolve => { release = resolve })
  } })
  const attempt = await api.link('ac_new', 'user')
  const first = api.poll(attempt, { maxAttempts: 1, intervalMs: 0 })
  await assert.rejects(api.poll(attempt), /did not complete/)
  release(json({ status: 'PENDING' }))
  await assert.rejects(first, /timed out/)
  await assert.rejects(api.poll(attempt), /did not complete/)
  assert.equal(gets, 1)
})

test('manager invalidates a timed-out attempt before a later poll', async () => {
  let gets = 0
  const f = fixture(async ({ method, path }) => {
    if (path.includes('connected_accounts?')) return json({ items: [], next_cursor: null })
    if (path.includes('auth_configs?')) return json({ items: [{ id: 'ac_new', toolkit: { slug: 'notion' }, status: 'ENABLED' }], next_cursor: null })
    if (method === 'POST') return json({ ...linked, expires_at: new Date(Date.now() + 2).toISOString() })
    gets++
    return json({ status: 'PENDING' })
  })
  await f.rt.connectorEndpoint('connector-notion-accounts')
  await f.rt.connectorEndpoint('connector-notion-configs')
  await f.rt.connectorEndpoint('connector-notion-link', { configId: 'ac_new' })
  await assert.rejects(f.rt.connectorEndpoint('connector-notion-poll'))
  const count = gets
  await assert.rejects(f.rt.connectorEndpoint('connector-notion-poll'), /No authorization/)
  assert.equal(gets, count)
  f.cleanup()
})
