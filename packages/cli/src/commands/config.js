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

// === Iter27 V2 governance overlay ===
export function registerScsgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "config");
  if (!parent) return;
  const L = async () => await import("../lib/session-core-singletons.js");
  parent
    .command("scsgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SCSGOV_PROFILE_MATURITY_V2,
            accessLifecycle: m.SCSGOV_ACCESS_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("scsgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveScsgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingScsgovAccesssPerProfileV2(),
            idleMs: m.getScsgovProfileIdleMsV2(),
            stuckMs: m.getScsgovAccessStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("scsgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveScsgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scsgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingScsgovAccesssPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scsgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setScsgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scsgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setScsgovAccessStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scsgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--component <v>", "component")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerScsgovProfileV2({ id, owner, component: o.component }),
          null,
          2,
        ),
      );
    });
  parent
    .command("scsgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateScsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scsgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleScsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scsgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveScsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scsgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchScsgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scsgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getScsgovProfileV2(id), null, 2));
    });
  parent
    .command("scsgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listScsgovProfilesV2(), null, 2));
    });
  parent
    .command("scsgov-create-access-v2 <id> <profileId>")
    .description("Create access")
    .option("--caller <v>", "caller")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createScsgovAccessV2({ id, profileId, caller: o.caller }),
          null,
          2,
        ),
      );
    });
  parent
    .command("scsgov-resolving-access-v2 <id>")
    .description("Mark access as resolving")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).resolvingScsgovAccessV2(id), null, 2),
      );
    });
  parent
    .command("scsgov-complete-access-v2 <id>")
    .description("Complete access")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeAccessScsgovV2(id), null, 2),
      );
    });
  parent
    .command("scsgov-fail-access-v2 <id> [reason]")
    .description("Fail access")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failScsgovAccessV2(id, reason), null, 2),
      );
    });
  parent
    .command("scsgov-cancel-access-v2 <id> [reason]")
    .description("Cancel access")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelScsgovAccessV2(id, reason), null, 2),
      );
    });
  parent
    .command("scsgov-get-access-v2 <id>")
    .description("Get access")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getScsgovAccessV2(id), null, 2));
    });
  parent
    .command("scsgov-list-accesss-v2")
    .description("List accesss")
    .action(async () => {
      console.log(JSON.stringify((await L()).listScsgovAccesssV2(), null, 2));
    });
  parent
    .command("scsgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleScsgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("scsgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck accesss")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckScsgovAccesssV2(), null, 2),
      );
    });
  parent
    .command("scsgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).getSessionCoreSingletonsGovStatsV2(),
          null,
          2,
        ),
      );
    });
}
