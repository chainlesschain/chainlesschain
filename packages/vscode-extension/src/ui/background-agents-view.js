/**
 * Background Agents webview — the IDE face of `cc agent --bg` sessions over
 * the same surfaces the CLI exposes:
 *  - list/summary: read the supervisor state dir directly (background-agents.js)
 *  - interactive attach: the vendored agent-sdk pipe client (same NDJSON
 *    transport `cc attach` speaks) — type a follow-up prompt, stop a turn
 *  - stop / rename / resume: `cc daemon … --json` via execFile
 *
 * Singleton panel; 3s list poll while open; 500ms log-delta poll while
 * attached. SDK-bound (`vscode` + child_process + fs via core module).
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");
const {
  listBackgroundSessions,
  summarizeSessions,
  formatElapsed,
  tailLog,
  readLogDelta,
} = require("../background-agents.js");

let _panel = null;
let _listTimer = null;
let _logTimer = null;
let _attach = null; // { id, handle, logFile, offset }
let _attachSeq = 0; // generation counter: a newer attach() invalidates older ones

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
      // shell:true joins argv with plain spaces — rename titles / resume
      // prompts are user-typed, so cmd metacharacters must be escaped or
      // `verify & deploy` executes `deploy` as a second command.
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

function postSessions() {
  const sessions = listBackgroundSessions();
  const now = Date.now();
  post({
    type: "sessions",
    sessions: sessions.map((s) => ({ ...s, elapsed: formatElapsed(s, now) })),
    summary: summarizeSessions(sessions),
    attachedId: _attach ? _attach.id : null,
  });
}

function stopLogPoll() {
  if (_logTimer) {
    clearInterval(_logTimer);
    _logTimer = null;
  }
}

function detach({ notify = true } = {}) {
  _attachSeq++; // invalidate any in-flight attach() awaiting its handshake
  stopLogPoll();
  const current = _attach;
  _attach = null;
  if (current?.handle) {
    try {
      current.handle.detach();
    } catch {
      /* transport already gone */
    }
  }
  if (notify) post({ type: "detached" });
}

async function attach(id) {
  // attach() awaits the pipe handshake, so two rapid attach requests can
  // interleave: both pass the detach() below with _attach still null, and the
  // slower one would overwrite _attach — leaking the other's socket handle
  // (and its 500ms log timer) until process exit. The generation counter
  // makes every older in-flight attach discard its own handle on resolve.
  detach({ notify: false }); // also bumps _attachSeq, superseding older attaches
  const seq = ++_attachSeq;
  const sessions = listBackgroundSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    post({ type: "attach-fail", id, error: "session not found" });
    return;
  }
  let handle;
  try {
    const {
      attachBackgroundSession,
    } = require("../vendor/agent-sdk/background.js");
    handle = await attachBackgroundSession({
      id,
      onEvent: (event) => post({ type: "bg-event", id, event }),
      onClose: () => {
        if (_attach && _attach.id === id) {
          detach({ notify: false });
          post({ type: "bg-event", id, event: { type: "transport-closed" } });
        }
      },
    });
  } catch (e) {
    if (seq === _attachSeq)
      post({
        type: "attach-fail",
        id,
        error: String(e.message || e).slice(0, 300),
      });
    return;
  }
  if (seq !== _attachSeq) {
    // A newer attach (or detach) superseded us while the handshake ran —
    // this handle must not become _attach; close it instead of leaking it.
    try {
      handle.detach();
    } catch {
      /* best-effort */
    }
    return;
  }
  const initial = tailLog(session.logFile, 200);
  _attach = {
    id,
    handle,
    logFile: session.logFile,
    offset: 0,
  };
  // Seed the offset at current EOF so the delta poll only streams new output.
  _attach.offset = readLogDelta(
    session.logFile,
    Number.MAX_SAFE_INTEGER,
  ).offset;
  post({ type: "attach-ok", id, hello: handle.hello || null, log: initial });
  _logTimer = setInterval(() => {
    if (!_attach) return;
    const next = readLogDelta(_attach.logFile, _attach.offset);
    _attach.offset = next.offset;
    if (next.chunk) post({ type: "bg-log", id: _attach.id, chunk: next.chunk });
  }, 500);
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.command) {
    case "refresh":
      postSessions();
      return;
    case "attach":
      await attach(String(msg.id || ""));
      postSessions();
      return;
    case "detach":
      detach();
      postSessions();
      return;
    case "prompt": {
      const text = String(msg.text || "").trim();
      if (_attach && text) _attach.handle.prompt(text);
      return;
    }
    case "stopTurn":
      if (_attach) _attach.handle.stopTurn();
      return;
    case "stop": {
      if (_attach && _attach.id === msg.id) detach({ notify: false });
      const r = await runCliJson(vscode, [
        "daemon",
        "stop",
        String(msg.id),
        "--json",
      ]);
      post({
        type: "action-result",
        action: "stop",
        id: msg.id,
        ok: r.ok,
        error: r.error,
      });
      postSessions();
      return;
    }
    case "rename": {
      const title = String(msg.title || "").trim();
      if (!title) return;
      const r = await runCliJson(vscode, [
        "daemon",
        "rename",
        String(msg.id),
        title,
        "--json",
      ]);
      post({
        type: "action-result",
        action: "rename",
        id: msg.id,
        ok: r.ok,
        error: r.error,
      });
      postSessions();
      return;
    }
    case "resume": {
      const text = String(msg.text || "").trim();
      if (!text) return;
      const r = await runCliJson(vscode, [
        "daemon",
        "resume",
        String(msg.id),
        text,
        "--json",
      ]);
      post({
        type: "action-result",
        action: "resume",
        id: msg.id,
        ok: r.ok,
        error: r.error,
        session: r.json || null,
      });
      postSessions();
      return;
    }
    default:
  }
}

function openBackgroundAgents(vscode) {
  if (_panel) {
    _panel.reveal();
    postSessions();
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainBackgroundAgents",
    "ChainlessChain · Background Agents",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml();
  _panel.webview.onDidReceiveMessage((msg) => handleMessage(vscode, msg));
  _panel.onDidDispose(() => {
    detach({ notify: false });
    if (_listTimer) {
      clearInterval(_listTimer);
      _listTimer = null;
    }
    _panel = null;
  });
  postSessions();
  _listTimer = setInterval(postSessions, 3000);
  return _panel;
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
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; font-size: 13px; }
  h1 { font-size: 16px; margin: 0 0 10px; }
  .cards { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
  .card { background: var(--vscode-editorWidget-background); border:1px solid var(--vscode-widget-border, transparent);
          border-radius:6px; padding:7px 13px; min-width:70px; }
  .card .k { opacity:.65; font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:17px; font-weight:600; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border,#333); vertical-align:top; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  .st { font-weight:600; } .st.running { color: var(--vscode-charts-blue,#3794ff); }
  .st.completed { color:#3fb950; } .st.failed, .st.lost { color: var(--vscode-errorForeground,#f85149); }
  .st.stopped { color: var(--vscode-editorWarning-foreground, orange); }
  .wait { color: var(--vscode-editorWarning-foreground, orange); font-weight:600; }
  .muted { opacity:.55; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; padding:3px 10px; border-radius:4px; cursor:pointer; margin-right:4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
  #attachbox { border:1px solid var(--vscode-widget-border,#333); border-radius:6px; padding:10px; }
  #attachhead { display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap; }
  #log { max-height: 320px; overflow:auto; background: var(--vscode-textCodeBlock-background);
         padding:8px 10px; border-radius:4px; font-family: var(--vscode-editor-font-family);
         font-size:12px; white-space:pre-wrap; word-break:break-all; }
  #evt { min-height:16px; font-size:11px; opacity:.7; margin:6px 0; }
  .prow { display:flex; gap:6px; margin-top:6px; }
  .prow input { flex:1; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
                border:1px solid var(--vscode-input-border, transparent); border-radius:4px; padding:5px 8px; }
  .err { color: var(--vscode-errorForeground,#f85149); }
</style>
</head>
<body>
  <h1>Background Agents <button id="refresh" class="sec">Refresh</button></h1>
  <div class="cards" id="cards"></div>
  <div id="list"></div>
  <div id="attachbox" style="display:none">
    <div id="attachhead"></div>
    <div id="log"></div>
    <div id="evt"></div>
    <div class="prow">
      <input id="prompt" placeholder="Type a follow-up prompt · Enter to send" />
      <button id="send">Send</button>
      <button id="stopturn" class="sec">Stop turn</button>
      <button id="detach" class="sec">Detach</button>
    </div>
  </div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  let attachedId = null;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function card(k,v){ return '<div class="card"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>'; }
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('detach').addEventListener('click', ()=>vscode.postMessage({command:'detach'}));
  document.getElementById('stopturn').addEventListener('click', ()=>vscode.postMessage({command:'stopTurn', id: attachedId}));
  function sendPrompt(){
    const el = document.getElementById('prompt');
    const text = el.value.trim();
    if (!text || !attachedId) return;
    vscode.postMessage({command:'prompt', id: attachedId, text});
    el.value='';
  }
  document.getElementById('send').addEventListener('click', sendPrompt);
  document.getElementById('prompt').addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendPrompt(); });
  document.getElementById('list').addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.getAttribute('data-id');
    const act = b.getAttribute('data-act');
    if (act==='attach') vscode.postMessage({command:'attach', id});
    else if (act==='stop') vscode.postMessage({command:'stop', id});
    else if (act==='rename'){ const t=prompt('New title'); if(t) vscode.postMessage({command:'rename', id, title:t}); }
    else if (act==='resume'){ const t=prompt('Prompt to continue this session with'); if(t) vscode.postMessage({command:'resume', id, text:t}); }
  });
  function renderSessions(m){
    const s = m.summary || {total:0, running:0, interactive:0, counts:{}};
    document.getElementById('cards').innerHTML =
      card('total', s.total) + card('running', s.running) + card('interactive', s.interactive)
      + (s.waiting ? card('waiting', s.waiting) : '')
      + card('done', (s.counts&&s.counts.completed)||0) + card('lost', (s.counts&&s.counts.lost)||0);
    const rows = (m.sessions||[]).map(x => {
      const acts = [];
      if (x.interactive) acts.push('<button data-act="attach" data-id="'+esc(x.id)+'">'+(m.attachedId===x.id?'Attached':'Attach')+'</button>');
      if (x.status==='running') acts.push('<button class="sec" data-act="stop" data-id="'+esc(x.id)+'">Stop</button>');
      if (x.status!=='running' && x.sessionId) acts.push('<button class="sec" data-act="resume" data-id="'+esc(x.id)+'">Resume</button>');
      acts.push('<button class="sec" data-act="rename" data-id="'+esc(x.id)+'">Rename</button>');
      // A blocked session (waiting_permission / needs_input / pending
      // approvals) must not read like a healthy "running" row.
      const blocked = x.status==='running' && (x.phase==='waiting_permission' || x.phase==='needs_input' || (x.pendingApprovals|0) > 0);
      const phase = blocked
        ? ' <span class="wait">⏸ waiting for you'+((x.pendingApprovals|0)>0?(' ('+x.pendingApprovals+' approval'+(x.pendingApprovals>1?'s':'')+' pending)'):'')+'</span>'
        : x.phase ? ' <span class="muted">('+esc(x.phase)+(x.turnCount?(' · turn '+x.turnCount):'')+')</span>' : '';
      const reason = x.lostReason ? ' <span class="muted">'+esc(x.lostReason)+'</span>' : '';
      return '<tr><td class="st '+esc(x.status)+'">'+esc(x.status)+reason+'</td>'
        + '<td>'+esc(x.title||x.id)+phase+'<div class="muted">'+esc(x.id)+' · '+esc(x.cwd||'')+'</div></td>'
        + '<td>'+esc(x.elapsed||'')+'</td><td>'+acts.join('')+'</td></tr>';
    });
    document.getElementById('list').innerHTML = rows.length
      ? '<table><thead><tr><th style="width:110px">status</th><th>session</th><th style="width:70px">elapsed</th><th style="width:230px">actions</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>'
      : '<p class="muted">No background agents. Start one with <code>cc agent -p "task" --bg</code>.</p>';
  }
  const logEl = document.getElementById('log');
  function appendLog(t){ logEl.textContent += t; logEl.scrollTop = logEl.scrollHeight; }
  window.addEventListener('message', (ev)=>{
    const m = ev.data || {};
    if (m.type==='sessions') renderSessions(m);
    else if (m.type==='attach-ok'){
      attachedId = m.id;
      document.getElementById('attachbox').style.display='';
      document.getElementById('attachhead').innerHTML = '<b>'+esc(m.id)+'</b>'
        + (m.hello ? '<span class="muted">phase '+esc(m.hello.phase)+' · turn '+esc(m.hello.turn)+'</span>' : '');
      logEl.textContent = m.log || '';
      logEl.scrollTop = logEl.scrollHeight;
      document.getElementById('evt').textContent = '';
    }
    else if (m.type==='attach-fail'){ document.getElementById('evt').textContent = 'attach failed: '+(m.error||''); }
    else if (m.type==='detached'){ attachedId=null; document.getElementById('attachbox').style.display='none'; }
    else if (m.type==='bg-log' && m.id===attachedId){ appendLog(m.chunk); }
    else if (m.type==='bg-event' && m.id===attachedId){
      const e = m.event||{};
      const line = e.type==='turn-started' ? ('turn '+e.turn+' started'+(e.prompt?(': '+e.prompt):''))
        : e.type==='turn-ended' ? ('turn '+e.turn+' ended (exit '+e.exitCode+')')
        : e.type==='idle' ? 'session idle — type a follow-up prompt'
        : e.type==='accepted' ? ('prompt queued (#'+e.queued+')')
        : e.type==='transport-closed' ? 'session ended — connection closed'
        : e.type==='error' ? ('error: '+(e.message||'')) : e.type;
      document.getElementById('evt').textContent = line;
    }
    else if (m.type==='action-result' && !m.ok){
      document.getElementById('evt').innerHTML = '<span class="err">'+esc(m.action+' failed: '+(m.error||''))+'</span>';
    }
  });
</script>
</body>
</html>`;
}

module.exports = { openBackgroundAgents };
