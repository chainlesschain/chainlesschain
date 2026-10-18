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
  buildCliGoalCatalogArgs,
  parseCliGoalCatalog,
  buildCliGoalPanelsArgs,
  parseCliGoalPanels,
  formatCliGoalPanels,
  buildCliGoalDraftRequestArgs,
  parseCliGoalDraftExport,
  buildMcpConnectArgs,
  buildMcpRemoveArgs,
  buildMcpServersArgs,
  buildPluginAddArgs,
  buildPluginConsentArgs,
  buildPluginInstalledArgs,
  buildPluginLifecycleArgs,
  buildPluginTrustArgs,
  buildPluginUninstallArgs,
  buildPluginUpgradeArgs,
  buildPluginUseArgs,
  buildSkillListArgs,
  parseMcpServers,
  parsePluginInstalled,
  parsePluginUpgradeResult,
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
const drafts = require("../goal-drafts.js");

let _panel = null;
let _chatProvider = null;
let _goalPanelGeneration = 0;
let _workspaceCwd;

async function runCli(args, timeoutMs = 30000, cwd = _workspaceCwd) {
  const { runCliText } = require("../chat/introspect-commands.js");
  const { getResolvedCli } = require("../cli-binary");
  return runCliText({ command: getResolvedCli(), args, timeoutMs, cwd });
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
  _goalPanelGeneration++;
  post({ type: "goalPanels", text: "" });
  post({ type: "busy" });
  post(await snapshot());
}

async function selectCliGoal(vscode, cwd, current) {
  let after, expectedStore;
  const seen = new Set();
  while (current()) {
    let page;
    try {
      const output = await runCli(buildCliGoalCatalogArgs(after), 30000, cwd);
      page = parseCliGoalCatalog(output, expectedStore);
      if (page?.nextCursor && seen.has(page.nextCursor)) page = null;
    } catch {
      /* Older CLI or unreadable catalog: explicit manual entry remains available. */
    }
    if (!current()) return null;
    const items = (page?.entries || []).map((entry) => ({
      label: entry.title || entry.id,
      description: `${entry.status} · ${entry.id}`,
      goalId: entry.id,
    }));
    if (page?.nextCursor) items.push({ label: "Next page…", next: true });
    items.push({ label: "Open desktop goal connection…", connection: true });
    items.push({
      label: "Enter goal ID…",
      manual: true,
      description: page
        ? undefined
        : "Goal catalog unavailable; enter an ID from cc goal list",
    });
    const selected = await vscode.window.showQuickPick(items, {
      title: "CLI goal panels",
      placeHolder: page
        ? `Select a standalone goal (${page.skippedCount} invalid sources on this page; ${page.invalidNameCount} invalid names in directory)`
        : "The selected CLI could not provide a goal catalog",
      matchOnDescription: true,
      ignoreFocusOut: true,
    });
    if (!selected || !current()) return null;
    if (selected.connection) {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        openLabel: "Read desktop goal",
        filters: { "Goal connection": ["json"] },
      });
      if (!files?.[0] || !current()) return null;
      const connection = files[0].fsPath;
      const output = await runCli(
        buildCliGoalCatalogArgs(undefined, connection),
        30000,
        cwd,
      );
      const connected = parseCliGoalCatalog(output, undefined, connection);
      if (!current()) return null;
      if (
        !connected ||
        connected.entries.length !== 1 ||
        connected.nextCursor !== null
      )
        throw new Error("Desktop goal connection unavailable or expired");
      return {
        id: connected.entries[0].id,
        expectedStore: connected.storeId,
        connection,
      };
    }
    if (selected.next) {
      after = page.nextCursor;
      expectedStore = page.storeId;
      seen.add(after);
      continue;
    }
    if (!selected.manual)
      return { id: selected.goalId, expectedStore: page.storeId };
    const id = await vscode.window.showInputBox({
      title: "CLI goal panels",
      prompt: "Standalone CLI goal ID (from cc goal list)",
      ignoreFocusOut: true,
    });
    return id?.trim() && current()
      ? { id: id.trim(), expectedStore: page?.storeId ?? expectedStore }
      : null;
  }
  return null;
}

async function selectDraftGoal(vscode, cwd, current) {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    openLabel: "Open online draft connection",
    filters: { "Goal draft connection": ["json"] },
  });
  if (!files?.[0] || !current()) return null;
  const connection = files[0].fsPath;
  const page = parseCliGoalCatalog(
    await runCli(buildCliGoalCatalogArgs(undefined, connection), 30000, cwd),
    undefined,
    connection,
  );
  if (!current()) return null;
  if (!page || page.entries.length !== 1 || page.nextCursor !== null)
    throw new Error("Desktop draft connection unavailable or expired");
  return { id: page.entries[0].id, expectedStore: page.storeId, connection };
}
async function selectDraftSource(vscode, input, cwd, current) {
  let after;
  const seen = new Set();
  while (current()) {
    const page = drafts.parseGoalDraftSources(
      await runCli(drafts.buildGoalDraftSourcesArgs(input, after), 30000, cwd),
      input,
    );
    if (!current()) return null;
    if (!page || (page.nextCursor && seen.has(page.nextCursor)))
      throw new Error("Native source page unavailable");
    input = { ...input, binding: page.binding };
    const choices = page.entries.map((entry) => ({
      label: entry.sourceTaskId,
      description: `${entry.reviewId} · ${entry.id}`,
      source: entry.id,
    }));
    if (page.nextCursor)
      choices.push({ label: "Next source page…", next: true });
    if (!choices.length)
      throw new Error(
        "No current native task-description source is available; check the goal in the desktop",
      );
    const picked = await vscode.window.showQuickPick(choices, {
      title: "Select native draft source",
      placeHolder: `${page.unavailableCount} unavailable sources on this page`,
      matchOnDescription: true,
      ignoreFocusOut: true,
    });
    if (!picked || !current()) return null;
    if (picked.next) {
      after = page.nextCursor;
      seen.add(after);
      continue;
    }
    return { source: picked.source, binding: page.binding };
  }
  return null;
}

function openPluginManager(vscode, chatProvider) {
  _chatProvider = chatProvider || _chatProvider;
  const uri = vscode.window.activeTextEditor?.document?.uri;
  const folder = uri ? vscode.workspace?.getWorkspaceFolder?.(uri) : null;
  _workspaceCwd =
    folder?.uri?.fsPath ||
    vscode.workspace?.workspaceFolders?.[0]?.uri?.fsPath ||
    process.cwd();
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
    _goalPanelGeneration++;
    _panel = null;
  });
  refresh().catch(() => {});
  return _panel;
}

async function handleMessage(vscode, msg) {
  if (!msg || typeof msg.command !== "string") return;
  if (msg.command.startsWith("plugin") || msg.command === "clearGoalPanels") {
    _goalPanelGeneration++;
    post({ type: "goalPanels", text: "" });
  }
  if (msg.command === "refresh") return refresh();
  if (msg.command === "clearGoalPanels") return;
  if (
    [
      "pluginGoalDraftAccess",
      "pluginGoalDraftSend",
      "pluginGoalDraftReceipt",
    ].includes(msg.command)
  ) {
    const generation = _goalPanelGeneration,
      panel = _panel,
      cwd = _workspaceCwd;
    const current = () =>
      generation === _goalPanelGeneration && panel === _panel;
    let record;
    try {
      const plugin = {
        name: String(msg.name || ""),
        scope: String(msg.scope || "user"),
      };
      if (msg.command === "pluginGoalDraftAccess") {
        const file = await vscode.window.showSaveDialog({
          title: "Export draft access request (choose a new file)",
          filters: { "Goal draft access": ["json"] },
        });
        if (!file || !current()) return;
        const input = { ...plugin, out: file.fsPath };
        const result = drafts.parseGoalDraftAccess(
          await runCli(drafts.buildGoalDraftAccessArgs(input), 30000, cwd),
          input,
        );
        if (!current()) return;
        if (!result)
          throw new Error(
            "Access request export unavailable; inspect the selected file",
          );
        post({
          type: "goalPanels",
          text: `Access request exported: ${result.file}\nIn the desktop, choose the separate online draft connection action and select this file for native consent.`,
        });
        return;
      }
      const selected = await selectDraftGoal(vscode, cwd, current);
      if (!selected || !current()) return;
      let input = { ...selected, ...plugin };
      if (msg.command === "pluginGoalDraftReceipt") {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: false,
          openLabel: "Look up saved submission record",
          filters: { "Goal draft submission record": ["json"] },
        });
        if (!files?.[0] || !current()) return;
        record = files[0].fsPath;
        input = { ...input, record };
      } else {
        const selectedSource = await selectDraftSource(
          vscode,
          input,
          cwd,
          current,
        );
        if (!selectedSource || !current()) return;
        const title = await vscode.window.showInputBox({
          title: "Submit pending goal draft",
          prompt: "Draft title",
          ignoreFocusOut: true,
        });
        if (!title || !current()) return;
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: false,
          openLabel: "Select proposed UTF-8 description",
          filters: { Text: ["txt", "md"] },
        });
        if (!files?.[0] || !current()) return;
        const destination = await vscode.window.showSaveDialog({
          title: "Save submission record before sending (choose a new file)",
          filters: { "Goal draft submission record": ["json"] },
        });
        if (!destination || !current()) return;
        record = destination.fsPath;
        input = {
          ...input,
          ...selectedSource,
          title,
          descriptionFile: files[0].fsPath,
          record,
          requestId: require("node:crypto").randomUUID(),
        };
      }
      const args =
        msg.command === "pluginGoalDraftReceipt"
          ? drafts.buildGoalDraftReceiptArgs(input)
          : drafts.buildGoalDraftSendArgs(input);
      const result = drafts.parseGoalDraftSubmission(
        await runCli(args, 30000, cwd),
        input,
      );
      if (!current()) return;
      if (!result) throw new Error("Submission result unavailable");
      post({
        type: "goalPanels",
        text: drafts.formatGoalDraftSubmission(result),
      });
    } catch (error) {
      if (current())
        post({
          type: "note",
          text: `${String(error.message || error)}${record ? `\nKeep the submission record: ${record}. Look up its receipt before retrying; the outcome may be unknown.` : ""}`,
        });
    }
    return;
  }
  if (msg.command === "pluginGoalDraftRequest") {
    const generation = _goalPanelGeneration,
      panel = _panel,
      cwd = _workspaceCwd;
    const current = () =>
      generation === _goalPanelGeneration && panel === _panel;
    try {
      const selected = await selectCliGoal(vscode, cwd, current);
      if (!selected || !current()) return;
      if (!selected.connection)
        throw new Error(
          "Select Open desktop goal connection… to export a project request",
        );
      const source = await vscode.window.showInputBox({
        title: "Export goal draft request",
        prompt: "Exact native risk proposal ID copied from the desktop",
        ignoreFocusOut: true,
      });
      if (!source || !current()) return;
      const title = await vscode.window.showInputBox({
        title: "Export goal draft request",
        prompt: "Request title",
        ignoreFocusOut: true,
      });
      if (!title || !current()) return;
      const descriptions = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        openLabel: "Select proposed UTF-8 description",
        filters: { Text: ["txt", "md"] },
      });
      if (!descriptions?.[0] || !current()) return;
      const output = await vscode.window.showSaveDialog({
        title: "Export untrusted goal request (choose a new file)",
        saveLabel: "Export request",
        filters: { "Goal draft request": ["json"] },
      });
      if (!output || !current()) return;
      const input = {
        ...selected,
        name: String(msg.name || ""),
        scope: String(msg.scope || "user"),
        source: source.trim(),
        title,
        descriptionFile: descriptions[0].fsPath,
        out: output.fsPath,
        requestId: require("node:crypto").randomUUID(),
      };
      const result = parseCliGoalDraftExport(
        await runCli(buildCliGoalDraftRequestArgs(input), 30000, cwd),
        input,
      );
      if (!current()) return;
      if (!result)
        throw new Error(
          "Export result unavailable; inspect the selected output file before retrying. No native draft was submitted.",
        );
      post({
        type: "goalPanels",
        text: `Request exported: ${result.file}\nRequest ID: ${result.requestId}\nNo native draft has been saved. Import this same file in the desktop and review its full text. Re-import the same file to recover a lost adoption response.`,
      });
    } catch (error) {
      if (current())
        post({ type: "note", text: String(error.message || error) });
    }
    return;
  }
  if (msg.command === "pluginGoalPanels") {
    const generation = _goalPanelGeneration;
    const panel = _panel;
    const name = String(msg.name || "");
    const scope = String(msg.scope || "user");
    const cwd = _workspaceCwd;
    try {
      const selected = await selectCliGoal(
        vscode,
        cwd,
        () => generation === _goalPanelGeneration && panel === _panel,
      );
      if (!selected) return;
      const { id, expectedStore, connection } = selected;
      const output = await runCli(
        buildCliGoalPanelsArgs(id, name, scope, expectedStore, connection),
        30000,
        cwd,
      );
      const result = parseCliGoalPanels(output, {
        id,
        name,
        scope,
        expectedStore,
        connection,
      });
      if (generation !== _goalPanelGeneration || panel !== _panel) return;
      if (!result)
        throw new Error(
          "CLI goal panels unavailable; check that the selected CLI supports goal panels.",
        );
      post({ type: "goalPanels", text: formatCliGoalPanels(result) });
    } catch (error) {
      if (generation === _goalPanelGeneration && panel === _panel)
        post({ type: "note", text: String(error.message || error) });
    }
    return;
  }

  if (msg.command === "pluginTrust") {
    // Scope must match where the plugin is installed (rows carry it) — the
    // CLI defaults to project scope and untrust at the wrong scope no-ops.
    await runCli(
      buildPluginTrustArgs(msg.name, msg.trusted === true, msg.scope),
    );
    reloadActivePluginSessions();
    return refresh();
  }
  if (msg.command === "pluginLifecycle") {
    const enabled = msg.enabled === true;
    if (!enabled) {
      const choice = await vscode.window.showWarningMessage(
        `Disable ${msg.name} (${msg.scope} scope)? Installed versions and configuration are retained, but its runtime components stop loading.`,
        { modal: true },
        "Disable",
      );
      if (choice !== "Disable") return;
    }
    await runCli(buildPluginLifecycleArgs(msg.name, enabled, msg.scope), 30000);
    const reloaded = reloadActivePluginSessions();
    vscode.window.showInformationMessage(
      `ChainlessChain: ${msg.name} ${enabled ? "enabled" : "disabled"}; reload requested in ${reloaded} live chat session(s).`,
    );
    return refresh();
  }
  if (msg.command === "pluginUpgrade") {
    const source =
      msg.source && typeof msg.source === "object" ? msg.source : {};
    const useRegistry = Boolean(source.registry && source.package);
    let target = useRegistry
      ? source.package
      : source.resolvedSource || source.source;
    if (!target) {
      target = await vscode.window.showInputBox({
        prompt: `Upgrade source for ${msg.name}`,
        placeHolder: "C:\\path\\to\\plugin · owner/repo[#ref]",
      });
      if (!target) return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Upgrade ${msg.name} from its ${source.type || "selected"} source? The current immutable version remains available for rollback.`,
      { modal: true },
      "Upgrade",
    );
    if (choice !== "Upgrade") return;
    const upgradeOptions = {
      scope: msg.scope,
      registry: useRegistry ? source.registry : undefined,
      packageName: useRegistry ? source.package : undefined,
    };
    let result = parsePluginUpgradeResult(
      await runCli(buildPluginUpgradeArgs(target, upgradeOptions), 120000),
    );
    if (!result) {
      vscode.window.showWarningMessage(
        `ChainlessChain: ${msg.name} upgrade returned an unreadable activation result; live sessions were not reloaded.`,
      );
      return refresh();
    }
    if (
      result.activationStatus === "rolled_back" &&
      result.rollbackReason === "capability_consent_required"
    ) {
      const added = result.capabilities?.added || [];
      const retry = await vscode.window.showWarningMessage(
        [
          `${msg.name} v${result.version || "?"} requested new capabilities, so the CLI restored v${result.rollbackVersion || "none"}.`,
          added.length ? `New capabilities:\n• ${added.join("\n• ")}` : "",
          "Retry the validated upgrade and grant this capability set?",
        ]
          .filter(Boolean)
          .join("\n\n"),
        { modal: true },
        "Retry and grant",
      );
      if (retry === "Retry and grant") {
        result = parsePluginUpgradeResult(
          await runCli(
            buildPluginUpgradeArgs(target, {
              ...upgradeOptions,
              grantCapabilities: true,
            }),
            120000,
          ),
        );
      }
    }
    if (!result || result.activationStatus === "rolled_back") {
      vscode.window.showWarningMessage(
        result
          ? `ChainlessChain: ${msg.name} upgrade was not activated (${result.rollbackReason || "automatic recovery"}); restored v${result.rollbackVersion || "none"}.`
          : `ChainlessChain: ${msg.name} retry returned an unreadable activation result; live sessions were not reloaded.`,
      );
      return refresh();
    }
    if (result.activationStatus === "unchanged") {
      vscode.window.showInformationMessage(
        `ChainlessChain: ${msg.name} is already up to date at v${result.version || "?"}.`,
      );
      return refresh();
    }
    const reloaded = reloadActivePluginSessions();
    vscode.window.showInformationMessage(
      `ChainlessChain: ${msg.name} v${result.version || "?"} activated; reload requested in ${reloaded} live chat session(s).`,
    );
    return refresh();
  }
  if (msg.command === "pluginDetails") {
    const source =
      msg.source && typeof msg.source === "object" ? msg.source : {};
    const integrity =
      msg.integrity && typeof msg.integrity === "object" ? msg.integrity : {};
    const signature = integrity.signature || {};
    const sbom = integrity.sbom || {};
    const policy =
      msg.policy && typeof msg.policy === "object" ? msg.policy : {};
    await vscode.window.showInformationMessage(
      [
        `${msg.name} v${msg.version || "?"} (${msg.scope} scope)`,
        `State: ${msg.enabled === false ? "disabled" : "enabled"}`,
        `Source: ${source.type || "legacy/unknown"} ${source.source || ""}`,
        source.ref ? `Pin: ${source.ref}` : "",
        signature.verified
          ? `Signature: verified (${signature.publicKeySha256 || "key fingerprint unavailable"})`
          : `Signature: unverified${signature.reason ? ` — ${signature.reason}` : ""}`,
        sbom.present
          ? `SBOM: ${sbom.fileCount || 0} files, ${sbom.totalBytes || 0} bytes, digest ${sbom.digest || "unknown"}`
          : "SBOM: unavailable",
        policy.managed
          ? `Managed policy: ${policy.allowed === false ? "blocked" : "allowed"} (${policy.source || "source unavailable"})${policy.reason ? ` — ${policy.reason}` : ""}`
          : "Managed policy: none",
      ]
        .filter(Boolean)
        .join("\n"),
      { modal: true },
    );
    return;
  }
  if (msg.command === "pluginReload") {
    const reloaded = reloadActivePluginSessions();
    vscode.window.showInformationMessage(
      reloaded
        ? `ChainlessChain: requested plugin-runtime reload in ${reloaded} live chat session(s).`
        : "ChainlessChain: no live foreground chat session needed reloading; new sessions already use the current plugin state.",
    );
    return;
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
  if (msg.command === "pluginUse") {
    const versions = Array.isArray(msg.versions)
      ? msg.versions.filter(
          (version) =>
            typeof version === "string" &&
            version &&
            version !== String(msg.activeVersion || ""),
        )
      : [];
    if (!versions.length) {
      vscode.window.showInformationMessage(
        `ChainlessChain: ${msg.name} has no other installed version to activate.`,
      );
      return;
    }
    const version = await vscode.window.showQuickPick(versions, {
      title: `Switch ${msg.name} from v${msg.activeVersion || "?"}`,
      placeHolder: "Choose an installed version",
    });
    if (!version) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Activate ${msg.name} v${version} (${msg.scope} scope)? Existing sessions keep their loaded bytes; new sessions use the selected version.`,
      { modal: true },
      "Switch version",
    );
    if (confirmed !== "Switch version") return;
    await runCli(buildPluginUseArgs(msg.name, version, msg.scope));
    const reloaded = reloadActivePluginSessions();
    vscode.window.showInformationMessage(
      `ChainlessChain: ${msg.name} now points to v${version}; reload requested in ${reloaded} live chat session(s).`,
    );
    return refresh();
  }
  if (msg.command === "pluginConsent") {
    let details;
    try {
      details = JSON.parse(
        await runCli(
          buildPluginConsentArgs(msg.name, "status", msg.scope),
          30000,
        ),
      );
    } catch {
      vscode.window.showWarningMessage(
        `ChainlessChain: could not read capability consent for ${msg.name}.`,
      );
      return;
    }
    const declared = Array.isArray(details?.declared) ? details.declared : [];
    const added = Array.isArray(details?.added) ? details.added : [];
    const consented = details?.consented === true;
    const action = consented ? "Revoke consent" : "Grant consent";
    const choice = await vscode.window.showWarningMessage(
      [
        `${msg.name} v${details?.version || msg.activeVersion || "?"} (${msg.scope} scope)`,
        details?.reason || "",
        declared.length
          ? `Declared capabilities:\n• ${declared.join("\n• ")}`
          : "Declared capabilities: none",
        added.length ? `New since last consent:\n• ${added.join("\n• ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      { modal: true },
      action,
    );
    if (choice !== action) return;
    await runCli(
      buildPluginConsentArgs(
        msg.name,
        consented ? "revoke" : "grant",
        msg.scope,
      ),
    );
    reloadActivePluginSessions();
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

function reloadActivePluginSessions() {
  try {
    return typeof _chatProvider?.reloadPluginRuntimes === "function"
      ? _chatProvider.reloadPluginRuntimes()
      : 0;
  } catch {
    return 0;
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
    <button id="pluginReload" class="sec">Reload live sessions</button>
  </div>

  <h2>Runtime plugins</h2>
  <div id="plugins"></div>
  <h2>CLI goal snapshot <button id="clearGoalPanels" class="sec">Clear</button></h2>
  <pre id="goalPanels" style="white-space:pre-wrap"></pre>

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
  document.getElementById('pluginReload').addEventListener('click', ()=>vscode.postMessage({command:'pluginReload'}));
  document.getElementById('clearGoalPanels').addEventListener('click', ()=>vscode.postMessage({command:'clearGoalPanels'}));
  document.getElementById('skillFilter').addEventListener('input', ()=>{ if(last) renderSkills(last.skills); });

  function renderPlugins(rows){
    const el = document.getElementById('plugins');
    if (rows === null){ el.innerHTML = '<p class="err">could not read plugins (is cc installed?)</p>'; return; }
    if (!rows.length){ el.innerHTML = '<p class="muted">No runtime plugins installed — Add plugin… installs a directory or a registry package.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>plugin</th><th>version</th><th>scope</th><th>state</th><th>supply chain</th><th style="width:360px"></th></tr></thead><tbody>'
      + rows.map(p => '<tr><td>'+esc(p.name)+'</td><td>'+esc(p.version)+'</td>'
        + '<td><span class="pill">'+esc(p.scope)+'</span></td>'
        + '<td>'+(p.enabled?'<span class="ok">enabled</span>':'<span class="warnflag">disabled</span>')
        + (p.ok?'':' <span class="bad">invalid manifest</span>')
        + (p.goalExtension && p.goalExtension.status !== 'legacy'
          ? '<br><span class="pill" title="Declaration; authorization is checked on each CLI goal panel read">Goal SDK '+esc(p.goalExtension.apiVersion||'?')+'</span> '
            + '<span class="muted">'+esc(p.goalExtension.status === 'declaration-only'
              ? (!p.goalExtension.apiCompatible ? 'unsupported API' : p.goalExtension.hosts.vscode ? 'declared for VS Code' : 'VS Code undeclared')
              : p.goalExtension.status)+'</span>'
          : '')+'</td>'
        + '<td>'+(p.integrity&&p.integrity.signature&&p.integrity.signature.verified
          ? '<span class="pill ok">signed</span>'
          : '<span class="pill muted">unsigned</span>')
        + (p.integrity&&p.integrity.sbom&&p.integrity.sbom.present
          ? ' <span class="pill">SBOM '+esc(p.integrity.sbom.fileCount)+'</span>'
          : '')
        + (p.policy&&p.policy.managed
          ? (p.policy.allowed? ' <span class="pill">managed</span>' : ' <span class="pill bad">policy blocked</span>')
          : '')+'</td>'
        + '<td>'
        + (p.goalExtension && p.goalExtension.hosts.cli
          ? '<button class="sec" data-act="pluginGoalPanels" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">CLI goal panels…</button><button class="sec" data-act="pluginGoalDraftRequest" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Export goal draft request…</button><button class="sec" data-act="pluginGoalDraftAccess" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Export online draft access…</button><button class="sec" data-act="pluginGoalDraftSend" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Submit pending draft…</button><button class="sec" data-act="pluginGoalDraftReceipt" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Look up draft receipt…</button>' : '')
        + '<button class="sec" data-act="pluginLifecycle" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">'+(p.enabled?'Disable':'Enable')+'</button>'
        + '<button class="sec" data-act="pluginUpgrade" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Upgrade</button>'
        + '<button class="sec" data-act="trust" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Trust</button>'
        + '<button class="sec" data-act="untrust" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Untrust</button>'
        + (Array.isArray(p.versions) && p.versions.length > 1
          ? '<button class="sec" data-act="pluginUse" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Versions ('+p.versions.length+')</button>'
          : '')
        + '<button class="sec" data-act="pluginConsent" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Capabilities</button>'
        + '<button class="sec" data-act="pluginDetails" data-name="'+esc(p.name)+'" data-scope="'+esc(p.scope)+'">Details</button>'
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
    const scope = b.getAttribute('data-scope')||'user';
    const row = Array.isArray(last && last.plugins) ? last.plugins.find(p => p.name === name && p.scope === scope) : null;
    if (act === 'trust') vscode.postMessage({command:'pluginTrust', name, trusted:true, scope: b.getAttribute('data-scope')||'user'});
    else if (act === 'untrust') vscode.postMessage({command:'pluginTrust', name, trusted:false, scope: b.getAttribute('data-scope')||'user'});
    else if (act === 'pluginLifecycle') vscode.postMessage({command:'pluginLifecycle', name, scope, enabled:!(row&&row.enabled)});
    else if (act === 'pluginUpgrade') vscode.postMessage({command:'pluginUpgrade', name, scope, source:row&&row.source});
    else if (act === 'pluginDetails') vscode.postMessage({command:'pluginDetails', name, scope, version:row&&row.version, enabled:row&&row.enabled, source:row&&row.source, integrity:row&&row.integrity, policy:row&&row.policy});
    else if (act === 'pluginGoalPanels') vscode.postMessage({command:'pluginGoalPanels', name, scope});
    else if (act === 'pluginGoalDraftRequest') vscode.postMessage({command:'pluginGoalDraftRequest', name, scope});
    else if (['pluginGoalDraftAccess','pluginGoalDraftSend','pluginGoalDraftReceipt'].includes(act)) vscode.postMessage({command:act, name, scope});
    else if (act === 'pluginUse') {
      vscode.postMessage({command:'pluginUse', name, scope:b.getAttribute('data-scope')||'user', activeVersion:row&&row.version, versions:row&&row.versions});
    }
    else if (act === 'pluginConsent') {
      vscode.postMessage({command:'pluginConsent', name, scope:b.getAttribute('data-scope')||'user', activeVersion:row&&row.version});
    }
    else if (act === 'uninstall') vscode.postMessage({command:'pluginUninstall', name, scope: b.getAttribute('data-scope')||'user'});
    else if (act === 'connect') vscode.postMessage({command:'mcpConnect', name});
    else if (act === 'mcpRemove') vscode.postMessage({command:'mcpRemove', name});
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'busy'){ document.getElementById('busy').textContent = '· working…'; return; }
    if (m.type === 'note'){ document.getElementById('note').textContent = m.text || ''; return; }
    if (m.type === 'goalPanels'){ document.getElementById('goalPanels').textContent = m.text || ''; return; }
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
