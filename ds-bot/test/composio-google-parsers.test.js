import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSyntheticMessage, parseSyntheticSheet } from '../src/host/composio-google-parsers.js'

const encode = text => Buffer.from(text).toString('base64url')
const message = payload => ({ message: { id: 'm1', payload } })

test('synthetic MIME handles nesting, attachments and safe HTML', () => {
  const result = parseSyntheticMessage(message({ mimeType: 'multipart/mixed', body: {}, parts: [
    { mimeType: 'multipart/alternative', body: {}, parts: [
      { mimeType: 'text/html', body: { data: encode('<script>bad()</script><p>html<img src="https://example.invalid/x"></p>') } },
      { mimeType: 'text/plain', body: { data: encode('plain') } },
    ] },
    { mimeType: 'application/pdf', filename: 'file.pdf', body: { attachmentId: 'a', size: 42 } },
  ] }), 'm1')
  assert.equal(result.text, 'plain')
  assert.deepEqual(result.attachments, [{ filename: 'file.pdf', mimeType: 'application/pdf', size: 42 }])
  assert.equal(result.completeness, 'unknown')
  const html = parseSyntheticMessage(message({ mimeType: 'text/html', body: { data: encode('<script>bad()</script><p>hello<img src="https://example.invalid/x"></p>') } }), 'm1')
  assert.equal(html.text.trim(), 'hello')
  assert.equal(parseSyntheticMessage(message({ mimeType: 'multipart/mixed', body: {} }), 'm1').bodyPresent, false)
})

test('synthetic MIME rejects bad encoding and marks truncation', () => {
  assert.throws(() => parseSyntheticMessage(message({ mimeType: 'text/plain', body: { data: 'a' } }), 'm1'), /encoding/)
  const result = parseSyntheticMessage(message({ mimeType: 'text/plain', body: { data: encode('界'.repeat(100000)) } }), 'm1')
  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.text) <= 256 * 1024)
  assert.ok(!result.text.includes('\ufffd'))
})

test('synthetic Sheets response must fit the requested rectangle', () => {
  const data = values => ({ valueRanges: [{ range: 'Sheet1!A1:B2', values }] })
  assert.deepEqual(JSON.parse(parseSyntheticSheet(data([[1, 2], [3]]), 'Sheet1!A1:B2')).values, [[1, 2], [3]])
  assert.throws(() => parseSyntheticSheet(data([[1], [2], [3]]), 'Sheet1!A1:B2'))
  assert.throws(() => parseSyntheticSheet(data([[1, 2, 3]]), 'Sheet1!A1:B2'))
  assert.throws(() => parseSyntheticSheet(data([['x'.repeat(256 * 1024)]]), 'Sheet1!A1:B2'), /display limit/)
  assert.throws(() => parseSyntheticSheet({ valueRanges: [{ range: 'Sheet1!A1:C2', values: [] }] }, 'Sheet1!A1:B2'))
})
