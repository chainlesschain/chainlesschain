import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useTokenIncentiveStore } from '../../../src/renderer/stores/tokenIncentive';

describe('tokenIncentive store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should fetch balance', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, balance: 100 });
    const store = useTokenIncentiveStore();
    await store.fetchBalance();
    expect(store.balance).toBe(100);
  });

  it('should fetch transactions', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, transactions: [{ id: '1', type: 'reward' }] });
    const store = useTokenIncentiveStore();
    await store.fetchTransactions();
    expect(store.transactions).toHaveLength(1);
  });

  it('should submit contribution and refresh balance', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, contribution: {} });
    mockInvoke.mockResolvedValueOnce({ success: true, balance: 110 });
    const store = useTokenIncentiveStore();
    const r = await store.submitContribution({ type: 'skill' });
    expect(r.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('token:submit-contribution', { type: 'skill' });
  });
});
