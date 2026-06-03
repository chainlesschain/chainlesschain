import { defineStore } from 'pinia';

export interface PerformanceBaselineRecord {
  id: string;
  name: string;
  version: string;
  status: string;
  metrics: Record<string, any>;
  environment: Record<string, any>;
  sample_count: number;
  created_at: number;
  completed_at: number | null;
}

export interface SecurityAuditReport {
  id: string;
  name: string;
  status: string;
  findings: any[];
  risk_score: number;
  summary: Record<string, any>;
  created_at: number;
  completed_at: number | null;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useHardeningStore = defineStore('hardening', {
  state: () => ({
    baselines: [] as PerformanceBaselineRecord[],
    auditReports: [] as SecurityAuditReport[],
    comparison: null as any,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    latestBaseline: (state) => state.baselines[0] || null,
    latestAudit: (state) => state.auditReports[0] || null,
    hasRegressions: (state) => state.comparison?.hasRegressions || false,
  },

  actions: {
    async collectBaseline(name: string, version?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('hardening:collect-baseline', { name, version });
        if (result.success) await this.fetchBaselines();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async compareBaseline(baselineId: string, currentId?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('hardening:compare-baseline', { baselineId, currentId });
        if (result.success) this.comparison = result.comparison;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchBaselines(filter?: { limit?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('hardening:get-baselines', filter);
        if (result.success) this.baselines = result.baselines || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async runSecurityAudit(name?: string, categories?: string[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('hardening:run-security-audit', { name, categories });
        if (result.success) await this.fetchAuditReports();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchAuditReports(filter?: { limit?: number }) {
      try {
        const result = await invoke('hardening:get-audit-reports', filter);
        if (result.success) this.auditReports = result.reports || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async fetchAuditReport(reportId: string) {
      try {
        const result = await invoke('hardening:get-audit-report', reportId);
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
