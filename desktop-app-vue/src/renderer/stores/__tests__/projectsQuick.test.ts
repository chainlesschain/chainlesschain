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
});
