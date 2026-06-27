/**
 * agent-core executeTool — run_code ApprovalGate gating (interactive-only).
 *
 * run_code executes arbitrary code and historically ran ungated, bypassing the
 * ApprovalGate that run_shell honors. In an INTERACTIVE session it now goes
 * through the same tier gate; headless (interactiveApproval=false) keeps its
 * existing per-permission-mode behavior.
 */
import { describe, it, expect } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";
import { APPROVAL_DECISION } from "@chainlesschain/session-core";

const NODE_OK = { language: "node", code: "console.log('RC_OK')" };

/** Minimal ApprovalGate stub whose decide() always returns `decision`. */
function gate(decision) {
  const calls = [];
  return {
    calls,
    decide: async (req) => {
      calls.push(req);
      return { decision, via: "tier:test" };
    },
  };
}

describe("run_code ApprovalGate gate (interactive-only)", () => {
  it("denies run_code when interactive + gate denies (not executed)", async () => {
    const g = gate(APPROVAL_DECISION.DENY);
    const res = await executeTool("run_code", NODE_OK, {
      cwd: process.cwd(),
      approvalGate: g,
      interactiveApproval: true,
    });
    expect(res.error).toMatch(/\[ApprovalGate\] run_code denied/);
    // Actionable for the model (parity with run_shell): retry won't help, ask user.
    expect(res.error).toMatch(/approval/i);
    expect(res.error).toMatch(/retry|user/i);
    expect(res.approval).toMatchObject({ riskLevel: "high" });
    // The gate was consulted for the run_code tool at HIGH risk.
    expect(g.calls[0]).toMatchObject({ tool: "run_code" });
  });

  it("proceeds when interactive + gate allows", async () => {
    const g = gate(APPROVAL_DECISION.ALLOW);
    const res = await executeTool("run_code", NODE_OK, {
      cwd: process.cwd(),
      approvalGate: g,
      interactiveApproval: true,
    });
    expect(res.error || "").not.toMatch(/ApprovalGate/);
    expect(g.calls.length).toBe(1);
  });

  it("does NOT gate run_code in headless (interactiveApproval false)", async () => {
    const g = gate(APPROVAL_DECISION.DENY); // would deny IF consulted
    const res = await executeTool("run_code", NODE_OK, {
      cwd: process.cwd(),
      approvalGate: g,
      interactiveApproval: false,
    });
    expect(res.error || "").not.toMatch(/ApprovalGate/);
    expect(g.calls.length).toBe(0); // gate never consulted → headless unchanged
  });

  it("bypasses the gate when a settings allow rule pre-authorizes", async () => {
    const g = gate(APPROVAL_DECISION.DENY);
    const res = await executeTool("run_code", NODE_OK, {
      cwd: process.cwd(),
      approvalGate: g,
      interactiveApproval: true,
      permissionRules: { allow: ["run_code"] },
    });
    expect(res.error || "").not.toMatch(/ApprovalGate/);
    expect(g.calls.length).toBe(0); // ruleAllowed short-circuits the gate
  });
});
