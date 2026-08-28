import { describe, expect, it } from "vitest";

import {
  MAX_DEBUG_NODES,
  budgetProjection,
  buildReplayFrames,
  createGraphDebuggerProjection,
  diffGraphs,
  topologicalProjection,
} from "../../../src/renderer/components/graph/graphRunDebuggerUtils.js";

function node(id, dependsOn, durationMs, status = "completed", metadata = {}) {
  return {
    id,
    title: id.toUpperCase(),
    dependsOn,
    status,
    metadata: { durationMs, ...metadata },
  };
}

describe("graphRunDebuggerUtils", () => {
  it("projects a DAG with a forward critical path and CPM slack", () => {
    const topology = topologicalProjection({
      graphId: "graph-1",
      order: ["a", "b", "c", "d"],
      nodes: {
        a: node("a", [], 10),
        b: node("b", ["a"], 20),
        c: node("c", ["a"], 5),
        d: node("d", ["b", "c"], 10),
      },
    });

    const projected = new Map(topology.nodes.map((item) => [item.id, item]));
    expect(topology.projectDurationMs).toBe(40);
    expect(
      topology.nodes.filter((item) => item.critical).map((item) => item.id),
    ).toEqual(["a", "b", "d"]);
    expect(projected.get("c").slackMs).toBe(15);
    expect(topology.edges.find((edge) => edge.id === "a->b").critical).toBe(
      true,
    );
    expect(topology.edges.find((edge) => edge.id === "a->c").critical).toBe(
      false,
    );
  });

  it("marks cycles without hanging and bounds renderer node retention", () => {
    const nodes = Object.fromEntries(
      Array.from({ length: MAX_DEBUG_NODES + 5 }, (_, index) => {
        const id = `node-${index}`;
        return [id, node(id, [], 1)];
      }),
    );
    nodes["node-0"].dependsOn = ["node-1"];
    nodes["node-1"].dependsOn = ["node-0"];

    const topology = topologicalProjection({ nodes });
    expect(topology.nodes).toHaveLength(MAX_DEBUG_NODES);
    expect(topology.truncatedNodes).toBe(5);
    expect(topology.cyclicNodeIds).toEqual(
      expect.arrayContaining(["node-0", "node-1"]),
    );
  });

  it("builds a budget heatmap from node metadata", () => {
    const budget = budgetProjection([
      node("low", [], 1, "running", {
        budget: { used: 20, limit: 100 },
      }),
      node("high", [], 1, "running", {
        tokensUsed: 90,
        tokenBudget: 100,
      }),
      node("unknown", [], 1),
    ]);

    expect(budget.items.map((item) => item.heat)).toEqual([
      "low",
      "high",
      "unknown",
    ]);
    expect(budget.knownCount).toBe(2);
    expect(budget.ratio).toBeCloseTo(0.55);
  });

  it("replays durable graph snapshots, diffs revisions and strips event bodies", () => {
    const first = {
      graphId: "graph-1",
      status: "active",
      nodes: { a: node("a", [], 1, "running") },
    };
    const second = {
      graphId: "graph-1",
      status: "completed",
      nodes: {
        a: node("a", [], 1, "completed"),
        b: node("b", ["a"], 1, "completed"),
      },
    };
    const events = [
      {
        id: "event-1",
        type: "task-graph.created",
        timestamp: 10,
        payload: { graph: first, content: "SECRET-MESSAGE-BODY" },
      },
      {
        id: "event-2",
        type: "approval.requested",
        timestamp: 20,
        payload: {
          graph: second,
          nodeId: "a",
          causationId: "event-1",
          content: "ANOTHER-SECRET",
        },
      },
    ];

    const frames = buildReplayFrames(second, events);
    expect(frames).toHaveLength(2);
    expect(diffGraphs(first, second)).toEqual({
      added: ["b"],
      removed: [],
      statusChanged: [{ nodeId: "a", from: "running", to: "completed" }],
    });

    const projection = createGraphDebuggerProjection(second, events);
    expect(projection.causalLinks).toEqual([
      { from: "event-1", to: "event-2", nodeId: "a" },
    ]);
    expect(JSON.stringify(projection.timeline)).not.toContain("SECRET");
    expect(projection.timeline[1]).toMatchObject({
      type: "approval.requested",
      category: "approval",
      nodeId: "a",
    });
  });

  it("projects canonical trace topology, custody, lineage and run budgets", () => {
    const canonical = {
      schema: "chainlesschain.graph-trace-projection/v1",
      runId: "canonical-run",
      budget: { tokens: 200, turns: 4 },
      budgetUsed: { tokens: 80, turns: 2 },
      criticalPath: { nodeIds: ["prepare", "ship"], durationMs: 40 },
      taskGraph: {
        nodes: [
          { id: "prepare", status: "succeeded" },
          { id: "ship", status: "running", blockedRoot: "prepare" },
        ],
        edges: [{ id: "prepare:ship", from: "prepare", to: "ship" }],
      },
      attempts: [
        {
          id: "attempt-1",
          nodeId: "prepare",
          agentId: "agent-1",
          status: "accepted",
          leaseId: "lease-1",
          fence: 3,
          createdAt: "2026-08-28T10:00:00.000Z",
          updatedAt: "2026-08-28T10:00:00.040Z",
          usage: { tokens: 80 },
          terminalEvidence: {
            commit: "abc123",
            outputDigest: `sha256:${"a".repeat(64)}`,
          },
        },
      ],
      agentTree: [
        {
          id: "agent-1",
          status: "idle",
          resident: true,
          capacity: 1,
          assignments: ["attempt-1"],
        },
      ],
      artifactGraph: {
        artifacts: [
          {
            id: "artifact-1",
            producerNodeId: "prepare",
            digest: `sha256:${"b".repeat(64)}`,
            body: "SECRET-ARTIFACT-BODY",
          },
        ],
      },
      messageGraph: {
        messages: [
          {
            id: "message-1",
            fromAttemptId: "attempt-1",
            status: "processed",
            payload: "SECRET-MESSAGE-BODY",
          },
        ],
      },
      effects: [
        {
          id: "effect-1",
          nodeId: "prepare",
          attemptId: "attempt-1",
          status: "committed",
          receipt: "SECRET-RECEIPT-BODY",
        },
      ],
      timeline: [
        {
          seq: 1,
          timestamp: "2026-08-28T10:00:00.000Z",
          type: "assignment.settled",
          details: { nodeId: "prepare", content: "SECRET-TIMELINE-BODY" },
        },
      ],
    };

    const projection = createGraphDebuggerProjection(canonical);

    expect(projection.topology.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "prepare",
          to: "ship",
          critical: true,
        }),
      ]),
    );
    expect(projection.topology.blockedRootIds).toContain("ship");
    expect(projection.budget.dimensions).toEqual(
      expect.arrayContaining([
        { field: "tokens", used: 80, limit: 200 },
        { field: "turns", used: 2, limit: 4 },
      ]),
    );
    expect(projection.evidence).toMatchObject({
      agents: [expect.objectContaining({ id: "agent-1" })],
      attempts: [
        expect.objectContaining({
          id: "attempt-1",
          leaseId: "lease-1",
          commit: "abc123",
        }),
      ],
      artifacts: [expect.objectContaining({ id: "artifact-1" })],
      effects: [expect.objectContaining({ id: "effect-1" })],
    });
    expect(JSON.stringify(projection)).not.toContain("SECRET");
    expect(projection.timeline.map((event) => event.category)).toEqual(
      expect.arrayContaining(["message", "artifact", "effect", "lease"]),
    );
  });
});
