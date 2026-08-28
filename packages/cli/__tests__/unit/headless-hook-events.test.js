import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/hooks-v2-runtime.js", () => ({
  default: {
    executeHooks: vi.fn(async () => ({
      success: true,
      blocked: false,
      decision: "continue",
      requiresApproval: false,
      results: [
        {
          hookId: "hook-private-id",
          status: "success",
          decision: "continue",
          durationMs: 7,
          stdout: "top-secret-hook-output",
          stderr: "top-secret-hook-error",
        },
      ],
    })),
  },
}));

import { emitHooksV2Event } from "../../src/lib/hooks-v2-producers.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { loadMcpConfig } from "../../src/runtime/mcp-config.js";

function makeDeps(lines, agentLoop) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => ({
      setSessionPolicy: () => {},
      setConfirmer: () => {},
    }),
    writeOut: (line) => lines.push(line),
    writeErr: () => {},
    now: () => 1,
    resolveAgentMcp: async () => null,
    executeHooksV2Event: async () => ({
      success: true,
      blocked: false,
      decision: "continue",
      requiresApproval: false,
      results: [],
    }),
    agentLoop,
  };
}

function parseNdjson(lines) {
  return lines
    .join("")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runHookEventProjection(includeHookEvents) {
  const lines = [];
  const agentLoop = async function* (_messages, loopOptions) {
    loopOptions.interaction?.emit("sub-agent.started", {
      subAgentId: "child-session",
      parentSessionId: "parent-session",
      role: "researcher",
      maxIterations: 4,
    });
    loopOptions.interaction?.emit("sub-agent.progress", {
      subAgentId: "child-session",
      parentSessionId: "parent-session",
      event_type: "tool",
      tool: "read_file",
      iteration_count: 2,
      token_count: 13,
    });
    emitHooksV2Event("PreToolUse", {
      session_id: "parent-session",
      trace_id: "trace-1",
      parent_id: "child-session",
      cwd: "/private/workspace",
      command: "echo top-secret-command",
    });
    await new Promise((resolve) => setImmediate(resolve));
    loopOptions.interaction?.emit("sub-agent.completed", {
      subAgentId: "child-session",
      parentSessionId: "parent-session",
      role: "researcher",
      iterationCount: 2,
    });
    yield { type: "response-complete", content: "done" };
  };

  const result = await runAgentHeadless(
    {
      prompt: "run the projected lifecycle",
      outputFormat: "stream-json",
      sessionId: "parent-session",
      includeHookEvents,
      settingsHooks: {},
      ephemeral: true,
      hermeticExecution: true,
    },
    makeDeps(lines, agentLoop),
  );
  return { result, events: parseNdjson(lines) };
}

async function* oneTurnInput() {
  yield '{"text":"run the streamed lifecycle"}\n';
}

async function runStreamHookEventProjection() {
  const lines = [];
  const agentLoop = async function* (_messages, loopOptions) {
    loopOptions.interaction?.emit("sub-agent.started", {
      subAgentId: "stream-child",
      parentSessionId: "stream-parent",
    });
    emitHooksV2Event("PostToolUse", {
      session_id: "stream-parent",
      tool_use_id: "tool-1",
      cwd: "/private/stream-workspace",
    });
    await new Promise((resolve) => setImmediate(resolve));
    loopOptions.interaction?.emit("sub-agent.completed", {
      subAgentId: "stream-child",
      parentSessionId: "stream-parent",
      iterationCount: 1,
    });
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  };
  const result = await runAgentHeadlessStream(
    {
      expandFileRefs: false,
      includeHookEvents: true,
      sessionId: "stream-parent",
      ephemeral: true,
      settingsHooks: {},
      hermeticExecution: true,
    },
    {
      ...makeDeps(lines, agentLoop),
      input: oneTurnInput(),
    },
  );
  return { result, events: parseNdjson(lines) };
}

async function* toolPolicyInput(negotiateWithoutPolicyDecision = false) {
  if (negotiateWithoutPolicyDecision) {
    yield `${JSON.stringify({
      type: "hello",
      protocol_version: 1,
      min_protocol_version: 1,
      features: ["event_seq", "tool_use_id", "trace_id"],
    })}\n`;
  }
  yield '{"text":"run the gated tool"}\n';
}

async function runStreamToolPolicyProjection(negotiateWithoutPolicyDecision) {
  const lines = [];
  const agentLoop = async function* () {
    yield {
      type: "tool-executing",
      tool: "run_shell",
      args: { command: "npm test" },
      tool_use_id: "tool-policy-1",
      turn_id: "turn-policy-1",
    };
    yield {
      type: "tool-result",
      tool: "run_shell",
      result: { error: "denied" },
      error: "denied",
      tool_use_id: "tool-policy-1",
      turn_id: "turn-policy-1",
      permission_decision_id: "tool-policy-1:perm:managed",
      permission_decision: {
        id: "tool-policy-1:perm:managed",
        tool: "run_shell",
        decision: "deny",
        via: "managed",
      },
    };
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  };
  const result = await runAgentHeadlessStream(
    {
      expandFileRefs: false,
      includeHookEvents: true,
      sessionId: "stream-policy",
      ephemeral: true,
      settingsHooks: {},
      hermeticExecution: true,
    },
    {
      ...makeDeps(lines, agentLoop),
      input: toolPolicyInput(negotiateWithoutPolicyDecision),
    },
  );
  return { result, events: parseNdjson(lines) };
}

describe("headless hook and subagent event projection", () => {
  it("emits an opt-in, ordered, redacted stream-json projection", async () => {
    const { result, events } = await runHookEventProjection(true);

    expect(result).toMatchObject({ exitCode: 0, isError: false });
    const initIndex = events.findIndex(
      (event) => event.type === "system" && event.subtype === "init",
    );
    const hookStartedIndex = events.findIndex(
      (event) => event.type === "hook_started",
    );
    expect(initIndex).toBeGreaterThanOrEqual(0);
    expect(hookStartedIndex).toBeGreaterThan(initIndex);

    expect(events).toContainEqual({
      type: "subagent_started",
      schema_version: 1,
      subagent_id: "child-session",
      parent_id: "parent-session",
      role: "researcher",
      background: false,
      max_iterations: 4,
    });
    expect(events).toContainEqual({
      type: "subagent_progress",
      schema_version: 1,
      subagent_id: "child-session",
      parent_id: "parent-session",
      event_type: "tool",
      tool: "read_file",
      iteration_count: 2,
      token_count: 13,
    });
    expect(events).toContainEqual({
      type: "subagent_completed",
      schema_version: 1,
      subagent_id: "child-session",
      parent_id: "parent-session",
      role: "researcher",
      status: "completed",
      background: false,
      iteration_count: 2,
    });

    expect(events).toContainEqual({
      type: "hook_started",
      schema_version: 1,
      hook_event: "PreToolUse",
      session_id: "parent-session",
      trace_id: "trace-1",
      parent_id: "child-session",
    });
    expect(events).toContainEqual({
      type: "hook_progress",
      schema_version: 1,
      hook_event: "PreToolUse",
      session_id: "parent-session",
      trace_id: "trace-1",
      parent_id: "child-session",
      hook_id: "hook-private-id",
      status: "success",
      decision: "continue",
      duration_ms: 7,
    });
    expect(events).toContainEqual({
      type: "hook_response",
      schema_version: 1,
      hook_event: "PreToolUse",
      session_id: "parent-session",
      trace_id: "trace-1",
      parent_id: "child-session",
      decision: "continue",
      blocked: false,
      requires_approval: false,
      hook_count: 1,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "policy_decision",
        schema_version: 1,
        source: "hook",
        decision: "allow",
        hook_event: "PreToolUse",
        session_id: "parent-session",
        policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("top-secret");
    expect(JSON.stringify(events)).not.toContain("/private/workspace");
  });

  it("keeps hook and subagent events out of the default stream", async () => {
    const { result, events } = await runHookEventProjection(false);

    expect(result).toMatchObject({ exitCode: 0, isError: false });
    expect(
      events.filter((event) =>
        [
          "hook_started",
          "hook_progress",
          "hook_response",
          "policy_decision",
          "subagent_started",
          "subagent_progress",
          "subagent_completed",
        ].includes(event.type),
      ),
    ).toEqual([]);
  });

  it("projects the same contract for stream-json input turns", async () => {
    const { result, events } = await runStreamHookEventProjection();

    expect(result).toMatchObject({ exitCode: 0, turns: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent_started",
        schema_version: 1,
        subagent_id: "stream-child",
        parent_id: "stream-parent",
        background: false,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent_completed",
        schema_version: 1,
        subagent_id: "stream-child",
        parent_id: "stream-parent",
        status: "completed",
        background: false,
        iteration_count: 1,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "hook_response",
        schema_version: 1,
        hook_event: "PostToolUse",
        session_id: "stream-parent",
        tool_use_id: "tool-1",
        decision: "continue",
        blocked: false,
        requires_approval: false,
        hook_count: 1,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "policy_decision",
        schema_version: 1,
        source: "hook",
        decision: "allow",
        hook_event: "PostToolUse",
        session_id: "stream-parent",
        tool_use_id: "tool-1",
        policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("/private/stream-workspace");
    expect(JSON.stringify(events)).not.toContain("top-secret");
  });

  it("emits the same policy event for a gated tool result", async () => {
    const { result, events } = await runStreamToolPolicyProjection(false);

    expect(result).toMatchObject({ exitCode: 0, turns: 1 });
    const toolResultIndex = events.findIndex(
      (event) => event.type === "tool_result",
    );
    const policyIndex = events.findIndex(
      (event) => event.type === "policy_decision" && event.source === "tool",
    );
    expect(policyIndex).toBeGreaterThan(toolResultIndex);
    expect(events[policyIndex]).toMatchObject({
      schema_version: 1,
      decision_id: "tool-policy-1:perm:managed",
      source: "tool",
      decision: "deny",
      tool: "run_shell",
      tool_use_id: "tool-policy-1",
      policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("suppresses policy events when capability negotiation disables them", async () => {
    const { events } = await runStreamToolPolicyProjection(true);

    expect(events.some((event) => event.type === "policy_decision")).toBe(
      false,
    );
    const result = events.find((event) => event.type === "tool_result");
    expect(result).not.toHaveProperty("permission_decision");
    expect(result).not.toHaveProperty("permission_decision_id");
  });
});

describe("headless MCP config-error projection", () => {
  it("keeps skipped --mcp-config errors structured, bounded, and out of transport setup", async () => {
    const warnings = [];
    const result = await loadMcpConfig("mcp.json", {
      readFile: () =>
        JSON.stringify({
          mcpServers: {
            unknown: { type: "grpc", url: "https://secret.example.test" },
            incomplete: { type: "stdio" },
          },
        }),
      writeErr: (line) => warnings.push(line),
    });

    expect(result.mcpServerErrors).toEqual([
      {
        name: "unknown",
        type: "unknown_type",
        message: "MCP server transport type is not supported.",
      },
      {
        name: "incomplete",
        type: "invalid_config",
        message: "Stdio MCP server configuration requires a command.",
      },
    ]);
    expect(warnings.join("")).toContain(
      "Warning: 2 MCP servers skipped due to invalid config:",
    );
    expect(JSON.stringify(result.mcpServerErrors)).not.toContain("secret");
    await result.mcpClient.disconnectAll();
  });

  it("adds non-empty mcp_server_errors only to the stream-json init event", async () => {
    const lines = [];
    const result = await runAgentHeadless(
      {
        prompt: "report setup",
        outputFormat: "stream-json",
        ephemeral: true,
        settingsHooks: {},
      },
      {
        ...makeDeps(lines, async function* () {
          yield { type: "response-complete", content: "done" };
          yield { type: "run-ended", reason: "complete" };
        }),
        resolveAgentMcp: async () => ({
          mcpServerErrors: [
            {
              name: "invalid",
              type: "invalid_config",
              message: "MCP server configuration is invalid.",
            },
          ],
          connected: [],
          extraToolDefinitions: [],
          externalToolExecutors: {},
          externalToolDescriptors: {},
        }),
      },
    );

    expect(result).toMatchObject({ exitCode: 0, isError: false });
    const init = parseNdjson(lines).find(
      (event) => event.type === "system" && event.subtype === "init",
    );
    expect(init.mcp_server_errors).toEqual([
      {
        name: "invalid",
        type: "invalid_config",
        message: "MCP server configuration is invalid.",
      },
    ]);
  });
});
