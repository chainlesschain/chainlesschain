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
    // The denial reason must be ACTIONABLE for the model: tell it retrying
    // won't help and to involve the user (Claude-Code 2.1.193 denial reasons).
    expect(res.error).toMatch(/approval/i);
    expect(res.error).toMatch(/retry|retrying|user/i);
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

  it("fail-closes unattended publish/push shell actions before spawning", async () => {
    const res = await executeTool(
      "run_shell",
      { command: "git push origin main" },
      {
        unattendedActionPolicy: {
          unattended: true,
          trigger: { trusted: true },
        },
      },
    );
    expect(res.error).toMatch(/Unattended Action/);
    expect(res.unattendedAction?.reason).toBe("requires-attendance");
    expect(res.policy).toEqual({
      decision: "deny",
      via: "unattended-action-policy",
    });
  });

  it("failed command surfaces stdout so the agent sees the failure output", async () => {
    // Test runners / linters / build tools print WHAT failed to stdout and only
    // a one-line summary to stderr, then exit non-zero. If the foreground error
    // path drops err.stdout the agent is blind to its primary failure signal.
    const res = await executeTool(
      "run_shell",
      {
        command: `node -e "console.log('OUT-MARKER'); process.exit(3)"`,
      },
      {},
    );
    expect(res.exitCode).toBe(3);
    expect(typeof res.stdout).toBe("string");
    expect(res.stdout).toContain("OUT-MARKER");
  });
});
