import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useEvoMapFederationStore } from '../../../src/renderer/stores/evoMapFederation';

describe('evoMapFederation store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch hubs', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, hubs: [{ id: '1', name: 'hub-a', status: 'online' }, { id: '2', name: 'hub-b', status: 'offline' }] });
    const store = useEvoMapFederationStore();
    await store.fetchHubs();
    expect(store.hubs).toHaveLength(2);
    expect(store.onlineHubs).toHaveLength(1);
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('evomap-federation:list-hubs', undefined);
  });

  it('should sync genes', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, synced: 15, conflicts: 0 });
    const store = useEvoMapFederationStore();
    const r = await store.syncGenes({ hubId: 'hub-1', direction: 'push' });
    expect(r.success).toBe(true);
    expect(r.synced).toBe(15);
    expect(mockInvoke).toHaveBeenCalledWith('evomap-federation:sync-genes', { hubId: 'hub-1', direction: 'push' });
  });

  it('should fetch pressure report', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, report: { pressure: 0.65, hotspots: ['auth', 'storage'] } });
    const store = useEvoMapFederationStore();
    await store.fetchPressureReport();
    expect(store.pressureReport).toEqual({ pressure: 0.65, hotspots: ['auth', 'storage'] });
    expect(mockInvoke).toHaveBeenCalledWith('evomap-federation:get-pressure-report');
  });
});
