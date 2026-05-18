import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useEvoMapFederationStore = defineStore('evoMapFederation', {
  state: () => ({ hubs: [] as any[], pressureReport: null as any, loading: false, error: null as string | null }),
  getters: { onlineHubs: (state) => state.hubs.filter((h: any) => h.status === 'online') },
  actions: {
    async fetchHubs(filter?: any) {
      this.loading = true;
      try { const r = await invoke('evomap-federation:list-hubs', filter); if (r.success) this.hubs = r.hubs || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async syncGenes(params: any) { try { return await invoke('evomap-federation:sync-genes', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchPressureReport() {
      try { const r = await invoke('evomap-federation:get-pressure-report'); if (r.success) this.pressureReport = r.report; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async recombineGenes(params: any) { try { return await invoke('evomap-federation:recombine-genes', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async getLineage(geneId: string) { try { return await invoke('evomap-federation:get-lineage', geneId); } catch (e: any) { return { success: false, error: e.message }; } },
  },
});
