import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createRuntime } from '../index.js'
import { bindNotionRestForTest, bindOnboardingForTest } from '../src/host/connectors.js'
import { fakeContext } from './fake-ctx.js'

const team = { version: 1, mainBotIds: ['a'], workspaceId: 'w1', bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 }, b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 } }, rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'a', named: true, sessions: {}, log: [], seq: 0, seen: {} } }, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0 }

test('product creates shared private, new Bot and group Sessions backed by the real registry', async (t) => {
  const root = new Context()
  await root.plugin(SystemPrompt, {})
  await root.plugin(ToolRuntime, { mode: 'native' })
  const home = mkdtempSync(join(tmpdir(), 'connected-product-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const live = new Map()
  const ctx = fakeContext({ services: { agents: { list: () => [...live.values()], get: id => live.get(id) } } })
  ctx.tools = root.tools
  let next = 0
  const agentOf = async id => {
    if (live.has(id)) return live.get(id)
    const agent = { id: SessionId(id), session: Session.create(SessionId(id)), status: 'idle', followup() {}, steer() {}, inject() {}, send() {}, cancel() {}, whenIdle: async () => {}, inbox: { nextStep: [], nextTurn: [], prepend() {}, append() {}, remove() {} } }
    await root.plugin(Object.assign(inner => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
    live.set(id, agent)
    return agent
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: id => id === 'w1' ? { id, path: home } : undefined, list: () => [{ id: 'w1', path: home }], resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: `s${++next}` }), resolveAgent: async id => ({ agent: await agentOf(id) }), selectModel: async () => {}, page: async () => ({ records: [], hasMore: false }) },
    sessionTitle: { rename: async () => {} }, sessions: { flush: async () => {} },
  })
  const accountId = 'ca_fixture'
  const pageId = '0123456789abcdef0123456789abcdef'
  const fakeAccount = { id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false }, user_id: 'fake-user' }
  bindOnboardingForTest(ctx, async ({ path }) => ({ status: 200, body: JSON.stringify(path.includes('?') ? { items: [fakeAccount], next_cursor: null } : fakeAccount) }))
  bindNotionRestForTest(ctx, async ({ method }) => ({ status: 200, body: JSON.stringify(method === 'GET' ? fakeAccount : { successful: true, error: null, data: { markdown: 'synthetic page', truncated: false } }) }))
  let route
  const originalRegister = ctx.connection.fetch.register
  ctx.connection.fetch.register = options => { route = options; return originalRegister(options) }
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  const stop = new AbortController()
  t.after(async () => { stop.abort(); await ctx.dispose(); await root.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  await call('state', {})
  await rt.secretEndpoint('secret-set', { name: 'COMPOSIO_API_KEY', value: 'fake-key', purpose: 'test', scope: [] })
  await rt.connectorEndpoint('connector-notion-accounts')
  await rt.connectorEndpoint('connector-connect', { id: 'notion', accountId, pageId })
  const created = await call('create-bot', { name: 'Solo' })
  assert.equal(created.ok, true)
  const freshId = created.value.id
  const userEvent = { type: 'user/message', data: { content: [{ type: 'text', text: 'launch moved' }], source: { kind: 'user' } } }
  for (const listener of ctx.listeners.get('session/event') ?? []) if (listener.length >= 2) listener({ id: 'r1' }, userEvent)
  const roomAgent = await agentOf('r1')
  const relay = rt.teamTools.find(d => d.name === 'group_relay').execute({}, { agent: roomAgent, name: 'group_relay', callId: 'r1', signal: stop.signal }).catch(() => {})
  for (let i = 0; i < 100 && !rt.state.rooms.r1.sessions.a; i++) await new Promise(resolve => setTimeout(resolve, 20))
  const groupId = rt.state.rooms.r1.sessions.a
  assert.ok(groupId, 'product relay created a member session')
  assert.deepEqual(rt.groupOwners.get(groupId), { botId: 'a', roomId: 'r1' })
  for (const id of ['a', freshId, groupId]) {
    const agent = await agentOf(id)
    assert.ok(root.tools.get('connected_notion_read_page', agent), `missing shared tool for ${id}`)
    const result = await root.tools.execute({ name: 'connected_notion_read_page', arguments: {}, agent, callId: id, signal: stop.signal })
    assert.equal(result.isError, false, `${id}: ${JSON.stringify(result.error)}`)
    assert.match(JSON.stringify(result), /synthetic page/)
  }
  await rt.connectorEndpoint('connector-disconnect', { id: 'notion' })
  stop.abort()
  await relay
})
