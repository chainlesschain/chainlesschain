import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useReputationOptimizerStore } from '../../../src/renderer/stores/reputationOptimizer';

describe('useReputationOptimizerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('history starts as empty', () => {
      const store = useReputationOptimizerStore();
      expect(store.history).toEqual([]);
    });

    it('analytics starts as empty', () => {
      const store = useReputationOptimizerStore();
      expect(store.analytics).toEqual([]);
    });
  });

  describe('Getters', () => {
    it('bestImprovement returns max', () => {
      const store = useReputationOptimizerStore();
      store.history = [{ improvement: 5 } as any, { improvement: 10 } as any];
      expect(store.bestImprovement).toBe(10);
    });

    it('anomalyCount filters anomalies', () => {
      const store = useReputationOptimizerStore();
      store.analytics = [{ anomaly_detected: 1 } as any, { anomaly_detected: 0 } as any];
      expect(store.anomalyCount).toBe(1);
    });
  });

  describe('runOptimization', () => {
    it('calls IPC and refetches', async () => {
      const store = useReputationOptimizerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, result: { improvement: 5 } })
        .mockResolvedValueOnce({ success: true, history: [] });
      await store.runOptimization();
      expect(mockInvoke).toHaveBeenCalledWith('reputation-optimizer:run-optimization', undefined);
    });

    it('sets error on failure', async () => {
      const store = useReputationOptimizerStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Failed' });
      await store.runOptimization();
      expect(store.error).toBe('Failed');
    });
  });

  describe('fetchHistory', () => {
    it('calls IPC and sets history', async () => {
      const store = useReputationOptimizerStore();
      mockInvoke.mockResolvedValueOnce({ success: true, history: [{ id: '1' }] });
      await store.fetchHistory();
      expect(store.history).toHaveLength(1);
    });
  });
});
