import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notionPageId } from '../src/shared/notion-page.js'

const id = '1234567890abcdef1234567890abcdef'
const uuid = '12345678-90ab-cdef-1234-567890abcdef'
test('accepts a single page ID in a trusted Notion path', () => {
  for (const input of [id, uuid, `https://app.notion.com/example-${id}?v=ffffffffffffffffffffffffffffffff#fragment`, `https://team.notion.site/${uuid}`, `https://www.notion.so/${id}`]) assert.equal(notionPageId(input), id)
})
test('rejects untrusted URLs and ambiguous paths', () => {
  for (const input of [`http://notion.so/${id}`, `https://notion.so.evil.test/${id}`, `https://evil.test/?next=https://notion.so/${id}`, `https://name@notion.so/${id}`, `https://notion.so:8443/${id}`, `https://notion.so/${id}/${id}`, 'https://notion.so/no-page', `https://notion.com/${id}`, `https://notion.so/%zz${id}`]) assert.throws(() => notionPageId(input))
})
