import { describe, expect, it } from "vitest";
import {
  compileGraphDefinition,
  executionAttemptId,
} from "../../src/lib/graph-kernel/compiler.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";
import { reduceGraphTrace } from "../../src/lib/graph-kernel/trace-reducer.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const CONDITION_EVIDENCE = `sha256:${"c".repeat(64)}`;

function node(id, overrides = {}) {
  return {
    id,
    kind: "task",
    dependsOn: [],
    inputs: [],
    outputs: [],
    effectClass: "none",
    ...overrides,
  };
}

function definition(id, nodes, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    nodes,
    edges: overrides.edges || [],
    loops: overrides.loops || [],
    subgraphCalls: overrides.subgraphCalls || [],
    budget: overrides.budget || { turns: 100, tokens: 100_000 },
    allowedCapabilities: [],
    metadata: {},
  };
}

function createContext(eventStore = null) {
  let generatedId = 0;
  const now = () => 1_700_000_000_000;
  const store =
    eventStore ||
    new GraphEventStore({ rolloutStore: new MemoryRolloutStore({ now }) });
  return {
    eventStore: store,
    kernel: new GraphKernel({
      eventStore: store,
      now,
      createId: () => `generated-${++generatedId}`,
    }),
  };
}

function succeed(kernel, runId, attempt) {
  return kernel.settleAttempt(runId, {
    attemptId: attempt.id,
    leaseId: attempt.leaseId,
    fence: attempt.fence,
    outcome: "succeeded",
    evidence: { outputDigest: DIGEST },
  });
}

function executeNode(kernel, runId, nodeId) {
  const attempt = kernel.assignNode(runId, nodeId, "agent-1");
  succeed(kernel, runId, attempt);
  return attempt;
}

function loopGraph(maxIterations = 3) {
  return compileGraphDefinition(
    definition(
      "structured-loop",
      [
        node("inspect"),
        node("judge", { dependsOn: ["inspect"] }),
        node("publish", { dependsOn: ["judge"] }),
      ],
      {
        loops: [
          {
            id: "quality-loop",
            entryNodeId: "inspect",
            exitNodeId: "judge",
            nodeIds: ["inspect", "judge"],
            maxIterations,
            condition: "quality gate passed",
          },
        ],
      },
    ),
  );
}

describe("Graph Kernel structured control flow", () => {
  it("expands loop attempts by deterministic iteration path and gates successors", () => {
    const { kernel } = createContext();
    kernel.startRun(loopGraph(), { runId: "run-loop" });
    kernel.sealRun("run-loop");

    const firstInspect = executeNode(kernel, "run-loop", "inspect");
    expect(firstInspect).toMatchObject({
      id: executionAttemptId("inspect", [0], 1),
      iterationPath: [0],
      attempt: 1,
    });
    executeNode(kernel, "run-loop", "judge");
    expect(kernel.getRun("run-loop")).toMatchObject({
      status: "waiting_external",
      loops: [
        expect.objectContaining({
          regionId: "quality-loop",
          status: "waiting_condition",
          iterationPath: [0],
        }),
      ],
    });
    expect(kernel.readyNodes("run-loop")).toEqual([]);

    kernel.advanceLoop("run-loop", {
      regionId: "quality-loop",
      continueLoop: true,
      conditionEvidenceDigest: CONDITION_EVIDENCE,
      requestId: "loop-decision-0",
    });
    const secondInspect = executeNode(kernel, "run-loop", "inspect");
    expect(secondInspect).toMatchObject({
      id: executionAttemptId("inspect", [1], 1),
      iterationPath: [1],
      attempt: 1,
    });
    expect(secondInspect.id).not.toBe(firstInspect.id);
    executeNode(kernel, "run-loop", "judge");
    const exited = kernel.advanceLoop("run-loop", {
      regionId: "quality-loop",
      continueLoop: false,
      conditionEvidenceDigest: CONDITION_EVIDENCE,
      requestId: "loop-decision-1",
    });
    expect(exited.iterationFrames).toEqual([
      expect.objectContaining({ iterationPath: [0], status: "succeeded" }),
      expect.objectContaining({ iterationPath: [1], status: "succeeded" }),
    ]);
    expect(kernel.readyNodes("run-loop").map((entry) => entry.nodeId)).toEqual([
      "publish",
    ]);
    executeNode(kernel, "run-loop", "publish");
    expect(kernel.getRun("run-loop").status).toBe("succeeded");
    expect(reduceGraphTrace(kernel.events("run-loop"))).toMatchObject({
      iterationGraph: {
        loops: [expect.objectContaining({ status: "succeeded" })],
        frames: [
          expect.objectContaining({ iterationPath: [0] }),
          expect.objectContaining({ iterationPath: [1] }),
        ],
        attempts: expect.arrayContaining([
          expect.objectContaining({ nodeId: "inspect", iterationPath: [1] }),
        ]),
      },
    });
  });

  it("recovers a loop decision point and fails closed when the cap is exhausted", () => {
    const context = createContext();
    context.kernel.startRun(loopGraph(2), { runId: "run-loop-cap" });
    context.kernel.sealRun("run-loop-cap");
    executeNode(context.kernel, "run-loop-cap", "inspect");
    executeNode(context.kernel, "run-loop-cap", "judge");

    const recovered = createContext(context.eventStore).kernel;
    expect(recovered.recoverRun("run-loop-cap").status).toBe(
      "waiting_external",
    );
    recovered.advanceLoop("run-loop-cap", {
      regionId: "quality-loop",
      continueLoop: true,
      conditionEvidenceDigest: CONDITION_EVIDENCE,
      requestId: "cap-decision-0",
    });
    executeNode(recovered, "run-loop-cap", "inspect");
    executeNode(recovered, "run-loop-cap", "judge");
    recovered.advanceLoop("run-loop-cap", {
      regionId: "quality-loop",
      continueLoop: true,
      conditionEvidenceDigest: CONDITION_EVIDENCE,
      requestId: "cap-decision-1",
    });
    const terminal = recovered.getRun("run-loop-cap");
    expect(terminal).toMatchObject({
      status: "budget_exhausted",
      loops: [
        expect.objectContaining({
          regionId: "quality-loop",
          status: "exhausted",
        }),
      ],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          nodeId: "judge",
          status: "budget_exhausted",
          blockedRoot: "quality-loop",
        }),
        expect.objectContaining({
          nodeId: "publish",
          status: "upstream_failed",
        }),
      ]),
    });
    expect(terminal.iterationFrames.at(-1).status).toBe("exhausted");

    const recoveredTerminal = createContext(context.eventStore).kernel;
    expect(recoveredTerminal.recoverRun("run-loop-cap")).toEqual(terminal);
  });

  it("does not unlock a loop exit when another region branch fails", () => {
    const compiled = compileGraphDefinition(
      definition(
        "loop-branch-failure",
        [
          node("entry"),
          node("side", { dependsOn: ["entry"] }),
          node("exit", { dependsOn: ["entry", "side"], join: "any" }),
          node("after", { dependsOn: ["exit"] }),
        ],
        {
          loops: [
            {
              id: "branch-loop",
              entryNodeId: "entry",
              exitNodeId: "exit",
              nodeIds: ["entry", "side", "exit"],
              maxIterations: 2,
            },
          ],
        },
      ),
    );
    const { kernel } = createContext();
    kernel.startRun(compiled, { runId: "run-loop-branch-failure" });
    kernel.sealRun("run-loop-branch-failure");
    executeNode(kernel, "run-loop-branch-failure", "entry");
    executeNode(kernel, "run-loop-branch-failure", "exit");
    expect(
      kernel.readyNodes("run-loop-branch-failure").map((entry) => entry.nodeId),
    ).toEqual(["side"]);
    const failed = kernel.assignNode(
      "run-loop-branch-failure",
      "side",
      "agent-1",
    );
    kernel.settleAttempt("run-loop-branch-failure", {
      attemptId: failed.id,
      leaseId: failed.leaseId,
      fence: failed.fence,
      outcome: "failed",
      error: "branch failed",
    });
    expect(kernel.getRun("run-loop-branch-failure")).toMatchObject({
      status: "partial",
      loops: [expect.objectContaining({ status: "failed" })],
      nodes: expect.arrayContaining([
        expect.objectContaining({ nodeId: "after", status: "upstream_failed" }),
      ]),
    });
    expect(kernel.readyNodes("run-loop-branch-failure")).toEqual([]);
  });

  it("runs digest-pinned subgraphs as recoverable bounded child runs", () => {
    const child = compileGraphDefinition(
      definition("child-graph", [node("child-task")]),
    );
    const parent = compileGraphDefinition(
      definition(
        "parent-graph",
        [
          node("call-child", { kind: "subgraph" }),
          node("after-child", { dependsOn: ["call-child"] }),
        ],
        {
          subgraphCalls: [
            {
              nodeId: "call-child",
              definitionId: child.definitionId,
              revisionDigest: child.revisionDigest,
              maxDepth: 2,
            },
          ],
        },
      ),
    );
    const context = createContext();
    context.kernel.startRun(parent, { runId: "run-parent" });
    context.kernel.sealRun("run-parent");
    expect(context.kernel.readyNodes("run-parent")).toEqual([
      expect.objectContaining({
        nodeId: "call-child",
        dispatch: "subgraph",
        revisionDigest: child.revisionDigest,
      }),
    ]);
    expect(() =>
      context.kernel.assignNode("run-parent", "call-child", "agent-1"),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_SUBGRAPH_DISPATCH_REQUIRED" }),
    );

    const started = context.kernel.startSubgraph(
      "run-parent",
      "call-child",
      child,
    );
    expect(started).toMatchObject({
      relation: { status: "running", depth: 1 },
      parentRun: { status: "waiting_external" },
      childRun: { phase: "sealed", status: "running" },
    });

    const recovered = createContext(context.eventStore).kernel;
    expect(recovered.recoverRun("run-parent")).toMatchObject({
      subgraphRuns: [expect.objectContaining({ status: "running" })],
    });
    const replay = recovered.startSubgraph("run-parent", "call-child", child);
    expect(replay.relation.childRunId).toBe(started.relation.childRunId);
    executeNode(recovered, replay.relation.childRunId, "child-task");
    expect(recovered.getRun(replay.relation.childRunId).status).toBe(
      "succeeded",
    );
    recovered.settleSubgraph("run-parent", "call-child");
    expect(
      recovered.readyNodes("run-parent").map((entry) => entry.nodeId),
    ).toEqual(["after-child"]);
    executeNode(recovered, "run-parent", "after-child");
    expect(recovered.getRun("run-parent")).toMatchObject({
      status: "succeeded",
      subgraphRuns: [
        expect.objectContaining({
          nodeId: "call-child",
          status: "succeeded",
          childStatus: "succeeded",
        }),
      ],
    });
    expect(reduceGraphTrace(recovered.events("run-parent"))).toMatchObject({
      subgraphGraph: {
        runs: [expect.objectContaining({ childStatus: "succeeded" })],
        edges: [
          expect.objectContaining({
            from: "call-child",
            kind: "subgraph_call",
            status: "succeeded",
          }),
        ],
      },
    });
  });

  it("rejects subgraph depth overflow and runtime recursion before child effects", () => {
    const leaf = compileGraphDefinition(
      definition("leaf-graph", [node("leaf-task")]),
    );
    const caller = compileGraphDefinition(
      definition("caller-graph", [node("call-leaf", { kind: "subgraph" })], {
        subgraphCalls: [
          {
            nodeId: "call-leaf",
            definitionId: leaf.definitionId,
            revisionDigest: leaf.revisionDigest,
            maxDepth: 1,
          },
        ],
      }),
    );

    const depthContext = createContext();
    depthContext.kernel.startRun(caller, {
      runId: "run-depth",
      subgraphDepth: 1,
      definitionPath: ["root-graph", caller.definitionId],
    });
    depthContext.kernel.sealRun("run-depth");
    expect(() =>
      depthContext.kernel.startSubgraph("run-depth", "call-leaf", leaf),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_SUBGRAPH_DEPTH_EXCEEDED" }),
    );
    expect(depthContext.eventStore.listRuns()).toHaveLength(1);

    const recursionContext = createContext();
    recursionContext.kernel.startRun(caller, {
      runId: "run-recursion",
      definitionPath: [leaf.definitionId, caller.definitionId],
    });
    recursionContext.kernel.sealRun("run-recursion");
    expect(() =>
      recursionContext.kernel.startSubgraph("run-recursion", "call-leaf", leaf),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_SUBGRAPH_RECURSION" }),
    );
    expect(recursionContext.eventStore.listRuns()).toHaveLength(1);
  });

  it("cascades parent cancellation into an active child run", async () => {
    const child = compileGraphDefinition(
      definition("cancel-child", [node("child-task")]),
    );
    const parent = compileGraphDefinition(
      definition("cancel-parent", [node("call-child", { kind: "subgraph" })], {
        subgraphCalls: [
          {
            nodeId: "call-child",
            definitionId: child.definitionId,
            revisionDigest: child.revisionDigest,
            maxDepth: 2,
          },
        ],
      }),
    );
    const { kernel } = createContext();
    kernel.startRun(parent, { runId: "run-cancel-parent" });
    kernel.sealRun("run-cancel-parent");
    const started = kernel.startSubgraph(
      "run-cancel-parent",
      "call-child",
      child,
    );

    const cancelled = await kernel.cancelRun("run-cancel-parent");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      nodes: [expect.objectContaining({ status: "cancelled" })],
      subgraphRuns: [expect.objectContaining({ status: "cancelled" })],
    });
    expect(kernel.getRun(started.relation.childRunId).status).toBe("cancelled");
  });
});
