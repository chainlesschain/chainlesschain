/**
 * Read-only "cc team" monitor webview: renders the parsed team-state snapshot
 * (task table + status counts + budget) and live-refreshes when the watched
 * `--state` file changes on disk. A singleton panel; the extension re-reads +
 * re-parses the file (team-monitor.js) and posts a fresh snapshot. SDK-bound
 * (`vscode` + fs).
 */
const fs = require("fs");
const { parseTeamState, summarizeTeam } = require("../team-monitor.js");

let _panel = null;
let _watcher = null;
let _debounce = null;
let _statePath = null;

/** Read + parse the state file into the webview payload (never throws). */
function snapshot(statePath) {
  let parsed;
  try {
    parsed = parseTeamState(fs.readFileSync(statePath, "utf8"));
  } catch (e) {
    parsed = { ok: false, error: `cannot read file: ${e.message}` };
  }
  if (!parsed.ok) {
    return { type: "update", ok: false, error: parsed.error, path: statePath };
  }
  return {
    type: "update",
    ok: true,
    path: statePath,
    tasks: parsed.tasks,
    summary: summarizeTeam(parsed),
    members: parsed.members,
    budget: parsed.budget,
  };
}

function post(statePath) {
  if (_panel) _panel.webview.postMessage(snapshot(statePath));
}

/**
 * Open (or reveal) the monitor for `statePath`, watching it for changes.
 * Switching to a different file re-points the watcher on the same panel.
 */
function openTeamMonitor(vscode, statePath) {
  _statePath = statePath;
  if (_panel) {
    _panel.reveal();
    rewatch(vscode);
    post(_statePath);
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainTeamMonitor",
    "ChainlessChain · Team",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml(_panel.webview);
  _panel.webview.onDidReceiveMessage((msg) => {
    if (msg && msg.command === "refresh") post(_statePath);
  });
  _panel.onDidDispose(() => {
    stopWatch();
    _panel = null;
    _statePath = null;
  });
  rewatch(vscode);
  post(_statePath);
  return _panel;
}

/** (Re)install the fs.watch on the current state file, debounced. */
function rewatch(vscode) {
  stopWatch();
  try {
    // fs.watch fires bursts (write + rename on the atomic tmp→final swap);
    // debounce to one re-read per settle. The file is replaced via rename, so
    // watch the FILE — some platforms drop the watch after a rename, so fall
    // back to re-arming on each event.
    _watcher = fs.watch(_statePath, () => {
      if (_debounce) clearTimeout(_debounce);
      _debounce = setTimeout(() => {
        post(_statePath);
        // Re-arm: after an atomic rename the old inode's watch is dead on Linux.
        try {
          _watcher?.close();
        } catch {
          /* ignore */
        }
        try {
          rewatch(vscode);
        } catch {
          /* file may be mid-swap — the next manual refresh recovers */
        }
      }, 150);
    });
  } catch {
    // Unwatchable (deleted / permissions) — the panel still shows the last
    // snapshot and the Refresh button re-reads on demand.
  }
}

function stopWatch() {
  if (_debounce) {
    clearTimeout(_debounce);
    _debounce = null;
  }
  if (_watcher) {
    try {
      _watcher.close();
    } catch {
      /* ignore */
    }
    _watcher = null;
  }
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function renderHtml(webview) {
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
  h1 { font-size: 16px; margin: 0 0 4px; }
  .path { opacity:.55; font-size:11px; margin-bottom:12px; word-break:break-all;
          font-family: var(--vscode-editor-font-family); }
  .row { display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; padding:5px 12px; border-radius:4px; cursor:pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .bar { height:8px; border-radius:5px; background: var(--vscode-editorWidget-background);
         overflow:hidden; flex:1; min-width:120px; }
  .bar > span { display:block; height:100%; background:#3fb950; width:0; transition:width .2s; }
  .cards { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .card { background: var(--vscode-editorWidget-background);
          border:1px solid var(--vscode-widget-border, transparent); border-radius:6px;
          padding:8px 14px; min-width:74px; }
  .card .k { opacity:.65; font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:18px; font-weight:600; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin-top:4px; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border, #333);
           vertical-align:top; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  .st { font-weight:600; }
  .st.completed { color:#3fb950; } .st.in_progress { color: var(--vscode-charts-blue,#3794ff); }
  .st.blocked, .st.cancelled { color: var(--vscode-errorForeground,#f85149); }
  .st.pending { opacity:.7; }
  .stale { color: var(--vscode-editorWarning-foreground, orange); }
  .muted { opacity:.55; } code { background: var(--vscode-textCodeBlock-background); padding:0 4px; border-radius:3px; }
  .err { color: var(--vscode-errorForeground,#f85149); }
</style>
</head>
<body>
  <h1>ChainlessChain · Team monitor</h1>
  <div class="path" id="path"></div>
  <div class="row">
    <div class="bar"><span id="prog"></span></div>
    <span id="pct" class="muted">—</span>
    <button id="refresh">Refresh</button>
  </div>
  <div class="cards" id="cards"></div>
  <div id="body"></div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  const ORDER = ['in_progress','pending','blocked','completed','cancelled'];
  function card(k, v){ return '<div class="card"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>'; }
  function apply(m){
    document.getElementById('path').textContent = m.path || '';
    const body = document.getElementById('body');
    if (!m.ok){
      document.getElementById('cards').innerHTML = '';
      document.getElementById('pct').textContent = '';
      document.getElementById('prog').style.width = '0';
      body.innerHTML = '<p class="err">'+esc(m.error||'unreadable state file')+'</p>';
      return;
    }
    const s = m.summary || { counts:{}, total:0, donePct:0, active:0, stale:0 };
    document.getElementById('prog').style.width = (s.donePct||0)+'%';
    document.getElementById('pct').textContent = (s.donePct||0)+'% · '+(s.counts.completed||0)+'/'+s.total+' done';
    let cards = card('tasks', s.total) + card('active', s.active);
    if (s.stale) cards += card('stale lease', s.stale);
    cards += card('blocked', s.counts.blocked||0) + card('done', s.counts.completed||0);
    document.getElementById('cards').innerHTML = cards;
    const tasks = (m.tasks||[]).slice().sort((a,b)=> ORDER.indexOf(a.status)-ORDER.indexOf(b.status));
    if (!tasks.length){ body.innerHTML = '<p class="muted">No tasks in this state file yet.</p>'; return; }
    const rows = tasks.map(t => {
      const dep = (t.dependsOn||[]).length ? '<span class="muted">⇠ '+esc(t.dependsOn.join(', '))+'</span>' : '';
      const holder = t.holder ? esc(t.holder) : '<span class="muted">—</span>';
      const attempts = t.attempts>1 ? ' <span class="muted">×'+t.attempts+'</span>' : '';
      return '<tr><td class="st '+esc(t.status)+'">'+esc(t.status)+'</td>'
        + '<td>'+esc(t.title)+attempts+' '+dep+'</td>'
        + '<td>'+holder+'</td></tr>';
    });
    body.innerHTML = '<table><thead><tr><th style="width:96px">status</th><th>task</th><th style="width:120px">holder</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
  }
  window.addEventListener('message', (ev) => { const m = ev.data; if (m && m.type==='update') apply(m); });
</script>
</body>
</html>`;
}

module.exports = { openTeamMonitor };
