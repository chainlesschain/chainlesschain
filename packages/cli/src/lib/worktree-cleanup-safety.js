/**
 * Worktree cleanup-safety gate — the fail-closed pre-removal check from P1-5
 * (统一后台 Agent / Worktree 工作台) of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md:
 *
 *   "清理前检查未提交修改、未追踪文件、未 Push Commit 和关联 PR。"
 *
 * [[agent-worktree.js]] `finishAgentWorktree()` already refuses to remove a
 * worktree with uncommitted changes or new commits, but it collapses "dirty"
 * into one flag and does NOT distinguish untracked files, does NOT know whether
 * commits were pushed, and has no notion of a linked PR — so a background agent
 * that committed + pushed but left an OPEN PR, or left brand-new untracked
 * scratch files, could still be reaped by a broader sweep.
 *
 * This module is the PURE decision behind any worktree reaper: given a plain
 * state descriptor (whatever the caller gathered from `git status --porcelain`,
 * `git rev-list @{u}..HEAD`, the PR store, …) it returns whether the worktree is
 * safe to remove, and — like [[pr-automation-policy.js]] — it EXHAUSTIVELY
 * collects every blocker so the caller can show the user all of them at once.
 *
 * Everything defaults to KEEP: an unreadable or under-described worktree is
 * never removed, because we must never destroy work we cannot verify is safe to
 * lose (the same invariant `finishAgentWorktree` guards with its try/catch).
 */

/** Named blockers — one per reason a worktree must be kept, not reaped. */
export const CLEANUP_BLOCKER = Object.freeze({
  UNVERIFIABLE: "unverifiable", // git state could not be read → fail-closed keep
  UNCOMMITTED: "uncommitted-changes", // tracked files modified but not committed
  UNTRACKED: "untracked-files", // new files git isn't tracking yet
  UNPUSHED: "unpushed-commits", // commits beyond base not on any remote
  LINKED_PR: "linked-pr", // an open PR references this branch
});

const BLOCKER_REASON = Object.freeze({
  [CLEANUP_BLOCKER.UNVERIFIABLE]:
    "git state could not be read — refusing to remove work that cannot be verified safe to lose",
  [CLEANUP_BLOCKER.UNCOMMITTED]: "tracked files have uncommitted modifications",
  [CLEANUP_BLOCKER.UNTRACKED]: "untracked files would be lost on removal",
  [CLEANUP_BLOCKER.UNPUSHED]:
    "commits beyond the base are not pushed to any remote",
  [CLEANUP_BLOCKER.LINKED_PR]:
    "an open pull request still references this branch",
});

function toCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function prList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((p) => p != null);
}

/**
 * Decide whether commits on this worktree are unpushed. A worktree whose HEAD
 * equals its base has no new commits. Otherwise: with a known upstream, unpushed
 * iff `aheadCount > 0`; WITHOUT a known upstream, any divergence from base is
 * treated as unpushed (there is nowhere it could have been pushed to) — the
 * fail-closed reading.
 */
function commitsAreUnpushed(state) {
  const { baseSha, headSha, hasUpstream, aheadCount } = state;
  const hasNewCommits =
    headSha != null && baseSha != null && String(headSha) !== String(baseSha);
  if (!hasNewCommits) {
    // Base/head unknown but the caller told us we're ahead → still unpushed.
    return toCount(aheadCount) > 0;
  }
  if (hasUpstream === true) return toCount(aheadCount) > 0;
  return true; // new commits + no upstream → nowhere pushed
}

/**
 * Evaluate a worktree's cleanup safety. EXHAUSTIVE + fail-closed.
 *
 * @param {object} state
 * @param {boolean} [state.readable]      false / omitted when git status could not be read
 * @param {boolean} [state.uncommitted]   tracked modifications present
 * @param {boolean} [state.untracked]     untracked files present
 * @param {string}  [state.baseSha]       worktree base commit
 * @param {string}  [state.headSha]       worktree HEAD commit
 * @param {boolean} [state.hasUpstream]   branch has a configured upstream
 * @param {number}  [state.aheadCount]    commits ahead of upstream
 * @param {Array}   [state.linkedPrs]     open PRs referencing this branch
 * @returns {{safeToRemove:boolean, blockers:string[], reasons:object}}
 */
export function evaluateWorktreeCleanup(state = {}) {
  const blockers = [];

  // Unverifiable state is the hard fail-closed gate: if we could not read the
  // worktree, we cannot prove anything else, so keep and report only this.
  if (state.readable === false) {
    blockers.push(CLEANUP_BLOCKER.UNVERIFIABLE);
    return finalize(blockers);
  }

  if (state.uncommitted === true) blockers.push(CLEANUP_BLOCKER.UNCOMMITTED);
  if (state.untracked === true) blockers.push(CLEANUP_BLOCKER.UNTRACKED);
  if (commitsAreUnpushed(state)) blockers.push(CLEANUP_BLOCKER.UNPUSHED);
  if (prList(state.linkedPrs).length > 0)
    blockers.push(CLEANUP_BLOCKER.LINKED_PR);

  return finalize(blockers);
}

function finalize(blockers) {
  const reasons = {};
  for (const b of blockers) reasons[b] = BLOCKER_REASON[b];
  return {
    safeToRemove: blockers.length === 0,
    blockers,
    reasons,
  };
}

/**
 * A human-readable one-line summary of a cleanup decision — never echoes file
 * contents or PR bodies, only counts and named blockers.
 */
export function summarizeWorktreeCleanup(state = {}) {
  const { safeToRemove, blockers } = evaluateWorktreeCleanup(state);
  if (safeToRemove)
    return "safe to remove — no uncommitted, untracked, unpushed or PR-linked work";
  const parts = blockers.map((b) => {
    if (b === CLEANUP_BLOCKER.LINKED_PR) {
      const n = prList(state.linkedPrs).length;
      return `${n} open PR${n === 1 ? "" : "s"}`;
    }
    return b;
  });
  return `keep — ${parts.join(", ")}`;
}
