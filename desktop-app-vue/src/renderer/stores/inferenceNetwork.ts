import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useInferenceNetworkStore = defineStore('inferenceNetwork', {
  state: () => ({
    nodes: [] as any[],
    tasks: [] as any[],
    networkStats: null as any,
    loading: false,
    error: null as string | null,
  }),
  getters: {
    onlineNodes: (state) => state.nodes.filter((n: any) => n.status === 'online'),
    nodeCount: (state) => state.nodes.length,
  },
  actions: {
    async registerNode(params: any) {
      this.loading = true;
      try { const r = await invoke('inference:register-node', params); if (r.success) await this.fetchNodes(); else this.error = r.error; return r; }
      catch (e: any) { this.error = e.message; return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async fetchNodes(filter?: any) {
      try { const r = await invoke('inference:list-nodes', filter); if (r.success) this.nodes = r.nodes || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async submitTask(params: any) {
      try { return await invoke('inference:submit-task', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async getTaskStatus(taskId: string) {
      try { return await invoke('inference:get-task-status', taskId); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async startFederatedRound(params: any) {
      try { return await invoke('inference:start-federated-round', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchNetworkStats() {
      try { const r = await invoke('inference:get-network-stats'); if (r.success) this.networkStats = r; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
