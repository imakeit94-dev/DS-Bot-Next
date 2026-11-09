// Standalone review artifact. Never calls a business tool or connects to the product.
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { offlineSessionBody } from '../src/host/composio-offline-transport.js'
import { jsonResponse } from '../src/host/composio-session-transport.js'

const ORIGIN = 'https://backend.composio.dev'
const BASE = '/api/v3.1/tool_router/session'
const PROTOCOL = '2025-03-26'
const TOOL = 'NOTION_GET_PAGE_MARKDOWN'
const MAX_BODY = 1024 * 1024

function liveExchange(key) {
  if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw Error('credential')
  return ({ method, url, headers, body, signal }) => new Promise((resolve, reject) => {
    const target = new URL(url)
    if (target.origin !== ORIGIN || target.username || target.password || target.hash) return reject(Error('destination'))
    const req = https.request(target, { method, signal, agent: false, headers: { ...headers, 'x-api-key': key, accept: 'application/json, text/event-stream' } }, res => {
      let size = 0
      const chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) req.destroy(); else chunks.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', () => reject(Error('response')))
      res.on('aborted', () => reject(Error('response')))
    })
    req.on('error', () => reject(Error('request')))
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

export async function discover({ exchange, timeoutMs = 8000, makeId = randomUUID } = {}) {
  if (typeof exchange !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw Error('invalid fixture')
  const counts = { total: 0, create: 0, toolkit: 0, mcp: 0, sessionDelete: 0, business: 0 }
  const report = { sessionVersionVerified: false, negativePin: 'unverified', discovery: 'not-started', cleanup: 'not-created', counts }
  const started = performance.now()
  let sessionId, mcpUrl, mcpId
  let mcpUncertain = false
  let generation = 0
  const uid = `dsbn-discovery-${makeId()}`
  const pin = `dsbn-nonexistent-${makeId()}`
  const body = offlineSessionBody(uid, pin)
  async function send(kind, method, url, payload, cleaning = false) {
    const limits = { create: 2, toolkit: 1, mcp: 4, sessionDelete: 2 }
    if (counts.total >= (cleaning ? 12 : 9) || counts[kind] >= limits[kind]) throw Error('budget')
    const target = new URL(url, ORIGIN)
    if (target.origin !== ORIGIN || target.username || target.password || target.hash) throw Error('destination')
    const left = started + (cleaning ? 40000 : 30000) - performance.now()
    if (left <= 0) throw Error('deadline')
    counts.total++; counts[kind]++
    const headers = {}
    if (payload !== undefined) headers['content-type'] = 'application/json'
    if (kind === 'mcp') {
      headers['mcp-protocol-version'] = PROTOCOL
      if (mcpId) headers['mcp-session-id'] = mcpId
    }
    const controller = new AbortController()
    let timer
    let timedOut = false
    const operation = Promise.resolve().then(() => exchange({ method, url: target.href, headers, body: payload, signal: controller.signal }))
    try {
      const response = await Promise.race([
        operation,
        new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(Error('timeout')) }, Math.min(timeoutMs, left)) }),
      ])
      if (!response || !Number.isInteger(response.status) || typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_BODY) throw Error('response')
      if (response.status >= 300 && response.status < 400) throw Error('redirect')
      return response
    } catch (error) {
      if (kind === 'mcp' && !cleaning) mcpUncertain = true
      if (kind === 'create' && timedOut) {
        // A late create can reveal an ID; wait briefly within the cleanup deadline, never resume discovery.
        const remaining = Math.min(timeoutMs, started + 40000 - performance.now())
        let lateTimer
        if (remaining > 0) {
          try {
            const late = await Promise.race([operation, new Promise(resolve => { lateTimer = setTimeout(() => resolve(undefined), remaining) })])
            if (late?.status >= 200 && late.status < 300 && typeof late.body === 'string' && Buffer.byteLength(late.body) <= MAX_BODY) {
              const value = JSON.parse(late.body)
              if (typeof value?.session_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.session_id)) sessionId = value.session_id
            }
          } catch {} finally { clearTimeout(lateTimer) }
        }
      }
      throw error
    } finally { clearTimeout(timer) }
  }
  function requireSuccess(response) { if (response.status < 200 || response.status >= 300) throw Error('status'); return response }
  function acceptSession(response) {
    const value = JSON.parse(response.body)
    if (typeof value?.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.session_id)) throw Error('session')
    sessionId = value.session_id
    if (value.mcp?.type !== 'http' || typeof value.mcp.url !== 'string') throw Error('endpoint')
    const url = new URL(value.mcp.url)
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname.startsWith('//')) throw Error('endpoint')
    mcpUrl = url.href
  }
  async function close() {
    generation++
    if (!sessionId) return
    let failed = false
    if (mcpUrl && mcpId) {
      try { requireSuccess(await send('mcp', 'DELETE', mcpUrl, undefined, true)) } catch { failed = true }
    }
    try {
      const response = requireSuccess(await send('sessionDelete', 'DELETE', `${BASE}/${sessionId}`, undefined, true))
      const value = JSON.parse(response.body)
      if (value?.session_id !== sessionId || value.deleted !== true) failed = true
    } catch { failed = true }
    report.cleanup = failed || mcpUncertain ? 'uncertain' : 'deleted'
    sessionId = undefined; mcpUrl = undefined; mcpId = undefined
  }
  async function rpc(method, id, params) {
    const message = { jsonrpc: '2.0', method, ...(id === undefined ? {} : { id }), ...(params === undefined ? {} : { params }) }
    const response = requireSuccess(await send('mcp', 'POST', mcpUrl, message))
    const header = response.headers?.['mcp-session-id']
    if (header !== undefined) {
      if (typeof header !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(header)) throw Error('mcp')
      mcpId = header
    }
    return jsonResponse(response, id, id === undefined)
  }
  try {
    report.cleanup = 'uncertain'
    const negative = await send('create', 'POST', BASE, body)
    if (negative.status >= 200 && negative.status < 300) {
      report.negativePin = 'unexpected-success'
      acceptSession(negative)
      return report
    }
    if (negative.status < 400 || negative.status >= 500 || [401, 403, 429].includes(negative.status)) throw Error('negative-unclassified')
    report.cleanup = 'not-created'
    const unpinned = { ...body }
    delete unpinned.connected_accounts
    report.cleanup = 'uncertain'
    const created = requireSuccess(await send('create', 'POST', BASE, unpinned))
    acceptSession(created)
    const current = generation
    const toolkit = requireSuccess(await send('toolkit', 'GET', `${BASE}/${sessionId}/toolkits`))
    const listing = JSON.parse(toolkit.body)
    // Account objects are deliberately not inspected or returned; their wire shape is unverified.
    if (!Array.isArray(listing?.items) || listing.items.length !== 1 || listing.items[0]?.slug !== 'notion' || listing.items[0]?.connected_account !== null) throw Error('toolkit')
    const initialized = await rpc('initialize', 1, { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ds-bot-discovery', version: '1' } })
    if (current !== generation || initialized.protocolVersion !== PROTOCOL || !initialized.capabilities || typeof initialized.capabilities !== 'object') throw Error('initialize')
    await rpc('notifications/initialized')
    const tools = await rpc('tools/list', 2, {})
    if (current !== generation || tools.nextCursor != null || !Array.isArray(tools.tools) || tools.tools.length !== 1 || tools.tools[0]?.name !== TOOL) throw Error('tools')
    report.discovery = 'listed'
  } catch {
    report.discovery = 'stopped'
  } finally { await close() }
  return report
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-once') { process.exitCode = 2; return }
  try {
    const result = await discover({ exchange: liveExchange(process.env.COMPOSIO_API_KEY) })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch { process.stdout.write('{"status":"stopped"}\n'); process.exitCode = 1 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
