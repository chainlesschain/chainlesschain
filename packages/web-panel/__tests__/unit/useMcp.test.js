/**
 * Unit tests for src/composables/useMcp.js
 *
 * useMcp talks to the embedded web-shell's MCP topics over the WS store. The
 * real logic worth pinning: the required-arg guards (serverName/toolName/uri),
 * the optional-serverName request shaping, the per-call timeouts, and the
 * envelope unwrap (ok:false -> throw, else result ?? reply ?? null). The WS
 * store is mocked so no socket is involved.
 *
 * Run: npx vitest run __tests__/unit/useMcp.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendRaw } = vi.hoisted(() => ({ sendRaw: vi.fn() }))
vi.mock('../../src/stores/ws.js', () => ({ useWsStore: () => ({ sendRaw }) }))

import { useMcp } from '../../src/composables/useMcp.js'

beforeEach(() => {
  sendRaw.mockReset()
  sendRaw.mockResolvedValue({ ok: true, result: { value: 'ok' } })
})

describe('listTools / listResources — request shaping', () => {
  it('listTools() sends the aggregate request with a 15s timeout', async () => {
    const out = await useMcp().listTools()
    expect(sendRaw).toHaveBeenCalledWith({ type: 'mcp.list_tools' }, 15000)
    expect(out).toEqual({ value: 'ok' })
  })

  it('listTools(server) scopes to one server', async () => {
    await useMcp().listTools('filesystem')
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'mcp.list_tools', serverName: 'filesystem' },
      15000,
    )
  })

  it('listResources() / (server) shape and timeout', async () => {
    await useMcp().listResources()
    expect(sendRaw).toHaveBeenLastCalledWith({ type: 'mcp.list_resources' }, 15000)
    await useMcp().listResources('fs')
    expect(sendRaw).toHaveBeenLastCalledWith(
      { type: 'mcp.list_resources', serverName: 'fs' },
      15000,
    )
  })
})

describe('callTool — guards + request', () => {
  it('throws when serverName is missing', async () => {
    await expect(useMcp().callTool('', 'read')).rejects.toThrow(/serverName is required/)
  })

  it('throws when toolName is missing', async () => {
    await expect(useMcp().callTool('fs', '')).rejects.toThrow(/toolName is required/)
  })

  it('sends a tool call with params and a 60s timeout', async () => {
    await useMcp().callTool('fs', 'read_file', { path: '/x' })
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'mcp.call_tool', serverName: 'fs', toolName: 'read_file', params: { path: '/x' } },
      60000,
    )
  })

  it('defaults params to {}', async () => {
    await useMcp().callTool('fs', 'noop')
    expect(sendRaw).toHaveBeenCalledWith(
      expect.objectContaining({ params: {} }),
      60000,
    )
  })
})

describe('readResource — guards + request', () => {
  it('throws when serverName or uri is missing', async () => {
    await expect(useMcp().readResource('', 'file:///x')).rejects.toThrow(/serverName is required/)
    await expect(useMcp().readResource('fs', '')).rejects.toThrow(/uri is required/)
  })

  it('sends a read with a 30s timeout', async () => {
    await useMcp().readResource('fs', 'file:///x')
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'mcp.read_resource', serverName: 'fs', uri: 'file:///x' },
      30000,
    )
  })
})

describe('unwrap — envelope handling', () => {
  it('throws the error message when ok is false', async () => {
    sendRaw.mockResolvedValue({ ok: false, error: 'boom' })
    await expect(useMcp().listTools()).rejects.toThrow(/boom/)
  })

  it('throws a default message when ok is false with no error', async () => {
    sendRaw.mockResolvedValue({ ok: false })
    await expect(useMcp().listTools()).rejects.toThrow(/MCP call failed/)
  })

  it('returns result when present', async () => {
    sendRaw.mockResolvedValue({ ok: true, result: { tools: [1, 2] } })
    expect(await useMcp().listTools()).toEqual({ tools: [1, 2] })
  })

  it('falls back to the raw reply when there is no result field', async () => {
    sendRaw.mockResolvedValue({ foo: 'bar' })
    expect(await useMcp().listTools()).toEqual({ foo: 'bar' })
  })

  it('returns null for a null reply', async () => {
    sendRaw.mockResolvedValue(null)
    expect(await useMcp().listTools()).toBe(null)
  })
})
