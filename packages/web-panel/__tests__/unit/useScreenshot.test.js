/**
 * useScreenshot composable — unit tests.
 *
 *   - browser: returns { unsupported:true }; capture/ocr throw, cleanup no-op
 *   - embedded: capture / ocr / cleanup via screenshot.* WS topics
 *
 * isEmbedded is captured at useScreenshot() call time, so each test sets
 * window.__CC_CONFIG__ before constructing the composable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

import { useScreenshot } from '../../src/composables/useScreenshot.js'

function embedded(on) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = on ? { embeddedShell: true } : {}
}

beforeEach(() => {
  sendRaw.mockReset()
  embedded(false)
})

describe('useScreenshot — browser mode (unsupported)', () => {
  it('flags unsupported and stubs the methods', async () => {
    const ss = useScreenshot()
    expect(ss.unsupported).toBe(true)
    await expect(ss.capture()).rejects.toThrow(/桌面壳/)
    await expect(ss.ocr('/p')).rejects.toThrow(/OCR/)
    await expect(ss.cleanup('/p')).resolves.toBeUndefined()
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('useScreenshot — embedded mode', () => {
  beforeEach(() => embedded(true))

  it('is not unsupported', () => {
    expect(useScreenshot().unsupported).toBe(false)
  })

  it('capture sends screenshot.capture and returns the result', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { path: '/tmp/s.png', dataUrl: 'data:...' },
    })
    const r = await useScreenshot().capture({ screenIndex: 1 })
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'screenshot.capture', screenIndex: 1 },
      30000,
    )
    expect(r.path).toBe('/tmp/s.png')
  })

  it('capture throws on success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'no-display' },
    })
    await expect(useScreenshot().capture()).rejects.toThrow(/no-display/)
  })

  it('ocr requires a path', async () => {
    await expect(useScreenshot().ocr()).rejects.toThrow(/path is required/)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('ocr sends path/lang/engine with the 90s budget', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { text: 'hello', engine: 'tesseract' },
    })
    const r = await useScreenshot().ocr('/tmp/s.png', 'eng', 'tesseract')
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'screenshot.ocr', path: '/tmp/s.png', lang: 'eng', engine: 'tesseract' },
      90000,
    )
    expect(r.text).toBe('hello')
  })

  it('ocr throws on success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'ocr-broke' },
    })
    await expect(useScreenshot().ocr('/p')).rejects.toThrow(/ocr-broke/)
  })

  it('cleanup with no path is a no-op (no WS call)', async () => {
    await useScreenshot().cleanup()
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('cleanup sends screenshot.cleanup', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { success: true } })
    await useScreenshot().cleanup('/tmp/s.png')
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'screenshot.cleanup', path: '/tmp/s.png' },
      10000,
    )
  })

  it('cleanup swallows handler failure (no throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'gone' },
    })
    await expect(useScreenshot().cleanup('/p')).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('cleanup swallows a transport throw (no throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sendRaw.mockRejectedValueOnce(new Error('ws-dead'))
    await expect(useScreenshot().cleanup('/p')).resolves.toBeUndefined()
    warn.mockRestore()
  })
})
