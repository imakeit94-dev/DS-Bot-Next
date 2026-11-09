// Unwired review artifact. Real network, account confirmation and business execution remain disabled.
import https from 'node:https'
import { offlineSessionBody, OFFLINE_FIXTURE_TOOL } from './composio-offline-transport.js'

const LIVE_NETWORK_ENABLED = false
const ORIGIN = 'https://backend.composio.dev'
const BASE = '/api/v3.1/tool_router/session'
const PROTOCOL = '2025-03-26'
const MAX_BODY = 1024 * 1024

// This gate is deliberately in source, not environment or persisted configuration.
export function liveExchange(key) {
  if (!LIVE_NETWORK_ENABLED) throw new Error('Live Composio network disabled')
  if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw new Error('Invalid credential')
  return ({ method, url, headers = {}, body, signal }) => new Promise((resolve, reject) => {
    let target
    try { target = new URL(url) } catch { reject(new Error('Request rejected')); return }
    if (target.origin !== ORIGIN || target.username || target.password || target.hash) { reject(new Error('Request rejected')); return }
    const request = https.request(target, {
      method, signal, agent: false,
      headers: { ...headers, 'x-api-key': key, accept: 'application/json, text/event-stream' },
    }, response => {
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_BODY) request.destroy()
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', () => reject(new Error('Request failed')))
      response.on('aborted', () => reject(new Error('Request failed')))
    })
    request.on('error', () => reject(new Error('Request failed')))
    if (body !== undefined) request.write(JSON.stringify(body))
    request.end()
  })
}

export function jsonResponse(response, id, notification = false) {
  const type = String(response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (notification && !response.body) return undefined
  let value
  if (type === 'text/event-stream') {
    const frames = response.body.split(/\r?\n\r?\n/)
    if (frames.at(-1) !== '') throw new Error('Incomplete stream')
    const matches = []
    for (const frame of frames.slice(0, -1)) {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
      if (!data) continue
      const message = JSON.parse(data)
      if (message?.jsonrpc !== '2.0') throw new Error('Invalid RPC')
      if (message.method && !Object.hasOwn(message, 'id')) continue
      matches.push(message)
    }
    if (matches.length !== 1) throw new Error('Invalid RPC')
    value = matches[0]
  } else {
    if (type !== 'application/json') throw new Error('Invalid response type')
    value = JSON.parse(response.body)
  }
  if (notification || value?.jsonrpc !== '2.0' || value.id !== id || value.error || !value.result || typeof value.result !== 'object' || Array.isArray(value.result)) throw new Error('Invalid RPC')
  return value.result
}

// Fixture exchange is injected in-process by tests; this module is not attached to the product.
export function createOfflineSessionTransport({ exchange, userId, accountId, timeoutMs = 1000, budget = 8 } = {}) {
  if (typeof exchange !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(budget) || budget < 4) throw new Error('Invalid fixture')
  const config = offlineSessionBody(userId, accountId)
  let count = 0
  let generation = 0
  let sessionId
  let mcpUrl
  let mcpSession
  let rpcId = 0
  let connecting = false
  let closing
  let cleanup = 'not-created'
  let mcpInFlight = 0
  let mcpUncertain = false
  const started = performance.now()

  async function request(method, url, body, isMcp = false, cleanupRequest = false) {
    if (count >= (cleanupRequest ? budget : budget - 2)) throw new Error('Budget exhausted')
    count++
    const target = new URL(url, ORIGIN)
    if (target.origin !== ORIGIN || target.username || target.password || target.hash) throw new Error('Destination rejected')
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (isMcp) {
      headers['mcp-protocol-version'] = PROTOCOL
      if (mcpSession) headers['mcp-session-id'] = mcpSession
    }
    const left = started + (cleanupRequest ? 40000 : 30000) - performance.now()
    if (left <= 0) throw new Error('Deadline exhausted')
    const controller = new AbortController()
    let timer
    if (isMcp && !cleanupRequest) mcpInFlight++
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => exchange({ method, url: target.href, headers, body, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')) }, Math.min(timeoutMs, left)) }),
      ])
      if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status >= 300 || typeof result.body !== 'string' || Buffer.byteLength(result.body) > MAX_BODY) throw new Error('Response rejected')
      if (isMcp && result.headers?.['mcp-session-id'] !== undefined) {
        const header = result.headers['mcp-session-id']
        if (typeof header !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(header)) throw new Error('Invalid MCP session')
        mcpSession = header
      }
      return result
    } catch (error) {
      if (isMcp && !cleanupRequest) mcpUncertain = true
      throw error
    } finally {
      if (isMcp && !cleanupRequest) mcpInFlight--
      clearTimeout(timer)
    }
  }

  async function rpc(method, params, notification = false) {
    const message = { jsonrpc: '2.0', method }
    if (!notification) message.id = ++rpcId
    if (params !== undefined) message.params = params
    return jsonResponse(await request('POST', mcpUrl, message, true), message.id, notification)
  }

  async function close() {
    generation++
    if (closing) return closing
    if (mcpInFlight) mcpUncertain = true
    const id = sessionId
    const url = mcpUrl
    const mcpId = mcpSession
    sessionId = undefined
    mcpUrl = undefined
    closing = (async () => {
      if (!id) return
      let failed = false
      if (url && mcpId) {
        try { await request('DELETE', url, undefined, true, true) } catch { failed = true }
      }
      try {
        const response = await request('DELETE', `${BASE}/${id}`, undefined, false, true)
        const result = JSON.parse(response.body)
        if (result?.session_id !== id || result.deleted !== true) failed = true
      } catch { failed = true }
      cleanup = failed || mcpUncertain ? 'uncertain' : 'deleted'
      mcpSession = undefined
    })()
    try { await closing } finally { closing = undefined }
  }

  async function inspectFixture() {
    if (connecting || closing || sessionId || cleanup === 'uncertain') throw new Error('Fixture unavailable')
    connecting = true
    const current = ++generation
    let creationStarted = false
    let known = false
    const check = () => { if (current !== generation) throw new Error('Cancelled') }
    try {
      creationStarted = true
      cleanup = 'uncertain'
      const response = await request('POST', BASE, config)
      const result = JSON.parse(response.body)
      if (typeof result?.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.session_id)) throw new Error('Invalid session')
      sessionId = result.session_id
      known = true
      cleanup = 'uncertain'
      check()
      if (result.mcp?.type !== 'http' || typeof result.mcp.url !== 'string') throw new Error('Invalid MCP endpoint')
      const url = new URL(result.mcp.url)
      if (url.origin !== ORIGIN || url.username || url.password || url.hash || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) throw new Error('Invalid MCP endpoint')
      mcpUrl = url.href
      const initialized = await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ds-bot-offline-fixture', version: '1' } })
      check()
      if (initialized.protocolVersion !== PROTOCOL || !initialized.capabilities || typeof initialized.capabilities !== 'object') throw new Error('Invalid protocol')
      await rpc('notifications/initialized', undefined, true)
      check()
      const listing = await rpc('tools/list', {})
      check()
      if (listing.nextCursor != null || !Array.isArray(listing.tools) || listing.tools.length !== 1 || listing.tools[0]?.name !== OFFLINE_FIXTURE_TOOL) throw new Error('Invalid tool list')
      // No schema or account fallback contract is verified; do not make a tools/call.
      throw new Error('Schema and account verification unavailable')
    } catch {
      if (creationStarted && !known) cleanup = 'uncertain'
      await close()
      throw new Error(cleanup === 'uncertain' ? 'Fixture stopped; cleanup uncertain' : 'Fixture stopped; verification unavailable')
    } finally { connecting = false }
  }
  return { inspectFixture, close, status: () => ({ count, cleanup }) }
}
