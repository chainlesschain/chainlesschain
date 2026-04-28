/**
 * useProjectsQuickStore — Pinia store unit tests (Phase 2 page port)
 *
 * Covers:
 *  - Initial state defaults + computed
 *  - recent caps at 5; filteredProjects matches search query (name + description)
 *  - loadAll() / loadRecent() request shapes (limit + sort + envelope unwrap)
 *  - loadAll() success + non-array fallback + error capture
 *  - deleteProject() success + reload + clearing flag
 *  - deleteProject() failure captures error
 *  - clearError()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectsQuickStore } from "../projectsQuick";

describe("useProjectsQuickStore (Phase 2)", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("initial state is empty with sensible defaults", () => {
    const store = useProjectsQuickStore();
    expect(store.projects).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.deletingId).toBeNull();
    expect(store.searchQuery).toBe("");
    expect(store.recent).toEqual([]);
    expect(store.filteredProjects).toEqual([]);
  });

  it("recent caps at 5; filteredProjects with no query returns full list", () => {
    const store = useProjectsQuickStore();
    store.$patch({
      projects: Array.from({ length: 7 }, (_, i) => ({
        id: `p${i}`,
        name: `Proj ${i}`,
      })),
    });
    expect(store.recent).toHaveLength(5);
    expect(store.recent.map((p) => p.id)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    expect(store.filteredProjects).toHaveLength(7);
  });

  it("filteredProjects matches name and description case-insensitively", () => {
    const store = useProjectsQuickStore();
    store.$patch({
      projects: [
        { id: "a", name: "Alpha Web App", description: "frontend" },
        { id: "b", name: "Beta", description: "Web demo" },
        { id: "c", name: "gamma" },
      ],
      searchQuery: "  WEB  ",
    });
    expect(store.filteredProjects.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("loadAll() invokes project:get-all with limit=200 + sort + unwraps envelope", async () => {
    invoke.mockImplementation((channel: string, _userId, options) => {
      if (channel === "project:get-all") {
        expect(options).toMatchObject({
          offset: 0,
          limit: 200,
          sortBy: "updated_at",
          sortOrder: "DESC",
        });
        return Promise.resolve({
          projects: [
            { id: "p1", name: "Proj 1", project_type: "web" },
            { id: "p2", name: "Proj 2", project_type: "document" },
          ],
          total: 42,
          hasMore: true,
        });
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    await store.loadAll();
    expect(store.projects).toHaveLength(2);
    expect(store.total).toBe(42);
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
  });

  it("loadRecent() uses limit=5", async () => {
    invoke.mockImplementation((channel: string, _userId, options) => {
      if (channel === "project:get-all") {
        expect(options.limit).toBe(5);
        return Promise.resolve({ projects: [{ id: "p1" }], total: 1 });
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    await store.loadRecent();
    expect(store.projects).toHaveLength(1);
  });

  it("loadAll() falls back to [] when response is non-array", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve({ projects: null, total: 0 }),
    );
    const store = useProjectsQuickStore();
    await store.loadAll();
    expect(store.projects).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.hasLoaded).toBe(true);
  });

  it("loadAll() defaults total to projects.length when backend omits it", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve({ projects: [{ id: "a" }, { id: "b" }] }),
    );
    const store = useProjectsQuickStore();
    await store.loadAll();
    expect(store.total).toBe(2);
  });

  it("loadAll() captures error and leaves hasLoaded false", async () => {
    invoke.mockRejectedValueOnce(new Error("ipc down"));
    const store = useProjectsQuickStore();
    await store.loadAll();
    expect(store.error).toBe("ipc down");
    expect(store.hasLoaded).toBe(false);
    expect(store.loading).toBe(false);
  });

  it("deleteProject() success triggers loadAll reload and clears flag", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:delete") {
        return Promise.resolve({ success: true });
      }
      if (channel === "project:get-all") {
        return Promise.resolve({ projects: [], total: 0 });
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    store.$patch({ projects: [{ id: "p1", name: "doomed" }] });
    const ok = await store.deleteProject("p1");
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("project:delete", "p1");
    expect(store.deletingId).toBeNull();
    expect(store.projects).toEqual([]);
  });

  it("deleteProject() failure returns false and surfaces error", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:delete") {
        return Promise.reject(new Error("locked file"));
      }
      return Promise.resolve(null);
    });
    const store = useProjectsQuickStore();
    const ok = await store.deleteProject("p1");
    expect(ok).toBe(false);
    expect(store.error).toBe("locked file");
    expect(store.deletingId).toBeNull();
  });

  it("clearError() resets error to null", () => {
    const store = useProjectsQuickStore();
    store.$patch({ error: "boom" });
    store.clearError();
    expect(store.error).toBeNull();
  });

  // ---- Phase 3: quick-create wizard ---------------------------------------

  it("initial state for create wizard fields", () => {
    const store = useProjectsQuickStore();
    expect(store.createOpen).toBe(false);
    expect(store.creating).toBe(false);
    expect(store.createError).toBeNull();
  });

  it("openCreateForm() flips flag and clears stale error", () => {
    const store = useProjectsQuickStore();
    store.$patch({ createError: "old" });
    store.openCreateForm();
    expect(store.createOpen).toBe(true);
    expect(store.createError).toBeNull();
  });

  it("closeCreateForm() goes back to closed when not creating", () => {
    const store = useProjectsQuickStore();
    store.openCreateForm();
    store.closeCreateForm();
    expect(store.createOpen).toBe(false);
  });

  it("closeCreateForm() refuses while creating", () => {
    const store = useProjectsQuickStore();
    store.$patch({ createOpen: true, creating: true });
    store.closeCreateForm();
    expect(store.createOpen).toBe(true);
  });

  it("createProject() success returns row, closes modal, reloads list", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:create-quick") {
        return Promise.resolve({
          id: "p-new",
          name: "Quick Demo",
          project_type: "document",
        });
      }
      if (channel === "project:get-all") {
        return Promise.resolve({
          projects: [
            { id: "p-new", name: "Quick Demo", project_type: "document" },
          ],
          total: 1,
        });
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    store.openCreateForm();
    const result = await store.createProject({
      name: "Quick Demo",
      description: "a test",
    });

    expect(result?.id).toBe("p-new");
    expect(store.createOpen).toBe(false);
    expect(store.creating).toBe(false);
    expect(store.createError).toBeNull();
    expect(store.projects).toHaveLength(1);
    const createCall = invoke.mock.calls.find(
      (c) => c[0] === "project:create-quick",
    );
    expect(createCall![1]).toEqual({
      name: "Quick Demo",
      description: "a test",
      projectType: "document",
      userId: "default-user",
    });
  });

  it("createProject() rejects empty name without IPC", async () => {
    const store = useProjectsQuickStore();
    const result = await store.createProject({ name: "  " });
    expect(result).toBeNull();
    expect(store.createError).toMatch(/名称/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createProject() rejects names over 100 chars", async () => {
    const store = useProjectsQuickStore();
    const result = await store.createProject({ name: "x".repeat(101) });
    expect(result).toBeNull();
    expect(store.createError).toMatch(/100/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createProject() defaults projectType to document and userId default-user", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:create-quick") {
        return Promise.resolve({ id: "p-x" });
      }
      return Promise.resolve({ projects: [] });
    });
    const store = useProjectsQuickStore();
    await store.createProject({ name: "Plain" });
    const call = invoke.mock.calls.find((c) => c[0] === "project:create-quick");
    expect(call![1]).toMatchObject({
      projectType: "document",
      userId: "default-user",
    });
  });

  it("createProject() captures backend error and stays open", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:create-quick") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    store.openCreateForm();
    const result = await store.createProject({ name: "Anything" });
    expect(result).toBeNull();
    expect(store.createError).toBe("disk full");
    expect(store.createOpen).toBe(true);
    expect(store.creating).toBe(false);
  });

  it("clearCreateError() resets only createError", () => {
    const store = useProjectsQuickStore();
    store.$patch({ createError: "boom", error: "main" });
    store.clearCreateError();
    expect(store.createError).toBeNull();
    expect(store.error).toBe("main");
  });

  // ---- Phase 4: rename modal ----------------------------------------------

  it("initial state for rename wizard fields", () => {
    const store = useProjectsQuickStore();
    expect(store.renameOpen).toBe(false);
    expect(store.renaming).toBe(false);
    expect(store.renameError).toBeNull();
    expect(store.renamingProject).toBeNull();
  });

  it("openRenameForm() captures the project + flips flag", () => {
    const store = useProjectsQuickStore();
    store.$patch({ renameError: "old" });
    store.openRenameForm({ id: "p1", name: "Original" });
    expect(store.renameOpen).toBe(true);
    expect(store.renamingProject?.id).toBe("p1");
    expect(store.renameError).toBeNull();
  });

  it("closeRenameForm() resets flag + project + error", () => {
    const store = useProjectsQuickStore();
    store.openRenameForm({ id: "p1", name: "X" });
    store.closeRenameForm();
    expect(store.renameOpen).toBe(false);
    expect(store.renamingProject).toBeNull();
    expect(store.renameError).toBeNull();
  });

  it("closeRenameForm() refuses while renaming", () => {
    const store = useProjectsQuickStore();
    store.$patch({
      renameOpen: true,
      renamingProject: { id: "p1" },
      renaming: true,
    });
    store.closeRenameForm();
    expect(store.renameOpen).toBe(true);
    expect(store.renamingProject?.id).toBe("p1");
  });

  it("renameProject() success invokes IPC and reloads list", async () => {
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === "project:update") {
        expect(args[0]).toBe("p1");
        expect(args[1]).toEqual({ name: "Renamed" });
        return Promise.resolve({ success: true });
      }
      if (channel === "project:get-all") {
        return Promise.resolve({
          projects: [{ id: "p1", name: "Renamed" }],
          total: 1,
        });
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    store.openRenameForm({ id: "p1", name: "Original" });
    const ok = await store.renameProject("p1", "  Renamed  ");
    expect(ok).toBe(true);
    expect(store.renameOpen).toBe(false);
    expect(store.renamingProject).toBeNull();
    expect(store.renaming).toBe(false);
    expect(store.projects[0]?.name).toBe("Renamed");
  });

  it("renameProject() rejects empty name without IPC", async () => {
    const store = useProjectsQuickStore();
    const ok = await store.renameProject("p1", "  ");
    expect(ok).toBe(false);
    expect(store.renameError).toMatch(/名称/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renameProject() rejects names over 100 chars", async () => {
    const store = useProjectsQuickStore();
    const ok = await store.renameProject("p1", "x".repeat(101));
    expect(ok).toBe(false);
    expect(store.renameError).toMatch(/100/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renameProject() captures backend error and stays open", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:update") {
        return Promise.reject(new Error("conflict"));
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    store.openRenameForm({ id: "p1", name: "Original" });
    const ok = await store.renameProject("p1", "Renamed");
    expect(ok).toBe(false);
    expect(store.renameError).toBe("conflict");
    expect(store.renameOpen).toBe(true);
    expect(store.renamingProject?.id).toBe("p1");
    expect(store.renaming).toBe(false);
  });

  it("clearRenameError() resets only renameError", () => {
    const store = useProjectsQuickStore();
    store.$patch({
      renameError: "boom",
      error: "main",
      createError: "third",
    });
    store.clearRenameError();
    expect(store.renameError).toBeNull();
    expect(store.error).toBe("main");
    expect(store.createError).toBe("third");
  });

  // ---- Path P1b: project detail drawer ------------------------------------

  it("initial state for detail drawer fields", () => {
    const store = useProjectsQuickStore();
    expect(store.viewingProjectId).toBeNull();
    expect(store.viewingProject).toBeNull();
    expect(store.viewingFiles).toEqual([]);
    expect(store.detailsLoading).toBe(false);
    expect(store.detailsFilesLoading).toBe(false);
    expect(store.detailsError).toBeNull();
  });

  it("openDetails() loads project + files via project:get and project:get-files", async () => {
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === "project:get") {
        expect(args[0]).toBe("p1");
        return Promise.resolve({
          id: "p1",
          name: "Test Project",
          project_type: "document",
          status: "active",
        });
      }
      if (channel === "project:get-files") {
        // verify pageSize=200 was requested
        expect(args[3]).toBe(200);
        return Promise.resolve({
          files: [
            { id: "f1", file_name: "a.md", file_type: "markdown" },
            { id: "f2", file_name: "b.png", file_type: "image" },
          ],
          total: 2,
          hasMore: false,
        });
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    await store.openDetails("p1");

    expect(store.viewingProjectId).toBe("p1");
    expect(store.viewingProject?.name).toBe("Test Project");
    expect(store.viewingFiles).toHaveLength(2);
    expect(store.detailsLoading).toBe(false);
    expect(store.detailsFilesLoading).toBe(false);
  });

  it("openDetails() captures error when project:get throws", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:get") {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    await store.openDetails("p-missing");

    expect(store.viewingProjectId).toBe("p-missing");
    expect(store.viewingProject).toBeNull();
    expect(store.detailsError).toBe("not found");
    expect(store.detailsLoading).toBe(false);
  });

  it("loadDetailFiles() handles flat array response", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "project:get-files") {
        return Promise.resolve([{ id: "f1", file_name: "x" }]);
      }
      return Promise.resolve(null);
    });

    const store = useProjectsQuickStore();
    await store.loadDetailFiles("p1");
    expect(store.viewingFiles).toHaveLength(1);
    expect(store.viewingFiles[0].id).toBe("f1");
  });

  it("loadDetailFiles() falls back to [] when response shape unknown", async () => {
    invoke.mockImplementation(() => Promise.resolve("unexpected"));

    const store = useProjectsQuickStore();
    await store.loadDetailFiles("p1");
    expect(store.viewingFiles).toEqual([]);
  });

  it("loadDetailFiles() captures error and falls back to []", async () => {
    invoke.mockImplementation(() =>
      Promise.reject(new Error("permission denied")),
    );
    const store = useProjectsQuickStore();
    store.$patch({ viewingFiles: [{ id: "stale" } as never] });
    await store.loadDetailFiles("p1");
    expect(store.viewingFiles).toEqual([]);
    expect(store.detailsError).toBe("permission denied");
  });

  it("closeDetails() resets all viewing state", () => {
    const store = useProjectsQuickStore();
    store.$patch({
      viewingProjectId: "p1",
      viewingProject: { id: "p1", name: "X" },
      viewingFiles: [{ id: "f1" } as never],
      detailsError: "old",
    });
    store.closeDetails();
    expect(store.viewingProjectId).toBeNull();
    expect(store.viewingProject).toBeNull();
    expect(store.viewingFiles).toEqual([]);
    expect(store.detailsError).toBeNull();
  });

  it("clearDetailsError() resets only detailsError", () => {
    const store = useProjectsQuickStore();
    store.$patch({
      detailsError: "x",
      error: "main",
      createError: "third",
      renameError: "fourth",
    });
    store.clearDetailsError();
    expect(store.detailsError).toBeNull();
    expect(store.error).toBe("main");
    expect(store.createError).toBe("third");
    expect(store.renameError).toBe("fourth");
  });
});
