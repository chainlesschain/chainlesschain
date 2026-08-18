/**
 * spawn_sub_agent background mode (Claude-Code 2.1.198 parity).
 *
 * background:true returns a running handle immediately and the parent loop
 * keeps working; the result is drained into the conversation as a user-role
 * message before a later LLM call. If the model tries to finish while
 * background sub-agents are still running, the loop WAITS for them, injects
 * the results, and gives the model one more turn — a background result can
 * never be silently lost.
 *
 * SubAgentContext is mocked (isolated file scope) so the child "run" can be
 * settled deterministically from the test; agentLoop + executeTool run real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/lib/sub-agent-context.js", () => {
  const state = { created: [], autoResolve: null };
  const create = vi.fn((opts) => {
    const n = state.created.length + 1;
    const ctx = {
      id: `sub-mock-${n}`,
      role: opts.role || "t",
      task: opts.task,
      opts,
      status: "active",
      result: null,
      maxIterations: 8,
      createdAt: "t0",
      completedAt: null,
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
            summary: `(Sub-agent force-completed: ${reason})`,
            artifacts: [],
            tokenCount: 0,
            toolsUsed: [],
            iterationCount: 0,
          };
        }
      }),
      run: vi.fn(
        () =>
          new Promise((resolve, reject) => {
            ctx._resolveRun = (result) => {
              ctx.status = "completed";
              ctx.result = result;
              resolve(result);
            };
            ctx._rejectRun = reject;
            if (state.autoResolve) state.autoResolve(ctx);
          }),
      ),
    };
    state.created.push(ctx);
    return ctx;
  });
  return { SubAgentContext: { create }, _subState: state };
});

import { agentLoop, executeTool } from "../../src/runtime/agent-core.js";
import { _subState } from "../../src/lib/sub-agent-context.js";

const RESULT = {
  summary: "bg summary: found 3 issues",
  artifacts: [],
  tokenCount: 5,
  toolsUsed: ["read_file"],
  iterationCount: 2,
};

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

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}

function runStrictChildUsageAttempt(ctx, childProvider) {
  const callId = `mdl-${ctx.id}`;
  try {
    ctx.opts.onUsageBoundary({
      type: "model-usage-started",
      callId,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      source: "model",
    });
    const providerResult = childProvider();
    ctx.opts.onUsageSettlement({
      type: "token-usage",
      callId,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: providerResult.usage,
    });
    ctx._resolveRun(RESULT);
  } catch (error) {
    ctx._rejectRun(error);
  }
  return callId;
}

function strictUsageObservers(failurePhase, failure, timeline) {
  return {
    onUsageBoundary: vi.fn((event) => {
      timeline.push({ phase: "boundary", event });
      if (failurePhase === "boundary") throw failure;
    }),
    onUsageSettlement: vi.fn((event) => {
      timeline.push({ phase: "settlement", event });
      if (failurePhase === "settlement") throw failure;
    }),
  };
}

beforeEach(() => {
  _subState.created.length = 0;
  _subState.autoResolve = null;
});

describe("spawn_sub_agent background mode", () => {
  it("binds the spawned child loop to the admitted parent tool effect", async () => {
    const workflowEffectId = `sha256:${"a".repeat(64)}`;
    const workflowChildEffectId = `sha256:${"b".repeat(64)}`;
    _subState.autoResolve = (ctx) => ctx._resolveRun(RESULT);

    const result = await executeTool(
      "spawn_sub_agent",
      { role: "reviewer", task: "review the release" },
      {
        workflowEffectId,
        workflowChildEffectId,
        workflowChildSequence: 1,
        workflowEffectProtocol: "cc-workflow-child-effect/v1",
        strictUsageTelemetry: true,
        subAgentUsageSink: [],
        onUsageBoundary: vi.fn(),
        onUsageSettlement: vi.fn(),
        onProviderReceipt: vi.fn(),
        onToolCallBoundary: vi.fn(),
        onToolCallSettlement: vi.fn(),
      },
    );

    expect(result).toMatchObject({ summary: RESULT.summary });
    expect(_subState.created).toHaveLength(1);
    expect(_subState.created[0].opts).toMatchObject({
      workflowEffectId: workflowChildEffectId,
      strictUsageTelemetry: true,
      onProviderReceipt: expect.any(Function),
    });
  });

  it("rethrows a workflow-bound spawned child's unknown outcome", async () => {
    const unknown = new Error("child provider outcome is unknown");
    unknown.workflowEffectOutcomeUnknown = true;
    _subState.autoResolve = (ctx) => ctx._rejectRun(unknown);

    await expect(
      executeTool(
        "spawn_sub_agent",
        { role: "reviewer", task: "review the release" },
        {
          workflowEffectId: `sha256:${"a".repeat(64)}`,
          workflowChildEffectId: `sha256:${"b".repeat(64)}`,
          workflowChildSequence: 1,
          workflowEffectProtocol: "cc-workflow-child-effect/v1",
          strictUsageTelemetry: true,
          subAgentUsageSink: [],
          onUsageBoundary: vi.fn(),
          onUsageSettlement: vi.fn(),
          onToolCallBoundary: vi.fn(),
          onToolCallSettlement: vi.fn(),
        },
      ),
    ).rejects.toBe(unknown);
  });

  it("fences a background descendant unknown before another parent provider call", async () => {
    const unknown = new Error("background child provider outcome is unknown");
    unknown.workflowEffectOutcomeUnknown = true;
    _subState.autoResolve = (ctx) => ctx._rejectRun(unknown);
    const chatFn = vi.fn(async (_messages, options) => ({
      message: {
        content: "",
        tool_calls: [
          spawnCall(
            { role: "reviewer", task: "review", background: true },
            "spawn-background-unknown",
          ),
        ],
      },
      usage: { input_tokens: 2, output_tokens: 1 },
      providerReceipt: {
        protocol: "cc-provider-request-receipt/v1",
        provider: "openai",
        clientRequestId: options.providerRequestId,
        requestId: "req_parent_before_background_unknown",
        responseId: "resp_parent_before_background_unknown",
        requestIdentitySemantics: "trace-only",
        independentlyReadable: false,
      },
    }));

    const error = await captureRejection(
      drive(chatFn, {
        provider: "openai",
        model: "gpt-4o",
        workflowEffectId: `sha256:${"a".repeat(64)}`,
        strictUsageTelemetry: true,
        onUsageBoundary: vi.fn(),
        onUsageSettlement: vi.fn(),
        onToolCallBoundary: vi.fn(),
        onToolCallSettlement: vi.fn(),
      }),
    );

    expect(error).toBe(unknown);
    expect(chatFn).toHaveBeenCalledOnce();
    expect(_subState.created[0].opts.workflowEffectId).toMatch(/^sha256:/u);
  });

  it("returns a running handle and waits for the result at run end", async () => {
    let call = 0;
    const chatFn = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [
              spawnCall({ role: "t", task: "bg", background: true }),
            ],
          },
        };
      }
      if (call === 2) {
        // Model tries to finish while the sub-agent is still running; settle
        // it now so the end-of-run wait can complete.
        _subState.created[0]._resolveRun(RESULT);
        return { message: { content: "premature final" } };
      }
      return { message: { content: "real final answer" } };
    });

    const { events, messages } = await drive(chatFn);

    // Spawn returned a running handle, not a summary.
    const toolResult = events.find((e) => e.type === "tool-result");
    expect(toolResult.result.background).toBe(true);
    expect(toolResult.result.status).toBe("running");
    expect(toolResult.result.subAgentId).toBe("sub-mock-1");

    // The loop refused to end at call 2: waited, injected, re-prompted.
    expect(events.some((e) => e.type === "waiting-background-sub-agents")).toBe(
      true,
    );
    const bg = events.find((e) => e.type === "background-sub-agent-result");
    expect(bg.summary).toBe(RESULT.summary);
    expect(bg.error).toBeNull();

    // The injected user message carries the result into the model's context.
    const injected = messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("[Background sub-agent"),
    );
    expect(injected.content).toContain(RESULT.summary);

    // The model got a third turn and produced the real final answer.
    expect(chatFn).toHaveBeenCalledTimes(3);
    const final = events.find((e) => e.type === "response-complete");
    expect(final.content).toBe("real final answer");
  });

  it("drains a result that settled between turns before the next LLM call", async () => {
    // Sub-agent completes immediately after spawn.
    _subState.autoResolve = (ctx) => ctx._resolveRun(RESULT);
    let call = 0;
    const seenByCall2 = { injected: false };
    const chatFn = vi.fn(async (messages) => {
      call++;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [
              spawnCall({ role: "t", task: "bg", background: true }),
            ],
          },
        };
      }
      seenByCall2.injected = messages.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes(RESULT.summary),
      );
      return { message: { content: "final" } };
    });

    const { events } = await drive(chatFn);

    // Delivered BEFORE the second LLM call — no end-of-run wait needed.
    expect(seenByCall2.injected).toBe(true);
    expect(events.some((e) => e.type === "waiting-background-sub-agents")).toBe(
      false,
    );
    expect(
      events.filter((e) => e.type === "background-sub-agent-result"),
    ).toHaveLength(1);
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it.each(["boundary", "settlement"])(
    "loop-top settled drain rethrows the original %s persistence failure before parent call 2",
    async (failurePhase) => {
      const failure = new Error(`${failurePhase} ledger unavailable`);
      const timeline = [];
      const observers = strictUsageObservers(failurePhase, failure, timeline);
      const childProvider = vi.fn(() => {
        timeline.push({ phase: "provider" });
        return { usage: { input_tokens: 5, output_tokens: 2 } };
      });
      _subState.autoResolve = (ctx) => {
        ctx._usageCallId = runStrictChildUsageAttempt(ctx, childProvider);
      };
      let parentCall = 0;
      const chatFn = vi.fn(async () => {
        parentCall += 1;
        if (parentCall === 1) {
          return {
            message: {
              content: "",
              tool_calls: [
                spawnCall({ role: "strict-bg", task: "bg", background: true }),
              ],
            },
          };
        }
        throw new Error("parent provider call 2 must not start");
      });

      const error = await captureRejection(
        drive(chatFn, {
          strictUsageTelemetry: true,
          ...observers,
        }),
      );

      expect(error).toBe(failure);
      expect(error.runtimeLedgerPersistence).toBe(true);
      expect(chatFn).toHaveBeenCalledTimes(1);
      expect(_subState.created).toHaveLength(1);
      const [ctx] = _subState.created;
      expect(ctx.opts).toMatchObject({ strictUsageTelemetry: true });
      expect(ctx.opts.onUsageBoundary).toEqual(expect.any(Function));
      expect(ctx.opts.onUsageSettlement).toEqual(expect.any(Function));
      expect(ctx.forceComplete).toHaveBeenCalledWith(failure.message);
      expect(observers.onUsageBoundary).toHaveBeenCalledTimes(1);
      expect(observers.onUsageBoundary.mock.calls[0][0]).toMatchObject({
        callId: ctx._usageCallId,
        source: "subagent",
        attribution: {
          origin: "subagent",
          subagentId: ctx.id,
          role: "strict-bg",
        },
      });

      if (failurePhase === "boundary") {
        expect(childProvider).not.toHaveBeenCalled();
        expect(observers.onUsageSettlement).not.toHaveBeenCalled();
        expect(timeline.map(({ phase }) => phase)).toEqual(["boundary"]);
      } else {
        expect(childProvider).toHaveBeenCalledTimes(1);
        expect(observers.onUsageSettlement).toHaveBeenCalledTimes(1);
        expect(observers.onUsageSettlement.mock.calls[0][0].callId).toBe(
          ctx._usageCallId,
        );
        expect(timeline.map(({ phase }) => phase)).toEqual([
          "boundary",
          "provider",
          "settlement",
        ]);
      }
    },
  );

  it.each(["boundary", "settlement"])(
    "final Promise.all drain rethrows the original %s persistence failure before parent call 3",
    async (failurePhase) => {
      const failure = new Error(`${failurePhase} ledger unavailable`);
      const timeline = [];
      const observers = strictUsageObservers(failurePhase, failure, timeline);
      const childProvider = vi.fn(() => {
        timeline.push({ phase: "provider" });
        return { usage: { input_tokens: 8, output_tokens: 3 } };
      });
      let parentCall = 0;
      const chatFn = vi.fn(async () => {
        parentCall += 1;
        if (parentCall === 1) {
          return {
            message: {
              content: "",
              tool_calls: [
                spawnCall({ role: "strict-bg", task: "bg", background: true }),
              ],
            },
          };
        }
        if (parentCall === 2) {
          // Keep the child pending through the next parent call, then fail it
          // so the no-tool final path must catch it after Promise.all.
          const [ctx] = _subState.created;
          ctx._usageCallId = runStrictChildUsageAttempt(ctx, childProvider);
          return { message: { content: "premature parent final" } };
        }
        throw new Error("parent provider call 3 must not start");
      });

      const error = await captureRejection(
        drive(chatFn, {
          strictUsageTelemetry: true,
          ...observers,
        }),
      );

      expect(error).toBe(failure);
      expect(error.runtimeLedgerPersistence).toBe(true);
      expect(chatFn).toHaveBeenCalledTimes(2);
      const [ctx] = _subState.created;
      expect(ctx.forceComplete).toHaveBeenCalledWith(failure.message);
      expect(observers.onUsageBoundary).toHaveBeenCalledTimes(1);
      if (failurePhase === "boundary") {
        expect(childProvider).not.toHaveBeenCalled();
        expect(observers.onUsageSettlement).not.toHaveBeenCalled();
        expect(timeline.map(({ phase }) => phase)).toEqual(["boundary"]);
      } else {
        expect(childProvider).toHaveBeenCalledTimes(1);
        expect(observers.onUsageSettlement).toHaveBeenCalledTimes(1);
        expect(observers.onUsageSettlement.mock.calls[0][0].callId).toBe(
          ctx._usageCallId,
        );
        expect(timeline.map(({ phase }) => phase)).toEqual([
          "boundary",
          "provider",
          "settlement",
        ]);
      }
    },
  );

  it("delivers a FAILED background run with its error instead of losing it", async () => {
    let call = 0;
    const chatFn = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [
              spawnCall({ role: "t", task: "bg", background: true }),
            ],
          },
        };
      }
      if (call === 2) {
        _subState.created[0]._rejectRun(new Error("429 rate limited"));
        return { message: { content: "premature" } };
      }
      return { message: { content: "final" } };
    });

    const { events, messages } = await drive(chatFn);

    const bg = events.find((e) => e.type === "background-sub-agent-result");
    expect(bg.error).toBe("429 rate limited");
    expect(_subState.created[0].forceComplete).toHaveBeenCalled();
    const injected = messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("FAILED"),
    );
    expect(injected).toBeDefined();
  });

  it("blocking mode (no background flag) is unchanged: awaits and returns the summary", async () => {
    _subState.autoResolve = (ctx) => ctx._resolveRun(RESULT);
    let call = 0;
    const chatFn = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          message: {
            content: "",
            tool_calls: [spawnCall({ role: "t", task: "sync task" })],
          },
        };
      }
      return { message: { content: "final" } };
    });

    const { events } = await drive(chatFn);

    const toolResult = events.find((e) => e.type === "tool-result");
    expect(toolResult.result.summary).toBe(RESULT.summary);
    expect(toolResult.result.background).toBeUndefined();
    expect(events.some((e) => e.type === "background-sub-agent-result")).toBe(
      false,
    );
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("an agent-file's `background: true` contract spawns detached WITHOUT a background arg", async () => {
    // The agent definition declares background; the caller passes only { agent }.
    const dir = mkdtempSync(join(tmpdir(), "cc-bg-agent-"));
    try {
      mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
      writeFileSync(
        join(dir, ".claude", "agents", "bg-worker.md"),
        "---\nname: bg-worker\nbackground: true\n---\nYou run in the background.\n",
        "utf-8",
      );

      let call = 0;
      const chatFn = vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            message: {
              content: "",
              // NOTE: no `background: true` here — it comes from the agent file.
              tool_calls: [spawnCall({ agent: "bg-worker", task: "bg" })],
            },
          };
        }
        if (call === 2) {
          _subState.created[0]._resolveRun(RESULT);
          return { message: { content: "premature" } };
        }
        return { message: { content: "final" } };
      });

      const { events } = await drive(chatFn, { cwd: dir });

      // Took the background path purely from the contract.
      const toolResult = events.find((e) => e.type === "tool-result");
      expect(toolResult.result.background).toBe(true);
      expect(toolResult.result.status).toBe("running");
      expect(
        events.some((e) => e.type === "waiting-background-sub-agents"),
      ).toBe(true);
      const bg = events.find((e) => e.type === "background-sub-agent-result");
      expect(bg.summary).toBe(RESULT.summary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
