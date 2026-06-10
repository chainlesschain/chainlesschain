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
    "ChainlessChain IDE 桥接",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml(_panel.webview);

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
  let s = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) s += chars[(i * 7 + 13) % chars.length];
  return s;
}

function renderHtml(webview) {
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
  <h1>ChainlessChain IDE 桥接</h1>
  <div class="row">
    <span id="badge"><span class="dot down"></span><span id="state">未连接</span></span>
    <button id="restart">重启桥接</button>
  </div>
  <div class="cards">
    <div class="card"><div class="k">端口</div><div class="v" id="port">—</div></div>
    <div class="card"><div class="k">工具调用</div><div class="v" id="cTool">0</div></div>
    <div class="card"><div class="k">client 连接</div><div class="v" id="cConn">0</div></div>
    <div class="card"><div class="k">错误</div><div class="v" id="cErr">0</div></div>
  </div>
  <div class="muted" id="ws"></div>
  <h3>实时工具调用</h3>
  <table>
    <thead><tr><th style="width:90px">时间</th><th style="width:140px">工具</th><th>详情</th></tr></thead>
    <tbody id="log"><tr><td colspan="3" class="muted">暂无调用</td></tr></tbody>
  </table>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  document.getElementById('restart').addEventListener('click', () => vscode.postMessage({ command: 'restart' }));
  function t(ts){ if(!ts) return ''; const d=new Date(ts); const p=x=>String(x).padStart(2,'0'); return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  window.addEventListener('message', (ev) => {
    const m = ev.data; if (!m || m.type !== 'update') return;
    const s = m.state || {}, c = m.counts || {};
    const up = s.port > 0;
    document.getElementById('badge').innerHTML = '<span class="dot '+(up?'up':'down')+'"></span>'+(up?'运行中':'已停止');
    document.getElementById('port').textContent = up ? s.port : '—';
    document.getElementById('cTool').textContent = c.tool || 0;
    document.getElementById('cConn').textContent = c.connect || 0;
    document.getElementById('cErr').textContent = c.error || 0;
    const ws = (s.workspaceFolders||[]);
    document.getElementById('ws').textContent = ws.length ? ('工作区: '+ws.join('  ·  ')) : '';
    const rows = (m.recent||[]).map(e => {
      const failed = e.ok === false;
      const name = e.type==='tool' ? e.tool : 'client 连接';
      const detail = e.argsSummary || (failed ? e.error : '');
      return '<tr><td class="t">'+t(e.ts)+'</td><td class="'+(failed?'err':'ok')+'">'+esc(name)+(failed?' ✗':'')+'</td><td>'+esc(detail)+'</td></tr>';
    });
    document.getElementById('log').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3" class="muted">暂无调用</td></tr>';
  });
</script>
</body>
</html>`;
}

module.exports = { openDashboard, refreshDashboard };
