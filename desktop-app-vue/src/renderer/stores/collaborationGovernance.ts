import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useCollaborationGovernanceStore = defineStore('collaborationGovernance', {
  state: () => ({
    pendingDecisions: [] as any[],
    autonomyLevel: null as any,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    pendingCount: (state) => state.pendingDecisions.length,
    currentLevel: (state) => state.autonomyLevel?.level ?? 2,
    trackRecord: (state) => state.autonomyLevel?.track_record ?? 0,
  },

  actions: {
    async fetchPendingDecisions(filter?: { decisionType?: string; limit?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('collab-governance:get-pending', filter);
        if (result.success) this.pendingDecisions = result.decisions || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async approveDecision(decisionId: string, reviewer?: string, comment?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('collab-governance:approve-decision', { decisionId, reviewer, comment });
        if (result.success) await this.fetchPendingDecisions();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async rejectDecision(decisionId: string, reviewer?: string, comment?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('collab-governance:reject-decision', { decisionId, reviewer, comment });
        if (result.success) await this.fetchPendingDecisions();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchAutonomyLevel(scope?: string) {
      try {
        const result = await invoke('collab-governance:get-autonomy-level', scope);
        if (result.success) this.autonomyLevel = result.level;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async setAutonomyPolicy(params: { scope?: string; level?: number; requireApprovalFor?: string[] }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('collab-governance:set-autonomy-policy', params);
        if (result.success) this.autonomyLevel = result.policy;
        else this.error = result.error;
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
