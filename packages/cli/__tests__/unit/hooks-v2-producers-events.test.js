import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ executeHooks: vi.fn() }));

vi.mock("../../src/lib/hooks-v2-runtime.js", () => ({
  default: runtime,
}));

import {
  addHooksV2EventObserver,
  executeHooksV2Event,
} from "../../src/lib/hooks-v2-producers.js";

describe("hooks-v2 producer event projection", () => {
  beforeEach(() => {
    runtime.executeHooks.mockReset();
  });

  it("projects start/progress/response without hook input or result content", async () => {
    runtime.executeHooks.mockResolvedValue({
      blocked: false,
      decision: "continue",
      requiresApproval: false,
      results: [
        {
          hookId: "hook-1",
          status: "success",
          decision: "continue",
          durationMs: 12.9,
          result: { additionalContext: "secret hook output" },
        },
      ],
    });
    const events = [];
    const unsubscribe = addHooksV2EventObserver("session-1", (event) =>
      events.push(event),
    );

    await executeHooksV2Event("PreToolUse", {
      session_id: "session-1",
      trace_id: "run-1",
      parent_id: "parent-1",
      turn_id: "turn-1",
      tool_use_id: "tool-1",
      tool_input: { password: "secret hook input" },
    });
    unsubscribe();

    expect(events).toEqual([
      expect.objectContaining({
        type: "hook_started",
        schema_version: 1,
        hook_event: "PreToolUse",
        session_id: "session-1",
        trace_id: "run-1",
        parent_id: "parent-1",
      }),
      expect.objectContaining({
        type: "hook_progress",
        hook_id: "hook-1",
        status: "success",
        duration_ms: 12,
      }),
      expect.objectContaining({
        type: "hook_response",
        decision: "continue",
        blocked: false,
        hook_count: 1,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret hook input");
    expect(JSON.stringify(events)).not.toContain("secret hook output");
  });

  it("does not require workspace identity when no hook can execute", async () => {
    runtime.executeHooks.mockResolvedValue({
      blocked: false,
      decision: "continue",
      results: [],
    });

    const outcome = await executeHooksV2Event(
      "Notification",
      { session_id: "session-no-hooks" },
      { cwd: "Z:/cc-definitely-missing-workspace" },
    );

    expect(outcome.decision).toBe("continue");
    expect(runtime.executeHooks).toHaveBeenCalledOnce();
  });

  it("binds settings failures to the caller's authority boundary", async () => {
    runtime.executeHooks.mockResolvedValue({
      blocked: false,
      decision: "continue",
      results: [],
    });
    const settingsHooks = {
      Stop: [
        {
          matcher: null,
          hooks: [{ type: "command", command: "echo stop" }],
        },
      ],
      PreToolUse: [
        {
          matcher: null,
          hooks: [{ type: "command", command: "echo pre" }],
        },
      ],
    };

    await executeHooksV2Event("Stop", {}, { settingsHooks });
    await executeHooksV2Event(
      "PreToolUse",
      {},
      {
        settingsHooks,
        failClosed: true,
      },
    );

    expect(
      runtime.executeHooks.mock.calls[0][2].additionalHooks[0],
    ).toMatchObject({ failureMode: "ignore" });
    expect(
      runtime.executeHooks.mock.calls[1][2].additionalHooks[0],
    ).toMatchObject({ failureMode: "fail-closed" });
  });

  it("fails closed only when the producer declares a real decision gate", async () => {
    runtime.executeHooks.mockRejectedValue(new Error("runtime unavailable"));

    const observed = await executeHooksV2Event("Stop", {});
    const gated = await executeHooksV2Event(
      "PreToolUse",
      {},
      {
        failClosed: true,
      },
    );

    expect(observed).toMatchObject({
      blocked: false,
      decision: "continue",
    });
    expect(gated).toMatchObject({ blocked: true, decision: "block" });
  });
});
