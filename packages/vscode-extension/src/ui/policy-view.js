/**
 * Permission / policy viewer webview (gap #10) — read-only panel over:
 *  - `cc permissions list --json`    merged allow/ask/deny rules + sources
 *  - `cc permissions recent --json`  recent policy denials
 *  - `cc permissions activity`       actual resources/effects/recovery
 *  - `cc auto-mode config --json`    effective risk→decision map + fine rules
 *  - `cc auto-mode defaults`         precedence chain (config json omits it)
 *  - `cc mcp servers --json`         optional section — this call bootstraps
 *                                    the CLI DB and may fail on machines
 *                                    without one; per-source tolerance turns
 *                                    that into a warning row, never a blank
 *                                    panel.
 *
 * All six sources load in parallel; each failure becomes a warning row.
 * Scoped mutations use validated `cc permissions scoped|revoke` argv. The
 * extension never reads or edits the authority file directly.
 * Model shaping/rendering is pure and lives in ../policy-viewer.js.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");
const {
  buildPolicyArgs,
  buildScopedPermissionCreateArgs,
  buildScopedPermissionRevokeArgs,
  shapePermissionRules,
  shapeDenials,
  shapeSideEffectActivity,
  shapeAutoMode,
  shapeMcpServers,
  buildPolicyModel,
  summarizePolicy,
  renderPolicyHtml,
} = require("../policy-viewer.js");

let _panel = null;
let _getSessionId = () => null;

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

/** Load all six sources in parallel; per-source failures → warning rows. */
async function loadData(vscode) {
  let sessionId = null;
  try {
    sessionId = _getSessionId();
  } catch {
    sessionId = null;
  }
  const args = buildPolicyArgs({ sessionId: sessionId || "default" });
  const errors = [];
  const [permRes, recentRes, activityRes, configRes, defaultsRes, mcpRes] =
    await Promise.all([
      runCliJson(vscode, args.permissionsList),
      runCliJson(vscode, args.recentDenials),
      runCliJson(vscode, args.permissionActivity),
      runCliJson(vscode, args.autoModeConfig),
      runCliJson(vscode, args.autoModeDefaults),
      // mcp servers bootstraps the CLI DB — give it a longer leash.
      runCliJson(vscode, args.mcpServers, { timeoutMs: 30000 }),
    ]);

  let permissions = null;
  if (permRes.ok && permRes.json) {
    permissions = shapePermissionRules(permRes.json);
  } else {
    errors.push({
      source: "cc permissions list",
      message: permRes.error || "no JSON output",
    });
  }

  let denials = null;
  if (recentRes.ok && recentRes.json) {
    denials = shapeDenials(recentRes.json);
  } else {
    errors.push({
      source: "cc permissions recent",
      message: recentRes.error || "no JSON output",
    });
  }

  let autoMode = null;
  if (configRes.ok && configRes.json) {
    // defaults only contributes the precedence chain — tolerate its absence.
    autoMode = shapeAutoMode(
      configRes.json,
      defaultsRes.ok ? defaultsRes.json : null,
    );
  } else {
    errors.push({
      source: "cc auto-mode config",
      message: configRes.error || "no JSON output",
    });
  }
  if (!defaultsRes.ok) {
    errors.push({
      source: "cc auto-mode defaults",
      message: defaultsRes.error || "no JSON output",
    });
  }

  let mcpServers = null;
  if (mcpRes.ok && Array.isArray(mcpRes.json)) {
    mcpServers = shapeMcpServers(mcpRes.json);
  } else {
    errors.push({
      source: "cc mcp servers",
      message: mcpRes.error || "no JSON output",
    });
  }

  let activity = null;
  if (activityRes.ok && activityRes.json) {
    activity = shapeSideEffectActivity(activityRes.json);
  }
  if (!activity) {
    errors.push({
      source: "cc permissions activity",
      message: activityRes.error || "no supported JSON output",
    });
  }

  const model = buildPolicyModel({
    permissions,
    denials,
    activity,
    autoMode,
    mcpServers,
    errors,
  });
  post({
    type: "rows",
    html: renderPolicyHtml(model, { now: Date.now() }),
    summary: summarizePolicy(model),
    scopedGeneration: model.permissions.scopedGeneration,
  });
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.command === "refresh") await loadData(vscode);
  if (msg.command === "createScoped") {
    try {
      const args = buildScopedPermissionCreateArgs({
        decision: msg.decision,
        rule: msg.rule,
        expiresIn: msg.expiresIn,
        reason: msg.reason,
        expectedGeneration: msg.expectedGeneration,
      });
      const result = await runCliJson(vscode, args);
      if (!result.ok || !result.json?.record) {
        throw new Error(result.error || "CLI returned no scoped rule");
      }
      post({ type: "mutation", ok: true, message: "Scoped rule created." });
      await loadData(vscode);
    } catch (error) {
      post({
        type: "mutation",
        ok: false,
        message: String(error?.message || error).slice(0, 400),
      });
    }
  }
  if (msg.command === "revokeScoped") {
    try {
      const args = buildScopedPermissionRevokeArgs({
        id: msg.id,
        revision: msg.revision,
      });
      const result = await runCliJson(vscode, args);
      if (!result.ok || result.json?.record?.status !== "revoked") {
        throw new Error(result.error || "CLI did not confirm revocation");
      }
      post({ type: "mutation", ok: true, message: "Scoped rule revoked." });
      await loadData(vscode);
    } catch (error) {
      post({
        type: "mutation",
        ok: false,
        message: String(error?.message || error).slice(0, 400),
      });
    }
  }
}

function openPolicyViewer(vscode, { getSessionId = () => null } = {}) {
  _getSessionId =
    typeof getSessionId === "function" ? getSessionId : () => null;
  if (_panel) {
    _panel.reveal();
    loadData(vscode);
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainPolicy",
    "ChainlessChain · Permissions & Policy",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderPageHtml();
  _panel.webview.onDidReceiveMessage((msg) => handleMessage(vscode, msg));
  _panel.onDidDispose(() => {
    _panel = null;
  });
  loadData(vscode);
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
  h1 { font-size: 16px; margin: 0 0 6px; }
  h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .05em; opacity: .8; }
  h3 { font-size: 12px; margin: 10px 0 4px; opacity: .8; }
  .bar { display:flex; gap:8px; margin-bottom:8px; align-items:center; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border,#333); vertical-align:top; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .st { font-weight:600; }
  .st.allow { color:#3fb950; }
  .st.ask { color: var(--vscode-editorWarning-foreground, orange); }
  .st.deny, .st.blocked { color: var(--vscode-errorForeground,#f85149); }
  .badge { background: var(--vscode-editorWarning-foreground, orange); color:#1e1e1e; border-radius:8px;
           padding:1px 7px; font-size:10px; font-weight:600; }
  .badge.alt { background: var(--vscode-charts-blue,#3794ff); color:#fff; }
  .muted { opacity:.55; }
  .warn { color: var(--vscode-editorWarning-foreground, orange); margin-bottom:6px; }
  .form { display:grid; grid-template-columns:90px minmax(220px,1fr) 70px minmax(140px,1fr) auto; gap:6px; margin:10px 0; }
  input, select { background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); padding:4px 6px; }
  #mutation.error { color:var(--vscode-errorForeground,#f85149); }
  ol.chain { margin:4px 0 0 18px; padding:0; }
  ol.chain li { margin:2px 0; }
  button { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc);
           border:none; padding:3px 10px; border-radius:4px; cursor:pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  #summary { font-size:11px; opacity:.7; margin-bottom:10px; }
</style>
</head>
<body>
  <h1>Permissions &amp; Policy</h1>
  <div class="bar"><div id="summary"></div><button id="refresh">Refresh</button></div>
  <div class="form" aria-label="Create scoped permission rule">
    <select id="decision"><option>allow</option><option>ask</option><option>deny</option></select>
    <input id="rule" placeholder="Tool(pattern), e.g. Read(./src/**)" />
    <input id="ttl" value="15m" aria-label="TTL" />
    <input id="reason" placeholder="Reason (optional)" />
    <button id="createScoped" disabled>Create scoped rule</button>
  </div>
  <div id="mutation" class="muted"></div>
  <div id="list"><p class="muted">Loading…</p></div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  let scopedGeneration = null;
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('createScoped').addEventListener('click', ()=>{
    if (!Number.isInteger(scopedGeneration)) return;
    vscode.postMessage({
      command:'createScoped',
      decision:document.getElementById('decision').value,
      rule:document.getElementById('rule').value,
      expiresIn:document.getElementById('ttl').value,
      reason:document.getElementById('reason').value,
      expectedGeneration:scopedGeneration,
    });
  });
  document.getElementById('list').addEventListener('click', (ev)=>{
    if (!(ev.target instanceof Element)) return;
    const button = ev.target.closest('.revoke-scoped');
    if (!button) return;
    vscode.postMessage({
      command:'revokeScoped',
      id:button.dataset.ruleId,
      revision:Number(button.dataset.revision),
    });
  });
  window.addEventListener('message', (ev)=>{
    const m = ev.data || {};
    if (m.type==='rows') {
      document.getElementById('list').innerHTML = m.html;
      document.getElementById('summary').textContent = m.summary || '';
      scopedGeneration = Number.isInteger(m.scopedGeneration) ? m.scopedGeneration : null;
      document.getElementById('createScoped').disabled = !Number.isInteger(scopedGeneration);
    }
    if (m.type==='mutation') {
      const status = document.getElementById('mutation');
      status.textContent = m.message || '';
      status.className = m.ok ? 'muted' : 'error';
    }
  });
</script>
</body>
</html>`;
}

module.exports = { openPolicyViewer };
