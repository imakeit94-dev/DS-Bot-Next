// Standalone, opt-in single-account preflight; no product integration.
import https from 'node:https'
import { pathToFileURL } from 'node:url'

const ORIGIN = 'https://backend.composio.dev'
const MAX_BYTES = 2 * 1024 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => object(value) && Object.hasOwn(value, key)
const boolField = (value, key) => own(value, key) && typeof value[key] === 'boolean' ? value[key] : null

function liveExchange(key) {
  if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw Error('credential')
  return ({ accountId, signal }) => new Promise((resolve, reject) => {
    const url = `${ORIGIN}/api/v3.1/connected_accounts/${accountId}`
    const req = https.request(url, { method: 'GET', agent: false, signal, headers: { 'x-api-key': key, accept: 'application/json' } }, res => {
      let size = 0
      const chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { reject(Error('response')); req.destroy() } else chunks.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', () => reject(Error('response')))
      res.on('aborted', () => reject(Error('response')))
    })
    req.on('error', () => reject(Error('request')))
    req.end()
  })
}

export async function inspectAccountOnce({ exchange, accountId, timeoutMs = 15000 } = {}) {
  const result = { requests: 0, httpStatus: null, idMatches: null, isNotion: null, connectionStatus: 'unknown', isDisabled: null, authConfigDisabled: null }
  try {
    if (typeof exchange !== 'function' || typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) return result
    const controller = new AbortController()
    let timer
    try {
      result.requests = 1
      const response = await Promise.race([
        Promise.resolve().then(() => exchange({ accountId, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('timeout')) }, timeoutMs) }),
      ])
      if (!response || !Number.isInteger(response.status)) return result
      if (response.status >= 100 && response.status <= 599) result.httpStatus = response.status
      if (response.status !== 200 || typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_BYTES) return result
      const value = JSON.parse(response.body)
      if (!object(value)) return result
      if (own(value, 'id') && typeof value.id === 'string') result.idMatches = value.id === accountId
      if (own(value, 'toolkit') && own(value.toolkit, 'slug') && typeof value.toolkit.slug === 'string') result.isNotion = value.toolkit.slug === 'notion'
      if (own(value, 'status') && ['ACTIVE', 'INITIALIZING', 'INITIATED'].includes(value.status)) result.connectionStatus = value.status
      result.isDisabled = boolField(value, 'is_disabled')
      if (own(value, 'auth_config')) result.authConfigDisabled = boolField(value.auth_config, 'is_disabled')
    } finally { clearTimeout(timer) }
  } catch {}
  return result
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-once') { process.exitCode = 2; return }
  try {
    const result = await inspectAccountOnce({ exchange: liveExchange(process.env.COMPOSIO_API_KEY), accountId: process.env.NOTION_ACCOUNT_ID })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.httpStatus !== 200) process.exitCode = 1
  } catch { process.exitCode = 1 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
