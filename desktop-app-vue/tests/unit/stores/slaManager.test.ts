import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useSLAManagerStore } from '../../../src/renderer/stores/slaManager';

describe('useSLAManagerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('contracts starts as empty', () => {
      const store = useSLAManagerStore();
      expect(store.contracts).toEqual([]);
    });

    it('violations starts as empty', () => {
      const store = useSLAManagerStore();
      expect(store.violations).toEqual([]);
    });
  });

  describe('Getters', () => {
    it('activeContracts filters active', () => {
      const store = useSLAManagerStore();
      store.contracts = [{ status: 'active' } as any, { status: 'expired' } as any];
      expect(store.activeContracts).toHaveLength(1);
    });

    it('unresolvedViolations filters unresolved', () => {
      const store = useSLAManagerStore();
      store.violations = [{ resolved: false } as any, { resolved: true } as any];
      expect(store.unresolvedViolations).toHaveLength(1);
    });

    it('violationCount returns total', () => {
      const store = useSLAManagerStore();
      store.violations = [{ id: '1' } as any, { id: '2' } as any];
      expect(store.violationCount).toBe(2);
    });
  });

  describe('fetchContracts', () => {
    it('calls IPC and sets contracts', async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockResolvedValueOnce({ success: true, contracts: [{ id: '1' }] });
      await store.fetchContracts();
      expect(store.contracts).toHaveLength(1);
    });

    it('sets error on failure', async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'DB error' });
      await store.fetchContracts();
      expect(store.error).toBe('DB error');
    });
  });

  describe('createContract', () => {
    it('calls IPC and refetches', async () => {
      const store = useSLAManagerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, contract: { id: '1' } })
        .mockResolvedValueOnce({ success: true, contracts: [] });
      await store.createContract('test-contract');
      expect(mockInvoke).toHaveBeenCalledWith('sla:create-contract', { name: 'test-contract', guarantees: undefined, orgId: undefined, partnerOrgId: undefined });
    });
  });

  describe('checkCompliance', () => {
    it('calls IPC and fetches violations', async () => {
      const store = useSLAManagerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, isCompliant: true })
        .mockResolvedValueOnce({ success: true, violations: [] });
      await store.checkCompliance('c1');
      expect(mockInvoke).toHaveBeenCalledWith('sla:check-compliance', 'c1');
    });

    it('catches exceptions', async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockRejectedValueOnce(new Error('SLA error'));
      const result = await store.checkCompliance('c1');
      expect(store.error).toBe('SLA error');
      expect(result).toEqual({ success: false, error: 'SLA error' });
    });
  });
});
