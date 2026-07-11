import chalk from "chalk";
import logger from "../lib/logger.js";
import { collectDoctorReport } from "../runtime/diagnostics.js";
import {
  collectCheckupSections,
  runCheckupFixes,
  unsafeFixCommands,
} from "../lib/doctor-checkup.js";

const LEVEL_ICON = {
  ok: () => chalk.green("✔"),
  warn: () => chalk.yellow("⚠"),
  err: () => chalk.red("✖"),
  info: () => chalk.gray("·"),
};

export function registerDoctorCommand(program) {
  program
    .command("doctor")
    .alias("checkup")
    .description("Diagnose your ChainlessChain environment (alias: checkup)")
    .option("--json", "Output as machine-readable JSON")
    .option("--fix", "Apply safe fixes (stale job files, git worktree prune)")
    .action(async (options) => {
      const report = await collectDoctorReport();
      const sections = await collectCheckupSections({ cwd: process.cwd() });
      const fixResults = options.fix ? await runCheckupFixes(sections) : null;

      const checkupErrs = sections
        .flatMap((s) => s.checks)
        .filter((c) => c.level === "err").length;

      if (options.json) {
        console.log(
          JSON.stringify({ ...report, checkup: sections, fixResults }, null, 2),
        );
        if (report.summary.criticalFailed > 0 || checkupErrs > 0) {
          process.exitCode = 1;
        }
        return;
      }

      logger.log(chalk.bold("\n  ChainlessChain Doctor\n"));

      // Version: running (this process) · installed (on disk) · latest (npm).
      const vc = report.versionCheck;
      if (vc) {
        const icon =
          vc.status === "current" ? chalk.green("✔") : chalk.yellow("⚠");
        logger.log(
          `  ${icon} cc version: running ${vc.running || "?"} · installed ${
            vc.installed || "?"
          } · latest ${vc.latest || "?"}`,
        );
        if (vc.status !== "current") {
          logger.log(chalk.yellow(`     ${vc.message}`));
        }
      }

      for (const check of report.checks) {
        const icon = check.ok ? chalk.green("✔") : chalk.red("✖");
        const detail = check.detail ? chalk.gray(` (${check.detail})`) : "";
        logger.log(`  ${icon} ${check.name}${detail}`);
      }

      // Layered checkup sections (config chain / provider / MCP / IDE /
      // plugins / subagents / transcripts / background agents / worktrees).
      for (const section of sections) {
        logger.log(chalk.bold(`\n  ${section.title}\n`));
        for (const c of section.checks) {
          const icon = (LEVEL_ICON[c.level] || LEVEL_ICON.info)();
          const detail = c.detail ? chalk.gray(` — ${c.detail}`) : "";
          logger.log(`  ${icon} ${c.name}${detail}`);
        }
      }

      logger.log(chalk.bold("\n  Port Status\n"));
      for (const p of report.ports) {
        const icon = p.open ? chalk.green("●") : chalk.gray("○");
        logger.log(`  ${icon} ${p.name}: ${p.port}`);
      }

      if (report.disk) {
        const ok = report.disk.freeGB > 2;
        logger.log(chalk.bold("\n  Disk\n"));
        const icon = ok ? chalk.green("✔") : chalk.yellow("⚠");
        logger.log(`  ${icon} Free space: ${report.disk.freeGB.toFixed(1)} GB`);
      }

      // Applied fixes (--fix) and copyable commands for the rest.
      if (fixResults && fixResults.length > 0) {
        logger.log(chalk.bold("\n  Fixes applied\n"));
        for (const f of fixResults) {
          const icon = f.applied ? chalk.green("✔") : chalk.red("✖");
          logger.log(`  ${icon} ${f.id}: ${f.detail}`);
        }
      } else if (options.fix) {
        logger.log(chalk.gray("\n  No safe fixes needed.\n"));
      }
      const manual = unsafeFixCommands(sections);
      if (manual.length > 0) {
        logger.log(
          chalk.bold("\n  Suggested commands (need your judgement)\n"),
        );
        for (const m of manual) {
          logger.log(`  ${chalk.gray("#")} ${m.description}`);
          logger.log(`    ${chalk.cyan(m.command)}`);
        }
      }

      logger.newline();
      const totalIssues = report.summary.criticalFailed + checkupErrs;
      if (report.summary.failed === 0 && checkupErrs === 0) {
        logger.log(chalk.bold.green("  All checks passed!\n"));
      } else if (totalIssues > 0) {
        logger.log(
          chalk.bold.red(
            `  ${totalIssues} issue(s) found. See details above.\n`,
          ),
        );
        process.exitCode = 1;
      } else {
        logger.log(
          chalk.bold.yellow(
            `  ${report.summary.failed} optional component(s) missing.\n`,
          ),
        );
      }
    });
}
