/**
 * Worktree Tasks webview (P1 #9 + P2 #3).
 *
 * Git is read-only here except for the existing, explicitly confirmed
 * worktree discard path. Merge preview, selective publish, conflict evidence,
 * and rollback are owned by `cc team merge-review`. The host strictly parses
 * that versioned projection, re-fetches it before a mutation, and accepts only
 * stable review/file/hunk IDs from the webview.
 */
const { execFile } = require("child_process");
const { runCliResult } = require("../chat/introspect-commands.js");
const {
  attachTaskGovernance,
  buildAheadArgs,
  buildBackgroundListArgs,
  buildBranchDeleteArgs,
  buildMergeReviewApplyArgs,
  buildMergeReviewPreviewArgs,
  buildMergeReviewRollbackArgs,
  buildMergeReviewShowArgs,
  buildNewTaskCommand,
  buildShortstatArgs,
  buildStatusArgs,
  buildWorktreeListArgs,
  buildWorktreeRemoveArgs,
  parseMergeReview,
  parseWorktreeList,
  selectMergeReviewActionArgs,
  summarizeShortstat,
  validateMergeReviewSelection,
} = require("../worktree-tasks.js");

const MERGE_REVIEW_ACTOR = "vscode-worktree-tasks";
const MAX_CACHED_REVIEWS = 32;

let _panel = null;
let _reviewBusy = false;
const _mergeReviews = new Map();

function runGit(args, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) =>
        resolve({
          code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        }),
    );
  });
}

function boundedText(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > max ||
    Array.from(trimmed).some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  return trimmed;
}

function safeError(error) {
  return (
    boundedText(error?.message || String(error || ""), 500) ||
    "merge-review request failed"
  );
}

function repoRootOf(vscode) {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
}

function post(payload) {
  if (_panel) _panel.webview.postMessage(payload);
}

function postNote(text, error = false) {
  post({ type: "note", text: String(text || ""), error });
}

async function snapshot(repoRoot) {
  const { getResolvedCli } = require("../cli-binary");
  const [list, background] = await Promise.all([
    runGit(buildWorktreeListArgs(), repoRoot),
    runCliResult({
      command: getResolvedCli() || "cc",
      args: buildBackgroundListArgs(),
      cwd: repoRoot,
      timeoutMs: 15000,
    }),
  ]);
  if (list.code !== 0) {
    return {
      type: "update",
      ok: false,
      error: list.stderr.trim() || "not a git repository",
    };
  }
  const rows = parseWorktreeList(list.stdout);
  const main = rows.find((row) => row.main);
  const tasks = rows.filter((row) => !row.main && row.isTask);
  const mainBranch = main?.branch || "HEAD";
  const enriched = await Promise.all(
    tasks.map(async (task) => {
      const [status, ahead, stat] = await Promise.all([
        runGit(buildStatusArgs(), task.path),
        runGit(buildAheadArgs(main?.head || "HEAD", task.branch), repoRoot),
        runGit(buildShortstatArgs(main?.head || "HEAD", task.branch), repoRoot),
      ]);
      return {
        branch: task.branch,
        path: task.path,
        dirty: status.code === 0 && status.stdout.trim().length > 0,
        ahead: Number(ahead.stdout.trim()) || 0,
        stat: summarizeShortstat(stat.stdout),
      };
    }),
  );
  return {
    type: "update",
    ok: true,
    repoRoot,
    mainBranch,
    tasks: attachTaskGovernance(enriched, background.stdout),
  };
}

async function resolveTaskAuthority(repoRoot, requestedBranch) {
  const branch = boundedText(requestedBranch, 512);
  if (!branch) throw new Error("invalid worktree task branch");
  const result = await runGit(buildWorktreeListArgs(), repoRoot);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "cannot read git worktrees");
  }
  const rows = parseWorktreeList(result.stdout);
  const main = rows.find((row) => row.main);
  const matches = rows.filter(
    (row) => !row.main && row.isTask && row.branch === branch,
  );
  if (!main || matches.length !== 1) {
    throw new Error(
      "worktree task identity is stale or ambiguous; refresh first",
    );
  }
  return { main, mainBranch: main.branch || "HEAD", task: matches[0] };
}

async function runMergeReview(repoRoot, args, expectedOperation) {
  const { getResolvedCli } = require("../cli-binary");
  const result = await runCliResult({
    command: getResolvedCli() || "cc",
    args,
    cwd: repoRoot,
    timeoutMs: 120000,
  });
  const parsed = parseMergeReview(result.stdout, { expectedOperation });
  if (!result.ok) {
    throw new Error(
      parsed.ok
        ? result.stderr || result.error || "merge-review CLI failed"
        : parsed.error,
    );
  }
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}

function ensureReviewMatchesTask(
  parsed,
  authority,
  { requireOids = true } = {},
) {
  const review = parsed.review;
  if (
    review.base.branch !== authority.mainBranch ||
    review.candidates.length !== 1 ||
    review.candidates[0].branch !== authority.task.branch
  ) {
    throw new Error("merge-review is not bound to the selected worktree task");
  }
  if (
    requireOids &&
    (review.base.oid !== authority.main.head ||
      review.candidates[0].oid !== authority.task.head)
  ) {
    throw new Error("worktree heads changed after review; preview again");
  }
}

function rememberReview(parsed) {
  const id = parsed.review.reviewId;
  _mergeReviews.delete(id);
  _mergeReviews.set(id, parsed);
  while (_mergeReviews.size > MAX_CACHED_REVIEWS) {
    _mergeReviews.delete(_mergeReviews.keys().next().value);
  }
}

function reviewForWebview(parsed) {
  return {
    type: "mergeReview",
    operation: parsed.operation,
    review: parsed.review,
    actions: parsed.actions.map(({ id, enabled, reason }) => ({
      id,
      enabled,
      reason,
    })),
  };
}

function postReview(parsed) {
  rememberReview(parsed);
  post(reviewForWebview(parsed));
}

function cachedReviewFromMessage(message, digestField) {
  const reviewId = boundedText(message.reviewId, 80);
  const cached = reviewId ? _mergeReviews.get(reviewId) : null;
  if (!cached) throw new Error("merge-review is not cached; preview again");
  if (
    message.revision !== cached.review.revision ||
    message[digestField] !== cached.review[digestField]
  ) {
    throw new Error("merge-review pins are stale; preview again");
  }
  return cached;
}

function ensureFreshPins(cached, fresh) {
  if (
    fresh.review.reviewId !== cached.review.reviewId ||
    fresh.review.revision !== cached.review.revision ||
    fresh.review.planDigest !== cached.review.planDigest ||
    fresh.review.evidenceDigest !== cached.review.evidenceDigest
  ) {
    throw new Error(
      "merge-review changed while awaiting approval; review it again",
    );
  }
}

function ensureForwardTransition(before, after, expectedState) {
  if (
    after.reviewId !== before.reviewId ||
    after.planDigest !== before.planDigest ||
    after.revision <= before.revision ||
    after.state !== expectedState
  ) {
    throw new Error(
      `merge-review did not make a valid transition to ${expectedState}`,
    );
  }
}

function sameIds(left, right) {
  return (
    left.length === right.length &&
    left.every((id) => right.includes(id)) &&
    right.every((id) => left.includes(id))
  );
}

function ensureApplySelectionAuthority(parsed, selection) {
  const { review } = parsed;
  const action = parsed.actions.find((candidate) => candidate.id === "apply");
  const resumable = ["planned", "prepared", "publishing"].includes(
    review.state,
  );
  if (!action || !resumable) {
    throw new Error(`merge-review state ${review.state} cannot be applied`);
  }
  if (!review.decision) {
    if (review.state !== "planned") {
      throw new Error("only a planned review may accept a new selection");
    }
    return;
  }
  if (
    !action.enabled ||
    !sameIds(selection.fileIds, review.selection.fileIds) ||
    !sameIds(selection.hunkIds, review.selection.hunkIds)
  ) {
    throw new Error(
      "merge-review already binds a different immutable selection",
    );
  }
}

async function withReviewLock(action) {
  if (_reviewBusy) {
    postNote("another merge-review operation is already running", true);
    return;
  }
  _reviewBusy = true;
  post({ type: "busy" });
  try {
    await action();
  } finally {
    _reviewBusy = false;
    post({ type: "idle" });
  }
}

async function previewMergeReview(repoRoot, message) {
  const authority = await resolveTaskAuthority(repoRoot, message.branch);
  const parsed = await runMergeReview(
    repoRoot,
    buildMergeReviewPreviewArgs({
      branch: authority.task.branch,
      base: authority.mainBranch,
      actor: MERGE_REVIEW_ACTOR,
      reason: "Previewed in VS Code Worktree Tasks",
    }),
    "preview",
  );
  ensureReviewMatchesTask(parsed, authority);
  postReview(parsed);
  postNote(
    `review ${parsed.review.reviewId} revision ${parsed.review.revision} is ready`,
  );
}

async function promptApplyReason(vscode) {
  const value = await vscode.window.showInputBox({
    prompt: "Reason for publishing this merge-review selection",
    placeHolder: "Reviewed conflicts and selected the intended changes",
    validateInput(input) {
      if (!input.trim()) return "A reason is required";
      if (!boundedText(input, 500))
        return "Use at most 500 printable characters";
      return null;
    },
  });
  return value == null ? null : boundedText(value, 500);
}

async function applyMergeReview(vscode, repoRoot, message) {
  const cached = cachedReviewFromMessage(message, "planDigest");
  const initialSelection = validateMergeReviewSelection(
    cached.review,
    message.fileIds,
    message.hunkIds,
  );
  if (!initialSelection.ok) throw new Error(initialSelection.error);
  ensureApplySelectionAuthority(cached, initialSelection);

  const reason = cached.review.decision
    ? cached.review.decision.reason
    : await promptApplyReason(vscode);
  if (!reason) return;
  const confirmation = await vscode.window.showWarningMessage(
    `Publish ${initialSelection.fileIds.length} file selection(s) and ` +
      `${initialSelection.hunkIds.length} hunk selection(s) from ` +
      `${cached.review.reviewId} revision ${cached.review.revision}?`,
    { modal: true },
    "Publish selection",
  );
  if (confirmation !== "Publish selection") return;

  const authority = await resolveTaskAuthority(
    repoRoot,
    cached.review.candidates[0].branch,
  );
  const fresh = await runMergeReview(
    repoRoot,
    buildMergeReviewShowArgs(cached.review.reviewId),
    "show",
  );
  ensureFreshPins(cached, fresh);
  ensureReviewMatchesTask(fresh, authority);
  const selection = validateMergeReviewSelection(
    fresh.review,
    initialSelection.fileIds,
    initialSelection.hunkIds,
  );
  if (!selection.ok) throw new Error(selection.error);
  ensureApplySelectionAuthority(fresh, selection);

  const expectedArgs = buildMergeReviewApplyArgs({
    reviewId: fresh.review.reviewId,
    revision: fresh.review.revision,
    planDigest: fresh.review.planDigest,
    fileIds: selection.fileIds,
    hunkIds: selection.hunkIds,
    actor: fresh.review.decision?.actor || MERGE_REVIEW_ACTOR,
    reason: fresh.review.decision?.reason || reason,
  });
  const args =
    selectMergeReviewActionArgs(fresh, "apply", expectedArgs) || expectedArgs;
  const applied = await runMergeReview(repoRoot, args, "apply");
  if (applied.review.state !== "published") {
    postReview(applied);
    post(await snapshot(repoRoot));
    throw new Error(
      `merge-review apply ended in ${applied.review.state}; inspect its conflict evidence`,
    );
  }
  ensureForwardTransition(fresh.review, applied.review, "published");
  postReview(applied);
  post(await snapshot(repoRoot));
  postNote(
    `published ${applied.review.reviewId}; evidence ${applied.review.evidenceDigest}`,
  );
}

async function rollbackMergeReview(vscode, repoRoot, message) {
  const cached = cachedReviewFromMessage(message, "evidenceDigest");
  const confirmation = await vscode.window.showWarningMessage(
    `Rollback published review ${cached.review.reviewId} revision ` +
      `${cached.review.revision}? Evidence ${cached.review.evidenceDigest} ` +
      "must still match.",
    { modal: true },
    "Rollback review",
  );
  if (confirmation !== "Rollback review") return;

  const fresh = await runMergeReview(
    repoRoot,
    buildMergeReviewShowArgs(cached.review.reviewId),
    "show",
  );
  ensureFreshPins(cached, fresh);
  const expectedArgs = buildMergeReviewRollbackArgs({
    reviewId: fresh.review.reviewId,
    revision: fresh.review.revision,
    evidenceDigest: fresh.review.evidenceDigest,
  });
  const args =
    selectMergeReviewActionArgs(fresh, "rollback", expectedArgs) ||
    expectedArgs;
  const rolledBack = await runMergeReview(repoRoot, args, "rollback");
  ensureForwardTransition(fresh.review, rolledBack.review, "rolled_back");
  postReview(rolledBack);
  post(await snapshot(repoRoot));
  postNote(
    `rolled back ${rolledBack.review.reviewId}; evidence ${rolledBack.review.evidenceDigest}`,
  );
}

async function refresh(vscode) {
  const repoRoot = repoRootOf(vscode);
  if (!repoRoot) {
    post({ type: "update", ok: false, error: "open a folder first" });
    return;
  }
  post({ type: "busy" });
  post(await snapshot(repoRoot));
}

function openWorktreeTasks(vscode) {
  if (_panel) {
    _panel.reveal();
    refresh(vscode).catch((error) => postNote(safeError(error), true));
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainWorktreeTasks",
    "ChainlessChain · Worktree Tasks",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml();
  _panel.webview.onDidReceiveMessage((message) => {
    handleMessage(vscode, message).catch((error) => {
      postNote(safeError(error), true);
    });
  });
  _panel.onDidDispose(() => {
    _panel = null;
    _reviewBusy = false;
    _mergeReviews.clear();
  });
  refresh(vscode).catch((error) => postNote(safeError(error), true));
  return _panel;
}

async function handleMessage(vscode, message) {
  if (!message || typeof message.command !== "string") return;
  const repoRoot = repoRootOf(vscode);
  if (message.command === "refresh") return refresh(vscode);
  if (!repoRoot) throw new Error("open a folder first");

  if (message.command === "newTask") {
    const task = await vscode.window.showInputBox({
      prompt:
        "Task for the isolated agent (runs in its own git worktree + branch)",
      placeHolder: "Fix the flaky retry test in packages/cli",
    });
    if (!task || !task.trim()) return;
    const { getResolvedCli } = require("../cli-binary");
    const command = buildNewTaskCommand(task, {
      command: getResolvedCli() || "cc",
      windows: process.platform === "win32",
    });
    const terminal = vscode.window.createTerminal({
      name: "cc worktree task",
      cwd: repoRoot,
    });
    terminal.show();
    terminal.sendText(command, true);
    postNote(
      "task started in the integrated terminal; Refresh lists its worktree once created",
    );
    return;
  }

  if (message.command === "mergeReviewPreview") {
    return withReviewLock(() => previewMergeReview(repoRoot, message));
  }
  if (message.command === "mergeReviewApply") {
    return withReviewLock(() => applyMergeReview(vscode, repoRoot, message));
  }
  if (message.command === "mergeReviewRollback") {
    return withReviewLock(() => rollbackMergeReview(vscode, repoRoot, message));
  }

  if (message.command === "discard") {
    const authority = await resolveTaskAuthority(repoRoot, message.branch);
    const ok = await vscode.window.showWarningMessage(
      `Discard worktree task ${authority.task.branch}? The worktree at ` +
        `${authority.task.path} is removed and the branch is deleted; ` +
        "unmerged commits are LOST.",
      { modal: true },
      "Discard",
    );
    if (ok !== "Discard") return;
    post({ type: "busy" });
    const remove = await runGit(
      buildWorktreeRemoveArgs(authority.task.path),
      repoRoot,
      60000,
    );
    const branch = await runGit(
      buildBranchDeleteArgs(authority.task.branch),
      repoRoot,
    );
    post(await snapshot(repoRoot));
    postNote(
      remove.code === 0 && branch.code === 0
        ? `discarded ${authority.task.branch}`
        : `discard hit an error: ${(remove.stderr + " " + branch.stderr)
            .trim()
            .slice(0, 200)}`,
      remove.code !== 0 || branch.code !== 0,
    );
  }
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function renderHtml() {
  const value = nonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${value}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 16px; font-size: 13px; }
  h1 { font-size: 16px; margin: 0 0 10px; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  h3 { font-size: 13px; margin: 10px 0 4px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; margin-right: 4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { cursor: default; opacity: .45; }
  button.sec { background: var(--vscode-button-secondaryBackground, #3a3d41);
               color: var(--vscode-button-secondaryForeground, #ccc); }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border, #333);
           vertical-align: middle; }
  th { opacity: .6; font-weight: 500; font-size: 11px; }
  code { font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; }
  .ok { color: #3fb950; }
  .bad, .err { color: var(--vscode-errorForeground, #f85149); }
  .warn { color: var(--vscode-editorWarning-foreground, orange); }
  .muted { opacity: .62; }
  .pill { font-size: 10px; padding: 1px 7px; border-radius: 8px;
          background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-widget-border, transparent); }
  #note { font-family: var(--vscode-editor-font-family); font-size: 11px;
          white-space: pre-wrap; margin-top: 10px; }
  #review { display: none; border: 1px solid var(--vscode-widget-border, #444);
            margin-top: 14px; padding: 12px; border-radius: 5px; }
  .review-meta { display: grid; grid-template-columns: max-content 1fr; gap: 3px 9px; }
  .conflict { border-left: 3px solid var(--vscode-editorWarning-foreground, orange);
              padding: 5px 8px; margin: 5px 0; background: var(--vscode-editorWidget-background); }
  .file { border-top: 1px solid var(--vscode-widget-border, #444); padding: 7px 0; }
  .hunk { margin-left: 24px; padding-top: 4px; }
  .review-actions { margin-top: 10px; }
</style>
</head>
<body>
  <h1>ChainlessChain · Worktree Tasks <span id="busy" class="muted"></span></h1>
  <div>
    <button id="new">New isolated task…</button>
    <button id="refresh" class="sec">Refresh</button>
    <span id="base" class="muted"></span>
  </div>
  <div id="tasks"></div>
  <section id="review"></section>
  <div id="note"></div>

<script nonce="${value}">
  const vscode = acquireVsCodeApi();
  let mergeReview = null;
  function esc(input) {
    return String(input == null ? '' : input).replace(/[&<>"]/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character];
    });
  }
  function actionById(id) {
    return mergeReview && (mergeReview.actions || []).find(function (action) { return action.id === id; });
  }
  function applyMode() {
    const review = mergeReview && mergeReview.review;
    const action = actionById('apply');
    if (!review || !action || !['planned', 'prepared', 'publishing'].includes(review.state)) {
      return {choose:false, apply:false};
    }
    const choose = review.state === 'planned' && !review.decision;
    return {choose:choose, apply:choose || action.enabled};
  }
  function governanceCell(task) {
    const managedId = task.managedTaskId || task.backgroundId;
    if (!managedId) return '<span class="muted">unmanaged</span>';
    const budget = task.resourceBudget || {};
    const effects = task.sideEffects || {};
    const budgetText = [
      budget.maxTurns ? 'turns ' + budget.maxTurns : '',
      budget.maxCostUsd ? '$' + budget.maxCostUsd : '',
      budget.maxTasks ? 'tasks ' + budget.maxTasks : '',
      budget.maxTokens ? 'tokens ' + budget.maxTokens : ''
    ].filter(Boolean).join(' / ') || 'unbounded';
    const effectText = Number(effects.total || 0)
      ? 'effects ' + Number(effects.total || 0) + ' / unsettled ' + Number(effects.unsettled || 0)
        + ' / unknown ' + Number(effects.unknown || 0)
      : 'no effects';
    return '<span class="pill">' + esc(task.permissionMode || 'default') + '</span> '
      + '<span class="muted">' + esc(task.owner || managedId) + '</span><br>'
      + '<span class="muted">' + esc(budgetText) + ' · ' + esc(effectText) + '</span>';
  }
  function renderTasks(message) {
    document.getElementById('busy').textContent = '';
    const tasks = document.getElementById('tasks');
    if (!message.ok) {
      tasks.innerHTML = '<p class="err">' + esc(message.error || 'unavailable') + '</p>';
      return;
    }
    document.getElementById('base').textContent = 'base: ' + (message.mainBranch || 'HEAD');
    if (!message.tasks.length) {
      tasks.innerHTML = '<p class="muted">No agent task worktrees (cc-agent-* / batch/* / agent/* / team/*).</p>';
      return;
    }
    tasks.innerHTML = '<table><thead><tr><th>branch</th><th>changes</th><th>state</th>'
      + '<th>governance</th><th style="width:190px"></th></tr></thead><tbody>'
      + message.tasks.map(function (task) {
        const status = task.managementStatus || task.backgroundStatus;
        const state = status
          ? '<span class="' + (status === 'failed' || status === 'lost' ? 'bad' : 'ok') + '">' + esc(status) + '</span>'
          : (task.dirty ? '<span class="warn">working (dirty)</span>' : '<span class="muted">idle</span>');
        return '<tr><td title="' + esc(task.path) + '">' + esc(task.branch) + '</td>'
          + '<td>' + esc(task.stat) + ' <span class="muted">↑' + Number(task.ahead || 0) + '</span></td>'
          + '<td>' + state + '</td><td>' + governanceCell(task) + '</td><td>'
          + '<button class="sec" data-act="preview" data-branch="' + esc(task.branch) + '"'
          + (task.dirty ? ' title="Uncommitted worktree changes are not part of the branch review"' : '')
          + '>Review merge…</button>'
          + '<button class="sec" data-act="discard" data-branch="' + esc(task.branch) + '">Discard</button>'
          + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function syncSelection() {
    const section = document.getElementById('review');
    const mode = applyMode();
    section.querySelectorAll('input[data-kind="file"]').forEach(function (file) {
      section.querySelectorAll('input[data-kind="hunk"][data-owner="' + file.dataset.id + '"]').forEach(function (hunk) {
        if (file.checked) hunk.checked = false;
        hunk.disabled = file.checked || !mode.choose;
      });
      file.disabled = !mode.choose;
    });
    const selected = section.querySelectorAll('input[data-kind]:checked').length;
    const apply = document.getElementById('apply-review');
    if (apply) apply.disabled = !mode.apply || selected === 0;
  }
  function renderReview(message) {
    mergeReview = message;
    const review = message.review;
    const section = document.getElementById('review');
    const applyAction = (message.actions || []).find(function (action) { return action.id === 'apply'; });
    const rollbackAction = (message.actions || []).find(function (action) { return action.id === 'rollback'; });
    const selectedFiles = new Set(review.selection.fileIds || []);
    const selectedHunks = new Set(review.selection.hunkIds || []);
    const canChoose = Boolean(applyAction) && review.state === 'planned' && !review.decision;
    const conflicts = (review.conflicts || []).length
      ? '<h3>Conflicts and explanations</h3>' + review.conflicts.map(function (conflict) {
          return '<div class="conflict"><strong>' + esc(conflict.type) + '</strong> · <code>' + esc(conflict.path) + '</code>'
            + '<div>' + esc(conflict.explanation) + '</div>'
            + (conflict.suggestion ? '<div class="muted">Suggestion: ' + esc(conflict.suggestion) + '</div>' : '')
            + (conflict.hunkIds.length ? '<div class="muted">Hunks: ' + conflict.hunkIds.map(esc).join(', ') + '</div>' : '')
            + '</div>';
        }).join('')
      : '<p class="ok">No conflicts reported by the CLI review.</p>';
    const files = (review.files || []).length
      ? review.files.map(function (file) {
          const hunks = file.hunks.map(function (hunk) {
            return '<label class="hunk"><input type="checkbox" data-kind="hunk" data-id="' + esc(hunk.id)
              + '" data-owner="' + esc(file.id) + '" ' + (selectedHunks.has(hunk.id) ? 'checked ' : '')
              + (!canChoose || selectedFiles.has(file.id) ? 'disabled ' : '') + '/> '
              + '<code>' + esc(hunk.header) + '</code> <span class="muted">' + esc(hunk.id) + '</span></label>';
          }).join('<br>');
          return '<div class="file"><label><input type="checkbox" data-kind="file" data-id="' + esc(file.id) + '" '
            + (selectedFiles.has(file.id) ? 'checked ' : '') + (!canChoose ? 'disabled ' : '') + '/> '
            + '<strong>' + esc(file.status) + '</strong> <code>' + esc(file.path) + '</code>'
            + (file.binary ? ' <span class="pill">binary</span>' : '') + '</label>'
            + '<div class="muted">' + esc(file.id) + '</div>' + hunks + '</div>';
        }).join('')
      : '<p class="muted">This review contains no selectable files.</p>';
    const canRollback = rollbackAction && rollbackAction.enabled
      && (review.state === 'published' || review.state === 'rollback_required');
    const disabledReason = [applyAction && !applyAction.enabled && !canChoose ? applyAction.reason : '', rollbackAction && !rollbackAction.enabled ? rollbackAction.reason : '']
      .filter(Boolean).join(' · ');
    section.style.display = 'block';
    section.innerHTML = '<h2>CLI merge review</h2><div class="review-meta">'
      + '<span class="muted">Review</span><code>' + esc(review.reviewId) + '</code>'
      + '<span class="muted">Revision / state</span><span>' + Number(review.revision) + ' / <strong>' + esc(review.state) + '</strong></span>'
      + '<span class="muted">Base</span><code>' + esc(review.base.branch) + ' @ ' + esc(review.base.oid) + '</code>'
      + '<span class="muted">Candidates</span><span>' + review.candidates.map(function (candidate) { return '<code>' + esc(candidate.branch) + ' @ ' + esc(candidate.oid) + '</code>'; }).join('<br>') + '</span>'
      + '<span class="muted">Plan digest</span><code>' + esc(review.planDigest) + '</code>'
      + '<span class="muted">Evidence digest</span><code>' + esc(review.evidenceDigest) + '</code></div>'
      + conflicts + '<h3>Files and hunks</h3>' + files
      + '<div class="review-actions"><button id="apply-review" ' + (!applyAction || !applyAction.enabled ? 'disabled ' : '') + '>Publish selected</button>'
      + '<button id="rollback-review" class="sec" ' + (!canRollback ? 'disabled ' : '') + '>Rollback</button></div>'
      + (disabledReason ? '<p class="muted">' + esc(disabledReason) + '</p>' : '');
    syncSelection();
  }
  document.getElementById('refresh').addEventListener('click', function () { vscode.postMessage({command:'refresh'}); });
  document.getElementById('new').addEventListener('click', function () { vscode.postMessage({command:'newTask'}); });
  document.body.addEventListener('change', function (event) {
    if (event.target.matches('input[data-kind]')) syncSelection();
  });
  document.body.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const action = button.getAttribute('data-act');
    if (action === 'preview') {
      vscode.postMessage({command:'mergeReviewPreview', branch:button.getAttribute('data-branch')});
    } else if (action === 'discard') {
      vscode.postMessage({command:'discard', branch:button.getAttribute('data-branch')});
    } else if (button.id === 'apply-review' && mergeReview) {
      const section = document.getElementById('review');
      const fileIds = Array.from(section.querySelectorAll('input[data-kind="file"]:checked')).map(function (input) { return input.dataset.id; });
      const hunkIds = Array.from(section.querySelectorAll('input[data-kind="hunk"]:checked')).map(function (input) { return input.dataset.id; });
      vscode.postMessage({command:'mergeReviewApply', reviewId:mergeReview.review.reviewId,
        revision:mergeReview.review.revision, planDigest:mergeReview.review.planDigest, fileIds:fileIds, hunkIds:hunkIds});
    } else if (button.id === 'rollback-review' && mergeReview) {
      vscode.postMessage({command:'mergeReviewRollback', reviewId:mergeReview.review.reviewId,
        revision:mergeReview.review.revision, evidenceDigest:mergeReview.review.evidenceDigest});
    }
  });
  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message) return;
    if (message.type === 'busy') { document.getElementById('busy').textContent = '· working…'; return; }
    if (message.type === 'idle') { document.getElementById('busy').textContent = ''; return; }
    if (message.type === 'note') {
      const note = document.getElementById('note');
      note.className = message.error ? 'err' : '';
      note.textContent = message.text || '';
      return;
    }
    if (message.type === 'update') renderTasks(message);
    if (message.type === 'mergeReview') renderReview(message);
  });
</script>
</body>
</html>`;
}

module.exports = { openWorktreeTasks };
