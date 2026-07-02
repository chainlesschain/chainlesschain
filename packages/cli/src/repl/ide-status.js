/**
 * `/ide` REPL command renderer (Claude-Code parity) — report whether an IDE
 * bridge is connected to THIS agent session, which editor/port/workspace it
 * is, the IDE tools the agent can call, and — when nothing is connected — why
 * discovery came up empty plus how to fix it.
 *
 * Pure and dependency-free: takes the resolved MCP bundle (for the live,
 * in-session connection) and an optional `diagnoseIde()` result (for lockfile
 * details), returns plain text. The REPL does the I/O.
 */

const IDE_PREFIX = "mcp__ide__";

/** Sorted bare IDE tool names connected in this session (e.g. ["getSelection"]). */
export function ideToolNames(mcp) {
  const ex = (mcp && mcp.externalToolExecutors) || {};
  return Object.keys(ex)
    .filter((k) => k.startsWith(IDE_PREFIX) && ex[k] && ex[k].kind === "mcp")
    .map((k) => k.slice(IDE_PREFIX.length))
    .sort();
}

/**
 * @param {object|null} mcp   resolved bundle from resolveAgentMcp (or null)
 * @param {object|null} diag  diagnoseIde() result, or null when unavailable
 * @returns {string}
 */
export function renderIdeStatus(mcp, diag = null) {
  const tools = ideToolNames(mcp);
  const chosen = diag && diag.chosen ? diag.chosen : null;
  const lines = [];

  if (tools.length > 0) {
    const where = chosen
      ? `${chosen.ide || "ide"} on 127.0.0.1:${chosen.port} (${chosen.transport})`
      : "an editor extension";
    lines.push(`● IDE bridge connected — ${where}`);
    if (
      chosen &&
      Array.isArray(chosen.workspaceFolders) &&
      chosen.workspaceFolders.length
    ) {
      lines.push(`  workspace: ${chosen.workspaceFolders.join(", ")}`);
    }
    lines.push(`  tools: ${tools.map((t) => IDE_PREFIX + t).join(", ")}`);
    lines.push(
      "  selection/diagnostics auto-share each turn · " +
        "@selection / @diagnostics expand on demand",
    );
    return lines.join("\n");
  }

  lines.push("○ IDE bridge not connected to this session");
  if (diag) {
    if (diag.reason) lines.push(`  ${diag.reason}`);
    if (Array.isArray(diag.locks) && diag.locks.length) {
      lines.push(`  ${diag.locks.length} lockfile(s) in ${diag.lockDir}:`);
      for (const l of diag.locks.slice(0, 5)) {
        lines.push(
          `    - ${l.ide || "?"} :${l.port} ${l.transport} ` +
            `(matchScore ${l.matchScore})`,
        );
      }
    }
    lines.push(
      diag.inIdeTerminal
        ? "  you're in an IDE terminal — restart the agent so it re-discovers the bridge"
        : "  launch `cc` from your IDE's integrated terminal, or pass --ide to force-connect",
    );
  } else {
    lines.push(
      "  install the ChainlessChain IDE extension, then launch cc from its terminal",
    );
  }
  return lines.join("\n");
}
