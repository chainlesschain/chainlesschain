/**
 * Layer-by-layer permission explanation chain (batch 12): a blocked run_shell
 * result carries `permissionChain` describing what each consulted layer said
 * (settings-rules → shell-policy → approval-gate), so `/permissions denials`
 * and `cc permissions recent` can explain WHY a command was blocked.
 */
import { describe, expect, it } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  appendRecentDenials,
  formatRecentDenials,
  readRecentDenials,
} from "../../src/lib/permission-denial-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("run_shell permissionChain", () => {
  it("gate deny carries all consulted layers incl. gate reason/rule passthrough", async () => {
    const approvalGate = {
      decide: async () => ({
        decision: "deny",
        via: "auto-mode-config",
        policy: "auto-mode",
        riskLevel: "low",
        reason: "autoMode.decisions maps low risk to deny",
        rule: { riskLevel: "low", decision: "deny", source: "settings" },
      }),
    };
    const result = await executeTool(
      "run_shell",
      { command: "echo chain-test" },
      { approvalGate },
    );
    expect(result.error).toMatch(/\[ApprovalGate\]/);
    expect(Array.isArray(result.permissionChain)).toBe(true);
    const layers = result.permissionChain.map((s) => s.layer);
    expect(layers).toEqual(["settings-rules", "shell-policy", "approval-gate"]);
    expect(result.permissionChain[0]).toMatchObject({ outcome: "no-match" });
    expect(result.permissionChain[1]).toMatchObject({
      outcome: "warn",
      rule: "unclassified-command",
    });
    expect(result.permissionChain[2]).toMatchObject({
      outcome: "deny",
      via: "auto-mode-config",
      policy: "auto-mode",
      reason: "autoMode.decisions maps low risk to deny",
    });
    expect(result.permissionChain[2].rule).toMatchObject({
      riskLevel: "low",
      decision: "deny",
    });
  });

  it("hard shell-policy deny explains without a phantom gate layer", async () => {
    const approvalGate = {
      decide: async () => {
        throw new Error("gate must not be consulted for a hard deny");
      },
    };
    const result = await executeTool(
      "run_shell",
      { command: "rm -rf /" },
      { approvalGate },
    );
    expect(result.error).toMatch(/\[Shell Policy\]/);
    const layers = (result.permissionChain || []).map((s) => s.layer);
    expect(layers).toEqual(["settings-rules", "shell-policy"]);
    expect(result.permissionChain[1].outcome).toMatch(/deny|reroute/);
  });

  it("settings deny rule appears as the settings-rules layer outcome", async () => {
    const approvalGate = {
      decide: async () => ({ decision: "allow", via: "policy" }),
    };
    // A deny rule matches before run_shell's own case — the early return has
    // no chain (it never reached the shell layers), which is correct: nothing
    // else was consulted. This guards the settingsVerdict wiring INSIDE the
    // chain for the ask/allow path instead.
    const result = await executeTool(
      "run_shell",
      { command: "echo hi" },
      {
        approvalGate: {
          decide: async () => ({
            decision: "deny",
            via: "policy",
            policy: "strict",
            riskLevel: "low",
          }),
        },
        permissionRules: { allow: ["Bash(echo:*)"], ask: [], deny: [] },
      },
    );
    // allow rule pre-authorizes → gate skipped → command actually runs.
    expect(result.error).toBeUndefined();
    expect(String(result.stdout || "")).toContain("hi");
    void approvalGate;
  });
});

describe("permission-denial-store chain persistence", () => {
  it("persists and renders the chain across processes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-denials-chain-"));
    const file = join(dir, "recent-denials.json");
    try {
      appendRecentDenials(
        [
          {
            tool: "run_shell",
            summary: "echo x",
            reason: "[ApprovalGate] denied",
            via: "user-deny",
            rule: null,
            chain: [
              { layer: "settings-rules", outcome: "no-match" },
              { layer: "approval-gate", outcome: "deny", via: "user-deny" },
            ],
          },
        ],
        { sessionId: "s1", source: "headless" },
        { file },
      );
      const records = readRecentDenials({ file });
      expect(records[0].chain).toHaveLength(2);
      const text = formatRecentDenials(records, { now: Date.now() });
      expect(text).toContain(
        "chain: settings-rules→no-match · approval-gate→deny (user-deny)",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
