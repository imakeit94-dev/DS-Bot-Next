// Synthetic-only contract for offline tests. It is not the Notion or Composio schema.
// Production activation remains disabled until the real schema and account binding are verified.
import { defineTool } from '@deepseek-ai/dsh-tools'

const SYNTHETIC_TOOL = 'synthetic_notion_read_page'
const SYNTHETIC_SCHEMA = {
  type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'], additionalProperties: false,
}

const exactSchema = schema => {
  if (!schema || Object.keys(schema).sort().join(',') !== 'additionalProperties,properties,required,type') return false
  if (schema.type !== 'object' || schema.additionalProperties !== false) return false
  if (!Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== 'page_id') return false
  const properties = schema.properties
  return properties && Object.keys(properties).join(',') === 'page_id' &&
    properties.page_id && Object.keys(properties.page_id).join(',') === 'type' && properties.page_id.type === 'string'
}

export function syntheticNotion({ register, open }) {
  let generation = 0
  let active = false
  let dispose
  let transport

  const close = () => {
    generation++
    active = false
    const unregister = dispose
    dispose = undefined
    unregister?.()
    const previous = transport
    transport = undefined
    return Promise.resolve().then(() => previous?.close?.()).catch(() => {})
  }

  const connect = async ({ account, pageId }) => {
    if (typeof account !== 'string' || !account || typeof pageId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(pageId)) throw new Error('Invalid synthetic connection')
    const closing = close()
    const current = generation
    await closing
    if (current !== generation) throw new Error('Synthetic Notion connection unavailable')
    let candidate
    try {
      candidate = await open()
      if (current !== generation) throw new Error('cancelled')
      const identity = await candidate.identity()
      if (current !== generation || identity !== account) throw new Error('identity mismatch')
      const tools = await candidate.list()
      if (current !== generation || !Array.isArray(tools) || tools.length !== 1 || tools[0]?.name !== SYNTHETIC_TOOL || !exactSchema(tools[0]?.inputSchema)) throw new Error('schema mismatch')
      transport = candidate
      const definition = defineTool({
        name: 'connected_notion_read_page',
        description: 'Read the selected Notion page through the workspace connection.',
        parameters: { page_id: { type: 'string', required: true, description: 'The selected page identifier' } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args) {
          if (!active || generation !== current) throw new Error('Notion connection is off')
          if (!args || Object.keys(args).length !== 1 || args.page_id !== pageId) throw new Error('Only the selected page can be read')
          let result
          try { result = await candidate.call(SYNTHETIC_TOOL, { page_id: pageId }) } catch { throw new Error('Notion read failed') }
          if (!active || generation !== current) throw new Error('Notion connection is off')
          if (!result || Object.keys(result).join(',') !== 'markdown' || typeof result.markdown !== 'string') throw new Error('Unrecognized Notion response')
          return result.markdown
        },
      })
      dispose = register(definition)
      if (typeof dispose !== 'function') throw new Error('registration failed')
      active = true
    } catch {
      if (candidate) await Promise.resolve().then(() => candidate.close?.()).catch(() => {})
      if (current === generation) {
        active = false
        transport = undefined
        dispose?.()
        dispose = undefined
      }
      throw new Error('Synthetic Notion connection unavailable')
    }
  }

  return { connect, close, isActive: () => active }
}

export { SYNTHETIC_SCHEMA, SYNTHETIC_TOOL }
