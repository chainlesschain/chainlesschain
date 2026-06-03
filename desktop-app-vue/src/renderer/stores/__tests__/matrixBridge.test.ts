/**
 * useMatrixBridgeStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isLoggedIn (loginState === 'logged_in') / encryptedRooms
 *    (is_encrypted === 1) / roomCount
 *  - IPC actions (electronAPI.invoke mocked): login (set session / error),
 *    fetchRooms (populate), sendMessage (chains fetchMessages), fetchMessages
 *    (populate), joinRoom (chains fetchRooms)
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useMatrixBridgeStore } from "../matrixBridge";
import type { MatrixRoom } from "../matrixBridge";

function room(id: string, is_encrypted = 0): MatrixRoom {
  return {
    id,
    room_id: `!${id}:matrix.org`,
    name: `Room ${id}`,
    topic: "",
    is_encrypted,
    member_count: 1,
    last_event_at: null,
    joined_at: 1700000000000,
    status: "joined",
  };
}

describe("useMatrixBridgeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts logged out and empty", () => {
      const store = useMatrixBridgeStore();
      expect(store.rooms).toEqual([]);
      expect(store.messages).toEqual([]);
      expect(store.loginState).toBe("logged_out");
      expect(store.userId).toBeNull();
      expect(store.homeserver).toBe("https://matrix.org");
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("isLoggedIn reflects loginState", () => {
      const store = useMatrixBridgeStore();
      expect(store.isLoggedIn).toBe(false);
      store.loginState = "logged_in";
      expect(store.isLoggedIn).toBe(true);
    });

    it("encryptedRooms filters is_encrypted === 1; roomCount counts all", () => {
      const store = useMatrixBridgeStore();
      store.rooms = [room("a", 1), room("b", 0), room("c", 1)];
      expect(store.encryptedRooms.map((r) => r.id)).toEqual(["a", "c"]);
      expect(store.roomCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("login sets the session on success", async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockResolvedValue({
        success: true,
        userId: "@me:matrix.org",
        homeserver: "https://hs",
      });
      await store.login("https://hs", "@me:matrix.org", "pw");
      expect(mockInvoke).toHaveBeenCalledWith("matrix:login", {
        homeserver: "https://hs",
        userId: "@me:matrix.org",
        password: "pw",
      });
      expect(store.loginState).toBe("logged_in");
      expect(store.userId).toBe("@me:matrix.org");
      expect(store.homeserver).toBe("https://hs");
      expect(store.loading).toBe(false);
    });

    it("login records the error on failure", async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockResolvedValue({ success: false, error: "bad creds" });
      await store.login("https://hs", "@me", "pw");
      expect(store.error).toBe("bad creds");
      expect(store.loginState).toBe("logged_out");
    });

    it("fetchRooms populates rooms", async () => {
      const store = useMatrixBridgeStore();
      mockInvoke.mockResolvedValue({
        success: true,
        rooms: [room("a"), room("b")],
      });
      await store.fetchRooms();
      expect(mockInvoke).toHaveBeenCalledWith("matrix:list-rooms");
      expect(store.rooms.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("sendMessage chains fetchMessages on success", async () => {
      const store = useMatrixBridgeStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // send
        .mockResolvedValueOnce({
          success: true,
          messages: [{ id: "m1" }],
        }); // get-messages
      await store.sendMessage("!r:matrix.org", "hello", "m.text");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "matrix:send-message", {
        roomId: "!r:matrix.org",
        body: "hello",
        msgtype: "m.text",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "matrix:get-messages", {
        roomId: "!r:matrix.org",
        limit: undefined,
        since: undefined,
      });
      expect(store.messages).toHaveLength(1);
    });

    it("joinRoom chains fetchRooms on success", async () => {
      const store = useMatrixBridgeStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // join
        .mockResolvedValueOnce({ success: true, rooms: [room("a")] }); // list
      await store.joinRoom("#alias:matrix.org");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "matrix:join-room", {
        roomIdOrAlias: "#alias:matrix.org",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "matrix:list-rooms");
      expect(store.rooms.map((r) => r.id)).toEqual(["a"]);
    });
  });
});
