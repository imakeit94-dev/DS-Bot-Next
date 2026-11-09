import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

const source = readFileSync(new URL('../scripts/notion-metadata-preflight.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function schemaSummary(')
const end = source.indexOf('\nasync function main()', start)
assert.ok(start >= 0 && end > start)
const { schemaSummary, safeToolVersion } = vm.runInNewContext(`${source.slice(start, end)}\n({ schemaSummary, safeToolVersion })`, { createHash })
const summarize = schema => schemaSummary(schema, 'output_parameters')

test('projects structure and local escaped pointer with combinations and constraints', () => {
  const schema = { $defs: { 'a/b~c': { type: 'string', minLength: 1 } }, type: 'object', properties: { page_id: { $ref: '#/$defs/a~1b~0c' }, data: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['page_id'], additionalProperties: false }
  const result = summarize(schema)
  assert.equal(result.status, 'partial')
  assert.equal(result.projection.properties.page_id.$ref.target.minLength, 1)
  assert.match(result.projection.properties.page_id.$ref.path, /^#\/output_parameters\/\$defs\/\[name-\d+\]$/)
  assert.equal(result.projection.properties.data.anyOf.length, 2)
  assert.equal(result.projection.additionalProperties, false)
})

test('schema local definitions resolve but external, missing and cyclic refs block', () => {
  assert.equal(summarize({ $defs: { Foo: { type: 'string' } }, $ref: '#/$defs/Foo' }).projection.$ref.target.type, 'string')
  assert.equal(summarize({ $ref: 'https://example.invalid/schema' }).reason, 'external-or-invalid-ref')
  assert.equal(summarize({ $ref: '#/$defs/missing' }).reason, 'missing-ref-target')
  assert.equal(summarize({ $ref: '#/secret' }).status, 'blocked')
  assert.equal(summarize({ $ref: '#' }).reason, 'cyclic-ref')
  assert.equal(summarize({ $ref: '#/output_parameters/$defs/Foo' }).status, 'blocked')
  for (const key of ['$id', 'id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveAnchor', '$recursiveRef']) {
    assert.equal(summarize({ type: 'object', properties: { data: { [key]: 'secret_scope' } } }).reason, 'unsupported-scope')
  }
})

test('input and output each resolve only within their own schema root', () => {
  const input = { $defs: { Shared: { type: 'string' } }, properties: { page_id: { $ref: '#/$defs/Shared' } } }
  const output = { $defs: { Shared: { type: 'boolean' } }, properties: { successful: { $ref: '#/$defs/Shared' } } }
  assert.equal(schemaSummary(input, 'input_parameters').projection.properties.page_id.$ref.target.type, 'string')
  assert.equal(schemaSummary(output, 'output_parameters').projection.properties.successful.$ref.target.type, 'boolean')
  assert.equal(summarize({ $defs: { Shared: { $id: 'https://secret.invalid' } }, $ref: '#/$defs/Shared' }).reason, 'unsupported-scope')
})

test('reference paths reject unsupported schema constructs and ancestor scopes', () => {
  const nested = { $defs: { Base: { type: 'string' } }, properties: { data: { if: { $id: 'https://secret.invalid', $defs: { Target: { $ref: '#/$defs/Base' } } } } }, $ref: '#/properties/data/if/$defs/Target' }
  assert.equal(summarize(nested).reason, 'unsupported-path')
  for (const scope of ['$id', 'id', '$anchor', '$dynamicRef']) {
    const parent = { $defs: { Target: { type: 'string' } }, [scope]: 'secret_scope' }
    assert.equal(summarize({ properties: { data: parent }, $ref: '#/properties/data/$defs/Target' }).reason, 'unsupported-scope')
  }
  const property = summarize({ properties: { $id: { type: 'string' } }, $ref: '#/properties/$id' })
  assert.equal(property.projection.$ref.target.type, 'string')
  assert.equal(JSON.stringify(property).includes('secret'), false)
})

test('filters secret sentinels, dangerous property keys, arbitrary values and unknown constraints', () => {
  const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"secret_field":{"type":"string"},"data":{"description":"secret_description","default":"secret_default","enum":["secret_enum"],"format":"secret_format","pattern":"secret_pattern","extraConstraint":"secret_value"}},"required":["secret_required"],"secret_keyword":"secret_value"}')
  const result = summarize(schema)
  const text = JSON.stringify(result)
  assert.equal(result.status, 'partial')
  assert.equal(text.includes('secret'), false)
  assert.equal(text.includes('__proto__'), false)
  assert.equal(result.projection.properties.data.default.redacted, 'string')
  assert.match(result.unknown[0].keyword, /^\[name-\d+\]$/)
  assert.equal(result.unknown[0].path, '#/output_parameters/properties/data')
  assert.match(result.unknown[1].keyword, /^\[name-\d+\]$/)
  assert.equal({}.polluted, undefined)
})

test('uses opaque IDs consistently for credentials and numeric object names', () => {
  const names = ['passwd', 'pwd', 'AKIAABCDEFGHIJKLMNOP', '1234567890123456789012345678901234567890']
  const props = Object.fromEntries(names.map(name => [name, { type: 'string' }]))
  const schema = { type: 'object', properties: props, required: names, $defs: { [names[3]]: { type: 'string' } }, allOf: [{ $ref: '#/$defs/' + names[3] }] }
  const result = summarize(schema)
  const text = JSON.stringify(result)
  assert.equal(result.status, 'partial')
  for (const name of names) assert.equal(text.includes(name), false)
  for (const id of result.projection.required) assert.ok(Object.hasOwn(result.projection.properties, id))
  assert.ok(result.projection.allOf[0].$ref.path.endsWith(result.projection.required[3]))
  const arrayRef = summarize({ allOf: [{ type: 'string' }, { $ref: '#/allOf/0' }] })
  assert.equal(arrayRef.projection.allOf[1].$ref.path, '#/output_parameters/allOf/0')
})

test('limits depth, names and malformed schema without exposing content', () => {
  let deep = { type: 'string' }
  for (let i = 0; i < 18; i++) deep = { items: deep }
  assert.equal(summarize(deep).status, 'blocked')
  assert.equal(summarize({ properties: 'secret_schema' }).status, 'blocked')
  const hidden = summarize({ properties: { ['x'.repeat(81)]: { type: 'string' } } })
  assert.equal(hidden.reason, 'projection-limit')
  const many = Object.fromEntries(Array.from({ length: 4100 }, (_, i) => [`field${i}`, { type: 'string' }]))
  assert.equal(summarize({ properties: many }).reason, 'projection-limit')
  const large = Object.fromEntries(Array.from({ length: 1900 }, (_, i) => [`ordinary_field_${i}`, { type: 'string', minLength: 1 }]))
  assert.equal(summarize({ properties: large }).reason, 'projection-limit')
  assert.equal(safeToolVersion('secret_version'), 'unknown')
  assert.equal(safeToolVersion('20261101_00'), '20261101_00')
})
