import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useTrustRootStore = defineStore('trustRoot', {
  state: () => ({ status: null as any, bootStatus: null as any, loading: false, error: null as string | null }),
  actions: {
    async fetchStatus() {
      this.loading = true;
      try { const r = await invoke('trust-root:get-status'); if (r.success) this.status = r.status; return r; }
      catch (e: any) { this.error = e.message; return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async verifyChain(deviceId: string) {
      try { return await invoke('trust-root:verify-chain', deviceId); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async syncKeys(params: any) {
      try { return await invoke('trust-root:sync-keys', params); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async bindFingerprint(deviceId: string, fingerprint: string) {
      try { return await invoke('trust-root:bind-fingerprint', { deviceId, fingerprint }); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async fetchBootStatus() {
      try { const r = await invoke('trust-root:get-boot-status'); if (r.success) this.bootStatus = r.bootStatus; return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
