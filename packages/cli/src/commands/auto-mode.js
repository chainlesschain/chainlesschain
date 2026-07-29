import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  autoModeDefaultsDocument,
  loadAutoModeConfig,
  resolveAutoModeDecisions,
} from "../lib/auto-mode-config.js";
import {
  formatAutoModeSafetyEvalReport,
  loadAutoModeSafetyDataset,
  runAutoModeSafetyEval,
} from "../lib/auto-mode-safety-eval.js";

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
  for (const rule of resolved.rules || []) {
    const match = Object.entries(rule.match)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    logger.log(`  rule   ${match} →  ${rule.decision.padEnd(5)} (settings)`);
  }
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

export function runAutoModeSafetyEvalCommand(options = {}, deps = {}) {
  const output = deps.output || ((value) => console.log(value));
  const log = deps.logger || logger;
  const setExitCode = deps.setExitCode || ((code) => (process.exitCode = code));
  const loadDataset = deps.loadDataset || loadAutoModeSafetyDataset;
  const runEval = deps.runEval || runAutoModeSafetyEval;

  try {
    const dataset = loadDataset(options.dataset);
    const report = runEval(dataset);
    if (options.json) output(JSON.stringify(report, null, 2));
    else log.log(formatAutoModeSafetyEvalReport(report));
    if (!report.ok) setExitCode(1);
    return report;
  } catch (error) {
    const envelope = {
      schema: "chainlesschain.auto-mode-safety-error/v1",
      ok: false,
      error: {
        code: error.code || "auto-mode-safety-eval-failed",
        message: error.message,
        ...(Array.isArray(error.errors)
          ? { validationErrors: error.errors.slice(0, 50) }
          : {}),
      },
    };
    if (options.json) output(JSON.stringify(envelope, null, 2));
    else log.error(chalk.red(`auto-mode eval failed: ${error.message}`));
    setExitCode(1);
    return envelope;
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
            rules: (resolved.rules || []).map((rule) => ({
              match: rule.match,
              decision: rule.decision,
              reason: rule.reason,
            })),
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

  cmd
    .command("eval")
    .description(
      "Run the offline dangerous-operation classifier corpus and CI gate",
    )
    .option("--dataset <file>", "Evaluate a custom versioned JSON dataset")
    .option("--json", "Output one machine-readable JSON report")
    .action((options) => runAutoModeSafetyEvalCommand(options));
}
