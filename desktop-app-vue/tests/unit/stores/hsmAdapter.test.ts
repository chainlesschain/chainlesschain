import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useHsmAdapterStore } from '../../../src/renderer/stores/hsmAdapter';

describe('hsmAdapter store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch adapters', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, adapters: [{ id: '1', name: 'Thales', status: 'connected' }] });
    const store = useHsmAdapterStore();
    await store.fetchAdapters();
    expect(store.adapters).toHaveLength(1);
    expect(store.connectedAdapters).toHaveLength(1);
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('hsm:list-adapters', undefined);
  });

  it('should connect device and refresh adapters', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, device: { id: 'hsm-1' } });
    mockInvoke.mockResolvedValueOnce({ success: true, adapters: [{ id: '1', status: 'connected' }] });
    const store = useHsmAdapterStore();
    const r = await store.connectDevice({ deviceId: 'hsm-1', pin: '1234' });
    expect(r.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('hsm:connect-device', { deviceId: 'hsm-1', pin: '1234' });
  });

  it('should fetch compliance status', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, status: { fips140: true, level: 3 } });
    const store = useHsmAdapterStore();
    await store.fetchComplianceStatus();
    expect(store.complianceStatus).toEqual({ fips140: true, level: 3 });
    expect(mockInvoke).toHaveBeenCalledWith('hsm:get-compliance-status');
  });

  it('should handle fetch adapters with no connected devices', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, adapters: [{ id: '1', status: 'disconnected' }] });
    const store = useHsmAdapterStore();
    await store.fetchAdapters();
    expect(store.adapters).toHaveLength(1);
    expect(store.connectedAdapters).toHaveLength(0);
  });
});
