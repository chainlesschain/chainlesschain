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

  it("recent caps at 5 and joinedCount counts isJoined entries", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      communities: [
        { id: "a", isJoined: true },
        { id: "b", isJoined: false },
        { id: "c", isJoined: true },
        { id: "d" },
        { id: "e", isJoined: true },
        { id: "f" },
        { id: "g" },
      ],
    });
    expect(store.recent.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(store.joinedCount).toBe(3);
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
        return Promise.resolve([{ id: "c1", isJoined: false }]);
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
});
