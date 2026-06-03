import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useTrustRootStore } from '../../../src/renderer/stores/trustRoot';

describe('trustRoot store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch status', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, status: { verified: true, level: 'high' } });
    const store = useTrustRootStore();
    await store.fetchStatus();
    expect(store.status).toEqual({ verified: true, level: 'high' });
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('trust-root:get-status');
  });

  it('should verify chain', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, valid: true, chain: ['root', 'intermediate'] });
    const store = useTrustRootStore();
    const r = await store.verifyChain('device-123');
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('trust-root:verify-chain', 'device-123');
  });

  it('should fetch boot status', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, bootStatus: { secure: true, measured: true } });
    const store = useTrustRootStore();
    await store.fetchBootStatus();
    expect(store.bootStatus).toEqual({ secure: true, measured: true });
    expect(mockInvoke).toHaveBeenCalledWith('trust-root:get-boot-status');
  });

  it('should handle fetch status error', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'TPM not found' });
    const store = useTrustRootStore();
    await store.fetchStatus();
    expect(store.status).toBeNull();
  });
});
