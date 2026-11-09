// Selected-account REST candidate. No selection or credential is persisted here.
import https from 'node:https'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { offlineNotionPageArguments, offlineNotionResponsePreview } from './composio-notion-response-preview.js'

const MAX_BYTES = 2 * 1024 * 1024
const VERSION = '20261101_00'
const own = (value, key) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key)

// One fixed-origin request; no redirects, proxy, or retry.
export function notionRestExchange({ method, accountId, body, key, signal }) {
  return new Promise((resolve, reject) => {
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) return reject(new Error('credential'))
    const path = method === 'GET' ? `/api/v3.1/connected_accounts/${accountId}` : '/api/v3.1/tools/execute/NOTION_GET_PAGE_MARKDOWN'
    const headers = { 'x-api-key': key, accept: 'application/json' }
    if (method === 'POST') headers['content-type'] = 'application/json'
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

export function notionRestConnection({ register, secret, exchange = notionRestExchange, timeoutMs = 15000 }) {
  let generation = 0
  let unregister
  let active = false
  const controllers = new Set()
  const close = () => {
    generation++
    active = false
    const dispose = unregister
    unregister = undefined
    for (const controller of controllers) controller.abort()
    controllers.clear()
    dispose?.()
  }
  const connect = ({ accountId, pageId, expectedUserId, expectedConfigId }) => {
    close()
    if (typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || accountId === 'instant_account') throw new Error('Invalid Notion selection')
    offlineNotionPageArguments(pageId)
    if (typeof secret() !== 'string' || !secret()) throw new Error('Save the Composio API key first')
    const current = generation
    const definition = defineTool({
      name: 'connected_notion_read_page',
      description: 'Read the page selected in the shared Notion connection.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args) {
        if (!active || generation !== current) throw new Error('Notion connection is off')
        if (!args || Object.keys(args).length !== 0) throw new Error('Only the selected page can be read')
        const controller = new AbortController()
        controllers.add(controller)
        const key = secret()
        const check = () => { if (!active || current !== generation || controller.signal.aborted) throw new Error('cancelled') }
        let timer
        try {
          const perform = async () => {
            if (typeof key !== 'string' || !key) throw new Error('credential')
            const accountResponse = await exchange({ method: 'GET', accountId, key, signal: controller.signal })
            check()
            if (accountResponse?.status !== 200 || typeof accountResponse.body !== 'string' || Buffer.byteLength(accountResponse.body) > MAX_BYTES) throw new Error('account')
            const account = JSON.parse(accountResponse.body)
            if (!own(account, 'id') || account.id !== accountId || !own(account, 'toolkit') || !own(account.toolkit, 'slug') || account.toolkit.slug !== 'notion' || !own(account, 'status') || account.status !== 'ACTIVE' || !own(account, 'is_disabled') || account.is_disabled !== false || !own(account, 'auth_config') || !own(account.auth_config, 'is_disabled') || account.auth_config.is_disabled !== false || !own(account, 'user_id') || typeof account.user_id !== 'string' || account.user_id.length < 1 || account.user_id.length > 256 || [...account.user_id].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || account.user_id.trim() !== account.user_id) throw new Error('account')
            if ((expectedUserId !== undefined && account.user_id !== expectedUserId) || (expectedConfigId !== undefined && account.auth_config.id !== expectedConfigId)) throw new Error('account')
            const response = await exchange({ method: 'POST', accountId, key, signal: controller.signal, body: { connected_account_id: accountId, user_id: account.user_id, version: VERSION, arguments: { ...offlineNotionPageArguments(pageId), include_transcript: false } } })
            check()
            if (response?.status !== 200 || typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_BYTES) throw new Error('response')
            const result = offlineNotionResponsePreview(JSON.parse(response.body))
            check()
            return `${result.truncated ? 'Note: this page was truncated.\n\n' : ''}${result.markdown}\n\nNote: the response may omit content.`
          }
          return await Promise.race([
            perform(),
            new Promise((_, reject) => {
              controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
              timer = setTimeout(() => controller.abort(), timeoutMs)
            }),
          ])
        } catch { throw new Error('Notion page could not be read') } finally { clearTimeout(timer); controllers.delete(controller) }
      },
    })
    try {
      unregister = register(definition)
      if (typeof unregister !== 'function') throw new Error('registration')
      active = true
    } catch { close(); throw new Error('Notion connection unavailable') }
  }
  return { connect, close, isActive: () => active }
}
