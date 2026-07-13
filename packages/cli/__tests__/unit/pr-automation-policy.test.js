/**
 * PR/CI automation policy (IDE gap P1-4). Pure fail-closed decision engine:
 * bounded auto-fix that never chases a stale-commit failure, and auto-merge
 * that stays off by default and demands branch protection + required checks +
 * review + zero pending approvals.
 */
import { describe, it, expect } from "vitest";
import {
  CHECK_STATE,
  normalizeCheckState,
  summarizeChecks,
  autoFixDecision,
  autoMergeDecision,
  describePrStatusBar,
} from "../../src/lib/pr-automation-policy.js";

describe("normalizeCheckState / summarizeChecks", () => {
  it("normalizes provider vocab", () => {
    expect(normalizeCheckState("success")).toBe(CHECK_STATE.PASSED);
    expect(normalizeCheckState("FAILURE")).toBe(CHECK_STATE.FAILED);
    expect(normalizeCheckState("in_progress")).toBe(CHECK_STATE.PENDING);
    expect(normalizeCheckState("timed_out")).toBe(CHECK_STATE.ERROR);
    expect(normalizeCheckState("weird")).toBeNull();
  });

  it("allPassed requires at least one check and none failing/pending", () => {
    expect(summarizeChecks([]).allPassed).toBe(false); // bare PR ≠ all passed
    expect(summarizeChecks([{ name: "a", state: "success" }]).allPassed).toBe(
      true,
    );
    const mixed = summarizeChecks([
      { name: "a", conclusion: "success" },
      { name: "b", conclusion: "failure" },
    ]);
    expect(mixed.allPassed).toBe(false);
    expect(mixed.anyFailed).toBe(true);
    expect(mixed.failed).toBe(1);
  });
});

describe("autoFixDecision", () => {
  const base = {
    check: { name: "test", state: "failure", logCommitSha: "sha-head" },
    headCommitSha: "sha-head",
    iteration: 0,
    maxIterations: 3,
    budget: { tokensSpent: 0, tokenBudget: 100000 },
  };

  it("allows fixing a fresh failing check within budget and iteration cap", () => {
    expect(autoFixDecision(base)).toEqual({ allow: true, reason: "ok" });
  });

  it("does not fix a passing check", () => {
    expect(
      autoFixDecision({ ...base, check: { ...base.check, state: "success" } })
        .reason,
    ).toBe("check-not-failing");
  });

  it("stops at the iteration cap", () => {
    expect(autoFixDecision({ ...base, iteration: 3 }).reason).toBe(
      "max-iterations-reached",
    );
  });

  it("refuses a STALE failure log (log sha != head sha)", () => {
    expect(
      autoFixDecision({
        ...base,
        check: { ...base.check, logCommitSha: "sha-old" },
      }).reason,
    ).toBe("stale-failure-log");
  });

  it("fails closed when the commit sha cannot be verified", () => {
    expect(
      autoFixDecision({ ...base, check: { ...base.check, logCommitSha: null } })
        .reason,
    ).toBe("commit-sha-unverifiable");
    expect(autoFixDecision({ ...base, headCommitSha: null }).reason).toBe(
      "commit-sha-unverifiable",
    );
  });

  it("stops when the token or time budget is exhausted", () => {
    expect(
      autoFixDecision({
        ...base,
        budget: { tokensSpent: 100000, tokenBudget: 100000 },
      }).reason,
    ).toBe("budget-exhausted");
    expect(
      autoFixDecision({
        ...base,
        budget: { timeSpentMs: 60000, timeBudgetMs: 60000 },
      }).reason,
    ).toBe("budget-exhausted");
  });
});

describe("autoMergeDecision — fail closed", () => {
  const ready = {
    enabled: true,
    hasOpenPr: true,
    branchProtectionSatisfied: true,
    reviewApproved: true,
    pendingApprovals: 0,
    requiredChecks: ["ci"],
    checks: [{ name: "ci", conclusion: "success" }],
  };

  it("allows merge only when every requirement is met", () => {
    expect(autoMergeDecision(ready)).toEqual({
      allow: true,
      reason: "ok",
      unmet: [],
    });
  });

  it("is OFF by default (enabled omitted → disabled)", () => {
    const d = autoMergeDecision({ ...ready, enabled: undefined });
    expect(d.allow).toBe(false);
    expect(d.unmet).toContain("auto-merge-disabled");
  });

  it("blocks direct-to-branch (no open PR)", () => {
    expect(autoMergeDecision({ ...ready, hasOpenPr: false }).unmet).toContain(
      "no-open-pr",
    );
  });

  it("blocks when branch protection / review / pending approvals fail", () => {
    expect(
      autoMergeDecision({ ...ready, branchProtectionSatisfied: false }).unmet,
    ).toContain("branch-protection-unsatisfied");
    expect(
      autoMergeDecision({ ...ready, reviewApproved: false }).unmet,
    ).toContain("review-not-approved");
    expect(
      autoMergeDecision({ ...ready, pendingApprovals: 2 }).unmet,
    ).toContain("pending-approvals");
  });

  it("blocks a failing / pending check", () => {
    expect(
      autoMergeDecision({
        ...ready,
        checks: [{ name: "ci", conclusion: "failure" }],
      }).unmet,
    ).toContain("checks-failing");
    expect(
      autoMergeDecision({
        ...ready,
        checks: [{ name: "ci", conclusion: "queued" }],
      }).unmet,
    ).toContain("checks-pending");
  });

  it("blocks when a REQUIRED check never ran (present-and-passed only)", () => {
    const d = autoMergeDecision({
      ...ready,
      requiredChecks: ["ci", "security"],
      checks: [{ name: "ci", conclusion: "success" }], // security missing
    });
    expect(d.allow).toBe(false);
    expect(d.unmet).toContain("required-check-missing:security");
  });

  it("collects EVERY unmet requirement (exhaustive, not first-fail)", () => {
    const d = autoMergeDecision({
      enabled: false,
      hasOpenPr: false,
      branchProtectionSatisfied: false,
      reviewApproved: false,
      pendingApprovals: 1,
      requiredChecks: ["ci"],
      checks: [],
    });
    expect(d.unmet.length).toBeGreaterThanOrEqual(5);
  });
});

describe("describePrStatusBar", () => {
  it("renders a compact, token-free status line", () => {
    const line = describePrStatusBar({
      branch: "feat/x",
      prNumber: 42,
      checks: [
        { name: "a", conclusion: "success" },
        { name: "b", conclusion: "failure" },
      ],
      reviewApproved: false,
      mergeable: false,
    });
    expect(line).toContain("PR#42");
    expect(line).toContain("checks:1/2 ✗");
    expect(line).toContain("review:pending");
    expect(line).toContain("merge:blocked");
  });
});
