import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useHsmAdapterStore = defineStore('hsmAdapter', {
  state: () => ({ adapters: [] as any[], complianceStatus: null as any, loading: false, error: null as string | null }),
  getters: { connectedAdapters: (state) => state.adapters.filter((a: any) => a.status === 'connected') },
  actions: {
    async fetchAdapters(filter?: any) {
      this.loading = true;
      try { const r = await invoke('hsm:list-adapters', filter); if (r.success) this.adapters = r.adapters || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async connectDevice(params: any) {
      try { const r = await invoke('hsm:connect-device', params); if (r.success) await this.fetchAdapters(); return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async executeOperation(params: any) { try { return await invoke('hsm:execute-operation', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchComplianceStatus() {
      try { const r = await invoke('hsm:get-compliance-status'); if (r.success) this.complianceStatus = r.status; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
