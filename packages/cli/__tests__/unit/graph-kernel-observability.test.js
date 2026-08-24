import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { compileGraphDefinition } from "../../src/lib/graph-kernel/compiler.js";
import {
  enforceGraphEvalThresholds,
  evaluateGraphProjection,
  runGraphEvalSuite,
  scheduleEquivalence,
} from "../../src/lib/graph-kernel/eval.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";
import {
  diffGraphTrace,
  locateBlockedRoot,
  reduceGraphTrace,
  timeTravelGraphTrace,
} from "../../src/lib/graph-kernel/trace-reducer.js";
import {
  SchedulerGraphDispatchJournal,
  SchedulerGraphTriggerAdapter,
} from "../../src/lib/graph-kernel/trigger-adapter.js";

const OUTPUT_DIGEST = `sha256:${"a".repeat(64)}`;

function node(id, dependsOn = []) {
  return {
    id,
    kind: "task",
    dependsOn,
    inputs: [],
    outputs: [],
    effectClass: "none",
  };
}

function graph(id = "observable") {
  return compileGraphDefinition({
    schemaVersion: 1,
    id,
    revision: 1,
    nodes: [node("first"), node("second", ["first"])],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 10, tokens: 1_000 },
    allowedCapabilities: [],
    metadata: {},
  });
}

function context() {
  let nowMs = 1_700_000_000_000;
  let serial = 0;
  const rolloutStore = new MemoryRolloutStore({ now: () => nowMs });
  const eventStore = new GraphEventStore({ rolloutStore });
  const kernel = new GraphKernel({
    eventStore,
    now: () => nowMs,
    createId: () => `generated-${++serial}`,
  });
  return {
    kernel,
    eventStore,
    rolloutStore,
    advance(ms) {
      nowMs += ms;
    },
  };
}

function complete(contextValue, runId) {
  const { kernel, advance } = contextValue;
  kernel.startRun(graph(), { runId });
  kernel.sealRun(runId);
  for (const nodeId of ["first", "second"]) {
    const attempt = kernel.assignNode(runId, nodeId, "agent-1", {
      attemptId: `${runId}-${nodeId}-attempt`,
      leaseId: `${runId}-${nodeId}-lease`,
    });
    advance(25);
    kernel.settleAttempt(runId, {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "succeeded",
      evidence: { outputDigest: OUTPUT_DIGEST },
      usage: { turns: 1, tokens: 10 },
    });
  }
  return reduceGraphTrace(kernel.events(runId));
}

describe("Graph trace, eval, and trigger contracts", () => {
  it("reduces durable events into deterministic topology and time-travel views", () => {
    const value = context();
    const projection = complete(value, "run-observable");
    const replay = reduceGraphTrace(value.kernel.events("run-observable"));

    expect(replay.projectionDigest).toBe(projection.projectionDigest);
    expect(projection).toMatchObject({
      status: "succeeded",
      criticalPath: { nodeIds: ["first", "second"], durationMs: 50 },
    });
    expect(projection.agentTree[0].assignments).toHaveLength(2);
    expect(projection.taskGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "first", to: "second" }),
      ]),
    );

    const settledFirst = value.kernel
      .events("run-observable")
      .find((event) => event.type === "assignment.settled");
    const earlier = timeTravelGraphTrace(
      value.kernel.events("run-observable"),
      settledFirst.seq,
    );
    const diff = diffGraphTrace(earlier, projection);
    expect(earlier.status).toBe("running");
    expect(diff.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "second" })]),
    );
  });

  it("locates blocked roots using only the durable projection", () => {
    const value = context();
    value.kernel.startRun(graph("failed"), { runId: "run-failed" });
    value.kernel.sealRun("run-failed");
    const attempt = value.kernel.assignNode("run-failed", "first", "agent-1", {
      attemptId: "failed-attempt",
      leaseId: "failed-lease",
    });
    value.kernel.settleAttempt("run-failed", {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "failed",
      error: "fixture failure",
      evidence: { outputDigest: OUTPUT_DIGEST },
    });

    const projection = reduceGraphTrace(value.kernel.events("run-failed"));
    expect(locateBlockedRoot(projection, "second")).toEqual({
      root: "first",
      chain: ["second", "first"],
    });
  });

  it("compares schedule-equivalent runs and enforces frozen eval thresholds", () => {
    const left = complete(context(), "run-left");
    const right = complete(context(), "run-right");
    const equivalence = scheduleEquivalence(left, right);
    const report = evaluateGraphProjection(left);

    expect(equivalence.equivalent).toBe(true);
    expect(report.metrics).toMatchObject({
      terminalSuccess: 1,
      duplicateAttempts: 0,
      messageVisibilityRate: 1,
    });
    expect(
      enforceGraphEvalThresholds(report, {
        terminalSuccess: { min: 1 },
        duplicateWorkRatio: { max: 0 },
        deadlocked: { max: 0 },
      }),
    ).toEqual({ passed: true, failures: [] });
    expect(
      enforceGraphEvalThresholds(report, {
        criticalPathUtilization: { min: 2 },
      }).passed,
    ).toBe(false);
  });

  it("idempotently maps a scheduler occurrence to one GraphRun", () => {
    const value = context();
    const journal = new SchedulerGraphDispatchJournal({
      store: value.rolloutStore,
    });
    const adapter = new SchedulerGraphTriggerAdapter({
      kernel: value.kernel,
      journal,
    });
    const occurrence = {
      jobRevision: "job-revision-1",
      occurrenceId: "occurrence-1",
      idempotencyKey: "occurrence-1",
    };

    const first = adapter.dispatch(occurrence, graph("scheduled"));
    const replay = adapter.dispatch(occurrence, graph("scheduled"));

    expect(first).toMatchObject({
      occurrenceStatus: "succeeded",
      dispatchStatus: "accepted",
      replayed: false,
      graphRun: { status: "running", phase: "open" },
    });
    expect(replay).toMatchObject({
      replayed: true,
      graphRun: { id: first.graphRun.id },
    });
    expect(value.eventStore.listRuns()).toHaveLength(1);
    expect(adapter.status(occurrence).graphRun.status).toBe("running");
  });

  it("generates a deterministic multi-seed release-gating Eval report", async () => {
    const projections = new Map();
    for (const mode of ["single_agent_control", "graph_candidate"]) {
      for (const seed of [1, 2]) {
        projections.set(
          `${mode}:${seed}`,
          complete(context(), `${mode}-${seed}`),
        );
      }
    }
    const input = {
      suiteId: "fixture-suite",
      commitSha: "a".repeat(40),
      cases: [
        { id: "recover-message", seeds: [2, 1], fault: "processed_before_ack" },
      ],
      thresholds: {
        successRate: { min: 1 },
        scheduleEquivalenceRate: { min: 1 },
        deadlockRate: { max: 0 },
      },
      execute: async ({ mode, seed }) => projections.get(`${mode}:${seed}`),
    };
    const first = await runGraphEvalSuite(input);
    const replay = await runGraphEvalSuite(input);
    expect(first).toMatchObject({
      commitSha: "a".repeat(40),
      metrics: { caseRuns: 2, successRate: 1, scheduleEquivalenceRate: 1 },
      gate: { passed: true },
    });
    expect(replay.reportDigest).toBe(first.reportDigest);
    expect(first.results.map((result) => result.seed)).toEqual([1, 2]);
  });

  it("recovers a dispatch that crashed after GraphRun commit but before journal ACK", () => {
    const value = context();
    const compiled = graph("scheduled-crash");
    const occurrence = {
      jobRevision: "job-revision-crash",
      occurrenceId: "occurrence-crash",
    };
    const journal = new SchedulerGraphDispatchJournal({
      store: value.rolloutStore,
    });
    const key = `${occurrence.jobRevision}\0${occurrence.occurrenceId}`;
    const runId = "run-before-ack-crash";
    journal.append(key, "pending", {
      runId,
      jobRevision: occurrence.jobRevision,
      occurrenceId: occurrence.occurrenceId,
      definitionDigest: compiled.revisionDigest,
    });
    value.kernel.startRun(compiled, { runId, occurrenceRef: occurrence });

    const recoveredKernel = new GraphKernel({
      eventStore: value.eventStore,
      now: () => 1_700_000_000_000,
    });
    const adapter = new SchedulerGraphTriggerAdapter({
      kernel: recoveredKernel,
      journal,
    });
    expect(adapter.dispatch(occurrence, compiled)).toMatchObject({
      replayed: true,
      recoveredAfterCrash: true,
      graphRun: { id: runId },
    });
    expect(value.eventStore.listRuns()).toHaveLength(1);
  });
});
