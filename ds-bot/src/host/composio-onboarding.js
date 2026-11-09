import https from 'node:https'

const MAX_BYTES = 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,128}$/
const own = (value, key) => value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key)
const validId = value => typeof value === 'string' && ID.test(value) && value !== 'instant_account'
const validUser = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)

export function authorizationUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/connect\.composio\.dev(?::443)?\/link\/[A-Za-z0-9_-]+$/.test(value)) throw new Error('Authorization link is not supported')
  let url
  try { url = new URL(value) } catch { throw new Error('Authorization link is not supported') }
  if (url.protocol !== 'https:' || url.hostname !== 'connect.composio.dev' || url.username || url.password || url.port || url.search || url.hash || !/^\/link\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error('Authorization link is not supported')
  return url.href
}

export function onboardingExchange({ method, path, body, key, signal }) {
  return new Promise((resolve, reject) => {
    if (!key || typeof key !== 'string' || /[\r\n]/.test(key)) return reject(new Error('credential'))
    const headers = { 'x-api-key': key, accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const req = https.request(`https://backend.composio.dev${path}`, { method, headers, agent: false, signal }, res => {
      let size = 0
      const chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { reject(new Error('size')); req.destroy() } else chunks.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', () => reject(new Error('response')))
      res.on('aborted', () => reject(new Error('response')))
    })
    req.on('error', () => reject(new Error('request')))
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

export function verifiedAccount(account, id, { configId, userId, toolkit = 'notion' } = {}) {
  return own(account, 'id') && account.id === id && own(account, 'toolkit') && own(account.toolkit, 'slug') && account.toolkit.slug === toolkit && own(account, 'status') && account.status === 'ACTIVE' && own(account, 'is_disabled') && account.is_disabled === false && own(account, 'auth_config') && own(account.auth_config, 'is_disabled') && account.auth_config.is_disabled === false && own(account, 'user_id') && validUser(account.user_id) && (configId === undefined || (own(account.auth_config, 'id') && account.auth_config.id === configId)) && (userId === undefined || account.user_id === userId)
}

export function createOnboarding({ secret, exchange = onboardingExchange, timeoutMs = 15000, toolkit = 'notion' }) {
  const names = { notion: 'Notion', gmail: 'Gmail', googlesheets: 'Google Sheets' }
  const name = names[toolkit]
  if (!name) throw new Error('Unsupported connector')
  let generation = 0
  const controllers = new Set()
  const cancel = () => { generation++; for (const controller of controllers) controller.abort(); controllers.clear() }
  async function request(method, path, body, current = generation, deadline = Infinity) {
    if (current !== generation) throw new Error('Connection was cancelled')
    const controller = new AbortController(); controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(timeoutMs, deadline - Date.now())))
    try {
      const response = await Promise.race([
        exchange({ method, path, body, key: secret(), signal: controller.signal }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
      ])
      if (current !== generation || controller.signal.aborted) throw new Error('cancelled')
      if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300 || typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_BYTES) throw new Error('response')
      return JSON.parse(response.body)
    } catch { throw new Error(`Could not complete ${name} connection`) } finally { clearTimeout(timer); controllers.delete(controller) }
  }
  async function list(path, current = generation) {
    const all = []
    const seen = new Set()
    let cursor = ''
    for (let i = 0; i < 10; i++) {
      const data = await request('GET', `${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, current)
      if (!own(data, 'items') || !Array.isArray(data.items) || data.items.length > 100) throw new Error('Could not load available connections')
      all.push(...data.items)
      if (!own(data, 'next_cursor')) throw new Error('Could not load available connections')
      if (data.next_cursor === null || data.next_cursor === '') return all
      if (typeof data.next_cursor !== 'string' || data.next_cursor.length > 512 || seen.has(data.next_cursor)) throw new Error('Could not load available connections')
      seen.add(data.next_cursor); cursor = data.next_cursor
    }
    throw new Error('Too many connections to display safely')
  }
  const account = async (id, expected) => {
    if (!validId(id)) throw new Error('Invalid connection')
    const value = await request('GET', `/api/v3.1/connected_accounts/${encodeURIComponent(id)}`)
    if (!verifiedAccount(value, id, { ...expected, toolkit })) throw new Error(`This ${name} connection is unavailable`)
    return value.user_id
  }
  const accounts = async () => {
    const listed = await list(`/api/v3.1/connected_accounts?toolkit_slugs=${toolkit}&statuses=ACTIVE&limit=100`)
    if (listed.some(item => !validId(item?.id) || typeof item?.toolkit?.slug !== 'string' || typeof item?.status !== 'string' || typeof item?.is_disabled !== 'boolean' || typeof item?.auth_config?.is_disabled !== 'boolean')) throw new Error('Could not load available connections')
    const items = listed.filter(item => item.toolkit.slug === toolkit && item.status === 'ACTIVE' && item.is_disabled === false && item.auth_config.is_disabled === false)
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Could not load available connections')
    const safeAlias = item => typeof item.alias === 'string' && /^[\p{L}\p{N} ._@-]{1,60}$/u.test(item.alias) ? item.alias : ''
    return items.map((item, index) => {
      const alias = safeAlias(item)
      const duplicate = alias && items.some((other, i) => i !== index && safeAlias(other) === alias)
      return { id: item.id, label: alias && !duplicate ? alias : `${alias || name} · ${item.id.slice(-6)} · ${index + 1}` }
    })
  }
  const configs = async () => {
    const items = await list(`/api/v3.1/auth_configs?toolkit_slug=${toolkit}&show_disabled=false&limit=100`)
    if (items.some(item => !validId(item?.id) || typeof item?.toolkit?.slug !== 'string' || typeof item?.status !== 'string') || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Could not load available connections')
    return items.filter(item => item.toolkit.slug === toolkit && item.status === 'ENABLED').map((item, index) => ({ id: item.id, label: `${name} ${index + 1} · ${item.id.slice(-6)}` }))
  }
  const createConfig = async () => {
    let data
    try { data = await request('POST', '/api/v3.1/auth_configs', { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth' } }) } catch { throw new Error('Authorization setup result is unknown; check your project before trying again') }
    if (!validId(data?.auth_config?.id)) throw new Error('Authorization setup result is unknown')
    return data.auth_config.id
  }
  const link = async (configId, userId) => {
    if (!validId(configId) || !validUser(userId)) throw new Error('Invalid authorization setup')
    const current = generation
    let data
    try { data = await request('POST', '/api/v3.1/connected_accounts/link', { auth_config_id: configId, user_id: userId }, current) } catch { throw new Error('Authorization result is unknown; check your project before trying again') }
    if (!validId(data?.connected_account_id)) throw new Error('Authorization result is unknown')
    const expires = Date.parse(data.expires_at)
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('Authorization link has expired')
    return { accountId: data.connected_account_id, url: authorizationUrl(data.redirect_url), expires, remaining: 30, current, configId, userId }
  }
  const poll = async (attempt, { intervalMs = 2000, maxAttempts = 30, timeout = 60000 } = {}) => {
    if (attempt.pollStarted) throw new Error(`${name} authorization did not complete`)
    attempt.pollStarted = true
    attempt.deadline = Math.min(attempt.expires, Date.now() + 60000)
    const deadline = Math.min(attempt.deadline, Date.now() + timeout)
    for (let i = 0; i < maxAttempts && attempt.remaining > 0 && Date.now() < deadline; i++) {
      attempt.remaining--
      const data = await request('GET', `/api/v3.1/connected_accounts/${encodeURIComponent(attempt.accountId)}`, undefined, attempt.current, deadline)
      if (Date.now() >= deadline) throw new Error(`${name} authorization timed out; check your project settings`)
      if (verifiedAccount(data, attempt.accountId, { configId: attempt.configId, userId: attempt.userId, toolkit })) return attempt.accountId
      if (data?.status === 'FAILED' && data?.status_reason === 'Callback identity verification failed') throw new Error('This project requires callback identity verification, which is not supported here')
      if (['FAILED', 'EXPIRED', 'REVOKED', 'INACTIVE'].includes(data?.status)) throw new Error(`${name} authorization did not complete`)
      const controller = new AbortController(); controllers.add(controller)
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now())))
          controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Connection was cancelled')) }, { once: true })
        })
      } finally { controllers.delete(controller) }
      if (attempt.current !== generation) throw new Error('Connection was cancelled')
    }
    throw new Error(`${name} authorization timed out; check your project settings`)
  }
  return { cancel, accounts, account, configs, createConfig, link, poll }
}
