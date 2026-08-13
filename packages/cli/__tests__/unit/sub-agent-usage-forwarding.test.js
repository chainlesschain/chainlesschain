/**
 * REAL SubAgentContext usage-boundary coverage. The child loop is driven with
 * an injected chatFn, so these tests exercise the generator's actual ordering
 * without making a live provider request.
 */
import { describe, it, expect, vi } from "vitest";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

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
