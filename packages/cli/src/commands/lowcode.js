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
  // Phase 93 V2 surface
  COMPONENT_CATEGORY,
  DATASOURCE_TYPE,
  APP_STATUS,
  listComponentsV2,
  registerDataSourceV2,
  testDataSourceConnection,
  updateAppStatus,
  archiveApp,
  getStatusHistory,
  cloneApp,
  exportAppJSON,
  importAppJSON,
  getLowcodeStatsV2,
} from "../lib/app-builder.js";
import fs from "fs";

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

  // ─── Phase 93 V2 subcommands ────────────────────────────────

  // lowcode categories
  lowcode
    .command("categories")
    .description("List component categories (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const categories = Object.values(COMPONENT_CATEGORY);
      if (options.json) {
        console.log(JSON.stringify(categories, null, 2));
      } else {
        logger.log(chalk.bold("Component Categories:"));
        for (const c of categories) logger.log(`  ${chalk.cyan(c)}`);
      }
    });

  // lowcode datasource-types
  lowcode
    .command("datasource-types")
    .description("List supported data source types (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = Object.values(DATASOURCE_TYPE);
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        logger.log(chalk.bold("Data Source Types:"));
        for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
      }
    });

  // lowcode statuses
  lowcode
    .command("statuses")
    .description("List canonical app statuses (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = Object.values(APP_STATUS);
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        logger.log(chalk.bold("App Statuses:"));
        for (const s of statuses) logger.log(`  ${chalk.cyan(s)}`);
      }
    });

  // lowcode components-v2
  lowcode
    .command("components-v2")
    .description("List built-in components with category filter (V2)")
    .option("-c, --category <cat>", "Filter by category")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const list = listComponentsV2(
          options.category ? { category: options.category } : {},
        );
        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          logger.log(chalk.bold(`Components (${list.length}):`));
          for (const c of list) {
            logger.log(
              `  ${chalk.cyan(c.name)} [${c.category}] props: ${c.props.join(", ")}`,
            );
          }
        }
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  // lowcode datasource-v2 <app-id> <name> <type>
  lowcode
    .command("datasource-v2")
    .description("Register a validated data source (V2)")
    .argument("<app-id>", "Application ID")
    .argument("<name>", "Data source name")
    .argument("<type>", "Type: rest|graphql|database|csv")
    .option("--config <json>", "Config as JSON string", "{}")
    .action(async (appId, name, type, options) => {
      const spinner = ora("Registering data source...").start();
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
          config = {};
        }

        const result = registerDataSourceV2(db, {
          appId,
          name,
          type,
          config,
        });
        spinner.succeed(
          `Data source "${chalk.cyan(name)}" registered (${type})`,
        );
        logger.log(`  ID: ${chalk.gray(result.id)}`);

        await shutdown();
      } catch (err) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // lowcode test-connection <datasource-id>
  lowcode
    .command("test-connection")
    .description("Heuristic connection check for a data source (V2)")
    .argument("<datasource-id>", "Data source ID")
    .option("--json", "Output as JSON")
    .action((dsId, options) => {
      const result = testDataSourceConnection(dsId);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const icon = result.ok ? chalk.green("✓") : chalk.red("✗");
        logger.log(
          `${icon} ${chalk.cyan(dsId)} (${result.type || "?"}): ${result.reason}`,
        );
      }
    });

  // lowcode set-status <app-id> <status>
  lowcode
    .command("set-status")
    .description("Update app status with validated transition (V2)")
    .argument("<app-id>", "Application ID")
    .argument("<status>", "New status: draft|published|archived")
    .action(async (appId, status) => {
      const spinner = ora(`Transitioning to ${status}...`).start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const result = updateAppStatus(db, { appId, status });
        spinner.succeed(
          `${chalk.cyan(appId)}: ${result.previous} → ${chalk.bold(result.status)}`,
        );

        await shutdown();
      } catch (err) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // lowcode archive <app-id>
  lowcode
    .command("archive")
    .description("Archive an application (V2)")
    .argument("<app-id>", "Application ID")
    .action(async (appId) => {
      const spinner = ora("Archiving...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        archiveApp(db, appId);
        spinner.succeed(`${chalk.cyan(appId)} archived`);

        await shutdown();
      } catch (err) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // lowcode status-history <app-id>
  lowcode
    .command("status-history")
    .description("Show status transition history for an app (V2)")
    .argument("<app-id>", "Application ID")
    .option("--json", "Output as JSON")
    .action((appId, options) => {
      const hist = getStatusHistory(appId);
      if (options.json) {
        console.log(JSON.stringify(hist, null, 2));
      } else if (hist.length === 0) {
        logger.info("No status transitions recorded");
      } else {
        logger.log(chalk.bold(`Status History (${hist.length}):`));
        for (const h of hist) {
          logger.log(`  ${chalk.gray(h.at)}  ${h.from} → ${chalk.cyan(h.to)}`);
        }
      }
    });

  // lowcode clone <source-id>
  lowcode
    .command("clone")
    .description("Clone an application (V2)")
    .argument("<source-id>", "Source app ID")
    .option("--name <name>", "New name for the clone")
    .action(async (sourceId, options) => {
      const spinner = ora("Cloning...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const result = cloneApp(db, {
          sourceId,
          newName: options.name,
        });
        spinner.succeed(`Cloned ${chalk.cyan(sourceId)} → ${result.clonedId}`);
        logger.log(`  Name: ${result.name}`);

        await shutdown();
      } catch (err) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // lowcode export-json <app-id>
  lowcode
    .command("export-json")
    .description("Export an app as canonical JSON (V2)")
    .argument("<app-id>", "Application ID")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .action(async (appId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const result = exportAppJSON(db, appId);
        const json = JSON.stringify(result, null, 2);
        if (options.output) {
          fs.writeFileSync(options.output, json, "utf-8");
          logger.log(chalk.green(`Wrote ${options.output}`));
        } else {
          console.log(json);
        }

        await shutdown();
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  // lowcode import-json <file>
  lowcode
    .command("import-json")
    .description("Import an app from a canonical JSON file (V2)")
    .argument("<file>", "Path to JSON export")
    .action(async (file) => {
      const spinner = ora("Importing...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureLowcodeTables(db);

        const raw = fs.readFileSync(file, "utf-8");
        const json = JSON.parse(raw);
        const result = importAppJSON(db, json);
        spinner.succeed(
          `Imported "${chalk.cyan(result.name)}" → ${result.importedId}`,
        );
        logger.log(`  Data sources: ${result.dataSources}`);

        await shutdown();
      } catch (err) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // lowcode stats-v2
  lowcode
    .command("stats-v2")
    .description("Low-code platform statistics (V2)")
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

        const stats = getLowcodeStatsV2(db);
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(chalk.bold("Low-Code Stats (V2):"));
          logger.log(`  Total apps:    ${chalk.cyan(stats.totalApps)}`);
          logger.log(`  By status:     ${JSON.stringify(stats.byStatus)}`);
          logger.log(`  By platform:   ${JSON.stringify(stats.byPlatform)}`);
          logger.log(
            `  Data sources:  ${stats.dataSources.total} (${JSON.stringify(stats.dataSources.byType)})`,
          );
          logger.log(`  Components:    ${stats.componentsAvailable}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
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

  _registerAppBuilderV2Commands(lowcode);
}

function _registerAppBuilderV2Commands(parent) {
  const L = async () => await import("../lib/app-builder.js");
  parent.command("enums-v2").description("Show V2 enums (app maturity + build lifecycle)")
    .action(async () => { const m = await L(); console.log(JSON.stringify({ appMaturity: m.APP_MATURITY_V2, buildLifecycle: m.APP_BUILD_LIFECYCLE_V2 }, null, 2)); });
  parent.command("config-v2").description("Show V2 config thresholds")
    .action(async () => { const m = await L(); console.log(JSON.stringify({ maxActiveAppsPerOwner: m.getMaxActiveAppsPerOwnerV2(), maxPendingAppBuildsPerApp: m.getMaxPendingAppBuildsPerAppV2(), appIdleMs: m.getAppIdleMsV2(), appBuildStuckMs: m.getAppBuildStuckMsV2() }, null, 2)); });
  parent.command("set-max-active-apps-v2 <n>").description("Set max active apps per owner")
    .action(async (n) => { const m = await L(); m.setMaxActiveAppsPerOwnerV2(Number(n)); console.log("ok"); });
  parent.command("set-max-pending-builds-v2 <n>").description("Set max pending builds per app")
    .action(async (n) => { const m = await L(); m.setMaxPendingAppBuildsPerAppV2(Number(n)); console.log("ok"); });
  parent.command("set-app-idle-ms-v2 <n>").description("Set app idle threshold (ms)")
    .action(async (n) => { const m = await L(); m.setAppIdleMsV2(Number(n)); console.log("ok"); });
  parent.command("set-build-stuck-ms-v2 <n>").description("Set build stuck threshold (ms)")
    .action(async (n) => { const m = await L(); m.setAppBuildStuckMsV2(Number(n)); console.log("ok"); });
  parent.command("register-app-v2 <id> <owner>").description("Register V2 app")
    .option("--name <n>", "App name").action(async (id, owner, o) => { const m = await L(); console.log(JSON.stringify(m.registerAppV2({ id, owner, name: o.name }), null, 2)); });
  parent.command("activate-app-v2 <id>").description("Activate app")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.activateAppV2(id), null, 2)); });
  parent.command("pause-app-v2 <id>").description("Pause app")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.pauseAppV2(id), null, 2)); });
  parent.command("archive-app-v2 <id>").description("Archive app (terminal)")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.archiveAppV2(id), null, 2)); });
  parent.command("touch-app-v2 <id>").description("Touch app lastTouchedAt")
    .action(async (id) => { const m = await L(); console.log(JSON.stringify(m.touchAppV2(id), null, 2)); });
  parent.command("get-app-v2 <id>").description("Get V2 app").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getAppV2(id), null, 2)); });
  parent.command("list-apps-v2").description("List V2 apps").action(async () => { const m = await L(); console.log(JSON.stringify(m.listAppsV2(), null, 2)); });
  parent.command("create-build-v2 <id> <appId>").description("Create V2 app build (queued)")
    .option("--target <t>", "Target", "web").action(async (id, appId, o) => { const m = await L(); console.log(JSON.stringify(m.createAppBuildV2({ id, appId, target: o.target }), null, 2)); });
  parent.command("start-build-v2 <id>").description("Start build").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.startAppBuildV2(id), null, 2)); });
  parent.command("succeed-build-v2 <id>").description("Succeed build").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.succeedAppBuildV2(id), null, 2)); });
  parent.command("fail-build-v2 <id> [reason]").description("Fail build").action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.failAppBuildV2(id, reason), null, 2)); });
  parent.command("cancel-build-v2 <id> [reason]").description("Cancel build").action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.cancelAppBuildV2(id, reason), null, 2)); });
  parent.command("get-build-v2 <id>").description("Get V2 build").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getAppBuildV2(id), null, 2)); });
  parent.command("list-builds-v2").description("List V2 builds").action(async () => { const m = await L(); console.log(JSON.stringify(m.listAppBuildsV2(), null, 2)); });
  parent.command("auto-pause-idle-v2").description("Auto-pause idle active apps")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.autoPauseIdleAppsV2(), null, 2)); });
  parent.command("auto-fail-stuck-v2").description("Auto-fail stuck building builds")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.autoFailStuckAppBuildsV2(), null, 2)); });
  parent.command("gov-stats-v2").description("V2 governance aggregate stats")
    .action(async () => { const m = await L(); console.log(JSON.stringify(m.getAppBuilderGovStatsV2(), null, 2)); });
}
