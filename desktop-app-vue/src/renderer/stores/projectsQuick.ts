/**
 * Projects Quick Store
 * Wraps `project:get-all` / `project:delete` / `project:create-quick`
 * (and later update for rename) IPC channels for the V6 shell panel.
 * Phase 3 of the V6 page port (路线 D) — list + delete + quick-create
 * wizard. Phase 4 adds rename + per-row dropdown menu; Phase 5 marks
 * the V5 `components/ProjectSidebar.vue` (773 lines) entry as deprecated.
 *
 * Field shape note: project:get-all returns sqlite snake_case rows
 * envelope-wrapped in {projects, total, hasMore}. Each row carries id /
 * name / description / project_type ('web' | 'document' | 'data' | 'app') /
 * status / created_at / updated_at + optional metadata. The V6 panel
 * matches V5 ProjectSidebar's project_type → icon map.
 * @version 1.2.0
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

export interface CreateProjectInput {
  name: string;
  description?: string;
  projectType?: "web" | "document" | "data" | "app";
  userId?: string;
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

  const createOpen = ref(false);
  const creating = ref(false);
  const createError = ref<string | null>(null);

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

  // ---- Phase 3: quick-create wizard ---------------------------------------

  function openCreateForm(): void {
    createOpen.value = true;
    createError.value = null;
  }

  function closeCreateForm(): void {
    if (creating.value) {
      return;
    }
    createOpen.value = false;
    createError.value = null;
  }

  async function createProject(
    input: CreateProjectInput,
  ): Promise<ProjectSummary | null> {
    if (!input.name || !input.name.trim()) {
      createError.value = "请输入项目名称";
      return null;
    }
    if (input.name.trim().length > 100) {
      createError.value = "项目名称不能超过 100 个字符";
      return null;
    }

    creating.value = true;
    createError.value = null;
    try {
      const result = (await api()?.invoke("project:create-quick", {
        name: input.name.trim(),
        description: input.description?.trim() || "",
        projectType: input.projectType ?? "document",
        userId: input.userId ?? "default-user",
      })) as ProjectSummary | null | undefined;
      await loadAll();
      createOpen.value = false;
      return result ?? null;
    } catch (e) {
      createError.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      creating.value = false;
    }
  }

  function clearCreateError(): void {
    createError.value = null;
  }

  return {
    projects,
    total,
    loading,
    error,
    hasLoaded,
    deletingId,
    searchQuery,
    createOpen,
    creating,
    createError,
    recent,
    filteredProjects,
    loadRecent,
    loadAll,
    deleteProject,
    clearError,
    openCreateForm,
    closeCreateForm,
    createProject,
    clearCreateError,
  };
});
