import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AgentCoordinator } = require("../agent-coordinator.js");
const {
  RUNTIME_MODE,
  TERMINAL_EVIDENCE_KIND,
  createRuntimeClaims,
} = require("@chainlesschain/session-core/runtime-claims");

function verifiedResult() {
  return {
    success: true,
    status: "completed",
    runtimeClaims: createRuntimeClaims({
      mode: RUNTIME_MODE.REAL_EXECUTION,
    }),
    terminalEvidence: [
      {
        kind: TERMINAL_EVIDENCE_KIND.RUNTIME_EVENT,
        outcome: "completed",
        source: "test-agent",
      },
      {
        kind: TERMINAL_EVIDENCE_KIND.OUTPUT_RECEIPT,
        digest: `sha256:${"b".repeat(64)}`,
      },
    ],
  };
}

function canonicalProjection(request, status = "succeeded") {
  return {
    id: request.runId,
    status,
    authorityMode: "canonical",
    authoritySource: "graph_kernel",
    authorityGeneration: 1,
    writerId: "desktop-test-writer",
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

describe("AgentCoordinator execution truthfulness", () => {
  it("keeps metadata-only agents pending instead of completing them", async () => {
    const coordinator = new AgentCoordinator({
      agentRegistry: { getInstance: () => ({ id: "metadata-only" }) },
    });

    const result = await coordinator.assignTask("metadata-only", "do work");

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.data.status).toBe("pending");
    expect(result.runtimeClaims.simulated).toBe(true);
    expect(coordinator.getTaskStatus(result.data.taskId).data.status).toBe(
      "pending",
    );
  });

  it("rejects an arbitrary success object without terminal evidence", async () => {
    const coordinator = new AgentCoordinator({
      agentRegistry: {
        getInstance: () => ({
          execute: vi.fn(async () => ({ success: true })),
        }),
      },
    });

    const result = await coordinator.assignTask("agent-1", "do work");

    expect(result.success).toBe(false);
    expect(result.data.status).toBe("failed");
    expect(result.error).toMatch(/terminal success evidence/);
  });

  it("completes only a verified real execution", async () => {
    const coordinator = new AgentCoordinator({
      agentRegistry: {
        getInstance: () => ({ execute: vi.fn(async () => verifiedResult()) }),
      },
    });

    const result = await coordinator.assignTask("agent-1", "do work");

    expect(result.success).toBe(true);
    expect(result.data.status).toBe("completed");
  });

  it("uses only the Graph writer for a canonical direct assignment", async () => {
    const legacyExecute = vi.fn(async () => verifiedResult());
    const writes = [];
    const database = {
      prepare: (sql) => ({
        run: (...args) => writes.push({ sql, args }),
      }),
    };
    const graphAdapter = {
      mode: () => "canonical",
      run: vi.fn(async (request) => canonicalProjection(request)),
    };
    const coordinator = new AgentCoordinator({
      agentRegistry: {
        getInstance: () => ({ execute: legacyExecute }),
      },
      database,
      graphAdapter,
    });

    const result = await coordinator.assignTask("agent-1", "do work");

    expect(result.success).toBe(true);
    expect(result.data.status).toBe("completed");
    expect(result.data.graphAuthority.authoritySource).toBe("graph_kernel");
    expect(result.data.result.terminalEvidence.outputDigest).toMatch(
      /^sha256:/,
    );
    expect(legacyExecute).not.toHaveBeenCalled();
    const persisted = writes
      .filter(({ sql }) => sql.startsWith("UPDATE agent_task_history"))
      .at(-1);
    const receipt = JSON.parse(persisted.args.at(-2));
    expect(receipt).toMatchObject({
      graphRunId: result.data.result.graphRunId,
      graphAuthority: {
        authorityGeneration: 1,
        writerId: "desktop-test-writer",
        eventHead: `sha256:${"a".repeat(64)}`,
        projectionVersion: 1,
      },
    });
  });

  it("runs a canonical multi-agent plan as one dependency-bound Graph", async () => {
    const legacyExecute = vi.fn(async () => verifiedResult());
    const graphAdapter = {
      mode: () => "canonical",
      run: vi.fn(async (request) => canonicalProjection(request)),
    };
    const coordinator = new AgentCoordinator({
      agentRegistry: {
        getInstance: () => ({ execute: legacyExecute }),
      },
      graphAdapter,
    });
    coordinator.getPlan = vi.fn(async () => ({
      subtasks: [
        {
          subtaskId: "plan",
          subtask: "plan the change",
          agentType: "design",
          dependencies: [],
        },
        {
          subtaskId: "build",
          subtask: "build the change",
          agentType: "code-generation",
          dependencies: ["plan"],
        },
      ],
    }));

    const result = await coordinator.orchestrate("plan and build");

    expect(result.success).toBe(true);
    expect(result.data.results).toHaveLength(2);
    expect(result.data.results.every((entry) => entry.success)).toBe(true);
    expect(graphAdapter.run).toHaveBeenCalledOnce();
    const graphRequest = graphAdapter.run.mock.calls[0][0];
    expect(graphRequest.definition.nodes[1].dependsOn).toEqual([
      graphRequest.definition.nodes[0].id,
    ]);
    expect(legacyExecute).not.toHaveBeenCalled();
  });

  it("rejects canonical success without immutable accepted evidence", async () => {
    const graphAdapter = {
      mode: () => "canonical",
      run: vi.fn(async (request) => {
        const value = canonicalProjection(request);
        value.attempts[0].terminalEvidence = {};
        return value;
      }),
    };
    const coordinator = new AgentCoordinator({ graphAdapter });

    const result = await coordinator.assignTask("agent-1", "do work");

    expect(result.success).toBe(false);
    expect(result.code).toBe("CC_DESKTOP_GRAPH_EXECUTION_FAILED");
    expect(result.data.status).toBe("failed");
  });

  it("keeps shadow divergence non-authoritative and runs the verified legacy agent", async () => {
    const legacyExecute = vi.fn(async () => verifiedResult());
    const graphAdapter = {
      mode: () => "shadow",
      run: vi.fn(async () => {
        const error = new Error("shadow unavailable");
        error.code = "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE";
        throw error;
      }),
    };
    const coordinator = new AgentCoordinator({
      agentRegistry: {
        getInstance: () => ({ execute: legacyExecute }),
      },
      graphAdapter,
    });

    const result = await coordinator.assignTask("agent-1", "do work");

    expect(result.success).toBe(true);
    expect(legacyExecute).toHaveBeenCalledOnce();
    expect(coordinator.shadowDivergences).toEqual([
      expect.objectContaining({
        phase: "assignment",
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    ]);
  });

  it("does not report canonical cancellation when Graph requires reconciliation", async () => {
    const graphAdapter = {
      mode: () => "canonical",
      cancel: vi.fn(async (runId) => ({
        id: runId,
        status: "reconciliation_required",
        authoritySource: "graph_kernel",
      })),
    };
    const coordinator = new AgentCoordinator({ graphAdapter });
    coordinator.activeTasks.set("task-1", {
      id: "task-1",
      status: "running",
      graphRunId: "desktop-specialized-task:task-1",
    });

    const result = await coordinator.cancelTask("task-1", "stop");

    expect(result.success).toBe(false);
    expect(result.reconciliationRequired).toBe(true);
    expect(coordinator.activeTasks.get("task-1").status).toBe(
      "reconciliation_required",
    );
  });
});
