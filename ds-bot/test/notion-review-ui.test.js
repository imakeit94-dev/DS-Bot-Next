import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const { outputFiles } = await build({ entryPoints: ['src/client/notion-onboarding.js'], bundle: true, format: 'cjs', platform: 'browser', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
function fixture(actions, state = 'off') {
  const instances = new Map(); let current, index
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== null && x !== false && x !== undefined) } }),
    useState(value) { const slot = index++; if (!(slot in current)) current[slot] = value; const own = current; return [own[slot], next => { own[slot] = typeof next === 'function' ? next(own[slot]) : next }] },
    useRef(value) { const slot = index++; return current[slot] ??= { current: value } },
    useEffect(fn) { const slot = index++; if (!(slot in current)) current[slot] = { cleanup: fn() } },
    useLayoutEffect() { index++ },
  }
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: name => name === 'react' ? react : {} })
  const render = (fn, props) => { if (!instances.has(fn)) instances.set(fn, []); current = instances.get(fn); index = 0; return fn(props) }
  const props = { connector: { state, composioConfigured: true }, actions }
  const row = () => render(module.exports.NotionRow, props)
  let tree = row(); button(tree, state === 'ready' ? 'Change connection' : 'Connect').props.onClick(); tree = row()
  const form = all(tree, node => typeof node.type === 'function' && node.type.name === 'NotionForm')[0]
  return { row, form: () => render(form.type, form.props) }
}
function all(node, predicate) { return !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...(node.props?.children ?? []).flatMap(child => all(child, predicate))] }
const button = (node, text) => all(node, item => item.type === 'button' && item.props.children.includes(text))[0]
const tick = () => new Promise(resolve => setImmediate(resolve))

test('existing account offers deliberate new authorization and warning, including when already connected', async () => {
  for (const state of ['off', 'ready']) {
    const calls = []
    const f = fixture({ notionAccounts: async () => [{ id: 'ca_fixture', label: 'Existing' }], notionConfigs: async flag => { calls.push(flag); return [] }, notionCancel: async () => {} }, state)
    button(f.form(), 'Find existing connections').props.onClick(); await tick()
    const view = f.form()
    assert.ok(JSON.stringify(view).includes('Authorizing another connection may affect an existing refresh token.'))
    button(view, 'Authorize another Notion account').props.onClick(); await tick()
    assert.deepEqual(calls, [true])
  }
})

test('late link and poll results cannot change a cancelled parent row', async () => {
  for (const stage of ['link', 'poll-success', 'poll-failure']) {
    let finish, reject
    const pending = new Promise((resolve, fail) => { finish = resolve; reject = fail })
    const f = fixture({ notionAccounts: async () => [], notionConfigs: async () => [{ id: 'ac_fixture', label: 'Setup' }], notionLink: async () => stage === 'link' ? pending : { url: 'https://connect.composio.dev/link/ln_fixture' }, notionPoll: async () => pending, notionCancel: async () => {} })
    button(f.form(), 'Find existing connections').props.onClick(); await tick(); button(f.form(), 'Connect Notion').props.onClick(); await tick()
    all(f.form(), item => item.type === 'select')[0].props.onChange({ target: { value: 'ac_fixture' } })
    button(f.form(), 'Prepare authorization').props.onClick(); await tick()
    if (stage !== 'link') { button(f.form(), 'I have authorized').props.onClick(); await tick() }
    button(f.form(), 'Cancel').props.onClick()
    if (stage === 'link') finish({ url: 'https://connect.composio.dev/link/ln_fixture' })
    else if (stage === 'poll-success') finish({ id: 'ca_fixture' })
    else reject(new Error('Notion authorization did not complete'))
    await tick()
    const row = JSON.stringify(f.row())
    assert.ok(row.includes('Not connected · single-page read'))
    assert.ok(!row.includes('Authorization in progress') && !row.includes('Choose a page to finish connecting'))
  }
})

test('card shows authorization and page stages and clears after a failed poll', async () => {
  let fail = false
  const f = fixture({ notionAccounts: async () => [], notionConfigs: async () => [{ id: 'ac_fixture', label: 'Setup' }], notionLink: async () => ({ url: 'https://connect.composio.dev/link/ln_fixture' }), notionPoll: async () => { if (fail) throw new Error('Notion authorization did not complete'); return { id: 'ca_fixture' } }, notionCancel: async () => {} })
  button(f.form(), 'Find existing connections').props.onClick(); await tick()
  button(f.form(), 'Connect Notion').props.onClick(); await tick()
  all(f.form(), item => item.type === 'select')[0].props.onChange({ target: { value: 'ac_fixture' } })
  button(f.form(), 'Prepare authorization').props.onClick(); await tick()
  assert.ok(JSON.stringify(f.row()).includes('Authorization in progress'))
  button(f.form(), 'I have authorized').props.onClick(); await tick()
  assert.ok(JSON.stringify(f.row()).includes('Choose a page to finish connecting'))
  const g = fixture({ notionAccounts: async () => [], notionConfigs: async () => [{ id: 'ac_fixture', label: 'Setup' }], notionLink: async () => ({ url: 'https://connect.composio.dev/link/ln_fixture' }), notionPoll: async () => { throw new Error('Notion authorization did not complete') }, notionCancel: async () => {} })
  button(g.form(), 'Find existing connections').props.onClick(); await tick(); button(g.form(), 'Connect Notion').props.onClick(); await tick()
  all(g.form(), item => item.type === 'select')[0].props.onChange({ target: { value: 'ac_fixture' } })
  button(g.form(), 'Prepare authorization').props.onClick(); await tick(); button(g.form(), 'I have authorized').props.onClick(); await tick()
  assert.ok(JSON.stringify(g.row()).includes('Not connected · single-page read'))
  assert.equal(all(g.form(), item => item.type === 'a').length, 0)
})
