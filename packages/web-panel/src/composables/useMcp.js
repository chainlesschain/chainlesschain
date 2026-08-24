/**
 * useMcp — talks to the embedded desktop web-shell's MCP topics
 * (see desktop-app-vue/src/main/web-shell/handlers/mcp-handlers.js).
 *
 * The Electron web-shell and standalone `cc ui` both register these topics.
 * Older CLI hosts may not have them; callers can retain a structured
 * `ws.executeJson('mcp servers --json')` compatibility path.
 *
 * Usage:
 *   const mcp = useMcp()
 *   const { servers } = await mcp.listTools()              // aggregate
 *   const { server }  = await mcp.listTools('filesystem')  // one server
 *   const result      = await mcp.callTool('fs', 'read_file', { path })
 *   const { contents } = await mcp.readResource('fs', 'file:///x')
 */

import { useWsStore } from '../stores/ws.js'

function unwrap(reply) {
  // sendRaw flattens envelope so .result fields land top-level. The desktop
  // web-shell wraps custom topics as { type: '<topic>.result', ok, result|error }
  // — when ok:false sendRaw rejects via the global 'error' branch, so anything
  // we see here is an ok:true reply with `result` carrying the handler payload.
  if (reply && typeof reply.ok === 'boolean' && !reply.ok) {
    throw new Error(reply.error || 'MCP call failed')
  }
  return reply?.result ?? reply ?? null
}

export function useMcp() {
  const ws = useWsStore()

  async function listTools(serverName) {
    const reply = await ws.sendRaw(
      serverName
        ? { type: 'mcp.list_tools', serverName }
        : { type: 'mcp.list_tools' },
      15000,
    )
    return unwrap(reply)
  }

  async function callTool(serverName, toolName, params = {}) {
    if (typeof serverName !== 'string' || !serverName) {
      throw new Error('serverName is required')
    }
    if (typeof toolName !== 'string' || !toolName) {
      throw new Error('toolName is required')
    }
    const reply = await ws.sendRaw(
      { type: 'mcp.call_tool', serverName, toolName, params },
      60000, // tool calls can be slow (network, filesystem, child processes)
    )
    return unwrap(reply)
  }

  async function listResources(serverName) {
    const reply = await ws.sendRaw(
      serverName
        ? { type: 'mcp.list_resources', serverName }
        : { type: 'mcp.list_resources' },
      15000,
    )
    return unwrap(reply)
  }

  async function readResource(serverName, uri) {
    if (typeof serverName !== 'string' || !serverName) {
      throw new Error('serverName is required')
    }
    if (typeof uri !== 'string' || !uri) {
      throw new Error('uri is required')
    }
    const reply = await ws.sendRaw(
      { type: 'mcp.read_resource', serverName, uri },
      30000,
    )
    return unwrap(reply)
  }

  return { listTools, callTool, listResources, readResource }
}
