/**
 * Worktree cleanup-safety gate (P1-5 "清理前检查未提交修改、未追踪文件、未 Push
 * Commit 和关联 PR" — CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md).
 * Pure module: no fs / git / clock — a plain state descriptor in, a fail-closed
 * exhaustive decision out.
 */
import { describe, it, expect } from "vitest";
import {
  CLEANUP_BLOCKER,
  evaluateWorktreeCleanup,
  summarizeWorktreeCleanup,
} from "../../src/lib/worktree-cleanup-safety.js";

/** A fully-clean worktree: readable, no changes, head==base, pushed, no PRs. */
function cleanState(over = {}) {
  return {
    readable: true,
    uncommitted: false,
    untracked: false,
    baseSha: "abc",
    headSha: "abc",
    hasUpstream: true,
    aheadCount: 0,
    linkedPrs: [],
    ...over,
  };
}

describe("evaluateWorktreeCleanup — clean path", () => {
  it("allows removal only when nothing is at risk", () => {
    const r = evaluateWorktreeCleanup(cleanState());
    expect(r.safeToRemove).toBe(true);
    expect(r.blockers).toEqual([]);
  });
});

describe("evaluateWorktreeCleanup — fail-closed on unverifiable", () => {
  it("keeps and reports ONLY unverifiable when git state is unreadable", () => {
    const r = evaluateWorktreeCleanup({
      readable: false,
      uncommitted: true, // even with other flags, unverifiable short-circuits
      untracked: true,
    });
    expect(r.safeToRemove).toBe(false);
    expect(r.blockers).toEqual([CLEANUP_BLOCKER.UNVERIFIABLE]);
  });

  it("treats an empty/omitted descriptor as unpushed-safe only when explicitly clean", () => {
    // readable not false but nothing described → head/base unknown, aheadCount 0
    const r = evaluateWorktreeCleanup({ readable: true });
    expect(r.safeToRemove).toBe(true); // no evidence of risk, but readable asserted
  });
});

describe("evaluateWorktreeCleanup — individual blockers", () => {
  it("blocks on uncommitted changes", () => {
    const r = evaluateWorktreeCleanup(cleanState({ uncommitted: true }));
    expect(r.safeToRemove).toBe(false);
    expect(r.blockers).toContain(CLEANUP_BLOCKER.UNCOMMITTED);
  });

  it("blocks on untracked files (distinct from uncommitted)", () => {
    const r = evaluateWorktreeCleanup(cleanState({ untracked: true }));
    expect(r.blockers).toContain(CLEANUP_BLOCKER.UNTRACKED);
    expect(r.blockers).not.toContain(CLEANUP_BLOCKER.UNCOMMITTED);
  });

  it("blocks on new commits with no upstream (nowhere pushed)", () => {
    const r = evaluateWorktreeCleanup(
      cleanState({ headSha: "def", hasUpstream: false }),
    );
    expect(r.blockers).toContain(CLEANUP_BLOCKER.UNPUSHED);
  });

  it("blocks on commits ahead of a known upstream", () => {
    const r = evaluateWorktreeCleanup(
      cleanState({ headSha: "def", hasUpstream: true, aheadCount: 2 }),
    );
    expect(r.blockers).toContain(CLEANUP_BLOCKER.UNPUSHED);
  });

  it("does NOT block when new commits are fully pushed (upstream, 0 ahead)", () => {
    const r = evaluateWorktreeCleanup(
      cleanState({ headSha: "def", hasUpstream: true, aheadCount: 0 }),
    );
    expect(r.blockers).not.toContain(CLEANUP_BLOCKER.UNPUSHED);
    expect(r.safeToRemove).toBe(true);
  });

  it("blocks on an open linked PR even when everything else is pushed & clean", () => {
    const r = evaluateWorktreeCleanup(
      cleanState({ linkedPrs: [{ number: 42, state: "open" }] }),
    );
    expect(r.safeToRemove).toBe(false);
    expect(r.blockers).toEqual([CLEANUP_BLOCKER.LINKED_PR]);
  });
});

describe("evaluateWorktreeCleanup — exhaustive collection", () => {
  it("collects every blocker at once, not just the first", () => {
    const r = evaluateWorktreeCleanup({
      readable: true,
      uncommitted: true,
      untracked: true,
      baseSha: "abc",
      headSha: "def",
      hasUpstream: false,
      linkedPrs: [{ number: 7 }],
    });
    expect(r.safeToRemove).toBe(false);
    expect(r.blockers).toEqual([
      CLEANUP_BLOCKER.UNCOMMITTED,
      CLEANUP_BLOCKER.UNTRACKED,
      CLEANUP_BLOCKER.UNPUSHED,
      CLEANUP_BLOCKER.LINKED_PR,
    ]);
    for (const b of r.blockers) expect(r.reasons[b]).toBeTruthy();
  });
});

describe("summarizeWorktreeCleanup", () => {
  it("summarizes a safe worktree", () => {
    expect(summarizeWorktreeCleanup(cleanState())).toMatch(/safe to remove/);
  });
  it("names blockers and pluralizes PR count without leaking content", () => {
    const s = summarizeWorktreeCleanup(
      cleanState({
        uncommitted: true,
        linkedPrs: [{ number: 1 }, { number: 2 }],
      }),
    );
    expect(s).toMatch(/keep/);
    expect(s).toContain(CLEANUP_BLOCKER.UNCOMMITTED);
    expect(s).toContain("2 open PRs");
  });
});
