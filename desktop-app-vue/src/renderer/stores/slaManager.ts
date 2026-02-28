import { defineStore } from 'pinia';

export interface SLAContract {
  id: string;
  name: string;
  org_id: string;
  partner_org_id: string;
  status: string;
  guarantees: Record<string, any>;
  penalties: Record<string, any>;
  rewards: Record<string, any>;
  valid_from: number;
  valid_until: number;
  created_at: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useSLAManagerStore = defineStore('slaManager', {
  state: () => ({
    contracts: [] as SLAContract[],
    violations: [] as any[],
    dashboard: null as any,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeContracts: (state) => state.contracts.filter(c => c.status === 'active'),
    unresolvedViolations: (state) => state.violations.filter((v: any) => !v.resolved),
    violationCount: (state) => state.violations.length,
  },

  actions: {
    async fetchContracts(filter?: { status?: string; orgId?: string; limit?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('sla:list-contracts', filter);
        if (result.success) this.contracts = result.contracts || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async createContract(name: string, guarantees?: any, orgId?: string, partnerOrgId?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('sla:create-contract', { name, guarantees, orgId, partnerOrgId });
        if (result.success) await this.fetchContracts();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchViolations(filter?: { contractId?: string; severity?: string; limit?: number }) {
      try {
        const result = await invoke('sla:get-violations', filter);
        if (result.success) this.violations = result.violations || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async checkCompliance(contractId: string) {
      this.loading = true;
      try {
        const result = await invoke('sla:check-compliance', contractId);
        if (result.success) await this.fetchViolations({ contractId });
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchDashboard() {
      try {
        const result = await invoke('sla:get-dashboard');
        if (result.success) this.dashboard = result.dashboard;
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
