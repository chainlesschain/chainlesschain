import { describe, it, expect } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";
import { ApprovalGate, APPROVAL_POLICY } from "@chainlesschain/session-core";

// Phase G #3 — run_shell branch must route through ApprovalGate when one is
// supplied in the tool context. These tests exercise the real shell-approval
// pipeline end-to-end via agent-core.executeTool.

describe("agent-core run_shell + ApprovalGate", () => {
  it("AUTOPILOT gate lets WARN commands through (policy via)", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT });
    const res = await executeTool(
      "run_shell",
      { command: "echo hello-autopilot" },
      { approvalGate: gate },
    );
    expect(res.error).toBeUndefined();
    expect(res.approval?.via).toBe("policy");
    expect(res.approval?.riskLevel).toBe("medium");
    expect(typeof res.stdout).toBe("string");
  });

  it("STRICT gate + no confirmer → denied with approval.via='no-confirmer'", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
    const res = await executeTool(
      "run_shell",
      { command: "echo hello-strict" },
      { approvalGate: gate },
    );
    expect(res.error).toMatch(/\[ApprovalGate\]/);
    expect(res.approval?.via).toBe("no-confirmer");
    expect(res.stdout).toBeUndefined();
  });

  it("STRICT gate + confirmer(true) allows, marking approval.via='user-confirm'", async () => {
    const gate = new ApprovalGate({
      defaultPolicy: APPROVAL_POLICY.STRICT,
      confirm: async () => true,
    });
    const res = await executeTool(
      "run_shell",
      { command: "echo hello-confirmed" },
      { approvalGate: gate },
    );
    expect(res.error).toBeUndefined();
    expect(res.approval?.via).toBe("user-confirm");
    expect(typeof res.stdout).toBe("string");
  });

  it("hard-denied shell-policy rules bypass the gate (shell-policy via)", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT });
    const res = await executeTool(
      "run_shell",
      { command: "rm -rf /" },
      { approvalGate: gate },
    );
    expect(res.error).toMatch(/\[Shell Policy\]/);
    expect(res.approval?.via).toBe("shell-policy");
  });

  it("no approvalGate → legacy shell-policy-only behavior (no approval field)", async () => {
    const res = await executeTool(
      "run_shell",
      { command: "echo hello-legacy" },
      {},
    );
    expect(res.error).toBeUndefined();
    expect(res.approval).toBeFalsy();
    expect(typeof res.stdout).toBe("string");
  });
});
