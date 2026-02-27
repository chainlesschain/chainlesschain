import { defineStore } from 'pinia';

export interface TerraformWorkspace {
  id: string;
  name: string;
  description: string;
  terraform_version: string;
  working_directory: string;
  auto_apply: number;
  status: string;
  last_run_id: string | null;
  last_run_at: number | null;
  state_version: number;
  variables: Record<string, any>;
  providers: string[];
  created_at: number;
}

export interface TerraformRun {
  id: string;
  workspace_id: string;
  run_type: string;
  status: string;
  plan_output: string | null;
  apply_output: string | null;
  resources_added: number;
  resources_changed: number;
  resources_destroyed: number;
  triggered_by: string;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useTerraformStore = defineStore('terraform', {
  state: () => ({
    workspaces: [] as TerraformWorkspace[],
    runs: [] as TerraformRun[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    activeWorkspaces: (state) => state.workspaces.filter(w => w.status === 'active'),
    recentRuns: (state) => state.runs.slice(0, 10),
    totalResources: (state) => state.runs.reduce((sum, r) => sum + r.resources_added, 0),
  },

  actions: {
    async fetchWorkspaces(filter?: { status?: string; limit?: number }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('terraform:list-workspaces', filter);
        if (result.success) this.workspaces = result.workspaces || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async createWorkspace(name: string, description?: string, terraformVersion?: string, providers?: string[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('terraform:create-workspace', { name, description, terraformVersion, providers });
        if (result.success) await this.fetchWorkspaces();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async planRun(workspaceId: string, runType?: string, triggeredBy?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('terraform:plan-run', { workspaceId, runType, triggeredBy });
        if (result.success) await this.fetchRuns(workspaceId);
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async fetchRuns(workspaceId?: string, limit?: number) {
      try {
        const result = await invoke('terraform:list-runs', { workspaceId, limit });
        if (result.success) this.runs = result.runs || [];
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
});
