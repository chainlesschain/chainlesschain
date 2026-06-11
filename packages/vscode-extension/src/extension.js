/**
 * ChainlessChain IDE Bridge — VS Code extension entry point.
 *
 * On activation it starts a localhost MCP server exposing the IDE tools
 * (getSelection / getDiagnostics / getOpenEditors / openDiff), writes the
 * discovery lockfile, and injects CHAINLESSCHAIN_IDE_PORT/_TOKEN into the
 * integrated terminals of this window so `cc agent` auto-connects (env
 * fast-path). It also surfaces live state through a status bar item, a sidebar
 * tree view, and a webview dashboard — all fed by one activity log.
 * See docs/design/modules/98_IDE桥接对标方案.md.
 *
 * This file is the only one that touches the `vscode` API directly; all logic
 * lives in vscode-free, unit-tested modules.
 */
const vscode = require("vscode");
const { IdeMcpServer } = require("./mcp-http-server");
const { buildIdeTools } = require("./ide-tools");
const { createVscodeEditorFacade } = require("./vscode-facade");
const { writeLock, removeLock, generateToken } = require("./lockfile");
const { ActivityLog, summarizeArgs } = require("./activity-log");
const { createStatusBar } = require("./ui/status-bar");
const { IdeBridgeTreeProvider } = require("./ui/tree-view");
const { openDashboard, refreshDashboard } = require("./ui/dashboard");
const { ChatViewProvider } = require("./chat/chat-view");

let _server = null;
let _port = null;
let _token = null;
let _output = null;
let _workspaceFolders = [];
let _activityLog = null;
let _statusBar = null;
let _treeProvider = null;

function log(msg) {
  try {
    if (_output) _output.appendLine(`[${new Date().toISOString()}] ${msg}`);
  } catch {
    /* ignore */
  }
}

/** Shared, non-sensitive view of the bridge for the UI (never the token). */
function getState() {
  return {
    port: _port || 0,
    workspaceFolders: _workspaceFolders,
    toolCount: _activityLog ? _activityLog.counts().tool : 0,
  };
}

function refreshUi() {
  if (_statusBar) _statusBar.render(getState());
  if (_treeProvider) _treeProvider.refresh();
  if (_activityLog) refreshDashboard(getState, _activityLog);
}

async function stopBridge(context) {
  if (_port != null) {
    removeLock(_port);
    _port = null;
  }
  _token = null;
  if (_server) {
    try {
      await _server.stop();
    } catch {
      /* ignore */
    }
    _server = null;
  }
  try {
    context?.environmentVariableCollection?.clear();
  } catch {
    /* ignore */
  }
  refreshUi();
}

async function startBridge(context) {
  await stopBridge(context);
  const enabled = vscode.workspace
    .getConfiguration("chainlesschain.ide")
    .get("enabled", true);
  if (!enabled) {
    log("bridge disabled via chainlesschain.ide.enabled");
    refreshUi();
    return;
  }
  const token = generateToken();
  _token = token;
  const facade = createVscodeEditorFacade(vscode);
  const tools = buildIdeTools(facade);
  _server = new IdeMcpServer({
    tools,
    token,
    onActivity: (e) => {
      if (!_activityLog) return;
      const argsSummary =
        e && e.type === "tool" ? summarizeArgs(e.tool, e.args) : undefined;
      _activityLog.record({ ...e, argsSummary });
    },
  });
  _port = await _server.start({ host: "127.0.0.1", port: 0 });

  _workspaceFolders = (vscode.workspace.workspaceFolders || []).map(
    (f) => f.uri.fsPath,
  );
  writeLock({ port: _port, token, workspaceFolders: _workspaceFolders });

  // Env fast-path: terminals spawned by this window carry the port + token so
  // the CLI locks onto exactly this instance without scanning.
  try {
    const env = context.environmentVariableCollection;
    env.replace("CHAINLESSCHAIN_IDE_PORT", String(_port));
    env.replace("CHAINLESSCHAIN_IDE_TOKEN", token);
  } catch (e) {
    log("env injection failed: " + e.message);
  }
  log(
    `bridge up on 127.0.0.1:${_port} as MCP server "ide" (${tools.length} tools)`,
  );
  refreshUi();
}

function activate(context) {
  _output = vscode.window.createOutputChannel("ChainlessChain IDE");
  context.subscriptions.push(_output);
  _activityLog = new ActivityLog({ max: 200 });

  // Status bar (always visible; click opens the dashboard).
  _statusBar = createStatusBar(vscode, "chainlesschain.ide.openDashboard");
  context.subscriptions.push(_statusBar.item);
  _statusBar.render(getState());

  // Sidebar tree view.
  _treeProvider = new IdeBridgeTreeProvider(vscode, getState, _activityLog);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "chainlesschainIdeView",
      _treeProvider,
    ),
  );

  // Chat panel: a webview that drives a persistent `cc agent` duplex child.
  // The child env carries this window's bridge port/token, so the agent gets
  // selection context, diagnostics feedback, and native diff reviews here.
  const chatProvider = new ChatViewProvider(vscode, {
    getBridgeEnv: () =>
      _port && _token
        ? {
            CHAINLESSCHAIN_IDE_PORT: String(_port),
            CHAINLESSCHAIN_IDE_TOKEN: _token,
          }
        : {},
    log,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "chainlesschainIdeChat",
      chatProvider,
    ),
    chatProvider,
  );

  // Live UI updates on every logged event.
  context.subscriptions.push({
    dispose: _activityLog.onChange((e) => {
      if (e && e.type === "tool" && _statusBar) {
        _statusBar.flash(e.tool, getState());
      }
      if (_treeProvider) _treeProvider.refresh();
    }),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("chainlesschain.ide.showStatus", () => {
      vscode.window.showInformationMessage(
        _port
          ? `ChainlessChain IDE bridge running on 127.0.0.1:${_port} (server "ide").`
          : "ChainlessChain IDE bridge is stopped.",
      );
    }),
    vscode.commands.registerCommand("chainlesschain.ide.restart", () =>
      startBridge(context).catch((e) => log("restart failed: " + e.message)),
    ),
    vscode.commands.registerCommand("chainlesschain.ide.openDashboard", () =>
      openDashboard(vscode, context, getState, _activityLog),
    ),
    { dispose: () => stopBridge(context) },
  );

  startBridge(context).catch((e) => log("start failed: " + e.message));
}

function deactivate() {
  return stopBridge();
}

module.exports = { activate, deactivate };
