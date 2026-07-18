import { describe, it, expect, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { TURN_BINDING_EVENT } from "../../src/lib/turn-binding-store.js";
import { TurnBindingLog, TURN_COVERAGE } from "../../src/lib/turn-binding.js";

/**
 * P1 explicit turn→checkpoint binding — real-time feed off the agent-loop
 * event stream + per-turn persistence as `turn_checkpoint_binding` session
 * events (latest snapshot wins on load, mirroring goal_snapshot /
 * side_effect_ledger).
 */

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

/** Deps harness capturing appendEvent, with seedable readEvents. */
function makeDeps(seeded = {}) {
  const appended = [];
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => fakeGate(),
    writeOut: () => {},
    writeErr: () => {},
    now: (() => {
      let t = 1000;
      return () => (t += 5);
    })(),
    chatFn: vi.fn(async () => ({
      message: { role: "assistant", content: "ok" },
      usage: { input_tokens: 1, output_tokens: 1 },
    })),
    sessionExists: (id) => Object.prototype.hasOwnProperty.call(seeded, id),
    rebuildMessages: () => [],
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendEvent: (id, type, data) => appended.push({ id, type, data }),
    readEvents: (id) => seeded[id] || [],
    getLastSessionId: () => null,
  };
  return { deps, appended };
}

/** A fake agentLoop yielding the given events, then completing. */
function loopWith(events) {
  return async function* () {
    for (const e of events) yield e;
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  };
}

const bindingSnapshots = (appended) =>
  appended.filter((e) => e.type === TURN_BINDING_EVENT);

describe("headless-runner — turn→checkpoint binding feed + persistence", () => {
  it("feeds checkpoint / tool calls / policy decisions / child agents into one persisted turn", async () => {
    const { deps, appended } = makeDeps();
    deps.agentLoop = loopWith([
      { type: "checkpoint", id: "cp-1", tool: "write_file" },
      { type: "tool-executing", tool: "write_file", args: { path: "a.txt" } },
      { type: "tool-result", tool: "write_file", result: { ok: true } },
      { type: "tool-executing", tool: "run_shell", args: { command: "ls" } },
      {
        type: "tool-result",
        tool: "run_shell",
        error: "denied",
        result: {
          error: "denied",
          policy: { decision: "deny", via: "settings" },
        },
      },
      { type: "background-sub-agent-result", subAgentId: "sub-9" },
    ]);

    await runAgentHeadless({ prompt: "task", resume: "sess-T" }, deps);

    const snaps = bindingSnapshots(appended);
    expect(snaps.length).toBeGreaterThan(0);
    const last = snaps.at(-1).data;
    expect(last.turns).toHaveLength(1);
    const turn = last.turns[0];
    expect(turn.conversationOffset).toBeGreaterThanOrEqual(1);
    expect(turn.fileCheckpointId).toBe("cp-1");
    expect(turn.toolCallIds).toHaveLength(2);
    expect(turn.permissionDecisionIds).toHaveLength(1);
    expect(turn.permissionDecisionIds[0]).toMatch(/:perm:settings$/);
    // the decision id hangs off the run_shell call (2nd synthesized id)
    expect(turn.permissionDecisionIds[0].startsWith(turn.toolCallIds[1])).toBe(
      true,
    );
    expect(turn.childAgentIds).toEqual(["sub-9"]);
    // snapshot round-trips through the real log with honest coverage:
    // a shell ran → external side effects → PARTIAL, never over-promised
    const log = TurnBindingLog.fromJSON(last);
    expect(log.list()[0].coverage).toBe(TURN_COVERAGE.PARTIAL);
  });

  it("reports the foreground spawn_sub_agent child id from the tool result", async () => {
    const { deps, appended } = makeDeps();
    deps.agentLoop = loopWith([
      { type: "tool-executing", tool: "spawn_sub_agent", args: { task: "x" } },
      {
        type: "tool-result",
        tool: "spawn_sub_agent",
        result: { subAgentId: "sub-fg-1", summary: "did it" },
      },
    ]);

    await runAgentHeadless({ prompt: "task", resume: "sess-T" }, deps);

    const last = bindingSnapshots(appended).at(-1).data;
    expect(last.turns[0].childAgentIds).toEqual(["sub-fg-1"]);
  });

  it("a tool-free persisted turn writes no binding event (dirty-gated)", async () => {
    const { deps, appended } = makeDeps();
    deps.agentLoop = loopWith([]);

    await runAgentHeadless({ prompt: "hi", resume: "sess-T" }, deps);

    expect(bindingSnapshots(appended)).toHaveLength(0);
  });

  it("a non-persisted one-shot run writes nothing even with tools", async () => {
    const { deps, appended } = makeDeps();
    deps.agentLoop = loopWith([
      { type: "checkpoint", id: "cp-1", tool: "write_file" },
      { type: "tool-executing", tool: "write_file", args: { path: "a.txt" } },
      { type: "tool-result", tool: "write_file", result: { ok: true } },
    ]);

    await runAgentHeadless({ prompt: "one shot" }, deps);

    expect(appended).toHaveLength(0);
  });

  it("resume rehydrates the prior table and appends the new turn to it", async () => {
    const prior = new TurnBindingLog();
    prior.startTurn("old:t0", { conversationOffset: 0 });
    prior.recordToolCall("old:t0", "old:c0", { name: "write_file" });
    const seeded = {
      "sess-T": [{ type: TURN_BINDING_EVENT, data: prior.toJSON() }],
    };
    const { deps, appended } = makeDeps(seeded);
    deps.agentLoop = loopWith([
      { type: "tool-executing", tool: "read_file", args: { path: "a.txt" } },
      { type: "tool-result", tool: "read_file", result: { content: "x" } },
    ]);

    await runAgentHeadless({ prompt: "next", resume: "sess-T" }, deps);

    const last = bindingSnapshots(appended).at(-1).data;
    expect(last.turns).toHaveLength(2);
    expect(last.turns[0].turnId).toBe("old:t0");
    expect(last.turns[0].toolCallIds).toEqual(["old:c0"]);
    expect(last.turns[1].toolCallIds).toHaveLength(1);
  });
});
