import { describe, expect, it } from "vitest";
import {
  buildPermissionDecision,
  PERMISSION_DECISION_VERSION,
} from "../../src/lib/permission-decision.js";
import { agentLoop } from "../../src/runtime/agent-core.js";

describe("PermissionDecision", () => {
  it("normalizes an approval chain into a stable protocol record", () => {
    const decision = buildPermissionDecision({
      toolUseId: "tu-7",
      tool: "run_shell",
      result: {
        approval: {
          decision: "deny",
          via: "auto-mode-config",
          reason: "high risk requires approval",
        },
        permissionChain: [
          { layer: "settings-rules", outcome: "no-match" },
          {
            layer: "approval-gate",
            outcome: "deny",
            via: "auto-mode-config",
            rule: { riskLevel: "high", decision: "deny" },
            reason: "high risk requires approval",
          },
        ],
      },
    });

    expect(decision).toMatchObject({
      version: PERMISSION_DECISION_VERSION,
      id: "tu-7:perm:auto-mode-config",
      tool: "run_shell",
      decision: "deny",
      via: "auto-mode-config",
      reason: "high risk requires approval",
    });
    expect(decision.chain).toHaveLength(2);
    expect(decision.chain[1].rule).toContain('"riskLevel":"high"');
  });

  it("redacts and bounds user-controlled explanations", () => {
    const decision = buildPermissionDecision({
      toolUseId: "tu-secret",
      tool: "run_shell",
      result: {
        policy: {
          decision: "deny",
          via: "managed",
          reason: `Bearer abcdefghijklmnop ${"x".repeat(700)}`,
        },
      },
    });

    expect(decision.reason).toContain("Bearer [REDACTED]");
    expect(decision.reason).not.toContain("abcdefghijklmnop");
    expect(decision.reason.length).toBeLessThanOrEqual(513);
  });

  it("returns null for an ordinary non-policy tool result", () => {
    expect(
      buildPermissionDecision({
        toolUseId: "tu-1",
        tool: "read_file",
        result: { content: "ok" },
      }),
    ).toBeNull();
  });

  it("is emitted by the real agent loop for a gated tool call", async () => {
    let calls = 0;
    const chatFn = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "tu-gated",
                type: "function",
                function: {
                  name: "run_shell",
                  arguments: JSON.stringify({ command: "echo gated" }),
                },
              },
            ],
          },
          usage: {},
        };
      }
      return { message: { role: "assistant", content: "done" }, usage: {} };
    };
    const events = [];
    for await (const event of agentLoop([{ role: "user", content: "run it" }], {
      chatFn,
      autoCompact: false,
      approvalGate: {
        decide: async () => ({
          decision: "deny",
          via: "managed",
          policy: "strict",
          riskLevel: "medium",
          reason: "managed policy requires approval",
        }),
      },
    })) {
      events.push(event);
    }

    const result = events.find((event) => event.type === "tool-result");
    expect(result.permission_decision_id).toBe("tu-gated:perm:managed");
    expect(result.permission_decision).toMatchObject({
      id: result.permission_decision_id,
      tool: "run_shell",
      decision: "deny",
      via: "managed",
      reason: "managed policy requires approval",
    });
  });
});
