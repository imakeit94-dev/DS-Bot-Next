const UUID = /^[0-9a-f]{32}$/i
const HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function notionPageId(input) {
  if (typeof input !== 'string') throw new Error('Paste a Notion page link')
  const value = input.trim()
  if (UUID.test(value) || HYPHENATED.test(value)) return value.replaceAll('-', '').toLowerCase()
  let url
  try { url = new URL(value) } catch { throw new Error('Paste a Notion page link') }
  const host = url.hostname.toLowerCase()
  const allowed = host === 'notion.so' || host.endsWith('.notion.so') || host === 'notion.site' || host.endsWith('.notion.site') || host === 'app.notion.com'
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.port) throw new Error('Paste a Notion page link')
  let path
  try { path = decodeURIComponent(url.pathname) } catch { throw new Error('Paste a Notion page link') }
  const matches = [...path.matchAll(/(?:^|[^0-9a-f])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})(?![0-9a-f])/gi)]
  if (matches.length !== 1) throw new Error('Paste a Notion page link')
  return matches[0][1].replaceAll('-', '').toLowerCase()
}
