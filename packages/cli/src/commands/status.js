import chalk from "chalk";
import logger from "../lib/logger.js";
import { collectStatusReport } from "../runtime/diagnostics.js";

export function registerStatusCommand(program) {
  program
    .command("status")
    .description("Show status of ChainlessChain app and services")
    .option("--json", "Output as machine-readable JSON")
    .action(async (options) => {
      try {
        const report = await collectStatusReport();

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        // App status
        logger.log(chalk.bold("\n  App Status\n"));
        if (report.app.running) {
          logger.log(
            `  ${chalk.green("●")} Desktop app running (PID: ${report.app.pid})`,
          );
        } else {
          logger.log(`  ${chalk.gray("○")} Desktop app not running`);
        }

        if (report.setup.completed) {
          logger.log(
            `  ${chalk.green("●")} Setup completed (${report.setup.completedAt || "unknown"})`,
          );
          if (report.setup.edition) {
            logger.log(`    Edition: ${report.setup.edition}`);
          }
          if (report.setup.llm) {
            logger.log(
              `    LLM: ${report.setup.llm.provider} (${report.setup.llm.model})`,
            );
          }
        } else {
          logger.log(`  ${chalk.yellow("●")} Setup not completed`);
        }

        // Docker services
        logger.log(chalk.bold("\n  Docker Services\n"));
        if (!report.docker.available) {
          logger.log(`  ${chalk.gray("○")} Docker not available`);
        } else if (report.docker.services) {
          for (const svc of report.docker.services) {
            const running = svc.state === "running";
            const icon = running ? chalk.green("●") : chalk.red("●");
            logger.log(`  ${icon} ${svc.name}: ${svc.state}`);
          }
        } else if (report.docker.note) {
          const icon = report.docker.note.includes("not found")
            ? chalk.gray("○")
            : chalk.gray("○");
          logger.log(`  ${icon} ${report.docker.note}`);
        }

        // Ports
        logger.log(chalk.bold("\n  Ports\n"));
        for (const p of report.ports) {
          const icon = p.open ? chalk.green("●") : chalk.gray("○");
          logger.log(`  ${icon} ${p.name}: ${p.port}`);
        }

        logger.newline();
      } catch (err) {
        logger.error(`Status check failed: ${err.message}`);
        process.exit(1);
      }
    });
}
