import { describe, expect, it, vi } from 'vitest'
import { saveLlmApiKey } from '../../src/utils/llm-config.js'

describe('saveLlmApiKey', () => {
  it('uses the structured secret protocol instead of a CLI command', async () => {
    const sendRaw = vi.fn().mockResolvedValue({
      type: 'config-set-secret-result',
      success: true,
      key: 'llm.apiKey',
      storage: 'keychain',
    })

    await expect(saveLlmApiKey({ sendRaw }, 'sk-first-run-key')).resolves.toMatchObject({
      success: true,
      key: 'llm.apiKey',
    })
    expect(sendRaw).toHaveBeenCalledWith(
      {
        type: 'config-set-secret',
        key: 'llm.apiKey',
        value: 'sk-first-run-key',
      },
      15000,
    )
  })

  it('surfaces a failed secret write', async () => {
    const sendRaw = vi.fn().mockResolvedValue({
      type: 'config-set-secret-result',
      success: false,
      message: 'write failed',
    })

    await expect(saveLlmApiKey({ sendRaw }, 'sk-key')).rejects.toThrow('write failed')
  })

  it('rejects empty keys before sending a frame', async () => {
    const sendRaw = vi.fn()
    await expect(saveLlmApiKey({ sendRaw }, '')).rejects.toThrow('cannot be empty')
    expect(sendRaw).not.toHaveBeenCalled()
  })
})
