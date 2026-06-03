import { defineStore } from 'pinia';

export interface SIEMTarget {
  id: string;
  target_type: string;
  target_url: string;
  format: string;
  exported_count: number;
  last_export_at: number | null;
  status: string;
  created_at: number;
}

export interface SIEMExportStats {
  targets: Array<{
    id: string;
    type: string;
    exported_count: number;
    last_export_at: number | null;
  }>;
  totalExported: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useSiemStore = defineStore('siem', {
  state: () => ({
    targets: [] as SIEMTarget[],
    stats: null as SIEMExportStats | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeTargets: (state) => state.targets.filter(t => t.status === 'active'),
    totalExported: (state) => state.stats?.totalExported || 0,
  },

  actions: {
    async fetchTargets() {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('siem:list-targets');
        if (result.success) this.targets = result.targets || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async addTarget(type: string, url: string, format: string, config?: any) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('siem:add-target', { type, url, format, config });
        if (result.success) await this.fetchTargets();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async exportLogs(targetId?: string, limit?: number) {
      this.loading = true;
      try {
        const result = await invoke('siem:export-logs', { targetId, limit });
        if (result.success) await this.fetchStats();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchStats() {
      try {
        const result = await invoke('siem:get-stats');
        if (result.success) this.stats = result.stats;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
