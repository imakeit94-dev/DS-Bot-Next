// Connectors: outside services every Bot can use. GitHub is the first one. Its tools come
// from GitHub's MCP server through DSH's own MCP client, mounted on the plugin context,
// so every Bot and Session gets them as mcp__github__<tool>.
//
// The token is the GITHUB_TOKEN secret (secrets.js keeps it, redacts it, and offers it to
// the shell). It reaches GitHub only in the MCP request headers, built here in memory,
// never written to the DSH profile. A new token is shared with no Bot's shell: the tools
// do not need it there, and a Bot that reads a planted instruction in an issue could
// send it anywhere. The Secrets page can still share it. Signing in is `signIn` alone, so a browser login can
// take its place later without touching the mount.

import { syntheticNotion } from './composio-notion.js'
import { notionRestConnection } from './composio-notion-rest.js'
import { createComposioConnection } from './composio-connection.js'
import { googleConnection } from './composio-google-rest.js'
import { notionPageId } from '../shared/notion-page.js'

// Only trusted in-process test code can bind a synthetic transport to a context.
const syntheticTransports = new WeakMap()
const restExchanges = new WeakMap()
const onboardingExchanges = new WeakMap()
export function bindOnboardingForTest(ctx, exchange) {
  if (typeof exchange !== 'function' || onboardingExchanges.has(ctx)) throw new Error('Invalid test exchange')
  onboardingExchanges.set(ctx, exchange)
}
export function bindNotionRestForTest(ctx, exchange) {
  if (typeof exchange !== 'function' || restExchanges.has(ctx)) throw new Error('Invalid test exchange')
  restExchanges.set(ctx, exchange)
}
export function bindSyntheticNotionForTest(ctx, open) {
  if (typeof open !== 'function' || syntheticTransports.has(ctx)) throw new Error('Invalid synthetic transport')
  syntheticTransports.set(ctx, open)
}

export const GITHUB = 'github'
export const GITHUB_SECRET = 'GITHUB_TOKEN'
const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'
const DEFAULTS = {
  url: 'https://api.githubcopilot.com/mcp/',
  api: 'https://api.github.com',
  toolsets: 'context,repos,issues,pull_requests',
}
const CHECK_TIMEOUT_MS = 15_000
const INSECURE = 'GitHub addresses must start with https://'

// Asks GitHub who the token belongs to. Any token GitHub accepts passes.
export async function signIn(token, { api = DEFAULTS.api, fetch: request = fetch } = {}) {
  let response
  try {
    response = await request(`${api.replace(/\/$/, '')}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ds-bot', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
  } catch {
    throw new Error('Could not reach GitHub')
  }
  if (response.status === 401) throw new Error('GitHub did not accept this token')
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const user = await response.json().catch(() => ({}))
  if (typeof user?.login !== 'string') throw new Error('GitHub did not say who this token belongs to')
  return { login: user.login }
}

export function install(rt) {
  const { ctx, state } = rt
  const syntheticOpen = syntheticTransports.get(ctx)
  syntheticTransports.delete(ctx)
  const notion = syntheticNotion({
    open: syntheticOpen ?? (async () => { throw new Error('Notion connection is not verified') }),
    register: tool => ctx.tools.register(tool),
  })
  rt.notionConnection = notion
  const restExchange = restExchanges.get(ctx)
  restExchanges.delete(ctx)
  const notionRest = notionRestConnection({ register: tool => ctx.tools.register(tool), secret: () => rt.secretValue('COMPOSIO_API_KEY'), ...(restExchange ? { exchange: restExchange } : {}) })
  const onboardingExchange = onboardingExchanges.get(ctx)
  onboardingExchanges.delete(ctx)
  let knownComposioKey
  let composioLoaded = false
  let composioRevision = 0
  const options = rt.config.github === false ? null : { ...DEFAULTS, ...rt.config.github }
  const insecure = options !== null && [options.url, options.api].some(address => !/^https:\/\//i.test(String(address)))
  // `token` is what the current mount was made with, so a changed secret mounts again.
  let mount = null
  let status = { state: 'off' }
  let queue = Promise.resolve()
  let stopped = false
  let generation = 0
  let pendingEnable = false
  const common = { rt, exchange: onboardingExchange, isStopped: () => stopped }
  const managers = {
    notion: createComposioConnection({ ...common, id: 'notion', toolkit: 'notion', connection: notionRest, resource: body => ({ pageId: notionPageId(body.pageId) }) }),
    gmail: createComposioConnection({ ...common, id: 'gmail', toolkit: 'gmail', connection: googleConnection({ toolkit: 'gmail', register: tool => ctx.tools.register(tool), secret: () => rt.secretValue('COMPOSIO_API_KEY') }), resource: () => ({}) }),
    googlesheets: createComposioConnection({ ...common, id: 'googlesheets', toolkit: 'googlesheets', connection: googleConnection({ toolkit: 'googlesheets', register: tool => ctx.tools.register(tool), secret: () => rt.secretValue('COMPOSIO_API_KEY') }), resource: () => ({}) }),
  }

  const unmount = async () => {
    const fiber = mount?.fiber
    mount = null
    if (fiber !== undefined) await Promise.resolve().then(() => fiber.dispose()).catch(() => {})
  }

  // The MCP client wraps the server's answer (a 401, say) as the cause.
  const reason = (error) => {
    const text = [error, error?.cause].filter(Boolean).map(part => String(part?.message ?? part)).join(': ')
    return rt.redactSecrets(text || 'error').slice(0, 300)
  }

  async function reconcile(force) {
    const current = generation
    const token = options !== null && !stopped && !pendingEnable && state.connectors?.[GITHUB]?.enabled !== false ? rt.secretValue(GITHUB_SECRET) : undefined
    if (!force && mount !== null && mount.token === token) return
    await unmount()
    if (current !== generation || stopped) return
    if (token === undefined) {
      status = { state: 'off' }
      return
    }
    if (insecure) {
      mount = { token }
      status = { state: 'error', error: INSECURE }
      return
    }
    status = { state: 'connecting' }
    const loader = ctx.get?.('loader')
    if (typeof loader?.import !== 'function' || typeof ctx.plugin !== 'function') {
      mount = { token }
      status = { state: 'error', error: 'This DSH cannot load connectors' }
      return
    }
    try {
      const exports = await loader.import(MCP_CLIENT)
      if (current !== generation || stopped) return
      const plugin = loader.unwrapExports?.(exports) ?? exports?.default ?? exports
      const fiber = ctx.plugin(plugin, {
        transport: 'streamable-http',
        serverName: GITHUB,
        url: options.url,
        headers: { Authorization: `Bearer ${token}`, 'X-MCP-Toolsets': options.toolsets },
        failOnStartupError: true,
      })
      mount = { token, fiber }
      await fiber.await()
      if (mount?.fiber !== fiber || current !== generation || stopped) return
      status = { state: 'ready' }
    } catch (error) {
      if (current !== generation || stopped) return
      await unmount()
      if (current !== generation || stopped) return
      mount = { token }
      status = { state: 'error', error: reason(error) }
      rt.warn('ds-bot: GitHub connector failed: %s', status.error)
    }
  }

  // One change at a time; `force` connects again even when the token is the same.
  const sync = (force = false) => {
    queue = queue.then(() => reconcile(force)).catch(error => { rt.warn('ds-bot: connectors: %s', reason(error)) })
    return queue
  }

  const connectorsView = () => [
    ...(options === null ? [] : [{
      id: GITHUB,
      name: 'GitHub',
      state: status.state,
      ...(status.error !== undefined ? { error: status.error } : {}),
      account: rt.secretValue(GITHUB_SECRET) !== undefined ? state.connectors?.[GITHUB]?.login ?? null : null,
    }]),
    ...Object.entries({ notion: 'Notion', gmail: 'Gmail', googlesheets: 'Google Sheets' }).map(([id, name]) => ({ id, name, state: managers[id].isActive() ? 'ready' : 'off', ...(composioRevision ? { composioRevision } : {}), ...(rt.secretValue('COMPOSIO_API_KEY') !== undefined ? { composioConfigured: true } : {}) })),
  ]

  const known = id => {
    if (options === null || id !== GITHUB) throw new Error('No such connector')
  }

  const endpoints = {
    async 'connector-composio-key'(body) {
      await rt.loadSecrets()
      const key = typeof body.token === 'string' ? body.token.trim() : ''
      if (!key) throw new Error('Paste a Composio key first')
      const kept = rt.secretValue('COMPOSIO_API_KEY') !== undefined
      if (key !== rt.secretValue('COMPOSIO_API_KEY')) {
        for (const [id, manager] of Object.entries(managers)) { manager.close(); state.connectors = { ...state.connectors, [id]: { enabled: false } } }
        await rt.save({ required: true })
      }
      await rt.secretEndpoint('secret-set', { name: 'COMPOSIO_API_KEY', value: key, purpose: 'Composio connector', ...(kept ? {} : { scope: [] }) })
      knownComposioKey = key
      return connectorsView()
    },
    async 'connector-notion-accounts'() { return managers.notion.accounts() },
    async 'connector-notion-configs'(body) { return managers.notion.configs(body) },
    async 'connector-notion-create-config'() { return managers.notion.createConfig() },
    async 'connector-notion-link'(body) { return managers.notion.link(body) },
    async 'connector-notion-poll'() { return managers.notion.poll() },
    async 'connector-notion-cancel'() { managers.notion.cancelPending(); return connectorsView() },
    async 'connector-composio-action'(body) {
      const manager = Object.hasOwn(managers, body.id) ? managers[body.id] : undefined
      const action = { accounts: 'accounts', configs: 'configs', createConfig: 'createConfig', link: 'link', poll: 'poll', cancel: 'cancelPending' }[body.action]
      if (!manager || !action) throw new Error('No such connector action')
      return await manager[action](body)
    },
    async 'connector-connect'(body) {
      if (Object.hasOwn(managers, body.id)) {
        await managers[body.id].connect(body)
        return connectorsView()
      }
      known(body.id)
      const token = typeof body.token === 'string' ? body.token.trim() : ''
      if (token === '') throw new Error('Paste a token first')
      if (insecure) throw new Error(INSECURE)
      const current = generation
      await rt.loadSecrets()
      if (current !== generation || stopped) throw new Error('Connection was cancelled')
      const kept = rt.secretValue(GITHUB_SECRET) !== undefined
      const { login } = await signIn(token, { api: options.api })
      if (current !== generation || stopped) throw new Error('Connection was cancelled')
      const operation = ++generation
      pendingEnable = true
      state.connectors = { ...state.connectors, [GITHUB]: { ...state.connectors?.[GITHUB], enabled: false } }
      status = { state: 'off' }
      await unmount()
      if (operation !== generation || stopped) throw new Error('Connection was cancelled')
      await rt.secretEndpoint('secret-set', { name: GITHUB_SECRET, value: token, purpose: 'GitHub connector', ...(kept ? {} : { scope: [] }) })
      if (operation !== generation || stopped) throw new Error('Connection was cancelled')
      state.connectors[GITHUB] = { login, connectedAt: Date.now(), enabled: true }
      try {
        await rt.save({ required: true })
      } catch {
        if (operation === generation) state.connectors[GITHUB].enabled = false
        throw new Error('Could not save GitHub connection state; connection is off')
      }
      if (operation !== generation || stopped) throw new Error('Connection was cancelled')
      pendingEnable = false
      await sync()
      return connectorsView()
    },
    async 'connector-disconnect'(body) {
      if (Object.hasOwn(managers, body.id)) {
        await managers[body.id].disconnect()
        return connectorsView()
      }
      known(body.id)
      generation++
      state.connectors = { ...state.connectors, [GITHUB]: { ...state.connectors?.[GITHUB], enabled: false } }
      status = { state: 'off' }
      await unmount()
      try {
        await rt.save({ required: true })
      } catch {
        throw new Error('Could not save GitHub disconnect; connection is off until restart')
      }
      return connectorsView()
    },
    async 'connector-retry'(body) {
      known(body.id)
      await rt.loadSecrets()
      await sync(true)
      return connectorsView()
    },
  }

  const connectorEndpoint = (endpoint, body) => endpoints[endpoint](body ?? {})

  ctx.effect(() => {
    stopped = false
    void rt.loadSecrets().then(async () => {
      await rt.load()
      if (stopped) return
      knownComposioKey = rt.secretValue('COMPOSIO_API_KEY')
      composioLoaded = true
      await sync()
      await Promise.all(Object.values(managers).map(manager => manager.restore()))
    }).catch(() => {})
    return () => {
      stopped = true
      generation++
      for (const manager of Object.values(managers)) manager.close()
      void notion.close()
      void unmount()
    }
  }, 'ds-bot: connectors')

  Object.assign(rt, { connectorsView, connectorEndpoint, secretsChanged: () => {
    const current = rt.secretValue('COMPOSIO_API_KEY')
    if (composioLoaded && current !== knownComposioKey) {
      composioRevision++
      for (const [id, manager] of Object.entries(managers)) { manager.close(); state.connectors = { ...state.connectors, [id]: { enabled: false } } }
      void rt.save({ required: true }).catch(() => {})
    }
    knownComposioKey = current
    void sync()
  } })
}
