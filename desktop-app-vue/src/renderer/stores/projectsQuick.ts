/**
 * Projects Quick Store
 * Wraps `project:get-all` / `project:delete` / `project:create-quick`
 * (and later update for rename) IPC channels for the V6 shell panel.
 * Phase 4 of the V6 page port (路线 D) — list + delete + quick-create
 * wizard + rename. Phase 5 marks the V5 `components/ProjectSidebar.vue`
 * (773 lines) entry as deprecated.
 *
 * Path P1b extension (2026-04-28) — adds project-detail drawer (read-
 * only metadata + file list) to give V6 users a richer summary without
 * jumping to V5 ProjectDetailPage. The full editing workspace (FileTree
 * + ChatPanel + Editor) stays in V5 because a 720px drawer can't host
 * three resizable columns of workspace.
 *
 * Field shape note: project:get-all returns sqlite snake_case rows
 * envelope-wrapped in {projects, total, hasMore}. Each row carries id /
 * name / description / project_type ('web' | 'document' | 'data' | 'app') /
 * status / created_at / updated_at + optional metadata. The V6 panel
 * matches V5 ProjectSidebar's project_type → icon map.
 * @version 1.4.0
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

export interface ProjectFile {
  id: string;
  project_id?: string;
  file_name?: string;
  file_path?: string;
  file_type?: string;
  size?: number;
  created_at?: number;
  updated_at?: number;
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

  const createOpen = ref(false);
  const creating = ref(false);
  const createError = ref<string | null>(null);

  const renameOpen = ref(false);
  const renamingProject = ref<ProjectSummary | null>(null);
  const renaming = ref(false);
  const renameError = ref<string | null>(null);

  const viewingProjectId = ref<string | null>(null);
  const viewingProject = ref<ProjectSummary | null>(null);
  const viewingFiles = ref<ProjectFile[]>([]);
  const detailsLoading = ref(false);
  const detailsFilesLoading = ref(false);
  const detailsError = ref<string | null>(null);

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

  // ---- Phase 4: rename modal ----------------------------------------------

  function openRenameForm(project: ProjectSummary): void {
    renamingProject.value = project;
    renameOpen.value = true;
    renameError.value = null;
  }

  function closeRenameForm(): void {
    if (renaming.value) {
      return;
    }
    renameOpen.value = false;
    renamingProject.value = null;
    renameError.value = null;
  }

  async function renameProject(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      renameError.value = "请输入项目名称";
      return false;
    }
    if (trimmed.length > 100) {
      renameError.value = "项目名称不能超过 100 个字符";
      return false;
    }

    renaming.value = true;
    renameError.value = null;
    try {
      await api()?.invoke("project:update", id, { name: trimmed });
      await loadAll();
      renameOpen.value = false;
      renamingProject.value = null;
      return true;
    } catch (e) {
      renameError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      renaming.value = false;
    }
  }

  function clearRenameError(): void {
    renameError.value = null;
  }

  // ---- Path P1b: project detail drawer ------------------------------------

  async function loadDetailFiles(projectId: string): Promise<void> {
    detailsFilesLoading.value = true;
    try {
      // Channel signature: (projectId, fileType=null, pageNum=1, pageSize=50)
      // Bumped pageSize to 200 to show the full file list in the detail
      // drawer without pagination — V5 detail page lazy-loads, V6 just
      // shows a flat list because the drawer is read-only.
      const result = (await api()?.invoke(
        "project:get-files",
        projectId,
        null,
        1,
        200,
      )) as ProjectFile[] | { files?: ProjectFile[] } | null | undefined;
      const list = Array.isArray(result)
        ? result
        : Array.isArray((result as { files?: ProjectFile[] })?.files)
          ? ((result as { files?: ProjectFile[] }).files as ProjectFile[])
          : [];
      viewingFiles.value = list;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      viewingFiles.value = [];
    } finally {
      detailsFilesLoading.value = false;
    }
  }

  async function openDetails(id: string): Promise<void> {
    viewingProjectId.value = id;
    viewingProject.value = null;
    viewingFiles.value = [];
    detailsError.value = null;
    detailsLoading.value = true;
    try {
      const detail = (await api()?.invoke("project:get", id)) as
        | ProjectSummary
        | null
        | undefined;
      viewingProject.value = detail ?? null;
      await loadDetailFiles(id);
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      detailsLoading.value = false;
    }
  }

  function closeDetails(): void {
    viewingProjectId.value = null;
    viewingProject.value = null;
    viewingFiles.value = [];
    detailsError.value = null;
  }

  function clearDetailsError(): void {
    detailsError.value = null;
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
    renameOpen,
    renamingProject,
    renaming,
    renameError,
    viewingProjectId,
    viewingProject,
    viewingFiles,
    detailsLoading,
    detailsFilesLoading,
    detailsError,
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
    openRenameForm,
    closeRenameForm,
    renameProject,
    clearRenameError,
    openDetails,
    closeDetails,
    loadDetailFiles,
    clearDetailsError,
  };
});
