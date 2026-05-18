import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useFederationHardeningStore } from '../../../src/renderer/stores/federationHardening';

describe('useFederationHardeningStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('status starts as null', () => {
      const store = useFederationHardeningStore();
      expect(store.status).toBeNull();
    });

    it('circuitBreakers starts as empty array', () => {
      const store = useFederationHardeningStore();
      expect(store.circuitBreakers).toEqual([]);
    });
  });

  describe('Getters', () => {
    it('openCircuits filters open state', () => {
      const store = useFederationHardeningStore();
      store.circuitBreakers = [
        { state: 'open' } as any,
        { state: 'closed' } as any,
      ];
      expect(store.openCircuits).toHaveLength(1);
    });
  });

  describe('fetchStatus', () => {
    it('calls IPC and sets status', async () => {
      const store = useFederationHardeningStore();
      mockInvoke.mockResolvedValueOnce({ success: true, status: { circuitBreakers: {} } });
      await store.fetchStatus();
      expect(store.status).toBeDefined();
    });

    it('sets error on failure', async () => {
      const store = useFederationHardeningStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Failed' });
      await store.fetchStatus();
      expect(store.error).toBe('Failed');
    });
  });

  describe('resetCircuit', () => {
    it('calls IPC and refetches', async () => {
      const store = useFederationHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, result: {} })
        .mockResolvedValueOnce({ success: true, breakers: [] });
      await store.resetCircuit('node1');
      expect(mockInvoke).toHaveBeenCalledWith('federation-hardening:reset-circuit', 'node1');
    });
  });
});
