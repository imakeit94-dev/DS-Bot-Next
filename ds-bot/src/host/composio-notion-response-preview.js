// Offline contract preview only. It is not a schema validator and is not wired to any runtime.
// The observed response schema is partial; unknown required fields, MCP framing, and account binding remain unverified.
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const MAX_MARKDOWN_BYTES = 1024 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// The caller must enforce the selected-page and account bindings before any future invocation.
export function offlineNotionPageArguments(pageId) {
  if (typeof pageId !== 'string' || !UUID.test(pageId)) throw new Error('Invalid page selection')
  return { page_id: pageId }
}

// Accepts an already-decoded synthetic REST-shaped fixture; no MCP decoding is implied.
export function offlineNotionResponsePreview(value) {
  if (!object(value) || !Object.hasOwn(value, 'successful') || value.successful !== true || !Object.hasOwn(value, 'data')) throw new Error('Notion response unavailable')
  if (Object.hasOwn(value, 'error') && value.error !== null && (typeof value.error !== 'string' || value.error.length !== 0)) throw new Error('Notion response unavailable')
  const data = value.data
  if (!object(data) || !Object.hasOwn(data, 'markdown') || typeof data.markdown !== 'string' || !Object.hasOwn(data, 'truncated') || typeof data.truncated !== 'boolean' || Buffer.byteLength(data.markdown, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('Notion response unavailable')
  // Unknown required fields and constants are intentionally not interpreted or validated.
  return { markdown: data.markdown, truncated: data.truncated, schemaVerified: false }
}
