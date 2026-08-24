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
});
