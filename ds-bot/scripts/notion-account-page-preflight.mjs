// Standalone opt-in experiment: one selected account GET followed by at most one page POST.
import https from 'node:https'
import { pathToFileURL } from 'node:url'
import { inspectAccountOnce } from './notion-account-status-preflight.mjs'
import { previewOnce } from './notion-rest-page-preflight.mjs'
import { offlineNotionPageArguments } from '../src/host/composio-notion-response-preview.js'

const ORIGIN = 'https://backend.composio.dev'
const MAX_BYTES = 2 * 1024 * 1024

function liveExchange(key) {
  if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw Error('credential')
  return ({ method, accountId, body, signal }) => new Promise((resolve, reject) => {
    const path = method === 'GET' ? `/api/v3.1/connected_accounts/${accountId}` : '/api/v3.1/tools/execute/NOTION_GET_PAGE_MARKDOWN'
    const headers = { 'x-api-key': key, accept: 'application/json' }
    if (method === 'POST') headers['content-type'] = 'application/json'
    const req = https.request(`${ORIGIN}${path}`, { method, headers, agent: false, signal }, res => {
      let size = 0
      const chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { reject(Error('response')); req.destroy() } else chunks.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', () => reject(Error('response')))
      res.on('aborted', () => reject(Error('response')))
    })
    req.on('error', () => reject(Error('request')))
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

export async function accountPageOnce({ exchange, accountId, pageId, marker, timeoutMs = 15000 } = {}) {
  const output = { account: null, userIdAvailable: false, page: null, requests: 0 }
  try {
    if (typeof exchange !== 'function' || typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || accountId === 'instant_account') return output
    offlineNotionPageArguments(pageId)
    if (marker !== undefined && (typeof marker !== 'string' || !marker || Buffer.byteLength(marker) > 128)) return output
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) return output
    let userId
    const account = await inspectAccountOnce({ accountId, timeoutMs, exchange: async ({ signal }) => {
      const response = await exchange({ method: 'GET', accountId, signal })
      if (response?.status === 200 && typeof response.body === 'string' && Buffer.byteLength(response.body) <= MAX_BYTES) {
        try {
          const value = JSON.parse(response.body)
          if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'user_id') && typeof value.user_id === 'string' && value.user_id.length >= 1 && value.user_id.length <= 256 && !/[\x00-\x1f\x7f]/.test(value.user_id) && value.user_id.trim() === value.user_id && value.user_id.trim()) userId = value.user_id
        } catch {}
      }
      return response
    } })
    output.account = account
    output.requests = account.requests
    output.userIdAvailable = typeof userId === 'string'
    if (account.httpStatus !== 200 || account.idMatches !== true || account.isNotion !== true || account.connectionStatus !== 'ACTIVE' || account.isDisabled !== false || account.authConfigDisabled !== false || !userId) return output
    const page = await previewOnce({ accountId, pageId, marker, timeoutMs, exchange: ({ body, signal }) => exchange({ method: 'POST', body: { ...body, user_id: userId }, signal }) })
    output.page = page
    output.requests += page.requests
  } catch {}
  return output
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-once') { process.exitCode = 2; return }
  try {
    const output = await accountPageOnce({ exchange: liveExchange(process.env.COMPOSIO_API_KEY), accountId: process.env.NOTION_ACCOUNT_ID, pageId: process.env.NOTION_PAGE_ID, marker: process.env.NOTION_TEST_MARKER })
    process.stdout.write(`${JSON.stringify(output)}\n`)
    if (output.page?.status !== 'preview') process.exitCode = 1
  } catch { process.exitCode = 1 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
