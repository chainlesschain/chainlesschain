import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useCollaborationGovernanceStore } from '../../../src/renderer/stores/collaborationGovernance';

describe('useCollaborationGovernanceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('pendingDecisions starts as empty', () => {
      const store = useCollaborationGovernanceStore();
      expect(store.pendingDecisions).toEqual([]);
    });

    it('autonomyLevel starts as null', () => {
      const store = useCollaborationGovernanceStore();
      expect(store.autonomyLevel).toBeNull();
    });
  });

  describe('Getters', () => {
    it('pendingCount returns count', () => {
      const store = useCollaborationGovernanceStore();
      store.pendingDecisions = [{ id: '1' } as any, { id: '2' } as any];
      expect(store.pendingCount).toBe(2);
    });

    it('currentLevel returns default when null', () => {
      const store = useCollaborationGovernanceStore();
      expect(store.currentLevel).toBe(2);
    });

    it('trackRecord returns 0 when null', () => {
      const store = useCollaborationGovernanceStore();
      expect(store.trackRecord).toBe(0);
    });
  });

  describe('fetchPendingDecisions', () => {
    it('calls IPC and sets decisions', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: true, decisions: [{ id: '1' }] });
      await store.fetchPendingDecisions();
      expect(store.pendingDecisions).toHaveLength(1);
    });

    it('sets error on failure', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Failed' });
      await store.fetchPendingDecisions();
      expect(store.error).toBe('Failed');
    });
  });

  describe('approveDecision', () => {
    it('calls IPC and refetches', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, decision: { id: '1' } })
        .mockResolvedValueOnce({ success: true, decisions: [] });
      await store.approveDecision('d1', 'admin', 'Approved');
      expect(mockInvoke).toHaveBeenCalledWith('collab-governance:approve-decision', { decisionId: 'd1', reviewer: 'admin', comment: 'Approved' });
    });

    it('catches exceptions', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockRejectedValueOnce(new Error('Approve failed'));
      const result = await store.approveDecision('d1');
      expect(store.error).toBe('Approve failed');
      expect(result).toEqual({ success: false, error: 'Approve failed' });
    });
  });

  describe('rejectDecision', () => {
    it('calls IPC and refetches', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, decision: { id: '1' } })
        .mockResolvedValueOnce({ success: true, decisions: [] });
      await store.rejectDecision('d1');
      expect(mockInvoke).toHaveBeenCalledWith('collab-governance:reject-decision', { decisionId: 'd1', reviewer: undefined, comment: undefined });
    });
  });

  describe('fetchAutonomyLevel', () => {
    it('calls IPC and sets level', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: true, level: { scope: 'global', level: 5 } });
      await store.fetchAutonomyLevel();
      expect(store.autonomyLevel?.level).toBe(5);
    });
  });

  describe('setAutonomyPolicy', () => {
    it('calls IPC and sets policy', async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: true, policy: { level: 7 } });
      await store.setAutonomyPolicy({ level: 7 });
      expect(store.autonomyLevel?.level).toBe(7);
    });
  });
});
