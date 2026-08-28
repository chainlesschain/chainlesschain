import { describe, expect, it } from "vitest";
import {
  projectHookPolicyDecision,
  projectToolPolicyDecision,
} from "../../src/lib/policy-decision-event.js";

describe("canonical policy decision events", () => {
  it("projects hook and tool policy outcomes into one bounded shape", () => {
    const hook = projectHookPolicyDecision({
      type: "hook_response",
      hook_event: "PreToolUse",
      session_id: "session-1",
      turn_id: "turn-1",
      tool_use_id: "tool-use-1",
      decision: "ask",
      requires_approval: true,
      blocked: false,
    });
    const tool = projectToolPolicyDecision({
      type: "tool-result",
      tool: "run_shell",
      tool_use_id: "tool-use-1",
      permission_decision: {
        id: "tool-use-1:perm:hook",
        decision: "deny",
        via: "hook",
        rule: "Bash(npm:*)",
        reason: "approval declined",
        chain: [{ layer: "hook", outcome: "deny", via: "PreToolUse" }],
      },
    });

    expect(hook).toMatchObject({
      type: "policy_decision",
      schema_version: 1,
      source: "hook",
      decision: "ask",
      hook_event: "PreToolUse",
      session_id: "session-1",
    });
    expect(tool).toMatchObject({
      type: "policy_decision",
      schema_version: 1,
      source: "tool",
      decision: "deny",
      decision_id: "tool-use-1:perm:hook",
      tool: "run_shell",
      via: "hook",
    });
    expect(hook.policy_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(tool.policy_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("redacts secrets and deterministically derives missing decision ids", () => {
    const input = {
      type: "tool-result",
      tool: "run_shell",
      tool_use_id: "tool-use-2",
      permission_decision: {
        decision: "blocked",
        via: "permission-rule",
        reason: "Authorization: Bearer secret-token-value",
      },
    };

    const first = projectToolPolicyDecision(input, { sessionId: "session-1" });
    const second = projectToolPolicyDecision(input, { sessionId: "session-1" });

    expect(first).toEqual(second);
    expect(first.decision).toBe("deny");
    expect(first.decision_id).toMatch(/^policy:[a-f0-9]{48}$/);
    expect(JSON.stringify(first)).not.toContain("secret-token-value");
  });

  it("ignores events without a policy outcome", () => {
    expect(projectHookPolicyDecision({ type: "hook_started" })).toBeNull();
    expect(projectToolPolicyDecision({ type: "tool-result" })).toBeNull();
  });
});
