import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { install } from '../src/host/prompt.js'

function fixture() {
  const ctx = new Context()
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  const rt = {
    ctx,
    isBotSession: id => ['private', 'member'].includes(id),
    roomOf: id => id === 'relay' ? {} : undefined,
    selfOf: () => undefined,
    botOf: () => undefined,
    isMain: () => false,
  }
  install(rt)
  prompt.section({ name: 'before', order: 10, text: 'before-marker' })
  prompt.section({ name: 'after', order: 100, text: 'after-marker' })
  return { ctx, prompt }
}

test('real prompt assembly filters only DS sessions and tracks section registration', async () => {
  const { prompt } = fixture()
  let dispose = prompt.section({ name: 'genui:cards', order: 80, text: 'schemaJson TinyCard continueChat' })
  const assemble = id => prompt.assemble({ agent: id === undefined ? undefined : { id } })
  const rendered = async id => renderPrompt(await assemble(id))
  for (const id of ['private', 'member', 'relay']) {
    const text = await rendered(id)
    assert.doesNotMatch(text, /schemaJson|TinyCard|continueChat/)
    assert.ok(text.indexOf('before-marker') < text.indexOf('after-marker'))
  }
  for (const id of ['ordinary', undefined]) assert.match(await rendered(id), /schemaJson TinyCard continueChat/)
  const outputs = await Promise.all(['private', 'ordinary', 'member', 'relay'].map(rendered))
  assert.deepEqual(outputs.map(text => text.includes('schemaJson')), [false, true, false, false])
  dispose()
  assert.doesNotMatch(await rendered('ordinary'), /schemaJson/)
  dispose = prompt.section({ name: 'genui:cards', order: 80, text: 'schemaJson' })
  assert.match(await rendered('ordinary'), /schemaJson/)
  assert.doesNotMatch(await rendered('private'), /schemaJson/)
  dispose()
})

test('real DS Bot ownership indexes select current sessions', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsbot-genui-'))
  const team = {
    version: 1, mainBotIds: ['chief'],
    bots: { chief: { id: 'chief', sessionId: 'private', name: 'Chief', createdAt: 1 } },
    rooms: { room: { id: 'room', sessionId: 'relay', name: 'Room', members: ['chief'], sessions: { chief: 'member' }, admin: 'chief', mode: 'everyone' } },
    agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, revision: 1,
  }
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const fake = fakeContext()
  const rt = createRuntime(fake, { home, github: false, diagnosticsFile: false })
  t.after(async () => { await fake.dispose(); rmSync(home, { recursive: true, force: true }) })
  await rt.load()
  const ctx = new Context()
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  install({ ...rt, ctx })
  prompt.section({ name: 'genui:cards', order: 80, text: 'schemaJson' })
  for (const id of ['private', 'member', 'relay']) {
    assert.doesNotMatch(renderPrompt(await prompt.assemble({ agent: { id } })), /schemaJson/, id)
  }
  assert.match(renderPrompt(await prompt.assemble({ agent: { id: 'ordinary' } })), /schemaJson/)
})

test('renamed sections and later outer middleware remain outside the filter', async () => {
  const ctx = new Context()
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, sections: [...assembly.sections, { name: 'genui:cards', text: 'late-marker' }] }
  })
  install({ ctx, isBotSession: id => id === 'private', roomOf: () => undefined, selfOf: () => undefined, botOf: () => undefined, isMain: () => false })
  prompt.section({ name: 'genui:renamed', order: 80, text: 'renamed-marker' })
  const text = renderPrompt(await prompt.assemble({ agent: { id: 'private' } }))
  assert.match(text, /renamed-marker/)
  assert.match(text, /late-marker/)
})

for (const genuiFirst of [true, false]) test(`installed GenUI apply integrates with the real prompt service (GenUI first: ${genuiFirst})`, { skip: !process.env.GENUI_PLUGIN_PATH }, async () => {
  const { apply } = await import(process.env.GENUI_PLUGIN_PATH)
  const ctx = new Context()
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  const handlers = new Map()
  const disposers = []
  const pluginCtx = {
    systemPrompt: prompt,
    webServer: { register: route => { handlers.set(route.path, route.handler); return () => handlers.delete(route.path) } },
    effect: fn => { disposers.push(fn()) },
    inject: () => {},
  }
  const loadGenui = () => apply(pluginCtx, { sectionName: 'genui:cards', sectionOrder: 80, promptEnabled: true })
  const loadNext = () => install({ ctx, isBotSession: id => ['private', 'member'].includes(id), roomOf: id => id === 'relay' ? {} : undefined, selfOf: () => undefined, botOf: () => undefined, isMain: () => false })
  if (genuiFirst) { loadGenui(); loadNext() } else { loadNext(); loadGenui() }
  const assemble = id => prompt.assemble({ agent: { id } })
  for (const id of ['private', 'member', 'relay']) assert.equal((await assemble(id)).sections.some(s => s.name === 'genui:cards'), false)
  const ordinary = await assemble('ordinary')
  assert.equal(ordinary.sections.filter(s => s.name === 'genui:cards').length, 1)
  assert.match(renderPrompt(ordinary), /schemaJson/)
  const control = handlers.get('/api/dsh-genui/prompt')
  assert.ok(control)
  const toggle = async enabled => {
    const req = { method: 'POST', async *[Symbol.asyncIterator]() { yield JSON.stringify({ enabled }) } }
    let status, body
    await control(req, { writeHead: value => { status = value }, end: value => { body = JSON.parse(value) } })
    assert.equal(status, 200)
    assert.equal(body.enabled, enabled)
  }
  await toggle(false)
  assert.equal((await assemble('ordinary')).sections.some(s => s.name === 'genui:cards'), false)
  await toggle(true)
  assert.equal((await assemble('ordinary')).sections.some(s => s.name === 'genui:cards'), true)
  assert.equal((await assemble('private')).sections.some(s => s.name === 'genui:cards'), false)
  for (const dispose of disposers.reverse()) dispose?.()
})

test('complete sections are restored by the host after waterfall', async () => {
  const { prompt } = fixture()
  prompt.section({ name: 'genui:cards', order: 80, text: 'schemaJson', complete: true })
  assert.match(renderPrompt(await prompt.assemble({ agent: { id: 'private' } })), /schemaJson/)
})
