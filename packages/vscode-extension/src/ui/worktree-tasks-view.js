/**
 * Worktree Tasks webview (P1 #9) — a singleton panel listing the repo's
 * agent task worktrees with change footprint + merge-conflict risk, and the
 * actions: New isolated task (integrated terminal running
 * `cc agent --worktree -p …`), Merge back (in the main checkout, aborted
 * clean on conflicts), and Discard (worktree remove + branch -D, confirmed).
 * All git runs through execFile with the repo paths from `git worktree
 * list`; worktree-tasks.js owns the argv/parsing. SDK-bound glue only.
 */
const { execFile } = require("child_process");
const {
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
  parseMergePreview,
  parseWorktreeList,
  summarizeShortstat,
} = require("../worktree-tasks.js");

let _panel = null;

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

async function snapshot(repoRoot) {
  const list = await runGit(buildWorktreeListArgs(), repoRoot);
  if (list.code !== 0) {
    return {
      type: "update",
      ok: false,
      error: list.stderr.trim() || "not a git repository",
    };
  }
  const rows = parseWorktreeList(list.stdout);
  const main = rows.find((r) => r.main);
  const tasks = rows.filter((r) => !r.main && r.isTask);
  const mainBranch = main?.branch || "HEAD";
  const enriched = [];
  for (const t of tasks) {
    const [status, ahead, stat, preview] = await Promise.all([
      runGit(buildStatusArgs(), t.path),
      runGit(buildAheadArgs(main?.head || "HEAD", t.branch), repoRoot),
      runGit(buildShortstatArgs(main?.head || "HEAD", t.branch), repoRoot),
      runGit(buildMergePreviewArgs(mainBranch, t.branch), repoRoot),
    ]);
    enriched.push({
      branch: t.branch,
      path: t.path,
      dirty: status.code === 0 && status.stdout.trim().length > 0,
      ahead: Number(ahead.stdout.trim()) || 0,
      stat: summarizeShortstat(stat.stdout),
      merge: parseMergePreview(preview),
    });
  }
  return {
    type: "update",
    ok: true,
    repoRoot,
    mainBranch,
    tasks: enriched,
  };
}

function post(payload) {
  if (_panel) _panel.webview.postMessage(payload);
}

function repoRootOf(vscode) {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
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
    refresh(vscode).catch(() => {});
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainWorktreeTasks",
    "ChainlessChain · Worktree Tasks",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml();
  _panel.webview.onDidReceiveMessage((msg) => {
    handleMessage(vscode, msg).catch(() => {});
  });
  _panel.onDidDispose(() => {
    _panel = null;
  });
  refresh(vscode).catch(() => {});
  return _panel;
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg.command !== "string") return;
  const repoRoot = repoRootOf(vscode);
  if (msg.command === "refresh") return refresh(vscode);

  if (msg.command === "newTask") {
    const task = await vscode.window.showInputBox({
      prompt:
        "Task for the isolated agent (runs in its own git worktree + branch)",
      placeHolder: "Fix the flaky retry test in packages/cli",
    });
    if (!task || !task.trim()) return;
    const { getResolvedCli } = require("../cli-binary");
    const cmd = buildNewTaskCommand(task, {
      command: getResolvedCli(),
      windows: process.platform === "win32",
    });
    const term = vscode.window.createTerminal({
      name: "cc worktree task",
      cwd: repoRoot,
    });
    term.show();
    term.sendText(cmd, true);
    post({
      type: "note",
      text: "task started in the integrated terminal — Refresh lists its worktree once created",
    });
    return;
  }

  if (msg.command === "merge") {
    // Merge in the MAIN checkout; a conflicted merge is aborted so the main
    // tree never stays half-merged — the user resolves via a normal merge.
    post({ type: "busy" });
    const res = await runGit(buildMergeArgs(msg.branch), repoRoot, 60000);
    if (res.code !== 0) {
      await runGit(buildMergeAbortArgs(), repoRoot);
      post(await snapshot(repoRoot));
      post({
        type: "note",
        text:
          `merge ${msg.branch} FAILED and was aborted — ` +
          (res.stderr.trim().split("\n").pop() || "conflicts") +
          ". Resolve manually: git merge " +
          msg.branch,
      });
      return;
    }
    post(await snapshot(repoRoot));
    post({
      type: "note",
      text: `merged ${msg.branch} into ${msg.mainBranch || "the current branch"} — the worktree row remains until you Discard it`,
    });
    return;
  }

  if (msg.command === "discard") {
    const ok = await vscode.window.showWarningMessage(
      `Discard worktree task ${msg.branch}? The worktree at ${msg.path} is removed ` +
        `and the branch is deleted — unmerged commits are LOST.`,
      { modal: true },
      "Discard",
    );
    if (ok !== "Discard") return;
    post({ type: "busy" });
    const rm = await runGit(buildWorktreeRemoveArgs(msg.path), repoRoot, 60000);
    const br = await runGit(buildBranchDeleteArgs(msg.branch), repoRoot);
    post(await snapshot(repoRoot));
    post({
      type: "note",
      text:
        rm.code === 0 && br.code === 0
          ? `discarded ${msg.branch}`
          : `discard hit an error — ${(rm.stderr + " " + br.stderr).trim().slice(0, 200)}`,
    });
    return;
  }
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function renderHtml() {
  const n = nonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';`;
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
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; padding:4px 10px; border-radius:4px; cursor:pointer; margin-right:4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground, #3a3d41);
               color: var(--vscode-button-secondaryForeground, #ccc); }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border,#333);
           vertical-align:middle; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  .ok { color:#3fb950; } .bad { color: var(--vscode-errorForeground,#f85149); }
  .warn { color: var(--vscode-editorWarning-foreground, orange); }
  .muted { opacity:.55; }
  .pill { font-size:10px; padding:1px 7px; border-radius:8px;
          background: var(--vscode-editorWidget-background);
          border:1px solid var(--vscode-widget-border, transparent); }
  #note { font-family: var(--vscode-editor-font-family); font-size:11px; opacity:.75;
          white-space:pre-wrap; margin-top:10px; }
  .err { color: var(--vscode-errorForeground,#f85149); }
</style>
</head>
<body>
  <h1>ChainlessChain · Worktree Tasks <span id="busy" class="muted"></span></h1>
  <div>
    <button id="new">New isolated task…</button>
    <button id="refresh" class="sec">Refresh</button>
    <span id="base" class="muted"></span>
  </div>
  <div id="body"></div>
  <div id="note"></div>

<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  let mainBranch = '';
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('new').addEventListener('click', ()=>vscode.postMessage({command:'newTask'}));

  function riskCell(m){
    if (!m || m.risk === 'unknown') return '<span class="muted">? (needs git ≥ 2.38)</span>';
    if (m.risk === 'clean') return '<span class="ok">clean</span>';
    const files = (m.files||[]).slice(0,3).join(', ');
    return '<span class="bad">conflicts</span> <span class="muted">'+esc(files)+((m.files||[]).length>3?' …':'')+'</span>';
  }

  function apply(m){
    document.getElementById('busy').textContent = '';
    const body = document.getElementById('body');
    if (!m.ok){ body.innerHTML = '<p class="err">'+esc(m.error||'unavailable')+'</p>'; return; }
    mainBranch = m.mainBranch || '';
    document.getElementById('base').textContent = 'base: '+mainBranch;
    if (!m.tasks.length){
      body.innerHTML = '<p class="muted">No agent task worktrees (cc-agent-* / batch/* / agent/*). “New isolated task…” starts one.</p>';
      return;
    }
    body.innerHTML = '<table><thead><tr><th>branch</th><th>changes</th><th>state</th><th>merge risk</th><th style="width:170px"></th></tr></thead><tbody>'
      + m.tasks.map(t => '<tr><td title="'+esc(t.path)+'">'+esc(t.branch)+'</td>'
        + '<td>'+esc(t.stat)+' <span class="muted">↑'+t.ahead+'</span></td>'
        + '<td>'+(t.dirty?'<span class="warn">working (dirty)</span>':'<span class="muted">idle</span>')+'</td>'
        + '<td>'+riskCell(t.merge)+'</td>'
        + '<td>'
        + '<button class="sec" data-act="merge" data-branch="'+esc(t.branch)+'"'+(t.dirty?' title="worktree has uncommitted changes — they will NOT be merged"':'')+'>Merge</button>'
        + '<button class="sec" data-act="discard" data-branch="'+esc(t.branch)+'" data-path="'+esc(t.path)+'">Discard</button>'
        + '</td></tr>').join('')
      + '</tbody></table>';
  }

  document.body.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act');
    if (act === 'merge') vscode.postMessage({command:'merge', branch: b.getAttribute('data-branch'), mainBranch});
    else if (act === 'discard') vscode.postMessage({command:'discard', branch: b.getAttribute('data-branch'), path: b.getAttribute('data-path')});
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'busy'){ document.getElementById('busy').textContent = '· working…'; return; }
    if (m.type === 'note'){ document.getElementById('note').textContent = m.text || ''; return; }
    if (m.type === 'update') apply(m);
  });
</script>
</body>
</html>`;
}

module.exports = { openWorktreeTasks };
