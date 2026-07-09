import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  autoModeDefaultsDocument,
  loadAutoModeConfig,
  resolveAutoModeDecisions,
} from "../lib/auto-mode-config.js";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printConfigSummary(config, resolved) {
  logger.log(chalk.bold("Auto mode effective config"));
  logger.log(
    `  classifyAllShell: ${String(config.effective.classifyAllShell)}`,
  );
  logger.log(
    `  classifier:       ${resolved.customized ? "autoMode.decisions (customized)" : "trusted policy (defaults)"}`,
  );
  for (const riskLevel of ["low", "medium", "high"]) {
    const rule = resolved.map[riskLevel];
    logger.log(
      `  ${riskLevel.padEnd(6)} risk →    ${rule.decision.padEnd(5)} (${rule.source}: ${rule.reason})`,
    );
  }
  if (config.files.length) {
    logger.log(chalk.gray(`  sources: ${config.files.join(", ")}`));
  } else {
    logger.log(chalk.gray("  sources: defaults only"));
  }
  if (config.managedFile) {
    logger.log(chalk.yellow(`  managed: ${config.managedFile}`));
  }
}

export function registerAutoModeCommand(program) {
  const cmd = program
    .command("auto-mode")
    .alias("automode")
    .description("Inspect auto permission-mode defaults and effective config");

  cmd
    .command("defaults")
    .description("Print built-in auto-mode classification defaults as JSON")
    .action(() => {
      printJson(autoModeDefaultsDocument());
    });

  cmd
    .command("config")
    .description("Print the effective auto-mode config")
    .option("--json", "Output as JSON")
    .option("--settings <file>", "Also merge an explicit settings file")
    .action((options) => {
      try {
        const config = loadAutoModeConfig({
          cwd: process.cwd(),
          settingsFile: options.settings,
        });
        const resolved = resolveAutoModeDecisions(config.effective);
        if (options.json) {
          printJson({
            ...config,
            decisions: resolved.map,
            customized: resolved.customized,
          });
          return;
        }
        printConfigSummary(config, resolved);
      } catch (error) {
        logger.error(chalk.red(`auto-mode config failed: ${error.message}`));
        process.exitCode = 1;
      }
    });
}
