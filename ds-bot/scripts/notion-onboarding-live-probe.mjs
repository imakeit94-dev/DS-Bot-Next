// Opt-in isolated product-manager probe. Never run against a formal profile.
import https from 'node:https'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { install } from '../src/host/connectors.js'
import { authorizationUrl } from '../src/host/composio-onboarding.js'
import { offlineNotionResponsePreview } from '../src/host/composio-notion-response-preview.js'

const LIMITS = Object.freeze({ accounts: 10, configs: 10, create: 1, link: 1, poll: 30, bind: 1, read: 2 })
const totalLimit = Object.values(LIMITS).reduce((a, b) => a + b, 0)

// The wrapper counts actual HTTPS attempts before calling Node's original transport.
export function guardHttps(request, state) {
  return function (address, options, callback) {
    const url = typeof address === 'string' ? new URL(address) : address
    const phase = state.phase
    const method = options?.method
    const path = url?.pathname
    let valid = url?.protocol === 'https:' && url.hostname === 'backend.composio.dev' && !url.port && !url.username && !url.password && options?.agent === false
    if (phase === 'accounts') valid &&= method === 'GET' && path === '/api/v3.1/connected_accounts'
    else if (phase === 'configs') valid &&= method === 'GET' && path === '/api/v3.1/auth_configs'
    else if (phase === 'create') valid &&= method === 'POST' && path === '/api/v3.1/auth_configs' && !url.search
    else if (phase === 'link') valid &&= method === 'POST' && path === '/api/v3.1/connected_accounts/link' && !url.search
    else if (phase === 'poll' || phase === 'bind') valid &&= method === 'GET' && /^\/api\/v3\.1\/connected_accounts\/[A-Za-z0-9_-]+$/.test(path) && !url.search
    else if (phase === 'read') valid &&= (method === 'GET' && /^\/api\/v3\.1\/connected_accounts\/[A-Za-z0-9_-]+$/.test(path) || method === 'POST' && path === '/api/v3.1/tools/execute/NOTION_GET_PAGE_MARKDOWN') && !url.search
    else valid = false
    if (phase === 'poll' && valid) {
      if (state.pollPath && state.pollPath !== path) valid = false
      else state.pollPath = path
    }
    if ((phase === 'bind' || (phase === 'read' && method === 'GET')) && valid) valid = path === `/api/v3.1/connected_accounts/${state.accountId}`
    if (phase === 'closed') state.deniedAfterClose++
    if (!valid || Date.now() >= state.deadline || state.counts[phase] >= LIMITS[phase] || state.total >= totalLimit) throw new Error('probe guard')
    // Product registration orders the read's account check before its single POST.
    if (phase === 'read' && (state.counts.read === 0 ? method !== 'GET' : method !== 'POST')) throw new Error('probe order')
    state.counts[phase]++; state.total++
    const responseCallback = phase === 'read' && method === 'POST' && state.capture ? res => {
      const chunks = []; let size = 0
      res.on('data', chunk => { size += chunk.length; if (size <= 2 * 1024 * 1024) chunks.push(chunk) })
      res.on('end', () => {
        if (size > 2 * 1024 * 1024 || res.statusCode !== 200) return
        try { state.capture(offlineNotionResponsePreview(JSON.parse(Buffer.concat(chunks).toString('utf8')))) } catch {}
      })
      callback(res)
    } : callback
    return request.call(this, address, options, responseCallback)
  }
}

// One-use loopback handoff: the sensitive Composio URL is never printed or passed to a child process.
export async function browserHandoff(url, { launch = local => spawn('/usr/bin/open', [local], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } }), timeoutMs = 60000, signal } = {}) {
  url = authorizationUrl(url)
  if (signal?.aborted) throw new Error('browser handoff')
  const nonce = randomBytes(24).toString('hex')
  const server = http.createServer()
  const sockets = new Set()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  let timer
  return await new Promise((resolve, reject) => {
    let done = false, port
    const onAbort = () => finish(true)
    const finish = (error, activeSocket) => {
      if (done) return
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); server.close()
      for (const socket of sockets) if (socket !== activeSocket) socket.destroy()
      if (error) reject(new Error('browser handoff')); else resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    server.on('request', (req, res) => {
      if (done || req.method !== 'GET' || req.url !== `/${nonce}` || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return }
      finish(false, req.socket)
      res.on('finish', () => req.socket.end())
      res.writeHead(303, { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }); res.end()
    })
    server.on('error', () => finish(true))
    timer = setTimeout(() => finish(true), timeoutMs)
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      try { const child = launch(`http://127.0.0.1:${port}/${nonce}`); child?.on?.('error', () => finish(true)) } catch { finish(true) }
    })
  })
}

function displayLabel(item, index, key) {
  const label = typeof item.label === 'string' ? item.label : ''
  // Product fallback labels contain an account-id suffix; don't print it.
  if (!label || label.includes(item.id) || label.includes(key) || /\b(?:ca|ac|ln)_[A-Za-z0-9_-]+\b/i.test(label) || / · [A-Za-z0-9_-]{1,6} · \d+$/.test(label)) return `Notion ${index + 1}（无法凭名称区分）`
  return /^[\p{L}\p{N} ._@-]{1,60}$/u.test(label) ? label : `Notion ${index + 1}`
}
function selected(answer, values) {
  if (!/^[1-9][0-9]*$/.test(answer)) throw new Error('selection')
  const index = Number(answer) - 1
  if (!Number.isSafeInteger(index) || index >= values.length) throw new Error('selection')
  return values[index]
}

export async function runProbe({ key, page, ask, output, handoff = browserHandoff, request = https.request, timeoutMs = 300000 } = {}) {
  const counts = Object.fromEntries(Object.keys(LIMITS).map(name => [name, 0]))
  const state = { phase: '', counts, total: 0, deniedAfterClose: 0, deadline: Date.now() + timeoutMs }
  const report = { status: 'stopped', counts, total: 0, read: false, truncated: null, markdownBytes: null, closed: false, staleDenied: false, closeExtraRequests: null }
  let host, cleanup, registered, selectedTool, timer, metadata
  state.capture = preview => { if (!abort.signal.aborted && Date.now() < state.deadline) metadata = preview }
  const original = https.request
  const abort = new AbortController()
  const ctx = { tools: { register: tool => { if (registered) throw new Error('registration'); const dispose = host.tools.register(tool); registered = tool; return () => { registered = undefined; dispose() } } }, effect: fn => { cleanup = fn() } }
  const rt = { ctx, state: {}, config: { github: false }, loadSecrets: async () => {}, load: async () => {}, save: async () => {}, secretValue: name => name === 'COMPOSIO_API_KEY' ? key : undefined, warn() {}, redactSecrets: () => '' }
  const question = async text => {
    if (abort.signal.aborted) throw new Error('deadline')
    return (await Promise.race([ask(text, abort.signal), new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }))])).trim()
  }
  try {
    if (typeof key !== 'string' || !key || typeof page !== 'string' || !page || typeof ask !== 'function' || typeof output !== 'function') throw new Error('input')
    https.request = guardHttps(request, state)
    timer = setTimeout(() => { abort.abort(); void rt.connectorEndpoint?.('connector-notion-cancel').catch(() => {}); void rt.connectorEndpoint?.('connector-disconnect', { id: 'notion' }).catch(() => {}) }, timeoutMs)
    host = new Context()
    await host.plugin(SystemPrompt, {})
    await host.plugin(ToolRuntime, { mode: 'native' })
    install(rt)
    if (registered || rt.connectorsView().find(item => item.id === 'notion')?.state !== 'off') throw new Error('default')
    state.phase = 'accounts'
    const accounts = await rt.connectorEndpoint('connector-notion-accounts')
    output(`发现 ${accounts.length} 个可选连接。`)
    accounts.forEach((item, index) => output(`${index + 1}. ${displayLabel(item, index, key)}`))
    const mode = await question(accounts.length ? '输入连接序号；输入 N 明确创建新的授权；输入 Q 结束：' : '没有现有连接；输入 N 准备新授权，或 Q 结束：')
    let accountId
    if (mode === 'N') {
      state.phase = 'configs'
      const configs = await rt.connectorEndpoint('connector-notion-configs', { newAuthorization: true })
      if (configs.length > 1) { output('存在多个授权配置，无法安全区分；请停止并核对项目设置。'); throw new Error('ambiguous') }
      if (configs.length === 1) output('发现一个 Notion 授权配置。')
      const choice = await question(configs.length ? '输入确认过的配置序号，或 Q 结束：' : '没有可用配置。输入 C 明确创建一项托管配置，或 Q 结束：')
      let configId
      if (choice === 'Q') throw new Error('cancel')
      if (configs.length) configId = selected(choice, configs).id
      else if (choice === 'C') { state.phase = 'create'; configId = await rt.connectorEndpoint('connector-notion-create-config') }
      else throw new Error('selection')
      if (await question('创建连接可能影响已有授权，且资源可能保留。输入 LINK 继续，或 Q 结束：') !== 'LINK') throw new Error('cancel')
      state.phase = 'link'
      const result = await rt.connectorEndpoint('connector-notion-link', { configId })
      output('即将打开本机一次性入口；浏览器后续跳转未由本工具验证。')
      await Promise.race([handoff(result.url, { signal: abort.signal }), new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }))])
      if (await question('完成浏览器操作后输入 DONE 开始等待，或 Q 停止：') !== 'DONE') throw new Error('cancel')
      state.phase = 'poll'
      accountId = (await rt.connectorEndpoint('connector-notion-poll')).id
    } else {
      if (mode === 'Q') throw new Error('cancel')
      const chosen = selected(mode, accounts)
      if (accounts.length > 1 && displayLabel(chosen, accounts.indexOf(chosen), key).includes('无法凭名称区分')) { output('该连接无法安全区分；请停止并核对项目设置。'); throw new Error('ambiguous') }
      accountId = chosen.id
    }
    if (state.pollPath && state.pollPath !== `/api/v3.1/connected_accounts/${accountId}`) throw new Error('poll account')
    state.accountId = accountId
    state.phase = 'bind'
    await rt.connectorEndpoint('connector-connect', { id: 'notion', accountId, pageId: page })
    selectedTool = host.tools.get('connected_notion_read_page')
    if (!selectedTool || !registered) throw new Error('registration')
    state.phase = 'read'
    const result = await selectedTool.execute({})
    if (abort.signal.aborted || Date.now() >= state.deadline || !metadata) throw new Error('deadline or response')
    const expected = `${metadata.truncated ? 'Note: this page was truncated.\n\n' : ''}${metadata.markdown}\n\nNote: the response may omit content.`
    if (typeof result !== 'string' || result !== expected) throw new Error('result')
    report.truncated = metadata.truncated
    report.markdownBytes = Buffer.byteLength(metadata.markdown, 'utf8')
    report.read = true
    report.status = 'read'
  } catch { /* Never emit raw errors or remote bodies. */ } finally {
    clearTimeout(timer); abort.abort()
    const before = state.total
    state.phase = 'closed'
    try { await rt.connectorEndpoint?.('connector-disconnect', { id: 'notion' }); cleanup?.(); report.closed = !registered } catch { try { cleanup?.() } catch {} }
    if (selectedTool) { try { await selectedTool.execute({}) } catch { report.staleDenied = true } }
    report.closeExtraRequests = state.total !== before || state.deniedAfterClose > 0
    report.total = state.total
    https.request = original
    try { await host?.fiber.dispose() } catch {}
  }
  return report
}

async function main() {
  // No business environment access before the explicit, exact gate.
  if (process.argv.length !== 3 || process.argv[2] !== '--run-once') { process.exitCode = 2; return }
  const key = process.env.COMPOSIO_API_KEY
  const page = process.env.NOTION_PAGE_LINK
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const report = await runProbe({ key, page, ask: (text, signal) => terminal.question(text, { signal }), output: text => process.stdout.write(`${text}\n`) })
    process.stdout.write(`结果：${report.status}；请求次数 ${report.total}；正文 UTF-8 字节 ${report.markdownBytes ?? '未知'}；截断 ${report.truncated ?? '未知'}；关闭 ${report.closed}；旧引用拒绝 ${report.staleDenied}；关闭新增请求 ${report.closeExtraRequests}。\n`)
    process.stdout.write(`阶段计数：${Object.entries(report.counts).map(([name, count]) => `${name}=${count}`).join(' ')}\n`)
    if (report.counts.create || report.counts.link) process.stdout.write('创建请求已发出，远端资源可能保留；结果不确定时先检查项目，勿直接重试。\n')
    if (report.status !== 'read' || !report.closed || !report.staleDenied || report.closeExtraRequests !== false) process.exitCode = 1
  } finally { terminal.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
