import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { bindSyntheticNotionForTest, bindNotionRestForTest, bindOnboardingForTest } from '../src/host/connectors.js'
import { fakeContext } from './fake-ctx.js'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { syntheticNotion, SYNTHETIC_SCHEMA, SYNTHETIC_TOOL } from '../src/host/composio-notion.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture({ tools = [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }], identity = 'fake-account', call = async () => ({ markdown: 'synthetic content' }), open } = {}) {
  let registered
  let closed = 0
  const transport = { identity: async () => identity, list: async () => tools, call, close: async () => { closed++ } }
  const notion = syntheticNotion({
    open: open ?? (async () => transport),
    register: tool => { registered = tool; return () => { registered = undefined } },
  })
  return { notion, transport, tool: () => registered, closed: () => closed }
}
const selection = { account: 'fake-account', pageId: 'page_1' }

test('synthetic adapter defaults off and reads only the selected page', async () => {
  const f = fixture()
  assert.equal(f.notion.isActive(), false)
  await f.notion.connect(selection)
  assert.equal(f.notion.isActive(), true)
  const tool = f.tool()
  assert.equal(await tool.execute({ page_id: 'page_1' }), 'synthetic content')
  await assert.rejects(tool.execute({ page_id: 'other' }), /selected page/)
  await assert.rejects(tool.execute({ page_id: 'page_1', url: 'https://example.invalid' }), /selected page/)
  await f.notion.close()
  assert.equal(f.tool(), undefined)
  await assert.rejects(tool.execute({ page_id: 'page_1' }), /off/)
})

test('synthetic identity and unknown or extra tool schemas fail closed', async () => {
  for (const options of [
    { identity: 'other-account' },
    { tools: [] },
    { tools: [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }, { name: 'write', inputSchema: SYNTHETIC_SCHEMA }] },
    { tools: [{ name: SYNTHETIC_TOOL, inputSchema: { ...SYNTHETIC_SCHEMA, additionalProperties: true } }] },
    { tools: [{ name: 'write', inputSchema: SYNTHETIC_SCHEMA }] },
  ]) {
    const f = fixture(options)
    await assert.rejects(f.notion.connect(selection), /unavailable/)
    assert.equal(f.notion.isActive(), false)
    assert.equal(f.tool(), undefined)
    assert.equal(f.closed(), 1)
  }
})

test('synthetic pinned account fails closed without selecting a fallback', async () => {
  for (const scenario of ['missing', 'invalid', 'different', 'closed']) {
    let opens = 0
    let identityChecks = 0
    let listings = 0
    let calls = 0
    let registered
    const transport = {
      identity: async () => { identityChecks++; if (scenario === 'invalid') throw new Error('secret identity failure'); return scenario === 'different' ? 'different-fake-user' : 'fake-account' },
      list: async () => { listings++; return [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }] },
      call: async () => { calls++; return { markdown: 'synthetic content' } },
      close: async () => {},
    }
    const notion = syntheticNotion({ open: async () => { opens++; return transport }, register: tool => { registered = tool; return () => { registered = undefined } } })
    if (scenario === 'missing') {
      await assert.rejects(notion.connect({ account: '', pageId: 'page_1' }), /Invalid synthetic connection/)
      assert.equal(opens, 0)
    } else if (scenario === 'closed') {
      await notion.connect(selection)
      const stale = registered
      await notion.close()
      await assert.rejects(stale.execute({ page_id: 'page_1' }), /off/)
      assert.equal(identityChecks, 1)
      assert.equal(calls, 0)
    } else {
      await assert.rejects(notion.connect(selection), /Synthetic Notion connection unavailable/)
      assert.equal(opens, 1)
      assert.equal(identityChecks, 1)
      assert.equal(listings, 0)
      assert.equal(calls, 0)
      assert.equal(registered, undefined)
    }
  }
})

test('close blocks late initialization and late results', async () => {
  const waitOpen = deferred()
  const f = fixture({ open: () => waitOpen.promise })
  const connecting = f.notion.connect(selection)
  await Promise.resolve()
  await f.notion.close()
  waitOpen.resolve(f.transport)
  await assert.rejects(connecting, /unavailable/)
  assert.equal(f.tool(), undefined)

  const waitCall = deferred()
  const g = fixture({ call: () => waitCall.promise })
  await g.notion.connect(selection)
  const result = g.tool().execute({ page_id: 'page_1' })
  await g.notion.close()
  waitCall.resolve({ markdown: 'should not be returned' })
  await assert.rejects(result, /off/)
})

test('overlapping synthetic initializations cannot revive an older connection', async () => {
  const first = deferred()
  let opens = 0
  let current
  let oldClosed = 0
  const old = { close: async () => { oldClosed++ } }
  const newest = { identity: async () => 'fake-account', list: async () => [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }], call: async () => ({ markdown: 'new' }) }
  const notion = syntheticNotion({ open: () => ++opens === 1 ? first.promise : Promise.resolve(newest), register: tool => { current = tool; return () => { current = undefined } } })
  const older = notion.connect(selection)
  await new Promise(resolve => setImmediate(resolve))
  await notion.connect(selection)
  first.resolve(old)
  await assert.rejects(older, /unavailable/)
  assert.equal(oldClosed, 1)
  assert.equal(await current.execute({ page_id: 'page_1' }), 'new')
  await notion.close()
})

test('synthetic tool registers through the actual native tool registry', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const transport = { identity: async () => 'fake-account', list: async () => [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }], call: async () => ({ markdown: 'synthetic content' }) }
  const notion = syntheticNotion({ open: async () => transport, register: tool => ctx.tools.register(tool) })
  await notion.connect(selection)
  const call = () => ctx.tools.execute({ name: 'connected_notion_read_page', arguments: { page_id: 'page_1' }, callId: 'synthetic-native', signal: new AbortController().signal })
  const result = await call()
  assert.equal(result.isError, false)
  for (const name of ['synthetic-private', 'synthetic-group-member', 'synthetic-future-bot']) {
    const agent = { ctx, id: SessionId(name), session: Session.create(SessionId(name)) }
    await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
    assert.ok(ctx.tools.get('connected_notion_read_page', agent))
    const scoped = await ctx.tools.execute({ name: 'connected_notion_read_page', arguments: { page_id: 'page_1' }, agent, callId: name, signal: new AbortController().signal })
    assert.equal(scoped.isError, false, `${name}: ${JSON.stringify(scoped.error)}`)
  }
  await notion.close()
  assert.equal((await call()).isError, true)
})

test('real PTC process dispatches synthetic Notion through the registry', { skip: process.env.RUN_REAL_PTC !== '1' && 'requires isolated real PTC process' }, async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const name of ['session-projection', 'fs-local', 'subprocess-local', 'sandbox-local']) {
    const plugin = await import(`@deepseek-ai/dsh-${name}`)
    await ctx.plugin(plugin.default, {})
  }
  const { default: SandboxPolicy } = await import('@deepseek-ai/dsh-sandbox-policy')
  const { default: NodePtcRuntime } = await import('@deepseek-ai/dsh-ptc-runtime-node')
  await ctx.plugin(SandboxPolicy, { mode: 'read-only' })
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, { mode: 'ptc' })
  await ctx.plugin(NodePtcRuntime, {})
  const entered = deferred()
  const waiting = deferred()
  let hold = false
  const transport = { identity: async () => 'fake-account', list: async () => [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }], call: async () => { if (hold) { entered.resolve(); return waiting.promise } return { markdown: 'synthetic content' } } }
  const home = mkdtempSync(join(tmpdir(), 'notion-ptc-manager-'))
  const product = fakeContext()
  product.tools = ctx.tools
  bindSyntheticNotionForTest(product, async () => transport)
  const rt = createRuntime(product, { home, github: false, diagnosticsFile: false })
  t.after(async () => { await product.dispose(); rmSync(home, { recursive: true, force: true }) })
  const notion = rt.notionConnection
  await notion.connect(selection)
  ctx.provide('workingDirectory', { ensure: async () => home })
  const agent = { ctx, id: SessionId('ptc-product-session'), session: Session.create(SessionId('ptc-product-session')) }
  await ctx.plugin(Object.assign(inner => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
  const invoke = () => ctx.tools.execute({ name: 'run_code', arguments: { code: "const saved = tools.connected_notion_read_page; return await saved({page_id: 'page_1'})", description: 'Read synthetic page' }, agent, workingDirectory: home, callId: 'synthetic-ptc', signal: new AbortController().signal })
  const before = await invoke()
  assert.equal(before.isError, false, JSON.stringify(before.error))
  hold = true
  const stale = invoke()
  await entered.promise
  await notion.close()
  waiting.resolve({ markdown: 'must not be delivered' })
  assert.equal((await stale).isError, true)
  const after = await invoke()
  assert.equal(after.isError, true)
})

test('product connection manager registers on the real registry and invalidates stale calls', async (t) => {
  const host = new Context()
  await host.plugin(SystemPrompt, {})
  await host.plugin(ToolRuntime, { mode: 'native' })
  const home = mkdtempSync(join(tmpdir(), 'notion-manager-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 1, mainBotIds: ['a'], workspaceId: 'w1', bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 }, b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 } }, rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'a', named: true, sessions: { b: 'group-b' }, log: [], seq: 0, seen: {} } }, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0 }))
  const ctx = fakeContext()
  ctx.tools = host.tools
  const held = deferred()
  const entered = deferred()
  let slow = false
  bindSyntheticNotionForTest(ctx, async () => ({ identity: async () => 'fake-account', list: async () => [{ name: SYNTHETIC_TOOL, inputSchema: SYNTHETIC_SCHEMA }], call: async () => { if (slow) { entered.resolve(); return held.promise } return { markdown: 'synthetic content' } } }))
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  t.after(async () => { await ctx.dispose(); await host.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  await rt.notionConnection.connect(selection)
  const agents = []
  for (const id of ['a', 'group-b']) {
    const agent = { ctx: host, id: SessionId(id), session: Session.create(SessionId(id)) }
    await host.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
    agents.push(agent)
  }
  const invoke = agent => host.tools.execute({ name: 'connected_notion_read_page', arguments: { page_id: 'page_1' }, agent, callId: 'manager-test', signal: new AbortController().signal })
  for (const agent of agents) assert.equal((await invoke(agent)).isError, false)
  const staleTool = host.tools.get('connected_notion_read_page', agents[0])
  slow = true
  const pending = invoke(agents[1])
  await entered.promise
  await rt.notionConnection.close()
  held.resolve({ markdown: 'do not deliver' })
  const discarded = await pending
  assert.equal(discarded.isError, true)
  assert.doesNotMatch(JSON.stringify(discarded), /do not deliver/)
  assert.equal((await invoke(agents[0])).isError, true)
  await assert.rejects(staleTool.execute({ page_id: 'page_1' }), /off/)
  slow = false
  await rt.notionConnection.connect(selection)
  const beforeDispose = host.tools.get('connected_notion_read_page', agents[0])
  await ctx.dispose()
  await assert.rejects(beforeDispose.execute({ page_id: 'page_1' }), /off/)
  assert.equal(host.tools.get('connected_notion_read_page', agents[0]), undefined)
})

test('production runtime rejects Notion without a code-injected synthetic transport', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'notion-disabled-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 1, connectors: { notion: { enabled: true, account: 'fake-account', pageId: 'page_1' } } }))
  const ctx = fakeContext()
  const rt = createRuntime(ctx, { home, github: false, notion: { enabled: true }, diagnosticsFile: false })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true }) })
  assert.equal(rt.notionConnection.isActive(), false)
  assert.equal(rt.connectorsView().find(item => item.id === 'notion').state, 'off')
  await assert.rejects(rt.connectorEndpoint('connector-connect', { id: 'notion', ...selection }), /Select a Notion connection/)
  await assert.rejects(rt.notionConnection.connect(selection), /unavailable/)
  assert.equal(rt.notionConnection.isActive(), false)
})

test('REST candidate connects through the product manager and shared native registry', async (t) => {
  const host = new Context()
  await host.plugin(SystemPrompt, {})
  await host.plugin(ToolRuntime, { mode: 'native' })
  const home = mkdtempSync(join(tmpdir(), 'notion-rest-manager-'))
  const ctx = fakeContext()
  ctx.tools = host.tools
  const accountId = 'ca_fixture'
  const pageId = '0123456789abcdef0123456789abcdef'
  const fakeAccount = { id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false }, user_id: 'synthetic-user' }
  bindOnboardingForTest(ctx, async ({ path }) => ({ status: 200, body: JSON.stringify(path.includes('?') ? { items: [fakeAccount], next_cursor: null } : fakeAccount) }))
  const calls = []
  bindNotionRestForTest(ctx, async request => {
    calls.push(request.method)
    return { status: 200, body: JSON.stringify(request.method === 'GET' ? { id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false }, user_id: 'synthetic-user' } : { successful: true, error: null, data: { markdown: 'fake page', truncated: false } }) }
  })
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  t.after(async () => { await ctx.dispose(); await host.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  await rt.secretEndpoint('secret-set', { name: 'COMPOSIO_API_KEY', value: 'fake-key', purpose: 'test', scope: [] })
  await rt.connectorEndpoint('connector-notion-accounts')
  await rt.connectorEndpoint('connector-connect', { id: 'notion', accountId, pageId })
  for (const id of ['private', 'group-member', 'future-bot']) {
    const agent = { ctx: host, id: SessionId(id), session: Session.create(SessionId(id)) }
    await host.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
    const response = await host.tools.execute({ name: 'connected_notion_read_page', arguments: {}, agent, callId: id, signal: new AbortController().signal })
    assert.equal(response.isError, false)
  }
  assert.deepEqual(calls, ['GET', 'POST', 'GET', 'POST', 'GET', 'POST'])
  await rt.connectorEndpoint('connector-disconnect', { id: 'notion' })
  assert.equal(host.tools.get('connected_notion_read_page'), undefined)
})

test('real PTC calls the REST candidate through the product manager', { skip: process.env.RUN_REAL_PTC !== '1' && 'requires isolated real PTC process' }, async (t) => {
  const host = new Context()
  for (const name of ['session-projection', 'fs-local', 'subprocess-local', 'sandbox-local']) await host.plugin((await import(`@deepseek-ai/dsh-${name}`)).default, {})
  const { default: SandboxPolicy } = await import('@deepseek-ai/dsh-sandbox-policy')
  const { default: NodePtcRuntime } = await import('@deepseek-ai/dsh-ptc-runtime-node')
  await host.plugin(SandboxPolicy, { mode: 'read-only' })
  await host.plugin(SystemPrompt, {})
  await host.plugin(ToolRuntime, { mode: 'ptc' })
  await host.plugin(NodePtcRuntime, {})
  const home = mkdtempSync(join(tmpdir(), 'notion-rest-ptc-'))
  const ctx = fakeContext()
  ctx.tools = host.tools
  const accountId = 'ca_fixture'
  const pageId = '0123456789abcdef0123456789abcdef'
  const fakeAccount = { id: accountId, toolkit: { slug: 'notion' }, status: 'ACTIVE', is_disabled: false, auth_config: { is_disabled: false }, user_id: 'synthetic-user' }
  bindOnboardingForTest(ctx, async ({ path }) => ({ status: 200, body: JSON.stringify(path.includes('?') ? { items: [fakeAccount], next_cursor: null } : fakeAccount) }))
  bindNotionRestForTest(ctx, async ({ method }) => ({ status: 200, body: JSON.stringify(method === 'GET' ? fakeAccount : { successful: true, error: null, data: { markdown: 'fake page', truncated: false } }) }))
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  t.after(async () => { await ctx.dispose(); await host.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  await rt.secretEndpoint('secret-set', { name: 'COMPOSIO_API_KEY', value: 'fake-key', purpose: 'test', scope: [] })
  await rt.connectorEndpoint('connector-notion-accounts')
  await rt.connectorEndpoint('connector-connect', { id: 'notion', accountId, pageId })
  host.provide('workingDirectory', { ensure: async () => home })
  const agent = { ctx: host, id: SessionId('rest-ptc'), session: Session.create(SessionId('rest-ptc')) }
  await host.plugin(Object.assign(inner => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
  const invoke = () => host.tools.execute({ name: 'run_code', arguments: { code: 'return await tools.connected_notion_read_page({})', description: 'Read selected page' }, agent, workingDirectory: home, callId: 'rest-ptc', signal: new AbortController().signal })
  assert.equal((await invoke()).isError, false)
  await rt.connectorEndpoint('connector-disconnect', { id: 'notion' })
  assert.equal((await invoke()).isError, true)
})

test('unknown responses and errors do not leak sensitive content', async () => {
  for (const call of [async () => ({ markdown: 'secret', extra: true }), async () => { throw new Error('private sentinel') }]) {
    const f = fixture({ call })
    await f.notion.connect(selection)
    await assert.rejects(f.tool().execute({ page_id: 'page_1' }), error => !error.message.includes('secret') && !error.message.includes('sentinel'))
    await f.notion.close()
  }
})
