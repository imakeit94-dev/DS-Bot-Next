import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import { test } from 'node:test'
import { browserHandoff, guardHttps, runProbe } from '../scripts/notion-onboarding-live-probe.mjs'

const limits = () => ({ accounts: 0, configs: 0, create: 0, link: 0, poll: 0, bind: 0, read: 0 })
test('guard pins poll to one ID, binds and reads only the selected ID', () => {
  const state = { phase: 'poll', counts: limits(), total: 0, deadline: Date.now() + 5000, deniedAfterClose: 0 }
  const guard = guardHttps(() => true, state)
  const get = id => guard(`https://backend.composio.dev/api/v3.1/connected_accounts/${id}`, { method: 'GET', agent: false })
  assert.equal(get('ca_first'), true); assert.throws(() => get('ca_second'))
  state.accountId = 'ca_first'; state.phase = 'bind'
  assert.throws(() => get('ca_second')); assert.equal(get('ca_first'), true)
  state.phase = 'read'; assert.equal(get('ca_first'), true); assert.throws(() => get('ca_first'))
  assert.throws(() => guard('https://evil.example/api/v3.1/tools/execute/NOTION_GET_PAGE_MARKDOWN', { method: 'POST', agent: false }))
})
test('global deadline aborts hanging request, restores transport, and suppresses late response', async () => {
  const original = https.request
  let finish
  const request = (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = () => {}; req.end = () => { finish = () => { const res = new EventEmitter(); res.statusCode = 200; callback(res); res.emit('data', Buffer.from('{"items":[],"next_cursor":null}')); res.emit('end') } }; return req
  }
  let asked = false
  const output = []
  const result = await runProbe({ key: 'FAKE_SECRET', page: '0123456789abcdef0123456789abcdef', request, ask: async () => { asked = true; return 'N' }, output: value => output.push(value), timeoutMs: 20 })
  assert.equal(result.status, 'stopped'); assert.equal(result.total, 1); assert.equal(asked, false); assert.equal(https.request, original)
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.total, 1); assert.equal(asked, false); assert.deepEqual(output, [])
})
test('one-use handoff rejects duplicate pipelined requests without throwing', async () => {
  let responses = ''
  let finished
  const received = new Promise(resolve => { finished = resolve })
  const promise = browserHandoff('https://connect.composio.dev/link/ln_fake', { launch: local => {
    const url = new URL(local)
    const socket = net.connect(Number(url.port), '127.0.0.1', () => {
      const request = `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: keep-alive\r\n\r\n`
      socket.write(request + request)
    })
    socket.on('data', data => { responses += data.toString() })
    socket.on('close', finished); socket.on('error', finished)
  } })
  await promise; await received
  assert.equal((responses.match(/HTTP\/1\.1 303/g) || []).length, 1)
  assert.equal((responses.match(/HTTP\/1\.1 404/g) || []).length, 1)
})
test('handoff closes incomplete header sockets on timeout, cancellation, and success', async () => {
  for (const mode of ['timeout', 'cancel', 'success']) {
    const controller = new AbortController()
    let closed
    const socketClosed = new Promise(resolve => { closed = resolve })
    let redirect
    const response = new Promise(resolve => { redirect = resolve })
    const handoff = browserHandoff('https://connect.composio.dev/link/ln_fake', { signal: controller.signal, timeoutMs: 100, launch: local => {
      const url = new URL(local)
      const socket = net.connect(Number(url.port), '127.0.0.1', () => {
        socket.write('GET / HTTP/1.1\r\nHost: incomplete')
        if (mode === 'cancel') controller.abort()
        if (mode === 'success') http.get(local, res => { res.resume(); redirect(res.statusCode) })
      })
      socket.on('close', closed); socket.on('error', closed)
    } })
    if (mode === 'success') { await handoff; assert.equal(await response, 303) }
    else await assert.rejects(handoff)
    await Promise.race([socketClosed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('socket still open')), 500); timer.unref() })])
  }
})
test('handoff cancellation removes local listener and invalid URLs never launch', async () => {
  const controller = new AbortController(); let local
  const promise = browserHandoff('https://connect.composio.dev/link/ln_fake', { signal: controller.signal, launch: url => { local = url; controller.abort() } })
  await assert.rejects(promise)
  assert.match(local, /^http:\/\/127\.0\.0\.1:/)
  let launched = false
  await assert.rejects(browserHandoff('https://connect.composio.dev/link/ln_fake?secret=1', { launch: () => { launched = true } }))
  assert.equal(launched, false)
})
