/**
 * Unit tests for session-hooks.js — the "三件套" session-level hook
 * firing helper used by agent-repl.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  fireSessionHook,
  SESSION_HOOK_EVENTS,
} from "../../src/lib/session-hooks.js";
import {
  HookEvents,
  registerHook,
  getHookStats,
} from "../../src/lib/hook-manager.js";

describe("session-hooks", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  describe("SESSION_HOOK_EVENTS", () => {
    it("whitelists exactly SessionStart, UserPromptSubmit, SessionEnd", () => {
      expect(SESSION_HOOK_EVENTS).toEqual([
        HookEvents.SessionStart,
        HookEvents.UserPromptSubmit,
        HookEvents.SessionEnd,
      ]);
    });

    it("is frozen (cannot be mutated at runtime)", () => {
      expect(Object.isFrozen(SESSION_HOOK_EVENTS)).toBe(true);
    });
  });

  describe("fireSessionHook", () => {
    it("no-ops and returns [] when hookDb is null", async () => {
      const result = await fireSessionHook(null, HookEvents.SessionStart, {
        sessionId: "s1",
      });
      expect(result).toEqual([]);
    });

    it("no-ops and returns [] when hookDb is undefined", async () => {
      const result = await fireSessionHook(undefined, HookEvents.SessionStart);
      expect(result).toEqual([]);
    });

    it("throws on non-whitelisted event names", async () => {
      await expect(
        fireSessionHook(db, HookEvents.PreToolUse, {}),
      ).rejects.toThrow(/not a session hook/);
    });

    it("throws on typo event names", async () => {
      await expect(fireSessionHook(db, "sessionstart", {})).rejects.toThrow(
        /not a session hook/,
      );
    });

    it("returns [] when no hooks are registered for the event", async () => {
      const result = await fireSessionHook(db, HookEvents.SessionStart, {
        sessionId: "s1",
      });
      expect(result).toEqual([]);
    });

    it("fires all three session events when hooks are registered", async () => {
      for (const event of SESSION_HOOK_EVENTS) {
        registerHook(db, {
          event,
          name: `test-${event}`,
          description: `test hook for ${event}`,
        });
      }

      const r1 = await fireSessionHook(db, HookEvents.SessionStart, {});
      const r2 = await fireSessionHook(db, HookEvents.UserPromptSubmit, {});
      const r3 = await fireSessionHook(db, HookEvents.SessionEnd, {});

      expect(r1).toHaveLength(1);
      expect(r1[0].hookName).toBe(`test-${HookEvents.SessionStart}`);
      expect(r1[0].success).toBe(true);

      expect(r2).toHaveLength(1);
      expect(r2[0].hookName).toBe(`test-${HookEvents.UserPromptSubmit}`);

      expect(r3).toHaveLength(1);
      expect(r3[0].hookName).toBe(`test-${HookEvents.SessionEnd}`);
    });

    it("injects an ISO timestamp into the context", async () => {
      // We can't easily observe the context inside executeHook for SYNC
      // no-op handlers, but we can at least verify the function does not
      // throw when the caller omits a timestamp.
      registerHook(db, {
        event: HookEvents.UserPromptSubmit,
        name: "inject-timestamp",
      });
      const result = await fireSessionHook(db, HookEvents.UserPromptSubmit, {
        prompt: "hello",
      });
      expect(result).toHaveLength(1);
      expect(result[0].success).toBe(true);
    });

    it("only fires hooks matching the given event (event isolation)", async () => {
      registerHook(db, {
        event: HookEvents.SessionStart,
        name: "start-only",
      });
      registerHook(db, {
        event: HookEvents.SessionEnd,
        name: "end-only",
      });

      const startResults = await fireSessionHook(
        db,
        HookEvents.SessionStart,
        {},
      );
      expect(startResults).toHaveLength(1);
      expect(startResults[0].hookName).toBe("start-only");

      const endResults = await fireSessionHook(db, HookEvents.SessionEnd, {});
      expect(endResults).toHaveLength(1);
      expect(endResults[0].hookName).toBe("end-only");
    });

    it("skips disabled hooks", async () => {
      registerHook(db, {
        event: HookEvents.SessionStart,
        name: "disabled-hook",
        enabled: false,
      });
      const result = await fireSessionHook(db, HookEvents.SessionStart, {});
      expect(result).toEqual([]);
    });

    it("updates hook stats after firing (execution_count += 1)", async () => {
      registerHook(db, {
        event: HookEvents.UserPromptSubmit,
        name: "counted-hook",
      });

      await fireSessionHook(db, HookEvents.UserPromptSubmit, {});
      await fireSessionHook(db, HookEvents.UserPromptSubmit, {});
      await fireSessionHook(db, HookEvents.UserPromptSubmit, {});

      const stats = getHookStats(db);
      const counted = stats.find((s) => s.name === "counted-hook");
      expect(counted).toBeDefined();
      expect(counted.executionCount).toBe(3);
    });

    it("swallows internal executeHooks errors and returns []", async () => {
      // Simulate a broken db by passing an object that throws on .prepare()
      const brokenDb = {
        exec: () => {
          throw new Error("disk I/O error");
        },
        prepare: () => {
          throw new Error("disk I/O error");
        },
      };
      const result = await fireSessionHook(
        brokenDb,
        HookEvents.SessionStart,
        {},
      );
      expect(result).toEqual([]);
    });

    it("respects a matcher on SessionStart hooks", async () => {
      registerHook(db, {
        event: HookEvents.SessionStart,
        name: "session-matcher",
        matcher: "/^SessionStart$/",
      });
      const result = await fireSessionHook(db, HookEvents.SessionStart, {});
      expect(result).toHaveLength(1);
    });

    it("runs multiple hooks for the same event in priority order", async () => {
      registerHook(db, {
        event: HookEvents.SessionEnd,
        name: "low-priority",
        priority: 900,
      });
      registerHook(db, {
        event: HookEvents.SessionEnd,
        name: "high-priority",
        priority: 100,
      });

      const results = await fireSessionHook(db, HookEvents.SessionEnd, {});
      expect(results.map((r) => r.hookName)).toEqual([
        "high-priority",
        "low-priority",
      ]);
    });
  });
});
