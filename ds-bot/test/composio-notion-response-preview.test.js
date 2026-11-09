import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offlineNotionPageArguments, offlineNotionResponsePreview } from '../src/host/composio-notion-response-preview.js'

test('offline page arguments accept one UUID and omit transcript', () => {
  for (const page of ['0123456789abcdef0123456789abcdef', '01234567-89ab-cdef-0123-456789abcdef']) assert.deepEqual(offlineNotionPageArguments(page), { page_id: page })
  for (const page of ['', 'selected_page', 'https://example.invalid/page', '01234567-89ab-cdef-0123-456789abcdeg', null]) assert.throws(() => offlineNotionPageArguments(page), /Invalid page selection/)
})

test('preview returns markdown and preserves truncation without declaring schema verified', () => {
  for (const truncated of [true, false]) {
    const data = { markdown: 'synthetic markdown', truncated, unknown_required_a: 'unverified', unknown_required_b: [], unknown_constant: 'do-not-infer' }
    const response = { successful: true, error: '', data }
    assert.deepEqual(offlineNotionResponsePreview(response), { markdown: 'synthetic markdown', truncated, schemaVerified: false })
    assert.deepEqual(offlineNotionResponsePreview({ successful: true, data }), { markdown: 'synthetic markdown', truncated, schemaVerified: false })
    assert.deepEqual(offlineNotionResponsePreview({ successful: true, error: null, data }), { markdown: 'synthetic markdown', truncated, schemaVerified: false })
  }
})

test('errors, failed status, malformed required fields, and oversized text fail closed without leaking text', () => {
  const good = { markdown: 'synthetic', truncated: false }
  const fixtures = [null, [], {}, { successful: false, data: good }, { successful: 'true', data: good }, { successful: true, error: 'secret_error', data: good }, { successful: false, error: null, data: good }, { successful: true, error: 0, data: good }, { successful: true, error: false, data: good }, { successful: true, data: null }, { successful: true, data: 'synthetic response string' }, { successful: true, data: { markdown: 'secret_content' } }, { successful: true, data: { markdown: 4, truncated: false } }, { successful: true, data: { markdown: 'secret_content', truncated: 'false' } }, { successful: true, data: { markdown: 'x'.repeat(1024 * 1024 + 1), truncated: false } }]
  for (const fixture of fixtures) assert.throws(() => offlineNotionResponsePreview(fixture), error => error.message === 'Notion response unavailable')
  assert.throws(() => offlineNotionResponsePreview(Object.create({ successful: true, data: good })), /unavailable/)
  assert.throws(() => offlineNotionResponsePreview({ successful: true, data: Object.create({ markdown: 'x', truncated: false }) }), /unavailable/)
})
