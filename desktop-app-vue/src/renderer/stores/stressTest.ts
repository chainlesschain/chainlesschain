import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useStressTestStore = defineStore('stressTest', {
  state: () => ({
    runs: [] as any[],
    currentResult: null as any,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    completedRuns: (state) => state.runs.filter((r: any) => r.status === 'complete'),
    latestRun: (state) => state.runs[0] || null,
  },

  actions: {
    async startTest(params?: { name?: string; nodeCount?: number; concurrentTasks?: number; durationMs?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('stress-test:start', params);
        if (result.success) {
          this.currentResult = result.result;
          await this.fetchRuns();
        } else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async stopTest() {
      try {
        const result = await invoke('stress-test:stop');
        if (result.success) await this.fetchRuns();
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async fetchRuns(filter?: { limit?: number }) {
      try {
        const result = await invoke('stress-test:get-runs', filter);
        if (result.success) this.runs = result.runs || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async fetchResults(runId: string) {
      try {
        const result = await invoke('stress-test:get-results', runId);
        if (result.success) this.currentResult = result.results;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
