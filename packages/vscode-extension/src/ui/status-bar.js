/**
 * Status bar indicator for the IDE bridge — a always-visible item in the
 * bottom-right showing running state + port + tool-call count, briefly flashing
 * the active tool on each call. Clicking runs `commandId` (the dashboard).
 */
function createStatusBar(vscode, commandId) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = commandId;
  let revertTimer = null;

  function render(state) {
    if (state && state.port > 0) {
      const n = state.toolCount || 0;
      item.text = `$(plug) IDE :${state.port}` + (n ? ` $(arrow-right)${n}` : "");
      item.tooltip = vscode.l10n.t(
        'ChainlessChain IDE bridge\n127.0.0.1:{0} (MCP server "ide")\n{1} tool calls · click to open the dashboard',
        String(state.port),
        String(n),
      );
    } else {
      item.text = "$(debug-disconnect) IDE off";
      item.tooltip = vscode.l10n.t(
        "ChainlessChain IDE bridge stopped · click to open the dashboard",
      );
    }
    item.show();
  }

  /** Briefly show the active tool, then revert to the steady state. */
  function flash(toolName, state) {
    item.text = `$(sync~spin) IDE ${toolName}`;
    item.show();
    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(() => {
      revertTimer = null;
      render(state);
    }, 1200);
  }

  return { item, render, flash };
}

/**
 * Status-bar indicator for the chat's per-conversation approval mode — makes
 * auto-accept / bypass visible (they are otherwise invisible once set via
 * /auto · /bypass or Shift+Tab). The normal "default" mode shows a quiet shield;
 * bypass is highlighted with the warning background so the risky state can't be
 * missed. Sits just left of the bridge item.
 */
function createModeStatusBar(vscode, commandId) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  );
  if (commandId) item.command = commandId;
  const warnBg = vscode.ThemeColor
    ? new vscode.ThemeColor("statusBarItem.warningBackground")
    : undefined;

  function render(mode) {
    if (mode === "bypassPermissions") {
      item.text = "$(unlock) bypass approvals";
      item.tooltip = vscode.l10n.t(
        "ChainlessChain chat: skip all approvals (dangerous) · /normal to restore",
      );
      item.backgroundColor = warnBg;
    } else if (mode === "acceptEdits") {
      item.text = "$(check) auto-accept edits";
      item.tooltip = vscode.l10n.t(
        "ChainlessChain chat: auto-accept edits · /normal to restore",
      );
      item.backgroundColor = undefined;
    } else {
      item.text = "$(shield) approvals";
      item.tooltip = vscode.l10n.t(
        "ChainlessChain chat: normal approvals (confirm each step) · /auto · /bypass",
      );
      item.backgroundColor = undefined;
    }
    item.show();
  }

  return { item, render };
}

module.exports = { createStatusBar, createModeStatusBar };
