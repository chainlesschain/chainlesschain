import { defineStore } from "pinia";
import { ref } from "vue";

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  const w = window as unknown as {
    electronAPI?: ElectronApi;
    electron?: { ipcRenderer?: ElectronApi };
  };
  return w.electronAPI || w.electron?.ipcRenderer;
}

export interface Organization {
  org_id: string;
  name: string;
  description?: string;
  type: string;
  role: string;
  member_count?: number;
  joined_at?: string | number;
  avatar?: string;
}

export interface CreateOrgInput {
  name: string;
  type: string;
  description?: string;
}

interface ListResult {
  success?: boolean;
  organizations?: Organization[];
  error?: string;
}

interface CreateResult {
  success?: boolean;
  organization?: Organization;
  error?: string;
}

export const useOrganizationsStore = defineStore("organizations", () => {
  const organizations = ref<Organization[]>([]);
  const loading = ref(false);
  const creating = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  async function loadOrganizations(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = (await api()?.invoke("org:get-user-organizations")) as
        | ListResult
        | undefined;
      if (res?.success) {
        organizations.value = Array.isArray(res.organizations)
          ? res.organizations
          : [];
      } else {
        error.value = res?.error || "加载组织列表失败";
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
      hasLoaded.value = true;
    }
  }

  // Alias for the panel's load-on-open convention.
  async function loadAll(): Promise<void> {
    return loadOrganizations();
  }

  async function createOrganization(
    input: CreateOrgInput,
  ): Promise<Organization | null> {
    creating.value = true;
    error.value = null;
    try {
      const res = (await api()?.invoke("org:create-organization", input)) as
        | CreateResult
        | undefined;
      if (res?.success) {
        await loadOrganizations();
        return res.organization ?? null;
      }
      error.value = res?.error || "创建组织失败";
      return null;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      creating.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    organizations,
    loading,
    creating,
    error,
    hasLoaded,
    loadOrganizations,
    loadAll,
    createOrganization,
    clearError,
  };
});
