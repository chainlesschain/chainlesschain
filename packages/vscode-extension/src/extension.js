/**
 * ChainlessChain IDE Bridge — VS Code extension entry point.
 *
 * On activation it starts a localhost MCP server exposing the IDE tools
 * (getSelection / getDiagnostics / getOpenEditors / openDiff), writes the
 * discovery lockfile, and injects CHAINLESSCHAIN_IDE_PORT/_TOKEN into the
 * integrated terminals of this window so `cc agent` auto-connects (env
 * fast-path). See docs/design/modules/98_IDE桥接对标方案.md.
 *
 * This file is the only one that touches the `vscode` API directly; all logic
 * lives in vscode-free, unit-tested modules.
 */
const vscode = require("vscode");
const { IdeMcpServer } = require("./mcp-http-server");
const { buildIdeTools } = require("./ide-tools");
const { createVscodeEditorFacade } = require("./vscode-facade");
const { writeLock, removeLock, generateToken } = require("./lockfile");

let _server = null;
let _port = null;
let _output = null;

function log(msg) {
  try {
    if (_output) _output.appendLine(`[${new Date().toISOString()}] ${msg}`);
  } catch {
    /* ignore */
  }
}

async function stopBridge(context) {
  if (_port != null) {
    removeLock(_port);
    _port = null;
  }
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
}

async function startBridge(context) {
  await stopBridge(context);
  const enabled = vscode.workspace
    .getConfiguration("chainlesschain.ide")
    .get("enabled", true);
  if (!enabled) {
    log("bridge disabled via chainlesschain.ide.enabled");
    return;
  }
  const token = generateToken();
  const facade = createVscodeEditorFacade(vscode);
  const tools = buildIdeTools(facade);
  _server = new IdeMcpServer({ tools, token });
  _port = await _server.start({ host: "127.0.0.1", port: 0 });

  const folders = (vscode.workspace.workspaceFolders || []).map(
    (f) => f.uri.fsPath,
  );
  writeLock({ port: _port, token, workspaceFolders: folders });

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
}

function activate(context) {
  _output = vscode.window.createOutputChannel("ChainlessChain IDE");
  context.subscriptions.push(_output);

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
    { dispose: () => stopBridge(context) },
  );

  startBridge(context).catch((e) => log("start failed: " + e.message));
}

function deactivate() {
  return stopBridge();
}

module.exports = { activate, deactivate };
