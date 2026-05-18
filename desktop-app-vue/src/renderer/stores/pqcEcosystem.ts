import { defineStore } from 'pinia';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const usePQCEcosystemStore = defineStore('pqcEcosystem', {
  state: () => ({ coverage: null as any, loading: false, error: null as string | null }),
  actions: {
    async fetchCoverage() {
      this.loading = true;
      try { const r = await invoke('pqc-ecosystem:get-coverage'); if (r.success) this.coverage = r.coverage; return r; }
      catch (e: any) { this.error = e.message; return { success: false, error: e.message }; }
      finally { this.loading = false; }
    },
    async migrateSubsystem(params: any) {
      try { const r = await invoke('pqc-ecosystem:migrate-subsystem', params); if (r.success) await this.fetchCoverage(); return r; }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async updateFirmwarePQC(version: string) {
      try { return await invoke('pqc-ecosystem:update-firmware-pqc', version); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
    async verifyMigration() {
      try { return await invoke('pqc-ecosystem:verify-migration'); }
      catch (e: any) { return { success: false, error: e.message }; }
    },
  },
});
