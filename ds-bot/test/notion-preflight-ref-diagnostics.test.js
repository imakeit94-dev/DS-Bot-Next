import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../scripts/notion-metadata-preflight.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function refDiagnostics(')
const end = source.indexOf('\nfunction safeToolVersion(', start)
assert.ok(start >= 0 && end > start)
const diagnose = vm.runInNewContext(`${source.slice(start, end)}\nrefDiagnostics`)

test('distinguishes independent schema root and outer metadata without exposing names', () => {
  const doc = { input_parameters: { $defs: { secret_input: { type: 'string' } }, properties: { page_id: { $ref: '#/$defs/secret_input' } } }, output_parameters: { $defs: { secret_output: { type: 'string' } }, properties: { data: { $ref: '#/$defs/secret_output' }, successful: { $ref: '#/definitions/secret_outer' }, error: { $ref: '#/definitions/secret_missing' } } }, definitions: { secret_outer: { type: 'string' } } }
  const result = diagnose(doc)
  assert.equal(result.status, 'diagnostic-only')
  assert.equal(result.refs.length, 4)
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.deepEqual(Array.from(result.refs, r => [r.source, r.kind, r.schemaRootTarget, r.metadataRootTarget]), [ ['input', 'defs', true, false], ['output', 'defs', true, false], ['output', 'definitions', false, true], ['output', 'definitions', false, false] ])
})

test('classifies external malformed escaped and ambiguous references without exposing content', () => {
  const doc = { input_parameters: {}, output_parameters: { $defs: { 'secret/a~b': {} }, allOf: [{ $ref: '#/$defs/secret~1a~0b' }, { $ref: 'https://secret.invalid/path' }, { $ref: '#/%ZZsecret' }, { $ref: '#/definitions/both' }] }, definitions: { both: {} } }
  doc.output_parameters.definitions = { both: {} }
  const result = diagnose(doc)
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.deepEqual(Array.from(result.refs, r => [r.kind, r.schemaRootTarget, r.metadataRootTarget]), [['defs', true, false], ['external-or-invalid', false, false], ['invalid', false, false], ['definitions', true, true]])
})

test('schema mappings may name properties and definitions $ref', () => {
  for (const mapping of ['properties', '$defs', 'definitions']) {
    const output = { $defs: { target: {} }, [mapping]: { $ref: { $ref: '#/$defs/target' } } }
    if (mapping === '$defs') output.$defs.target = {}
    const result = diagnose({ input_parameters: {}, output_parameters: output })
    assert.equal(result.refs.length, 1)
    assert.equal(result.refs[0].kind, 'defs')
    assert.equal(result.refs[0].schemaRootTarget, true)
    assert.equal(result.refs[0].metadataRootTarget, false)
  }
  const invalid = diagnose({ input_parameters: {}, output_parameters: { $ref: { secret: 'value' } } })
  assert.equal(invalid.refs.length, 1)
  assert.equal(invalid.refs[0].kind, 'invalid')
  assert.equal(JSON.stringify(invalid).includes('secret'), false)
})

test('fails closed on excessive depth and reference count', () => {
  let deep = { $ref: '#/definitions/test' }
  for (let i = 0; i < 18; i++) deep = { items: deep }
  assert.equal(diagnose({ input_parameters: {}, output_parameters: deep }).status, 'blocked')
  assert.equal(diagnose({ input_parameters: {}, output_parameters: { allOf: Array.from({ length: 129 }, () => ({ $ref: '#' })) } }).status, 'blocked')
})
