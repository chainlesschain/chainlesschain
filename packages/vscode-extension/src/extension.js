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
let _preview = null;

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
  // CLI version-sync: if the installed `cc` is older than this extension's
  // features need, nudge the user to upgrade it (fire-and-forget, best-effort).
  checkCliVersionAndNotify(vscode, context).catch(() => {});
  const facade = createVscodeEditorFacade(vscode);
  // Clean up the terminal shell-integration subscriptions on deactivate.
  context.subscriptions.push({
    dispose: () => facade.disposeTerminalCapture?.(),
  });
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
    state: context.workspaceState, // per-workspace chat session resume
    log,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "chainlesschainIdeChat",
      chatProvider,
    ),
    chatProvider,
  );

  // "Fix with ChainlessChain" (Claude Code parity): a QuickFix lightbulb on any
  // diagnostic seeds the chat panel with a fix request scoped to that file +
  // those problems. Glue is vscode-free in code-actions.js / chat/fix-with-cc.js.
  const { createFixCodeActionProvider } = require("./code-actions.js");
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      createFixCodeActionProvider(vscode),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // "Explain / Refactor selection" (Claude Code parity): right-click a
  // selection → seed the chat panel with a request referencing @selection
  // (the CLI expands it to the live selection via the bridge).
  const seedSelectionAction = (action) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.selection || editor.selection.isEmpty) {
      vscode.window.showInformationMessage(
        "ChainlessChain: select some code first, then Explain / Refactor with ChainlessChain.",
      );
      return;
    }
    const { formatSelectionPrompt } = require("./chat/selection-actions.js");
    const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
    const sel = editor.selection;
    chatProvider.seedInput(
      formatSelectionPrompt(action, {
        relPath: rel,
        startLine: sel.start.line,
        endLine: sel.end.line,
      }),
    );
  };

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
    // App Preview (Claude-Code preview-pane parity): spawn the project's dev
    // server and open the served URL in Simple Browser; the dev server's own
    // HMR handles live reload on edits.
    vscode.commands.registerCommand("chainlesschain.preview.start", () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!cwd) {
        vscode.window.showWarningMessage("Open a folder to preview its app.");
        return;
      }
      if (!_preview) {
        const { createPreviewController } = require("./preview.js");
        _preview = createPreviewController(vscode, { log });
      }
      const res = _preview.start(cwd);
      if (res?.error === "no-dev-script") {
        vscode.window.showWarningMessage(
          "No dev script (dev / start / serve …) found in package.json.",
        );
      } else if (res?.started) {
        vscode.window.setStatusBarMessage(
          `$(globe) Starting app preview (npm run ${res.script})…`,
          5000,
        );
      }
    }),
    vscode.commands.registerCommand("chainlesschain.preview.stop", () => {
      _preview?.stop();
      vscode.window.setStatusBarMessage("$(primitive-square) App preview stopped", 3000);
    }),
    // On-demand: upgrade the `cc` CLI to the latest npm — works any time, not
    // just when the version-sync floor check nags. Runs npm i -g in a terminal.
    vscode.commands.registerCommand("chainlesschain.cli.upgrade", () => {
      upgradeCliInTerminal(vscode);
    }),
    // Project memory (CLI 0.162.41): drive `chainlesschain init` / `memory
    // files` in the shared terminal — cc.md is then auto-loaded by cc agent.
    vscode.commands.registerCommand("chainlesschain.memory.init", async () => {
      const {
        buildInitCommand,
        initQuickPickItems,
        runInTerminal,
      } = require("./project-memory-commands.js");
      const pick = await vscode.window.showQuickPick(initQuickPickItems(), {
        placeHolder:
          "Generate project memory (cc.md) — auto-loaded by chainlesschain agent",
      });
      if (!pick) return;
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      runInTerminal(vscode, buildInitCommand(pick.args), cwd);
    }),
    // Guided LLM setup — thin wizard over `cc config set` + `cc llm test`
    // (one source of truth: ~/.chainlesschain/config.json).
    vscode.commands.registerCommand(
      "chainlesschain.llm.configure",
      async () => {
        const {
          PROVIDER_PRESETS,
          applyLlmConfig,
          testLlm,
        } = require("./llm-config.js");
        const cliCmd =
          vscode.workspace
            .getConfiguration("chainlesschain.cli")
            .get("path") || "cc";
        const pick = await vscode.window.showQuickPick(
          PROVIDER_PRESETS.map((p) => ({
            label: p.label,
            description: p.id,
            detail: `默认模型 ${p.defaultModel} · ${p.needsKey ? "需要 API key" : "免 key"}`,
            preset: p,
          })),
          { placeHolder: "选择 LLM 提供商(写入 ~/.chainlesschain/config.json,CLI 与 Chat 面板共用)" },
        );
        if (!pick) return;
        const preset = pick.preset;
        const model = await vscode.window.showInputBox({
          prompt: `模型名(${preset.id})`,
          value: preset.defaultModel,
          ignoreFocusOut: true,
        });
        if (model === undefined) return;
        let apiKey = "";
        if (preset.needsKey) {
          apiKey =
            (await vscode.window.showInputBox({
              prompt: `${preset.label} 的 API key(只写入本机 config.json,不进 VS Code 设置)`,
              password: true,
              ignoreFocusOut: true,
            })) || "";
          if (!apiKey) {
            vscode.window.showWarningMessage(
              "未输入 API key — 配置已取消(该提供商必须有 key)。",
            );
            return;
          }
        }
        const baseUrl = await vscode.window.showInputBox({
          prompt: "Base URL(回车用默认)",
          value: preset.baseUrl,
          ignoreFocusOut: true,
        });
        if (baseUrl === undefined) return;
        const applied = await applyLlmConfig({
          command: cliCmd,
          answers: { provider: preset.id, model, apiKey, baseUrl },
        });
        if (!applied.ok) {
          vscode.window.showErrorMessage(`LLM 配置写入失败:${applied.error}`);
          return;
        }
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `已写入 ${preset.id} 配置,正在用 cc llm test 验证连通…`,
          },
          async () => {
            const t = await testLlm({ command: cliCmd });
            if (t.ok) {
              vscode.window.showInformationMessage(
                `LLM 配置完成并连通 ✓ (${preset.id} · ${model})。Chat 面板的下一条消息即生效。`,
              );
            } else {
              vscode.window.showWarningMessage(
                `配置已写入,但连通性测试未通过:${t.detail || "见输出"} — 检查 key/网络后可重跑 ChainlessChain: Configure LLM。`,
              );
            }
          },
        );
        chatProvider.onLlmConfigured?.();
      },
    ),
    // Insert File Reference (Cmd/Ctrl+Alt+K — Claude Code parity): take the
    // active editor's workspace-relative path and drop it into the chat input
    // as an `@<path>` reference (the CLI expands it server-side).
    vscode.commands.registerCommand(
      "chainlesschain.chat.insertReference",
      () => {
        const { formatInsertReference } = require("./chat/insert-reference.js");
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage(
            "ChainlessChain: open a file in the editor first, then insert it as an @reference.",
          );
          return;
        }
        const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
        const ref = formatInsertReference(rel);
        if (ref) chatProvider.insertReference(ref);
      },
    ),
    // Fix with ChainlessChain: invoked by the QuickFix lightbulb (with a
    // {uri, diagnostics} payload) OR from the command palette / editor context
    // menu (no args → gather the active editor's problems near the cursor).
    vscode.commands.registerCommand(
      "chainlesschain.chat.fixDiagnostics",
      (payload) => {
        const {
          collectActiveDiagnostics,
        } = require("./code-actions.js");
        const { formatFixPrompt } = require("./chat/fix-with-cc.js");
        let uri = payload && payload.uri;
        let diagnostics =
          payload && Array.isArray(payload.diagnostics)
            ? payload.diagnostics
            : null;
        if (!diagnostics) {
          const active = collectActiveDiagnostics(vscode);
          if (!active) {
            vscode.window.showInformationMessage(
              "ChainlessChain: no problems here — put the cursor on an error or warning, then run Fix with ChainlessChain.",
            );
            return;
          }
          uri = active.uri;
          diagnostics = active.diagnostics;
        }
        if (!diagnostics.length) return;
        const rel = uri
          ? vscode.workspace.asRelativePath(uri, false)
          : "";
        const prompt = formatFixPrompt({ relPath: rel, diagnostics });
        if (prompt) chatProvider.seedInput(prompt);
      },
    ),
    vscode.commands.registerCommand("chainlesschain.chat.explainSelection", () =>
      seedSelectionAction("explain"),
    ),
    vscode.commands.registerCommand(
      "chainlesschain.chat.refactorSelection",
      () => seedSelectionAction("refactor"),
    ),
    vscode.commands.registerCommand("chainlesschain.chat.newConversation", () =>
      chatProvider.newConversation(),
    ),
    vscode.commands.registerCommand(
      "chainlesschain.chat.reopenClosedSession",
      () => chatProvider.reopenClosedSession(),
    ),
    vscode.commands.registerCommand("chainlesschain.memory.files", () => {
      const {
        buildMemoryFilesCommand,
        runInTerminal,
      } = require("./project-memory-commands.js");
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      runInTerminal(vscode, buildMemoryFilesCommand(), cwd);
    }),
    { dispose: () => stopBridge(context) },
  );

  startBridge(context).catch((e) => log("start failed: " + e.message));
}

function deactivate() {
  try {
    _preview?.dispose();
  } catch {
    /* best-effort */
  }
  _preview = null;
  return stopBridge();
}

/** Run `<cliPath> --version`, returning stdout (or null on failure/timeout). */
function runCliVersion(cliPath) {
  const cp = require("child_process");
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const child = cp.spawn(cliPath, ["--version"], {
        shell: true,
        windowsHide: true,
      });
      let out = "";
      child.stdout?.on("data", (d) => {
        out += d.toString();
      });
      child.on("error", () => finish(null));
      child.on("close", () => finish(out.trim() || null));
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* best-effort */
        }
        finish(null);
      }, 5000);
    } catch {
      finish(null);
    }
  });
}

/** Version-sync: nudge to upgrade `cc` if it's older than the extension needs. */
function checkCliVersionAndNotify(vscode, context) {
  const { runCliVersionSync } = require("./version-check");
  const cliPath =
    vscode.workspace.getConfiguration("chainlesschain.cli").get("path") || "cc";
  return runCliVersionSync({
    getVersion: () => runCliVersion(cliPath),
    isDismissed: (k) => !!context.globalState.get(k),
    setDismissed: (k) => context.globalState.update(k, true),
    prompt: async (message) => {
      const pick = await vscode.window.showWarningMessage(
        message,
        "Upgrade cc",
        "Don't show again",
      );
      if (pick === "Upgrade cc") return "upgrade";
      if (pick === "Don't show again") return "dismiss";
      return null;
    },
    upgrade: (command) => upgradeCliInTerminal(vscode, command),
  });
}

/** Run the cc upgrade command in a visible terminal. */
function upgradeCliInTerminal(vscode, command) {
  const { UPGRADE_COMMAND } = require("./version-check");
  const term = vscode.window.createTerminal("ChainlessChain CLI upgrade");
  term.show();
  term.sendText(command || UPGRADE_COMMAND);
}

module.exports = { activate, deactivate };
