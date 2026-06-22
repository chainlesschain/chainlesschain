/**
 * Unit tests for src/composables/useFs.js
 *
 * useFs routes file open/save between the embedded desktop web-shell (native
 * Electron dialogs over WS fs.* topics) and a browser fallback (Blob download /
 * file input). Pinned: content validation, embedded request shaping + reply
 * normalization + ok:false errors, saveJson's stringify/defaults delegation, the
 * browser save fallback, and pickDirectory's browser "unsupported" shortcut.
 * Both the WS store and useShellMode are mocked; no socket.
 *
 * Run: npx vitest run __tests__/unit/useFs.test.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { sendRaw, shell } = vi.hoisted(() => ({
  sendRaw: vi.fn(),
  shell: { isEmbedded: false },
}))
vi.mock('../../src/stores/ws.js', () => ({ useWsStore: () => ({ sendRaw }) }))
vi.mock('../../src/composables/useShellMode.js', () => ({
  useShellMode: () => shell,
}))

import { useFs } from '../../src/composables/useFs.js'

beforeEach(() => {
  sendRaw.mockReset()
  sendRaw.mockResolvedValue({ ok: true, result: {} })
  shell.isEmbedded = false
  // happy-dom may lack object-URL APIs the browser save path uses
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:x'
  if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {}
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveText', () => {
  it('throws when content is not a string', async () => {
    await expect(useFs().saveText(42)).rejects.toThrow(/content must be a string/)
  })

  it('embedded: sends fs.saveDialog with content and normalizes the reply', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({ ok: true, result: { canceled: false, path: '/out.txt' } })
    const r = await useFs().saveText('hello', { defaultPath: 'out.txt' })
    expect(r).toEqual({ canceled: false, path: '/out.txt' })
    const msg = sendRaw.mock.calls.at(-1)[0]
    expect(msg.type).toBe('fs.saveDialog')
    expect(msg.content).toBe('hello')
  })

  it('embedded: throws on ok:false', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({ ok: false, error: 'denied' })
    await expect(useFs().saveText('x')).rejects.toThrow('denied')
  })

  it('browser: uses the Blob download fallback (no WS call)', async () => {
    shell.isEmbedded = false
    const r = await useFs().saveText('hi', { defaultPath: 'note.txt' })
    expect(r).toEqual({ canceled: false, path: 'note.txt' })
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('saveJson', () => {
  it('stringifies with 2-space indent and defaults path/filter via saveText', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({ ok: true, result: { canceled: false, path: '/d.json' } })
    await useFs().saveJson({ a: 1 })
    const msg = sendRaw.mock.calls.at(-1)[0]
    expect(msg.content).toBe('{\n  "a": 1\n}')
    expect(msg.defaultPath).toBe('data.json')
    expect(msg.filters).toEqual([{ name: 'JSON', extensions: ['json'] }])
  })
})

describe('pickFileText (embedded)', () => {
  it('normalizes the dialog reply', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({
      ok: true,
      result: { canceled: false, path: '/a.txt', content: 'C', size: 1 },
    })
    const r = await useFs().pickFileText({ title: 'Open' })
    expect(r).toEqual({ canceled: false, path: '/a.txt', content: 'C', size: 1, reason: undefined })
    expect(sendRaw.mock.calls.at(-1)[0].type).toBe('fs.openDialog')
  })

  it('throws on ok:false', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({ ok: false, error: 'no' })
    await expect(useFs().pickFileText()).rejects.toThrow('no')
  })
})

describe('pickDirectory', () => {
  it('browser: returns unsupported without a WS call', async () => {
    shell.isEmbedded = false
    expect(await useFs().pickDirectory()).toEqual({
      canceled: true,
      path: null,
      initialized: false,
      unsupported: true,
    })
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('embedded: normalizes path + initialized', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({
      ok: true,
      result: { canceled: false, path: '/proj', initialized: true },
    })
    expect(await useFs().pickDirectory()).toEqual({
      canceled: false,
      path: '/proj',
      initialized: true,
    })
  })

  it('embedded: throws on ok:false', async () => {
    shell.isEmbedded = true
    sendRaw.mockResolvedValue({ ok: false, error: 'boom' })
    await expect(useFs().pickDirectory()).rejects.toThrow('boom')
  })
})
