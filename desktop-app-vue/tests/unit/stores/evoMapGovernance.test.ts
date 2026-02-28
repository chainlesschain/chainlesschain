import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { mockInvoke } = vi.hoisted(() => {
  const m = vi.fn();
  (globalThis as any).window = { electronAPI: { invoke: m } };
  (window as any).electronAPI = { invoke: m };
  return { mockInvoke: m };
});

import { useEvoMapGovernanceStore } from '../../../src/renderer/stores/evoMapGovernance';

describe('evoMapGovernance store', () => {
  beforeEach(() => { setActivePinia(createPinia()); mockInvoke.mockReset(); });

  it('should create proposal', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, proposalId: 'prop-1' });
    const store = useEvoMapGovernanceStore();
    const r = await store.createProposal({ title: 'New gene policy', description: 'Require reviews' });
    expect(r.success).toBe(true);
    expect(r.proposalId).toBe('prop-1');
    expect(mockInvoke).toHaveBeenCalledWith('evomap-gov:create-proposal', { title: 'New gene policy', description: 'Require reviews' });
  });

  it('should cast vote', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, vote: { proposalId: 'prop-1', choice: 'approve' } });
    const store = useEvoMapGovernanceStore();
    const r = await store.castVote({ proposalId: 'prop-1', choice: 'approve' });
    expect(r.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('evomap-gov:cast-vote', { proposalId: 'prop-1', choice: 'approve' });
  });

  it('should fetch dashboard', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, activeProposals: 3, totalVotes: 42, recentDecisions: [] });
    const store = useEvoMapGovernanceStore();
    await store.fetchDashboard();
    expect(store.dashboard).toBeDefined();
    expect(store.dashboard.activeProposals).toBe(3);
    expect(store.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('evomap-gov:get-governance-dashboard');
  });

  it('should handle dashboard fetch error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Connection refused'));
    const store = useEvoMapGovernanceStore();
    const r = await store.fetchDashboard();
    expect(r.success).toBe(false);
    expect(store.error).toBe('Connection refused');
    expect(store.loading).toBe(false);
  });
});
