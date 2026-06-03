/**
 * useCrossFedTrust composable tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useWsStore } from '../../src/stores/ws.js'
import { useCrossFedTrust } from '../../src/composables/useCrossFedTrust.js'

function setEmbedded(embedded) {
  if (typeof window === 'undefined') globalThis.window = {}
  window.__CC_CONFIG__ = { embeddedShell: !!embedded }
}

describe('useCrossFedTrust', () => {
  let sendRawMock

  beforeEach(() => {
    setActivePinia(createPinia())
    sendRawMock = vi.fn()
    useWsStore().sendRaw = sendRawMock
    setEmbedded(true)
  })

  it('listTrust caches records', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: {
        success: true,
        records: [{ remoteCommunityId: 'comm-B', remoteMembers: ['did:chainlesschain:abc'] }],
      },
    })
    const { records, listTrust } = useCrossFedTrust()
    const r = await listTrust('comm-A')
    expect(r).toHaveLength(1)
    expect(records.value[0].remoteCommunityId).toBe('comm-B')
  })

  it('listTrust rejects empty localCommunityId', async () => {
    const { listTrust, errorMessage } = useCrossFedTrust()
    const r = await listTrust('')
    expect(r).toBeNull()
    expect(errorMessage.value).toMatch(/localCommunityId/)
  })

  it('establishTrust forwards full payload', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, record: { remoteCommunityId: 'comm-B' } },
    })
    const { establishTrust } = useCrossFedTrust()
    await establishTrust({
      localCommunityId: 'comm-A',
      remoteCommunityId: 'comm-B',
      remoteMembers: ['did:chainlesschain:abc', 'did:chainlesschain:def'],
      expiresAt: '2099-01-01T00:00:00Z',
      note: 'engineering ↔ design',
    })
    const args = sendRawMock.mock.calls[0][0]
    expect(args.type).toBe('mtc.cross-fed-trust.establish')
    expect(args.localCommunityId).toBe('comm-A')
    expect(args.remoteCommunityId).toBe('comm-B')
    expect(args.remoteMembers).toHaveLength(2)
    expect(args.expiresAt).toBe('2099-01-01T00:00:00Z')
    expect(args.note).toBe('engineering ↔ design')
  })

  it('establishTrust strips empty optional fields', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, record: {} },
    })
    const { establishTrust } = useCrossFedTrust()
    await establishTrust({
      localCommunityId: 'comm-A',
      remoteCommunityId: 'comm-B',
      remoteMembers: ['did:chainlesschain:abc'],
      // expiresAt + note omitted
    })
    const args = sendRawMock.mock.calls[0][0]
    expect(args.expiresAt).toBeUndefined()
    expect(args.note).toBeUndefined()
  })

  it('revokeTrust returns boolean from handler', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, removed: true },
    })
    const { revokeTrust } = useCrossFedTrust()
    const r = await revokeTrust('comm-A', 'comm-B')
    expect(r).toBe(true)
  })

  it('getTrustedDids caches list', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: true, dids: ['did:chainlesschain:abc', 'did:chainlesschain:def'] },
    })
    const { trustedDids, getTrustedDids } = useCrossFedTrust()
    const r = await getTrustedDids('comm-A')
    expect(r).toHaveLength(2)
    expect(trustedDids.value).toEqual([
      'did:chainlesschain:abc',
      'did:chainlesschain:def',
    ])
  })

  it('captures handler error', async () => {
    sendRawMock.mockResolvedValue({
      ok: true,
      result: { success: false, error: 'crossFedTrust not initialized' },
    })
    const { listTrust, errorMessage } = useCrossFedTrust()
    const r = await listTrust('comm-A')
    expect(r).toBeNull()
    expect(errorMessage.value).toMatch(/not initialized/)
  })
})
