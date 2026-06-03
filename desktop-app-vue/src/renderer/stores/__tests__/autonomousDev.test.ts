/**
 * useAutonomousDevStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: completedSessions (status === 'complete') / activeSessions
 *    (status not in [complete, failed]) / sessionCount
 *  - IPC actions (electronAPI.invoke mocked): startSession (set currentSession +
 *    chains fetchSessions / error), refineSession (set currentSession),
 *    generateCode (set currentSession), reviewCode (return / error), fetchSessions
 *    (populate)
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

import { useAutonomousDevStore } from "../autonomousDev";

describe("useAutonomousDevStore", () => {
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
    it("starts empty", () => {
      const store = useAutonomousDevStore();
      expect(store.sessions).toEqual([]);
      expect(store.currentSession).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("completedSessions / activeSessions split by status; sessionCount counts all", () => {
      const store = useAutonomousDevStore();
      store.sessions = [
        { id: "a", status: "complete" },
        { id: "b", status: "generating" },
        { id: "c", status: "failed" },
        { id: "d", status: "reviewing" },
      ];
      expect(store.completedSessions.map((s: any) => s.id)).toEqual(["a"]);
      // active = not complete and not failed
      expect(store.activeSessions.map((s: any) => s.id)).toEqual(["b", "d"]);
      expect(store.sessionCount).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("startSession stores the session and chains fetchSessions", async () => {
      const store = useAutonomousDevStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, session: { id: "s1" } }) // start
        .mockResolvedValueOnce({
          success: true,
          sessions: [{ id: "s1", status: "generating" }],
        }); // list
      await store.startSession("build a todo app", "Todo");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "autonomous-dev:start-session",
        { intent: "build a todo app", title: "Todo" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "autonomous-dev:list-sessions",
        undefined,
      );
      expect(store.currentSession).toEqual({ id: "s1" });
      expect(store.sessions).toHaveLength(1);
      expect(store.loading).toBe(false);
    });

    it("startSession records the error on failure", async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await store.startSession("x");
      expect(store.error).toBe("denied");
      expect(store.currentSession).toBeNull();
    });

    it("refineSession updates the current session", async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValue({
        success: true,
        session: { id: "s1", status: "refined" },
      });
      await store.refineSession("s1", "add tests");
      expect(mockInvoke).toHaveBeenCalledWith("autonomous-dev:refine", {
        sessionId: "s1",
        feedback: "add tests",
      });
      expect(store.currentSession?.status).toBe("refined");
    });

    it("generateCode updates the current session", async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValue({
        success: true,
        session: { id: "s1", status: "generated" },
      });
      await store.generateCode("s1");
      expect(mockInvoke).toHaveBeenCalledWith("autonomous-dev:generate", {
        sessionId: "s1",
      });
      expect(store.currentSession?.status).toBe("generated");
    });

    it("reviewCode returns the result and records errors", async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValue({ success: true, findings: [] });
      const ok = await store.reviewCode("s1");
      expect(mockInvoke).toHaveBeenCalledWith("autonomous-dev:review", {
        sessionId: "s1",
      });
      expect(ok).toEqual({ success: true, findings: [] });

      mockInvoke.mockResolvedValue({ success: false, error: "lint fail" });
      await store.reviewCode("s1");
      expect(store.error).toBe("lint fail");
    });

    it("fetchSessions populates the session list", async () => {
      const store = useAutonomousDevStore();
      mockInvoke.mockResolvedValue({
        success: true,
        sessions: [{ id: "s1" }, { id: "s2" }],
      });
      await store.fetchSessions({ status: "complete" });
      expect(mockInvoke).toHaveBeenCalledWith("autonomous-dev:list-sessions", {
        status: "complete",
      });
      expect(store.sessions).toHaveLength(2);
    });
  });
});
