/**
 * useMcp composable — unit tests.
 *
 * Mocks the `useWsStore` `sendRaw` so neither a real WebSocket nor a desktop
 * web-shell is needed. We assert the composable shapes the right frames,
 * unwraps `.result.result`, and propagates errors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

import { useMcp } from '../../src/composables/useMcp.js'

beforeEach(() => {
  sendRaw.mockReset()
})

describe('useMcp.listTools', () => {
  it('sends mcp.list_tools with no serverName for aggregate', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: {
        servers: [
          { name: 'fs', state: 'connected', tools: [{ name: 'read_file' }] },
        ],
      },
    })
    const mcp = useMcp()
    const r = await mcp.listTools()
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'mcp.list_tools' },
      15000,
    )
    expect(r.servers[0].name).toBe('fs')
  })

  it('sends serverName when provided', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { server: { name: 'fs', state: 'connected', tools: [] } },
    })
    const mcp = useMcp()
    const r = await mcp.listTools('fs')
    expect(sendRaw.mock.calls[0][0]).toEqual({
      type: 'mcp.list_tools',
      serverName: 'fs',
    })
    expect(r.server.name).toBe('fs')
  })

  it('throws with the server-side error on ok:false replies', async () => {
    sendRaw.mockResolvedValueOnce({ ok: false, error: 'mcp_unavailable' })
    const mcp = useMcp()
    await expect(mcp.listTools()).rejects.toThrow('mcp_unavailable')
  })
})

describe('useMcp.callTool', () => {
  it('forwards serverName + toolName + params', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { content: [{ type: 'text', text: 'hi' }] },
    })
    const mcp = useMcp()
    const r = await mcp.callTool('fs', 'read_file', { path: '/x' })
    expect(sendRaw.mock.calls[0][0]).toEqual({
      type: 'mcp.call_tool',
      serverName: 'fs',
      toolName: 'read_file',
      params: { path: '/x' },
    })
    expect(sendRaw.mock.calls[0][1]).toBe(60000)
    expect(r.content[0].text).toBe('hi')
  })

  it('defaults params to {} when omitted', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: {} })
    const mcp = useMcp()
    await mcp.callTool('fs', 'read_file')
    expect(sendRaw.mock.calls[0][0].params).toEqual({})
  })

  it('rejects with descriptive error on missing serverName', async () => {
    const mcp = useMcp()
    await expect(mcp.callTool('', 'tool')).rejects.toThrow('serverName is required')
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('rejects with descriptive error on missing toolName', async () => {
    const mcp = useMcp()
    await expect(mcp.callTool('fs', '')).rejects.toThrow('toolName is required')
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('useMcp.listResources / readResource', () => {
  it('sends mcp.list_resources aggregate', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { servers: [] } })
    const mcp = useMcp()
    const r = await mcp.listResources()
    expect(sendRaw.mock.calls[0][0]).toEqual({ type: 'mcp.list_resources' })
    expect(r.servers).toEqual([])
  })

  it('sends mcp.list_resources with serverName', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { server: { name: 'gh', state: 'connected', resources: [] } },
    })
    const mcp = useMcp()
    await mcp.listResources('gh')
    expect(sendRaw.mock.calls[0][0]).toEqual({
      type: 'mcp.list_resources',
      serverName: 'gh',
    })
  })

  it('sends mcp.read_resource with serverName + uri', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { contents: [{ uri: 'file:///x', text: 'content' }] },
    })
    const mcp = useMcp()
    const r = await mcp.readResource('fs', 'file:///x')
    expect(sendRaw.mock.calls[0][0]).toEqual({
      type: 'mcp.read_resource',
      serverName: 'fs',
      uri: 'file:///x',
    })
    expect(r.contents[0].text).toBe('content')
  })

  it('rejects when uri is empty or non-string', async () => {
    const mcp = useMcp()
    await expect(mcp.readResource('fs', '')).rejects.toThrow('uri is required')
    await expect(mcp.readResource('fs', null)).rejects.toThrow('uri is required')
    expect(sendRaw).not.toHaveBeenCalled()
  })
})
