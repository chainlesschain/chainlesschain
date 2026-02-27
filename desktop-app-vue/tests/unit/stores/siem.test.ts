/**
 * useSiemStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: activeTargets, totalExported
 *  - fetchTargets()  -> siem:list-targets
 *  - addTarget()     -> siem:add-target
 *  - exportLogs()    -> siem:export-logs
 *  - fetchStats()    -> siem:get-stats
 *  - Loading state toggling
 *  - Error handling for each action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.hoisted runs before imports -- set up electronAPI before store captures it
const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useSiemStore } from '../../../src/renderer/stores/siem';

const makeTarget = (overrides: Partial<any> = {}) => ({
  id: 'tgt-1',
  target_type: 'splunk',
  target_url: 'https://splunk.example.com:8088',
  format: 'json',
  exported_count: 500,
  last_export_at: Date.now(),
  status: 'active',
  created_at: Date.now(),
  ...overrides,
});

describe('useSiemStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('targets starts as empty array', () => {
      const store = useSiemStore();
      expect(store.targets).toEqual([]);
    });

    it('stats starts as null', () => {
      const store = useSiemStore();
      expect(store.stats).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useSiemStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useSiemStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('activeTargets returns only targets with status active', () => {
      const store = useSiemStore();
      store.targets = [
        makeTarget({ id: '1', status: 'active' }),
        makeTarget({ id: '2', status: 'disabled' }),
        makeTarget({ id: '3', status: 'active' }),
      ];
      expect(store.activeTargets).toHaveLength(2);
      expect(store.activeTargets.every(t => t.status === 'active')).toBe(true);
    });

    it('activeTargets returns empty array initially', () => {
      const store = useSiemStore();
      expect(store.activeTargets).toEqual([]);
    });

    it('totalExported returns 0 when stats is null', () => {
      const store = useSiemStore();
      expect(store.totalExported).toBe(0);
    });

    it('totalExported returns value from stats', () => {
      const store = useSiemStore();
      store.stats = {
        targets: [{ id: '1', type: 'splunk', exported_count: 100, last_export_at: null }],
        totalExported: 1500,
      };
      expect(store.totalExported).toBe(1500);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  describe('fetchTargets', () => {
    it('calls IPC and sets targets on success', async () => {
      const store = useSiemStore();
      const targets = [makeTarget({ id: '1' }), makeTarget({ id: '2' })];
      mockInvoke.mockResolvedValueOnce({ success: true, targets });

      const result = await store.fetchTargets();
      expect(mockInvoke).toHaveBeenCalledWith('siem:list-targets');
      expect(result.success).toBe(true);
      expect(store.targets).toEqual(targets);
      expect(store.loading).toBe(false);
    });

    it('toggles loading during call', async () => {
      const store = useSiemStore();
      let loadingDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        loadingDuringCall = store.loading;
        return Promise.resolve({ success: true, targets: [] });
      });

      await store.fetchTargets();
      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error when result is not success', async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Config missing' });

      await store.fetchTargets();
      expect(store.error).toBe('Config missing');
      expect(store.targets).toEqual([]);
    });

    it('catches exceptions and sets error', async () => {
      const store = useSiemStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC down'));

      const result = await store.fetchTargets();
      expect(store.error).toBe('IPC down');
      expect(result).toEqual({ success: false, error: 'IPC down' });
      expect(store.loading).toBe(false);
    });
  });

  describe('addTarget', () => {
    it('calls IPC and refetches targets on success', async () => {
      const store = useSiemStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, id: 'tgt-new' })
        .mockResolvedValueOnce({ success: true, targets: [makeTarget({ id: 'tgt-new' })] });

      const result = await store.addTarget('splunk', 'https://splunk.local:8088', 'json', { token: 'abc' });
      expect(mockInvoke).toHaveBeenCalledWith('siem:add-target', { type: 'splunk', url: 'https://splunk.local:8088', format: 'json', config: { token: 'abc' } });
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid target type' });

      await store.addTarget('bad-type', 'url', 'json');
      expect(store.error).toBe('Invalid target type');
    });

    it('toggles loading during call', async () => {
      const store = useSiemStore();
      let loadingDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        loadingDuringCall = store.loading;
        return Promise.resolve({ success: false, error: 'test' });
      });

      await store.addTarget('splunk', 'url', 'json');
      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('catches exceptions', async () => {
      const store = useSiemStore();
      mockInvoke.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await store.addTarget('splunk', 'url', 'json');
      expect(store.error).toBe('Connection refused');
      expect(result).toEqual({ success: false, error: 'Connection refused' });
      expect(store.loading).toBe(false);
    });
  });

  describe('exportLogs', () => {
    it('calls IPC and refetches stats on success', async () => {
      const store = useSiemStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, exported: 50 })
        .mockResolvedValueOnce({ success: true, stats: { targets: [], totalExported: 550 } });

      const result = await store.exportLogs('tgt-1', 100);
      expect(mockInvoke).toHaveBeenCalledWith('siem:export-logs', { targetId: 'tgt-1', limit: 100 });
      expect(result.success).toBe(true);
      expect(store.stats?.totalExported).toBe(550);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Target unreachable' });

      await store.exportLogs('tgt-1');
      expect(store.error).toBe('Target unreachable');
    });

    it('catches exceptions', async () => {
      const store = useSiemStore();
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      const result = await store.exportLogs();
      expect(store.error).toBe('Network error');
      expect(result).toEqual({ success: false, error: 'Network error' });
      expect(store.loading).toBe(false);
    });
  });

  describe('fetchStats', () => {
    it('calls IPC and sets stats on success', async () => {
      const store = useSiemStore();
      const stats = { targets: [{ id: '1', type: 'splunk', exported_count: 100, last_export_at: null }], totalExported: 100 };
      mockInvoke.mockResolvedValueOnce({ success: true, stats });

      const result = await store.fetchStats();
      expect(mockInvoke).toHaveBeenCalledWith('siem:get-stats');
      expect(result.success).toBe(true);
      expect(store.stats).toEqual(stats);
    });

    it('does not update stats on failure', async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'No data' });

      await store.fetchStats();
      expect(store.stats).toBeNull();
    });

    it('catches exceptions', async () => {
      const store = useSiemStore();
      mockInvoke.mockRejectedValueOnce(new Error('Stats error'));

      const result = await store.fetchStats();
      expect(result).toEqual({ success: false, error: 'Stats error' });
    });
  });
});
