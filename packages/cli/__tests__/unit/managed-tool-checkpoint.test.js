import { describe, expect, it, vi } from "vitest";
import {
  MANAGED_TOOL_CHECKPOINT_ERROR,
  beginManagedToolCheckpoint,
  settleManagedToolCheckpoint,
} from "../../src/lib/managed-tool-checkpoint.js";

function transaction(overrides = {}) {
  return {
    id: "wcp-1",
    checkpointId: "checkpoint-wcp-1",
    snapshot: vi.fn(() => ({ id: "wcp-1", state: "prepared" })),
    accept: vi.fn(() => ({
      outcome: "committed",
      coverage: "partial",
      fileCoverage: "partial",
      evidenceDigest: "sha256:commit",
    })),
    rollback: vi.fn(() => ({
      outcome: "rolled_back",
      coverage: "partial",
      fileCoverage: "partial",
      evidenceDigest: "sha256:rollback",
    })),
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const tx = transaction();
  const broker = {
    beginWorkspaceTransaction: vi.fn(() => tx),
  };
  return {
    tx,
    broker,
    options: {
      enabled: true,
      broker,
      workspaceRoot: "/trusted/workspace",
      runId: "run-1",
      taskKey: "task-1",
      toolName: "write_file",
      toolArgs: { path: "out.txt" },
      ...overrides,
    },
  };
}

describe("managed tool checkpoint adapter", () => {
  it("prepares direct file writes without claiming external side effects", () => {
    const input = fixture();
    const handle = beginManagedToolCheckpoint(input.options);

    expect(handle).toMatchObject({
      skipped: false,
      transactionId: "wcp-1",
      checkpointId: "checkpoint-wcp-1",
    });
    expect(input.broker.beginWorkspaceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: "/trusted/workspace",
        coverageTarget: "partial",
        writerIsolation: "unknown",
        externalSideEffects: false,
      }),
    );
  });

  it("commits success and rolls back failure", () => {
    const success = fixture();
    const committed = settleManagedToolCheckpoint(
      beginManagedToolCheckpoint(success.options),
      { success: true },
    );
    expect(success.tx.accept).toHaveBeenCalledOnce();
    expect(committed.evidence.outcome).toBe("committed");

    const failure = fixture();
    const rolledBack = settleManagedToolCheckpoint(
      beginManagedToolCheckpoint(failure.options),
      { success: false, reason: "tool returned an error" },
    );
    expect(failure.tx.rollback).toHaveBeenCalledWith({
      reason: "tool returned an error",
    });
    expect(rolledBack.evidence.outcome).toBe("rolled_back");
  });

  it.each([
    [
      "background shell",
      {
        toolName: "run_shell",
        toolArgs: { command: "server", run_in_background: true },
      },
      "background_writer_not_quiescent",
    ],
    [
      "external MCP",
      {
        toolName: "mcp__server__write",
        externalToolExecutor: { kind: "mcp" },
      },
      "external_writer_lifetime_unmanaged",
    ],
    [
      "additional workspace root",
      {
        unmanagedWriterReason: "additional_workspace_roots_not_transactional",
      },
      "additional_workspace_roots_not_transactional",
    ],
  ])(
    "reports none for %s instead of creating a transaction",
    (_name, patch, reason) => {
      const input = fixture(patch);
      expect(beginManagedToolCheckpoint(input.options)).toMatchObject({
        skipped: true,
        coverage: "none",
        fileCoverage: "none",
        reason,
      });
      expect(input.broker.beginWorkspaceTransaction).not.toHaveBeenCalled();
    },
  );

  it("does nothing for disabled and read-only calls", () => {
    expect(
      beginManagedToolCheckpoint({
        enabled: false,
        toolName: "write_file",
      }),
    ).toBeNull();
    expect(
      beginManagedToolCheckpoint({
        enabled: true,
        toolName: "read_file",
      }),
    ).toBeNull();
  });

  it("retains durable recovery evidence when settlement fails", () => {
    const input = fixture();
    input.tx.accept.mockImplementation(() => {
      const error = new Error("writer tree is still active");
      error.code = "WORKSPACE_TRANSACTION_WRITERS_ACTIVE";
      throw error;
    });
    const handle = beginManagedToolCheckpoint(input.options);

    expect(() =>
      settleManagedToolCheckpoint(handle, { success: true }),
    ).toThrow(
      expect.objectContaining({
        code: MANAGED_TOOL_CHECKPOINT_ERROR.SETTLEMENT_FAILED,
        transactionId: "wcp-1",
        checkpointId: "checkpoint-wcp-1",
        transaction: { id: "wcp-1", state: "prepared" },
      }),
    );
  });
});
