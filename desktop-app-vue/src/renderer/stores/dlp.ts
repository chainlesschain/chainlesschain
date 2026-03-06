import { defineStore } from 'pinia';

export interface DLPPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  channels: string[];
  patterns: string[];
  keywords: string[];
  action: string;
  severity: string;
  created_at: number;
  updated_at: number;
}

export interface DLPIncident {
  id: string;
  policy_id: string;
  channel: string;
  action_taken: string;
  matched_patterns: string;
  severity: string;
  user_id: string;
  created_at: number;
  resolved_at: number | null;
  resolution: string | null;
}

export interface DLPStats {
  scanned: number;
  blocked: number;
  alerted: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useDlpStore = defineStore('dlp', {
  state: () => ({
    policies: [] as DLPPolicy[],
    incidents: [] as DLPIncident[],
    stats: null as DLPStats | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activePolicies: (state) => state.policies.filter(p => p.enabled),
    unresolvedIncidents: (state) => state.incidents.filter(i => !i.resolved_at),
  },

  actions: {
    async fetchPolicies(enabled?: boolean) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('dlp:list-policies', { enabled });
        if (result.success) this.policies = result.policies || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async createPolicy(policy: Partial<DLPPolicy>) {
      this.loading = true;
      try {
        const result = await invoke('dlp:create-policy', policy);
        if (result.success) await this.fetchPolicies();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async updatePolicy(id: string, updates: Partial<DLPPolicy>) {
      this.loading = true;
      try {
        const result = await invoke('dlp:update-policy', { id, ...updates });
        if (result.success) await this.fetchPolicies();
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async deletePolicy(id: string) {
      this.loading = true;
      try {
        const result = await invoke('dlp:delete-policy', { id });
        if (result.success) await this.fetchPolicies();
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchIncidents(params?: { channel?: string; severity?: string; limit?: number }) {
      this.loading = true;
      try {
        const result = await invoke('dlp:get-incidents', params || {});
        if (result.success) this.incidents = result.incidents || [];
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async resolveIncident(incidentId: string, resolution: string) {
      try {
        const result = await invoke('dlp:resolve-incident', { id: incidentId, resolution });
        if (result.success) await this.fetchIncidents();
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async scanContent(content: string, channel: string, userId?: string) {
      try {
        return await invoke('dlp:scan-content', { content, channel, userId });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async fetchStats() {
      try {
        const result = await invoke('dlp:get-stats');
        if (result.success) this.stats = result.stats;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
