import { describe, expect, it } from "vitest";
import sharedCodingAgentPolicy from "../../src/runtime/coding-agent-policy.cjs";

const {
  PLAN_APPROVED_STATES,
  READ_ONLY_GIT_SUBCOMMANDS,
  TOOL_DECISIONS,
  TOOL_POLICY_METADATA,
  evaluateToolPolicy,
  getToolPolicyMetadata,
  isReadOnlyGitCommand,
  normalizeGitCommand,
  resolveToolPolicy,
} = sharedCodingAgentPolicy;

describe("coding-agent policy", () => {
  it("exposes the shared MVP policy metadata for git", () => {
    expect(getToolPolicyMetadata("git")).toEqual(
      expect.objectContaining({
        riskLevel: "high",
        category: "execute",
        planModeBehavior: "readonly-conditional",
        requiresPlanApproval: true,
        requiresConfirmation: true,
        readOnlySubcommands: READ_ONLY_GIT_SUBCOMMANDS,
      }),
    );
    expect(TOOL_POLICY_METADATA.git).toEqual(getToolPolicyMetadata("git"));
  });

  it("normalizes git commands and detects readonly subcommands", () => {
    expect(normalizeGitCommand("git status --short")).toBe("status --short");
    expect(normalizeGitCommand("  log --oneline ")).toBe("log --oneline");
    expect(isReadOnlyGitCommand("git diff -- README.md")).toBe(true);
    expect(isReadOnlyGitCommand("commit -m test")).toBe(false);
  });

  it("requires plan approval for medium-risk write tools until the plan is approved", () => {
    expect(
      evaluateToolPolicy({
        toolName: "edit_file",
        planModeState: "analyzing",
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: TOOL_DECISIONS.REQUIRE_PLAN,
        requiresPlanApproval: true,
        requiresConfirmation: false,
      }),
    );

    expect(
      evaluateToolPolicy({
        toolName: "edit_file",
        planModeState: "approved",
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        decision: TOOL_DECISIONS.ALLOW,
        requiresPlanApproval: false,
      }),
    );
  });

  it("allows readonly git during plan mode but still requires confirmation for mutating git", () => {
    expect(
      evaluateToolPolicy({
        toolName: "git",
        planModeState: "analyzing",
        toolArgs: { command: "status --short" },
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        decision: TOOL_DECISIONS.ALLOW,
        riskLevel: "low",
        category: "read",
      }),
    );

    expect(
      evaluateToolPolicy({
        toolName: "git",
        planModeState: "approved",
        toolArgs: { command: "commit -m test" },
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: TOOL_DECISIONS.REQUIRE_CONFIRMATION,
        requiresConfirmation: true,
      }),
    );

    expect(
      evaluateToolPolicy({
        toolName: "git",
        planModeState: "approved",
        confirmed: true,
        toolArgs: { command: "commit -m test" },
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        decision: TOOL_DECISIONS.ALLOW,
        requiresConfirmation: false,
      }),
    );
  });

  it("can upgrade a descriptor override into readonly auto-allow behavior", () => {
    expect(
      resolveToolPolicy("custom_readonly_tool", {
        riskLevel: "high",
        isReadOnly: true,
      }),
    ).toEqual(
      expect.objectContaining({
        riskLevel: "low",
        availableInPlanMode: true,
        planModeBehavior: "allow",
        requiresPlanApproval: false,
        requiresConfirmation: false,
        isReadOnly: true,
      }),
    );
    expect(PLAN_APPROVED_STATES).toEqual(
      expect.arrayContaining(["approved", "executing", "completed"]),
    );
  });
});
