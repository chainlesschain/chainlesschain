/**
 * useCallHistoryStore — Pinia store unit tests (V5→V6 page port, Phase 2)
 *
 * Covers:
 *  - Initial state defaults + filteredHistory getter
 *  - filterType filters records by type; "all" passes through
 *  - loadHistory() success populates records + hasLoaded ({success,history} wrapper)
 *  - loadHistory() failure surfaces error from the wrapper
 *  - loadHistory() non-array history → [] (graceful)
 *  - loadFriends() builds the DID→name map; peerName() resolves / falls back
 *  - loadAll() runs both
 *  - deleteRecord() success removes the row + clears flag
 *  - deleteRecord() failure returns false + sets error
 *  - deleteRecord() closes the detail drawer when deleting the open record
 *  - clearAll() success empties records
 *  - clearAll() failure returns false + sets error
 *  - openDetails/closeDetails + clearError
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCallHistoryStore } from "../callHistory";

describe("useCallHistoryStore (Phase 2 port)", () => {
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
    const store = useCallHistoryStore();
    expect(store.records).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.filterType).toBe("all");
    expect(store.deletingId).toBeNull();
    expect(store.clearing).toBe(false);
    expect(store.selectedRecord).toBeNull();
    expect(store.detailsOpen).toBe(false);
    expect(store.filteredHistory).toEqual([]);
  });

  it("filteredHistory honors filterType; 'all' passes through", () => {
    const store = useCallHistoryStore();
    store.$patch({
      records: [
        { id: "1", type: "audio" },
        { id: "2", type: "video" },
        { id: "3", type: "screen" },
        { id: "4", type: "audio" },
      ],
    });
    expect(store.filteredHistory.map((r) => r.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    store.setFilter("audio");
    expect(store.filteredHistory.map((r) => r.id)).toEqual(["1", "4"]);
    store.setFilter("video");
    expect(store.filteredHistory.map((r) => r.id)).toEqual(["2"]);
  });

  it("loadHistory() unwraps {success,history} into records + hasLoaded", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      history: [
        { id: "a", type: "audio" },
        { id: "b", type: "video" },
      ],
    });
    const store = useCallHistoryStore();
    await store.loadHistory();
    expect(invoke).toHaveBeenCalledWith("call-history:get-all");
    expect(store.records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("loadHistory() surfaces a failed wrapper as error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "db locked" });
    const store = useCallHistoryStore();
    await store.loadHistory();
    expect(store.error).toBe("db locked");
    expect(store.records).toEqual([]);
    expect(store.hasLoaded).toBe(true);
  });

  it("loadHistory() tolerates a non-array history payload", async () => {
    invoke.mockResolvedValueOnce({ success: true, history: null });
    const store = useCallHistoryStore();
    await store.loadHistory();
    expect(store.records).toEqual([]);
  });

  it("loadHistory() captures a thrown error", async () => {
    invoke.mockRejectedValueOnce(new Error("ipc boom"));
    const store = useCallHistoryStore();
    await store.loadHistory();
    expect(store.error).toBe("ipc boom");
    expect(store.loading).toBe(false);
  });

  it("loadFriends() builds the DID→name map; peerName resolves and falls back", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      friends: [
        { friend_did: "did:abc12345xyz", display_name: "Alice" },
        { friend_did: "did:def67890xyz", nickname: "Bob" },
        { friend_did: "did:ghijklmnop" },
      ],
    });
    const store = useCallHistoryStore();
    await store.loadFriends();
    expect(store.peerName("did:abc12345xyz")).toBe("Alice");
    expect(store.peerName("did:def67890xyz")).toBe("Bob");
    expect(store.peerName("did:ghijklmnop")).toBe("did:ghij…"); // truncated DID
    expect(store.peerName("did:unknown999")).toBe("did:unkn…");
    expect(store.peerName(undefined)).toBe("未知");
  });

  it("loadFriends() stays best-effort on failure (empty map, no throw)", async () => {
    invoke.mockRejectedValueOnce(new Error("no friends ipc"));
    const store = useCallHistoryStore();
    await expect(store.loadFriends()).resolves.toBeUndefined();
    expect(store.friendsMap.size).toBe(0);
  });

  it("loadAll() loads friends + history", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "friend:list") {
        return Promise.resolve({
          success: true,
          friends: [{ friend_did: "did:p1", display_name: "Peer One" }],
        });
      }
      if (channel === "call-history:get-all") {
        return Promise.resolve({
          success: true,
          history: [{ id: "x", type: "audio", peerId: "did:p1" }],
        });
      }
      return Promise.resolve(undefined);
    });
    const store = useCallHistoryStore();
    await store.loadAll();
    expect(store.records.map((r) => r.id)).toEqual(["x"]);
    expect(store.peerName("did:p1")).toBe("Peer One");
  });

  it("deleteRecord() success removes the row + clears the flag", async () => {
    const store = useCallHistoryStore();
    store.$patch({
      records: [
        { id: "1", type: "audio" },
        { id: "2", type: "video" },
      ],
    });
    invoke.mockResolvedValueOnce({ success: true });
    const ok = await store.deleteRecord("1");
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("call-history:delete", "1");
    expect(store.records.map((r) => r.id)).toEqual(["2"]);
    expect(store.deletingId).toBeNull();
  });

  it("deleteRecord() failure returns false + sets error, keeps the row", async () => {
    const store = useCallHistoryStore();
    store.$patch({ records: [{ id: "1", type: "audio" }] });
    invoke.mockResolvedValueOnce({ success: false, error: "nope" });
    const ok = await store.deleteRecord("1");
    expect(ok).toBe(false);
    expect(store.error).toBe("nope");
    expect(store.records.map((r) => r.id)).toEqual(["1"]);
  });

  it("deleteRecord() closes the detail drawer when the open record is removed", async () => {
    const store = useCallHistoryStore();
    const rec = { id: "1", type: "audio" };
    store.$patch({ records: [rec] });
    store.openDetails(rec);
    expect(store.detailsOpen).toBe(true);
    invoke.mockResolvedValueOnce({ success: true });
    await store.deleteRecord("1");
    expect(store.detailsOpen).toBe(false);
    expect(store.selectedRecord).toBeNull();
  });

  it("clearAll() success empties records", async () => {
    const store = useCallHistoryStore();
    store.$patch({
      records: [
        { id: "1", type: "audio" },
        { id: "2", type: "video" },
      ],
    });
    invoke.mockResolvedValueOnce({ success: true });
    const ok = await store.clearAll();
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("call-history:clear-all");
    expect(store.records).toEqual([]);
    expect(store.clearing).toBe(false);
  });

  it("clearAll() failure returns false + sets error", async () => {
    const store = useCallHistoryStore();
    store.$patch({ records: [{ id: "1", type: "audio" }] });
    invoke.mockResolvedValueOnce({ success: false, error: "busy" });
    const ok = await store.clearAll();
    expect(ok).toBe(false);
    expect(store.error).toBe("busy");
    expect(store.records.map((r) => r.id)).toEqual(["1"]);
  });

  it("openDetails/closeDetails + clearError", () => {
    const store = useCallHistoryStore();
    const rec = { id: "9", type: "screen" };
    store.openDetails(rec);
    expect(store.selectedRecord).toEqual(rec);
    expect(store.detailsOpen).toBe(true);
    store.closeDetails();
    expect(store.selectedRecord).toBeNull();
    expect(store.detailsOpen).toBe(false);
    store.$patch({ error: "x" });
    store.clearError();
    expect(store.error).toBeNull();
  });
});
