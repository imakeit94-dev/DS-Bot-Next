// These parsers describe deliberately narrow synthetic fixtures, not a verified live API schema.
import { sheetRangeSize } from './composio-google-arguments.js'
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const MAX_DISPLAY = 256 * 1024
const bytes = value => Buffer.byteLength(value, 'utf8')
function bounded(text) {
  const buffer = Buffer.from(text)
  if (buffer.length <= MAX_DISPLAY) return { text, truncated: false }
  let end = MAX_DISPLAY
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true }
}
function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error('Unsupported email encoding')
  const buffer = Buffer.from(value, 'base64url')
  if (buffer.toString('base64url') !== value) throw new Error('Unsupported email encoding')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { throw new Error('Unsupported email encoding') }
}
function plainHtml(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\s*\/\s*(?:p|div|li|tr|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[x])
}
export function parseSyntheticMessage(data, expectedId) {
  const message = data?.message
  if (!object(message) || message.id !== expectedId || !object(message.payload)) throw new Error('Unsupported Gmail message response')
  const text = []; const html = []; const attachments = []
  let count = 0
  const visit = (part, depth) => {
    if (++count > 500 || depth > 20 || !object(part) || typeof part.mimeType !== 'string' || !object(part.body)) throw new Error('Unsupported Gmail message response')
    if (part.filename !== undefined && typeof part.filename !== 'string') throw new Error('Unsupported Gmail message response')
    const filename = part.filename || ''
    if (filename || part.body.attachmentId) {
      if (part.body.size !== undefined && (!Number.isSafeInteger(part.body.size) || part.body.size < 0)) throw new Error('Unsupported attachment')
      attachments.push({ filename: filename.slice(0, 255), mimeType: part.mimeType.slice(0, 100), ...(part.body.size === undefined ? {} : { size: part.body.size }) })
    } else if (part.body.data !== undefined) {
      const decoded = decode(part.body.data)
      if (part.mimeType.toLowerCase() === 'text/plain') text.push(decoded)
      else if (part.mimeType.toLowerCase() === 'text/html') html.push(plainHtml(decoded))
    }
    if (part.parts !== undefined) {
      if (!Array.isArray(part.parts)) throw new Error('Unsupported Gmail message response')
      for (const child of part.parts) visit(child, depth + 1)
    }
  }
  visit(message.payload, 0)
  const body = bounded((text.length ? text : html).join('\n'))
  return { ...body, bodyPresent: text.length > 0 || html.length > 0, attachments, completeness: 'unknown', schema: 'synthetic-unverified' }
}
export function parseSyntheticSheet(data, requestedRange) {
  if (!Array.isArray(data?.valueRanges) || data.valueRanges.length !== 1) throw new Error('Unsupported Sheets response')
  const item = data.valueRanges[0]
  if (!object(item) || item.range !== requestedRange || (item.majorDimension !== undefined && item.majorDimension !== 'ROWS') || (item.values !== undefined && !Array.isArray(item.values))) throw new Error('Unsupported Sheets response')
  const rows = item.values ?? []
  const bounds = sheetRangeSize(requestedRange)
  if (rows.length > bounds.rows || rows.some(row => !Array.isArray(row) || row.length > bounds.columns || row.some(v => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))))) throw new Error('Unsupported Sheets response')
  const result = JSON.stringify({ range: requestedRange, values: rows, schema: 'synthetic-unverified' })
  if (bytes(result) > MAX_DISPLAY) throw new Error('Sheet response exceeds display limit')
  return result
}
