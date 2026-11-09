// Standalone review artifact; not connected to the product.
import https from 'node:https'
import { pathToFileURL } from 'node:url'
import { offlineNotionPageArguments, offlineNotionResponsePreview } from '../src/host/composio-notion-response-preview.js'

const ENDPOINT = 'https://backend.composio.dev/api/v3.1/tools/execute/NOTION_GET_PAGE_MARKDOWN'
const MAX_BYTES = 2 * 1024 * 1024
const VERSION = '20261101_00'
const TOO_LARGE = Symbol('response-too-large')
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function errorHint(error) {
  if (!isObject(error)) return 'unknown'
  const messages = ['message', 'suggested_fix'].filter(key => Object.hasOwn(error, key) && typeof error[key] === 'string' && error[key].length <= 1024).map(key => error[key])
  const rules = [
    ['missing-user-id', /\b(?:missing|required)\s+(?:field\s+)?user[_ -]id\b|\buser[_ -]id\s+(?:is\s+)?(?:required|missing)\b/i],
    ['invalid-version', /\b(?:invalid|unsupported|unknown)\s+(?:tool\s+)?version\b|\bversion\s+(?:is\s+)?(?:invalid|unsupported|unknown)\b/i],
    ['invalid-argument', /\b(?:invalid|missing|required)\s+(?:tool\s+)?arguments?\b|\barguments?\s+(?:is\s+|are\s+)?(?:invalid|missing|required)\b/i],
  ]
  const matched = rules.filter(([, pattern]) => messages.some(message => pattern.test(message))).map(([name]) => name)
  return matched.length === 1 ? matched[0] : matched.length > 1 ? 'multiple' : 'unknown'
}

function liveExchange(key) {
  if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw Error('invalid credential')
  return ({ body, signal }) => new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, { method: 'POST', agent: false, signal, headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' } }, res => {
      let size = 0
      const chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { reject(TOO_LARGE); req.destroy() } else chunks.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', () => reject(Error('response')))
      res.on('aborted', () => reject(Error('response')))
    })
    req.on('error', () => reject(Error('request')))
    req.end(JSON.stringify(body))
  })
}

export async function previewOnce({ exchange, accountId, pageId, marker, timeoutMs = 15000 } = {}) {
  const report = { status: 'stopped', diagnostic: 'invalid-input', httpStatus: null, serviceCode: null, serviceHint: 'unavailable', schemaVerified: false, requests: 0, truncated: null, markdownBytes: null, markerMatched: null }
  try {
    if (typeof exchange !== 'function' || typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId) || accountId === 'instant_account') throw Error('selection')
    const args = offlineNotionPageArguments(pageId)
    if (marker !== undefined && (typeof marker !== 'string' || !marker || Buffer.byteLength(marker) > 128)) throw Error('marker')
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw Error('timeout')
    const body = { connected_account_id: accountId, version: VERSION, arguments: { ...args, include_transcript: false } }
    const controller = new AbortController()
    let timer
    try {
      report.requests++
      report.diagnostic = 'transport'
      const response = await Promise.race([
        Promise.resolve().then(() => exchange({ body, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { report.diagnostic = 'timeout'; controller.abort(); reject(Error('timeout')) }, timeoutMs) }),
      ])
      if (!response || !Number.isInteger(response.status)) throw Error('response')
      if (response.status >= 100 && response.status <= 599) report.httpStatus = response.status
      if (response.status < 200 || response.status >= 300) {
        report.diagnostic = response.status >= 100 && response.status < 600 ? `http-${Math.floor(response.status / 100)}xx` : 'http-other'
        if (response.status >= 400 && response.status < 600 && typeof response.body === 'string' && Buffer.byteLength(response.body) <= MAX_BYTES) {
          report.serviceHint = 'unknown'
          try {
            const error = JSON.parse(response.body)?.error
            const code = isObject(error) && Object.hasOwn(error, 'code') ? error.code : undefined
            if (Number.isSafeInteger(code) && code >= 0 && code <= 999999999) report.serviceCode = code
            report.serviceHint = errorHint(error)
          } catch {}
        }
        throw Error('status')
      }
      report.diagnostic = 'response-type'
      if (typeof response.body !== 'string') throw Error('body')
      report.diagnostic = 'response-too-large'
      if (Buffer.byteLength(response.body) > MAX_BYTES) throw Error('size')
      report.diagnostic = 'json-invalid'
      const parsed = JSON.parse(response.body)
      report.diagnostic = 'envelope-type'
      if (!isObject(parsed)) throw Error('envelope')
      report.diagnostic = 'successful-missing'
      if (!Object.hasOwn(parsed, 'successful')) throw Error('successful')
      report.diagnostic = 'successful-not-true'
      if (parsed.successful !== true) throw Error('successful')
      if (Object.hasOwn(parsed, 'error')) {
        report.diagnostic = parsed.error === null ? 'error-null' : typeof parsed.error === 'string' ? 'error-string' : 'error-type'
        if (parsed.error !== '' && parsed.error !== null) throw Error('error')
      }
      report.diagnostic = 'data-missing'
      if (!Object.hasOwn(parsed, 'data')) throw Error('data')
      report.diagnostic = 'data-type'
      if (!isObject(parsed.data)) throw Error('data')
      report.diagnostic = 'markdown-missing'
      if (!Object.hasOwn(parsed.data, 'markdown')) throw Error('markdown')
      report.diagnostic = 'markdown-type'
      if (typeof parsed.data.markdown !== 'string') throw Error('markdown')
      report.diagnostic = 'markdown-too-large'
      if (Buffer.byteLength(parsed.data.markdown, 'utf8') > 1024 * 1024) throw Error('markdown')
      report.diagnostic = 'truncated-missing'
      if (!Object.hasOwn(parsed.data, 'truncated')) throw Error('truncated')
      report.diagnostic = 'truncated-type'
      if (typeof parsed.data.truncated !== 'boolean') throw Error('truncated')
      report.diagnostic = 'preview-rejected'
      const preview = offlineNotionResponsePreview(parsed)
      report.truncated = preview.truncated
      report.markdownBytes = Buffer.byteLength(preview.markdown, 'utf8')
      if (marker !== undefined) report.markerMatched = preview.markdown.includes(marker)
      report.status = 'preview'
      report.diagnostic = 'ok'
    } catch (error) {
      if (error === TOO_LARGE) report.diagnostic = 'response-too-large'
    } finally { clearTimeout(timer) }
  } catch {}
  return report
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-once') { process.exitCode = 2; return }
  try {
    const result = await previewOnce({ exchange: liveExchange(process.env.COMPOSIO_API_KEY), accountId: process.env.NOTION_ACCOUNT_ID, pageId: process.env.NOTION_PAGE_ID, marker: process.env.NOTION_TEST_MARKER })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.status !== 'preview') process.exitCode = 1
  } catch { process.stdout.write('{"status":"stopped","diagnostic":"invalid-credential"}\n'); process.exitCode = 1 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
