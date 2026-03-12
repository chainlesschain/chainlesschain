/**
 * Terraform commands
 * chainlesschain terraform workspaces|create|plan|runs
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureTerraformTables,
  listWorkspaces,
  createWorkspace,
  planRun,
  listRuns,
} from "../lib/terraform-manager.js";

export function registerTerraformCommand(program) {
  const terraform = program
    .command("terraform")
    .description("Terraform IaC — workspace and run management");

  terraform
    .command("workspaces")
    .description("List Terraform workspaces")
    .option("--status <status>", "Filter by status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureTerraformTables(db);

        const workspaces = listWorkspaces({ status: options.status });
        if (options.json) {
          console.log(JSON.stringify(workspaces, null, 2));
        } else if (workspaces.length === 0) {
          logger.info("No workspaces. Use `terraform create` to add one.");
        } else {
          for (const w of workspaces) {
            logger.log(
              `  ${chalk.cyan(w.id.slice(0, 8))} ${w.name} [${w.status}] tf=${w.terraformVersion} state=v${w.stateVersion}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  terraform
    .command("create <name>")
    .description("Create a Terraform workspace")
    .option("-d, --description <text>", "Workspace description")
    .option("--tf-version <version>", "Terraform version", "1.9.0")
    .option("--auto-apply", "Enable auto-apply")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureTerraformTables(db);

        const ws = createWorkspace(db, name, {
          description: options.description,
          terraformVersion: options.tfVersion,
          autoApply: options.autoApply,
        });
        logger.success("Workspace created");
        logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(ws.id)}`);
        logger.log(`  ${chalk.bold("Name:")}    ${ws.name}`);
        logger.log(`  ${chalk.bold("Version:")} ${ws.terraformVersion}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  terraform
    .command("plan <workspace-id>")
    .description("Run a Terraform plan")
    .option("-t, --type <type>", "Run type: plan, apply, destroy", "plan")
    .action(async (workspaceId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureTerraformTables(db);

        const run = planRun(db, workspaceId, { runType: options.type });
        logger.success(`Run completed: ${run.planOutput}`);
        logger.log(`  ${chalk.bold("Run ID:")}    ${chalk.cyan(run.id)}`);
        logger.log(`  ${chalk.bold("Added:")}     ${run.resourcesAdded}`);
        logger.log(`  ${chalk.bold("Changed:")}   ${run.resourcesChanged}`);
        logger.log(`  ${chalk.bold("Destroyed:")} ${run.resourcesDestroyed}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  terraform
    .command("runs")
    .description("List Terraform runs")
    .option("-w, --workspace <id>", "Filter by workspace ID")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureTerraformTables(db);

        const runs = listRuns({ workspaceId: options.workspace });
        if (options.json) {
          console.log(JSON.stringify(runs, null, 2));
        } else if (runs.length === 0) {
          logger.info("No runs found.");
        } else {
          for (const r of runs) {
            logger.log(
              `  ${chalk.cyan(r.id.slice(0, 8))} ${r.runType} [${r.status}] +${r.resourcesAdded} ~${r.resourcesChanged} -${r.resourcesDestroyed}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
