/**
 * Persona management command
 * chainlesschain persona [show|set|reset]
 *
 * Manage project-level AI persona configuration.
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import { findProjectRoot, loadProjectConfig } from "../lib/project-detector.js";

export function registerPersonaCommand(program) {
  const persona = program
    .command("persona")
    .description("Manage project AI persona configuration");

  // persona show
  persona
    .command("show")
    .description("Show the current project persona")
    .action(() => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const config = loadProjectConfig(projectRoot);
      if (!config?.persona) {
        logger.log("No persona configured. Using default coding assistant.");
        logger.log(
          `\nSet one with: ${chalk.cyan('chainlesschain persona set --name "My Assistant" --role "Your role description"')}`,
        );
        return;
      }

      const p = config.persona;
      logger.log(chalk.bold("Current Persona:"));
      logger.log(`  Name: ${chalk.cyan(p.name || "(unnamed)")}`);
      logger.log(`  Role: ${p.role || "(no role defined)"}`);
      if (p.behaviors?.length > 0) {
        logger.log("  Behaviors:");
        for (const b of p.behaviors) {
          logger.log(`    - ${b}`);
        }
      }
      if (p.toolsPriority?.length > 0) {
        logger.log(
          `  Preferred tools: ${chalk.gray(p.toolsPriority.join(", "))}`,
        );
      }
      if (p.toolsDisabled?.length > 0) {
        logger.log(
          `  Disabled tools: ${chalk.red(p.toolsDisabled.join(", "))}`,
        );
      }
    });

  // persona set
  persona
    .command("set")
    .description("Set or update the project persona")
    .option("-n, --name <name>", "Persona display name")
    .option("-r, --role <role>", "Role description (system prompt override)")
    .option(
      "-b, --behavior <behavior>",
      "Add a behavior guideline (repeatable)",
      collectValues,
      [],
    )
    .option(
      "--tools-priority <tools>",
      "Comma-separated list of preferred tools",
    )
    .option(
      "--tools-disabled <tools>",
      "Comma-separated list of disabled tools",
    )
    .action((options) => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const configPath = path.join(
        projectRoot,
        ".chainlesschain",
        "config.json",
      );
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        logger.error("Failed to read config.json");
        process.exit(1);
      }

      const existing = config.persona || {};
      const updated = { ...existing };

      if (options.name) updated.name = options.name;
      if (options.role) updated.role = options.role;
      if (options.behavior?.length > 0) {
        updated.behaviors = [
          ...(existing.behaviors || []),
          ...options.behavior,
        ];
      }
      if (options.toolsPriority) {
        updated.toolsPriority = options.toolsPriority
          .split(",")
          .map((s) => s.trim());
      }
      if (options.toolsDisabled) {
        updated.toolsDisabled = options.toolsDisabled
          .split(",")
          .map((s) => s.trim());
      }

      config.persona = updated;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      logger.success("Persona updated.");
      logger.log(`  Name: ${chalk.cyan(updated.name || "(unnamed)")}`);
      logger.log(`  Role: ${updated.role || "(no role defined)"}`);
    });

  // persona reset
  persona
    .command("reset")
    .description(
      "Remove the project persona, restoring the default coding assistant",
    )
    .action(() => {
      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        logger.error(
          "Not inside a ChainlessChain project. Run `chainlesschain init` first.",
        );
        process.exit(1);
      }

      const configPath = path.join(
        projectRoot,
        ".chainlesschain",
        "config.json",
      );
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        logger.error("Failed to read config.json");
        process.exit(1);
      }

      if (!config.persona) {
        logger.log("No persona configured. Nothing to reset.");
        return;
      }

      delete config.persona;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      logger.success(
        "Persona removed. The default coding assistant will be used.",
      );
    });
}

function collectValues(value, previous) {
  return previous.concat([value]);
}
