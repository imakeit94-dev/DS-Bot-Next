import assert from 'node:assert/strict'
import { test } from 'node:test'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { notionRestConnection, notionRestExchange } from '../src/host/composio-notion-rest.js'

const selection = { accountId: 'ca_fixture', pageId: '0123456789abcdef0123456789abcdef' }
const account = { id: selection.accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false }, user_id: 'fake-user' }
const result = { successful: true, error: null, data: { markdown: 'fake page', truncated: true } }
const reply = body => ({ status: 200, body: JSON.stringify(body) })
function fixture(exchange, timeoutMs) {
  let tool
  const connection = notionRestConnection({ register: value => { tool = value; return () => { tool = undefined } }, secret: () => 'fake-secret', exchange, timeoutMs })
  return { connection, tool: () => tool }
}

test('selected page uses one pinned account GET and POST, preserving truncation', async () => {
  const calls = []
  const f = fixture(async request => { calls.push(request); return reply(request.method === 'GET' ? account : result) })
  assert.equal(f.connection.isActive(), false)
  f.connection.connect(selection)
  assert.match(await f.tool().execute({}), /truncated[\s\S]*fake page/)
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST'])
  assert.deepEqual(calls[1].body, { connected_account_id: selection.accountId, user_id: 'fake-user', version: '20261101_00', arguments: { page_id: selection.pageId, include_transcript: false } })
  await assert.rejects(f.tool().execute({ page_id: 'other' }), /selected page/)
  const old = f.tool(); f.connection.close()
  assert.equal(f.tool(), undefined)
  await assert.rejects(old.execute({}), /off/)
})

test('account mismatch and invalid response fail without fallback or leaking errors', async () => {
  for (const changed of [{ id: 'other' }, { toolkit: { slug: 'other' } }, { status: 'EXPIRED' }, { is_disabled: true }, { auth_config: { is_disabled: true } }, { user_id: undefined }]) {
    let calls = 0
    const f = fixture(async () => { calls++; return reply({ ...account, ...changed }) })
    f.connection.connect(selection)
    await assert.rejects(f.tool().execute({}), /^Error: Notion page could not be read$/)
    assert.equal(calls, 1)
  }
  for (const response of [{ ...result, error: 'secret-sentinel' }, { ...result, data: 'bad' }, { ...result, successful: false }, { ...result, data: { markdown: 'x'.repeat(1024 * 1024 + 1), truncated: false } }, { ...result, data: { markdown: 'x' } }]) {
    const f = fixture(async ({ method }) => reply(method === 'GET' ? account : response))
    f.connection.connect(selection)
    await assert.rejects(f.tool().execute({}), /^Error: Notion page could not be read$/)
  }
})

test('wire uses fixed HTTPS paths and bounds streamed responses', async (t) => {
  const previous = https.request
  t.after(() => { https.request = previous })
  const seen = []
  let size = 2
  https.request = (url, options, callback) => {
    seen.push({ url, options })
    const request = new EventEmitter()
    request.destroy = () => {}
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter()
      response.statusCode = 200
      callback(response)
      response.emit('data', Buffer.alloc(size))
      response.emit('end')
    })
    return request
  }
  await notionRestExchange({ method: 'GET', accountId: selection.accountId, key: 'fake-secret' })
  assert.equal(seen[0].url, 'https://backend.composio.dev/api/v3.1/connected_accounts/ca_fixture')
  assert.equal(seen[0].options.agent, false)
  size = 2 * 1024 * 1024 + 1
  await assert.rejects(notionRestExchange({ method: 'POST', body: {}, key: 'fake-secret' }), /size/)
  assert.equal(seen[1].url, 'https://backend.composio.dev/api/v3.1/tools/execute/NOTION_GET_PAGE_MARKDOWN')
})

test('close and timeout abort pending calls and reject late results', async () => {
  let resolve
  let signal
  const f = fixture(request => { signal = request.signal; return new Promise(done => { resolve = done }) }, 100)
  f.connection.connect(selection)
  const pending = f.tool().execute({})
  f.connection.close()
  assert.equal(signal.aborted, true)
  await assert.rejects(pending, /could not be read/)
  resolve(reply(account))
  const g = fixture(() => new Promise(() => {}), 10)
  g.connection.connect(selection)
  await assert.rejects(g.tool().execute({}), /could not be read/)
})
