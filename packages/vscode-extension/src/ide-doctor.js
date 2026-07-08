/**
 * "Diagnose Bridge" — surface the CLI's own IDE-discovery diagnostics
 * (`cc ide status` / `cc ide doctor`) inside the IDE. The extension writes
 * the lockfile and hosts the MCP server, but when a terminal `cc agent`
 * doesn't auto-connect the WHY lives on the CLI side — this report brings it
 * in-IDE instead of making the user guess. Pure logic (no `vscode`):
 * extension.js wires the command.
 */

const IDE_STATUS_ARGS = ["ide", "status"];
const IDE_DOCTOR_ARGS = ["ide", "doctor"];

/** Section body, or a visible placeholder when the CLI produced nothing. */
function sectionBody(text) {
  const t = String(text || "").trim();
  return t || "(no output — is the `cc` CLI installed and on PATH?)";
}

/**
 * The markdown document the command shows: this window's bridge state (from
 * the live extension), then the CLI's view of discovery (`status`) and its
 * explanation (`doctor`). The CLI sections pass through as-is — they are the
 * source of truth this report exists to surface.
 */
function formatBridgeReport({ port, statusText, doctorText } = {}) {
  const mine =
    Number(port) > 0
      ? `running on 127.0.0.1:${port} (server "ide")`
      : "STOPPED — check chainlesschain.ide.enabled, then run “ChainlessChain IDE: Restart Bridge”";
  return [
    "# ChainlessChain IDE bridge — diagnostics",
    "",
    `This window's bridge: ${mine}`,
    "",
    "## cc ide status — which server a terminal `cc agent` would connect",
    "",
    "```",
    sectionBody(statusText),
    "```",
    "",
    "## cc ide doctor — why discovery did / didn't pick a server",
    "",
    "```",
    sectionBody(doctorText),
    "```",
    "",
    "_A `cc agent` run in this window's integrated terminal auto-connects via",
    "the injected `CHAINLESSCHAIN_IDE_PORT`/`_TOKEN`; from an outside terminal,",
    "discovery matches the lockfile's workspace folders against your cwd._",
    "",
  ].join("\n");
}

module.exports = { IDE_STATUS_ARGS, IDE_DOCTOR_ARGS, formatBridgeReport };
