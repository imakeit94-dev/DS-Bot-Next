// Offline protocol fixture only: there is deliberately no network implementation or production binding.
const ORIGIN = 'https://fixture.invalid'
const TOOL = 'NOTION_GET_PAGE_MARKDOWN'
const SCHEMA = { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'], additionalProperties: false }
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function offlineSessionBody(userId, accountId) {
  if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId) || typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) throw new Error('Offline identity rejected')
  return {
    user_id: userId,
    toolkits: { enable: ['notion'] },
    connected_accounts: { notion: [accountId] },
    tools: { notion: { enable: [TOOL] } },
    instant: false,
    manage_connections: { enable: false },
    workbench: { enable: false },
    proxy_execute: { enable: false },
    multi_account: { enable: false },
    preload: { tools: 'all' },
    search: { enable: false },
    execute: { enable_multi_execute: false },
  }
}

export function offlinePageArguments(pageId) {
  if (typeof pageId !== 'string' || !UUID.test(pageId)) throw new Error('Offline page rejected')
  return { page_id: pageId }
}

export function offlineNotionTransport({ exchange, timeoutMs = 1000, maxBytes = 65536, budget = 8 } = {}) {
  if (typeof exchange !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(budget) || budget < 4) throw new Error('Invalid offline fixture')
  let remaining = budget
  let generation = 0
  let session
  let opened = false
  let connecting = false
  let cleanupFailed = false
  let closing

  async function request(path, body, cleanup = false) {
    if (remaining <= (cleanup ? 0 : 2)) throw new Error('Offline budget exhausted')
    remaining--
    const url = new URL(path, ORIGIN)
    if (url.origin !== ORIGIN || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Offline origin rejected')
    const controller = new AbortController()
    let timer
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => exchange({ url: url.href, body, signal: controller.signal, redirect: 'error' })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, timeoutMs) }),
      ])
      if (!result || result.url !== url.href || result.status !== 200 || typeof result.body !== 'string' || Buffer.byteLength(result.body) > maxBytes) throw new Error('response rejected')
      return JSON.parse(result.body)
    } catch {
      throw new Error('Offline request failed')
    } finally { clearTimeout(timer) }
  }

  async function close() {
    generation++
    opened = false
    if (closing) return closing
    const id = session
    session = undefined
    closing = (async () => {
      if (!id) return
      try { if (!same(await request('/mcp/close', { session: id }, true), { ok: true })) cleanupFailed = true } catch { cleanupFailed = true }
      try { if (!same(await request('/session/delete', { session: id }, true), { ok: true })) cleanupFailed = true } catch { cleanupFailed = true }
    })()
    try { await closing } finally { closing = undefined }
  }

  async function connect({ account, pageId, fakeAccountProof } = {}) {
    if (session || opened || connecting || closing || cleanupFailed) throw new Error('Offline fixture already in use')
    if (typeof account !== 'string' || !account || !UUID.test(pageId || '') || fakeAccountProof !== 'fixture-only-no-fallback') throw new Error('Offline selection rejected')
    connecting = true
    let createStarted = false
    let createKnown = false
    const current = ++generation
    const check = () => { if (current !== generation) throw new Error('cancelled') }
    try {
      // This fixture uses invented request and response shapes, not Composio's API contract.
      createStarted = true
      const created = await request('/session/create', { account, tools: [TOOL], instant: false })
      if (typeof created?.session !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(created.session)) throw new Error('invalid session')
      createKnown = true
      session = created.session
      check()
      const initialized = await request('/mcp/initialize', { session })
      check()
      if (!same(initialized, { protocol: 'fixture-v1' })) throw new Error('unsupported protocol')
      const ack = await request('/mcp/initialized', { session })
      check()
      if (!same(ack, { ok: true })) throw new Error('invalid acknowledgement')
      const listing = await request('/mcp/tools/list', { session })
      check()
      if (!same(listing, { tools: [{ name: TOOL, inputSchema: SCHEMA, outputSchema: { type: 'fixture-unknown' } }] })) throw new Error('unknown schema or pagination')
      opened = true
      return { pageId }
    } catch {
      if (createStarted && !createKnown) cleanupFailed = true
      await close()
      throw new Error(cleanupFailed ? 'Offline connection failed; cleanup unconfirmed' : 'Offline connection failed')
    } finally { connecting = false }
  }

  // Real tool execution is intentionally unavailable until metadata and account binding are verified.
  async function read() { throw new Error('Notion execution disabled: real contract unverified') }
  return { connect, close, read, status: () => ({ opened, remaining, cleanupFailed }) }
}

export { SCHEMA as OFFLINE_FIXTURE_SCHEMA, TOOL as OFFLINE_FIXTURE_TOOL }
