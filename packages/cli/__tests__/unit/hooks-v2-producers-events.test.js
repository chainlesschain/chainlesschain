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
});
