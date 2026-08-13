/**
 * 用量归因 — sub-agent usage propagation through the agent loop.
 *
 * A spawned sub-agent consumes its own generator, so its real token usage
 * never reaches the parent loop's consumers. The spawn wiring forwards it
 * (via SubAgentContext options.onUsage) into the run's shared sink, and
 * agentLoop drains that sink at iteration boundaries as `token-usage` events
 * carrying an `attribution` frame ({origin:"subagent", subagentId, role,
 * parentSessionId, depth}). A nested child's already-attributed record must
 * pass through unchanged (deepest frame wins).
 *
 * SubAgentContext is mocked (module scope) so the child "run" can emit usage
 * deterministically; agentLoop + executeTool run real (chatFn-injected).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/sub-agent-context.js", () => {
  const state = { created: [] };
  const createContext = (opts) => {
    const n = state.created.length + 1;
    const ctx = {
      id: `sub-mock-${n}`,
      role: opts.role || "t",
      task: opts.task,
      status: "active",
      result: null,
      maxIterations: 8,
      createdAt: "t0",
      completedAt: null,
      _opts: opts,
      _signal: opts.signal || null,
      recoveryBinding: vi.fn(() => ({
        childAgentId: ctx.id,
        parentAgentId: opts.parentId || null,
        traceId: null,
        parentTraceId: opts.hookParentTraceId || null,
        checkpointIds: [],
        toolUseIds: [],
        worktreeId: null,
        worktreePath: null,
      })),
      forceComplete: vi.fn(function (reason) {
        ctx.status = "completed";
        if (!ctx.result) {
          ctx.result = {
            summary: `(force-completed: ${reason})`,
            artifacts: [],
            tokenCount: 0,
            toolsUsed: [],
            iterationCount: 0,
          };
        }
      }),
      run: vi.fn(async () => {
        // Simulate the real child-loop protocol: a started event reaches the
        // synchronous boundary observer before provider work; its matching
        // settlement is persisted synchronously before the attributed record
        // is forwarded to the parent sink with de-duplication flags.
        if (Array.isArray(ctx._emitUsage)) {
          for (const rawEvent of ctx._emitUsage) {
            const event = rawEvent?.type
              ? rawEvent
              : { type: "token-usage", ...rawEvent };
            if (event.type === "model-usage-started") {
              opts.onUsageBoundary?.(event);
              ctx._childProvider?.(event);
              continue;
            }
            if (
              event.type === "token-usage" ||
              event.type === "model-usage-unknown" ||
              event.type === "compaction-usage-unknown"
            ) {
              let forwarded = event;
              if (opts.strictUsageTelemetry === true) {
                forwarded = { ...event, boundaryNotified: true };
                opts.onUsageSettlement?.(forwarded);
                forwarded = { ...forwarded, ledgerPersisted: true };
              }
              opts.onUsage?.(forwarded);
            }
          }
        }
        ctx.status = "completed";
        ctx.result = {
          summary: "child done",
          artifacts: [],
          tokenCount: 3,
          toolsUsed: ["read_file"],
          iterationCount: 1,
        };
        return ctx.result;
      }),
    };
    state.created.push(ctx);
    return ctx;
  };
  state.createContext = createContext;
  const create = vi.fn(createContext);
  return { SubAgentContext: { create }, _subState: state };
});

import {
  _retryStreamingChat,
  agentLoop,
} from "../../src/runtime/agent-core.js";
import { _subState, SubAgentContext } from "../../src/lib/sub-agent-context.js";

function spawnCall(args, id = "c1") {
  return {
    id,
    function: { name: "spawn_sub_agent", arguments: JSON.stringify(args) },
  };
}

async function drive(chatFn, options = {}) {
  const messages = [{ role: "user", content: "go" }];
  const events = [];
  const gen = agentLoop(messages, {
    chatFn,
    autoCompact: false,
    runnableProviderFallback: false,
    ...options,
  });
  for await (const e of gen) events.push(e);
  return { events, messages };
}

beforeEach(() => {
  _subState.created.length = 0;
  SubAgentContext.create.mockClear();
});

const CHILD_USAGE = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  usage: { input_tokens: 40, output_tokens: 15 },
  source: "semantic-compaction",
};

describe("agentLoop sub-agent usage attribution", () => {
  it("re-yields a blocking sub-agent's usage as an attributed token-usage event", async () => {
    let call = 0;
    const chatFn = vi.fn(async () => {
      call++;
      if (call === 1) {
        // arm the child to emit usage when run() is invoked
        queueMicrotask(() => {
          if (_subState.created[0]) {
            _subState.created[0]._emitUsage = [CHILD_USAGE];
          }
        });
        return {
          message: {
            content: "",
            tool_calls: [spawnCall({ role: "researcher", task: "dig" })],
          },
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }
      return {
        message: { content: "final" },
        usage: { input_tokens: 20, output_tokens: 8 },
      };
    });
    // _emitUsage must be set BEFORE run() — arm via create() instead:
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx._emitUsage = [CHILD_USAGE];
      return ctx;
    });

    const { events } = await drive(chatFn, { sessionId: "sess-parent" });

    const usageEvents = events.filter((e) => e.type === "token-usage");
    const attributed = usageEvents.filter((e) => e.attribution);
    expect(attributed).toHaveLength(1);
    expect(attributed[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 40, output_tokens: 15 },
      source: "semantic-compaction",
      attribution: {
        origin: "subagent",
        subagentId: "sub-mock-1",
        role: "researcher",
        parentSessionId: "sess-parent",
        depth: 1,
      },
    });

    // main-loop usage events carry NO attribution frame (absence ⇒ main)
    const main = usageEvents.filter((e) => !e.attribution);
    expect(main.length).toBeGreaterThanOrEqual(2);

    // ordering: the attributed drain happens at the next iteration boundary,
    // BEFORE the final main LLM call's usage — so the LAST usage event is
    // always the main model's (the REPL derives its context-size estimate
    // from it).
    expect(usageEvents[usageEvents.length - 1].attribution).toBeUndefined();
  });

  it("preserves a nested child's own attribution frame (passthrough, deepest wins)", async () => {
    const nested = {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 3, output_tokens: 2 },
      attribution: { origin: "skill", skill: "csv-clean", depth: 2 },
    };
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx._emitUsage = [nested];
      return ctx;
    });
    let call = 0;
    const chatFn = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [spawnCall({ role: "outer", task: "t" })],
          },
        };
      }
      return { message: { content: "final" } };
    });

    const { events } = await drive(chatFn);
    const attributed = events.filter(
      (e) => e.type === "token-usage" && e.attribution,
    );
    expect(attributed).toHaveLength(1);
    expect(attributed[0].attribution).toEqual(nested.attribution);
  });

  it("forwards one real strict child callId without synthetic boundaries or sentinels", async () => {
    const childCallId = "child-call-real-1";
    const childProvider = vi.fn();
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx._childProvider = childProvider;
      ctx._emitUsage = [
        {
          type: "model-usage-started",
          callId: childCallId,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          source: "model",
        },
        {
          type: "token-usage",
          callId: childCallId,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          usage: { input_tokens: 40, output_tokens: 15 },
          source: "model",
        },
      ];
      return ctx;
    });
    let call = 0;
    const chatFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [spawnCall({ role: "strict-child", task: "t" })],
          },
          usage: { input_tokens: 2, output_tokens: 1 },
        };
      }
      return {
        message: { content: "final" },
        usage: { input_tokens: 3, output_tokens: 1 },
      };
    });

    const boundaries = [];
    const settlements = [];
    const { events } = await drive(chatFn, {
      sessionId: "sess-strict",
      strictUsageTelemetry: true,
      onUsageBoundary: (event) => boundaries.push(event),
      onUsageSettlement: (event) => settlements.push(event),
    });
    expect(_subState.created[0].run).toHaveBeenCalledOnce();
    expect(childProvider).toHaveBeenCalledOnce();
    expect(boundaries).toHaveLength(1);
    const [boundary] = boundaries;
    expect(boundary).toMatchObject({
      type: "model-usage-started",
      callId: childCallId,
      source: "subagent",
      attribution: {
        origin: "subagent",
        subagentId: "sub-mock-1",
        parentSessionId: "sess-strict",
      },
    });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      type: "token-usage",
      callId: childCallId,
      source: "subagent",
      boundaryNotified: true,
    });
    const childUsage = events.find(
      (event) => event.type === "token-usage" && event.attribution,
    );
    expect(childUsage).toMatchObject({
      callId: childCallId,
      source: "subagent",
      ledgerPersisted: true,
    });
    expect(
      events.filter(
        (event) =>
          event.type === "model-usage-started" && event.callId === childCallId,
      ),
    ).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === "model-usage-unknown" && event.source === "subagent",
      ),
    ).toHaveLength(0);
  });

  it("blocks child execution when the strict parent boundary cannot be persisted", async () => {
    const childProvider = vi.fn();
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx._childProvider = childProvider;
      ctx._emitUsage = [
        {
          type: "model-usage-started",
          callId: "child-call-fail-1",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          source: "model",
        },
      ];
      return ctx;
    });
    let call = 0;
    const chatFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [spawnCall({ role: "strict-child", task: "t" })],
          },
          usage: { input_tokens: 2, output_tokens: 1 },
        };
      }
      return { message: { content: "must not run" } };
    });
    const persistenceError = new Error("ledger unavailable");

    await expect(
      drive(chatFn, {
        sessionId: "sess-strict-failure",
        strictUsageTelemetry: true,
        onUsageBoundary: () => {
          throw persistenceError;
        },
        onUsageSettlement: () => {},
      }),
    ).rejects.toBe(persistenceError);
    expect(_subState.created).toHaveLength(1);
    expect(_subState.created[0].run).toHaveBeenCalledOnce();
    expect(childProvider).not.toHaveBeenCalled();
    expect(chatFn).toHaveBeenCalledOnce();
    expect(persistenceError).toMatchObject({
      runtimeLedgerPersistence: true,
    });
  });

  it("blocks strict child creation when the settlement observer is missing", async () => {
    const chatFn = vi.fn(async () => ({
      message: {
        content: "",
        tool_calls: [spawnCall({ role: "strict-child", task: "t" })],
      },
      usage: { input_tokens: 2, output_tokens: 1 },
    }));

    await expect(
      drive(chatFn, {
        sessionId: "sess-strict-no-observer",
        strictUsageTelemetry: true,
        onUsageBoundary: () => {},
      }),
    ).rejects.toMatchObject({
      code: "CC_USAGE_SETTLEMENT_OBSERVER_REQUIRED",
      runtimeLedgerPersistence: true,
    });
    expect(_subState.created).toHaveLength(0);
    expect(chatFn).toHaveBeenCalledOnce();
  });

  it("forwards strict child retry evidence with child attribution", async () => {
    const drop = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const childTransport = vi
      .fn()
      .mockRejectedValueOnce(drop)
      .mockResolvedValueOnce("ok");
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx.run = vi.fn(async () => {
        await _retryStreamingChat(childTransport, {
          retries: 1,
          sleep: async () => {},
          strictRetryObserver: true,
          ...(typeof opts.llmOptions?.onStreamRetry === "function"
            ? { onRetry: opts.llmOptions.onStreamRetry }
            : {}),
        });
        ctx.status = "completed";
        ctx.result = {
          summary: "child done",
          artifacts: [],
          tokenCount: 0,
          toolsUsed: [],
          iterationCount: 1,
        };
        return ctx.result;
      });
      return ctx;
    });
    let call = 0;
    const chatFn = vi.fn(async () => {
      call += 1;
      return call === 1
        ? {
            message: {
              content: "",
              tool_calls: [spawnCall({ role: "retry-child", task: "t" })],
            },
            usage: { input_tokens: 2, output_tokens: 1 },
          }
        : {
            message: { content: "done" },
            usage: { input_tokens: 1, output_tokens: 1 },
          };
    });
    const retryEvidence = [];

    await drive(chatFn, {
      sessionId: "sess-child-retry",
      strictUsageTelemetry: true,
      onUsageBoundary: vi.fn(),
      onUsageSettlement: vi.fn(),
      onStreamRetry: (attempt, error, telemetry) =>
        retryEvidence.push({ attempt, error, telemetry }),
    });

    expect(childTransport).toHaveBeenCalledTimes(2);
    expect(retryEvidence).toHaveLength(1);
    expect(retryEvidence[0]).toMatchObject({
      attempt: 1,
      error: drop,
      telemetry: {
        source: "subagent",
        attribution: {
          origin: "subagent",
          subagentId: "sub-mock-1",
          role: "retry-child",
          parentSessionId: "sess-child-retry",
          depth: 1,
        },
      },
    });
  });

  it("fails a strict child retry closed when the parent retry writer is missing", async () => {
    const drop = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const childTransport = vi.fn(async () => {
      throw drop;
    });
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx.run = vi.fn(async () =>
        _retryStreamingChat(childTransport, {
          retries: 1,
          sleep: async () => {},
          strictRetryObserver: true,
          ...(typeof opts.llmOptions?.onStreamRetry === "function"
            ? { onRetry: opts.llmOptions.onStreamRetry }
            : {}),
        }),
      );
      return ctx;
    });
    const chatFn = vi.fn(async () => ({
      message: {
        content: "",
        tool_calls: [spawnCall({ role: "retry-child", task: "t" })],
      },
      usage: { input_tokens: 2, output_tokens: 1 },
    }));

    await expect(
      drive(chatFn, {
        strictUsageTelemetry: true,
        onUsageBoundary: vi.fn(),
        onUsageSettlement: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "CC_RETRY_OBSERVER_REQUIRED",
      runtimeLedgerPersistence: true,
    });
    expect(childTransport).toHaveBeenCalledOnce();
    expect(chatFn).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "throwing",
      () => {
        throw new Error("retry writer failed");
      },
      "CC_RETRY_PERSISTENCE_FAILED",
    ],
    ["async", async () => {}, "CC_RETRY_OBSERVER_ASYNC"],
  ])(
    "fails a strict child retry closed for a %s parent retry writer",
    async (_label, onStreamRetry, code) => {
      const drop = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
      });
      const childTransport = vi.fn(async () => {
        throw drop;
      });
      SubAgentContext.create.mockImplementationOnce((opts) => {
        const ctx = _subState.createContext(opts);
        ctx.run = vi.fn(async () =>
          _retryStreamingChat(childTransport, {
            retries: 1,
            sleep: async () => {},
            strictRetryObserver: true,
            onRetry: opts.llmOptions.onStreamRetry,
          }),
        );
        return ctx;
      });
      const chatFn = vi.fn(async () => ({
        message: {
          content: "",
          tool_calls: [spawnCall({ role: "retry-child", task: "t" })],
        },
        usage: { input_tokens: 2, output_tokens: 1 },
      }));

      await expect(
        drive(chatFn, {
          strictUsageTelemetry: true,
          onUsageBoundary: vi.fn(),
          onUsageSettlement: vi.fn(),
          onStreamRetry,
        }),
      ).rejects.toMatchObject({
        code,
        runtimeLedgerPersistence: true,
      });
      expect(childTransport).toHaveBeenCalledOnce();
      expect(chatFn).toHaveBeenCalledOnce();
    },
  );

  it("drains background sub-agent usage before the run ends", async () => {
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = _subState.createContext(opts);
      ctx._emitUsage = [CHILD_USAGE];
      return ctx;
    });
    let call = 0;
    const chatFn = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [
              spawnCall({ role: "bg", task: "t", background: true }),
            ],
          },
        };
      }
      return { message: { content: "final" } };
    });

    const { events } = await drive(chatFn, { sessionId: "sess-bg" });
    const attributed = events.filter(
      (e) => e.type === "token-usage" && e.attribution,
    );
    expect(attributed).toHaveLength(1);
    expect(attributed[0].attribution).toMatchObject({
      origin: "subagent",
      subagentId: "sub-mock-1",
      parentSessionId: "sess-bg",
    });
  });
});
