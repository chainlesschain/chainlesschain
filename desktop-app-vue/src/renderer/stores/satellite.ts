import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useSatelliteStore = defineStore('satellite', {
  state: () => ({ messages: [] as any[], recoveryStatus: null as any, loading: false, error: null as string | null }),
  actions: {
    async sendMessage(params: any) {
      try { return await invoke('satellite:send-message', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchMessages(filter?: any) {
      this.loading = true;
      try { const r = await invoke('satellite:get-messages', filter); if (r.success) this.messages = r.messages || []; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async syncSignatures() { try { return await invoke('satellite:sync-signatures'); } catch (e: any) { return { success: false, error: e.message }; } },
    async emergencyRevoke(keyId: string) { try { return await invoke('satellite:emergency-revoke', keyId); } catch (e: any) { return { success: false, error: e.message }; } },
    async fetchRecoveryStatus() {
      try { const r = await invoke('satellite:get-recovery-status'); if (r.success) this.recoveryStatus = r.status; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
