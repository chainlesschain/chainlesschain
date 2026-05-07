/**
 * useMtcEnvelope composable — 5-phase WS round-trip tests.
 * Mirrors the V6 desktop useMessageEnvelope coverage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useWsStore } from '../../src/stores/ws.js'
import { useMtcEnvelope } from '../../src/composables/useMtcEnvelope.js'

function setEmbedded(embedded) {
  if (typeof window === 'undefined') globalThis.window = {}
  window.__CC_CONFIG__ = { embeddedShell: !!embedded }
}

describe('useMtcEnvelope', () => {
  let sendRawMock

  beforeEach(() => {
    setActivePinia(createPinia())
    sendRawMock = vi.fn()
    useWsStore().sendRaw = sendRawMock
    setEmbedded(true)
  })

  it('starts in idle phase', () => {
    const { state } = useMtcEnvelope()
    expect(state.value.phase).toBe('idle')
  })

  it('rejects empty args with error phase', async () => {
    const { state, fetch } = useMtcEnvelope()
    await fetch('', 'm')
    expect(state.value.phase).toBe('error')
    await fetch('c', '')
    expect(state.value.phase).toBe('error')
  })

  it('returns error in pure-browser mode', async () => {
    setEmbedded(false)
    const { state, fetch } = useMtcEnvelope()
    await fetch('c', 'm')
    expect(state.value.phase).toBe('error')
    expect(state.value.message).toMatch(/web-shell/)
    expect(sendRawMock).not.toHaveBeenCalled()
  })

  it('returns found result on success', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: {
        success: true,
        origin: 'remote',
        envelope: { schema: 'envelope/v1' },
        landmark: { snapshots: [] },
        treeHeadId: 'sha256:abc',
        batchId: '000007',
        leafIndex: 3,
      },
    })
    const { state, fetch } = useMtcEnvelope()
    await fetch('c', 'm')
    expect(state.value.phase).toBe('found')
    expect(state.value.result.origin).toBe('remote')
    expect(state.value.result.batchId).toBe('000007')
    expect(sendRawMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mtc.envelope.get', communityId: 'c', messageId: 'm' }),
      12000,
    )
  })

  it('returns not-found phase on success:false', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: false, error: 'envelope not found locally or among peers' },
    })
    const { state, fetch } = useMtcEnvelope()
    await fetch('c', 'm')
    expect(state.value.phase).toBe('not-found')
    expect(state.value.reason).toMatch(/not found/)
  })

  it('returns error phase when ws throws', async () => {
    sendRawMock.mockRejectedValue(new Error('socket closed'))
    const { state, fetch } = useMtcEnvelope()
    await fetch('c', 'm')
    expect(state.value.phase).toBe('error')
    expect(state.value.message).toBe('socket closed')
  })

  it('returns error when reply.ok is false', async () => {
    sendRawMock.mockResolvedValue({ ok: false, error: 'topic_unavailable' })
    const { state, fetch } = useMtcEnvelope()
    await fetch('c', 'm')
    expect(state.value.phase).toBe('error')
    expect(state.value.message).toMatch(/topic_unavailable/)
  })

  it('reset returns to idle', async () => {
    sendRawMock.mockResolvedValue({ ok: true, result: { success: false } })
    const { state, fetch, reset } = useMtcEnvelope()
    await fetch('c', 'm')
    reset()
    expect(state.value.phase).toBe('idle')
  })
})
