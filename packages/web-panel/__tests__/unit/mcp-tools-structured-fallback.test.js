import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = process.cwd().endsWith(`${path.sep}packages${path.sep}web-panel`)
  ? process.cwd()
  : path.resolve(process.cwd(), 'packages/web-panel')
const source = readFileSync(path.resolve(packageRoot, 'src/views/McpTools.vue'), 'utf8')

describe('McpTools structured data contract', () => {
  it('uses the MCP topic first and a JSON-only legacy fallback', () => {
    expect(source).toContain('await mcp.listTools()')
    expect(source).toContain("ws.executeJson('mcp servers --json'")
    expect(source).not.toContain("ws.execute('mcp servers'")
    expect(source).not.toContain("ws.execute('mcp tools'")
  })

  it('does not keep the human-output parsers that created fake servers', () => {
    expect(source).not.toContain('function parseServers(')
    expect(source).not.toContain('function parseTools(')
  })

  it('renders real connection state instead of a hard-coded ready badge', () => {
    expect(source).toContain(':value="connectedServers"')
    expect(source).toContain(':status="serverBadgeStatus(srv.state)"')
    expect(source).not.toContain('status="success"')
  })
})
