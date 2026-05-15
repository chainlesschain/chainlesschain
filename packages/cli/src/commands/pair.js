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

export function registerPairCommand(program) {
  const pair = program
    .command("pair")
    .description(
      "LAN pairing utilities (preflight diagnostics; init/accept coming in PR2)",
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
}
