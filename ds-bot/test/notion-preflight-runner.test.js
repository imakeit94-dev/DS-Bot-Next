import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

function sandbox(args) {
  const source = readFileSync(new URL('../scripts/notion-metadata-preflight.mjs', import.meta.url), 'utf8')
    .replace("import https from 'node:https'", '')
    .replace("import { createHash } from 'node:crypto'", '')
    .replace(/main\(\)\.catch\([\s\S]*$/, 'globalThis.run = main')
  let output = ''
  const requests = []
  const metadata = { slug: 'NOTION_GET_PAGE_MARKDOWN', version: 'secret_version', input_parameters: { type: 'object', properties: { page_id: { type: 'string' }, secret_property: { description: 'secret_description', type: 'string' } }, required: ['page_id', 'secret_required'], secret_keyword: 1 }, output_parameters: { type: 'object', properties: { data: { type: 'string', default: 'secret_default' } } } }
  if (args.includes('--diagnose-refs')) { metadata.output_parameters.$defs = { secret_ref: { type: 'boolean' } }; metadata.output_parameters.properties.successful = { $ref: '#/$defs/secret_ref' } }
  const https = { get(url, options, callback) {
    requests.push({ url: String(url), options })
    const req = new EventEmitter()
    req.destroy = () => req.emit('error', new Error('destroyed'))
    queueMicrotask(() => {
      const res = new EventEmitter()
      res.statusCode = 200
      res.headers = {}
      callback(res)
      res.emit('data', Buffer.from(JSON.stringify(metadata)))
      res.emit('end')
      req.emit('close')
    })
    return req
  } }
  let envReads = 0
  const fakeProcess = { argv: args, get env() { envReads++; return { COMPOSIO_API_KEY: 'secret_key' } }, stdout: { write(s) { output += s } } }
  const context = { https, createHash, process: fakeProcess, URL, Buffer, setTimeout, clearTimeout }
  vm.runInNewContext(source, context)
  return { run: context.run, requests, output: () => output, envReads: () => envReads }
}

test('default gate rejects before reading credentials or sending requests', async () => {
  const f = sandbox(['node', 'script'])
  await assert.rejects(f.run(), /not enabled/)
  assert.equal(f.envReads(), 0)
  assert.equal(f.requests.length, 0)
})

test('diagnostic requires explicit flag and makes one redacted fake request', async () => {
  const rejected = sandbox(['node', 'script', '--diagnose-refs'])
  await assert.rejects(rejected.run(), /not enabled/)
  assert.equal(rejected.envReads(), 0)
  assert.equal(rejected.requests.length, 0)
  const f = sandbox(['node', 'script', '--run-once', '--diagnose-refs'])
  await f.run()
  assert.equal(f.requests.length, 1)
  assert.equal(f.output().includes('secret'), false)
  const output = JSON.parse(f.output())
  assert.equal(output.references.refs[0].kind, 'defs')
  assert.equal(output.references.refs[0].schemaRootTarget, true)
  assert.equal(output.references.refs[0].metadataRootTarget, false)
})

test('explicit fixture uses one version-pinned GET and redacts sentinels', async () => {
  const f = sandbox(['node', 'script', '--run-once'])
  await f.run()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url, 'https://backend.composio.dev/api/v3.1/tools/NOTION_GET_PAGE_MARKDOWN?toolkit_versions%5Bnotion%5D=20261101_00')
  assert.equal(f.output().includes('secret'), false)
  const output = JSON.parse(f.output())
  assert.equal(output.toolVersion, 'unknown')
  assert.equal(output.requestCount, 1)
  assert.equal(output.input.status, 'partial')
  assert.equal(output.input.projection.properties.page_id.type, 'string')
  assert.equal(output.output.projection.properties.data.default.redacted, 'string')
})
