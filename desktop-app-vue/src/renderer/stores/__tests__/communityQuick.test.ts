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

  // ---- Phase 4: details drawer + members + channels -----------------------

  it("openDetails() loads community + members + channels in parallel", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:get-by-id") {
        return Promise.resolve({
          id: "c1",
          name: "Alpha",
          member_count: 3,
          status: "active",
        });
      }
      if (channel === "community:get-members") {
        return Promise.resolve([
          { id: "m1", member_did: "did:cc:owner", role: "owner" },
          { id: "m2", member_did: "did:cc:bob", role: "member" },
        ]);
      }
      if (channel === "channel:get-list") {
        return Promise.resolve([
          {
            id: "ch1",
            community_id: "c1",
            name: "general",
            type: "discussion",
          },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.openDetails("c1");

    expect(store.viewingCommunityId).toBe("c1");
    expect(store.viewingCommunity?.name).toBe("Alpha");
    expect(store.viewingMembers).toHaveLength(2);
    expect(store.viewingChannels).toHaveLength(1);
    expect(store.detailsLoading).toBe(false);
    expect(store.detailsError).toBeNull();
  });

  it("openDetails() captures community-level error and surfaces it", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:get-by-id") {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.openDetails("c-missing");

    expect(store.viewingCommunityId).toBe("c-missing");
    expect(store.viewingCommunity).toBeNull();
    expect(store.detailsError).toBe("not found");
    expect(store.detailsLoading).toBe(false);
  });

  it("loadMembers() falls back to [] on backend failure", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:get-members") {
        return Promise.reject(new Error("table missing"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      viewingMembers: [{ id: "stale" } as never],
    });
    await store.loadMembers("c1");
    expect(store.viewingMembers).toEqual([]);
    expect(store.detailsError).toBe("table missing");
  });

  it("loadChannels() handles non-array payload gracefully", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:get-list") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.loadChannels("c1");
    expect(store.viewingChannels).toEqual([]);
  });

  it("closeDetails() resets all viewing state", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      viewingCommunityId: "c1",
      viewingCommunity: { id: "c1", name: "Alpha" },
      viewingMembers: [{ id: "m1" } as never],
      viewingChannels: [{ id: "ch1" } as never],
      detailsError: "old",
    });
    store.closeDetails();
    expect(store.viewingCommunityId).toBeNull();
    expect(store.viewingCommunity).toBeNull();
    expect(store.viewingMembers).toEqual([]);
    expect(store.viewingChannels).toEqual([]);
    expect(store.detailsError).toBeNull();
  });

  it("promoteMember() invokes IPC with newRole and reloads members", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:promote") {
        return Promise.resolve({ success: true });
      }
      if (channel === "community:get-members") {
        return Promise.resolve([
          { id: "m1", member_did: "did:cc:bob", role: "admin" },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.promoteMember("c1", "did:cc:bob", "admin");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "community:promote",
      "c1",
      "did:cc:bob",
      "admin",
    );
    expect(store.promotingDid).toBeNull();
    expect(store.viewingMembers[0]?.role).toBe("admin");
  });

  it("promoteMember() failure leaves error in detailsError", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:promote") {
        return Promise.reject(new Error("not authorized"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.promoteMember("c1", "did:cc:bob", "admin");

    expect(ok).toBe(false);
    expect(store.detailsError).toBe("not authorized");
    expect(store.promotingDid).toBeNull();
  });

  it("demoteMember() invokes IPC and reloads members", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:demote") {
        return Promise.resolve({ success: true });
      }
      if (channel === "community:get-members") {
        return Promise.resolve([
          { id: "m1", member_did: "did:cc:bob", role: "member" },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.demoteMember("c1", "did:cc:bob");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("community:demote", "c1", "did:cc:bob");
    expect(store.demotingDid).toBeNull();
  });

  it("banMember() invokes IPC, reloads members, and refreshes community detail", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:ban") {
        return Promise.resolve({ success: true });
      }
      if (channel === "community:get-members") {
        return Promise.resolve([]);
      }
      if (channel === "community:get-by-id") {
        return Promise.resolve({ id: "c1", member_count: 0 });
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.banMember("c1", "did:cc:bob");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("community:ban", "c1", "did:cc:bob");
    expect(invoke).toHaveBeenCalledWith("community:get-by-id", "c1");
    expect(store.banningDid).toBeNull();
    expect(store.viewingCommunity?.member_count).toBe(0);
  });

  it("banMember() failure leaves community detail untouched", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "community:ban") {
        return Promise.reject(new Error("backend down"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      viewingCommunity: { id: "c1", member_count: 5 },
    });
    const ok = await store.banMember("c1", "did:cc:bob");

    expect(ok).toBe(false);
    expect(store.detailsError).toBe("backend down");
    expect(store.viewingCommunity?.member_count).toBe(5);
    expect(store.banningDid).toBeNull();
  });

  it("clearDetailsError() resets only detailsError", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      detailsError: "boom",
      error: "main",
      createError: "third",
    });
    store.clearDetailsError();
    expect(store.detailsError).toBeNull();
    expect(store.error).toBe("main");
    expect(store.createError).toBe("third");
  });

  // ---- Phase 5: channel CRUD + messages -----------------------------------

  it("selectChannel() loads messages sorted chronologically", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:get-messages") {
        // Backend returns DESC; store should flip to ASC
        return Promise.resolve([
          { id: "m3", content: "third", created_at: 3000 },
          { id: "m1", content: "first", created_at: 1000 },
          { id: "m2", content: "second", created_at: 2000 },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.selectChannel("ch1");

    expect(store.selectedChannelId).toBe("ch1");
    expect(store.channelMessages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(store.messagesLoading).toBe(false);
  });

  it("loadMessages() captures error and falls back to []", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:get-messages") {
        return Promise.reject(new Error("backend down"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      selectedChannelId: "ch1",
      channelMessages: [{ id: "stale" } as never],
    });
    await store.loadMessages("ch1");
    expect(store.channelMessages).toEqual([]);
    expect(store.channelError).toBe("backend down");
  });

  it("clearSelectedChannel() resets messages + error", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      selectedChannelId: "ch1",
      channelMessages: [{ id: "m1" } as never],
      channelError: "stale",
    });
    store.clearSelectedChannel();
    expect(store.selectedChannelId).toBeNull();
    expect(store.channelMessages).toEqual([]);
    expect(store.channelError).toBeNull();
  });

  it("sendMessage() refuses without selected channel", async () => {
    const store = useCommunityQuickStore();
    const ok = await store.sendMessage("hi");
    expect(ok).toBe(false);
    expect(store.channelError).toMatch(/频道/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sendMessage() refuses empty content silently (no error)", async () => {
    const store = useCommunityQuickStore();
    store.$patch({ selectedChannelId: "ch1" });
    const ok = await store.sendMessage("   ");
    expect(ok).toBe(false);
    expect(store.channelError).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sendMessage() optimistically appends backend payload", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:send-message") {
        return Promise.resolve({
          id: "m-new",
          content: "hi",
          created_at: 9999,
        });
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      selectedChannelId: "ch1",
      channelMessages: [{ id: "m1", created_at: 1 } as never],
    });
    const ok = await store.sendMessage("hi");

    expect(ok).toBe(true);
    expect(store.channelMessages).toHaveLength(2);
    expect(store.channelMessages[1].id).toBe("m-new");
    expect(invoke).toHaveBeenCalledWith("channel:send-message", {
      channelId: "ch1",
      content: "hi",
      messageType: "text",
    });
    expect(store.sendingMessage).toBe(false);
  });

  it("sendMessage() falls back to reload when backend returns no message", async () => {
    let getMessagesCalls = 0;
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:send-message") {
        return Promise.resolve(null);
      }
      if (channel === "channel:get-messages") {
        getMessagesCalls += 1;
        return Promise.resolve([{ id: "reloaded", created_at: 5 }]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({ selectedChannelId: "ch1" });
    const ok = await store.sendMessage("hi");

    expect(ok).toBe(true);
    expect(getMessagesCalls).toBe(1);
    expect(store.channelMessages.map((m) => m.id)).toEqual(["reloaded"]);
  });

  it("sendMessage() failure populates channelError", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:send-message") {
        return Promise.reject(new Error("write denied"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({ selectedChannelId: "ch1" });
    const ok = await store.sendMessage("hi");
    expect(ok).toBe(false);
    expect(store.channelError).toBe("write denied");
    expect(store.sendingMessage).toBe(false);
  });

  it("pinMessage() toggles is_pinned locally on success", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:pin-message") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      channelMessages: [
        { id: "m1", is_pinned: 0 } as never,
        { id: "m2", is_pinned: 1 } as never,
      ],
    });

    await store.pinMessage("m1");
    expect(store.channelMessages[0].is_pinned).toBe(1);
    expect(store.channelMessages[1].is_pinned).toBe(1);

    await store.pinMessage("m2");
    expect(store.channelMessages[1].is_pinned).toBe(0);
    expect(store.pinningMessageId).toBeNull();
  });

  it("pinMessage() failure leaves messages untouched", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:pin-message") {
        return Promise.reject(new Error("forbidden"));
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      channelMessages: [{ id: "m1", is_pinned: 0 } as never],
    });
    const ok = await store.pinMessage("m1");
    expect(ok).toBe(false);
    expect(store.channelMessages[0].is_pinned).toBe(0);
    expect(store.channelError).toBe("forbidden");
  });

  it("createChannel() success calls IPC + reloads channel list", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:create") {
        return Promise.resolve({
          id: "ch-new",
          name: "general",
          type: "discussion",
        });
      }
      if (channel === "channel:get-list") {
        return Promise.resolve([
          { id: "ch-new", name: "general", type: "discussion" },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const result = await store.createChannel({
      communityId: "c1",
      name: "general",
    });

    expect(result?.id).toBe("ch-new");
    expect(store.viewingChannels).toHaveLength(1);
    const createCall = invoke.mock.calls.find((c) => c[0] === "channel:create");
    expect(createCall![1]).toMatchObject({
      communityId: "c1",
      name: "general",
      type: "discussion",
      sortOrder: 0,
    });
    expect(store.creatingChannel).toBe(false);
  });

  it("createChannel() rejects empty name without IPC", async () => {
    const store = useCommunityQuickStore();
    const result = await store.createChannel({
      communityId: "c1",
      name: "  ",
    });
    expect(result).toBeNull();
    expect(store.channelError).toMatch(/名称/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("deleteChannel() clears selection if deleting the active channel", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:delete") {
        return Promise.resolve({ success: true });
      }
      if (channel === "channel:get-list") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({
      selectedChannelId: "ch-active",
      channelMessages: [{ id: "m1" } as never],
    });
    const ok = await store.deleteChannel("ch-active", "c1");

    expect(ok).toBe(true);
    expect(store.selectedChannelId).toBeNull();
    expect(store.channelMessages).toEqual([]);
    expect(store.viewingChannels).toEqual([]);
  });

  it("deleteChannel() preserves selection if deleting a different channel", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "channel:delete") {
        return Promise.resolve({ success: true });
      }
      if (channel === "channel:get-list") {
        return Promise.resolve([{ id: "ch-active", name: "a" }]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    store.$patch({ selectedChannelId: "ch-active" });
    const ok = await store.deleteChannel("ch-other", "c1");

    expect(ok).toBe(true);
    expect(store.selectedChannelId).toBe("ch-active");
  });

  it("closeDetails() also clears selected channel + messages + channelError", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      viewingCommunityId: "c1",
      selectedChannelId: "ch1",
      channelMessages: [{ id: "m1" } as never],
      channelError: "boom",
    });
    store.closeDetails();
    expect(store.selectedChannelId).toBeNull();
    expect(store.channelMessages).toEqual([]);
    expect(store.channelError).toBeNull();
  });

  it("clearChannelError() resets only channelError", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      channelError: "x",
      error: "main",
      detailsError: "details",
    });
    store.clearChannelError();
    expect(store.channelError).toBeNull();
    expect(store.error).toBe("main");
    expect(store.detailsError).toBe("details");
  });

  // ---- Phase 6: governance + moderation -----------------------------------

  it("loadProposals() populates list and flips proposalsLoaded", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "governance:get-proposals") {
        return Promise.resolve([
          { id: "p1", title: "P1", status: "voting" },
          { id: "p2", title: "P2", status: "passed" },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.loadProposals("c1");
    expect(store.viewingProposals).toHaveLength(2);
    expect(store.proposalsLoaded).toBe(true);
    expect(store.proposalsLoading).toBe(false);
  });

  it("loadProposals() captures error and falls back to []", async () => {
    invoke.mockImplementation(() =>
      Promise.reject(new Error("engine offline")),
    );
    const store = useCommunityQuickStore();
    store.$patch({ viewingProposals: [{ id: "stale" } as never] });
    await store.loadProposals("c1");
    expect(store.viewingProposals).toEqual([]);
    expect(store.governanceError).toBe("engine offline");
    expect(store.proposalsLoaded).toBe(false);
  });

  it("createProposal() converts hours to ms and reloads list", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "governance:create-proposal") {
        return Promise.resolve({ id: "p-new", title: "New" });
      }
      if (channel === "governance:get-proposals") {
        return Promise.resolve([{ id: "p-new", title: "New" }]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const result = await store.createProposal({
      communityId: "c1",
      title: "New",
      description: "...",
      proposalType: "rule_change",
      discussionHours: 12,
      votingHours: 24,
    });

    expect(result?.id).toBe("p-new");
    const createCall = invoke.mock.calls.find(
      (c) => c[0] === "governance:create-proposal",
    );
    expect(createCall![1]).toEqual({
      communityId: "c1",
      title: "New",
      description: "...",
      proposalType: "rule_change",
      discussionDuration: 12 * 60 * 60 * 1000,
      votingDuration: 24 * 60 * 60 * 1000,
    });
    expect(store.viewingProposals).toHaveLength(1);
    expect(store.creatingProposal).toBe(false);
  });

  it("createProposal() rejects empty title without IPC", async () => {
    const store = useCommunityQuickStore();
    const result = await store.createProposal({
      communityId: "c1",
      title: "  ",
    });
    expect(result).toBeNull();
    expect(store.governanceError).toMatch(/标题/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createProposal() defaults durations when missing", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "governance:create-proposal") {
        return Promise.resolve({ id: "p1" });
      }
      return Promise.resolve([]);
    });
    const store = useCommunityQuickStore();
    await store.createProposal({ communityId: "c1", title: "T" });
    const call = invoke.mock.calls.find(
      (c) => c[0] === "governance:create-proposal",
    );
    expect(call![1]).toMatchObject({
      proposalType: "other",
      discussionDuration: 24 * 60 * 60 * 1000,
      votingDuration: 48 * 60 * 60 * 1000,
    });
  });

  it("castVote() invokes IPC and reloads proposals", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "governance:vote") {
        return Promise.resolve({ success: true });
      }
      if (channel === "governance:get-proposals") {
        return Promise.resolve([{ id: "p1", status: "voting" }]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.castVote("p1", "approve", "c1");
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("governance:vote", "p1", "approve");
    expect(invoke).toHaveBeenCalledWith("governance:get-proposals", "c1");
    expect(store.votingProposalId).toBeNull();
  });

  it("castVote() failure surfaces error and clears flag", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "governance:vote") {
        return Promise.reject(new Error("already voted"));
      }
      return Promise.resolve(null);
    });
    const store = useCommunityQuickStore();
    const ok = await store.castVote("p1", "approve", "c1");
    expect(ok).toBe(false);
    expect(store.governanceError).toBe("already voted");
    expect(store.votingProposalId).toBeNull();
  });

  it("loadModerationLog() populates queue and flips moderationLoaded", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "moderation:get-log") {
        return Promise.resolve([
          { id: "r1", status: "pending" },
          { id: "r2", status: "resolved" },
        ]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    await store.loadModerationLog("c1");
    expect(store.viewingModerationLog).toHaveLength(2);
    expect(store.moderationLoaded).toBe(true);
    expect(invoke).toHaveBeenCalledWith("moderation:get-log", "c1", {
      limit: 100,
    });
  });

  it("loadModerationLog() captures error and falls back to []", async () => {
    invoke.mockImplementation(() =>
      Promise.reject(new Error("moderator offline")),
    );
    const store = useCommunityQuickStore();
    store.$patch({ viewingModerationLog: [{ id: "x" } as never] });
    await store.loadModerationLog("c1");
    expect(store.viewingModerationLog).toEqual([]);
    expect(store.moderationError).toBe("moderator offline");
  });

  it("reviewReport() invokes IPC with action+reason and reloads log", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "moderation:review") {
        return Promise.resolve({ success: true });
      }
      if (channel === "moderation:get-log") {
        return Promise.resolve([{ id: "r1", status: "resolved" }]);
      }
      return Promise.resolve(null);
    });

    const store = useCommunityQuickStore();
    const ok = await store.reviewReport("r1", "removed", "spam", "c1");
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "moderation:review",
      "r1",
      "removed",
      "spam",
    );
    expect(store.reviewingReportId).toBeNull();
    expect(store.viewingModerationLog[0]?.status).toBe("resolved");
  });

  it("reviewReport() failure preserves queue + clears flag", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "moderation:review") {
        return Promise.reject(new Error("forbidden"));
      }
      return Promise.resolve(null);
    });
    const store = useCommunityQuickStore();
    store.$patch({
      viewingModerationLog: [{ id: "r1", status: "pending" } as never],
    });
    const ok = await store.reviewReport("r1", "removed", "", "c1");
    expect(ok).toBe(false);
    expect(store.moderationError).toBe("forbidden");
    expect(store.viewingModerationLog[0]?.status).toBe("pending");
    expect(store.reviewingReportId).toBeNull();
  });

  it("closeDetails() also clears Phase 6 state", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      viewingCommunityId: "c1",
      viewingProposals: [{ id: "p1" } as never],
      proposalsLoaded: true,
      governanceError: "g",
      viewingModerationLog: [{ id: "r1" } as never],
      moderationLoaded: true,
      moderationError: "m",
    });
    store.closeDetails();
    expect(store.viewingProposals).toEqual([]);
    expect(store.proposalsLoaded).toBe(false);
    expect(store.governanceError).toBeNull();
    expect(store.viewingModerationLog).toEqual([]);
    expect(store.moderationLoaded).toBe(false);
    expect(store.moderationError).toBeNull();
  });

  it("clearGovernanceError + clearModerationError isolate from other errors", () => {
    const store = useCommunityQuickStore();
    store.$patch({
      governanceError: "g",
      moderationError: "m",
      error: "main",
      detailsError: "d",
    });
    store.clearGovernanceError();
    expect(store.governanceError).toBeNull();
    expect(store.moderationError).toBe("m");

    store.clearModerationError();
    expect(store.moderationError).toBeNull();
    expect(store.error).toBe("main");
    expect(store.detailsError).toBe("d");
  });
});
