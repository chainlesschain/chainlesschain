/**
 * useFs composable — unit tests.
 *
 * Two modes to cover:
 *   1. Embedded desktop web-shell (window.__CC_CONFIG__.embeddedShell true)
 *      → fs.openDialog / fs.saveDialog WS topics via ws.sendRaw.
 *   2. Browser (embeddedShell false / undefined)
 *      → blob+anchor for save, <input type=file>+FileReader for open.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

import { useFs } from '../../src/composables/useFs.js'

beforeEach(() => {
  sendRaw.mockReset()
  // Reset embedded flag default per test
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = {}
})

// ─── Embedded mode ──────────────────────────────────────────────────────────

describe('useFs — embedded shell mode', () => {
  beforeEach(() => {
    globalThis.window.__CC_CONFIG__ = { embeddedShell: true }
  })

  it('pickFileText sends fs.openDialog with filters and returns the result', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: {
        canceled: false,
        path: 'C:/notes.md',
        size: 12,
        content: 'hello world\n',
      },
    })
    const fs = useFs()
    const r = await fs.pickFileText({
      title: 'Pick a file',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    expect(sendRaw).toHaveBeenCalledWith(
      {
        type: 'fs.openDialog',
        title: 'Pick a file',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      },
      60000,
    )
    expect(r.canceled).toBe(false)
    expect(r.path).toBe('C:/notes.md')
    expect(r.content).toBe('hello world\n')
    expect(r.size).toBe(12)
  })

  it('pickFileText surfaces too_large reason without throwing', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: {
        canceled: false,
        path: '/tmp/big.bin',
        size: 50_000_000,
        content: null,
        reason: 'too_large',
      },
    })
    const fs = useFs()
    const r = await fs.pickFileText()
    expect(r.reason).toBe('too_large')
    expect(r.content).toBeNull()
  })

  it('pickFileText reports a canceled dialog as canceled:true, content:null', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { canceled: true, path: null, content: null },
    })
    const fs = useFs()
    const r = await fs.pickFileText()
    expect(r).toEqual({
      canceled: true,
      path: null,
      content: null,
      size: undefined,
      reason: undefined,
    })
  })

  it('pickFileText throws on ok:false envelope replies', async () => {
    sendRaw.mockResolvedValueOnce({ ok: false, error: 'main_window_unavailable' })
    const fs = useFs()
    await expect(fs.pickFileText()).rejects.toThrow('main_window_unavailable')
  })

  it('saveText sends fs.saveDialog with content + defaultPath + filters', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { canceled: false, path: '/tmp/note.txt' },
    })
    const fs = useFs()
    const r = await fs.saveText('hi', {
      title: 'Save Note',
      defaultPath: 'note.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    })
    expect(sendRaw.mock.calls[0][0]).toMatchObject({
      type: 'fs.saveDialog',
      title: 'Save Note',
      defaultPath: 'note.txt',
      content: 'hi',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    })
    expect(r.canceled).toBe(false)
    expect(r.path).toBe('/tmp/note.txt')
  })

  it('saveText rejects non-string content', async () => {
    const fs = useFs()
    await expect(fs.saveText(42)).rejects.toThrow('content must be a string')
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('saveJson defaults filters to JSON + serialises with indent', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { canceled: false, path: '/tmp/data.json' },
    })
    const fs = useFs()
    await fs.saveJson({ a: 1, b: [2, 3] })
    const sent = sendRaw.mock.calls[0][0]
    expect(sent.type).toBe('fs.saveDialog')
    expect(sent.filters).toEqual([{ name: 'JSON', extensions: ['json'] }])
    expect(sent.defaultPath).toBe('data.json')
    expect(JSON.parse(sent.content)).toEqual({ a: 1, b: [2, 3] })
  })

  it('saveJson honours an override defaultPath', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { canceled: false, path: '/x' } })
    const fs = useFs()
    await fs.saveJson({}, { defaultPath: 'workflow.json' })
    expect(sendRaw.mock.calls[0][0].defaultPath).toBe('workflow.json')
  })
})

// ─── Browser fallback mode ──────────────────────────────────────────────────

describe('useFs — browser fallback mode', () => {
  beforeEach(() => {
    globalThis.window.__CC_CONFIG__ = {} // no embeddedShell
  })

  it('saveText creates an <a download> blob link without touching ws.sendRaw', async () => {
    // Stub URL.createObjectURL so JSDOM doesn't error on Blob.
    const origCreate = global.URL.createObjectURL
    const origRevoke = global.URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    try {
      const fs = useFs()
      const r = await fs.saveText('hello', { defaultPath: 'note.txt' })
      expect(r.canceled).toBe(false)
      expect(r.path).toBe('note.txt')
      expect(global.URL.createObjectURL).toHaveBeenCalled()
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
      expect(sendRaw).not.toHaveBeenCalled()
    } finally {
      global.URL.createObjectURL = origCreate
      global.URL.revokeObjectURL = origRevoke
    }
  })

  it('saveJson defaults to data.json when no defaultPath provided', async () => {
    const origCreate = global.URL.createObjectURL
    const origRevoke = global.URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    try {
      const fs = useFs()
      const r = await fs.saveJson({ ok: 1 })
      expect(r.path).toBe('data.json')
    } finally {
      global.URL.createObjectURL = origCreate
      global.URL.revokeObjectURL = origRevoke
    }
  })

  it('pickFileText resolves with the chosen file content via FileReader', async () => {
    const fs = useFs()
    const promise = fs.pickFileText({ filters: [{ name: 'JSON', extensions: ['json'] }] })

    // Drive the input the composable just appended: simulate a file selection
    // by overriding the most-recently-added input element.
    const inputs = document.querySelectorAll('input[type=file]')
    expect(inputs.length).toBeGreaterThan(0)
    const input = inputs[inputs.length - 1]
    expect(input.accept).toBe('.json')

    // jsdom doesn't allow direct files= assignment; stub via Object.defineProperty.
    const fakeFile = new File(['{"a":1}'], 'data.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true })
    input.dispatchEvent(new Event('change'))

    const r = await promise
    expect(r.canceled).toBe(false)
    expect(r.path).toBe('data.json')
    expect(r.content).toBe('{"a":1}')
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('pickFileText reports canceled=true when the input has no files', async () => {
    const fs = useFs()
    const promise = fs.pickFileText()
    const inputs = document.querySelectorAll('input[type=file]')
    const input = inputs[inputs.length - 1]
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    input.dispatchEvent(new Event('change'))
    const r = await promise
    expect(r.canceled).toBe(true)
    expect(r.content).toBeNull()
  })
})
