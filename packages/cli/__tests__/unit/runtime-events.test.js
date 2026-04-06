import { describe, expect, it } from "vitest";

import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
} from "../../src/runtime/runtime-events.js";
import { createAgentTurnRecord } from "../../src/runtime/contracts/agent-turn.js";
import { createTaskRecord } from "../../src/runtime/contracts/task-record.js";
import { createWorktreeRecord } from "../../src/runtime/contracts/worktree-record.js";
import { createTelemetryRecord } from "../../src/runtime/contracts/telemetry-record.js";

describe("runtime-events", () => {
  it("creates a normalized runtime event envelope", () => {
    const event = createRuntimeEvent(
      RUNTIME_EVENTS.TASK_NOTIFICATION,
      { taskId: "task-1" },
      { kind: "server", sessionId: "sess-1", timestamp: 123 },
    );

    expect(event).toEqual({
      type: "task:notification",
      kind: "server",
      sessionId: "sess-1",
      timestamp: 123,
      toolDescriptor: null,
      toolTelemetryRecord: null,
      payload: { taskId: "task-1" },
    });
  });

  it("creates normalized runtime contract records", () => {
    const turn = createAgentTurnRecord({
      kind: "agent",
      sessionId: "sess-2",
      input: "hello",
      result: { ok: true },
      startedAt: 10,
      endedAt: 20,
    });
    const task = createTaskRecord({
      id: "task-2",
      status: "completed",
      type: "shell",
      outputSummary: { preview: "ok" },
    });
    const worktree = createWorktreeRecord({
      branch: "agent/task-2",
      worktreePath: "/tmp/wt",
      hasChanges: true,
      previewEntrypoints: [{ type: "worktree-diff" }],
    });
    const telemetry = createTelemetryRecord({
      provider: "openai",
      model: "gpt-4o-mini",
      saved: 42,
      ratio: 0.75,
      abVariant: "balanced",
      timestamp: 99,
    });

    expect(turn).toEqual(
      expect.objectContaining({
        kind: "agent",
        sessionId: "sess-2",
        input: "hello",
        result: { ok: true },
      }),
    );
    expect(task).toEqual(
      expect.objectContaining({
        id: "task-2",
        status: "completed",
        type: "shell",
        result: null,
        error: null,
        outputSummary: { preview: "ok" },
      }),
    );
    expect(worktree).toEqual(
      expect.objectContaining({
        branch: "agent/task-2",
        path: "/tmp/wt",
        hasChanges: true,
      }),
    );
    expect(telemetry).toEqual(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o-mini",
        strategy: null,
        source: null,
        savedTokens: 42,
        ratio: 0.75,
        variant: "balanced",
        timestamp: 99,
      }),
    );
  });

  it("includes tool descriptor/telemetry metadata if provided", () => {
    const payload = {
      toolDescriptor: { name: "shell", kind: "shell" },
      toolTelemetryRecord: { toolName: "shell", status: "completed" },
    };
    const event = createRuntimeEvent(RUNTIME_EVENTS.TASK_NOTIFICATION, payload);
    expect(event.toolDescriptor).toEqual(payload.toolDescriptor);
    expect(event.toolTelemetryRecord).toEqual(payload.toolTelemetryRecord);
  });
});
