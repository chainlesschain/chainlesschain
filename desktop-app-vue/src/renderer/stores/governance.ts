import { defineStore } from 'pinia';

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  type: string;
  proposer_did: string;
  status: string;
  impact_level: string | null;
  impact_analysis: any;
  vote_yes: number;
  vote_no: number;
  vote_abstain: number;
  voting_starts_at: number | null;
  voting_ends_at: number | null;
  created_at: number;
}

export interface ImpactAnalysis {
  impact_level: string;
  affected_components: string[];
  risk_score: number;
  benefit_score: number;
  estimated_effort: string;
  community_sentiment: string;
  recommendations: string[];
  analyzed_at: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useGovernanceStore = defineStore('governance', {
  state: () => ({
    proposals: [] as GovernanceProposal[],
    currentAnalysis: null as ImpactAnalysis | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeProposals: (state) => state.proposals.filter(p => p.status === 'active'),
    draftProposals: (state) => state.proposals.filter(p => p.status === 'draft'),
    proposalCount: (state) => state.proposals.length,
  },

  actions: {
    async fetchProposals(filter?: { status?: string; type?: string; limit?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('governance:list-proposals', filter);
        if (result.success) this.proposals = result.proposals || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async createProposal(title: string, description: string, type?: string, proposerDid?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('governance:create-proposal', { title, description, type, proposerDid });
        if (result.success) await this.fetchProposals();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async analyzeImpact(proposalId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('governance:analyze-impact', { proposalId });
        if (result.success) this.currentAnalysis = result.analysis;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async predictVote(proposalId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('governance:predict-vote', { proposalId });
        if (!result.success) this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },
  },
});
