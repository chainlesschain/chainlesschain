import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useAntiCensorshipStore } from '../../../src/renderer/stores/antiCensorship';

describe('antiCensorship store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should start Tor', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, status: { running: true, circuit: 'established' } });
    const store = useAntiCensorshipStore();
    await store.startTor();
    expect(store.torStatus).toEqual({ running: true, circuit: 'established' });
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('anti-censorship:start-tor');
  });

  it('should fetch Tor status', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, status: { running: false, circuit: null } });
    const store = useAntiCensorshipStore();
    await store.fetchTorStatus();
    expect(store.torStatus).toEqual({ running: false, circuit: null });
    expect(mockInvoke).toHaveBeenCalledWith('anti-censorship:get-tor-status');
  });

  it('should fetch connectivity report', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, report: { reachable: true, latency: 120, blockedDomains: 0 } });
    const store = useAntiCensorshipStore();
    await store.fetchConnectivityReport();
    expect(store.connectivityReport).toEqual({ reachable: true, latency: 120, blockedDomains: 0 });
    expect(mockInvoke).toHaveBeenCalledWith('anti-censorship:get-connectivity-report');
  });

  it('should handle Tor start failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Tor binary not found'));
    const store = useAntiCensorshipStore();
    const r = await store.startTor();
    expect(r.success).toBe(false);
    expect(r.error).toBe('Tor binary not found');
    expect(store.loading).toBe(false);
  });
});
