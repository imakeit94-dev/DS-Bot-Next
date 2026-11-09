import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterAssembled } from '../src/host/tools.js'

// Host 0.2.4 and later hand tools to the middleware, so both lists are filtered.
test('filters tools and sections when the host assembles them before the hook', () => {
  const out = filterAssembled({
    tools: [{ name: 'subagent' }, { name: 'message_bot' }, { name: 'ask_user' }],
    sections: [{ name: 'tool:subagent' }, { name: 'tool:message_bot' }, { name: 'identity' }],
    contexts: [{ name: 'runtime' }],
    variables: { a: 'b' },
  })
  assert.deepEqual(out.tools.map(tool => tool.name), ['message_bot', 'ask_user'])
  assert.deepEqual(out.sections.map(section => section.name), ['tool:message_bot', 'identity'])
  assert.deepEqual(out.contexts, [{ name: 'runtime' }])
  assert.deepEqual(out.variables, { a: 'b' })
})

// Host 0.2.2-rc.1 appends the tool list after the waterfall. The filter must keep
// the missing field missing rather than pass an empty list to the host, which
// would then hide every section the host still adds itself.
test('keeps a missing tool list missing and still filters sections (rc.1 shape)', () => {
  const out = filterAssembled({
    sections: [{ name: 'tool:subagent' }, { name: 'identity' }],
    contexts: [{ name: 'runtime' }],
    variables: {},
  })
  assert.equal('tools' in out, false)
  assert.deepEqual(out.sections.map(section => section.name), ['identity'])
  assert.deepEqual(out.contexts, [{ name: 'runtime' }])
})

test('returns the assembly unchanged when it carries no tool or section list', () => {
  const input = { variables: { a: 'b' } }
  const out = filterAssembled(input)
  assert.deepEqual(out, input)
  assert.notEqual(out, input)
})
