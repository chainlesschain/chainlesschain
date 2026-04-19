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
  // V2
  RUN_STATUS_V2,
  RUN_TYPE_V2,
  WORKSPACE_STATUS_V2,
  TERRAFORM_DEFAULT_MAX_CONCURRENT,
  setMaxConcurrentRuns,
  getMaxConcurrentRuns,
  createWorkspaceV2,
  setWorkspaceStatus,
  archiveWorkspace,
  planRunV2,
  setRunStatus,
  cancelRun,
  failRun,
  getActiveRunCount,
  getTerraformStatsV2,
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

  /* ── V2 Subcommands (Phase 56) ──────────────────────────── */

  const withDb = async (fn) => {
    const ctx = await bootstrap({ verbose: program.opts().verbose });
    if (!ctx.db) {
      logger.error("Database not available");
      process.exit(1);
    }
    try {
      const db = ctx.db.getDatabase();
      ensureTerraformTables(db);
      return await fn(db);
    } finally {
      await shutdown();
    }
  };

  terraform
    .command("run-statuses")
    .description("List RUN_STATUS_V2 enum values")
    .action(() => {
      console.log(JSON.stringify(Object.values(RUN_STATUS_V2), null, 2));
    });

  terraform
    .command("run-types")
    .description("List RUN_TYPE_V2 enum values")
    .action(() => {
      console.log(JSON.stringify(Object.values(RUN_TYPE_V2), null, 2));
    });

  terraform
    .command("workspace-statuses")
    .description("List WORKSPACE_STATUS_V2 enum values")
    .action(() => {
      console.log(JSON.stringify(Object.values(WORKSPACE_STATUS_V2), null, 2));
    });

  terraform
    .command("default-max-concurrent")
    .description("Show TERRAFORM_DEFAULT_MAX_CONCURRENT")
    .action(() => {
      console.log(TERRAFORM_DEFAULT_MAX_CONCURRENT);
    });

  terraform
    .command("active-run-count")
    .description("Show current active (non-terminal) run count")
    .action(() => {
      console.log(getActiveRunCount());
    });

  terraform
    .command("set-max-concurrent <n>")
    .description("Set max concurrent runs")
    .action(async (n) => {
      try {
        const value = setMaxConcurrentRuns(Number(n));
        logger.success(`maxConcurrentRuns = ${value}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  terraform
    .command("max-concurrent")
    .description("Show current max concurrent runs")
    .action(() => {
      console.log(getMaxConcurrentRuns());
    });

  terraform
    .command("create-workspace-v2 <name>")
    .description("Create workspace (V2, unique-name enforced)")
    .option("-d, --description <text>", "Workspace description")
    .option("--tf-version <version>", "Terraform version")
    .option("--auto-apply", "Enable auto-apply")
    .option("--providers <list>", "Comma-separated providers")
    .action(async (name, options) => {
      await withDb(async (db) => {
        try {
          const ws = createWorkspaceV2(db, {
            name,
            description: options.description,
            terraformVersion: options.tfVersion,
            autoApply: options.autoApply,
            providers: options.providers
              ? options.providers.split(",").map((s) => s.trim())
              : undefined,
          });
          logger.success("Workspace created (V2)");
          logger.log(`  ID:     ${chalk.cyan(ws.id)}`);
          logger.log(`  Name:   ${ws.name}`);
          logger.log(`  Status: ${ws.status}`);
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("set-workspace-status <workspace-id> <status>")
    .description("Set workspace status (state-machine guarded)")
    .action(async (workspaceId, status) => {
      await withDb(async (db) => {
        try {
          const result = setWorkspaceStatus(db, workspaceId, status);
          logger.success(
            `Workspace ${workspaceId.slice(0, 8)} → ${result.status}`,
          );
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("archive-workspace <workspace-id>")
    .description("Archive a workspace (shortcut)")
    .action(async (workspaceId) => {
      await withDb(async (db) => {
        try {
          const result = archiveWorkspace(db, workspaceId);
          logger.success(`Workspace archived: ${result.status}`);
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("plan-run-v2 <workspace-id>")
    .description("Create a V2 run (pending state, concurrency-limited)")
    .option("-t, --run-type <type>", "Run type: plan|apply|destroy", "plan")
    .option("--triggered-by <who>", "Who triggered the run")
    .action(async (workspaceId, options) => {
      await withDb(async (db) => {
        try {
          const run = planRunV2(db, {
            workspaceId,
            runType: options.runType,
            triggeredBy: options.triggeredBy,
          });
          logger.success("Run created (V2)");
          logger.log(`  ID:     ${chalk.cyan(run.id)}`);
          logger.log(`  Type:   ${run.runType}`);
          logger.log(`  Status: ${run.status}`);
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("set-run-status <run-id> <status>")
    .description("Set run status (state-machine guarded)")
    .option("--plan-output <text>", "Plan output summary")
    .option("--apply-output <text>", "Apply output summary")
    .option("--resources-added <n>", "Resources added count")
    .option("--resources-changed <n>", "Resources changed count")
    .option("--resources-destroyed <n>", "Resources destroyed count")
    .option("--error-message <text>", "Error message")
    .action(async (runId, status, options) => {
      await withDb(async (db) => {
        try {
          const patch = {};
          if (options.planOutput) patch.planOutput = options.planOutput;
          if (options.applyOutput) patch.applyOutput = options.applyOutput;
          if (options.resourcesAdded !== undefined)
            patch.resourcesAdded = Number(options.resourcesAdded);
          if (options.resourcesChanged !== undefined)
            patch.resourcesChanged = Number(options.resourcesChanged);
          if (options.resourcesDestroyed !== undefined)
            patch.resourcesDestroyed = Number(options.resourcesDestroyed);
          if (options.errorMessage) patch.errorMessage = options.errorMessage;
          const run = setRunStatus(db, runId, status, patch);
          logger.success(`Run ${runId.slice(0, 8)} → ${run.status}`);
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("cancel-run <run-id>")
    .description("Cancel a run (shortcut)")
    .action(async (runId) => {
      await withDb(async (db) => {
        try {
          const run = cancelRun(db, runId);
          logger.success(`Run cancelled: ${run.status}`);
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("fail-run <run-id> <error-message>")
    .description("Mark a run as errored (shortcut)")
    .action(async (runId, errorMessage) => {
      await withDb(async (db) => {
        try {
          const run = failRun(db, runId, errorMessage);
          logger.success(`Run errored: ${run.errorMessage}`);
        } catch (err) {
          logger.error(`Failed: ${err.message}`);
          process.exit(1);
        }
      });
    });

  terraform
    .command("stats-v2")
    .description("Show V2 terraform stats")
    .action(async () => {
      await withDb(async () => {
        const stats = getTerraformStatsV2();
        console.log(JSON.stringify(stats, null, 2));
      });
    });
}

// === Iter16 V2 governance overlay ===
export function registerTfgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "terraform");
  if (!parent) return;
  const L = async () => await import("../lib/terraform-manager.js");
  parent
    .command("tfgov-enums-v2")
    .description("Show V2 enums (tfgov maturity + apply lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.TFGOV_PROFILE_MATURITY_V2,
            applyLifecycle: m.TFGOV_APPLY_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("tfgov-config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveTfgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingTfgovApplysPerProfileV2(),
            idleMs: m.getTfgovProfileIdleMsV2(),
            stuckMs: m.getTfgovApplyStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("tfgov-set-max-active-v2 <n>")
    .description("Set max active profiles per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActiveTfgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tfgov-set-max-pending-v2 <n>")
    .description("Set max pending applys per profile")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingTfgovApplysPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tfgov-set-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setTfgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tfgov-set-stuck-ms-v2 <n>")
    .description("Set apply stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setTfgovApplyStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tfgov-register-v2 <id> <owner>")
    .description("Register V2 tfgov profile")
    .option("--provider <v>", "provider")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerTfgovProfileV2({ id, owner, provider: o.provider }),
          null,
          2,
        ),
      );
    });
  parent
    .command("tfgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activateTfgovProfileV2(id), null, 2));
    });
  parent
    .command("tfgov-drift-v2 <id>")
    .description("Drift profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.driftTfgovProfileV2(id), null, 2));
    });
  parent
    .command("tfgov-archive-v2 <id>")
    .description("Archive profile (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archiveTfgovProfileV2(id), null, 2));
    });
  parent
    .command("tfgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchTfgovProfileV2(id), null, 2));
    });
  parent
    .command("tfgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getTfgovProfileV2(id), null, 2));
    });
  parent
    .command("tfgov-list-v2")
    .description("List profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listTfgovProfilesV2(), null, 2));
    });
  parent
    .command("tfgov-create-apply-v2 <id> <profileId>")
    .description("Create apply (queued)")
    .option("--resource <v>", "resource")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createTfgovApplyV2({ id, profileId, resource: o.resource }),
          null,
          2,
        ),
      );
    });
  parent
    .command("tfgov-applying-apply-v2 <id>")
    .description("Mark apply as applying")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.applyingTfgovApplyV2(id), null, 2));
    });
  parent
    .command("tfgov-complete-apply-v2 <id>")
    .description("Complete apply")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.completeApplyTfgovV2(id), null, 2));
    });
  parent
    .command("tfgov-fail-apply-v2 <id> [reason]")
    .description("Fail apply")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.failTfgovApplyV2(id, reason), null, 2));
    });
  parent
    .command("tfgov-cancel-apply-v2 <id> [reason]")
    .description("Cancel apply")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.cancelTfgovApplyV2(id, reason), null, 2));
    });
  parent
    .command("tfgov-get-apply-v2 <id>")
    .description("Get apply")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getTfgovApplyV2(id), null, 2));
    });
  parent
    .command("tfgov-list-applys-v2")
    .description("List applys")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listTfgovApplysV2(), null, 2));
    });
  parent
    .command("tfgov-auto-drift-idle-v2")
    .description("Auto-drift idle profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoDriftIdleTfgovProfilesV2(), null, 2));
    });
  parent
    .command("tfgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck applys")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoFailStuckTfgovApplysV2(), null, 2));
    });
  parent
    .command("tfgov-gov-stats-v2")
    .description("V2 gov aggregate stats")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.getTerraformManagerGovStatsV2(), null, 2));
    });
}
