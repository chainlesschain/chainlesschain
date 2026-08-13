import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
  resolveHeadlessMeteredSessionId,
  runAgentHeadless,
} from "../../src/runtime/headless-runner.js";

function markedPersistenceError() {
  return Object.assign(new Error("private disk path and provider data"), {
    runtimeLedgerPersistence: true,
  });
}

function makeDeps() {
  const out = [];
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => ({
      setSessionPolicy: () => {},
      setConfirmer: () => {},
      decide: async () => ({ decision: "allow" }),
    }),
    writeOut: (text) => out.push(String(text)),
    writeErr: () => {},
    agentLoop: vi.fn(async function* () {
      yield { type: "response-complete", content: "main result" };
      yield { type: "run-ended", reason: "complete" };
    }),
  };
  return { deps, out };
}

function outputEvents(out) {
  return out
    .join("")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("headless direct-model ledger fail-closed", () => {
  it("does not enable direct-call metering for ephemeral sessions", () => {
    expect(resolveHeadlessMeteredSessionId(false, "ephemeral-id")).toBeNull();
    expect(resolveHeadlessMeteredSessionId(true, "durable-id")).toBe(
      "durable-id",
    );
    expect(resolveHeadlessMeteredSessionId(true, null)).toBeNull();
  });

  it("terminates a model goal-condition when ledger persistence fails", async () => {
    const { deps, out } = makeDeps();
    deps.goalConditionJudge = vi.fn(async () => {
      throw markedPersistenceError();
    });

    const result = await runAgentHeadless(
      {
        prompt: "finish",
        outputFormat: "stream-json",
        goalCondition: "model:work is complete",
      },
      deps,
    );

    expect(deps.agentLoop).toHaveBeenCalledOnce();
    expect(result).toEqual({
      exitCode: 1,
      result: RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
      isError: true,
    });
    const terminal = outputEvents(out).at(-1);
    expect(terminal).toMatchObject({
      type: "result",
      subtype: "error_persistence",
      is_error: true,
      error: RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
    });
    expect(JSON.stringify(terminal)).not.toContain("private disk path");
  });

  it("turns --goal-assess ledger failure into a safe final result", async () => {
    const { deps, out } = makeDeps();
    const goal = {
      id: "goal-1",
      objective: "ship",
      status: "active",
      progress: 0,
      keyResults: [],
    };
    deps.resolveActiveGoal = () => goal;
    deps.getGoal = () => goal;
    deps.assessGoalProgress = vi.fn(async () => {
      throw markedPersistenceError();
    });

    const result = await runAgentHeadless(
      {
        prompt: "finish",
        outputFormat: "stream-json",
        goal: "goal-1",
        goalAssess: true,
      },
      deps,
    );

    expect(result).toEqual({
      exitCode: 1,
      result: RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
      isError: true,
    });
    const terminal = outputEvents(out).at(-1);
    expect(terminal).toMatchObject({
      type: "result",
      subtype: "error_persistence",
      is_error: true,
      result: RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
    });
    expect(JSON.stringify(terminal)).not.toContain("private disk path");
  });
});
