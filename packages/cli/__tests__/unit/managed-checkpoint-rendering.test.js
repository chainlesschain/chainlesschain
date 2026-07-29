import { afterEach, describe, expect, it, vi } from "vitest";
import { agentLoop as runReplLoop } from "../../src/repl/agent-repl.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const SECRET = "managed-rendering-secret-that-must-not-be-printed";

async function* managedEventSequence() {
  yield {
    type: "managed-checkpoint",
    phase: "prepared",
    id: "checkpoint-render",
    transaction_id: "wcp-render",
    tool: "write_file",
    coverage: "partial",
    sensitive_payload: SECRET,
  };
  yield {
    type: "managed-checkpoint-settled",
    phase: "committed",
    id: "checkpoint-render",
    transaction_id: "wcp-render",
    evidence_digest: `sha256:${"a".repeat(64)}`,
    tool: "write_file",
    coverage: "partial",
    file_coverage: "partial",
    sensitive_payload: SECRET,
  };
  yield {
    type: "managed-checkpoint",
    phase: "unavailable",
    tool: "run_shell",
    coverage: "none",
    reason: "background_writer_not_quiescent",
    sensitive_payload: SECRET,
  };
  yield {
    type: "managed-checkpoint-error",
    phase: "rollback",
    tool: "edit_file",
    error: "durable settlement failed",
    code: "MANAGED_TOOL_CHECKPOINT_SETTLEMENT_FAILED",
    coverage: "none",
    recovery_required: true,
    sensitive_payload: SECRET,
  };
  yield { type: "response-complete", content: "done" };
  yield { type: "run-ended", reason: "complete" };
}

describe("managed checkpoint human-readable rendering", () => {
  let stdout;

  afterEach(() => {
    stdout?.mockRestore();
    stdout = null;
  });

  it("renders honest managed coverage in the interactive REPL without dumping the event", async () => {
    const writes = [];
    stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const result = await runReplLoop([], {
      _coreLoop: managedEventSequence,
    });

    expect(result.content).toBe("done");
    const rendered = writes.join("");
    expect(rendered).toMatch(/managed checkpoint/i);
    expect(rendered).toMatch(/prepared/i);
    expect(rendered).toMatch(/committed/i);
    expect(rendered).toMatch(/partial/i);
    expect(rendered).toMatch(/unavailable/i);
    expect(rendered).toMatch(/background_writer_not_quiescent/);
    expect(rendered).toMatch(/recovery required/i);
    expect(rendered).not.toContain(SECRET);
  });

  it("renders honest managed coverage in single-prompt text mode without dumping the event", async () => {
    const output = [];
    const errors = [];

    const result = await runAgentHeadless(
      { prompt: "test", outputFormat: "text" },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        agentLoop: managedEventSequence,
        writeOut: (chunk) => output.push(String(chunk)),
        writeErr: (chunk) => errors.push(String(chunk)),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(output.join("")).toBe("done\n");
    const rendered = errors.join("");
    expect(rendered).toMatch(/managed checkpoint/i);
    expect(rendered).toMatch(/prepared/i);
    expect(rendered).toMatch(/committed/i);
    expect(rendered).toMatch(/partial/i);
    expect(rendered).toMatch(/unavailable/i);
    expect(rendered).toMatch(/background_writer_not_quiescent/);
    expect(rendered).toMatch(/recovery required/i);
    expect(rendered).not.toContain(SECRET);
  }, 30_000);
});
