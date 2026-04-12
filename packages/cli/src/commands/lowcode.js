/**
 * Low-Code Platform commands
 * chainlesschain lowcode create|list|preview|publish|components|datasource|versions|rollback|export|deploy
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureLowcodeTables,
  createApp,
  saveDesign,
  previewApp,
  publishApp,
  listComponents,
  addDataSource,
  getVersions,
  rollbackApp,
  exportApp,
  listApps,
  deployApp,
} from "../lib/app-builder.js";

export function registerLowcodeCommand(program) {
  const lowcode = program
    .command("lowcode")
    .description("Low-code application platform");

  // lowcode create <name>
  lowcode
    .command("create")
    .description("Create a new low-code application")
    .argument("<name>", "Application name")
    .option("--description <desc>", "Application description", "")
    .option(
      "--platform <platform>",
      "Target platform (web|desktop|mobile|all)",
      "web",
    )
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const spinner = ora("Creating application...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const result = createApp(db, {
          name,
          description: options.description,
          platform: options.platform,
        });

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            chalk.green(`Application created: ${chalk.bold(result.name)}`),
          );
          logger.log(`  ID:     ${chalk.cyan(result.id)}`);
          logger.log(`  Status: ${result.status}`);
        }

        await shutdown();
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // lowcode list
  lowcode
    .command("list")
    .description("List all low-code applications")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const apps = listApps(db);

        if (options.json) {
          console.log(JSON.stringify(apps, null, 2));
        } else if (apps.length === 0) {
          logger.info(
            'No applications found. Create one with "chainlesschain lowcode create <name>"',
          );
        } else {
          logger.log(chalk.bold(`Applications (${apps.length}):\n`));
          for (const app of apps) {
            const status =
              app.status === "published"
                ? chalk.green(app.status)
                : chalk.yellow(app.status);
            logger.log(
              `  ${chalk.cyan(app.name)} [${status}] v${app.version} (${app.platform})`,
            );
            if (app.description)
              logger.log(`    ${chalk.gray(app.description)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // lowcode preview <app-id>
  lowcode
    .command("preview")
    .description("Preview application info")
    .argument("<app-id>", "Application ID")
    .action(async (appId) => {
      try {
        const preview = previewApp(appId);

        logger.log(chalk.bold("Application Preview:"));
        logger.log(`  App ID:      ${chalk.cyan(preview.appId)}`);
        logger.log(`  Platform:    ${preview.platform}`);
        logger.log(`  Preview URL: ${chalk.underline(preview.previewUrl)}`);
        logger.log(
          `  Components:  ${(preview.design.components || []).length}`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // lowcode publish <app-id>
  lowcode
    .command("publish")
    .description("Publish an application")
    .argument("<app-id>", "Application ID")
    .action(async (appId) => {
      const spinner = ora("Publishing application...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const result = publishApp(db, appId);
        spinner.succeed(`Application ${chalk.cyan(appId)} published`);

        await shutdown();
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // lowcode components
  lowcode
    .command("components")
    .description("List available built-in components")
    .option("--json", "Output as JSON")
    .action((options) => {
      const components = listComponents();

      if (options.json) {
        console.log(JSON.stringify(components, null, 2));
      } else {
        logger.log(chalk.bold(`Built-in Components (${components.length}):\n`));
        const categories = [...new Set(components.map((c) => c.category))];
        for (const cat of categories) {
          logger.log(chalk.yellow(`  [${cat}]`));
          for (const comp of components.filter((c) => c.category === cat)) {
            logger.log(
              `    ${chalk.cyan(comp.name)} — props: ${comp.props.join(", ")}`,
            );
          }
        }
      }
    });

  // lowcode datasource <app-id> <name> <type>
  lowcode
    .command("datasource")
    .description("Add a data source to an application")
    .argument("<app-id>", "Application ID")
    .argument("<name>", "Data source name")
    .argument("<type>", "Data source type (rest|graphql|database|csv)")
    .option("--config <json>", "Configuration as JSON string", "{}")
    .action(async (appId, name, type, options) => {
      const spinner = ora("Adding data source...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        let config;
        try {
          config = JSON.parse(options.config);
        } catch (_err) {
          // Intentionally ignore parse error — use empty config
          config = {};
        }

        const result = addDataSource(db, appId, name, type, config);
        spinner.succeed(`Data source "${chalk.cyan(name)}" added (${type})`);
        logger.log(`  ID: ${chalk.gray(result.id)}`);

        await shutdown();
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // lowcode versions <app-id>
  lowcode
    .command("versions")
    .description("Show version history for an application")
    .argument("<app-id>", "Application ID")
    .option("--json", "Output as JSON")
    .action((appId, options) => {
      const versions = getVersions(appId);

      if (options.json) {
        console.log(JSON.stringify(versions, null, 2));
      } else if (versions.length === 0) {
        logger.info("No versions found for this application");
      } else {
        logger.log(chalk.bold(`Version History (${versions.length}):\n`));
        for (const v of versions) {
          logger.log(`  v${v.version} — ${v.created_at || "unknown date"}`);
        }
      }
    });

  // lowcode rollback <app-id> <version>
  lowcode
    .command("rollback")
    .description("Rollback application to a previous version")
    .argument("<app-id>", "Application ID")
    .argument("<version>", "Version number to restore")
    .action(async (appId, version) => {
      const spinner = ora(`Rolling back to version ${version}...`).start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const result = rollbackApp(db, appId, parseInt(version, 10));

        if (result.restored) {
          spinner.succeed(`Rolled back to version ${version}`);
        } else {
          spinner.fail(`Version ${version} not found`);
        }

        await shutdown();
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // lowcode export <app-id>
  lowcode
    .command("export")
    .description("Export application definition")
    .argument("<app-id>", "Application ID")
    .option("--json", "Output as JSON")
    .action((appId, options) => {
      const result = exportApp(appId);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        logger.log(chalk.bold("Application Export:"));
        logger.log(`  App ID:       ${chalk.cyan(result.appId)}`);
        logger.log(
          `  App:          ${result.app ? result.app.name : "not found"}`,
        );
        logger.log(`  Data Sources: ${result.dataSources.length}`);
        logger.log(`  Versions:     ${result.versions.length}`);
      }
    });

  // lowcode deploy <app-id>
  lowcode
    .command("deploy")
    .description("Deploy application as static HTML bundle")
    .argument("<app-id>", "Application ID")
    .option("-o, --output <dir>", "Output directory for the deploy bundle")
    .action(async (appId, options) => {
      const spinner = ora("Deploying application...").start();
      let ctx;
      try {
        ctx = await bootstrap();
        ensureLowcodeTables(ctx.db);
        const result = deployApp(ctx.db, appId, {
          outputDir: options.output || undefined,
        });
        spinner.succeed(
          chalk.green(`App ${chalk.cyan(appId)} deployed successfully`),
        );
        logger.log(`  Output:    ${chalk.cyan(result.outputDir)}`);
        logger.log(`  Files:     ${result.files.join(", ")}`);
        logger.log(`  Deployed:  ${result.deployedAt}`);
      } catch (err) {
        spinner.fail(chalk.red(`Deploy failed: ${err.message}`));
      } finally {
        if (ctx) await shutdown(ctx);
      }
    });
}
