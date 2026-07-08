/**
 * Webview dashboard for the IDE bridge: status cards + a live tool-call stream
 * + actions (restart, copy port). A singleton panel that re-renders on every
 * activity-log change via postMessage. SDK-bound (uses `vscode`).
 */
let _panel = null;
let _unsub = null;

function snapshot(getState, activityLog) {
  return {
    type: "update",
    state: getState() || {},
    counts: activityLog.counts(),
    recent: activityLog.recent(60),
  };
}

function openDashboard(vscode, context, getState, activityLog) {
  if (_panel) {
    _panel.reveal();
    _panel.webview.postMessage(snapshot(getState, activityLog));
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainIdeDashboard",
    vscode.l10n.t("ChainlessChain IDE bridge"),
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml(_panel.webview, dashboardStrings(vscode));

  _panel.webview.onDidReceiveMessage((msg) => {
    if (msg && msg.command === "restart") {
      vscode.commands.executeCommand("chainlesschain.ide.restart");
    }
  });

  _unsub = activityLog.onChange(() => {
    if (_panel) _panel.webview.postMessage(snapshot(getState, activityLog));
  });

  _panel.onDidDispose(() => {
    if (_unsub) _unsub();
    _unsub = null;
    _panel = null;
  });

  _panel.webview.postMessage(snapshot(getState, activityLog));
  return _panel;
}

/** Push a fresh snapshot if the dashboard is open (e.g. on start/stop). */
function refreshDashboard(getState, activityLog) {
  if (_panel) _panel.webview.postMessage(snapshot(getState, activityLog));
}

function nonce() {
  // Must be unpredictable per render — a constant nonce makes the CSP
  // script-src gate decorative (same scheme as the chat panel's).
  return require("crypto").randomBytes(16).toString("hex");
}

/**
 * Localize the webview's chrome in the extension host (the webview itself can't
 * call vscode.l10n.t) — resolved once here, interpolated into the static HTML
 * and injected as `L` for the inline script.
 */
function dashboardStrings(vscode) {
  return {
    title: vscode.l10n.t("ChainlessChain IDE bridge"),
    disconnected: vscode.l10n.t("Disconnected"),
    restart: vscode.l10n.t("Restart bridge"),
    port: vscode.l10n.t("Port"),
    toolCalls: vscode.l10n.t("Tool calls"),
    clientConnections: vscode.l10n.t("Client connections"),
    errors: vscode.l10n.t("Errors"),
    liveToolCalls: vscode.l10n.t("Live tool calls"),
    thTime: vscode.l10n.t("Time"),
    thTool: vscode.l10n.t("Tool"),
    thDetail: vscode.l10n.t("Detail"),
    noCalls: vscode.l10n.t("No calls yet"),
    running: vscode.l10n.t("Running"),
    stopped: vscode.l10n.t("Stopped"),
    workspace: vscode.l10n.t("Workspace"),
    clientConnected: vscode.l10n.t("client connected"),
  };
}

function renderHtml(webview, L) {
  const n = nonce();
  const csp =
    `default-src 'none'; style-src 'unsafe-inline'; ` +
    `script-src 'nonce-${n}';`;
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 16px; font-size: 13px; }
  h1 { font-size: 16px; margin: 0 0 12px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .card { background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-widget-border, transparent);
          border-radius: 6px; padding: 12px 16px; min-width: 120px; }
  .card .k { opacity: .7; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .card .v { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
         margin-right: 6px; vertical-align: middle; }
  .up { background: #3fb950; } .down { background: #888; }
  .row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
  th { opacity: .6; font-weight: 500; font-size: 11px; }
  td.t { white-space: nowrap; opacity: .7; font-variant-numeric: tabular-nums; }
  .ok { color: #3fb950; } .err { color: var(--vscode-errorForeground, #f85149); }
  .muted { opacity: .55; }
</style>
</head>
<body>
  <h1>${L.title}</h1>
  <div class="row">
    <span id="badge"><span class="dot down"></span><span id="state">${L.disconnected}</span></span>
    <button id="restart">${L.restart}</button>
  </div>
  <div class="cards">
    <div class="card"><div class="k">${L.port}</div><div class="v" id="port">—</div></div>
    <div class="card"><div class="k">${L.toolCalls}</div><div class="v" id="cTool">0</div></div>
    <div class="card"><div class="k">${L.clientConnections}</div><div class="v" id="cConn">0</div></div>
    <div class="card"><div class="k">${L.errors}</div><div class="v" id="cErr">0</div></div>
  </div>
  <div class="muted" id="ws"></div>
  <h3>${L.liveToolCalls}</h3>
  <table>
    <thead><tr><th style="width:90px">${L.thTime}</th><th style="width:140px">${L.thTool}</th><th>${L.thDetail}</th></tr></thead>
    <tbody id="log"><tr><td colspan="3" class="muted">${L.noCalls}</td></tr></tbody>
  </table>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const L = ${JSON.stringify(L)};
  document.getElementById('restart').addEventListener('click', () => vscode.postMessage({ command: 'restart' }));
  function t(ts){ if(!ts) return ''; const d=new Date(ts); const p=x=>String(x).padStart(2,'0'); return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function apply(m){
    const s = m.state || {}, c = m.counts || {};
    const up = s.port > 0;
    document.getElementById('badge').innerHTML = '<span class="dot '+(up?'up':'down')+'"></span>'+(up?L.running:L.stopped);
    document.getElementById('port').textContent = up ? s.port : '—';
    document.getElementById('cTool').textContent = c.tool || 0;
    document.getElementById('cConn').textContent = c.connect || 0;
    document.getElementById('cErr').textContent = c.error || 0;
    const ws = (s.workspaceFolders||[]);
    document.getElementById('ws').textContent = ws.length ? (L.workspace+': '+ws.join('  ·  ')) : '';
    const rows = (m.recent||[]).map(e => {
      const failed = e.ok === false;
      const name = e.type==='tool' ? e.tool : L.clientConnected;
      const detail = e.argsSummary || (failed ? e.error : '');
      return '<tr><td class="t">'+t(e.ts)+'</td><td class="'+(failed?'err':'ok')+'">'+esc(name)+(failed?' ✗':'')+'</td><td>'+esc(detail)+'</td></tr>';
    });
    document.getElementById('log').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3" class="muted">'+L.noCalls+'</td></tr>';
  }
  // Coalesce a burst of activity events into one DOM rebuild per frame — a busy
  // agent turn posts a full snapshot per tool call, and only the latest matters.
  let pending = null, raf = 0;
  window.addEventListener('message', (ev) => {
    const m = ev.data; if (!m || m.type !== 'update') return;
    pending = m;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const x = pending; pending = null; if (x) apply(x); });
  });
</script>
</body>
</html>`;
}

module.exports = { openDashboard, refreshDashboard };
