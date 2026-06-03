import { defineStore } from 'pinia';

export interface FirmwareVersion {
  id: string;
  version: string;
  channel: string;
  release_notes: string;
  file_size: number;
  checksum: string;
  download_url: string;
  is_critical: number;
  released_at: number;
}

export interface FirmwareUpdate {
  id: string;
  version_id: string;
  version: string;
  status: string;
  progress: number;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useFirmwareOtaStore = defineStore('firmwareOta', {
  state: () => ({
    availableUpdates: [] as FirmwareVersion[],
    updateHistory: [] as FirmwareUpdate[],
    currentUpdate: null as FirmwareUpdate | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    hasUpdate: (state) => state.availableUpdates.length > 0,
    criticalUpdates: (state) => state.availableUpdates.filter(u => u.is_critical === 1),
    isUpdating: (state) => state.currentUpdate !== null,
  },

  actions: {
    async checkUpdates(currentVersion?: string, channel?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('firmware:check-updates', { currentVersion, channel });
        if (result.success && result.availableUpdate) {
          this.availableUpdates = [result.availableUpdate];
        } else if (!result.success) {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchVersions(channel?: string, limit?: number) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('firmware:list-versions', { channel, limit });
        if (result.success) this.availableUpdates = result.versions || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async startUpdate(versionId: string, allowRollback?: boolean) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('firmware:start-update', { versionId, allowRollback });
        if (result.success) {
          this.currentUpdate = result.update;
          await this.fetchHistory();
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
        this.currentUpdate = null;
      }
    },

    async fetchHistory(limit?: number) {
      try {
        const result = await invoke('firmware:get-history', { limit });
        if (result.success) this.updateHistory = result.history || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
