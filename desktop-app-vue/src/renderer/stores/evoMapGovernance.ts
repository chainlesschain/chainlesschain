import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useEvoMapGovernanceStore = defineStore('evoMapGovernance', {
  state: () => ({ dashboard: null as any, loading: false, error: null as string | null }),
  actions: {
    async registerOwnership(params: any) { try { return await invoke('evomap-gov:register-ownership', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async traceContributions(geneId: string) { try { return await invoke('evomap-gov:trace-contributions', geneId); } catch (e: any) { return { success: false, error: e.message }; } },
    async createProposal(params: any) { try { return await invoke('evomap-gov:create-proposal', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async castVote(params: any) { try { return await invoke('evomap-gov:cast-vote', params); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchDashboard() {
      this.loading = true;
      try { const r = await invoke('evomap-gov:get-governance-dashboard'); if (r.success) this.dashboard = r; return r; }
      catch (e: any) { this.error = e.message; return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
  },
});
