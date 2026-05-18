import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useAntiCensorshipStore = defineStore('antiCensorship', {
  state: () => ({ torStatus: null as any, connectivityReport: null as any, loading: false, error: null as string | null }),
  actions: {
    async startTor() { this.loading = true; try { const r = await invoke('anti-censorship:start-tor'); if (r.success) this.torStatus = r.status; return r; } catch (e: any) { return { success: false, error: e.message }; } finally { this.loading = false; } },
    async fetchTorStatus() { try { const r = await invoke('anti-censorship:get-tor-status'); if (r.success) this.torStatus = r.status; return r; } catch (e: any) { return { success: false, error: e.message }; } },
    async enableDomainFronting(params?: any) { try { return await invoke('anti-censorship:enable-domain-fronting', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async startMesh() { try { return await invoke('anti-censorship:start-mesh'); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchConnectivityReport() {
      try { const r = await invoke('anti-censorship:get-connectivity-report'); if (r.success) this.connectivityReport = r.report; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
