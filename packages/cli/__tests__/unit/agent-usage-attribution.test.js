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
  const create = vi.fn((opts) => {
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
        // Simulate the child loop reporting REAL usage mid-run (the real
        // SubAgentContext forwards its loop's token-usage events this way).
        if (typeof opts.onUsage === "function" && ctx._emitUsage) {
          for (const u of ctx._emitUsage) opts.onUsage(u);
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
  });
  return { SubAgentContext: { create }, _subState: state };
});

import { agentLoop } from "../../src/runtime/agent-core.js";
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
      const ctx = SubAgentContext.create.getMockImplementation()(opts);
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
      const ctx = SubAgentContext.create.getMockImplementation()(opts);
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

  it("drains background sub-agent usage before the run ends", async () => {
    SubAgentContext.create.mockImplementationOnce((opts) => {
      const ctx = SubAgentContext.create.getMockImplementation()(opts);
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
