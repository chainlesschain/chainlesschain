import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useProtocolFusionStore = defineStore('protocolFusion', {
  state: () => ({ feed: [] as any[], identityMap: [] as any[], protocolStatus: null as any, loading: false, error: null as string | null }),
  actions: {
    async fetchFeed(filter?: any) {
      this.loading = true;
      try { const r = await invoke('protocol-fusion:get-unified-feed', filter); if (r.success) this.feed = r.feed || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async sendMessage(params: any) { try { return await invoke('protocol-fusion:send-message', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async mapIdentity(params: any) { try { return await invoke('protocol-fusion:map-identity', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchIdentityMap(didId?: string) {
      try { const r = await invoke('protocol-fusion:get-identity-map', didId); if (r.success) this.identityMap = Array.isArray(r.map) ? r.map : r.map ? [r.map] : []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchProtocolStatus() {
      try { const r = await invoke('protocol-fusion:get-protocol-status'); if (r.success) this.protocolStatus = r.status; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
