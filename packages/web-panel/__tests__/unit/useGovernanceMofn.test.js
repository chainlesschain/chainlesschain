/**
 * useGovernanceMofn composable tests — proposal lifecycle + base64 key
 * serialization edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useWsStore } from '../../src/stores/ws.js'
import { useGovernanceMofn } from '../../src/composables/useGovernanceMofn.js'

function setEmbedded(embedded) {
  if (typeof window === 'undefined') globalThis.window = {}
  window.__CC_CONFIG__ = { embeddedShell: !!embedded }
}

describe('useGovernanceMofn', () => {
  let sendRawMock

  beforeEach(() => {
    setActivePinia(createPinia())
    sendRawMock = vi.fn()
    useWsStore().sendRaw = sendRawMock
    setEmbedded(true)
  })

  it('listProposals caches result', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, proposals: [{ proposalId: 'p1', threshold: 2 }] },
    })
    const { proposals, listProposals } = useGovernanceMofn()
    const r = await listProposals('c')
    expect(r).toHaveLength(1)
    expect(proposals.value[0].proposalId).toBe('p1')
  })

  it('listProposals rejects empty communityId', async () => {
    const { listProposals, errorMessage } = useGovernanceMofn()
    const r = await listProposals('')
    expect(r).toBeNull()
    expect(errorMessage.value).toMatch(/communityId/)
  })

  it('createProposal forwards args', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, proposal: { proposalId: 'p1' } },
    })
    const { createProposal } = useGovernanceMofn()
    await createProposal({
      communityId: 'c',
      proposalId: 'p1',
      payload: { x: 1 },
      members: ['did:chainlesschain:abc'],
      threshold: 1,
    })
    const args = sendRawMock.mock.calls[0][0]
    expect(args.type).toBe('mtc.governance-mofn.create')
    expect(args.threshold).toBe(1)
    expect(args.payload.x).toBe(1)
  })

  it('addSignature serializes Uint8Array keys to base64', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, status: { collected: 1 } },
    })
    const { addSignature } = useGovernanceMofn()

    // Simulate browser Uint8Array (no Buffer)
    const sk = new Uint8Array(64).fill(1)
    const pk = new Uint8Array(32).fill(2)
    await addSignature('c', 'p1', {
      did: 'did:chainlesschain:abc',
      secretKey: sk,
      publicKey: pk,
    })
    const args = sendRawMock.mock.calls[0][0]
    expect(args.type).toBe('mtc.governance-mofn.sign')
    expect(typeof args.signerKeys.secretKey).toBe('string')
    expect(typeof args.signerKeys.publicKey).toBe('string')
    // Base64 of 64 bytes is 88 chars; 32 bytes is 44 chars (with padding)
    expect(args.signerKeys.secretKey.length).toBe(88)
    expect(args.signerKeys.publicKey.length).toBe(44)
  })

  it('addSignature rejects missing signerKeys', async () => {
    const { addSignature, errorMessage } = useGovernanceMofn()
    const r = await addSignature('c', 'p1', null)
    expect(r).toBeNull()
    expect(errorMessage.value).toMatch(/signerKeys/)
  })

  it('addSignature accepts already-base64 strings (no double-encode)', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, status: {} },
    })
    const { addSignature } = useGovernanceMofn()
    await addSignature('c', 'p1', {
      did: 'did:chainlesschain:abc',
      secretKey: 'AAAAAA==', // already base64
      publicKey: 'BBBBBB==',
    })
    const args = sendRawMock.mock.calls[0][0]
    expect(args.signerKeys.secretKey).toBe('AAAAAA==')
    expect(args.signerKeys.publicKey).toBe('BBBBBB==')
  })

  it('finalize delegates', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, result: { treeHeadId: 'sha256:abc' } },
    })
    const { finalize } = useGovernanceMofn()
    const r = await finalize('c', 'p1')
    expect(r.treeHeadId).toBe('sha256:abc')
  })

  it('getStatus delegates + caches', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, status: { collected: 2, complete: false } },
    })
    const { currentStatus, getStatus } = useGovernanceMofn()
    const r = await getStatus('c', 'p1')
    expect(r.collected).toBe(2)
    expect(currentStatus.value.collected).toBe(2)
  })

  it('captures error envelope from handler', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: false, error: 'governanceMultiSig not initialized' },
    })
    const { listProposals, errorMessage } = useGovernanceMofn()
    const r = await listProposals('c')
    expect(r).toBeNull()
    expect(errorMessage.value).toMatch(/not initialized/)
  })
})
