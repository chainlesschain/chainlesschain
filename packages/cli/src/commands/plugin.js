/**
 * Plugin management commands
 * chainlesschain plugin list|install|remove|enable|disable|update|info|search|registry|summary
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
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
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
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
            const manifestContent = fs.readFileSync(options.manifest, "utf-8");
            const manifest = JSON.parse(manifestContent);
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
              { ...result, skills: skillResult.installed },
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
}
