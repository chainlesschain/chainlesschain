const { execFile } = require("child_process");
const { getResolvedCli } = require("../cli-binary");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");
const {
  parseAutomationCenter,
  recheckAutomationAction,
  recheckCreateRoutine,
  filterAutomationFlows,
  renderAutomationRows,
} = require("../automation-center");

const REFRESH_MS = 15_000;
let panel = null;
let timer = null;
let snapshot = parseAutomationCenter(null);
let query = "";

function cliCommand(vscode) {
  return (
    getResolvedCli() ||
    vscode.workspace.getConfiguration("chainlesschain.cli").get("path") ||
    "cc"
  );
}

function runCli(vscode, args, timeout = 20_000, stdin = null) {
  const shell = process.platform === "win32";
  return new Promise((resolve) => {
    const child = execFile(
      cliCommand(vscode),
      shell ? escapeCmdArgs(args) : args,
      {
        timeout,
        windowsHide: true,
        shell,
        env: hardenedEnv(process.env),
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          stdout: String(stdout || ""),
          error: error
            ? String(stderr || error.message || "").slice(0, 400)
            : null,
        }),
    );
    if (stdin !== null && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }
  });
}

function postRows() {
  panel?.webview.postMessage({
    type: "snapshot",
    connected: snapshot.connected,
    revision: snapshot.revision,
    error: snapshot.error,
    summary: snapshot.summary,
    html: renderAutomationRows(filterAutomationFlows(snapshot.items, query)),
  });
}

async function read(vscode) {
  const result = await runCli(vscode, [
    "automation",
    "center-projection",
    "--json",
  ]);
  return result.ok
    ? parseAutomationCenter(result.stdout)
    : parseAutomationCenter({ reason: result.error });
}

async function refresh(vscode) {
  snapshot = await read(vscode);
  postRows();
}

async function askRoutineDefinition(vscode, current = null) {
  const title = current ? "Edit Routine" : "Create Routine";
  const name = await vscode.window.showInputBox({
    title,
    prompt: "Routine name",
    value: current?.name || "",
    validateInput: (value) => (value.trim() ? null : "Name is required"),
  });
  if (name === undefined) return null;
  const prompt = await vscode.window.showInputBox({
    title,
    prompt: "Agent prompt",
    value: current?.prompt || "",
    validateInput: (value) => (value.trim() ? null : "Prompt is required"),
  });
  if (prompt === undefined) return null;
  const kind = await vscode.window.showQuickPick(
    ["cron", "once", "webhook", "github"],
    {
      title: "Routine trigger",
      placeHolder: current?.trigger?.kind || "Select a trigger",
    },
  );
  if (!kind) return null;
  let trigger;
  if (kind === "cron") {
    const cron = await vscode.window.showInputBox({
      title: "Cron trigger",
      prompt: "Five-field cron expression",
      value:
        current?.trigger?.kind === "cron" ? current.trigger.cron : "0 9 * * *",
    });
    if (cron === undefined) return null;
    trigger = { kind, cron };
  } else if (kind === "once") {
    const at = await vscode.window.showInputBox({
      title: "One-shot trigger",
      prompt: "ISO timestamp or epoch milliseconds",
      value:
        current?.trigger?.kind === "once"
          ? new Date(current.trigger.at).toISOString()
          : new Date(Date.now() + 3_600_000).toISOString(),
    });
    if (at === undefined) return null;
    trigger = { kind, at };
  } else if (kind === "github") {
    const repo = await vscode.window.showInputBox({
      title: "GitHub trigger",
      prompt: "Repository (owner/name)",
      value: current?.trigger?.kind === "github" ? current.trigger.repo : "",
    });
    if (repo === undefined) return null;
    const events = await vscode.window.showInputBox({
      title: "GitHub trigger",
      prompt: "Optional comma-separated event types",
      value:
        current?.trigger?.kind === "github"
          ? (current.trigger.events || []).join(",")
          : "PushEvent,PullRequestEvent",
    });
    if (events === undefined) return null;
    trigger = {
      kind,
      repo,
      events: events
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    };
  } else {
    trigger = { kind: "webhook" };
  }
  return { name, prompt, trigger };
}

async function createRoutine(vscode) {
  const rendered = snapshot;
  const current = await read(vscode);
  const preview = recheckCreateRoutine(rendered, current);
  if (!preview) {
    snapshot = current;
    panel?.webview.postMessage({
      type: "notice",
      text: "Routine catalog changed; refreshed without creating it.",
    });
    postRows();
    return;
  }
  const definition = await askRoutineDefinition(vscode);
  if (!definition) return;
  const result = await runCli(
    vscode,
    preview.argv,
    30_000,
    JSON.stringify(definition),
  );
  panel?.webview.postMessage({
    type: "notice",
    text: result.ok
      ? "Routine created."
      : `Routine create failed: ${result.error}`,
  });
  await refresh(vscode);
}

async function runAction(vscode, message) {
  const rendered = snapshot;
  const request = {
    kind: String(message.kind || ""),
    id: String(message.id || ""),
    action: String(message.action || ""),
    revision: String(message.projectionRevision || ""),
    itemRevision: String(message.itemRevision || ""),
  };
  const current = await read(vscode);
  const preview = recheckAutomationAction(rendered, current, request);
  if (!preview) {
    snapshot = current;
    panel?.webview.postMessage({
      type: "notice",
      text: "Automation changed or the action is unavailable; refreshed without sending it.",
    });
    postRows();
    return;
  }
  if (request.action === "edit") {
    snapshot = current;
    const item = current.items.find(
      (candidate) =>
        candidate.kind === request.kind && candidate.id === request.id,
    );
    const definition = await askRoutineDefinition(vscode, item?.definition);
    if (!definition) return;
    const result = await runCli(
      vscode,
      preview.argv,
      30_000,
      JSON.stringify(definition),
    );
    panel?.webview.postMessage({
      type: "notice",
      text: result.ok
        ? "Routine edited."
        : `Routine edit failed: ${result.error}`,
    });
    await refresh(vscode);
    return;
  }
  const label = request.action.replace("_", " ");
  const impact =
    request.action === "delete"
      ? ` This permanently deletes the disabled ${request.kind}${request.kind === "flow" ? ", its triggers, run history, and automation budget records" : " definition"}.`
      : request.action === "disable"
        ? ` This disables the ${request.kind} and stops future trigger execution.`
        : "";
  const confirmed = await vscode.window.showWarningMessage(
    `Run Automation Center action “${label}” for ${request.kind} ${request.id}?${impact} The CLI will enforce the exact item revision and applicable live authority.`,
    { modal: true },
    "Run action",
  );
  if (confirmed !== "Run action") return;
  const timeout =
    request.kind === "routine" && request.action === "run_now"
      ? 10 * 60_000
      : 30_000;
  const result = await runCli(vscode, preview.argv, timeout);
  panel?.webview.postMessage({
    type: "notice",
    text: result.ok
      ? `${label} completed.`
      : `${label} failed: ${result.error}`,
  });
  await refresh(vscode);
}

function nonce() {
  return require("crypto").randomBytes(16).toString("hex");
}

function html() {
  const n = nonce();
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:14px}h1{font-size:18px;margin:0}.top{display:flex;gap:8px;margin:12px 0}.top input{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:5px}.summary{margin:8px 0;opacity:.8}.flow{border:1px solid var(--vscode-widget-border,#555);border-radius:7px;padding:10px;margin:9px 0}.flow header{display:flex;justify-content:space-between;gap:12px}.status,.kind{font-weight:600}.status.active{color:#3fb950}.status.paused{color:var(--vscode-editorWarning-foreground,orange)}.meta,.triggers{opacity:.7;margin-top:4px}.security{margin-top:7px}.actions{margin-top:9px}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:4px;padding:4px 9px;margin-right:5px}button:disabled{opacity:.45}.empty{opacity:.7;padding:20px 0}li{margin:4px 0}#notice{color:var(--vscode-editorWarning-foreground);margin-top:8px}
</style></head><body><h1>Automation Center</h1><div class="top"><input id="query" placeholder="Filter flows and routines"><button id="create">New routine</button><button id="refresh">Refresh</button></div><div id="summary" class="summary"></div><div id="notice"></div><main id="rows"></main><script nonce="${n}">const vscode=acquireVsCodeApi();let revision="";document.getElementById('refresh').onclick=()=>vscode.postMessage({command:'refresh'});document.getElementById('create').onclick=()=>vscode.postMessage({command:'createRoutine'});document.getElementById('query').oninput=e=>vscode.postMessage({command:'filter',query:e.target.value});document.getElementById('rows').onclick=e=>{const b=e.target.closest('button[data-action]');if(b&&!b.disabled)vscode.postMessage({command:'action',kind:b.dataset.kind,id:b.dataset.id,action:b.dataset.action,itemRevision:b.dataset.revision,projectionRevision:revision})};window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='snapshot'){revision=m.revision||'';document.getElementById('rows').innerHTML=m.html;document.getElementById('summary').textContent=m.connected?m.summary.total+' items · '+m.summary.flows+' flows · '+m.summary.routines+' routines · '+m.summary.active+' active · '+m.summary.paused+' paused · '+m.summary.needsAttention+' need attention':'Disconnected: '+(m.error||'CLI unavailable')}if(m.type==='notice')document.getElementById('notice').textContent=m.text||''});vscode.postMessage({command:'ready'});</script></body></html>`;
}

function openAutomationCenter(vscode) {
  if (panel) {
    panel.reveal();
    refresh(vscode);
    return panel;
  }
  panel = vscode.window.createWebviewPanel(
    "chainlesschainAutomationCenter",
    "ChainlessChain · Automation Center",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = html();
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command === "ready" || message?.command === "refresh") {
      await refresh(vscode);
    } else if (message?.command === "filter") {
      query = String(message.query || "");
      postRows();
    } else if (message?.command === "action") {
      await runAction(vscode, message);
    } else if (message?.command === "createRoutine") {
      await createRoutine(vscode);
    }
  });
  panel.onDidDispose(() => {
    if (timer) clearInterval(timer);
    timer = null;
    panel = null;
    snapshot = parseAutomationCenter(null);
  });
  refresh(vscode);
  timer = setInterval(() => refresh(vscode), REFRESH_MS);
  return panel;
}

module.exports = { openAutomationCenter, runCli, askRoutineDefinition };
