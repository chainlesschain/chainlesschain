/**
 * Plugin / MCP manager webview (P1 #7 + gap #11 quality board) — a singleton
 * panel with four sections: runtime plugins (trust/untrust · uninstall · add),
 * a quality board (per-plugin component counts + broken/lsp/unused flags from
 * `plugin validate` and `code-intel status`), MCP servers (test-connect ·
 * remove), and a read-only skills listing with a filter box. Every action
 * shells out to the CLI's --json commands (plugin-manager.js/plugin-quality.js
 * build the argv, parse the replies) and re-lists afterwards, so the CLI
 * store stays the single source of truth. SDK-bound glue only.
 */
const {
  buildMcpConnectArgs,
  buildMcpRemoveArgs,
  buildMcpServersArgs,
  buildPluginAddArgs,
  buildPluginInstalledArgs,
  buildPluginTrustArgs,
  buildPluginUninstallArgs,
  buildSkillListArgs,
  parseMcpServers,
  parsePluginInstalled,
  parseSkillList,
} = require("../plugin-manager.js");
const {
  buildPluginValidateArgs,
  buildCodeIntelStatusArgs,
  parsePluginValidate,
  parseCodeIntelStatus,
  buildQualityRows,
  renderQualityHtml,
} = require("../plugin-quality.js");

let _panel = null;

async function runCli(args, timeoutMs = 30000) {
  const { runCliText } = require("../chat/introspect-commands.js");
  const { getResolvedCli } = require("../cli-binary");
  return runCliText({ command: getResolvedCli(), args, timeoutMs });
}

async function snapshot() {
  const [pluginsText, mcpText, skillsText, lspText] = await Promise.all([
    runCli(buildPluginInstalledArgs()),
    runCli(buildMcpServersArgs()),
    runCli(buildSkillListArgs(), 60000),
    runCli(buildCodeIntelStatusArgs(), 60000),
  ]);
  const plugins = parsePluginInstalled(pluginsText);
  return {
    type: "update",
    plugins,
    mcp: parseMcpServers(mcpText),
    skills: parseSkillList(skillsText),
    qualityHtml: await gatherQualityHtml(plugins, lspText),
  };
}

/**
 * Quality board (gap #11): per-plugin `plugin validate <dir> --json` +
 * `code-intel status --json` → flag rows. Every per-plugin validate failure is
 * tolerated (that row reports "validate failed"), and an unreadable status
 * probe degrades the LSP flag to "unknown" — one failing source never blanks
 * the section.
 */
async function gatherQualityHtml(plugins, lspText) {
  const validations = {};
  if (Array.isArray(plugins)) {
    await Promise.all(
      plugins.map(async (p) => {
        if (!p.dir) {
          validations[p.name] = {
            failed: true,
            message: "no install dir reported",
          };
          return;
        }
        let out = "";
        try {
          out = await runCli(buildPluginValidateArgs(p.dir));
        } catch {
          /* per-plugin tolerance — parsed below as failed */
        }
        validations[p.name] = parsePluginValidate(out) || {
          failed: true,
          message: "validate produced no JSON",
        };
      }),
    );
  }
  const lspStatus = parseCodeIntelStatus(lspText);
  const rows = buildQualityRows({ plugins, validations, lspStatus });
  return renderQualityHtml(rows, {
    lspStatusAvailable: Array.isArray(lspStatus),
  });
}

function post(payload) {
  if (_panel) _panel.webview.postMessage(payload);
}

async function refresh() {
  post({ type: "busy" });
  post(await snapshot());
}

function openPluginManager(vscode) {
  if (_panel) {
    _panel.reveal();
    refresh().catch(() => {});
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainPluginManager",
    "ChainlessChain · Plugins & MCP",
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
  refresh().catch(() => {});
  return _panel;
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg.command !== "string") return;
  if (msg.command === "refresh") return refresh();

  if (msg.command === "pluginTrust") {
    // Scope must match where the plugin is installed (rows carry it) — the
    // CLI defaults to project scope and untrust at the wrong scope no-ops.
    await runCli(
      buildPluginTrustArgs(msg.name, msg.trusted === true, msg.scope),
    );
    return refresh();
  }
  if (msg.command === "pluginUninstall") {
    const ok = await vscode.window.showWarningMessage(
      `Uninstall plugin ${msg.name} (${msg.scope} scope)? Its installed files are removed.`,
      { modal: true },
      "Uninstall",
    );
    if (ok !== "Uninstall") return;
    await runCli(buildPluginUninstallArgs(msg.name, msg.scope));
    return refresh();
  }
  if (msg.command === "pluginAdd") {
    const source = await vscode.window.showInputBox({
      prompt:
        "Plugin source — a local directory, or a name to fetch from a registry",
      placeHolder: "C:\\path\\to\\plugin  ·  my-plugin",
    });
    if (!source) return;
    const registry = await vscode.window.showInputBox({
      prompt:
        "Registry URL (leave empty to install the source as a local directory)",
      placeHolder: "https://registry.example.com  (optional)",
    });
    if (registry === undefined) return;
    const out = await runCli(
      buildPluginAddArgs(source.trim(), {
        registry: (registry || "").trim() || undefined,
      }),
      120000,
    );
    if (!out) {
      vscode.window.showWarningMessage(
        "ChainlessChain: plugin add produced no output — check the source and registry.",
      );
    }
    return refresh();
  }
  if (msg.command === "mcpRemove") {
    const ok = await vscode.window.showWarningMessage(
      `Remove MCP server ${msg.name} from the configuration?`,
      { modal: true },
      "Remove",
    );
    if (ok !== "Remove") return;
    await runCli(buildMcpRemoveArgs(msg.name));
    return refresh();
  }
  if (msg.command === "mcpConnect") {
    post({ type: "busy" });
    const out = await runCli(buildMcpConnectArgs(msg.name), 60000);
    post(await snapshot());
    post({
      type: "note",
      text: out
        ? `connect ${msg.name}: ${out.trim().slice(0, 400)}`
        : `connect ${msg.name}: no output (server unreachable?)`,
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
  h1 { font-size: 16px; margin: 0 0 12px; }
  h2 { font-size: 13px; margin: 18px 0 6px; opacity:.85; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; padding:4px 10px; border-radius:4px; cursor:pointer; margin-right:4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground, #3a3d41);
               color: var(--vscode-button-secondaryForeground, #ccc); }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border,#333);
           vertical-align:middle; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  .ok { color:#3fb950; } .bad { color: var(--vscode-errorForeground,#f85149); }
  .muted { opacity:.55; }
  .pill { font-size:10px; padding:1px 7px; border-radius:8px;
          background: var(--vscode-editorWidget-background);
          border:1px solid var(--vscode-widget-border, transparent); }
  input { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
          border:1px solid var(--vscode-input-border, transparent); border-radius:3px;
          padding:3px 8px; }
  #note { font-family: var(--vscode-editor-font-family); font-size:11px; opacity:.75;
          white-space:pre-wrap; margin-top:10px; }
  .err { color: var(--vscode-errorForeground,#f85149); }
  .warnflag { color: var(--vscode-editorWarning-foreground, orange); }
  .pill.ok { color:#3fb950; } .pill.bad { color: var(--vscode-errorForeground,#f85149); }
  .pill.muted { opacity:.55; }
</style>
</head>
<body>
  <h1>ChainlessChain · Plugins &amp; MCP <span id="busy" class="muted"></span></h1>
  <div>
    <button id="refresh">Refresh</button>
    <button id="pluginAdd" class="sec">Add plugin…</button>
  </div>

  <h2>Runtime plugins</h2>
  <div id="plugins"></div>

  <h2>Quality</h2>
  <div id="quality"><p class="muted">Analyzing…</p></div>

  <h2>MCP servers</h2>
  <div id="mcp"></div>

  <h2>Skills <input id="skillFilter" placeholder="filter…" /></h2>
  <div id="skills"></div>
  <div id="note"></div>

<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  let last = null;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('pluginAdd').addEventListener('click', ()=>vscode.postMessage({command:'pluginAdd'}));
  document.getElementById('skillFilter').addEventListener('input', ()=>{ if(last) renderSkills(last.skills); });

  function renderPlugins(rows){
    const el = document.getElementById('plugins');
    if (rows === null){ el.innerHTML = '<p class="err">could not read plugins (is cc installed?)</p>'; return; }
    if (!rows.length){ el.innerHTML = '<p class="muted">No runtime plugins installed — Add plugin… installs a directory or a registry package.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>plugin</th><th>version</th><th>scope</th><th>manifest</th><th style="width:220px"></th></tr></thead><tbody>'
      + rows.map(p => '<tr><td>'+esc(p.name)+'</td><td>'+esc(p.version)+'</td>'
        + '<td><span class="pill">'+esc(p.scope)+'</span></td>'
        + '<td>'+(p.ok?'<span class="ok">✔ ok</span>':'<span class="bad">✖ invalid</span>')+'</td>'
        + '<td>'
        + '<button class="sec" data-act="trust" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Trust</button>'
        + '<button class="sec" data-act="untrust" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Untrust</button>'
        + '<button class="sec" data-act="uninstall" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Uninstall</button>'
        + '</td></tr>').join('')
      + '</tbody></table>';
  }

  function renderMcp(rows){
    const el = document.getElementById('mcp');
    if (rows === null){ el.innerHTML = '<p class="err">could not read MCP servers</p>'; return; }
    if (!rows.length){ el.innerHTML = '<p class="muted">No MCP servers configured — add one with <code>cc mcp add</code>.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>server</th><th>transport</th><th>endpoint</th><th>policy</th><th style="width:170px"></th></tr></thead><tbody>'
      + rows.map(s => '<tr><td>'+esc(s.name)+(s.autoConnect?' <span class="pill">auto</span>':'')+'</td>'
        + '<td>'+esc(s.transport||'?')+'</td>'
        + '<td class="muted">'+esc(s.url||s.command||'')+'</td>'
        + '<td>'+(s.allowed?'<span class="ok">ok</span>':'<span class="bad">blocked: '+esc(s.reason)+'</span>')+'</td>'
        + '<td>'
        + '<button class="sec" data-act="connect" data-name="'+esc(s.name)+'">Test</button>'
        + '<button class="sec" data-act="mcpRemove" data-name="'+esc(s.name)+'">Remove</button>'
        + '</td></tr>').join('')
      + '</tbody></table>';
  }

  function renderSkills(rows){
    const el = document.getElementById('skills');
    if (rows === null){ el.innerHTML = '<p class="err">could not read skills</p>'; return; }
    const q = document.getElementById('skillFilter').value.trim().toLowerCase();
    const filtered = q ? rows.filter(s => (s.id+' '+s.name+' '+s.category+' '+s.description).toLowerCase().includes(q)) : rows;
    const shown = filtered.slice(0, 60);
    el.innerHTML = '<p class="muted">'+filtered.length+' skill(s)'+(q?' matching "'+esc(q)+'"':'')+(filtered.length>shown.length?' — showing first '+shown.length:'')+'</p>'
      + '<table><thead><tr><th>skill</th><th>category</th><th>source</th></tr></thead><tbody>'
      + shown.map(s => '<tr><td title="'+esc(s.description)+'">'+esc(s.name)+'</td><td class="muted">'+esc(s.category)+'</td><td><span class="pill">'+esc(s.source||'?')+'</span></td></tr>').join('')
      + '</tbody></table>';
  }

  document.body.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const name = b.getAttribute('data-name');
    const act = b.getAttribute('data-act');
    if (act === 'trust') vscode.postMessage({command:'pluginTrust', name, trusted:true, scope: b.getAttribute('data-scope')||'user'});
    else if (act === 'untrust') vscode.postMessage({command:'pluginTrust', name, trusted:false, scope: b.getAttribute('data-scope')||'user'});
    else if (act === 'uninstall') vscode.postMessage({command:'pluginUninstall', name, scope: b.getAttribute('data-scope')||'user'});
    else if (act === 'connect') vscode.postMessage({command:'mcpConnect', name});
    else if (act === 'mcpRemove') vscode.postMessage({command:'mcpRemove', name});
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'busy'){ document.getElementById('busy').textContent = '· working…'; return; }
    if (m.type === 'note'){ document.getElementById('note').textContent = m.text || ''; return; }
    if (m.type === 'update'){
      document.getElementById('busy').textContent = '';
      last = m;
      renderPlugins(m.plugins);
      renderMcp(m.mcp);
      renderSkills(m.skills);
      // Quality rows are rendered (and escaped) host-side in plugin-quality.js.
      document.getElementById('quality').innerHTML = m.qualityHtml || '';
    }
  });
</script>
</body>
</html>`;
}

module.exports = { openPluginManager };
