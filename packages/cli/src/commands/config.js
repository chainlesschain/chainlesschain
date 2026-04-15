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
import { listFeatures, setFeature, getFlagInfo } from "../lib/feature-flags.js";

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

  // ── Feature Flags ──────────────────────────────────────────────────

  const featuresCmd = cmd
    .command("features")
    .description("Manage feature flags");

  featuresCmd
    .command("list")
    .alias("ls")
    .description("Show all feature flags and their status")
    .action(() => {
      const flags = listFeatures();
      logger.log(chalk.bold("\n  Feature Flags\n"));
      for (const f of flags) {
        const status = f.enabled ? chalk.green("● ON ") : chalk.gray("○ OFF");
        const src = chalk.gray(`[${f.source}]`);
        logger.log(`  ${status} ${chalk.cyan(f.name)} ${src}`);
        logger.log(`         ${chalk.gray(f.description)}`);
      }
      logger.newline();
    });

  featuresCmd
    .command("enable")
    .description("Enable a feature flag")
    .argument("<name>", "Flag name (e.g. CONTEXT_SNIP)")
    .action((name) => {
      setFeature(name, true);
      const info = getFlagInfo(name);
      logger.success(`Enabled ${name}${info ? ` — ${info.description}` : ""}`);
    });

  featuresCmd
    .command("disable")
    .description("Disable a feature flag")
    .argument("<name>", "Flag name (e.g. CONTEXT_SNIP)")
    .action((name) => {
      setFeature(name, false);
      logger.success(`Disabled ${name}`);
    });

  // ── Reset ──────────────────────────────────────────────────────────

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

  // config beta — Managed Agents parity Phase E2 beta flags
  const beta = cmd
    .command("beta")
    .description("Manage beta / experimental feature flags");

  beta
    .command("list", { isDefault: true })
    .description("List enabled and known beta flags")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { getBetaFlags } =
          await import("../lib/session-core-singletons.js");
        const flags = await getBetaFlags();
        const out = flags.list();
        if (options.json) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        logger.log(chalk.bold("Enabled beta flags:"));
        if (out.enabled.length === 0) logger.log(chalk.gray("  (none)"));
        for (const f of out.enabled) logger.log(`  ${chalk.green("✓")} ${f}`);
        if (out.known.length > out.enabled.length) {
          const disabled = out.known.filter((f) => !out.enabled.includes(f));
          logger.log(chalk.bold("\nKnown (disabled):"));
          for (const f of disabled) logger.log(`  ${chalk.gray("·")} ${f}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  beta
    .command("enable")
    .description("Enable a beta flag (format: <feature>-<YYYY-MM-DD>)")
    .argument("<flag>")
    .action(async (flag) => {
      try {
        const { getBetaFlags } =
          await import("../lib/session-core-singletons.js");
        const flags = await getBetaFlags();
        flags.enable(flag);
        logger.success(`Enabled: ${chalk.cyan(flag)}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  beta
    .command("disable")
    .description("Disable a beta flag")
    .argument("<flag>")
    .action(async (flag) => {
      try {
        const { getBetaFlags } =
          await import("../lib/session-core-singletons.js");
        const flags = await getBetaFlags();
        flags.disable(flag);
        logger.success(`Disabled: ${chalk.cyan(flag)}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
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
