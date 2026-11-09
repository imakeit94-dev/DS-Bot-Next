import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { probe } from '../scripts/notion-product-manager-probe.mjs'

test('the obsolete 0.3.1 product probe fails closed without a request', async () => {
  await assert.rejects(probe(), /unavailable for 0\.3\.2/)
})

test('the obsolete probe CLI exits before reading credentials', () => {
  for (const args of [[], ['--run-once']]) {
    const result = spawnSync(process.execPath, ['scripts/notion-product-manager-probe.mjs', ...args], { encoding: 'utf8', env: { COMPOSIO_API_KEY: 'synthetic-secret', NOTION_ACCOUNT_ID: 'synthetic-account' } })
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  }
})
