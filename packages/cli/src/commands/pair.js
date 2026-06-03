/**
 * `cc pair` — LAN pairing utilities. v0.1 ships only the `preflight`
 * subcommand for Linux LAN-pairing diagnostics (#21 A.1 PR1).
 *
 * Future:
 *   cc pair init             — headless mode pairing initiator (PR2)
 *   cc pair accept --qr ...  — accept a scanned QR from CLI (PR2)
 */

import chalk from "chalk";
import { Command } from "commander";
import {
  runPreflight,
  firewallCommandTemplate,
  detectFirewallTool,
  STATUS,
} from "../lib/lan-pairing-preflight.js";
import {
  addToken,
  listTokens,
  findToken,
  revokeToken,
  STATUS as TOKEN_STATUS,
} from "../lib/lan-pairing-tokens.js";

function statusBadge(s) {
  switch (s) {
    case STATUS.OK:
      return chalk.green("✔ ok");
    case STATUS.WARNING:
      return chalk.yellow("⚠ warn");
    case STATUS.BLOCKER:
      return chalk.red("✖ blocker");
    case STATUS.SKIP:
      return chalk.gray("· skip");
    default:
      return s;
  }
}

function printHumanReadable(report, showFirewall) {
  console.log(chalk.bold("\n  cc pair preflight\n"));
  for (const c of report.checks) {
    console.log(
      `  ${statusBadge(c.status).padEnd(20)} ${chalk.bold(c.name.padEnd(22))} ${c.detail}`,
    );
  }
  console.log();
  console.log(
    chalk.bold(
      `  summary: ${chalk.green(report.summary.ok + " ok")}, ` +
        `${chalk.yellow(report.summary.warnings + " warning")}, ` +
        `${chalk.red(report.summary.blockers + " blocker")}`,
    ),
  );

  // Show firewall commands when there's a blocker on multicast_bind, or
  // when --show-firewall is set.
  const multicastBlocked = report.checks.some(
    (c) => c.name === "multicast_bind" && c.status === STATUS.BLOCKER,
  );
  if (showFirewall || multicastBlocked) {
    const tool = detectFirewallTool();
    const tpl = firewallCommandTemplate(tool);
    if (tpl) {
      console.log();
      console.log(chalk.bold("  Firewall fix (detected tool: " + tool + "):"));
      console.log();
      console.log(
        tpl
          .split("\n")
          .map((l) => "    " + l)
          .join("\n"),
      );
    }
  }
  console.log();
}

function tokenStatusBadge(s) {
  switch (s) {
    case TOKEN_STATUS.PENDING:
      return chalk.cyan("pending");
    case TOKEN_STATUS.CONSUMED:
      return chalk.green("consumed");
    case TOKEN_STATUS.REVOKED:
      return chalk.gray("revoked");
    case TOKEN_STATUS.EXPIRED:
      return chalk.yellow("expired");
    default:
      return s;
  }
}

function relTime(ms) {
  const diff = ms - Date.now();
  const absMin = Math.abs(diff) / 60_000;
  if (absMin < 60) {
    return diff > 0
      ? `${Math.round(absMin)} min from now`
      : `${Math.round(absMin)} min ago`;
  }
  const absH = absMin / 60;
  if (absH < 24) {
    return diff > 0
      ? `${Math.round(absH)}h from now`
      : `${Math.round(absH)}h ago`;
  }
  return diff > 0
    ? `${Math.round(absH / 24)}d from now`
    : `${Math.round(absH / 24)}d ago`;
}

export function registerPairCommand(program) {
  const pair = program
    .command("pair")
    .description(
      "LAN pairing utilities (preflight diagnostics + pairing token issuance)",
    );

  pair
    .command("preflight")
    .description(
      "Diagnose Linux LAN pairing — checks multicast bind, port 5353 holders, firewall hints (#21 A.1)",
    )
    .option("--json", "Machine-readable JSON output")
    .option(
      "--show-firewall",
      "Always print firewall fix commands (default: only on blocker)",
    )
    .option(
      "--multicast-bind-timeout-ms <ms>",
      "Timeout for multicast bind probe",
      (v) => parseInt(v, 10),
    )
    .action(async (options) => {
      const report = await runPreflight({
        multicastBindTimeoutMs: options.multicastBindTimeoutMs,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.exitCode;
        return;
      }

      printHumanReadable(report, options.showFirewall);
      process.exitCode = report.exitCode;
    });

  // ─── pair token (PR2) ─────────────────────────────────────────

  const token = pair
    .command("token")
    .description(
      "Manage pairing tokens (issue/list/show/revoke). Tokens are compatible with desktop device-pairing-handler QR shape.",
    );

  token
    .command("generate")
    .description("Issue a new 6-digit pairing token for a given DID")
    .requiredOption("--did <did>", "PC DID (the token will pair this DID)")
    .option("--name <name>", "Friendly device name (default: hostname)")
    .option(
      "--device-id <id>",
      "Override deviceId (default: cli-<hostname>-<ts>)",
    )
    .option("--json", "Machine-readable JSON output (full qrData + metadata)")
    .action((options) => {
      const deviceInfo = (() => {
        const out = {};
        if (options.name) out.name = options.name;
        if (options.deviceId) out.deviceId = options.deviceId;
        return Object.keys(out).length ? out : undefined;
      })();
      const t = addToken({ did: options.did, deviceInfo });
      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }
      console.log();
      console.log(chalk.bold("  ✓ Pairing token issued\n"));
      console.log("  code:       " + chalk.bold.cyan(t.code));
      console.log("  did:        " + t.qrData.did);
      console.log("  device:     " + (t.qrData.deviceInfo?.name || "(none)"));
      console.log("  expires:    " + relTime(t.expiresAtMs));
      console.log();
      console.log(
        chalk.gray("  QR data (paste into mobile scanner / Electron handler):"),
      );
      console.log();
      console.log("    " + JSON.stringify(t.qrData));
      console.log();
    });

  token
    .command("list")
    .description("List pairing tokens")
    .option(
      "--status <s>",
      "Filter by status (pending/consumed/revoked/expired)",
    )
    .option("--did <did>", "Filter by DID")
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      const tokens = listTokens({ status: options.status, did: options.did });
      if (options.json) {
        console.log(JSON.stringify({ tokens }, null, 2));
        return;
      }
      if (tokens.length === 0) {
        console.log(chalk.gray("\n  No pairing tokens.\n"));
        return;
      }
      console.log();
      console.log(chalk.bold("  Pairing tokens:\n"));
      console.log(
        "  " +
          chalk.gray("code").padEnd(10) +
          chalk.gray("status").padEnd(14) +
          chalk.gray("did").padEnd(30) +
          chalk.gray("expires"),
      );
      for (const t of tokens) {
        console.log(
          "  " +
            chalk.bold(t.code).padEnd(20) +
            tokenStatusBadge(t.status).padEnd(20) +
            String(t.qrData?.did || "?")
              .slice(0, 28)
              .padEnd(30) +
            relTime(t.expiresAtMs),
        );
      }
      console.log();
    });

  token
    .command("show <code>")
    .description("Show a single pairing token by code")
    .option("--json", "Machine-readable JSON output")
    .action((code, options) => {
      const t = findToken(code);
      if (!t) {
        console.error(chalk.red(`✖ token not found: ${code}`));
        process.exitCode = 2;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }
      console.log();
      console.log(chalk.bold(`  Token ${chalk.cyan(t.code)}\n`));
      console.log("  status:     " + tokenStatusBadge(t.status));
      console.log("  did:        " + t.qrData.did);
      console.log(
        "  device:     " +
          (t.qrData.deviceInfo?.name || "(none)") +
          " (" +
          (t.qrData.deviceInfo?.platform || "?") +
          ")",
      );
      console.log("  created:    " + new Date(t.createdAtMs).toISOString());
      console.log("  expires:    " + new Date(t.expiresAtMs).toISOString());
      if (t.consumedAtMs)
        console.log("  consumed:   " + new Date(t.consumedAtMs).toISOString());
      if (t.revokedAtMs)
        console.log("  revoked:    " + new Date(t.revokedAtMs).toISOString());
      console.log();
    });

  token
    .command("revoke <code>")
    .description("Revoke a pending pairing token")
    .option("--json", "Machine-readable JSON output")
    .action((code, options) => {
      const r = revokeToken(code);
      if (options.json) {
        console.log(JSON.stringify(r, null, 2));
        if (!r.revoked) process.exitCode = 2;
        return;
      }
      if (r.revoked) {
        console.log(chalk.green(`\n  ✓ Token ${code} revoked.\n`));
      } else {
        console.error(chalk.red(`\n  ✖ Cannot revoke: ${r.reason}\n`));
        process.exitCode = 2;
      }
    });
}
