import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { browserHandoff, guardHttps, runProbe } from '../scripts/notion-onboarding-live-probe.mjs'

const page = '0123456789abcdef0123456789abcdef'
const key = 'SECRET_SENTINEL'
const accountId = 'ca_ACCOUNT_SENTINEL'
const configId = 'ac_CONFIG_SENTINEL'
const token = 'ln_TEST_TOKEN_SENTINEL'
const account = user => ({ id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { id: configId, is_disabled: false }, user_id: user })
function wire({ empty = false, configs = 1, failCreate = false, markdown = 'BODY_SENTINEL', delayPost = 0 } = {}) {
  const calls = []
  let user = 'USER_SENTINEL'
  const request = (address, options, callback) => {
    const req = new EventEmitter()
    req.destroy = () => {}
    req.end = raw => {
      const url = new URL(address); const body = raw ? JSON.parse(raw) : undefined
      calls.push({ url: url.pathname, method: options.method, body })
      let response
      if (url.pathname.endsWith('/connected_accounts') && options.method === 'GET') response = { items: empty ? [] : [account(user)], next_cursor: null }
      else if (url.pathname.endsWith('/auth_configs') && options.method === 'GET') response = { items: Array.from({ length: configs }, (_, i) => ({ id: `${configId}${i}`, toolkit: { slug: 'notion' }, status: 'ENABLED' })), next_cursor: null }
      else if (url.pathname.endsWith('/auth_configs') && options.method === 'POST') response = { auth_config: { id: configId } }
      else if (url.pathname.endsWith('/connected_accounts/link')) { user = body.user_id; response = { connected_account_id: accountId, redirect_url: `https://connect.composio.dev/link/${token}`, expires_at: new Date(Date.now() + 120000).toISOString(), link_token: 'OTHER_SECRET_SENTINEL' } }
      else if (url.pathname.endsWith('/connected_accounts/' + accountId)) response = account(user)
      else if (url.pathname.endsWith('/tools/execute/NOTION_GET_PAGE_MARKDOWN')) response = { successful: true, error: null, data: { markdown, truncated: false } }
      else throw Error('unexpected')
      const respond = () => {
        if (failCreate && url.pathname.endsWith('/auth_configs') && options.method === 'POST') { req.emit('error', new Error('PRIVATE ERROR')); return }
        const res = new EventEmitter(); res.statusCode = 200; callback(res)
        res.emit('data', Buffer.from(JSON.stringify(response))); res.emit('end')
      }
      if (delayPost && url.pathname.endsWith('/tools/execute/NOTION_GET_PAGE_MARKDOWN')) setTimeout(respond, delayPost)
      else process.nextTick(respond)
    }
    return req
  }
  return { request, calls }
}
async function invoke(options, choices, timeoutMs) {
  const f = wire(options); const output = []
  const report = await runProbe({ key, page, request: f.request, timeoutMs, ask: async () => choices.shift() ?? 'Q', output: line => output.push(line), handoff: async url => { assert.equal(url, `https://connect.composio.dev/link/${token}`) } })
  assert.doesNotMatch(JSON.stringify({ report, output }), /SECRET_SENTINEL|ACCOUNT_SENTINEL|CONFIG_SENTINEL|TOKEN_SENTINEL|BODY_SENTINEL|USER_SENTINEL|0123456789abcdef/)
  return { report, output, calls: f.calls }
}
test('default CLI gate does not access credentials or network', () => {
  const child = spawnSync(process.execPath, ['--import', './test/harness-resolve.mjs', './scripts/notion-onboarding-live-probe.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH, DSH_HARNESS: process.env.DSH_HARNESS } })
  assert.equal(child.status, 2); assert.equal(child.stdout, ''); assert.equal(child.stderr, '')
})
test('existing account: real manager registers, reads and closes through guarded fake wire', async () => {
  const { report, calls } = await invoke({}, ['1'])
  assert.equal(report.status, 'read'); assert.equal(report.markdownBytes, 13); assert.equal(report.closed, true); assert.equal(report.staleDenied, true); assert.equal(report.closeExtraRequests, false)
  assert.deepEqual(calls.map(x => x.method), ['GET', 'GET', 'GET', 'POST'])
  assert.equal(calls[3].body.connected_account_id, accountId); assert.equal(calls[3].body.user_id, 'USER_SENTINEL'); assert.equal(calls[3].body.version, '20261101_00')
})
test('deadline aborts in-flight POST and never publishes its late successful response', async () => {
  const { report } = await invoke({ delayPost: 120 }, ['1'], 40)
  assert.equal(report.status, 'stopped'); assert.equal(report.read, false); assert.equal(report.truncated, null); assert.equal(report.markdownBytes, null); assert.equal(report.closed, true); assert.equal(report.staleDenied, true)
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(report.status, 'stopped'); assert.equal(report.read, false)
})
test('page text matching the truncation prefix keeps true response metadata', async () => {
  const markdown = 'Note: this page was truncated.\n\nBODY_SENTINEL'
  const { report } = await invoke({ markdown }, ['1'])
  assert.equal(report.status, 'read'); assert.equal(report.truncated, false); assert.equal(report.markdownBytes, Buffer.byteLength(markdown))
})
test('new auth: config creation and link precede account-bound polling and read', async () => {
  const { report, calls } = await invoke({ empty: true, configs: 0 }, ['N', 'C', 'LINK', 'DONE'])
  assert.equal(report.status, 'read'); assert.equal(report.total, 8)
  assert.deepEqual(calls.map(x => x.method), ['GET', 'GET', 'POST', 'POST', 'GET', 'GET', 'GET', 'POST'])
  assert.equal(calls[3].body.auth_config_id, configId); assert.equal(calls[7].body.user_id, calls[3].body.user_id)
})
test('ambiguous configs and uncertain creation stop without link or retry', async () => {
  const many = await invoke({ empty: true, configs: 2 }, ['N'])
  assert.equal(many.report.status, 'stopped'); assert.equal(many.calls.length, 2)
  const failed = await invoke({ empty: true, configs: 0, failCreate: true }, ['N', 'C'])
  assert.equal(failed.report.status, 'stopped'); assert.equal(failed.calls.length, 3)
})
test('guard counts before underlying errors and enforces per-phase and total caps', () => {
  const counts = { accounts: 0, configs: 0, create: 0, link: 0, poll: 0, bind: 0, read: 0 }
  const state = { phase: 'create', counts, total: 0, deadline: Date.now() + 10000, deniedAfterClose: 0 }
  const request = guardHttps(() => { throw Error('underlying') }, state)
  const invoke = () => request('https://backend.composio.dev/api/v3.1/auth_configs', { method: 'POST', agent: false }, () => {})
  assert.throws(invoke, /underlying/); assert.throws(invoke, /guard/); assert.equal(state.total, 1)
  state.phase = 'closed'; assert.throws(invoke, /guard/); assert.equal(state.deniedAfterClose, 1)
})
test('one-use browser handoff validates initial URL and never passes it to launcher', async () => {
  let local
  const promise = browserHandoff(`https://connect.composio.dev/link/${token}`, { launch: value => { local = value; queueMicrotask(() => http.get(value, res => { assert.equal(res.statusCode, 303); assert.equal(res.headers.location, `https://connect.composio.dev/link/${token}`); res.resume() })) } })
  await promise
  assert.match(local, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+$/); assert.doesNotMatch(local, /SENTINEL/)
  await assert.rejects(browserHandoff('https://evil.example/link/token'))
})
