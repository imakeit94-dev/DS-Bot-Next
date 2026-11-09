import { createHmac, randomUUID } from 'node:crypto'
import { createOnboarding } from './composio-onboarding.js'

// Each app owns its attempt and generation; platform-key changes cancel all managers.
export function createComposioConnection({ rt, id, toolkit, connection, resource, exchange, isStopped }) {
  const onboarding = createOnboarding({ toolkit, secret: () => rt.secretValue('COMPOSIO_API_KEY'), ...(exchange ? { exchange } : {}) })
  const binding = (accountId, userId) => createHmac('sha256', rt.secretValue('COMPOSIO_API_KEY')).update(JSON.stringify([`${id}-selection-v1`, accountId, userId])).digest('hex')
  let generation = 0
  let attempt
  let writing = false
  let connecting
  let discovered = false
  let canCreate = false
  let candidates = new Map()
  let configs = new Set()
  const valid = operation => { if (operation !== generation || isStopped()) throw new Error('Connection was cancelled') }
  const cancelPending = () => {
    generation++
    onboarding.cancel()
    attempt = undefined
    discovered = false
    canCreate = false
    candidates.clear()
    configs.clear()
  }
  const close = () => { cancelPending(); connection.close() }
  const accounts = async () => {
    const operation = generation
    await rt.loadSecrets(); valid(operation)
    const items = await onboarding.accounts(); valid(operation)
    candidates = new Map(items.map(item => [item.id, {}]))
    discovered = true
    return items
  }
  const listConfigs = async body => {
    if (!discovered || (candidates.size && body.newAuthorization !== true)) throw new Error('Find existing connections first')
    const operation = generation
    const items = await onboarding.configs(); valid(operation)
    configs = new Set(items.map(item => item.id))
    canCreate = items.length === 0
    return items
  }
  const createConfig = async () => {
    if (!discovered || !canCreate) throw new Error('Find available authorization setups first')
    if (writing) throw new Error('Authorization is already in progress')
    canCreate = false; writing = true
    try {
      const operation = generation
      const config = await onboarding.createConfig(); valid(operation)
      configs.add(config)
      return config
    } finally { writing = false }
  }
  const link = async body => {
    if (writing || attempt) throw new Error('Authorization is already in progress')
    if (!configs.has(body.configId)) throw new Error('Select an authorization setup')
    writing = true
    try {
      const operation = generation
      if (!rt.state.connectors?.[id]?.workspaceUserId) {
        const previous = rt.state.connectors?.[id]
        const selection = { ...previous, workspaceUserId: randomUUID() }
        rt.state.connectors = { ...rt.state.connectors, [id]: selection }
        try { await rt.save({ required: true }) } catch {
          if (rt.state.connectors?.[id] === selection) {
            if (previous === undefined) delete rt.state.connectors[id]
            else rt.state.connectors[id] = previous
          }
          throw new Error('Could not save authorization; retry')
        }
      }
      valid(operation)
      const next = await onboarding.link(body.configId, rt.state.connectors[id].workspaceUserId); valid(operation)
      attempt = next
      return { url: next.url }
    } finally { writing = false }
  }
  const poll = async () => {
    const current = attempt
    if (!current) throw new Error('No authorization is pending')
    if (current.polling) throw new Error('Authorization is already in progress')
    current.polling = true
    const operation = generation
    try {
      const accountId = await onboarding.poll(current); valid(operation)
      if (attempt !== current) throw new Error('Connection was cancelled')
      attempt = undefined
      candidates.set(accountId, { userId: current.userId, configId: current.configId })
      return { id: accountId }
    } catch (error) {
      if (attempt === current) { attempt = undefined; generation++; onboarding.cancel() }
      throw error
    }
  }
  const connect = async body => {
    const operation = ++generation
    connecting = operation
    try {
      onboarding.cancel(); connection.close()
      await rt.loadSecrets(); valid(operation)
      if (!candidates.has(body.accountId)) throw new Error(id === 'notion' ? 'Select a Notion connection' : 'Select a connection')
      const resourceValue = resource(body)
      const expected = candidates.get(body.accountId)
      const userId = await onboarding.account(body.accountId, expected); valid(operation)
      const selection = { ...rt.state.connectors?.[id], ...resourceValue, accountId: body.accountId, identityBinding: binding(body.accountId, userId), enabled: true, ...(expected.configId ? { configId: expected.configId, usesWorkspaceUser: true } : { configId: undefined, usesWorkspaceUser: false }) }
      rt.state.connectors = { ...rt.state.connectors, [id]: selection }
      try { await rt.save({ required: true }) } catch {
        selection.enabled = false
        if (operation === generation) connection.close()
        throw new Error('Could not save connection; it is off')
      }
      if (isStopped() || operation !== generation) {
        if (rt.state.connectors?.[id] === selection) { selection.enabled = false; await rt.save({ required: true }).catch(() => {}) }
        throw new Error('Connection was cancelled')
      }
      try {
        connection.connect({ accountId: body.accountId, ...resourceValue, expectedUserId: userId, expectedConfigId: expected.configId })
      } catch {
        if (rt.state.connectors?.[id] === selection) { selection.enabled = false; await rt.save({ required: true }).catch(() => {}) }
        throw new Error('Connection unavailable')
      }
    } finally { if (connecting === operation) connecting = undefined }
  }
  const restore = async () => {
    if (connecting !== undefined) return
    const selection = rt.state.connectors?.[id]
    if (!selection?.enabled || !rt.secretValue('COMPOSIO_API_KEY')) return
    const operation = generation
    try {
      const resourceValue = resource(selection)
      const expected = selection.usesWorkspaceUser ? { userId: selection.workspaceUserId, configId: selection.configId } : {}
      if (selection.usesWorkspaceUser && (!expected.userId || !expected.configId)) return
      const userId = await onboarding.account(selection.accountId, expected); valid(operation)
      if (typeof selection.identityBinding !== 'string' || selection.identityBinding !== binding(selection.accountId, userId)) return
      connection.connect({ accountId: selection.accountId, ...resourceValue, expectedUserId: userId, expectedConfigId: expected.configId })
    } catch { if (operation === generation) connection.close() }
  }
  const disconnect = async () => {
    close()
    rt.state.connectors = { ...rt.state.connectors, [id]: { ...rt.state.connectors?.[id], enabled: false } }
    try { await rt.save({ required: true }) } catch { throw new Error('Could not save disconnect; connection is off until restart') }
  }
  return { accounts, configs: listConfigs, createConfig, link, poll, cancelPending, close, connect, restore, disconnect, isActive: () => connection.isActive() }
}
