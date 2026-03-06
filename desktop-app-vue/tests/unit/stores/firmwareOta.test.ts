/**
 * useFirmwareOtaStore -- Pinia store unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useFirmwareOtaStore } from '../../../src/renderer/stores/firmwareOta';

describe('useFirmwareOtaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('availableUpdates starts as empty array', () => {
      const store = useFirmwareOtaStore();
      expect(store.availableUpdates).toEqual([]);
    });

    it('updateHistory starts as empty array', () => {
      const store = useFirmwareOtaStore();
      expect(store.updateHistory).toEqual([]);
    });

    it('currentUpdate starts as null', () => {
      const store = useFirmwareOtaStore();
      expect(store.currentUpdate).toBeNull();
    });

    it('loading and error start correctly', () => {
      const store = useFirmwareOtaStore();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('Getters', () => {
    it('hasUpdate returns true when updates exist', () => {
      const store = useFirmwareOtaStore();
      store.availableUpdates = [{ id: '1', is_critical: 0 } as any];
      expect(store.hasUpdate).toBe(true);
    });

    it('criticalUpdates filters correctly', () => {
      const store = useFirmwareOtaStore();
      store.availableUpdates = [
        { id: '1', is_critical: 1 } as any,
        { id: '2', is_critical: 0 } as any,
      ];
      expect(store.criticalUpdates).toHaveLength(1);
    });

    it('isUpdating returns false when no current update', () => {
      const store = useFirmwareOtaStore();
      expect(store.isUpdating).toBe(false);
    });
  });

  describe('checkUpdates', () => {
    it('calls IPC and sets availableUpdates on success', async () => {
      const store = useFirmwareOtaStore();
      const update = { id: '1', version: '2.0.0' };
      mockInvoke.mockResolvedValueOnce({ success: true, hasUpdate: true, availableUpdate: update });

      const result = await store.checkUpdates();
      expect(mockInvoke).toHaveBeenCalledWith('firmware:check-updates', { currentVersion: undefined, channel: undefined });
      expect(result.success).toBe(true);
      expect(store.availableUpdates).toEqual([update]);
    });

    it('sets error on failure', async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Network error' });

      await store.checkUpdates();
      expect(store.error).toBe('Network error');
    });

    it('catches exceptions', async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockRejectedValueOnce(new Error('Timeout'));

      const result = await store.checkUpdates();
      expect(store.error).toBe('Timeout');
      expect(result).toEqual({ success: false, error: 'Timeout' });
    });
  });

  describe('startUpdate', () => {
    it('calls IPC on success', async () => {
      const store = useFirmwareOtaStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, update: { id: 'u1', status: 'completed' } })
        .mockResolvedValueOnce({ success: true, history: [] });

      await store.startUpdate('v1');
      expect(mockInvoke).toHaveBeenCalledWith('firmware:start-update', { versionId: 'v1', allowRollback: undefined });
    });

    it('sets error on failure', async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Install failed' });

      await store.startUpdate('v1');
      expect(store.error).toBe('Install failed');
    });

    it('catches exceptions', async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockRejectedValueOnce(new Error('Device error'));

      const result = await store.startUpdate('v1');
      expect(store.error).toBe('Device error');
      expect(result).toEqual({ success: false, error: 'Device error' });
    });
  });

  describe('fetchHistory', () => {
    it('calls IPC and sets history', async () => {
      const store = useFirmwareOtaStore();
      const history = [{ id: 'u1', version: '2.0.0', status: 'completed' }];
      mockInvoke.mockResolvedValueOnce({ success: true, history });

      const result = await store.fetchHistory();
      expect(result.success).toBe(true);
      expect(store.updateHistory).toEqual(history);
    });
  });
});
