import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useProtocolFusionStore } from '../../../src/renderer/stores/protocolFusion';

describe('protocolFusion store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch feed', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, feed: [{ id: '1', protocol: 'nostr' }, { id: '2', protocol: 'matrix' }] });
    const store = useProtocolFusionStore();
    await store.fetchFeed();
    expect(store.feed).toHaveLength(2);
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('protocol-fusion:get-unified-feed', undefined);
  });

  it('should send message', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, messageId: 'msg-1' });
    const store = useProtocolFusionStore();
    const r = await store.sendMessage({ protocol: 'matrix', content: 'hello' });
    expect(r.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('protocol-fusion:send-message', { protocol: 'matrix', content: 'hello' });
  });

  it('should map identity', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, mapping: { did: 'did:key:123', nostr: 'npub1...' } });
    const store = useProtocolFusionStore();
    const r = await store.mapIdentity({ did: 'did:key:123', protocol: 'nostr', handle: 'npub1...' });
    expect(r.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('protocol-fusion:map-identity', { did: 'did:key:123', protocol: 'nostr', handle: 'npub1...' });
  });

  it('should fetch protocol status', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, status: { nostr: 'connected', matrix: 'disconnected' } });
    const store = useProtocolFusionStore();
    await store.fetchProtocolStatus();
    expect(store.protocolStatus).toEqual({ nostr: 'connected', matrix: 'disconnected' });
    expect(mockInvoke).toHaveBeenCalledWith('protocol-fusion:get-protocol-status');
  });
});
