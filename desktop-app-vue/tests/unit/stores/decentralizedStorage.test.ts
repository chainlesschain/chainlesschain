import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useDecentralizedStorageStore } from '../../../src/renderer/stores/decentralizedStorage';

describe('decentralizedStorage store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should store to Filecoin', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, dealId: 'deal-123', cid: 'bafy...' });
    const store = useDecentralizedStorageStore();
    const r = await store.storeToFilecoin({ data: 'test-content', miner: 'f01234' });
    expect(r.success).toBe(true);
    expect(r.dealId).toBe('deal-123');
    expect(mockInvoke).toHaveBeenCalledWith('dstorage:store-to-filecoin', { data: 'test-content', miner: 'f01234' });
  });

  it('should fetch storage stats', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, stats: { totalStored: 1024, activeDeals: 3, providers: 5 } });
    const store = useDecentralizedStorageStore();
    await store.fetchStorageStats();
    expect(store.storageStats).toEqual({ totalStored: 1024, activeDeals: 3, providers: 5 });
    expect(mockInvoke).toHaveBeenCalledWith('dstorage:get-storage-stats');
  });

  it('should filter active deals via getter', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, stats: {} });
    const store = useDecentralizedStorageStore();
    // Manually set deals to test getter
    store.deals = [{ id: '1', status: 'active' }, { id: '2', status: 'expired' }, { id: '3', status: 'active' }];
    expect(store.activeDeals).toHaveLength(2);
  });
});
