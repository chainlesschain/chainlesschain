import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  WorkflowManager,
  WorkflowPipeline,
} = require("../workflow-pipeline.js");

function tracker() {
  return {
    setPercent: vi.fn(),
    complete: vi.fn(),
    error: vi.fn(),
    cancel: vi.fn(),
  };
}

function progressEmitter() {
  const value = tracker();
  return {
    value,
    createTracker: vi.fn(() => value),
    setMainWindow: vi.fn(),
  };
}

function qualityGates() {
  return {
    on: vi.fn(),
    check: vi.fn(async () => ({ passed: true, blocking: false })),
    override: vi.fn(() => true),
    getAllStatuses: vi.fn(() => ({})),
  };
}

function graphProjection(request, status = "succeeded") {
  return {
    id: request.runId,
    status,
    authorityMode: "canonical",
    authoritySource: "graph_kernel",
    authorityGeneration: 3,
    writerId: "workflow-test-writer",
    eventHead: `sha256:${"a".repeat(64)}`,
    projectionVersion: 1,
    nodes: request.definition.nodes.map((node) => ({
      nodeId: node.id,
      status: status === "succeeded" ? "succeeded" : "failed",
    })),
    attempts: request.definition.nodes.map((node, index) => ({
      id: `attempt-${index + 1}`,
      nodeId: node.id,
      status: status === "succeeded" ? "accepted" : "rejected",
      terminalEvidence:
        status === "succeeded"
          ? { outputDigest: `sha256:${"b".repeat(64)}` }
          : null,
    })),
  };
}

describe("Workflow Graph authority", () => {
  it("loads durable Graph history through the workflow binding", async () => {
    const history = {
      schema: "chainlesschain.graph-debug-history/v1",
      runId: "desktop-workflow:history-workflow",
      events: [],
      snapshots: [],
    };
    const graphAdapter = {
      mode: () => "canonical",
      history: vi.fn(async () => history),
    };
    const workflow = new WorkflowPipeline({
      id: "history-workflow",
      graphAdapter,
      progressEmitter: progressEmitter(),
      qualityGateManager: qualityGates(),
    });
    workflow.graphRunId = history.runId;

    await expect(
      workflow.getGraphHistory({ limit: 10, snapshotLimit: 5 }),
    ).resolves.toBe(history);
    expect(graphAdapter.history).toHaveBeenCalledWith(history.runId, {
      limit: 10,
      snapshotLimit: 5,
    });
  });

  it("projects canonical Graph evidence without invoking a legacy stage executor", async () => {
    const legacyExecutor = vi.fn(async () => ({ legacy: true }));
    const graphAdapter = {
      mode: () => "canonical",
      run: vi.fn(async (request) => graphProjection(request)),
      cancel: vi.fn(),
    };
    const workflow = new WorkflowPipeline({
      id: "canonical-workflow",
      graphAdapter,
      progressEmitter: progressEmitter(),
      qualityGateManager: qualityGates(),
      stageExecutors: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [
          `stage_${index + 1}`,
          legacyExecutor,
        ]),
      ),
    });

    const result = await workflow.execute({ request: "ship it" });

    expect(result.success).toBe(true);
    expect(result.graphAuthority).toMatchObject({
      authoritySource: "graph_kernel",
      authorityGeneration: 3,
      writerId: "workflow-test-writer",
    });
    expect(legacyExecutor).not.toHaveBeenCalled();
    expect(workflow.getStages()).toHaveLength(6);
    expect(
      workflow.getStages().every((stage) => stage.status === "completed"),
    ).toBe(true);
    expect(workflow.getStatus()).toMatchObject({
      authorityMode: "canonical",
      authoritySource: "graph_kernel",
      graphRunId: "desktop-workflow:canonical-workflow",
      reconciliationRequired: false,
    });
  });

  it("keeps a shadow Graph failure observational and runs legacy stages", async () => {
    const legacyExecutor = vi.fn(async () => ({ legacy: true }));
    const graphAdapter = {
      mode: () => "shadow",
      run: vi.fn(async () => {
        const error = new Error("shadow graph unavailable");
        error.code = "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE";
        throw error;
      }),
    };
    const workflow = new WorkflowPipeline({
      id: "shadow-workflow",
      graphAdapter,
      progressEmitter: progressEmitter(),
      qualityGateManager: qualityGates(),
      stageExecutors: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [
          `stage_${index + 1}`,
          legacyExecutor,
        ]),
      ),
    });

    const result = await workflow.execute({ request: "legacy remains writer" });

    expect(result.success).toBe(true);
    expect(legacyExecutor).toHaveBeenCalledTimes(6);
    expect(result.graphShadowDivergences).toEqual([
      expect.objectContaining({
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    ]);
  });

  it("does not project cancellation when Graph reports an unknown effect", async () => {
    const graphAdapter = {
      mode: () => "canonical",
      run: vi.fn(),
      cancel: vi.fn(async (runId) => ({
        id: runId,
        status: "reconciliation_required",
        authorityMode: "canonical",
        authoritySource: "graph_kernel",
      })),
    };
    const workflow = new WorkflowPipeline({
      id: "reconcile-workflow",
      graphAdapter,
      progressEmitter: progressEmitter(),
      qualityGateManager: qualityGates(),
    });
    workflow.graphRunId = "desktop-workflow:reconcile-workflow";
    workflow.runAuthorityMode = "canonical";
    workflow.stateMachine.start();

    await expect(workflow.cancel("stop")).resolves.toBe(false);
    expect(workflow.stateMachine.getState()).toBe("failed");
    expect(workflow.getStatus()).toMatchObject({
      overall: { status: "reconciliation_required" },
      reconciliationRequired: true,
    });
  });

  it("fails closed for controls that the canonical Graph API does not expose", () => {
    const graphAdapter = { mode: () => "canonical" };
    const workflow = new WorkflowPipeline({
      graphAdapter,
      progressEmitter: progressEmitter(),
      qualityGateManager: qualityGates(),
    });

    expect(() => workflow.pause()).toThrowError(
      expect.objectContaining({
        code: "CC_DESKTOP_GRAPH_CONTROL_UNSUPPORTED",
      }),
    );
    expect(() => workflow.retry()).toThrowError(
      expect.objectContaining({
        code: "CC_DESKTOP_GRAPH_CONTROL_UNSUPPORTED",
      }),
    );
    expect(() => workflow.overrideQualityGate("gate_1_analysis")).toThrowError(
      expect.objectContaining({
        code: "CC_DESKTOP_GRAPH_CONTROL_UNSUPPORTED",
      }),
    );
  });

  it("shares one Graph adapter across workflows and refuses deletion if cancel is unresolved", async () => {
    const graphAdapter = {
      mode: () => "canonical",
      cancel: vi.fn(async (runId) => ({
        id: runId,
        status: "reconciliation_required",
      })),
    };
    const manager = new WorkflowManager({
      graphAdapter,
      progressEmitter: progressEmitter(),
    });
    const workflow = manager.createWorkflow({
      id: "manager-workflow",
      qualityGateManager: qualityGates(),
    });
    workflow.graphRunId = "desktop-workflow:manager-workflow";
    workflow.runAuthorityMode = "canonical";
    workflow.stateMachine.start();

    await expect(manager.deleteWorkflow(workflow.id)).resolves.toBe(false);
    await expect(manager.deleteWorkflow(workflow.id)).resolves.toBe(false);
    expect(manager.getWorkflow(workflow.id)).toBe(workflow);
    expect(workflow.graphAdapter).toBe(graphAdapter);
    expect(graphAdapter.cancel).toHaveBeenCalledOnce();
  });
});
