/**
 * Artifacts drawer webview (gap #9) — browse the agent deliverable store
 * (`cc artifacts`, ~/.chainlesschain/artifacts/). List shows METADATA only
 * (never inlined file bodies); actions route through vscode APIs, not
 * `cc artifacts open` (which merely prints a path):
 *
 *  - Preview  markdown → markdown.showPreview on the stored file
 *             image    → <img> via webview.asWebviewUri (localResourceRoots
 *                        pinned to the artifacts dir)
 *             text/log → showTextDocument
 *  - Open in browser (html) → vscode.env.openExternal — artifact html is
 *             NEVER executed inside the panel webview
 *  - Copy path → vscode.env.clipboard
 *  - Reveal   → revealFileInOS
 *  - Download → save-dialog + fs.copyFile to the chosen path
 *  - Remove   → confirm modal, then `cc artifacts remove <id> --json`
 *
 * Singleton panel; row shaping/filtering/rendering is pure and lives in
 * ../artifacts-drawer.js.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const { hardenedEnv } = require("../hardened-env");
const {
  buildArtifactsListArgs,
  buildArtifactsShowArgs,
  buildArtifactsRemoveArgs,
  defaultArtifactsDir,
  shapeArtifacts,
  filterArtifacts,
  renderArtifactsHtml,
  ARTIFACT_KINDS,
} = require("../artifacts-drawer.js");

// Artifact ids come back through webview messages — keep them argv-safe.
const SAFE_ID = /^[\w.-]+$/;

let _panel = null;
let _rows = [];
let _errors = [];
let _query = "";
let _kind = "all";

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
  return new Promise((resolve) => {
    execFile(
      cliCommand(vscode),
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        shell: process.platform === "win32", // cc is a .cmd shim on Windows
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
    html: renderArtifactsHtml(
      filterArtifacts(_rows, { query: _query, kind: _kind }),
      { now: Date.now(), errors: _errors },
    ),
    total: _rows.length,
  });
}

async function loadData(vscode) {
  const res = await runCliJson(vscode, buildArtifactsListArgs());
  if (res.ok) {
    _rows = shapeArtifacts(res.json);
    _errors = [];
  } else {
    _rows = [];
    _errors = [{ source: "cc artifacts list", message: res.error }];
  }
  postRows();
}

/** Stored-file path for an id via `cc artifacts show --json` (authoritative). */
async function storedPathFor(vscode, id) {
  const res = await runCliJson(vscode, buildArtifactsShowArgs(id));
  const p = res.ok && res.json && typeof res.json.storedPath === "string"
    ? res.json.storedPath
    : null;
  if (!p) {
    post({ type: "info", text: `artifact ${id} not found${res.ok ? "" : `: ${res.error}`}` });
  }
  return p;
}

async function runAction(vscode, msg) {
  const id = String(msg.id || "");
  if (!SAFE_ID.test(id)) return;
  const row = _rows.find((r) => r.id === id);

  switch (msg.act) {
    case "preview": {
      const stored = await storedPathFor(vscode, id);
      if (!stored) return;
      const uri = vscode.Uri.file(stored);
      if (row?.preview === "markdown") {
        await vscode.commands.executeCommand("markdown.showPreview", uri);
      } else if (row?.preview === "image") {
        post({
          type: "preview-image",
          src: _panel.webview.asWebviewUri(uri).toString(),
          title: row.title || id,
        });
      } else {
        // text/log/json/patch — plain editor, read as a document
        await vscode.window.showTextDocument(uri, { preview: true });
      }
      return;
    }
    case "openExternal": {
      // html is opened in the OS browser — never executed in this webview.
      const stored = await storedPathFor(vscode, id);
      if (stored) await vscode.env.openExternal(vscode.Uri.file(stored));
      return;
    }
    case "copyPath": {
      const stored = await storedPathFor(vscode, id);
      if (!stored) return;
      await vscode.env.clipboard.writeText(stored);
      post({ type: "info", text: `copied: ${stored}` });
      return;
    }
    case "reveal": {
      const stored = await storedPathFor(vscode, id);
      if (stored) {
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(stored),
        );
      }
      return;
    }
    case "download": {
      const stored = await storedPathFor(vscode, id);
      if (!stored) return;
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(row?.file || id),
        saveLabel: "Download artifact copy",
      });
      if (!target) return;
      try {
        await fs.promises.copyFile(stored, target.fsPath);
        post({ type: "info", text: `saved: ${target.fsPath}` });
      } catch (e) {
        post({ type: "info", text: `download failed: ${e?.message || e}` });
      }
      return;
    }
    case "remove": {
      const proceed = await vscode.window.showWarningMessage(
        `Remove artifact ${id}${row?.title ? ` (“${row.title}”)` : ""}? Its stored copy is deleted. This cannot be undone.`,
        { modal: true },
        "Remove",
      );
      if (proceed !== "Remove") return;
      const r = await runCliJson(vscode, buildArtifactsRemoveArgs(id));
      if (!r.ok) post({ type: "info", text: `remove failed: ${r.error}` });
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
      _kind = String(msg.kind || "all");
      postRows();
      return;
    case "action":
      await runAction(vscode, msg);
      return;
    default:
  }
}

function openArtifactsDrawer(vscode) {
  if (_panel) {
    _panel.reveal();
    loadData(vscode);
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainArtifacts",
    "ChainlessChain · Artifacts",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      // Image previews are served with asWebviewUri from the store only.
      localResourceRoots: [vscode.Uri.file(defaultArtifactsDir())],
    },
  );
  _panel.webview.html = renderPageHtml(_panel.webview.cspSource);
  _panel.webview.onDidReceiveMessage((msg) => handleMessage(vscode, msg));
  _panel.onDidDispose(() => {
    _panel = null;
    _rows = [];
    _errors = [];
    _query = "";
    _kind = "all";
  });
  loadData(vscode);
  return _panel;
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function renderPageHtml(cspSource) {
  const n = nonce();
  // img-src limited to webview resources (the artifacts dir) — no remote loads.
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${cspSource}; script-src 'nonce-${n}';`;
  const kindOptions = ["all", ...ARTIFACT_KINDS]
    .map((k) => `<option value="${k}">${k}</option>`)
    .join("");
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
  .bar input { flex:1; max-width:300px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
               border:1px solid var(--vscode-input-border, transparent); border-radius:4px; padding:5px 8px; }
  .bar select { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
                border:1px solid var(--vscode-input-border, transparent); border-radius:4px; padding:5px 6px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-widget-border,#333); vertical-align:top; }
  th { opacity:.6; font-weight:500; font-size:11px; }
  .kind { opacity:.85; font-size:11px; white-space:nowrap; }
  .muted { opacity:.55; }
  .warn { color: var(--vscode-editorWarning-foreground, orange); margin-bottom:6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border:none; padding:3px 10px; border-radius:4px; cursor:pointer; margin:0 4px 3px 0; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
  #info { min-height:16px; font-size:11px; opacity:.7; margin:6px 0; }
  #preview { display:none; margin:0 0 12px; border:1px solid var(--vscode-widget-border,#333); border-radius:4px; padding:8px; }
  #preview img { max-width:100%; }
  #preview .cap { font-size:11px; opacity:.7; margin-bottom:4px; display:flex; justify-content:space-between; }
</style>
</head>
<body>
  <h1>Artifacts</h1>
  <div class="bar">
    <input id="q" placeholder="Filter by title / id / session / file" />
    <select id="kind">${kindOptions}</select>
    <button id="refresh" class="sec">Refresh</button>
  </div>
  <div id="info"></div>
  <div id="preview"><div class="cap"><span id="pTitle"></span><button id="pClose" class="sec">Close</button></div><img id="pImg" alt="artifact preview" /></div>
  <div id="list"><p class="muted">Loading…</p></div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const sendFilter = () => vscode.postMessage({command:'filter', query: document.getElementById('q').value,
                                               kind: document.getElementById('kind').value});
  document.getElementById('refresh').addEventListener('click', ()=>vscode.postMessage({command:'refresh'}));
  document.getElementById('q').addEventListener('input', sendFilter);
  document.getElementById('kind').addEventListener('change', sendFilter);
  document.getElementById('pClose').addEventListener('click', ()=>{
    document.getElementById('preview').style.display='none';
    document.getElementById('pImg').removeAttribute('src');
  });
  document.getElementById('list').addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    vscode.postMessage({ command:'action', act: b.getAttribute('data-act'), id: b.getAttribute('data-id') });
  });
  window.addEventListener('message', (ev)=>{
    const m = ev.data || {};
    if (m.type==='rows') document.getElementById('list').innerHTML = m.html;
    else if (m.type==='info') document.getElementById('info').textContent = m.text || '';
    else if (m.type==='preview-image') {
      document.getElementById('pTitle').textContent = m.title || '';
      document.getElementById('pImg').setAttribute('src', m.src);
      document.getElementById('preview').style.display='block';
    }
  });
</script>
</body>
</html>`;
}

module.exports = { openArtifactsDrawer };
