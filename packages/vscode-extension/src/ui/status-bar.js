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
      item.tooltip =
        `ChainlessChain IDE 桥接\n127.0.0.1:${state.port}（MCP server "ide"）\n` +
        `工具调用 ${n} 次 · 点击打开仪表板`;
    } else {
      item.text = "$(debug-disconnect) IDE off";
      item.tooltip = "ChainlessChain IDE 桥接已停止 · 点击打开仪表板";
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

module.exports = { createStatusBar };
