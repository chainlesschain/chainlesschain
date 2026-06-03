import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useReputationOptimizerStore = defineStore('reputationOptimizer', {
  state: () => ({
    history: [] as any[],
    analytics: [] as any[],
    latestOptimization: null as any,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    bestImprovement: (state) => {
      if (state.history.length === 0) return 0;
      return Math.max(...state.history.map((h: any) => h.improvement || 0));
    },
    anomalyCount: (state) => state.analytics.filter((a: any) => a.anomaly_detected).length,
  },

  actions: {
    async runOptimization(params?: { iterations?: number; parameters?: any }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('reputation-optimizer:run-optimization', params);
        if (result.success) {
          this.latestOptimization = result.result;
          await this.fetchHistory();
        } else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchAnalytics(filter?: { nodeId?: string; limit?: number }) {
      try {
        const result = await invoke('reputation-optimizer:get-analytics', filter);
        if (result.success) this.analytics = result.analytics || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async detectAnomalies(params?: { nodeScores?: any[] }) {
      this.loading = true;
      try {
        const result = await invoke('reputation-optimizer:detect-anomalies', params);
        if (result.success) await this.fetchAnalytics();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchHistory(filter?: { limit?: number }) {
      try {
        const result = await invoke('reputation-optimizer:get-history', filter);
        if (result.success) this.history = result.history || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
