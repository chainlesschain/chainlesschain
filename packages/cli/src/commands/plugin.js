/**
 * Plugin management commands
 * chainlesschain plugin list|install|remove|enable|disable|update|info|search|registry|summary
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  enforcePluginPolicy,
  loadPluginManagedPolicy,
  verifyPluginManifest,
} from "../lib/plugin-security.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  installPlugin,
  getPlugin,
  listPlugins,
  enablePlugin,
  disablePlugin,
  removePlugin,
  updatePlugin,
  getPluginSettings,
  searchRegistry,
  listRegistry,
  getPluginSummary,
  installPluginSkills,
  removePluginSkills,
  getPluginSkills,
} from "../harness/plugin-manager.js";

function collectRepeatableOption(value, previous = []) {
  return [...previous, value];
}

async function buildRegistryInstallPreflight(url, resolved, cwd) {
  const { discoverPlugins } = await import("../lib/plugin-runtime/scopes.js");
  const { VERSION } = await import("../constants.js");
  const { buildPluginMarketplaceInstallPreflight } =
    await import("../lib/plugin-runtime/marketplace-catalog.js");
  const installed = {};
  try {
    for (const row of discoverPlugins({ cwd, skipPolicy: true })) {
      installed[row.name] = row.version;
    }
  } catch {
    /* an empty inventory conservatively leaves declared dependencies missing */
  }
  return buildPluginMarketplaceInstallPreflight({
    registryUrl: url,
    entry: resolved.entry,
    fromCache: resolved.fromCache === true,
    installed,
    hostVersion: VERSION,
  }).preflight;
}

function catalogAuthorityFromPreflight(preflight, impact = null) {
  return {
    catalogDigest: preflight.catalogDigest,
    candidateId: preflight.candidateId,
    candidateDigest: preflight.candidateDigest,
    governanceStatus: preflight.governance.status,
    registryStatus: preflight.registry.status,
    versionAuthority: preflight.versionAuthority,
    ...(impact ? { updateImpactDigest: impact.impactDigest } : {}),
  };
}

function marketplacePreflightBlockerMessage(preflight) {
  return preflight.blockers
    .map((blocker) =>
      blocker.detail ? `${blocker.code} (${blocker.detail})` : blocker.code,
    )
    .join(", ");
}

async function installedCatalogAuthorityMatches(
  name,
  scope,
  cwd,
  preflight,
  impact = null,
) {
  if (!preflight) return null;
  try {
    const { listInstalled } = await import("../lib/plugin-runtime/install.js");
    const installed = listInstalled({ cwd, scopes: [scope] }).find(
      (row) => row.name === name && row.scope === scope,
    );
    const authority = installed?.source?.catalogAuthority;
    return (
      authority?.catalogDigest === preflight.catalogDigest &&
      authority?.candidateId === preflight.candidateId &&
      authority?.candidateDigest === preflight.candidateDigest &&
      (!impact || authority?.updateImpactDigest === impact.impactDigest) &&
      authority?.preflightStatus === "allowed"
    );
  } catch {
    return false;
  }
}

async function buildInstalledMarketplaceSnapshot(name, scope, cwd) {
  const { listInstalled } = await import("../lib/plugin-runtime/install.js");
  const { discoverPlugins } = await import("../lib/plugin-runtime/scopes.js");
  const row = listInstalled({ cwd, scopes: [scope] }).find(
    (candidate) => candidate.name === name && candidate.scope === scope,
  );
  if (!row) return null;
  const discovered = discoverPlugins({
    cwd,
    scopes: [scope],
    skipPolicy: true,
    includeDisabled: true,
  }).find((candidate) => candidate.name === name && candidate.scope === scope);
  let dependencies = {};
  if (discovered?.manifest?.manifestPath) {
    try {
      const fs = await import("node:fs");
      const raw = JSON.parse(
        fs.readFileSync(discovered.manifest.manifestPath, "utf8"),
      );
      if (
        raw.dependencies &&
        typeof raw.dependencies === "object" &&
        !Array.isArray(raw.dependencies)
      ) {
        dependencies = Object.fromEntries(
          Object.entries(raw.dependencies).filter(
            ([dependency]) => dependency !== "host" && dependency !== "cc",
          ),
        );
      }
    } catch {
      dependencies = {};
    }
  }
  return {
    name: row.name,
    version: row.version,
    scope: row.scope,
    source: row.source,
    integrity: row.integrity,
    license: {
      expression: discovered?.manifest?.metadata?.license || null,
    },
    capabilities: discovered?.manifest?.capabilities || null,
    dependencies,
  };
}

async function buildRegistryUpdateImpact(preflight, name, scope, cwd) {
  const { buildPluginMarketplaceUpdateImpact } =
    await import("../lib/plugin-runtime/marketplace-impact.js");
  const installed = await buildInstalledMarketplaceSnapshot(name, scope, cwd);
  return buildPluginMarketplaceUpdateImpact({ preflight, installed });
}

/**
 * After an install/upgrade, resolve the just-installed plugin's DECLARED
 * capabilities and its current consent status, so `cc plugin add`/`upgrade`
 * surface a capability list + diff and tell the user when a WIDENING requires
 * re-consent (mirroring `cc plugin consent`). Best-effort: capability rendering
 * must never fail an otherwise-successful install. Returns a structured summary
 * (for --json folding) or null when the plugin declares nothing / can't be
 * resolved.
 */
async function resolvePluginCapabilityNotice(
  name,
  scope,
  cwd,
  { strict = false } = {},
) {
  try {
    const { discoverPlugins } = await import("../lib/plugin-runtime/scopes.js");
    const { describeCapabilities } =
      await import("../lib/plugin-runtime/capabilities.js");
    const consent = await import("../lib/plugin-runtime/capability-consent.js");
    const installed = discoverPlugins({ cwd, skipPolicy: true }).find(
      (p) => p.name === name && p.scope === scope,
    );
    if (!installed) {
      if (strict) {
        throw new Error(`${name} is not discoverable at ${scope} scope`);
      }
      return null;
    }
    const declared = installed.manifest?.capabilities;
    if (!declared || consent.capabilitiesAreEmpty(declared)) return null;
    const entry = consent.loadConsentStore()[`${scope}:${name}`] || null;
    const status = consent.capabilityConsentStatus(declared, entry);
    return {
      declared: describeCapabilities(declared),
      consented: status.consented,
      reason: status.reason,
      added: status.added,
    };
  } catch (error) {
    if (strict) {
      throw new Error(
        `installed plugin capability validation failed: ${error.message}`,
      );
    }
    return null; // capability rendering is advisory — never break an install
  }
}

/**
 * Print the capability notice (text mode) after an install/upgrade. Pass
 * `{ hint: false }` to omit the trailing `cc plugin consent … --grant` pointer
 * when consent is being granted inline (explicit flag or interactive prompt).
 */
function printPluginCapabilityNotice(name, notice, { hint = true } = {}) {
  if (!notice) return;
  logger.log(chalk.bold("\nCapabilities (declared):"));
  for (const l of notice.declared) logger.log(`  ${chalk.magenta(l)}`);
  if (notice.consented) {
    logger.log(chalk.gray(`  capability consent: ${notice.reason}`));
    return;
  }
  logger.log(
    chalk.yellow(`  ⚠ capability consent required (${notice.reason})`),
  );
  if (notice.added.length)
    logger.log(chalk.yellow(`    new: ${notice.added.join(", ")}`));
  if (hint)
    logger.log(
      chalk.dim(`    run \`cc plugin consent ${name} --grant\` to allow them`),
    );
}

/**
 * Unified install-command audit for the Plugin-Bin install path (P0 sandbox
 * slice): the same opt-in trail (CC_INSTALL_AUDIT / settings installPolicy)
 * that records run_shell installs and run_code auto-installs also records
 * plugin installs — a plugin ships executable components (bin/hooks/LSP/MCP),
 * so `cc plugin add` IS "fetch and run third-party code". Best-effort and
 * opt-in: with the policy off (the default) this writes nothing and the
 * install result is untouched.
 */
async function auditPluginInstall(action, res, installSource, capNotice) {
  try {
    const icp = await import("../lib/install-command-policy.js");
    const policy = icp.resolveInstallPolicy({});
    if (!policy.audit) return;
    icp.recordInstallCommandAudit({
      source: "plugin_install",
      action, // "add" | "upgrade"
      install: icp.classifyPluginInstall({
        name: res.name,
        version: res.version,
        scope: res.scope,
        source:
          (typeof res.source === "string" && res.source) ||
          (typeof installSource === "string" ? installSource : null),
        capabilities: capNotice?.declared || null,
      }),
      signatureVerified: res.signatureVerified === true,
    });
  } catch {
    /* the unified audit must never affect the install itself */
  }
}

/**
 * Record consent for a freshly installed/upgraded plugin's currently-declared
 * capabilities (re-discovers to get the raw declared set + version). Best-effort
 * — returns false rather than throwing so it can never break an install.
 */
async function grantInstalledPluginCapabilities(name, scope, cwd) {
  try {
    const { discoverPlugins } = await import("../lib/plugin-runtime/scopes.js");
    const consent = await import("../lib/plugin-runtime/capability-consent.js");
    const installed = discoverPlugins({ cwd, skipPolicy: true }).find(
      (p) => p.name === name && p.scope === scope,
    );
    if (!installed) return false;
    const declared = installed.manifest?.capabilities;
    if (!declared || consent.capabilitiesAreEmpty(declared)) return false;
    consent.consentPluginCapabilities(name, {
      scope,
      version: installed.version,
      capabilities: declared,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle the capability-consent gate after a text-mode install/upgrade: print
 * the notice and, when consent is required, either auto-grant (explicit
 * `--grant-capabilities`) or block interactively (TTY) to grant it right away
 * instead of forcing a separate `cc plugin consent --grant` step. Returns true
 * if consent was recorded during this call.
 */
async function applyCapabilityConsentGate(name, scope, notice, cwd, opts = {}) {
  const consent = await import("../lib/plugin-runtime/capability-consent.js");
  const action = consent.resolveConsentAction(notice, {
    grant: opts.grant === true,
    interactive: opts.interactive === true,
  });
  if (action === "advisory") {
    printPluginCapabilityNotice(name, notice);
    return false;
  }
  // Show the ⚠ notice + new-capability diff before deciding; suppress the
  // "run cc plugin consent" pointer since we grant inline here.
  printPluginCapabilityNotice(name, notice, { hint: false });
  if (action === "prompt") {
    let ok = false;
    try {
      const { confirm } = await import("@inquirer/prompts");
      ok = await confirm({
        message: `Grant these capabilities to ${name} now?`,
        default: false,
      });
    } catch {
      ok = false; // Ctrl-C / non-interactive → treat as decline (fail closed)
    }
    if (!ok) {
      logger.log(
        chalk.dim(
          "    capabilities not granted — components needing them stay disabled",
        ),
      );
      return false;
    }
  }
  const granted = await grantInstalledPluginCapabilities(name, scope, cwd);
  if (granted) logger.success(`  ✔ capability consent granted for ${name}`);
  return granted;
}

export function registerPluginCommand(program) {
  const plugin = program
    .command("plugin")
    .description("Plugin and marketplace management");

  // plugin list
  plugin
    .command("list", { isDefault: true })
    .description("List installed plugins")
    .option("--enabled", "Show only enabled plugins")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const plugins = listPlugins(db, { enabledOnly: options.enabled });

        if (options.json) {
          console.log(
            JSON.stringify(
              plugins.map((p) => ({
                name: p.name,
                version: p.version,
                enabled: p.enabled === 1,
                status: p.status,
              })),
              null,
              2,
            ),
          );
        } else if (plugins.length === 0) {
          logger.info(
            'No plugins installed. Install one with "chainlesschain plugin install <name>"',
          );
        } else {
          logger.log(chalk.bold(`Plugins (${plugins.length}):\n`));
          for (const p of plugins) {
            const status = p.enabled
              ? chalk.green("enabled")
              : chalk.gray("disabled");
            logger.log(`  ${chalk.cyan(p.name)} v${p.version} [${status}]`);
            if (p.description) logger.log(`    ${chalk.gray(p.description)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin install
  plugin
    .command("install")
    .description("Install a plugin")
    .argument("<name>", "Plugin name")
    .option("--version <version>", "Plugin version", "1.0.0")
    .option("--description <desc>", "Plugin description")
    .option("--author <author>", "Plugin author")
    .option("--manifest <path>", "Plugin manifest file with skill declarations")
    .option("--source <source>", "Plugin source or marketplace identifier")
    .option("--sha256 <hex>", "Expected SHA-256 of the manifest")
    .option("--signature <path>", "Detached Ed25519 signature of the manifest")
    .option("--public-key <path>", "PEM public key used to verify --signature")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const managed = loadPluginManagedPolicy();
        enforcePluginPolicy(
          { name, source: options.source, action: "install" },
          managed,
        );
        let verifiedManifest = null;
        let parsedManifest = null;
        if (options.manifest || managed?.requireSignedPlugins) {
          verifiedManifest = verifyPluginManifest({
            manifestFile: options.manifest,
            expectedSha256: options.sha256,
            signatureFile: options.signature,
            publicKeyFile: options.publicKey,
            requireSignature: managed?.requireSignedPlugins === true,
            trustedKeySha256: managed?.trustedPluginKeySha256,
            requireTrustedKey: managed?.requireSignedPlugins === true,
          });
          parsedManifest = JSON.parse(verifiedManifest.bytes.toString("utf8"));
        }
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = installPlugin(db, {
          name,
          version: options.version,
          description: options.description,
          author: options.author,
        });

        // Install plugin skills if manifest provided
        let skillResult = { installed: [] };
        if (options.manifest) {
          try {
            const fs = await import("fs");
            const manifest =
              parsedManifest ||
              JSON.parse(fs.readFileSync(options.manifest, "utf-8"));
            if (manifest.skills && manifest.skills.length > 0) {
              const path = await import("path");
              const pluginPath = path.dirname(path.resolve(options.manifest));
              skillResult = installPluginSkills(
                db,
                name,
                pluginPath,
                manifest.skills,
              );
            }
          } catch (err) {
            logger.warn(`Could not install plugin skills: ${err.message}`);
          }
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ...result,
                skills: skillResult.installed,
                integrity: verifiedManifest
                  ? {
                      sha256: verifiedManifest.sha256,
                      signatureVerified: verifiedManifest.signatureVerified,
                      publicKeySha256: verifiedManifest.publicKeySha256,
                    }
                  : null,
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(`Plugin installed: ${result.name} v${result.version}`);
          if (skillResult.installed.length > 0) {
            logger.info(
              `Skills installed: ${skillResult.installed.join(", ")}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin remove
  plugin
    .command("remove")
    .description("Remove a plugin")
    .argument("<name>", "Plugin name")
    .option("--force", "Skip confirmation")
    .action(async (name, options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Remove plugin "${name}"?`,
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        // Remove plugin skills first
        const skillResult = removePluginSkills(db, name);
        const ok = removePlugin(db, name);

        if (ok) {
          logger.success(`Plugin removed: ${name}`);
          if (skillResult.removed.length > 0) {
            logger.info(`Skills removed: ${skillResult.removed.join(", ")}`);
          }
        } else {
          logger.error(`Plugin not found: ${name}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin enable
  plugin
    .command("enable")
    .description("Enable a plugin")
    .argument("<name>", "Plugin name")
    .option(
      "--scope <scope>",
      "Enable the unified-runtime install at this scope (user|project|local)",
    )
    .option("--json", "Output unified-runtime result as JSON")
    .action(async (name, options) => {
      try {
        if (options.scope) {
          const { setPluginEnabled } =
            await import("../lib/plugin-runtime/install.js");
          const result = setPluginEnabled(name, true, {
            scope: options.scope,
            cwd: process.cwd(),
          });
          if (options.json) console.log(JSON.stringify(result, null, 2));
          else {
            logger.success(
              `Enabled ${name} (${options.scope} scope). Reload active plugin sessions to apply the change.`,
            );
          }
          return;
        }
        enforcePluginPolicy(
          { name, action: "enable" },
          loadPluginManagedPolicy(),
        );
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = enablePlugin(db, name);

        if (ok) {
          logger.success(`Plugin enabled: ${name}`);
        } else {
          logger.error(`Plugin not found: ${name}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin disable
  plugin
    .command("disable")
    .description("Disable a plugin")
    .argument("<name>", "Plugin name")
    .option(
      "--scope <scope>",
      "Disable the unified-runtime install at this scope (user|project|local)",
    )
    .option("--json", "Output unified-runtime result as JSON")
    .action(async (name, options) => {
      try {
        if (options.scope) {
          const { setPluginEnabled } =
            await import("../lib/plugin-runtime/install.js");
          const result = setPluginEnabled(name, false, {
            scope: options.scope,
            cwd: process.cwd(),
          });
          if (options.json) console.log(JSON.stringify(result, null, 2));
          else {
            logger.success(
              `Disabled ${name} (${options.scope} scope). Reload active plugin sessions to apply the change.`,
            );
          }
          return;
        }
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = disablePlugin(db, name);

        if (ok) {
          logger.success(`Plugin disabled: ${name}`);
        } else {
          logger.error(`Plugin not found: ${name}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin update
  plugin
    .command("update")
    .description("Update a plugin version")
    .argument("<name>", "Plugin name")
    .argument("<version>", "New version")
    .action(async (name, version) => {
      try {
        enforcePluginPolicy(
          { name, action: "update" },
          loadPluginManagedPolicy(),
        );
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = updatePlugin(db, name, version);

        if (ok) {
          logger.success(`Plugin updated: ${name} → v${version}`);
        } else {
          logger.error(`Plugin not found: ${name}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin info
  plugin
    .command("info")
    .description("Show plugin details")
    .argument("<name>", "Plugin name")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const p = getPlugin(db, name);

        if (!p) {
          logger.error(`Plugin not found: ${name}`);
          process.exit(1);
        }

        const settings = getPluginSettings(db, name);
        const skills = getPluginSkills(db, name);

        if (options.json) {
          console.log(JSON.stringify({ ...p, settings, skills }, null, 2));
        } else {
          logger.log(chalk.bold("Plugin Info:\n"));
          logger.log(`  ${chalk.bold("Name:")}        ${chalk.cyan(p.name)}`);
          logger.log(`  ${chalk.bold("Version:")}     ${p.version}`);
          logger.log(
            `  ${chalk.bold("Description:")} ${p.description || chalk.gray("(none)")}`,
          );
          logger.log(
            `  ${chalk.bold("Author:")}      ${p.author || chalk.gray("(unknown)")}`,
          );
          logger.log(
            `  ${chalk.bold("Enabled:")}     ${p.enabled ? chalk.green("yes") : chalk.red("no")}`,
          );
          logger.log(`  ${chalk.bold("Installed:")}   ${p.installed_at}`);

          if (skills.length > 0) {
            logger.log(`\n  ${chalk.bold("Skills:")}`);
            for (const sk of skills) {
              logger.log(
                `    ${chalk.cyan(sk.skill_name)} → ${chalk.gray(sk.skill_path)}`,
              );
            }
          }

          if (Object.keys(settings).length > 0) {
            logger.log(`\n  ${chalk.bold("Settings:")}`);
            for (const [k, v] of Object.entries(settings)) {
              logger.log(`    ${k}: ${v}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin search
  plugin
    .command("search")
    .description("Search plugin registry")
    .argument("<query>", "Search query")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const results = searchRegistry(db, query);

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info(`No plugins found for "${query}"`);
        } else {
          logger.log(chalk.bold(`Registry Results (${results.length}):\n`));
          for (const r of results) {
            logger.log(`  ${chalk.cyan(r.name)} v${r.latest_version}`);
            if (r.description) logger.log(`    ${chalk.gray(r.description)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin registry
  plugin
    .command("registry")
    .description("List all plugins in registry")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const registry = listRegistry(db);

        if (options.json) {
          console.log(JSON.stringify(registry, null, 2));
        } else if (registry.length === 0) {
          logger.info("Registry is empty");
        } else {
          logger.log(chalk.bold(`Plugin Registry (${registry.length}):\n`));
          for (const r of registry) {
            logger.log(
              `  ${chalk.cyan(r.name)} v${r.latest_version} - ${r.description || ""}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin summary
  plugin
    .command("summary")
    .description("Show plugin summary statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const summary = getPluginSummary(db);

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          logger.log(chalk.bold("Plugin Summary:\n"));
          logger.log(`  ${chalk.bold("Installed:")} ${summary.installed}`);
          logger.log(`  ${chalk.bold("Enabled:")}   ${summary.enabled}`);
          logger.log(`  ${chalk.bold("Registry:")}  ${summary.registryCount}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // plugin validate — parse a plugin's unified manifest and report every
  // component it contributes (skills/agents/hooks/mcp/lsp/monitors/bin/settings),
  // plus path-traversal / schema problems. Optional signature/hash verification
  // reuses the real crypto in plugin-security. No DB, no install — pure inspection.
  plugin
    .command("validate <dir>")
    .description("Validate a plugin manifest and list its components")
    .option("--sha256 <hex>", "Expected SHA-256 of the manifest file")
    .option("--signature <path>", "Detached Ed25519 signature of the manifest")
    .option("--public-key <path>", "Public key for signature verification")
    .option("--json", "Output as JSON")
    .action(async (dir, options) => {
      const { parsePluginManifest, summarizeComponents } =
        await import("../lib/plugin-runtime/manifest.js");
      const manifest = parsePluginManifest(dir);

      // Optional integrity/signature check on the manifest file itself.
      // verifyPluginManifest THROWS on any mismatch/failure and returns a
      // details object on success — so a caught error means verification failed.
      let verification = null;
      if (manifest.manifestPath && (options.sha256 || options.signature)) {
        try {
          const v = verifyPluginManifest({
            manifestFile: manifest.manifestPath,
            expectedSha256: options.sha256,
            signatureFile: options.signature,
            publicKeyFile: options.publicKey,
          });
          verification = {
            ok: true,
            sha256: v?.sha256 || null,
            signatureVerified: v?.signatureVerified === true,
          };
        } catch (err) {
          verification = { ok: false, reason: err.message };
          manifest.ok = false;
          manifest.errors.push(`manifest verification failed: ${err.message}`);
        }
      }

      const counts = summarizeComponents(manifest);

      // Dependency version constraints (gap P2#13): if the manifest declares
      // `dependencies` (plugin name → semver range, plus reserved host/cc),
      // check them against what's installed and the running cc version. Unmet
      // deps are surfaced but do not by themselves fail structural validation —
      // they may simply be absent in this environment.
      let dependencyCheck = null;
      try {
        const rawManifest = manifest.manifestPath
          ? JSON.parse(
              (await import("node:fs")).readFileSync(
                manifest.manifestPath,
                "utf8",
              ),
            )
          : {};
        if (rawManifest && rawManifest.dependencies) {
          const { checkPluginDependencies, formatDependencyIssues } =
            await import("../lib/plugin-runtime/governance.js");
          const { discoverPlugins } =
            await import("../lib/plugin-runtime/scopes.js");
          const { VERSION } = await import("../constants.js");
          const installed = {};
          try {
            for (const p of discoverPlugins({ skipPolicy: true })) {
              installed[p.name] = p.version;
            }
          } catch {
            /* discovery best-effort */
          }
          const result = checkPluginDependencies(rawManifest, {
            installed,
            hostVersion: VERSION,
          });
          dependencyCheck = {
            ok: result.ok,
            issues: formatDependencyIssues(
              manifest.metadata?.name || dir,
              result,
            ),
            ...result,
          };
        }
      } catch {
        /* dependency inspection is best-effort */
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ...manifest,
              componentCounts: counts,
              verification,
              dependencyCheck,
            },
            null,
            2,
          ),
        );
        if (!manifest.ok) process.exitCode = 1;
        return;
      }

      const m = manifest.metadata || {};
      logger.log(
        chalk.bold(`Plugin: `) +
          `${chalk.cyan(m.name || "(no name)")} ${chalk.gray("v" + (m.version || "?"))}`,
      );
      if (m.description) logger.log(chalk.gray("  " + m.description));
      logger.log(
        chalk.gray(`  manifest: ${manifest.manifestPath || "(none)"}`),
      );
      logger.log(chalk.bold("\nComponents:"));
      for (const [kind, n] of Object.entries(counts)) {
        const mark = n > 0 ? chalk.green(String(n)) : chalk.gray("0");
        logger.log(`  ${kind.padEnd(10)} ${mark}`);
      }
      if (verification) {
        logger.log(
          chalk.bold("\nVerification: ") +
            (verification.ok ? chalk.green("passed") : chalk.red("FAILED")),
        );
      }
      if (dependencyCheck) {
        logger.log(
          chalk.bold("\nDependencies: ") +
            (dependencyCheck.ok
              ? chalk.green("satisfied")
              : chalk.yellow("unmet")),
        );
        for (const issue of dependencyCheck.issues) {
          logger.log(chalk.yellow(`  ⚠ ${issue}`));
        }
      }
      // Declared capabilities (Phase 3 gap): show what the plugin says it needs
      // so a user can compare against the components it ships (the audit findings
      // for an under-declared manifest already surface in manifest.warnings).
      if (manifest.capabilitiesDeclared) {
        const { describeCapabilities } =
          await import("../lib/plugin-runtime/capabilities.js");
        const capLines = describeCapabilities(manifest.capabilities);
        logger.log(chalk.bold("\nCapabilities (declared):"));
        if (capLines.length === 0) logger.log(chalk.gray("  (none)"));
        for (const l of capLines) logger.log(`  ${chalk.magenta(l)}`);
      }
      for (const w of manifest.warnings) logger.log(chalk.yellow(`  ⚠ ${w}`));
      for (const e of manifest.errors) logger.log(chalk.red(`  ✖ ${e}`));
      if (manifest.ok) {
        logger.success("\nManifest is valid.");
      } else {
        logger.error("\nManifest is INVALID.");
        process.exitCode = 1;
      }
    });

  // ── unified plugin runtime install lifecycle (Phase 3) ──
  // These operate on the scope version dirs (user/project/local), independent
  // of the legacy DB-backed `install/list/remove` above. A plugin installed
  // here has its skills/hooks/lsp components picked up by the agent.

  const SCOPES = "user|project|local";

  // plugin add <source> — install from a local dir, git URL, owner/repo, or a
  // remote registry/manifest URL (with --name to pick from a multi-plugin index)
  plugin
    .command("add <source>")
    .description(
      `Install a plugin from a local dir, git URL, owner/repo[#ref], or registry URL (scope: ${SCOPES})`,
    )
    .option("--scope <scope>", "Install scope (user|project|local)", "user")
    .option("--force", "Reinstall over an existing immutable version")
    .option("--sha256 <hex>", "Expected SHA-256 of the manifest file")
    .option("--signature <path>", "Detached Ed25519 signature of the manifest")
    .option("--public-key <path>", "Public key for signature verification")
    .option(
      "--registry <url>",
      "Resolve <source> as a plugin NAME in this registry URL",
    )
    .option(
      "--name <plugin>",
      "Plugin name to select from a multi-plugin registry",
    )
    .option("--token <token>", "Bearer token for a private registry")
    .option(
      "--allow-insecure-registry",
      "Allow a plain-HTTP registry URL (MITM risk — trusted networks only)",
    )
    .option(
      "--grant-capabilities",
      "Grant the plugin's declared capabilities at install time (no separate consent step)",
    )
    .option("--json", "Output as JSON")
    .action(async (source, options) => {
      const { installFromSource, setPluginEnabled } =
        await import("../lib/plugin-runtime/install.js");

      // Remote resolution: a registry/manifest URL (or --registry <url> with a
      // plugin name) resolves to a git source the installer already handles.
      let installSource = source;
      let integritySha = null;
      let sourceMetadata = null;
      let expectedIdentity = null;
      let marketplacePreflight = null;
      const { isRemoteSource, resolveRemoteSource } =
        await import("../lib/plugin-runtime/remote-source.js");
      if (options.registry || isRemoteSource(source)) {
        const url = options.registry || source;
        // With --registry the positional arg is the plugin NAME; otherwise the
        // URL is positional and --name selects.
        const name = options.registry ? source : options.name;
        let config = null;
        try {
          ({ loadConfig: config } = await import("../lib/config-manager.js"));
          config = config();
        } catch {
          config = null; // config is optional — token can come from --token/env
        }
        try {
          const resolved = await resolveRemoteSource(url, {
            name,
            token: options.token,
            config,
            allowInsecure: options.allowInsecureRegistry === true,
          });
          installSource = resolved.source;
          integritySha = resolved.sha256;
          marketplacePreflight = await buildRegistryInstallPreflight(
            url,
            resolved,
            process.cwd(),
          );
          if (marketplacePreflight.status !== "allowed") {
            throw new Error(
              `registry candidate preflight blocked: ${marketplacePreflightBlockerMessage(marketplacePreflight)}`,
            );
          }
          expectedIdentity = {
            name:
              typeof resolved.entry.name === "string"
                ? resolved.entry.name
                : null,
            version:
              marketplacePreflight.versionAuthority ===
              "registry-declared-unverified"
                ? marketplacePreflight.registryVersion
                : null,
          };
          sourceMetadata = {
            type: "registry",
            source: url,
            registry: url,
            package: name || source,
            resolvedSource: resolved.source,
            ref:
              (typeof resolved.source === "string" &&
                resolved.source.includes("#") &&
                resolved.source.slice(resolved.source.indexOf("#") + 1)) ||
              null,
            offline: resolved.fromCache === true,
            catalogAuthority:
              catalogAuthorityFromPreflight(marketplacePreflight),
          };
          if (resolved.fromCache) {
            logger.warn(
              chalk.yellow(
                "  ⚠ registry unreachable — using cached copy (offline)",
              ),
            );
          }
        } catch (err) {
          logger.error(`Registry resolution failed: ${err.message}`);
          process.exitCode = 1;
          return;
        }
      }

      let managed = null;
      try {
        managed = loadPluginManagedPolicy();
      } catch (err) {
        logger.error(`Managed plugin policy is invalid: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      const requiresManagedSignature =
        managed?.requireSignedPlugins === true ||
        managed?.requireSignedPlugins === "require";
      const signature =
        options.sha256 ||
        options.signature ||
        options.publicKey ||
        integritySha ||
        requiresManagedSignature
          ? {
              sha256: options.sha256 || integritySha,
              signatureFile: options.signature,
              publicKeyFile: options.publicKey,
              requireSignature:
                Boolean(options.signature) || requiresManagedSignature,
              trustedKeySha256: managed?.trustedPluginKeySha256 || null,
              requireTrustedKey: requiresManagedSignature,
            }
          : null;
      try {
        const res = installFromSource(installSource, {
          scope: options.scope,
          cwd: process.cwd(),
          force: options.force === true,
          signature,
          sourceMetadata,
          expectedIdentity,
          managedPolicy: managed,
          policySource: options.registry || source,
        });
        const marketplaceAuthorityPersisted = marketplacePreflight
          ? res.sourceMetadata?.catalogAuthority?.catalogDigest ===
              marketplacePreflight.catalogDigest &&
            res.sourceMetadata?.catalogAuthority?.candidateId ===
              marketplacePreflight.candidateId &&
            res.sourceMetadata?.catalogAuthority?.candidateDigest ===
              marketplacePreflight.candidateDigest
          : null;
        if (marketplacePreflight && !marketplaceAuthorityPersisted) {
          setPluginEnabled(res.name, false, {
            scope: res.scope,
            cwd: process.cwd(),
            reason: "marketplace catalog authority persistence failed",
          });
          throw new Error(
            "installed plugin was disabled because marketplace catalog authority was not persisted",
          );
        }
        const capNotice = await resolvePluginCapabilityNotice(
          res.name,
          res.scope,
          process.cwd(),
        );
        await auditPluginInstall("add", res, installSource, capNotice);
        if (options.json) {
          // Non-interactive JSON path: honor an explicit --grant-capabilities so
          // scripted installs can consent atomically; never prompt.
          let capabilitiesGranted = false;
          if (options.grantCapabilities && capNotice && !capNotice.consented)
            capabilitiesGranted = await grantInstalledPluginCapabilities(
              res.name,
              res.scope,
              process.cwd(),
            );
          console.log(
            JSON.stringify(
              {
                ...res,
                marketplacePreflight,
                marketplaceAuthorityPersisted,
                capabilities: capNotice,
                capabilitiesGranted,
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `Installed ${res.name} v${res.version} (${res.scope} scope)` +
              (res.signatureVerified ? chalk.green(" ✔ signed") : ""),
          );
          logger.log(chalk.gray(`  → ${res.dir}`));
          if (marketplacePreflight) {
            logger.log(
              chalk.gray(
                `  catalog: ${marketplacePreflight.catalogDigest} (${marketplacePreflight.governance.status}; authority persisted)`,
              ),
            );
            if (marketplacePreflight.governance.missing.length) {
              logger.log(
                chalk.yellow(
                  `  ⚠ registry governance metadata missing: ${marketplacePreflight.governance.missing.join(", ")}`,
                ),
              );
            }
          }
          for (const w of res.warnings || [])
            logger.log(chalk.yellow(`  ⚠ ${w}`));
          await applyCapabilityConsentGate(
            res.name,
            res.scope,
            capNotice,
            process.cwd(),
            {
              grant: options.grantCapabilities === true,
              interactive: Boolean(process.stdin.isTTY),
            },
          );
        }
      } catch (err) {
        logger.error(`Install failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // plugin browse — browse the plugins offered by a remote registry (discovery)
  plugin
    .command("browse [query]")
    .description(
      "List plugins in a remote registry (--registry <url>); filter by [query]",
    )
    .requiredOption("--registry <url>", "Registry/manifest URL to browse")
    .option("--token <token>", "Bearer token for a private registry")
    .option(
      "--allow-insecure-registry",
      "Allow a plain-HTTP registry URL (MITM risk — trusted networks only)",
    )
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      const { fetchRegistry, listRegistryPlugins, resolveRegistryToken } =
        await import("../lib/plugin-runtime/remote-source.js");
      let config = null;
      try {
        const cm = await import("../lib/config-manager.js");
        config = cm.loadConfig();
      } catch {
        config = null;
      }
      try {
        const token = resolveRegistryToken(options.registry, {
          token: options.token,
          config,
        });
        const { registry, fromCache } = await fetchRegistry(options.registry, {
          token,
          allowInsecure: options.allowInsecureRegistry === true,
        });
        let rows = listRegistryPlugins(registry);
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              (r.description || "").toLowerCase().includes(q),
          );
        }
        if (options.json) {
          console.log(JSON.stringify({ fromCache, plugins: rows }, null, 2));
          return;
        }
        if (fromCache) {
          logger.warn(
            chalk.yellow(
              "  ⚠ registry unreachable — showing cached copy (offline)",
            ),
          );
        }
        if (rows.length === 0) {
          logger.info("No matching plugins in this registry.");
          return;
        }
        logger.log(chalk.bold(`Plugins (${rows.length}):`));
        for (const r of rows) {
          const ver = r.version ? chalk.gray(` v${r.version}`) : "";
          logger.log(
            `  ${chalk.cyan(r.name)}${ver}  ${chalk.gray(r.description || r.source)}`,
          );
        }
        logger.log(
          chalk.gray(
            `\nInstall with: cc plugin add <name> --registry ${options.registry}`,
          ),
        );
      } catch (err) {
        logger.error(`Registry search failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // plugin catalog — merge one or more registries into a bounded, versioned
  // governance projection. Registry assertions remain explicitly unverified;
  // signature/SBOM verification still happens only after bytes are fetched.
  plugin
    .command("catalog [query]")
    .description(
      "Review digest, signature, SBOM, license, capability, dependency, and health metadata across registries",
    )
    .option(
      "--registry <url>",
      "Registry URL to include (repeatable; earlier sources have higher priority)",
      collectRepeatableOption,
      [],
    )
    .option("--token <token>", "Bearer token for private registries")
    .option(
      "--allow-insecure-registry",
      "Allow plain-HTTP registry URLs (MITM risk — trusted networks only)",
    )
    .option(
      "--strict",
      "Block candidates missing digest, signature, SBOM, license, or capabilities",
    )
    .option("--json", "Output the versioned catalog projection as JSON")
    .action(async (query, options) => {
      const registryUrls = Array.isArray(options.registry)
        ? options.registry
        : [];
      if (registryUrls.length === 0) {
        logger.error("At least one --registry <url> is required");
        process.exitCode = 1;
        return;
      }

      const { fetchRegistry, resolveRegistryToken } =
        await import("../lib/plugin-runtime/remote-source.js");
      const { buildPluginMarketplaceCatalog, MAX_MARKETPLACE_CATALOG_SOURCES } =
        await import("../lib/plugin-runtime/marketplace-catalog.js");
      if (registryUrls.length > MAX_MARKETPLACE_CATALOG_SOURCES) {
        logger.error(
          `At most ${MAX_MARKETPLACE_CATALOG_SOURCES} --registry sources are allowed`,
        );
        process.exitCode = 1;
        return;
      }
      const { discoverPlugins } =
        await import("../lib/plugin-runtime/scopes.js");
      const { VERSION } = await import("../constants.js");
      let config = null;
      try {
        const cm = await import("../lib/config-manager.js");
        config = cm.loadConfig();
      } catch {
        config = null;
      }

      const sources = await Promise.all(
        registryUrls.map(async (url) => {
          try {
            const token = resolveRegistryToken(url, {
              token: options.token,
              config,
            });
            const resolved = await fetchRegistry(url, {
              token,
              allowInsecure: options.allowInsecureRegistry === true,
            });
            return { url, ...resolved };
          } catch (error) {
            return {
              url,
              error: {
                code: "REGISTRY_FETCH_FAILED",
                message: error.message,
              },
            };
          }
        }),
      );

      const installed = {};
      try {
        for (const pluginRow of discoverPlugins({
          cwd: process.cwd(),
          skipPolicy: true,
        })) {
          installed[pluginRow.name] = pluginRow.version;
        }
      } catch {
        /* dependency projection stays conservative with an empty inventory */
      }

      const catalog = buildPluginMarketplaceCatalog({
        sources,
        installed,
        hostVersion: VERSION,
        query,
        strict: options.strict === true,
      });
      if (options.json) {
        console.log(JSON.stringify(catalog, null, 2));
      } else {
        logger.log(
          chalk.bold(
            `Marketplace candidates (${catalog.summary.candidateCount}) — ${catalog.mode}`,
          ),
        );
        for (const source of catalog.sources) {
          const mark =
            source.status === "online"
              ? chalk.green("online")
              : source.status === "cached"
                ? chalk.yellow("cached")
                : chalk.red("unavailable");
          logger.log(
            `  source ${chalk.cyan(source.sourceId)} [${mark}] ${source.url}`,
          );
          if (source.error) {
            logger.log(
              chalk.red(`    ${source.error.code}: ${source.error.message}`),
            );
          }
        }
        for (const candidate of catalog.candidates) {
          const allowed =
            candidate.installability.status === "allowed"
              ? chalk.green("allowed")
              : chalk.red("blocked");
          logger.log(
            `\n  ${chalk.cyan(candidate.name)} v${candidate.version || "?"} [${allowed}]`,
          );
          logger.log(
            `    source: ${candidate.registry.sourceId} → ${candidate.package.source || "missing"}${candidate.package.ref ? `#${candidate.package.ref}` : ""}`,
          );
          logger.log(
            `    digest (${candidate.integrity.digest.subject}): ${candidate.integrity.digest.status}${candidate.integrity.digest.value ? ` sha256:${candidate.integrity.digest.value}` : ""}`,
          );
          logger.log(
            `    signature: ${candidate.integrity.signature.status} (${candidate.integrity.signature.verification})`,
          );
          logger.log(
            `    SBOM: ${candidate.integrity.sbom.status} (${candidate.integrity.sbom.verification})`,
          );
          logger.log(
            `    license: ${candidate.license.expression || candidate.license.status}`,
          );
          logger.log(
            `    capabilities: ${candidate.capabilities.declared ? candidate.capabilities.summary.join("; ") || "declared none" : "missing"}`,
          );
          logger.log(
            `    compatibility: ${candidate.compatibility.status}${candidate.compatibility.range ? ` (${candidate.compatibility.range})` : ""}; dependencies: ${candidate.dependencies.status}; health: ${candidate.health.status}`,
          );
          if (candidate.installability.blockers.length) {
            logger.log(
              chalk.red(
                `    blockers: ${candidate.installability.blockers.map((item) => item.code).join(", ")}`,
              ),
            );
          }
          if (candidate.governance.missing.length) {
            logger.log(
              chalk.yellow(
                `    missing governance metadata: ${candidate.governance.missing.join(", ")}`,
              ),
            );
          }
        }
        logger.log(
          chalk.gray(
            `\nCatalog ${catalog.catalogDigest}; registry metadata is unverified until install/load verification.`,
          ),
        );
      }

      if (catalog.summary.availableSourceCount === 0) {
        process.exitCode = 1;
      } else if (
        options.strict &&
        (catalog.summary.unavailableSourceCount > 0 ||
          catalog.summary.blockedCandidateCount > 0 ||
          catalog.summary.incompleteCandidateCount > 0)
      ) {
        process.exitCode = 2;
      }
    });

  // plugin impact — compare one registry candidate with the active immutable
  // install before upgrade. This never clones or executes candidate bytes.
  plugin
    .command("impact <name>")
    .description(
      "Preview version, source, integrity, license, capability, and dependency impact before a registry upgrade",
    )
    .requiredOption("--registry <url>", "Registry URL containing the candidate")
    .option("--scope <scope>", "Installed plugin scope", "user")
    .option("--token <token>", "Bearer token for a private registry")
    .option(
      "--allow-insecure-registry",
      "Allow a plain-HTTP registry URL (MITM risk — trusted networks only)",
    )
    .option("--json", "Output the versioned update-impact projection as JSON")
    .action(async (name, options) => {
      const { resolveRemoteSource } =
        await import("../lib/plugin-runtime/remote-source.js");
      let config = null;
      try {
        const cm = await import("../lib/config-manager.js");
        config = cm.loadConfig();
      } catch {
        config = null;
      }
      try {
        const resolved = await resolveRemoteSource(options.registry, {
          name,
          token: options.token,
          config,
          allowInsecure: options.allowInsecureRegistry === true,
        });
        const preflight = await buildRegistryInstallPreflight(
          options.registry,
          resolved,
          process.cwd(),
        );
        const impact = await buildRegistryUpdateImpact(
          preflight,
          name,
          options.scope,
          process.cwd(),
        );
        if (options.json) {
          console.log(JSON.stringify(impact, null, 2));
        } else {
          logger.log(
            chalk.bold(
              `${name}: ${impact.status} (${impact.changeCount} material changes)`,
            ),
          );
          logger.log(
            `  version: ${impact.changes.version.from || "not installed"} → ${impact.changes.version.to || "manifest-deferred"} [${impact.changes.version.kind}]`,
          );
          logger.log(
            `  source: ${impact.changes.source.kind}${impact.changes.source.requiresApproval ? " (explicit approval required)" : ""}`,
          );
          logger.log(
            `  license: ${impact.changes.license.from || "unknown"} → ${impact.changes.license.to || "unknown"}`,
          );
          logger.log(
            `  capabilities: +${impact.changes.capabilities.added.join(", ") || "none"}; -${impact.changes.capabilities.removed.join(", ") || "none"}`,
          );
          logger.log(
            `  dependencies: +${impact.changes.dependencies.added.length} / -${impact.changes.dependencies.removed.length} / changed ${impact.changes.dependencies.changed.length}`,
          );
          if (impact.blockers.length) {
            logger.log(
              chalk.red(
                `  blockers: ${impact.blockers.map((blocker) => blocker.code).join(", ")}`,
              ),
            );
          }
          if (impact.requiredApprovals.length) {
            logger.log(
              chalk.yellow(
                `  approvals: ${impact.requiredApprovals.map((approval) => approval.code).join(", ")}`,
              ),
            );
          }
          logger.log(chalk.gray(`  impact digest: ${impact.impactDigest}`));
          logger.log(
            chalk.gray(
              "  Candidate registry metadata is unverified; no candidate bytes were fetched or executed.",
            ),
          );
        }
        if (impact.status === "blocked") process.exitCode = 2;
      } catch (error) {
        logger.error(`Marketplace impact failed: ${error.message}`);
        process.exitCode = 1;
      }
    });

  // plugin installed — list runtime-installed plugins across scopes
  plugin
    .command("installed")
    .description("List plugins installed in the unified runtime (scope dirs)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const { listInstalled } =
        await import("../lib/plugin-runtime/install.js");
      const rows = listInstalled({ cwd: process.cwd() });
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        logger.info("No plugins installed. Add one with: cc plugin add <dir>");
        return;
      }
      const { isPluginTrusted } =
        await import("../lib/plugin-runtime/trust.js");
      logger.log(chalk.bold(`Installed plugins (${rows.length}):`));
      for (const r of rows) {
        const ok = r.ok ? chalk.green("✔") : chalk.red("✖");
        const trust = isPluginTrusted(r)
          ? chalk.green("trusted")
          : chalk.yellow("untrusted");
        const state =
          r.enabled === false
            ? chalk.yellow("disabled")
            : chalk.green("enabled");
        const signed = r.integrity?.signature?.verified
          ? chalk.green("signed")
          : chalk.gray("unsigned");
        const policy =
          r.policy?.allowed === false
            ? chalk.red("policy-blocked")
            : r.policy?.managed
              ? chalk.cyan("managed")
              : "";
        logger.log(
          `  ${ok} ${chalk.cyan(r.name)} v${r.version} ${chalk.gray(`[${r.scope}]`)} ${state} ${trust} ${signed}${policy ? ` ${policy}` : ""}`,
        );
      }
    });

  // plugin trust <name> — allow a plugin's code-bearing components to run
  plugin
    .command("trust <name>")
    .description("Trust a plugin so its hooks / LSP servers may run")
    .option("--scope <scope>", "Scope of the plugin", "project")
    .option("--list", "List all trusted plugins instead")
    .action(async (name, options) => {
      const { trustPlugin, listTrust } =
        await import("../lib/plugin-runtime/trust.js");
      const { getActiveVersion } =
        await import("../lib/plugin-runtime/install.js");
      if (options.list) {
        for (const t of listTrust()) {
          logger.log(`  ${chalk.cyan(t.name)} v${t.version} [${t.scope}]`);
        }
        return;
      }
      const version = getActiveVersion(name, {
        scope: options.scope,
        cwd: process.cwd(),
      });
      if (!version) {
        logger.error(`${name} is not installed at ${options.scope} scope`);
        process.exitCode = 1;
        return;
      }
      trustPlugin(name, { scope: options.scope, version });
      logger.success(`Trusted ${name} v${version} (${options.scope} scope)`);
    });

  // plugin untrust <name> — revoke trust
  plugin
    .command("untrust <name>")
    .description(
      "Revoke trust for a plugin (its hooks / LSP servers stop running)",
    )
    .option("--scope <scope>", "Scope of the plugin", "project")
    .action(async (name, options) => {
      const { untrustPlugin } = await import("../lib/plugin-runtime/trust.js");
      const res = untrustPlugin(name, { scope: options.scope });
      if (res.removed) {
        logger.success(`Revoked trust for ${name} (${options.scope} scope)`);
      } else {
        logger.info(`${name} was not trusted at ${options.scope} scope`);
      }
    });

  // plugin consent [name] — view / grant a plugin's CAPABILITY consent
  // (process / network / filesystem / mcp / monitor / credential). Distinct from
  // `trust`, which pins the code VERSION: consent pins the capability SET, and
  // any widening re-prompts even for an already-trusted plugin.
  plugin
    .command("consent [name]")
    .description(
      "View or grant a plugin's capability consent (--grant / --revoke / --list)",
    )
    .option("--scope <scope>", "Scope of the plugin", "project")
    .option(
      "--grant",
      "Grant consent for the plugin's currently-declared capabilities",
    )
    .option("--revoke", "Revoke capability consent")
    .option("--list", "List all capability consent entries")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const consent =
        await import("../lib/plugin-runtime/capability-consent.js");
      const { describeCapabilities } =
        await import("../lib/plugin-runtime/capabilities.js");

      if (!name || options.list) {
        const rows = consent.listCapabilityConsent();
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          logger.info("No capability consent recorded.");
          return;
        }
        logger.log(chalk.bold(`Capability consent (${rows.length}):`));
        for (const r of rows) {
          logger.log(`  ${chalk.cyan(r.name)} v${r.version} [${r.scope}]`);
          for (const c of r.capabilities) logger.log(`    ${chalk.magenta(c)}`);
        }
        return;
      }

      if (options.revoke) {
        const res = consent.revokeCapabilityConsent(name, {
          scope: options.scope,
        });
        if (res.removed) {
          logger.success(
            `Revoked capability consent for ${name} (${options.scope} scope)`,
          );
        } else {
          logger.info(
            `${name} had no capability consent at ${options.scope} scope`,
          );
        }
        return;
      }

      // Resolve the installed plugin + its declared capabilities.
      const { discoverPlugins } =
        await import("../lib/plugin-runtime/scopes.js");
      let installed = null;
      try {
        installed = discoverPlugins({
          cwd: process.cwd(),
          skipPolicy: true,
        }).find((p) => p.name === name && p.scope === options.scope);
      } catch {
        /* discovery best-effort */
      }
      if (!installed) {
        logger.error(`${name} is not installed at ${options.scope} scope`);
        process.exitCode = 1;
        return;
      }
      const declared = installed.manifest?.capabilities;
      const entry =
        consent.loadConsentStore()[`${options.scope}:${name}`] || null;
      const status = consent.capabilityConsentStatus(declared, entry);

      if (options.grant) {
        consent.consentPluginCapabilities(name, {
          scope: options.scope,
          version: installed.version,
          capabilities: declared,
        });
        const capLines = describeCapabilities(declared);
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                granted: true,
                name,
                scope: options.scope,
                version: installed.version,
                capabilities: capLines,
              },
              null,
              2,
            ),
          );
          return;
        }
        logger.success(
          `Granted capability consent for ${name} v${installed.version} (${options.scope} scope)`,
        );
        for (const l of capLines) logger.log(`    ${chalk.magenta(l)}`);
        return;
      }

      // Show status.
      const capLines = describeCapabilities(declared);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              name,
              scope: options.scope,
              version: installed.version,
              declared: capLines,
              ...status,
            },
            null,
            2,
          ),
        );
        return;
      }
      logger.log(
        chalk.bold("Capability consent: ") +
          `${chalk.cyan(name)} v${installed.version} [${options.scope}]`,
      );
      logger.log(chalk.bold("Declared capabilities:"));
      if (capLines.length === 0) logger.log(chalk.gray("  (none)"));
      for (const l of capLines) logger.log(`  ${chalk.magenta(l)}`);
      logger.log(
        chalk.bold("Status: ") +
          (status.consented
            ? chalk.green("consented")
            : chalk.yellow("NEEDS CONSENT")),
      );
      logger.log(chalk.gray(`  ${status.reason}`));
      if (status.added.length) {
        logger.log(
          chalk.yellow(`  new since consent: ${status.added.join(", ")}`),
        );
      }
      if (!status.consented) {
        logger.log(
          chalk.dim(
            `  run \`cc plugin consent ${name} --grant\` to allow them`,
          ),
        );
      }
    });

  // plugin options — view a plugin's resolved typed options, or set
  // non-sensitive values at a scope. Sensitive values are rejected on this
  // argv-based surface because process arguments and shell history are not a
  // credential transport.
  plugin
    .command("options <name>")
    .description(
      "View or set a plugin's typed options (--set key=value, --scope user|project)",
    )
    .option("--scope <scope>", "Scope for --set (user|project)", "user")
    .option(
      "--set <pair>",
      "Set a non-sensitive option value (key=value); repeatable",
      (v, acc) => {
        acc.push(v);
        return acc;
      },
      [],
    )
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const { discoverPlugins } =
        await import("../lib/plugin-runtime/scopes.js");
      const optsMod = await import("../lib/plugin-runtime/plugin-options.js");

      let installed = null;
      try {
        installed = discoverPlugins({
          cwd: process.cwd(),
          skipPolicy: true,
        }).find((p) => p.name === name);
      } catch {
        /* discovery best-effort */
      }
      if (!installed) {
        logger.error(`${name} is not installed`);
        process.exitCode = 1;
        return;
      }
      const schema = installed.manifest?.optionsSchema || {};

      // --set: persist values at the requested scope (then fall through to show).
      if (options.set && options.set.length) {
        const scope = options.scope === "project" ? "project" : "user";
        const updates = Object.create(null);
        for (const pair of options.set) {
          const eq = pair.indexOf("=");
          if (eq <= 0) {
            logger.error("Invalid --set value (expected key=value)");
            process.exitCode = 1;
            return;
          }
          const key = pair.slice(0, eq);
          const descriptor = Object.prototype.hasOwnProperty.call(schema, key)
            ? schema[key]
            : null;
          if (descriptor?.sensitive) {
            logger.error(
              `Sensitive option "${key}" cannot be supplied via --set because command-line arguments are observable`,
            );
            process.exitCode = 1;
            return;
          }
          updates[key] = pair.slice(eq + 1);
        }
        optsMod.patchPluginOptionValues(name, updates, scope, {
          cwd: process.cwd(),
          schema,
        });
        logger.success(`Set option(s) for ${name} at ${scope} scope`);
      }

      const resolved = optsMod.getResolvedPluginOptions(name, schema, {
        cwd: process.cwd(),
      });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              name,
              scope: installed.scope,
              options: resolved.redacted,
              sources: resolved.sources,
              warnings: resolved.warnings,
              droppedFromProject: resolved.droppedFromProject,
            },
            null,
            2,
          ),
        );
        return;
      }
      logger.log(chalk.bold(`Options: ${chalk.cyan(name)}`));
      const keys = Object.keys(resolved.redacted);
      if (keys.length === 0) logger.log(chalk.gray("  (no options)"));
      for (const k of keys) {
        logger.log(
          `  ${chalk.cyan(k)} = ${resolved.redacted[k]} ${chalk.gray(
            `[${resolved.sources[k] || "default"}]`,
          )}`,
        );
      }
      if (resolved.droppedFromProject.length) {
        logger.log(
          chalk.yellow(
            `  ⚠ dropped from project config (sensitive/user-only): ${resolved.droppedFromProject.join(
              ", ",
            )} — set with --scope user`,
          ),
        );
      }
      for (const w of resolved.warnings) logger.log(chalk.gray(`  ${w}`));
    });

  // plugin monitors — list (and optionally run) trusted plugins' background
  // monitors. `--run --seconds N` actually starts the supervisor for N seconds,
  // prints captured output, then reaps everything (verifies no leaked process).
  plugin
    .command("monitors")
    .description("List installed plugins' background monitors (trusted only)")
    .option("--json", "Output as JSON")
    .option("--run", "Actually run the monitors for a few seconds, then reap")
    .option("--seconds <n>", "With --run: how long to run", "3")
    .action(async (options) => {
      const { collectPluginMonitors } =
        await import("../lib/plugin-runtime/monitors.js");
      const monitors = collectPluginMonitors({ cwd: process.cwd() });
      if (options.json && !options.run) {
        console.log(JSON.stringify(monitors, null, 2));
        return;
      }
      if (monitors.length === 0) {
        logger.info(
          "No monitors from trusted plugins. (Untrusted project plugins are skipped — `cc plugin trust <name>`.)",
        );
        return;
      }
      logger.log(chalk.bold(`Plugin monitors (${monitors.length}):`));
      for (const m of monitors) {
        const cadence =
          m.mode === "interval"
            ? `every ${m.intervalMs || 60000}ms`
            : "long-running";
        logger.log(
          `  ${chalk.cyan(m.id)} ${chalk.gray(`[${m.scope}]`)} ${m.command} ${m.args.join(" ")} ${chalk.gray(`(${cadence})`)}`,
        );
      }
      if (!options.run) return;

      const { PluginMonitorSupervisor } =
        await import("../lib/plugin-monitor-supervisor.js");
      const secs = Math.max(1, parseInt(options.seconds, 10) || 3);
      const sup = new PluginMonitorSupervisor();
      const started = sup.start(monitors);
      logger.log(
        chalk.gray(`\nRunning ${started.length} monitor(s) for ${secs}s…`),
      );
      await new Promise((r) => setTimeout(r, secs * 1000));
      const out = sup.drainOutputs();
      sup.stopAll();
      logger.log(chalk.bold(`Captured ${out.length} output line(s):`));
      for (const rec of out.slice(0, 50)) {
        logger.log(
          `  ${chalk.gray(`[${rec.monitor}/${rec.stream}]`)} ${rec.line}`,
        );
      }
      logger.success("Monitors reaped — no process left running.");
    });

  // plugin uninstall <name> — remove a plugin (or one version) from a scope
  plugin
    .command("uninstall <name>")
    .description(`Uninstall a runtime plugin from a scope (${SCOPES})`)
    .option("--scope <scope>", "Scope to remove from", "user")
    .option("--version <version>", "Remove only this version (default: all)")
    .action(async (name, options) => {
      const { uninstall } = await import("../lib/plugin-runtime/install.js");
      try {
        const res = uninstall(name, {
          scope: options.scope,
          cwd: process.cwd(),
          version: options.version,
        });
        logger.success(
          `Uninstalled ${name} (${res.removed.join(", ") || "nothing"}) from ${options.scope} scope`,
        );
      } catch (err) {
        logger.error(`Uninstall failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // plugin upgrade <source> — re-fetch a source and install its newer version
  plugin
    .command("upgrade <source>")
    .description(
      "Update a runtime plugin from its pinned local, git, or registry source; repoints .active",
    )
    .option("--scope <scope>", `Scope to update in (${SCOPES})`, "user")
    .option("--force", "Reinstall even if the version is unchanged")
    .option("--sha256 <hex>", "Expected SHA-256 of the manifest file")
    .option("--signature <path>", "Detached Ed25519 signature of the manifest")
    .option("--public-key <path>", "Public key for signature verification")
    .option(
      "--registry <url>",
      "Resolve <source> as a plugin NAME in this registry URL",
    )
    .option(
      "--name <plugin>",
      "Plugin name to select from a multi-plugin registry",
    )
    .option("--token <token>", "Bearer token for a private registry")
    .option(
      "--allow-insecure-registry",
      "Allow a plain-HTTP registry URL (MITM risk — trusted networks only)",
    )
    .option(
      "--allow-source-switch",
      "Explicitly approve changing registry/source authority",
    )
    .option("--allow-downgrade", "Explicitly approve a version downgrade")
    .option(
      "--expected-impact-digest <sha256>",
      "Require the exact digest from a prior `cc plugin impact` review",
    )
    .option(
      "--grant-capabilities",
      "Grant any newly declared capabilities during the upgrade (no separate consent step)",
    )
    .option("--json", "Output as JSON")
    .action(async (source, options) => {
      const { updatePlugin, finalizePluginUpdate, rollbackPluginUpdate } =
        await import("../lib/plugin-runtime/install.js");
      let installSource = source;
      let integritySha = null;
      let sourceMetadata = null;
      let expectedIdentity = null;
      let marketplacePreflight = null;
      let marketplaceImpact = null;
      const { isRemoteSource, resolveRemoteSource } =
        await import("../lib/plugin-runtime/remote-source.js");
      if (options.registry || isRemoteSource(source)) {
        const url = options.registry || source;
        const name = options.registry ? source : options.name;
        let config = null;
        try {
          const cm = await import("../lib/config-manager.js");
          config = cm.loadConfig();
        } catch {
          config = null;
        }
        try {
          const resolved = await resolveRemoteSource(url, {
            name,
            token: options.token,
            config,
            allowInsecure: options.allowInsecureRegistry === true,
          });
          installSource = resolved.source;
          integritySha = resolved.sha256;
          marketplacePreflight = await buildRegistryInstallPreflight(
            url,
            resolved,
            process.cwd(),
          );
          if (marketplacePreflight.status !== "allowed") {
            throw new Error(
              `registry candidate preflight blocked: ${marketplacePreflightBlockerMessage(marketplacePreflight)}`,
            );
          }
          marketplaceImpact = await buildRegistryUpdateImpact(
            marketplacePreflight,
            resolved.entry.name,
            options.scope,
            process.cwd(),
          );
          if (
            marketplaceImpact.changes.source.requiresApproval &&
            options.allowSourceSwitch !== true
          ) {
            throw new Error(
              `registry candidate preflight blocked: SOURCE_SWITCH_APPROVAL_REQUIRED (${marketplaceImpact.changes.source.kind}); pass --allow-source-switch after reviewing cc plugin impact`,
            );
          }
          if (
            marketplaceImpact.changes.version.kind === "downgrade" &&
            options.allowDowngrade !== true
          ) {
            throw new Error(
              "registry candidate preflight blocked: VERSION_DOWNGRADE_APPROVAL_REQUIRED; pass --allow-downgrade after reviewing cc plugin impact",
            );
          }
          if (
            options.expectedImpactDigest &&
            !/^[a-f0-9]{64}$/.test(options.expectedImpactDigest)
          ) {
            throw new Error(
              "registry candidate preflight blocked: INVALID_EXPECTED_IMPACT_DIGEST",
            );
          }
          if (
            options.expectedImpactDigest &&
            options.expectedImpactDigest !== marketplaceImpact.impactDigest
          ) {
            throw new Error(
              `registry candidate preflight blocked: UPDATE_IMPACT_DIGEST_MISMATCH (expected ${options.expectedImpactDigest}, actual ${marketplaceImpact.impactDigest})`,
            );
          }
          expectedIdentity = {
            name:
              typeof resolved.entry.name === "string"
                ? resolved.entry.name
                : null,
            version:
              marketplacePreflight.versionAuthority ===
              "registry-declared-unverified"
                ? marketplacePreflight.registryVersion
                : null,
          };
          sourceMetadata = {
            type: "registry",
            source: url,
            registry: url,
            package: name || source,
            resolvedSource: resolved.source,
            ref:
              (typeof resolved.source === "string" &&
                resolved.source.includes("#") &&
                resolved.source.slice(resolved.source.indexOf("#") + 1)) ||
              null,
            offline: resolved.fromCache === true,
            catalogAuthority: catalogAuthorityFromPreflight(
              marketplacePreflight,
              marketplaceImpact,
            ),
          };
          if (resolved.fromCache && !options.json) {
            logger.warn(
              chalk.yellow(
                "  ⚠ registry unreachable — using cached copy (offline)",
              ),
            );
          }
        } catch (err) {
          logger.error(`Registry resolution failed: ${err.message}`);
          process.exitCode = 1;
          return;
        }
      }

      let managed = null;
      try {
        managed = loadPluginManagedPolicy();
      } catch (err) {
        logger.error(`Managed plugin policy is invalid: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      const requiresManagedSignature =
        managed?.requireSignedPlugins === true ||
        managed?.requireSignedPlugins === "require";
      const signature =
        options.sha256 ||
        options.signature ||
        options.publicKey ||
        integritySha ||
        requiresManagedSignature
          ? {
              sha256: options.sha256 || integritySha,
              signatureFile: options.signature,
              publicKeyFile: options.publicKey,
              requireSignature:
                Boolean(options.signature) || requiresManagedSignature,
              trustedKeySha256: managed?.trustedPluginKeySha256 || null,
              requireTrustedKey: requiresManagedSignature,
            }
          : null;
      let res = null;
      let marketplaceAuthorityPersisted = null;
      try {
        res = updatePlugin(installSource, {
          scope: options.scope,
          cwd: process.cwd(),
          force: options.force,
          signature,
          sourceMetadata,
          expectedIdentity,
          managedPolicy: managed,
          policySource: options.registry || source,
          transactional: true,
        });
        marketplaceAuthorityPersisted = await installedCatalogAuthorityMatches(
          res.name,
          options.scope,
          process.cwd(),
          marketplacePreflight,
          marketplaceImpact,
        );
        if (marketplacePreflight && !marketplaceAuthorityPersisted) {
          throw new Error(
            "registry candidate matched existing immutable bytes without the exact catalog authority; retry with --force to verify and persist this source",
          );
        }
        const upgradeNotice = await resolvePluginCapabilityNotice(
          res.name,
          options.scope,
          process.cwd(),
          { strict: true },
        );
        if (res.updated || res.reinstalled)
          await auditPluginInstall(
            "upgrade",
            { ...res, scope: options.scope },
            installSource,
            upgradeNotice,
          );

        let capabilitiesGranted = false;
        if (options.json) {
          if (options.grantCapabilities && upgradeNotice?.consented === false) {
            capabilitiesGranted = await grantInstalledPluginCapabilities(
              res.name,
              options.scope,
              process.cwd(),
            );
          }
        } else {
          capabilitiesGranted = await applyCapabilityConsentGate(
            res.name,
            options.scope,
            upgradeNotice,
            process.cwd(),
            {
              grant: options.grantCapabilities === true,
              interactive: Boolean(process.stdin.isTTY),
            },
          );
        }

        const changed = res.updated || res.reinstalled;
        const consentBlocked =
          changed &&
          upgradeNotice?.consented === false &&
          capabilitiesGranted !== true;
        const rollbackReason = consentBlocked
          ? options.grantCapabilities
            ? "capability_consent_failed"
            : "capability_consent_required"
          : null;
        let activationStatus = changed ? "activated" : "unchanged";
        let rollbackVersion = null;
        let cleanupPending = false;
        if (rollbackReason) {
          const recovery = rollbackPluginUpdate(res);
          if (!recovery.rolledBack) {
            throw new Error("upgrade rollback transaction was unavailable");
          }
          activationStatus = "rolled_back";
          rollbackVersion = recovery.version;
          marketplaceAuthorityPersisted =
            await installedCatalogAuthorityMatches(
              res.name,
              options.scope,
              process.cwd(),
              marketplacePreflight,
              marketplaceImpact,
            );
        } else {
          cleanupPending = finalizePluginUpdate(res).cleanupPending === true;
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ...res,
                scope: options.scope,
                marketplacePreflight,
                marketplaceImpact,
                marketplaceAuthorityPersisted,
                capabilities: upgradeNotice,
                capabilitiesGranted,
                activationStatus,
                rollbackVersion,
                rollbackReason,
                cleanupPending,
              },
              null,
              2,
            ),
          );
          return;
        }

        if (marketplacePreflight) {
          logger.log(
            chalk.gray(
              `  catalog: ${marketplacePreflight.catalogDigest} (${marketplacePreflight.governance.status}; ${marketplaceAuthorityPersisted ? "authority active" : "activation rolled back"})`,
            ),
          );
          if (marketplacePreflight.governance.missing.length) {
            logger.log(
              chalk.yellow(
                `  ⚠ registry governance metadata missing: ${marketplacePreflight.governance.missing.join(", ")}`,
              ),
            );
          }
          logger.log(
            chalk.gray(`  reviewed impact: ${marketplaceImpact.impactDigest}`),
          );
        }

        if (activationStatus === "rolled_back") {
          logger.warn(
            `Upgrade not activated: ${rollbackReason.replaceAll("_", " ")}; ` +
              (rollbackVersion
                ? `restored ${res.name} v${rollbackVersion}`
                : `removed the rejected ${res.name} v${res.version} install`),
          );
        } else if (res.updated) {
          logger.success(
            `Updated ${res.name}: ${res.previousVersion ? `v${res.previousVersion} → ` : ""}v${res.version} (${options.scope} scope)`,
          );
        } else if (res.reinstalled) {
          logger.success(
            `Reinstalled ${res.name} v${res.version} (${options.scope} scope)`,
          );
        } else {
          logger.info(
            `${res.name} is already up to date at v${res.version} (use --force to reinstall)`,
          );
        }
      } catch (err) {
        let recoveryNote = "";
        if (res) {
          try {
            const recovery = rollbackPluginUpdate(res);
            if (recovery.rolledBack) {
              recoveryNote = recovery.version
                ? `; restored v${recovery.version}`
                : "; removed the rejected install";
            }
          } catch (recoveryError) {
            recoveryNote = `; automatic recovery failed: ${recoveryError.message}`;
          }
        }
        logger.error(`Upgrade failed: ${err.message}${recoveryNote}`);
        process.exitCode = 1;
      }
    });

  // plugin use <name> <version> — pin the active version (rollback / switch)
  plugin
    .command("use <name> <version>")
    .description("Pin a plugin's active version (rollback or switch)")
    .option("--scope <scope>", "Scope", "user")
    .action(async (name, version, options) => {
      const { setActiveVersion } =
        await import("../lib/plugin-runtime/install.js");
      try {
        setActiveVersion(name, version, {
          scope: options.scope,
          cwd: process.cwd(),
        });
        logger.success(
          `${name} active version → v${version} (${options.scope} scope)`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return plugin;
}

// === Iter26 V2 governance overlay ===
export function registerPadgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "plugin");
  if (!parent) return;
  const L = async () => await import("../lib/plugin-autodiscovery.js");
  parent
    .command("padgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PADGOV_PROFILE_MATURITY_V2,
            scanLifecycle: m.PADGOV_SCAN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("padgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePadgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPadgovScansPerProfileV2(),
            idleMs: m.getPadgovProfileIdleMsV2(),
            stuckMs: m.getPadgovScanStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("padgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePadgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("padgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPadgovScansPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("padgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPadgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("padgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPadgovScanStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("padgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--root <v>", "root")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPadgovProfileV2({ id, owner, root: o.root }),
          null,
          2,
        ),
      );
    });
  parent
    .command("padgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePadgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("padgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).stalePadgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("padgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePadgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("padgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchPadgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("padgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPadgovProfileV2(id), null, 2));
    });
  parent
    .command("padgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPadgovProfilesV2(), null, 2));
    });
  parent
    .command("padgov-create-scan-v2 <id> <profileId>")
    .description("Create scan")
    .option("--path <v>", "path")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPadgovScanV2({ id, profileId, path: o.path }),
          null,
          2,
        ),
      );
    });
  parent
    .command("padgov-scanning-scan-v2 <id>")
    .description("Mark scan as scanning")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).scanningPadgovScanV2(id), null, 2),
      );
    });
  parent
    .command("padgov-complete-scan-v2 <id>")
    .description("Complete scan")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeScanPadgovV2(id), null, 2),
      );
    });
  parent
    .command("padgov-fail-scan-v2 <id> [reason]")
    .description("Fail scan")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPadgovScanV2(id, reason), null, 2),
      );
    });
  parent
    .command("padgov-cancel-scan-v2 <id> [reason]")
    .description("Cancel scan")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPadgovScanV2(id, reason), null, 2),
      );
    });
  parent
    .command("padgov-get-scan-v2 <id>")
    .description("Get scan")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPadgovScanV2(id), null, 2));
    });
  parent
    .command("padgov-list-scans-v2")
    .description("List scans")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPadgovScansV2(), null, 2));
    });
  parent
    .command("padgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdlePadgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("padgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck scans")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPadgovScansV2(), null, 2),
      );
    });
  parent
    .command("padgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getPluginAutodiscoveryGovStatsV2(), null, 2),
      );
    });
}
