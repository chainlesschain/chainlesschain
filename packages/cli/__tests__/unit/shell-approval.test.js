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

  it("classifyAllShell lifts an allowlisted command from low to medium risk", async () => {
    // The built-in allowlist normally fast-paths `npm run test` to LOW (above).
    // With autoMode.classifyAllShell it is classified as MEDIUM, so the gate
    // decides instead of auto-passing — a strict tier then asks/denies.
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
    const res = await evaluateShellCommandWithApproval({
      command: "npm run test",
      approvalGate: gate,
      shellPolicyOptions: { classifyAllShell: true },
    });
    expect(res.riskLevel).toBe("medium");
    expect(res.shellPolicy.decision).toBe("warn");
  });

  describe("install-command policy (opt-in)", () => {
    it("attaches no install classification by default (byte-unchanged)", async () => {
      const gate = new ApprovalGate({
        defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
      });
      const res = await evaluateShellCommandWithApproval({
        command: "npm install left-pad",
        approvalGate: gate,
      });
      expect(res.install).toBeNull();
    });

    it("classifies an install and raises the risk floor before gating", async () => {
      // AUTOPILOT would allow a LOW install silently; a HIGH riskFloor makes it
      // HIGH, which STRICT-with-no-confirmer then denies.
      const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
      const res = await evaluateShellCommandWithApproval({
        command: "npm install left-pad",
        approvalGate: gate,
        installPolicy: { enabled: true, riskFloor: "high" },
      });
      expect(res.install.isInstall).toBe(true);
      expect(res.install.installs[0].manager).toBe("npm");
      expect(res.riskLevel).toBe("high");
      expect(res.allowed).toBe(false); // strict + no confirmer denies HIGH
    });

    it("records an audit entry through the injected fs when audit is on", async () => {
      const appends = [];
      const fs = {
        mkdirSync: () => {},
        appendFileSync: (p, line) => appends.push({ p, line }),
      };
      const gate = new ApprovalGate({
        defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
      });
      await evaluateShellCommandWithApproval({
        command: "sudo apt-get install -y nginx",
        approvalGate: gate,
        installPolicy: {
          enabled: true,
          audit: true,
          auditOpts: { baseDir: "/audit", fs, now: () => 0 },
        },
      });
      expect(appends).toHaveLength(1);
      const rec = JSON.parse(appends[0].line);
      expect(rec.kind).toBe("install-command");
      expect(rec.global).toBe(true);
      expect(rec.installs[0].manager).toBe("apt");
    });

    it("does not classify a non-install command even when enabled", async () => {
      const gate = new ApprovalGate({
        defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
      });
      const res = await evaluateShellCommandWithApproval({
        command: "npm run build",
        approvalGate: gate,
        installPolicy: { enabled: true, riskFloor: "high", audit: true },
      });
      expect(res.install).toBeNull();
      expect(res.riskLevel).toBe("low"); // floor not applied to a non-install
    });
  });
});
