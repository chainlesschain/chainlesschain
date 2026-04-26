/**
 * Projects Quick Store
 * Thin wrapper over `project:get-all` IPC for the V6 shell quick panel.
 * Intentionally minimal — read-only "recent N projects" surface only.
 * Full CRUD/filters/pagination live in the V5 useProjectStore (`project.ts`)
 * and are not re-exposed here.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface ProjectSummary {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  status?: string;
  updated_at?: string | number;
  created_at?: string | number;
  [key: string]: unknown;
}

interface ProjectListResponse {
  projects?: ProjectSummary[];
  total?: number;
  hasMore?: boolean;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

const RECENT_LIMIT = 5;

export const useProjectsQuickStore = defineStore("projectsQuick", () => {
  const projects = ref<ProjectSummary[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const recent = computed(() => projects.value.slice(0, RECENT_LIMIT));

  async function loadRecent(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = (await api()?.invoke("project:get-all", null, {
        offset: 0,
        limit: RECENT_LIMIT,
        sortBy: "updated_at",
        sortOrder: "DESC",
      })) as ProjectListResponse | null | undefined;
      projects.value = Array.isArray(response?.projects)
        ? (response!.projects as ProjectSummary[])
        : [];
      total.value =
        typeof response?.total === "number"
          ? response!.total
          : projects.value.length;
      hasLoaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    projects,
    total,
    loading,
    error,
    hasLoaded,
    recent,
    loadRecent,
    clearError,
  };
});
