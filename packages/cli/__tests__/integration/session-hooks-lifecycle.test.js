/**
 * Integration: session-hooks lifecycle (4 events fired through the helper)
 *
 * Boundary: session-hooks helper + hook-manager DB layer. Verifies that:
 *   - Registered hooks for SessionStart, UserPromptSubmit,
 *     AssistantResponse, SessionEnd execute in order
 *   - Hook execution_count accumulates across the lifecycle
 *   - fireUserPromptSubmit returns the original prompt when nothing rewrites
 *
 * The actual REPL wiring is exercised by chat-repl integration tests; here
 * we focus on the helper-side contract that those tests rely on.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  fireSessionHook,
  fireUserPromptSubmit,
  SESSION_HOOK_EVENTS,
} from "../../src/lib/session-hooks.js";
import {
  HookEvents,
  registerHook,
  getHookStats,
} from "../../src/lib/hook-manager.js";

describe("integration: session-hooks lifecycle (4 events)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  it("fires all four session events in order during a typical turn", async () => {
    for (const event of SESSION_HOOK_EVENTS) {
      registerHook(db, { event, name: `lifecycle-${event}` });
    }

    const sessionId = "test-session-123";

    const startResults = await fireSessionHook(db, HookEvents.SessionStart, {
      sessionId,
      provider: "ollama",
      model: "llama2",
    });
    expect(startResults).toHaveLength(1);
    expect(startResults[0].success).toBe(true);

    const promptResult = await fireUserPromptSubmit(db, "hello agent", {
      sessionId,
      messageCount: 0,
    });
    expect(promptResult.prompt).toBe("hello agent");
    expect(promptResult.abort).toBe(false);

    const responseResults = await fireSessionHook(
      db,
      HookEvents.AssistantResponse,
      {
        sessionId,
        response: "Hi! How can I help?",
        messageCount: 2,
        provider: "ollama",
        model: "llama2",
      },
    );
    expect(responseResults).toHaveLength(1);

    const endResults = await fireSessionHook(db, HookEvents.SessionEnd, {
      sessionId,
      messageCount: 2,
    });
    expect(endResults).toHaveLength(1);

    // All four hooks fired exactly once
    const stats = getHookStats(db);
    for (const event of SESSION_HOOK_EVENTS) {
      const s = stats.find((row) => row.name === `lifecycle-${event}`);
      expect(s, `missing stats for ${event}`).toBeDefined();
      expect(s.executionCount).toBe(1);
    }
  });

  it("multiple turns accumulate UserPromptSubmit + AssistantResponse counts", async () => {
    registerHook(db, {
      event: HookEvents.UserPromptSubmit,
      name: "prompt-counter",
    });
    registerHook(db, {
      event: HookEvents.AssistantResponse,
      name: "response-counter",
    });

    for (let i = 0; i < 3; i++) {
      await fireUserPromptSubmit(db, `prompt ${i}`, { sessionId: "s1" });
      await fireSessionHook(db, HookEvents.AssistantResponse, {
        sessionId: "s1",
        response: `reply ${i}`,
      });
    }

    const stats = getHookStats(db);
    expect(stats.find((s) => s.name === "prompt-counter").executionCount).toBe(
      3,
    );
    expect(
      stats.find((s) => s.name === "response-counter").executionCount,
    ).toBe(3);
  });

  it("a broken hook does not break the turn (fire-and-forget)", async () => {
    // We can't easily inject a throwing handler through MockDatabase, but
    // the helper is documented to swallow internal errors. Verify that
    // calling the helper on a corrupted db handle returns gracefully.
    const brokenDb = {
      exec: () => {
        throw new Error("disk I/O");
      },
      prepare: () => {
        throw new Error("disk I/O");
      },
    };

    const r1 = await fireSessionHook(brokenDb, HookEvents.SessionStart, {});
    const r2 = await fireUserPromptSubmit(brokenDb, "hi");
    const r3 = await fireSessionHook(
      brokenDb,
      HookEvents.AssistantResponse,
      {},
    );
    const r4 = await fireSessionHook(brokenDb, HookEvents.SessionEnd, {});

    expect(r1).toEqual([]);
    expect(r2.prompt).toBe("hi");
    expect(r2.abort).toBe(false);
    expect(r3).toEqual([]);
    expect(r4).toEqual([]);
  });
});
