import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  configureEvolutionDeployment,
  getEvolutionDeploymentStatus,
  setEvolutionDeploymentEnabled,
} from "../lib/evolution/evolution-deployment-config.js";

function printStatus(status) {
  logger.log(chalk.bold("Governed Skill evolution deployment"));
  logger.log(
    `  Effective:       ${status.effectiveEnabled ? "enabled" : "disabled"}`,
  );
  logger.log(`  Source:          ${status.source}`);
  logger.log(
    `  Signature:       ${status.verified ? "verified" : "not verified"}`,
  );
  logger.log(`  Auto promotion:  HOLD (manual review required)`);
  logger.log(`  Profile:         ${status.profilePath}`);
  if (status.descriptorPath)
    logger.log(`  Descriptor:      ${status.descriptorPath}`);
  if (status.trustRootPath)
    logger.log(`  Trust root:      ${status.trustRootPath}`);
  if (status.commands?.length)
    logger.log(`  Commands:        ${status.commands.join(", ")}`);
  if (status.error) logger.log(chalk.red(`  Error:           ${status.error}`));
}

function output(status, json) {
  if (json) console.log(JSON.stringify(status, null, 2));
  else printStatus(status);
}

function fail(error, json) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else logger.error(`Failed: ${message}`);
  process.exitCode = 1;
}

export function registerEvolutionDeploymentCommands(parent) {
  const deployment = parent
    .command("deployment")
    .description("Configure the signed governed Skill evolution deployment");

  deployment
    .command("status")
    .description("Show the effective deployment and signature status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        output(await getEvolutionDeploymentStatus(), options.json);
      } catch (error) {
        fail(error, options.json);
      }
    });

  deployment
    .command("configure")
    .description("Verify, save, and enable a signed deployment")
    .requiredOption("--descriptor <path>", "Absolute signed descriptor path")
    .requiredOption("--trust-root <path>", "Absolute Ed25519 public key path")
    .option("--disabled", "Save without enabling")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        output(
          await configureEvolutionDeployment({
            descriptorPath: options.descriptor,
            trustRootPath: options.trustRoot,
            enabled: options.disabled !== true,
          }),
          options.json,
        );
      } catch (error) {
        fail(error, options.json);
      }
    });

  for (const enabled of [true, false]) {
    deployment
      .command(enabled ? "enable" : "disable")
      .description(
        `${enabled ? "Enable" : "Disable"} the saved deployment profile`,
      )
      .option("--json", "Output as JSON")
      .action(async (options) => {
        try {
          output(await setEvolutionDeploymentEnabled(enabled), options.json);
        } catch (error) {
          fail(error, options.json);
        }
      });
  }
}
