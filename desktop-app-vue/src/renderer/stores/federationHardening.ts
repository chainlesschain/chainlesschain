import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useFederationHardeningStore = defineStore('federationHardening', {
  state: () => ({
    status: null as any,
    circuitBreakers: [] as any[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    openCircuits: (state) => state.circuitBreakers.filter((b: any) => b.state === 'open'),
    healthyNodes: (state) => state.status?.healthChecks?.healthy || 0,
  },

  actions: {
    async fetchStatus() {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('federation-hardening:get-status');
        if (result.success) this.status = result.status;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchCircuitBreakers() {
      try {
        const result = await invoke('federation-hardening:get-circuit-breakers');
        if (result.success) this.circuitBreakers = result.breakers || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async resetCircuit(nodeId: string) {
      this.loading = true;
      try {
        const result = await invoke('federation-hardening:reset-circuit', nodeId);
        if (result.success) await this.fetchCircuitBreakers();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async runHealthCheck(nodeId?: string) {
      this.loading = true;
      try {
        const result = await invoke('federation-hardening:run-health-check', nodeId);
        if (result.success) await this.fetchStatus();
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
