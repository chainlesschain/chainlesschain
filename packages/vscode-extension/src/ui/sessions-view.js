/**
 * Existing Sessions Workbench webview over the CLI-owned canonical session
 * projection. The IDE never joins state/index files or reads transport tokens;
 * every mutation is revision-gated and routed through a CLI command.
 */
const { execFile } = require("child_process");
const fs = require("node:fs");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");
const {
  hostDomTokensEqual,
  normalizeHostDomToken,
} = require("../chat/host-dom-relay");
const {
  buildWorkbenchArgs,
  parseSessionProjection,
  canRunProjectionAction,
  recheckProjectionAction,
  materializeActionPreview,
  filterRows,
  renderWorkbenchHtml,
} = require("../sessions-workbench.js");
const {
  ACTION_LABELS: DELIVERY_ACTION_LABELS,
  DeliveryWorkflowController,
  renderDeliveryHtml,
} = require("../delivery-workflow.js");

const REFRESH_MS = 15000;
// Session/agent ids come back through webview messages — keep them argv-safe
let _panel = null;
let _timer = null;
let _rows = [];
let _errors = [];
let _query = "";
let _hooks = {};
let _deliveryController = null;
let _deliveryError = "";
let _hostDomToken = null;
let _hostDomReady = false;
const _hostDomPending = new Map();
let _snapshot = {
  connected: false,
  revision: null,
  rows: [],
  error: "not loaded",
};

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

function projectionArgs(vscode) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
  return buildWorkbenchArgs({ cwd }).sessionProjection;
}

async function readProjection(vscode) {
  if (typeof _hooks.readSessionProjection === "function") {
    return _hooks.readSessionProjection();
  }
  const result = await runCliJson(vscode, projectionArgs(vscode));
  return result.ok
    ? parseSessionProjection(result.raw)
    : {
        connected: false,
        revision: null,
        rows: [],
        error: result.error || "cc session projection unavailable",
      };
}

function postDelivery() {
  post({
    type: "delivery",
    html: renderDeliveryHtml(_deliveryController?.projection, {
      statePath: _deliveryController?.statePath || "",
      error: _deliveryError,
    }),
  });
}

function ensureDeliveryController(vscode) {
  if (_deliveryController) return _deliveryController;
  _deliveryController = new DeliveryWorkflowController({
    runCli:
      typeof _hooks.runDeliveryCli === "function"
        ? _hooks.runDeliveryCli
        : (args) => runCliJson(vscode, args, { timeoutMs: 30000 }),
    readResultFile:
      typeof _hooks.readDeliveryResultFile === "function"
        ? _hooks.readDeliveryResultFile
        : (file) => fs.promises.readFile(file, "utf8"),
  });
  return _deliveryController;
}

async function loadDelivery(vscode, statePath) {
  try {
    await ensureDeliveryController(vscode).load(statePath);
    _deliveryError = "";
  } catch (error) {
    _deliveryError = `Delivery flow unavailable: ${error.message || error}`;
  }
  postDelivery();
}

async function selectDeliveryState(vscode) {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Load delivery flow",
    title: "Select a CLI delivery-flow state snapshot",
    filters: { "Delivery state": ["json"], "All files": ["*"] },
  });
  const statePath = picked?.[0]?.fsPath;
  if (statePath) await loadDelivery(vscode, statePath);
}

async function requestDeliveryAction(vscode, action) {
  const controller = ensureDeliveryController(vscode);
  try {
    const token = controller.previewRequest(String(action || ""));
    const label = DELIVERY_ACTION_LABELS[token.action] || token.action;
    const confirmed = await vscode.window.showWarningMessage(
      `Request “${label}” for ${token.flowId} at revision ${token.expectedRevision}? This records a pending coordinator effect only; it does not run PR, CI, merge, or archive operations.`,
      { modal: true },
      "Request effect",
    );
    if (confirmed !== "Request effect") return;
    const next = await controller.confirmRequest(token);
    _deliveryError = "";
    post({
      type: "info",
      text: `Pending delivery request recorded: ${next.pendingEffect.action}. Supply an exact effect-bound result JSON to settle it.`,
    });
  } catch (error) {
    _deliveryError = `Delivery request rejected: ${error.message || error}`;
  }
  postDelivery();
}

async function settleDeliveryAction(vscode) {
  const controller = ensureDeliveryController(vscode);
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Preview result envelope",
    title: "Select an effect-bound delivery action result JSON",
    filters: { "Delivery result": ["json"], "All files": ["*"] },
  });
  const resultPath = picked?.[0]?.fsPath;
  if (!resultPath) return;
  try {
    const token = await controller.previewSettlement(resultPath);
    const confirmed = await vscode.window.showWarningMessage(
      `Settle the pending ${token.action} request at revision ${token.expectedRevision} with effect ${token.expectedEffectId}? The CLI will re-check the state, effect ID, and unchanged result file before settling.`,
      { modal: true },
      "Settle exact effect",
    );
    if (confirmed !== "Settle exact effect") return;
    const next = await controller.confirmSettlement(token);
    _deliveryError = "";
    post({
      type: "info",
      text: `Delivery effect settled by the CLI; flow is now ${next.status}/${next.phase}.`,
    });
  } catch (error) {
    _deliveryError = `Delivery settlement rejected: ${error.message || error}`;
  }
  postDelivery();
}

/** Load the one CLI-owned projection; any failure clears stale actions. */
async function loadData(vscode) {
  _snapshot = await readProjection(vscode);
  _rows = _snapshot.connected ? _snapshot.rows : [];
  _errors = [];
  if (!_snapshot.connected) {
    _errors.push({
      source: "cc session projection",
      message: _snapshot.error || "disconnected",
    });
  } else {
    for (const [source, status] of Object.entries(_snapshot.sources || {})) {
      if (status?.ok === false) {
        _errors.push({
          source,
          message: status.error || "source unavailable",
        });
      }
    }
  }
  postRows();
}

function terminalToken(value) {
  const text = String(value || "");
  if (process.platform === "win32") {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function openPreviewTerminal(vscode, args) {
  if (
    !Array.isArray(args) ||
    args.length === 0 ||
    args.length > 32 ||
    args.some(
      (value) =>
        typeof value !== "string" ||
        value.includes("\0") ||
        /[\r\n]/.test(value),
    )
  ) {
    return false;
  }
  const term = vscode.window.createTerminal("ChainlessChain Session");
  term.show();
  term.sendText(
    [terminalToken(cliCommand(vscode)), ...args.map(terminalToken)].join(" "),
  );
  return true;
}

async function showCliOutput(vscode, title, result) {
  if (!result.ok) {
    post({ type: "info", text: `${title} failed: ${result.error}` });
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    content: result.raw || JSON.stringify(result.json || {}, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function runAction(vscode, msg) {
  const renderedSnapshot = _snapshot;
  const request = {
    id: String(msg.id || ""),
    action: String(msg.act || ""),
    revision: String(msg.revision || ""),
    itemRevision: String(msg.itemRevision || ""),
  };
  if (!canRunProjectionAction(renderedSnapshot, request)) {
    post({
      type: "info",
      text: "Session data is disconnected or stale; action was not sent.",
    });
    await loadData(vscode);
    return;
  }
  const currentSnapshot = await readProjection(vscode);
  const checked = recheckProjectionAction(
    renderedSnapshot,
    currentSnapshot,
    request,
  );
  if (!checked.ok) {
    post({
      type: "info",
      text: `${checked.error}; refresh before retrying.`,
    });
    await loadData(vscode);
    return;
  }
  const route = materializeActionPreview(checked.preview, {
    prompt: msg.text,
  });
  if (!route) {
    post({ type: "info", text: "Action input is missing or invalid." });
    return;
  }

  if (route.executor === "host") {
    if (
      request.action === "dispatch" &&
      checked.row.kind === "local" &&
      typeof _hooks.resumeChatSession === "function"
    ) {
      _hooks.resumeChatSession(checked.row.sourceId);
      post({
        type: "info",
        text: `resuming ${checked.row.sourceId} in the chat panel`,
      });
      return;
    }
    if (!openPreviewTerminal(vscode, route.argv)) {
      post({ type: "info", text: "Host action preview was rejected." });
    }
    return;
  }

  if (route.executor === "terminal") {
    if (!openPreviewTerminal(vscode, route.argv)) {
      post({ type: "info", text: "Terminal action preview was rejected." });
    }
    return;
  }

  const result = await runCliJson(vscode, route.argv);
  if (request.action === "peek") {
    await showCliOutput(vscode, "peek", result);
    return;
  }
  if (!result.ok) {
    post({
      type: "info",
      text: `${request.action} failed: ${result.error}`,
    });
  }
  if (route.mutates) {
    await loadData(vscode);
  }
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "hostWorkbenchDomReady") {
    if (_hostDomToken && hostDomTokensEqual(_hostDomToken, msg.token)) {
      _hostDomReady = true;
    }
    return;
  }
  if (msg.type === "hostWorkbenchDomResult") {
    if (
      !_hostDomToken ||
      !hostDomTokensEqual(_hostDomToken, msg.token) ||
      typeof msg.requestId !== "string"
    ) {
      return;
    }
    const pending = _hostDomPending.get(msg.requestId);
    if (!pending) return;
    _hostDomPending.delete(msg.requestId);
    clearTimeout(pending.timer);
    if (msg.error) pending.reject(new Error(String(msg.error)));
    else pending.resolve(msg.result);
    return;
  }
  switch (msg.command) {
    case "ready":
      postRows();
      postDelivery();
      return;
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
    case "delivery-select":
      await selectDeliveryState(vscode);
      return;
    case "delivery-refresh":
      if (_deliveryController?.statePath) {
        await loadDelivery(vscode, _deliveryController.statePath);
      }
      return;
    case "delivery-request":
      await requestDeliveryAction(vscode, msg.action);
      return;
    case "delivery-settle":
      await settleDeliveryAction(vscode);
      return;
    default:
  }
}

function openSessionsWorkbench(vscode, hooks = {}) {
  _hooks = hooks || {};
  _hostDomToken = normalizeHostDomToken(_hooks.hostDomToken);
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
  _panel.webview.html = renderPageHtml(_hostDomToken);
  ensureDeliveryController(vscode);
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
    _deliveryController = null;
    _deliveryError = "";
    _hostDomToken = null;
    _hostDomReady = false;
    for (const pending of _hostDomPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Sessions Workbench DOM relay was disposed"));
    }
    _hostDomPending.clear();
    _snapshot = {
      connected: false,
      revision: null,
      rows: [],
      error: "disposed",
    };
  });
  loadData(vscode);
  postDelivery();
  _timer = setInterval(() => {
    if (_panel && _panel.visible) loadData(vscode);
  }, REFRESH_MS);
  return _panel;
}

async function waitForHostDomReady(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (_panel && _hostDomReady) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Sessions Workbench DOM relay did not become ready");
}

/** Token-gated, fixed-semantics relay for signed macOS real-host journeys. */
async function runSessionsWorkbenchHostDomCommand(request) {
  if (!_panel || !_hostDomToken) {
    throw new Error("Sessions Workbench DOM relay is unavailable");
  }
  await waitForHostDomReady();
  const requestId = require("node:crypto").randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _hostDomPending.delete(requestId);
      reject(new Error("Sessions Workbench DOM relay timed out"));
    }, 15_000);
    timer.unref?.();
    _hostDomPending.set(requestId, { resolve, reject, timer });
    Promise.resolve(
      _panel.webview.postMessage({
        kind: "hostWorkbenchDomCommand",
        token: _hostDomToken,
        requestId,
        request,
      }),
    ).then(
      (posted) => {
        if (posted !== false) return;
        const pending = _hostDomPending.get(requestId);
        if (!pending) return;
        _hostDomPending.delete(requestId);
        clearTimeout(timer);
        reject(
          new Error("Sessions Workbench DOM relay message was not posted"),
        );
      },
      (error) => {
        const pending = _hostDomPending.get(requestId);
        if (!pending) return;
        _hostDomPending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isSessionsWorkbenchOpen() {
  return Boolean(_panel);
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function renderPageHtml(hostDomToken = null) {
  const n = nonce();
  const relayToken = normalizeHostDomToken(hostDomToken);
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
  .details { margin-top:3px; font-size:11px; color:var(--vscode-descriptionForeground); }
  .warn { color: var(--vscode-editorWarning-foreground, orange); margin-bottom:6px; }
  #delivery { border:1px solid var(--vscode-widget-border,#555); border-radius:5px; padding:10px; margin:0 0 12px; }
  .delivery-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .delivery-controls, .delivery-actions { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
  .delivery-path { overflow-wrap:anywhere; margin:3px 0 7px; }
  .delivery-stages { display:flex; flex-wrap:wrap; gap:5px; margin:8px 0; }
  .delivery-stage { border:1px solid var(--vscode-widget-border,#555); border-radius:10px; padding:1px 7px; font-size:11px; }
  .delivery-stage.done { color:#3fb950; }
  .delivery-stage.current { color:var(--vscode-charts-blue,#3794ff); }
  .delivery-stage.blocked { color:var(--vscode-errorForeground,#f85149); }
  #delivery details { margin:7px 0; }
  #delivery ul { margin:4px 0; padding-left:22px; }
  #delivery code { overflow-wrap:anywhere; }
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
  <section id="delivery">${renderDeliveryHtml(null)}</section>
  <div id="list"><p class="muted">Loading…</p></div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const hostDomToken = ${JSON.stringify(relayToken)};
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('q').addEventListener('input', (e)=>vscode.postMessage({command:'filter', query: e.target.value}));
  document.getElementById('list').addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const msg = { command:'action', act: b.getAttribute('data-act'), id: b.getAttribute('data-id'),
                  kind: b.getAttribute('data-kind'), sessionId: b.getAttribute('data-session'),
                  port: b.getAttribute('data-port'), revision: b.getAttribute('data-revision'),
                  itemRevision: b.getAttribute('data-item-revision') };
    if ((msg.act==='dispatch' || msg.act==='reply') && msg.kind==='background'){
      const label=msg.act==='reply' ? 'Reply to this waiting session' : 'Prompt to dispatch this finished session with';
      const t=prompt(label); if(!t) return; msg.text=t;
    }
    vscode.postMessage(msg);
  });
  document.getElementById('delivery').addEventListener('click', (e)=>{
    const action = e.target.closest('button[data-delivery-action]');
    if (action) {
      vscode.postMessage({command:'delivery-request', action:action.getAttribute('data-delivery-action')});
      return;
    }
    const button = e.target.closest('button[data-delivery-command]');
    if (!button) return;
    const command = button.getAttribute('data-delivery-command');
    if (command==='select') vscode.postMessage({command:'delivery-select'});
    else if (command==='refresh') vscode.postMessage({command:'delivery-refresh'});
    else if (command==='settle') vscode.postMessage({command:'delivery-settle'});
  });
  window.addEventListener('message', (ev)=>{
    const m = ev.data || {};
    if (hostDomToken && m.kind==='hostWorkbenchDomCommand' && m.token===hostDomToken && typeof m.requestId==='string') {
      const request=m.request || {};
      try {
        let result;
        if (request.action==='snapshot') {
          const rows=[...document.querySelectorAll('#list tbody tr')];
          const background=rows.find((row)=>row.querySelector('[data-source-id="ui-workbench-background"]')) || null;
          const kinds=[...new Set(rows.map((row)=>row.querySelector('.kind')?.textContent?.trim()).filter(Boolean))];
          result={
            text:document.body?.innerText || '',
            rowCount:rows.length,
            kinds,
            backgroundState:background?.querySelector('.st')?.textContent?.trim() || null,
            dispatchEnabled:Boolean(background?.querySelector('button[data-act="dispatch"]')),
            replyEnabled:Boolean(background?.querySelector('button[data-act="reply"]')),
            artifactVisible:Boolean(background && (background.textContent || '').includes('workbench-result.md')),
            prVisible:Boolean(background && (background.textContent || '').includes('PR #88 merged')),
          };
        } else if (request.action==='click' && (request.target==='dispatch' || request.target==='reply')) {
          const button=document.querySelector('#list button[data-source-id="ui-workbench-background"][data-act="'+request.target+'"]');
          if (!button) throw new Error('requested workbench action is unavailable: '+request.target);
          const originalPrompt=window.prompt;
          window.prompt=()=>String(request.text || '');
          try { button.click(); } finally { window.prompt=originalPrompt; }
          result={clicked:request.target};
        } else if (request.action==='refresh') {
          document.getElementById('refresh').click();
          result={refreshed:true};
        } else {
          throw new Error('unsupported Sessions Workbench host DOM action');
        }
        vscode.postMessage({type:'hostWorkbenchDomResult',token:hostDomToken,requestId:m.requestId,result});
      } catch (error) {
        vscode.postMessage({type:'hostWorkbenchDomResult',token:hostDomToken,requestId:m.requestId,error:String(error && error.message || error)});
      }
      return;
    }
    if (m.type==='rows') document.getElementById('list').innerHTML = m.html;
    else if (m.type==='delivery') document.getElementById('delivery').innerHTML = m.html;
    else if (m.type==='info') document.getElementById('info').textContent = m.text || '';
  });
  if (hostDomToken) vscode.postMessage({type:'hostWorkbenchDomReady',token:hostDomToken});
  vscode.postMessage({command:'ready'});
</script>
</body>
</html>`;
}

module.exports = {
  openSessionsWorkbench,
  isSessionsWorkbenchOpen,
  runSessionsWorkbenchHostDomCommand,
};
