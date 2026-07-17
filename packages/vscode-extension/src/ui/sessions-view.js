/**
 * Sessions Workbench webview (gap #3 跨端 Remote/Cloud Session 入口) — one
 * panel across every session surface:
 *  - chat sessions   `cc session list --json`
 *  - IDE sessions    ~/.chainlesschain/ide/session-index.json
 *  - background      supervisor state dir (background-agents.js, like the
 *                    Background Agents panel — no CLI round-trip)
 *  - remote control  `cc remote-control status --json`
 *
 * Every source is loaded with per-call error tolerance: a failing source shows
 * a warning row, never a blank panel. Actions route to the least invasive
 * existing flow: resume → the chat view's resumeSessionId (injected hook from
 * extension.js, falls back to a `cc session resume` terminal); attach → opens
 * the Background Agents panel (which owns the take-over transport/log UI);
 * stop/continue/rename(background) → `cc daemon … --json`; rename(chat/ide) →
 * shared IDE index overlay; delete → `cc session delete --force` + index
 * prune; stop(remote) → `cc remote-control stop --port … --json`.
 *
 * Singleton panel; 15s auto-refresh while visible. Row aggregation/rendering
 * is pure and lives in ../sessions-workbench.js.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");
const {
  buildWorkbenchArgs,
  aggregateSessions,
  filterRows,
  renderWorkbenchHtml,
} = require("../sessions-workbench.js");

const REFRESH_MS = 15000;
// Session/agent ids come back through webview messages — keep them argv-safe
// (Windows execFile runs through a shell for the .cmd shim, like every other
// cc call in this extension).
const SAFE_ID = /^[\w@.:-]+$/;

let _panel = null;
let _timer = null;
let _rows = [];
let _errors = [];
let _query = "";
let _hooks = {};

function cliCommand(vscode) {
  const { getResolvedCli } = require("../cli-binary");
  return (
    getResolvedCli() ||
    vscode.workspace.getConfiguration("chainlesschain.cli").get("path") ||
    "cc"
  );
}

/** Run a `cc …` command, resolve {ok, json|raw, error}. Never rejects. */
function runCliJson(vscode, args, { timeoutMs = 15000 } = {}) {
  const useShell = process.platform === "win32"; // cc is a .cmd shim on Windows
  return new Promise((resolve) => {
    execFile(
      cliCommand(vscode),
      // Under the Windows shell, free-form argv (rename titles, continue
      // prompts) must be cmd-escaped or `&`/`|`/`^` inject a second command.
      useShell ? escapeCmdArgs(args) : args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        shell: useShell,
        env: hardenedEnv(process.env),
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            error: String(stderr || error.message || "")
              .trim()
              .slice(0, 400),
          });
          return;
        }
        let json = null;
        try {
          json = JSON.parse(String(stdout || "").trim());
        } catch {
          /* non-JSON success output is fine for some commands */
        }
        resolve({ ok: true, json, raw: String(stdout || "") });
      },
    );
  });
}

function post(message) {
  if (_panel) _panel.webview.postMessage(message);
}

function postRows() {
  post({
    type: "rows",
    html: renderWorkbenchHtml(filterRows(_rows, _query), {
      now: Date.now(),
      errors: _errors,
    }),
    total: _rows.length,
  });
}

/** Load all four sources in parallel; per-source failures become warning rows. */
async function loadData(vscode) {
  const args = buildWorkbenchArgs();
  const errors = [];

  const [chatRes, remoteRes] = await Promise.all([
    runCliJson(vscode, args.sessionList),
    runCliJson(vscode, args.remoteControlStatus),
  ]);

  let chatSessions = [];
  if (chatRes.ok) {
    const { parseSessionList } = require("../chat/session-list.js");
    chatSessions = parseSessionList(chatRes.raw);
  } else {
    errors.push({ source: "cc session list", message: chatRes.error });
  }

  let remoteControl = [];
  if (remoteRes.ok) {
    remoteControl = Array.isArray(remoteRes.json) ? remoteRes.json : [];
  } else {
    errors.push({
      source: "cc remote-control status",
      message: remoteRes.error,
    });
  }

  let ideIndex = [];
  try {
    const { readIdeSessionIndex } = require("../chat/ide-session-index.js");
    ideIndex = readIdeSessionIndex();
  } catch (e) {
    errors.push({
      source: "IDE session index",
      message: e?.message || String(e),
    });
  }

  let backgroundAgents = [];
  try {
    const { listBackgroundSessions } = require("../background-agents.js");
    backgroundAgents = listBackgroundSessions();
  } catch (e) {
    errors.push({
      source: "background agents",
      message: e?.message || String(e),
    });
  }

  _rows = aggregateSessions({
    chatSessions,
    ideIndex,
    backgroundAgents,
    remoteControl,
  });
  _errors = errors;
  postRows();
}

async function runAction(vscode, msg) {
  const id = String(msg.id || "");
  const kind = String(msg.kind || "");
  if (!SAFE_ID.test(id)) return;

  switch (msg.act) {
    case "resume": {
      // Least invasive resume: the chat view already exposes resumeSessionId
      // (used by /sessions and deep links) — extension.js injects it here.
      if (typeof _hooks.resumeChatSession === "function") {
        _hooks.resumeChatSession(id);
        post({ type: "info", text: `resuming ${id} in the chat panel` });
      } else {
        const term = vscode.window.createTerminal("ChainlessChain Session");
        term.show();
        term.sendText(`${cliCommand(vscode)} session resume ${id}`);
      }
      return;
    }
    case "rename": {
      const title = String(msg.title || "").trim();
      if (!title) return;
      if (kind === "background") {
        const r = await runCliJson(vscode, [
          "daemon",
          "rename",
          id,
          title,
          "--json",
        ]);
        if (!r.ok) post({ type: "info", text: `rename failed: ${r.error}` });
      } else {
        try {
          const {
            renameIdeSessionRecord,
          } = require("../chat/ide-session-index.js");
          renameIdeSessionRecord(id, title);
        } catch (e) {
          post({ type: "info", text: `rename failed: ${e?.message || e}` });
        }
      }
      await loadData(vscode);
      return;
    }
    case "delete": {
      const proceed = await vscode.window.showWarningMessage(
        `Delete session ${id}? Its saved transcript is removed. This cannot be undone.`,
        { modal: true },
        "Delete",
      );
      if (proceed !== "Delete") return;
      const { deleteCliSession } = require("../chat/session-list.js");
      await deleteCliSession({ command: cliCommand(vscode), id });
      try {
        const {
          removeIdeSessionRecord,
        } = require("../chat/ide-session-index.js");
        removeIdeSessionRecord(id);
      } catch {
        /* index prune is best-effort */
      }
      await loadData(vscode);
      return;
    }
    case "attach": {
      // The Background Agents panel owns the interactive take-over transport
      // (agent-sdk pipe client) + live log UI — reuse it instead of cloning.
      const { openBackgroundAgents } = require("./background-agents-view.js");
      openBackgroundAgents(vscode);
      return;
    }
    case "stop": {
      if (kind === "remote") {
        const port = Number(msg.port);
        if (!Number.isFinite(port) || port <= 0) return;
        const r = await runCliJson(vscode, [
          "remote-control",
          "stop",
          "--port",
          String(port),
          "--json",
        ]);
        if (!r.ok) post({ type: "info", text: `stop failed: ${r.error}` });
      } else {
        const r = await runCliJson(vscode, ["daemon", "stop", id, "--json"]);
        if (!r.ok) post({ type: "info", text: `stop failed: ${r.error}` });
      }
      await loadData(vscode);
      return;
    }
    case "continue": {
      const text = String(msg.text || "").trim();
      if (!text) return;
      const r = await runCliJson(vscode, [
        "daemon",
        "resume",
        id,
        text,
        "--json",
      ]);
      if (!r.ok) post({ type: "info", text: `continue failed: ${r.error}` });
      await loadData(vscode);
      return;
    }
    default:
  }
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.command) {
    case "refresh":
      await loadData(vscode);
      return;
    case "filter":
      _query = String(msg.query || "");
      postRows();
      return;
    case "action":
      await runAction(vscode, msg);
      return;
    default:
  }
}

function openSessionsWorkbench(vscode, hooks = {}) {
  _hooks = hooks || {};
  if (_panel) {
    _panel.reveal();
    loadData(vscode);
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainSessionsWorkbench",
    "ChainlessChain · Sessions Workbench",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderPageHtml();
  _panel.webview.onDidReceiveMessage((msg) => handleMessage(vscode, msg));
  _panel.onDidDispose(() => {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
    _panel = null;
    _rows = [];
    _errors = [];
    _query = "";
  });
  loadData(vscode);
  _timer = setInterval(() => {
    if (_panel && _panel.visible) loadData(vscode);
  }, REFRESH_MS);
  return _panel;
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function renderPageHtml() {
  const n = nonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; font-size: 13px; }
  h1 { font-size: 16px; margin: 0 0 10px; }
  .bar { display:flex; gap:8px; margin-bottom:12px; align-items:center; }
  .bar input { flex:1; max-width:340px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
               border:1px solid var(--vscode-input-border, transparent); border-radius:4px; padding:5px 8px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border,#333); vertical-align:top; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  .st { font-weight:600; } .st.running { color: var(--vscode-charts-blue,#3794ff); }
  .st.completed { color:#3fb950; } .st.failed, .st.lost, .st.errored, .st.invalid { color: var(--vscode-errorForeground,#f85149); }
  .st.stopped, .st.stale, .st.waiting_approval { color: var(--vscode-editorWarning-foreground, orange); }
  .badge { background: var(--vscode-editorWarning-foreground, orange); color:#1e1e1e; border-radius:8px;
           padding:1px 7px; font-size:10px; font-weight:600; }
  .badge.alt { background: var(--vscode-charts-blue,#3794ff); color:#fff; }
  .kind { opacity:.7; font-size:10px; text-transform:uppercase; letter-spacing:.05em; border:1px solid
          var(--vscode-widget-border,#555); border-radius:3px; padding:0 4px; }
  .muted { opacity:.55; }
  .warn { color: var(--vscode-editorWarning-foreground, orange); margin-bottom:6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; padding:3px 10px; border-radius:4px; cursor:pointer; margin:0 4px 3px 0; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
  #info { min-height:16px; font-size:11px; opacity:.7; margin:6px 0; }
</style>
</head>
<body>
  <h1>Sessions Workbench</h1>
  <div class="bar">
    <input id="q" placeholder="Filter by title / workspace / id" />
    <button id="refresh" class="sec">Refresh</button>
  </div>
  <div id="info"></div>
  <div id="list"><p class="muted">Loading…</p></div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('q').addEventListener('input', (e)=>vscode.postMessage({command:'filter', query: e.target.value}));
  document.getElementById('list').addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const msg = { command:'action', act: b.getAttribute('data-act'), id: b.getAttribute('data-id'),
                  kind: b.getAttribute('data-kind'), sessionId: b.getAttribute('data-session'),
                  port: b.getAttribute('data-port') };
    if (msg.act==='rename'){ const t=prompt('New title'); if(!t) return; msg.title=t; }
    if (msg.act==='continue'){ const t=prompt('Prompt to continue this session with'); if(!t) return; msg.text=t; }
    vscode.postMessage(msg);
  });
  window.addEventListener('message', (ev)=>{
    const m = ev.data || {};
    if (m.type==='rows') document.getElementById('list').innerHTML = m.html;
    else if (m.type==='info') document.getElementById('info').textContent = m.text || '';
  });
</script>
</body>
</html>`;
}

module.exports = { openSessionsWorkbench };
