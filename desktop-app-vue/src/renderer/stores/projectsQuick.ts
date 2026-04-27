/**
 * Projects Quick Store
 * Wraps `project:get-all` / `project:delete` (and later create-quick /
 * update) IPC channels for the V6 shell panel. Phase 2 of the V6 page
 * port (路线 D) — replaces the old recent-only surface with a full
 * filterable list + delete + open. Phase 3-4 will add quick-create
 * wizard + rename modal; phase 5 ports the V5 `components/ProjectSidebar.vue`
 * (773 lines) entry to deprecated.
 *
 * Field shape note: project:get-all returns sqlite snake_case rows
 * envelope-wrapped in {projects, total, hasMore}. Each row carries id /
 * name / description / project_type ('web' | 'document' | 'data' | 'app') /
 * status / created_at / updated_at + optional metadata. The V6 panel
 * matches V5 ProjectSidebar's project_type → icon map.
 * @version 1.1.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface ProjectSummary {
  id: string;
  name?: string;
  description?: string;
  project_type?: "web" | "document" | "data" | "app" | string;
  status?: string;
  updated_at?: number;
  created_at?: number;
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
const FULL_LIMIT = 200;

export const useProjectsQuickStore = defineStore("projectsQuick", () => {
  const projects = ref<ProjectSummary[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);
  const deletingId = ref<string | null>(null);
  const searchQuery = ref("");

  const recent = computed(() => projects.value.slice(0, RECENT_LIMIT));

  const filteredProjects = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) {
      return projects.value;
    }
    return projects.value.filter((p) => {
      const name = typeof p.name === "string" ? p.name.toLowerCase() : "";
      const desc =
        typeof p.description === "string" ? p.description.toLowerCase() : "";
      return name.includes(q) || desc.includes(q);
    });
  });

  async function fetchProjects(limit: number): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = (await api()?.invoke("project:get-all", null, {
        offset: 0,
        limit,
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

  async function loadRecent(): Promise<void> {
    return fetchProjects(RECENT_LIMIT);
  }

  async function loadAll(): Promise<void> {
    return fetchProjects(FULL_LIMIT);
  }

  async function deleteProject(id: string): Promise<boolean> {
    error.value = null;
    deletingId.value = id;
    try {
      await api()?.invoke("project:delete", id);
      await loadAll();
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      deletingId.value = null;
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
    deletingId,
    searchQuery,
    recent,
    filteredProjects,
    loadRecent,
    loadAll,
    deleteProject,
    clearError,
  };
});
