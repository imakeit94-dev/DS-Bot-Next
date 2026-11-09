import { createElement as h, useEffect, useRef, useState } from 'react'
import { MaskedInput } from './secret-card.js'
import { t } from './i18n.js'

const button = (text, onClick, disabled = false) => h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick, disabled }, t(text))
const safeErrors = new Set([
  'Connection was cancelled', 'Could not complete Notion connection', 'Could not load available connections',
  'Too many connections to display safely', 'This Notion connection is unavailable', 'Paste a Notion page link',
  'Authorization link is not supported', 'Authorization link has expired', 'Notion authorization did not complete',
  'Notion authorization timed out; check your project settings',
  'This project requires callback identity verification, which is not supported here',
  'Authorization setup result is unknown; check your project before trying again',
  'Authorization setup result is unknown', 'Authorization result is unknown; check your project before trying again',
  'Authorization result is unknown',
])

export function ComposioCard({ configured, actions }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (!value.trim() || busy) return
    setBusy(true); setError('')
    try { await actions.composioKey(value); setValue(''); setEditing(false) } catch { setError(t('Could not save the key')) } finally { setBusy(false) }
  }
  return h('div', { className: 'bt-connector' },
    h('div', { className: 'bt-connector-head' },
      h('span', { className: 'bt-connector-text' }, h('span', { className: 'bt-connector-name' }, 'Composio'), h('span', { className: 'bt-connector-status' }, configured ? t('Configured') : t('Add a key to connect apps'))),
      !editing ? button(configured ? 'Replace key' : 'Add key', () => setEditing(true)) : null),
    editing ? h('div', { className: 'bt-connector-form' },
      configured ? h('p', null, t('Replacing the key disconnects apps using the previous project.')) : null,
      h('label', { className: 'bt-q-field bt-secret-field' }, h(MaskedInput, { value, onChange: setValue, onEnter: save, label: t('Composio API key'), autoFocus: true })),
      h('div', { className: 'bt-connector-form-row' }, button('Cancel', () => { setEditing(false); setValue(''); setError('') }, busy), button('Save', () => void save(), busy || !value.trim()))) : null,
    error ? h('div', { className: 'bt-connector-error', role: 'alert' }, error) : null)
}

function NotionForm({ actions, onDone, onPhase, id = 'notion', name = 'Notion' }) {
  const isNotion = id === 'notion'
  const [accounts, setAccounts] = useState(null)
  const [accountId, setAccountId] = useState('')
  const [page, setPage] = useState('')
  const [configs, setConfigs] = useState(null)
  const [configId, setConfigId] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const actionsRef = useRef(actions)
  const generation = useRef(0)
  actionsRef.current = actions
  useEffect(() => {
    generation.current++
    return () => { generation.current++; void actionsRef.current.notionCancel().catch(() => {}) }
  }, [])
  const run = async fn => {
    const current = generation.current
    const valid = () => current === generation.current
    setBusy(true); setError('')
    try { await fn(valid) } catch (failure) { if (valid()) setError(t(safeErrors.has(failure?.message) ? failure.message : 'Could not connect')) } finally { if (valid()) setBusy(false) }
  }
  const listAccounts = () => run(async valid => { const list = await actions.notionAccounts(); if (!valid()) return; setAccounts(list); setAccountId('') })
  const listConfigs = () => run(async valid => { const list = await actions.notionConfigs(true); if (!valid()) return; setConfigs(list); setConfigId(''); setAccountId(''); onPhase('off') })
  const createConfig = () => run(async valid => { const id = await actions.notionCreateConfig(); if (!valid()) return; setConfigs([{ id, label: isNotion ? t('New Notion setup') : t('New authorization setup') }]); setConfigId(id) })
  const link = () => run(async valid => { const result = await actions.notionLink(configId); if (!valid()) return; setUrl(result.url); onPhase('authorizing') })
  const poll = () => run(async valid => {
    try { const result = await actions.notionPoll(); if (!valid()) return; setUrl(''); setAccountId(result.id); setAccounts([{ id: result.id, label: isNotion ? t('New Notion connection') : t('New connection') }]); onPhase('page') }
    catch (error) { if (valid()) { setUrl(''); onPhase('off') } throw error }
  })
  const connect = () => run(async valid => { await actions.connectorConnect(id, '', isNotion ? { accountId, pageId: page } : { accountId }); if (valid()) onDone() })
  const cancel = () => { generation.current++; onDone() }
  return h('div', { className: 'bt-connector-form' },
    accounts === null ? button('Find existing connections', () => void listAccounts(), busy) : null,
    accounts?.length && configs === null ? h('label', null, isNotion ? t('Choose a Notion connection') : t('Choose a connection'), h('select', { value: accountId, onChange: event => { setAccountId(event.target.value); onPhase(event.target.value ? 'page' : 'off') }, disabled: busy }, h('option', { value: '' }, t('Select a connection')), ...accounts.map(item => h('option', { key: item.id, value: item.id }, item.label)))) : null,
    accounts?.length === 0 && configs === null ? h('div', null, h('p', null, isNotion ? t('No connection found. Continue to set up Notion authorization.') : t('No connection found. Continue to set up authorization.')), button(isNotion ? 'Connect Notion' : 'Set up authorization', () => void listConfigs(), busy)) : null,
    accounts?.length > 0 && configs === null ? h('div', null, h('p', null, t('Authorizing another connection may affect an existing refresh token.')), button(isNotion ? 'Authorize another Notion account' : 'Authorize another account', () => void listConfigs(), busy)) : null,
    configs !== null && !url && !accountId ? h('div', null,
      h('p', null, isNotion ? t('Authorization opens Composio and Notion. Creating a setup adds a resource to your Composio project.') : t('Authorization opens Composio and {name}. Creating a setup adds a resource to your Composio project.', { name })),
      configs.length ? h('label', null, t('Choose an authorization setup'), h('select', { value: configId, onChange: event => setConfigId(event.target.value), disabled: busy }, h('option', { value: '' }, t('Select a setup')), ...configs.map(item => h('option', { key: item.id, value: item.id }, item.label)))) : h('div', null, button('Create authorization setup', () => void createConfig(), busy), button('Check authorization setups again', () => void listConfigs(), busy)),
      configId ? button('Prepare authorization', () => void link(), busy) : null) : null,
    url ? h('div', null, h('p', null, t('Open the authorization page, then return here.')), h('p', null, t('Stopping here does not revoke authorization or remove remote resources.')), h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, isNotion ? t('Open Notion authorization') : t('Open authorization page')), button('I have authorized', () => void poll(), busy)) : null,
    accountId && isNotion ? h('label', null, t('Notion page link'), h('input', { value: page, onChange: event => setPage(event.target.value), disabled: busy, placeholder: 'https://…' })) : null,
    h('div', { className: 'bt-connector-form-row' }, button('Cancel', cancel), accountId ? button('Connect', () => void connect(), busy || (isNotion && !page.trim())) : null),
    error ? h('div', { className: 'bt-connector-error', role: 'alert' }, error) : null)
}

export function NotionRow({ connector, actions }) {
  const [form, setForm] = useState(false)
  const [phase, setPhase] = useState('off')
  const [error, setError] = useState('')
  const disconnect = async () => { setError(''); try { await actions.connectorDisconnect('notion'); setPhase('off'); setForm(false) } catch { setPhase('off'); setForm(false); setError(t('Could not disconnect')) } }
  return h('div', { className: 'bt-connector', 'data-state': connector.state },
    h('div', { className: 'bt-connector-head' },
      h('span', { className: 'bt-connector-text' }, h('span', { className: 'bt-connector-name' }, 'Notion'), h('span', { className: 'bt-connector-status' }, phase === 'authorizing' ? t('Authorization in progress') : phase === 'page' ? t('Choose a page to finish connecting') : connector.state === 'ready' ? t('Selected page · content may be incomplete') : t('Not connected · single-page read'))),
      connector.state === 'ready' ? h('span', null, !form ? button('Change connection', () => setForm(true)) : null, button('Disconnect', () => void disconnect())) : !form ? button('Connect', () => setForm(true), !connector.composioConfigured) : null),
    form ? h(NotionForm, { actions, onPhase: setPhase, onDone: () => { setPhase('off'); setForm(false) } }) : null,
    error ? h('div', { className: 'bt-connector-error', role: 'alert' }, error) : null)
}

export function GoogleRow({ connector, actions }) {
  const [form, setForm] = useState(false)
  const [phase, setPhase] = useState('off')
  const [error, setError] = useState('')
  const { id, name } = connector
  const run = (action, fields) => actions.composioAction(id, action, fields)
  const shared = { ...actions, notionAccounts: () => run('accounts'), notionConfigs: newAuthorization => run('configs', { newAuthorization }), notionCreateConfig: () => run('createConfig'), notionLink: configId => run('link', { configId }), notionPoll: () => run('poll'), notionCancel: () => run('cancel') }
  const disconnect = async () => { setError(''); try { await actions.connectorDisconnect(id); setPhase('off'); setForm(false) } catch { setError(t('Could not disconnect')) } }
  return h('div', { className: 'bt-connector', 'data-state': connector.state },
    h('div', { className: 'bt-connector-head' },
      h('span', { className: 'bt-connector-text' }, h('span', { className: 'bt-connector-name' }, name), h('span', { className: 'bt-connector-status' }, phase === 'authorizing' ? t('Authorization in progress') : connector.state === 'ready' ? t('Account connected · reading unavailable pending verification') : t('Account not connected · reading unavailable pending verification'))),
      connector.state === 'ready' ? h('span', null, !form ? button('Change connection', () => setForm(true)) : null, button('Disconnect', () => void disconnect())) : !form ? button('Connect', () => setForm(true), !connector.composioConfigured) : null),
    form ? h(NotionForm, { actions: shared, id, name, onPhase: setPhase, onDone: () => { setPhase('off'); setForm(false) } }) : null,
    error ? h('div', { className: 'bt-connector-error', role: 'alert' }, error) : null)
}
