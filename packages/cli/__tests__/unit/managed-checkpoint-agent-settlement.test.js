import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const checkpointMocks = vi.hoisted(() => ({
  begin: vi.fn(() => ({
    skipped: false,
    toolName: "write_file",
    checkpointId: "checkpoint-settlement-test",
    transactionId: "wcp-settlement-test",
    prepared: { coverage: "partial" },
    transaction: { snapshot: () => ({ state: "rollback_required" }) },
  })),
  settle: vi.fn(() => {
    const error = new Error("durable settlement failed");
    error.code = "MANAGED_TOOL_CHECKPOINT_SETTLEMENT_FAILED";
    error.transactionId = "wcp-settlement-test";
    error.checkpointId = "checkpoint-settlement-test";
    error.settlement = "commit";
    throw error;
  }),
}));

vi.mock("../../src/lib/managed-tool-checkpoint.js", () => ({
  beginManagedToolCheckpoint: checkpointMocks.begin,
  settleManagedToolCheckpoint: checkpointMocks.settle,
}));

import { agentLoop } from "../../src/runtime/agent-core.js";

function scriptedWrite(content) {
  let turn = 0;
  return async () => {
    turn += 1;
    if (turn === 1) {
      return {
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "settlement-call",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: "settlement.txt",
                  content,
                }),
              },
            },
          ],
        },
      };
    }
    return { message: { role: "assistant", content: "done" } };
  };
}

describe("agent managed-checkpoint settlement failure", () => {
  it("marks recovery_required and retains the durable transaction binding", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cc-managed-settlement-"));
    const secret = "settlement-content-secret";
    try {
      const events = [];
      for await (const event of agentLoop(
        [{ role: "user", content: "write it" }],
        {
          cwd: workspace,
          chatFn: scriptedWrite(secret),
          managedCheckpoint: true,
          autoCheckpoint: false,
        },
      )) {
        events.push(event);
      }

      // The tool itself completed, but the transaction could not be committed.
      // The workspace must therefore be treated as unsafe for reuse instead of
      // reporting the original tool success.
      expect(readFileSync(join(workspace, "settlement.txt"), "utf8")).toBe(
        secret,
      );
      expect(checkpointMocks.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: "wcp-settlement-test",
        }),
        expect.objectContaining({ success: true }),
      );

      const prepared = events.find(
        (event) => event.type === "managed-checkpoint",
      );
      const executing = events.find((event) => event.type === "tool-executing");
      const checkpointError = events.find(
        (event) => event.type === "managed-checkpoint-error",
      );
      const toolResult = events.find((event) => event.type === "tool-result");

      expect(checkpointError).toMatchObject({
        phase: "commit",
        code: "MANAGED_TOOL_CHECKPOINT_SETTLEMENT_FAILED",
        transaction_id: "wcp-settlement-test",
        checkpoint_id: "checkpoint-settlement-test",
        coverage: "none",
        recovery_required: true,
      });
      expect(toolResult).toMatchObject({
        error: "durable settlement failed",
        result: {
          managedCheckpoint: {
            status: "recovery_required",
            coverage: "none",
            transactionId: "wcp-settlement-test",
            checkpointId: "checkpoint-settlement-test",
            settlement: "commit",
            originalToolError: null,
          },
        },
      });
      expect(toolResult.result.error).toMatch(
        /Manual recovery\/adjudication is required/i,
      );
      expect(events.indexOf(prepared)).toBeLessThan(events.indexOf(executing));
      expect(events.indexOf(executing)).toBeLessThan(
        events.indexOf(checkpointError),
      );
      expect(events.indexOf(checkpointError)).toBeLessThan(
        events.indexOf(toolResult),
      );
      expect(JSON.stringify([prepared, checkpointError])).not.toContain(secret);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
