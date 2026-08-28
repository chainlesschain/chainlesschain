import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import GraphRunDebugger from "../../../src/renderer/components/graph/GraphRunDebugger.vue";

const firstGraph = {
  graphId: "debug-graph",
  title: "Debug graph",
  status: "active",
  order: ["prepare", "ship"],
  nodes: {
    prepare: {
      id: "prepare",
      title: "Prepare",
      status: "completed",
      dependsOn: [],
      metadata: { durationMs: 20, budget: { used: 10, limit: 100 } },
    },
    ship: {
      id: "ship",
      title: "Ship",
      status: "running",
      dependsOn: ["prepare"],
      metadata: { durationMs: 30, budget: { used: 85, limit: 100 } },
    },
  },
};

const currentGraph = {
  ...firstGraph,
  status: "completed",
  updatedAt: "2026-08-28T10:00:00.000Z",
  nodes: {
    ...firstGraph.nodes,
    ship: { ...firstGraph.nodes.ship, status: "completed" },
  },
  budget: { tokens: 1000 },
  budgetUsed: { tokens: 320 },
  attempts: [
    {
      id: "attempt-ship",
      nodeId: "ship",
      agentId: "agent-coder",
      status: "accepted",
      leaseId: "lease-ship",
      fence: 2,
      worktreeId: "worktree-ship",
      terminalEvidence: { commit: "abc123" },
    },
  ],
  agentTree: [
    {
      id: "agent-coder",
      status: "idle",
      resident: true,
      capacity: 1,
      assignments: ["attempt-ship"],
    },
  ],
  artifactGraph: {
    artifacts: [
      {
        id: "artifact-ship",
        producerNodeId: "ship",
        digest: "sha256:artifact-ref",
        content: "must-not-render-artifact",
      },
    ],
  },
};

const events = [
  {
    id: "event-1",
    type: "task-graph.created",
    timestamp: 1,
    payload: { graph: firstGraph, content: "must-not-render" },
  },
  {
    id: "event-2",
    type: "approval.requested",
    timestamp: 2,
    payload: {
      graph: currentGraph,
      nodeId: "ship",
      causationId: "event-1",
      content: "must-not-render-either",
    },
  },
];

describe("GraphRunDebugger", () => {
  it("renders topology, replay, budget and metadata-only causal drilldown", async () => {
    const wrapper = mount(GraphRunDebugger, {
      props: { graph: currentGraph, events },
    });

    expect(wrapper.get('[data-testid="graph-topology"]').exists()).toBe(true);
    expect(wrapper.findAll(".topology-node")).toHaveLength(2);
    expect(wrapper.get('[data-testid="graph-replay-toolbar"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain("must-not-render");

    await wrapper.get('[data-testid="graph-view-budget"]').trigger("click");
    expect(
      wrapper.get('[data-testid="graph-budget-heatmap"]').text(),
    ).toContain("85/100");
    expect(
      wrapper.get('[data-testid="graph-budget-heatmap"]').text(),
    ).toContain("tokens: 320/1000");

    await wrapper.get('[data-testid="graph-view-trace"]').trigger("click");
    await wrapper.get("#trace-node-select").setValue("ship");
    const trace = wrapper.get('[data-testid="graph-trace-overlay"]');
    expect(trace.text()).toContain("agent-coder");
    expect(trace.text()).toContain("lease-ship");
    expect(trace.text()).toContain("worktree-ship");
    expect(trace.text()).toContain("abc123");
    expect(trace.text()).toContain("artifact-ship");
    expect(trace.text()).not.toContain("must-not-render-artifact");

    await wrapper.get('[data-testid="graph-view-causality"]').trigger("click");
    await wrapper.get("#causal-node-select").setValue("ship");
    expect(wrapper.get('[data-testid="graph-causality"]').text()).toContain(
      "approval.requested",
    );
    expect(wrapper.text()).not.toContain("must-not-render-either");

    await wrapper.get('[data-testid="graph-replay-cursor"]').setValue("0");
    expect(wrapper.find('[data-testid="graph-revision-diff"]').exists()).toBe(
      false,
    );
  });
});
