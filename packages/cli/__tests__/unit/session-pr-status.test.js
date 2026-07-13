/**
 * `cc session pr-status` pure helpers (P1-4 PR/CI monitor + controlled
 * auto-merge). renderPrStatus / mapGhPrToSignals are pure — no gh, no network.
 */
import { describe, it, expect } from "vitest";
import {
  renderPrStatus,
  mapGhPrToSignals,
} from "../../src/commands/session.js";

describe("mapGhPrToSignals", () => {
  it("maps gh pr view json to fail-closed signals", () => {
    const s = mapGhPrToSignals({
      number: 12,
      state: "OPEN",
      headRefName: "feat/x",
      headRefOid: "abc123",
      reviewDecision: "APPROVED",
      statusCheckRollup: [
        { name: "build", conclusion: "SUCCESS" },
        { name: "test", status: "IN_PROGRESS" },
      ],
    });
    expect(s.prNumber).toBe(12);
    expect(s.hasOpenPr).toBe(true);
    expect(s.branch).toBe("feat/x");
    expect(s.headCommitSha).toBe("abc123");
    expect(s.reviewApproved).toBe(true);
    expect(s.checks).toEqual([
      { name: "build", state: "SUCCESS" },
      { name: "test", state: "IN_PROGRESS" },
    ]);
    // Branch protection + pending approvals are NOT in gh json → undefined, so
    // the fail-closed policy denies unless a --checks-file asserts them.
    expect(s.branchProtectionSatisfied).toBeUndefined();
  });

  it("treats a non-open PR as no-open-pr", () => {
    expect(mapGhPrToSignals({ state: "MERGED" }).hasOpenPr).toBe(false);
    expect(mapGhPrToSignals({}).hasOpenPr).toBe(false);
  });
});

describe("renderPrStatus (P1-4)", () => {
  const ready = {
    branch: "feat/x",
    prNumber: 7,
    hasOpenPr: true,
    branchProtectionSatisfied: true,
    reviewApproved: true,
    pendingApprovals: 0,
    requiredChecks: ["build"],
    checks: [{ name: "build", state: "success" }],
  };

  it("blocks auto-merge by default (off) even when everything else passes", async () => {
    const r = await renderPrStatus(ready);
    expect(r.autoMerge.allow).toBe(false);
    expect(r.autoMerge.unmet).toContain("auto-merge-disabled");
    expect(r.statusBar).toMatch(/PR#7/);
    expect(r.statusBar).toMatch(/checks:1\/1/);
    expect(r.lines.join(" ")).toMatch(/blocked/);
  });

  it("allows auto-merge when enabled and every requirement is met", async () => {
    const r = await renderPrStatus(ready, { enabled: true });
    expect(r.autoMerge.allow).toBe(true);
    expect(r.lines.join(" ")).toMatch(/eligible/);
    expect(r.statusBar).toMatch(/merge:ready/);
  });

  it("blocks when a required check is absent (fail-closed)", async () => {
    const r = await renderPrStatus(
      { ...ready, requiredChecks: ["build", "e2e"] },
      { enabled: true },
    );
    expect(r.autoMerge.allow).toBe(false);
    expect(
      r.autoMerge.unmet.some((u) => u.includes("required-check-missing:e2e")),
    ).toBe(true);
  });

  it("blocks and marks the status bar when a check is failing", async () => {
    const r = await renderPrStatus(
      { ...ready, checks: [{ name: "build", state: "failure" }] },
      { enabled: true },
    );
    expect(r.autoMerge.allow).toBe(false);
    expect(r.autoMerge.unmet).toContain("checks-failing");
    expect(r.statusBar).toMatch(/✗/);
  });
});
