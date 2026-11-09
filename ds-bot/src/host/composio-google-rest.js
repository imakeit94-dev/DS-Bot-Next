import https from 'node:https'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { verifiedAccount } from './composio-onboarding.js'
import { gmailListArguments, gmailMessageArguments, sheetArguments } from './composio-google-arguments.js'
import { parseSyntheticMessage, parseSyntheticSheet } from './composio-google-parsers.js'

const MAX_BYTES = 2 * 1024 * 1024
const ownObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const SLUGS = { gmail: ['GMAIL_FETCH_EMAILS', 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID'], googlesheets: ['GOOGLESHEETS_BATCH_GET'] }
const VERSIONS = { gmail: '20261103_00', googlesheets: '20261101_00' }

export function googleExchange({ method, accountId, slug, body, key, signal }) {
  return new Promise((resolve, reject) => {
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) return reject(new Error('credential'))
    const path = method === 'GET' ? `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}` : `/api/v3.1/tools/execute/${slug}`
    const headers = { 'x-api-key': key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }
    const req = https.request(`https://backend.composio.dev${path}`, { method, headers, agent: false, signal }, res => {
      let size = 0; const chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { reject(new Error('size')); req.destroy() } else chunks.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', () => reject(new Error('response')))
      res.on('aborted', () => reject(new Error('response')))
    })
    req.on('error', () => reject(new Error('request')))
    req.end(body ? JSON.stringify(body) : undefined)
  })
}

// These shapes are synthetic fixtures, not verified live contracts.
export function googleEnvelope(response) {
  if (response?.status !== 200 || typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_BYTES) throw new Error('response')
  const value = JSON.parse(response.body)
  if (!ownObject(value) || value.successful !== true || value.error !== null || !ownObject(value.data)) throw new Error('response')
  return value.data
}

export function googleConnection(options) {
  return createGoogleConnection(options, false)
}

// Synthetic adapters are injected only by offline tests; production uses googleConnection.
export function syntheticGoogleConnection(options) {
  if (typeof options.exchange !== 'function' || options.exchange === googleExchange) throw new Error('Synthetic exchange required')
  return createGoogleConnection(options, true)
}

function createGoogleConnection({ toolkit, register, secret, exchange = googleExchange, timeoutMs = 15000 }, synthetic) {
  if (!SLUGS[toolkit]) throw new Error('Unsupported connector')
  let generation = 0; let active = false; let disposers = []; const controllers = new Set(); const selected = new Set()
  const close = () => {
    generation++; active = false; selected.clear()
    for (const controller of controllers) controller.abort()
    controllers.clear()
    for (const dispose of disposers) dispose()
    disposers = []
  }
  const connect = ({ accountId, expectedUserId, expectedConfigId }) => {
    close()
    if (typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || accountId === 'instant_account' || !secret()) throw new Error('Invalid connection')
    const current = generation
    const valid = () => { if (!active || current !== generation) throw new Error('Connection is off') }
    const invoke = async (slug, args) => {
      if (!synthetic) throw new Error('Google reading is unavailable until verification')
      if (!active || current !== generation || !SLUGS[toolkit].includes(slug)) throw new Error('Connection is off')
      const controller = new AbortController(); controllers.add(controller)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const check = () => { if (!active || current !== generation || controller.signal.aborted) throw new Error('cancelled') }
      try {
        return await Promise.race([(async () => {
          const key = secret()
          const answer = await exchange({ method: 'GET', accountId, key, signal: controller.signal }); check()
          if (answer?.status !== 200 || typeof answer.body !== 'string' || Buffer.byteLength(answer.body) > MAX_BYTES) throw new Error('account')
          const account = JSON.parse(answer.body)
          if (!verifiedAccount(account, accountId, { toolkit, userId: expectedUserId, configId: expectedConfigId })) throw new Error('account')
          const response = await exchange({ method: 'POST', accountId, slug, key, signal: controller.signal, body: { connected_account_id: accountId, user_id: account.user_id, version: VERSIONS[toolkit], arguments: args } }); check()
          const data = googleEnvelope(response); check()
          return data
        })(), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))])
      } catch { throw new Error('Connected app read failed or returned an unsupported response') } finally { clearTimeout(timer); controllers.delete(controller) }
    }
    const define = (name, description, parameters, execute) => defineTool({ name, description, parameters, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }, execute })
    const tools = toolkit === 'gmail' ? [
      define('connected_gmail_list', 'List one bounded page of messages from the shared Gmail connection. Results may be incomplete.', { query: { type: 'string' }, max_results: { type: 'number' }, page_token: { type: 'string' } }, async args => {
        const data = await invoke(SLUGS.gmail[0], gmailListArguments({ query: args?.query, maxResults: args?.max_results, pageToken: args?.page_token }))
        valid()
        // Unknown live result shapes fail closed until independently verified.
        if (!Array.isArray(data.messages) || data.messages.length > 50 || data.messages.some(item => !ownObject(item) || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id))) throw new Error('Unsupported Gmail response')
        const ids = data.messages.map(item => item.id)
        const token = data.nextPageToken
        if (token !== undefined && (typeof token !== 'string' || token.length > 1024)) throw new Error('Unsupported Gmail response')
        if (selected.size + ids.length > 500) selected.clear()
        for (const id of ids) selected.add(id)
        return JSON.stringify({ ids, ...(token ? { nextPageToken: token } : {}), completeness: 'unknown', schema: 'unverified' })
      }),
      define('connected_gmail_read', 'Read a message ID obtained from the current Gmail list.', { message_id: { type: 'string', required: true } }, async args => {
        if (!selected.has(args?.message_id)) throw new Error('Select a message from the current list')
        const data = await invoke(SLUGS.gmail[1], gmailMessageArguments(args.message_id))
        valid()
        const result = JSON.stringify(parseSyntheticMessage(data, args.message_id))
        if (Buffer.byteLength(result) > 256 * 1024) throw new Error('Email response exceeds display limit')
        return result
      }),
    ] : [
      define('connected_sheets_read', 'Read one explicit bounded range of a Google spreadsheet.', { link: { type: 'string', required: true }, range: { type: 'string', required: true } }, async args => {
        const request = sheetArguments(args?.link, args?.range)
        const data = await invoke(SLUGS.googlesheets[0], request)
        valid()
        return parseSyntheticSheet(data, request.ranges[0])
      }),
    ]
    try { for (const tool of tools) { const dispose = register(tool); if (typeof dispose !== 'function') throw new Error('registration'); disposers.push(dispose) } active = true } catch { close(); throw new Error('Connection unavailable') }
  }
  return { close, connect, isActive: () => active }
}
