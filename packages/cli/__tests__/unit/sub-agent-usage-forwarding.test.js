/**
 * REAL SubAgentContext usage-boundary coverage. The child loop is driven with
 * an injected chatFn, so these tests exercise the generator's actual ordering
 * without making a live provider request.
 */
import { describe, it, expect, vi } from "vitest";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";

const RUN_OPTIONS = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  autoCompact: false,
  runnableProviderFallback: false,
};

function createContext(options = {}) {
  return SubAgentContext.create({
    role: "researcher",
    task: "count things",
    cwd: process.cwd(),
    ...options,
  });
}

function finalResponse(content = "child answer", usage = undefined) {
  return {
    message: { content },
    ...(usage === undefined ? {} : { usage }),
  };
}

function toolResponse(usage = { input_tokens: 3, output_tokens: 2 }) {
  return {
    message: {
      content: "",
      tool_calls: [
        {
          id: "read-1",
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: "package.json" }),
          },
        },
      ],
    },
    usage,
  };
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}

describe("SubAgentContext usage forwarding", () => {
  it("forwards real provider-reported usage and its real callId", async () => {
    const forwarded = [];
    const subCtx = createContext({
      onUsage: (event) => forwarded.push(event),
    });
    const chatFn = vi.fn(async () =>
      finalResponse("child answer", {
        input_tokens: 11,
        output_tokens: 4,
      }),
    );

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn,
    });

    expect(result.summary).toContain("child answer");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      type: "token-usage",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 11, output_tokens: 4 },
      attribution: null,
    });
    expect(forwarded[0].callId).toMatch(/^mdl-/);
  });

  it("keeps legacy onUsage forwarding best-effort outside strict mode", async () => {
    const subCtx = createContext({
      onUsage: () => {
        throw new Error("listener boom");
      },
    });
    const result = await subCtx.run("t", {
      ...RUN_OPTIONS,
      chatFn: async () =>
        finalResponse("ok", { input_tokens: 1, output_tokens: 1 }),
    });

    expect(result.summary).toContain("ok");
  });

  it("runs unchanged without a usage sink outside strict mode", async () => {
    const subCtx = createContext();
    const result = await subCtx.run("t", {
      ...RUN_OPTIONS,
      chatFn: async () =>
        finalResponse("plain", { input_tokens: 1, output_tokens: 1 }),
    });

    expect(result.summary).toContain("plain");
  });

  it("retains provider-returned request receipts for workflow recovery", async () => {
    const workflowEffectId = `sha256:${"c".repeat(64)}`;
    const subCtx = createContext({ workflowEffectId });
    const chatFn = vi.fn(async (_messages, options) => ({
      ...finalResponse("receipt", { input_tokens: 1, output_tokens: 1 }),
      providerReceipt: {
        protocol: "cc-provider-request-receipt/v1",
        provider: "openai",
        clientRequestId: options.providerRequestId,
        requestId: "req_child_1",
        responseId: "chatcmpl_child_1",
        requestIdentitySemantics: "trace-only",
        independentlyReadable: false,
      },
    }));

    await subCtx.run("t", {
      ...RUN_OPTIONS,
      provider: "openai",
      model: "gpt-4o",
      chatFn,
    });

    expect(chatFn.mock.calls[0][1].providerRequestId).toMatch(
      /^ccwf_[a-f0-9]{64}$/,
    );
    expect(subCtx.providerRequestAttempts()).toEqual([
      expect.objectContaining({
        protocol: "cc-provider-request-attempt/v1",
        workflowEffectId,
        callSequence: 1,
        source: "model",
        clientRequestId: chatFn.mock.calls[0][1].providerRequestId,
        requestIdentitySemantics: "trace-only",
      }),
    ]);
    expect(subCtx.providerRequestReceipts()).toEqual([
      expect.objectContaining({
        workflowEffectId,
        callSequence: 1,
        source: "model",
        requestId: "req_child_1",
        responseId: "chatcmpl_child_1",
        requestIdentitySemantics: "trace-only",
        independentlyReadable: false,
      }),
    ]);
    expect(subCtx.recoveryBinding()).toMatchObject({
      providerRequestAttempts: [
        expect.objectContaining({ workflowEffectId, source: "model" }),
      ],
      providerRequestReceipts: [
        expect.objectContaining({ workflowEffectId, requestId: "req_child_1" }),
      ],
    });
  });

  it("retains semantic-compaction attempts and receipts beside normal model turns", async () => {
    const workflowEffectId = `sha256:${"d".repeat(64)}`;
    const subCtx = createContext({ workflowEffectId, maxIterations: 5 });
    let modelCall = 0;
    const withReceipt = (result, options, suffix) => ({
      ...result,
      providerReceipt: {
        protocol: "cc-provider-request-receipt/v1",
        provider: "openai",
        clientRequestId: options.providerRequestId,
        requestId: `req_${suffix}`,
        responseId: `chatcmpl_${suffix}`,
        requestIdentitySemantics: "trace-only",
        independentlyReadable: false,
      },
    });
    const chatFn = vi.fn(async (_messages, options) => {
      modelCall += 1;
      if (modelCall <= 2) {
        const response = toolResponse({ input_tokens: 2, output_tokens: 1 });
        response.message.tool_calls[0].id = `read-${modelCall}`;
        return withReceipt(response, options, `model_${modelCall}`);
      }
      return withReceipt(
        finalResponse("done", { input_tokens: 2, output_tokens: 1 }),
        options,
        "model_3",
      );
    });
    const compactor = {
      shouldAutoCompact: (messages) => messages.length > 4,
      llmQuery: vi.fn(async (_prompt, binding) => ({
        summary: "not used by fake compactor",
        usage: { input_tokens: 5, output_tokens: 2 },
        providerReceipt: {
          protocol: "cc-provider-request-receipt/v1",
          provider: "openai",
          clientRequestId: binding.providerRequestId,
          requestId: "req_compaction_child",
          responseId: "chatcmpl_compaction_child",
          requestIdentitySemantics: "trace-only",
          independentlyReadable: false,
        },
      })),
      async compress(messages) {
        await this.llmQuery("summarize");
        return {
          messages: [messages[0], messages.at(-1)],
          stats: {
            saved: messages.length - 2,
            originalMessages: messages.length,
            compressedMessages: 2,
            summaryUsage: {
              inputTokens: 5,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
          },
        };
      },
    };

    await subCtx.run("t", {
      ...RUN_OPTIONS,
      provider: "openai",
      model: "gpt-4o",
      chatFn,
      autoCompact: true,
      autoMicroCompact: false,
      _autoCompactor: compactor,
    });

    expect(
      subCtx.providerRequestAttempts().map((entry) => entry.source),
    ).toEqual(["model", "model", "semantic-compaction", "model"]);
    expect(
      subCtx.providerRequestReceipts().map((entry) => entry.source),
    ).toEqual(["model", "model", "semantic-compaction", "model"]);
    const compactionAttempt = subCtx
      .providerRequestAttempts()
      .find((entry) => entry.source === "semantic-compaction");
    const compactionReceipt = subCtx
      .providerRequestReceipts()
      .find((entry) => entry.source === "semantic-compaction");
    expect(compactionAttempt).toMatchObject({
      workflowEffectId,
      callSequence: 3,
    });
    expect(compactionReceipt).toMatchObject({
      workflowEffectId,
      callId: compactionAttempt.callId,
      clientRequestId: compactionAttempt.clientRequestId,
      requestId: "req_compaction_child",
    });
  });

  it("does not downgrade a workflow-bound provider exception to a failed result", async () => {
    const subCtx = createContext({
      workflowEffectId: `sha256:${"e".repeat(64)}`,
    });

    await expect(
      subCtx.run("t", {
        ...RUN_OPTIONS,
        chatFn: async () => {
          throw new Error("transport outcome unknown");
        },
      }),
    ).rejects.toThrow("transport outcome unknown");
    expect(subCtx.providerRequestReceipts()).toEqual([]);
  });

  it("retains stable nested tool attempts and matching settlements", async () => {
    const workflowEffectId = `sha256:${"9".repeat(64)}`;
    const subCtx = createContext({ workflowEffectId, maxIterations: 3 });
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(toolResponse())
      .mockResolvedValueOnce(
        finalResponse("done", { input_tokens: 1, output_tokens: 1 }),
      );

    await subCtx.run("t", { ...RUN_OPTIONS, chatFn });

    const attempts = subCtx.nestedEffectAttempts();
    const settlements = subCtx.nestedEffectSettlements();
    expect(attempts).toEqual([
      expect.objectContaining({
        protocol: "cc-workflow-child-effect/v1",
        workflowEffectId,
        childEffectId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        childSequence: 1,
        kind: "tool",
        tool: "read_file",
        toolUseId: "read-1",
        identitySemantics: "runtime-derived",
      }),
    ]);
    expect(settlements).toEqual([
      expect.objectContaining({
        workflowEffectId,
        childEffectId: attempts[0].childEffectId,
        childSequence: 1,
        status: "completed",
        outcomeUnknown: false,
        mcpLedgerId: null,
        mcpLedgerPrewritePersisted: false,
        mcpLedgerSettlementPersisted: false,
      }),
    ]);
    expect(subCtx.recoveryBinding()).toMatchObject({
      nestedEffectAttempts: [
        expect.objectContaining({ childEffectId: attempts[0].childEffectId }),
      ],
      nestedEffectSettlements: [
        expect.objectContaining({ childEffectId: attempts[0].childEffectId }),
      ],
    });
  });

  it("propagates an MCP outcome-unknown settlement to the outer workflow", async () => {
    const workflowEffectId = `sha256:${"8".repeat(64)}`;
    const toolName = "mcp__repo__publish";
    const ledger = createMcpCallLedger({ randomUUID: () => "nested" });
    const callTool = vi.fn(async () => {
      throw new Error("transport may have dispatched");
    });
    const subCtx = createContext({
      workflowEffectId,
      maxIterations: 2,
      permissionConfirm: async () => true,
      extraToolDefinitions: [
        {
          type: "function",
          function: {
            name: toolName,
            description: "publish",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      externalToolDescriptors: {
        [toolName]: {
          name: toolName,
          kind: "mcp",
          category: "mcp",
          source: "mcp:repo",
          effectContract: { declaredEffect: "write" },
        },
      },
      externalToolExecutors: {
        [toolName]: {
          kind: "mcp",
          serverName: "repo",
          toolName: "publish",
        },
      },
      mcpClient: { callTool },
      mcpCallLedger: ledger,
    });
    const chatFn = vi.fn(async () => ({
      message: {
        content: "",
        tool_calls: [
          {
            id: "publish-1",
            type: "function",
            function: { name: toolName, arguments: "{}" },
          },
        ],
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    }));

    const error = await captureRejection(
      subCtx.run("t", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toMatchObject({
      code: "CC_WORKFLOW_NESTED_TOOL_OUTCOME_UNKNOWN",
      workflowEffectOutcomeUnknown: true,
      workflowEffectId,
      workflowChildEffectId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(subCtx.nestedEffectAttempts()).toHaveLength(1);
    expect(subCtx.nestedEffectSettlements()).toEqual([
      expect.objectContaining({
        childEffectId: error.workflowChildEffectId,
        status: "outcome_unknown",
        outcomeUnknown: true,
        mcpLedgerId: "mcp-nested-1",
      }),
    ]);
    expect(ledger.list()).toEqual([
      expect.objectContaining({
        status: "started",
        workflowEffectId,
        workflowChildEffectId: error.workflowChildEffectId,
        workflowChildSequence: 1,
        workflowEffectProtocol: "cc-workflow-child-effect/v1",
      }),
    ]);
    expect(callTool).toHaveBeenCalledWith(
      "repo",
      "publish",
      {},
      expect.objectContaining({
        workflowEffectId,
        workflowChildEffectId: error.workflowChildEffectId,
      }),
    );
  });

  it("treats a hosted tool exception after its boundary as outcome unknown", async () => {
    const workflowEffectId = `sha256:${"7".repeat(64)}`;
    const toolName = "host_publish";
    const requestHostTool = vi.fn(async () => {
      throw new Error("host connection dropped after dispatch");
    });
    const subCtx = createContext({
      workflowEffectId,
      maxIterations: 2,
      tokenBudget: 1,
      hostManagedToolPolicy: {
        toolDefinitions: [
          {
            type: "function",
            function: {
              name: toolName,
              description: "publish",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        tools: { [toolName]: { allowed: true, riskLevel: "low" } },
      },
    });
    const chatFn = vi.fn(async () => ({
      message: {
        content: "",
        tool_calls: [
          {
            id: "host-1",
            type: "function",
            function: { name: toolName, arguments: "{}" },
          },
        ],
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    }));

    const error = await captureRejection(
      subCtx.run("t", {
        ...RUN_OPTIONS,
        chatFn,
        interaction: { requestHostTool },
      }),
    );

    expect(error).toMatchObject({
      code: "CC_WORKFLOW_NESTED_TOOL_OUTCOME_UNKNOWN",
      workflowEffectOutcomeUnknown: true,
      workflowEffectId,
    });
    expect(subCtx.nestedEffectSettlements()).toEqual([
      expect.objectContaining({
        childEffectId: error.workflowChildEffectId,
        status: "outcome_unknown",
        outcomeUnknown: true,
      }),
    ]);
    expect(requestHostTool).toHaveBeenCalledWith(
      toolName,
      {},
      expect.objectContaining({
        workflowEffectId,
        workflowChildEffectId: error.workflowChildEffectId,
      }),
    );
  });
});

describe("SubAgentContext strict usage boundary contract", () => {
  it("persists start before provider work and settles the same real callId", async () => {
    const timeline = [];
    const boundaries = [];
    const settlements = [];
    const forwarded = [];
    const subCtx = createContext({
      maxIterations: 2,
      strictUsageTelemetry: true,
      onUsageBoundary: (event) => {
        timeline.push("boundary");
        boundaries.push({ ...event });
      },
      onUsageSettlement: (event) => {
        timeline.push("settlement");
        settlements.push({ ...event });
      },
      onUsage: (event) => {
        timeline.push("forwarded");
        forwarded.push({ ...event });
      },
    });
    const chatFn = vi.fn(async () => {
      timeline.push("provider");
      return finalResponse("strict answer", {
        input_tokens: 7,
        output_tokens: 5,
      });
    });

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn,
    });

    expect(result.summary).toContain("strict answer");
    expect(timeline).toEqual([
      "boundary",
      "provider",
      "settlement",
      "forwarded",
    ]);
    expect(boundaries).toHaveLength(1);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].callId).toBe(boundaries[0].callId);
    expect(settlements[0]).toMatchObject({
      type: "token-usage",
      boundaryNotified: true,
      usage: { input_tokens: 7, output_tokens: 5 },
    });
    expect(forwarded[0]).toMatchObject({
      callId: boundaries[0].callId,
      boundaryNotified: true,
      ledgerPersisted: true,
    });
  });

  it("pairs every call independently across multiple child model turns", async () => {
    const boundaries = [];
    const settlements = [];
    const toolBoundaries = [];
    const toolSettlements = [];
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(toolResponse())
      .mockResolvedValueOnce(
        finalResponse("done", { input_tokens: 4, output_tokens: 1 }),
      );
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: (event) => boundaries.push({ ...event }),
      onUsageSettlement: (event) => settlements.push({ ...event }),
      onToolCallBoundary: (event) => toolBoundaries.push({ ...event }),
      onToolCallSettlement: (event) => toolSettlements.push({ ...event }),
    });

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn,
    });

    expect(result.summary).toContain("done");
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(boundaries).toHaveLength(2);
    expect(settlements).toHaveLength(2);
    expect(new Set(boundaries.map((event) => event.callId)).size).toBe(2);
    expect(settlements.map((event) => event.callId)).toEqual(
      boundaries.map((event) => event.callId),
    );
    expect(toolBoundaries).toHaveLength(1);
    expect(toolSettlements).toHaveLength(1);
    expect(toolSettlements[0].tool_use_id).toBe(toolBoundaries[0].tool_use_id);
    expect(toolSettlements[0].tool).toBe(toolBoundaries[0].tool);
  });

  it("persists provider settlement before a session budget projection can fail", async () => {
    const timeline = [];
    const sessionBudget = {
      recordUsage: vi.fn(() => {
        timeline.push("budget");
        throw new Error("budget projection failed");
      }),
    };
    const subCtx = createContext({
      strictUsageTelemetry: true,
      sessionBudget,
      onUsageBoundary: () => timeline.push("boundary"),
      onUsageSettlement: () => timeline.push("settlement"),
    });

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn: async () => {
        timeline.push("provider");
        return finalResponse("done", { input_tokens: 2, output_tokens: 1 });
      },
    });

    expect(timeline).toEqual(["boundary", "provider", "settlement", "budget"]);
    expect(sessionBudget.recordUsage).toHaveBeenCalledOnce();
    expect(result.summary).toContain("budget projection failed");
  });

  it("persists a successful response settlement before honoring child abort", async () => {
    const controller = new AbortController();
    const timeline = [];
    const subCtx = createContext({
      signal: controller.signal,
      strictUsageTelemetry: true,
      onUsageBoundary: () => timeline.push("boundary"),
      onUsageSettlement: () => timeline.push("settlement"),
    });

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn: async () => {
        timeline.push("provider");
        controller.abort();
        return finalResponse("done", { input_tokens: 2, output_tokens: 1 });
      },
    });

    expect(timeline).toEqual(["boundary", "provider", "settlement"]);
    expect(result.summary).toContain("aborted");
  });

  it("fails closed at a missing child tool boundary writer before another provider call", async () => {
    const chatFn = vi.fn(async () => toolResponse());
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: vi.fn(),
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toMatchObject({
      code: "CC_USAGE_TOOL_BOUNDARY_OBSERVER_REQUIRED",
      runtimeLedgerPersistence: true,
    });
    expect(chatFn).toHaveBeenCalledOnce();
  });

  it("stops before another provider call when the child tool boundary writer throws", async () => {
    const failure = new Error("tool start disk full");
    const chatFn = vi.fn(async () => toolResponse());
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: vi.fn(),
      onToolCallBoundary: () => {
        throw failure;
      },
      onToolCallSettlement: vi.fn(),
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toBe(failure);
    expect(error.runtimeLedgerPersistence).toBe(true);
    expect(chatFn).toHaveBeenCalledOnce();
  });

  it("stops before another provider call when the child tool settlement writer throws", async () => {
    const failure = new Error("tool result disk full");
    const chatFn = vi.fn(async () => toolResponse());
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: vi.fn(),
      onToolCallBoundary: vi.fn(),
      onToolCallSettlement: () => {
        throw failure;
      },
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toBe(failure);
    expect(error.runtimeLedgerPersistence).toBe(true);
    expect(chatFn).toHaveBeenCalledOnce();
  });

  it("fails before agentLoop without invoking an existing observer with null", async () => {
    const boundary = vi.fn();
    const chatFn = vi.fn();
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: boundary,
      // Deliberately omit onUsageSettlement.
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toMatchObject({
      code: "CC_USAGE_SETTLEMENT_OBSERVER_REQUIRED",
      runtimeLedgerPersistence: true,
    });
    expect(boundary).not.toHaveBeenCalled();
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("marks a throwing boundary observer and prevents provider work", async () => {
    const failure = new Error("boundary disk full");
    const chatFn = vi.fn();
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: () => {
        throw failure;
      },
      onUsageSettlement: vi.fn(),
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toBe(failure);
    expect(error.runtimeLedgerPersistence).toBe(true);
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("rejects an async boundary observer before provider work", async () => {
    const chatFn = vi.fn();
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: () => Promise.resolve(),
      onUsageSettlement: vi.fn(),
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toMatchObject({
      code: "CC_USAGE_BOUNDARY_OBSERVER_ASYNC",
      runtimeLedgerPersistence: true,
    });
    expect(chatFn).not.toHaveBeenCalled();
  });

  it("marks a throwing settlement observer and does not forward the usage", async () => {
    const failure = new Error("settlement disk full");
    const forwarded = vi.fn();
    const chatFn = vi.fn(async () =>
      toolResponse({ input_tokens: 1, output_tokens: 1 }),
    );
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: () => {
        throw failure;
      },
      onUsage: forwarded,
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toBe(failure);
    expect(error.runtimeLedgerPersistence).toBe(true);
    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(forwarded).not.toHaveBeenCalled();
  });

  it("rejects an async settlement observer before another provider call", async () => {
    const chatFn = vi.fn(async () =>
      toolResponse({ input_tokens: 1, output_tokens: 1 }),
    );
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: () => Promise.resolve(),
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toMatchObject({
      code: "CC_USAGE_SETTLEMENT_OBSERVER_ASYNC",
      runtimeLedgerPersistence: true,
    });
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a strict onUsage sink failure", async () => {
    const failure = new Error("parent usage queue closed");
    const chatFn = vi.fn(async () =>
      toolResponse({ input_tokens: 1, output_tokens: 1 }),
    );
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: vi.fn(),
      onUsage: () => {
        throw failure;
      },
    });

    const error = await captureRejection(
      subCtx.run("count things", { ...RUN_OPTIONS, chatFn }),
    );

    expect(error).toBe(failure);
    expect(error.runtimeLedgerPersistence).toBe(true);
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("settles missing provider usage as unknown with the start callId", async () => {
    const boundaries = [];
    const settlements = [];
    const forwarded = [];
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: (event) => boundaries.push({ ...event }),
      onUsageSettlement: (event) => settlements.push({ ...event }),
      onUsage: (event) => forwarded.push({ ...event }),
    });

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn: async () => finalResponse("usage unavailable"),
    });

    expect(result.summary).toContain("usage unavailable");
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      type: "model-usage-unknown",
      callId: boundaries[0].callId,
      code: "provider_usage_missing",
      boundaryNotified: true,
    });
    expect(forwarded[0]).toMatchObject({
      type: "model-usage-unknown",
      callId: boundaries[0].callId,
      ledgerPersisted: true,
    });
  });

  it("settles a provider failure as unknown before returning partial failure", async () => {
    const boundaries = [];
    const settlements = [];
    const subCtx = createContext({
      strictUsageTelemetry: true,
      onUsageBoundary: (event) => boundaries.push({ ...event }),
      onUsageSettlement: (event) => settlements.push({ ...event }),
    });

    const result = await subCtx.run("count things", {
      ...RUN_OPTIONS,
      chatFn: async () => {
        throw new Error("provider offline");
      },
    });

    expect(result.summary).toContain("provider offline");
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      type: "model-usage-unknown",
      callId: boundaries[0].callId,
      code: "provider_call_failed",
    });
  });
});
