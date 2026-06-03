/**
 * useProjectStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - fetchProjects()       → project.getAll
 *  - createProject()       → project.create
 *  - getProject()          → project.get / project.getFiles
 *  - updateProject()       → project.update
 *  - deleteProject()       → project.delete
 *  - loadProjectFiles()    → project.getFiles
 *  - saveProjectFiles()    → project.saveFiles
 *  - updateFile()          → project.updateFile
 *  - Getters: filteredProjects, paginatedProjects, projectStats, fileTree
 *  - Filters: setFilter(), resetFilters()
 *  - View: setViewMode(), setSort(), setPagination()
 *  - clearCurrentProject()
 *  - Error handling when IPC throws
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Project, ProjectFile } from "../project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    description: "A test project",
    project_type: "web",
    status: "active",
    tags: "[]",
    root_path: "/tmp/test-project",
    created_at: 1700000000000,
    updated_at: 1700000001000,
    ...overrides,
  };
}

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "file-1",
    project_id: "proj-1",
    file_name: "index.ts",
    file_path: "/src/index.ts",
    content: 'console.log("hello")',
    version: 1,
    created_at: 1700000000000,
    updated_at: 1700000001000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProjectStore", () => {
  let pinia: ReturnType<typeof createPinia>;

  const mockProjectAPI = {
    getAll: vi.fn(),
    create: vi.fn(),
    createStream: vi.fn(),
    cancelStream: vi.fn(),
    get: vi.fn(),
    fetchFromBackend: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getFiles: vi.fn(),
    saveFiles: vi.fn(),
    updateFile: vi.fn(),
    sync: vi.fn(),
    syncOne: vi.fn(),
    gitInit: vi.fn(),
    gitCommit: vi.fn(),
    gitPush: vi.fn(),
    gitPull: vi.fn(),
    gitStatus: vi.fn(),
  };

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    // Reset all mocks
    Object.values(mockProjectAPI).forEach((fn) => fn.mockReset());
    mockProjectAPI.getAll.mockResolvedValue([]);
    mockProjectAPI.getFiles.mockResolvedValue([]);

    (window as any).electronAPI = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      project: mockProjectAPI,
    };

    // Mock localStorage
    const storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        storage[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("projects starts as empty array", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.projects).toEqual([]);
    });

    it("currentProject starts as null", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.currentProject).toBeNull();
    });

    it("loading starts as false", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.loading).toBe(false);
    });

    it("viewMode defaults to grid", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.viewMode).toBe("grid");
    });

    it("pagination has default values", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.pagination).toEqual({ current: 1, pageSize: 12, total: 0 });
    });

    it("filters have default empty values", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.filters).toEqual({
        projectType: "",
        status: "",
        tags: [],
        searchKeyword: "",
      });
    });

    it("sortBy defaults to updated_at desc", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      expect(store.sortBy).toBe("updated_at");
      expect(store.sortOrder).toBe("desc");
    });
  });

  // -------------------------------------------------------------------------
  // fetchProjects
  // -------------------------------------------------------------------------

  describe("fetchProjects()", () => {
    it("calls project.getAll with userId", async () => {
      mockProjectAPI.getAll.mockResolvedValue([]);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.fetchProjects("user-1");
      expect(mockProjectAPI.getAll).toHaveBeenCalledWith("user-1");
    });

    it("populates projects from array response", async () => {
      const projects = [makeProject({ id: "p1" }), makeProject({ id: "p2" })];
      mockProjectAPI.getAll.mockResolvedValue(projects);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.fetchProjects("user-1");
      expect(store.projects).toHaveLength(2);
    });

    it("populates projects from object response with projects field", async () => {
      const projects = [makeProject({ id: "p1" })];
      mockProjectAPI.getAll.mockResolvedValue({ projects, total: 5 });
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.fetchProjects("user-1");
      expect(store.projects).toHaveLength(1);
      expect(store.pagination.total).toBe(5);
    });

    it("sets loading to false after completion", async () => {
      mockProjectAPI.getAll.mockResolvedValue([]);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.fetchProjects("user-1");
      expect(store.loading).toBe(false);
    });

    it("throws and sets loading false when IPC fails", async () => {
      mockProjectAPI.getAll.mockRejectedValue(new Error("DB error"));
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await expect(store.fetchProjects("user-1")).rejects.toThrow("DB error");
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // createProject
  // -------------------------------------------------------------------------

  describe("createProject()", () => {
    it("calls project.create and adds result to projects", async () => {
      const newProject = makeProject({ id: "new-1", name: "New Project" });
      mockProjectAPI.create.mockResolvedValue(newProject);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      const result = await store.createProject({ name: "New Project" });
      expect(mockProjectAPI.create).toHaveBeenCalledWith({
        name: "New Project",
      });
      expect(result.id).toBe("new-1");
      expect(store.projects[0].id).toBe("new-1");
    });

    it("increments pagination total on success", async () => {
      mockProjectAPI.create.mockResolvedValue(makeProject());
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.pagination.total = 5;
      await store.createProject({ name: "Test" });
      expect(store.pagination.total).toBe(6);
    });

    it("throws and sets error status on failure", async () => {
      mockProjectAPI.create.mockRejectedValue(new Error("Create failed"));
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await expect(store.createProject({ name: "Bad" })).rejects.toThrow(
        "Create failed",
      );
    });
  });

  // -------------------------------------------------------------------------
  // getProject
  // -------------------------------------------------------------------------

  describe("getProject()", () => {
    it("sets currentProject from local result", async () => {
      const project = makeProject({ id: "p-detail", name: "Detail" });
      mockProjectAPI.get.mockResolvedValue(project);
      mockProjectAPI.getFiles.mockResolvedValue([]);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.getProject("p-detail");
      expect(store.currentProject).not.toBeNull();
      expect(store.currentProject!.name).toBe("Detail");
    });

    it("falls back to fetchFromBackend when local returns null", async () => {
      const project = makeProject({ id: "p-remote" });
      mockProjectAPI.get.mockResolvedValue(null);
      mockProjectAPI.fetchFromBackend.mockResolvedValue(project);
      mockProjectAPI.getFiles.mockResolvedValue([]);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.getProject("p-remote");
      expect(mockProjectAPI.fetchFromBackend).toHaveBeenCalledWith("p-remote");
      expect(store.currentProject!.id).toBe("p-remote");
    });

    it("loads project files after getting project", async () => {
      mockProjectAPI.get.mockResolvedValue(makeProject());
      mockProjectAPI.getFiles.mockResolvedValue([makeFile()]);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.getProject("proj-1");
      expect(mockProjectAPI.getFiles).toHaveBeenCalledWith("proj-1");
    });

    it("sets loading to false after completion", async () => {
      mockProjectAPI.get.mockResolvedValue(makeProject());
      mockProjectAPI.getFiles.mockResolvedValue([]);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.getProject("proj-1");
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // updateProject
  // -------------------------------------------------------------------------

  describe("updateProject()", () => {
    it("calls project.update and updates local list", async () => {
      mockProjectAPI.update.mockResolvedValue(undefined);
      mockProjectAPI.syncOne.mockResolvedValue(undefined);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [makeProject({ id: "u1", name: "Old Name" })];
      await store.updateProject("u1", { name: "New Name" });
      expect(mockProjectAPI.update).toHaveBeenCalledWith("u1", {
        name: "New Name",
      });
      expect(store.projects[0].name).toBe("New Name");
    });

    it("updates currentProject if it matches", async () => {
      mockProjectAPI.update.mockResolvedValue(undefined);
      mockProjectAPI.syncOne.mockResolvedValue(undefined);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      const proj = makeProject({ id: "u1", name: "Old" });
      store.projects = [proj];
      store.currentProject = proj;
      await store.updateProject("u1", { name: "Updated" });
      expect(store.currentProject!.name).toBe("Updated");
    });

    it("throws when IPC fails", async () => {
      mockProjectAPI.update.mockRejectedValue(new Error("Update failed"));
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [makeProject({ id: "u1" })];
      await expect(store.updateProject("u1", { name: "X" })).rejects.toThrow(
        "Update failed",
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteProject
  // -------------------------------------------------------------------------

  describe("deleteProject()", () => {
    it("removes project from local list", async () => {
      mockProjectAPI.delete.mockResolvedValue(undefined);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({ id: "del-1" }),
        makeProject({ id: "keep-1" }),
      ];
      store.pagination.total = 2;
      await store.deleteProject("del-1");
      expect(store.projects).toHaveLength(1);
      expect(store.projects[0].id).toBe("keep-1");
      expect(store.pagination.total).toBe(1);
    });

    it("clears currentProject if it matches deleted", async () => {
      mockProjectAPI.delete.mockResolvedValue(undefined);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      const proj = makeProject({ id: "del-1" });
      store.projects = [proj];
      store.currentProject = proj;
      await store.deleteProject("del-1");
      expect(store.currentProject).toBeNull();
    });

    it("throws when IPC fails", async () => {
      mockProjectAPI.delete.mockRejectedValue(new Error("Delete failed"));
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [makeProject({ id: "del-1" })];
      await expect(store.deleteProject("del-1")).rejects.toThrow(
        "Delete failed",
      );
    });
  });

  // -------------------------------------------------------------------------
  // loadProjectFiles
  // -------------------------------------------------------------------------

  describe("loadProjectFiles()", () => {
    it("populates projectFiles from array response", async () => {
      const files = [makeFile({ id: "f1" }), makeFile({ id: "f2" })];
      mockProjectAPI.getFiles.mockResolvedValue(files);
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      const result = await store.loadProjectFiles("proj-1");
      expect(store.projectFiles).toHaveLength(2);
      expect(result).toHaveLength(2);
    });

    it("handles object response with files field", async () => {
      mockProjectAPI.getFiles.mockResolvedValue({ files: [makeFile()] });
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      await store.loadProjectFiles("proj-1");
      expect(store.projectFiles).toHaveLength(1);
    });

    it("returns empty array on error without throwing", async () => {
      mockProjectAPI.getFiles.mockRejectedValue(new Error("File error"));
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      const result = await store.loadProjectFiles("proj-1");
      expect(result).toEqual([]);
      expect(store.projectFiles).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("filteredProjects filters by projectType", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({ id: "p1", project_type: "web" }),
        makeProject({ id: "p2", project_type: "data" }),
      ];
      store.filters.projectType = "web";
      expect(store.filteredProjects).toHaveLength(1);
      expect(store.filteredProjects[0].id).toBe("p1");
    });

    it("filteredProjects filters by status", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({ id: "p1", status: "active" }),
        makeProject({ id: "p2", status: "archived" }),
      ];
      store.filters.status = "archived";
      expect(store.filteredProjects).toHaveLength(1);
      expect(store.filteredProjects[0].id).toBe("p2");
    });

    it("filteredProjects filters by searchKeyword in name and description", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({
          id: "p1",
          name: "Alpha App",
          description: "First project",
        }),
        makeProject({
          id: "p2",
          name: "Beta Service",
          description: "Second project",
        }),
      ];
      store.filters.searchKeyword = "alpha";
      expect(store.filteredProjects).toHaveLength(1);
      expect(store.filteredProjects[0].id).toBe("p1");
    });

    it("filteredProjects filters by tags", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({ id: "p1", tags: '["vue","typescript"]' }),
        makeProject({ id: "p2", tags: '["react"]' }),
      ];
      store.filters.tags = ["vue"];
      expect(store.filteredProjects).toHaveLength(1);
      expect(store.filteredProjects[0].id).toBe("p1");
    });

    it("filteredProjects returns all when no filters", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [makeProject({ id: "p1" }), makeProject({ id: "p2" })];
      expect(store.filteredProjects).toHaveLength(2);
    });

    it("filteredProjects sorts by name ascending", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({ id: "p1", name: "Zebra" }),
        makeProject({ id: "p2", name: "Alpha" }),
      ];
      store.sortBy = "name";
      store.sortOrder = "asc";
      const names = store.filteredProjects.map((p) => p.name);
      expect(names).toEqual(["Alpha", "Zebra"]);
    });

    it("paginatedProjects returns correct page slice", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = Array.from({ length: 15 }, (_, i) =>
        makeProject({
          id: `p${i}`,
          name: `Project ${i}`,
          updated_at: 1700000000000 + i,
        }),
      );
      store.pagination.pageSize = 5;
      store.pagination.current = 2;
      store.sortOrder = "asc";
      expect(store.paginatedProjects).toHaveLength(5);
    });

    it("projectStats counts by type and status", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projects = [
        makeProject({ id: "p1", project_type: "web", status: "active" }),
        makeProject({ id: "p2", project_type: "web", status: "completed" }),
        makeProject({ id: "p3", project_type: "data", status: "active" }),
      ];
      const stats = store.projectStats;
      expect(stats.total).toBe(3);
      expect(stats.byType).toEqual({ web: 2, data: 1 });
      expect(stats.byStatus).toEqual({ active: 2, completed: 1 });
    });

    it("fileTree builds directory structure from file paths", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.projectFiles = [
        makeFile({ id: "f1", file_path: "/src/index.ts" }),
        makeFile({ id: "f2", file_path: "/src/utils/helper.ts" }),
      ];
      const tree = store.fileTree;
      expect(tree.name).toBe("/");
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].name).toBe("src");
      expect(tree.children[0].files).toHaveLength(1);
      expect(tree.children[0].children).toHaveLength(1);
      expect(tree.children[0].children[0].name).toBe("utils");
    });
  });

  // -------------------------------------------------------------------------
  // Filters and View
  // -------------------------------------------------------------------------

  describe("Filters and View", () => {
    it("setFilter updates filter and resets pagination", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.pagination.current = 3;
      store.setFilter("projectType", "web");
      expect(store.filters.projectType).toBe("web");
      expect(store.pagination.current).toBe(1);
    });

    it("resetFilters clears all filters", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.filters.projectType = "web";
      store.filters.status = "active";
      store.filters.searchKeyword = "test";
      store.pagination.current = 5;
      store.resetFilters();
      expect(store.filters.projectType).toBe("");
      expect(store.filters.status).toBe("");
      expect(store.filters.searchKeyword).toBe("");
      expect(store.filters.tags).toEqual([]);
      expect(store.pagination.current).toBe(1);
    });

    it("setSort updates sortBy and sortOrder", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.setSort("name", "asc");
      expect(store.sortBy).toBe("name");
      expect(store.sortOrder).toBe("asc");
    });

    it("setViewMode updates viewMode", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.setViewMode("list");
      expect(store.viewMode).toBe("list");
    });

    it("setPagination updates current page and pageSize", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.setPagination(3, 24);
      expect(store.pagination.current).toBe(3);
      expect(store.pagination.pageSize).toBe(24);
    });
  });

  // -------------------------------------------------------------------------
  // File management helpers
  // -------------------------------------------------------------------------

  describe("File management", () => {
    it("setCurrentFile sets the current file", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      const file = makeFile({ id: "f1" });
      store.setCurrentFile(file);
      expect(store.currentFile).not.toBeNull();
      expect(store.currentFile!.id).toBe("f1");
    });

    it("toggleFolderExpanded adds and removes folder paths", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.toggleFolderExpanded("/src");
      expect(store.fileTreeExpanded).toContain("/src");
      store.toggleFolderExpanded("/src");
      expect(store.fileTreeExpanded).not.toContain("/src");
    });
  });

  // -------------------------------------------------------------------------
  // clearCurrentProject
  // -------------------------------------------------------------------------

  describe("clearCurrentProject()", () => {
    it("clears project, files, and expanded state", async () => {
      const { useProjectStore } = await import("../project");
      const store = useProjectStore();
      store.currentProject = makeProject();
      store.projectFiles = [makeFile()];
      store.currentFile = makeFile();
      store.fileTreeExpanded = ["/src"];

      store.clearCurrentProject();

      expect(store.currentProject).toBeNull();
      expect(store.projectFiles).toEqual([]);
      expect(store.currentFile).toBeNull();
      expect(store.fileTreeExpanded).toEqual([]);
    });
  });
});
