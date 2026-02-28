import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useStressTestStore } from '../../../src/renderer/stores/stressTest';

describe('useStressTestStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('runs starts as empty array', () => {
      const store = useStressTestStore();
      expect(store.runs).toEqual([]);
    });

    it('currentResult starts as null', () => {
      const store = useStressTestStore();
      expect(store.currentResult).toBeNull();
    });
  });

  describe('Getters', () => {
    it('completedRuns filters complete status', () => {
      const store = useStressTestStore();
      store.runs = [{ status: 'complete' } as any, { status: 'running' } as any];
      expect(store.completedRuns).toHaveLength(1);
    });

    it('latestRun returns first item', () => {
      const store = useStressTestStore();
      store.runs = [{ id: '1' } as any];
      expect(store.latestRun?.id).toBe('1');
    });
  });

  describe('startTest', () => {
    it('calls IPC and refetches runs', async () => {
      const store = useStressTestStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, result: { total_tasks: 50 } })
        .mockResolvedValueOnce({ success: true, runs: [] });
      await store.startTest({ nodeCount: 10 });
      expect(mockInvoke).toHaveBeenCalledWith('stress-test:start', { nodeCount: 10 });
    });

    it('catches exceptions', async () => {
      const store = useStressTestStore();
      mockInvoke.mockRejectedValueOnce(new Error('Test error'));
      const result = await store.startTest();
      expect(store.error).toBe('Test error');
      expect(result).toEqual({ success: false, error: 'Test error' });
    });
  });

  describe('fetchRuns', () => {
    it('calls IPC and sets runs', async () => {
      const store = useStressTestStore();
      mockInvoke.mockResolvedValueOnce({ success: true, runs: [{ id: '1' }] });
      await store.fetchRuns();
      expect(store.runs).toHaveLength(1);
    });
  });
});
