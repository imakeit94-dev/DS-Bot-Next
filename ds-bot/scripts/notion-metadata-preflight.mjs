// One-shot metadata only. --run-once requires separate approval; never enable business execution here.
import https from 'node:https'
import { createHash } from 'node:crypto'

const url = new URL('https://backend.composio.dev/api/v3.1/tools/NOTION_GET_PAGE_MARKDOWN')
url.searchParams.set('toolkit_versions[notion]', '20261101_00')
const MAX_BYTES = 262144
const TIMEOUT_MS = 10000

// Bounded, deliberately incomplete projection of untrusted schema data; never a validator.
function schemaSummary(schema, root) {
  // Only reviewed protocol names are displayed; all other names get per-projection opaque IDs.
  const visible = new Set(['input_parameters', 'output_parameters', '$defs', 'definitions', 'properties', 'items', 'additionalProperties', 'allOf', 'anyOf', 'oneOf', 'page_id', 'include_transcript', 'data', 'error', 'successful', 'markdown', 'truncated', '$schema', '$id', 'patternProperties', 'dependentRequired', 'dependentSchemas', 'not', 'if', 'then', 'else', 'contains', 'prefixItems', 'unevaluatedProperties', 'unevaluatedItems', 'readOnly', 'writeOnly', 'uniqueItems', 'contentEncoding', 'contentMediaType'])
  const safeName = name => typeof name === 'string' && visible.has(name)
  const names = new Map()
  const label = name => {
    if (safeName(name)) return name
    if (typeof name !== 'string' || name.length > 80) throw new Error('projection-limit')
    partial = true
    if (!names.has(name)) names.set(name, `[name-${names.size + 1}]`)
    return names.get(name)
  }
  const map = value => value && typeof value === 'object' && !Array.isArray(value)
  const annotations = new Set(['description', 'title', 'examples', 'example', '$comment'])
  const scopeKeywords = ['$id', 'id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveAnchor', '$recursiveRef']
  const checkScope = node => { if (scopeKeywords.some(key => Object.hasOwn(node, key))) throw new Error('unsupported-scope') }
  const numeric = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'])
  const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
  const formats = new Set(['date', 'date-time', 'time', 'uuid', 'uri', 'email'])
  let nodes = 0
  let redactedNames = 0
  let partial = false
  const unknown = []
  const active = new Set()
  const pointer = parts => '#/' + parts.map(part => {
    const s = typeof part === 'object' ? String(part.index) : label(part)
    return s.replace(/~/g, '~0').replace(/\//g, '~1')
  }).join('/')
  function lookup(ref) {
    if (ref === '#') return { target: schema, parts: [root] }
    if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error('external-or-invalid-ref')
    if (ref.length > 512 || /%(?![0-9a-f]{2})/i.test(ref)) throw new Error('invalid-ref')
    let fragment
    try { fragment = decodeURIComponent(ref.slice(2)) } catch { throw new Error('blocked') }
    const parts = fragment.split('/').map(s => {
      if (/~(?![01])/.test(s)) throw new Error('blocked')
      return s.replace(/~1/g, '/').replace(/~0/g, '~')
    })
    if (!['$defs', 'definitions', 'properties', 'items', 'allOf', 'anyOf', 'oneOf', 'additionalProperties'].includes(parts[0])) throw new Error('blocked')
    let target = schema
    let position = 'schema'
    const displayParts = [root]
    for (const part of parts) {
      if (part.length > 80) throw new Error('projection-limit')
      if (position === 'schema') {
        if (!map(target)) throw new Error('missing-ref-target')
        checkScope(target)
        if (['properties', '$defs', 'definitions'].includes(part)) position = 'mapping'
        else if (['items', 'additionalProperties'].includes(part)) position = 'schema'
        else if (['allOf', 'anyOf', 'oneOf'].includes(part)) position = 'array'
        else throw new Error('unsupported-path')
      } else if (position === 'mapping') {
        if (!map(target)) throw new Error('missing-ref-target')
        position = 'schema'
      } else {
        if (!Array.isArray(target) || !/^(0|[1-9]\d*)$/.test(part)) throw new Error('invalid-ref')
        position = 'schema'
      }
      if (!Object.hasOwn(target, part)) throw new Error('missing-ref-target')
      if (Array.isArray(target)) displayParts.push({ index: part })
      else displayParts.push(part)
      target = target[part]
    }
    if (position !== 'schema') throw new Error('unsupported-path')
    return { target, parts: displayParts }
  }
  function valueSummary(value) {
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
    if (typeof value === 'string' && value.length <= 1024) { partial = true; return { redacted: 'string', length: value.length, sha256: createHash('sha256').update(value).digest('hex') } }
    throw new Error('blocked')
  }
  function visit(node, parts, depth) {
    if (depth > 16 || ++nodes > 4096) throw new Error('projection-limit')
    if (!map(node)) throw new Error('blocked')
    checkScope(node)
    const path = pointer(parts)
    if (active.has(node)) throw new Error('cyclic-ref')
    active.add(node)
    const out = Object.create(null)
    for (const [key, value] of Object.entries(node)) {
      if (annotations.has(key)) continue
      if (key === '$ref') {
        const resolved = lookup(value)
        out.$ref = { path: pointer(resolved.parts), target: visit(resolved.target, resolved.parts, depth + 1) }
      } else if (key === 'properties' || key === '$defs' || key === 'definitions') {
        if (!map(value)) throw new Error('blocked')
        const children = Object.create(null)
        for (const [name, child] of Object.entries(value)) {
          if (!safeName(name)) redactedNames++
          children[label(name)] = visit(child, [...parts, key, name], depth + 1)
        }
        out[key] = children
      } else if (key === 'items' || key === 'additionalProperties') {
        out[key] = typeof value === 'boolean' && key === 'additionalProperties' ? value : visit(value, [...parts, key], depth + 1)
      } else if (['allOf', 'anyOf', 'oneOf'].includes(key)) {
        if (!Array.isArray(value) || value.length > 128) throw new Error('blocked')
        out[key] = value.map((child, i) => visit(child, [...parts, key, { index: i }], depth + 1))
      } else if (key === 'required') {
        if (!Array.isArray(value) || value.length > 256 || !value.every(v => typeof v === 'string')) throw new Error('blocked')
        out.required = value.map(label)
      } else if (key === 'type') {
        if (typeof value === 'string' && types.has(value)) out.type = value
        else if (Array.isArray(value) && value.length <= 7 && value.every(v => types.has(v))) out.type = value
        else throw new Error('blocked')
      } else if (key === 'nullable') {
        if (typeof value !== 'boolean') throw new Error('blocked')
        out.nullable = value
      } else if (numeric.has(key)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('blocked')
        out[key] = value
      } else if (key === 'enum') {
        if (!Array.isArray(value) || value.length > 128) throw new Error('blocked')
        out.enum = value.map(valueSummary)
      } else if (key === 'default' || key === 'const') out[key] = valueSummary(value)
      else if (key === 'format') {
        if (typeof value !== 'string' || value.length > 80) throw new Error('blocked')
        if (formats.has(value)) out.format = value
        else { partial = true; out.format = { redacted: true } }
      } else if (key === 'pattern') {
        if (typeof value !== 'string' || value.length > 1024) throw new Error('blocked')
        out.pattern = valueSummary(value)
      } else {
        partial = true
        unknown.push({ path, keyword: label(key), valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value })
      }
    }
    active.delete(node)
    return out
  }
  try {
    const projection = visit(schema, [root], 0)
    const result = { status: partial ? 'partial' : 'projected', projection, unknown, redactedNames }
    if (JSON.stringify(result).length > 65536) throw new Error('projection-limit')
    return result
  } catch (error) {
    const allowed = ['external-or-invalid-ref', 'invalid-ref', 'missing-ref-target', 'cyclic-ref', 'projection-limit', 'unsupported-scope', 'unsupported-path']
    return { status: 'blocked', reason: allowed.includes(error.message) ? error.message : 'unsupported-schema' }
  }
}

// Diagnostics report only fixed categories and existence, never reference text or schema values.
function refDiagnostics(document) {
  let nodes = 0
  const refs = []
  function resolve(root, parts) {
    let target = root
    for (const part of parts) {
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) return false
      if (Array.isArray(target) && !/^(0|[1-9]\d*)$/.test(part)) return false
      target = target[part]
    }
    return true
  }
  function inspect(value, schemaRoot, source, location, depth, nameMap = false) {
    if (depth > 16 || ++nodes > 4096) throw new Error('limit')
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) inspect(item, schemaRoot, source, location, depth + 1)
      return
    }
    if (nameMap) {
      for (const child of Object.values(value)) inspect(child, schemaRoot, source, location, depth + 1)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        if (refs.length >= 128) throw new Error('limit')
        const result = { source, location, kind: 'invalid', schemaRootTarget: false, metadataRootTarget: false }
        if (typeof child === 'string' && child.length <= 512) {
          if (child === '#') {
            result.kind = 'root'
            result.schemaRootTarget = true
            result.metadataRootTarget = true
          } else if (!child.startsWith('#/')) result.kind = 'external-or-invalid'
          else {
            try {
              const fragment = decodeURIComponent(child.slice(2))
              const segments = fragment.split('/').map(s => {
                if (/~(?![01])/.test(s)) throw new Error('invalid')
                return s.replace(/~1/g, '/').replace(/~0/g, '~')
              })
              if (segments.some(s => s.length > 80)) throw new Error('invalid')
              result.kind = segments[0] === '$defs' ? 'defs' : segments[0] === 'definitions' ? 'definitions' : segments[0] === 'properties' ? 'properties' : 'other-local'
              result.schemaRootTarget = resolve(schemaRoot, segments)
              result.metadataRootTarget = resolve(document, segments)
            } catch { /* Invalid references remain invalid, without outputting their text. */ }
          }
        }
        refs.push(result)
        continue
      }
      const next = ['properties', 'items', '$defs', 'definitions'].includes(key) ? key : ['allOf', 'anyOf', 'oneOf'].includes(key) ? 'composition' : 'other'
      if (child && typeof child === 'object') inspect(child, schemaRoot, source, next, depth + 1, ['properties', '$defs', 'definitions'].includes(key) && !Array.isArray(child))
    }
  }
  try {
    for (const source of ['input_parameters', 'output_parameters']) {
      const schema = document[source]
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('invalid')
      inspect(schema, schema, source === 'input_parameters' ? 'input' : 'output', 'root', 0)
    }
    return { status: 'diagnostic-only', refs }
  } catch { return { status: 'blocked' } }
}

function safeToolVersion(version) {
  return typeof version === 'string' && /^\d{8}_\d{2}$/.test(version) ? version : 'unknown'
}

async function main() {
  const diagnostic = process.argv.length === 4 && process.argv[2] === '--run-once' && process.argv[3] === '--diagnose-refs'
  if (!diagnostic && (process.argv.length !== 3 || process.argv[2] !== '--run-once')) throw new Error('Preflight not enabled')
  const key = process.env.COMPOSIO_API_KEY
  if (!key || /[\r\n]/.test(key)) throw new Error('Project key unavailable')
  const bytes = await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'x-api-key': key, accept: 'application/json' }, agent: false }, res => {
      if (res.statusCode !== 200 || res.headers.location) { res.resume(); reject(new Error('Request failed')); return }
      const chunks = []
      let size = 0
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) req.destroy(); else chunks.push(chunk) })
      res.on('end', () => { if (size > MAX_BYTES) reject(new Error('Response too large')); else resolve(Buffer.concat(chunks)) })
      res.on('error', () => reject(new Error('Request failed')))
      res.on('aborted', () => reject(new Error('Request failed')))
    })
    const deadline = setTimeout(() => req.destroy(), TIMEOUT_MS)
    req.on('close', () => clearTimeout(deadline))
    req.on('error', () => reject(new Error('Request failed')))
  })
  const metadata = JSON.parse(bytes.toString('utf8'))
  if (metadata.slug !== 'NOTION_GET_PAGE_MARKDOWN') throw new Error('Wrong tool')
  const toolVersion = safeToolVersion(metadata.version)
  const common = { requestedToolkitVersion: '20261101_00', toolVersion, rawResponseSha256: createHash('sha256').update(bytes).digest('hex'), requestCount: 1 }
  const result = diagnostic
    ? { ...common, references: refDiagnostics(metadata) }
    : { ...common, input: schemaSummary(metadata.input_parameters, 'input_parameters'), output: schemaSummary(metadata.output_parameters, 'output_parameters') }
  const text = JSON.stringify(result)
  if (Buffer.byteLength(text) > 65536) throw new Error('Projection too large')
  process.stdout.write(text + '\n')
}

main().catch(() => { process.stderr.write('Metadata preflight unavailable; no retry.\n'); process.exitCode = 1 })
