import { describe, expect, it } from "vitest";

import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
  CODING_AGENT_EVENT_VERSION,
  CODING_AGENT_EVENT_CHANNEL,
  CODING_AGENT_EVENT_TYPES,
  CodingAgentSequenceTracker,
  createCodingAgentEvent,
  wrapLegacyMessage,
  validateCodingAgentEvent,
  mapLegacyType,
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

describe("coding-agent unified event protocol", () => {
  it("exposes the canonical version, channel and type whitelist", () => {
    expect(CODING_AGENT_EVENT_VERSION).toBe("1.0");
    expect(CODING_AGENT_EVENT_CHANNEL).toBe("coding-agent:event");
    expect(CODING_AGENT_EVENT_TYPES.SESSION_STARTED).toBe("session.started");
    expect(CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA).toBe("assistant.delta");
    expect(CODING_AGENT_EVENT_TYPES.TOOL_CALL_STARTED).toBe(
      "tool.call.started",
    );
    expect(CODING_AGENT_EVENT_TYPES.PLAN_APPROVAL_REQUIRED).toBe(
      "plan.approval_required",
    );
    expect(CODING_AGENT_EVENT_TYPES.APPROVAL_REQUESTED).toBe(
      "approval.requested",
    );
    expect(CODING_AGENT_EVENT_TYPES.CONTEXT_COMPACTION_COMPLETED).toBe(
      "context.compaction.completed",
    );
  });

  it("builds an envelope with all required fields", () => {
    const tracker = new CodingAgentSequenceTracker();
    const envelope = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
      { text: "正在分析代码结构..." },
      {
        sessionId: "sess-001",
        requestId: "req-001",
        source: "cli-runtime",
        timestamp: 1775600000000,
        tracker,
      },
    );

    expect(envelope.version).toBe("1.0");
    expect(envelope.type).toBe("assistant.delta");
    expect(envelope.sessionId).toBe("sess-001");
    expect(envelope.requestId).toBe("req-001");
    expect(envelope.source).toBe("cli-runtime");
    expect(envelope.timestamp).toBe(1775600000000);
    expect(envelope.payload).toEqual({ text: "正在分析代码结构..." });
    expect(envelope.sequence).toBe(1);
    expect(envelope.eventId).toEqual(expect.any(String));
    expect(envelope.eventId).toBe(envelope.id);
    expect(envelope.meta).toEqual({});
  });

  it("issues monotonically increasing sequences per requestId", () => {
    const tracker = new CodingAgentSequenceTracker();
    const a1 = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
      { text: "a" },
      { sessionId: "s", requestId: "req-A", tracker },
    );
    const a2 = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
      { text: "b" },
      { sessionId: "s", requestId: "req-A", tracker },
    );
    const b1 = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
      { text: "c" },
      { sessionId: "s", requestId: "req-B", tracker },
    );
    const a3 = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
      { text: "d" },
      { sessionId: "s", requestId: "req-A", tracker },
    );

    expect(a1.sequence).toBe(1);
    expect(a2.sequence).toBe(2);
    expect(a3.sequence).toBe(3);
    expect(b1.sequence).toBe(1);
  });

  it("strips envelope-reserved keys from meta", () => {
    const envelope = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.SESSION_STARTED,
      { sessionId: "s" },
      {
        meta: {
          sessionId: "should-be-stripped",
          requestId: "should-be-stripped",
          sequence: 999,
          source: "should-be-stripped",
          eventId: "should-be-stripped",
          model: "claude-opus-4-6",
          traceId: "trace-1",
        },
      },
    );

    expect(envelope.meta).toEqual({
      model: "claude-opus-4-6",
      traceId: "trace-1",
    });
  });

  it("maps legacy kebab-case types into the unified dot-case set", () => {
    expect(mapLegacyType("session-created")).toBe("session.started");
    expect(mapLegacyType("session-resumed")).toBe("session.resumed");
    expect(mapLegacyType("response-token")).toBe("assistant.delta");
    expect(mapLegacyType("response-complete")).toBe("assistant.final");
    expect(mapLegacyType("tool-executing")).toBe("tool.call.started");
    expect(mapLegacyType("tool-result")).toBe("tool.call.completed");
    expect(mapLegacyType("plan-ready")).toBe("plan.approval_required");
    expect(mapLegacyType("compression-applied")).toBe(
      "context.compaction.completed",
    );
    expect(mapLegacyType("error")).toBe("error");
    // Unknown types fall through unchanged so receivers still get an envelope.
    expect(mapLegacyType("totally-unknown")).toBe("totally-unknown");
  });

  it("wrapLegacyMessage upgrades a wire-format message to a unified envelope", () => {
    const wire = {
      type: "tool-executing",
      id: "req-7",
      sessionId: "sess-7",
      tool: "edit_file",
      input: { path: "foo.js" },
    };
    const envelope = wrapLegacyMessage(wire, { source: "cli-runtime" });
    expect(envelope.type).toBe("tool.call.started");
    expect(envelope.requestId).toBe("req-7");
    expect(envelope.sessionId).toBe("sess-7");
    expect(envelope.source).toBe("cli-runtime");
    expect(envelope.payload).toEqual({
      id: "req-7",
      sessionId: "sess-7",
      tool: "edit_file",
      input: { path: "foo.js" },
    });
  });

  it("validates a well-formed envelope and rejects malformed ones", () => {
    const good = createCodingAgentEvent(
      CODING_AGENT_EVENT_TYPES.SESSION_STARTED,
      { mode: "interactive" },
      { sessionId: "s", requestId: "r" },
    );
    expect(validateCodingAgentEvent(good)).toEqual({ valid: true, errors: [] });

    expect(validateCodingAgentEvent(null).valid).toBe(false);
    expect(validateCodingAgentEvent({ ...good, version: "0.9" }).valid).toBe(
      false,
    );
    expect(validateCodingAgentEvent({ ...good, type: "made-up" }).valid).toBe(
      false,
    );
    expect(
      validateCodingAgentEvent({ ...good, eventId: undefined }).valid,
    ).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(() =>
      createCodingAgentEvent(CODING_AGENT_EVENT_TYPES.ERROR, "boom"),
    ).toThrow(/payload must be an object/);
  });
});
