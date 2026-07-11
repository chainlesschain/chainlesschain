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
  setPluginSetting,
  searchRegistry,
  listRegistry,
  registerInMarketplace,
  getPluginSummary,
  installPluginSkills,
  removePluginSkills,
  getPluginSkills,
} from "../harness/plugin-manager.js";

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
    .action(async (name) => {
      try {
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
    .action(async (name) => {
      try {
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
    .option("--json", "Output as JSON")
    .action(async (source, options) => {
      const { installFromSource } =
        await import("../lib/plugin-runtime/install.js");

      // Remote resolution: a registry/manifest URL (or --registry <url> with a
      // plugin name) resolves to a git source the installer already handles.
      let installSource = source;
      let integritySha = null;
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

      const signature =
        options.sha256 || options.signature || options.publicKey || integritySha
          ? {
              sha256: options.sha256 || integritySha,
              signatureFile: options.signature,
              publicKeyFile: options.publicKey,
              requireSignature: Boolean(options.signature),
            }
          : null;
      try {
        const res = installFromSource(installSource, {
          scope: options.scope,
          cwd: process.cwd(),
          force: options.force === true,
          signature,
        });
        if (options.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          logger.success(
            `Installed ${res.name} v${res.version} (${res.scope} scope)` +
              (res.signatureVerified ? chalk.green(" ✔ signed") : ""),
          );
          logger.log(chalk.gray(`  → ${res.dir}`));
          for (const w of res.warnings || [])
            logger.log(chalk.yellow(`  ⚠ ${w}`));
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
        logger.log(
          `  ${ok} ${chalk.cyan(r.name)} v${r.version} ${chalk.gray(`[${r.scope}]`)} ${trust}`,
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
      "Update a runtime plugin from its source (local dir or git); repoints .active",
    )
    .option("--scope <scope>", `Scope to update in (${SCOPES})`, "user")
    .option("--force", "Reinstall even if the version is unchanged")
    .action(async (source, options) => {
      const { updatePlugin } = await import("../lib/plugin-runtime/install.js");
      try {
        const res = updatePlugin(source, {
          scope: options.scope,
          cwd: process.cwd(),
          force: options.force,
        });
        if (res.updated) {
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
        logger.error(`Upgrade failed: ${err.message}`);
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
