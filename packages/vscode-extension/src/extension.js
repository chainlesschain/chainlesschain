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
const { buildIdeCapabilities } = require("./ide-capabilities");
const { buildIdeTools } = require("./ide-tools");
const { createVscodeEditorFacade } = require("./vscode-facade");
const {
  writeLock,
  removeLock,
  pruneStaleLocks,
  generateToken,
  loadLockfileSecurityPolicy,
} = require("./lockfile");
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
let _remoteControl = null;
// Module-level so command callbacks registered in activate() (e.g. the
// diff.accept/reject keybindings) can reach the facade created per-bridge in
// startBridge(); reassigned on every restart, nulled on stop.
let _facade = null;

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
  // Dispose the per-bridge facade here (not via context.subscriptions) so a
  // restart doesn't stack a second set of terminal shell-integration
  // subscriptions on top of the old one.
  try {
    _facade?.disposeTerminalCapture?.();
  } catch {
    /* ignore */
  }
  _facade = null;
  refreshUi();
}

async function startBridge(context) {
  await stopBridge(context);
  // Sweep lockfiles left by crashed/force-killed instances (ephemeral ports mean
  // each crash leaves a distinct orphan that normal shutdown never cleans).
  try {
    const pruned = pruneStaleLocks();
    if (pruned > 0) log(`pruned ${pruned} stale IDE lockfile(s)`);
  } catch {
    /* best-effort — pruning must never block bridge start */
  }
  const enabled = vscode.workspace
    .getConfiguration("chainlesschain.ide")
    .get("enabled", true);
  if (!enabled) {
    log("bridge disabled via chainlesschain.ide.enabled");
    refreshUi();
    return;
  }
  // Only the organization-controlled managed settings layer can permit an
  // insecure lockfile downgrade. Malformed managed policy is fail-closed.
  const lockfileSecurity = loadLockfileSecurityPolicy();
  if (lockfileSecurity.allowInsecurePermissions) {
    log(
      "managed policy permits bridge startup when owner-only lockfile " +
        `permissions cannot be verified (${lockfileSecurity.managedFile})`,
    );
  }
  const token = generateToken();
  _token = token;
  // Resolve the CLI binary first (cc may be shadowed by the C compiler, also
  // named `cc`) — tries cc → chainlesschain → clc → clchain and caches the one
  // that actually answers as chainlesschain, so the panel spawn + every probe
  // agree. THEN the CLI checks (fire-and-forget, best-effort), in priority order:
  //  1. cc missing entirely → prompt to install (the panel can't work without it)
  //  2. cc too old for this extension's features → hard-floor upgrade nudge
  //  3. a newer cc is available on npm → soft "update available" nudge
  // (1) short-circuits the rest; (2) short-circuits (3).
  (async () => {
    const { resolveCliBinary, setResolvedCli } = require("./cli-binary");
    const cliCfg = vscode.workspace.getConfiguration("chainlesschain.cli");
    const configuredPath = cliCfg.get("path");
    const managedEnabled = cliCfg.get("managed.enabled", true) !== false;
    const bin = await resolveCliBinary({
      configuredPath,
      getVersionOf: (b) => runCliVersion(b),
      // Managed CLI runtime (see managed-cli.js): consulted ONLY after every
      // global probe failed, and never when an explicit path is configured —
      // an explicit `chainlesschain.cli.path` is never silently replaced.
      getManaged: managedEnabled
        ? () => resolveManagedCliCommand(context)
        : undefined,
    });
    setResolvedCli(bin);
    const missing = await notifyIfCliMissing(vscode, context);
    if (missing) return; // no usable cc → version checks are moot
    const res = await checkCliVersionAndNotify(vscode, context);
    if (res === "none") await checkLatestCliAndNotify(vscode, context);
    // One-shot "What's New" toast when cc changed since the last activation
    // (first run stores silently — no toast for a fresh install).
    try {
      const { parseCliVersion } = require("./version-check");
      const { upgradeNudge } = require("./whats-new.js");
      const cur = parseCliVersion((await runCliVersion(bin)) || "");
      const KEY = "chainlesschain.lastSeenCcVersion";
      const prev = context.globalState?.get?.(KEY) || null;
      const nudge = upgradeNudge(prev, cur);
      if (cur && cur !== prev) await context.globalState?.update?.(KEY, cur);
      if (nudge) {
        vscode.window.showInformationMessage(nudge.message, nudge.button).then(
          (pick) => {
            if (pick === nudge.button) {
              vscode.commands.executeCommand("chainlesschain.cli.whatsNew");
            }
          },
          () => {},
        );
      }
    } catch {
      /* best-effort */
    }
  })().catch(() => {});
  const facade = createVscodeEditorFacade(vscode, {
    // getPreviewState reads the App Preview controller lazily — it is created
    // by the preview.start command, possibly after the bridge is up.
    getPreview: () => _preview,
  });
  _facade = facade;
  const tools = buildIdeTools(facade);
  _server = new IdeMcpServer({
    tools,
    ideCapabilities: buildIdeCapabilities(tools),
    token,
    onError: (e) => log("ide bridge server error: " + (e?.message || e)),
    onActivity: (e) => {
      if (!_activityLog) return;
      const argsSummary =
        e && e.type === "tool" ? summarizeArgs(e.tool, e.args) : undefined;
      _activityLog.record({ ...e, argsSummary });
    },
  });
  try {
    _port = await _server.start({ host: "127.0.0.1", port: 0 });

    _workspaceFolders = (vscode.workspace.workspaceFolders || []).map(
      (f) => f.uri.fsPath,
    );
    writeLock({
      port: _port,
      token,
      workspaceFolders: _workspaceFolders,
      allowInsecurePermissions: lockfileSecurity.allowInsecurePermissions,
    });
  } catch (e) {
    // A permission/verification failure happens after the ephemeral port was
    // bound. Stop it immediately and remove any partial discovery files.
    await stopBridge(context);
    throw e;
  }

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
    enableSessionIndex: true,
    log,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "chainlesschainIdeChat",
      chatProvider,
      // Keep the panel's DOM alive when you switch sidebar views and back, so the
      // conversation transcript isn't lost (the panel doesn't replay it) and the
      // webview isn't torn down + rebuilt each time. The transcript node cap
      // (0.36.5) bounds the retained memory.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    chatProvider,
  );
  if (typeof vscode.window.onDidChangeActiveTextEditor === "function") {
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() =>
        chatProvider.updatePlanReviewContext(),
      ),
    );
  }

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

  // "✨ Explain / Refactor" CodeLens above functions/methods/classes: one
  // click selects the symbol's full range and seeds the SAME @selection
  // prompt as the context-menu actions. Symbols come from the IDE's own
  // DocumentSymbolProvider; chainlesschain.codeLens.enabled turns it off (the
  // change event refreshes open editors without a reload).
  const { createCcCodeLensProvider } = require("./code-lens.js");
  const lensRefresh = new vscode.EventEmitter();
  const lensSeed = (action) => async (uri, range) => {
    try {
      if (!uri || !range) return;
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
      });
      editor.selection = new vscode.Selection(range.start, range.end);
      seedSelectionAction(action);
    } catch {
      /* lens is best-effort sugar over the context-menu action */
    }
  };
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      createCcCodeLensProvider(vscode, { onDidChange: lensRefresh.event }),
    ),
    lensRefresh,
    vscode.commands.registerCommand(
      "chainlesschain.lens.explain",
      lensSeed("explain"),
    ),
    vscode.commands.registerCommand(
      "chainlesschain.lens.refactor",
      lensSeed("refactor"),
    ),
  );

  // Inline ghost-text completion (manual trigger). The provider only fires on an
  // explicit Invoke (the keybinding → the built-in inline trigger), so typing
  // never spawns an LLM; it reuses `cc complete` (the configured LLM).
  {
    const { createInlineCompletionProvider } = require("./completion");
    const { getResolvedCli } = require("./cli-binary");
    const cwdForDoc = (document) => {
      try {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (folder?.uri?.fsPath) return folder.uri.fsPath;
        const first = vscode.workspace.workspaceFolders?.[0];
        return first?.uri?.fsPath;
      } catch {
        return undefined;
      }
    };
    const inlineProvider = createInlineCompletionProvider({
      vscode,
      getCommand: getResolvedCli,
      getCwd: cwdForDoc,
      isEnabled: () =>
        vscode.workspace
          .getConfiguration("chainlesschain")
          .get("completion.enabled", true) !== false,
    });
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: "**" },
        inlineProvider,
      ),
      vscode.commands.registerCommand("chainlesschain.complete.trigger", () => {
        vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      }),
    );
  }
  if (typeof vscode.workspace.onDidChangeConfiguration === "function") {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e?.affectsConfiguration?.("chainlesschain.codeLens")) {
          lensRefresh.fire();
        }
      }),
    );
  }

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
    // Diagnose Bridge: this window's bridge state + the CLI's own discovery
    // view (`cc ide status` / `cc ide doctor`) in one report — when a terminal
    // `cc agent` won't auto-connect, the WHY lives on the CLI side.
    vscode.commands.registerCommand("chainlesschain.ide.doctor", async () => {
      const doctor = require("./ide-doctor.js");
      const { runCliText } = require("./chat/introspect-commands.js");
      const { getResolvedCli } = require("./cli-binary");
      const command = getResolvedCli();
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      const [statusText, doctorText] = await Promise.all([
        runCliText({
          command,
          args: doctor.IDE_STATUS_ARGS,
          cwd,
          timeoutMs: 15000,
        }),
        runCliText({
          command,
          args: doctor.IDE_DOCTOR_ARGS,
          cwd,
          timeoutMs: 15000,
        }),
      ]);
      const doc = await vscode.workspace.openTextDocument({
        content: doctor.formatBridgeReport({
          port: _port,
          statusText,
          doctorText,
          extensionVersion: context.extension.packageJSON.version,
          vscodeVersion: vscode.version,
          workspaceTrusted: vscode.workspace.isTrusted,
          workspace: cwd || "(no workspace folder)",
        }),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
    vscode.commands.registerCommand(
      "chainlesschain.ide.exportDiagnostics",
      async () => {
        const path = require("path");
        const os = require("os");
        const { runCliText } = require("./chat/introspect-commands.js");
        const { getResolvedCli } = require("./cli-binary");
        const {
          exportDiagnosticBundleToPath,
        } = require("./diagnostic-export.js");
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(cwd || os.homedir(), "cc-diagnostic-bundle.json"),
          ),
          filters: { JSON: ["json"] },
          saveLabel: "Export de-identified diagnostics",
        });
        if (!uri) return;
        if (uri.scheme && uri.scheme !== "file") {
          vscode.window.showErrorMessage(
            "ChainlessChain: diagnostics can only be exported to a local file.",
          );
          return;
        }
        const result = await exportDiagnosticBundleToPath({
          command: getResolvedCli(),
          cwd,
          targetPath: uri.fsPath,
          runCliText,
        });
        if (!result.ok) {
          vscode.window.showErrorMessage(
            `ChainlessChain: diagnostic export failed — ${result.reason}`,
          );
          return;
        }
        const pick = await vscode.window.showInformationMessage(
          `ChainlessChain: de-identified diagnostic bundle exported to ${result.path}`,
          "Open",
        );
        if (pick === "Open") {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        }
      },
    ),
    vscode.commands.registerCommand("chainlesschain.ide.openDashboard", () =>
      openDashboard(vscode, context, getState, _activityLog),
    ),
    // Read-only PR/CI status: the CLI remains authoritative for linked-PR
    // lookup and fail-closed merge eligibility; the IDE only renders JSON and
    // never merges or pushes.
    vscode.commands.registerCommand("chainlesschain.session.prStatus", async () => {
      const { runCliText } = require("./chat/introspect-commands.js");
      const { getResolvedCli } = require("./cli-binary");
      const { parsePrStatusJson, prStatusToMarkdown } = require("./pr-status-view.js");
      const text = await runCliText({
        command: getResolvedCli(),
        args: ["session", "pr-status", "last", "--json"],
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath,
        timeoutMs: 30000,
      });
      const status = parsePrStatusJson(text);
      if (!status) {
        vscode.window.showWarningMessage(
          `ChainlessChain: PR status unavailable — ${text || "no linked PR or valid JSON"}`,
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: prStatusToMarkdown(status),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    // Read-only "cc team" monitor: pick the `cc team run --state <file>`
    // snapshot (remembered per workspace) and watch it live — task graph,
    // lease holders, budget. The CLI runs the team; this window watches.
    vscode.commands.registerCommand("chainlesschain.team.monitor", async () => {
      const KEY = "chainlesschain.team.lastStatePath";
      const last = context.workspaceState.get(KEY);
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Monitor this team state file",
        title: "Select a `cc team run --state <file>` JSON snapshot",
        defaultUri: last ? vscode.Uri.file(last) : undefined,
        filters: { "Team state": ["json"], "All files": ["*"] },
      });
      const file = picked && picked[0] && picked[0].fsPath;
      if (!file) return;
      await context.workspaceState.update(KEY, file);
      const { openTeamMonitor } = require("./ui/team-monitor-view.js");
      openTeamMonitor(vscode, file);
    }),
    // Background Agents panel: list `cc agent --bg` supervisor sessions,
    // interactively take one over (follow-up prompts / stop-turn via the
    // agent-sdk pipe client — same transport `cc attach` speaks), and
    // stop / rename / resume through the CLI's --json commands.
    vscode.commands.registerCommand("chainlesschain.background.agents", () => {
      const {
        openBackgroundAgents,
      } = require("./ui/background-agents-view.js");
      openBackgroundAgents(vscode);
    }),
    // Sessions Workbench (gap #3 跨端 session 入口): one panel aggregating
    // chat sessions (cc session list), cross-IDE session index, background
    // agents, and remote-control hosts — with resume/attach/rename/delete/
    // stop/continue routed to the existing flows. Resume reuses the chat
    // view's resumeSessionId (same path /sessions and deep links take).
    vscode.commands.registerCommand("chainlesschain.sessions.workbench", () => {
      const { openSessionsWorkbench } = require("./ui/sessions-view.js");
      openSessionsWorkbench(vscode, {
        resumeChatSession: (id) => {
          vscode.commands.executeCommand("chainlesschainIdeChat.focus");
          chatProvider.resumeSessionId(id);
        },
      });
    }),
    // Artifacts drawer (gap #9): browse the agent deliverable store
    // (`cc artifacts`) — metadata list + preview (markdown/image/text via
    // vscode APIs; html opens externally, never executed in the webview),
    // copy path / reveal / download / remove.
    vscode.commands.registerCommand("chainlesschain.artifacts.show", () => {
      const { openArtifactsDrawer } = require("./ui/artifacts-view.js");
      openArtifactsDrawer(vscode);
    }),
    // Permission / policy viewer (gap #10): read-only panel over
    // `cc permissions list/recent`, `cc auto-mode config/defaults` and
    // `cc mcp servers` — merged rules with source + managed badge, recent
    // denials, the auto-mode decision matrix and precedence chain.
    vscode.commands.registerCommand("chainlesschain.policy.show", () => {
      const { openPolicyViewer } = require("./ui/policy-view.js");
      openPolicyViewer(vscode);
    }),
    // Chrome connector (P1 #8): drive `cc browse chrome` — launch a
    // debuggable Chrome (dedicated profile keeps login state), check the CDP
    // port, and capture a tab's state (console/network/DOM/screenshot) as a
    // markdown report the agent can also reproduce via the same CLI command.
    vscode.commands.registerCommand(
      "chainlesschain.chrome.connector",
      async () => {
        const {
          buildChromeLaunchArgs,
          buildChromeStateArgs,
          buildChromeStatusArgs,
          parseChromeJson,
          stateToMarkdown,
        } = require("./chrome-connector.js");
        const { runCliText } = require("./chat/introspect-commands.js");
        const { getResolvedCli } = require("./cli-binary");
        const command = getResolvedCli();
        const status = parseChromeJson(
          await runCliText({
            command,
            args: buildChromeStatusArgs(),
            timeoutMs: 15000,
          }),
        );
        const connected = status?.ok === true;
        const pick = await vscode.window.showQuickPick(
          connected
            ? [
                {
                  label: "$(device-camera) Capture page state",
                  action: "state",
                },
                {
                  label: "$(refresh) Capture with reload",
                  description: "catches load-time console/network",
                  action: "stateReload",
                },
              ]
            : [
                {
                  label: "$(rocket) Launch connected Chrome",
                  description:
                    "dedicated profile — sign in once there, login state persists",
                  action: "launch",
                },
              ],
          {
            placeHolder: connected
              ? `Connected: ${status.browser || "Chrome"} on port ${status.port}`
              : "No debuggable Chrome on port 9222",
          },
        );
        if (!pick) return;
        if (pick.action === "launch") {
          const res = parseChromeJson(
            await runCliText({
              command,
              args: buildChromeLaunchArgs({}),
              timeoutMs: 30000,
            }),
          );
          vscode.window.showInformationMessage(
            res?.ok
              ? vscode.l10n.t(
                  "Connected Chrome launched (CDP port 9222). Open your page there, then run this command again to capture its state.",
                )
              : vscode.l10n.t(
                  "Could not launch Chrome — install Chrome/Edge or set CHROME_PATH.",
                ),
          );
          return;
        }
        const shot = require("path").join(
          require("os").tmpdir(),
          `cc-chrome-${Date.now()}.png`,
        );
        const state = parseChromeJson(
          await runCliText({
            command,
            args: buildChromeStateArgs({
              reload: pick.action === "stateReload",
              screenshotPath: shot,
            }),
            timeoutMs: 60000,
          }),
        );
        const markdown = stateToMarkdown(state);
        if (!markdown) {
          vscode.window.showWarningMessage(
            `ChainlessChain: could not capture page state — ${state?.error || "no output"}`,
          );
          return;
        }
        const doc = await vscode.workspace.openTextDocument({
          content: markdown,
          language: "markdown",
        });
        try {
          await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
        } catch {
          await vscode.window.showTextDocument(doc, { preview: false });
        }
        if (state.screenshotPath) {
          try {
            await vscode.commands.executeCommand(
              "vscode.open",
              vscode.Uri.file(state.screenshotPath),
            );
          } catch {
            /* screenshot open is best-effort */
          }
        }
      },
    ),
    // Worktree parallel tasks (P1 #9): list agent task worktrees with change
    // footprint + merge-conflict preview; new isolated task / merge / discard.
    vscode.commands.registerCommand("chainlesschain.worktree.tasks", () => {
      const { openWorktreeTasks } = require("./ui/worktree-tasks-view.js");
      openWorktreeTasks(vscode);
    }),
    // Plugin / MCP manager (P1 #7): a webview over the CLI's --json surface —
    // runtime plugins (trust/uninstall/add), MCP servers (test/remove), and a
    // filterable read-only skills listing.
    vscode.commands.registerCommand("chainlesschain.plugins.manage", () => {
      const { openPluginManager } = require("./ui/plugin-manager-view.js");
      openPluginManager(vscode);
    }),
    // Remote Control (cc remote-control): start a pairing host so a phone /
    // web panel can drive this machine's agent sessions, show the one-time
    // pairing URI, list hosts, stop them. The host child belongs to this
    // window and is torn down on deactivate.
    vscode.commands.registerCommand("chainlesschain.remote.control", () => {
      if (!_remoteControl) {
        const { createRemoteControlHost } = require("./remote-control-host.js");
        _remoteControl = createRemoteControlHost(vscode, {
          command: () => {
            const configured = vscode.workspace
              .getConfiguration("chainlesschain.cli")
              .get("path");
            if (configured && configured !== "cc") return configured;
            return require("./cli-binary").getResolvedCli();
          },
          log,
        });
      }
      _remoteControl.openMenu().catch(() => {});
    }),
    // Diff-review keyboard decisions (Claude-Code IDE parity): Accept / Reject
    // the diff openDiff is currently blocking on, without reaching for the
    // notification buttons. Scoped to `chainlesschainDiffActive` so the keys are
    // inert when no review is open; a no-op if the review already settled.
    vscode.commands.registerCommand("chainlesschain.diff.accept", () =>
      _facade?.acceptActiveDiff?.(),
    ),
    vscode.commands.registerCommand("chainlesschain.diff.reject", () =>
      _facade?.rejectActiveDiff?.(),
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
      vscode.window.setStatusBarMessage(
        "$(primitive-square) App preview stopped",
        3000,
      );
    }),
    // On-demand: upgrade the `cc` CLI to the latest npm — works any time, not
    // just when the version-sync floor check nags. Runs npm i -g in a terminal.
    vscode.commands.registerCommand("chainlesschain.cli.upgrade", () => {
      upgradeCliInTerminal(vscode);
    }),
    // Managed CLI runtime (插件托管/内置 CLI): download a verified copy of the
    // chainlesschain npm package into extension storage and run it via the
    // PATH `node` — for machines without a usable global cc. The previously
    // active version stays one rollback away.
    vscode.commands.registerCommand("chainlesschain.cli.installManaged", () => {
      installManagedCliCommand(vscode, context).catch(() => {});
    }),
    vscode.commands.registerCommand(
      "chainlesschain.cli.rollbackManaged",
      () => {
        rollbackManagedCliCommand(vscode, context).catch(() => {});
      },
    ),
    // On-demand: check the installed cc against npm `latest` and report — unlike
    // the activation nudge this ALWAYS shows a result (incl. "up to date") and
    // ignores the once-per-version throttle / "don't show again".
    vscode.commands.registerCommand("chainlesschain.cli.checkUpdate", () => {
      checkCliUpdateManually(vscode).catch(() => {});
    }),
    // What's New: render `cc changelog --json` (ships offline with the CLI
    // since 0.162.151) as a markdown preview. Also the target of the one-shot
    // "cc updated" toast fired from the activation version check.
    vscode.commands.registerCommand("chainlesschain.cli.whatsNew", async () => {
      const {
        buildChangelogArgs,
        parseChangelogJson,
        loadBundledChangelog,
        changelogToMarkdown,
        MIN_CHANGELOG_CLI,
      } = require("./whats-new.js");
      const { runCliText } = require("./chat/introspect-commands.js");
      const { getResolvedCli } = require("./cli-binary");
      const text = await runCliText({
        command: getResolvedCli(),
        args: buildChangelogArgs({}),
        timeoutMs: 15000,
      });
      const releases =
        parseChangelogJson(text) || loadBundledChangelog({ command: getResolvedCli() });
      if (!releases || releases.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            "ChainlessChain: could not read cc release notes — needs cc ≥ {0} (upgrade with npm i -g chainlesschain, then retry).",
            MIN_CHANGELOG_CLI,
          ),
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: changelogToMarkdown(releases),
        language: "markdown",
      });
      try {
        await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
      } catch {
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    }),
    // Token usage report (P1 #6): join `cc session usage --json` with
    // `cc session list --json` and preview a markdown report — all-time /
    // activity-window totals, per-model rollup, top sessions.
    vscode.commands.registerCommand("chainlesschain.usage.show", async () => {
      const {
        buildSessionListArgs,
        buildUsageArgs,
        parseSessionListJson,
        parseUsageJson,
        summarizeUsage,
        usageToMarkdown,
      } = require("./usage-report.js");
      const { runCliText } = require("./chat/introspect-commands.js");
      const { getResolvedCli } = require("./cli-binary");
      const command = getResolvedCli();
      const [usageText, listText] = await Promise.all([
        runCliText({ command, args: buildUsageArgs(), timeoutMs: 30000 }),
        runCliText({ command, args: buildSessionListArgs(), timeoutMs: 30000 }),
      ]);
      const summary = summarizeUsage({
        usage: parseUsageJson(usageText),
        sessions: parseSessionListJson(listText),
      });
      const markdown = usageToMarkdown(summary);
      if (!markdown) {
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            "ChainlessChain: could not read token usage — is the cc CLI installed and on PATH?",
          ),
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: "markdown",
      });
      try {
        await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
      } catch {
        await vscode.window.showTextDocument(doc, { preview: false });
      }
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
          suggestVisionModel,
          testLlm,
          getConfiguredProvider,
          getConfiguredModel,
          getConfiguredBaseUrl,
          getConfiguredVisionModel,
          hasConfiguredApiKey,
        } = require("./llm-config.js");
        const cliCmd =
          vscode.workspace.getConfiguration("chainlesschain.cli").get("path") ||
          "cc";
        // Pre-read existing config so re-running the wizard PRE-FILLS instead of
        // forcing a full re-type. Fixes "更新后又要重新配置模型和key": the model/
        // baseUrl/vision default to the current values and the API key can be
        // kept by leaving it blank. The key value is never read into the UI —
        // only its presence (curHasKey), so "blank = keep" stays secure.
        const [curProvider, curModel, curBaseUrl, curVision, curHasKey] =
          await Promise.all([
            getConfiguredProvider({ command: cliCmd }),
            getConfiguredModel({ command: cliCmd }),
            getConfiguredBaseUrl({ command: cliCmd }),
            getConfiguredVisionModel({ command: cliCmd }),
            hasConfiguredApiKey({ command: cliCmd }),
          ]);
        const items = PROVIDER_PRESETS.map((p) => ({
          label:
            vscode.l10n.t(p.label) +
            (p.id === curProvider ? vscode.l10n.t("  ✓ current") : ""),
          description: p.id,
          detail: vscode.l10n.t(
            "Default model {0} · {1}",
            p.defaultModel,
            p.needsKey
              ? vscode.l10n.t("needs API key")
              : vscode.l10n.t("no key"),
          ),
          preset: p,
        }));
        // Surface the current provider first so re-running defaults to "keep".
        items.sort((a, b) =>
          a.preset.id === curProvider
            ? -1
            : b.preset.id === curProvider
              ? 1
              : 0,
        );
        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: vscode.l10n.t(
            "Choose an LLM provider (written to ~/.chainlesschain/config.json, shared by the CLI and the Chat panel)",
          ),
        });
        if (!pick) return;
        const preset = pick.preset;
        // Same provider as before → pre-fill its current model/baseUrl/vision and
        // allow keeping the stored key. Switched provider → use preset defaults.
        const sameProvider = preset.id === curProvider;
        const model = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("Model name ({0})", preset.id),
          value: (sameProvider && curModel) || preset.defaultModel,
          ignoreFocusOut: true,
        });
        if (model === undefined) return;
        let apiKey = "";
        if (preset.needsKey) {
          const canKeep = sameProvider && curHasKey;
          const entered = await vscode.window.showInputBox({
            prompt: canKeep
              ? vscode.l10n.t(
                  "API key for {0} (leave blank = keep the existing key, no need to retype)",
                  preset.label,
                )
              : vscode.l10n.t(
                  "API key for {0} (written only to the local config.json, not VS Code settings)",
                  preset.label,
                ),
            password: true,
            ignoreFocusOut: true,
            placeHolder: canKeep
              ? vscode.l10n.t("leave blank to keep the existing key")
              : "",
          });
          if (entered === undefined) return; // cancelled
          // Blank + canKeep → applyLlmConfig omits llm.apiKey, keeping the
          // existing one (buildConfigSetArgs skips empty values).
          apiKey = entered;
          if (!apiKey && !canKeep) {
            vscode.window.showWarningMessage(
              vscode.l10n.t(
                "No API key entered — configuration cancelled (this provider requires a key).",
              ),
            );
            return;
          }
        }
        const baseUrl = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("Base URL (Enter for the default)"),
          value: (sameProvider && curBaseUrl) || preset.baseUrl,
          ignoreFocusOut: true,
        });
        if (baseUrl === undefined) return;
        // Vision (image-recognition) model — can differ from the text model;
        // the panel auto-switches to it when you paste a screenshot. Blank =
        // reuse the text model / the CLI default.
        const visionModel = await vscode.window.showInputBox({
          prompt: vscode.l10n.t(
            "Image-recognition (vision) model (blank = same as the text model / the CLI default; auto-selected when you paste a screenshot)",
          ),
          value: (sameProvider && curVision) || suggestVisionModel(preset.id),
          ignoreFocusOut: true,
        });
        if (visionModel === undefined) return;
        const applied = await applyLlmConfig({
          command: cliCmd,
          answers: { provider: preset.id, model, apiKey, baseUrl, visionModel },
        });
        if (!applied.ok) {
          const {
            looksLikeMissingCli,
            installGuidance,
          } = require("./version-check");
          // A "cc not found" failure needs install guidance (with the Node
          // floor), not the raw shell error — same fix as the JetBrains plugin.
          const msg = looksLikeMissingCli(applied.error)
            ? vscode.l10n.t(
                "Failed to write LLM config: cc CLI not found. {0}",
                installGuidance(true),
              )
            : vscode.l10n.t("Failed to write LLM config: {0}", applied.error);
          vscode.window.showErrorMessage(msg);
          return;
        }
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t(
              "Wrote {0} config, verifying connectivity with cc llm test…",
              preset.id,
            ),
          },
          async () => {
            const t = await testLlm({ command: cliCmd });
            if (t.ok) {
              vscode.window.showInformationMessage(
                vscode.l10n.t(
                  "LLM configured and reachable ✓ ({0} · {1}). The Chat panel's next message uses it.",
                  preset.id,
                  model,
                ),
              );
            } else {
              vscode.window.showWarningMessage(
                vscode.l10n.t(
                  "Config written, but the connectivity test failed: {0} — check the key/network, then re-run ChainlessChain: Configure LLM.",
                  t.detail || vscode.l10n.t("see output"),
                ),
              );
            }
          },
        );
        chatProvider.onLlmConfigured?.();
      },
    ),
    // Dedicated vision-model entry — set just llm.visionModel without re-running
    // the full wizard (or re-typing the API key). Mirrors the JetBrains
    // "Configure Vision Model" action / ⚙ LLM menu item.
    vscode.commands.registerCommand(
      "chainlesschain.llm.configureVision",
      async () => {
        const {
          getConfiguredProvider,
          getConfiguredVisionModel,
          suggestVisionModel,
          setVisionModel,
        } = require("./llm-config.js");
        const cliCmd =
          vscode.workspace.getConfiguration("chainlesschain.cli").get("path") ||
          "cc";
        const [provider, current] = await Promise.all([
          getConfiguredProvider({ command: cliCmd }),
          getConfiguredVisionModel({ command: cliCmd }),
        ]);
        const prefill = current || suggestVisionModel(provider || "");
        const visionModel = await vscode.window.showInputBox({
          prompt: vscode.l10n.t(
            "Image-recognition (vision) model (blank = same as the text model / the CLI default; auto-selected when you paste a screenshot)",
          ),
          value: prefill,
          ignoreFocusOut: true,
        });
        if (visionModel === undefined) return;
        const r = await setVisionModel({ command: cliCmd, visionModel });
        if (!r.ok) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("Failed to write the vision model: {0}", r.error),
          );
        } else if (!visionModel.trim()) {
          vscode.window.showInformationMessage(
            vscode.l10n.t(
              "Cleared the image-recognition model — images reuse the text model / CLI default.",
            ),
          );
        } else {
          vscode.window.showInformationMessage(
            vscode.l10n.t(
              "Image-recognition model set to {0} ✓ (auto-selected when you paste a screenshot).",
              visionModel.trim(),
            ),
          );
        }
      },
    ),
    // Insert File Reference (Cmd/Ctrl+Alt+K — Claude Code parity): take the
    // active editor's workspace-relative path and drop it into the chat input
    // as an `@<path>` reference (the CLI expands it server-side).
    vscode.commands.registerCommand(
      "chainlesschain.chat.insertReference",
      () => {
        const {
          formatInsertReference,
          selectionToLineRange,
        } = require("./chat/insert-reference.js");
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage(
            "ChainlessChain: open a file in the editor first, then insert it as an @reference.",
          );
          return;
        }
        const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
        // A non-empty selection → @path#Lstart-end so the CLI slices those lines.
        const range = selectionToLineRange(editor.selection);
        const ref = formatInsertReference(rel, range);
        if (ref) chatProvider.insertReference(ref);
      },
    ),
    // Fix with ChainlessChain: invoked by the QuickFix lightbulb (with a
    // {uri, diagnostics} payload) OR from the command palette / editor context
    // menu (no args → gather the active editor's problems near the cursor).
    vscode.commands.registerCommand(
      "chainlesschain.chat.fixDiagnostics",
      (payload) => {
        const { collectActiveDiagnostics } = require("./code-actions.js");
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
        const rel = uri ? vscode.workspace.asRelativePath(uri, false) : "";
        const prompt = formatFixPrompt({ relPath: rel, diagnostics });
        if (prompt) chatProvider.seedInput(prompt);
      },
    ),
    vscode.commands.registerCommand(
      "chainlesschain.chat.explainSelection",
      () => seedSelectionAction("explain"),
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
    vscode.commands.registerCommand("chainlesschain.plan.approve", () =>
      chatProvider.reviewPlan("approve").catch(() => {}),
    ),
    vscode.commands.registerCommand("chainlesschain.plan.requestChanges", () =>
      chatProvider.reviewPlan("requestChanges").catch(() => {}),
    ),
    vscode.commands.registerCommand("chainlesschain.plan.regenerate", () =>
      chatProvider.reviewPlan("regenerate").catch(() => {}),
    ),
    vscode.commands.registerCommand("chainlesschain.plan.reject", () =>
      chatProvider.reviewPlan("reject").catch(() => {}),
    ),
    vscode.commands.registerCommand("chainlesschain.memory.files", () => {
      const {
        buildMemoryFilesCommand,
        runInTerminal,
      } = require("./project-memory-commands.js");
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      runInTerminal(vscode, buildMemoryFilesCommand(), cwd);
    }),
    // Deep link (Claude-Code parity): vscode://chainlesschain.chainlesschain-ide/open
    // [?prompt=…] focuses the chat panel and optionally seeds a prompt, so docs,
    // scripts, or the CLI can hand off into the IDE chat. Parsing lives in the
    // vscode-free, unit-tested uri-handler.js.
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        try {
          const { parseDeepLink } = require("./uri-handler.js");
          const link = parseDeepLink({ path: uri.path, query: uri.query });
          if (!link) return;
          // A link may target a specific workspace; if the open folder doesn't
          // match, don't silently act on the wrong repo — the human can retry.
          if (link.workspace) {
            const open = (vscode.workspace.workspaceFolders || []).map((f) =>
              (f.uri?.fsPath || "").toLowerCase(),
            );
            const want = link.workspace.toLowerCase().replace(/[\\/]+$/, "");
            const matches = open.some((p) => p.replace(/[\\/]+$/, "") === want);
            if (open.length && !matches) {
              vscode.window.showWarningMessage(
                `ChainlessChain: this link targets ${link.workspace}, which isn't the open folder — ignored.`,
              );
              return;
            }
          }
          vscode.commands.executeCommand("chainlesschainIdeChat.focus");
          // Order: resume (repoints the tab) → mode → prompt seed → file reveal.
          if (link.session) chatProvider.resumeSessionId(link.session);
          if (link.mode) chatProvider.applyApprovalMode(link.mode);
          if (link.prompt) chatProvider.seedInput(link.prompt);
          if (link.file)
            chatProvider.openFileAtLine(link.file, link.line).catch(() => {});
        } catch (e) {
          log("uri handler failed: " + (e?.message || e));
        }
      },
    }),
    // Auto-exec config guard (P2 #13): let the user re-scan the open workspace
    // for files that can run code without an explicit action (tasks / hooks /
    // MCP / run configs / shell profiles) on demand.
    vscode.commands.registerCommand(
      "chainlesschain.workspace.scanAutoExec",
      () => reviewWorkspaceAutoExec(vscode, context, /*fromCommand*/ true),
    ),
    // Remote / WSL Doctor (P2 #12): diagnose the environment signals that make
    // the bridge flaky on WSL2 / Remote / SSH — mirrored networking, a missing
    // or outdated CLI on the remote host, a stopped/unreachable bridge port —
    // each with a copyable fix.
    vscode.commands.registerCommand("chainlesschain.remote.doctor", () =>
      runRemoteDoctor(vscode).catch((e) =>
        log("remote doctor failed: " + (e?.message || e)),
      ),
    ),
    { dispose: () => stopBridge(context) },
  );

  // One-time-per-workspace advisory: if the freshly-opened folder already holds
  // auto-executable config, surface it once before the agent (which can trigger
  // it via tasks/hooks/MCP) does much work. Non-blocking; the agent's own
  // per-write gates still apply. Silent when the workspace is clean or trusted.
  maybeWarnAutoExecConfig(vscode, context).catch((e) =>
    log("auto-exec scan failed: " + (e?.message || e)),
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
  try {
    _remoteControl?.dispose();
  } catch {
    /* best-effort */
  }
  _remoteControl = null;
  return stopBridge();
}

/** Quick loopback probe: does something accept a TCP connection on `port`? */
function _probePort(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    if (!port) return resolve("stopped");
    const net = require("net");
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* best-effort */
      }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish("listening"));
    sock.once("timeout", () => finish("unknown"));
    sock.once("error", () => finish("unknown"));
    try {
      sock.connect(port, "127.0.0.1");
    } catch {
      finish("unknown");
    }
  });
}

/** Gather real environment signals and show the Remote/WSL Doctor report. */
async function runRemoteDoctor(vscode) {
  const { analyzeRemoteEnv } = require("./remote-doctor.js");
  const { MIN_CLI_VERSION } = require("./version-check");
  const remoteName = vscode.env?.remoteName || null; // 'wsl' | 'ssh-remote' | …
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "";
  const cliPath = require("./cli-binary").getResolvedCli();
  const versionOut = await runCliVersion(cliPath);
  const cliVersion = versionOut
    ? (versionOut.match(/\d+\.\d+\.\d+[\w.-]*/) || [null])[0]
    : null;
  const port = _port || 0;
  const portProbe = await _probePort(port);
  const report = analyzeRemoteEnv({
    platform: process.platform,
    isWsl: remoteName === "wsl",
    isRemote: !!remoteName,
    remoteUncPath: /^\\\\wsl/i.test(folder) ? folder : null,
    cliFound: !!versionOut,
    cliVersion,
    minCliVersion: MIN_CLI_VERSION,
    bridgePort: port,
    portProbe,
  });
  _output.appendLine("\n" + report.summary);
  const { classifyFixes } = require("./remote-doctor-fixes.js");
  const fixes = classifyFixes(report.checks);
  const buttons = ["Show report", "Copy report"];
  if (fixes.length) buttons.push("Fix…");
  const pick = await vscode.window.showInformationMessage(
    `Remote / WSL Doctor: ${report.level.toUpperCase()} — ${report.checks.length} check(s).`,
    ...buttons,
  );
  if (pick === "Show report") _output.show(true);
  else if (pick === "Copy report")
    await vscode.env.clipboard?.writeText?.(report.summary);
  else if (pick === "Fix…") await offerRemoteDoctorFixes(vscode, report, fixes);
}

/**
 * Fix menu for the Remote/WSL Doctor (gap #12). Three tiers, none silent:
 *  - autoApplicable → shown verbatim, ONE modal confirm, then a visible
 *    terminal (npm upgrade) or the existing restart-bridge command;
 *  - scriptable (admin firewall rules) → a complete idempotent .ps1 is written
 *    where the USER chooses and opened for review — never executed by us;
 *  - manualOnly (.wslconfig) → the exact ini + target path go to the clipboard.
 */
async function offerRemoteDoctorFixes(vscode, report, fixes) {
  const {
    buildFirewallFixScript,
    buildWslConfigPatch,
  } = require("./remote-doctor-fixes.js");
  const autos = fixes.filter((f) => f.kind === "autoApplicable");
  const items = [];
  if (autos.length) {
    items.push({
      label: `Apply safe fixes (${autos.length})`,
      detail: autos.map((a) => a.title).join(" · "),
      key: "auto",
    });
  }
  if (fixes.some((f) => f.kind === "scriptable")) {
    items.push({
      label: "Generate firewall fix script (.ps1)…",
      detail: "Admin-required — saved for you to review and run elevated.",
      key: "firewall",
    });
  }
  if (fixes.some((f) => f.action?.type === "wslconfig")) {
    items.push({
      label: "Copy .wslconfig patch",
      detail: "Merge into %UserProfile%\\.wslconfig, then `wsl --shutdown`.",
      key: "wslconfig",
    });
  }
  for (const f of fixes) {
    if (f.action?.type === "copy") {
      items.push({
        label: `Copy fix: ${f.title}`,
        detail: String(f.action.text).split("\n")[0],
        key: "copy",
        fix: f,
      });
    }
  }
  if (!items.length) return;
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Remote / WSL Doctor — choose a fix",
  });
  if (!picked) return;

  if (picked.key === "auto") {
    // Never silent: list exactly what will run and require one confirm.
    const lines = autos.map((a) =>
      a.action.type === "terminal"
        ? `• run in terminal: ${a.action.command}`
        : `• run command: ChainlessChain IDE: Restart Bridge`,
    );
    const ok = await vscode.window.showWarningMessage(
      `Apply ${autos.length} safe fix(es)?`,
      { modal: true, detail: lines.join("\n") },
      "Apply",
    );
    if (ok !== "Apply") return;
    let term = null;
    for (const a of autos) {
      if (a.action.type === "terminal") {
        term = term || vscode.window.createTerminal("ChainlessChain Doctor");
        term.show();
        term.sendText(a.action.command);
      } else if (a.action.type === "vscodeCommand") {
        await vscode.commands.executeCommand(a.action.command);
      }
    }
    return;
  }

  if (picked.key === "firewall") {
    const script = buildFirewallFixScript(report.checks);
    if (!script) return;
    const path = require("path");
    const os = require("os");
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(os.homedir(), "cc-ide-firewall-fix.ps1"),
      ),
      filters: { PowerShell: ["ps1"] },
    });
    if (!uri) return;
    require("fs").writeFileSync(uri.fsPath, script, "utf-8");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(
      "ChainlessChain: firewall fix script saved — review it, then run it from an elevated PowerShell.",
    );
    return;
  }

  if (picked.key === "wslconfig") {
    const patch = buildWslConfigPatch(report.checks);
    if (!patch) return;
    await vscode.env.clipboard?.writeText?.(patch.ini);
    vscode.window.showInformationMessage(
      `ChainlessChain: .wslconfig patch copied — merge it into ${patch.targetPathHint}, then run \`${patch.postStep}\`. ${patch.note}`,
    );
    return;
  }

  if (picked.key === "copy" && picked.fix) {
    await vscode.env.clipboard?.writeText?.(String(picked.fix.action.text));
    vscode.window.showInformationMessage(
      `ChainlessChain: fix for "${picked.fix.title}" copied to the clipboard.`,
    );
  }
}

/**
 * Shallow-scan the open workspace root (plus the dirs where auto-exec config
 * hides one level deep) and classify what's there. Returns the pure
 * scanAutoExecConfig findings; never throws (missing dirs → skipped).
 */
function scanWorkspaceAutoExec(vscode) {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (!folder) return { folder: null, findings: [] };
  const fs = require("fs");
  const path = require("path");
  const rels = [];
  const listDir = (rel) => {
    try {
      for (const name of fs.readdirSync(path.join(folder, rel))) {
        rels.push(rel ? `${rel}/${name}` : name);
      }
    } catch {
      /* dir absent — fine */
    }
  };
  listDir(""); // root: .mcp.json, .bashrc, …
  for (const d of [
    ".vscode",
    ".idea",
    ".idea/runConfigurations",
    ".git/hooks",
    ".husky",
  ]) {
    listDir(d);
  }
  const { scanAutoExecConfig } = require("./auto-exec-guard.js");
  return { folder, findings: scanAutoExecConfig(rels) };
}

/** globalState key recording that a workspace's auto-exec config was acknowledged. */
function _autoExecAckKey(folder) {
  return "chainlesschain.autoExecAck:" + String(folder || "");
}

/**
 * Show the one-time advisory when a workspace holds auto-exec config and hasn't
 * been acknowledged yet. Trust persists the acknowledgement; Review lists the
 * files. No-op (silent) when clean or already trusted.
 */
async function maybeWarnAutoExecConfig(vscode, context) {
  const { folder, findings } = scanWorkspaceAutoExec(vscode);
  if (!folder || !findings.length) return;
  if (context.globalState.get(_autoExecAckKey(folder))) return;
  const { summarizeAutoExecScan } = require("./auto-exec-guard.js");
  const pick = await vscode.window.showWarningMessage(
    summarizeAutoExecScan(findings),
    { modal: false },
    "Review",
    "Trust workspace",
  );
  if (pick === "Trust workspace") {
    await context.globalState.update(_autoExecAckKey(folder), true);
  } else if (pick === "Review") {
    await reviewWorkspaceAutoExec(vscode, context, false);
  }
}

/**
 * Command entry (and Review action): present the findings and let the user
 * trust the workspace. When invoked from the command with a clean workspace,
 * says so; otherwise offers to persist trust.
 */
async function reviewWorkspaceAutoExec(vscode, context, fromCommand) {
  const { folder, findings } = scanWorkspaceAutoExec(vscode);
  if (!folder) {
    if (fromCommand) {
      vscode.window.showInformationMessage(
        "ChainlessChain: no folder open to scan.",
      );
    }
    return;
  }
  if (!findings.length) {
    if (fromCommand) {
      vscode.window.showInformationMessage(
        "ChainlessChain: no auto-executable config found in this workspace.",
      );
    }
    return;
  }
  const { summarizeAutoExecScan } = require("./auto-exec-guard.js");
  const trusted = !!context.globalState.get(_autoExecAckKey(folder));
  const buttons = trusted ? ["Untrust"] : ["Trust workspace"];
  const pick = await vscode.window.showWarningMessage(
    summarizeAutoExecScan(findings) +
      (trusted ? "\n\n(This workspace is currently trusted.)" : ""),
    { modal: true },
    ...buttons,
  );
  if (pick === "Trust workspace") {
    await context.globalState.update(_autoExecAckKey(folder), true);
  } else if (pick === "Untrust") {
    await context.globalState.update(_autoExecAckKey(folder), undefined);
  }
}

// Process-level memo of `cc --version` per binary. Activation probes the
// version ~5× (binary resolution + the missing/outdated/latest notices + the
// What's-New nudge), each a cold ~12s-capped Windows `.cmd`-shim spawn — memoize
// so it runs ONCE. A null result (missing / timeout) is NOT cached, so a not-
// yet-installed CLI keeps being re-checked; a real version is stable under a
// running window (a manual upgrade clears the cache — see checkCliUpdateManually).
const _versionProbeCache = new Map(); // cliPath -> Promise<string|null>

/** Drop the memoized `cc --version` results (call after a manual update check —
 *  the user may have just upgraded in a terminal). */
function clearCliVersionCache() {
  _versionProbeCache.clear();
}

/** Run `<cliPath> --version` (memoized), returning stdout (or null on failure). */
function runCliVersion(cliPath) {
  const cached = _versionProbeCache.get(cliPath);
  if (cached) return cached;
  const p = _spawnCliVersion(cliPath).then((out) => {
    if (out == null) _versionProbeCache.delete(cliPath); // keep re-checkable
    return out;
  });
  _versionProbeCache.set(cliPath, p);
  return p;
}

/** The uncached spawn behind runCliVersion. */
function _spawnCliVersion(cliPath) {
  const cp = require("child_process");
  const { hardenedEnv } = require("./hardened-env");
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
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv(process.env),
      });
      let out = "";
      child.stdout?.on("data", (d) => {
        out += d.toString();
      });
      child.on("error", () => finish(null));
      child.on("close", () => finish(out.trim() || null));
      // Generous timeout: a cold Windows `cc` (node + npm .cmd shim) can take
      // several seconds the first time — 5s caused false "cc not installed".
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* best-effort */
        }
        finish(null);
      }, 12000);
    } catch {
      finish(null);
    }
  });
}

/** Version-sync: nudge to upgrade `cc` if it's older than the extension needs. */
function checkCliVersionAndNotify(vscode, context) {
  const { runCliVersionSync } = require("./version-check");
  const cliPath = require("./cli-binary").getResolvedCli();
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

// ---------------------------------------------------------------------------
// Managed CLI runtime (插件托管/内置 CLI) — glue over src/managed-cli-flow.js.
// All decision logic is in the pure core (managed-cli.js); this is IO only.
// ---------------------------------------------------------------------------

/** Root dir for the managed CLI (per-user extension storage), or null. */
function managedCliRoot(context) {
  const base = context?.globalStorageUri?.fsPath;
  if (!base) return null;
  const { MANAGED_DIR_NAME } = require("./managed-cli");
  return require("node:path").join(base, MANAGED_DIR_NAME);
}

/**
 * Cheap candidate source for resolveCliBinary: an existing managed install,
 * runnable only when a new-enough `node` is on PATH (the extension host's
 * Electron is NOT usable for spawning cc). Returns {command, version} | null.
 */
async function resolveManagedCliCommand(context) {
  const root = managedCliRoot(context);
  if (!root) return null;
  const { managedNodeDiagnostic } = require("./managed-cli");
  const { MIN_NODE_VERSION } = require("./version-check");
  const nodeDiag = managedNodeDiagnostic({
    nodeVersionOutput: await runCliVersion("node").catch(() => null),
    minNodeVersion: MIN_NODE_VERSION,
  });
  if (!nodeDiag.ok) return null; // shim would fail — treat as not installed
  const { resolveManagedCommand } = require("./managed-cli-flow");
  return resolveManagedCommand(root);
}

/** "ChainlessChain: Install Managed CLI" — download/verify/extract/activate. */
async function installManagedCliCommand(vscode, context) {
  const { MIN_NODE_VERSION, MIN_CLI_VERSION } = require("./version-check");
  const { managedNodeDiagnostic } = require("./managed-cli");
  const root = managedCliRoot(context);
  if (!root) {
    vscode.window.showErrorMessage(
      vscode.l10n.t(
        "ChainlessChain: extension storage is unavailable — cannot install a managed CLI copy.",
      ),
    );
    return;
  }
  // The managed copy runs as `node <entry>` — no usable node ⇒ impossible,
  // and the diagnostic must say exactly that (明确诊断), not a vague failure.
  const nodeDiag = managedNodeDiagnostic({
    nodeVersionOutput: await runCliVersion("node").catch(() => null),
    minNodeVersion: MIN_NODE_VERSION,
  });
  if (!nodeDiag.ok) {
    vscode.window.showErrorMessage(
      nodeDiag.reason === "no-node"
        ? vscode.l10n.t(
            "ChainlessChain: the managed cc CLI runs via `node`, but no Node.js was found on PATH — a managed copy cannot work here. Install Node.js >= {0}, then retry.",
            MIN_NODE_VERSION,
          )
        : vscode.l10n.t(
            "ChainlessChain: Node.js {0} on PATH is older than the {1} the cc CLI requires — upgrade Node.js, then retry.",
            nodeDiag.version,
            MIN_NODE_VERSION,
          ),
    );
    return;
  }
  const res = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Installing managed cc CLI…"),
    },
    async (progress) => {
      const { runManagedInstall } = require("./managed-cli-flow");
      return runManagedInstall({
        rootDir: root,
        floorVersion: MIN_CLI_VERSION,
        io: {
          fetchJson: (url) => httpsGetJson(url),
          fetchBuffer: (url) => httpsGetBuffer(url),
          report: (step) => progress.report({ message: step }),
        },
      });
    },
  );
  if (res && res.ok) {
    // Re-point this window's CLI resolution at the fresh install immediately.
    require("./cli-binary").setResolvedCli(res.command);
    log(`managed cc ${res.version} installed at ${res.entry}`);
    vscode.window.showInformationMessage(
      vscode.l10n.t(
        "ChainlessChain: managed cc {0} installed and active for this window.",
        res.version,
      ),
    );
  } else {
    vscode.window.showErrorMessage(
      vscode.l10n.t(
        "ChainlessChain: managed CLI install failed ({0}: {1}).",
        String(res?.step || "unknown"),
        String(res?.error || "unknown"),
      ),
    );
  }
}

/** "ChainlessChain: Roll Back Managed CLI" — one step, gated on previousVersion. */
async function rollbackManagedCliCommand(vscode, context) {
  const root = managedCliRoot(context);
  if (!root) {
    vscode.window.showErrorMessage(
      vscode.l10n.t(
        "ChainlessChain: extension storage is unavailable — cannot install a managed CLI copy.",
      ),
    );
    return;
  }
  const { runManagedRollback } = require("./managed-cli-flow");
  const res = runManagedRollback({ rootDir: root });
  if (!res.ok) {
    if (res.reason === "no-previous" || res.reason === "no-state") {
      vscode.window.showInformationMessage(
        vscode.l10n.t(
          "ChainlessChain: no previous managed cc version to roll back to.",
        ),
      );
    } else {
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "ChainlessChain: managed CLI rollback failed ({0}).",
          String(res.reason),
        ),
      );
    }
    return;
  }
  require("./cli-binary").setResolvedCli(res.command);
  log(`managed cc rolled back to ${res.version}`);
  vscode.window.showInformationMessage(
    vscode.l10n.t(
      "ChainlessChain: managed cc rolled back to {0}.",
      res.version,
    ),
  );
}

/** GET a JSON document over https (same conventions as fetchLatestCliVersion:
 *  best-effort, timeout, resolve null — never reject). */
function httpsGetJson(url, timeoutMs = 15000) {
  const https = require("https");
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const req = https.get(
        url,
        { headers: { Accept: "application/json" } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return finish(null);
          }
          res.setEncoding("utf8");
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            try {
              finish(JSON.parse(body));
            } catch {
              finish(null);
            }
          });
        },
      );
      req.on("error", () => finish(null));
      req.setTimeout(timeoutMs, () => {
        try {
          req.destroy();
        } catch {
          /* best-effort */
        }
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

/** GET a binary body over https (redirect-following, size-capped, 120s). The
 *  integrity check downstream is the real gate — this only fetches bytes. */
function httpsGetBuffer(url, redirectsLeft = 3, maxBytes = 64 * 1024 * 1024) {
  const https = require("https");
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const req = https.get(url, (res) => {
        const status = res.statusCode || 0;
        if (status >= 301 && status <= 308 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return finish(null);
          const next = new URL(res.headers.location, url).toString();
          if (!next.startsWith("https://")) return finish(null); // never downgrade
          return httpsGetBuffer(next, redirectsLeft - 1, maxBytes).then(finish);
        }
        if (status !== 200) {
          res.resume();
          return finish(null);
        }
        const chunks = [];
        let total = 0;
        res.on("data", (d) => {
          total += d.length;
          if (total > maxBytes) {
            try {
              req.destroy();
            } catch {
              /* best-effort */
            }
            return finish(null);
          }
          chunks.push(d);
        });
        res.on("end", () => finish(Buffer.concat(chunks)));
        res.on("error", () => finish(null));
      });
      req.on("error", () => finish(null));
      req.setTimeout(120000, () => {
        try {
          req.destroy();
        } catch {
          /* best-effort */
        }
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

/** The npm `latest` dist-tag of the CLI, or null (best-effort, 5s timeout). */
function fetchLatestCliVersion() {
  const https = require("https");
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const req = https.get(
        "https://registry.npmjs.org/chainlesschain/latest",
        { headers: { Accept: "application/json" } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return finish(null);
          }
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            try {
              finish(JSON.parse(body).version || null);
            } catch {
              finish(null);
            }
          });
        },
      );
      req.on("error", () => finish(null));
      req.setTimeout(5000, () => {
        try {
          req.destroy();
        } catch {
          /* best-effort */
        }
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Proactive "the `cc` CLI isn't installed" warning. The whole chat panel needs
 * `cc` on PATH, so if it's missing we say so up front (instead of only failing
 * when the user sends their first message). Offers a one-click install or a
 * jump to the CLI-path setting. Returns true when cc is missing/unusable (the
 * caller then skips the version checks, which are pointless without cc).
 */
async function notifyIfCliMissing(vscode, context) {
  const { looksLikeCcVersion, getResolvedCli } = require("./cli-binary");
  const { MIN_NODE_VERSION } = require("./version-check");
  // Use the resolved binary + a BARE-semver check (not parseCliVersion's
  // find-anywhere) so a `cc` that's really a C compiler — "cc (GCC) 12.2.0" —
  // is correctly treated as "no chainlesschain", not a false "installed".
  const present = looksLikeCcVersion(
    String((await runCliVersion(getResolvedCli()).catch(() => null)) || ""),
  );
  if (present) return false; // chainlesschain cc is present → not missing
  const cliCfg = vscode.workspace.getConfiguration("chainlesschain.cli");
  const configured = cliCfg.get("path");
  const managedEnabled = cliCfg.get("managed.enabled", true) !== false;
  // A broken EXPLICIT `chainlesschain.cli.path` is an error to surface, and
  // the managed copy is only ever an OFFER here — the setting itself stays
  // authoritative and is never silently replaced (repo iron rule).
  if (configured && configured !== "cc") {
    const buttons = [vscode.l10n.t("Open setting")];
    if (managedEnabled) buttons.push(vscode.l10n.t("Download managed copy"));
    const pick = await vscode.window.showErrorMessage(
      vscode.l10n.t(
        "ChainlessChain: the configured CLI path ({0}) did not answer as chainlesschain. The setting was left untouched — fix chainlesschain.cli.path, or download a managed copy.",
        String(configured),
      ),
      ...buttons,
    );
    if (pick === vscode.l10n.t("Open setting")) {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "chainlesschain.cli.path",
      );
    } else if (pick === vscode.l10n.t("Download managed copy")) {
      vscode.commands.executeCommand("chainlesschain.cli.installManaged");
    }
    return true;
  }
  if (context.globalState.get("cliMissingDismissed")) return true;
  if (managedEnabled) {
    // Managed-runtime offer (Download / Use terminal npm / Not now). If the
    // managed runtime is impossible (no `node` on PATH), say EXACTLY that —
    // the install command repeats the diagnostic if invoked anyway.
    const { managedNodeDiagnostic } = require("./managed-cli");
    const nodeDiag = managedNodeDiagnostic({
      nodeVersionOutput: await runCliVersion("node").catch(() => null),
      minNodeVersion: MIN_NODE_VERSION,
    });
    const message = nodeDiag.ok
      ? vscode.l10n.t(
          "ChainlessChain: no usable `cc` CLI was found. Download a managed copy into extension storage, or install it globally with npm (requires Node.js >= {0}).",
          MIN_NODE_VERSION,
        )
      : vscode.l10n.t(
          "ChainlessChain: no usable `cc` CLI was found, and a managed copy is impossible: no Node.js >= {0} on PATH (the managed cc runs via `node`). Install Node.js first.",
          MIN_NODE_VERSION,
        );
    const buttons = nodeDiag.ok
      ? [
          vscode.l10n.t("Download managed copy"),
          vscode.l10n.t("Use terminal npm"),
          vscode.l10n.t("Not now"),
        ]
      : [vscode.l10n.t("Use terminal npm"), vscode.l10n.t("Not now")];
    const pick = await vscode.window.showWarningMessage(message, ...buttons);
    if (pick === vscode.l10n.t("Download managed copy")) {
      vscode.commands.executeCommand("chainlesschain.cli.installManaged");
    } else if (pick === vscode.l10n.t("Use terminal npm")) {
      upgradeCliInTerminal(vscode, "npm i -g chainlesschain");
    }
    return true;
  }
  const pick = await vscode.window.showWarningMessage(
    `ChainlessChain: the \`cc\` CLI isn't installed or isn't on PATH — the chat panel needs it to work (requires Node.js >= ${MIN_NODE_VERSION}). Install it now?`,
    "Install cc",
    "Set CLI path",
    "Don't show again",
  );
  if (pick === "Install cc") {
    upgradeCliInTerminal(vscode, "npm i -g chainlesschain");
  } else if (pick === "Set CLI path") {
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "chainlesschain.cli.path",
    );
  } else if (pick === "Don't show again") {
    context.globalState.update("cliMissingDismissed", true);
  }
  return true;
}

/**
 * Proactive "a newer cc is available" nudge (distinct from the hard-floor
 * check): compares the installed cc against the latest npm release. Shown at
 * most once per newer version; "Don't show again" suppresses it for good.
 */
function checkLatestCliAndNotify(vscode, context) {
  const { runLatestVersionCheck } = require("./version-check");
  const cliPath = require("./cli-binary").getResolvedCli();
  const OFF = "cliLatestNudge:off";
  return runLatestVersionCheck({
    getVersion: () => runCliVersion(cliPath),
    getLatest: () => fetchLatestCliVersion(),
    isSuppressed: () => !!context.globalState.get(OFF),
    wasShownFor: (v) => !!context.globalState.get("cliLatestNudge:" + v),
    markShownFor: (v) =>
      context.globalState.update("cliLatestNudge:" + v, true),
    setSuppressed: () => context.globalState.update(OFF, true),
    prompt: async (message) => {
      const pick = await vscode.window.showInformationMessage(
        message,
        "Upgrade cc",
        "Later",
        "Don't show again",
      );
      if (pick === "Upgrade cc") return "upgrade";
      if (pick === "Don't show again") return "dismiss";
      return null;
    },
    upgrade: (command) => upgradeCliInTerminal(vscode, command),
  });
}

/**
 * Manual "Check for CLI Updates" command. Unlike the activation nudge, this
 * ALWAYS reports (including "you're up to date") and ignores the throttle /
 * "don't show again", so it's a reliable button to check + upgrade on demand.
 */
async function checkCliUpdateManually(vscode) {
  const {
    parseCliVersion,
    compareVersions,
    latestUpdateNotice,
    MIN_NODE_VERSION,
  } = require("./version-check");
  const cliPath = require("./cli-binary").getResolvedCli();
  // The user may have just upgraded in a terminal — re-probe fresh.
  clearCliVersionCache();
  const installed = parseCliVersion(
    String((await runCliVersion(cliPath).catch(() => null)) || ""),
  );
  if (!installed) {
    vscode.window
      .showWarningMessage(
        `ChainlessChain: couldn't read the installed cc version. Is the CLI on PATH? Install with \`npm i -g chainlesschain\` (requires Node.js >= ${MIN_NODE_VERSION}).`,
        "Install cc",
      )
      .then((p) => {
        if (p === "Install cc") upgradeCliInTerminal(vscode);
      });
    return;
  }
  const latest = parseCliVersion(
    String((await fetchLatestCliVersion().catch(() => null)) || ""),
  );
  if (!latest) {
    vscode.window.showWarningMessage(
      `ChainlessChain: couldn't reach npm to check for updates (you have cc ${installed}).`,
    );
    return;
  }
  if (compareVersions(installed, latest) >= 0) {
    vscode.window.showInformationMessage(
      `ChainlessChain: cc ${installed} is up to date (latest published is ${latest}).`,
    );
    return;
  }
  const notice = latestUpdateNotice(installed, latest);
  const pick = await vscode.window.showInformationMessage(
    notice.message,
    "Upgrade cc",
    "Later",
  );
  if (pick === "Upgrade cc")
    upgradeCliInTerminal(vscode, notice.upgradeCommand);
}

module.exports = { activate, deactivate };
