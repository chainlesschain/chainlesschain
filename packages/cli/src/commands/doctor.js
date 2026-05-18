import chalk from "chalk";
import logger from "../lib/logger.js";
import { collectDoctorReport } from "../runtime/diagnostics.js";

export function registerDoctorCommand(program) {
  program
    .command("doctor")
    .description("Diagnose your ChainlessChain environment")
    .option("--json", "Output as machine-readable JSON")
    .action(async (options) => {
      const report = await collectDoctorReport();

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        if (report.summary.criticalFailed > 0) {
          process.exitCode = 1;
        }
        return;
      }

      logger.log(chalk.bold("\n  ChainlessChain Doctor\n"));

      for (const check of report.checks) {
        const icon = check.ok ? chalk.green("✔") : chalk.red("✖");
        const detail = check.detail ? chalk.gray(` (${check.detail})`) : "";
        logger.log(`  ${icon} ${check.name}${detail}`);
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

      logger.newline();
      if (report.summary.failed === 0) {
        logger.log(chalk.bold.green("  All checks passed!\n"));
      } else if (report.summary.criticalFailed > 0) {
        logger.log(
          chalk.bold.red(
            `  ${report.summary.criticalFailed} issue(s) found. See details above.\n`,
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
