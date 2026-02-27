/**
 * useGovernanceStore -- Pinia store unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useGovernanceStore } from '../../../src/renderer/stores/governance';

describe('useGovernanceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  describe('Initial state', () => {
    it('proposals starts as empty array', () => {
      const store = useGovernanceStore();
      expect(store.proposals).toEqual([]);
    });

    it('currentAnalysis starts as null', () => {
      const store = useGovernanceStore();
      expect(store.currentAnalysis).toBeNull();
    });

    it('loading and error start correctly', () => {
      const store = useGovernanceStore();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('Getters', () => {
    it('activeProposals filters by status active', () => {
      const store = useGovernanceStore();
      store.proposals = [
        { id: '1', status: 'active' } as any,
        { id: '2', status: 'draft' } as any,
      ];
      expect(store.activeProposals).toHaveLength(1);
    });

    it('draftProposals filters by status draft', () => {
      const store = useGovernanceStore();
      store.proposals = [
        { id: '1', status: 'draft' } as any,
        { id: '2', status: 'active' } as any,
      ];
      expect(store.draftProposals).toHaveLength(1);
    });

    it('proposalCount returns total count', () => {
      const store = useGovernanceStore();
      store.proposals = [{ id: '1' } as any, { id: '2' } as any];
      expect(store.proposalCount).toBe(2);
    });
  });

  describe('fetchProposals', () => {
    it('calls IPC and sets proposals on success', async () => {
      const store = useGovernanceStore();
      const proposals = [{ id: '1', title: 'Test' }];
      mockInvoke.mockResolvedValueOnce({ success: true, proposals });

      await store.fetchProposals();
      expect(mockInvoke).toHaveBeenCalledWith('governance:list-proposals', undefined);
      expect(store.proposals).toEqual(proposals);
    });

    it('sets error on failure', async () => {
      const store = useGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'DB error' });

      await store.fetchProposals();
      expect(store.error).toBe('DB error');
    });

    it('catches exceptions', async () => {
      const store = useGovernanceStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC down'));

      const result = await store.fetchProposals();
      expect(store.error).toBe('IPC down');
      expect(result).toEqual({ success: false, error: 'IPC down' });
    });
  });

  describe('createProposal', () => {
    it('calls IPC and refetches on success', async () => {
      const store = useGovernanceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, proposal: { id: '1' } })
        .mockResolvedValueOnce({ success: true, proposals: [{ id: '1' }] });

      await store.createProposal('Test', 'Description', 'feature_request');
      expect(mockInvoke).toHaveBeenCalledWith('governance:create-proposal', { title: 'Test', description: 'Description', type: 'feature_request', proposerDid: undefined });
    });

    it('sets error on failure', async () => {
      const store = useGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Title required' });

      await store.createProposal('', '');
      expect(store.error).toBe('Title required');
    });
  });

  describe('analyzeImpact', () => {
    it('calls IPC and sets currentAnalysis', async () => {
      const store = useGovernanceStore();
      const analysis = { impact_level: 'medium', risk_score: 0.5 };
      mockInvoke.mockResolvedValueOnce({ success: true, analysis });

      await store.analyzeImpact('p1');
      expect(mockInvoke).toHaveBeenCalledWith('governance:analyze-impact', { proposalId: 'p1' });
      expect(store.currentAnalysis).toEqual(analysis);
    });

    it('catches exceptions', async () => {
      const store = useGovernanceStore();
      mockInvoke.mockRejectedValueOnce(new Error('Analysis failed'));

      const result = await store.analyzeImpact('p1');
      expect(store.error).toBe('Analysis failed');
      expect(result).toEqual({ success: false, error: 'Analysis failed' });
    });
  });

  describe('predictVote', () => {
    it('calls IPC and returns prediction', async () => {
      const store = useGovernanceStore();
      const prediction = { predicted_outcome: 'pass', confidence: 0.8 };
      mockInvoke.mockResolvedValueOnce({ success: true, prediction });

      const result = await store.predictVote('p1');
      expect(result.success).toBe(true);
      expect(result.prediction).toEqual(prediction);
    });
  });
});
