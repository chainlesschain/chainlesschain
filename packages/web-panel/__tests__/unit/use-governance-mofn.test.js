/**
 * useGovernanceMofn composable — unit tests.
 *
 * Focus: the signer-key serialization (_bufToBase64 via addSignature) for the
 * M-of-N multi-sig governance flow, plus proposal create + error handling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))
vi.mock('../../src/composables/useShellMode.js', () => ({
  useShellMode: () => ({ isEmbedded: true }),
}))

import { useGovernanceMofn } from '../../src/composables/useGovernanceMofn.js'

beforeEach(() => {
  sendRaw.mockReset()
})

describe('useGovernanceMofn — createProposal', () => {
  it('forwards proposal params and returns the created proposal', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: true, proposal: { id: 'p1' } },
    })
    const g = useGovernanceMofn()
    const proposal = await g.createProposal({
      communityId: 'c1',
      proposalId: 'p1',
      payload: { x: 1 },
      members: ['a', 'b', 'c'],
      threshold: 2,
    })
    expect(sendRaw).toHaveBeenCalledWith(
      {
        type: 'mtc.governance-mofn.create',
        communityId: 'c1',
        proposalId: 'p1',
        payload: { x: 1 },
        members: ['a', 'b', 'c'],
        threshold: 2,
      },
      expect.any(Number),
    )
    expect(proposal).toEqual({ id: 'p1' })
  })

  it('sets an error and returns null when the handler reports failure', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: '阈值非法' },
    })
    const g = useGovernanceMofn()
    expect(await g.createProposal({ communityId: 'c1' })).toBeNull()
    expect(g.errorMessage.value).toBe('阈值非法')
  })
})

describe('useGovernanceMofn — addSignature signer-key serialization', () => {
  it('base64-encodes Buffer keys before sending', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: true, status: { signed: 1 } },
    })
    const g = useGovernanceMofn()
    await g.addSignature('c1', 'p1', {
      did: 'did:x',
      secretKey: Buffer.from([1, 2, 3]),
      publicKey: Buffer.from([4, 5, 6]),
    })
    const sent = sendRaw.mock.calls[0][0]
    expect(sent.type).toBe('mtc.governance-mofn.sign')
    expect(sent.signerKeys).toEqual({
      did: 'did:x',
      secretKey: 'AQID',
      publicKey: 'BAUG',
    })
  })

  it('base64-encodes Uint8Array keys', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: true, status: {} },
    })
    const g = useGovernanceMofn()
    await g.addSignature('c1', 'p1', {
      did: 'did:x',
      secretKey: new Uint8Array([1, 2, 3]),
      publicKey: new Uint8Array([4, 5, 6]),
    })
    expect(sendRaw.mock.calls[0][0].signerKeys).toMatchObject({
      secretKey: 'AQID',
      publicKey: 'BAUG',
    })
  })

  it('passes already-base64 string keys through unchanged', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: true, status: {} },
    })
    const g = useGovernanceMofn()
    await g.addSignature('c1', 'p1', {
      did: 'did:x',
      secretKey: 'AQID',
      publicKey: 'BAUG',
    })
    expect(sendRaw.mock.calls[0][0].signerKeys).toMatchObject({
      secretKey: 'AQID',
      publicKey: 'BAUG',
    })
  })

  it('rejects signerKeys without a did before touching the WS topic', async () => {
    const g = useGovernanceMofn()
    expect(
      await g.addSignature('c1', 'p1', { secretKey: Buffer.from([1]) }),
    ).toBeNull()
    expect(g.errorMessage.value).toMatch(/did/)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('sets an error (does not throw) when a key has an unsupported type', async () => {
    const g = useGovernanceMofn()
    const r = await g.addSignature('c1', 'p1', {
      did: 'did:x',
      secretKey: 123,
      publicKey: 456,
    })
    expect(r).toBeNull()
    expect(g.errorMessage.value).toMatch(/Buffer \/ Uint8Array \/ base64/)
    expect(sendRaw).not.toHaveBeenCalled() // throws during serialization, before send
  })
})
