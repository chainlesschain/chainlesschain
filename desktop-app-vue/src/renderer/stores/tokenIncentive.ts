import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useTokenIncentiveStore = defineStore('tokenIncentive', {
  state: () => ({
    balance: 0,
    transactions: [] as any[],
    rewardsSummary: null as any,
    loading: false,
    error: null as string | null,
  }),
  getters: {
    rewardTransactions: (state) => state.transactions.filter((t: any) => t.type === 'reward'),
  },
  actions: {
    async fetchBalance() {
      try { const r = await invoke('token:get-balance'); if (r.success) this.balance = r.balance; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchTransactions(filter?: any) {
      this.loading = true;
      try { const r = await invoke('token:get-transactions', filter); if (r.success) this.transactions = r.transactions || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async submitContribution(params: any) {
      try { const r = await invoke('token:submit-contribution', params); if (r.success) await this.fetchBalance(); return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchPricing(params?: any) {
      try { return await invoke('token:get-pricing', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchRewardsSummary() {
      try { const r = await invoke('token:get-rewards-summary'); if (r.success) this.rewardsSummary = r.summary; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
