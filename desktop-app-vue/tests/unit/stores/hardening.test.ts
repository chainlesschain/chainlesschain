import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useHardeningStore } from '../../../src/renderer/stores/hardening';

describe('useHardeningStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('baselines starts as empty array', () => {
      const store = useHardeningStore();
      expect(store.baselines).toEqual([]);
    });

    it('auditReports starts as empty array', () => {
      const store = useHardeningStore();
      expect(store.auditReports).toEqual([]);
    });

    it('loading and error start correctly', () => {
      const store = useHardeningStore();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('Getters', () => {
    it('latestBaseline returns first item', () => {
      const store = useHardeningStore();
      store.baselines = [{ id: '1' } as any, { id: '2' } as any];
      expect(store.latestBaseline?.id).toBe('1');
    });

    it('hasRegressions returns false by default', () => {
      const store = useHardeningStore();
      expect(store.hasRegressions).toBe(false);
    });
  });

  describe('collectBaseline', () => {
    it('calls IPC and refetches', async () => {
      const store = useHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, baseline: { id: '1' } })
        .mockResolvedValueOnce({ success: true, baselines: [] });
      await store.collectBaseline('test');
      expect(mockInvoke).toHaveBeenCalledWith('hardening:collect-baseline', { name: 'test', version: undefined });
    });

    it('sets error on failure', async () => {
      const store = useHardeningStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Failed' });
      await store.collectBaseline('test');
      expect(store.error).toBe('Failed');
    });
  });

  describe('runSecurityAudit', () => {
    it('calls IPC and refetches reports', async () => {
      const store = useHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, report: {} })
        .mockResolvedValueOnce({ success: true, reports: [] });
      await store.runSecurityAudit();
      expect(mockInvoke).toHaveBeenCalledWith('hardening:run-security-audit', { name: undefined, categories: undefined });
    });
  });

  describe('fetchBaselines', () => {
    it('calls IPC and sets baselines', async () => {
      const store = useHardeningStore();
      mockInvoke.mockResolvedValueOnce({ success: true, baselines: [{ id: '1' }] });
      await store.fetchBaselines();
      expect(store.baselines).toHaveLength(1);
    });

    it('catches exceptions', async () => {
      const store = useHardeningStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC down'));
      const result = await store.fetchBaselines();
      expect(store.error).toBe('IPC down');
      expect(result).toEqual({ success: false, error: 'IPC down' });
    });
  });
});
