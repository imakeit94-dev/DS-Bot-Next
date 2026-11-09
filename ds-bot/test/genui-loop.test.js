import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { install } from '../src/host/prompt.js'

test('real AgentLoop projects the installed GenUI prompt across fresh and continuing synthetic sessions', { skip: !process.env.GENUI_PLUGIN_PATH }, async () => {
  const { apply } = await import(process.env.GENUI_PLUGIN_PATH)
  const ctx = new Context()
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new AgentRegistry(ctx)
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  prompt.section({ name: 'baseline', order: 10, text: 'synthetic baseline' })
  const disposers = []
  apply({ systemPrompt: prompt, webServer: { register: () => () => {} }, effect: fn => { disposers.push(fn()) }, inject: () => {} }, { sectionName: 'genui:cards', sectionOrder: 80, promptEnabled: true })
  const botIds = new Set(['private'])
  install({ ctx, isBotSession: id => botIds.has(id), roomOf: () => undefined, selfOf: () => undefined, botOf: () => undefined, isMain: () => false })
  const requests = []
  ctx.provide('llm', { prepareCall: async config => ({ config, systemPromptUpdate: 'in-history', stream: async function* (req) { requests.push(req); yield* [] } }) })
  ctx.provide('tools', {})
  const loop = new AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })
  const send = async agent => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic' }] }))
    await agent.whenIdle()
  }
  const options = { provider: 'mock', model: 'mock' }
  const privateAgent = await loop.create('private', options)
  await send(privateAgent)
  assert.equal(requests.length, 1)
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /schemaJson/)
  const ordinary = await loop.create('ordinary', options)
  await send(ordinary)
  assert.match(JSON.stringify(requests[1].messages), /schemaJson/)
  botIds.add('ordinary')
  await send(ordinary)
  assert.equal(requests.length, 3)
  assert.match(JSON.stringify(requests[2].messages), /schemaJson/)
  const systems = requests[2].messages.filter(message => message.role === 'system')
  assert.ok(systems.length >= 2)
  assert.doesNotMatch(JSON.stringify(systems.at(-1)), /schemaJson/)
  assert.match(JSON.stringify(systems[0]), /schemaJson/)
  for (const dispose of disposers.reverse()) dispose?.()
})
