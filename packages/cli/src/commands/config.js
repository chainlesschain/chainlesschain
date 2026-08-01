import chalk from "chalk";
import { existsSync } from "node:fs";
import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  resetConfig,
  saveConfig,
  loadUserConfig,
  setSecretConfigValue,
  backupConfigForMigration,
  withConfigLock,
} from "../lib/config-manager.js";
import { getConfigPath, getHomeDir } from "../lib/paths.js";
import logger from "../lib/logger.js";
import { listFeatures, setFeature, getFlagInfo } from "../lib/feature-flags.js";
import { executionBroker } from "../lib/process-execution-broker/index.js";
import {
  CONFIG_SCHEMA_VERSION,
  getConfigDescriptor,
  getConfigDescriptors,
  getConfigJsonSchema,
  isSecretConfigKey,
  migrateConfigDocument,
  validateConfigDocument,
} from "../lib/config-schema.js";
import {
  CONFIG_REDACTED,
  redactConfigObject,
  redactConfigValue,
} from "../lib/config-redaction.js";
import {
  ensurePrivateDirectory,
  inspectPrivatePaths,
  repairPrivatePaths,
} from "../lib/secure-fs.js";

export const _deps = {
  spawnSync: (...args) => executionBroker.spawnSync(...args),
  platform: () => process.platform,
};

/** Parse the conventional $EDITOR string without invoking a shell. */
export function parseEditorCommand(value) {
  const input = String(value || "").trim();
  if (!input) return [];
  const tokens = [];
  let token = "";
  let quote = null;
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        started = true;
      } else if (char === "\\" && input[index + 1] === quote) {
        token += quote;
        index += 1;
      } else {
        token += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || token) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    if (
      char === "\\" &&
      (input[index + 1] === '"' || input[index + 1] === "'")
    ) {
      token += input[index + 1];
      index += 1;
      started = true;
      continue;
    }
    token += char;
    started = true;
  }
  if (quote) throw new Error("EDITOR contains an unterminated quote");
  if (started || token) tokens.push(token);
  return tokens;
}

export function openConfigEditor(editor, configPath, deps = _deps) {
  const [file, ...editorArgs] = parseEditorCommand(editor);
  if (!file) throw new Error("EDITOR command is empty");
  return deps.spawnSync(file, [...editorArgs, configPath], {
    stdio: "inherit",
    origin: "config:editor",
    policy: "allow",
    scope: "config",
    shell: false,
  });
}

export async function readSecretInput(options = {}) {
  const stdin = options.stdin || process.stdin;
  if (stdin.isTTY) {
    const askPassword =
      options.askPassword || (await import("../lib/prompts.js")).askPassword;
    return String(await askPassword(options.message || "Secret value:"));
  }
  let value = "";
  stdin.setEncoding?.("utf8");
  for await (const chunk of stdin) value += chunk;
  // Drop only line endings introduced by piping/Enter. Spaces may be part of
  // the credential and must not be silently changed.
  return value.replace(/[\r\n]+$/, "");
}

function getNested(obj, key) {
  let current = obj;
  for (const part of String(key).split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function hasNested(obj, key) {
  let current = obj;
  for (const part of String(key).split(".")) {
    if (
      current == null ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function setNested(obj, key, value) {
  const parts = String(key).split(".");
  let current = obj;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current[parts[index]] ||= {};
  }
  current[parts.at(-1)] = value;
}

function recordUserProvenance(value, prefix, provenance, source) {
  if (prefix) {
    provenance[prefix] = {
      source,
      layer: "user",
      overridden: [],
      locked: false,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [name, child] of Object.entries(value)) {
    recordUserProvenance(
      child,
      prefix ? `${prefix}.${name}` : name,
      provenance,
      source,
    );
  }
}

/** Inspect, and optionally repair, the owner-only config storage contract. */
export function checkConfigStoragePermissions(options = {}) {
  const home = options.home || getHomeDir();
  const configPath = options.configPath || getConfigPath();
  const platform = options.platform || _deps.platform();
  const secureOptions = { platform, ...(options.secureOptions || {}) };
  const pathExists =
    options.existsSync || secureOptions.deps?.fs?.existsSync || existsSync;

  const definitions = [
    { name: "home", target: home, kind: "directory" },
    { name: "config", target: configPath, kind: "file" },
  ];
  const results = new Map();
  const existing = [];
  for (const definition of definitions) {
    let exists = false;
    try {
      exists = pathExists(definition.target);
    } catch (error) {
      results.set(definition.name, {
        ok: false,
        exists: false,
        platform,
        error: error.message,
      });
      continue;
    }
    if (!exists && options.fix && definition.kind === "directory") {
      try {
        ensurePrivateDirectory(definition.target, {
          ...secureOptions,
          failIfUnavailable: true,
        });
        results.set(definition.name, { ok: true, exists: true, platform });
      } catch (error) {
        results.set(definition.name, {
          ok: false,
          exists: false,
          platform,
          error: error.message,
        });
      }
      continue;
    }
    if (!exists) {
      results.set(definition.name, { ok: false, exists: false, platform });
      continue;
    }
    existing.push(definition);
  }

  if (existing.length > 0) {
    const targets = existing.map((entry) => entry.target);
    let inspected;
    try {
      inspected = options.fix
        ? repairPrivatePaths(targets, secureOptions)
        : inspectPrivatePaths(targets, secureOptions);
    } catch (error) {
      // A batch repair may partially succeed. Read back every target so the
      // report reflects durable post-fix state rather than a generic failure.
      inspected = inspectPrivatePaths(targets, secureOptions).map((entry) => ({
        ...entry,
        ...(entry.ok ? {} : { error: entry.error || error.message }),
      }));
    }
    for (let index = 0; index < existing.length; index += 1) {
      results.set(existing[index].name, inspected[index]);
    }
  }

  return {
    home: results.get("home"),
    config: results.get("config"),
  };
}

/** Secure config.json for an editor without parsing or rewriting it. */
export function prepareConfigForEdit(options = {}) {
  const configPath = options.configPath || getConfigPath();
  const pathExists = options.existsSync || existsSync;
  if (pathExists(configPath)) {
    const checkPermissions =
      options.checkPermissions || checkConfigStoragePermissions;
    const permissions = checkPermissions({
      fix: true,
      configPath,
      ...(options.home ? { home: options.home } : {}),
    });
    if (!permissions.home.ok || !permissions.config.ok) {
      throw new Error("Could not secure config.json before editing");
    }
  } else {
    const load = options.loadConfig || loadConfig;
    const save = options.saveConfig || saveConfig;
    save(load());
  }
  return configPath;
}

const PROVIDER_KEY_ENV = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  volcengine: "VOLCENGINE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  gemini: "GEMINI_API_KEY",
  kimi: "MOONSHOT_API_KEY",
  minimax: "MINIMAX_API_KEY",
  mistral: "MISTRAL_API_KEY",
});

/** Resolve the config layers used by CLI agent startup, with provenance. */
export async function resolveEffectiveConfig(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const raw = loadUserConfig();
  const config = loadConfig({ resolveSecrets: false });
  const provenance = {};
  let settingsLayer = {
    files: [],
    managedFile: null,
    environmentVariables: [],
    sandbox: null,
  };
  let settingsEnv = {};
  let settingsEnvSources = {};
  recordUserProvenance(raw, "", provenance, getConfigPath());
  for (const entry of getConfigDescriptors()) {
    if (!hasNested(raw, entry.key) && entry.default !== undefined) {
      provenance[entry.key] = {
        source: "built-in default",
        layer: "default",
        overridden: [],
        locked: false,
      };
    }
  }

  try {
    const imported = await import("../lib/settings-loader.cjs");
    const settings = imported.default || imported;
    const loaded = settings.loadSettingsConfig({ cwd, env });
    settingsEnv = loaded.env || {};
    settingsEnvSources = loaded.envSources || {};
    settingsLayer = {
      files: loaded.files || [],
      managedFile: loaded.managedFile || null,
      environmentVariables: Object.keys(settingsEnv).sort(),
      sandbox: redactConfigObject(loaded.sandbox),
    };
    if (loaded.model) {
      const previous = provenance["llm.model"]?.source;
      setNested(config, "llm.model", loaded.model);
      const modelSource =
        loaded.modelSource || loaded.files.at(-1) || "settings";
      provenance["llm.model"] = {
        source: modelSource,
        layer:
          loaded.managedFile && modelSource === loaded.managedFile
            ? "managed"
            : "settings",
        overridden: previous ? [previous] : [],
        locked: Boolean(
          loaded.managedFile && modelSource === loaded.managedFile,
        ),
      };
    }
  } catch (error) {
    provenance.$settings = {
      source: "settings",
      layer: "error",
      overridden: [],
      locked: false,
      error: error.message,
    };
  }

  const provider = config?.llm?.provider;
  const effectiveEnv = { ...env, ...settingsEnv };
  const envName = effectiveEnv.CC_API_KEY
    ? "CC_API_KEY"
    : PROVIDER_KEY_ENV[String(provider || "").toLowerCase()];
  if (envName && effectiveEnv[envName]) {
    const previous = provenance["llm.apiKey"]?.source;
    const settingsSource = settingsEnvSources[envName];
    setNested(config, "llm.apiKey", CONFIG_REDACTED);
    provenance["llm.apiKey"] = {
      source: settingsSource
        ? `${settingsSource}:env.${envName}`
        : `environment:${envName}`,
      layer:
        settingsSource && settingsSource === settingsLayer.managedFile
          ? "managed"
          : settingsSource
            ? "settings-environment"
            : "environment",
      overridden: previous ? [previous] : [],
      locked: Boolean(
        settingsSource && settingsSource === settingsLayer.managedFile,
      ),
    };
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    config: redactConfigObject(config),
    provenance,
    settings: settingsLayer,
  };
}

export function registerConfigCommand(program) {
  const cmd = program
    .command("config")
    .description("Manage ChainlessChain configuration");

  cmd
    .command("list")
    .description("Show all configuration values")
    .option("--json", "Output redacted JSON")
    .action((options) => {
      const config = redactConfigObject(loadConfig({ resolveSecrets: false }));
      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      logger.log(chalk.bold(`\n  Config: ${getConfigPath()}\n`));
      printConfig(config, "  ");
      logger.newline();
    });

  cmd
    .command("keys")
    .description("List the recognized configuration keys (with types/defaults)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const { describeConfigKeys } = await import("../lib/config-keys.js");
      const entries = describeConfigKeys();
      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      logger.log(chalk.bold("\n  Configuration keys\n"));
      logger.log(
        chalk.gray(
          "  Set with: cc config set <key> <value>   Get: cc config get <key>\n",
        ),
      );
      for (const e of entries) {
        const cur =
          e.current === undefined || e.current === null
            ? chalk.gray("(unset)")
            : typeof e.current === "object"
              ? chalk.gray(JSON.stringify(e.current))
              : chalk.green(String(e.current));
        logger.log(
          `  ${chalk.cyan(e.key)} ${chalk.gray(`<${e.type}>`)}  = ${cur}`,
        );
        if (e.description) logger.log(`      ${chalk.gray(e.description)}`);
      }
      logger.newline();
    });

  cmd
    .command("get")
    .description("Get a configuration value")
    .argument("<key>", "Config key (dot-notation, e.g. llm.provider)")
    .option("--json", "Output a redacted JSON envelope")
    .action((key, options) => {
      const value = getConfigValue(key, { resolveSecrets: false });
      if (value === undefined) {
        logger.error(`Key not found: ${key}`);
        process.exitCode = 1;
        return;
      }
      const redacted = redactConfigValue(key, value);
      if (options.json) {
        console.log(JSON.stringify({ key, value: redacted }, null, 2));
      } else if (typeof redacted === "object") {
        logger.log(JSON.stringify(redacted, null, 2));
      } else {
        logger.log(String(redacted));
      }
    });

  cmd
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Config key (dot-notation)")
    .argument("<value>", "Value to set")
    .option(
      "--allow-unknown",
      "Allow an unregistered key for extension development",
    )
    .action(async (key, value, options) => {
      if (isSecretConfigKey(key)) {
        logger.error(
          `Refusing a secret in argv for ${key}. Pipe it to "cc config set-secret ${key}" or use its hidden TTY prompt.`,
        );
        process.exitCode = 1;
        return;
      }
      setConfigValue(key, value, {
        allowUnknown: options.allowUnknown === true,
      });
      logger.success(`Set ${key}`);
      // Claude-Code parity: if the user just pinned a retired/deprecated model
      // id (llm.model / llm.visionModel / llm.fallbackModel), warn now — at pin
      // time — rather than only when a later run fails. stderr-only, vitest-safe.
      if (
        /(^|\.)(model|visionModel|fallbackModel)$/i.test(key) &&
        !process.env.VITEST &&
        !process.env.VITEST_WORKER_ID
      ) {
        try {
          const { maybeWarnDeprecatedModel } =
            await import("../lib/model-deprecation.js");
          maybeWarnDeprecatedModel({ model: value });
        } catch {
          /* fail-open: a deprecation notice must never affect the set */
        }
      }
    });

  cmd
    .command("set-secret")
    .description("Set a secret from a hidden TTY prompt or stdin (never argv)")
    .argument("<key>", "Schema-declared secret key")
    .option(
      "--storage <mode>",
      "Storage: auto (OS store then 0600 fallback), keychain, or file",
      "auto",
    )
    .action(async (key, options) => {
      if (!isSecretConfigKey(key)) {
        logger.error(`${key} is not a registered secret key`);
        process.exitCode = 1;
        return;
      }
      const value = await readSecretInput({
        message: `Secret value for ${key}:`,
      });
      if (!value) {
        logger.error("Secret input was empty; configuration was not changed");
        process.exitCode = 1;
        return;
      }
      const result = setSecretConfigValue(key, value, {
        storage: options.storage,
      });
      logger.success(
        `Set ${key} (${result.storage === "keychain" ? result.backend : "owner-only config file"})`,
      );
    });

  cmd
    .command("schema")
    .description("Print the versioned JSON Schema for config.json")
    .option("--json", "Output JSON (default)")
    .action(() => {
      console.log(JSON.stringify(getConfigJsonSchema(), null, 2));
    });

  cmd
    .command("validate")
    .description("Validate config.json types, keys and filesystem permissions")
    .option("--fix", "Apply safe migrations and owner-only permissions")
    .option("--allow-unknown", "Permit extension-development keys")
    .option("--json", "Output JSON")
    .action((options) => {
      const permissions = checkConfigStoragePermissions({
        fix: options.fix === true,
      });
      const inspectAndMaybeMigrate = () => {
        const raw = loadUserConfig({ failIfUnavailable: true });
        const migrated = migrateConfigDocument(raw);
        const validation = validateConfigDocument(
          options.fix ? migrated.config : raw,
          { allowUnknown: options.allowUnknown === true },
        );
        if (options.fix && migrated.migrations.length && validation.valid) {
          backupConfigForMigration(
            `.before-schema-v${CONFIG_SCHEMA_VERSION.split(".")[0]}`,
            { applyWindowsAcl: true, failIfUnavailable: true },
          );
          saveConfig(migrated.config);
        }
        return { migrated, validation };
      };
      // Re-read, migrate, back up and save under one cross-process lock. A
      // concurrent `config set` can therefore never be overwritten by a stale
      // pre-migration snapshot.
      const { migrated, validation } = options.fix
        ? withConfigLock(inspectAndMaybeMigrate)
        : inspectAndMaybeMigrate();
      const ok =
        validation.valid &&
        permissions.home.ok &&
        (!permissions.config.exists || permissions.config.ok);
      const result = {
        ok,
        ...validation,
        migrations: migrated.migrations,
        permissions,
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (ok) {
        logger.success(
          `Configuration is valid (schema ${CONFIG_SCHEMA_VERSION})`,
        );
      } else {
        for (const issue of validation.issues) logger.error(issue.message);
        if (!permissions.home.ok) logger.error("Config home is not owner-only");
        if (permissions.config.exists && !permissions.config.ok) {
          logger.error("config.json is not owner-only");
        }
      }
      if (!ok) process.exitCode = 1;
    });

  cmd
    .command("effective")
    .description("Show the redacted effective configuration and provenance")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await resolveEffectiveConfig();
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.log(
        chalk.bold(`\n  Effective config (schema ${result.schemaVersion})\n`),
      );
      printConfig(result.config, "  ");
      logger.newline();
    });

  cmd
    .command("explain")
    .description("Explain a key's type, redacted value, source and policy lock")
    .argument("<key>", "Known config key")
    .option("--json", "Output JSON")
    .action(async (key, options) => {
      const entry = getConfigDescriptor(key);
      if (!entry) {
        logger.error(`Unknown configuration key: ${key}`);
        process.exitCode = 1;
        return;
      }
      const effective = await resolveEffectiveConfig();
      const result = {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        key,
        type: entry.type,
        secret: entry.secret === true || isSecretConfigKey(key),
        scope: entry.scope,
        managedLock: entry.managedLock,
        deprecated: entry.deprecated === true,
        migration: entry.migration || null,
        value: redactConfigValue(key, getNested(effective.config, key)),
        provenance: effective.provenance[key] || {
          source: "unset",
          layer: "unset",
          overridden: [],
          locked: false,
        },
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.log(`${chalk.cyan(key)} = ${String(result.value ?? "(unset)")}`);
      logger.log(
        `  type: ${Array.isArray(result.type) ? result.type.join(" | ") : result.type}`,
      );
      logger.log(`  source: ${result.provenance.source}`);
      logger.log(
        `  policy lock: ${result.provenance.locked ? "managed" : "not locked"}`,
      );
      if (result.migration)
        logger.warn(`  deprecated; migrate to ${result.migration}`);
    });

  cmd
    .command("edit")
    .description("Open config file in default editor")
    .action(async () => {
      // Existing malformed JSON must reach the editor byte-for-byte; this only
      // repairs owner-only permissions. A missing file is created atomically.
      const configPath = prepareConfigForEdit();
      const editor =
        process.env.EDITOR ||
        process.env.VISUAL ||
        (process.platform === "win32" ? "notepad" : "vi");
      try {
        openConfigEditor(editor, configPath);
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

export function printConfig(obj, indent = "") {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      logger.log(`${indent}${chalk.cyan(key)}:`);
      printConfig(value, indent + "  ");
    } else {
      const displayValue = value === null ? chalk.gray("null") : String(value);
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
