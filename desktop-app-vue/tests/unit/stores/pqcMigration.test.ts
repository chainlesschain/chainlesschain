/**
 * usePqcMigrationStore -- Pinia store unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { usePqcMigrationStore } from '../../../src/renderer/stores/pqcMigration';

describe('usePqcMigrationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('keys starts as empty array', () => {
      const store = usePqcMigrationStore();
      expect(store.keys).toEqual([]);
    });

    it('migrationPlans starts as empty array', () => {
      const store = usePqcMigrationStore();
      expect(store.migrationPlans).toEqual([]);
    });

    it('loading starts as false', () => {
      const store = usePqcMigrationStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = usePqcMigrationStore();
      expect(store.error).toBeNull();
    });
  });

  describe('Getters', () => {
    it('activeKeys filters by status active', () => {
      const store = usePqcMigrationStore();
      store.keys = [
        { id: '1', status: 'active' } as any,
        { id: '2', status: 'revoked' } as any,
      ];
      expect(store.activeKeys).toHaveLength(1);
    });

    it('hybridKeys filters by hybrid_mode', () => {
      const store = usePqcMigrationStore();
      store.keys = [
        { id: '1', hybrid_mode: 1 } as any,
        { id: '2', hybrid_mode: 0 } as any,
      ];
      expect(store.hybridKeys).toHaveLength(1);
    });

    it('completedMigrations filters by status completed', () => {
      const store = usePqcMigrationStore();
      store.migrationPlans = [
        { id: '1', status: 'completed' } as any,
        { id: '2', status: 'pending' } as any,
      ];
      expect(store.completedMigrations).toHaveLength(1);
    });
  });

  describe('fetchKeys', () => {
    it('calls IPC and sets keys on success', async () => {
      const store = usePqcMigrationStore();
      const keys = [{ id: '1', algorithm: 'ML-KEM-768' }];
      mockInvoke.mockResolvedValueOnce({ success: true, keys });

      await store.fetchKeys();
      expect(mockInvoke).toHaveBeenCalledWith('pqc:list-keys', undefined);
      expect(store.keys).toEqual(keys);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'PQC error' });

      await store.fetchKeys();
      expect(store.error).toBe('PQC error');
    });

    it('catches exceptions', async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC down'));

      const result = await store.fetchKeys();
      expect(store.error).toBe('IPC down');
      expect(result).toEqual({ success: false, error: 'IPC down' });
    });
  });

  describe('generateKey', () => {
    it('calls IPC and refetches keys on success', async () => {
      const store = usePqcMigrationStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, key: { id: '1' } })
        .mockResolvedValueOnce({ success: true, keys: [{ id: '1' }] });

      await store.generateKey('ML-KEM-768', 'encryption');
      expect(mockInvoke).toHaveBeenCalledWith('pqc:generate-key', { algorithm: 'ML-KEM-768', purpose: 'encryption', hybridMode: undefined, classicalAlgorithm: undefined });
    });

    it('sets error on failure', async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid algo' });

      await store.generateKey('bad', 'encryption');
      expect(store.error).toBe('Invalid algo');
    });
  });

  describe('executeMigration', () => {
    it('calls IPC and refetches on success', async () => {
      const store = usePqcMigrationStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, migration: { id: '1' } })
        .mockResolvedValueOnce({ success: true, plans: [] })
        .mockResolvedValueOnce({ success: true, keys: [] });

      await store.executeMigration('plan1', 'RSA', 'ML-KEM-768');
      expect(mockInvoke).toHaveBeenCalledWith('pqc:execute-migration', { planName: 'plan1', sourceAlgorithm: 'RSA', targetAlgorithm: 'ML-KEM-768' });
    });

    it('catches exceptions', async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockRejectedValueOnce(new Error('Migration error'));

      const result = await store.executeMigration('plan', 'RSA', 'ML-KEM-768');
      expect(store.error).toBe('Migration error');
      expect(result).toEqual({ success: false, error: 'Migration error' });
    });
  });
});
