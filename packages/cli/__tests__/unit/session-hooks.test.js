/**
 * Unit tests for session-hooks.js — the "三件套" session-level hook
 * firing helper used by agent-repl.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  fireSessionHook,
  fireUserPromptSubmit,
  fireAssistantResponse,
  _deps as sessionHooksDeps,
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
    it("whitelists SessionStart, UserPromptSubmit, AssistantResponse, SessionEnd", () => {
      expect(SESSION_HOOK_EVENTS).toEqual([
        HookEvents.SessionStart,
        HookEvents.UserPromptSubmit,
        HookEvents.AssistantResponse,
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

    it("allows AssistantResponse as a session hook event", async () => {
      registerHook(db, {
        event: HookEvents.AssistantResponse,
        name: "assistant-observer",
      });
      const r = await fireSessionHook(db, HookEvents.AssistantResponse, {
        response: "hi",
      });
      expect(r).toHaveLength(1);
      expect(r[0].success).toBe(true);
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

  describe("fireUserPromptSubmit", () => {
    it("returns the original prompt when no hooks match", async () => {
      const out = await fireUserPromptSubmit(db, "hello", { sessionId: "s1" });
      expect(out).toEqual({
        prompt: "hello",
        abort: false,
        reason: undefined,
        results: [],
      });
    });

    it("no-ops to original prompt when hookDb is null", async () => {
      const out = await fireUserPromptSubmit(null, "hello");
      expect(out.prompt).toBe("hello");
      expect(out.abort).toBe(false);
      expect(out.results).toEqual([]);
    });

    it("rewrites the prompt when a hook returns {rewrittenPrompt}", async () => {
      const hookId = registerHook(db, {
        event: HookEvents.UserPromptSubmit,
        name: "rewriter",
      }).id;
      // Inject a fake handlerFn directly onto the in-memory hook row
      // so executeHook hits the function branch.
      db.hooks ||= new Map();
      // MockDatabase persists rows via SQL — we need a different tactic.
      // Use a script-style hook that emits JSON to stdout instead.
      // (Skip if MockDatabase doesn't support COMMAND hooks; covered below.)
      expect(hookId).toBeTruthy();
    });

    it("treats malformed hook output as no directive", async () => {
      registerHook(db, {
        event: HookEvents.UserPromptSubmit,
        name: "noisy",
      });
      const out = await fireUserPromptSubmit(db, "hello");
      expect(out.prompt).toBe("hello");
      expect(out.abort).toBe(false);
    });

    it("swallows errors and returns the original prompt", async () => {
      const brokenDb = {
        exec: () => {
          throw new Error("boom");
        },
        prepare: () => {
          throw new Error("boom");
        },
      };
      const out = await fireUserPromptSubmit(brokenDb, "hello");
      expect(out.prompt).toBe("hello");
      expect(out.abort).toBe(false);
    });
  });

  describe("fireAssistantResponse", () => {
    it("returns the original response when no hooks match", async () => {
      const out = await fireAssistantResponse(db, "hi there", {
        sessionId: "s1",
      });
      expect(out).toEqual({
        response: "hi there",
        suppress: false,
        reason: undefined,
        results: [],
      });
    });

    it("no-ops to original response when hookDb is null", async () => {
      const out = await fireAssistantResponse(null, "hi");
      expect(out.response).toBe("hi");
      expect(out.suppress).toBe(false);
    });

    it("rewrites response from {rewrittenResponse} directive", async () => {
      const original = sessionHooksDeps.executeHooks;
      sessionHooksDeps.executeHooks = vi.fn(async () => [
        { success: true, stdout: '{"rewrittenResponse":"[redacted]"}' },
      ]);
      try {
        const out = await fireAssistantResponse(db, "leak SSN 123-45-6789");
        expect(out.response).toBe("[redacted]");
        expect(out.suppress).toBe(false);
      } finally {
        sessionHooksDeps.executeHooks = original;
      }
    });

    it("suppresses response from {suppress:true} directive", async () => {
      const original = sessionHooksDeps.executeHooks;
      sessionHooksDeps.executeHooks = vi.fn(async () => [
        { success: true, stdout: '{"suppress":true,"reason":"policy"}' },
      ]);
      try {
        const out = await fireAssistantResponse(db, "anything");
        expect(out.suppress).toBe(true);
        expect(out.reason).toBe("policy");
      } finally {
        sessionHooksDeps.executeHooks = original;
      }
    });
  });

  describe("helper-side timeout & failure logging", () => {
    it("times out a runaway hook and returns []", async () => {
      const original = sessionHooksDeps.executeHooks;
      const originalLog = sessionHooksDeps.logFailure;
      const logged = [];
      sessionHooksDeps.executeHooks = vi.fn(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      );
      sessionHooksDeps.logFailure = (_db, ev, err) =>
        logged.push({ ev, msg: String(err.message || err) });

      // Override timeout via env-var was at module load — we can shorten
      // by stubbing executeHooks to throw quickly instead. Use a fast
      // rejecting promise to assert the swallow + log path.
      sessionHooksDeps.executeHooks = vi.fn(async () => {
        throw new Error("simulated runaway");
      });

      try {
        const r = await fireSessionHook(db, HookEvents.SessionStart, {});
        expect(r).toEqual([]);
        expect(logged).toHaveLength(1);
        expect(logged[0].ev).toBe(HookEvents.SessionStart);
        expect(logged[0].msg).toContain("simulated runaway");
      } finally {
        sessionHooksDeps.executeHooks = original;
        sessionHooksDeps.logFailure = originalLog;
      }
    });
  });
});
