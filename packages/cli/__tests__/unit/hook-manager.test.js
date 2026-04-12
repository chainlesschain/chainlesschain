import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  HookPriority,
  HookType,
  HookEvents,
  ensureHookTables,
  registerHook,
  unregisterHook,
  listHooks,
  getHook,
  executeHook,
  executeHooks,
  getHookStats,
  updateHookStats,
  compileMatcher,
} from "../../src/lib/hook-manager.js";

describe("Hook Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constants ──────────────────────────────────────────

  describe("HookPriority", () => {
    it("defines correct priority levels", () => {
      expect(HookPriority.SYSTEM).toBe(0);
      expect(HookPriority.HIGH).toBe(100);
      expect(HookPriority.NORMAL).toBe(500);
      expect(HookPriority.LOW).toBe(900);
      expect(HookPriority.MONITOR).toBe(1000);
    });

    it("SYSTEM has lowest value (runs first)", () => {
      const values = Object.values(HookPriority);
      expect(Math.min(...values)).toBe(HookPriority.SYSTEM);
    });
  });

  describe("HookType", () => {
    it("defines all hook types", () => {
      expect(HookType.SYNC).toBe("sync");
      expect(HookType.ASYNC).toBe("async");
      expect(HookType.COMMAND).toBe("command");
      expect(HookType.SCRIPT).toBe("script");
    });
  });

  describe("HookEvents", () => {
    it("defines 30 event types", () => {
      const eventCount = Object.keys(HookEvents).length;
      expect(eventCount).toBe(30);
    });

    it("includes IPC events", () => {
      expect(HookEvents.PreIPCCall).toBe("PreIPCCall");
      expect(HookEvents.PostIPCCall).toBe("PostIPCCall");
      expect(HookEvents.IPCError).toBe("IPCError");
    });

    it("includes tool events", () => {
      expect(HookEvents.PreToolUse).toBe("PreToolUse");
      expect(HookEvents.PostToolUse).toBe("PostToolUse");
      expect(HookEvents.ToolError).toBe("ToolError");
    });

    it("includes session events", () => {
      expect(HookEvents.SessionStart).toBe("SessionStart");
      expect(HookEvents.SessionEnd).toBe("SessionEnd");
    });

    it("includes git events", () => {
      expect(HookEvents.PreGitCommit).toBe("PreGitCommit");
      expect(HookEvents.PostGitCommit).toBe("PostGitCommit");
      expect(HookEvents.PreGitPush).toBe("PreGitPush");
      expect(HookEvents.CIFailure).toBe("CIFailure");
    });

    it("includes compliance events", () => {
      expect(HookEvents.AuditLog).toBe("AuditLog");
      expect(HookEvents.ComplianceCheck).toBe("ComplianceCheck");
      expect(HookEvents.DataSubjectRequest).toBe("DataSubjectRequest");
    });
  });

  // ─── ensureHookTables ───────────────────────────────────

  describe("ensureHookTables", () => {
    it("creates hooks table", () => {
      ensureHookTables(db);
      expect(db.tables.has("hooks")).toBe(true);
    });

    it("is idempotent", () => {
      ensureHookTables(db);
      ensureHookTables(db);
      expect(db.tables.has("hooks")).toBe(true);
    });
  });

  // ─── registerHook ──────────────────────────────────────

  describe("registerHook", () => {
    it("registers a hook with minimal config", () => {
      const result = registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "my-hook",
      });
      expect(result.id).toMatch(/^hook-/);
      expect(result.event).toBe("PreIPCCall");
      expect(result.name).toBe("my-hook");
      expect(result.type).toBe("sync");
      expect(result.priority).toBe(500);
      expect(result.enabled).toBe(true);
    });

    it("registers a hook with full config", () => {
      const result = registerHook(db, {
        event: HookEvents.PostToolUse,
        name: "audit-tool",
        type: HookType.ASYNC,
        priority: HookPriority.HIGH,
        handler: "echo done",
        matcher: "Edit|Write",
        timeout: 10000,
        enabled: false,
        description: "Audit tool usage",
      });
      expect(result.type).toBe("async");
      expect(result.priority).toBe(100);
      expect(result.matcher).toBe("Edit|Write");
      expect(result.enabled).toBe(false);
      expect(result.description).toBe("Audit tool usage");
    });

    it("throws when event is missing", () => {
      expect(() => registerHook(db, { name: "no-event" })).toThrow(
        "Hook event is required",
      );
    });

    it("throws when name is missing", () => {
      expect(() => registerHook(db, { event: HookEvents.PreIPCCall })).toThrow(
        "Hook name is required",
      );
    });

    it("throws on invalid event name", () => {
      expect(() =>
        registerHook(db, { event: "InvalidEvent", name: "bad" }),
      ).toThrow("Invalid hook event: InvalidEvent");
    });

    it("throws on invalid hook type", () => {
      expect(() =>
        registerHook(db, {
          event: HookEvents.PreIPCCall,
          name: "bad-type",
          type: "invalid",
        }),
      ).toThrow("Invalid hook type: invalid");
    });

    it("generates unique IDs", () => {
      const h1 = registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "hook-1",
      });
      const h2 = registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "hook-2",
      });
      expect(h1.id).not.toBe(h2.id);
    });
  });

  // ─── unregisterHook ─────────────────────────────────────

  describe("unregisterHook", () => {
    it("removes an existing hook", () => {
      const hook = registerHook(db, {
        event: HookEvents.SessionStart,
        name: "test",
      });
      const ok = unregisterHook(db, hook.id);
      expect(ok).toBe(true);
    });

    it("returns false for non-existent hook", () => {
      ensureHookTables(db);
      const ok = unregisterHook(db, "hook-nonexistent");
      expect(ok).toBe(false);
    });
  });

  // ─── listHooks ──────────────────────────────────────────

  describe("listHooks", () => {
    beforeEach(() => {
      registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "ipc-1",
        priority: HookPriority.HIGH,
      });
      registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "ipc-2",
        priority: HookPriority.LOW,
        enabled: false,
      });
      registerHook(db, {
        event: HookEvents.SessionStart,
        name: "session-1",
        priority: HookPriority.NORMAL,
      });
    });

    it("lists all hooks", () => {
      const hooks = listHooks(db);
      expect(hooks.length).toBe(3);
    });

    it("filters by event", () => {
      const hooks = listHooks(db, { event: HookEvents.PreIPCCall });
      expect(hooks.length).toBe(2);
      for (const h of hooks) {
        expect(h.event).toBe("PreIPCCall");
      }
    });

    it("filters by enabled only", () => {
      const hooks = listHooks(db, { enabledOnly: true });
      expect(hooks.length).toBe(2);
      for (const h of hooks) {
        expect(h.enabled).toBe(1);
      }
    });

    it("filters by event and enabled", () => {
      const hooks = listHooks(db, {
        event: HookEvents.PreIPCCall,
        enabledOnly: true,
      });
      expect(hooks.length).toBe(1);
      expect(hooks[0].name).toBe("ipc-1");
    });

    it("returns hooks sorted by priority (ascending)", () => {
      const hooks = listHooks(db, { event: HookEvents.PreIPCCall });
      expect(hooks[0].priority).toBeLessThanOrEqual(hooks[1].priority);
    });
  });

  // ─── getHook ────────────────────────────────────────────

  describe("getHook", () => {
    it("returns a hook by ID", () => {
      const created = registerHook(db, {
        event: HookEvents.AgentStart,
        name: "get-test",
      });
      const found = getHook(db, created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe("get-test");
    });

    it("returns null for unknown ID", () => {
      ensureHookTables(db);
      const found = getHook(db, "hook-missing");
      expect(found).toBeFalsy();
    });
  });

  // ─── compileMatcher ─────────────────────────────────────

  describe("compileMatcher", () => {
    it("matches everything when pattern is null", () => {
      const fn = compileMatcher(null);
      expect(fn("anything")).toBe(true);
      expect(fn("")).toBe(true);
    });

    it("matches everything when pattern is undefined", () => {
      const fn = compileMatcher(undefined);
      expect(fn("test")).toBe(true);
    });

    it("matches exact string", () => {
      const fn = compileMatcher("Edit");
      expect(fn("Edit")).toBe(true);
      expect(fn("Write")).toBe(false);
    });

    it("matches wildcard *", () => {
      const fn = compileMatcher("Pre*");
      expect(fn("PreIPCCall")).toBe(true);
      expect(fn("PreToolUse")).toBe(true);
      expect(fn("PostIPCCall")).toBe(false);
    });

    it("matches wildcard ?", () => {
      const fn = compileMatcher("hook-?");
      expect(fn("hook-a")).toBe(true);
      expect(fn("hook-1")).toBe(true);
      expect(fn("hook-ab")).toBe(false);
    });

    it("matches pipe-separated patterns", () => {
      const fn = compileMatcher("Edit|Write|Read");
      expect(fn("Edit")).toBe(true);
      expect(fn("Write")).toBe(true);
      expect(fn("Read")).toBe(true);
      expect(fn("Delete")).toBe(false);
    });

    it("matches regex pattern", () => {
      const fn = compileMatcher("/^Pre/");
      expect(fn("PreIPCCall")).toBe(true);
      expect(fn("PreToolUse")).toBe(true);
      expect(fn("PostIPCCall")).toBe(false);
    });

    it("matches regex with flags", () => {
      const fn = compileMatcher("/edit/i");
      expect(fn("Edit")).toBe(true);
      expect(fn("EDIT")).toBe(true);
      expect(fn("edit")).toBe(true);
    });
  });

  // ─── executeHook ────────────────────────────────────────

  describe("executeHook", () => {
    it("executes a hook with handlerFn", async () => {
      const hook = {
        event: HookEvents.PreIPCCall,
        type: HookType.SYNC,
        handlerFn: vi.fn(() => "result-value"),
      };
      const outcome = await executeHook(hook, { channel: "test" });
      expect(outcome.success).toBe(true);
      expect(outcome.result).toBe("result-value");
      expect(outcome.error).toBeNull();
      expect(typeof outcome.executionTime).toBe("number");
    });

    it("returns success with null result when no handler", async () => {
      const hook = { event: HookEvents.PreIPCCall, type: HookType.SYNC };
      const outcome = await executeHook(hook, {});
      expect(outcome.success).toBe(true);
      expect(outcome.result).toBeNull();
    });

    it("catches errors from handlerFn", async () => {
      const hook = {
        event: HookEvents.PreIPCCall,
        type: HookType.ASYNC,
        handlerFn: vi.fn(() => {
          throw new Error("handler failed");
        }),
      };
      const outcome = await executeHook(hook, {});
      expect(outcome.success).toBe(false);
      expect(outcome.error).toBe("handler failed");
    });

    it("returns error when command type has no handler", async () => {
      const hook = {
        event: HookEvents.PreIPCCall,
        type: HookType.COMMAND,
        handler: "",
      };
      const outcome = await executeHook(hook, {});
      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain("No handler command");
    });
  });

  // ─── executeHooks ───────────────────────────────────────

  describe("executeHooks", () => {
    it("executes hooks for an event in priority order", async () => {
      registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "low-priority",
        priority: HookPriority.LOW,
      });
      registerHook(db, {
        event: HookEvents.PreIPCCall,
        name: "high-priority",
        priority: HookPriority.HIGH,
      });

      const results = await executeHooks(db, HookEvents.PreIPCCall, {});
      expect(results.length).toBe(2);
      // High priority should run first (listed first by ORDER BY priority ASC)
      expect(results[0].hookName).toBe("high-priority");
      expect(results[1].hookName).toBe("low-priority");
    });

    it("skips disabled hooks", async () => {
      registerHook(db, {
        event: HookEvents.SessionStart,
        name: "enabled-hook",
      });
      registerHook(db, {
        event: HookEvents.SessionStart,
        name: "disabled-hook",
        enabled: false,
      });

      const results = await executeHooks(db, HookEvents.SessionStart, {});
      expect(results.length).toBe(1);
      expect(results[0].hookName).toBe("enabled-hook");
    });

    it("returns empty array when no hooks match", async () => {
      ensureHookTables(db);
      const results = await executeHooks(db, HookEvents.CIFailure, {});
      expect(results).toEqual([]);
    });
  });

  // ─── getHookStats / updateHookStats ─────────────────────

  describe("hook stats", () => {
    it("returns stats for registered hooks", () => {
      registerHook(db, { event: HookEvents.PreIPCCall, name: "stats-hook" });
      const stats = getHookStats(db);
      expect(stats.length).toBe(1);
      expect(stats[0].name).toBe("stats-hook");
      expect(stats[0].executionCount).toBe(0);
      expect(stats[0].errorCount).toBe(0);
      expect(stats[0].avgExecutionTime).toBe(0);
    });

    it("updates stats after successful execution", () => {
      const hook = registerHook(db, {
        event: HookEvents.PostIPCCall,
        name: "count-hook",
      });
      updateHookStats(db, hook.id, { executionTime: 50, success: true });
      updateHookStats(db, hook.id, { executionTime: 30, success: true });

      const stats = getHookStats(db);
      const s = stats.find((h) => h.id === hook.id);
      expect(s.executionCount).toBe(2);
      expect(s.errorCount).toBe(0);
      expect(s.totalExecutionTime).toBe(80);
      expect(s.avgExecutionTime).toBe(40);
    });

    it("tracks error count", () => {
      const hook = registerHook(db, {
        event: HookEvents.ToolError,
        name: "error-hook",
      });
      updateHookStats(db, hook.id, { executionTime: 10, success: true });
      updateHookStats(db, hook.id, { executionTime: 5, success: false });

      const stats = getHookStats(db);
      const s = stats.find((h) => h.id === hook.id);
      expect(s.executionCount).toBe(2);
      expect(s.errorCount).toBe(1);
    });

    it("does nothing for unknown hook ID", () => {
      ensureHookTables(db);
      // Should not throw
      updateHookStats(db, "hook-nonexistent", {
        executionTime: 100,
        success: true,
      });
      const stats = getHookStats(db);
      expect(stats.length).toBe(0);
    });
  });
});
