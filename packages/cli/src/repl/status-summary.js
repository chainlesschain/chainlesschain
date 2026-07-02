/**
 * `/status` REPL command — a concise environment snapshot (Claude-Code parity,
 * minus the account/billing bits cc doesn't have). Lighter than `/doctor`'s
 * health check: just "where am I" — version, model, session, cwd, roots, and
 * connection counts. Pure renderer; the REPL gathers the live info.
 */

/**
 * @param {object} info
 *   version, installedVersion, node, platform, provider, model, sessionId,
 *   messageCount, cwd, extraRoots, ideConnected, mcpServers, hookEvents
 */
export function formatStatus(info = {}) {
  const ver =
    info.installedVersion && info.installedVersion !== info.version
      ? `cc ${info.version} (disk ${info.installedVersion} — restart to apply)`
      : `cc ${info.version || "?"}`;
  const lines = [
    `${ver}  ·  node ${info.node || "?"}  ·  ${info.platform || "?"}`,
    `  provider/model: ${info.provider || "?"} / ${info.model || "?"}`,
    `  session: ${info.sessionId || "(none)"}  ·  messages: ${info.messageCount ?? 0}`,
    `  cwd: ${info.cwd || "?"}`,
  ];
  if (info.extraRoots > 0) {
    lines.push(`  extra roots: +${info.extraRoots} (/add-dir)`);
  }
  lines.push(
    `  IDE: ${info.ideConnected ? "connected" : "none"}  ·  ` +
      `MCP: ${info.mcpServers || 0} server(s)  ·  ` +
      `hooks: ${info.hookEvents || 0} event(s)`,
  );
  return lines.join("\n");
}
