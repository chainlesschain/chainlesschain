import { describe, expect, it, vi } from "vitest";

const {
  DesktopGraphExecutionAdapter,
  buildSpecializedAgentsGraph,
  buildWorkflowGraph,
  projectGraphNodes,
} = require("../desktop-graph-execution-adapter.js");

function projection(request, overrides = {}) {
  return {
    id: request.runId,
    status: request.authorityMode === "shadow" ? "running" : "succeeded",
    authorityMode: request.authorityMode,
    authoritySource:
      request.authorityMode === "shadow"
        ? "graph_kernel_shadow"
        : "graph_kernel",
    authorityGeneration: 1,
    writerId: "app-server-writer",
    eventHead: `sha256:${"a".repeat(64)}`,
    projectionVersion: 1,
    nodes: [],
    attempts: [],
    ...overrides,
  };
}

describe("DesktopGraphExecutionAdapter", () => {
  it("routes canonical work through the fixed capability and validates authority", async () => {
    const graphRun = vi.fn(async (request) => projection(request));
    const adapter = new DesktopGraphExecutionAdapter({
      surface: "desktop_specialized_agents",
      client: { graphRun },
      authorityMode: () => "canonical",
    });

    await expect(
      adapter.run({
        runId: "desktop-agent-run",
        definition: { id: "definition" },
        inputs: {},
      }),
    ).resolves.toMatchObject({
      id: "desktop-agent-run",
      authoritySource: "graph_kernel",
    });
    expect(graphRun).toHaveBeenCalledWith(
      expect.objectContaining({
        originSurface: "desktop",
        authorityMode: "canonical",
        waitForCompletion: true,
      }),
    );
  });

  it("resumes a durable canonical run without replaying Desktop inputs", async () => {
    const graphRun = vi.fn(async (request) =>
      projection(
        { ...request, authorityMode: "canonical" },
        { status: "running" },
      ),
    );
    const adapter = new DesktopGraphExecutionAdapter({
      surface: "desktop_workflow_manager",
      client: { graphRun },
      authorityMode: () => "canonical",
    });

    await expect(
      adapter.resume("desktop-workflow:durable", {
        waitForCompletion: false,
      }),
    ).resolves.toMatchObject({
      id: "desktop-workflow:durable",
      status: "running",
      authoritySource: "graph_kernel",
    });
    expect(graphRun).toHaveBeenCalledWith({
      runId: "desktop-workflow:durable",
      resume: true,
      waitForCompletion: false,
      idempotencyKey:
        "desktop_workflow_manager:desktop-workflow:durable:resume",
    });
  });

  it("uses a stable run key for admission and a pinned mode after rollback", async () => {
    let selectedMode = "canonical";
    const authorityMode = vi.fn(({ runKey }) => {
      expect(runKey).toBe("desktop-workflow:rollback");
      return selectedMode;
    });
    const graphRun = vi.fn(async (request) => projection(request));
    const graphStatus = vi.fn(async ({ runId }) =>
      projection({ runId, authorityMode: "canonical" }, { status: "running" }),
    );
    const adapter = new DesktopGraphExecutionAdapter({
      surface: "desktop_workflow_manager",
      client: { graphRun, graphStatus },
      authorityMode,
    });
    await adapter.run({
      runId: "desktop-workflow:rollback",
      definition: { id: "definition" },
      inputs: {},
    });
    selectedMode = "legacy";
    await expect(
      adapter.status("desktop-workflow:rollback", {
        authorityMode: "canonical",
      }),
    ).resolves.toMatchObject({
      authorityMode: "canonical",
      status: "running",
    });
    expect(authorityMode).toHaveBeenCalledTimes(1);
  });

  it("forwards audited reconciliation through the fixed capability", async () => {
    const graphReconcile = vi.fn(async ({ runId }) =>
      projection({ runId, authorityMode: "canonical" }),
    );
    const adapter = new DesktopGraphExecutionAdapter({
      client: { graphRun: vi.fn(), graphReconcile },
      authorityMode: () => "canonical",
    });
    const reconciliation = {
      effectId: "effect-1",
      decision: "committed",
      receipt: { receiptDigest: `sha256:${"c".repeat(64)}` },
      terminalEvidence: { outputDigest: `sha256:${"d".repeat(64)}` },
      auditDecisionId: "audit-1",
    };

    await expect(
      adapter.reconcile("desktop-reconcile-run", reconciliation),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(graphReconcile).toHaveBeenCalledWith({
      runId: "desktop-reconcile-run",
      reconciliation,
    });
  });

  it("rejects a forged response and a shadow executor attempt", async () => {
    const forged = new DesktopGraphExecutionAdapter({
      client: {
        graphRun: async (request) =>
          projection(request, { eventHead: `sha256:${"f".repeat(63)}` }),
      },
      authorityMode: () => "canonical",
    });
    await expect(
      forged.run({ runId: "forged", definition: {}, inputs: {} }),
    ).rejects.toMatchObject({ code: "CC_DESKTOP_GRAPH_AUTHORITY_INVALID" });

    const shadow = new DesktopGraphExecutionAdapter({
      client: {
        graphRun: async (request) =>
          projection(request, {
            attempts: [{ id: "attempt", status: "active" }],
          }),
      },
      authorityMode: () => "shadow",
    });
    await expect(
      shadow.run({ runId: "shadow", definition: {}, inputs: {} }),
    ).rejects.toMatchObject({
      code: "CC_DESKTOP_GRAPH_SHADOW_EFFECT_DETECTED",
    });
  });

  it("builds dependency-bound Specialized Agent and sequential Workflow graphs", () => {
    const specialized = buildSpecializedAgentsGraph(
      {
        subtasks: [
          { subtaskId: "plan", subtask: "plan", agentType: "architect" },
          {
            subtaskId: "build",
            subtask: "build",
            agentType: "code-generation",
            dependencies: ["plan"],
          },
        ],
      },
      "session-1",
    );
    expect(specialized.definition.nodes[1].dependsOn).toEqual([
      specialized.taskToNode.get("plan"),
    ]);

    const workflow = buildWorkflowGraph(
      {
        id: "workflow-1",
        description: "ship",
        stages: [
          { id: "requirements", name: "Requirements" },
          { id: "delivery", name: "Delivery" },
        ],
      },
      { request: "build it" },
    );
    expect(workflow.definition.nodes[1].dependsOn).toEqual([
      workflow.stageToNode.get("requirements"),
    ]);
  });

  it("projects success only from an accepted evidence-bound attempt", () => {
    const projected = projectGraphNodes(
      {
        id: "run-1",
        nodes: [{ nodeId: "node-1", status: "succeeded" }],
        attempts: [
          {
            id: "attempt-1",
            nodeId: "node-1",
            status: "accepted",
            terminalEvidence: { outputDigest: `sha256:${"b".repeat(64)}` },
          },
        ],
      },
      [{ key: "task-1", nodeId: "node-1" }],
    );
    expect(projected[0]).toMatchObject({
      success: true,
      graphAttemptId: "attempt-1",
    });
  });

  it("rejects empty or malformed accepted terminal evidence", () => {
    const projected = projectGraphNodes(
      {
        id: "run-1",
        nodes: [{ nodeId: "node-1", status: "succeeded" }],
        attempts: [
          {
            id: "attempt-1",
            nodeId: "node-1",
            status: "accepted",
            terminalEvidence: { outputDigest: `sha256:${"b".repeat(63)}` },
          },
        ],
      },
      [{ key: "task-1", nodeId: "node-1" }],
    );

    expect(projected[0]).toMatchObject({
      success: false,
      graphAttemptId: null,
    });
  });

  it("preserves a reconciliation projection without treating it as terminal success", async () => {
    const value = new DesktopGraphExecutionAdapter({
      client: {
        graphRun: async (request) =>
          projection(request, { status: "reconciliation_required" }),
      },
      authorityMode: () => "canonical",
    });

    await expect(
      value.run({ runId: "unknown-effect", definition: {}, inputs: {} }),
    ).rejects.toMatchObject({
      code: "CC_GRAPH_RECONCILIATION_REQUIRED",
      projection: { id: "unknown-effect", status: "reconciliation_required" },
    });
  });
});
