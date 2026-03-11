import chalk from "chalk";
import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  resetConfig,
  saveConfig,
} from "../lib/config-manager.js";
import { getConfigPath } from "../lib/paths.js";
import logger from "../lib/logger.js";

export function registerConfigCommand(program) {
  const cmd = program
    .command("config")
    .description("Manage ChainlessChain configuration");

  cmd
    .command("list")
    .description("Show all configuration values")
    .action(() => {
      const config = loadConfig();
      logger.log(chalk.bold(`\n  Config: ${getConfigPath()}\n`));
      printConfig(config, "  ");
      logger.newline();
    });

  cmd
    .command("get")
    .description("Get a configuration value")
    .argument("<key>", "Config key (dot-notation, e.g. llm.provider)")
    .action((key) => {
      const value = getConfigValue(key);
      if (value === undefined) {
        logger.error(`Key not found: ${key}`);
        process.exit(1);
      }
      if (typeof value === "object") {
        logger.log(JSON.stringify(value, null, 2));
      } else {
        logger.log(String(value));
      }
    });

  cmd
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Config key (dot-notation)")
    .argument("<value>", "Value to set")
    .action((key, value) => {
      setConfigValue(key, value);
      logger.success(`Set ${key} = ${value}`);
    });

  cmd
    .command("edit")
    .description("Open config file in default editor")
    .action(async () => {
      const configPath = getConfigPath();
      const editor =
        process.env.EDITOR ||
        process.env.VISUAL ||
        (process.platform === "win32" ? "notepad" : "vi");
      const { execSync } = await import("node:child_process");
      try {
        execSync(`${editor} "${configPath}"`, { stdio: "inherit" });
      } catch (err) {
        logger.error(`Failed to open editor: ${err.message}`);
        logger.info(`Config file is at: ${configPath}`);
      }
    });

  cmd
    .command("reset")
    .description("Reset configuration to defaults")
    .action(async () => {
      const { askConfirm } = await import("../lib/prompts.js");
      const confirmed = await askConfirm(
        "Reset all configuration to defaults?",
        false,
      );
      if (confirmed) {
        resetConfig();
        logger.success("Configuration reset to defaults");
      } else {
        logger.info("Reset cancelled");
      }
    });
}

function printConfig(obj, indent = "") {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      logger.log(`${indent}${chalk.cyan(key)}:`);
      printConfig(value, indent + "  ");
    } else {
      const displayValue =
        value === null
          ? chalk.gray("null")
          : key.toLowerCase().includes("key") && value
            ? chalk.yellow("****")
            : String(value);
      logger.log(`${indent}${chalk.cyan(key)}: ${displayValue}`);
    }
  }
}
