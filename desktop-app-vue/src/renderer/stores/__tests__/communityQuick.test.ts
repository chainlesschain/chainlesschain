/**
 * useCommunityQuickStore — Pinia store unit tests (Phase 2 page port)
 *
 * Covers:
 *  - Initial state defaults + computed getters
 *  - loadAll() success populates communities + hasLoaded
 *  - loadAll() captures error
 *  - loadAll() handles non-array payload (graceful fallback to [])
 *  - joinCommunity() success triggers reload + clears flag
 *  - joinCommunity() failure returns false + sets error
 *  - leaveCommunity() success triggers reload + clears flag
 *  - leaveCommunity() failure returns false + sets error
 *  - deleteCommunity() success triggers reload + clears flag
 *  - deleteCommunity() failure returns false + sets error
 *  - clearError()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCommunityQuickStore } from "../communityQuick";

describe("useCommunityQuickStore (Phase 2)", () => {
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
    const store = useCommunityQuickStore();
    expect(store.communities).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.joiningId).toBeNull();
    expect(store.leavingId).toBeNull();
    expect(store.deletingId).toBeNull();
    expect(store.recent).toEqual([]);
    expect(store.joinedCount).toBe(0);
  });

  it("recent caps at 5; joinedCount mirrors total since list is pre-filtered", () => {
    // community:get-list is INNER JOIN community_members for the caller,
    // so every row in `communities` is already a joined community.
    const store = useCommunityQuickStore();
    store.$patch({
      communities: [
        { id: "a", my_role: "owner" },
        { id: "b", my_role: "member" },
        { id: "c", my_role: "admin" },
        { id: "d", my_role: "member" },
        { id: "e", my_role: "member" },
        { id: "f", my_role: "member" },
        { id: "g", my_role: "member" },
      ],
    });
    expect(store.recent.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(store.joinedCount).toBe(7);
  });

  it("loadAll() populates communities on success", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:get-list") {
        return Promise.resolve([
          { id: "c1", name: "Alpha" },
          { id: "c2", name: "Beta", isJoined: true },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.loadAll();
    expect(store.communities).toHaveLength(2);
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
  });

  it("loadAll() captures error and leaves hasLoaded false", async () => {
    invoke.mockRejectedValueOnce(new Error("ipc down"));
    const store = useCommunityQuickStore();
    await store.loadAll();
    expect(store.error).toBe("ipc down");
    expect(store.hasLoaded).toBe(false);
    expect(store.loading).toBe(false);
  });

  it("loadAll() falls back to [] when backend returns non-array", async () => {
    invoke.mockImplementation(() => Promise.resolve(null));
    const store = useCommunityQuickStore();
    await store.loadAll();
    expect(store.communities).toEqual([]);
    expect(store.hasLoaded).toBe(true);
  });

  it("joinCommunity() success triggers reload and clears joiningId", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:join") {
        return Promise.resolve({ success: true });
      }
      if (channel === "community:get-list") {
        return Promise.resolve([{ id: "c1", isJoined: true }]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.joinCommunity("c1");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("community:join", "c1");
    expect(invoke).toHaveBeenCalledWith("community:get-list", { limit: 50 });
    expect(store.joiningId).toBeNull();
    expect(store.joinedCount).toBe(1);
  });

  it("joinCommunity() failure returns false and sets error", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:join") {
        return Promise.reject(new Error("policy denied"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.joinCommunity("c1");

    expect(ok).toBe(false);
    expect(store.error).toBe("policy denied");
    expect(store.joiningId).toBeNull();
  });

  it("leaveCommunity() success triggers reload and clears leavingId", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:leave") {
        return Promise.resolve({ success: true });
      }
      if (channel === "community:get-list") {
        // After leaving, the user is no longer a member, so the
        // INNER JOIN list returns []
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.leaveCommunity("c1");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("community:leave", "c1");
    expect(store.leavingId).toBeNull();
    expect(store.joinedCount).toBe(0);
  });

  it("leaveCommunity() failure returns false and sets error", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:leave") {
        return Promise.reject(new Error("not a member"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.leaveCommunity("c1");

    expect(ok).toBe(false);
    expect(store.error).toBe("not a member");
    expect(store.leavingId).toBeNull();
  });

  it("deleteCommunity() success triggers reload and clears deletingId", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:delete") {
        return Promise.resolve({ success: true });
      }
      if (channel === "community:get-list") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.deleteCommunity("c1");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("community:delete", "c1");
    expect(store.deletingId).toBeNull();
    expect(store.communities).toEqual([]);
  });

  it("deleteCommunity() failure returns false and sets error (e.g. non-owner)", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:delete") {
        return Promise.reject(new Error("only the owner can delete"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.deleteCommunity("c1");

    expect(ok).toBe(false);
    expect(store.error).toBe("only the owner can delete");
    expect(store.deletingId).toBeNull();
  });

  it("clearError() resets error to null", () => {
    const store = useCommunityQuickStore();
    store.$patch({ error: "boom" });
    store.clearError();
    expect(store.error).toBeNull();
  });

  it("initial state defaults for create wizard fields", () => {
    const store = useCommunityQuickStore();
    expect(store.createOpen).toBe(false);
    expect(store.creating).toBe(false);
    expect(store.createError).toBeNull();
  });

  // ---- Phase 3: create community wizard -----------------------------------

  it("openCreateForm() flips flag and clears stale error", () => {
    const store = useCommunityQuickStore();
    store.$patch({ createError: "old" });
    store.openCreateForm();
    expect(store.createOpen).toBe(true);
    expect(store.createError).toBeNull();
  });

  it("closeCreateForm() goes back to closed when not creating", () => {
    const store = useCommunityQuickStore();
    store.openCreateForm();
    store.closeCreateForm();
    expect(store.createOpen).toBe(false);
  });

  it("closeCreateForm() refuses to close while creating", () => {
    const store = useCommunityQuickStore();
    store.$patch({ createOpen: true, creating: true });
    store.closeCreateForm();
    expect(store.createOpen).toBe(true);
  });

  it("createCommunity() success returns row, closes modal, reloads list", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:create") {
        return Promise.resolve({
          id: "c-new",
          name: "Open Source 学习圈",
          my_role: "owner",
          member_count: 1,
        });
      }
      if (channel === "community:get-list") {
        return Promise.resolve([
          { id: "c-new", name: "Open Source 学习圈", my_role: "owner" },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.openCreateForm();
    const result = await store.createCommunity({
      name: "Open Source 学习圈",
      description: "for OSS learners",
      memberLimit: 500,
    });

    expect(result?.id).toBe("c-new");
    expect(store.createOpen).toBe(false);
    expect(store.creating).toBe(false);
    expect(store.createError).toBeNull();
    expect(store.communities).toHaveLength(1);
    const createCall = invoke.mock.calls.find(
      (c) => c[0] === "community:create",
    );
    expect(createCall![1]).toEqual({
      name: "Open Source 学习圈",
      description: "for OSS learners",
      iconUrl: "",
      rulesMd: "",
      memberLimit: 500,
    });
  });

  it("createCommunity() rejects empty name without IPC", async () => {
    const store = useCommunityQuickStore();
    const result = await store.createCommunity({ name: "  " });
    expect(result).toBeNull();
    expect(store.createError).toMatch(/名称/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createCommunity() rejects names over 100 chars", async () => {
    const store = useCommunityQuickStore();
    const result = await store.createCommunity({ name: "x".repeat(101) });
    expect(result).toBeNull();
    expect(store.createError).toMatch(/100/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createCommunity() defaults memberLimit to 1000 when missing", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:create") {
        return Promise.resolve({ id: "c-x", name: "X" });
      }
      return Promise.resolve([]);
    });
    const store = useCommunityQuickStore();
    await store.createCommunity({ name: "X" });
    const createCall = invoke.mock.calls.find(
      (c) => c[0] === "community:create",
    );
    expect(createCall![1]).toMatchObject({ memberLimit: 1000 });
  });

  it("createCommunity() captures backend error and stays open", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:create") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.openCreateForm();
    const result = await store.createCommunity({ name: "Anything" });
    expect(result).toBeNull();
    expect(store.createError).toBe("disk full");
    expect(store.createOpen).toBe(true);
    expect(store.creating).toBe(false);
  });

  it("clearCreateError() resets only createError", () => {
    const store = useCommunityQuickStore();
    store.$patch({ createError: "boom", error: "main" });
    store.clearCreateError();
    expect(store.createError).toBeNull();
    expect(store.error).toBe("main");
  });
});
