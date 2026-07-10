/**
 * Worktree parallel tasks (P1 #9) — pure logic for the Worktree Tasks panel.
 * Enumerates the repo's agent task worktrees (`cc agent --worktree` →
 * cc-agent-*, `cc batch` → batch/*, team isolation → agent/*), sizes their
 * changes, previews merge-conflict risk via `git merge-tree --write-tree`
 * (git ≥ 2.38 — the same plumbing the CLI's previewWorktreeMerge uses), and
 * builds the git argv for merge / discard plus the `cc agent --worktree`
 * terminal command for a NEW isolated task. All plain git — the CLI does not
 * expose its worktree lib as commands, and these are standard operations.
 */

const TASK_BRANCH_RE = /^(cc-agent-|batch\/|agent\/)/;

function isTaskBranch(branch) {
  return TASK_BRANCH_RE.test(String(branch || ""));
}

/** `git worktree list --porcelain`. */
function buildWorktreeListArgs() {
  return ["worktree", "list", "--porcelain"];
}

/**
 * Parse `git worktree list --porcelain` into rows. The FIRST entry is the
 * main checkout; `isTask` marks agent-task branches. Bare/detached entries
 * are kept (branch "") so the caller can ignore them explicitly.
 */
function parseWorktreeList(text) {
  const rows = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) rows.push(current);
      current = { path: line.slice(9).trim(), branch: "", head: "" };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).trim().replace("refs/heads/", "");
    }
  }
  if (current) rows.push(current);
  return rows.map((r, i) => ({
    ...r,
    main: i === 0,
    isTask: isTaskBranch(r.branch),
  }));
}

/** `git status --porcelain` (run inside the worktree) — dirty check. */
function buildStatusArgs() {
  return ["status", "--porcelain"];
}

/** `git rev-list --count <mainHead>..<branch>` — commits the task is ahead. */
function buildAheadArgs(mainHead, branch) {
  return ["rev-list", "--count", `${mainHead}..${branch}`];
}

/** `git diff --shortstat <mainHead>...<branch>` — change footprint. */
function buildShortstatArgs(mainHead, branch) {
  return ["diff", "--shortstat", `${mainHead}...${branch}`];
}

/**
 * `git merge-tree --write-tree <mainBranch> <branch>` — conflict preview
 * WITHOUT touching any working tree (git ≥ 2.38; exit 1 = conflicts).
 */
function buildMergePreviewArgs(mainBranch, branch) {
  return ["merge-tree", "--write-tree", "--name-only", mainBranch, branch];
}

/** `git merge --no-ff <branch>` (run in the MAIN checkout). */
function buildMergeArgs(branch) {
  return ["merge", "--no-ff", String(branch)];
}

function buildMergeAbortArgs() {
  return ["merge", "--abort"];
}

/** Discard step 1: `git worktree remove --force <path>`. */
function buildWorktreeRemoveArgs(path) {
  return ["worktree", "remove", "--force", String(path)];
}

/** Discard step 2: `git branch -D <branch>`. */
function buildBranchDeleteArgs(branch) {
  return ["branch", "-D", String(branch)];
}

/**
 * Interpret merge-tree output + exit code: clean (mergeable), conflicted
 * (with the conflicted file list), or unknown (older git without
 * --write-tree — callers show "?" instead of guessing).
 */
function parseMergePreview({ code, stdout, stderr } = {}) {
  const err = String(stderr || "");
  if (/unknown option|usage: git merge-tree/i.test(err)) {
    return { risk: "unknown", files: [] };
  }
  if (code === 0) return { risk: "clean", files: [] };
  // --write-tree exit 1: line 1 = tree OID, then conflicted file names
  // (--name-only), separated from the informational section by a blank line.
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .slice(1);
  const files = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) break;
    files.push(s);
  }
  return { risk: "conflict", files };
}

/** "3 files changed, 40 insertions(+), 2 deletions(-)" → compact "+40 −2 (3 files)". */
function summarizeShortstat(text) {
  const s = String(text || "").trim();
  if (!s) return "no diff";
  const files = /(\d+) files? changed/.exec(s);
  const ins = /(\d+) insertions?\(\+\)/.exec(s);
  const del = /(\d+) deletions?\(-\)/.exec(s);
  return (
    `+${ins ? ins[1] : 0} −${del ? del[1] : 0}` +
    (files ? ` (${files[1]} file${files[1] === "1" ? "" : "s"})` : "")
  );
}

/**
 * The terminal command for a NEW isolated task. Runs interactively in the
 * integrated terminal (`--bg --worktree` is rejected by the CLI), so the
 * user watches/interrupts it; the worktree row appears on the next refresh.
 * The task is single-quoted for POSIX shells and double-quoted for
 * cmd/PowerShell — quotes in the task itself are stripped rather than
 * escaped (shell-escaping across three shells is not worth a prompt char).
 */
function buildNewTaskCommand(task, { command = "cc", windows = false } = {}) {
  const clean = String(task || "")
    .replace(/["'`\\]/g, " ")
    .trim();
  return windows
    ? `${command} agent --worktree -p "${clean}"`
    : `${command} agent --worktree -p '${clean}'`;
}

module.exports = {
  buildAheadArgs,
  buildBranchDeleteArgs,
  buildMergeAbortArgs,
  buildMergeArgs,
  buildMergePreviewArgs,
  buildNewTaskCommand,
  buildShortstatArgs,
  buildStatusArgs,
  buildWorktreeListArgs,
  buildWorktreeRemoveArgs,
  isTaskBranch,
  parseMergePreview,
  parseWorktreeList,
  summarizeShortstat,
};
