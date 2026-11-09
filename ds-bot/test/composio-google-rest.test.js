import test from 'node:test'
import assert from 'node:assert/strict'
import { googleConnection as productionGoogleConnection, syntheticGoogleConnection as googleConnection, googleEnvelope, googleExchange } from '../src/host/composio-google-rest.js'
import { createComposioConnection } from '../src/host/composio-connection.js'
import https from 'node:https'

const account = { id: 'acct', toolkit: { slug: 'gmail' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: 'cfg', is_disabled: false }, user_id: 'user' }
const ok = data => ({ status: 200, body: JSON.stringify({ successful: true, error: null, data }) })
const registered = () => {
  const tools = new Map()
  return { tools, add: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } }
}

test('synthetic Gmail list uses only fixed read endpoints and blocks unknown message shapes', async () => {
  const { tools, add } = registered(); const requests = []
  const c = googleConnection({ toolkit: 'gmail', register: add, secret: () => 'secret', exchange: async request => {
    requests.push(request)
    if (request.method === 'GET') return { status: 200, body: JSON.stringify(account) }
    return ok(request.slug === 'GMAIL_FETCH_EMAILS' ? { messages: [{ id: 'm1' }], nextPageToken: 'next' } : { unknown: true })
  } })
  c.connect({ accountId: 'acct', expectedUserId: 'user', expectedConfigId: 'cfg' })
  assert.deepEqual([...tools.keys()].sort(), ['connected_gmail_list', 'connected_gmail_read'])
  const list = JSON.parse(await tools.get('connected_gmail_list').execute({ max_results: 2 }))
  assert.deepEqual(list.ids, ['m1']); assert.equal(list.completeness, 'unknown')
  await assert.rejects(tools.get('connected_gmail_read').execute({ message_id: 'other' }))
  await assert.rejects(tools.get('connected_gmail_read').execute({ message_id: 'm1' }), /Unsupported Gmail message response/)
  assert.deepEqual(requests.map(r => r.method), ['GET', 'POST', 'GET', 'POST'])
  assert.equal(requests[1].body.version, '20261103_00')
  c.close(); assert.equal(tools.size, 0)
})

test('Sheets rejects missing range before any exchange', async () => {
  const { tools, add } = registered(); let calls = 0
  const c = googleConnection({ toolkit: 'googlesheets', register: add, secret: () => 'secret', exchange: async () => { calls++; throw new Error('unexpected') } })
  c.connect({ accountId: 'acct', expectedUserId: 'user' })
  await assert.rejects(tools.get('connected_sheets_read').execute({ link: 'https://docs.google.com/spreadsheets/d/abc/edit', range: '' }))
  assert.equal(calls, 0); c.close()
})

test('production reads stay blocked through connect, restore and stale tool references', async () => {
  let networkCalls = 0; let injectedCalls = 0
  const originalRequest = https.request
  https.request = () => { networkCalls++; throw new Error('unexpected network') }
  try {
    for (const toolkit of ['gmail', 'googlesheets']) for (const injected of [false, true]) {
      const { tools, add } = registered()
      const selected = { ...account, toolkit: { slug: toolkit } }
      const rt = { state: {}, secretValue: () => 'synthetic-key', loadSecrets: async () => {}, save: async () => {} }
      const connection = productionGoogleConnection({ toolkit, register: add, secret: rt.secretValue, ...(injected ? { exchange: async () => { injectedCalls++; throw new Error('unexpected exchange') } } : {}) })
      const manager = createComposioConnection({ rt, id: toolkit, toolkit, connection, resource: () => ({}), isStopped: () => false,
        exchange: async ({ path }) => ({ status: 200, body: JSON.stringify(path.includes('?') ? { items: [selected], next_cursor: null } : selected) }) })
      await manager.accounts(); await manager.connect({ accountId: 'acct' })
      const names = toolkit === 'gmail' ? ['connected_gmail_list', 'connected_gmail_read'] : ['connected_sheets_read']
      const args = toolkit === 'gmail' ? [{}, { message_id: 'm1' }] : [{ link: 'https://docs.google.com/spreadsheets/d/abc/edit', range: 'Sheet1!A1:B2' }]
      const old = names.map(name => tools.get(name))
      for (let i = 0; i < old.length; i++) await assert.rejects(old[i].execute(args[i]))
      manager.close(); await manager.restore()
      for (let i = 0; i < names.length; i++) {
        await assert.rejects(old[i].execute(args[i]))
        await assert.rejects(tools.get(names[i]).execute(args[i]))
      }
      manager.close()
    }
    assert.equal(networkCalls, 0)
    assert.equal(injectedCalls, 0)
    assert.throws(() => googleConnection({ exchange: googleExchange }), /Synthetic exchange required/)
  } finally { https.request = originalRequest }
})

test('unknown, unsuccessful and oversized synthetic envelopes are rejected', () => {
  for (const value of [{ status: 200, body: '{}' }, { status: 200, body: JSON.stringify({ successful: false, error: null, data: {} }) }, { status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1) }]) assert.throws(() => googleEnvelope(value))
})

test('late list after reconnect cannot authorize IDs for another account', async () => {
  const { tools, add } = registered(); let release; let entered
  const started = new Promise(resolve => { entered = resolve })
  const pending = new Promise(resolve => { release = resolve })
  const posts = []
  const c = googleConnection({ toolkit: 'gmail', register: add, secret: () => 'synthetic', exchange: async request => {
    if (request.method === 'GET') return { status: 200, body: JSON.stringify({ ...account, id: request.accountId, user_id: `${request.accountId}user` }) }
    posts.push(request.accountId)
    if (request.slug === 'GMAIL_FETCH_EMAILS') { entered(); return pending }
    return ok({ message: { id: 'old_message', payload: { mimeType: 'text/plain', body: {} } } })
  } })
  c.connect({ accountId: 'old', expectedUserId: 'olduser' })
  const old = tools.get('connected_gmail_list').execute({})
  await started
  release(ok({ messages: [{ id: 'old_message' }] }))
  let remaining = 2
  const reconnect = () => { if (remaining-- === 0) c.connect({ accountId: 'new', expectedUserId: 'newuser' }); else queueMicrotask(reconnect) }
  queueMicrotask(reconnect)
  await assert.rejects(old)
  await assert.rejects(tools.get('connected_gmail_read').execute({ message_id: 'old_message' }))
  assert.deepEqual(posts, ['old'])
  c.close()
})

test('late Gmail detail and Sheets results are not published after reconnect', async () => {
  for (const toolkit of ['gmail', 'googlesheets']) {
    const { tools, add } = registered(); let release; let entered
    const started = new Promise(resolve => { entered = resolve })
    const pending = new Promise(resolve => { release = resolve })
    const c = googleConnection({ toolkit, register: add, secret: () => 'synthetic', exchange: async request => {
      if (request.method === 'GET') return { status: 200, body: JSON.stringify({ ...account, id: request.accountId, toolkit: { slug: toolkit }, user_id: `${request.accountId}user` }) }
      if (request.slug === 'GMAIL_FETCH_EMAILS') return ok({ messages: [{ id: 'm1' }] })
      entered(); return pending
    } })
    c.connect({ accountId: 'old', expectedUserId: 'olduser' })
    if (toolkit === 'gmail') await tools.get('connected_gmail_list').execute({})
    const result = toolkit === 'gmail' ? tools.get('connected_gmail_read').execute({ message_id: 'm1' }) : tools.get('connected_sheets_read').execute({ link: 'https://docs.google.com/spreadsheets/d/abc/edit', range: 'Sheet1!A1:B2' })
    await started
    release(toolkit === 'gmail' ? ok({ message: { id: 'm1', payload: { mimeType: 'text/plain', body: {} } } }) : ok({ valueRanges: [{ range: 'Sheet1!A1:B2', values: [[1]] }] }))
    let remaining = 2
    const reconnect = () => { if (remaining-- === 0) c.connect({ accountId: 'new', expectedUserId: 'newuser' }); else queueMicrotask(reconnect) }
    queueMicrotask(reconnect)
    await assert.rejects(result)
    c.close()
  }
})

test('toolkit and account identity mismatch never reaches a read request', async () => {
  for (const mismatch of [{ toolkit: { slug: 'googlesheets' } }, { user_id: 'other' }, { auth_config: { id: 'other', is_disabled: false } }]) {
    const { tools, add } = registered(); const methods = []
    const c = googleConnection({ toolkit: 'gmail', register: add, secret: () => 'synthetic', exchange: async request => {
      methods.push(request.method)
      return { status: 200, body: JSON.stringify({ ...account, ...mismatch }) }
    } })
    c.connect({ accountId: 'acct', expectedUserId: 'user', expectedConfigId: 'cfg' })
    await assert.rejects(tools.get('connected_gmail_list').execute({}))
    assert.deepEqual(methods, ['GET'])
    c.close()
  }
})

test('timed out synthetic requests cannot produce results after late replies', async () => {
  const { tools, add } = registered(); let reply
  const c = googleConnection({ toolkit: 'gmail', register: add, secret: () => 'synthetic', timeoutMs: 10, exchange: () => new Promise(resolve => { reply = resolve }) })
  c.connect({ accountId: 'acct', expectedUserId: 'user' })
  await assert.rejects(tools.get('connected_gmail_list').execute({}))
  reply({ status: 200, body: JSON.stringify(account) })
  c.close()
})

test('disconnect cancels a pending synthetic exchange and rejects a late response', async () => {
  const { tools, add } = registered(); let reply
  const c = googleConnection({ toolkit: 'gmail', register: add, secret: () => 'secret', exchange: () => new Promise(resolve => { reply = resolve }) })
  c.connect({ accountId: 'acct', expectedUserId: 'user' })
  const result = tools.get('connected_gmail_list').execute({})
  c.close(); await assert.rejects(result); reply({ status: 200, body: JSON.stringify(account) })
  assert.equal(tools.size, 0)
})
