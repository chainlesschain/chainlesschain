/**
 * Remote / WSL Doctor one-click fixes (gap #12) — pure classification of the
 * doctor's checks (remote-doctor.js analyzeRemoteEnv) into what the extension
 * may safely do about each:
 *
 *   autoApplicable  safe + non-admin: `npm install -g chainlesschain[@latest]`
 *                   (run in a VISIBLE terminal after one confirm) and
 *                   restarting the bridge via the existing
 *                   `chainlesschain.ide.restart` command.
 *   scriptable      admin-required Windows Firewall rules → we GENERATE a
 *                   complete .ps1 (elevation-checked, idempotent) for the user
 *                   to review and run themselves; the extension never runs it.
 *   manualOnly      .wslconfig edits (exact ini + target path, user merges) and
 *                   anything we can only offer to copy.
 *
 * Injection stance: check titles/details/fixes are DATA, never code. Terminal
 * commands are only emitted when they match a strict allowlist; the firewall
 * script embeds nothing from a check except a digits-validated port number.
 *
 * Pure + host-free so it unit-tests without vscode; the glue lives in
 * extension.js (runRemoteDoctor).
 */

/** The only shell commands the "Apply safe fixes" path is allowed to run. */
const AUTO_COMMAND_ALLOWLIST = /^npm install -g chainlesschain(@latest)?$/;

/** VS Code command that restarts the IDE bridge (registered in extension.js). */
const RESTART_BRIDGE_COMMAND = "chainlesschain.ide.restart";

/**
 * Digits-only port extraction from a firewall check's fix text
 * (`… localport=51234`). Anything non-numeric or out of range → null, so
 * hostile check text can never smuggle script fragments into the .ps1.
 */
function extractFirewallPort(check) {
  const m = /localport=(\d{1,5})(?!\d)/.exec(String(check?.fix || ""));
  if (!m) return null;
  const port = Number(m[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * Classify each actionable check (level ≠ ok, has a fix) into a fix plan.
 *
 * @param {Array<{id,level,title,detail,fix}>} checks  analyzeRemoteEnv checks
 * @returns {Array<{id,title,kind,action}>}
 *   kind: 'autoApplicable' | 'scriptable' | 'manualOnly'
 *   action: {type:'terminal', command}       — allowlisted shell command
 *           {type:'vscodeCommand', command}  — existing extension command
 *           {type:'script', port}            — include in the firewall .ps1
 *           {type:'wslconfig'}               — buildWslConfigPatch output
 *           {type:'copy', text}              — copy-only fallback
 */
function classifyFixes(checks) {
  const out = [];
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!c || c.level === "ok" || !c.fix) continue;
    switch (c.id) {
      case "cli-missing":
      case "cli-outdated": {
        const cmd = String(c.fix).trim();
        if (AUTO_COMMAND_ALLOWLIST.test(cmd)) {
          out.push({
            id: c.id,
            title: c.title,
            kind: "autoApplicable",
            action: { type: "terminal", command: cmd },
          });
        } else {
          // Unexpected fix text (tampered / future variant) — never execute it.
          out.push({
            id: c.id,
            title: c.title,
            kind: "manualOnly",
            action: { type: "copy", text: String(c.fix) },
          });
        }
        break;
      }
      case "bridge-stopped":
        out.push({
          id: c.id,
          title: c.title,
          kind: "autoApplicable",
          action: { type: "vscodeCommand", command: RESTART_BRIDGE_COMMAND },
        });
        break;
      case "firewall": {
        const port = extractFirewallPort(c);
        if (port) {
          out.push({
            id: c.id,
            title: c.title,
            kind: "scriptable",
            action: { type: "script", port },
          });
        } else {
          out.push({
            id: c.id,
            title: c.title,
            kind: "manualOnly",
            action: { type: "copy", text: String(c.fix) },
          });
        }
        break;
      }
      case "wsl-networking":
        out.push({
          id: c.id,
          title: c.title,
          kind: "manualOnly",
          action: { type: "wslconfig" },
        });
        break;
      default:
        out.push({
          id: c.id,
          title: c.title,
          kind: "manualOnly",
          action: { type: "copy", text: String(c.fix) },
        });
    }
  }
  return out;
}

/**
 * Generate the complete, reviewable PowerShell script that adds the inbound
 * firewall rule(s) for the bridge port(s). Deterministic (no timestamps),
 * elevation-checked, idempotent (an existing cc-ide rule for the same port is
 * skipped). Only digits-validated ports reach the script — nothing else from
 * the checks is embedded.
 *
 * @returns {string|null} script text, or null when no firewall check applies.
 */
function buildFirewallFixScript(checks) {
  const ports = [];
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!c || c.id !== "firewall") continue;
    const port = extractFirewallPort(c);
    if (port && !ports.includes(port)) ports.push(port);
  }
  if (!ports.length) return null;

  const lines = [
    "#Requires -RunAsAdministrator",
    "<#",
    // Keep the script pure ASCII: it is saved as UTF-8 WITHOUT a BOM, which
    // Windows PowerShell 5.1 would otherwise decode as ANSI (mojibake).
    " ChainlessChain Remote / WSL Doctor - firewall fix",
    "",
    " Adds an inbound Windows Firewall ALLOW rule (TCP) for the ChainlessChain",
    " IDE bridge port(s) listed below, so a cc agent running across the",
    " WSL2/host boundary can reach the bridge on 127.0.0.1.",
    "",
    " Idempotent: a cc-ide rule that already exists for the same port is",
    " skipped, so re-running the script is safe. Review before running;",
    " it must be executed from an elevated (Administrator) PowerShell.",
    "#>",
    '$ErrorActionPreference = "Stop"',
    "",
    "$ports = @(" + ports.join(", ") + ")",
    "foreach ($port in $ports) {",
    '  $ruleName = "cc-ide-$port"',
    "  $existing = netsh advfirewall firewall show rule name=\"$ruleName\" 2>$null | Out-String",
    '  if ($existing -match "$ruleName") {',
    '    Write-Host "Rule $ruleName already exists - skipping."',
    "  } else {",
    "    netsh advfirewall firewall add rule name=\"$ruleName\" dir=in action=allow protocol=TCP localport=$port",
    '    Write-Host "Added inbound allow rule $ruleName (TCP $port)."',
    "  }",
    "}",
    "",
  ];
  return lines.join("\r\n");
}

/**
 * The exact .wslconfig ini content to merge + where it lives. The extension
 * never writes this file itself — the user confirms and merges (an existing
 * [wsl2] section must be merged by hand, not clobbered).
 *
 * @returns {{targetPathHint,ini,postStep,note}|null} null when no
 *          wsl-networking check is present.
 */
function buildWslConfigPatch(checks) {
  const c = (Array.isArray(checks) ? checks : []).find(
    (x) => x && x.id === "wsl-networking",
  );
  if (!c) return null;
  return {
    targetPathHint: "%UserProfile%\\.wslconfig",
    ini: "[wsl2]\nnetworkingMode=mirrored\n",
    postStep: "wsl --shutdown",
    note:
      "Merge into the existing [wsl2] section if the file already has one, " +
      "then run `wsl --shutdown` and reopen the WSL window.",
  };
}

module.exports = {
  AUTO_COMMAND_ALLOWLIST,
  RESTART_BRIDGE_COMMAND,
  extractFirewallPort,
  classifyFixes,
  buildFirewallFixScript,
  buildWslConfigPatch,
};
