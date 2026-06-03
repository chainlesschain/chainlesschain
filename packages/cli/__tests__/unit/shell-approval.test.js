import { describe, it, expect } from "vitest";
import { evaluateShellCommandWithApproval } from "../../src/lib/shell-approval.js";
import { ApprovalGate, APPROVAL_POLICY } from "@chainlesschain/session-core";

describe("evaluateShellCommandWithApproval", () => {
  it("hard-denies shell-policy DENY rules regardless of gate tier", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT });
    const res = await evaluateShellCommandWithApproval({
      command: "rm -rf /",
      approvalGate: gate,
    });
    expect(res.allowed).toBe(false);
    expect(res.via).toBe("shell-policy");
    expect(res.riskLevel).toBe("high");
  });

  it("preserves legacy behavior when no approvalGate is passed (WARN → allow)", async () => {
    const res = await evaluateShellCommandWithApproval({
      command: "echo hi",
    });
    expect(res.allowed).toBe(true);
    expect(res.via).toBe("shell-policy");
    expect(res.riskLevel).toBe("medium");
  });

  it("STRICT policy asks for confirmation on WARN commands", async () => {
    let confirmCalled = false;
    const gate = new ApprovalGate({
      defaultPolicy: APPROVAL_POLICY.STRICT,
      confirm: async () => {
        confirmCalled = true;
        return true;
      },
    });
    const res = await evaluateShellCommandWithApproval({
      command: "echo hello",
      approvalGate: gate,
    });
    expect(confirmCalled).toBe(true);
    expect(res.allowed).toBe(true);
    expect(res.via).toBe("user-confirm");
  });

  it("STRICT policy + no confirmer → safe-default deny", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
    const res = await evaluateShellCommandWithApproval({
      command: "echo hello",
      approvalGate: gate,
    });
    expect(res.allowed).toBe(false);
    expect(res.via).toBe("no-confirmer");
  });

  it("TRUSTED allows WARN commands without confirm", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.TRUSTED });
    const res = await evaluateShellCommandWithApproval({
      command: "echo hi",
      approvalGate: gate,
    });
    expect(res.allowed).toBe(true);
    expect(res.via).toBe("policy");
  });

  it("AUTOPILOT allows WARN commands silently", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT });
    const res = await evaluateShellCommandWithApproval({
      command: "echo hi",
      approvalGate: gate,
    });
    expect(res.allowed).toBe(true);
    expect(res.via).toBe("policy");
  });

  it("per-session policy overrides default (trusted)", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
    gate.setSessionPolicy("sess-1", APPROVAL_POLICY.TRUSTED);
    const res = await evaluateShellCommandWithApproval({
      command: "echo ok",
      sessionId: "sess-1",
      approvalGate: gate,
    });
    expect(res.allowed).toBe(true);
    expect(res.policy).toBe(APPROVAL_POLICY.TRUSTED);
  });

  it("ALLOW commands are low-risk — autopilot passthrough", async () => {
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
    const res = await evaluateShellCommandWithApproval({
      command: "npm run test",
      approvalGate: gate,
    });
    expect(res.allowed).toBe(true);
    expect(res.riskLevel).toBe("low");
    expect(res.via).toBe("policy");
  });
});
