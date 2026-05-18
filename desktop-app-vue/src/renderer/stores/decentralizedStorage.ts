import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useDecentralizedStorageStore = defineStore('decentralizedStorage', {
  state: () => ({ deals: [] as any[], storageStats: null as any, loading: false, error: null as string | null }),
  getters: { activeDeals: (state) => state.deals.filter((d: any) => d.status === 'active') },
  actions: {
    async storeToFilecoin(params: any) { try { return await invoke('dstorage:store-to-filecoin', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async getDealStatus(dealId: string) { try { return await invoke('dstorage:get-deal-status', dealId); } catch (e: any) { return { success: false, error: e.message }; } },
    async distributeContent(params: any) { try { return await invoke('dstorage:distribute-content', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async getVersionHistory(cid: string) { try { return await invoke('dstorage:get-version-history', cid); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchStorageStats() {
      try { const r = await invoke('dstorage:get-storage-stats'); if (r.success) this.storageStats = r.stats; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
