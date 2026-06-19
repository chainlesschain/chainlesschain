import { describe, expect, it } from "vitest";
import sharedCodingAgentPolicy from "../../src/runtime/coding-agent-policy.cjs";

const {
  PLAN_APPROVED_STATES,
  READ_ONLY_GIT_SUBCOMMANDS,
  TOOL_DECISIONS,
  TOOL_POLICY_METADATA,
  evaluateToolPolicy,
  getToolPolicyMetadata,
  isDangerousGitCommand,
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

  describe("isDangerousGitCommand (2.1.183 destructive-git parity)", () => {
    it("flags working-tree / history destroying commands", () => {
      const dangerous = [
        "git reset --hard",
        "git reset --hard HEAD~1",
        "git reset --merge",
        "git reset --keep origin/main",
        "git clean -fd",
        "git clean -fdx",
        "clean -f",
        "git commit --amend",
        "git commit --amend -m reworded",
        "git commit --amend --no-edit",
        "git checkout -- src/index.js",
        "git checkout .",
        "git checkout -f main",
        "git restore src/app.js",
        "git restore .",
        "git restore --staged --worktree file.js",
        "git switch --force other",
        "git switch --discard-changes other",
        "git push --force",
        "git push -f origin main",
        "git branch -D feature",
        "git branch --delete --force feature",
        "git stash drop",
        "git stash clear",
        "git reflog expire --expire=now --all",
        "git update-ref -d refs/heads/x",
        "git filter-branch --tree-filter rm",
        "git gc --prune=now",
        "git rebase main",
        "git rebase -i HEAD~3",
      ];
      for (const cmd of dangerous) {
        expect(isDangerousGitCommand(cmd), cmd).toBe(true);
      }
    });

    it("does NOT flag recoverable / benign git commands", () => {
      const safe = [
        "git status",
        "git diff",
        "git log --oneline",
        "git add -A",
        "git commit -m 'wip'",
        "git commit --no-verify -m 'wip'",
        "git reset",
        "git reset HEAD~1",
        "git reset --soft HEAD~1",
        "git reset --mixed",
        "git checkout main",
        "git checkout -b feature",
        "git switch other",
        "git restore --staged file.js",
        "git push origin main",
        "git push --force-with-lease",
        "git push --force-if-includes origin main",
        "git branch -d merged",
        "git branch feature",
        "git stash",
        "git stash push -m wip",
        "git stash pop",
        "git rebase --abort",
        "git rebase --continue",
        "git fetch --all",
        "git pull",
        "",
      ];
      for (const cmd of safe) {
        expect(isDangerousGitCommand(cmd), cmd).toBe(false);
      }
    });
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
