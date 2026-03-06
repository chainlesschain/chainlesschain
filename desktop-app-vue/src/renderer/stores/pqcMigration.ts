import { defineStore } from 'pinia';

export interface PQCKey {
  id: string;
  algorithm: string;
  purpose: string;
  public_key: string;
  key_size: number;
  hybrid_mode: number;
  classical_algorithm: string | null;
  status: string;
  created_at: number;
}

export interface MigrationPlan {
  id: string;
  plan_name: string;
  source_algorithm: string;
  target_algorithm: string;
  total_keys: number;
  migrated_keys: number;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const usePqcMigrationStore = defineStore('pqcMigration', {
  state: () => ({
    keys: [] as PQCKey[],
    migrationPlans: [] as MigrationPlan[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeKeys: (state) => state.keys.filter(k => k.status === 'active'),
    hybridKeys: (state) => state.keys.filter(k => k.hybrid_mode === 1),
    completedMigrations: (state) => state.migrationPlans.filter(p => p.status === 'completed'),
  },

  actions: {
    async fetchKeys(filter?: { algorithm?: string; status?: string }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('pqc:list-keys', filter);
        if (result.success) this.keys = result.keys || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async generateKey(algorithm: string, purpose: string, hybridMode?: boolean, classicalAlgorithm?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('pqc:generate-key', { algorithm, purpose, hybridMode, classicalAlgorithm });
        if (result.success) await this.fetchKeys();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchMigrationStatus() {
      try {
        const result = await invoke('pqc:get-migration-status');
        if (result.success) this.migrationPlans = result.plans || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async executeMigration(planName: string, sourceAlgorithm: string, targetAlgorithm: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('pqc:execute-migration', { planName, sourceAlgorithm, targetAlgorithm });
        if (result.success) {
          await this.fetchMigrationStatus();
          await this.fetchKeys();
        } else {
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
  },
});
